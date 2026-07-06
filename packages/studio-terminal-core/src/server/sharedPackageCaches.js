import path from "node:path";
import process from "node:process";

const VIBE64_SHARED_CACHE_ROOT_ENV = "VIBE64_SHARED_CACHE_ROOT";
const DEFAULT_VIBE64_SHARED_CACHE_ROOT = "/var/cache/vibe64";
const PACKAGE_CACHE_ENV = Object.freeze({
  composer: "COMPOSER_CACHE_DIR",
  npm: "npm_config_cache",
  pip: "PIP_CACHE_DIR",
  ruby: "BUNDLE_USER_CACHE"
});

function normalizeCacheName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function resolveVibe64SharedCacheRoot({
  env = process.env,
  explicitRoot = ""
} = {}) {
  return path.resolve(String(explicitRoot || env?.[VIBE64_SHARED_CACHE_ROOT_ENV] || DEFAULT_VIBE64_SHARED_CACHE_ROOT));
}

function packageManagerCacheNames(names = []) {
  return [...new Set((Array.isArray(names) ? names : [names])
    .map(normalizeCacheName)
    .filter((name) => PACKAGE_CACHE_ENV[name]))];
}

function packageManagerCacheEnv(names = [], options = {}) {
  const root = resolveVibe64SharedCacheRoot(options);
  return Object.fromEntries(packageManagerCacheNames(names).map((name) => [
    PACKAGE_CACHE_ENV[name],
    path.join(root, name)
  ]));
}

export {
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  packageManagerCacheEnv,
  packageManagerCacheNames,
  resolveVibe64SharedCacheRoot
};
