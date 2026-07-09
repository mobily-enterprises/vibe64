import { execa } from "execa";

import {
  commandErrorResult,
  commandResult
} from "../result.js";

async function runCaptureCommand(command = "", args = [], {
  cwd = "",
  env = {},
  input = undefined,
  maxBuffer = undefined,
  onOutput = null,
  timeout = 15_000
} = {}) {
  try {
    const subprocess = execa(command, args, {
      all: true,
      cwd,
      env,
      extendEnv: false,
      input,
      maxBuffer,
      reject: false,
      stdin: input === undefined || input === null ? "ignore" : "pipe",
      timeout
    });
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
    return commandResult({
      exitCode: result.exitCode,
      output: result.all,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout
    });
  } catch (error) {
    return commandErrorResult(error.message, "vibe64_command_capture_failed", {
      exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
      output: error.all,
      signal: error.signal,
      stderr: error.stderr,
      stdout: error.stdout,
      timedOut: error.timedOut === true
    });
  }
}

export {
  runCaptureCommand
};
