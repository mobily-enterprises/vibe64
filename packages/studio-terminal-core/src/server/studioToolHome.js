import {
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR,
  STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL,
  STUDIO_GITHUB_PROVIDER_HOME_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH,
  STUDIO_TOOL_HOME_VOLUME
} from "./studioRuntimeIdentity.js";
import {
  shellQuote
} from "./shellCommands.js";

const STUDIO_MYSQL_CLIENT_CONFIG_DIR = "/tmp/vibe64-mysql-client";

function studioPlaywrightBrowsersDockerArgs() {
  return [
    "-v",
    `${STUDIO_PLAYWRIGHT_BROWSERS_VOLUME}:${STUDIO_PLAYWRIGHT_BROWSERS_PATH}`,
    "-e",
    `PLAYWRIGHT_BROWSERS_PATH=${STUDIO_PLAYWRIGHT_BROWSERS_PATH}`
  ];
}

function studioGithubProviderHomeDockerArgs({
  source = ""
} = {}) {
  if (!source) {
    return [];
  }
  return [
    ...studioToolHomeVolumeDockerArgs({
      source,
      target: STUDIO_GITHUB_PROVIDER_HOME_PATH
    }),
    "-e",
    `VIBE64_GITHUB_PROVIDER_HOME=${STUDIO_GITHUB_PROVIDER_HOME_PATH}`,
    "-e",
    `GH_CONFIG_DIR=${STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR}`,
    "-e",
    `GIT_CONFIG_GLOBAL=${STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL}`
  ];
}

function studioToolHomeDockerArgs({
  githubToolHomeSource = "",
  source = STUDIO_TOOL_HOME_VOLUME
} = {}) {
  return [
    ...studioToolHomeVolumeDockerArgs({
      source
    }),
    ...studioGithubProviderHomeDockerArgs({
      source: githubToolHomeSource
    }),
    "-e",
    `HOME=${STUDIO_TOOL_HOME_PATH}`,
    "-e",
    `NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`
  ];
}

function studioToolHomeVolumeDockerArgs({
  readOnly = false,
  source = STUDIO_TOOL_HOME_VOLUME,
  target = STUDIO_TOOL_HOME_PATH
} = {}) {
  return [
    "-v",
    `${source || STUDIO_TOOL_HOME_VOLUME}:${target}${readOnly ? ":ro" : ""}`
  ];
}

function studioToolHomeSetupLines() {
  return [
    `export HOME=${STUDIO_TOOL_HOME_PATH}`,
    `export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`,
    `export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`,
    "mkdir -p \"$HOME\" \"$NPM_CONFIG_PREFIX\"",
    "if [ -n \"${VIBE64_GITHUB_PROVIDER_HOME:-}\" ]; then",
    "  mkdir -p \"$VIBE64_GITHUB_PROVIDER_HOME\" \"${GH_CONFIG_DIR:-$VIBE64_GITHUB_PROVIDER_HOME/.config/gh}\" \"$HOME/.config\"",
    "  if [ -n \"${GIT_CONFIG_GLOBAL:-}\" ]; then",
    "    touch \"$GIT_CONFIG_GLOBAL\"",
    "  fi",
    "  if [ -n \"${GH_CONFIG_DIR:-}\" ]; then",
    "    if [ -e \"$HOME/.config/gh\" ] && [ ! -L \"$HOME/.config/gh\" ]; then",
    "      rm -rf \"$HOME/.config/gh\"",
    "    fi",
    "    ln -sfn \"$GH_CONFIG_DIR\" \"$HOME/.config/gh\"",
    "  fi",
    "fi"
  ];
}

function studioMysqlClientConfigSetupLines() {
  return [
    "if [ -n \"${MYSQL_HOST:-}\" ] || [ -n \"${VIBE64_MYSQL_USER:-}\" ] || [ -n \"${MYSQL_PWD:-}\" ] || [ -n \"${MYSQL_TCP_PORT:-}\" ]; then",
    `  export MYSQL_HOME=${STUDIO_MYSQL_CLIENT_CONFIG_DIR}`,
    "  mkdir -p \"$MYSQL_HOME\"",
    "  chmod 700 \"$MYSQL_HOME\"",
    "  {",
    "    printf '%s\\n' '[client]'",
    "    [ -n \"${MYSQL_HOST:-}\" ] && printf 'host=%s\\n' \"$MYSQL_HOST\"",
    "    [ -n \"${VIBE64_MYSQL_USER:-}\" ] && printf 'user=%s\\n' \"$VIBE64_MYSQL_USER\"",
    "    [ -n \"${MYSQL_PWD:-}\" ] && printf 'password=%s\\n' \"$MYSQL_PWD\"",
    "    [ -n \"${MYSQL_TCP_PORT:-}\" ] && printf 'port=%s\\n' \"$MYSQL_TCP_PORT\"",
    "    if [ -n \"${MYSQL_DATABASE:-}\" ]; then",
    "      printf '%s\\n' '[mysql]'",
    "      printf 'database=%s\\n' \"$MYSQL_DATABASE\"",
    "      printf '%s\\n' '[mariadb-client]'",
    "      printf 'database=%s\\n' \"$MYSQL_DATABASE\"",
    "    fi",
    "  } > \"$MYSQL_HOME/my.cnf\"",
    "  chmod 600 \"$MYSQL_HOME/my.cnf\"",
    "fi"
  ];
}

function studioUserCommand(commandArgs = []) {
  const args = Array.isArray(commandArgs) ? commandArgs : [commandArgs];
  const normalizedArgs = args
    .map((arg) => String(arg ?? ""))
    .filter((arg, index) => index > 0 || arg.trim());
  return (normalizedArgs.length ? normalizedArgs : ["bash"]).map(shellQuote).join(" ");
}

function studioUserStartupScript(commandArgs = ["bash"], {
  setupLines = []
} = {}) {
  const startupCommand = studioUserCommand(commandArgs);
  return [
    "set -e",
    ...studioToolHomeSetupLines(),
    ...studioMysqlClientConfigSetupLines(),
    ...setupLines,
    `if [ "$(id -u)" = "0" ] && [ -n "\${${STUDIO_HOST_UID_ENV}:-}" ] && [ -n "\${${STUDIO_HOST_GID_ENV}:-}" ] && command -v setpriv >/dev/null 2>&1; then`,
    `  chown -R "$${STUDIO_HOST_UID_ENV}:$${STUDIO_HOST_GID_ENV}" "$HOME"`,
    "  if [ -n \"${VIBE64_GITHUB_PROVIDER_HOME:-}\" ]; then",
    `    chown -R "$${STUDIO_HOST_UID_ENV}:$${STUDIO_HOST_GID_ENV}" "$VIBE64_GITHUB_PROVIDER_HOME"`,
    "  fi",
    "  if [ -n \"${MYSQL_HOME:-}\" ]; then",
    `    chown -R "$${STUDIO_HOST_UID_ENV}:$${STUDIO_HOST_GID_ENV}" "$MYSQL_HOME"`,
    "  fi",
    `  exec setpriv --reuid "$${STUDIO_HOST_UID_ENV}" --regid "$${STUDIO_HOST_GID_ENV}" --clear-groups ${startupCommand}`,
    "fi",
    `exec ${startupCommand}`
  ].join("\n");
}

export {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR,
  studioGithubProviderHomeDockerArgs,
  studioMysqlClientConfigSetupLines,
  studioPlaywrightBrowsersDockerArgs,
  studioUserCommand,
  studioToolHomeDockerArgs,
  studioToolHomeSetupLines,
  studioToolHomeVolumeDockerArgs,
  studioUserStartupScript
};
