import { assistantGoalIsActive } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  assistantReplyAsksPerson,
  latestAssistantQuestionsAwaitingUserReply
} from "@local/vibe64-runtime/shared/conversationQuestions";
import { readWorkPlan } from "./assistantWorkPlan.js";
import { followupFitsPlan, personTurn, userTurnsSince, usesWorkPlan } from "./assistantRoutingRequests.js";
import { FOLLOWUP_OVERTAKEN_CODES } from "./assistantRoutingDelivery.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {import("./types.js").AssistantRoutingAdmission} AssistantRoutingAdmission */

// A turn's end waits this long between tries for a lock another operation holds, so the tries never spin.
const TURN_END_RETRY_MS = 250;
// What an owed automatic step, and one held for the person, tells them.
const OWED_STEPS = Object.freeze({
  planning: "Planning",
  implementation: "Implementation",
  review: "Senior's review",
  pass: "The plan's next pass"
});
const owedStep = (state) => `${OWED_STEPS[state.stage] || "The next step"} starts by itself once the current turn ends.`;
const HELD_FOR_PERSON = "A message came after Vibe64 decided this step, so it waits for you: Continue takes it.";
const HELD_FOR_QUESTION = "The last answer asks something, so this step waits for you: Continue takes it.";
const PLAN_CHANGED = "The plan changed before this step started. Read it and send a new request.";

/**
 * A request's automatic step (its next turn: Senior's review of a built plan, the next implementation turn, a pass, a
 * resume) that another turn or message came before is owed, never dropped: the server decides it again when a turn
 * ends, or at its own recovery, and no page has to be open for it. A message of the person's own since, Stop and
 * Cancel still end the automatic start.
 * @param {object} dependencies
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {AssistantRoutingAdmission} dependencies.admission
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>}
 *   dependencies.exclusiveAfterWrites The lock for what a turn leaves behind, which waits out a Save or Update.
 */
function createAssistantRoutingOwedSteps({ routingState, records, delivery, admission, agent, exclusiveAfterWrites }) {
  /**
   * The lock for what follows a Main chat turn, which is never lost to a busy lock, whoever holds it: it queues again
   * until it runs or routing closes, as it does behind a Save or Update, so nothing waits for a page to reconcile the
   * request. A temporary chat's turn end retries a busy lock itself (temporaryConversationLifecycle.js).
   */
  async function exclusiveAtTurnEnd(sessionId, options, operation) {
    for (;;) {
      try {
        return await exclusiveAfterWrites(sessionId, options, operation);
      } catch (error) {
        // Only Main chat's routing allows Auto.
        if (error?.code !== "vibe64_agent_write_mode_busy" || !routingState.allowAuto || admission.isClosing()) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, TURN_END_RETRY_MS));
    }
  }

  /**
   * A refused automatic step (the request's next turn, not sent) that another turn or message only came before: a
   * turn still running, a question or approval pending, or the conversation changed since the step was decided. The
   * step is owed, not dropped: the request waits with it until a turn ends, when it is decided again (continueOwed).
   * The conversation changed under a turn that has already ended, so that step is decided again at once. Any other
   * refusal is the caller's, as before.
   * @param {object} context
   * @param {object} state the saved routing request
   * @param {any} error the refusal
   * @param {{ decideNow?: boolean }} [options] decideNow: false when this refusal is already a decision made again
   * @returns {Promise<boolean>} whether the refusal left the step owed
   */
  async function oweRefusedStep(context, state, error, { decideNow = true } = {}) {
    if (!routingState.allowAuto || !state.followup || state.attemptedMessageId || state.stopped || state.cancelled ||
        !FOLLOWUP_OVERTAKEN_CODES.includes(error?.code)) return false;
    Object.assign(state, { status: "waiting", delivery: "pending", error: owedStep(state) });
    state.followup.owed = true;
    await records.save(context, state);
    if (decideNow && error.code === "vibe64_assistant_routing_continuation_changed") await continueOwed(context, state);
    return true;
  }

  /**
   * Whether the saved request still owes its step: waiting with it unsent (never attempted, so never sent twice), not
   * stopped or cancelled. A Continue the turn still running refused leaves it owed too.
   */
  const owesStep = (state) => Boolean(state?.followup?.owed) && state.status === "waiting" && state.delivery === "pending" &&
    !state.attemptedMessageId && !state.stopped && !state.cancelled;

  /**
   * The owed step decided again once the turn that came first has ended, from the conversation and plan as they are
   * now: it goes ahead unless something else still holds the chat (a turn running, a question or approval pending, a
   * goal), which leaves it owed until a turn ends again. A message of the person's own since the step was decided
   * waits for their Continue, and so does an answer since that asks something; a plan the step no longer fits needs a
   * new request. Another session's message, and Vibe64's own notes and follow-ups, are never the person's word on it.
   */
  async function continueOwed(context, state) {
    const sessionId = context.session.sessionId;
    const store = context.runtime.store;
    const native = await agent.sessionState(sessionId, context).catch(() => null);
    if (!native || native.ok === false || native.turn?.active || native.pendingRequests?.length || native.turn?.waitingForInput) return;
    if (assistantGoalIsActive((await records.currentGoal(sessionId, context)).goal)) return;
    const hold = async (fields) => {
      delete state.followup.owed;
      Object.assign(state, fields);
      await records.save(context, state);
    };
    const since = await userTurnsSince(store, sessionId, state.followup.lastUserMessageId);
    if (!since || since.some(personTurn)) return hold({ error: HELD_FOR_PERSON });
    if (since.length && assistantReplyAsksPerson(latestAssistantQuestionsAwaitingUserReply(
      await store.readConversationTail(sessionId, { userLimit: 1 })
    ))) {
      return hold({ error: HELD_FOR_QUESTION });
    }
    const plan = usesWorkPlan(state) ? await readWorkPlan(context).catch(() => null) : null;
    if (!followupFitsPlan(state, plan)) return hold({ error: PLAN_CHANGED });
    await records.refreshFollowup(context, state, plan);
    delete state.followup.owed;
    state.status = "working";
    delete state.error;
    await records.save(context, state);
    try {
      await delivery.deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
    } catch (error) {
      await settleRefusedStep(context, state, error, { decideNow: false });
    }
  }

  /**
   * A refused automatic step: owed when another turn or message only came before it (oweRefusedStep); otherwise it
   * waits for the person, with its delivery uncertain when its message may have left.
   * @param {object} context
   * @param {object} state the saved routing request
   * @param {any} error the refusal
   * @param {{ decideNow?: boolean }} [options] oweRefusedStep's
   */
  async function settleRefusedStep(context, state, error, options) {
    if (await oweRefusedStep(context, state, error, options)) return;
    state.status = "waiting";
    state.delivery = state.attemptedMessageId ? "uncertain" : "pending";
    state.error = error.message;
    await records.save(context, state);
  }


  return Object.freeze({
    exclusiveAtTurnEnd,
    oweRefusedStep,
    settleRefusedStep,
    owesStep,
    continueOwed
  });
}

export {
  createAssistantRoutingOwedSteps
};
