import { sessionLockIsAbandoned, sessionLockPath } from "./sessionLocks.js";
import {
  genuineLearningBinding,
  isValidVibe64SessionId,
  LEARNING_SESSION_METADATA,
  learningSessionBinding,
  normalizeSessionListOptions,
  sessionIsUnfinishedRenewalRecord,
  sessionListMayIncludeArchived,
  sessionStatusMatchesListOptions,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import { readDirectoryEntries, sortedDirectoryNames } from "./sessionStoreLayout.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionArchiveRecords} SessionArchiveRecords */
/** @typedef {import("./types.js").SessionRecords} SessionRecords */
/** @typedef {import("./types.js").SessionArchivePublishing} SessionArchivePublishing */
/** @typedef {ReturnType<typeof import("./currentSessionRecords.js").createCurrentSessionRecords>} CurrentSessionRecords */

/**
 * Lists sessions and session summaries, and publishes archived sessions left
 * unpublished.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 * @param {SessionRecords} dependencies.sessionRecords
 * @param {SessionArchivePublishing} dependencies.archivePublishing
 * @param {CurrentSessionRecords} dependencies.currentSession
 */
function createSessionListing({
  state,
  storePaths,
  archiveRecords,
  sessionRecords,
  archivePublishing,
  currentSession
}) {
  async function readUnarchivedSessionRecords() {
    const rootPaths = storePaths.paths();
    const [activeEntries, closingEntries] = await Promise.all([
      readDirectoryEntries(rootPaths.activeSessionsRoot),
      readDirectoryEntries(rootPaths.closingSessionsRoot)
    ]);
    const activeSessionIds = sortedDirectoryNames(activeEntries, isValidVibe64SessionId);
    const closingSessionIds = sortedDirectoryNames(closingEntries, isValidVibe64SessionId);
    const sessionIds = [...new Set([
      ...activeSessionIds,
      ...closingSessionIds
    ])].sort((left, right) => left.localeCompare(right));
    const learning = !state.admittedLearningScope ? await Promise.all(sessionIds.map(currentSession.hasGenuineLearningBinding)) : [];
    return Promise.all(sessionIds.filter((_sessionId, index) => !learning[index]).map(async (sessionId) => ({
      sessionId,
      status: await sessionRecords.readStatusForRenewal(sessionId)
    })));
  }

  /**
   * Publishes each archived session left unpublished. One that cannot be
   * published is reported and stays for the next attempt; the others go on.
   */
  async function recoverSessionArchives() {
    const recovered = [];
    const failures = [];
    for (const record of await readUnarchivedSessionRecords()) {
      if (record.status !== VIBE64_SESSION_STATUS.ARCHIVED) continue;
      try {
        const session = await sessionRecords.readSessionForRenewal(record.sessionId);
        if (
          toText(session.metadata.renewal_id) &&
          toText(session.metadata.renewed_to)
        ) {
          // Renewal owns a reversible close transaction. Ordinary history
          // reads must neither publish it nor interfere with its rollback.
          continue;
        }
        await archivePublishing.publishSessionArchive(record.sessionId);
        recovered.push(record.sessionId);
      } catch (error) {
        failures.push({
          code: toText(error?.code) || "vibe64_session_archive_recovery_failed",
          error: toText(error?.message) || `Archived session ${record.sessionId} could not be published.`,
          ok: false,
          ...(error?.retryable === true ? { retryable: true } : {}),
          sessionId: record.sessionId
        });
      }
    }
    return { failures, recovered };
  }

  async function sessionRecordsForList(options = {}) {
    const listOptions = normalizeSessionListOptions(options);
    let unarchivedRecords = await readUnarchivedSessionRecords();
    if (sessionListMayIncludeArchived(listOptions)) {
      // Terminal status plus an unpublished closing tree is resumed atomically.
      await recoverSessionArchives();
      unarchivedRecords = unarchivedRecords.filter((record) => (
        record.status !== VIBE64_SESSION_STATUS.ARCHIVED
      ));
    }
    unarchivedRecords = unarchivedRecords.filter(({ status }) => (
      sessionStatusMatchesListOptions(status, listOptions)
    ));
    const creating = await Promise.all(unarchivedRecords.map(async ({ sessionId }) => (
      !await sessionLockIsAbandoned(sessionLockPath(storePaths.paths(sessionId), "create"))
    )));
    unarchivedRecords = unarchivedRecords.filter((_record, index) => !creating[index]);
    const unarchivedSessionIds = new Set(unarchivedRecords.map((record) => record.sessionId));
    const archivedRecords = sessionListMayIncludeArchived(listOptions)
      ? (await archiveRecords.readSessionArchiveRecords())
          .filter((record) => !unarchivedSessionIds.has(record.sessionId))
          .filter((record) => sessionStatusMatchesListOptions(record.status, listOptions))
          .filter((record) => state.admittedLearningScope || !genuineLearningBinding(
            archiveRecords.sessionArchiveSummary(record).metadata?.[LEARNING_SESSION_METADATA],
            record.sessionId
          ))
      : [];
    return {
      archivedRecords,
      unarchivedRecords
    };
  }

  async function listSessions(options = {}) {
    const {
      archivedRecords,
      unarchivedRecords
    } = await sessionRecordsForList(options);
    const sessionIds = [
      ...unarchivedRecords.map((record) => record.sessionId),
      ...archivedRecords.map((record) => record.sessionId)
    ].sort((left, right) => left.localeCompare(right));
    return Promise.all(sessionIds.map((entrySessionId) => sessionRecords.readSession(entrySessionId)));
  }

  async function listSessionSummaries(options = {}) {
    const {
      archivedRecords,
      unarchivedRecords
    } = await sessionRecordsForList(options);
    const unarchivedSummaries = await Promise.all(unarchivedRecords.map((record) => (
      sessionRecords.readSessionSummary(record.sessionId)
    )));
    return [
      ...unarchivedSummaries,
      ...archivedRecords.map(record => {
        const summary = archiveRecords.sessionArchiveSummary(record);
        learningSessionBinding(summary.metadata, state.admittedLearningScope, summary.sessionId);
        return summary;
      })
    ].sort((left, right) => toText(left.sessionId).localeCompare(toText(right.sessionId)));
  }

  /**
   * Summaries (status and metadata, no agent runs or background tasks) of the
   * sessions renewal and session limits consider.
   */
  async function listSessionsForRenewal() {
    const sessions = await Promise.all(
      (await readUnarchivedSessionRecords())
        .filter(({ status }) => [
          VIBE64_SESSION_STATUS.ARCHIVED,
          VIBE64_SESSION_STATUS.ACTIVE,
          VIBE64_SESSION_STATUS.BLOCKED,
          VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING,
          VIBE64_SESSION_STATUS.RENEWAL_PENDING,
          VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
        ].includes(status))
        .map(({ sessionId }) => sessionRecords.readSessionSummaryForRenewalList(sessionId))
    );
    return sessions.filter((session) => (
      [
        VIBE64_SESSION_STATUS.ACTIVE,
        VIBE64_SESSION_STATUS.BLOCKED,
        VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
      ].includes(session.status) ||
      sessionIsUnfinishedRenewalRecord(session)
    ));
  }

  return Object.freeze({
    listSessionSummaries,
    listSessions,
    listSessionsForRenewal,
    recoverSessionArchives
  });
}

export {
  createSessionListing
};
