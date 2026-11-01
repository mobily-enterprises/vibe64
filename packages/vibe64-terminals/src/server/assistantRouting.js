import { createAssistantRoutingState } from "./assistantRoutingState.js";
import { doNothing } from "./doNothing.js";
import { createAssistantRoutingRecords } from "./assistantRoutingRecords.js";
import { createAssistantRoutingDecisions } from "./assistantRoutingDecisions.js";
import { createAssistantRoutingDelivery } from "./assistantRoutingDelivery.js";
import { createAssistantRoutingCancellation } from "./assistantRoutingCancellation.js";
import { createAssistantRoutingAdmission } from "./assistantRoutingAdmission.js";
import { createAssistantRoutingOutcomes } from "./assistantRoutingOutcomes.js";
import { createAssistantRoutingGoals } from "./assistantRoutingGoals.js";

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManager.js").createSessionAgentManager>} SessionAgentManager */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/sessionRealtimeEvents").createSessionChangedPublisher>} PublishSessionChanged */

// Main routing reports send timing and follows a completed plan (automatic
// save); a sibling chat's routing does neither.
function followNoCompletedPlan() {
  return "";
}

/**
 * The ordinary conversation owns delivery and history. This record only holds
 * the one request being prepared, its working plan snapshot and follow-up.
 * Cancel also needs the chat's context without the agent-write lock (open), the
 * interrupt Stop uses (interrupt), and the native attempt's discard, which runs
 * under that lock (discardPending).
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {boolean} [dependencies.allowAuto]
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>} dependencies.exclusive
 * @param {(sessionId: string, input: object, context: object) => Promise<object>} dependencies.dispatch
 * @param {PublishSessionChanged} dependencies.publish
 * @param {(sessionId: string, selection: object, context: object) => Promise<unknown>} dependencies.prepareSelection
 * @param {(sessionId: string, options: object) => Promise<object>} dependencies.open
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.interrupt
 * @param {typeof import("./assistantChangeover.js").discardAssistantChangeoverMessage} dependencies.discardPending
 * @param {(timing: object) => void} [dependencies.onTiming]
 * @param {(sessionId: string, details: object) => unknown} [dependencies.onPlanCompleted]
 */
function createAssistantRouting({ systemRoot, allowAuto = true, agent, exclusive, dispatch, publish, prepareSelection,
  open, interrupt, discardPending,
  onTiming = doNothing,
  onPlanCompleted = followNoCompletedPlan }) {
  const routingState = createAssistantRoutingState({ systemRoot, allowAuto });
  const records = createAssistantRoutingRecords({ routingState, agent, publish });
  const decisions = createAssistantRoutingDecisions({ records, agent, exclusive });
  const delivery = createAssistantRoutingDelivery({
    routingState,
    records,
    decisions,
    agent,
    dispatch,
    prepareSelection,
    interrupt
  });
  const cancellation = createAssistantRoutingCancellation({
    routingState,
    records,
    decisions,
    delivery,
    agent,
    exclusive,
    open,
    interrupt,
    discardPending
  });
  const admission = createAssistantRoutingAdmission({
    routingState,
    records,
    decisions,
    delivery,
    cancellation,
    agent,
    exclusive,
    dispatch,
    interrupt,
    onTiming
  });
  const outcomes = createAssistantRoutingOutcomes({
    routingState,
    records,
    decisions,
    delivery,
    admission,
    agent,
    exclusive,
    publish,
    onPlanCompleted
  });
  const goals = createAssistantRoutingGoals({ records, decisions, agent, prepareSelection });

  return Object.freeze({
    send: admission.send,
    cancel: cancellation.cancel,
    cancelMessage: cancellation.cancelMessage,
    isCancelled: cancellation.isCancelled,
    inspectDelivery: cancellation.inspectDelivery,
    recordOutcome: outcomes.recordOutcome,
    afterTurn: outcomes.afterTurn,
    prepareGoal: goals.prepareGoal,
    applyGoalSelection: goals.applyGoalSelection,
    reconcile: outcomes.reconcile,
    close: admission.close
  });
}

export {
  assistantRoutingRequestForMessage,
  assistantCancelledMessageIds,
  prepareCopiedAssistantRouting
} from "./assistantRoutingRequests.js";
export {
  createAssistantRouting
};
