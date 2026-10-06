import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

import {
  commandErrorResult,
  commandResult
} from "../result.js";

const detachedExecutions = new Map();
const DEFAULT_STOP_TERM_MS = 3000;
const DEFAULT_STOP_KILL_MS = 1000;

async function openDetachedLog(logPath = "") {
  if (!logPath) {
    return null;
  }
  await mkdir(path.dirname(logPath), {
    recursive: true
  });
  return open(logPath, "w", 0o600);
}

async function waitForDetachedSpawn(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };
    child.once?.("spawn", () => settle(resolve));
    child.once?.("error", (error) => settle(reject, error));
  });
}

async function runDetachedCommand(request = {}, {
  cwd = "",
  env = {}
} = {}) {
  let logHandle = null;
  try {
    logHandle = await openDetachedLog(request.logPath);
    const stdio = logHandle
      ? ["ignore", logHandle.fd, logHandle.fd]
      : ["ignore", "ignore", "ignore"];
    const child = spawn(request.command, request.args, {
      cwd: cwd || undefined,
      detached: true,
      env,
      stdio
    });
    await waitForDetachedSpawn(child);
    const executionId = request.execution?.id || "";
    if (executionId) {
      detachedExecutions.set(executionId, {
        child,
        pid: Number(child.pid)
      });
      child.once?.("exit", () => {
        if (!processGroupExists(child.pid)) {
          detachedExecutions.set(executionId, {
            child,
            pid: Number(child.pid),
            scopeEmpty: true
          });
        }
      });
    }
    child.unref?.();
    return commandResult({
      execution: request.execution,
      exitCode: 0,
      ok: true,
      output: "Detached command started.",
      pid: child.pid
    });
  } catch (error) {
    return commandErrorResult(
      error?.message || "Detached command failed to start.",
      error?.code || "vibe64_command_detached_failed",
      { execution: request.execution }
    );
  } finally {
    await logHandle?.close?.().catch(() => null);
  }
}

function processGroupExists(processGroupId = null) {
  const normalized = Number(processGroupId);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    const execution = [...detachedExecutions.values()]
      .find((candidate) => candidate.pid === normalized);
    return execution?.child?.exitCode === null && execution?.child?.signalCode === null;
  }
  try {
    process.kill(-normalized, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalProcessGroup(processGroupId = null, signal = "SIGTERM") {
  if (!processGroupExists(processGroupId)) {
    return false;
  }
  try {
    if (process.platform === "win32") {
      const execution = [...detachedExecutions.values()]
        .find((candidate) => candidate.pid === Number(processGroupId));
      execution?.child?.kill?.(signal);
    } else {
      process.kill(-Number(processGroupId), signal);
    }
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForProcessGroupEmpty(processGroupId = null, timeoutMs = 0) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (processGroupExists(processGroupId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(processGroupId);
}

async function drainProcessGroup(processGroupId = null, {
  killTimeoutMs = DEFAULT_STOP_KILL_MS,
  termTimeoutMs = DEFAULT_STOP_TERM_MS
} = {}) {
  signalProcessGroup(processGroupId, "SIGTERM");
  let empty = await waitForProcessGroupEmpty(processGroupId, termTimeoutMs);
  if (!empty) {
    signalProcessGroup(processGroupId, "SIGKILL");
    empty = await waitForProcessGroupEmpty(processGroupId, killTimeoutMs);
  }
  return empty;
}

async function stopDetachedExecution(executionId = "", {
  killTimeoutMs = DEFAULT_STOP_KILL_MS,
  termTimeoutMs = DEFAULT_STOP_TERM_MS
} = {}) {
  const normalizedExecutionId = String(executionId || "").trim();
  const execution = detachedExecutions.get(normalizedExecutionId);
  if (!execution) {
    return {
      code: "vibe64_execution_not_found",
      error: "The execution is not owned by this process.",
      executionId: normalizedExecutionId,
      ok: false,
      scopeEmpty: false,
      stopped: false
    };
  }
  if (execution.scopeEmpty === true) {
    detachedExecutions.delete(normalizedExecutionId);
    return {
      executionId: normalizedExecutionId,
      ok: true,
      scopeEmpty: true,
      stopped: false
    };
  }
  const empty = await drainProcessGroup(execution.pid, {
    killTimeoutMs,
    termTimeoutMs
  });
  if (!empty) {
    return {
      code: "vibe64_execution_drain_failed",
      error: "The execution process group did not become empty.",
      executionId: normalizedExecutionId,
      ok: false,
      scopeEmpty: false,
      stopped: false
    };
  }
  detachedExecutions.delete(normalizedExecutionId);
  return {
    executionId: normalizedExecutionId,
    ok: true,
    scopeEmpty: true,
    stopped: true
  };
}

function inspectDetachedExecution(executionId) {
  const execution = detachedExecutions.get(executionId);
  const running = Boolean(execution && !execution.scopeEmpty && processGroupExists(execution.pid));
  return { ok: true, scopeEmpty: !running, activeState: running ? "active" : "inactive",
    running: Boolean(execution && execution.child.exitCode === null && execution.child.signalCode === null),
    exitCode: execution?.child.exitCode ?? null, signal: execution?.child.signalCode ?? null
  };
}

export {
  inspectDetachedExecution,
  drainProcessGroup,
  processGroupExists,
  runDetachedCommand,
  stopDetachedExecution
};
