// A session with a typed gradle connection has its own Gradle user home, in its source, whose init.d
// holds the script that includes each connected checkout: Gradle reads init.d by itself, so every
// Gradle command of the session (Preview, tests, the AI's, a terminal's) builds the checkouts
// without passing a flag. The gradle adapter writes that home; this module names it, and every
// command whose folder is in such a session gets it as GRADLE_USER_HOME. Dependencies come first
// from one read-only cache shared by every session (GRADLE_RO_DEP_CACHE), so a session does not
// download again what the machine's Gradle already has.
import { existsSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeAbsolutePath } from "../normalize.js";
import { vibe64Host } from "../hostProfile.js";

/** The session's Gradle user home, relative to its source root. */
const CONNECTED_GRADLE_HOME = ".development/gradle-home";
/** The connection's init script, relative to that home. */
const CONNECTED_GRADLE_INIT = "init.d/vibe64-connected.init.gradle.kts";
/** The link to the published generation of the shared read-only cache, inside its root. */
const CONNECTED_GRADLE_RO_CURRENT = "current";

/** Where the shared read-only dependency cache lives: the host's shared cache, else the server login's cache folder. */
function connectedGradleReadOnlyCacheRoot() {
  const shared = normalizeAbsolutePath(vibe64Host().sharedCacheRoot);
  const own = normalizeAbsolutePath(process.env.XDG_CACHE_HOME) || path.join(os.homedir(), ".cache");
  return shared ? path.join(shared, "gradle-ro-dep-cache") : path.join(own, "vibe64", "gradle-ro-dep-cache");
}

/** The nearest folder at or above `cwd` that holds `.git`: the tree the command runs in. */
function treeRoot(cwd) {
  let dir = normalizeAbsolutePath(cwd);
  while (dir) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
  return "";
}

/** The published generation, which a command keeps for its whole run while a newer one is published; "" when none is. */
function publishedReadOnlyCache() {
  const root = connectedGradleReadOnlyCacheRoot();
  let generation = "";
  try {
    generation = path.join(root, path.basename(readlinkSync(path.join(root, CONNECTED_GRADLE_RO_CURRENT))));
  } catch {
    return "";
  }
  return existsSync(path.join(generation, "modules-2")) ? generation : "";
}

/**
 * The Gradle environment of a command that runs in `cwd`: the session's own Gradle user home once
 * the gradle adapter has written its init script there, with the shared read-only cache when one is
 * published; nothing otherwise.
 * @param {string} cwd
 * @returns {Record<string, string>}
 */
function connectedGradleEnv(cwd) {
  const root = treeRoot(cwd);
  if (!root) return {};
  const home = path.join(root, CONNECTED_GRADLE_HOME);
  if (!existsSync(path.join(home, CONNECTED_GRADLE_INIT))) return {};
  const cache = publishedReadOnlyCache();
  return {
    GRADLE_USER_HOME: home,
    ...(cache ? { GRADLE_RO_DEP_CACHE: cache } : {})
  };
}

/**
 * `env` without a session's Gradle home whose connection is gone, which an earlier environment still
 * names (an agent started while the session was connected carries it in its own): Gradle would make
 * that home again, outside the session's Git exclude, so a Save could commit its caches.
 * @param {Record<string, string>} env
 * @returns {Record<string, string>}
 */
function withoutStaleConnectedGradleHome(env) {
  const home = String(env.GRADLE_USER_HOME || "");
  if (!home.endsWith(`/${CONNECTED_GRADLE_HOME}`) || existsSync(path.join(home, CONNECTED_GRADLE_INIT))) return env;
  const { GRADLE_USER_HOME: _home, GRADLE_RO_DEP_CACHE: cache, ...rest } = env;
  return cache && !String(cache).startsWith(`${connectedGradleReadOnlyCacheRoot()}/`) ? { ...rest, GRADLE_RO_DEP_CACHE: cache } : rest;
}

export {
  CONNECTED_GRADLE_HOME,
  CONNECTED_GRADLE_INIT,
  CONNECTED_GRADLE_RO_CURRENT,
  connectedGradleEnv,
  connectedGradleReadOnlyCacheRoot,
  withoutStaleConnectedGradleHome
};
