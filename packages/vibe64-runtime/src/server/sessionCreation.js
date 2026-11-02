import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { assertRenewalId } from "./sessionRenewalIds.js";
import { writeJsonFile, writeTextFile } from "./sessionFiles.js";
import {
  assertSafeMetadataName,
  assertValidVibe64SessionId,
  assertVibe64SessionStatus,
  LEARNING_SESSION_METADATA,
  RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES,
  VIBE64_SESSION_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import {
  createAvailableSessionId,
  metadataFilePath,
  removeStaleSessionCreationStages,
  sessionCreationStagingRoot,
  sessionRecordExists,
  toDate
} from "./sessionStoreLayout.js";
import { enqueueSessionMutation, SESSION_MUTATION_LOCK_WAIT_MS } from "./sessionStoreLocks.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionStoreLocks} SessionStoreLocks */
/** @typedef {import("./types.js").SessionRecords} SessionRecords */
/** @typedef {ReturnType<typeof import("./sessionListing.js").createSessionListing>} SessionListing */

/**
 * The created session as it is: creation with nothing to initialize.
 * @param {object} session
 */
function keepCreatedSession(session) {
  return session;
}

/**
 * Creates a session, and a renewal's pending successor.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionStoreLocks} dependencies.locks
 * @param {SessionRecords} dependencies.sessionRecords
 * @param {SessionListing} dependencies.listing
 */
function createSessionCreation({
  state,
  storePaths,
  locks,
  sessionRecords,
  listing
}) {
  async function createSessionRecord({
    metadata = {},
    runtimeKind = "",
    sessionId = "",
    status = VIBE64_SESSION_STATUS.ACTIVE
  }, initialize) {
    if (Object.hasOwn(metadata, LEARNING_SESSION_METADATA)) {
      throw vibe64Error(
        "Learning purpose is supplied only by the authorized runtime constructor, not creation metadata.",
        "vibe64_learning_scope_invalid"
      );
    }
    const normalizedMetadata = Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [assertSafeMetadataName(name), toText(value)])
    );
    const normalizedStatus = assertVibe64SessionStatus(status);
    const rootPaths = storePaths.paths();
    await mkdir(rootPaths.activeSessionsRoot, {
      recursive: true
    });
    const createdAt = state.now().toISOString();
    const resolvedSessionId = sessionId
      ? assertValidVibe64SessionId(sessionId)
      : await createAvailableSessionId(rootPaths, createdAt);
    const sessionPaths = storePaths.paths(resolvedSessionId);
    if (state.admittedLearningScope) {
      normalizedMetadata[LEARNING_SESSION_METADATA] = JSON.stringify({
        schemaVersion: 1,
        ...state.admittedLearningScope,
        conversationId: resolvedSessionId
      });
    }
    const release = await locks.acquireStoreSessionLock(sessionPaths, "create", {
      waitMs: SESSION_MUTATION_LOCK_WAIT_MS
    });
    if (!release) {
      throw vibe64Error(
        `Vibe64 session creation is already in progress: ${resolvedSessionId}`,
        "vibe64_session_busy"
      );
    }
    try {
      const session = await enqueueSessionMutation(sessionPaths.sessionRoot, async () => {
        const stagingRoot = sessionCreationStagingRoot(rootPaths);
        const stagedSessionRoot = path.join(
          stagingRoot,
          `${resolvedSessionId}.${process.pid}.${randomUUID()}`
        );
        const stagedPaths = storePaths.pathsForSessionRoot(resolvedSessionId, stagedSessionRoot);
        let published = false;
        try {
          if (await sessionRecordExists(rootPaths, resolvedSessionId)) {
            throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
          }
          await mkdir(stagedSessionRoot, { recursive: true });
          await Promise.all([
            mkdir(stagedPaths.dropZoneRoot, { recursive: true }),
            mkdir(stagedPaths.agentRunsRoot, {
              recursive: true
            }),
            mkdir(stagedPaths.artifactsRoot, {
              recursive: true
            }),
            mkdir(stagedPaths.backgroundTasksRoot, {
              recursive: true
            }),
            mkdir(stagedPaths.metadataRoot, {
              recursive: true
            })
          ]);
          const normalizedRuntimeKind = toText(runtimeKind);
          const manifest = {
            ...(normalizedRuntimeKind ? { runtimeKind: normalizedRuntimeKind } : {}),
            createdAt,
            product: "vibe64",
            revision: 1,
            schemaVersion: VIBE64_SESSION_SCHEMA_VERSION,
            sessionId: resolvedSessionId,
            updatedAt: createdAt
          };
          await Promise.all([
            writeJsonFile(stagedPaths.manifestPath, manifest),
            writeTextFile(stagedPaths.statusPath, `${normalizedStatus}\n`),
            ...Object.entries(normalizedMetadata).map(([name, value]) => {
              return writeTextFile(metadataFilePath(stagedPaths, name), `${value}\n`);
            })
          ]);
          if (await sessionRecordExists(rootPaths, resolvedSessionId)) {
            throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
          }
          await rename(stagedSessionRoot, sessionPaths.sessionRoot);
          published = true;
          await removeStaleSessionCreationStages(rootPaths, resolvedSessionId).catch(() => null);
          return sessionRecords.readSessionForRenewal(resolvedSessionId);
        } catch (error) {
          if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
            throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
          }
          throw error;
        } finally {
          if (!published) {
            await rm(stagedSessionRoot, {
              force: true,
              recursive: true
            });
          }
        }
      });
      // Source initialization uses ordinary queued metadata mutations. Keep the
      // creation lock, but release the publication queue before invoking it.
      return await initialize(session);
    } finally {
      await release();
    }
  }

  async function createSession(options = {}, initialize = keepCreatedSession) {
    if (typeof initialize !== "function") {
      throw new TypeError("Session initialization must be a function.");
    }
    const status = assertVibe64SessionStatus(options.status);
    if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(status)) {
      throw vibe64Error(
        `Renewal session status requires createRenewalPendingSession: ${status}`,
        "vibe64_session_renewal_transition_required"
      );
    }
    return createSessionRecord({
      ...options,
      status
    }, initialize);
  }

  /**
   * @param {object} request
   * @param {string} [request.actorDisplayName]
   * @param {string} [request.actorId]
   * @param {string} [request.confirmedAt]
   * @param {object} [request.metadata]
   * @param {string} [request.renewalId]
   * @param {string} [request.renewedFrom]
   * @param {string} [request.runtimeKind]
   * @param {string} [request.sessionId]
   * @param {string} [request.startedAt]
   */
  async function createRenewalPendingSession({
    actorDisplayName = "",
    actorId = "",
    confirmedAt = "",
    metadata = {},
    renewalId = "",
    renewedFrom = "",
    runtimeKind = "",
    sessionId = "",
    startedAt = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const sourceSessionId = assertValidVibe64SessionId(renewedFrom);
    const successorSessionId = sessionId ? assertValidVibe64SessionId(sessionId) : "";
    if (successorSessionId && successorSessionId === sourceSessionId) {
      throw vibe64Error(
        "A renewed session must have a different session id from its predecessor.",
        "vibe64_session_renewal_same_session"
      );
    }
    const normalizedActorId = toText(actorId);
    if (!normalizedActorId) {
      throw vibe64Error(
        "A renewed session requires actor attribution.",
        "vibe64_session_renewal_actor_required"
      );
    }
    if (!toText(confirmedAt)) {
      throw vibe64Error(
        "A renewed session requires the confirmation timestamp.",
        "vibe64_session_renewal_confirmation_required"
      );
    }
    const normalizedConfirmedAt = toDate(confirmedAt).toISOString();
    const normalizedStartedAt = startedAt ? toDate(startedAt).toISOString() : "";
    return locks.runRenewalTransitionExclusive(async () => {
      const sourceSession = await sessionRecords.readSessionForRenewal(sourceSessionId);
      if (
        sourceSession.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        toText(sourceSession.metadata.renewal_quiesced_id) !== normalizedRenewalId
      ) {
        throw vibe64Error(
          `A renewed session can only be prepared from its quiesced predecessor: ${sourceSessionId}`,
          sourceSession.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
            ? "vibe64_session_renewal_conflict"
            : "vibe64_session_renewal_source_not_quiesced"
        );
      }
      const renewalRecords = await listing.listSessionsForRenewal();
      const foreignOwner = renewalRecords.find((session) => (
        session.sessionId !== sourceSessionId &&
        toText(session.metadata.renewal_quiesced_id) === normalizedRenewalId
      ));
      if (foreignOwner) {
        throw vibe64Error(
          `Renewal ${normalizedRenewalId} belongs to another predecessor.`,
          "vibe64_session_renewal_conflict"
        );
      }
      const existingSuccessor = renewalRecords.find((session) => (
        session.sessionId !== sourceSessionId &&
        (
          toText(session.metadata.renewal_id) === normalizedRenewalId ||
          toText(session.metadata.renewed_from) === sourceSessionId
        )
      ));
      if (existingSuccessor) {
        const exactRetry =
          existingSuccessor.status === VIBE64_SESSION_STATUS.RENEWAL_PENDING &&
          toText(existingSuccessor.metadata.renewal_id) === normalizedRenewalId &&
          toText(existingSuccessor.metadata.renewed_from) === sourceSessionId &&
          toText(existingSuccessor.metadata.renewal_actor_id) === normalizedActorId &&
          toText(existingSuccessor.metadata.renewal_actor_display_name) === toText(actorDisplayName) &&
          toText(existingSuccessor.metadata.renewal_confirmed_at) === normalizedConfirmedAt &&
          (
            !normalizedStartedAt ||
            toText(existingSuccessor.metadata.renewal_started_at) === normalizedStartedAt
          ) &&
          (!successorSessionId || existingSuccessor.sessionId === successorSessionId);
        if (exactRetry) {
          return existingSuccessor;
        }
        throw vibe64Error(
          `Another renewal is already prepared for session ${sourceSessionId}.`,
          "vibe64_session_renewal_conflict"
        );
      }
      const successorCreatedAt = state.now().toISOString();
      return createSessionRecord({
        metadata: {
          ...(isPlainObject(metadata) ? metadata : {}),
          renewal_actor_display_name: toText(actorDisplayName),
          renewal_actor_id: normalizedActorId,
          renewal_confirmed_at: normalizedConfirmedAt,
          renewal_id: normalizedRenewalId,
          renewal_started_at: normalizedStartedAt || successorCreatedAt,
          renewal_successor_created_at: successorCreatedAt,
          renewed_from: sourceSessionId
        },
        runtimeKind,
        sessionId: successorSessionId,
        status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
      }, keepCreatedSession);
    });
  }

  return Object.freeze({
    createRenewalPendingSession,
    createSession
  });
}

export {
  createSessionCreation
};
