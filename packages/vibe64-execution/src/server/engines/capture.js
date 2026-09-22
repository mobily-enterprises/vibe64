import { execa } from "execa";

import {
  commandErrorResult,
  commandResult
} from "../result.js";
import {
  drainProcessGroup
} from "./detached.js";

// Retain failed drains so the execution owner can retry the same stop.
const capturedExecutions = new Map();

async function stopCaptureExecution(executionId) {
  const stop = capturedExecutions.get(executionId);
  if (!stop) return { ok: false, code: "vibe64_execution_not_found" };
  const scopeEmpty = await stop();
  if (scopeEmpty) capturedExecutions.delete(executionId);
  return {
    ok: scopeEmpty,
    executionId,
    scopeEmpty,
    ...(scopeEmpty ? {} : {
      code: "vibe64_execution_drain_failed",
      error: "The command's process group could not be stopped."
    })
  };
}

async function runCaptureCommand(command = "", args = [], {
  cwd = "",
  env = {},
  execution = null,
  input = undefined,
  maxBuffer = undefined,
  onOutput = null,
  outputEncoding = "utf8",
  signal = null,
  timeout = 15_000
} = {}) {
  let outcome;
  let stop;
  let cancellation;
  const cancellationFinished = Promise.withResolvers();
  const abort = () => {
    cancellation ||= stop();
    cancellation.then(cancellationFinished.resolve);
  };
  if (signal?.aborted) {
    return commandErrorResult("Command cancelled.", "vibe64_command_cancelled", { execution });
  }
  try {
    const subprocess = execa(command, args, {
      all: true,
      cwd,
      detached: process.platform !== "win32",
      encoding: outputEncoding,
      env,
      extendEnv: false,
      input,
      maxBuffer,
      reject: false,
      stdin: input === undefined || input === null ? "ignore" : "pipe",
      stripFinalNewline: false,
      timeout
    });
    const processGroupId = Number(subprocess.pid);
    let stopping;
    stop = () => {
      if (!stopping) {
        let drain;
        if (process.platform !== "win32") {
          drain = drainProcessGroup(processGroupId).catch(() => false);
        } else {
          subprocess.kill("SIGKILL");
          drain = subprocess.then(() => true, () => true);
        }
        stopping = drain.then((scopeEmpty) => {
          if (!scopeEmpty) stopping = null;
          return scopeEmpty;
        });
      }
      return stopping;
    };
    if (execution?.id) capturedExecutions.set(execution.id, stop);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (typeof onOutput === "function" && subprocess.all) {
      subprocess.all.on("data", (chunk) => {
        try {
          onOutput(String(chunk || ""));
        } catch {
          // Output observers must not change command execution semantics.
        }
      });
    }
    const result = await Promise.race([
      subprocess,
      cancellationFinished.promise.then((scopeEmpty) => scopeEmpty ? subprocess : { exitCode: 1 })
    ]);
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : 1;
    outcome = commandResult({
      code: result.timedOut === true
        ? "vibe64_command_capture_timed_out"
        : result.code ? "vibe64_command_capture_failed" : "",
      error: exitCode === 0 ? "" : result.shortMessage,
      exitCode,
      output: result.all || (exitCode === 0 ? "" : result.shortMessage),
      outputEncoding,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
      timedOut: result.timedOut === true,
      execution
    });
  } catch (error) {
    outcome = commandErrorResult(error.message, "vibe64_command_capture_failed", {
      execution,
      exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
      output: error.all,
      outputEncoding,
      signal: error.signal,
      stderr: error.stderr,
      stdout: error.stdout,
      timedOut: error.timedOut === true
    });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  const scopeEmpty = await (cancellation || stop?.() || true);
  if (!scopeEmpty) {
    return commandErrorResult(
      "The command finished, but its execution scope did not become empty.",
      "vibe64_execution_drain_failed",
      {
        execution,
        output: outcome?.output,
        outputEncoding,
        stderr: outcome?.stderr,
        stdout: outcome?.stdout
      }
    );
  }
  if (execution?.id) capturedExecutions.delete(execution.id);
  if (signal?.aborted) {
    return commandErrorResult("Command cancelled.", "vibe64_command_cancelled", {
      ...outcome, execution, outputEncoding
    });
  }
  return outcome;
}

export {
  runCaptureCommand,
  stopCaptureExecution
};
