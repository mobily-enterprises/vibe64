import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_RECURSIVE_HACK_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import { surfaceRuntime } from "./surfaceRuntime.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_ENV_FILE = path.join(APP_ROOT, ".env");
const HOST_ENV_FILE = "/etc/vibe64/vibe64.env";
const VIBE64_SUPABASE_URL_ENV = "VIBE64_SUPABASE_URL";
const VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV = "VIBE64_SUPABASE_PUBLISHABLE_KEY";
const VIBE64_SUPABASE_SECRET_KEY_ENV = "VIBE64_SUPABASE_SECRET_KEY";

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
  hostEnvFile = HOST_ENV_FILE,
  loadEnvFile = process.loadEnvFile
} = {}) {
  loadEnvFileIfPresent(appEnvFile, loadEnvFile);
  loadEnvFileIfPresent(hostEnvFile, loadEnvFile);
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
  const recursiveSystemRoot = isTruthyEnvValue(process.env[VIBE64_RECURSIVE_HACK_SYSTEM_ROOT_ENV])
    ? String(process.env[VIBE64_SYSTEM_ROOT_ENV] || "").trim()
    : "";
  return {
    [VIBE64_SUPABASE_URL_ENV]: String(process.env[VIBE64_SUPABASE_URL_ENV] || "").trim().replace(/\/+$/u, ""),
    [VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV]: String(process.env[VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV] || "").trim(),
    [VIBE64_SUPABASE_SECRET_KEY_ENV]: String(process.env[VIBE64_SUPABASE_SECRET_KEY_ENV] || "").trim(),
    [VIBE64_RUNTIME_NAMESPACE_ENV]: runtimeNamespace({
      env: process.env
    }),
    [VIBE64_PROJECTS_ROOT_ENV]: String(process.env[VIBE64_PROJECTS_ROOT_ENV] || "").trim(),
    [VIBE64_PROVIDER_HOMES_ROOT_ENV]: String(process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "").trim(),
    [VIBE64_SYSTEM_ROOT_ENV]: recursiveSystemRoot || undefined,
    SERVER_SURFACE: serverSurface,
    PORT: rawPort ? toPort(rawPort, 3000) : null,
    PORT_CONFIGURED: Boolean(rawPort),
    HOST: String(process.env.HOST || "").trim() || "127.0.0.1"
  };
}

export {
  APP_ENV_FILE,
  HOST_ENV_FILE,
  VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV,
  VIBE64_SUPABASE_SECRET_KEY_ENV,
  VIBE64_SUPABASE_URL_ENV,
  loadRuntimeEnvFiles,
  resolveRuntimeEnv
};
