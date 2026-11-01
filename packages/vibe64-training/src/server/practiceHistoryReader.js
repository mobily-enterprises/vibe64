import path from "node:path";
import { assertLearningSystemRoot } from "./learnerRecords.js";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import {
  failure,
  inspectDirectoryChain,
  inspectPath,
  learnerIdentity,
  lessonSteps,
  readRecord,
  validateLessonStepResults,
  validatePin
} from "./learnerState.js";
import {
  activeSchema,
  assessmentLesson,
  deriveActive,
  emptyActiveSchema,
  lessonStepEntry,
  MAX_RECORD_BYTES,
  MAX_STEP_RECORD_BYTES,
  passedAssessmentIds,
  uuidPattern,
  validateLearning,
  validatePreparation,
  validateProgress,
  validateSnapshot,
  validateStepProgress
} from "./practiceHistoryRecords.js";

/** @typedef {import("./types.js").InstalledTrainingContent} InstalledTrainingContent */

/**
 * Read-only reader of version 1 learner progress, the format the 20261022
 * learning reset retired. Only the published 20261008-learning-practice-history
 * upgrade uses it, before that reset runs; it never writes. File safety,
 * identity, pin and step-result validation are the live learner state's.
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {InstalledTrainingContent} dependencies.content
 */
function createPracticeHistoryReader({ systemRoot, content }) {
  assertLearningSystemRoot(systemRoot);
  const installed = content;

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
      lock: path.join(userRoot, "state.lock"),
      preparationLock: path.join(userRoot, "preparation.lock"),
      stepProgress: path.join(userRoot, "step-progress.json")
    };
  }

  async function readProgress(paths) {
    const value = await readRecord(paths.progress, MAX_RECORD_BYTES);
    if (!value) return { schemaVersion: 1, learnerId: paths.learner.id, revision: 0, activeAttemptId: null, attempts: [] };
    const progress = validateProgress(value, paths.learner.id);
    return progress;
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
      const savedActive = await readRecord(paths.active, MAX_RECORD_BYTES);
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
          if (active.preparation) validatePreparation(active.preparation, active);
          validateLearning(active.learning, active, active.learnerId, active.progressRevision);
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
            if (predecessor) {
              preparation = current;
            }
          }
          let projected = { ...active, progressRevision: expectedRevision, ...(preparation ? { preparation } : {}) };
          if (expected && active.progressRevision < expectedRevision && expected.learning) {
            const previous = active.learning;
            const current = expected.learning;
            const prefix = !previous || previous.submissions.length <= current.submissions.length &&
              previous.submissions.every((result, index) => canonicalJson(result) === canonicalJson(current.submissions[index]));
            const olderResume = !previous?.resume || current.resume &&
              (previous.resume.revision < current.resume.revision || canonicalJson(previous.resume) === canonicalJson(current.resume));
            if (prefix && olderResume) projected = { ...projected, learning: current };
          }
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

  async function verifyInstalled(pin, options = {}) {
    const { admissionOnly = false } = options;
    // readable-check: allow method-probe - optional operation: content without admission reads is verified by its whole lesson read
    const read = admissionOnly && typeof installed.readAdmissionIdentity === "function"
      ? installed.readAdmissionIdentity : installed.readLesson;
    const lesson = await read.call(installed, { ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
    if (canonicalJson(lesson.pin) !== canonicalJson(pin.topic)) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
    return lesson;
  }

  /**
   * Each distinct pinned lesson is verified once per read, however many
   * attempts (every leave and continue adds one) share it.
   */
  async function verifyProgressLessons(progress) {
    const lessons = new Map();
    const verified = new Map();
    for (const attempt of progress.attempts) {
      const key = canonicalJson([attempt.pin.topic, attempt.pin.lesson]);
      if (!verified.has(key)) verified.set(key, await verifyInstalled(attempt.pin));
      const lesson = verified.get(key);
      validateLessonPractice(attempt, lesson);
      validateLessonLearning(attempt, lesson);
      lessons.set(attempt.attemptId, lesson);
    }
    return lessons;
  }

  async function readState({ actor, includeCompletion = false } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    if (includeCompletion !== true) return state;
    const lessons = await verifyProgressLessons(state.progress);
    const { lessons: stepLessons } = await readLessonStepProgress(paths, state.progress, lessons);
    // Read-only per-lesson summary of the same verified passes; a lesson counts
    // in every course that contains its exact code and hash.
    const byLesson = new Map();
    for (const attempt of state.progress.attempts) {
      const key = canonicalJson(attempt.pin.lesson);
      const saved = byLesson.get(key) ||
        { ...lessonCompletion(attempt, lessons.get(attempt.attemptId), state.progress.attempts, stepLessons), open: false };
      saved.open ||= !attempt.ended;
      byLesson.set(key, saved);
    }
    const lessonCompletions = [...byLesson.values()];
    if (!state.active) return { ...state, completion: null, lessonCompletions };
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    return {
      ...state,
      completion: lessonCompletion(attempt, lessons.get(attempt.attemptId), state.progress.attempts, stepLessons),
      lessonCompletions
    };
  }

  /**
   * The exact bundled exercise of a saved attempt, with this refusal
   * precedence: installed pin, no exercise, inactive work, unavailable reader.
   */
  async function readAttemptExercise(state, attempt, access) {
    const active = state.progress.activeAttemptId === attempt.attemptId && !attempt.ended;
    const workInactive = (access === "write" || access === "create") && (!active || !state.activeSummaryCurrent);
    // Refusals keep the installed-pin/no-exercise precedence. Admitted
    // reads use readExercise's existing lesson validation instead of repeating it.
    // readable-check: allow method-probe - optional operation: content without exercise reads is verified by its whole lesson read
    if (workInactive || typeof installed.readExercise !== "function") {
      const lesson = await verifyInstalled(attempt.pin);
      if (!lesson.lesson.exercise) {
        throw failure(
          "This saved lesson has no practice project. Use its source-less learning conversation.",
          "VIBE64_TRAINING_EXERCISE_MISSING",
          409
        );
      }
      if (workInactive) {
        throw failure("Resume this exact confirmed active lesson before admitting practice work.", "VIBE64_TRAINING_ATTEMPT_INACTIVE", 409);
      }
      throw failure(
        "This installed content reader cannot supply the lesson's exact bundled exercise.",
        "VIBE64_TRAINING_EXERCISE_UNAVAILABLE",
        409
      );
    }
    let exercise;
    try {
      exercise = await installed.readExercise({
        ...attempt.pin.topic,
        lessonCode: attempt.pin.lesson.code,
        lessonHash: attempt.pin.lesson.hash,
        metadataOnly: true,
        admissionOnly: access === "observe" || access === "control"
      });
    } catch (error) {
      if (error?.code === "VIBE64_TRAINING_EXERCISE_MISSING") {
        await verifyInstalled(attempt.pin);
        throw failure(
          "This saved lesson has no practice project. Use its source-less learning conversation.",
          "VIBE64_TRAINING_EXERCISE_MISSING",
          409
        );
      }
      throw error;
    }
    if (canonicalJson(exercise.pin) !== canonicalJson(attempt.pin.topic) ||
        exercise.lessonCode !== attempt.pin.lesson.code || exercise.lessonHash !== attempt.pin.lesson.hash) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
    return { active, sourcePath: exercise.sourcePath };
  }

  function exerciseScope(paths, state, attempt, { active, training }) {
    return {
      scope: { learnerId: paths.learner.id, attemptId: attempt.attemptId, pin: structuredClone(attempt.pin), noExercise: false },
      systemRoot,
      training,
      projectSlug: attempt.projectSlug,
      ...(attempt.preparation.initialSessionId ? { initialSessionId: attempt.preparation.initialSessionId } : {}),
      active,
      activeSummaryCurrent: state.activeSummaryCurrent
    };
  }

  /**
   * The upgrade compares the result with a version 1 project marker: one
   * attempt, its own project and the version 1 marker.
   */
  async function readExerciseProjectScope({ actor, attemptId, access = "observe" } = {}) {
    if (!["observe", "control", "write", "create"].includes(access)) {
      throw new TypeError("Use an explicit practice operation scope.");
    }
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId)) {
      throw new Error("Use the exact saved exercise attempt ID.");
    }
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("This learner has no matching saved attempt.", "VIBE64_TRAINING_ATTEMPT_MISSING", 404);
    if (attempt.practiceId) {
      throw failure(
        "This attempt continues a learning-space practice project; read it by its practice project.",
        "VIBE64_TRAINING_ATTEMPT_CONFLICT",
        409
      );
    }
    const { active, sourcePath } = await readAttemptExercise(state, attempt, access);
    return exerciseScope(paths, state, attempt, {
      active,
      training: {
        schemaVersion: 1,
        learnerKey: paths.learner.key,
        attemptId,
        pin: structuredClone(attempt.pin),
        exercise: { kind: "bundled", sourcePath }
      }
    });
  }

  /**
   * v2 completes when every required step has passed for this lesson content.
   * v1 (read only, for published upgrades) counts its saved assessment passes.
   */
  function lessonCompletion(attempt, lesson, attempts = [attempt], stepLessons = []) {
    const steps = lessonSteps(lesson);
    let required;
    let passed;
    if (steps) {
      const { results } = lessonStepEntry(stepLessons, attempt.pin.lesson);
      required = steps.filter(value => value.required).map(value => value.id);
      passed = required.filter(id => results.some(result => result.stepId === id && result.outcome === "passed"));
    } else if (assessmentLesson(lesson)) {
      required = lesson.lesson.assessments.filter(value => value.required).map(value => value.id);
      passed = passedAssessmentIds(attempt, lesson, attempts).filter(id => required.includes(id));
    } else {
      throw new Error(`Lesson ${lesson.lesson.code} uses an unsupported format.`);
    }
    return {
      lessonCode: lesson.lesson.code,
      lessonHash: lesson.hash,
      required: required.length,
      passed: passed.length,
      completed: passed.length === required.length
    };
  }

  function validateResume(resume, lesson) {
    if (!assessmentLesson(lesson)) throw new Error("A lesson resume checkpoint belongs only to a version 1 lesson.");
    if (resume.pendingQuestion && !lesson.lesson.assessments.some(value => value.id === resume.pendingQuestion.assessmentId)) {
      throw new Error("The pending question must name an assessment in the exact pinned lesson.");
    }
    for (const { visualId, snapshot } of resume.visuals) {
      const visual = lesson.visuals.find(value => value.id === visualId)?.visual;
      validateSnapshot(snapshot);
      if (!visual || !visual.states.includes(snapshot.state)) {
        throw new Error("The semantic state must belong to a visual declared in this pinned lesson.");
      }
    }
  }

  /**
   * An exercise lesson's attempt names its practice project and preparation;
   * any other attempt names none. Read only: vibe64 0.1.35 reserved a project
   * for every lesson, and the published 20261008-learning-practice-history
   * upgrade still reads that progress.
   */
  function validateLessonPractice(attempt, lesson) {
    if (lesson.lesson.exercise ? !attempt.preparation : attempt.preparation && attempt.preparation.phase !== "reserved") {
      throw new Error("An attempt names a practice project exactly when its lesson declares an exercise.");
    }
  }

  function validateLessonLearning(attempt, lesson) {
    if (!attempt.learning) return;
    if (!assessmentLesson(lesson)) throw new Error("A version 2 lesson records step results, not assessment learning.");
    if (attempt.learning.resume) validateResume(attempt.learning.resume, lesson);
    for (const result of attempt.learning.submissions) {
      const declared = lesson.lesson.assessments.find(value => value.id === result.assessmentId);
      const evidence = result.evidence;
      if (!declared || result.kind !== declared.kind || result.rubric !== declared.rubric ||
          result.rubricRevision !== lesson.hash || declared.kind === "practical" &&
          (evidence.producer !== declared.evidence.producer || evidence.operation !== declared.evidence.operation ||
            evidence.check !== declared.evidence.check)) {
        throw new Error("Saved assessment receipts must match the exact pinned assessment, rubric and evidence contract.");
      }
    }
  }

  async function readStepProgressRecord(paths) {
    const value = await readRecord(paths.stepProgress, MAX_STEP_RECORD_BYTES);
    return value ? validateStepProgress(value, paths.learner.id) : null;
  }

  /**
   * Entries of retained lesson content are checked against that pinned lesson.
   */
  async function readLessonStepProgress(paths, progress, lessons) {
    try {
      const record = await readStepProgressRecord(paths);
      for (const entry of record?.lessons || []) {
        const attempt = progress.attempts.find(value => canonicalJson(value.pin.lesson) === canonicalJson(entry.lesson));
        if (attempt) validateLessonStepResults(entry, lessons.get(attempt.attemptId));
      }
      return { revision: record?.revision || 0, lessons: record?.lessons || [] };
    } catch (cause) {
      throw failure(
        `Learning step progress is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`,
        "VIBE64_TRAINING_STATE_INVALID",
        null,
        { cause }
      );
    }
  }

  return Object.freeze({ readState, readExerciseProjectScope });
}

export { createPracticeHistoryReader };
