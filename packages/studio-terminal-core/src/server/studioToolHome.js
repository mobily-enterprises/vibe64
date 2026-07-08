import path from "node:path";

import {
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_TOOL_HOME_ENV
} from "./studioRuntimeIdentity.js";
import {
  shellQuote
} from "./shellCommands.js";
import {
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  resolveVibe64SharedCacheRoot
} from "./sharedPackageCaches.js";

const STUDIO_MYSQL_CLIENT_CONFIG_DIR = "/tmp/vibe64-mysql-client";
const STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV = "VIBE64_MYSQL_CLIENT_CONFIG_DIR";
const STUDIO_PLAYWRIGHT_CACHE_NAME = "playwright";

function studioPlaywrightBrowsersPath(options = {}) {
  return path.join(resolveVibe64SharedCacheRoot(options), STUDIO_PLAYWRIGHT_CACHE_NAME);
}

function studioToolHomeSetupLines() {
  return [
    "if [ -z \"${HOME:-}\" ]; then",
    `  if [ -n "\${${STUDIO_TOOL_HOME_ENV}:-}" ]; then`,
    `    export HOME="$${STUDIO_TOOL_HOME_ENV}"`,
    "  elif [ -n \"${XDG_RUNTIME_DIR:-}\" ]; then",
    "    export HOME=\"$XDG_RUNTIME_DIR/vibe64/studio-home\"",
    "  else",
    "    export HOME=\"${TMPDIR:-/tmp}/vibe64-studio-home-$(id -u)\"",
    "  fi",
    "fi",
    `export NPM_CONFIG_PREFIX="\${NPM_CONFIG_PREFIX:-$HOME/.local}"`,
    `export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"`,
    `export PLAYWRIGHT_BROWSERS_PATH="\${PLAYWRIGHT_BROWSERS_PATH:-\${${VIBE64_SHARED_CACHE_ROOT_ENV}:-${DEFAULT_VIBE64_SHARED_CACHE_ROOT}}/${STUDIO_PLAYWRIGHT_CACHE_NAME}}"`,
    "mkdir -p \"$HOME\" \"$NPM_CONFIG_PREFIX\""
  ];
}

function studioMysqlClientConfigSetupLines() {
  return [
    "if [ -n \"${DB_HOST:-}\" ] || [ -n \"${DB_USER:-}\" ] || [ -n \"${DB_PASSWORD:-}\" ] || [ -n \"${DB_PORT:-}\" ]; then",
    `  if [ -n "\${${STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV}:-}" ]; then`,
    `    export MYSQL_HOME="$${STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV}"`,
    "  elif [ -n \"${XDG_RUNTIME_DIR:-}\" ]; then",
    "    export MYSQL_HOME=\"$XDG_RUNTIME_DIR/vibe64/mysql-client\"",
    "  else",
    "    export MYSQL_HOME=\"${TMPDIR:-/tmp}/vibe64-mysql-client-$(id -u)\"",
    "  fi",
    "  mkdir -p \"$MYSQL_HOME\"",
    "  chmod 700 \"$MYSQL_HOME\"",
    "  {",
    "    printf '%s\\n' '[client]'",
    "    [ -n \"${DB_HOST:-}\" ] && printf 'host=%s\\n' \"$DB_HOST\"",
    "    [ -n \"${DB_USER:-}\" ] && printf 'user=%s\\n' \"$DB_USER\"",
    "    [ -n \"${DB_PASSWORD:-}\" ] && printf 'password=%s\\n' \"$DB_PASSWORD\"",
    "    [ -n \"${DB_PORT:-}\" ] && printf 'port=%s\\n' \"$DB_PORT\"",
    "    if [ -n \"${DB_NAME:-}\" ]; then",
    "      printf '%s\\n' '[mysql]'",
    "      printf 'database=%s\\n' \"$DB_NAME\"",
    "      printf '%s\\n' '[mariadb-client]'",
    "      printf 'database=%s\\n' \"$DB_NAME\"",
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
  STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV,
  studioMysqlClientConfigSetupLines,
  studioPlaywrightBrowsersPath,
  studioUserCommand,
  studioToolHomeSetupLines,
  studioUserStartupScript
};
