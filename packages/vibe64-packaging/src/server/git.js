// Git as a release runs it: through Vibe64's command gateway, as the workspace
// daemon, with the project's environment policy, the repository marked safe and
// no prompts, the way Vibe64's own remote controls run Git. A push therefore
// signs in with the person's own Git credential helper.
import { gitFailureError, runVibe64Command } from "@local/vibe64-execution/server";

import { publishError } from "./errors.js";

// A full Git commit id (SHA-1 or SHA-256 repositories).
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function withoutCredentials(value = "") {
  return String(value).replace(/(https?:\/\/)[^\s/@]+@/gu, "$1[credentials]@").trim();
}

// Runs `git <args>` in `root` and returns its trimmed output. An optional
// command that fails returns null; any other failure throws `code` with Git's
// own message. `env` adds Git variables such as GIT_INDEX_FILE.
async function releaseGit(root, args, {
  code = "VIBE64_PUBLISH_GIT_FAILED",
  optional = false,
  stdin,
  env,
  timeout = 60_000,
  maxBuffer = 8 * 1024 * 1024,
  runCommand = runVibe64Command
} = {}) {
  const result = await runCommand({
    actor: "daemon", allowedRoots: [root], command: "git", args, cwd: root,
    envPolicy: "project", gitSafeDirectories: [root], inheritProcessEnv: true,
    mode: "capture", purpose: "source", runtimes: ["git"], timeout, maxBuffer,
    ...(env ? { env } : {}),
    ...(stdin === undefined ? {} : { input: stdin })
  });
  if (result?.ok !== true) {
    const missingGit = gitFailureError(result);
    if (missingGit) throw missingGit;
    if (optional) return null;
    throw publishError(code, `Git: ${withoutCredentials(result?.stderr || result?.error || "the command failed.").slice(0, 3000)}`);
  }
  return String(result.stdout ?? result.output ?? "").trim();
}

export { COMMIT_ID, releaseGit };
