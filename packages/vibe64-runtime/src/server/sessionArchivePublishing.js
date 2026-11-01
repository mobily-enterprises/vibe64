import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { normalizeText, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { writeJsonFile } from "./sessionFiles.js";
import { clearVibe64CurrentSessionAliasIfMatches } from "./currentSessionAlias.js";
import {
  assertNormalSessionIsMutable,
  assertValidVibe64SessionId,
  unknownSessionError,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import {
  ARCHIVE_EXECUTIONS,
  archiveCommandError,
  runCommand,
  sessionArchiveMetadataPath,
  sessionArchivePath,
  sessionArchiveStagingRoot
} from "./sessionStoreLayout.js";
import { enqueueSessionMutation } from "./sessionStoreLocks.js";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionStoreLocks} SessionStoreLocks */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveRecords} SessionArchiveRecords */

/**
 * Archives a session: detaches it from the active sessions and publishes
 * its archive.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionStoreLocks} dependencies.locks
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 */
function createSessionArchivePublishing({
  state,
  storePaths,
  locks,
  recordFiles,
  archiveRecords
}) {
  async function moveActiveSessionToClosing(activePaths, closingPaths) {
    const moveSessionRoot = async () => {
      await mkdir(activePaths.closingSessionsRoot, {
        recursive: true
      });
      await rename(activePaths.sessionRoot, closingPaths.sessionRoot);
    };
    if (!activePaths.currentSessionAliasPath) {
      return moveSessionRoot();
    }
    return enqueueSessionMutation(activePaths.currentSessionAliasPath, async () => {
      await recordFiles.assertSessionNotPinned(activePaths.sessionId);
      await moveSessionRoot();
      await clearVibe64CurrentSessionAliasIfMatches({
        aliasPath: activePaths.currentSessionAliasPath,
        sessionId: activePaths.sessionId
      });
    });
  }

  async function clearClosingSessionAlias(sessionPaths) {
    if (!sessionPaths.currentSessionAliasPath) {
      return;
    }
    await enqueueSessionMutation(sessionPaths.currentSessionAliasPath, () => (
      clearVibe64CurrentSessionAliasIfMatches({
        aliasPath: sessionPaths.currentSessionAliasPath,
        sessionId: sessionPaths.sessionId
      })
    ));
  }

  async function detachSessionForArchive(sessionId) {
    const activePaths = storePaths.paths(sessionId);
    const closingPaths = storePaths.closingSessionPaths(activePaths.sessionId);
    const mutationKey = activePaths.sessionRoot;
    const mutationContext = state.sessionMutationContext.getStore();
    if (
      mutationContext?.key === mutationKey &&
      mutationContext.participant?.active === true
    ) {
      throw vibe64Error(
        `Cannot archive Vibe64 session during an active mutation: ${activePaths.sessionId}`,
        "vibe64_session_archive_during_mutation"
      );
    }
    return locks.withQueuedSessionLock(mutationKey, activePaths, "mutation", {
      timeoutMessage: `Timed out waiting to archive Vibe64 session: ${activePaths.sessionId}`,
      timeoutCode: "vibe64_session_mutation_lock_timeout"
    }, async () => {
      const [activeExists, closingExists] = await Promise.all([
        pathExists(activePaths.manifestPath),
        pathExists(closingPaths.manifestPath)
      ]);
      if (activeExists && closingExists) {
        throw vibe64Error(
          `Vibe64 session exists in both active and archiving state: ${activePaths.sessionId}`,
          "vibe64_session_archive_state_conflict"
        );
      }
      if (closingExists) {
        const [closingStatus, closingMetadata] = await Promise.all([
          recordFiles.readStatusFromPaths(closingPaths),
          recordFiles.readMetadataFromPaths(closingPaths)
        ]);
        assertNormalSessionIsMutable({
          sessionId: closingPaths.sessionId,
          status: closingStatus
        });
        if (
          normalizeText(closingMetadata.renewal_id) &&
          normalizeText(closingMetadata.renewed_to)
        ) {
          throw vibe64Error(
            `Renewal predecessor must use the renewal archive transaction: ${activePaths.sessionId}`,
            "vibe64_session_renewal_archive_api_required"
          );
        }
        await clearClosingSessionAlias(closingPaths);
        return;
      }
      if (!activeExists) {
        if (await archiveRecords.readSessionArchiveRecord(activePaths.sessionId)) {
          return;
        }
        throw unknownSessionError(activePaths.sessionId);
      }
      const [status, metadata] = await Promise.all([
        recordFiles.readStatusFromPaths(activePaths),
        recordFiles.readMetadataFromPaths(activePaths)
      ]);
      assertNormalSessionIsMutable({
        sessionId: activePaths.sessionId,
        status
      });
      if (status !== VIBE64_SESSION_STATUS.ARCHIVED) {
        throw vibe64Error(
          `Cannot archive open Vibe64 session ${activePaths.sessionId} with status ${status}.`,
          "vibe64_session_archive_open_status"
        );
      }
      if (
        normalizeText(metadata.renewal_id) &&
        normalizeText(metadata.renewed_to)
      ) {
        throw vibe64Error(
          `Renewal predecessor must use the renewal archive transaction: ${activePaths.sessionId}`,
          "vibe64_session_renewal_archive_api_required"
        );
      }

      // Compression must never observe a mutable live tree. The atomic rename
      // is the archive barrier: earlier writers are included, and later writers
      // re-check the active namespace after acquiring this same lock.
      await moveActiveSessionToClosing(activePaths, closingPaths);
    });
  }

  async function publishSessionArchive(sessionId) {
    // Detachment is the archive barrier. Queue it before any archive work so a
    // later writer can never overtake finalisation, even while another process
    // is publishing the archive.
    await detachSessionForArchive(sessionId);
    return locks.runSessionArchiveExclusive(
      sessionId,
      () => publishSessionArchiveExclusive(sessionId)
    );
  }

  async function publishSessionArchiveExclusive(sessionId, options = {}) {
    const {
      retainSessionRoot = false
    } = options;
    const rootPaths = storePaths.paths();
    const sessionPaths = storePaths.closingSessionPaths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      const archiveRecord = await archiveRecords.readSessionArchiveRecord(sessionId);
      if (!archiveRecord) {
        throw unknownSessionError(assertValidVibe64SessionId(sessionId));
      }
      await archiveRecords.validateSessionArchive(archiveRecord.archivePath);
      return archiveRecord;
    }
    const status = await recordFiles.readStatusFromPaths(sessionPaths);
    if (status !== VIBE64_SESSION_STATUS.ARCHIVED) {
      throw vibe64Error(
        `Cannot archive open Vibe64 session ${sessionPaths.sessionId} with status ${status}.`,
        "vibe64_session_archive_open_status"
      );
    }

    const finalArchivePath = sessionArchivePath(rootPaths, sessionPaths.sessionId);
    const finalMetadataPath = sessionArchiveMetadataPath(rootPaths, sessionPaths.sessionId);
    const finalArchiveExists = await pathExists(finalArchivePath);
    const finalMetadataExists = await pathExists(finalMetadataPath);
    if (finalArchiveExists && finalMetadataExists) {
      const archiveRecord = await archiveRecords.requireSessionArchiveRecord(
        rootPaths,
        sessionPaths.sessionId
      );
      await archiveRecords.validateSessionArchive(archiveRecord.archivePath);
      await rm(sessionPaths.dropZoneRoot, { force: true, recursive: true });
      if (!retainSessionRoot) {
        await rm(sessionPaths.sessionRoot, {
          force: true,
          recursive: true
        });
      }
      return archiveRecord;
    }
    if (finalArchiveExists || finalMetadataExists) {
      // The closing tree is the durable source of truth until both published
      // files exist. A process interruption between the two renames is retried
      // from that immutable tree instead of stranding a half-archived session.
      await Promise.all([
        rm(finalArchivePath, {
          force: true
        }),
        rm(finalMetadataPath, {
          force: true
        })
      ]);
    }

    const stagedRoot = path.join(sessionArchiveStagingRoot(rootPaths), `${sessionPaths.sessionId}-${randomUUID()}`);
    const stagedArchivePath = path.join(stagedRoot, `${sessionPaths.sessionId}.tar.gz`);
    const stagedMetadataPath = path.join(stagedRoot, `${sessionPaths.sessionId}.json`);
    const archivedAt = state.now().toISOString();
    const summary = await recordFiles.readSessionSummaryFromPaths(sessionPaths);
    const metadataRecord = archiveRecords.sessionArchiveMetadataRecord({
      archivePath: finalArchivePath,
      archivedAt,
      metadataPath: finalMetadataPath,
      sessionId: sessionPaths.sessionId,
      summary
    });
    let archiveFinalized = false;
    let metadataFinalized = false;
    try {
      await mkdir(stagedRoot, {
        recursive: true
      });
      const tarResult = await runCommand("tar", [
        "-czf",
        stagedArchivePath,
        "-C",
        rootPaths.closingSessionsRoot,
        `--exclude=${sessionPaths.sessionId}/drop-zone`,
        // Usage recordings are never archived; they end with the session.
        `--exclude=${sessionPaths.sessionId}/usage-recordings`,
        // Architecture caches are rebuilt by the next inspection.
        `--exclude=${sessionPaths.sessionId}/architecture-cache`,
        sessionPaths.sessionId
      ], {
        allowedRoots: [
          rootPaths.closingSessionsRoot,
          stagedRoot
        ],
        cwd: state.normalizedProjectContextRoot,
        execution: ARCHIVE_EXECUTIONS.write
      });
      if (!tarResult.ok) {
        throw archiveCommandError(tarResult,
          `Cannot archive Vibe64 session ${sessionPaths.sessionId}: ${tarResult.output}`,
          "vibe64_session_archive_write_failed");
      }
      await archiveRecords.validateSessionArchive(stagedArchivePath);
      await writeJsonFile(stagedMetadataPath, metadataRecord);
      await mkdir(path.dirname(finalArchivePath), {
        recursive: true
      });
      await rename(stagedArchivePath, finalArchivePath);
      archiveFinalized = true;
      await rename(stagedMetadataPath, finalMetadataPath);
      metadataFinalized = true;
      const archiveRecord = await archiveRecords.requireSessionArchiveRecord(
        rootPaths,
        sessionPaths.sessionId
      );
      await rm(sessionPaths.dropZoneRoot, { force: true, recursive: true });
      if (!retainSessionRoot) {
        await rm(sessionPaths.sessionRoot, {
          force: true,
          recursive: true
        });
      }
      return archiveRecord;
    } catch (error) {
      if (!metadataFinalized) {
        await rm(stagedMetadataPath, {
          force: true
        });
      }
      if (!archiveFinalized) {
        await rm(stagedArchivePath, {
          force: true
        });
      }
      if (archiveFinalized && !metadataFinalized) {
        await rm(finalArchivePath, {
          force: true
        });
      }
      throw error;
    } finally {
      await rm(stagedRoot, {
        force: true,
        recursive: true
      });
    }
  }

  return Object.freeze({
    moveActiveSessionToClosing,
    publishSessionArchive,
    publishSessionArchiveExclusive
  });
}

export {
  createSessionArchivePublishing
};
