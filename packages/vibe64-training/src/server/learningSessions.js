import { isDeepStrictEqual } from "node:util";
import { learningGuidanceText } from "../shared/learningGuidance.js";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

function learningError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

const deferredGuidanceCodes = new Set([
  "conversation_busy", "conversation_not_steerable", "vibe64_opencode_conversation_busy",
  "vibe64_codex_app_server_runtime_busy", "vibe64_agent_write_mode_busy"
]);

// Training derives authority and instructions from the saved reservation. Main's
// original Project/Session/Runtime owners retain storage, routing and execution.
// Only a lesson without an exercise has a learning session; a practice
// project's sessions are ordinary project sessions (Learning v2).
function createTrainingLearningSessions({ learners, teachingBrief, project, sessions, terminals = null, learningTeaching = null } = {}) {
  if (typeof learners?.readLearningSessionScope !== "function" ||
      typeof learners?.runPreparationExclusive !== "function" ||
      typeof teachingBrief?.readBrief !== "function" ||
      typeof project?.createRuntime !== "function" ||
      typeof sessions?.createSession !== "function" || typeof sessions?.inspectSession !== "function") {
    throw new TypeError("Learning sessions require the existing learner, teaching brief, Project and Main session owners.");
  }

  if (learningTeaching !== null && typeof learningTeaching?.bindConversation !== "function") {
    throw new TypeError("Learning teaching requires its original typed Training owner.");
  }

  // An exercise attempt is refused with VIBE64_TRAINING_EXERCISE_REQUIRED by
  // the saved-scope reader: its practice project uses the normal project routes.
  async function resolveContext({ actor, attemptId, sessionId, access = "observe" } = {}) {
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
      trainingLearners: learners,
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
        return readLearningInstructions({ actor, attemptId, saved });
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

  async function readLearningInstructions({ actor, attemptId, saved }) {
    const before = await learners.readLearningSessionScope({ actor, attemptId });
    if (!before.active || !before.activeSummaryCurrent || !isDeepStrictEqual(before.scope, saved.scope)) {
      throw learningError("VIBE64_TRAINING_ATTEMPT_INACTIVE", "The lesson changed before teaching instructions were read.");
    }
    const brief = await teachingBrief.readBrief({ actor, attemptId });
    const after = await learners.readLearningSessionScope({ actor, attemptId });
    if (!after.active || !after.activeSummaryCurrent || !isDeepStrictEqual(after.scope, saved.scope) ||
        brief.attemptId !== attemptId || !brief.activeSummaryCurrent || brief.lesson.exerciseRequired ||
        !isDeepStrictEqual(brief.pin, saved.scope.pin)) {
      throw learningError("VIBE64_TRAINING_ATTEMPT_CHANGED", "The saved lesson changed while its instructions were read. Read the current attempt before continuing.");
    }
    const instructions = `You are the Main session teacher for this exact pinned lesson.\n${JSON.stringify(brief)}`;
    if (Buffer.byteLength(instructions) > 128 * 1024) {
      throw learningError("VIBE64_TRAINING_BRIEF_TOO_LARGE", "The teaching instructions exceed 128 KiB; no content was silently omitted.");
    }
    return instructions;
  }

  async function readSessions({ actor } = {}) {
    const state = await learners.readState({ actor });
    const summaries = [];
    for (const attempt of state.progress.attempts) {
      let context;
      try { context = await resolveContext({ actor, attemptId: attempt.attemptId, access: "observe" }); }
      catch (error) {
        // Exercise attempts use their ordinary practice project sessions.
        if (error.code === "VIBE64_TRAINING_EXERCISE_REQUIRED") continue;
        throw error;
      }
      const read = async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        let session;
        try { session = await runtime.store.readSessionSummary(`learning-${attempt.attemptId}`); }
        catch (error) { if (error.code === "vibe64_session_not_found") return; throw error; }
        // The original Store validates the immutable learning binding. Project
        // only summary facts here: no transcript, native observation or paths.
        summaries.push({
          sessionId: session.sessionId, sessionName: session.sessionName,
          status: session.status, revision: session.revision,
          createdAt: session.createdAt, updatedAt: session.updatedAt,
          ...(session.archived === true ? { archived: true, archivedAt: session.archivedAt } : {}),
          purpose: "learning", learningAttemptId: attempt.attemptId,
          lessonCode: context.learningScope.pin.lesson.code
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

  // An ended attempt can no longer supply teaching instructions, so its saved
  // source-less conversation's agent work cannot continue. Stop it through the
  // original session Stop owner that Archive uses; the session and history
  // remain. A missing or archived session has no live work. A practice
  // project's sessions are ordinary project sessions the learner keeps using,
  // so ending its lesson stops nothing there.
  async function stopAttemptSessions({ actor, attemptId } = {}) {
    if (typeof terminals?.closeSessionTerminals !== "function") return { stopped: 0 };
    let context;
    try { context = await resolveContext({ actor, attemptId, access: "control" }); }
    catch (error) {
      if (["VIBE64_TRAINING_EXERCISE_REQUIRED", "VIBE64_TRAINING_SESSION_REQUIRED", "vibe64_session_not_found"].includes(error.code)) return { stopped: 0 };
      throw error;
    }
    const sessionId = `learning-${attemptId}`;
    const run = async () => {
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      if (session.archived === true || session.status === "archived") return { stopped: 0 };
      const result = await terminals.closeSessionTerminals(sessionId, { session });
      if (result?.ok === false) {
        throw learningError(result.code || "VIBE64_TRAINING_SESSION_STOP_FAILED",
          result.error || "The ended lesson's assistant could not be stopped. Retry the same end request.");
      }
      return { stopped: 1 };
    };
    try {
      return await runWithProjectRequestContext(context, run);
    } catch (error) {
      if (error.code === "vibe64_session_not_found") return { stopped: 0 };
      throw error;
    }
  }

  async function guideTask({ actor, actorId, attemptId, sessionId, guidanceId, requestContext, task, evidence } = {}) {
    if (typeof terminals?.openBrowserConversation !== "function") {
      throw learningError("VIBE64_TRAINING_POLLING_GUIDANCE_UNAVAILABLE", "This installation cannot open the saved Main teacher conversation.");
    }
    if (!actor || typeof actorId !== "string" || !actorId || typeof guidanceId !== "string" || !guidanceId ||
        !requestContext || !task || task.attemptId !== attemptId || task.sessionId !== sessionId || !evidence) {
      throw new TypeError("Learning guidance requires its exact actor, task, evidence and retained request context.");
    }
    const context = await resolveContext({ actor, attemptId, sessionId, access: "write" });
    const run = async () => {
      const conversation = await terminals.openBrowserConversation(sessionId, { vibe64User: actor,
        browserAuthority: { learningAttemptId: attemptId, sessionId, actorId, requestContext } });
      const current = await conversation.read({ limit: "1" });
      if (current.status !== "ready") return { status: "deferred" };
      try {
        const receipt = await conversation.wake({ messageId: guidanceId, text: learningGuidanceText(task, evidence),
          data: { learningGuidance: { attemptId, sessionId, pin: task.pin, evidence,
            progress: task.progress, criterion: task.criterion } } });
        return { status: receipt?.duplicate === true ? "duplicate" : "accepted" };
      } catch (error) {
        if (deferredGuidanceCodes.has(error.code)) return { status: "deferred" };
        throw error;
      }
    };
    return runWithProjectRequestContext(context, run);
  }

  return Object.freeze({ resolveContext, openSession, readSessions, guideTask, stopAttemptSessions });
}

export { createTrainingLearningSessions };
