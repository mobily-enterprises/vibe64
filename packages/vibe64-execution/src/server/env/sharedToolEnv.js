import path from "node:path";

import {
  normalizeAbsolutePath
} from "../normalize.js";
import {
  DEFAULT_RUNTIME_PACK_ROOT,
  VIBE64_RUNTIME_PACK_ROOT_ENV,
  runtimePackRoot
} from "../runtime/runtimePacks.js";

const VIBE64_SHARED_CACHE_ROOT_ENV = "VIBE64_SHARED_CACHE_ROOT";
const PLAYWRIGHT_BROWSERS_PATH_ENV = "PLAYWRIGHT_BROWSERS_PATH";
const DEFAULT_VIBE64_SHARED_CACHE_ROOT = "/var/cache/vibe64";
const PLAYWRIGHT_RUNTIME_PACK_NAME = "playwright";
const PLAYWRIGHT_BROWSERS_DIR_NAME = "browsers";

function resolveVibe64SharedCacheRoot({
  env = process.env,
  explicitRoot = ""
} = {}) {
  return normalizeAbsolutePath(explicitRoot || env?.[VIBE64_SHARED_CACHE_ROOT_ENV] || DEFAULT_VIBE64_SHARED_CACHE_ROOT);
}

function resolvePlaywrightBrowsersPath(options = {}) {
  return path.join(
    runtimePackRoot(options),
    PLAYWRIGHT_RUNTIME_PACK_NAME,
    PLAYWRIGHT_BROWSERS_DIR_NAME
  );
}

function sharedToolEnv(options = {}) {
  const sharedCacheRoot = resolveVibe64SharedCacheRoot(options);
  return {
    [VIBE64_SHARED_CACHE_ROOT_ENV]: sharedCacheRoot,
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: resolvePlaywrightBrowsersPath(options)
  };
}

function sharedToolEnvShellExportLines() {
  return [
    `export ${VIBE64_SHARED_CACHE_ROOT_ENV}="\${${VIBE64_SHARED_CACHE_ROOT_ENV}:-${DEFAULT_VIBE64_SHARED_CACHE_ROOT}}"`,
    `export ${PLAYWRIGHT_BROWSERS_PATH_ENV}="\${${VIBE64_RUNTIME_PACK_ROOT_ENV}:-${DEFAULT_RUNTIME_PACK_ROOT}}/${PLAYWRIGHT_RUNTIME_PACK_NAME}/${PLAYWRIGHT_BROWSERS_DIR_NAME}"`
  ];
}

export {
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  PLAYWRIGHT_BROWSERS_DIR_NAME,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  PLAYWRIGHT_RUNTIME_PACK_NAME,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  resolvePlaywrightBrowsersPath,
  resolveVibe64SharedCacheRoot,
  sharedToolEnv,
  sharedToolEnvShellExportLines
};
