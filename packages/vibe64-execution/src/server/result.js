import {
  normalizeText
} from "./normalize.js";

function normalizeExitCode(value = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 1;
}

function commandResult({
  code = "",
  error = "",
  exitCode = 0,
  ok = null,
  output = "",
  pid = null,
  signal = "",
  stderr = "",
  stdout = "",
  timedOut = false
} = {}) {
  const normalizedExitCode = normalizeExitCode(exitCode);
  const normalizedStdout = String(stdout || "");
  const normalizedStderr = String(stderr || "");
  const normalizedOutput = String(output || [normalizedStdout, normalizedStderr].filter(Boolean).join("\n")).trim();
  return {
    code: normalizeText(code),
    error: normalizeText(error),
    exitCode: normalizedExitCode,
    ok: ok === null ? normalizedExitCode === 0 : ok === true,
    output: normalizedOutput,
    pid: Number.isSafeInteger(Number(pid)) ? Number(pid) : null,
    signal: normalizeText(signal),
    stderr: normalizedStderr.trim(),
    stdout: normalizedStdout.trim(),
    timedOut: timedOut === true
  };
}

function commandErrorResult(message = "", code = "vibe64_command_failed", extra = {}) {
  const error = normalizeText(message) || "Vibe64 command failed.";
  return commandResult({
    ...extra,
    code,
    error,
    exitCode: 1,
    ok: false,
    output: normalizeText(extra.output) || error,
    stderr: normalizeText(extra.stderr) || error,
    stdout: normalizeText(extra.stdout)
  });
}

export {
  commandErrorResult,
  commandResult
};
