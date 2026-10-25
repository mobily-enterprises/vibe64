import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import process from "node:process";

const VIBE64_LOCAL_RUNTIME_NAMESPACE = "__local__";

const VIBE64_RUNTIME_NAMESPACE_ENV = "VIBE64_RUNTIME_NAMESPACE";
const STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG = "check_for_update_on_startup=false";

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

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV,
  VIBE64_TARGET_ROOT_ENV,
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  runtimeNamespace
};
