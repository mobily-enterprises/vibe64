import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  GITHUB_ACCOUNT_MODE_LOCAL, VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubCredentialContext, normalizeGithubAccountMode, runVibe64Command
} from "@local/vibe64-execution/server";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

/**
 * The project's GitHub owner/name, wherever its record keeps it ("" for none).
 */
export function projectGithubFullName(project) {
  return String(project?.githubRepository?.fullName || project?.repository?.github?.fullName || "");
}

export function requireGithubRepository(project, feature = "GitHub tools") {
  const fullName = projectGithubFullName(project);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(fullName) || project?.repositoryMode === "managed_git") {
    throw vibe64Error(`${feature} are available only for GitHub projects.`, "vibe64_github_project_required");
  }
  return fullName;
}

/**
 * Calls the GitHub API as the request's person, through the GitHub CLI and their credentials.
 * @param {{ vibe64User?: object }} input
 * @param {object} options
 * @param {RuntimeEnv} options.env the server's environment, which names the GitHub account mode
 */
export function githubApi(input, options) {
  const {
    env,
    runCommand = runVibe64Command,
    feature = "Pull requests",
    failureCode,
    uncertainWriteMessage = "",
    uncertainWriteCode = ""
  } = options;
  const accountMode = normalizeGithubAccountMode(env[VIBE64_GITHUB_ACCOUNT_MODE_ENV], GITHUB_ACCOUNT_MODE_LOCAL);
  const identity = githubCredentialContext({ vibe64User: input.vibe64User }, { accountMode });
  if (!identity.ok) throw vibe64Error(identity.error, identity.code);

  return async function api(endpoint, payload, method = "POST", options = {}) {
    const { allowNotFound = false } = options;
    const result = await runCommand({
      actor: accountMode === GITHUB_ACCOUNT_MODE_LOCAL ? "daemon" : "named-user",
      allowedRoots: [identity.home],
      command: "gh",
      args: ["api", "--hostname", "github.com", endpoint, "--method", method, ...(payload === undefined ? [] : ["--input", "-"])],
      ...(payload === undefined ? {} : { input: JSON.stringify(payload) }),
      credentialHome: { home: identity.home, uid: identity.uid, gid: identity.gid, username: identity.username },
      cwd: identity.home,
      envPolicy: "auth",
      mode: "capture",
      purpose: "github-api",
      runtimes: ["gh"],
      userKey: identity.username,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (result.code === "vibe64_github_user_credentials_required") {
      throw vibe64Error(result.error, result.code);
    }
    let value;
    try {
      value = JSON.parse(result.stdout || "");
    } catch { /* Handled as an unsuccessful response below. */ }
    if (allowNotFound && method === "GET" && String(value?.status) === "404") return null;
    if (!result.ok || !value || value.errors?.length) {
      const output = String(result.stderr || "");
      if (/401|Bad credentials|auth login|authentication/iu.test(output)) {
        throw vibe64Error(`Reconnect your GitHub account to use ${feature}.`, "vibe64_github_authentication_failed", { params: { feature } });
      }
      if (/403|Resource not accessible|permission/iu.test(output)) {
        throw vibe64Error("GitHub refused this action. Check your repository permissions and try again.", "vibe64_github_action_refused");
      }
      if (uncertainWriteMessage) {
        const reason = value?.message || value?.errors?.[0]?.message;
        const message = typeof reason === "string" && reason.trim()
          ? `GitHub: ${reason.slice(0, 1000)} ${uncertainWriteMessage}` : uncertainWriteMessage;
        throw vibe64Error(message, uncertainWriteCode);
      }
      throw vibe64Error("GitHub could not complete this request. Refresh and try again.", failureCode);
    }
    return value;
  };
}
