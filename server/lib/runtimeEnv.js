import path from "node:path";
import { fileURLToPath } from "node:url";
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

function ensureRuntimeEnvLoaded() {
  if (envLoaded) {
    return;
  }
  try {
    process.loadEnvFile(APP_ENV_FILE);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  envLoaded = true;
}

function resolveRuntimeEnv() {
  ensureRuntimeEnvLoaded();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  return {
    ...process.env,
    SERVER_SURFACE: serverSurface,
    PORT: toPort(process.env.PORT, 3000),
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  };
}

export { resolveRuntimeEnv };
