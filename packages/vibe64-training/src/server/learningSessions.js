import { isDeepStrictEqual } from "node:util";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

function learningError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

// Training derives authority and instructions from the saved reservation. Main's
// original Project/Session/Runtime owners retain storage, routing and execution.
function createTrainingLearningSessions({ learners, teachingBrief, project, sessions } = {}) {
  if (typeof learners?.readLearningSessionScope !== "function" ||
      typeof learners?.runPreparationExclusive !== "function" ||
      typeof teachingBrief?.readBrief !== "function" ||
      typeof project?.createRuntime !== "function" ||
      typeof sessions?.createSession !== "function" || typeof sessions?.inspectSession !== "function") {
    throw new TypeError("Learning sessions require the existing learner, teaching brief, Project and Main session owners.");
  }

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

  return Object.freeze({ resolveContext, openSession });
}

export { createTrainingLearningSessions };
