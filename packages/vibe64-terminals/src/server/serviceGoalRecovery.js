/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { openProjectRuntimeRecords } from "./serviceSessionAccess.js";

// After a restart the AI can still be busy or slow to start, so a pass that
// could not continue every goal runs again after each of these delays. A goal
// continued at its usage limit's reset that cannot continue waits them too.
const GOAL_RECOVERY_RETRY_DELAYS_MS = Object.freeze([30_000, 2 * 60_000, 10 * 60_000]);

/**
 * Restart recovery of the open projects' active goals, which continues saved
 * intent and never repairs history.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {(sessionId: string) => Promise<object>} dependencies.recoverSessionGoal Continues one session's goal, or says why not.
 * @param {(session: object) => any} dependencies.readGoalIntent
 * @param {(sessionId: string, context: object, change: (latest: any) => any) => Promise<unknown>} dependencies.changeGoalIntent
 */
function createServiceGoalRecovery({
  state,
  logger,
  project,
  sessionAccess,
  assistantContext,
  recoverSessionGoal,
  readGoalIntent,
  changeGoalIntent
}) {
  /**
   * One pass over the open projects' goals. This is continuation of saved
   * intent, never history repair; a goal this server already continued is skipped.
   * @param {boolean} retrying Whether another pass follows a failure.
   */
  async function recoverGoalsPass(retrying) {
    const results = [];
    const reportFailure = (error, target) => {
      const result = { ...target, ok: false, code: error.code, error: error.message };
      results.push(result);
      logOperationalEvent(logger, "warn", {
        ...result,
        event: "vibe64.agent_goal.recovery_failed",
        component: "vibe64.agent_goal"
      }, "An active goal needs attention after server restart.");
    };
    /**
     * A failure names its project and the person who set the goal: session
     * IDs repeat across projects, so the operator needs both.
     */
    const recoverCurrentProject = async projectSlug => {
      for (const session of await sessionAccess.listOpenProjectRuntimeSessions()) {
        if (state.lifecycle.closing) break;
        try {
          results.push(await recoverSessionGoal(session.sessionId));
        } catch (error) {
          let actor = "";
          try {
            actor = String(readGoalIntent(session)?.actor?.username || "");
          } catch { /* An unreadable intent names no one. */ }
          try {
            const context = await assistantContext.assistantSessionOptions(session.sessionId);
            const expected = readGoalIntent(session);
            await changeGoalIntent(
              session.sessionId,
              context,
              latest => latest?.active && (latest.id === expected?.id || latest.restartOf === expected?.id) ? {
                ...latest,
                error: `Goal continuation after restart failed: ${String(error.message || "Recovery could not be verified.").slice(0, 500)}` +
                  (retrying ? " Vibe64 tries again shortly." : "")
              } : null
            );
          } catch { /* The original recovery failure remains visible in the operational log. */ }
          reportFailure(error, { projectSlug, sessionId: session.sessionId, ...(actor ? { actor } : {}) });
        }
      }
    };
    const listed = await project.listProjects();
    if (listed?.ok === false) throw new Error(listed.error || "Goal recovery could not list projects.");
    for (const projectRecord of openProjectRuntimeRecords(listed)) {
      if (state.lifecycle.closing) break;
      try {
        await project.runInProjectContext(projectRecord.slug, () => recoverCurrentProject(projectRecord.slug));
      } catch (error) {
        reportFailure(error, { projectSlug: projectRecord.slug });
      }
    }
    return { ok: results.every(result => result.ok !== false), results };
  }

  /**
   * Run once per daemon after all host admission and execution facilities are
   * configured. A goal it could not continue is tried again after each retry
   * delay; every pass skips a goal this server already continued, so none is
   * sent twice, and shutdown cancels the next pass.
   */
  function recoverActiveGoals({ retryDelaysMs = GOAL_RECOVERY_RETRY_DELAYS_MS } = {}) {
    if (state.lifecycle.goalRecovery) return state.lifecycle.goalRecovery;
    const retryAfter = (failed, delays) => {
      if (!failed || !delays.length || state.lifecycle.closing) return;
      const [delay, ...later] = delays;
      state.lifecycle.goalRecoveryTimer = setTimeout(() => {
        if (state.lifecycle.closing) return;
        state.lifecycle.goalRecoveryRetry = recoverGoalsPass(later.length > 0).then(result => retryAfter(!result.ok, later), error => {
          logOperationalEvent(logger, "warn", {
            component: "vibe64.agent_goal",
            event: "vibe64.agent_goal.recovery_failed",
            code: error.code,
            error: error.message
          }, "Active goals could not be recovered after server restart.");
          retryAfter(true, later);
        });
      }, delay);
      state.lifecycle.goalRecoveryTimer.unref();
    };
    state.lifecycle.goalRecovery = recoverGoalsPass(retryDelaysMs.length > 0);
    state.lifecycle.goalRecovery.then(result => retryAfter(!result.ok, retryDelaysMs), () => retryAfter(true, retryDelaysMs));
    return state.lifecycle.goalRecovery;
  }

  return recoverActiveGoals;
}

export {
  GOAL_RECOVERY_RETRY_DELAYS_MS,
  createServiceGoalRecovery
};
