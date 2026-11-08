import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { readWorkPlan } from "./assistantWorkPlan.js";
import {
  assistantModeLabel,
  assistantRoutingGoalFromMetadata,
  assistantWorkflowMessageIds
} from "@local/vibe64-runtime/shared/assistantRouting";
import {
  assistantFinishingMessage
} from "@local/vibe64-runtime/shared/assistantFinishing";
import { STATE_KEY, failure, usesWorkPlan, recentVisibleMessages } from "./assistantRoutingRequests.js";

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
    if (assistantWorkflowMessageIds(state).some(id => isCancelling(sessionId, context, id))) {
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

  async function prepareFollowup(context, state, stage) {
    state.stage = stage;
    const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
    const reviewer = state.mode === "auto" ? "Senior" : assistantModeLabel(state.resolvedMode);
    state.followup = {
      messageId: randomUUID(),
      planRevision: plan?.revision || null,
      messages: await recentVisibleMessages(context.runtime.store, context.session.sessionId, 5),
      displayMessage: stage === "review"
        ? `Continue ${reviewer} review.`
        : stage === "planning" ? "Continue planning." : "Continue implementation.",
      message: [stage === "review"
        ? state.reviewMessage || assistantFinishingMessage({ review: true })
        : "Continue the authorised work from its current state; preserve completed work and do not reduce scope.",
      `Original request: ${state.input.message}`, `Accepted steering: ${JSON.stringify(state.steering || [])}`,
      // Each finishing turn covers every change since the last one, so a
      // stopped or unfinished earlier request's changes fold in here.
      ...(stage === "review" && state.unreviewed?.length ? [
        `Earlier requests whose changes no automatic review has covered yet; cover their changes too: ${JSON.stringify(state.unreviewed)}`
      ] : []),
      `Previous outcome: ${state.outcome?.explanation || "The previous turn was interrupted or ended without a valid outcome."}`].join("\n\n")
    };
    state.delivery = "pending";
    delete state.attemptedMessageId;
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
    prepareFollowup
  });
}

export {
  createAssistantRoutingRecords
};
