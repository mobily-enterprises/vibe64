import { normalizeText } from "@local/vibe64-core/server/core";
import { runVibe64Command } from "@local/vibe64-execution/server";

// One daemon-side capture of a session source command (git, tar), reporting
// combined output the way every session source caller expects it.
async function runSourceCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
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
    gitSafeDirectories,
    maxBuffer,
    mode: "capture",
    purpose: "source",
    ...(runtimes ? { runtimes } : {}),
    timeout
  });
  return {
    ok: result.ok === true,
    output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`) ||
      normalizeText(result.output || result.error),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

export { runSourceCommand };
