import path from "node:path";

import {
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_PATH
} from "./studioRuntimeIdentity.js";
import {
  shellQuote
} from "./shellCommands.js";

const STUDIO_MYSQL_CLIENT_CONFIG_DIR = "/tmp/vibe64-mysql-client";

function normalizeToolHomePath(value = "", label = "tool home") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!path.isAbsolute(normalized)) {
    throw new Error(`Vibe64 ${label} must be an absolute real OS path.`);
  }
  return path.resolve(normalized);
}

function toolHomeNpmPrefix(home = "") {
  return path.join(home || STUDIO_TOOL_HOME_PATH, ".local");
}

function studioPlaywrightBrowsersDockerArgs() {
  return [
    "-v",
    `${STUDIO_PLAYWRIGHT_BROWSERS_VOLUME}:${STUDIO_PLAYWRIGHT_BROWSERS_PATH}`,
    "-e",
    `PLAYWRIGHT_BROWSERS_PATH=${STUDIO_PLAYWRIGHT_BROWSERS_PATH}`
  ];
}

function studioToolHomeDockerArgs({
  githubToolHomeSource = "",
  source = ""
} = {}) {
  const home = normalizeToolHomePath(source || githubToolHomeSource) || STUDIO_TOOL_HOME_PATH;
  return [
    ...(source || githubToolHomeSource
      ? studioToolHomeVolumeDockerArgs({
          source: source || githubToolHomeSource,
          target: home
        })
      : []),
    "-e",
    `HOME=${home}`,
    "-e",
    `NPM_CONFIG_PREFIX=${toolHomeNpmPrefix(home)}`
  ];
}

function studioToolHomeVolumeDockerArgs({
  readOnly = false,
  source = "",
  target = ""
} = {}) {
  const resolvedSource = normalizeToolHomePath(source, "home source");
  if (!resolvedSource) {
    return [];
  }
  const resolvedTarget = normalizeToolHomePath(target || resolvedSource, "home target");
  return [
    "-v",
    `${resolvedSource}:${resolvedTarget}${readOnly ? ":ro" : ""}`
  ];
}

function studioToolHomeSetupLines() {
  return [
    `export HOME="\${HOME:-${STUDIO_TOOL_HOME_PATH}}"`,
    `export NPM_CONFIG_PREFIX="\${NPM_CONFIG_PREFIX:-$HOME/.local}"`,
    `export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"`,
    "mkdir -p \"$HOME\" \"$NPM_CONFIG_PREFIX\""
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
  studioMysqlClientConfigSetupLines,
  studioPlaywrightBrowsersDockerArgs,
  studioUserCommand,
  studioToolHomeDockerArgs,
  studioToolHomeSetupLines,
  studioToolHomeVolumeDockerArgs,
  studioUserStartupScript
};
