import { execa } from "execa";

import {
  commandErrorResult,
  commandResult
} from "../result.js";
import {
  drainProcessGroup
} from "./detached.js";

async function runCaptureCommand(command = "", args = [], {
  cwd = "",
  env = {},
  execution = null,
  input = undefined,
  maxBuffer = undefined,
  onOutput = null,
  outputEncoding = "utf8",
  timeout = 15_000
} = {}) {
  let processGroupId = null;
  let outcome;
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
    processGroupId = Number(subprocess.pid);
    if (typeof onOutput === "function" && subprocess.all) {
      subprocess.all.on("data", (chunk) => {
        try {
          onOutput(String(chunk || ""));
        } catch {
          // Output observers must not change command execution semantics.
        }
      });
    }
    const result = await subprocess;
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
  }
  if (
    process.platform !== "win32" &&
    Number.isSafeInteger(processGroupId) &&
    !await drainProcessGroup(processGroupId)
  ) {
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
  return outcome;
}

export {
  runCaptureCommand
};
