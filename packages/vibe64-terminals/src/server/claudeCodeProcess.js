import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runVibe64Command, shellQuote, stopVibe64Execution } from "@local/vibe64-execution/server";
import { createClaudeJsonClient } from "@local/vibe64-runtime/server/claudeStreamJson";

const CLAUDE_CODE_VERSION = "2.1.278";
const bridgePath = fileURLToPath(new URL("./claudeStdioBridge.js", import.meta.url));

function claudeCodeArguments({
  sessionId, resume = false, model = "", effort = "", toolFree = false,
  outputSchema, terminal = false, systemPrompt, appendSystemPrompt
} = {}) {
  const args = terminal ? [] : ["--print", "--input-format", "stream-json", "--output-format", "stream-json",
    "--verbose", "--include-partial-messages", "--replay-user-messages"];
  if (sessionId) args.push(resume ? "--resume" : "--session-id", sessionId);
  if (systemPrompt) args.push("--system-prompt", systemPrompt);
  if (appendSystemPrompt) args.push("--append-system-prompt", appendSystemPrompt);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (toolFree) {
    args.push("--safe-mode", "--restricted", "--tools", "", "--disallowedTools", "mcp__*",
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"fallbackModel":[]}');
  } else {
    const commandHook = {
      type: "command",
      timeout: 30,
      command: [
        process.execPath,
        fileURLToPath(import.meta.resolve("@local/vibe64-runtime/server/agentSessionCommandHook"))
      ].map(shellQuote).join(" ")
    };
    args.push("--permission-mode", "bypassPermissions", "--settings", JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [commandHook] }] }
    }));
  }
  if (outputSchema) args.push("--json-schema", JSON.stringify(outputSchema));
  return args;
}

async function createClaudeCodeProcess({
  command = "claude", commandRunner = runVibe64Command, stopExecution = stopVibe64Execution,
  credentialHome = { home: os.homedir() }, env = process.env, execution = {},
  workdir, shimDirs = [], onEvent, onFailure, onStarted, ...options
} = {}) {
  if (!workdir || !path.isAbsolute(workdir)) throw new TypeError("Claude requires an absolute workspace directory.");
  const root = await mkdtemp(path.join(os.tmpdir(), `v64-claude-${process.getuid?.() ?? "user"}-`));
  const socketPath = path.join(root, "stream.sock");
  const ownerId = execution.ownerId || randomUUID();
  let client;
  let executionId = "";
  let started = false;
  let stopped = false;
  let stopping;
  async function stop() {
    if (stopped) return { exited: true, scopeEmpty: true };
    if (stopping) return stopping;
    stopping = (async () => {
      client?.close();
      const proof = started ? await stopExecution(executionId, {
        allowMissingRecordScopeRecovery: true, reason: "claude-code-stop", termTimeoutMs: 3_000
      }) : { scopeEmpty: true };
      stopped = proof?.scopeEmpty === true;
      if (stopped) await rm(root, { recursive: true, force: true });
      return { ...proof, exited: stopped };
    })().finally(() => { stopping = null; });
    return stopping;
  }
  try {
    // No API credential injection or OAuth extraction. Use Claude's native home.
    const baseEnv = { ...env, DISABLE_AUTOUPDATER: "1" };
    for (const name of [
      "DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE",
      "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"
    ]) delete baseEnv[name];
    const result = await commandRunner({
      actor: "app", command: process.execPath,
      args: [bridgePath, socketPath, command, ...claudeCodeArguments(options)],
      baseEnv, inheritProcessEnv: false, credentialHome, cwd: workdir,
      allowedRoots: [workdir], envPolicy: "auth", purpose: options.toolFree ? "account" : "assistant", mode: "detached",
      shimDirs, runtimes: ["node26", "operator-clis"], logPath: path.join(root, "stderr.log"),
      execution: { ...execution, kind: "assistant", lifecycle: "service",
        operationId: "claude-code", ownerId, label: "Claude Code assistant" }
    });
    if (result?.ok !== true) throw Object.assign(new Error(result?.error || "Claude could not start."), { code: result?.code });
    started = true;
    executionId = result.execution.id;
    await onStarted?.(executionId);
    const deadline = Date.now() + 30_000;
    let stream;
    while (!stream) {
      try {
        stream = await new Promise((resolve, reject) => {
          const socket = net.createConnection(socketPath);
          socket.once("connect", () => { socket.off("error", reject); resolve(socket); });
          socket.once("error", (error) => { socket.destroy(); reject(error); });
        });
      } catch (error) {
        if (!["ENOENT", "ECONNREFUSED"].includes(error.code) || Date.now() >= deadline) throw error;
        await delay(25);
      }
    }
    client = createClaudeJsonClient({ stream, onEvent, onFailure });
    const initialization = await client.initialize();
    return { client, initialization, executionId, stop };
  } catch (error) {
    const proof = await stop();
    if (!proof.exited) error.stopProof = proof;
    throw error;
  }
}

export { CLAUDE_CODE_VERSION, claudeCodeArguments, createClaudeCodeProcess };
