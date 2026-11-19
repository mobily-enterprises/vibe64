import { lstat, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "../projectState.js";
import { verifyUpgradeParents } from "../stateUpgradeFiles.js";

const OLD_INCOMING = ".vibe64-staging";
const INCOMING = ".vibe64-incoming";

// Folders whose names said "deployment" or "staging" for something else were
// renamed so that Staging names only the app on the workspace's own server
// (19 Nov 2026). In every project state directory, projects/<slug>:
// - deployments, the project's Staging records, becomes staging;
// - Files' unfinished items in Dropzone, Backups and each active or closing
//   session's drop-zone move from .vibe64-staging to .vibe64-incoming;
// - sessions/archived/.staging, where archives are packed, becomes .packing.
// Each folder moves whole with what it holds. Writers are stopped, so an item
// an upload or archive left there moves as it was, and the release cleans it
// up or finishes it as it did before. A folder already moved is skipped; a
// folder that is not a directory, or a project holding both names, stops the
// upgrade before any move. Files inside session archives and Repo's folder in
// a checkout's Git directory are not moved.
export default {
  id: "20261119-staging-folders",
  async run({ systemRoot, apply, report }) {
    const moves = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
      const sessionsRoot = path.join(projectRuntimeRoot, "sessions");
      moves.push(
        [path.join(projectRuntimeRoot, "deployments"), path.join(projectRuntimeRoot, "staging")],
        [path.join(projectRuntimeRoot, "drop-zone", OLD_INCOMING), path.join(projectRuntimeRoot, "drop-zone", INCOMING)],
        [path.join(projectRuntimeRoot, "backups", OLD_INCOMING), path.join(projectRuntimeRoot, "backups", INCOMING)],
        [path.join(sessionsRoot, "archived", ".staging"), path.join(sessionsRoot, "archived", ".packing")]
      );
      for (const state of ["active", "closing"]) {
        for (const sessionRoot of await sessionDirectories(path.join(sessionsRoot, state))) {
          moves.push([path.join(sessionRoot, "drop-zone", OLD_INCOMING), path.join(sessionRoot, "drop-zone", INCOMING)]);
        }
      }
    }
    const pending = [];
    for (const [from, to] of moves) {
      const found = await folderKind(from);
      if (!found) continue;
      const label = path.relative(systemRoot, from);
      if (found !== "directory") throw new Error(`${label} is not a folder. Inspect it before upgrading state.`);
      if (await folderKind(to)) {
        throw new Error(`${label} and ${path.relative(systemRoot, to)} both exist. Inspect them before upgrading state.`);
      }
      await verifyUpgradeParents(systemRoot, from);
      pending.push([from, to, label]);
    }
    for (const [from, to, label] of pending) {
      report("info", `${label} ${apply ? "moved" : "moves"} to ${path.basename(to)}.`);
      if (apply) await rename(from, to);
    }
    if (!pending.length) report("info", "No folder has an old name.");
  }
};

async function folderKind(target) {
  try {
    return (await lstat(target)).isDirectory() ? "directory" : "other";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

// A session state folder's session directories; .creating and other dot
// folders are the store's own and hold no drop-zone.
async function sessionDirectories(stateRoot) {
  if (await folderKind(stateRoot) !== "directory") return [];
  return (await readdir(stateRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(stateRoot, entry.name))
    .sort();
}
