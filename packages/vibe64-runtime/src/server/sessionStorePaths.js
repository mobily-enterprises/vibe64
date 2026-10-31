import { lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { normalizeText, vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { managedSessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { assertValidVibe64SessionId } from "./sessionRecordRules.js";
import {
  buildingRenewalArchiveRoot,
  closingSessionRoot,
  preparedRenewalArchiveRoot,
  publishingRenewalArchiveRoot,
  renewalArchiveStagingRoot,
  resolveVibe64SessionPaths,
  sessionArchiveMetadataPath,
  sessionArchivePath,
  sessionArchiveStagingRoot,
  sessionCreationStagingRoot,
  sessionPathsFromRoot
} from "./sessionStoreLayout.js";

/** @typedef {ReturnType<typeof import("./sessionStoreState.js").createSessionStoreState>} SessionStoreState */

/**
 * Where the store keeps sessions, closing trees, archives and renewal state,
 * and the check that a new session leaves none of it behind.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 */
function createSessionStorePaths({ state }) {
  function paths(sessionId = "") {
    return resolveVibe64SessionPaths({
      projectContextRoot: state.normalizedProjectContextRoot,
      projectRuntimeRoot: state.normalizedStateRoot,
      projectSessionSourceRoot: state.projectSessionSourceRoot,
      sessionId
    });
  }

  // The project-shared Files folders exist before an agent is given their
  // paths, so copying into one never creates a file in a folder's place. Each
  // is prepared on its own and never fails the caller: whatever already sits
  // at a path is left alone, and Files reports a non-folder there.
  async function prepareProjectFileAreas() {
    const { projectBackupsRoot, projectDropZoneRoot } = paths();
    for (const root of [projectDropZoneRoot, projectBackupsRoot]) {
      if (root) await mkdir(root, { recursive: true, mode: vibe64SharedModes().directory }).catch(() => {});
    }
  }

  function renewalStateRoot() {
    return path.join(state.normalizedStateRoot, "session-renewals");
  }

  function renewalStatePath(sessionId = "") {
    return path.join(
      renewalStateRoot(),
      `${assertValidVibe64SessionId(sessionId)}.json`
    );
  }

  async function assertSessionCreationAbsent(sessionId = "") {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const rootPaths = paths();
    const sourcePath = managedSessionSourcePath(state.projectSessionSourceRoot, normalizedSessionId);
    const conflict = (filePath) => vibe64Error(
      `Session creation state already exists for ${normalizedSessionId}: ${filePath}. Inspect and recover it before creating the session.`,
      "vibe64_session_creation_state_conflict"
    );
    const readStatePath = async (filePath) => {
      try {
        return await lstat(filePath);
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    };
    const creationStagingRoot = sessionCreationStagingRoot(rootPaths);
    const archiveStagingRoot = sessionArchiveStagingRoot(rootPaths);
    const directoryPaths = [
      state.normalizedStateRoot,
      rootPaths.sessionsRoot,
      rootPaths.activeSessionsRoot,
      rootPaths.closingSessionsRoot,
      rootPaths.archivedSessionsRoot,
      creationStagingRoot,
      archiveStagingRoot,
      renewalArchiveStagingRoot(rootPaths),
      path.dirname(buildingRenewalArchiveRoot(rootPaths, normalizedSessionId)),
      path.dirname(publishingRenewalArchiveRoot(rootPaths, normalizedSessionId)),
      renewalStateRoot(),
      ...(sourcePath ? [
        path.resolve(normalizeText(state.projectSessionSourceRoot)),
        path.dirname(path.dirname(path.dirname(sourcePath))),
        path.dirname(path.dirname(sourcePath))
      ] : [])
    ];
    for (const directoryPath of directoryPaths) {
      const info = await readStatePath(directoryPath);
      if (info && !info.isDirectory()) throw conflict(directoryPath);
    }
    const statePaths = [
      paths(normalizedSessionId).sessionRoot,
      closingSessionRoot(rootPaths, normalizedSessionId),
      sessionArchiveMetadataPath(rootPaths, normalizedSessionId),
      sessionArchivePath(rootPaths, normalizedSessionId),
      preparedRenewalArchiveRoot(rootPaths, normalizedSessionId),
      buildingRenewalArchiveRoot(rootPaths, normalizedSessionId),
      publishingRenewalArchiveRoot(rootPaths, normalizedSessionId),
      renewalStatePath(normalizedSessionId),
      ...(sourcePath ? [path.dirname(sourcePath)] : [])
    ];
    for (const statePath of statePaths) {
      if (await readStatePath(statePath)) throw conflict(statePath);
    }
    for (const [stagingRoot, prefix] of [
      [creationStagingRoot, `${normalizedSessionId}.`],
      [archiveStagingRoot, `${normalizedSessionId}-`]
    ]) {
      const info = await readStatePath(stagingRoot);
      if (!info) continue;
      if (!info.isDirectory()) throw conflict(stagingRoot);
      const entries = await readdir(stagingRoot);
      const existing = entries.find((name) => name.startsWith(prefix));
      if (existing) throw conflict(path.join(stagingRoot, existing));
    }
  }

  function pathsForSessionRoot(sessionId = "", sessionRoot = "") {
    const rootPaths = paths();
    return sessionPathsFromRoot({
      activeSessionsRoot: rootPaths.activeSessionsRoot,
      closingSessionsRoot: rootPaths.closingSessionsRoot,
      archivedSessionsRoot: rootPaths.archivedSessionsRoot,
      currentSessionAliasPath: rootPaths.currentSessionAliasPath,
      projectContextRoot: rootPaths.projectContextRoot,
      sessionId: assertValidVibe64SessionId(sessionId),
      sessionRoot,
      sessionsRoot: rootPaths.sessionsRoot,
      stateRoot: rootPaths.stateRoot
    });
  }

  function closingSessionPaths(sessionId = "") {
    const rootPaths = paths();
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    return pathsForSessionRoot(
      normalizedSessionId,
      closingSessionRoot(rootPaths, normalizedSessionId)
    );
  }

  return Object.freeze({
    assertSessionCreationAbsent,
    closingSessionPaths,
    paths,
    pathsForSessionRoot,
    prepareProjectFileAreas,
    renewalStatePath,
    renewalStateRoot
  });
}

export {
  createSessionStorePaths
};
