import { lstat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { captureProjectRequestContext, currentProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

function learningError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

// Training derives authority and instructions from the saved reservation. Main's
// original Project/Session/Runtime owners retain storage, routing and execution.
function createTrainingLearningSessions({ learners, teachingBrief, project, sessions, projectContext, learningTeaching = null, practiceSessions = false } = {}) {
  if (typeof learners?.readLearningSessionScope !== "function" ||
      typeof learners?.runPreparationExclusive !== "function" ||
      typeof teachingBrief?.readBrief !== "function" ||
      typeof project?.createRuntime !== "function" ||
      typeof sessions?.createSession !== "function" || typeof sessions?.inspectSession !== "function") {
    throw new TypeError("Learning sessions require the existing learner, teaching brief, Project and Main session owners.");
  }

  if (typeof practiceSessions !== "boolean") {
    throw new TypeError("Practice Learning composition requires an explicit server construction choice.");
  }
  if (practiceSessions && (typeof learners.readExerciseProjectScope !== "function" ||
      typeof project?.runInProjectContext !== "function" ||
      typeof projectContext?.runWithPracticeProjectScope !== "function" ||
      projectContext.projectCatalogEnabled && typeof projectContext.runWithHostedTrainingProjectScope !== "function")) {
    throw new TypeError("Practice Learning requires the original saved learner and scoped Project owners.");
  }

  if (learningTeaching !== null && typeof learningTeaching?.bindConversation !== "function") {
    throw new TypeError("Learning teaching requires its original typed Training owner.");
  }

  async function resolveSourceLessContext({ actor, attemptId, sessionId, access = "observe" } = {}) {
    if (!["observe", "control", "write", "create"].includes(access)) {
      throw new TypeError("Use an explicit learning operation scope.");
    }
    const saved = await learners.readLearningSessionScope({ actor, attemptId });
    if ((access === "write" || access === "create") && (!saved.active || !saved.activeSummaryCurrent)) {
      throw learningError("VIBE64_TRAINING_ATTEMPT_INACTIVE", "Resume this exact confirmed active lesson before admitting new work. Historical conversations remain readable.");
    }
    if (access === "write" && !sessionId) {
      throw learningError("VIBE64_TRAINING_SESSION_REQUIRED", "Use the exact saved learning conversation.");
    }
    const context = Object.freeze({
      projectRuntimeRoot: saved.projectRuntimeRoot,
      systemRoot: saved.systemRoot,
      learningScope: Object.freeze(structuredClone(saved.scope)),
      vibe64User: actor,
      ...(learningTeaching ? { learningTeaching } : {}),
      ...(access === "create" ? {
        // The canonical Create action receives this host-only facility. The
        // opener rechecks the saved reservation under the original end lock;
        // transport input never selects the reserved session identity.
        createLearningSession: input => openSession({ actor, attemptId, input })
      } : {}),
      async learningInstructions(currentSessionId) {
        if (sessionId && currentSessionId !== sessionId) {
          throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Teaching instructions belong to this exact conversation.");
        }
        return readLearningInstructions({ actor, attemptId, saved, noExercise: true });
      }
    });
    if (sessionId) {
      await runWithProjectRequestContext(context, async () => {
        // The original Store checks the immutable owner/attempt/pin binding and
        // archive form. This read never creates a missing native workspace.
        const runtime = await project.createRuntime({ inspectSource: false });
        await runtime.store.readSession(sessionId);
      });
    }
    return context;
  }

  async function readLearningInstructions({ actor, attemptId, saved, noExercise }) {
    const readScope = noExercise ? learners.readLearningSessionScope : learners.readExerciseProjectScope;
    const before = await readScope.call(learners, { actor, attemptId });
    if (!before.active || !before.activeSummaryCurrent || !isDeepStrictEqual(before.scope, saved.scope)) {
      throw learningError("VIBE64_TRAINING_ATTEMPT_INACTIVE", "The lesson changed before teaching instructions were read.");
    }
    const brief = await teachingBrief.readBrief({ actor, attemptId });
    const after = await readScope.call(learners, { actor, attemptId });
    if (!after.active || !after.activeSummaryCurrent || !isDeepStrictEqual(after.scope, saved.scope) ||
        brief.attemptId !== attemptId || !brief.activeSummaryCurrent || (noExercise ? brief.lesson.exerciseRequired : !brief.lesson.exerciseRequired) ||
        !isDeepStrictEqual(brief.pin, saved.scope.pin)) {
      throw learningError("VIBE64_TRAINING_ATTEMPT_CHANGED", "The saved lesson changed while its instructions were read. Read the current attempt before continuing.");
    }
    const instructions = `You are the Main session teacher for this exact pinned lesson.\n${JSON.stringify(brief)}`;
    if (Buffer.byteLength(instructions) > 128 * 1024) {
      throw learningError("VIBE64_TRAINING_BRIEF_TOO_LARGE", "The teaching instructions exceed 128 KiB; no content was silently omitted.");
    }
    return instructions;
  }

  async function resolveContext(input = {}) {
    try { return await resolveSourceLessContext(input); }
    catch (error) {
      if (!practiceSessions || error.code !== "VIBE64_TRAINING_EXERCISE_REQUIRED") throw error;
      return resolveBoundPracticeContext(input);
    }
  }

  function boundPracticeContext(saved, actor, sessionId) {
    const current = currentProjectRequestContext();
    if (!current || current.slug !== saved.projectSlug || !current.targetRoot || !current.projectSessionSourceRoot ||
        !current.projectRuntimeRoot || sessionId !== saved.initialSessionId) {
      throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Use the actual saved practice Project and initial session.");
    }
    return Object.freeze({ ...current,
      learningScope: Object.freeze(structuredClone(saved.scope)), vibe64User: actor,
      ...(learningTeaching ? { learningTeaching } : {}),
      async learningInstructions(currentSessionId) {
        if (currentSessionId !== sessionId) {
          throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Teaching instructions belong to this exact conversation.");
        }
        return readLearningInstructions({ actor, attemptId: saved.scope.attemptId, saved, noExercise: false });
      }
    });
  }

  async function resolveBoundPracticeContext({ actor, attemptId, sessionId, access = "observe" }) {
    if (!["observe", "control", "write", "create"].includes(access)) throw new TypeError("Use an explicit learning operation scope.");
    const saved = await learners.readExerciseProjectScope({ actor, attemptId, access });
    if (!saved.initialSessionId) {
      throw learningError("VIBE64_TRAINING_SESSION_REQUIRED", "Prepare this saved practice session before opening it.");
    }
    if (sessionId && sessionId !== saved.initialSessionId) {
      throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Prepare and use this saved practice attempt's exact initial session.");
    }
    if (access === "write" && !sessionId) {
      throw learningError("VIBE64_TRAINING_SESSION_REQUIRED", "Use the exact saved learning conversation.");
    }
    let captured;
    await runPracticeOperation({ actor, attemptId, sessionId: saved.initialSessionId, access: "control" },
      () => { captured = captureProjectRequestContext(); }, true, false, access === "observe" && !sessionId);
    return Object.freeze({ ...captured,
      ...(access === "create" ? { createLearningSession: input => openSession({ actor, attemptId, input }) } : {}),
      runLearningOperation(operation) {
        if (typeof operation !== "function") throw new TypeError("Learning execution requires its owning callback.");
        return runPracticeOperation({ actor, attemptId, sessionId: saved.initialSessionId, access }, async () => {
          if (!isDeepStrictEqual(currentProjectRequestContext().learningScope, saved.scope)) {
            throw learningError("VIBE64_TRAINING_ATTEMPT_CHANGED", "Read this saved lesson's current authority before continuing.");
          }
          return operation();
        }, true, false);
      }
    });
  }

  async function runPreparationSessionContext({ actor, attemptId, sessionId } = {}, operation) {
    if (!practiceSessions || typeof operation !== "function") {
      throw new TypeError("Practice preparation requires its configured original context owner and owning callback.");
    }
    const saved = await learners.readExerciseProjectScope({ actor, attemptId, access: "create" });
    if (!sessionId || sessionId !== saved.initialSessionId) {
      throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Preparation belongs to this exact saved initial session.");
    }
    const run = () => runWithProjectRequestContext(boundPracticeContext(saved, actor, sessionId), operation);
    if (projectContext.projectCatalogEnabled) {
      return projectContext.runWithHostedTrainingProjectScope({ actor, training: saved.training, access: "create" }, run);
    }
    const current = projectContext.currentPracticeProjectScope();
    if (!current || current.access !== "create" || current.slug !== saved.projectSlug ||
        !isDeepStrictEqual(current.training, saved.training)) {
      throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Preparation requires its already-admitted exact practice scope.");
    }
    // prepareLesson already owns the non-reentrant preparation barrier.
    return run();
  }

  async function resolvePracticeContext(input = {}, operation) {
    return runPracticeOperation(input, operation, false, false);
  }

  async function runPracticeOperation({ actor, attemptId, sessionId, access = "observe" } = {}, operation, bindLearning, barrierHeld, allowMissingSession = false) {
    if (typeof operation !== "function" || typeof learners.readExerciseProjectScope !== "function" ||
        typeof projectContext?.runWithPracticeProjectScope !== "function") {
      throw new TypeError("Practice admission requires its saved learner, original Project context and owning callback.");
    }
    const run = async () => {
      const saved = await learners.readExerciseProjectScope({ actor, attemptId, access });
      if (sessionId && sessionId !== saved.initialSessionId) {
        throw learningError("VIBE64_TRAINING_SESSION_MISMATCH", "Use this saved practice attempt's exact initial session.");
      }
      const run = async () => {
        if (bindLearning) {
          if (!saved.initialSessionId) throw learningError("VIBE64_TRAINING_SESSION_REQUIRED", "Prepare this saved practice session before opening it.");
          return project.runInProjectContext(saved.projectSlug, () => runWithProjectRequestContext(
            boundPracticeContext(saved, actor, saved.initialSessionId), async () => {
              const runtime = await project.createRuntime({ inspectSource: false });
              try { await runtime.store.readSessionNativeDescriptor(saved.initialSessionId); }
              catch (error) {
                if (!allowMissingSession || error.code !== "vibe64_session_not_found") throw error;
              }
              return operation({ projectSlug: saved.projectSlug, initialSessionId: saved.initialSessionId });
            }));
        }
        if (sessionId) {
          await project.runInProjectContext(saved.projectSlug, async () => {
            const runtime = await project.createRuntime({ inspectSource: false });
            await runtime.store.readSession(sessionId);
          });
        }
        return operation({ projectSlug: saved.projectSlug,
          ...(saved.initialSessionId ? { initialSessionId: saved.initialSessionId } : {}) });
      };
      if (practiceSessions && projectContext.projectCatalogEnabled) {
        return project.runInProjectContext(saved.projectSlug, () => projectContext.runWithHostedTrainingProjectScope(
          { actor, training: saved.training, access }, run));
      }
      return projectContext.runWithPracticeProjectScope({ actor, training: saved.training, access }, run);
    };
    // End and fresh practice writes use the original preparation barrier.
    return !barrierHeld && (access === "create" || access === "write")
      ? learners.runPreparationExclusive({ actor, attemptId }, run)
      : run();
  }
  async function readSessions({ actor } = {}) {
    const state = await learners.readState({ actor });
    const summaries = [];
    for (const attempt of state.progress.attempts) {
      let context;
      try { context = await resolveContext({ actor, attemptId: attempt.attemptId, access: "observe" }); }
      catch (error) {
        // Exercise attempts use their real project, never this reserved namespace.
        if (error.code === "VIBE64_TRAINING_EXERCISE_REQUIRED" ||
            practiceSessions && error.code === "VIBE64_TRAINING_SESSION_REQUIRED") continue;
        if (practiceSessions && attempt.ended && error.code === "vibe64_project_path_not_accessible" &&
            error.cause?.code === "ENOENT") {
          const saved = await learners.readExerciseProjectScope({ actor, attemptId: attempt.attemptId, access: "observe" });
          const readRemoved = async () => {
            const state = await projectContext.readWorkspaceProjectState({ slug: saved.projectSlug });
            if (Object.keys(state.metadata).length) return false;
            for (const root of [state.projectContextRoot, state.projectRuntimeRoot,
              projectContext.projectSessionSourceRootForSlug(saved.projectSlug)]) {
              try { await lstat(root); return false; }
              catch (missing) { if (missing.code !== "ENOENT") throw missing; }
            }
            return true;
          };
          // An ended exercise may have been explicitly deleted. Retain its
          // evidence, but omit its conversation only after complete removal.
          // Partial deletion, unsafe paths and authority errors still fail.
          const removed = projectContext.projectCatalogEnabled ? await readRemoved()
            : await projectContext.runWithPracticeProjectScope({ actor, training: saved.training, access: "observe" }, readRemoved);
          if (removed) continue;
        }
        throw error;
      }
      const read = async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        let session;
        const saved = context.learningScope.noExercise ? null
          : await learners.readExerciseProjectScope({ actor, attemptId: attempt.attemptId });
        try { session = await runtime.store.readSessionSummary(saved?.initialSessionId || `learning-${attempt.attemptId}`); }
        catch (error) { if (error.code === "vibe64_session_not_found") return; throw error; }
        // The original Store validates the immutable learning binding. Project
        // only summary facts here: no transcript, native observation or paths.
        summaries.push({
          sessionId: session.sessionId, sessionName: session.sessionName,
          status: session.status, revision: session.revision,
          createdAt: session.createdAt, updatedAt: session.updatedAt,
          ...(session.archived === true ? { archived: true, archivedAt: session.archivedAt } : {}),
          purpose: "learning", learningAttemptId: attempt.attemptId,
          lessonCode: context.learningScope.pin.lesson.code,
          ...(!context.learningScope.noExercise ? { noExercise: false, projectSlug: context.slug } : {})
        });
      };
      await runWithProjectRequestContext(context, read);
    }
    return summaries;
  }

  async function openSession({ actor, attemptId, input = {} } = {}) {
    // The existing preparation lock also serializes lesson ending. No new
    // journal, session registry or replacement creation path is needed.
    return learners.runPreparationExclusive({ actor, attemptId }, async () => {
      const context = await resolveContext({ actor, attemptId, access: "create" });
      if (!context.learningScope.noExercise) {
        if (["repositoryBranch", "pullRequestNumber", "expectedCommit", "sourceContext", "sourcePath", "sourceRoot",
          "projectSessionSourceRoot", "createSessionSource"].some(name => Object.hasOwn(input, name))) {
          throw new TypeError("Reopening a saved lesson cannot select a different practice source.");
        }
        const saved = await learners.readExerciseProjectScope({ actor, attemptId, access: "create" });
        return runPracticeOperation({ actor, attemptId, sessionId: saved.initialSessionId, access: "create" },
          () => sessions.inspectSession(saved.initialSessionId), true, true);
      }
      const sessionId = `learning-${attemptId}`;
      return runWithProjectRequestContext(context, async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        let existing;
        try { existing = await runtime.store.readSession(sessionId); }
        catch (error) { if (error.code !== "vibe64_session_not_found") throw error; }
        if (existing) return sessions.inspectSession(sessionId);
        // Keep the original routing/access/metadata and atomic staging owner.
        // The server-reserved identity is never a browser-selected path.
        return sessions.createSession({ ...input, vibe64User: actor }, { sessionId });
      });
    });
  }

  return Object.freeze({ resolveContext, resolvePracticeContext, openSession, readSessions, runPreparationSessionContext });
}

export { createTrainingLearningSessions };
