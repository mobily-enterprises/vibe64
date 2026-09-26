import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  GITHUB_ACCOUNT_MODE_LOCAL, VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubCredentialContext, normalizeGithubAccountMode, runVibe64Command
} from "@local/vibe64-execution/server";

export function requireGithubRepository(project, feature = "GitHub tools") {
  const repository = project?.githubRepository || project?.repository?.github;
  const fullName = String(repository?.fullName || "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(fullName) || project?.repositoryMode === "managed_git") {
    throw vibe64Error(`${feature} are available only for GitHub projects.`, "vibe64_github_project_required");
  }
  return fullName;
}

export function githubApi(input, { env = process.env, runCommand = runVibe64Command,
  feature = "Pull requests", failureCode = "vibe64_github_pull_requests_failed", uncertainWriteMessage = "" } = {}) {
  const accountMode = normalizeGithubAccountMode(env[VIBE64_GITHUB_ACCOUNT_MODE_ENV], GITHUB_ACCOUNT_MODE_LOCAL);
  const identity = githubCredentialContext({ vibe64User: input.vibe64User }, { accountMode });
  if (!identity.ok) throw vibe64Error(identity.error, identity.code);

  return async function api(endpoint, payload, method = "POST", { allowNotFound = false } = {}) {
    const result = await runCommand({
      actor: accountMode === GITHUB_ACCOUNT_MODE_LOCAL ? "daemon" : "named-user",
      allowedRoots: [identity.home],
      command: "gh",
      args: ["api", "--hostname", "github.com", endpoint, "--method", method, ...(payload === undefined ? [] : ["--input", "-"])],
      ...(payload === undefined ? {} : { input: JSON.stringify(payload) }),
      credentialHome: { home: identity.home, uid: identity.uid, gid: identity.gid, username: identity.username },
      cwd: identity.home, envPolicy: "auth", mode: "capture", purpose: "github-api",
      runtimes: ["gh"], userKey: identity.username, timeout: 30_000, maxBuffer: 4 * 1024 * 1024
    });
    if (result.code === "vibe64_github_user_credentials_required") {
      throw vibe64Error(result.error, result.code);
    }
    let value;
    try { value = JSON.parse(result.stdout || ""); } catch { /* Handled as an unsuccessful response below. */ }
    if (allowNotFound && method === "GET" && String(value?.status) === "404") return null;
    if (!result.ok || !value || value.errors?.length) {
      const output = String(result.stderr || "");
      let message = "GitHub could not complete this request. Refresh and try again.";
      if (/401|Bad credentials|auth login|authentication/iu.test(output)) {
        message = `Reconnect your GitHub account to use ${feature}.`;
      } else if (/403|Resource not accessible|permission/iu.test(output)) {
        message = "GitHub refused this action. Check your repository permissions and try again.";
      } else if (uncertainWriteMessage) {
        const reason = value?.message || value?.errors?.[0]?.message;
        message = typeof reason === "string" && reason.trim()
          ? `GitHub: ${reason.slice(0, 1000)} ${uncertainWriteMessage}` : uncertainWriteMessage;
      }
      throw vibe64Error(message, failureCode);
    }
    return value;
  };
}
