import { runVibe64Command } from "@local/vibe64-execution/server";
import { toText } from "@local/vibe64-core/shared/toText";

/**
 * One daemon-side capture of a session source command (git, tar), reporting
 * combined output the way every session source caller expects it. A code means
 * the command never reached its own verdict (refused, timed out or undrained);
 * a command that ran and failed has none.
 */
async function runSourceCommand(command, args = [], options = {}) {
  const {
    allowedRoots = [],
    cwd = "",
    execution,
    gitSafeDirectories,
    maxBuffer,
    runtimes,
    timeout
  } = options;
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
    code: toText(result.code),
    ok: result.ok === true,
    output: toText(`${result.stdout || ""}\n${result.stderr || ""}`) ||
      toText(result.output || result.error),
    retryable: result.retryable === true,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

export { runSourceCommand };
