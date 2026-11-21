import { readFileSync } from "node:fs";
import path from "node:path";

import {
  normalizeAbsolutePath
} from "../normalize.js";
import { vibe64Host } from "../hostProfile.js";
import {
  runtimePackRoot as resolveRuntimePackRoot
} from "../runtime/runtimePacks.js";

const VIBE64_SHARED_CACHE_ROOT_ENV = "VIBE64_SHARED_CACHE_ROOT";
// The variable a host's runtime pack tools find their packs by: the wrappers every command's PATH names first
// (policy-bin's npm, npx and the rest) run the pack's own program below it.
const VIBE64_RUNTIME_PACK_ROOT_ENV = "VIBE64_RUNTIME_PACK_ROOT";
const PLAYWRIGHT_BROWSERS_PATH_ENV = "PLAYWRIGHT_BROWSERS_PATH";
const PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV = "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD";
const VIBE64_PLAYWRIGHT_VERSION_ENV = "VIBE64_PLAYWRIGHT_VERSION";
const PLAYWRIGHT_RUNTIME_PACK_NAME = "playwright";
const PLAYWRIGHT_BROWSERS_DIR_NAME = "browsers";
const PLAYWRIGHT_RUNTIME_ENV_FILE_NAME = "runtime.env";
const EXACT_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;

function resolveManagedPlaywrightVersion({ runtimePackRoot = "" } = {}) {
  const root = resolveRuntimePackRoot({ root: runtimePackRoot });
  if (!root) {
    return "";
  }
  const manifestPath = path.join(root, PLAYWRIGHT_RUNTIME_PACK_NAME, PLAYWRIGHT_RUNTIME_ENV_FILE_NAME);
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

/**
 * Without packs, Playwright keeps its own browser cache and downloads. With them every command is told where they are,
 * as its PATH's pack wrappers need: a command whose env does not start from the editor's own (one that runs with a
 * Staging Env file) has the folder only from here.
 */
function sharedToolEnv({ runtimePackRoot = "" } = {}) {
  const packRoot = resolveRuntimePackRoot({ root: runtimePackRoot });
  const cacheRoot = normalizeAbsolutePath(vibe64Host().sharedCacheRoot);
  const playwrightVersion = resolveManagedPlaywrightVersion({ runtimePackRoot: packRoot });
  return {
    ...(cacheRoot ? { [VIBE64_SHARED_CACHE_ROOT_ENV]: cacheRoot } : {}),
    ...(packRoot
      ? {
          [VIBE64_RUNTIME_PACK_ROOT_ENV]: packRoot,
          [PLAYWRIGHT_BROWSERS_PATH_ENV]: path.join(packRoot, PLAYWRIGHT_RUNTIME_PACK_NAME, PLAYWRIGHT_BROWSERS_DIR_NAME),
          [PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV]: "1"
        }
      : {}),
    ...(playwrightVersion ? { [VIBE64_PLAYWRIGHT_VERSION_ENV]: playwrightVersion } : {})
  };
}

export {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV,
  VIBE64_PLAYWRIGHT_VERSION_ENV,
  VIBE64_RUNTIME_PACK_ROOT_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  sharedToolEnv
};
