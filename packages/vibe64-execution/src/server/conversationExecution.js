import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runVibe64Command } from "./runVibe64Command.js";
import { inspectVibe64Service, stopVibe64Execution } from "./managedExecution.js";

const bridgePath = fileURLToPath(new URL("./engines/stdioBridge.js", import.meta.url));

/** Common native-conversation execution facility backed by Vibe64's policy gateway. */
export function createVibe64ConversationExecution({
  commandRunner = runVibe64Command, stopExecution = stopVibe64Execution, inspectExecution = inspectVibe64Service,
  credentialHome = { home: os.homedir() }, execution = {}, shimDirs = [],
  purpose = "assistant", operationId = "conversation", label = "Assistant", logPath, onStarted
} = {}) {
  const entries = new Map();
  async function stop(id, options = {}) {
    const entry = entries.get(id);
    if (entry?.stopping) return entry.stopping;
    const stopping = (async () => {
      // A restored conversation supplies its durable execution ID. The gateway,
      // not this transient socket map, proves ownership and drains that scope.
      const proof = await stopExecution(id, {
        allowMissingRecordScopeRecovery: true, reason: `${operationId}-stop`, termTimeoutMs: 3_000,
        ...options
      });
      if (proof?.scopeEmpty === true && entry) {
        entry.running = false;
        entry.observation.abort();
        entry.exit.resolve({ code: null, signal: null });
        entry.socket?.destroy();
        await rm(entry.root, { recursive: true, force: true });
        entries.delete(id);
      }
      return proof;
    })().finally(() => { if (entry) entry.stopping = null; });
    if (entry) entry.stopping = stopping;
    return stopping;
  }
  async function observe(id, entry) {
    try {
      while (entry.running) {
        const status = await inspectExecution(id);
        if (entry.observation.signal.aborted) return;
        if (status?.ok !== true || typeof status.running !== "boolean") {
          throw new Error("The execution host could not observe the native process.");
        }
        if (!status.running) {
          entry.running = false;
          entry.exit.resolve({ code: status.exitCode ?? null, signal: status.signal || null });
          return;
        }
        await delay(1_000, undefined, { signal: entry.observation.signal });
      }
    } catch (error) {
      if (entry.observation.signal.aborted) return;
      entry.running = false;
      entry.exit.reject(error);
    }
  }
  return Object.freeze({
    stop,
    async start({ command, args = [], cwd, env, stream = false } = {}) {
      if (!cwd || !path.isAbsolute(cwd)) throw new TypeError("Native execution requires an absolute workspace directory.");
      // A driver can isolate its own configuration/state without borrowing the
      // account's home. The gateway still validates those paths against the actor.
      const processHome = { ...credentialHome };
      for (const [field, name] of [["home", "HOME"], ["cacheRoot", "XDG_CACHE_HOME"],
        ["configRoot", "XDG_CONFIG_HOME"], ["dataRoot", "XDG_DATA_HOME"], ["stateRoot", "XDG_STATE_HOME"]]) {
        if (env?.[name] === undefined) continue;
        if (typeof env[name] !== "string" || !path.isAbsolute(env[name])) throw new TypeError(`Native ${name} must be an absolute directory.`);
        processHome[field] = env[name];
      }
      const root = await mkdtemp(path.join(os.tmpdir(), `v64-conversation-${process.getuid?.() ?? "user"}-`));
      const socketPath = path.join(root, "stream.sock");
      const outputPath = logPath || path.join(root, "stderr.log");
      let id;
      try {
        const result = await commandRunner({
          actor: "app", command: stream ? process.execPath : command,
          args: stream ? [bridgePath, socketPath, command, ...args] : args,
          baseEnv: env, inheritProcessEnv: false, credentialHome: processHome, cwd,
          allowedRoots: [cwd], envPolicy: "auth", purpose, mode: "detached",
          shimDirs, runtimes: ["node26", "operator-clis"], logPath: outputPath,
          execution: { ...execution, kind: "assistant", lifecycle: "service",
            operationId, ownerId: execution.ownerId || randomUUID(), label }
        });
        if (result?.ok !== true || !String(result?.execution?.id ?? "").trim()) {
          const error = new Error(String(result?.error || result?.output || "").trim() || "The native process could not start.");
          error.code = result?.code;
          error.execution = result?.execution;
          error.retryable = result?.retryable === true;
          throw error;
        }
        id = result.execution.id;
        const entry = { root, socket: null, stopping: null, running: true,
          observation: new AbortController(), exit: Promise.withResolvers() };
        // Startup can fail before the driver has received its handle.
        entry.exit.promise.catch(() => {});
        entries.set(id, entry);
        void observe(id, entry);
        await onStarted?.(id);
        if (stream) {
          const deadline = Date.now() + 30_000;
          while (!entry.socket) {
            if (!entry.running) {
              await entry.exit.promise;
              throw new Error("The native process exited before its stream was ready.");
            }
            try {
              entry.socket = await new Promise((resolve, reject) => {
                const socket = net.createConnection({ path: socketPath, allowHalfOpen: true });
                socket.on("error", () => {});
                socket.once("connect", () => { socket.off("error", reject); resolve(socket); });
                socket.once("error", (error) => { socket.destroy(); reject(error); });
              });
            } catch (error) {
              if (!["ENOENT", "ECONNREFUSED"].includes(error.code) || Date.now() >= deadline) throw error;
              await delay(25);
            }
          }
        }
        return Object.freeze({ id, pid: result.pid, stdin: entry.socket, stdout: entry.socket, exited: entry.exit.promise,
          readLogs() {
            let descriptor;
            try {
              descriptor = openSync(outputPath, "r");
              const size = fstatSync(descriptor).size;
              const output = Buffer.alloc(Math.min(size, 64 * 1024));
              readSync(descriptor, output, 0, output.length, Math.max(0, size - output.length));
              return { stderr: output.toString("utf8").trim(), stdout: "" };
            } catch (error) {
              if (error.code === "ENOENT") return { stderr: "", stdout: "" };
              throw error;
            } finally { if (descriptor !== undefined) closeSync(descriptor); }
          },
          get running() { return entry.running; } });
      } catch (error) {
        if (id) {
          error.executionId = id;
          try { error.stopProof = await stop(id); }
          catch (cleanupError) { error.cleanupError = cleanupError; error.stopProof = { scopeEmpty: false }; }
          if (error.stopProof?.scopeEmpty !== true) error.cleanupFailed = true;
        } else await rm(root, { recursive: true, force: true });
        throw error;
      }
    }
  });
}
