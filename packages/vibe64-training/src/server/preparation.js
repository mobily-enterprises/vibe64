import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { practiceLearnerKey } from "@local/vibe64-core/server/learningSpace";

function trainingError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

const revisionConflict = () => trainingError("VIBE64_TRAINING_STATE_REVISION_CONFLICT",
  "Learning state changed. Read the current revision and retry.");
const missingAttempt = () => Object.assign(trainingError("VIBE64_TRAINING_ATTEMPT_MISSING",
  "This is not your lesson in progress. Nothing was changed."), { statusCode: 404 });

function requireSuccess(result) {
  if (result?.ok === false) {
    throw trainingError(result.code || "VIBE64_TRAINING_PREPARATION_FAILED", result.error || "Exercise preparation failed. Resume the same attempt.");
  }
  return result;
}

// Internal orchestration, supplied with the existing owners. Authenticated
// actions admit actors and pins; neither model input nor HTTP selects paths,
// initializers, session identities or shell commands here.
function createTrainingService({ catalogue, content, learners, learningSpace = null, projectContext, projectRepositoryService, project, sessions, terminals } = {}) {
  // Rev 4 (H4): one lesson in progress at a time. A different lesson in
  // progress refuses once with its title (the client's one confirmation);
  // archiveCurrent archives it first, under the same admitted revision.
  async function startLesson({ actor, courseId, release, lessonCode, requestId, expectedRevision, archiveCurrent = false } = {}) {
    const approved = await catalogue.readCatalogue();
    const entry = approved.courses.find(value => value.course.courseId === courseId && value.course.release === release);
    if (!entry?.enabled) throw trainingError("VIBE64_TRAINING_COURSE_UNAVAILABLE", "This exact course release is not enabled. Ask the owner to enable it, or resume your saved lesson.");
    // A preview course is for the workspace owner to review before release;
    // its admitted attempt is otherwise an ordinary saved lesson.
    if (entry.course.status !== "released" && actor?.role !== "owner") {
      throw Object.assign(trainingError("VIBE64_TRAINING_COURSE_PREVIEW",
        "This preview course can be tried only by the workspace owner until it is released."), { statusCode: 403 });
    }
    const topic = entry.lock.topics.find(value => value.lessons.some(lesson => lesson.code === lessonCode && lesson.status === "published"));
    if (!topic) throw trainingError("VIBE64_TRAINING_LESSON_UNAVAILABLE", "Choose a published lesson in the approved course release.");
    const lesson = topic.lessons.find(value => value.code === lessonCode);
    const pin = {
      course: { courseId, release },
      topic: { schemaVersion: 1, topicId: topic.topicId, release: topic.release, repository: topic.repository,
        commit: topic.commit, topicHash: topic.manifestHash },
      lesson: { code: lesson.code, hash: lesson.hash }
    };
    let revision = expectedRevision;
    const saved = await learners.readState({ actor });
    const current = saved.progress.attempts.find(value => value.attemptId === saved.progress.activeAttemptId);
    // The same lesson in progress, or a replayed start, is the learner store's.
    const replay = saved.progress.attempts.some(value => value.requestIds?.includes(requestId));
    if (current && !replay && !isDeepStrictEqual(current.pin, pin)) {
      if (archiveCurrent !== true) {
        // An AppError: the HTTP error response carries only an AppError's details.
        throw new AppError(409, "Another lesson is in progress. Archive it to start this one, or continue it.", {
          code: "VIBE64_TRAINING_LESSON_IN_PROGRESS",
          details: { attemptId: current.attemptId, lessonTitle: await lessonTitle(current.pin) } });
      }
      if (expectedRevision !== saved.revision) throw revisionConflict();
      await requireCloser().closeAttempt({ actor, attemptId: current.attemptId, archive: true, reason: "archived" });
      revision = (await learners.readState({ actor })).revision;
    }
    return reserveAndPrepare({ actor, requestId, expectedRevision: revision, pin });
  }

  async function reserveAndPrepare({ actor, requestId, expectedRevision, pin }) {
    const reserved = await learners.reserveAttempt({ actor, requestId, expectedRevision, pin });
    if (reserved.attempt.ended) return { ...reserved, previewReady: false };
    await learners.setLearningMode({ actor, on: true });
    return prepareLesson({ actor, attemptId: reserved.attempt.attemptId });
  }

  // Restart (H5): archive this attempt, then a new attempt of the same pinned
  // lesson with a fresh project, teacher and results. A retry with the same
  // request finishes a stopped restart: the close is resumable and the
  // reservation replays.
  async function restartLesson({ actor, attemptId, requestId, expectedRevision } = {}) {
    const saved = await learners.readState({ actor });
    const attempt = saved.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw missingAttempt();
    if (!attempt.ended) {
      if (expectedRevision !== saved.revision) throw revisionConflict();
      await requireCloser().closeAttempt({ actor, attemptId, archive: true, reason: "archived" });
    } else if (attempt.ended.reason !== "archived" || saved.progress.activeAttemptId &&
        !saved.progress.attempts.some(value => value.attemptId === saved.progress.activeAttemptId && value.requestIds?.includes(requestId))) {
      throw missingAttempt();
    }
    return reserveAndPrepare({ actor, requestId, expectedRevision: (await learners.readState({ actor })).revision, pin: attempt.pin });
  }

  // Completing the lesson archives the attempt as one bundle (H5); the
  // learner store keeps the completion. Refused unless every required step passed.
  async function finishLesson({ actor, attemptId, expectedRevision } = {}) {
    const saved = await learners.readState({ actor, includeCompletion: true });
    const attempt = saved.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw missingAttempt();
    if (!attempt.ended) {
      if (expectedRevision !== saved.revision) throw revisionConflict();
      if (!(saved.completion && saved.completion.passed >= saved.completion.required)) {
        throw trainingError("VIBE64_TRAINING_LESSON_INCOMPLETE", "Pass every required step before finishing this lesson. Nothing was changed.");
      }
    }
    return requireCloser().closeAttempt({ actor, attemptId, archive: true, reason: "finished" });
  }

  // Delete (H5): the project and the teacher conversation go, with no archive.
  async function deleteLesson({ actor, attemptId } = {}) {
    return requireCloser().closeAttempt({ actor, attemptId, archive: false, reason: "deleted" });
  }

  function requireCloser() {
    if (typeof learningSpace?.closeAttempt !== "function") {
      throw trainingError("VIBE64_TRAINING_PRACTICE_UNAVAILABLE", "Closing lessons is unavailable in this installation. Nothing was changed.");
    }
    return learningSpace;
  }

  async function lessonTitle(pin) {
    try {
      return (await content.readLesson({ ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash })).lesson.title;
    } catch {
      return pin.lesson.code;
    }
  }

  // Creating the exercise session starts the original asynchronous Workspace
  // setup, so the first preparation normally returns "preparing". When that
  // exact setup run finishes, recheck the same attempt through this original
  // owner, as Resume would; it records ready only when setup is proven.
  const setupFollowUps = new Map();
  function followSetup({ actor, attemptId, setupRun }) {
    if (setupFollowUps.has(attemptId)) return;
    const task = Promise.resolve(setupRun).catch(() => null).then(async () => {
      for (let tries = 1; ; tries++) {
        try { return await prepareLesson({ actor, attemptId }); }
        catch (error) {
          // A concurrent learning write may briefly hold the preparation barrier.
          if (error.code !== "VIBE64_TRAINING_PREPARATION_BUSY" || tries >= 3) throw error;
        }
      }
    }).catch(() => null).finally(() => setupFollowUps.delete(attemptId));
    // Resume remains the explicit recovery when this follow-up cannot finish.
    setupFollowUps.set(attemptId, task);
  }

  async function prepareLesson({ actor, attemptId } = {}) {
    let setupRun = null;
    const prepared = await learners.runPreparationExclusive({ actor, attemptId }, async () => {
      let saved = await learners.resumeAttempt({ actor, attemptId });
      const lesson = await content.readLesson({ ...saved.attempt.pin.topic,
        lessonCode: saved.attempt.pin.lesson.code, lessonHash: saved.attempt.pin.lesson.hash });
      if (!lesson.lesson.exercise) return { ...saved, previewReady: false };
      if (typeof projectRepositoryService?.createManagedGitProject !== "function" ||
          typeof projectRepositoryService?.verifyTrainingProjectSource !== "function") {
        throw trainingError("VIBE64_TRAINING_EXERCISE_UNAVAILABLE", "This installation cannot prepare the lesson's practice project. Keep the saved attempt and ask the owner to provide exercise preparation.");
      }
      saved = await learners.beginPreparation({ actor, attemptId, expectedRevision: saved.revision });
      const { attempt } = saved;
      const initialSessionId = attempt.preparation.initialSessionId;
      let stage = "project";
      try {
        const exercise = await content.readExercise({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
        // The marker keeps its field name practiceId; its value is the attemptId.
        const training = {
          schemaVersion: 2, learnerKey: practiceLearnerKey(actor), practiceId: attemptId,
          pin: attempt.pin, exercise: { kind: "bundled", sourcePath: exercise.sourcePath }
        };
        const prepareExercise = async () => {
          const existing = await projectContext.readWorkspaceProjectState({ slug: attempt.projectSlug });
          let exists = false;
          try { await lstat(existing.projectContextRoot); exists = true; }
          catch (error) { if (error.code !== "ENOENT") throw error; }
          if (exists || Object.keys(existing.metadata).length) {
            if (!isDeepStrictEqual(existing.metadata.training, training) || existing.metadata.deletion || existing.metadata.repository?.mode !== "managed_git") {
              throw trainingError("VIBE64_TRAINING_PROJECT_CONFLICT", "The reserved exercise project has different or missing ownership. Keep it intact and ask the owner to inspect it; no replacement was created.");
            }
          } else {
            if (attempt.preparation.phase === "ready") throw trainingError("VIBE64_TRAINING_PROJECT_MISSING", "Your prepared exercise project is missing. Keep your progress and ask the owner to restore it; this attempt cannot silently adopt a replacement.");
            requireSuccess(await projectRepositoryService.createManagedGitProject({
              slug: attempt.projectSlug, name: `Practice: ${attempt.pin.lesson.code}`, training, vibe64User: actor
            }, { initializeProject: async ({ projectRoot }) => {
              // readExercise already verifies every byte against the installed pin.
              // Retain the original managed initializer's Git commit and rollback.
              for (const file of exercise.files) {
                const relative = file.path;
                if (!relative || relative.includes("\\") || path.posix.isAbsolute(relative) || relative.split("/").some(part => !part || part === "." || part === ".." || part === ".git")) {
                  throw trainingError("VIBE64_TRAINING_EXERCISE_PATH_INVALID", "The verified exercise contains an invalid source path. Ask the owner to inspect its content release.");
                }
                const destination = path.join(projectRoot, relative);
                await mkdir(path.dirname(destination), { recursive: true });
                await writeFile(destination, file.bytes, { flag: "wx" });
              }
            } }));
          }
          stage = "session";
          const session = await project.runInProjectContext(attempt.projectSlug, async () => {
            const prepareSession = async () => {
              const runtime = await project.createRuntime({ inspectSource: false });
              let current;
              try { current = await runtime.getSession(initialSessionId, { inspectSource: false }); }
              catch (error) {
                if (error.code !== "vibe64_session_not_found") throw error;
                if (attempt.preparation.phase === "ready") throw trainingError("VIBE64_TRAINING_SESSION_MISSING", "Your prepared exercise session is missing. Ask the owner to restore it; this attempt cannot silently create a replacement.");
                // Prove the original exercise before the first session exists.
                const expectedCommit = (await projectRepositoryService.verifyTrainingProjectSource({ slug: attempt.projectSlug, training }, { files: exercise.files })).commit;
                current = requireSuccess(await sessions.createSession({ vibe64User: actor }, { sessionId: initialSessionId, expectedCommit }));
              }
              if (current.sessionId !== initialSessionId || current.status === "archived" || current.closing) {
                throw trainingError("VIBE64_TRAINING_SESSION_CONFLICT", "The reserved exercise session is unavailable. Keep your progress and ask the owner to inspect it; no alternative session was selected.");
              }
              if (current.workspaceSetup?.status === "succeeded" && !await terminals.workspaceSetupIsPrepared(initialSessionId)) {
                throw trainingError("VIBE64_TRAINING_SETUP_CHANGED", "Workspace setup no longer matches this exercise session. Use its existing setup recovery, then resume the same lesson; no replacement was created.");
              }
              // The setup runner is keyed in this Project context.
              setupRun = current.workspaceSetup?.status === "succeeded" ? null : terminals.waitForWorkspaceSetup?.(initialSessionId) || null;
              return current;
            };
            // The initial practice session is an ordinary project session: no
            // learning binding; prepareExercise runs inside the learner's own
            // practice scope.
            return prepareSession();
          });
          stage = "setup";
          // Creating a session starts the original asynchronous Workspace setup.
          // A pending/failed setup is not success, and prepared is not running Preview.
          if (session.workspaceSetup?.status !== "succeeded") {
            const current = await learners.resumeAttempt({ actor, attemptId });
            if (["failed", "ambiguous", "required", "unconfigured"].includes(session.workspaceSetup?.status)) {
              setupRun = null;
              if (attempt.preparation.phase === "ready") return { ...current, setup: session.workspaceSetup, previewReady: false };
              return { ...await learners.recordPreparationFailure({ actor, attemptId, expectedRevision: current.revision, initialSessionId,
                stage, code: "VIBE64_TRAINING_SETUP_INCOMPLETE", message: "Exercise Workspace setup is incomplete. Use the existing setup recovery, then resume this same lesson." }), previewReady: false };
            }
            return { ...current, setup: session.workspaceSetup || null, previewReady: false };
          }
          const current = await learners.resumeAttempt({ actor, attemptId });
          return { ...await learners.recordPreparationReady({ actor, attemptId, expectedRevision: current.revision, initialSessionId }), previewReady: false };
        };
        return await projectContext.runWithPracticeProjectScope({ actor, training, access: "create" }, prepareExercise);
      } catch (error) {
        // Preserve the original error even if recording its bounded diagnosis
        // fails. Retrying reads the same saved identities before any effect.
        try {
          const current = await learners.resumeAttempt({ actor, attemptId });
          if (attempt.preparation.phase !== "ready") await learners.recordPreparationFailure({ actor, attemptId, expectedRevision: current.revision, initialSessionId,
            stage, code: String(error.code || "VIBE64_TRAINING_PREPARATION_FAILED").slice(0, 64),
            message: "Exercise preparation could not finish. Resume the same lesson; if it still fails, ask the owner to inspect the project, session and setup diagnostics." });
        } catch { /* Original failure remains authoritative. */ }
        setupRun = null;
        throw error;
      }
    });
    if (setupRun) followSetup({ actor, attemptId, setupRun });
    return prepared;
  }

  return Object.freeze({ startLesson, prepareLesson, restartLesson, finishLesson, deleteLesson });
}

export { createTrainingService };
