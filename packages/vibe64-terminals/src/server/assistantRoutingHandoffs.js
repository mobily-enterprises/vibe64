// A request handed on by the turn that could not do it: the plan handoff (a plan change only Senior may make goes to
// Senior's planning turn, assistantPlanHandoff.js) and the act handoff (an action a turn that may only answer or only
// plan was asked for goes to an implementation turn, assistantActHandoff.js). The plan command records the handoff
// for the running turn; when that turn completes unstopped, the same request continues in the turn that may do it,
// with no new message from the person, before any other outcome of the ended turn.
import { read, failure, assistantActHandsOn, assistantPlanHandsOff } from "./assistantRoutingRequests.js";
import { PLAN_HANDOFF_OPERATIONS, assistantPlanHandoffNotice } from "./assistantPlanHandoff.js";
import { assistantActHandoffNotice, assistantActingRole } from "./assistantActHandoff.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */

/**
 * @param {object} dependencies
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>}
 *   dependencies.exclusiveAfterWrites The lock for what a turn leaves behind, which waits out a Save or Update.
 * @param {(context: object, state: object, ended: string) => Promise<void>} dependencies.continueRecovered the owed
 *   step a server's recovery prepared (assistantRoutingOwedSteps.js)
 * @param {(context: object, state: object, error: any) => Promise<void>} dependencies.settleRefusedStep a refused
 *   automatic step, owed or waiting (assistantRoutingOwedSteps.js)
 */
function createAssistantRoutingHandoffs({ records, delivery, agent, exclusiveAfterWrites, continueRecovered, settleRefusedStep }) {
  /**
   * The plan command refused Auto's running turn a plan change only Senior may make (creating a plan, changing its
   * scope, reopening or archiving it), or the turn handed it over itself: the request is Senior's once this turn ends.
   */
  async function handPlanToSenior(sessionId, input, options) {
    return exclusiveAfterWrites(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!assistantPlanHandsOff(state) || input.messageId !== state.messageId || input.turnId !== state.turnId ||
          !PLAN_HANDOFF_OPERATIONS.includes(input.operation)) {
        throw failure("The plan handoff does not match the active Auto request and turn.", "vibe64_assistant_plan_handoff_mismatch");
      }
      const native = await agent.sessionState(sessionId, context);
      if (!native?.turn?.active || native.turn.id && native.turn.id !== state.turnId) {
        throw failure("Only the active turn can hand its plan change to Senior.", "vibe64_assistant_plan_handoff_turn_inactive");
      }
      state.planHandoff = {
        turnId: state.turnId,
        role: state.resolvedMode,
        reason: state.reason,
        operation: input.operation,
        // Handed over while implementing the plan: once Senior saves the change, the implementation goes on.
        // A request Router took for implementation that never worked on the plan is planning, which waits.
        ...(state.stage === "implementation" && state.planInvolved ? { implementing: true } : {})
      };
      await records.save(context, state);
      return { ok: true, handedTo: "senior" };
    });
  }

  /**
   * The turn whose plan change only Senior may make ended: the same request continues as Senior's planning turn, with
   * the conversation, and then follows planning's own outcomes. Handed over while implementing, the implementation
   * goes on once Senior saves the change.
   */
  async function continueWithSeniorPlan(context, state, { recovered, live, ended }) {
    Object.assign(state, { resolvedMode: "senior", reason: "planning", workflow: false, review: false, planInvolved: false });
    // An action the turn handed on too is the planning turn's to hand on once the plan is saved.
    delete state.actHandoff;
    if (state.planHandoff.implementing) state.resumeImplementation = true;
    state.steps = (state.steps || 0) + 1;
    state.stalledTurns = 0;
    delete state.outcome;
    await records.prepareFollowup(context, state, "planning");
    const notice = assistantPlanHandoffNotice(state);
    delete state.planHandoff;
    state.status = "working";
    await records.save(context, state);
    await records.writeNotice(context, state, notice);
    if (recovered && !live) return continueRecovered(context, state, ended);
    try {
      await delivery.deliver(context.session.sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
    } catch (error) {
      await settleRefusedStep(context, state, error);
    }
  }

  /**
   * `vibe64-helper plan act`: the running turn, which may only answer or only plan, was asked to act. The request is
   * an implementation turn's once this turn ends (continueActing).
   */
  async function handActionOn(sessionId, input, options) {
    return exclusiveAfterWrites(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!assistantActHandsOn(state) || input.messageId !== state.messageId || input.turnId !== state.turnId) {
        throw failure("The act handoff does not match the active request and turn.", "vibe64_assistant_act_handoff_mismatch");
      }
      const native = await agent.sessionState(sessionId, context);
      if (!native?.turn?.active || native.turn.id && native.turn.id !== state.turnId) {
        throw failure("Only the active turn can hand its request on.", "vibe64_assistant_act_handoff_turn_inactive");
      }
      state.actHandoff = { turnId: state.turnId, role: state.resolvedMode, reason: state.reason };
      await records.save(context, state);
      return { ok: true, handedTo: "implementation" };
    });
  }

  /**
   * The turn that could only answer or plan, asked to act, ended: the same request continues as an implementation
   * turn, Junior's after Auto's planning and the turn's own role otherwise, as Router's implementation would have, and
   * then follows implementation's own outcomes. Whatever plan the work involves its own outcome says.
   */
  async function continueActing(context, state, { recovered, live, ended }) {
    Object.assign(state, {
      resolvedMode: assistantActingRole(state),
      reason: "implementation",
      workflow: true,
      review: state.mode === "auto",
      planInvolved: false
    });
    for (const field of ["planPassNote", "resumeImplementation", "outcome"]) delete state[field];
    state.steps = (state.steps || 0) + 1;
    state.stalledTurns = 0;
    await records.prepareFollowup(context, state, "implementation");
    const notice = assistantActHandoffNotice(state);
    delete state.actHandoff;
    state.status = "working";
    await records.save(context, state);
    await records.writeNotice(context, state, notice);
    if (recovered && !live) return continueRecovered(context, state, ended);
    try {
      await delivery.deliver(context.session.sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
    } catch (error) {
      await settleRefusedStep(context, state, error);
    }
  }

  /**
   * The ended turn's handoff, decided before any other outcome: a completed, unstopped turn's own handoff continues the
   * request (a plan handoff first, whose planning turn hands an action on itself once the plan is saved); any other
   * turn's end drops it.
   * @param {object} context
   * @param {object} state the saved routing request
   * @param {{ state?: string }} run the ended turn
   * @param {{ recovered: boolean, live: boolean, ended: string }} schedule
   * @returns {Promise<boolean>} whether the request continued
   */
  async function continueHandedOn(context, state, run, schedule) {
    const completed = !state.stopped && run.state === "completed";
    if (state.planHandoff) {
      if (state.planHandoff.turnId === state.turnId && completed) {
        await continueWithSeniorPlan(context, state, schedule);
        return true;
      }
      delete state.planHandoff;
    }
    if (state.actHandoff) {
      if (state.actHandoff.turnId === state.turnId && completed) {
        await continueActing(context, state, schedule);
        return true;
      }
      delete state.actHandoff;
    }
    return false;
  }

  return Object.freeze({
    handPlanToSenior,
    handActionOn,
    continueHandedOn
  });
}

export {
  createAssistantRoutingHandoffs
};
