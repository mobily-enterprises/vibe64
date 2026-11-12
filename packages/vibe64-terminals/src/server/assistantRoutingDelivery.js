import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { readWorkPlan, workPlanInstructions } from "./assistantWorkPlan.js";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  serializeVibe64AssistantSelection,
  sameVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import {
  assistantModeLabel,
  assistantModePrompt,
  assistantWorkflowInstructions,
  assistantGoalIsActive,
  assistantWorkflowRole,
  assistantTaskPurpose,
  uiPassRequest
} from "@local/vibe64-runtime/shared/assistantRouting";
import {
  ASSISTANT_FINISHING_STEPS,
  assistantFinishingParts
} from "@local/vibe64-runtime/shared/assistantFinishing";
import {
  failure,
  activeMessage,
  withSelection,
  usesWorkPlan,
  recentVisibleMessages,
  savesAutomatically
} from "./assistantRoutingRequests.js";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Delivery of a routed request, or of its follow-up, to the chosen AI, and the attribution its turn carries.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDecisions} dependencies.decisions
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, input: object, context: object) => Promise<object>} dependencies.dispatch
 * @param {(sessionId: string, selection: object, context: object) => Promise<unknown>} dependencies.prepareSelection
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.interrupt
 */
function createAssistantRoutingDelivery({
  routingState,
  records,
  decisions,
  agent,
  dispatch,
  prepareSelection,
  interrupt,
  logger
}) {
  async function deliver(sessionId, context, state, followup = false, inspectionOnly = false) {
    if (!routingState.allowAuto && state.mode === "auto") {
      throw failure("Auto is available in Main chat only. Cancel this request and choose Senior or Junior.", "vibe64_assistant_routing_auto_delivery_unavailable");
    }
    const store = context.runtime.store;
    context = { ...context, vibe64User: state.submittedBy };
    const modelRole = assistantWorkflowRole(state);
    const role = state.stage === "review" && modelRole === "senior" ? "review" : modelRole;
    const implementing = state.stage === "implementation";
    const followupLabel = state.stage === "review"
      ? `${assistantModeLabel(modelRole)} review`
      : state.stage === "planning" ? "Continue planning" : "Continue implementation";
    const selection = state.assignments[modelRole];
    const input = activeMessage(state);
    const messageId = input.messageId || state.messageId;
    const displayMessage = input.displayMessage || input.message;
    const selectedContext = withSelection(context, selection);
    selectedContext.expectedConnectionIdentity = decisions.destinations(state.decision || {})[modelRole]?.connectionIdentity;
    const uncertain = state.delivery === "uncertain";
    if (uncertain || state.attemptedMessageId === messageId) {
      // An inspection that fails decides nothing: the receipt stays unknown.
      const receipt = await agent.inspectMessageAdmission(sessionId, { messageId, threadId: state.threadId }, selectedContext)
        .catch(error => {
          logOperationalEvent(logger, "warn", {
            component: "vibe64.assistant_routing",
            event: "vibe64.assistant_routing.admission_inspection_failed",
            sessionId,
            messageId,
            code: error?.code,
            error: error?.message
          }, "A routed request's delivery could not be checked; it stays unconfirmed.");
          return null;
        });
      // Only the AI's proof that it never received the attempt makes it
      // unsent; a retry then sends it normally.
      if (receipt?.admission === "not-admitted") {
        delete state.attemptedMessageId;
        state.delivery = followup ? "pending" : "failed";
        state.status = "waiting";
        await records.save(context, state);
        if (inspectionOnly) return { status: "not-sent", messageId, error: "This request was not sent." };
      } else {
        if (inspectionOnly && receipt?.admission !== "accepted") return { ok: false, delivered: false, messageId };
        if (receipt?.admission !== "accepted") {
          throw failure(
            "Delivery is uncertain. Retry to check the receipt; this will not send a duplicate. Or Cancel this request so other messages can be sent.",
            "vibe64_assistant_routing_delivery_uncertain"
          );
        }
        await store.writeConversationUserMessage(sessionId, {
          messageId,
          text: displayMessage,
          attachments: followup ? [] : state.input.displayAttachments,
          turnMetadata: {
            ...(!followup ? state.input.turnMetadata : {}),
            assistantSelection: selection,
            assistantRouting: attribution(state, followup),
            ...(followup ? { actorId: "app", actorDisplayName: followupLabel } : {})
          }
        });
        state.status = "working";
        state.delivery = "accepted";
        state.turnId = receipt.turnId || "";
        delete state.error;
        await records.save(context, state);
        return { ok: true, delivered: true, messageId, threadId: state.threadId };
      }
    }
    // Explicit inspection may use only the original uncertain-receipt branch.
    // It cannot continue into selection, preparation or native dispatch.
    if (inspectionOnly) return null;
    if (followup && !routingState.allowAuto) {
      throw failure("Automatic follow-ups run in Main chat only. Cancel this follow-up and send a new request.", "vibe64_assistant_routing_followup_main_chat_only");
    }
    if (state.stopped) throw failure("This request was stopped. Send a new request to continue.", "vibe64_assistant_routing_delivery_stopped");
    await decisions.validateDecision(context, state, followup);
    records.mark(state.messageId, "deliver-validated");
    const currentSelection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    const expected = followup ? state.deliverySelection : state.observedSelection;
    const { goal, pinned } = await records.currentGoal(sessionId, context);
    const workflow = assistantGoalIsActive(goal) && pinned?.workflowEngineId;
    if ((workflow && workflow !== state.workflowEngineId) ||
        !sameVibe64AssistantSelection(currentSelection, expected) &&
          !sameVibe64AssistantSelection(currentSelection, state.deliverySelection)) {
      throw failure("The orchestrator changed while this request was being prepared. Cancel it and send a new request.", "vibe64_assistant_routing_orchestrator_changed");
    }
    if (state.helper) throw failure("The routing helper still needs cleanup before this request can be delivered.", "vibe64_assistant_routing_delivery_cleanup_required");
    const native = await agent.sessionState(sessionId, context);
    if (native?.turn?.active) throw failure("Wait for the current turn to finish before sending a new request.", "vibe64_assistant_routing_turn_active");
    // The goal read above is already inside this same exclusive section.
    if (followup && assistantGoalIsActive(goal)) {
      state.status = "waiting";
      state.error = "Finish or cancel the goal before resuming this workflow.";
      await records.save(context, state);
      return { ok: true, skipped: true };
    }
    if (followup && (native?.pendingRequests?.length || native?.turn?.waitingForInput)) {
      throw failure("Answer the pending question or approval before continuing.", "vibe64_assistant_routing_question_pending");
    }
    if (followup) {
      const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
      const messages = await recentVisibleMessages(store, sessionId, 5);
      if ((plan?.revision || null) !== state.followup.planRevision ||
          JSON.stringify(messages) !== JSON.stringify(state.followup.messages) || usesWorkPlan(state) &&
            plan?.status !== "active" &&
            !(state.stage === "review" && plan?.status === "completed")) {
        throw failure("The conversation or plan changed before continuation. Stop this handoff and send a new request.", "vibe64_assistant_routing_continuation_changed");
      }
    }
    if (!followup && state.mode === "auto" && state.input.planRevision) {
      const plan = await readWorkPlan(context);
      if (!plan || plan.status !== "active" || plan.revision !== state.input.planRevision) {
        throw failure("The active plan changed before execution started. Read it and send your execution request again.", "vibe64_assistant_routing_execution_plan_changed");
      }
    }
    const taskPurpose = assistantTaskPurpose(state.task);
    const includePlanInstructions = !taskPurpose && (state.mode === "auto" || ["senior", "junior"].includes(state.mode));
    // A UI pass's scope is the request its Genesis task receives, as a commit
    // range in the message is Deslop's.
    const request = state.task === "ui-pass" ? uiPassRequest(input.message, { explicit: true }) : input.message;
    const finishingParts = assistantFinishingParts(state);
    // A finishing turn without review follows its first part's own instructions.
    const firstPart = ASSISTANT_FINISHING_STEPS.find(({ id }) => id === finishingParts[0]);
    const finishingIntent = followup && !finishingParts.includes("review") && assistantTaskPurpose(firstPart?.genesisTask);
    let message = assistantModePrompt(role, request, {
      intent: taskPurpose || (state.stage === "review" ? finishingIntent || "review" : state.mode === "auto" ? state.reason : ""),
      // Auto's implementer leaves browser checks to Senior's review.
      browserReview: state.mode === "auto" && state.workflow && implementing && finishingParts.includes("review"),
      // Auto's Senior hands rework to Junior; a direct chat's own agent does it in its workflow.
      rework: state.mode === "auto" ? "junior" : state.workflow ? "self" : "report",
      planInstructions: includePlanInstructions ? workPlanInstructions(role) : ""
    });
    // A review renders Genesis's review task; a finishing turn without review
    // renders its first part's task, as an explicit Deslop renders deslop.
    let genesisTask = taskPurpose ? state.task : "";
    if (!genesisTask && state.stage === "review") {
      const first = followup && finishingParts[0];
      genesisTask = ASSISTANT_FINISHING_STEPS.find(({ id }) => id === first)?.genesisTask || "review";
    }
    if (state.workflow || state.mode === "auto" && state.stage === "planning") {
      message += "\n\n" + assistantWorkflowInstructions(state, { autoSave: savesAutomatically(context.session.metadata) });
    }
    await prepareSelection(sessionId, selection, context);
    state.deliverySelection = selection;
    // Save the delivery selection before the session selection changes. The
    // sending status adds no recovery meaning before dispatch, so one save
    // records both.
    state.status = "working";
    state.delivery = "sending";
    await records.save(context, state);
    selectedContext.session.metadata = {
      ...context.session.metadata,
      [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection)
    };
    await store.writeMetadataValue(sessionId, VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection(selection));
    records.mark(state.messageId, "selection-saved");
    const { onPromptSending = doNothing } = context;
    const result = await dispatch(sessionId, {
      ...(followup ? {} : state.input),
      messageId,
      message,
      displayMessage,
      // A finishing turn's task is Vibe64's choice, not the person's: without a
      // Blueprint it goes as written instead of becoming the Blueprint's task.
      ...(genesisTask ? { genesisTask, ...(!taskPurpose ? { automaticGenesisTask: true } : {}) } : {}),
      turnMetadata: {
        ...(!followup ? state.input.turnMetadata : {}),
        assistantRouting: attribution(state, followup),
        ...(followup ? { actor: "app", actorLabel: followupLabel } : {})
      },
      onPromptSending: async ({ threadId }) => {
        if (!followup) await onPromptSending({ threadId, assistantSelection: selection });
        state.threadId = threadId;
        state.attemptedMessageId = messageId;
        // Persist the attempt before dispatch, but keep a live send in progress.
        // Only a lost response or restart makes its delivery uncertain.
        await records.save(context, state);
      },
      onPromptRejected: async () => {
        delete state.attemptedMessageId;
        state.delivery = followup ? "pending" : "failed";
        state.status = "waiting";
        await records.save(context, state);
      }
    }, selectedContext);
    records.mark(state.messageId, "dispatched");
    if (result?.delivered !== true) throw failure(result?.error || "The assistant did not confirm delivery.", result?.code || "vibe64_assistant_routing_delivery_unconfirmed");
    // A Cancel that arrived during dispatch stops the turn this message started.
    if (records.isCancelling(sessionId, context, messageId)) {
      await interrupt(sessionId, context).catch((error) => logOperationalEvent(logger, "warn", {
        component: "vibe64.assistant_routing",
        event: "vibe64.assistant_routing.interrupt_failed",
        sessionId: sessionId,
        code: error?.code,
        error: error?.message
      }, "Stopping a cancelled message's turn failed; the cancel stays recorded."));
    }
    state.status = "working";
    state.delivery = "accepted";
    state.turnId = result.turnId || result.turn?.id || result.codexAgentTurn?.turnId || "";
    if (state.workflow === true || state.mode === "auto" && state.stage === "planning") {
      routingState.liveFollowupRequests.set(records.keyFor(sessionId, context), state.messageId);
    }
    delete state.error;
    await records.save(context, state);
    return { ...result, assistantRoutingRequest: state };
  }
  function attribution(state, followup) {
    const modelRole = assistantWorkflowRole(state);
    const destination = decisions.destinations(state.decision || {})[modelRole];
    let resolvedMode = state.resolvedMode;
    if (state.stage === "review" && (state.mode === "auto" || modelRole === "senior")) resolvedMode = "review";
    else if (assistantTaskPurpose(state.task) && resolvedMode === "senior") resolvedMode = assistantTaskPurpose(state.task);
    return {
      requestedMode: state.mode,
      resolvedMode,
      workflowEngineId: state.workflowEngineId,
      destination: state.assignments[modelRole],
      configuredSelection: destination?.configuredSelection,
      reason: state.reason || "",
      parentMessageId: followup ? state.messageId : "",
      settingsRevision: state.settingsRevision
    };
  }

  return Object.freeze({
    deliver
  });
}

export {
  createAssistantRoutingDelivery
};
