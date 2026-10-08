import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

function trainingError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function requireSuccess(result) {
  if (result?.ok === false) {
    throw trainingError(result.code || "VIBE64_TRAINING_PREPARATION_FAILED", result.error || "Exercise preparation failed. Resume the same attempt.");
  }
  return result;
}

// Internal orchestration, supplied with the existing owners. Authenticated
// actions admit actors and pins; neither model input nor HTTP selects paths,
// initializers, session identities or shell commands here.
function createTrainingService({ catalogue, content, learners, projectContext, projectRepositoryService, project, sessions, terminals } = {}) {
  async function startLesson({ actor, courseId, release, lessonCode, requestId, expectedRevision } = {}) {
    // This native namespace belongs only to retained-pin continuation.
    if (typeof requestId === "string" && requestId.startsWith("continue_")) {
      throw trainingError("VIBE64_TRAINING_REQUEST_INVALID", "Choose an ordinary start request; continuation request identities are host-owned.");
    }
    const approved = await catalogue.readCatalogue();
    const entry = approved.courses.find(value => value.course.courseId === courseId && value.course.release === release);
    if (!entry?.enabled) throw trainingError("VIBE64_TRAINING_COURSE_UNAVAILABLE", "This exact course release is not enabled. Ask the owner to enable it, or resume your saved lesson.");
    const topic = entry.lock.topics.find(value => value.lessons.some(lesson => lesson.code === lessonCode && lesson.status === "published"));
    if (!topic) throw trainingError("VIBE64_TRAINING_LESSON_UNAVAILABLE", "Choose a published lesson in the approved course release.");
    const lesson = topic.lessons.find(value => value.code === lessonCode);
    const reserved = await learners.reserveAttempt({ actor, requestId, expectedRevision, pin: {
      course: { courseId, release },
      topic: { schemaVersion: 1, topicId: topic.topicId, release: topic.release, repository: topic.repository,
        commit: topic.commit, topicHash: topic.manifestHash },
      lesson: { code: lesson.code, hash: lesson.hash }
    } });
    if (reserved.attempt.ended) return { ...reserved, previewReady: false };
    return prepareLesson({ actor, attemptId: reserved.attempt.attemptId });
  }

  async function endLesson(input = {}) {
    const { actor, attemptId } = input;
    const saved = await learners.readState({ actor, includeCompletion: true });
    const attempt = saved.progress.attempts.find(value => value.attemptId === attemptId);
    // A confirmed end replay may belong to an earlier attempt. It cannot take
    // the active preparation lock, reactivate old work or end its successor.
    if (attempt?.ended) return learners.endAttempt(input);
    return learners.runPreparationExclusive({ actor, attemptId }, () => learners.endAttempt(input));
  }

  async function continueLesson({ actor, attemptId, requestId, expectedRevision } = {}) {
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,17}$/u.test(requestId)) {
      throw trainingError("VIBE64_TRAINING_REQUEST_INVALID", "Use the same bounded continuation request when retrying.");
    }
    const saved = await learners.readState({ actor, includeCompletion: true });
    const previous = saved.progress.attempts.find(value => value.attemptId === attemptId);
    if (!previous?.ended) {
      throw trainingError("VIBE64_TRAINING_ATTEMPT_MISSING", "Continue this learner's exact ended lesson; retire its active attempt only when requested.");
    }
    // Keep source identity in the original request field, with no new journal.
    const scopedRequestId = `continue_${attemptId}_${requestId}`;
    const replay = saved.progress.attempts.find(value => value.requestIds?.includes(scopedRequestId));
    if (!replay && saved.active) {
      throw trainingError("VIBE64_TRAINING_ATTEMPT_CONFLICT", "Another lesson attempt is active. Resume it or explicitly end it; this continuation cannot adopt it.");
    }
    if (!replay && expectedRevision !== saved.revision) {
      throw trainingError("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read the current revision and retry the same continuation.");
    }
    // Pass the admitted revision unchanged. A racing start must fail the
    // original CAS, rather than silently join its same-pin active successor.
    const reserved = await learners.reserveAttempt({ actor, requestId: scopedRequestId, expectedRevision, pin: previous.pin });
    if (reserved.attempt.ended) return { ...reserved, previewReady: false };
    return prepareLesson({ actor, attemptId: reserved.attempt.attemptId });
  }

  async function prepareLesson({ actor, attemptId } = {}) {
    return learners.runPreparationExclusive({ actor, attemptId }, async () => {
      let saved = await learners.resumeAttempt({ actor, attemptId });
      const lesson = await content.readLesson({ ...saved.attempt.pin.topic,
        lessonCode: saved.attempt.pin.lesson.code, lessonHash: saved.attempt.pin.lesson.hash });
      if (!lesson.lesson.exercise) {
        if (saved.attempt.preparation.phase !== "reserved") {
          throw trainingError("VIBE64_TRAINING_PREPARATION_CONFLICT", "This lesson has no exercise but retains an exercise preparation checkpoint. Keep its progress and explicitly restart the lesson; no checkpoint was changed.");
        }
        return { ...saved, previewReady: false };
      }
      saved = await learners.beginPreparation({ actor, attemptId, expectedRevision: saved.revision });
      const { attempt } = saved;
      const initialSessionId = attempt.preparation.initialSessionId;
      let stage = "project";
      try {
        const exercise = await content.readExercise({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
        const training = {
          schemaVersion: 1, learnerKey: Buffer.from(saved.active.learnerId).toString("base64url"), attemptId,
          pin: attempt.pin, exercise: { kind: "bundled", sourcePath: exercise.sourcePath }
        };
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
          const runtime = await project.createRuntime({ inspectSource: false });
          let current;
          try { current = await runtime.getSession(initialSessionId, { inspectSource: false }); }
          catch (error) {
            if (error.code !== "vibe64_session_not_found") throw error;
            if (attempt.preparation.phase === "ready") throw trainingError("VIBE64_TRAINING_SESSION_MISSING", "Your prepared exercise session is missing. Ask the owner to restore it; this attempt cannot silently create a replacement.");
            // Prove the original exercise only before the first session exists.
            // Existing session source may contain the learner's unsaved edits.
            const source = await projectRepositoryService.verifyTrainingProjectSource({ slug: attempt.projectSlug, training }, { files: exercise.files });
            current = requireSuccess(await sessions.createSession({ vibe64User: actor }, { sessionId: initialSessionId, expectedCommit: source.commit }));
          }
          if (current.sessionId !== initialSessionId || current.status === "archived" || current.closing) {
            throw trainingError("VIBE64_TRAINING_SESSION_CONFLICT", "The reserved exercise session is unavailable. Keep your progress and ask the owner to inspect it; no alternative session was selected.");
          }
          if (current.workspaceSetup?.status === "succeeded" && !await terminals.workspaceSetupIsPrepared(initialSessionId)) {
            throw trainingError("VIBE64_TRAINING_SETUP_CHANGED", "Workspace setup no longer matches this exercise session. Use its existing setup recovery, then resume the same lesson; no replacement was created.");
          }
          return current;
        });
        stage = "setup";
        // Creating a session starts the original asynchronous Workspace setup.
        // A pending/failed setup is not success, and prepared is not running Preview.
        if (session.workspaceSetup?.status !== "succeeded") {
          const current = await learners.resumeAttempt({ actor, attemptId });
          if (["failed", "ambiguous", "required", "unconfigured"].includes(session.workspaceSetup?.status)) {
            if (attempt.preparation.phase === "ready") return { ...current, setup: session.workspaceSetup, previewReady: false };
            return { ...await learners.recordPreparationFailure({ actor, attemptId, expectedRevision: current.revision, initialSessionId,
              stage, code: "VIBE64_TRAINING_SETUP_INCOMPLETE", message: "Exercise Workspace setup is incomplete. Use the existing setup recovery, then resume this same lesson." }), previewReady: false };
          }
          return { ...current, setup: session.workspaceSetup || null, previewReady: false };
        }
        const current = await learners.resumeAttempt({ actor, attemptId });
        return { ...await learners.recordPreparationReady({ actor, attemptId, expectedRevision: current.revision, initialSessionId }), previewReady: false };
      } catch (error) {
        // Preserve the original error even if recording its bounded diagnosis
        // fails. Retrying reads the same saved identities before any effect.
        try {
          const current = await learners.resumeAttempt({ actor, attemptId });
          if (attempt.preparation.phase !== "ready") await learners.recordPreparationFailure({ actor, attemptId, expectedRevision: current.revision, initialSessionId,
            stage, code: String(error.code || "VIBE64_TRAINING_PREPARATION_FAILED").slice(0, 64),
            message: "Exercise preparation could not finish. Resume the same lesson; if it still fails, ask the owner to inspect the project, session and setup diagnostics." });
        } catch { /* Original failure remains authoritative. */ }
        throw error;
      }
    });
  }

  return Object.freeze({ startLesson, prepareLesson, endLesson, continueLesson });
}

export { createTrainingService };
