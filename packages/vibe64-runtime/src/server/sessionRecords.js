import { rm } from "node:fs/promises";
import {
  createConversationOperationLease as createSessionOperationLease,
  beginConversationOperation as beginSessionOperation,
  finishConversationOperation as finishSessionOperation,
  conversationAgentRunEvent
} from "@jskit-ai/assistant-core/server/conversation";
import { normalizeText, vibe64Error } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { writeJsonFile, writeTextFile } from "./sessionFiles.js";
import { sessionLockPath } from "./sessionLocks.js";
import {
  assertNormalSessionIsMutable,
  assertNormalSessionIsReadable,
  assertSafeAgentRunId,
  assertSafeBackgroundTaskId,
  assertValidVibe64SessionId,
  assertVibe64SessionStatus,
  BACKGROUND_TASK_EVENT_LIMIT,
  BACKGROUND_TASK_STATUS,
  HIDDEN_VIBE64_SESSION_STATUSES,
  LEARNING_SESSION_METADATA,
  learningSessionBinding,
  normalizeBackgroundTaskStatus,
  normalizeVibe64AgentRunState,
  OPEN_VIBE64_SESSION_STATUSES,
  RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES,
  SESSION_LABEL_MAX_LENGTH,
  SESSION_LABEL_METADATA,
  unknownSessionError,
  VIBE64_SESSION_STATUS,
  vibe64AgentRunStateIsTerminal
} from "./sessionRecordRules.js";
import {
  agentRunFilePath,
  artifactFilePath,
  backgroundTaskFilePath,
  metadataFilePath,
  readTextIfExists,
  revisionNumber,
  withRevisionMarker
} from "./sessionStoreLayout.js";

/** @typedef {ReturnType<typeof import("./sessionStoreState.js").createSessionStoreState>} SessionStoreState */
/** @typedef {ReturnType<typeof import("./sessionStorePaths.js").createSessionStorePaths>} SessionStorePaths */
/** @typedef {ReturnType<typeof import("./sessionStoreLocks.js").createSessionStoreLocks>} SessionStoreLocks */
/** @typedef {ReturnType<typeof import("./sessionRecordFiles.js").createSessionRecordFiles>} SessionRecordFiles */
/** @typedef {ReturnType<typeof import("./sessionArchiveRecords.js").createSessionArchiveRecords>} SessionArchiveRecords */
/** @typedef {ReturnType<typeof import("./sessionArchiveAccess.js").createSessionArchiveAccess>} SessionArchiveAccess */

/**
 * Reads and changes one session's record under its locks: status, metadata,
 * label, artifacts, agent runs, background tasks, and the session and its
 * summary.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionStoreLocks} dependencies.locks
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 */
function createSessionRecords({ state, storePaths, locks, recordFiles, archiveRecords, archiveAccess }) {
  async function bumpSessionRevision(sessionPaths) {
    const manifest = await recordFiles.readManifestFromPaths(sessionPaths);
    const nextManifest = {
      ...manifest,
      revision: revisionNumber(manifest.revision) + 1,
      updatedAt: state.now().toISOString()
    };
    await writeJsonFile(sessionPaths.manifestPath, nextManifest);
    return nextManifest;
  }

  async function mutateSessionRecord(sessionId, operation, {
    renewal = false
  } = {}) {
    const requestedPaths = storePaths.paths(sessionId);
    const key = requestedPaths.sessionRoot;
    const inheritedContext = state.sessionMutationContext.getStore();
    if (inheritedContext?.key === key && inheritedContext.participant?.active === true) {
      const participant = beginSessionOperation(inheritedContext.lease);
      try {
        return await state.sessionMutationContext.run({
          key,
          lease: inheritedContext.lease,
          participant,
          renewal: renewal || inheritedContext.renewal === true,
          sessionPaths: inheritedContext.sessionPaths
        }, () => operation(inheritedContext.sessionPaths));
      } finally {
        finishSessionOperation(inheritedContext.lease, participant);
      }
    }
    return locks.withQueuedSessionLock(key, requestedPaths, "mutation", {
      timeoutMessage: `Timed out waiting to update Vibe64 session: ${requestedPaths.sessionId}`,
      timeoutCode: "vibe64_session_mutation_lock_timeout"
    }, async () => {
      // Resolve the active tree only after acquiring the stable session lock.
      // A close operation may have detached it while this writer was queued.
      const sessionPaths = await archiveRecords.ensureActiveSessionRoot(requestedPaths.sessionId);
      await recordFiles.assertStoredLearningScope(sessionPaths);
      const lease = createSessionOperationLease();
      const participant = beginSessionOperation(lease);
      let result;
      try {
        result = await state.sessionMutationContext.run({
          key,
          lease,
          participant,
          renewal,
          sessionPaths
        }, () => operation(sessionPaths));
      } finally {
        finishSessionOperation(lease, participant);
        await lease.idle;
      }
      const manifest = await bumpSessionRevision(sessionPaths);
      return withRevisionMarker(result, manifest, sessionPaths.sessionId);
    });
  }

  async function mutateSession(sessionId, operation) {
    const requestedPaths = storePaths.paths(sessionId);
    const inheritedContext = state.sessionMutationContext.getStore();
    if (
      inheritedContext?.key === requestedPaths.sessionRoot &&
      inheritedContext.participant?.active === true &&
      inheritedContext.renewal === true
    ) {
      return mutateSessionRecord(sessionId, operation, {
        renewal: true
      });
    }
    return mutateSessionRecord(sessionId, async (sessionPaths) => {
      assertNormalSessionIsMutable({
        sessionId: sessionPaths.sessionId,
        status: await recordFiles.readStatusFromPaths(sessionPaths)
      });
      return operation(sessionPaths);
    });
  }

  async function mutateSessionForRenewal(sessionId, operation) {
    return mutateSessionRecord(sessionId, operation, {
      renewal: true
    });
  }

  async function runSessionExclusiveRecord(sessionId, operationName, operation, {
    expectedRefusal = false,
    operation: diagnosticOperation = "",
    renewal = false,
    waitMs = 0
  } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Exclusive Vibe64 session work requires an operation.");
    }
    const sessionPaths = await archiveRecords.ensureActiveSessionRoot(sessionId);
    const lockPath = sessionLockPath(sessionPaths, operationName);
    return locks.runReentrantExclusive(lockPath, async () => {
      let blockingOperation = "";
      const release = await locks.acquireStoreSessionLock(sessionPaths, operationName, {
        expectedRefusal,
        onRejected: (ownerOperation) => { blockingOperation = ownerOperation; },
        operation: diagnosticOperation,
        waitMs
      });
      return release ? { release } : {
        rejected: {
          acquired: false,
          blockingOperation,
          value: null
        }
      };
    }, operation, renewal ? null : async () => {
      assertNormalSessionIsMutable({
        sessionId: sessionPaths.sessionId,
        status: await recordFiles.readStatusFromPaths(sessionPaths)
      });
    });
  }

  async function runSessionExclusive(sessionId, operationName, operation, options = {}) {
    return runSessionExclusiveRecord(sessionId, operationName, operation, options);
  }

  async function runSessionExclusiveForRenewal(sessionId, operationName, operation, options = {}) {
    return runSessionExclusiveRecord(sessionId, operationName, operation, {
      ...options,
      renewal: true
    });
  }

  async function writeStatus(sessionId, status) {
    const normalizedStatus = assertVibe64SessionStatus(status);
    if (!OPEN_VIBE64_SESSION_STATUSES.has(normalizedStatus)) await recordFiles.assertSessionNotPinned(sessionId);
    if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
      throw vibe64Error(
        `Renewal session status requires a renewal transition: ${normalizedStatus}`,
        "vibe64_session_renewal_transition_required"
      );
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const currentStatus = await recordFiles.readStatusFromPaths(sessionPaths);
      if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(currentStatus)) {
        throw vibe64Error(
          `Renewal session status requires a renewal transition: ${currentStatus}`,
          "vibe64_session_renewal_transition_required"
        );
      }
      await writeTextFile(sessionPaths.statusPath, `${normalizedStatus}\n`);
    });
  }

  async function readStatus(sessionId) {
    const status = await readStatusForRenewal(sessionId);
    if (HIDDEN_VIBE64_SESSION_STATUSES.has(status)) {
      throw vibe64Error(
        `Vibe64 session is reserved for an in-progress renewal: ${assertValidVibe64SessionId(sessionId)}`,
        "vibe64_session_renewal_private"
      );
    }
    return status;
  }

  async function readStatusForRenewal(sessionId) {
    return archiveAccess.withReadableSessionPathsForRenewal(sessionId, recordFiles.readStatusFromPaths);
  }

  function assertMutableMetadataName(name) {
    if (name === LEARNING_SESSION_METADATA) {
      throw vibe64Error("Learning purpose is immutable; start a separately admitted session.",
        "vibe64_learning_session_binding_immutable");
    }
  }

  async function writeMetadataValue(sessionId, name, value) {
    assertMutableMetadataName(name);
    return mutateSession(sessionId, async (sessionPaths) => {
      await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
    });
  }

  async function writeMetadataValueForRenewal(sessionId, name, value) {
    assertMutableMetadataName(name);
    return mutateSessionForRenewal(sessionId, async (sessionPaths) => {
      await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
    });
  }

  async function writeSessionLabel(sessionId, sessionLabel, { onlyIfUnnamed = false } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const sessionName = typeof sessionLabel === "string" ? sessionLabel.trim() : "";
      if (!sessionName || sessionName.length > SESSION_LABEL_MAX_LENGTH || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(sessionName)) {
        throw vibe64Error("Use a session name between 1 and 120 characters on one line.", "vibe64_session_name_invalid");
      }
      const labelPath = metadataFilePath(sessionPaths, SESSION_LABEL_METADATA);
      if (onlyIfUnnamed) {
        const current = normalizeText(await readTextIfExists(labelPath));
        if (current) return current;
      }
      await writeTextFile(labelPath, `${sessionName}\n`);
      return sessionName;
    });
  }

  async function readMetadataValue(sessionId, name) {
    return archiveAccess.withReadableSessionPaths(sessionId, async (sessionPaths) => {
      return normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)));
    });
  }

  async function deleteMetadataValue(sessionId, name) {
    assertMutableMetadataName(name);
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(metadataFilePath(sessionPaths, name), {
        force: true
      });
    });
  }

  async function deleteMetadataValues(sessionId, names = []) {
    await Promise.all(names.map((name) => deleteMetadataValue(sessionId, name)));
  }

  async function readMetadata(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, recordFiles.readMetadataFromPaths);
  }

  async function readSessionNativeDescriptor(sessionId) {
    if (!state.admittedLearningScope) return readSessionSourceDescriptor(sessionId);
    return archiveAccess.withReadableSessionPaths(sessionId, async (sessionPaths, archiveRecord) => {
      const metadata = await recordFiles.readMetadataFromPaths(sessionPaths);
      const learning = learningSessionBinding(metadata, state.admittedLearningScope, sessionPaths.sessionId);
      const status = await recordFiles.readStatusFromPaths(sessionPaths);
      const source = await recordFiles.readSessionSourceDescriptorFromPaths(sessionPaths);
      return { ...source, sessionRoot: archiveRecord ? "" : source.sessionRoot,
        purpose: "learning", learning, status, archived: Boolean(archiveRecord) || status === VIBE64_SESSION_STATUS.ARCHIVED,
        nativeExecutionRoot: sessionSourcePath(source) };
    });
  }

  async function readSessionSourceDescriptor(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, recordFiles.readSessionSourceDescriptorFromPaths);
  }

  async function writeArtifact(sessionId, relativePath, text) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeTextFile(artifactPath, text);
      return artifactPath;
    });
  }

  async function writeJsonArtifact(sessionId, relativePath, value) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeJsonFile(artifactPath, value);
      return artifactPath;
    });
  }

  async function readArtifact(sessionId, relativePath) {
    return archiveAccess.withReadableSessionPaths(sessionId, (sessionPaths) => {
      return readTextIfExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function readArtifactForRenewal(sessionId, relativePath) {
    return archiveAccess.withReadableSessionPathsForRenewal(sessionId, (sessionPaths) => {
      return readTextIfExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function writeJsonArtifactForRenewal(sessionId, relativePath, value) {
    return mutateSessionForRenewal(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeJsonFile(artifactPath, value);
      return artifactPath;
    });
  }

  async function readAgentRun(sessionId, runId) {
    return archiveAccess.withReadableSessionPaths(sessionId, (sessionPaths) => recordFiles.readAgentRunFromPath(sessionPaths, runId));
  }

  async function readAgentRuns(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, recordFiles.readAgentRunsFromPaths);
  }

  async function writeAgentRunEvent(sessionId, runId, {
    event = {},
    patch = {}
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedRunId = assertSafeAgentRunId(runId);
      const previous = await recordFiles.readAgentRunFromPath(sessionPaths, normalizedRunId) || {
        events: [],
        id: normalizedRunId
      };
      const record = conversationAgentRunEvent(previous, normalizedRunId, { event, patch }, {
        now: state.now,
        normalizeState: normalizeVibe64AgentRunState,
        isTerminal: vibe64AgentRunStateIsTerminal
      });
      await writeJsonFile(agentRunFilePath(sessionPaths, normalizedRunId), record);
      return record;
    });
  }

  async function readBackgroundTask(sessionId, taskId) {
    return archiveAccess.withReadableSessionPaths(sessionId, (sessionPaths) => recordFiles.readBackgroundTaskFromPath(sessionPaths, taskId));
  }

  async function readBackgroundTasks(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, recordFiles.readBackgroundTasksFromPaths);
  }

  async function writeBackgroundTaskEvent(sessionId, taskId, {
    event = {},
    patch = {},
    reset = false,
    shouldWrite = null
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedTaskId = assertSafeBackgroundTaskId(taskId);
      const previous = reset === true
        ? { events: [], id: normalizedTaskId }
        : await recordFiles.readBackgroundTaskFromPath(sessionPaths, normalizedTaskId) || {
            events: [],
            id: normalizedTaskId
          };
      const eventAt = normalizeText(event.at || patch.updatedAt) || state.now().toISOString();
      const status = normalizeBackgroundTaskStatus(patch.status || event.status || previous.status);
      const previousStatus = normalizeText(previous.status);
      const eventRecord = {
        ...event,
        at: eventAt,
        kind: normalizeText(event.kind || status || "updated"),
        message: normalizeText(event.message || patch.message),
        status
      };
      if (typeof shouldWrite === "function" && !shouldWrite({
        event: eventRecord,
        patch,
        previous,
        status
      })) {
        return previous;
      }
      const record = {
        ...previous,
        ...patch,
        events: [
          ...(Array.isArray(previous.events) ? previous.events : []),
          eventRecord
        ].slice(-BACKGROUND_TASK_EVENT_LIMIT),
        finishedAt: status === BACKGROUND_TASK_STATUS.RUNNING
          ? ""
          : normalizeText(patch.finishedAt || previous.finishedAt) || eventAt,
        id: normalizedTaskId,
        kind: Object.hasOwn(patch, "kind")
          ? normalizeText(patch.kind)
          : normalizeText(eventRecord.kind || previous.kind),
        message: Object.hasOwn(patch, "message")
          ? normalizeText(patch.message)
          : Object.hasOwn(event, "message")
            ? normalizeText(event.message)
            : normalizeText(previous.message),
        startedAt: status === BACKGROUND_TASK_STATUS.RUNNING && previousStatus !== BACKGROUND_TASK_STATUS.RUNNING
          ? eventAt
          : normalizeText(patch.startedAt || previous.startedAt) || eventAt,
        status,
        updatedAt: eventAt
      };
      if (status !== BACKGROUND_TASK_STATUS.RUNNING && !Object.hasOwn(patch, "stage")) {
        delete record.stage;
      }
      if (status !== BACKGROUND_TASK_STATUS.FAILED && !Object.hasOwn(patch, "error")) {
        record.error = "";
      }
      await writeJsonFile(backgroundTaskFilePath(sessionPaths, normalizedTaskId), record);
      return record;
    });
  }

  async function readManifest(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, recordFiles.readManifestFromPaths);
  }

  async function readSession(sessionId) {
    return assertNormalSessionIsReadable(await readSessionForRenewal(sessionId));
  }

  async function readSessionForRenewal(sessionId) {
    return archiveAccess.withReadableSessionPathsForRenewal(sessionId, recordFiles.readSessionFromPaths);
  }

  async function readSessionSummary(sessionId) {
    return assertNormalSessionIsReadable(await readSessionSummaryForRenewal(sessionId));
  }

  async function readSessionSummaryForRenewal(sessionId) {
    const activePaths = storePaths.paths(sessionId);
    const unarchivedRead = await archiveAccess.readUnarchivedSessionIfPresent(
      sessionId,
      recordFiles.readSessionSummaryFromPaths
    );
    if (unarchivedRead.found) {
      return unarchivedRead.value;
    }
    const publishedArchive = await archiveRecords.readSessionArchiveRecord(sessionId);
    if (publishedArchive) {
      const summary = archiveRecords.sessionArchiveSummary(publishedArchive);
      learningSessionBinding(summary.metadata, state.admittedLearningScope, summary.sessionId);
      return summary;
    }
    throw unknownSessionError(activePaths.sessionId);
  }

  return Object.freeze({
    deleteMetadataValue,
    deleteMetadataValues,
    mutateSession,
    mutateSessionForRenewal,
    readAgentRun,
    readAgentRuns,
    readArtifact,
    readArtifactForRenewal,
    readBackgroundTask,
    readBackgroundTasks,
    readManifest,
    readMetadata,
    readMetadataValue,
    readSession,
    readSessionForRenewal,
    readSessionNativeDescriptor,
    readSessionSourceDescriptor,
    readSessionSummary,
    readStatus,
    readStatusForRenewal,
    runSessionExclusive,
    runSessionExclusiveForRenewal,
    writeAgentRunEvent,
    writeArtifact,
    writeBackgroundTaskEvent,
    writeJsonArtifact,
    writeJsonArtifactForRenewal,
    writeMetadataValue,
    writeMetadataValueForRenewal,
    writeSessionLabel,
    writeStatus
  });
}

export {
  createSessionRecords
};
