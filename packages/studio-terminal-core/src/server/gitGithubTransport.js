import {
  applyGitConfigEntriesToEnv
} from "./gitSafeDirectories.js";

const GITHUB_SSH_TO_HTTPS_GIT_CONFIG = Object.freeze([
  {
    key: "url.https://github.com/.insteadOf",
    value: "git@github.com:"
  },
  {
    key: "url.https://github.com/.insteadOf",
    value: "ssh://git@github.com/"
  }
]);

function githubSshToHttpsGitEnv(env = {}) {
  return applyGitConfigEntriesToEnv(env, GITHUB_SSH_TO_HTTPS_GIT_CONFIG);
}

function githubGitNonInteractiveEnv() {
  return {
    GH_PROMPT_DISABLED: "1",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "cat"
  };
}

export {
  GITHUB_SSH_TO_HTTPS_GIT_CONFIG,
  githubGitNonInteractiveEnv,
  githubSshToHttpsGitEnv
};
