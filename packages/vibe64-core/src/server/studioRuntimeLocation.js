const REMOTE_STUDIO_RUNTIME_FLAG = "--remote";
const REMOTE_STUDIO_RUNTIME_ENV = "VIBE64_REMOTE";
const STUDIO_RUNTIME_LOCATION_LOCAL = "local";
const STUDIO_RUNTIME_LOCATION_REMOTE = "remote";

function isRemoteValue(value = "") {
  return ["1", "true", "yes", "on", STUDIO_RUNTIME_LOCATION_REMOTE]
    .includes(String(value || "").trim().toLowerCase());
}

function hasRemoteStudioRuntimeArg(argv = []) {
  return Array.isArray(argv) && argv.some((arg) => String(arg || "") === REMOTE_STUDIO_RUNTIME_FLAG);
}

function stripRemoteStudioRuntimeArgs(args = []) {
  return (Array.isArray(args) ? args : []).filter((arg) => String(arg || "") !== REMOTE_STUDIO_RUNTIME_FLAG);
}

function studioRuntimeLocation({
  argv = process.argv,
  env = process.env
} = {}) {
  return hasRemoteStudioRuntimeArg(argv) || isRemoteValue(env?.[REMOTE_STUDIO_RUNTIME_ENV])
    ? STUDIO_RUNTIME_LOCATION_REMOTE
    : STUDIO_RUNTIME_LOCATION_LOCAL;
}

function isRemoteStudioRuntime(options = {}) {
  return studioRuntimeLocation(options) === STUDIO_RUNTIME_LOCATION_REMOTE;
}

function studioRuntimeEnv(location = STUDIO_RUNTIME_LOCATION_LOCAL) {
  return {
    [REMOTE_STUDIO_RUNTIME_ENV]: location === STUDIO_RUNTIME_LOCATION_REMOTE ? "1" : "0"
  };
}

export {
  REMOTE_STUDIO_RUNTIME_ENV,
  REMOTE_STUDIO_RUNTIME_FLAG,
  STUDIO_RUNTIME_LOCATION_LOCAL,
  STUDIO_RUNTIME_LOCATION_REMOTE,
  hasRemoteStudioRuntimeArg,
  isRemoteStudioRuntime,
  stripRemoteStudioRuntimeArgs,
  studioRuntimeEnv,
  studioRuntimeLocation
};
