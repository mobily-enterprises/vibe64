const VIBE64_RUNTIME_MODE_LOCAL = "local";

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
 */
function assertSafeLocalModeListenTarget(profile, listenTarget) {
  if (profile.mode !== VIBE64_RUNTIME_MODE_LOCAL || listenTarget.transport !== "tcp") {
    return;
  }
  const host = String(listenTarget.host || "").trim().toLowerCase();
  if (isLocalhostHost(host)) {
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
