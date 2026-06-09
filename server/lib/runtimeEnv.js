import path from "node:path";
import { fileURLToPath } from "node:url";
import { surfaceRuntime } from "./surfaceRuntime.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_ENV_FILE = path.join(APP_ROOT, ".env");
const VIBE64_LISTEN_SOCKET_ENV = "VIBE64_LISTEN_SOCKET";
const VIBE64_PUBLIC_ORIGIN_ENV = "VIBE64_PUBLIC_ORIGIN";

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
  const rawPort = String(process.env.PORT || "").trim();
  return {
    ...process.env,
    [VIBE64_LISTEN_SOCKET_ENV]: String(process.env[VIBE64_LISTEN_SOCKET_ENV] || "").trim(),
    [VIBE64_PUBLIC_ORIGIN_ENV]: String(process.env[VIBE64_PUBLIC_ORIGIN_ENV] || "").trim().replace(/\/+$/u, ""),
    SERVER_SURFACE: serverSurface,
    PORT: rawPort ? toPort(rawPort, 3000) : null,
    PORT_CONFIGURED: Boolean(rawPort),
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  };
}

export { VIBE64_LISTEN_SOCKET_ENV, VIBE64_PUBLIC_ORIGIN_ENV, resolveRuntimeEnv };
