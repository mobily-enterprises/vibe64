/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

import { randomUUID } from "node:crypto";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

// The goal states Resume goal continues.
const RESUMABLE_GOAL_STATUSES = Object.freeze(["paused", "blocked", "usageLimited"]);

/**
 * What the person's chat messages do to a goal. After Stop, their next message
 * continues the still-active native goal and enrolls its continuation again.
 * When they ask Main Claude to resume or continue a paused, blocked or waiting
 * goal, Claude's Resume action saves that request as the goal's continuation
 * intent, and the goal continues once that turn ends, through the Resume goal
 * control's own canonical Resume, as that person.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {string} dependencies.goalRuntimeId this server's goal runtime
 * @param {(session: object) => any} dependencies.readGoalIntent
 * @param {(sessionId: string, context: object, change: (latest: any) => any) => Promise<unknown>} dependencies.changeGoalIntent
 * @param {(sessionId: string, options: object) => Promise<Record<string, any>>} dependencies.readCanonicalAgentGoal
 * @param {(sessionId: string, input: object, options: object) => Promise<Record<string, any>>} dependencies.writeAgentGoal
 */
function createServiceGoalChatContinuation({
  state,
  logger,
  sessionAccess,
  assistantContext,
  sessionAgent,
  goalRuntimeId,
  readGoalIntent,
  changeGoalIntent,
  readCanonicalAgentGoal,
  writeAgentGoal
}) {
  /**
   * Stop ends a goal's continuation until the person's next message, which
   * continues the still-active native goal: that message enrolls the same
   * goal's continuation again, so a restart during or after its turn continues
   * the goal, once. A paused, finished, cancelled or different goal is left alone.
   */
  async function continueAfterMessage(sessionId, options = {}) {
    try {
      const context = await assistantContext.assistantSessionOptions(sessionId, options);
      const intent = readGoalIntent(context.session);
      if (!intent || intent.active || intent.pending || !intent.native) return false;
      const native = await sessionAgent.readGoal(sessionId, context);
      if (native?.status !== "available" || native.goal?.status !== "active" || native.threadId !== intent.native.threadId ||
          native.goal.createdAt !== intent.native.createdAt || native.goal.objective !== intent.native.objective) return false;
      let enrolled = false;
      await changeGoalIntent(sessionId, context, latest => {
        if (latest?.id !== intent.id || latest.active) return null;
        enrolled = true;
        return { ...latest, active: true, daemonId: goalRuntimeId, error: null };
      });
      return enrolled;
    } catch (error) {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.agent_goal",
        event: "vibe64.agent_goal.message_continuation_failed",
        sessionId,
        code: error?.code,
        error: error?.message
      }, "A message continued the goal, but a restart may not continue it.");
      return false;
    }
  }

  /**
   * Main Claude's Resume action, at the person's request in chat: the goal the
   * turn observed continues once that turn ends. The request is saved as the
   * goal's continuation intent, so a restart before then continues it too;
   * Pause, Stop or Cancel meanwhile withdraw it.
   * @param {string} sessionId
   * @param {{ runtime: object, vibe64User: { username: string, role: string }, threadId: string, goal: Record<string, any> }} request
   */
  async function requestResume(sessionId, { runtime, vibe64User, threadId, goal }) {
    if (!RESUMABLE_GOAL_STATUSES.includes(goal?.status)) throw new Error("Only a paused, blocked or waiting goal can be resumed.");
    const context = await assistantContext.assistantSessionOptions(sessionId, { runtime, vibe64User });
    await changeGoalIntent(sessionId, context, latest => ({
      version: 1,
      ...latest,
      id: randomUUID(),
      active: true,
      daemonId: goalRuntimeId,
      restartOf: null,
      actor: { username: vibe64User.username, role: vibe64User.role },
      pending: null,
      error: null,
      native: { threadId, createdAt: goal.createdAt, objective: goal.objective },
      resumeRequested: true
    }));
  }

  const logResumeFailure = (sessionId, error) => logOperationalEvent(logger, "warn", {
    component: "vibe64.agent_goal",
    event: "vibe64.agent_goal.chat_resume_failed",
    sessionId,
    code: error?.code,
    error: error?.message
  }, "The goal the person asked to resume in chat could not continue.");

  /**
   * The Resume the person asked for, as the Resume goal control does it, as that
   * person; a goal no longer paused, blocked or waiting is left alone. A failure
   * shows on the goal.
   * @param {string} sessionId
   * @param {object} context the session's assistant options
   * @param {Record<string, any>} intent the claimed goal intent
   */
  async function resumeAsAsked(sessionId, context, intent) {
    try {
      const actor = await state.assistantRuntime.authorizeProjectMessage(intent.actor, sessionAccess.projectRuntimeContext().projectSlug);
      const observed = await readCanonicalAgentGoal(sessionId, { vibe64User: actor });
      if (!RESUMABLE_GOAL_STATUSES.includes(observed.goal?.status)) return;
      const result = await writeAgentGoal(sessionId, {
        action: "resume",
        vibe64User: actor,
        expectedSegmentId: observed.target.segmentId,
        expectedGoalId: observed.goal.id,
        messageId: `goal-chat-resume-${randomUUID()}`
      }, { canonical: true, continuesIntentId: intent.id });
      if (result?.ok === false) throw Object.assign(new Error(result.error || "Goal resume failed."), result);
    } catch (error) {
      logResumeFailure(sessionId, error);
      await changeGoalIntent(sessionId, context, latest => latest?.active && latest.id === intent.id ? {
        ...latest,
        error: `Resuming the goal as asked in chat failed: ${String(error.message || "It could not be verified.").slice(0, 500)} ` +
          "Choose Resume goal to try again."
      } : null).catch(() => {});
    }
  }

  /**
   * After a Main turn: a Resume the person asked for in it continues the goal,
   * once, unless they paused, stopped or cancelled it meanwhile. It runs beside
   * the turn's other follow-up work, as a press of Resume goal would.
   * @param {string} sessionId
   * @returns {Promise<boolean>} Whether a requested Resume was found.
   */
  async function resumeAfterTurn(sessionId) {
    try {
      const context = await assistantContext.assistantSessionOptions(sessionId);
      const intent = readGoalIntent(context.session);
      if (!intent?.active || !intent.resumeRequested || intent.pending || state.lifecycle.closing) return false;
      let claimed = false;
      await changeGoalIntent(sessionId, context, latest => {
        if (latest?.id !== intent.id || !latest.active || !latest.resumeRequested) return null;
        claimed = true;
        return { ...latest, resumeRequested: false };
      });
      if (claimed) void state.trackShutdownWork(resumeAsAsked(sessionId, context, intent));
      return claimed;
    } catch (error) {
      logResumeFailure(sessionId, error);
      return false;
    }
  }

  return Object.freeze({
    continueAfterMessage,
    requestResume,
    resumeAfterTurn
  });
}

export {
  RESUMABLE_GOAL_STATUSES,
  createServiceGoalChatContinuation
};
