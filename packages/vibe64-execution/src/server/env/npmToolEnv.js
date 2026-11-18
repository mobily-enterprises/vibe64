import path from "node:path";

import {
  normalizeAbsolutePath
} from "../normalize.js";
import {
  runtimePackRoot
} from "../runtime/runtimePacks.js";

const NPM_CONFIG_PREFIX_ENV = "NPM_CONFIG_PREFIX";

/**
 * Pinned Node packs are read-only, so global installs go to the user's own
 * prefix: its folder below the host's `prefixRoot` when the host names one (a
 * host whose homes cannot start programs), else ~/.local, whose bin is on PATH.
 * Without packs the person's own npm configuration stays in charge.
 */
function npmConfigPrefix({ env = {}, prefixRoot = "" } = {}) {
  if (!runtimePackRoot()) {
    return "";
  }
  const root = normalizeAbsolutePath(prefixRoot);
  const login = String(env.USER || "").trim();
  return normalizeAbsolutePath(env[NPM_CONFIG_PREFIX_ENV]) ||
    (root && /^[a-z_][a-z0-9_-]*$/u.test(login) ? path.join(root, login) : "") ||
    (normalizeAbsolutePath(env.HOME) ? path.join(normalizeAbsolutePath(env.HOME), ".local") : "");
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
  npmToolBinDirs,
  npmToolEnv
};
