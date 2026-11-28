/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { VIBE64_ASSISTANT_ACCESS_ERROR_CODES } from "@local/vibe64-runtime/shared";
import { assistantRoutingGoalFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { turnInterruptionAccountWait } from "../shared/turnInterruptionText.js";
import { INTERRUPTION_CAUSE, awaitsAccount, interruptionNotice, nextTurnInterruptions, turnEnding } from "./turnInterruptions.js";

// An AI account its person can't use now: none connected, or another person's.
const ACCOUNT_REFUSALS = Object.freeze([VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE, VIBE64_ASSISTANT_ACCESS_ERROR_CODES.RESTRICTED]);
// The goal states setting an account continues: Claude's between turns (its checker still armed), and the pause a
// Codex account change made (JSKIT pauses the goal on the runtime still running its turn).
const CONTINUED_STATUSES = Object.freeze(["active", "paused"]);

/**
 * Whether a goal waits for an AI account its person can use: its intent still continues (its person has not paused,
 * stopped or cancelled it), no command of it is unconfirmed, and its latest interruption is marked with it.
 * @param {Record<string, any> | null} intent the goal's saved intent
 */
const goalWaitsForAccount = intent => Boolean(intent?.active) && !intent.pending && awaitsAccount(intent.interruptions, intent.id);

/**
 * A goal whose turn its AI account stopped, as a Main or temporary chat's turn is (assistantRoutingInterruptions.js):
 * a sign-out that ends its turn, an account change that paused it (Codex), or a restart whose continuation the account
 * refused marks the goal's own interruption record (awaitsAccount, naming its intent) instead of ending it for Resume
 * goal, and the sweep that follows every AI account set (serviceTurnsAfterAccountSet.js) continues it once, through
 * the goal's one resume (resumeGoal in serviceGoalInterruptions.js), as the person who set it. An account change that
 * leaves an account its person can use continues it at once. The person's Pause, Stop or Cancel ends its intent, and
 * with it the wait.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {(session: object) => any} dependencies.readGoalIntent
 * @param {(sessionId: string, context: object, change: (latest: any) => any) => Promise<unknown>} dependencies.changeGoalIntent
 * @param {(sessionId: string, options: object) => Promise<Record<string, any>>} dependencies.readCanonicalAgentGoal
 * @param {ReturnType<typeof import("./serviceGoalInterruptions.js").createServiceGoalInterruptions>} dependencies.goalInterruptions
 * @param {string} dependencies.goalRuntimeId this server's goal runtime
 * @param {(sessionId: string) => Promise<Record<string, any>>} dependencies.recoverSessionGoal a restart's continuation of
 *   a goal an earlier server ran
 */
function createServiceGoalAccountWait({
  state,
  logger,
  sessionAccess,
  assistantContext,
  sessionAgent,
  readGoalIntent,
  changeGoalIntent,
  readCanonicalAgentGoal,
  goalInterruptions,
  goalRuntimeId,
  recoverSessionGoal
}) {
  const log = (sessionId, event, fields, message) => logOperationalEvent(logger, "warn", {
    component: "vibe64.agent_goal",
    event: `vibe64.agent_goal.${event}`,
    projectSlug: sessionAccess.projectRuntimeContext().projectSlug,
    sessionId,
    ...fields
  }, message);

  /**
   * Marks the goal's latest interruption with its intent, its resume unsent, and the goal control says why; with
   * `notice`, its red entry says it waits, once (an account change that may continue at once marks it quietly first).
   * @param {string} sessionId
   * @param {object} context
   * @param {{ id: string }} intent the goal intent the account stopped
   * @param {{ key: string, cause: string, at: string, detail?: string }} interruption
   * @param {{ error?: string, notice?: boolean }} [options] error: the account's refusal; none after a sign-out
   * @returns {Promise<boolean>} whether it was marked: the same intent still continues, with no command unconfirmed
   */
  async function markForAccount(sessionId, context, intent, interruption, { error = "", notice = true } = {}) {
    let marked = false;
    await changeGoalIntent(sessionId, context, latest => {
      if (!latest?.active || latest.id !== intent.id || latest.pending) return null;
      const { history } = nextTurnInterruptions(latest.interruptions, interruption, Date.now(), { resumes: false });
      const detail = interruption.detail ? { detail: String(interruption.detail).slice(0, 500) } : {};
      marked = true;
      return {
        ...latest,
        interruptions: [...history.slice(0, -1), { ...history.at(-1), ...detail, resumedAt: null, awaitsAccount: latest.id }],
        error: turnInterruptionAccountWait(interruption.cause, error, { goal: true })
      };
    });
    if (marked && notice) {
      await goalInterruptions.writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "account", { goal: true, error }));
      const fields = { cause: interruption.cause, ...(error ? { error } : {}) };
      log(sessionId, "waiting_for_account", fields, "A goal its AI account stopped waits for an account its person can use.");
    }
    return marked;
  }

  /**
   * After a Main turn: a goal whose turn a sign-out ended (turnEnding's sign-in) waits for an account. Its intent,
   * still continuing, is the goal's: Claude's goal can't be read while it is signed out.
   * @param {string} sessionId
   * @param {object} payload the ended turn's publication, with its agent run
   * @returns {Promise<boolean>} whether it now waits
   */
  async function afterTurn(sessionId, payload) {
    try {
      const ending = turnEnding(payload?.payload?.agentRun || {});
      if (ending?.cause !== INTERRUPTION_CAUSE.SIGN_IN || state.lifecycle.closing) return false;
      const context = await assistantContext.assistantSessionOptions(sessionId);
      const intent = readGoalIntent(context.session);
      if (!intent?.active || intent.pending || !intent.native) return false;
      const interruption = { key: `goal:${intent.id}:${ending.cause}`, ...ending, at: new Date().toISOString() };
      return await markForAccount(sessionId, context, intent, interruption);
    } catch (error) {
      const fields = { code: error?.code, error: error?.message };
      log(
        sessionId,
        "account_wait_failed",
        fields,
        "A goal its AI account signed out of could not be marked to continue once an account is set; Resume goal continues it."
      );
      return false;
    }
  }

  /**
   * The last restart pass's refusal by the goal's AI account (none connected, or another person's) leaves the goal
   * waiting for an account instead of stopping it; any other failure, or a goal with a command unconfirmed, is not this.
   * @returns {Promise<boolean>} whether it now waits
   */
  async function waitAfterRestart(sessionId, context, intent, error) {
    if (!ACCOUNT_REFUSALS.includes(error?.code)) return false;
    const interruption = await goalInterruptions.interruptionOf(intent);
    if (!await markForAccount(sessionId, context, intent, interruption, { error: String(error.message || "").slice(0, 500) })) return false;
    await goalInterruptions.countUnresumed(interruption);
    return true;
  }

  /**
   * Once an AI account is set: a goal waiting for one continues once, as the person who set it, on the account
   * connected now, unless that person still can't use it, when it goes on waiting. The mark is cleared under the goal's
   * lock first, so another event, pass or server then finds nothing; a Claude goal a turn already carries on (the
   * person's message) needs nothing more. One an earlier server ran (a restart found it waiting, or left it so)
   * continues through that restart's own continuation, which first verifies that server's run stopped.
   * @param {string} sessionId
   * @returns {Promise<{ sessionId: string, resumed?: true, waiting?: true, skipped?: true, reason?: string, cancelled?: true,
   *   ok?: false }>} skipped's reason: not-waiting, closing, goal-<its status> or turn-at-work
   */
  async function continueAfterAccountSet(sessionId) {
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const intent = readGoalIntent(context.session);
    if (!goalWaitsForAccount(intent)) return { sessionId, skipped: true, reason: "not-waiting" };
    if (state.lifecycle.closing || sessionIsClosing(context.session)) return { sessionId, skipped: true, reason: "closing" };
    let claimed = null;
    await changeGoalIntent(sessionId, context, latest => {
      if (latest?.id !== intent.id || !goalWaitsForAccount(latest)) return null;
      const { awaitsAccount: _mark, ...entry } = latest.interruptions.at(-1);
      const interruptions = [...latest.interruptions.slice(0, -1), { ...entry, resumedAt: new Date().toISOString() }];
      claimed = { ...latest, interruptions, error: null };
      return claimed;
    });
    if (!claimed) return { sessionId, skipped: true, reason: "not-waiting" };
    const { key, cause, at, detail } = claimed.interruptions.at(-1);
    const interruption = { key, cause, at, ...(detail ? { detail } : {}) };
    try {
      // A goal an earlier server ran continues as a restart continues it, once that server's run is verified stopped.
      if (intent.daemonId !== goalRuntimeId) return await recoverSessionGoal(sessionId);
      const actor = await state.assistantRuntime.authorizeProjectMessage(intent.actor, sessionAccess.projectRuntimeContext().projectSlug);
      const pin = assistantRoutingGoalFromMetadata(context.session.metadata);
      const asActor = { ...context, vibe64User: actor, assistantSelection: pin?.selection || intent.selection };
      await sessionAgent.requireAssistantAccess(sessionId, asActor);
      const observed = await readCanonicalAgentGoal(sessionId, { vibe64User: actor });
      if (!CONTINUED_STATUSES.includes(observed.goal?.status)) return { sessionId, skipped: true, reason: `goal-${observed.goal?.status || "none"}` };
      const carriedOn = observed.goal.status === "active" && (await sessionAgent.sessionState(sessionId, asActor))?.turn?.active === true;
      if (carriedOn) return { sessionId, skipped: true, reason: "turn-at-work" };
      const result = await goalInterruptions.resumeGoal(sessionId, context, {
        intent: claimed, observed, actor, interruption, history: claimed.interruptions, newConnection: true
      });
      if (result?.code === "vibe64_goal_main_ai_changed") return { sessionId, cancelled: true };
      if (result?.ok === false) throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
      return { sessionId, resumed: true };
    } catch (error) {
      // An account its person still can't use: it goes on waiting.
      const refused = ACCOUNT_REFUSALS.includes(error?.code);
      const waits = refused && await markForAccount(sessionId, context, claimed, interruption, { error: error.message });
      if (waits) return { sessionId, waiting: true };
      const fields = { actor: String(intent.actor?.username || ""), code: error?.code, error: error?.message };
      log(
        sessionId,
        "account_set_continue_failed",
        fields,
        "A goal its AI account stopped could not continue after an AI account was set; Resume goal continues it."
      );
      await changeGoalIntent(sessionId, context, latest => latest?.active && latest.id === intent.id ? {
        ...latest,
        error: `Continuing the goal after an AI account was set failed: ${String(error?.message || "It could not be verified.").slice(0, 500)} ` +
          "Choose Resume goal to try again."
      } : null).catch(() => {});
      return { sessionId, ok: false, code: error?.code, error: error?.message };
    }
  }

  /**
   * A Codex account change paused the goal on the runtime still running its turn, which has now stopped (JSKIT): the
   * goal is marked as stopped by the account, and continues at once on the account connected now when its person can
   * use it, else once one is set, through the same continuation.
   * @param {string} sessionId
   * @param {{ threadId?: string }} [options] the paused goal's conversation
   */
  async function continueAfterAccountChange(sessionId, { threadId = "" } = {}) {
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const intent = readGoalIntent(context.session);
    if (!intent?.active || intent.pending || !threadId || intent.native?.threadId !== threadId || state.lifecycle.closing ||
        sessionIsClosing(context.session)) return { sessionId, skipped: true };
    const interruption = {
      key: `goal:${intent.id}:${INTERRUPTION_CAUSE.ENGINE}`,
      cause: INTERRUPTION_CAUSE.ENGINE,
      detail: "The signed-in AI account changed",
      at: new Date().toISOString()
    };
    await markForAccount(sessionId, context, intent, interruption, { notice: false });
    return continueAfterAccountSet(sessionId);
  }

  return Object.freeze({
    afterTurn,
    continueAfterAccountChange,
    continueAfterAccountSet,
    waitAfterRestart
  });
}

export {
  createServiceGoalAccountWait,
  goalWaitsForAccount
};
