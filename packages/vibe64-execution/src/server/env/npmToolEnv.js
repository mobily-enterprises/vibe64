import path from "node:path";

import {
  normalizeAbsolutePath
} from "../normalize.js";
import {
  runtimePackRoot
} from "../runtime/runtimePacks.js";

const NPM_CONFIG_PREFIX_ENV = "NPM_CONFIG_PREFIX";

// Pinned Node packs are read-only, so global installs go to the user's home.
// Without packs the person's own npm configuration stays in charge.
function npmConfigPrefix({ env = {} } = {}) {
  if (!runtimePackRoot()) {
    return "";
  }
  return normalizeAbsolutePath(env?.[NPM_CONFIG_PREFIX_ENV]) ||
    (normalizeAbsolutePath(env?.HOME) ? path.join(normalizeAbsolutePath(env.HOME), ".local") : "");
}

function npmToolEnv(options = {}) {
  const prefix = npmConfigPrefix(options);
  return prefix
    ? {
        [NPM_CONFIG_PREFIX_ENV]: prefix
      }
    : {};
}

function npmToolBinDirs(options = {}) {
  const prefix = npmConfigPrefix(options);
  return prefix ? [path.join(prefix, "bin")] : [];
}

export {
  NPM_CONFIG_PREFIX_ENV,
  npmConfigPrefix,
  npmToolBinDirs,
  npmToolEnv
};
