import { readFileSync } from "node:fs";
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
const PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV = "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD";
const VIBE64_PLAYWRIGHT_VERSION_ENV = "VIBE64_PLAYWRIGHT_VERSION";
const DEFAULT_VIBE64_SHARED_CACHE_ROOT = "/var/cache/vibe64";
const PLAYWRIGHT_RUNTIME_PACK_NAME = "playwright";
const PLAYWRIGHT_BROWSERS_DIR_NAME = "browsers";
const PLAYWRIGHT_RUNTIME_ENV_FILE_NAME = "runtime.env";
const EXACT_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;

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

function resolveManagedPlaywrightVersion(options = {}) {
  const manifestPath = path.join(
    runtimePackRoot(options),
    PLAYWRIGHT_RUNTIME_PACK_NAME,
    PLAYWRIGHT_RUNTIME_ENV_FILE_NAME
  );
  let source;
  try {
    source = readFileSync(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
  const versions = source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("playwright_version="))
    .map((line) => line.slice("playwright_version=".length).trim());
  if (versions.length !== 1 || !EXACT_SEMVER_PATTERN.test(versions[0])) {
    throw new Error(`Invalid managed Playwright runtime manifest: ${manifestPath}.`);
  }
  return versions[0];
}

function sharedToolEnv(options = {}) {
  const sharedCacheRoot = resolveVibe64SharedCacheRoot(options);
  const playwrightVersion = resolveManagedPlaywrightVersion(options);
  return {
    [VIBE64_SHARED_CACHE_ROOT_ENV]: sharedCacheRoot,
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: resolvePlaywrightBrowsersPath(options),
    [PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV]: "1",
    ...(playwrightVersion
      ? {
        [VIBE64_PLAYWRIGHT_VERSION_ENV]: playwrightVersion
      }
      : {})
  };
}

function sharedToolEnvShellExportLines() {
  return [
    `export ${VIBE64_SHARED_CACHE_ROOT_ENV}="\${${VIBE64_SHARED_CACHE_ROOT_ENV}:-${DEFAULT_VIBE64_SHARED_CACHE_ROOT}}"`,
    `export ${PLAYWRIGHT_BROWSERS_PATH_ENV}="\${${VIBE64_RUNTIME_PACK_ROOT_ENV}:-${DEFAULT_RUNTIME_PACK_ROOT}}/${PLAYWRIGHT_RUNTIME_PACK_NAME}/${PLAYWRIGHT_BROWSERS_DIR_NAME}"`,
    `export ${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV}=1`
  ];
}

export {
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  PLAYWRIGHT_BROWSERS_DIR_NAME,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV,
  PLAYWRIGHT_RUNTIME_PACK_NAME,
  VIBE64_PLAYWRIGHT_VERSION_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  resolveManagedPlaywrightVersion,
  resolvePlaywrightBrowsersPath,
  resolveVibe64SharedCacheRoot,
  sharedToolEnv,
  sharedToolEnvShellExportLines
};
