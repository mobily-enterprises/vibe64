import {
  applyGitSafeDirectoriesToEnv,
  githubGitNonInteractiveEnv,
  githubHttpsGitTransportEnv
} from "./gitConfigEnv.js";

function gitEnv({ request = {} } = {}) {
  const base = {
    GIT_TERMINAL_PROMPT: "0"
  };
  const transportEnv = request.gitTransport === "github-https" || request.purpose === "github"
    ? githubHttpsGitTransportEnv({
        ...base,
        ...githubGitNonInteractiveEnv()
      })
    : base;
  return applyGitSafeDirectoriesToEnv(transportEnv, request.gitSafeDirectories || []);
}

export {
  gitEnv
};
