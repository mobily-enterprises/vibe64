import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

import {
  commandErrorResult,
  commandResult
} from "../result.js";

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
    setImmediate(() => settle(resolve));
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
    child.unref?.();
    return commandResult({
      exitCode: 0,
      ok: true,
      output: "Detached command started.",
      pid: child.pid
    });
  } catch (error) {
    return commandErrorResult(
      error?.message || "Detached command failed to start.",
      error?.code || "vibe64_command_detached_failed"
    );
  } finally {
    await logHandle?.close?.().catch(() => null);
  }
}

export {
  runDetachedCommand
};
