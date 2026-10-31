import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { practiceSlug } from "@local/vibe64-core/server/learningSpace";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

import { LEARNER_NOTES_MAX_CHARS as MAX_NOTES_CHARS, TRAINING_LESSON_IN_PROGRESS_CODE } from "../shared/learnerContract.js";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import { createInstalledTrainingContent, pinnedLessonKey } from "./installedContent.js";
import { availableStepIds } from "./lessonAvailability.js";

import {
  activeSchema,
  attemptSessionId,
  byteSize,
  deriveActive,
  emptyActiveSchema,
  END_REASONS,
  failure,
  inspectDirectoryChain,
  inspectPath,
  learnerIdentity,
  lessonCompletion,
  lessonSteps,
  MAX_ATTEMPTS,
  MAX_COMPLETED_LESSONS,
  MAX_RECORD_BYTES,
  MAX_REQUEST_IDS,
  MAX_STEP_RESULTS,
  PREPARATION_BUSY_WAIT_MS,
  preparationFailureSchema,
  readRecord,
  requestPattern,
  STEP_LOCK_WAIT_MS,
  stepReceiptSchema,
  stepResultSchema,
  uuidPattern,
  validateLessonStepResults,
  validatePin,
  validatePreparation,
  validateProgress,
  validateStepEntry
} from "./learnerRecords.js";
import { createLearnerNotes } from "./learnerNotes.js";
import { createLearnerMode } from "./learnerMode.js";
import { createLearnerCodeLedgers } from "./learnerCodeLedgers.js";
import { createLearnerReviews } from "./learnerReviews.js";
import { createLearnerSteps } from "./learnerSteps.js";

/** @typedef {ReturnType<typeof import("./installedContent.js").createInstalledTrainingContent>} InstalledTrainingContent */

/**
 * Callers derive actor from fresh authentication and admit a new start against
 * the course lock. This internal store neither authenticates objects nor owns
 * release enablement, project effects, grading or arbitrary state patches.
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {string} [dependencies.contentSystemRoot]
 * @param {InstalledTrainingContent} dependencies.content
 */
function createTrainingLearnerState({ systemRoot, contentSystemRoot = systemRoot, content }) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) !== systemRoot || systemRoot === path.parse(systemRoot).root) {
    throw new Error("Learning state needs a canonical absolute, non-root server-owned system root.");
  }
  // Offline restore reads staged state against the live exact-pin installation.
  // An isolated author-preview store uses the same writer and its exact reader.
  const installed = content === undefined ? createInstalledTrainingContent({ systemRoot: contentSystemRoot }) : content;
  // readable-check: allow method-probe - test asserts error: content without readLesson() is refused at construction
  if (typeof installed?.readLesson !== "function") {
    throw new TypeError("Learning state requires the configured installed-content reader.");
  }

  const notes = createLearnerNotes({ acquireRecordLock, createNamespace, systemRoot, userPaths });
  const learningMode = createLearnerMode({ createNamespace, loadState, userPaths, verifyInstalled });
  const codeLedgers = createLearnerCodeLedgers({ activeAttemptForProject, createNamespace, loadState, userPaths });
  const reviews = createLearnerReviews({ createNamespace, userPaths });
  const steps = createLearnerSteps({ acquireRecordLock, loadState, userPaths, verifyActiveLesson, verifyInstalled });

  function userPaths(actor) {
    const learner = learnerIdentity(actor);
    const trainingRoot = path.join(systemRoot, "training");
    const usersRoot = path.join(trainingRoot, "users");
    const userRoot = path.join(usersRoot, learner.key);
    return {
      learner,
      directories: [trainingRoot, usersRoot, userRoot],
      userRoot,
      progress: path.join(userRoot, "progress.json"),
      active: path.join(userRoot, "active-lesson.json"),
      mode: path.join(userRoot, "learning-mode.json"),
      lock: path.join(userRoot, "state.lock"),
      preparationLock: path.join(userRoot, "preparation.lock"),
      codeLedgers: path.join(userRoot, "code-ledgers"),
      codeLedgerLock: path.join(userRoot, "code-ledger.lock"),
      stepProgress: path.join(userRoot, "step-progress.json"),
      stepProgressLock: path.join(userRoot, "step-progress.lock"),
      reader: path.join(userRoot, "reader.json"),
      readerLock: path.join(userRoot, "reader.lock"),
      notes: path.join(userRoot, "teacher-notes.json"),
      notesLock: path.join(userRoot, "teacher-notes.lock"),
      reviewHelper: path.join(userRoot, "review-helper.json"),
      reviewHelpers: path.join(userRoot, "review-helpers"),
      reviewLock: path.join(userRoot, "review.lock")
    };
  }

  async function readProgress(paths) {
    const value = await readRecord(paths.progress);
    if (!value) return { schemaVersion: 2, learnerId: paths.learner.id, revision: 0, activeAttemptId: null, completedLessons: [], attempts: [] };
    return validateProgress(value, paths.learner.id);
  }

  async function loadState(paths) {
    try {
      await inspectDirectoryChain(systemRoot);
      for (const directory of paths.directories) await inspectPath(directory, true);
      for (const lockPath of [paths.lock, paths.preparationLock]) {
        const lock = await inspectPath(lockPath, false);
        if (lock && lock.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
      }
      let progress = await readProgress(paths);
      const savedActive = await readRecord(paths.active);
      if (savedActive) {
        const isEmpty = savedActive.attemptId === null;
        const active = validateContent(isEmpty ? emptyActiveSchema : activeSchema, savedActive, "Active learner reservation");
        if (active.learnerId !== paths.learner.id) throw new Error("Active summary belongs to another learner.");
        // Progress is saved before its derived summary. Re-read once if a read
        // straddles those publications; never repair from a read.
        if (active.progressRevision > progress.revision) progress = await readProgress(paths);
        if (isEmpty) {
          if (!progress.attempts.some(attempt => attempt.ended?.revision === active.progressRevision)) {
            throw new Error("An empty active summary must describe an actual retained end revision.");
          }
        } else {
          validatePin(active.pin);
          if (active.preparation) validatePreparation(active.preparation, active.attemptId);
          const attemptIndex = progress.attempts.findIndex(attempt => attempt.attemptId === active.attemptId);
          const retained = progress.attempts[attemptIndex];
          const previousEndRevision = progress.attempts[attemptIndex - 1]?.ended?.revision || 0;
          const expectedRevision = retained?.ended ? retained.ended.revision - 1 : progress.revision;
          const expected = retained && deriveActive({ ...progress, activeAttemptId: retained.attemptId, revision: expectedRevision });
          if (previousEndRevision && active.progressRevision <= previousEndRevision) throw new Error("Active summary predates this attempt's reservation.");
          let preparation = active.preparation;
          if (preparation && expected?.preparation && active.progressRevision < expectedRevision) {
            const previous = active.preparation;
            const current = expected.preparation;
            const revisionDistance = expectedRevision - active.progressRevision;
            // A phase-changing progress write can precede its derived summary.
            // Accept only reachable older preparation with the same reserved ID.
            let predecessor = false;
            if (current.phase !== "reserved") {
              if (previous.phase === "reserved") {
                const minimumDistance = current.phase === "ready" || current.failure ? 2 : 1;
                predecessor = revisionDistance >= minimumDistance;
              } else if (previous.initialSessionId === current.initialSessionId) {
                if (current.phase === "ready") {
                  // Observation times can move backward with the wall clock.
                  // Changed ready observations require an intervening failure write.
                  predecessor = previous.phase !== "ready" ||
                    previous.observedAt === current.observedAt || revisionDistance >= 2;
                } else if (current.failure) {
                  predecessor = true;
                } else {
                  predecessor = previous.phase === "preparing" && !previous.failure;
                }
              }
            }
            if (predecessor) preparation = current;
          }
          const projected = { ...active, progressRevision: expectedRevision, ...(preparation ? { preparation } : {}) };
          if (!expected || active.progressRevision > expectedRevision ||
              canonicalJson(projected) !== canonicalJson(expected)) {
            throw new Error("Active summary conflicts with durable progress; inspect a consistent backup before recovery.");
          }
        }
      }
      const active = deriveActive(progress);
      return {
        revision: progress.revision,
        progress,
        active,
        activeSummaryCurrent: canonicalJson(savedActive) === canonicalJson(active || (progress.revision ? {
          schemaVersion: 1, learnerId: progress.learnerId, progressRevision: progress.revision, attemptId: null
        } : null))
      };
    } catch (cause) {
      throw failure(
        "VIBE64_TRAINING_STATE_INVALID",
        `Learning state is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`,
        null,
        { cause }
      );
    }
  }

  // Preserve existing state/permissions. Create only this explicit operation's
  // private namespace.
  async function createNamespace(paths) {
    if (!await inspectDirectoryChain(systemRoot)) {
      throw new Error("Prepare the server-owned system root before reserving a lesson.");
    }
    for (const directory of paths.directories) {
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      await inspectPath(directory, true);
    }
  }

  async function acquire(paths) {
    // The persistent lock serializes cooperating writers.
    await createNamespace(paths);
    const release = await tryAcquireExclusiveFileLock(paths.lock);
    if (!release) {
      throw failure("VIBE64_TRAINING_STATE_BUSY", "Learning state is being updated. Retry the same request after that operation finishes.", 409);
    }
    return release;
  }

  async function verifyInstalled(pin, { admissionOnly = false } = {}) {
    // readable-check: allow method-probe - optional operation: content without admission reads is verified by its whole lesson read
    const read = admissionOnly && typeof installed.readAdmissionIdentity === "function"
      ? installed.readAdmissionIdentity : installed.readLesson;
    const lesson = await read.call(installed, pinnedLessonKey(pin));
    if (canonicalJson(lesson.pin) !== canonicalJson(pin.topic)) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
    return lesson;
  }

  // Learner operations act on the lesson in progress only, so only its pin is
  // verified: an ended attempt's lesson, which a later Vibe64 may no longer
  // teach, never blocks it. Teaching, step results and finishing need the
  // lesson teachable; closing it (archive, delete) needs only its identity.
  async function verifyActiveLesson(progress, { admissionOnly = false } = {}) {
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    if (!attempt) return null;
    const lesson = await verifyInstalled(attempt.pin, { admissionOnly });
    if (Boolean(lesson.lesson.exercise) !== Boolean(attempt.preparation)) {
      throw new Error("An attempt names a practice project exactly when its lesson declares an exercise.");
    }
    return lesson;
  }

  async function saveActive(paths, progress) {
    const active = deriveActive(progress);
    try {
      const summary = active || { schemaVersion: 1, learnerId: progress.learnerId, progressRevision: progress.revision, attemptId: null };
      await writeJsonFileAtomic(paths.active, summary, { directoryMode: 0o700, fileMode: 0o600 });
    } catch (cause) {
      const error = failure(
        "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED",
        active ? "The reservation is saved, but its active summary save was not confirmed. Retry the same request or resume before provisioning."
          : "The attempt end is saved, but its empty active summary save was not confirmed. Read or retry the same end request; no project disposal was claimed.",
        null,
        { reservationSaved: Boolean(active), ...(active ? {} : { attemptEndSaved: true }), revision: progress.revision, attemptId: progress.activeAttemptId }
      );
      error.cause = cause;
      throw error;
    }
    return active;
  }

  async function writeProgress(paths, progress, message) {
    validateProgress(progress, paths.learner.id);
    try {
      await writeJsonFileAtomic(paths.progress, progress, { directoryMode: 0o700, fileMode: 0o600 });
    } catch (cause) {
      throw failure("VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", message, null, { cause });
    }
  }

  // completion is the in-progress attempt's; lessonCompletions lists every
  // completed lesson content and the one in progress. A completed lesson that
  // is not in progress reports no step counts (its results went with its attempt).
  async function readState({ actor, includeCompletion = false } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    if (includeCompletion !== true) return state;
    const lesson = await verifyActiveLesson(state.progress);
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    const completion = attempt
      ? lessonCompletion(lesson, await steps.readAttemptSteps(paths, attempt, lesson), availableStepIds(lesson, actor)) : null;
    const completed = new Set(state.progress.completedLessons.map(lesson => canonicalJson({ code: lesson.code, hash: lesson.hash })));
    const lessonCompletions = state.progress.completedLessons.map(lesson => ({ lessonCode: lesson.code, lessonHash: lesson.hash,
      required: 0, passed: 0, completed: true, open: false }));
    if (completion) {
      const open = { ...completion, completed: completion.completed || completed.has(canonicalJson(attempt.pin.lesson)), open: true };
      const index = lessonCompletions.findIndex(value => value.lessonCode === open.lessonCode && value.lessonHash === open.lessonHash);
      if (index < 0) lessonCompletions.push(open);
      else lessonCompletions[index] = open;
    }
    return { ...state, completion, lessonCompletions };
  }

  // The in-progress attempt with this ID when it has a practice project, else
  // null. Code saves and host store selection resolve their attempt here.
  async function activeAttemptForProject({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    const { progress } = await loadState(paths);
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    return attempt?.attemptId === attemptId && attempt.projectSlug ? structuredClone(attempt) : null;
  }

  // One lesson is in progress at a time. The same request ID replays its
  // reservation; the same lesson pin returns the attempt in progress; another
  // lesson in progress is refused with its identity, so the caller can offer to
  // archive it first. At the attempt cap (or the record's byte bound) the oldest
  // ended attempts are pruned; completion stays in completedLessons.
  async function reserveAttempt({ actor, requestId, expectedRevision, pin: inputPin } = {}) {
    const paths = userPaths(actor);
    if (typeof requestId !== "string" || !requestPattern.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Reserve with a bounded stable request ID and the revision returned by readState.");
    }
    const pin = validatePin(inputPin);
    await loadState(paths);
    const lesson = await verifyInstalled(pin);
    if (!lessonSteps(lesson)) {
      throw failure("VIBE64_TRAINING_LESSON_VERSION", "This lesson uses an earlier format that can no longer be started.", 409);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.attempts.some(attempt => attempt.ended?.requestId === requestId)) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already ended an attempt; use its original end operation.", 409);
      }
      const replay = state.progress.attempts.find(attempt => attempt.requestIds.includes(requestId));
      if (replay) {
        if (canonicalJson(replay.pin) !== canonicalJson(pin)) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already reserved another exact lesson pin. Resume its saved attempt.", 409);
        }
        await verifyInstalled(replay.pin);
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt: replay, active, replayed: true };
      }
      let attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      if (attempt && canonicalJson(attempt.pin) !== canonicalJson(pin)) {
        const current = await verifyInstalled(attempt.pin).catch(() => null);
        throw failure(TRAINING_LESSON_IN_PROGRESS_CODE, "Another lesson is in progress. Archive it before starting this one.", 409,
          { details: { attemptId: attempt.attemptId, lessonCode: attempt.pin.lesson.code, lessonTitle: current?.lesson?.title || attempt.pin.lesson.code } });
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read the current revision and resume or retry the same request.", 409);
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. Resume the saved attempt; no new reservation was written.");
      }
      let attempts = state.progress.attempts;
      if (attempt) {
        if (attempt.requestIds.length >= MAX_REQUEST_IDS) {
          throw new Error("This attempt reached its 64 distinct reservation-request limit. Resume the saved attempt; no retry identity was removed.");
        }
        attempt = { ...attempt, requestIds: [...attempt.requestIds, requestId] };
        attempts = attempts.map(value => value.attemptId === attempt.attemptId ? attempt : value);
      } else {
        const attemptId = randomUUID();
        attempt = { attemptId, requestIds: [requestId], createdAt: new Date().toISOString(), pin,
          ...(lesson.lesson.exercise ? { projectSlug: practiceSlug(attemptId), preparation: { phase: "reserved" } } : {}) };
        attempts = [...attempts, attempt];
      }
      let progress = { ...state.progress, revision: state.revision + 1, activeAttemptId: attempt.attemptId, attempts };
      // Every attempt but the new last one has ended here.
      while (progress.attempts.length > MAX_ATTEMPTS || progress.attempts.length > 1 && byteSize(progress) > MAX_RECORD_BYTES) {
        progress = { ...progress, attempts: progress.attempts.slice(1) };
      }
      await verifyInstalled(pin);
      await writeProgress(paths, progress, "Reservation save was not confirmed. Retry the same request ID before provisioning; the atomic rename may already have saved it.");
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt, active, replayed: false };
    } finally {
      await release();
    }
  }

  // Finishing (finished), archiving (archived, also by restart) and deleting
  // (deleted) end the attempt in progress. Finished requires every required
  // step passed and records the lesson content in completedLessons. Its step
  // results and code ledger then go: the archive bundle already copied what it
  // keeps (readAttemptRecord). The admitted host runs this inside
  // runPreparationExclusive; no project or session effect happens here.
  async function endAttempt({ actor, attemptId, requestId, expectedRevision, reason } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !requestPattern.test(requestId || "") ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !END_REASONS.includes(reason)) {
      throw new Error("End the exact saved attempt with a stable request ID, current revision and an explicit finished, archived or deleted reason.");
    }
    await loadState(paths);
    const release = await acquire(paths);
    let ended;
    try {
      const state = await loadState(paths);
      const replay = state.progress.attempts.find(value => value.ended?.requestId === requestId);
      if (replay) {
        if (replay.attemptId !== attemptId || replay.ended.reason !== reason) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This end request already retired a different attempt or reason.", 409);
        }
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        ended = { revision: state.revision, attempt: replay, active, replayed: true };
      } else {
        if (state.progress.attempts.some(value => value.requestIds.includes(requestId))) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already reserved an attempt; use a distinct stable end request.", 409);
        }
        if (state.progress.activeAttemptId !== attemptId) {
          throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Only this learner's exact lesson in progress can be ended; retained history is not reactivated.", 404);
        }
        if (expectedRevision !== state.revision) {
          throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read it before ending the same attempt.", 409);
        }
        if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("Learning state reached its revision limit. No attempt was ended.");
        const lesson = await verifyActiveLesson(state.progress, { admissionOnly: reason !== "finished" });
        const previous = state.progress.attempts.find(value => value.attemptId === attemptId);
        let { completedLessons } = state.progress;
        if (reason === "finished") {
          if (!lessonCompletion(lesson, await steps.readAttemptSteps(paths, previous, lesson), availableStepIds(lesson, actor)).completed) {
            throw failure("VIBE64_TRAINING_LESSON_INCOMPLETE", "Pass every required step before finishing this lesson.", 409);
          }
          const key = canonicalJson(previous.pin.lesson);
          if (!completedLessons.some(value => canonicalJson({ code: value.code, hash: value.hash }) === key)) {
            // The bound keeps the record small; the oldest completion leaves first.
            completedLessons = [...completedLessons, { ...previous.pin.lesson, completedAt: new Date().toISOString() }].slice(-MAX_COMPLETED_LESSONS);
          }
        }
        const attempt = { ...previous, ended: { requestId, revision: state.revision + 1, reason } };
        const progress = { ...state.progress, revision: state.revision + 1, activeAttemptId: null, completedLessons,
          attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? attempt : value) };
        await writeProgress(paths, progress, "Attempt end save was not confirmed; atomic rename may have succeeded. Read or retry this exact end request before a new reservation.");
        const active = await saveActive(paths, progress);
        ended = { revision: progress.revision, attempt, active, replayed: false };
      }
    } finally {
      await release();
    }
    // Disposable once the end is saved; a retry of the same end forgets them again.
    await forgetAttemptRecords(paths, attemptId).catch(() => {});
    return ended;
  }

  async function forgetAttemptRecords(paths, attemptId) {
    await codeLedgers.withLedgerLock(paths, async () => {
      const filename = codeLedgers.ledgerPath(paths, attemptId);
      await inspectPath(filename, false);
      await rm(filename, { force: true });
    });
    const release = await acquireRecordLock(paths.stepProgressLock, "VIBE64_TRAINING_STEP_PROGRESS_BUSY", "Step results are being saved.");
    try {
      if ((await steps.readStepProgressRecord(paths))?.attemptId === attemptId) await rm(paths.stepProgress, { force: true });
    } finally {
      await release();
    }
  }

  async function resumeAttempt({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId)) {
      throw new Error("Resume the saved active attempt ID returned by readState.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching active reservation. Read the current learning state before resuming.", 404);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The active attempt changed. Read the current learning state before resuming.", 404);
      }
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      const lesson = await verifyActiveLesson(state.progress);
      const completion = lessonCompletion(lesson, await steps.readAttemptSteps(paths, attempt, lesson), availableStepIds(lesson, actor));
      const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
      return { revision: state.revision, attempt, active, completion };
    } finally {
      await release();
    }
  }

  // The admitted server owner holds this across effects. Typed state writes
  // acquire only their short state.lock, so they remain usable inside it.
  // Preparation verifies the teachable lesson first; a close (archive or
  // delete) needs only its identity, so a lesson this Vibe64 can no longer
  // teach can still be closed.
  async function runPreparationExclusive({ actor, attemptId, closing = false } = {}, operation) {
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId) || typeof operation !== "function") {
      throw new Error("Run preparation for the saved attempt with an admitted server operation.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching active reservation. Read the current learning state before preparing.", 404);
    }
    await verifyActiveLesson(before.progress, { admissionOnly: closing === true });
    let release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    for (const deadline = Date.now() + PREPARATION_BUSY_WAIT_MS; !release && Date.now() < deadline;) {
      await new Promise(resolve => setTimeout(resolve, 100));
      release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    }
    if (!release) {
      throw failure("VIBE64_TRAINING_PREPARATION_BUSY", "This learner's exercise is being prepared. Retry the same attempt after that operation finishes.", 409);
    }
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The active attempt changed. Read the current learning state before preparing.", 404);
      }
      await verifyActiveLesson(state.progress, { admissionOnly: closing === true });
      return await operation();
    } finally {
      await release();
    }
  }

  // These typed operations record observations from an admitted server owner.
  // They never create/inspect projects, sessions or running applications.
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
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching active reservation. Read the current learning state before preparing.", 404);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The active attempt changed. Read the current learning state before preparing.", 404);
      }
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      await verifyActiveLesson(state.progress);
      if (!attempt.preparation) {
        throw failure("VIBE64_TRAINING_EXERCISE_MISSING", "This lesson has no practice project to prepare.", 409);
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
        throw failure("VIBE64_TRAINING_PREPARATION_CONFLICT", "Begin and save this attempt's exact session identity before project or session effects.", 409);
      } else if (operation === "start") {
        // Recorded before the practice session exists; a retry before it
        // exists re-verifies the same exercise and may record again.
        if (current.phase === "ready") {
          throw failure("VIBE64_TRAINING_PREPARATION_CONFLICT", "A prepared lesson keeps the start commit it recorded.", 409);
        }
        next = { ...current, startCommit: input.startCommit };
      } else if (operation === "ready") {
        next = current.phase === "ready" ? current : { phase: "ready", initialSessionId: sessionId, observedAt: new Date().toISOString(), ...start };
      } else {
        next = { phase: "preparing", initialSessionId: sessionId, failure: observedFailure, ...start };
      }
      if (canonicalJson(current) === canonicalJson(next)) {
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt, active, replayed: true };
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning preparation changed. Read the current revision before reporting another observation.", 409);
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
      await writeProgress(paths, progress, "Preparation save was not confirmed; atomic rename may already have succeeded. Read or retry this same preparation operation before external effects.");
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt: progress.attempts.find(value => value.attemptId === attemptId), active, replayed: false };
    } finally {
      await release();
    }
  }

  // Step progress and the reader position use their own short locks so they
  // never contend with progress.json writers or the preparation barrier.
  async function acquireRecordLock(lockPath, code, message) {
    const existing = await inspectPath(lockPath, false);
    if (existing && existing.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
    let release = await tryAcquireExclusiveFileLock(lockPath);
    for (const deadline = Date.now() + STEP_LOCK_WAIT_MS; !release && Date.now() < deadline;) {
      await new Promise(resolve => setTimeout(resolve, 50));
      release = await tryAcquireExclusiveFileLock(lockPath);
    }
    if (!release) throw failure(code, message, 409);
    return release;
  }

  // What an archive bundle keeps of the attempt in progress: its record, its
  // step results and its lesson's title. Archiving needs only the lesson's
  // identity, so a lesson this Vibe64 can no longer teach is still archived.
  async function readAttemptRecord({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin, { admissionOnly: true });
    const { revision: _revision, ...stepProgress } = await steps.readAttemptSteps(paths, attempt, lesson);
    return { attempt: structuredClone(attempt), stepProgress: structuredClone(stepProgress),
      lessonTitle: String(lesson.lesson?.title || "") || attempt.pin.lesson.code };
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

  // The verified exercise commit, recorded just before the practice session
  // is created from it.
  async function recordPreparationStart({ actor, attemptId, initialSessionId, expectedRevision, startCommit } = {}) {
    if (typeof startCommit !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(startCommit)) {
      throw new Error("Record the practice session's start commit as an exact Git object ID.");
    }
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision, startCommit }, "start");
  }

  return { readState, activeAttemptForProject, readAttemptRecord, reserveAttempt, endAttempt, resumeAttempt, runPreparationExclusive,
    beginPreparation, recordPreparationReady, recordPreparationFailure, recordPreparationStart, runReviewExclusive: reviews.runReviewExclusive,
    readCodeLedger: codeLedgers.readCodeLedger, updateCodeLedger: codeLedgers.updateCodeLedger, readStepProgress: steps.readStepProgress, updateStepProgress: steps.updateStepProgress, readReader: steps.readReader, saveReader: steps.saveReader,
    // readable-check: allow setter-seam - not a slot: setLearningMode saves one learner's Learn mode
    readTeacherNotes: notes.readTeacherNotes, saveTeacherNotes: notes.saveTeacherNotes, readLearningMode: learningMode.readLearningMode, setLearningMode: learningMode.setLearningMode };
}

export {
  createTrainingLearnerState, failure, inspectDirectoryChain, inspectPath, learnerIdentity, lessonSteps, MAX_NOTES_CHARS, MAX_STEP_RESULTS,
  readRecord, stepReceiptSchema, stepResultSchema, validatePin, validateLessonStepResults, validateStepEntry
};
