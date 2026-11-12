/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

import { randomUUID } from "node:crypto";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";

// A goal continues this long after its AI account's usage limit resets, so a
// server clock slightly ahead of the AI's does not send it into the limit again.
const LIMIT_RESET_MARGIN_MS = 60_000;

/**
 * When a goal waiting at its AI account's usage limit can continue, in epoch
 * milliseconds: the reset the AI named (Claude), else the latest reset among
 * the account's used-up plan allowance windows (Codex). Null when the account
 * is out of credit or no reset time is known: the goal waits for the person.
 * @param {Record<string, any> | null | undefined} goal the native goal
 * @param {() => Promise<{ windows?: Array<{ remainingPercent?: number, resetsAt?: number | null }> } | null>} readPlanUsage
 * @returns {Promise<number | null>}
 */
async function goalUsageLimitResetAt(goal, readPlanUsage) {
  if (goal?.status !== "usageLimited" || goal.outOfCredit) return null;
  if (Number.isSafeInteger(goal.resetsAt) && goal.resetsAt > 0) return goal.resetsAt * 1000;
  const usage = await readPlanUsage().catch(() => null);
  const resets = (usage?.windows || []).filter(window => Number.isFinite(window?.remainingPercent) && window.remainingPercent <= 0 &&
    Number.isFinite(window.resetsAt) && window.resetsAt > 0).map(window => window.resetsAt * 1000);
  return resets.length ? Math.max(...resets) : null;
}

/**
 * A goal waiting at its AI account's usage limit continues by itself once the
 * limit has reset, unless the person pauses, stops or cancels it meanwhile; out
 * of credit, or when no reset time is known, it waits for the person. One timer
 * per session, for the goal intent that was waiting, continues the goal once
 * after the reset, as the person who set it. When an automatic continuation
 * meets the same limit again (a reset no later than that continuation), or
 * fails, the next waits the retry spacing; after the last the goal waits for
 * the person. Timers live only in this server: a restart, even after a kill
 * that ran no shutdown, schedules again from the saved goal and its reset time.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {readonly number[]} dependencies.retryDelaysMs
 * @param {(session: object) => any} dependencies.readGoalIntent
 * @param {(sessionId: string, context: object, change: (latest: any) => any) => Promise<unknown>} dependencies.changeGoalIntent
 * @param {(sessionId: string, options: object) => Promise<Record<string, any>>} dependencies.readCanonicalAgentGoal
 * @param {(sessionId: string, input: object, options: object) => Promise<Record<string, any>>} dependencies.writeAgentGoal
 */
function createServiceGoalLimitReset({
  state,
  logger,
  project,
  sessionAccess,
  assistantContext,
  sessionAgent,
  publishAgentSessionChanged,
  retryDelaysMs,
  readGoalIntent,
  changeGoalIntent,
  readCanonicalAgentGoal,
  writeAgentGoal
}) {
  /** @type {Map<string, { projectSlug: string, sessionId: string, intentId: string, resetAt: number, at: number, attempt: number, continuedAt: number, timer: NodeJS.Timeout | null }>} */
  const sessions = new Map();
  const keyFor = (projectSlug, sessionId) => JSON.stringify([projectSlug, sessionId]);
  const currentProjectSlug = () => sessionAccess.projectRuntimeContext().projectSlug;

  /**
   * Continues a goal at its usage limit's reset, once, as the person who set
   * it, when it is the same goal and still waiting; the person's Pause, Stop,
   * Resume or Cancel meanwhile leaves it alone. A failure shows on the goal.
   * @param {string} sessionId
   * @param {string} intentId the goal intent that was waiting
   * @param {{ retrying: boolean }} options whether another attempt follows a failure
   */
  async function continueGoal(sessionId, intentId, { retrying }) {
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const intent = readGoalIntent(context.session);
    if (!intent?.active || intent.id !== intentId || intent.pending || state.lifecycle.closing || sessionIsClosing(context.session) ||
        context.session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) return { sessionId, skipped: true };
    try {
      const actor = await state.assistantRuntime.authorizeProjectMessage(intent.actor, currentProjectSlug());
      const observed = await readCanonicalAgentGoal(sessionId, { vibe64User: actor });
      if (observed.goal?.status !== "usageLimited" || observed.goal.outOfCredit) return { sessionId, skipped: true };
      // A turn still working (the person's message) decides for itself; if the limit holds, its end schedules again.
      if ((await sessionAgent.sessionState(sessionId, { ...context, vibe64User: actor }))?.turn?.active === true) {
        return { sessionId, skipped: true };
      }
      const result = await writeAgentGoal(sessionId, {
        action: "resume",
        vibe64User: actor,
        expectedSegmentId: observed.target.segmentId,
        expectedGoalId: observed.goal.id,
        messageId: `goal-limit-reset-${randomUUID()}`
      }, { canonical: true, restartIntentId: intent.id });
      if (result?.code === "vibe64_goal_main_ai_changed") return { sessionId, cancelled: true };
      if (result?.ok === false) throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
      return { sessionId, resumed: true };
    } catch (error) {
      await changeGoalIntent(sessionId, context, latest => latest?.active && (latest.id === intentId || latest.restartOf === intentId) ? {
        ...latest,
        error: `Goal continuation after the usage limit reset failed: ${String(error.message || "It could not be verified.").slice(0, 500)}` +
          (retrying ? " Vibe64 tries again shortly." : "")
      } : null).catch(() => {});
      throw error;
    }
  }

  function fire(key, entry) {
    if (sessions.get(key) !== entry || state.lifecycle.closing) return;
    entry.timer = null;
    entry.continuedAt = Date.now();
    const retrying = entry.attempt < retryDelaysMs.length;
    const work = Promise.resolve()
      .then(() => project.runInProjectContext(entry.projectSlug, () => continueGoal(entry.sessionId, entry.intentId, { retrying })))
      .catch(error => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_goal",
          event: "vibe64.agent_goal.limit_reset_continue_failed",
          projectSlug: entry.projectSlug,
          sessionId: entry.sessionId,
          code: error?.code,
          error: error?.message
        }, "A goal could not continue after its usage limit reset.");
        if (!state.lifecycle.closing) schedule(entry);
      });
    state.trackShutdownWork(work);
  }

  /**
   * Starts, or keeps, the timer that continues a session's waiting goal once its usage limit has reset.
   * @param {{ projectSlug: string, sessionId: string, intentId: string, resetAt: number }} request
   * @returns {number | null} When it continues (epoch milliseconds), or null when it waits for the person.
   */
  function schedule({ projectSlug, sessionId, intentId, resetAt }) {
    const key = keyFor(projectSlug, sessionId);
    const previous = sessions.get(key);
    let at = resetAt + LIMIT_RESET_MARGIN_MS;
    let attempt = 0;
    if (previous?.continuedAt >= at) {
      attempt = previous.attempt + 1;
      if (attempt > retryDelaysMs.length) {
        clearTimeout(previous.timer);
        sessions.set(key, { ...previous, timer: null });
        return null;
      }
      at = previous.continuedAt + retryDelaysMs[attempt - 1];
    }
    if (previous?.timer && previous.intentId === intentId && previous.at === at) return at;
    clearTimeout(previous?.timer);
    const entry = { projectSlug, sessionId, intentId, resetAt, at, attempt, continuedAt: previous?.continuedAt ?? 0, timer: null };
    sessions.set(key, entry);
    entry.timer = setTimeout(() => fire(key, entry), Math.max(0, at - Date.now()));
    entry.timer.unref();
    return at;
  }

  /**
   * Schedules the continuation of a goal that is waiting at its usage limit.
   * @param {string} sessionId
   * @param {object} context the session's assistant options
   * @param {{ id: string }} intent the active goal intent
   * @param {Record<string, any>} goal the native goal
   * @returns {Promise<number | null>} When it continues (epoch milliseconds), or null when it waits for the person.
   */
  async function scheduleGoal(sessionId, context, intent, goal) {
    const resetAt = await goalUsageLimitResetAt(goal, () => sessionAgent.readPlanUsage(sessionId, context));
    if (resetAt === null) return null;
    return schedule({ projectSlug: currentProjectSlug(), sessionId, intentId: intent.id, resetAt });
  }

  /**
   * After each Main turn, and once a goal command is accepted: a goal that met
   * its AI account's usage limit is scheduled to continue once the limit has
   * reset, and its readers learn when. Its failure is logged.
   * @param {string} sessionId
   * @returns {Promise<number | null>} When it continues (epoch milliseconds).
   */
  async function continueWhenLimitResets(sessionId) {
    try {
      const context = await assistantContext.assistantSessionOptions(sessionId);
      const intent = readGoalIntent(context.session);
      if (!intent?.active || intent.pending || !intent.native || state.lifecycle.closing) return null;
      const native = await sessionAgent.readGoal(sessionId, context);
      if (native?.status !== "available" || native.goal?.status !== "usageLimited" || native.threadId !== intent.native.threadId ||
          native.goal.objective !== intent.native.objective) return null;
      const continuesAt = await scheduleGoal(sessionId, context, intent, native.goal);
      if (continuesAt !== null) await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
      return continuesAt;
    } catch (error) {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.agent_goal",
        event: "vibe64.agent_goal.limit_reset_schedule_failed",
        sessionId,
        code: error?.code,
        error: error?.message
      }, "A goal at its usage limit could not be scheduled to continue once the limit resets; it waits for Resume goal.");
      return null;
    }
  }

  /**
   * A goal read names when a goal waiting at its usage limit continues by
   * itself (resumesAt, epoch seconds), while that is scheduled.
   * @param {string} sessionId
   * @param {object} session
   * @param {Record<string, any> | null | undefined} goal
   */
  function withResumeTime(sessionId, session, goal) {
    if (goal?.status !== "usageLimited" || goal.outOfCredit) return goal;
    const intent = readGoalIntent(session);
    const entry = intent?.active ? sessions.get(keyFor(currentProjectSlug(), sessionId)) : null;
    return entry?.timer && entry.intentId === intent.id ? { ...goal, resumesAt: Math.ceil(entry.at / 1000) } : goal;
  }

  /** Shutdown cancels every scheduled continuation; the next server schedules them again. */
  function close() {
    for (const entry of sessions.values()) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  return Object.freeze({
    close,
    continueWhenLimitResets,
    scheduleGoal,
    withResumeTime
  });
}

export {
  LIMIT_RESET_MARGIN_MS,
  createServiceGoalLimitReset
};
