import { copyFile, cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { assertRenewalId } from "./sessionRenewalIds.js";
import { writeJsonFile, writeTextFile } from "./sessionFiles.js";
import { readVibe64CurrentSessionAlias } from "./currentSessionAlias.js";
import {
  assertValidVibe64SessionId,
  RENEWAL_ARCHIVE_RESET_METADATA_NAMES,
  RENEWAL_ARCHIVE_SELECTION_METADATA,
  RENEWAL_ARCHIVE_SELECTION_NONE,
  renewalArchiveMetadata,
  unknownSessionError,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import {
  ARCHIVE_EXECUTIONS,
  archiveCommandError,
  buildingRenewalArchiveRoot,
  metadataFilePath,
  preparedRenewalArchiveRoot,
  publishingRenewalArchiveRoot,
  runCommand,
  sessionArchiveMetadataPath,
  sessionArchivePath,
  sessionArchiveRecordExists
} from "./sessionStoreLayout.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionStoreLocks} SessionStoreLocks */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveRecords} SessionArchiveRecords */
/** @typedef {import("./types.js").SessionArchiveAccess} SessionArchiveAccess */
/** @typedef {import("./types.js").SessionArchivePublishing} SessionArchivePublishing */

/**
 * The archive side of a renewal: prepares, commits, finalizes and restores
 * the archive of the renewed session.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionStoreLocks} dependencies.locks
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 * @param {SessionArchivePublishing} dependencies.archivePublishing
 */
function createSessionRenewalArchives({
  state,
  storePaths,
  locks,
  recordFiles,
  archiveRecords,
  archiveAccess,
  archivePublishing
}) {
  function assertRenewalArchiveOwnership({
    metadata = {},
    renewalId = "",
    selectionMarkerRequired = true,
    sessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    if (
      toText(metadata.renewal_id) !== normalizedRenewalId ||
      toText(metadata.renewed_to) !== normalizedSuccessorSessionId
    ) {
      throw vibe64Error(
        `Renewal predecessor does not belong to renewal ${normalizedRenewalId}: ${normalizedSessionId}`,
        "vibe64_session_renewal_predecessor_mismatch",
        { params: { renewalId: normalizedRenewalId, sessionId: normalizedSessionId } }
      );
    }
    const selectedBeforeArchive = toText(metadata[RENEWAL_ARCHIVE_SELECTION_METADATA]);
    if (
      (selectionMarkerRequired || selectedBeforeArchive) &&
      ![normalizedSessionId, RENEWAL_ARCHIVE_SELECTION_NONE].includes(selectedBeforeArchive)
    ) {
      throw vibe64Error(
        `Renewal predecessor has no exact archive-selection marker: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_marker_invalid"
      );
    }
    return {
      renewalId: normalizedRenewalId,
      selectedBeforeArchive,
      sessionId: normalizedSessionId,
      successorSessionId: normalizedSuccessorSessionId
    };
  }

  async function readPublishedRenewalArchive({
    renewalId = "",
    sessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    if (!await sessionArchiveRecordExists(storePaths.paths(), normalizedSessionId)) {
      return null;
    }
    const archiveRecord = await archiveRecords.readSessionArchiveRecord(normalizedSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has a partially published archive: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_partially_published",
        { params: { sessionId: normalizedSessionId } }
      );
    }
    if (
      toText(archiveRecord.index?.metadata?.renewal_id) !== assertRenewalId(renewalId) ||
      toText(archiveRecord.index?.metadata?.renewed_to) !== assertValidVibe64SessionId(successorSessionId)
    ) {
      throw vibe64Error(
        `Published predecessor archive belongs to another renewal: ${normalizedSessionId}`,
        "vibe64_session_renewal_published_archive_mismatch",
        { params: { sessionId: normalizedSessionId } }
      );
    }
    return archiveRecord;
  }

  async function requirePreparedRenewalArchive({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const archiveRecord = await archiveRecords.readPreparedRenewalArchive(normalizedSourceSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has no prepared archive: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_prepared_archive_required",
        { params: { sessionId: normalizedSourceSessionId } }
      );
    }
    await archiveRecords.validateSessionArchive(archiveRecord.archivePath);
    if (
      toText(archiveRecord.index?.metadata?.renewal_id) !== normalizedRenewalId ||
      toText(archiveRecord.index?.metadata?.renewed_to) !== normalizedSuccessorSessionId
    ) {
      throw vibe64Error(
        `Prepared predecessor archive belongs to another renewal: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_prepared_archive_mismatch",
        { params: { sessionId: normalizedSourceSessionId } }
      );
    }
    return archiveRecord;
  }

  async function prepareRenewalArchiveExclusive({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    await recordFiles.assertSessionNotPinned(normalizedSourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const rootPaths = storePaths.paths();
    if (await sessionArchiveRecordExists(rootPaths, normalizedSourceSessionId)) {
      throw vibe64Error(
        `Renewal predecessor was published before its durable commit: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_archive_published_early",
        { params: { sessionId: normalizedSourceSessionId } }
      );
    }
    const buildRoot = buildingRenewalArchiveRoot(rootPaths, normalizedSourceSessionId);
    await rm(buildRoot, { force: true, recursive: true });
    const existing = await archiveRecords.readPreparedRenewalArchive(normalizedSourceSessionId);
    if (existing) {
      return requirePreparedRenewalArchive({
        renewalId: normalizedRenewalId,
        sourceSessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
    }

    const sourcePaths = storePaths.paths(normalizedSourceSessionId);
    const successorPaths = storePaths.paths(normalizedSuccessorSessionId);
    const [sourceStatus, sourceMetadata, successorStatus, successorMetadata] = await Promise.all([
      recordFiles.readStatusFromPaths(sourcePaths),
      recordFiles.readMetadataFromPaths(sourcePaths),
      recordFiles.readStatusFromPaths(successorPaths),
      recordFiles.readMetadataFromPaths(successorPaths)
    ]);
    if (
      sourceStatus !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
      toText(sourceMetadata.renewal_quiesced_id) !== normalizedRenewalId ||
      successorStatus !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
      toText(successorMetadata.renewal_id) !== normalizedRenewalId ||
      toText(successorMetadata.renewed_from) !== normalizedSourceSessionId
    ) {
      throw vibe64Error(
        `Renewal archive cannot be prepared from ${sourceStatus} -> ${successorStatus}.`,
        "vibe64_session_renewal_archive_status_pair_invalid",
        { params: { sourceStatus, successorStatus } }
      );
    }
    const selectedSessionId = rootPaths.currentSessionAliasPath
      ? await readVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath
      })
      : "";
    const selectedBeforeArchive = selectedSessionId === normalizedSourceSessionId
      ? normalizedSourceSessionId
      : RENEWAL_ARCHIVE_SELECTION_NONE;
    const preparedRoot = preparedRenewalArchiveRoot(rootPaths, normalizedSourceSessionId);
    const snapshotRoot = path.join(buildRoot, normalizedSourceSessionId);
    const stagedArchivePath = path.join(buildRoot, `${normalizedSourceSessionId}.tar.gz`);
    const stagedMetadataPath = path.join(buildRoot, `${normalizedSourceSessionId}.json`);
    const finalArchivePath = sessionArchivePath(rootPaths, normalizedSourceSessionId);
    const finalMetadataPath = sessionArchiveMetadataPath(rootPaths, normalizedSourceSessionId);
    const archivedAt = state.now().toISOString();
    try {
      await mkdir(buildRoot, { recursive: true });
      await cp(sourcePaths.sessionRoot, snapshotRoot, {
        recursive: true,
        filter: (source) => source !== sourcePaths.dropZoneRoot
      });
      const snapshotPaths = storePaths.pathsForSessionRoot(normalizedSourceSessionId, snapshotRoot);
      await Promise.all(RENEWAL_ARCHIVE_RESET_METADATA_NAMES.map((name) => (
        rm(metadataFilePath(snapshotPaths, name), { force: true })
      )));
      await Promise.all([
        ...Object.entries(renewalArchiveMetadata(successorMetadata, {
          archivedAt,
          renewalId: normalizedRenewalId,
          selectedBeforeArchive,
          successorSessionId: normalizedSuccessorSessionId
        })).map(([name, value]) => (
          writeTextFile(metadataFilePath(snapshotPaths, name), `${value}\n`)
        )),
        writeTextFile(
          snapshotPaths.statusPath,
          `${VIBE64_SESSION_STATUS.ARCHIVED}\n`
        )
      ]);
      const summary = await recordFiles.readSessionSummaryFromPaths(snapshotPaths);
      const metadataRecord = archiveRecords.sessionArchiveMetadataRecord({
        archivePath: finalArchivePath,
        archivedAt,
        metadataPath: finalMetadataPath,
        sessionId: normalizedSourceSessionId,
        summary
      });
      const tarResult = await runCommand("tar", [
        "-czf",
        stagedArchivePath,
        "-C",
        buildRoot,
        normalizedSourceSessionId
      ], {
        allowedRoots: [buildRoot],
        cwd: state.normalizedProjectContextRoot,
        execution: ARCHIVE_EXECUTIONS.write
      });
      if (!tarResult.ok) {
        throw archiveCommandError(
          tarResult,
          `Cannot prepare renewal archive ${normalizedSourceSessionId}: ${tarResult.output}`,
          "vibe64_session_renewal_archive_write_failed"
        );
      }
      await archiveRecords.validateSessionArchive(stagedArchivePath);
      await writeJsonFile(stagedMetadataPath, metadataRecord);
      await rm(snapshotRoot, { force: true, recursive: true });
      await mkdir(path.dirname(preparedRoot), { recursive: true });
      await rename(buildRoot, preparedRoot);
      return requirePreparedRenewalArchive({
        renewalId: normalizedRenewalId,
        sourceSessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
    } finally {
      await rm(buildRoot, { force: true, recursive: true });
    }
  }

  async function detachRenewedSessionForArchive(options = {}) {
    return locks.runSessionArchiveExclusive(
      options.sourceSessionId,
      async () => {
        const sourcePaths = storePaths.paths(options.sourceSessionId);
        const mutationKey = sourcePaths.sessionRoot;
        const mutationContext = state.sessionMutationContext.getStore();
        if (
          mutationContext?.key === mutationKey &&
          mutationContext.participant?.active === true
        ) {
          throw vibe64Error(
            `Cannot prepare renewal archive during an active mutation: ${sourcePaths.sessionId}`,
            "vibe64_session_renewal_archive_during_mutation",
            { params: { sessionId: sourcePaths.sessionId } }
          );
        }
        return locks.withQueuedSessionLock(mutationKey, sourcePaths, "mutation", {
          timeoutMessage: `Timed out waiting to prepare renewed Vibe64 session: ${sourcePaths.sessionId}`,
          timeoutCode: "vibe64_session_mutation_lock_timeout"
        }, async () => {
          const archiveRecord = await prepareRenewalArchiveExclusive(options);
          return {
            archiveRecord,
            detached: false,
            prepared: true,
            published: false,
            renewalId: assertRenewalId(options.renewalId),
            sessionId: sourcePaths.sessionId,
            successorSessionId: assertValidVibe64SessionId(options.successorSessionId)
          };
        });
      }
    );
  }

  async function prepareRenewalSessionArchive(options = {}) {
    const prepared = await detachRenewedSessionForArchive(options);
    return prepared.archiveRecord;
  }

  async function restoreRenewalClosingSession({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    return locks.runSessionArchiveExclusive(normalizedSourceSessionId, async () => {
      const activePaths = storePaths.paths(normalizedSourceSessionId);
      const closingPaths = storePaths.closingSessionPaths(normalizedSourceSessionId);
      return locks.withQueuedSessionLock(activePaths.sessionRoot, activePaths, "mutation", {
        timeoutMessage: `Timed out waiting to restore renewed Vibe64 session: ${normalizedSourceSessionId}`,
        timeoutCode: "vibe64_session_mutation_lock_timeout"
      }, async () => {
        const [activeExists, closingExists] = await Promise.all([
          pathExists(activePaths.manifestPath),
          pathExists(closingPaths.manifestPath)
        ]);
        if (activeExists && closingExists) {
          throw vibe64Error(
            `Vibe64 session exists in both active and closing state: ${normalizedSourceSessionId}`,
            "vibe64_session_closing_state_conflict",
            { params: { sessionId: normalizedSourceSessionId } }
          );
        }
        if (
          closingExists ||
          await sessionArchiveRecordExists(storePaths.paths(), normalizedSourceSessionId)
        ) {
          throw vibe64Error(
            `A committed predecessor archive cannot be restored: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_archive_published",
            { params: { sessionId: normalizedSourceSessionId } }
          );
        }
        if (!activeExists) {
          throw unknownSessionError(normalizedSourceSessionId);
        }
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(activePaths),
          recordFiles.readMetadataFromPaths(activePaths)
        ]);
        if (
          status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
          toText(metadata.renewal_quiesced_id) !== normalizedRenewalId
        ) {
          throw vibe64Error(
            `Renewal predecessor cannot be restored from status ${status}: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_archive_status_invalid",
            { params: { status, sessionId: normalizedSourceSessionId } }
          );
        }
        let selectedBeforeArchive = RENEWAL_ARCHIVE_SELECTION_NONE;
        const prepared = await archiveRecords.readPreparedRenewalArchive(normalizedSourceSessionId);
        if (prepared) {
          selectedBeforeArchive = await archiveAccess.withPreparedRenewalSession(
            normalizedSourceSessionId,
            (preparedSession) => assertRenewalArchiveOwnership({
              metadata: preparedSession.metadata,
              renewalId: normalizedRenewalId,
              sessionId: normalizedSourceSessionId,
              successorSessionId: normalizedSuccessorSessionId
            }).selectedBeforeArchive
          );
          await rm(
            preparedRenewalArchiveRoot(storePaths.paths(), normalizedSourceSessionId),
            { force: true, recursive: true }
          );
        }
        return {
          renewalId: normalizedRenewalId,
          restored: Boolean(prepared),
          selectedBeforeArchive,
          sessionId: normalizedSourceSessionId,
          status,
          successorSessionId: normalizedSuccessorSessionId
        };
      });
    });
  }

  async function commitRenewalArchive({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    return locks.runSessionArchiveExclusive(normalizedSourceSessionId, async () => {
      const rootPaths = storePaths.paths();
      const finalArchivePath = sessionArchivePath(rootPaths, normalizedSourceSessionId);
      const finalMetadataPath = sessionArchiveMetadataPath(rootPaths, normalizedSourceSessionId);
      const publishingRoot = publishingRenewalArchiveRoot(
        rootPaths,
        normalizedSourceSessionId
      );
      await rm(publishingRoot, { force: true, recursive: true });
      const [initialArchiveExists, initialMetadataExists] = await Promise.all([
        pathExists(finalArchivePath),
        pathExists(finalMetadataPath)
      ]);
      const prepared = await requirePreparedRenewalArchive({
        renewalId: normalizedRenewalId,
        sourceSessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
      const preparedSession = await archiveAccess.withPreparedRenewalSession(
        normalizedSourceSessionId,
        (session) => session
      );
      const ownership = assertRenewalArchiveOwnership({
        metadata: preparedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
      const activePaths = storePaths.paths(normalizedSourceSessionId);
      const closingPaths = storePaths.closingSessionPaths(normalizedSourceSessionId);
      return locks.withQueuedSessionLock(activePaths.sessionRoot, activePaths, "mutation", {
        timeoutMessage: `Timed out waiting to commit renewed Vibe64 session: ${normalizedSourceSessionId}`,
        timeoutCode: "vibe64_session_mutation_lock_timeout"
      }, async () => {
        const [activeExists, closingExists] = await Promise.all([
          pathExists(activePaths.manifestPath),
          pathExists(closingPaths.manifestPath)
        ]);
        if (activeExists && closingExists) {
          throw vibe64Error(
            `Vibe64 session exists in both active and archiving state: ${normalizedSourceSessionId}`,
            "vibe64_session_archive_state_conflict",
            { params: { sessionId: normalizedSourceSessionId } }
          );
        }
        if (activeExists) {
          const [status, metadata] = await Promise.all([
            recordFiles.readStatusFromPaths(activePaths),
            recordFiles.readMetadataFromPaths(activePaths)
          ]);
          if (
            status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
            toText(metadata.renewal_quiesced_id) !== normalizedRenewalId
          ) {
            throw vibe64Error(
              `Renewal predecessor cannot be committed from status ${status}: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_archive_commit_status_invalid",
              { params: { status, sessionId: normalizedSourceSessionId } }
            );
          }
          await archivePublishing.moveActiveSessionToClosing(activePaths, closingPaths);
          await state.renewalArchiveCommitStep({
            renewalId: normalizedRenewalId,
            sessionId: normalizedSourceSessionId,
            step: "closing-renamed"
          });
        } else if (!closingExists) {
          throw unknownSessionError(normalizedSourceSessionId);
        }

        const [closingStatus, closingMetadata] = await Promise.all([
          recordFiles.readStatusFromPaths(closingPaths),
          recordFiles.readMetadataFromPaths(closingPaths)
        ]);
        if (closingStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
          if (
            toText(closingMetadata.renewal_quiesced_id) !==
              normalizedRenewalId
          ) {
            throw vibe64Error(
              `Renewal predecessor closing ownership is invalid: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_closing_owner_invalid",
              { params: { sessionId: normalizedSourceSessionId } }
            );
          }
          for (const name of RENEWAL_ARCHIVE_RESET_METADATA_NAMES) {
            await rm(metadataFilePath(closingPaths, name), { force: true });
          }
          for (const [name, value] of Object.entries(renewalArchiveMetadata(preparedSession.metadata, {
            archivedAt: toText(preparedSession.metadata.renewal_archived_at),
            renewalId: normalizedRenewalId,
            selectedBeforeArchive: ownership.selectedBeforeArchive,
            successorSessionId: normalizedSuccessorSessionId
          }))) {
            await writeTextFile(metadataFilePath(closingPaths, name), `${value}\n`);
            await state.renewalArchiveCommitStep({
              metadataName: name,
              renewalId: normalizedRenewalId,
              sessionId: normalizedSourceSessionId,
              step: "closing-metadata-written"
            });
          }
          await writeTextFile(
            closingPaths.statusPath,
            `${VIBE64_SESSION_STATUS.ARCHIVED}\n`
          );
          await state.renewalArchiveCommitStep({
            renewalId: normalizedRenewalId,
            sessionId: normalizedSourceSessionId,
            step: "closing-status-written"
          });
        } else if (closingStatus === VIBE64_SESSION_STATUS.ARCHIVED) {
          assertRenewalArchiveOwnership({
            metadata: closingMetadata,
            renewalId: normalizedRenewalId,
            sessionId: normalizedSourceSessionId,
            successorSessionId: normalizedSuccessorSessionId
          });
        } else {
          throw vibe64Error(
            `Renewal predecessor closing status is invalid: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_closing_status_invalid",
            { params: { sessionId: normalizedSourceSessionId } }
          );
        }

        const archiveExists = initialArchiveExists || await pathExists(finalArchivePath);
        const metadataExists = initialMetadataExists || await pathExists(finalMetadataPath);
        if (archiveExists && metadataExists) {
          const published = await readPublishedRenewalArchive({
            renewalId: normalizedRenewalId,
            sessionId: normalizedSourceSessionId,
            successorSessionId: normalizedSuccessorSessionId
          });
          await archiveRecords.validateSessionArchive(published.archivePath);
          return published;
        }
        if (archiveExists || metadataExists) {
          await Promise.all([
            rm(finalArchivePath, { force: true }),
            rm(finalMetadataPath, { force: true })
          ]);
        }
        await mkdir(path.dirname(finalArchivePath), { recursive: true });
        const stagedArchivePath = path.join(
          publishingRoot,
          `${normalizedSourceSessionId}.tar.gz`
        );
        const stagedMetadataPath = path.join(
          publishingRoot,
          `${normalizedSourceSessionId}.json`
        );
        await mkdir(publishingRoot, { recursive: true });
        try {
          await copyFile(prepared.archivePath, stagedArchivePath);
          await copyFile(prepared.metadataPath, stagedMetadataPath);
          await archiveRecords.validateSessionArchive(stagedArchivePath);
          await rename(stagedArchivePath, finalArchivePath);
          await rename(stagedMetadataPath, finalMetadataPath);
        } finally {
          await rm(publishingRoot, { force: true, recursive: true });
        }
        const committed = await readPublishedRenewalArchive({
          renewalId: normalizedRenewalId,
          sessionId: normalizedSourceSessionId,
          successorSessionId: normalizedSuccessorSessionId
        });
        await archiveRecords.validateSessionArchive(committed.archivePath);
        return committed;
      });
    });
  }

  async function finalizeRenewalArchiveCommit({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const published = await readPublishedRenewalArchive({
      renewalId: normalizedRenewalId,
      sessionId: normalizedSourceSessionId,
      successorSessionId: normalizedSuccessorSessionId
    });
    if (!published) {
      throw vibe64Error(
        `Renewal predecessor has no published archive: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_archive_required",
        { params: { sessionId: normalizedSourceSessionId } }
      );
    }
    const finalized = await locks.runSessionArchiveExclusive(
      normalizedSourceSessionId,
      () => archivePublishing.publishSessionArchiveExclusive(normalizedSourceSessionId)
    );
    await rm(
      preparedRenewalArchiveRoot(storePaths.paths(), normalizedSourceSessionId),
      { force: true, recursive: true }
    );
    return finalized;
  }

  return Object.freeze({
    assertRenewalArchiveOwnership,
    commitRenewalArchive,
    detachRenewedSessionForArchive,
    finalizeRenewalArchiveCommit,
    prepareRenewalSessionArchive,
    restoreRenewalClosingSession
  });
}

export {
  createSessionRenewalArchives
};
