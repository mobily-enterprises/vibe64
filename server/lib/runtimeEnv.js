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

/**
 * The one environment the server composes from: the process environment, with
 * .env loaded and the server's own settings resolved. Every value stays a
 * string, as the kernel's RuntimeEnv says; PORT is "" when none is configured,
 * and the system root is honored only for a self-targeting server.
 * @returns {import("@jskit-ai/kernel/server/types").RuntimeEnv}
 */
function resolveRuntimeEnv() {
  loadEnvFile();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  const rawPort = String(process.env.PORT || "").trim();
  const selfTargetSystemRoot = isTruthyEnvValue(process.env[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV])
    ? String(process.env[VIBE64_SYSTEM_ROOT_ENV] || "").trim()
    : "";
  return Object.freeze({
    ...process.env,
    [VIBE64_RUNTIME_NAMESPACE_ENV]: runtimeNamespace({
      env: process.env
    }),
    [VIBE64_PROJECTS_ROOT_ENV]: String(process.env[VIBE64_PROJECTS_ROOT_ENV] || "").trim(),
    [VIBE64_SERVICE_DATA_ROOT_ENV]: String(process.env[VIBE64_SERVICE_DATA_ROOT_ENV] || "").trim(),
    [VIBE64_SYSTEM_ROOT_ENV]: selfTargetSystemRoot || undefined,
    // The official Learning catalogue's repository (owner/name); unset uses the default.
    VIBE64_LEARNING_CATALOG_REPOSITORY: String(process.env.VIBE64_LEARNING_CATALOG_REPOSITORY || "").trim() || undefined,
    SERVER_SURFACE: serverSurface,
    PORT: rawPort ? String(toPort(rawPort)) : "",
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  });
}

export {
  resolveRuntimeEnv
};
