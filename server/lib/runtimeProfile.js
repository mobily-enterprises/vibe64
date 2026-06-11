const VIBE64_RUNTIME_MODE_HOSTED = "hosted";
const VIBE64_RUNTIME_MODE_LOCAL = "local";
const VIBE64_ALLOW_UNSAFE_LOCAL_MODE_ENV = "VIBE64_ALLOW_UNSAFE_LOCAL_MODE";

function normalizeRuntimeMode(value = "", {
  targetRoot = ""
} = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === VIBE64_RUNTIME_MODE_LOCAL || normalized === "local-editor") {
    return VIBE64_RUNTIME_MODE_LOCAL;
  }
  if (normalized === VIBE64_RUNTIME_MODE_HOSTED) {
    return VIBE64_RUNTIME_MODE_HOSTED;
  }
  return String(targetRoot || "").trim()
    ? VIBE64_RUNTIME_MODE_LOCAL
    : VIBE64_RUNTIME_MODE_HOSTED;
}

function createVibe64RuntimeProfile({
  mode = "",
  targetRoot = "",
  singleTargetRoot = ""
} = {}) {
  const resolvedTargetRoot = String(targetRoot || singleTargetRoot || "").trim();
  const normalizedMode = normalizeRuntimeMode(mode, {
    targetRoot: resolvedTargetRoot
  });
  const local = normalizedMode === VIBE64_RUNTIME_MODE_LOCAL;
  return Object.freeze({
    authRequired: !local,
    billingEnabled: false,
    githubRequired: true,
    local,
    managedProjectsEnabled: !local,
    mode: normalizedMode,
    projectAccessManagementEnabled: !local,
    singleTargetRoot: local ? resolvedTargetRoot : "",
    tenantUsersEnabled: !local
  });
}

function publicRuntimeProfile(profile = {}) {
  const local = profile.mode === VIBE64_RUNTIME_MODE_LOCAL || profile.local === true;
  return {
    authRequired: profile.authRequired !== false,
    billingEnabled: profile.billingEnabled === true,
    capabilities: {
      aiAccountsEnabled: true,
      githubRequired: profile.githubRequired !== false,
      managedProjectsEnabled: profile.managedProjectsEnabled === true,
      projectAccessManagementEnabled: profile.projectAccessManagementEnabled === true,
      studioSetupEnabled: true,
      supabaseAccountManagementEnabled: profile.authRequired !== false,
      tenantUsersEnabled: profile.tenantUsersEnabled === true
    },
    local,
    mode: local ? VIBE64_RUNTIME_MODE_LOCAL : VIBE64_RUNTIME_MODE_HOSTED,
    singleTargetRoot: local ? String(profile.singleTargetRoot || "") : ""
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
  const error = new Error("Local editor mode disables Vibe64 tenancy auth and must bind to localhost. Refusing public listen host.");
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
  VIBE64_RUNTIME_MODE_HOSTED,
  VIBE64_RUNTIME_MODE_LOCAL,
  assertSafeLocalModeListenTarget,
  createVibe64RuntimeProfile,
  normalizeRuntimeMode,
  publicRuntimeProfile
};
