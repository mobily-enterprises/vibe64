import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";

import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import {
  attemptSessionId,
  failure,
  PREPARATION_BUSY_WAIT_MS,
  preparationFailureSchema,
  uuidPattern,
  validatePreparation
} from "./learnerRecords.js";

/**
 * A learner's exercise preparation: the exclusive preparation barrier and the
 * typed observations an admitted server owner records for the active attempt
 * (begin, start commit, ready, failure). It never creates or inspects projects,
 * sessions or running applications.
 * @param {object} dependencies
 * @param {(paths: object) => Promise<() => Promise<void>>} dependencies.acquire
 * @param {(paths: object) => Promise<object>} dependencies.loadState
 * @param {(paths: object, progress: object) => Promise<object>} dependencies.saveActive
 * @param {(actor: object) => object} dependencies.userPaths
 * @param {(progress: object, options?: object) => Promise<object>} dependencies.verifyActiveLesson
 * @param {(paths: object, progress: object, message: string) => Promise<void>} dependencies.writeProgress
 */
function createLearnerPreparation({
  acquire,
  loadState,
  saveActive,
  userPaths,
  verifyActiveLesson,
  writeProgress
}) {
  /**
   * The admitted server owner holds this across effects. Typed state writes
   * acquire only their short state.lock, so they remain usable inside it.
   * Preparation verifies the teachable lesson first; a close (archive or
   * delete) needs only its identity, so a lesson this Vibe64 can no longer
   * teach can still be closed.
   */
  async function runPreparationExclusive({ actor, attemptId, closing = false }, operation) {
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId) || typeof operation !== "function") {
      throw new Error("Run preparation for the saved attempt with an admitted server operation.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure(
        "This learner has no matching active reservation. Read the current learning state before preparing.",
        "VIBE64_TRAINING_ATTEMPT_MISSING",
        404
      );
    }
    await verifyActiveLesson(before.progress, { admissionOnly: closing === true });
    let release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    for (const deadline = Date.now() + PREPARATION_BUSY_WAIT_MS; !release && Date.now() < deadline;) {
      await new Promise(resolve => setTimeout(resolve, 100));
      release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    }
    if (!release) {
      throw failure(
        "This learner's exercise is being prepared. Retry the same attempt after that operation finishes.",
        "VIBE64_TRAINING_PREPARATION_BUSY",
        409
      );
    }
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure(
          "The active attempt changed. Read the current learning state before preparing.",
          "VIBE64_TRAINING_ATTEMPT_MISSING",
          404
        );
      }
      await verifyActiveLesson(state.progress, { admissionOnly: closing === true });
      return await operation();
    } finally {
      await release();
    }
  }

  /**
   * These typed operations record observations from an admitted server owner.
   * They never create/inspect projects, sessions or running applications.
   */
  async function writePreparation(input, operation, failureInput) {
    const { actor, attemptId, expectedRevision, initialSessionId } = input;
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Update preparation for the saved attempt with its current state revision.");
    }
    if ((operation !== "begin" || initialSessionId !== undefined) && initialSessionId !== attemptSessionId(attemptId)) {
      throw new Error("Observe preparation for the exact server-reserved initial session.");
    }
    const observedFailure = operation === "failure"
      ? structuredClone(validateContent(preparationFailureSchema, failureInput, "Preparation failure")) : null;
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure(
        "This learner has no matching active reservation. Read the current learning state before preparing.",
        "VIBE64_TRAINING_ATTEMPT_MISSING",
        404
      );
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure(
          "The active attempt changed. Read the current learning state before preparing.",
          "VIBE64_TRAINING_ATTEMPT_MISSING",
          404
        );
      }
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      await verifyActiveLesson(state.progress);
      if (!attempt.preparation) {
        throw failure("This lesson has no practice project to prepare.", "VIBE64_TRAINING_EXERCISE_MISSING", 409);
      }
      const sessionId = attemptSessionId(attemptId);
      if (observedFailure) validatePreparation({ phase: "preparing", initialSessionId: sessionId, failure: observedFailure }, attemptId);
      const current = attempt.preparation;
      // The start commit, once recorded, stays with every later phase.
      const start = current.startCommit ? { startCommit: current.startCommit } : {};
      let next;
      if (operation === "begin") {
        next = current.phase === "reserved" ? { phase: "preparing", initialSessionId: sessionId } : current;
      } else if (current.phase === "reserved") {
        throw failure(
          "Begin and save this attempt's exact session identity before project or session effects.",
          "VIBE64_TRAINING_PREPARATION_CONFLICT",
          409
        );
      } else if (operation === "start") {
        // Recorded before the practice session exists; a retry before it
        // exists re-verifies the same exercise and may record again.
        if (current.phase === "ready") {
          throw failure("A prepared lesson keeps the start commit it recorded.", "VIBE64_TRAINING_PREPARATION_CONFLICT", 409);
        }
        next = { ...current, startCommit: input.startCommit };
      } else if (operation === "ready") {
        next = current.phase === "ready" ? current : {
          phase: "ready",
          initialSessionId: sessionId,
          observedAt: new Date().toISOString(),
          ...start
        };
      } else {
        next = { phase: "preparing", initialSessionId: sessionId, failure: observedFailure, ...start };
      }
      if (canonicalJson(current) === canonicalJson(next)) {
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt, active, replayed: true };
      }
      if (expectedRevision !== state.revision) {
        throw failure(
          "Learning preparation changed. Read the current revision before reporting another observation.",
          "VIBE64_TRAINING_STATE_REVISION_CONFLICT",
          409
        );
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. No preparation change was written.");
      }
      validatePreparation(next, attemptId);
      const progress = {
        ...state.progress,
        revision: state.revision + 1,
        attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? { ...attempt, preparation: next } : value)
      };
      await writeProgress(
        paths,
        progress,
        "Preparation save was not confirmed; atomic rename may already have succeeded. Read or retry this same preparation operation before external effects."
      );
      const active = await saveActive(paths, progress);
      return {
        revision: progress.revision,
        attempt: progress.attempts.find(value => value.attemptId === attemptId),
        active,
        replayed: false
      };
    } finally {
      await release();
    }
  }

  async function beginPreparation({ actor, attemptId, expectedRevision, initialSessionId } = {}) {
    return writePreparation({ actor, attemptId, expectedRevision, initialSessionId }, "begin");
  }

  async function recordPreparationReady({ actor, attemptId, initialSessionId, expectedRevision } = {}) {
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision }, "ready");
  }

  async function recordPreparationFailure({ actor, attemptId, initialSessionId, expectedRevision, stage, code, message } = {}) {
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision }, "failure", { stage, code, message });
  }

  /**
   * The verified exercise commit, recorded just before the practice session
   * is created from it.
   */
  async function recordPreparationStart({ actor, attemptId, initialSessionId, expectedRevision, startCommit } = {}) {
    if (typeof startCommit !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(startCommit)) {
      throw new Error("Record the practice session's start commit as an exact Git object ID.");
    }
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision, startCommit }, "start");
  }

  return Object.freeze({
    runPreparationExclusive,
    beginPreparation,
    recordPreparationReady,
    recordPreparationFailure,
    recordPreparationStart
  });
}

export { createLearnerPreparation };
