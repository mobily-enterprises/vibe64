import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { REPOSITORY_UPDATE_CHECK_METADATA } from "@local/vibe64-core/shared";
import {
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore,
  isValidVibe64SessionId,
  readActiveSessionMetadataValues
} from "./sessionStore.js";
import { WORKSPACE_SETUP_METADATA_NAME } from "./workspaceSetupState.js";

// The session links connected repository copies replaced.
const LINK_METADATA = Object.freeze([
  "connected_sources",
  "connected_contribution",
  "connected_submissions",
  "connected_session_name"
]);
// Renewal and archive states own their records until they finish.
const UPGRADABLE_STATUSES = new Set([VIBE64_SESSION_STATUS.ACTIVE, VIBE64_SESSION_STATUS.BLOCKED]);

/**
 * One private file per session holds every value the upgrade changes. An
 * existing file is an earlier attempt: it must match exactly and is never replaced.
 */
async function backUpSessionValues(backupPath, label, record) {
  const existing = await readFile(backupPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing === null) await writeJsonFileAtomic(backupPath, record, { directoryMode: 0o700, fileMode: 0o600 });
  let saved = null;
  try {
    saved = JSON.parse(await readFile(backupPath, "utf8"));
  } catch { /* Refused below. */ }
  if (!isDeepStrictEqual(saved, record)) {
    throw new Error(`The backup for ${label} differs from its current record; inspect ${backupPath} before upgrading.`);
  }
}

// The stored preparation without its recipe hash, so the next open prepares
// the session's connected repositories again; null when nothing changes.
function setupNeedingPreparation(serialized = "") {
  try {
    const setup = JSON.parse(serialized);
    return setup?.recipeHash ? JSON.stringify({ ...setup, recipeHash: "" }) : null;
  } catch {
    return null;
  }
}

/**
 * 20261106: connected repositories became per-session copies. Every active
 * session drops the link metadata that replaced them, with its cached update
 * check; a former consumer's preparation is marked as needed again. Sessions
 * keep every file and commit, and nothing is fetched or pushed.
 */
async function removeConnectedSessionLinks({ apply, backupRoot, report, systemRoot }) {
  let changed = 0;
  let skipped = 0;
  for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
    const project = path.basename(projectRuntimeRoot);
    const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
    for (const { sessionId } of await readActiveSessionMetadataValues({ projectRuntimeRoot, name: "connected_sources" })) {
      if (!isValidVibe64SessionId(sessionId)) continue;
      const label = `${project}/${sessionId}`;
      const metadata = await store.readMetadata(sessionId);
      const links = LINK_METADATA.filter((name) => metadata[name]);
      if (!links.length) continue;
      const status = await store.readStatusForRenewal(sessionId);
      if (!UPGRADABLE_STATUSES.has(status)) {
        skipped += 1;
        report("warning", `${label}: skipped, its status is ${status}; its links stay and are no longer read.`);
        continue;
      }
      const setup = links.includes("connected_sources")
        ? setupNeedingPreparation(metadata[WORKSPACE_SETUP_METADATA_NAME])
        : null;
      const names = [...links, ...(metadata[REPOSITORY_UPDATE_CHECK_METADATA] ? [REPOSITORY_UPDATE_CHECK_METADATA] : [])];
      changed += 1;
      if (!apply) {
        report("info", `${label}: would remove ${names.join(", ")}${setup ? " and prepare its workspace again" : ""}.`);
        continue;
      }
      await backUpSessionValues(path.join(backupRoot, project, `${sessionId}.json`), label, {
        schemaVersion: 1,
        project,
        sessionId,
        metadata: Object.fromEntries([...names, ...(setup ? [WORKSPACE_SETUP_METADATA_NAME] : [])]
          .map((name) => [name, metadata[name]]))
      });
      await store.mutateSession(sessionId, async () => {
        await store.deleteMetadataValues(sessionId, names);
        if (setup) await store.writeMetadataValue(sessionId, WORKSPACE_SETUP_METADATA_NAME, setup);
      });
      report("info", `${label}: removed ${names.join(", ")}${setup ? "; its workspace prepares again" : ""}.`);
    }
  }
  report("info", changed || skipped
    ? `Connected session links: ${changed} session(s) ${apply ? "upgraded" : "to upgrade"}; ${skipped} skipped.`
    : "No connected session links to remove.");
}

export { removeConnectedSessionLinks };
