const VIBE64_RUNTIME_MODE_LOCAL = "local";
const VIBE64_ALLOW_UNSAFE_LOCAL_MODE_ENV = "VIBE64_ALLOW_UNSAFE_LOCAL_MODE";

function normalizeRuntimeMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === VIBE64_RUNTIME_MODE_LOCAL || normalized === "local-editor") {
    return VIBE64_RUNTIME_MODE_LOCAL;
  }
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

function publicRuntimeProfile(profile = {}) {
  return {
    capabilities: {
      githubRequired: profile.githubRequired !== false,
      studioSetupEnabled: true
    },
    local: true,
    mode: VIBE64_RUNTIME_MODE_LOCAL,
    singleTargetRoot: String(profile.singleTargetRoot || "")
  };
}

function assertSafeLocalModeListenTarget(profile = {}, listenTarget = {}, {
  env = process.env
} = {}) {
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

function isTruthyEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

export {
  VIBE64_ALLOW_UNSAFE_LOCAL_MODE_ENV,
  VIBE64_RUNTIME_MODE_LOCAL,
  assertSafeLocalModeListenTarget,
  createVibe64RuntimeProfile,
  normalizeRuntimeMode,
  publicRuntimeProfile
};
