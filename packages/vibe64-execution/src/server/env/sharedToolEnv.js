import path from "node:path";

import {
  normalizeAbsolutePath
} from "../normalize.js";

const VIBE64_SHARED_CACHE_ROOT_ENV = "VIBE64_SHARED_CACHE_ROOT";
const PLAYWRIGHT_BROWSERS_PATH_ENV = "PLAYWRIGHT_BROWSERS_PATH";
const DEFAULT_VIBE64_SHARED_CACHE_ROOT = "/var/cache/vibe64";
const DEFAULT_PLAYWRIGHT_CACHE_NAME = "playwright";

function resolveVibe64SharedCacheRoot({
  env = process.env,
  explicitRoot = ""
} = {}) {
  return normalizeAbsolutePath(explicitRoot || env?.[VIBE64_SHARED_CACHE_ROOT_ENV] || DEFAULT_VIBE64_SHARED_CACHE_ROOT);
}

function resolvePlaywrightBrowsersPath(options = {}) {
  return path.join(resolveVibe64SharedCacheRoot(options), DEFAULT_PLAYWRIGHT_CACHE_NAME);
}

function sharedToolEnv(options = {}) {
  const sharedCacheRoot = resolveVibe64SharedCacheRoot(options);
  return {
    [VIBE64_SHARED_CACHE_ROOT_ENV]: sharedCacheRoot,
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: path.join(sharedCacheRoot, DEFAULT_PLAYWRIGHT_CACHE_NAME)
  };
}

function sharedToolEnvShellExportLines() {
  return [
    `export ${VIBE64_SHARED_CACHE_ROOT_ENV}="\${${VIBE64_SHARED_CACHE_ROOT_ENV}:-${DEFAULT_VIBE64_SHARED_CACHE_ROOT}}"`,
    `export ${PLAYWRIGHT_BROWSERS_PATH_ENV}="$${VIBE64_SHARED_CACHE_ROOT_ENV}/${DEFAULT_PLAYWRIGHT_CACHE_NAME}"`
  ];
}

export {
  DEFAULT_PLAYWRIGHT_CACHE_NAME,
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  resolvePlaywrightBrowsersPath,
  resolveVibe64SharedCacheRoot,
  sharedToolEnv,
  sharedToolEnvShellExportLines
};
