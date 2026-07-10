import {
  applyGitSafeDirectoriesToEnv,
  githubGitNonInteractiveEnv,
  githubHttpsGitTransportEnv,
  githubTokenGitTransportEnv
} from "./gitConfigEnv.js";

const VIBE64_GIT_AUTH_TOKEN_ENV = "VIBE64_GIT_AUTH_TOKEN";

function githubTokenTransportEnv(request = {}) {
  if (!request.gitAuthToken) {
    const error = new Error("Token-backed GitHub transport requires a gitAuthToken.");
    error.code = "vibe64_command_git_auth_token_required";
    throw error;
  }
  return githubTokenGitTransportEnv({
    ...githubGitNonInteractiveEnv(),
    GIT_TERMINAL_PROMPT: "0",
    [VIBE64_GIT_AUTH_TOKEN_ENV]: request.gitAuthToken
  });
}

function gitEnv({ request = {} } = {}) {
  const base = {
    GIT_TERMINAL_PROMPT: "0"
  };
  let transportEnv = base;
  if (request.gitTransport === "github-token") {
    transportEnv = githubTokenTransportEnv(request);
  } else if (request.gitTransport === "github-https" || request.purpose === "github") {
    transportEnv = githubHttpsGitTransportEnv({
      ...base,
      ...githubGitNonInteractiveEnv()
    });
  }
  return applyGitSafeDirectoriesToEnv(transportEnv, request.gitSafeDirectories || []);
}

export {
  VIBE64_GIT_AUTH_TOKEN_ENV,
  gitEnv
};
