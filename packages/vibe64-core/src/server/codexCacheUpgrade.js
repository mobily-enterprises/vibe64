import { codexHomeDisposablePaths } from "@jskit-ai/assistant-core/server/codex-configuration";
import { lstat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURATED_CODEX_PROVIDERS } from "../shared/curatedCodexProviders.js";
import { codexProviderPaths } from "./codexProviderConnections.js";

// A home is reached only through real directories below its trusted root; a
// link on the way is reported and left alone.
async function homeState(root, home) {
  let current = root;
  for (const part of path.relative(root, home).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (!(await lstat(current)).isDirectory()) return "not a real directory";
    } catch (error) {
      if (error.code === "ENOENT") return "missing";
      throw error;
    }
  }
  return "directory";
}

// Codex synced plugin and app catalogues into every home it ran in, and a
// removed provider connection kept its diagnostic logs and temporary files.
// Neither is read again: the managed home and connected providers lose only the
// plugin and app caches; a provider home without a connection also loses its
// runtime-only data. Which entries those are is JSKIT's Codex owner's answer.
// These are regenerable caches and logs, not saved state, so there is no backup.
async function removeUnusedCodexCaches({ systemRoot, apply, report, home = os.homedir() }) {
  if (!path.isAbsolute(systemRoot || "") || !path.isAbsolute(home || "")) {
    throw new Error("Codex cache removal requires absolute state and home directories.");
  }
  const homes = [{ root: home, codexHome: path.join(home, ".codex"), label: "~/.codex", retired: false }];
  for (const { id } of CURATED_CODEX_PROVIDERS) {
    const paths = codexProviderPaths(systemRoot, id, "codex");
    const connected = await lstat(paths.connectionPath).then(() => true, (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    homes.push({ root: systemRoot, codexHome: paths.codexHome, label: path.relative(systemRoot, paths.codexHome), retired: !connected });
  }
  const found = [];
  for (const entry of homes) {
    const state = await homeState(entry.root, entry.codexHome);
    if (state === "missing") continue;
    if (state !== "directory") {
      report("warning", `${entry.label} is ${state}; its Codex caches are left alone.`);
      continue;
    }
    const paths = await codexHomeDisposablePaths(entry.codexHome, { retired: entry.retired });
    if (paths.length) found.push({ ...entry, paths });
  }
  if (!found.length) {
    report("info", "No unused Codex caches.");
    return;
  }
  for (const { label, paths, retired } of found) {
    report("info", `${label}: ${apply ? "removing" : "would remove"} ${paths.length} unused ` +
      `${retired ? "cache, temporary and log entries of a removed connection" : "plugin and app cache entries"}.`);
    if (apply) for (const entry of paths) await rm(entry, { recursive: true, force: true });
  }
  report("info", `${apply ? "Removed" : "Found"} unused Codex caches in ${found.length} Codex home(s).`);
}

export { removeUnusedCodexCaches };
