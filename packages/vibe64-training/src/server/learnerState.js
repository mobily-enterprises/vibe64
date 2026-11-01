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
  acquireRecordLock,
  activeSchema,
  assertLearningSystemRoot,
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
  readRecord,
  requestPattern,
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
import { createLearnerPreparation } from "./learnerPreparation.js";

/** @typedef {import("./types.js").InstalledTrainingContent} InstalledTrainingContent */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Callers derive actor from fresh authentication and admit a new start against
 * the course lock. This internal store neither authenticates objects nor owns
 * release enablement, project effects, grading or arbitrary state patches.
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {string} [dependencies.contentSystemRoot] where the installed content is read; an offline restore reads
 * staged state against the live installation
 * @param {InstalledTrainingContent} [dependencies.content] an isolated author-preview store's own exact reader
 * @param {RuntimeLogger} dependencies.logger
 */
function createTrainingLearnerState({
  systemRoot,
  contentSystemRoot = systemRoot,
  content,
  logger
}) {
  assertLearningSystemRoot(systemRoot);
  const installed = content ?? createInstalledTrainingContent({ systemRoot: contentSystemRoot });

  const notes = createLearnerNotes({
    acquireRecordLock,
    createNamespace,
    systemRoot,
    userPaths
  });
  const learningMode = createLearnerMode({
    createNamespace,
    loadState,
    userPaths,
    verifyInstalled
  });
  const codeLedgers = createLearnerCodeLedgers({
    activeAttemptForProject,
    createNamespace,
    loadState,
    userPaths
  });
  const reviews = createLearnerReviews({ createNamespace, userPaths });
  const steps = createLearnerSteps({
    acquireRecordLock,
    loadState,
    userPaths,
    verifyActiveLesson,
    verifyInstalled
  });
  const preparation = createLearnerPreparation({
    acquire,
    loadState,
    saveActive,
    userPaths,
    verifyActiveLesson,
    writeProgress
  });

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
    if (!value) return {
      schemaVersion: 2,
      learnerId: paths.learner.id,
      revision: 0,
      activeAttemptId: null,
      completedLessons: [],
      attempts: []
    };
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
          if (previousEndRevision && active.progressRevision <= previousEndRevision) {
            throw new Error("Active summary predates this attempt's reservation.");
          }
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
          schemaVersion: 1,
          learnerId: progress.learnerId,
          progressRevision: progress.revision,
          attemptId: null
        } : null))
      };
    } catch (cause) {
      throw failure(
        `Learning state is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`,
        "VIBE64_TRAINING_STATE_INVALID",
        null,
        { cause }
      );
    }
  }

  /**
   * Preserve existing state/permissions. Create only this explicit operation's
   * private namespace.
   */
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
      throw failure(
        "Learning state is being updated. Retry the same request after that operation finishes.",
        "VIBE64_TRAINING_STATE_BUSY",
        409
      );
    }
    return release;
  }

  async function verifyInstalled(pin, options = {}) {
    const { admissionOnly = false } = options;
    // readable-check: allow method-probe - optional operation: content without admission reads is verified by its whole lesson read
    const read = admissionOnly && typeof installed.readAdmissionIdentity === "function"
      ? installed.readAdmissionIdentity : installed.readLesson;
    const lesson = await read.call(installed, pinnedLessonKey(pin));
    if (canonicalJson(lesson.pin) !== canonicalJson(pin.topic)) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
    return lesson;
  }

  /**
   * Learner operations act on the lesson in progress only, so only its pin is
   * verified: an ended attempt's lesson, which a later Vibe64 may no longer
   * teach, never blocks it. Teaching, step results and finishing need the
   * lesson teachable; closing it (archive, delete) needs only its identity.
   */
  async function verifyActiveLesson(progress, options = {}) {
    const { admissionOnly = false } = options;
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
        active ? "The reservation is saved, but its active summary save was not confirmed. Retry the same request or resume before provisioning."
          : "The attempt end is saved, but its empty active summary save was not confirmed. Read or retry the same end request; no project disposal was claimed.",
        "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED",
        null,
        {
          reservationSaved: Boolean(active),
          ...(active ? {} : { attemptEndSaved: true }),
          revision: progress.revision,
          attemptId: progress.activeAttemptId
        }
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
      throw failure(message, "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", null, { cause });
    }
  }

  /**
   * completion is the in-progress attempt's; lessonCompletions lists every
   * completed lesson content and the one in progress. A completed lesson that
   * is not in progress reports no step counts (its results went with its attempt).
   */
  async function readState({ actor, includeCompletion = false } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    if (includeCompletion !== true) return state;
    const lesson = await verifyActiveLesson(state.progress);
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    const completion = attempt
      ? lessonCompletion(lesson, await steps.readAttemptSteps(paths, attempt, lesson), availableStepIds(lesson, actor)) : null;
    const completed = new Set(state.progress.completedLessons.map(done => canonicalJson({ code: done.code, hash: done.hash })));
    const lessonCompletions = state.progress.completedLessons.map(done => ({
      lessonCode: done.code,
      lessonHash: done.hash,
      required: 0,
      passed: 0,
      completed: true,
      open: false
    }));
    if (completion) {
      const open = { ...completion, completed: completion.completed || completed.has(canonicalJson(attempt.pin.lesson)), open: true };
      const index = lessonCompletions.findIndex(value => value.lessonCode === open.lessonCode && value.lessonHash === open.lessonHash);
      if (index < 0) lessonCompletions.push(open);
      else lessonCompletions[index] = open;
    }
    return { ...state, completion, lessonCompletions };
  }

  /**
   * The in-progress attempt with this ID when it has a practice project, else
   * null. Code saves and host store selection resolve their attempt here.
   */
  async function activeAttemptForProject({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    const { progress } = await loadState(paths);
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    return attempt?.attemptId === attemptId && attempt.projectSlug ? structuredClone(attempt) : null;
  }

  /**
   * One lesson is in progress at a time. The same request ID replays its
   * reservation; the same lesson pin returns the attempt in progress; another
   * lesson in progress is refused with its identity, so the caller can offer to
   * archive it first. At the attempt cap (or the record's byte bound) the oldest
   * ended attempts are pruned; completion stays in completedLessons.
   */
  async function reserveAttempt({ actor, requestId, expectedRevision, pin: inputPin } = {}) {
    const paths = userPaths(actor);
    if (typeof requestId !== "string" ||
        !requestPattern.test(requestId) ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0) {
      throw new Error("Reserve with a bounded stable request ID and the revision returned by readState.");
    }
    const pin = validatePin(inputPin);
    await loadState(paths);
    const lesson = await verifyInstalled(pin);
    if (!lessonSteps(lesson)) {
      throw failure("This lesson uses an earlier format that can no longer be started.", "VIBE64_TRAINING_LESSON_VERSION", 409);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.attempts.some(attempt => attempt.ended?.requestId === requestId)) {
        throw failure("This request ID already ended an attempt; use its original end operation.", "VIBE64_TRAINING_REQUEST_CONFLICT", 409);
      }
      const replay = state.progress.attempts.find(attempt => attempt.requestIds.includes(requestId));
      if (replay) {
        if (canonicalJson(replay.pin) !== canonicalJson(pin)) {
          throw failure(
            "This request ID already reserved another exact lesson pin. Resume its saved attempt.",
            "VIBE64_TRAINING_REQUEST_CONFLICT",
            409
          );
        }
        await verifyInstalled(replay.pin);
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt: replay, active, replayed: true };
      }
      let attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      if (attempt && canonicalJson(attempt.pin) !== canonicalJson(pin)) {
        const current = await verifyInstalled(attempt.pin).catch(() => null);
        throw failure("Another lesson is in progress. Archive it before starting this one.", TRAINING_LESSON_IN_PROGRESS_CODE, 409,
          {
            details: {
              attemptId: attempt.attemptId,
              lessonCode: attempt.pin.lesson.code,
              lessonTitle: current?.lesson?.title || attempt.pin.lesson.code
            }
          });
      }
      if (expectedRevision !== state.revision) {
        throw failure(
          "Learning state changed. Read the current revision and resume or retry the same request.",
          "VIBE64_TRAINING_STATE_REVISION_CONFLICT",
          409
        );
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. Resume the saved attempt; no new reservation was written.");
      }
      let attempts = state.progress.attempts;
      if (attempt) {
        if (attempt.requestIds.length >= MAX_REQUEST_IDS) {
          throw new Error(
            "This attempt reached its 64 distinct reservation-request limit. Resume the saved attempt; no retry identity was removed."
          );
        }
        attempt = { ...attempt, requestIds: [...attempt.requestIds, requestId] };
        attempts = attempts.map(value => value.attemptId === attempt.attemptId ? attempt : value);
      } else {
        const attemptId = randomUUID();
        attempt = {
          attemptId,
          requestIds: [requestId],
          createdAt: new Date().toISOString(),
          pin,
          ...(lesson.lesson.exercise ? { projectSlug: practiceSlug(attemptId), preparation: { phase: "reserved" } } : {})
        };
        attempts = [...attempts, attempt];
      }
      let progress = { ...state.progress, revision: state.revision + 1, activeAttemptId: attempt.attemptId, attempts };
      // Every attempt but the new last one has ended here.
      while (progress.attempts.length > MAX_ATTEMPTS || progress.attempts.length > 1 && byteSize(progress) > MAX_RECORD_BYTES) {
        progress = { ...progress, attempts: progress.attempts.slice(1) };
      }
      await verifyInstalled(pin);
      await writeProgress(
        paths,
        progress,
        "Reservation save was not confirmed. Retry the same request ID before provisioning; the atomic rename may already have saved it."
      );
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt, active, replayed: false };
    } finally {
      await release();
    }
  }

  /**
   * Finishing (finished), archiving (archived, also by restart) and deleting
   * (deleted) end the attempt in progress. Finished requires every required
   * step passed and records the lesson content in completedLessons. Its step
   * results and code ledger then go: the archive bundle already copied what it
   * keeps (readAttemptRecord). The admitted host runs this inside
   * runClosingExclusive; no project or session effect happens here.
   */
  async function endAttempt({ actor, attemptId, requestId, expectedRevision, reason } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !requestPattern.test(requestId || "") ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !END_REASONS.includes(reason)) {
      throw new Error(
        "End the exact saved attempt with a stable request ID, current revision and an explicit finished, archived or deleted reason."
      );
    }
    await loadState(paths);
    const release = await acquire(paths);
    let ended;
    try {
      const state = await loadState(paths);
      const replay = state.progress.attempts.find(value => value.ended?.requestId === requestId);
      if (replay) {
        if (replay.attemptId !== attemptId || replay.ended.reason !== reason) {
          throw failure("This end request already retired a different attempt or reason.", "VIBE64_TRAINING_REQUEST_CONFLICT", 409);
        }
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        ended = { revision: state.revision, attempt: replay, active, replayed: true };
      } else {
        if (state.progress.attempts.some(value => value.requestIds.includes(requestId))) {
          throw failure(
            "This request ID already reserved an attempt; use a distinct stable end request.",
            "VIBE64_TRAINING_REQUEST_CONFLICT",
            409
          );
        }
        if (state.progress.activeAttemptId !== attemptId) {
          throw failure(
            "Only this learner's exact lesson in progress can be ended; retained history is not reactivated.",
            "VIBE64_TRAINING_ATTEMPT_MISSING",
            404
          );
        }
        if (expectedRevision !== state.revision) {
          throw failure("Learning state changed. Read it before ending the same attempt.", "VIBE64_TRAINING_STATE_REVISION_CONFLICT", 409);
        }
        if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("Learning state reached its revision limit. No attempt was ended.");
        const lesson = await verifyActiveLesson(state.progress, { admissionOnly: reason !== "finished" });
        const previous = state.progress.attempts.find(value => value.attemptId === attemptId);
        let { completedLessons } = state.progress;
        if (reason === "finished") {
          if (!lessonCompletion(lesson, await steps.readAttemptSteps(paths, previous, lesson), availableStepIds(lesson, actor)).completed) {
            throw failure("Pass every required step before finishing this lesson.", "VIBE64_TRAINING_LESSON_INCOMPLETE", 409);
          }
          const key = canonicalJson(previous.pin.lesson);
          if (!completedLessons.some(value => canonicalJson({ code: value.code, hash: value.hash }) === key)) {
            // The bound keeps the record small; the oldest completion leaves first.
            completedLessons = [...completedLessons, {
              ...previous.pin.lesson,
              completedAt: new Date().toISOString()
            }].slice(-MAX_COMPLETED_LESSONS);
          }
        }
        const attempt = { ...previous, ended: { requestId, revision: state.revision + 1, reason } };
        const progress = {
          ...state.progress,
          revision: state.revision + 1,
          activeAttemptId: null,
          completedLessons,
          attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? attempt : value)
        };
        await writeProgress(
          paths,
          progress,
          "Attempt end save was not confirmed; atomic rename may have succeeded. Read or retry this exact end request before a new reservation."
        );
        const active = await saveActive(paths, progress);
        ended = { revision: progress.revision, attempt, active, replayed: false };
      }
    } finally {
      await release();
    }
    // Disposable once the end is saved; a retry of the same end forgets them again.
    await forgetAttemptRecords(paths, attemptId).catch(error => logger.warn({ error, attemptId },
      "An ended attempt's code ledger and step results were not forgotten; a retry of the same end forgets them."));
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
      throw failure(
        "This learner has no matching active reservation. Read the current learning state before resuming.",
        "VIBE64_TRAINING_ATTEMPT_MISSING",
        404
      );
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure(
          "The active attempt changed. Read the current learning state before resuming.",
          "VIBE64_TRAINING_ATTEMPT_MISSING",
          404
        );
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

  /**
   * What an archive bundle keeps of the attempt in progress: its record, its
   * step results and its lesson's title. Archiving needs only the lesson's
   * identity, so a lesson this Vibe64 can no longer teach is still archived.
   */
  async function readAttemptRecord({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("This learner has no matching saved attempt.", "VIBE64_TRAINING_ATTEMPT_MISSING", 404);
    const lesson = await verifyInstalled(attempt.pin, { admissionOnly: true });
    const { revision: _revision, ...stepProgress } = await steps.readAttemptSteps(paths, attempt, lesson);
    return {
      attempt: structuredClone(attempt),
      stepProgress: structuredClone(stepProgress),
      lessonTitle: String(lesson.lesson?.title || "") || attempt.pin.lesson.code
    };
  }

  return Object.freeze({
    readState,
    activeAttemptForProject,
    readAttemptRecord,
    reserveAttempt,
    endAttempt,
    resumeAttempt,
    runClosingExclusive: preparation.runClosingExclusive,
    runPreparationExclusive: preparation.runPreparationExclusive,
    beginPreparation: preparation.beginPreparation,
    recordPreparationReady: preparation.recordPreparationReady,
    recordPreparationFailure: preparation.recordPreparationFailure,
    recordPreparationStart: preparation.recordPreparationStart,
    runReviewExclusive: reviews.runReviewExclusive,
    readCodeLedger: codeLedgers.readCodeLedger,
    updateCodeLedger: codeLedgers.updateCodeLedger,
    readStepProgress: steps.readStepProgress,
    updateStepProgress: steps.updateStepProgress,
    readReader: steps.readReader,
    saveReader: steps.saveReader,
    readTeacherNotes: notes.readTeacherNotes,
    saveTeacherNotes: notes.saveTeacherNotes,
    readLearningMode: learningMode.readLearningMode,
    // readable-check: allow setter-seam - not a slot: setLearningMode saves one learner's Learn mode
    setLearningMode: learningMode.setLearningMode
  });
}

export {
  createTrainingLearnerState, failure, inspectDirectoryChain, inspectPath, learnerIdentity, lessonSteps, MAX_NOTES_CHARS, MAX_STEP_RESULTS,
  readRecord, stepReceiptSchema, stepResultSchema, validatePin, validateLessonStepResults, validateStepEntry
};
