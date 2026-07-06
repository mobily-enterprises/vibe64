import path from "node:path";

import {
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_TOOL_HOME_PATH
} from "./studioRuntimeIdentity.js";
import {
  shellQuote
} from "./shellCommands.js";
import {
  resolveVibe64SharedCacheRoot
} from "./sharedPackageCaches.js";

const STUDIO_MYSQL_CLIENT_CONFIG_DIR = "/tmp/vibe64-mysql-client";
const STUDIO_PLAYWRIGHT_CACHE_NAME = "playwright";

function studioPlaywrightBrowsersPath(options = {}) {
  return path.join(resolveVibe64SharedCacheRoot(options), STUDIO_PLAYWRIGHT_CACHE_NAME);
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
  studioPlaywrightBrowsersPath,
  studioUserCommand,
  studioToolHomeSetupLines,
  studioUserStartupScript
};
