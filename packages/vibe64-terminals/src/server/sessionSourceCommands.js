// Runs the Git and GitHub commands that create a session's source, with the project's GitHub credentials.

import { normalizeText, vibe64Error } from "@local/vibe64-core/server/core";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  gitFailureError,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubCredentialContext,
  normalizeGithubAccountMode,
  runVibe64Command
} from "@local/vibe64-execution/server";

function sourceError(message = "", code = "vibe64_session_source_failed") {
  return vibe64Error(message || "Vibe64 could not create the session source.", code);
}

async function runSourceCommand(command = "", args = [], options = {}) {
  const {
    actor = "daemon",
    allowedRoots = [],
    credentialHome = null,
    cwd = "",
    gitAuthToken = "",
    gitTransport = "none",
    runCommand = runVibe64Command,
    userKey = ""
  } = options;
  const githubTransport = gitTransport === "github-https" || gitTransport === "github-token";
  const result = await runCommand({
    actor,
    allowedRoots,
    args,
    command,
    ...(credentialHome ? { credentialHome } : {}),
    cwd,
    envPolicy: "project",
    ...(gitAuthToken ? { gitAuthToken } : {}),
    gitSafeDirectories: allowedRoots,
    gitTransport,
    mode: "capture",
    purpose: githubTransport ? "github" : "source",
    runtimes: gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: 60_000,
    ...(userKey ? { userKey } : {})
  });
  if (result?.ok !== true) {
    const gitFailure = command === "git" ? gitFailureError(result) : null;
    if (gitFailure) throw gitFailure;
    throw sourceError(
      normalizeText(result?.stderr || result?.output || result?.error) || "A source command failed while creating the session source.",
      normalizeText(result?.code) || "vibe64_session_source_git_failed"
    );
  }
  return normalizeText(result.stdout || result.output);
}

function runGit(cwd = "", args = [], allowedRoots = [], options = {}) {
  return runSourceCommand("git", args, {
    ...options,
    allowedRoots,
    cwd
  });
}

async function githubSourceCommandOptions(vibe64User = null, env = process.env, options = {}) {
  const {
    runCommand = runVibe64Command
  } = options;
  const accountMode = normalizeGithubAccountMode(
    env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubCredentialContext({
    vibe64User
  }, {
    accountMode
  });
  if (context?.ok === false) {
    throw sourceError(
      context.error || "Connect GitHub before creating a session from this project.",
      context.code || "vibe64_session_source_github_credentials_required"
    );
  }
  if (accountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    return {
      actor: "daemon",
      credentialHome: {
        gid: context.gid,
        home: context.home,
        scope: context.scope,
        uid: context.uid,
        username: context.username
      },
      gitTransport: "github-https"
    };
  }
  const tokenResult = await runCommand({
    actor: "named-user",
    allowedRoots: [context.home],
    args: ["auth", "token"],
    command: "gh",
    cwd: context.home,
    envPolicy: "auth",
    gitTransport: "none",
    mode: "capture",
    project: {
      ownerUserKey: context.username
    },
    purpose: "github-api",
    runtimes: ["gh"],
    timeout: 60_000,
    userKey: context.username
  });
  const token = tokenResult?.ok === true ? normalizeText(tokenResult.stdout) : "";
  if (!token) {
    throw sourceError(
      normalizeText(tokenResult?.stderr || tokenResult?.error) ||
        "GitHub authentication is not ready for this Vibe64 account.",
      "vibe64_session_source_github_credentials_required"
    );
  }
  return {
    actor: "daemon",
    gitAuthToken: token,
    gitTransport: "github-token"
  };
}

async function optionalGitOutput(cwd = "", args = [], allowedRoots = [], options = {}) {
  try {
    return await runGit(cwd, args, allowedRoots, options);
  } catch {
    return "";
  }
}

export {
  githubSourceCommandOptions,
  optionalGitOutput,
  runGit,
  runSourceCommand,
  sourceError
};
