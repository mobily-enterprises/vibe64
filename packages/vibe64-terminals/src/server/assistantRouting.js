import { createAssistantRoutingState } from "./assistantRoutingState.js";
import { createAssistantRoutingRecords } from "./assistantRoutingRecords.js";
import { createAssistantRoutingDecisions } from "./assistantRoutingDecisions.js";
import { createAssistantRoutingDelivery } from "./assistantRoutingDelivery.js";
import { createAssistantRoutingCancellation } from "./assistantRoutingCancellation.js";
import { createAssistantRoutingAdmission } from "./assistantRoutingAdmission.js";
import { createAssistantRoutingOutcomes } from "./assistantRoutingOutcomes.js";
import { createAssistantRoutingGoals } from "./assistantRoutingGoals.js";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { NO_WRITES_WHILE_ASSISTANT_WORKS } from "./writesWhileAssistantWorks.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Main routing reports send timing and follows a completed plan (automatic
 * save); a sibling chat's routing does neither.
 */
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
 * @param {RuntimeLogger} dependencies.logger
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
 * @param {import("./types.js").WritesWhileAssistantWorks} [dependencies.writesWhileAssistantWorks] The Saves and
 *   Updates holding the agent-write lock while the AI works, which Stop and steers never wait for.
 * @param {(timing: object) => void} [dependencies.onTiming]
 * @param {(sessionId: string, details: object) => unknown} [dependencies.onPlanCompleted]
 */
function createAssistantRouting({
  systemRoot,
  allowAuto = true,
  agent,
  exclusive,
  dispatch,
  publish,
  prepareSelection,
  open,
  interrupt,
  discardPending,
  logger,
  writesWhileAssistantWorks = NO_WRITES_WHILE_ASSISTANT_WORKS,
  onTiming = doNothing,
  onPlanCompleted = followNoCompletedPlan
}) {
  const routingState = createAssistantRoutingState({ systemRoot, allowAuto });
  /**
   * The lock for what a turn leaves behind (its outcome, its after-turn review): a Save or Update holds the lock for
   * its whole run, so rather than give up after the usual wait while one holds it, this queues again.
   */
  async function exclusiveAfterWrites(sessionId, options, operation) {
    for (;;) {
      const writing = writesWhileAssistantWorks.holds(sessionId);
      const started = writesWhileAssistantWorks.started(sessionId);
      try {
        return await exclusive(sessionId, options, operation);
      } catch (error) {
        const writeBlocked = writing || writesWhileAssistantWorks.started(sessionId) !== started;
        if (error?.code !== "vibe64_agent_write_mode_busy" || !writeBlocked) throw error;
      }
    }
  }
  const records = createAssistantRoutingRecords({
    routingState,
    agent,
    publish
  });
  const decisions = createAssistantRoutingDecisions({
    records,
    agent,
    exclusive
  });
  const delivery = createAssistantRoutingDelivery({
    routingState,
    records,
    decisions,
    agent,
    dispatch,
    prepareSelection,
    interrupt,
    logger
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
    discardPending,
    writesWhileAssistantWorks,
    logger
  });
  const admission = createAssistantRoutingAdmission({
    routingState,
    records,
    decisions,
    delivery,
    cancellation,
    agent,
    exclusive,
    open,
    dispatch,
    interrupt,
    writesWhileAssistantWorks,
    onTiming,
    logger
  });
  const outcomes = createAssistantRoutingOutcomes({
    routingState,
    records,
    decisions,
    delivery,
    admission,
    agent,
    exclusive: exclusiveAfterWrites,
    publish,
    onPlanCompleted
  });
  const goals = createAssistantRoutingGoals({
    records,
    decisions,
    agent,
    prepareSelection
  });

  return Object.freeze({
    send: admission.send,
    cancel: cancellation.cancel,
    stop: cancellation.stop,
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
