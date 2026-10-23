import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  normalizeText,
  uniqueStrings
} from "../normalize.js";
import {
  runtimePackBinPaths,
  runtimePackGuardBinPaths,
  runtimePackPolicyBinPaths,
  runtimePackRoot
} from "./runtimePacks.js";

const DEFAULT_SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function pathParts(value = "") {
  return String(value || "")
    .split(":")
    .map(normalizeText)
    .filter(Boolean);
}

function existingDirectories(directories = []) {
  return directories.filter((directory) => {
    try {
      return existsSync(directory);
    } catch {
      return false;
    }
  });
}

function versionedEntries(directory = "", pattern = /^$/u) {
  try {
    return readdirSync(directory).filter((name) => pattern.test(name))
      .sort((left, right) => Number(/\d+/u.exec(right)?.[0] || 0) - Number(/\d+/u.exec(left)?.[0] || 0));
  } catch {
    return [];
  }
}

// Without packs, the person's own installs come first: ~/.local/bin, mise's
// shims and rustup's cargo folder, so `mise use -g python@3.13` beats the
// system's /usr/bin/python3 even when no shell profile activated them.
function installedToolFront(env = process.env) {
  if (runtimePackRoot()) return [];
  const home = String(env.HOME || os.homedir() || "");
  if (!path.isAbsolute(home)) return [];
  const xdgData = path.isAbsolute(String(env.XDG_DATA_HOME || "")) ? env.XDG_DATA_HOME : path.join(home, ".local/share");
  const miseData = path.isAbsolute(String(env.MISE_DATA_DIR || "")) ? env.MISE_DATA_DIR : path.join(xdgData, "mise");
  return existingDirectories([path.join(home, ".local/bin"), path.join(miseData, "shims"), path.join(home, ".cargo/bin")]);
}

// Without packs, commands come from the tools installed for the person running
// Vibe64, so the server's own PATH stays reachable, followed by the places
// Homebrew and Debian/Ubuntu keep programs off PATH (the newest PostgreSQL's
// initdb and pg_config, Homebrew's keg-only database programs).
function installedToolPath() {
  if (runtimePackRoot()) return [];
  const brew = ["/opt/homebrew", "/usr/local"];
  return [
    ...pathParts(process.env.PATH),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    ...existingDirectories([
      ...versionedEntries("/usr/lib/postgresql", /^\d+$/u).slice(0, 1).map((name) => `/usr/lib/postgresql/${name}/bin`),
      ...(process.platform === "darwin" ? brew.flatMap((prefix) => [
        ...versionedEntries(`${prefix}/opt`, /^postgresql@\d+$/u).slice(0, 1).map((name) => `${prefix}/opt/${name}/bin`),
        `${prefix}/opt/mariadb/bin`
      ]) : [])
    ])
  ];
}

// Order: session shims, packs, the caller's own PATH entries, the person's
// own installs (no packs), then the inherited PATH and the system folders.
function resolveRuntimePath({
  env = process.env,
  existingPath = "",
  inheritedPath = "",
  runtimes = [],
  shimDirs = []
} = {}) {
  return uniqueStrings([
    ...pathParts(shimDirs.join(":")),
    ...runtimePackPolicyBinPaths(),
    ...runtimes.flatMap((runtime) => runtimePackBinPaths(runtime)),
    ...runtimePackGuardBinPaths(),
    ...pathParts(existingPath || (inheritedPath ? "" : env.PATH)),
    ...installedToolFront(process.env),
    ...pathParts(inheritedPath),
    ...installedToolPath(),
    ...pathParts(DEFAULT_SYSTEM_PATH)
  ]).join(":");
}

export {
  DEFAULT_SYSTEM_PATH,
  resolveRuntimePath
};
