import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import { randomUUID } from "node:crypto";
import process from "node:process";

const VIBE64_RUNTIME_NAME = "vibe64";
const VIBE64_TOOLCHAIN_IMAGE_REGISTRY = "ghcr.io/mobily-enterprises";
const VIBE64_TOOLCHAIN_IMAGE_VERSION = "0.1.0";

const VIBE64_BYPASS_LOCALHOST_CHECK_ENV = "VIBE64_BYPASS_LOCALHOST_CHECK";
const VIBE64_RUNTIME_NAMESPACE_ENV = "VIBE64_RUNTIME_NAMESPACE";
const VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV = "VIBE64_SKIP_STALE_TERMINAL_CLEANUP";
const VIBE64_BASE_TOOLCHAIN_IMAGE_ENV = "VIBE64_BASE_TOOLCHAIN_IMAGE";
const VIBE64_JSKIT_TOOLCHAIN_IMAGE_ENV = "VIBE64_JSKIT_TOOLCHAIN_IMAGE";
const VIBE64_LARAVEL_TOOLCHAIN_IMAGE_ENV = "VIBE64_LARAVEL_TOOLCHAIN_IMAGE";
const VIBE64_CPP_TOOLCHAIN_IMAGE_ENV = "VIBE64_CPP_TOOLCHAIN_IMAGE";
const STUDIO_PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";
const STUDIO_PLAYWRIGHT_BROWSERS_VOLUME = "vibe64_playwright_browsers";
const STUDIO_TOOL_HOME_VOLUME = "vibe64_tool_home";
const STUDIO_TOOL_HOME_PATH = "/home/vibe64";
const STUDIO_TOOL_HOME_NPM_PREFIX = `${STUDIO_TOOL_HOME_PATH}/.local`;
const STUDIO_TOOL_HOME_BIN_PATH = `${STUDIO_TOOL_HOME_NPM_PREFIX}/bin`;
const STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS = Object.freeze(["--pull", "never"]);
const STUDIO_TEMP_DIR_NAME = VIBE64_RUNTIME_NAME;

const STUDIO_DOCKER_LABEL_PREFIX = VIBE64_RUNTIME_NAME;
const STUDIO_DAEMON_ID_ENV = "VIBE64_STUDIO_DAEMON_ID";
const STUDIO_DAEMON_PID_ENV = "VIBE64_STUDIO_DAEMON_PID";
const STUDIO_DAEMON_ID_LABEL = `${STUDIO_DOCKER_LABEL_PREFIX}.daemon-id`;
const STUDIO_DAEMON_PID_LABEL = `${STUDIO_DOCKER_LABEL_PREFIX}.daemon-pid`;
const LOCAL_STUDIO_DAEMON_ID = randomUUID();

const STUDIO_HOST_UID_ENV = "VIBE64_HOST_UID";
const STUDIO_HOST_GID_ENV = "VIBE64_HOST_GID";

const STUDIO_CODEX_CONTAINER_PREFIX = `${VIBE64_RUNTIME_NAME}-codex`;

function vibe64ToolchainImage(name = "", envName = "") {
  const override = envName ? String(process.env[envName] || "").trim() : "";
  return override || `${VIBE64_TOOLCHAIN_IMAGE_REGISTRY}/${name}:${VIBE64_TOOLCHAIN_IMAGE_VERSION}`;
}

function runtimeNamespace({
  env = process.env
} = {}) {
  return String(env[VIBE64_RUNTIME_NAMESPACE_ENV] || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

const STUDIO_BASE_TOOLCHAIN_IMAGE = vibe64ToolchainImage("vibe64-base-toolchain", VIBE64_BASE_TOOLCHAIN_IMAGE_ENV);

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

function studioDaemonDockerEnvArgs({
  env = process.env
} = {}) {
  return [
    "-e",
    `${STUDIO_DAEMON_ID_ENV}=${studioDaemonId({
      env
    })}`,
    "-e",
    `${STUDIO_DAEMON_PID_ENV}=${studioDaemonPid({
      env
    })}`
  ];
}

function studioDaemonDockerLabels({
  env = process.env
} = {}) {
  return [
    `${STUDIO_DAEMON_ID_LABEL}=${studioDaemonId({
      env
    })}`,
    `${STUDIO_DAEMON_PID_LABEL}=${studioDaemonPid({
      env
    })}`
  ];
}

function studioDockerLabel(name = "", value = undefined) {
  const key = `${STUDIO_DOCKER_LABEL_PREFIX}.${String(name || "").trim()}`;
  return value === undefined ? key : `${key}=${String(value)}`;
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_BASE_TOOLCHAIN_IMAGE_ENV,
  VIBE64_BYPASS_LOCALHOST_CHECK_ENV,
  VIBE64_CPP_TOOLCHAIN_IMAGE_ENV,
  VIBE64_JSKIT_TOOLCHAIN_IMAGE_ENV,
  VIBE64_LARAVEL_TOOLCHAIN_IMAGE_ENV,
  VIBE64_RUNTIME_NAME,
  VIBE64_RUNTIME_NAMESPACE_ENV,
  VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  STUDIO_DAEMON_ID_ENV,
  STUDIO_DAEMON_ID_LABEL,
  VIBE64_TARGET_ROOT_ENV,
  VIBE64_TOOLCHAIN_IMAGE_REGISTRY,
  VIBE64_TOOLCHAIN_IMAGE_VERSION,
  STUDIO_CODEX_CONTAINER_PREFIX,
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_DAEMON_PID_ENV,
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH,
  STUDIO_TEMP_DIR_NAME,
  STUDIO_TOOL_HOME_VOLUME,
  normalizeDaemonId,
  runtimeNamespace,
  studioDaemonDockerEnvArgs,
  studioDaemonDockerLabels,
  studioDaemonId,
  studioDaemonPid,
  vibe64ToolchainImage,
  studioDockerLabel
};
