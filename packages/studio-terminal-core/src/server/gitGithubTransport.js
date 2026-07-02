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

function githubSshToHttpsGitEnv() {
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(GITHUB_SSH_TO_HTTPS_GIT_CONFIG.length)],
    ...GITHUB_SSH_TO_HTTPS_GIT_CONFIG.flatMap((entry, index) => [
      [`GIT_CONFIG_KEY_${index}`, entry.key],
      [`GIT_CONFIG_VALUE_${index}`, entry.value]
    ])
  ]);
}

function githubSshToHttpsGitDockerEnvArgs() {
  return Object.entries(githubSshToHttpsGitEnv()).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`
  ]);
}

function githubGitNonInteractiveEnv() {
  return {
    GH_PROMPT_DISABLED: "1",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "cat"
  };
}

function githubGitNonInteractiveDockerEnvArgs() {
  return Object.entries(githubGitNonInteractiveEnv()).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`
  ]);
}

export {
  GITHUB_SSH_TO_HTTPS_GIT_CONFIG,
  githubGitNonInteractiveDockerEnvArgs,
  githubGitNonInteractiveEnv,
  githubSshToHttpsGitDockerEnvArgs,
  githubSshToHttpsGitEnv
};
