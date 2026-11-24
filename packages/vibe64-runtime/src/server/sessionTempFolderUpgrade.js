import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { explicitPathIsManagedSessionSource } from "@local/vibe64-core/server/sessionSourcePath";
import { createVibe64SessionStore, isValidVibe64SessionId, readActiveSessionMetadataValues } from "./sessionStore.js";

function missingAsNull(error) {
  if (error?.code === "ENOENT") return null;
  throw error;
}

/**
 * 20261124: a session's temporary folder moved from `tmp` beside its source
 * to a short folder in the editor's own TMPDIR (sessionTempPath), so Unix
 * sockets fit below it. Each session's old folder goes with what it holds,
 * whatever the session's status: throwaway files, which archive removes
 * without a copy too, so nothing is backed up. Anything else named `tmp`
 * there (a file, a link) is not what Vibe64 made and stays, with a warning;
 * so does a folder that cannot be removed.
 */
async function removeOldSessionTempFolders({ apply, report, systemRoot }) {
  let found = 0;
  let removed = 0;
  for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
    const project = path.basename(projectRuntimeRoot);
    const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
    for (const { sessionId, value } of await readActiveSessionMetadataValues({ projectRuntimeRoot, name: "source_kind" })) {
      // Creation staging lives beside the sessions.
      if (!isValidVibe64SessionId(sessionId) || String(value || "").trim() !== "session_clone") continue;
      const label = `${project}/${sessionId}`;
      const metadata = await store.readMetadata(sessionId);
      // The recorded checkout, kept or already archived: the old folder was beside it.
      const recorded = String(metadata.source_path || metadata.source || "").trim();
      if (!explicitPathIsManagedSessionSource({ metadata, sessionId, sessionRoot: store.paths(sessionId).sessionRoot }, recorded)) continue;
      const oldTemp = path.join(path.dirname(path.resolve(recorded)), "tmp");
      const entry = await lstat(oldTemp).catch(missingAsNull);
      if (!entry) continue;
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        report("warning", `${label}: ${oldTemp} is not a folder Vibe64 made, so it stays; remove it if nothing needs it.`);
        continue;
      }
      found += 1;
      if (!apply) {
        report("info", `${label}: would remove its old temporary folder ${oldTemp}.`);
        continue;
      }
      try {
        await rm(oldTemp, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
      } catch (error) {
        report("warning", `${label}: its old temporary folder ${oldTemp} could not be removed (${error.code || error.message}); ` +
          "remove it by hand, as the account that owns what is in it.");
        continue;
      }
      removed += 1;
      report("info", `${label}: removed its old temporary folder ${oldTemp}.`);
    }
  }
  report("info", found
    ? `Old session temporary folders: ${apply ? `${removed} of ${found} removed` : `${found} to remove`}.`
    : "No old session temporary folders to remove.");
}

export { removeOldSessionTempFolders };
