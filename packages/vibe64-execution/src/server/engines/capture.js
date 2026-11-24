import {
  commandErrorResult,
  commandResult
} from "../result.js";
import { startCaptureProcess } from "./captureProcess.js";
import {
  drainProcessGroup,
  processGroupMembers
} from "./detached.js";

// Retain failed drains so the execution owner can retry the same stop.
const capturedExecutions = new Map();
// Every capture still running, with when it started: the server's stop ends them (endCaptures), so no command the
// editor started outlives it. Each leads its own process group, which nothing else ends when the server exits.
const liveCaptures = new Set();

/**
 * Ends the captures still running that started before `startedBefore` (epoch ms; all by default): SIGTERM to each
 * one's process group before this returns, then SIGKILL to a group still there after `termTimeoutMs`. Each one's
 * caller gets its command's end as usual, killed by that signal. Never throws.
 * @param {{ startedBefore?: number, termTimeoutMs?: number, killTimeoutMs?: number }} [options]
 * @returns {Promise<{ ended: number, scopeEmpty: boolean }>} `ended` counts the captures no earlier call was ending
 */
async function endCaptures({ startedBefore = Infinity, termTimeoutMs = 100, killTimeoutMs = 100 } = {}) {
  const ending = [...liveCaptures].filter((capture) => capture.startedAt < startedBefore);
  const ended = ending.filter((capture) => !capture.ending).length;
  const drained = await Promise.all(ending.map((capture) => {
    capture.ending = true;
    return drainProcessGroup(capture.processGroupId, { termTimeoutMs, killTimeoutMs }).catch(() => false);
  }));
  return { ended, scopeEmpty: drained.every(Boolean) };
}

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

async function runCaptureCommand(command = "", args = [], options = {}) {
  const {
    cwd = "",
    env = {},
    execution = null,
    input = undefined,
    maxBuffer = undefined,
    onOutput = null,
    outputEncoding = "utf8",
    signal = null,
    timeout = 15_000
  } = options;
  let outcome;
  let stop;
  let cancellation;
  let processGroupId = null;
  const cancellationFinished = Promise.withResolvers();
  const abort = () => {
    cancellation ||= stop();
    cancellation.then(cancellationFinished.resolve);
  };
  if (signal?.aborted) {
    return commandErrorResult("Command cancelled.", "vibe64_command_cancelled", { execution });
  }
  try {
    const subprocess = startCaptureProcess(command, args, {
      cwd,
      env,
      input,
      maxBuffer,
      onOutput,
      outputEncoding,
      timeout
    });
    processGroupId = Number(subprocess.pid);
    if (process.platform !== "win32" && Number.isSafeInteger(processGroupId) && processGroupId > 0) {
      const live = { ending: false, processGroupId, startedAt: Date.now() };
      liveCaptures.add(live);
      void subprocess.completion.then(() => liveCaptures.delete(live));
    }
    let stopping;
    stop = () => {
      if (!stopping) {
        let drain;
        if (process.platform !== "win32") {
          drain = drainProcessGroup(processGroupId).catch(() => false);
        } else {
          subprocess.kill("SIGKILL");
          drain = subprocess.completion.then(() => true);
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
    const result = await Promise.race([
      subprocess.completion,
      cancellationFinished.promise.then((scopeEmpty) => scopeEmpty ? subprocess.completion : { exitCode: 1 })
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
    // spawn refused its arguments before any process started.
    outcome = commandErrorResult(error.message, "vibe64_command_capture_failed", {
      execution,
      outputEncoding
    });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  const scopeEmpty = await (cancellation || stop?.() || true);
  if (!scopeEmpty) {
    // The scope stays the owner's to clean up, but the command's own outcome
    // is kept: a timeout is still a timeout, and the error names what is left.
    const remainingProcesses = await processGroupMembers(processGroupId);
    const ended = outcome?.timedOut ? "The command timed out"
      : signal?.aborted ? "The command was cancelled" : "The command finished";
    const remaining = remainingProcesses.length
      ? `: ${remainingProcesses.map(member => `${member.command} (pid ${member.pid})`).join(", ")} still running`
      : "";
    return {
      ...commandErrorResult(
        `${ended}, and its execution scope did not become empty${remaining}.`,
        "vibe64_execution_drain_failed",
        {
          execution,
          output: outcome?.output,
          outputEncoding,
          signal: outcome?.signal,
          stderr: outcome?.stderr,
          stdout: outcome?.stdout,
          timedOut: outcome?.timedOut
        }
      ),
      remainingProcesses
    };
  }
  if (execution?.id) capturedExecutions.delete(execution.id);
  const finishedExecution = execution ? { ...execution, state: "finished" } : execution;
  if (signal?.aborted) {
    return commandErrorResult("Command cancelled.", "vibe64_command_cancelled", {
      ...outcome,
      execution: finishedExecution,
      outputEncoding
    });
  }
  return finishedExecution ? { ...outcome, execution: finishedExecution } : outcome;
}

export {
  endCaptures,
  runCaptureCommand,
  stopCaptureExecution
};
