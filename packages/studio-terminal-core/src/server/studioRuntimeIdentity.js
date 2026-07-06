import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import { randomUUID } from "node:crypto";
import process from "node:process";

const VIBE64_RUNTIME_NAME = "vibe64";
const VIBE64_LOCAL_RUNTIME_NAMESPACE = "__local__";

const VIBE64_BYPASS_LOCALHOST_CHECK_ENV = "VIBE64_BYPASS_LOCALHOST_CHECK";
const VIBE64_RUNTIME_NAMESPACE_ENV = "VIBE64_RUNTIME_NAMESPACE";
const STUDIO_PLAYWRIGHT_BROWSERS_PATH = "/var/cache/vibe64/playwright";
const STUDIO_TOOL_HOME_PATH = "/tmp/studio-home";
const STUDIO_TOOL_HOME_NPM_PREFIX = `${STUDIO_TOOL_HOME_PATH}/.local`;
const STUDIO_TOOL_HOME_BIN_PATH = `${STUDIO_TOOL_HOME_NPM_PREFIX}/bin`;
const STUDIO_MANAGED_CODEX_COMMAND = "/usr/local/bin/codex";
const STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG = "check_for_update_on_startup=false";
const STUDIO_TEMP_DIR_NAME = VIBE64_RUNTIME_NAME;

const STUDIO_DAEMON_ID_ENV = "VIBE64_STUDIO_DAEMON_ID";
const STUDIO_DAEMON_PID_ENV = "VIBE64_STUDIO_DAEMON_PID";
const LOCAL_STUDIO_DAEMON_ID = randomUUID();

const STUDIO_HOST_UID_ENV = "VIBE64_HOST_UID";
const STUDIO_HOST_GID_ENV = "VIBE64_HOST_GID";

function normalizeRuntimeNamespace(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function runtimeNamespace({
  env = process.env
} = {}) {
  const namespace = normalizeRuntimeNamespace(env[VIBE64_RUNTIME_NAMESPACE_ENV]);
  if (!namespace) {
    throw new Error(`${VIBE64_RUNTIME_NAMESPACE_ENV} is required for Vibe64 runtime naming.`);
  }
  return namespace;
}

function normalizePositiveInteger(value = "") {
  const normalized = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
}

function normalizeDaemonId(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 128);
}

function studioDaemonId({
  env = process.env
} = {}) {
  return normalizeDaemonId(env[STUDIO_DAEMON_ID_ENV]) || LOCAL_STUDIO_DAEMON_ID;
}

function studioDaemonPid({
  env = process.env,
  fallbackPid = process.pid
} = {}) {
  return normalizePositiveInteger(env[STUDIO_DAEMON_PID_ENV]) ||
    normalizePositiveInteger(fallbackPid);
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_BYPASS_LOCALHOST_CHECK_ENV,
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAME,
  VIBE64_RUNTIME_NAMESPACE_ENV,
  STUDIO_DAEMON_ID_ENV,
  VIBE64_TARGET_ROOT_ENV,
  STUDIO_DAEMON_PID_ENV,
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH,
  STUDIO_TEMP_DIR_NAME,
  normalizeDaemonId,
  runtimeNamespace,
  studioDaemonId,
  studioDaemonPid
};
