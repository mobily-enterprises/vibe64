const VIBE64_JSKIT_LOCK_PATH_ENV = "VIBE64_JSKIT_LOCK_PATH";
const DEFAULT_JSKIT_LOCK_PATH = ".jskit/lock.json";

function resolveJskitLockPath({
  env = process.env,
  explicitPath = ""
} = {}) {
  return String(explicitPath || env[VIBE64_JSKIT_LOCK_PATH_ENV] || DEFAULT_JSKIT_LOCK_PATH).trim() || DEFAULT_JSKIT_LOCK_PATH;
}

export {
  DEFAULT_JSKIT_LOCK_PATH,
  VIBE64_JSKIT_LOCK_PATH_ENV,
  resolveJskitLockPath
};
