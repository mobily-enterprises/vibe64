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
import { loadEnvFile } from "./envFile.js";
import { surfaceRuntime } from "./surfaceRuntime.js";

const DEFAULT_PORT = 3000;

function toPort(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function isTruthyEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

function resolveRuntimeEnv() {
  loadEnvFile();
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
    PORT: rawPort ? toPort(rawPort) : null,
    PORT_CONFIGURED: Boolean(rawPort),
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  };
}

export {
  resolveRuntimeEnv
};
