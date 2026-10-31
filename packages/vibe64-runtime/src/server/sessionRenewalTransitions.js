import { rm } from "node:fs/promises";
import { normalizeText, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { assertRenewalId } from "./sessionRenewalIds.js";
import { writeTextFile } from "./sessionFiles.js";
import { clearVibe64CurrentSessionAliasIfMatches } from "./currentSessionAlias.js";
import {
  assertRenewalSuccessorLink,
  assertValidVibe64SessionId,
  sessionIsUnfinishedRenewalRecord,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import { metadataFilePath, toDate } from "./sessionStoreLayout.js";

/** @typedef {ReturnType<typeof import("./sessionStoreState.js").createSessionStoreState>} SessionStoreState */
/** @typedef {ReturnType<typeof import("./sessionStorePaths.js").createSessionStorePaths>} SessionStorePaths */
/** @typedef {ReturnType<typeof import("./sessionStoreLocks.js").createSessionStoreLocks>} SessionStoreLocks */
/** @typedef {ReturnType<typeof import("./sessionRecordFiles.js").createSessionRecordFiles>} SessionRecordFiles */
/** @typedef {ReturnType<typeof import("./sessionArchiveRecords.js").createSessionArchiveRecords>} SessionArchiveRecords */
/** @typedef {ReturnType<typeof import("./sessionArchiveAccess.js").createSessionArchiveAccess>} SessionArchiveAccess */
/** @typedef {ReturnType<typeof import("./sessionRecords.js").createSessionRecords>} SessionRecords */
/** @typedef {ReturnType<typeof import("./sessionRenewalArchives.js").createSessionRenewalArchives>} SessionRenewalArchives */

/**
 * A renewal's session status changes: quiesce and restore the source session,
 * then transition, activate, roll back, commit or remove its successor.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionStoreLocks} dependencies.locks
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 * @param {SessionRecords} dependencies.sessionRecords
 * @param {SessionRenewalArchives} dependencies.renewalArchives
 */
function createSessionRenewalTransitions({
  state,
  storePaths,
  locks,
  recordFiles,
  archiveRecords,
  archiveAccess,
  sessionRecords,
  renewalArchives
}) {
  async function quiesceSessionForRenewal({
    quiescedAt = "",
    renewalId = "",
    sourceSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const requestedQuiescedAt = quiescedAt
      ? toDate(quiescedAt).toISOString()
      : state.now().toISOString();
    return locks.runRenewalTransitionExclusive(async () => {
      return sessionRecords.mutateSessionForRenewal(normalizedSourceSessionId, async (sourcePaths) => {
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(sourcePaths),
          recordFiles.readMetadataFromPaths(sourcePaths)
        ]);
        const currentQuiescedId = normalizeText(metadata.renewal_quiesced_id);
        if (status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
          if (currentQuiescedId && currentQuiescedId !== normalizedRenewalId) {
            throw vibe64Error(
              `Session is quiesced for another renewal: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_conflict"
            );
          }
          const normalizedQuiescedAt = normalizeText(metadata.renewal_quiesced_at) ||
            requestedQuiescedAt;
          await Promise.all([
            writeTextFile(
              metadataFilePath(sourcePaths, "renewal_quiesced_at"),
              `${normalizedQuiescedAt}\n`
            ),
            writeTextFile(
              metadataFilePath(sourcePaths, "renewal_quiesced_id"),
              `${normalizedRenewalId}\n`
            )
          ]);
          return recordFiles.readSessionFromPaths(sourcePaths);
        }
        const source = await recordFiles.readSessionFromPaths(sourcePaths);
        if (
          status !== VIBE64_SESSION_STATUS.ACTIVE ||
          sessionIsUnfinishedRenewalRecord(source)
        ) {
          throw vibe64Error(
            `A session can only be quiesced for renewal while it is active: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_source_not_active"
          );
        }

        // Status is the durable write barrier. Once it changes, every ordinary
        // writer and exclusive operation rejects the session, even if this
        // process stops before the provenance files finish writing.
        await writeTextFile(
          sourcePaths.statusPath,
          `${VIBE64_SESSION_STATUS.RENEWAL_QUIESCED}\n`
        );
        await state.renewalQuiesceStep({
          renewalId: normalizedRenewalId,
          sessionId: normalizedSourceSessionId,
          step: "status-written"
        });
        await Promise.all([
          rm(metadataFilePath(sourcePaths, "renewal_restored_at"), { force: true }),
          rm(metadataFilePath(sourcePaths, "renewal_restored_id"), { force: true }),
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_quiesced_at"),
            `${requestedQuiescedAt}\n`
          ),
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_quiesced_id"),
            `${normalizedRenewalId}\n`
          )
        ]);
        return recordFiles.readSessionFromPaths(sourcePaths);
      });
    });
  }

  async function restoreSessionAfterRenewalCancellation({
    renewalId = "",
    restoredAt = "",
    sourceSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const requestedRestoredAt = restoredAt
      ? toDate(restoredAt).toISOString()
      : state.now().toISOString();
    return locks.runRenewalTransitionExclusive(async () => {
      return sessionRecords.mutateSessionForRenewal(normalizedSourceSessionId, async (sourcePaths) => {
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(sourcePaths),
          recordFiles.readMetadataFromPaths(sourcePaths)
        ]);
        const currentQuiescedId = normalizeText(metadata.renewal_quiesced_id);
        const currentRestoredId = normalizeText(metadata.renewal_restored_id);
        if (
          status === VIBE64_SESSION_STATUS.ACTIVE &&
          currentRestoredId === normalizedRenewalId
        ) {
          await Promise.all([
            rm(metadataFilePath(sourcePaths, "renewal_quiesced_at"), { force: true }),
            rm(metadataFilePath(sourcePaths, "renewal_quiesced_id"), { force: true })
          ]);
          return recordFiles.readSessionFromPaths(sourcePaths);
        }
        if (
          status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
          currentQuiescedId !== normalizedRenewalId ||
          normalizeText(metadata.renewed_to)
        ) {
          throw vibe64Error(
            `Session cannot be restored from renewal ${normalizedRenewalId}: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        const normalizedRestoredAt = normalizeText(metadata.renewal_restored_at) ||
          requestedRestoredAt;
        await Promise.all([
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_restored_at"),
            `${normalizedRestoredAt}\n`
          ),
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_restored_id"),
            `${normalizedRenewalId}\n`
          )
        ]);
        await writeTextFile(sourcePaths.statusPath, `${VIBE64_SESSION_STATUS.ACTIVE}\n`);
        await Promise.all([
          rm(metadataFilePath(sourcePaths, "renewal_quiesced_at"), { force: true }),
          rm(metadataFilePath(sourcePaths, "renewal_quiesced_id"), { force: true })
        ]);
        return recordFiles.readSessionFromPaths(sourcePaths);
      });
    });
  }

  async function transitionRenewalSuccessor({
    acknowledgedAt = "",
    actorDisplayName = "",
    actorId = "",
    handoverDeliveredAt = "",
    renewedAt = "",
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    if (normalizedSourceSessionId === normalizedSuccessorSessionId) {
      throw vibe64Error(
        "A renewed session must have a different session id from its predecessor.",
        "vibe64_session_renewal_same_session"
      );
    }
    const acknowledgedTimestamp = normalizeText(acknowledgedAt);
    const deliveredTimestamp = normalizeText(handoverDeliveredAt);
    if (!acknowledgedTimestamp && !deliveredTimestamp) {
      throw vibe64Error(
        "A renewed session cannot become active before its handover reaches the fresh agent thread.",
        "vibe64_session_renewal_handover_required"
      );
    }
    const normalizedAcknowledgedAt = acknowledgedTimestamp
      ? toDate(acknowledgedTimestamp).toISOString()
      : "";
    const normalizedHandoverDeliveredAt = toDate(
      deliveredTimestamp || normalizedAcknowledgedAt
    ).toISOString();
    const normalizedRenewedAt = renewedAt
      ? toDate(renewedAt).toISOString()
      : state.now().toISOString();

    return locks.runRenewalTransitionExclusive(async () => {
      const transition = await sessionRecords.mutateSessionForRenewal(normalizedSourceSessionId, async (sourcePaths) => {
        return sessionRecords.mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
          const [sourceStatus, sourceMetadata, successorStatus, successorMetadata] = await Promise.all([
            recordFiles.readStatusFromPaths(sourcePaths),
            recordFiles.readMetadataFromPaths(sourcePaths),
            recordFiles.readStatusFromPaths(successorPaths),
            recordFiles.readMetadataFromPaths(successorPaths)
          ]);
          const successorRenewalId = normalizeText(successorMetadata.renewal_id);
          const successorRenewedFrom = normalizeText(successorMetadata.renewed_from);
          const sourceQuiescedId = normalizeText(sourceMetadata.renewal_quiesced_id);
          if (
            successorRenewalId !== normalizedRenewalId ||
            successorRenewedFrom !== normalizedSourceSessionId ||
            sourceQuiescedId !== normalizedRenewalId
          ) {
            throw vibe64Error(
              `Renewal successor does not match renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
              "vibe64_session_renewal_link_mismatch"
            );
          }
          if (!normalizeText(successorMetadata.renewal_actor_id)) {
            throw vibe64Error(
              "A renewed session requires actor attribution.",
              "vibe64_session_renewal_actor_required"
            );
          }
          const transitionActorId = normalizeText(actorId) ||
            normalizeText(successorMetadata.renewal_actor_id);
          const transitionActorDisplayName = normalizeText(actorDisplayName) ||
            normalizeText(successorMetadata.renewal_actor_display_name);
          if (!transitionActorId) {
            throw vibe64Error(
              "A renewed session requires actor attribution.",
              "vibe64_session_renewal_actor_required"
            );
          }
          const validTransition = sourceStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
            successorStatus === VIBE64_SESSION_STATUS.RENEWAL_PENDING;
          if (!validTransition) {
            throw vibe64Error(
              `Invalid renewal transition ${sourceStatus} -> ${successorStatus}.`,
              "vibe64_session_renewal_transition_invalid"
            );
          }

          const sharedMetadata = {
            ...(normalizedAcknowledgedAt
              ? {
                  renewal_acknowledged_at: normalizeText(
                    successorMetadata.renewal_acknowledged_at
                  ) || normalizedAcknowledgedAt
                }
              : {}),
            renewal_actor_display_name: transitionActorDisplayName,
            renewal_actor_id: transitionActorId,
            renewal_confirmed_at: normalizeText(successorMetadata.renewal_confirmed_at),
            renewal_handover_delivered_at: normalizeText(
              successorMetadata.renewal_handover_delivered_at
            ) || normalizedHandoverDeliveredAt,
            renewal_id: normalizedRenewalId,
            renewal_started_at: normalizeText(successorMetadata.renewal_started_at),
            renewal_successor_created_at: normalizeText(successorMetadata.renewal_successor_created_at),
            renewed_at: normalizeText(
              successorMetadata.renewed_at
            ) || normalizedRenewedAt
          };
          await Promise.all([
            ...Object.entries({
              ...sharedMetadata,
              renewed_from: normalizedSourceSessionId
            }).map(([name, value]) => (
              writeTextFile(metadataFilePath(successorPaths, name), `${value}\n`)
            ))
          ]);

          // Pre-commit ownership is private: the ordinary predecessor remains
          // quiesced, visible, and selected until its prepared archive proves
          // the exact successor and the renewal state records the commit.
          return {
            renewalId: normalizedRenewalId,
            sourceSessionId: normalizedSourceSessionId,
            successorSessionId: normalizedSuccessorSessionId
          };
        });
      });

      return transition;
    });
  }

  async function activateRenewalSuccessor({
    preparedAt = "",
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const requestedPreparedAt = preparedAt
      ? toDate(preparedAt).toISOString()
      : state.now().toISOString();
    await archiveAccess.withPreparedRenewalSession(normalizedSourceSessionId, (preparedSession) => (
      renewalArchives.assertRenewalArchiveOwnership({
        metadata: preparedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    ));
    return locks.runRenewalTransitionExclusive(() => (
      sessionRecords.mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(successorPaths),
          recordFiles.readMetadataFromPaths(successorPaths)
        ]);
        assertRenewalSuccessorLink(metadata, {
          renewalId: normalizedRenewalId,
          sourceSessionId: normalizedSourceSessionId,
          successorSessionId: normalizedSuccessorSessionId
        });
        if (status === VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING) {
          if (!normalizeText(metadata.renewal_activation_prepared_at)) {
            throw vibe64Error(
              `Prepared renewal successor has no activation proof: ${normalizedSuccessorSessionId}`,
              "vibe64_session_renewal_transition_invalid"
            );
          }
          return recordFiles.readSessionFromPaths(successorPaths);
        }
        if (status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING) {
          throw vibe64Error(
            `Renewal successor cannot be activated from status ${status}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        const normalizedPreparedAt = normalizeText(metadata.renewal_activation_prepared_at) ||
          requestedPreparedAt;
        await writeTextFile(
          metadataFilePath(successorPaths, "renewal_activation_prepared_at"),
          `${normalizedPreparedAt}\n`
        );
        await writeTextFile(
          successorPaths.statusPath,
          `${VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING}\n`
        );
        return recordFiles.readSessionFromPaths(successorPaths);
      })
    ));
  }

  async function rollbackRenewalSuccessorActivation({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    return locks.runRenewalTransitionExclusive(() => (
      sessionRecords.mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(successorPaths),
          recordFiles.readMetadataFromPaths(successorPaths)
        ]);
        assertRenewalSuccessorLink(metadata, {
          renewalId: normalizedRenewalId,
          sourceSessionId: normalizedSourceSessionId,
          successorSessionId: normalizedSuccessorSessionId
        });
        if (status === VIBE64_SESSION_STATUS.RENEWAL_PENDING) {
          await rm(
            metadataFilePath(successorPaths, "renewal_activation_prepared_at"),
            { force: true }
          );
          return recordFiles.readSessionFromPaths(successorPaths);
        }
        if (status !== VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING) {
          throw vibe64Error(
            `Renewal successor activation cannot be rolled back from status ${status}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        await writeTextFile(
          successorPaths.statusPath,
          `${VIBE64_SESSION_STATUS.RENEWAL_PENDING}\n`
        );
        await rm(
          metadataFilePath(successorPaths, "renewal_activation_prepared_at"),
          { force: true }
        );
        return recordFiles.readSessionFromPaths(successorPaths);
      })
    ));
  }

  async function commitRenewalSuccessor({
    committedAt = "",
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const normalizedCommittedAt = toDate(committedAt).toISOString();
    await archiveAccess.withPublishedRenewalSession(normalizedSourceSessionId, (publishedSession) => (
      renewalArchives.assertRenewalArchiveOwnership({
        metadata: publishedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    ));
    return locks.runRenewalTransitionExclusive(() => (
      sessionRecords.mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(successorPaths),
          recordFiles.readMetadataFromPaths(successorPaths)
        ]);
        assertRenewalSuccessorLink(metadata, {
          renewalId: normalizedRenewalId,
          sourceSessionId: normalizedSourceSessionId,
          successorSessionId: normalizedSuccessorSessionId
        });
        if (status === VIBE64_SESSION_STATUS.ACTIVE) {
          if (normalizeText(metadata.renewal_activated_at) !== normalizedCommittedAt) {
            throw vibe64Error(
              `Active renewal successor has a different commit marker: ${normalizedSuccessorSessionId}`,
              "vibe64_session_renewal_transition_invalid"
            );
          }
          return recordFiles.readSessionFromPaths(successorPaths);
        }
        if (
          status !== VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING ||
          !normalizeText(metadata.renewal_activation_prepared_at)
        ) {
          throw vibe64Error(
            `Renewal successor is not prepared for commit: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        await writeTextFile(
          metadataFilePath(successorPaths, "renewal_activated_at"),
          `${normalizedCommittedAt}\n`
        );
        await writeTextFile(successorPaths.statusPath, `${VIBE64_SESSION_STATUS.ACTIVE}\n`);
        return recordFiles.readSessionFromPaths(successorPaths);
      })
    ));
  }

  async function removeRenewalPendingSession({
    renewalId = "",
    sessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    return locks.runRenewalTransitionExclusive(async () => {
      const sessionPaths = storePaths.paths(normalizedSessionId);
      const mutationKey = sessionPaths.sessionRoot;
      return locks.withQueuedSessionLock(mutationKey, sessionPaths, "mutation", {
        timeoutMessage: `Timed out waiting to remove renewal successor: ${normalizedSessionId}`,
        timeoutCode: "vibe64_session_mutation_lock_timeout"
      }, async () => {
        if (!await pathExists(sessionPaths.manifestPath)) {
          if (await archiveRecords.readSessionArchiveRecord(normalizedSessionId)) {
            throw vibe64Error(
              `An archived session cannot be removed as a pending renewal successor: ${normalizedSessionId}`,
              "vibe64_session_renewal_transition_invalid"
            );
          }
          return {
            removed: false,
            renewalId: normalizedRenewalId,
            sessionId: normalizedSessionId
          };
        }
        const [status, metadata] = await Promise.all([
          recordFiles.readStatusFromPaths(sessionPaths),
          recordFiles.readMetadataFromPaths(sessionPaths)
        ]);
        if (
          status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
          normalizeText(metadata.renewal_id) !== normalizedRenewalId
        ) {
          throw vibe64Error(
            `Session is not the pending successor for renewal ${normalizedRenewalId}: ${normalizedSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        const rootPaths = storePaths.paths();
        if (rootPaths.currentSessionAliasPath) {
          await clearVibe64CurrentSessionAliasIfMatches({
            aliasPath: rootPaths.currentSessionAliasPath,
            sessionId: normalizedSessionId
          });
        }
        await rm(sessionPaths.sessionRoot, {
          force: true,
          recursive: true
        });
        return {
          removed: true,
          renewalId: normalizedRenewalId,
          sessionId: normalizedSessionId
        };
      });
    });
  }

  return Object.freeze({
    activateRenewalSuccessor,
    commitRenewalSuccessor,
    quiesceSessionForRenewal,
    removeRenewalPendingSession,
    restoreSessionAfterRenewalCancellation,
    rollbackRenewalSuccessorActivation,
    transitionRenewalSuccessor
  });
}

export {
  createSessionRenewalTransitions
};
