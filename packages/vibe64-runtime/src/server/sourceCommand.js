import { normalizeText } from "@local/vibe64-core/server/core";
import { runVibe64Command } from "@local/vibe64-execution/server";

// One daemon-side capture of a session source command (git, tar), reporting
// combined output the way every session source caller expects it. A code means
// the command never reached its own verdict (refused, timed out or undrained);
// a command that ran and failed has none.
async function runSourceCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
  execution,
  gitSafeDirectories,
  maxBuffer,
  runtimes,
  timeout
} = {}) {
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [
      cwd,
      ...allowedRoots
    ].filter(Boolean),
    args,
    command,
    cwd,
    envPolicy: "session",
    ...(execution ? { execution } : {}),
    gitSafeDirectories,
    maxBuffer,
    mode: "capture",
    purpose: "source",
    ...(runtimes ? { runtimes } : {}),
    timeout
  });
  return {
    code: normalizeText(result.code),
    ok: result.ok === true,
    output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`) ||
      normalizeText(result.output || result.error),
    retryable: result.retryable === true,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

export { runSourceCommand };
