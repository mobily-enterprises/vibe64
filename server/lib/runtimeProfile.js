import { isTruthyEnvValue } from "./runtimeEnv.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const VIBE64_RUNTIME_MODE_LOCAL = "local";
const VIBE64_ALLOW_UNSAFE_LOCAL_MODE_ENV = "VIBE64_ALLOW_UNSAFE_LOCAL_MODE";

/**
 * Public Vibe64 runs in one mode.
 */
function normalizeRuntimeMode() {
  return VIBE64_RUNTIME_MODE_LOCAL;
}

function createVibe64RuntimeProfile({
  mode = "",
  targetRoot = "",
  singleTargetRoot = ""
} = {}) {
  const resolvedTargetRoot = String(targetRoot || singleTargetRoot || "").trim();
  const normalizedMode = normalizeRuntimeMode(mode);
  return Object.freeze({
    githubRequired: false,
    local: true,
    mode: normalizedMode,
    projectCatalogEnabled: false,
    singleTargetRoot: resolvedTargetRoot
  });
}

/**
 * Refuses a local editor that would listen on a public TCP host.
 * @param {object} profile
 * @param {object} listenTarget
 * @param {object} options
 * @param {RuntimeEnv} options.env
 */
function assertSafeLocalModeListenTarget(profile, listenTarget, { env }) {
  if (profile.mode !== VIBE64_RUNTIME_MODE_LOCAL || listenTarget.transport !== "tcp") {
    return;
  }
  const host = String(listenTarget.host || "").trim().toLowerCase();
  if (isLocalhostHost(host) || isTruthyEnvValue(env[VIBE64_ALLOW_UNSAFE_LOCAL_MODE_ENV])) {
    return;
  }
  const error = new Error("Local editor mode must bind to localhost. Refusing public listen host.");
  error.code = "vibe64_local_mode_public_host";
  throw error;
}

function isLocalhostHost(host = "") {
  return [
    "",
    "127.0.0.1",
    "localhost",
    "::1",
    "[::1]"
  ].includes(String(host || "").trim().toLowerCase());
}

export {
  VIBE64_RUNTIME_MODE_LOCAL,
  assertSafeLocalModeListenTarget,
  createVibe64RuntimeProfile
};
