import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SERVICE_DATA_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import { surfaceRuntime } from "./surfaceRuntime.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_ENV_FILE = path.join(APP_ROOT, ".env");

function toPort(value, fallback = 3000) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

let envLoaded = false;

function loadEnvFileIfPresent(filePath, loadEnvFile = process.loadEnvFile) {
  try {
    loadEnvFile(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function loadRuntimeEnvFiles({
  appEnvFile = APP_ENV_FILE,
  loadEnvFile = process.loadEnvFile
} = {}) {
  loadEnvFileIfPresent(appEnvFile, loadEnvFile);
}

function ensureRuntimeEnvLoaded() {
  if (envLoaded) {
    return;
  }
  loadRuntimeEnvFiles();
  envLoaded = true;
}

function isTruthyEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

function resolveRuntimeEnv() {
  ensureRuntimeEnvLoaded();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  const rawPort = String(process.env.PORT || "").trim();
  const selfTargetSystemRoot = isTruthyEnvValue(process.env[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV])
    ? String(process.env[VIBE64_SYSTEM_ROOT_ENV] || "").trim()
    : "";
  return {
    [VIBE64_RUNTIME_NAMESPACE_ENV]: runtimeNamespace({
      env: process.env
    }),
    [VIBE64_PROJECTS_ROOT_ENV]: String(process.env[VIBE64_PROJECTS_ROOT_ENV] || "").trim(),
    [VIBE64_SERVICE_DATA_ROOT_ENV]: String(process.env[VIBE64_SERVICE_DATA_ROOT_ENV] || "").trim(),
    [VIBE64_SYSTEM_ROOT_ENV]: selfTargetSystemRoot || undefined,
    // The official Learning catalogue's repository (owner/name); unset uses the default.
    VIBE64_LEARNING_CATALOG_REPOSITORY: String(process.env.VIBE64_LEARNING_CATALOG_REPOSITORY || "").trim() || undefined,
    SERVER_SURFACE: serverSurface,
    JSKIT_REALTIME_DEBUG: process.env.JSKIT_REALTIME_DEBUG,
    PORT: rawPort ? toPort(rawPort, 3000) : null,
    PORT_CONFIGURED: Boolean(rawPort),
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  };
}

export {
  APP_ENV_FILE,
  loadRuntimeEnvFiles,
  resolveRuntimeEnv
};
