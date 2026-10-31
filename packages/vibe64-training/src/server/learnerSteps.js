import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import { attemptStepEntry, failure, idPattern, lessonSteps, MAX_READER_BYTES, MAX_STEP_RECORD_BYTES, readerSchema, readRecord, uuidPattern, validateLessonStepResults, validateStepProgress } from "./learnerRecords.js";

/**
 * A learner's step results and reader position, each under its own short
 * lock, checked against the attempt's pinned lesson.
 * @param {object} dependencies
 * @param {(lockPath: string, code: string, message: string) => Promise<() => Promise<void>>} dependencies.acquireRecordLock
 * @param {(paths: object) => Promise<object>} dependencies.loadState
 * @param {(actor: object) => object} dependencies.userPaths
 * @param {(progress: object, options?: { admissionOnly?: boolean }) => Promise<object | null>} dependencies.verifyActiveLesson
 * @param {(pin: object, options?: { admissionOnly?: boolean }) => Promise<object>} dependencies.verifyInstalled
 */
function createLearnerSteps({ acquireRecordLock, loadState, userPaths, verifyActiveLesson, verifyInstalled }) {
  async function readStepProgressRecord(paths) {
    const value = await readRecord(paths.stepProgress, MAX_STEP_RECORD_BYTES);
    return value ? validateStepProgress(value, paths.learner.id) : null;
  }

  // The attempt's own step results, checked against its pinned lesson.
  async function readAttemptSteps(paths, attempt, lesson) {
    try {
      const record = await readStepProgressRecord(paths);
      const entry = attemptStepEntry(record, attempt);
      if (record?.attemptId === attempt.attemptId) {
        if (canonicalJson(record.lesson) !== canonicalJson(attempt.pin.lesson)) throw new Error("Step progress names another lesson than its attempt.");
        validateLessonStepResults(entry, lesson);
      }
      return { ...entry, revision: record?.attemptId === attempt.attemptId ? record.revision : 0 };
    } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID",
        `Learning step progress is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`, null, { cause });
    }
  }

  // Read-only: the saved step results of one retained attempt (the one in
  // progress unless attemptId names another). An ended attempt has none here.
  async function readStepProgress({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === (attemptId ?? state.progress.activeAttemptId));
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin);
    const { revision: stepRevision, ...entry } = await readAttemptSteps(paths, attempt, lesson);
    return { revision: stepRevision, entry, attempt, progress: state.progress };
  }

  // The admitted step owner supplies the operation; it decides what may pass.
  // This store only serializes, validates against the pinned lesson and saves
  // the results of the attempt in progress.
  async function updateStepProgress({ actor, attemptId } = {}, operation) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || typeof operation !== "function") {
      throw new Error("Record step results for an exact saved attempt.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Continue this lesson before recording step results.", 404);
    }
    const release = await acquireRecordLock(paths.stepProgressLock, "VIBE64_TRAINING_STEP_PROGRESS_BUSY",
      "Another step result for this learner is being saved. Retry the same request in a moment.");
    try {
      const state = await loadState(paths);
      const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
      if (state.progress.activeAttemptId !== attemptId || !attempt || attempt.ended) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The saved learning attempt changed.", 404);
      }
      const lesson = await verifyActiveLesson(state.progress);
      if (!lessonSteps(lesson)) {
        throw failure("VIBE64_TRAINING_LESSON_VERSION", "This lesson uses assessments, not step results.", 409);
      }
      const { revision: stepRevision, ...entry } = await readAttemptSteps(paths, attempt, lesson);
      const result = await operation(structuredClone(entry), { lesson, attempt, revision: stepRevision, learnerId: paths.learner.id });
      if (!result?.entry) return { revision: stepRevision, entry, value: result?.value };
      if (stepRevision === Number.MAX_SAFE_INTEGER) throw new Error("Step progress reached its revision limit. No result was written.");
      const next = { schemaVersion: 3, learnerId: paths.learner.id, revision: stepRevision + 1, attemptId, lesson: entry.lesson,
        results: result.entry.results, receipts: result.entry.receipts || [] };
      validateStepProgress(next, paths.learner.id);
      validateLessonStepResults(next, lesson);
      try {
        await writeJsonFileAtomic(paths.stepProgress, next, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_STEP_PROGRESS_SAVE_UNCONFIRMED",
          "The step result save was not confirmed; the atomic rename may have succeeded. Read or retry the same request ID.", null, { cause });
      }
      return { revision: next.revision, entry: { lesson: next.lesson, results: next.results, receipts: next.receipts }, value: result.value };
    } finally {
      await release();
    }
  }

  // A position in an attempt that was since pruned reads as no position.
  async function readReader({ actor } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    let value;
    try {
      value = await readRecord(paths.reader, MAX_READER_BYTES);
      if (!value) return null;
      const reader = validateContent(readerSchema, value, "Lesson reader position");
      if (reader.learnerId !== paths.learner.id || !uuidPattern.test(reader.attemptId) || !idPattern.test(reader.stepId)) {
        throw new Error("The reader position belongs to another learner or names an invalid attempt or step.");
      }
      if (!state.progress.attempts.some(attempt => attempt.attemptId === reader.attemptId)) return null;
      return { attemptId: reader.attemptId, stepId: reader.stepId, scroll: reader.scroll };
    } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID",
        `Lesson reader position is invalid: ${cause.message} Keep the file and ask the owner to inspect it.`, null, { cause });
    }
  }

  // Last write wins. Any retained attempt of this learner may be read again.
  async function saveReader({ actor, attemptId, stepId, scroll } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !idPattern.test(stepId || "") ||
        typeof scroll !== "number" || !Number.isFinite(scroll) || scroll < 0 || scroll > 10_000_000) {
      throw new Error("Save the reader position with an exact attempt, step and a bounded scroll offset.");
    }
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin);
    if (!lessonSteps(lesson)?.some(step => step.id === stepId)) {
      throw failure("VIBE64_TRAINING_STEP_MISSING", "The step is not declared in this attempt's pinned lesson.", 404);
    }
    const release = await acquireRecordLock(paths.readerLock, "VIBE64_TRAINING_READER_BUSY", "The reader position is being saved. Retry in a moment.");
    try {
      const reader = { schemaVersion: 1, learnerId: paths.learner.id, attemptId, stepId, scroll };
      await writeJsonFileAtomic(paths.reader, validateContent(readerSchema, reader, "Lesson reader position"), { directoryMode: 0o700, fileMode: 0o600 });
      return { attemptId, stepId, scroll };
    } finally {
      await release();
    }
  }

  return { readAttemptSteps, readStepProgress, readStepProgressRecord, updateStepProgress, readReader, saveReader };
}

export { createLearnerSteps };
