import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { readWorkPlan } from "./assistantWorkPlan.js";
import {
  assistantModeLabel,
  assistantPlanPass,
  assistantRoutingGoalFromMetadata,
  assistantWorkflowMessageIds
} from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantRunsWholeChecks } from "@local/vibe64-runtime/shared/assistantWholeChecks";
import {
  ASSISTANT_PLAN_COMPLETION_MESSAGE,
  ASSISTANT_SENIOR_VERIFICATION_MESSAGE
} from "@local/vibe64-runtime/shared/assistantFinishing";
import { STATE_KEY, failure, usesWorkPlan, followupConversation } from "./assistantRoutingRequests.js";
import { ASSISTANT_PLAN_CHANGE_MESSAGE, ASSISTANT_PLAN_HANDOFF_MESSAGE } from "./assistantPlanHandoff.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */

/**
 * A routing request's records: its key, its saved state and change notices, the chat notices it
 * writes, the current goal, the routing helper's cleanup, its send timing marks and its next follow-up.
 * @param {object} dependencies
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {SessionAgentManager} dependencies.agent
 * @param {PublishSessionChanged} dependencies.publish
 */
function createAssistantRoutingRecords({
  routingState,
  agent,
  publish
}) {
  function mark(messageId, stage) {
    const timing = routingState.timings.get(messageId);
    if (timing) timing.stages[stage] = Math.round(performance.now() - timing.started);
  }

  const keyFor = (sessionId, context) => `${context.runtime.stateRoot}\0${sessionId}\0${context.routingConversationId || ""}`;

  const cancelKey = (sessionId, context, messageId) => `${keyFor(sessionId, context)}\0${messageId}`;
  const isCancelling = (sessionId, context, messageId) => routingState.cancelling.has(cancelKey(sessionId, context, messageId));
  async function save(context, state) {
    const sessionId = context.session.sessionId;
    if (assistantWorkflowMessageIds(state).some(id => isCancelling(sessionId, context, id) ||
        routingState.stopping.has(cancelKey(sessionId, context, id)))) {
      state.stopped = true;
      state.status = "waiting";
    }
    await context.runtime.store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(state));
    await announce(context, state);
  }
  function announce(context, state) {
    return publish(context.session.sessionId, {
      reason: "assistant-routing-changed",
      payload: {
        assistantRoutingRequest: state,
        clientRefresh: { includeList: false },
        ...(context.routingConversationId ? { conversationId: context.routingConversationId } : {})
      }
    });
  }
  async function writeNotice(context, state, notice) {
    if (!notice) return;
    const sessionId = context.session.sessionId;
    const conversationId = context.routingConversationId;
    const scope = conversationId ? { sessionId, conversationId } : sessionId;
    const turn = await context.runtime.store.writeConversationSystemMessage(scope, notice);
    if (turn) {
      await publish(sessionId, {
        reason: "assistant-routing-changed",
        payload: {
          assistantRoutingRequest: state,
          clientRefresh: { includeList: false },
          conversationLogPatch: {
            type: "upsert-turn",
            turn
          },
          ...(conversationId ? { conversationId } : {})
        }
      });
    }
  }
  async function currentGoal(sessionId, context) {
    const native = await agent.readGoal(sessionId, context);
    const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
    return { pinned, goal: native?.status === "available" ? native.goal : native?.goal || pinned };
  }
  async function cleanupHelper(context, state) {
    const helper = state.helper;
    if (!helper) return;
    const result = await agent.deleteEphemeralConversation(helper.scope, {
      conversationId: helper.conversationId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {}),
      cleanupExecutionId: helper.executionId || ""
    }, { assistantSelection: helper.selection, vibe64User: state.submittedBy });
    if (result?.ok !== true) throw failure("The routing helper could not be closed. Retry after reconnecting the assistant.", "vibe64_assistant_routing_helper_close_failed");
    const root = path.join(context.runtime.stateRoot, "assistant-helpers", helper.scope.id);
    if (helper.scope.runtimeRoot !== path.join(root, "runtime") || helper.scope.workdir !== path.join(root, "workdir")) {
      throw failure("The routing helper directory does not match its request.", "vibe64_assistant_routing_helper_directory_mismatch");
    }
    await rm(root, { recursive: true, force: true });
  }
  /**
   * Closes the routing helper and saves the request without it.
   */
  async function releaseHelper(context, state) {
    await cleanupHelper(context, state);
    state.helper = null;
    delete state.error;
    await save(context, state);
  }
  /**
   * The saved routing settings: their revision and the owner's and non-owners' assignments.
   */
  function readRoutingSettings() {
    return createAssistantRoutingStore({ systemRoot: routingState.systemRoot }).read();
  }

  /**
   * The request's next automatic turn: a plan's pass sends Genesis's request for its Passes item,
   * word for word, so Genesis recognises it as that pass's run;
   * Senior's planning turn after a plan handoff writes the plan from the request and the conversation;
   * every other stage continues the request's own work.
   */
  async function prepareFollowup(context, state, stage, { resumeNote = "" } = {}) {
    state.stage = stage;
    const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
    const pass = assistantPlanPass(state);
    const handoff = stage === "planning" ? state.planHandoff : null;
    const reviewer = state.mode === "auto" ? "Senior" : assistantModeLabel(state.resolvedMode);
    // Auto's Senior reviews a plan Junior implemented, and a Senior chat's its own built plan; without one it verifies
    // a review.
    const checksPlan = stage === "review" && (state.mode === "auto" || state.planReview === true) && state.planInvolved;
    let displayMessage = stage === "planning" ? "Continue planning." : "Continue implementation.";
    if (handoff) displayMessage = handoff.implementing ? "Senior changes the plan." : "Senior makes the plan.";
    if (stage === "review") displayMessage = checksPlan ? "Senior reviews the plan." : `Continue ${reviewer} review.`;
    let lead = "Continue the authorised work from its current state; preserve completed work and do not reduce scope.";
    // Senior changed the plan being implemented: the implementation goes on from the plan as it now is.
    if (stage === "implementation" && state.resumeImplementation) {
      lead = "Continue implementing the current plan: Senior has changed it, so read it again and work its remaining items in the plan's order. Preserve completed work and do not reduce scope.";
    }
    // The whole-project checks the person said Yes to go on from where the last turn stopped, never from the start.
    if (stage === "implementation" && assistantRunsWholeChecks(state)) {
      displayMessage = "Continue the whole-project checks.";
      lead = "Continue the whole-project checks the person asked for from where the last turn stopped: they run once in this request, never again, and what they found is fixed as new work.";
    }
    if (handoff) lead = handoff.implementing ? ASSISTANT_PLAN_CHANGE_MESSAGE : ASSISTANT_PLAN_HANDOFF_MESSAGE;
    if (stage === "review") lead = checksPlan ? ASSISTANT_PLAN_COMPLETION_MESSAGE : ASSISTANT_SENIOR_VERIFICATION_MESSAGE;
    const previous = handoff
      ? `The previous turn (${assistantModeLabel(handoff.role)}) handed this request to Senior and wrote no plan.`
      : `Previous outcome: ${state.outcome?.explanation || "The previous turn was interrupted or ended without a valid outcome."}`;
    const message = pass ? pass.request : [lead, `Original request: ${state.input.message}`,
      `Accepted steering: ${JSON.stringify(state.steering || [])}`, previous].join("\n\n");
    state.followup = {
      messageId: randomUUID(),
      planRevision: plan?.revision || null,
      ...await followupConversation(context.runtime.store, context.session.sessionId),
      // A turn resumed after an interruption leads with Vibe64's note of what interrupted it; a pass's own
      // request stays the message's last paragraph.
      displayMessage: pass ? pass.request : resumeNote ? "Continue after the interruption." : displayMessage,
      message: resumeNote ? `${resumeNote}\n\n${message}` : message,
      ...(resumeNote ? { resume: true } : {})
    };
    state.delivery = "pending";
    delete state.attemptedMessageId;
  }

  /**
   * The plan check's turn, the request's next: Vibe64's note asking the AI to bring the plan up to date with the turn
   * that just ended (state.planCheck names it), in the same stage. The chat shows it as Vibe64's note.
   * @param {object} context
   * @param {object} state
   * @param {{ message: string, displayMessage: string }} note
   */
  async function preparePlanCheck(context, state, note) {
    const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
    state.planCheck = { turnId: state.turnId };
    state.followup = {
      messageId: randomUUID(),
      planRevision: plan?.revision || null,
      ...await followupConversation(context.runtime.store, context.session.sessionId),
      displayMessage: note.displayMessage,
      message: note.message,
      planCheck: true
    };
    state.delivery = "pending";
    delete state.attemptedMessageId;
  }

  /**
   * The request's prepared step, unsent, decided again from the conversation and plan as they are now: what its
   * delivery compares with them. Its message, and so the step itself, stays as it was prepared.
   * @param {object} context
   * @param {object} state the saved routing request, with its prepared follow-up
   * @param {{ revision: string } | null} plan the current plan, when the request involves one
   */
  async function refreshFollowup(context, state, plan) {
    Object.assign(state.followup, await followupConversation(context.runtime.store, context.session.sessionId), {
      planRevision: plan?.revision || null
    });
  }

  return Object.freeze({
    mark,
    keyFor,
    cancelKey,
    isCancelling,
    save,
    announce,
    writeNotice,
    currentGoal,
    cleanupHelper,
    releaseHelper,
    readRoutingSettings,
    prepareFollowup,
    preparePlanCheck,
    refreshFollowup
  });
}

export {
  createAssistantRoutingRecords
};
