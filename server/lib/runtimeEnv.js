import { createRequire } from "node:module";
import {
  REMOTE_STUDIO_RUNTIME_ENV,
  studioRuntimeEnv,
  studioRuntimeLocation
} from "@local/vibe64-core/server/studioRuntimeLocation";
import { surfaceRuntime } from "./surfaceRuntime.js";

const require = createRequire(import.meta.url);

function toPort(value, fallback = 3000) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

let envLoaded = false;

function ensureRuntimeEnvLoaded() {
  if (envLoaded) {
    return;
  }
  try {
    const dotenvModule = require("dotenv");
    const loadDotEnv = dotenvModule?.config;
    if (typeof loadDotEnv === "function") {
      loadDotEnv();
    }
  } catch {
    // dotenv is optional in base-shell; bundles can add it when needed.
  }
  envLoaded = true;
}

function resolveRuntimeEnv() {
  ensureRuntimeEnvLoaded();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  const runtimeLocation = studioRuntimeLocation({
    argv: process.argv,
    env: process.env
  });
  const runtimeLocationEnv = studioRuntimeEnv(runtimeLocation);
  return {
    ...process.env,
    ...runtimeLocationEnv,
    STUDIO_RUNTIME_LOCATION: runtimeLocation,
    [REMOTE_STUDIO_RUNTIME_ENV]: runtimeLocationEnv[REMOTE_STUDIO_RUNTIME_ENV],
    SERVER_SURFACE: serverSurface,
    PORT: toPort(process.env.PORT, 3000),
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  };
}

export { resolveRuntimeEnv };
