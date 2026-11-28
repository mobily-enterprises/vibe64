import path from "node:path";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { readWorkPlan } from "./assistantWorkPlan.js";
import { workPlanInstructions } from "./assistantWorkPlanInstructions.js";
import { listSessionPasses } from "./planPasses.js";
import { sessionConnectedRoots } from "@local/vibe64-core/server/projectRepository";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  serializeVibe64AssistantSelection,
  sameVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import {
  assistantModeLabel,
  assistantPlanPass,
  assistantPlanReviewPass,
  assistantModePrompt,
  assistantWorkflowInstructions,
  assistantGoalIsActive,
  assistantWorkflowRole
} from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantTaskPurpose, uiPassRequest } from "@local/vibe64-runtime/shared/assistantExplicitTask";
import {
  assistantPassInstructions,
  assistantPlanCompletionFollows,
  assistantPlanReviewMessage
} from "@local/vibe64-runtime/shared/assistantFinishing";
import {
  WHOLE_CHECKS_LABEL,
  WHOLE_CHECKS_OFFERED_NOTE,
  assistantRunsWholeChecks,
  assistantWholeChecksInstructions
} from "@local/vibe64-runtime/shared/assistantWholeChecks";
import { workPlanLastPass } from "../shared/assistantWorkPlan.js";
import {
  failure,
  activeMessage,
  withSelection,
  usesWorkPlan,
  receiptTurnId,
  recentVisibleMessages,
  savesAutomatically
} from "./assistantRoutingRequests.js";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { plannedRestart } from "@local/vibe64-core/server/plannedRestart";
import { PLANNED_RESTART_REFUSAL_CODE } from "@local/vibe64-core/server/plannedRestartNotice";
import { PLAN_CHECK_LABEL, planCheckStart, rememberPlanCheckStart } from "./assistantPlanCheck.js";
import { MAIN_CHAT_NOTE_TURN_METADATA_KEY } from "./mainChatNote.js";
import { runWithoutActionRequest } from "@local/vibe64-core/server/projectRequestContext";

// The refusals of an automatic step that mean only that another turn or message came first: a turn still running, a
// question or approval pending, or the conversation changed since the step was decided. The step is owed, not dropped
// (assistantRoutingOutcomes.js).
const FOLLOWUP_OVERTAKEN_CODES = Object.freeze([
  "vibe64_assistant_routing_turn_active",
  "vibe64_assistant_routing_question_pending",
  "vibe64_assistant_routing_continuation_changed"
]);

/**
 * The names of the session's own copies of its connected repositories, each at ../connected/<name>.
 * @param {{ metadata?: Record<string, string> }} session
 */
function connectedCopyNames(session) {
  return sessionConnectedRoots(session).map((root) => path.basename(root));
}

/**
 * What started a follow-up turn Vibe64 sends by itself, as its session timeline line names it in place of a request:
 * its step (the plan check, the whole-project checks, a pass, a resume after an interruption, or the request's next
 * stage: planning, implementation or Senior's review).
 * @param {object} state the routing request being delivered
 * @param {{ planCheck: boolean, checks: boolean, pass: object | null }} step
 */
function followupTimelineTrigger(state, { planCheck, checks, pass }) {
  const name = planCheck ? "plan-check" : checks ? "whole-checks" : pass ? "pass"
    : state.followup?.resume === true ? "resume" : state.stage || "implementation";
  return `follow-up:${name}`;
}

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
 * @param {import("./types.js").ServerRun} dependencies.serverRun This editor process's run, which each delivery names
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} dependencies.listPasses The passes Genesis
 *   offers for the session's source, whose exact titles a turn that may write a plan's Passes is told
 */
function createAssistantRoutingDelivery({
  routingState,
  records,
  decisions,
  serverRun,
  agent,
  dispatch,
  prepareSelection,
  interrupt,
  listPasses,
  logger
}) {
  /**
   * The exact title of each pass Genesis offers the session's source, for the plan guidance of a turn that may write
   * the plan's Passes (any role but Junior, which never changes them); null when Genesis's list can't be read, and the
   * guidance then says the plan command lists them when it refuses a name.
   */
  async function passTitlesFor(context, role) {
    if (role === "junior") return null;
    try {
      return (await listSessionPasses(listPasses, context.session)).passes.map(({ title }) => title);
    } catch {
      return null;
    }
  }

  /**
   * Delivers the request's turn: the person's message, or its follow-up (`followup`). A follow-up Vibe64 sends by
   * itself runs without any request and names its step in its timeline line; one the person's Continue sends
   * (`context.continuedByPerson`) is theirs, under their request.
   */
  async function deliver(sessionId, context, state, followup = false, inspectionOnly = false) {
    if (!routingState.allowAuto && state.mode === "auto") {
      throw failure("Auto is available in Main chat only. Cancel this request and choose Senior or Junior.", "vibe64_assistant_routing_auto_delivery_unavailable");
    }
    const store = context.runtime.store;
    context = { ...context, vibe64User: state.submittedBy };
    const modelRole = assistantWorkflowRole(state);
    // A plan's pass is its own Senior turn on that pass's purpose; Senior's review of a plan may run its Review pass too.
    const pass = assistantPlanPass(state);
    const reviewPass = assistantPlanReviewPass(state);
    const taskPurpose = assistantTaskPurpose(pass?.id || state.task);
    let role = state.stage === "review" && modelRole === "senior" ? "review" : modelRole;
    if (pass) role = taskPurpose;
    // Vibe64's plan check after a turn that changed the source but not the plan: a note, not a workflow step.
    const planCheck = followup && state.followup?.planCheck === true;
    // The person's Yes to the whole-project checks once a plan is finished: Senior runs them once, in its own turn.
    const checks = !planCheck && assistantRunsWholeChecks(state);
    let followupLabel = state.stage === "planning" ? "Continue planning" : "Continue implementation";
    if (state.stage === "review") followupLabel = `${assistantModeLabel(modelRole)} review${reviewPass ? ` and ${reviewPass.title} pass` : ""}`;
    if (pass) followupLabel = pass.title;
    if (checks) followupLabel = WHOLE_CHECKS_LABEL;
    if (planCheck) followupLabel = PLAN_CHECK_LABEL;
    const selection = state.assignments[modelRole];
    const input = activeMessage(state);
    const messageId = input.messageId || state.messageId;
    const displayMessage = input.displayMessage || input.message;
    const selectedContext = withSelection(context, selection);
    // The connection the request's decision holds: validateDecision below may move a follow-up to the account connected now.
    const holdToDecision = () => {
      selectedContext.expectedConnectionIdentity = decisions.destinations(state.decision || {})[modelRole]?.connectionIdentity;
    };
    holdToDecision();
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
            ...(followup ? { actorId: "app", actorDisplayName: followupLabel } : {}),
            ...(planCheck ? { [MAIN_CHAT_NOTE_TURN_METADATA_KEY]: true } : {})
          }
        });
        state.status = "working";
        state.delivery = "accepted";
        // The attempt's own run (saved with it) sent this turn, which may have been an earlier one.
        state.turnId = receiptTurnId(receipt);
        delete state.error;
        await records.save(context, state);
        return { ok: true, delivered: true, messageId, threadId: state.threadId };
      }
    }
    // Explicit inspection may use only the original uncertain-receipt branch.
    // It cannot continue into selection, preparation or native dispatch.
    if (inspectionOnly) return null;
    // A temporary chat has no automatic follow-ups, but continues a turn an interruption ended like Main chat does.
    if (followup && !routingState.allowAuto && state.followup?.resume !== true) {
      throw failure("Automatic follow-ups run in Main chat only. Cancel this follow-up and send a new request.", "vibe64_assistant_routing_followup_main_chat_only");
    }
    if (state.stopped) throw failure("This request was stopped. Send a new request to continue.", "vibe64_assistant_routing_delivery_stopped");
    // Vibe64's own next step (a plan handoff, Senior's review, a plan's pass, the whole-project checks) does not start
    // while a planned restart is near: it is owed, and starts by itself once the window ends. A resume, and the plan
    // check that only writes the plan, go ahead.
    const restartRefusal = followup && state.followup?.resume !== true && !planCheck && plannedRestart().refusal({
      operation: state.stage === "planning" ? "plan-handoff" : "automatic-review",
      label: state.stage === "planning" ? "" : followupLabel,
      after: "It starts by itself after the restart."
    });
    if (restartRefusal) throw failure(restartRefusal.message, PLANNED_RESTART_REFUSAL_CODE);
    await decisions.validateDecision(context, state, followup);
    holdToDecision();
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
    const includePlanInstructions = !taskPurpose && (state.mode === "auto" || ["senior", "junior"].includes(state.mode));
    // Auto's planning, implementation and review turns report a workflow outcome; its conversation turns do not.
    const autoOutcome = !pass && !planCheck && state.mode === "auto" && (state.workflow || state.stage === "planning");
    // A typed UI pass message names its scope as the request its Genesis task
    // receives, as a commit range in the message is Deslop's. A run sent by
    // name, as Run in Passes sends Genesis's own request, goes verbatim.
    let request = !pass && !planCheck && state.task === "ui-pass" && !state.input.genesisTask ? uiPassRequest(input.message) : input.message;
    // A plan's pass sends Genesis's request for its Passes item as the message's last paragraph, where
    // Genesis recognises it: after the person's reply when the pass was waiting for one.
    const person = Boolean(pass) && !followup && state.passReply === true;
    if (pass) request = person ? `${input.message}\n\n${pass.request}` : pass.request;
    // The plan, read once for what a pass or Senior's review running one is told: whether it is the plan's last pass.
    const passPlan = pass || reviewPass ? await readWorkPlan(context) : null;
    const lastPass = (item) => Boolean(passPlan) && workPlanLastPass(passPlan.text, item);
    // The person's reply to Senior's review of the plan that waited for them: the reply, then that review's request,
    // and Genesis's request for the Review pass it runs last, where Genesis recognises it.
    if (state.reviewReply && !followup && !pass && !planCheck) {
      request = `${input.message}\n\n[Vibe64: the message above is the person's reply to your review of the plan, which waited for them. Continue that review with it.]\n\n` +
        assistantPlanReviewMessage(reviewPass, { last: reviewPass ? lastPass(reviewPass.item) : false }) + (reviewPass ? `\n\n${reviewPass.request}` : "");
    }
    // Passes the person asked for that can't start yet: Senior says so, and runs nothing.
    if (state.planPassNote && !pass && !planCheck) request = `[Vibe64: ${state.planPassNote} Tell the person so in a sentence or two; run no pass and change nothing.]\n\n${request}`;
    // A message the person typed while Vibe64 asked about the whole-project checks: its turn hears what was asked.
    if (state.wholeChecks?.status === "offered" && !followup && !pass && !planCheck) request = `[Vibe64: ${WHOLE_CHECKS_OFFERED_NOTE}]\n\n${request}`;
    let passInstructions = "";
    if (pass) {
      passInstructions = assistantPassInstructions(pass, { last: !passPlan || lastPass(pass.item), person }) +
        (state.planPassNote && !followup ? ` ${state.planPassNote}` : "");
    }
    let intent = taskPurpose || (state.stage === "review" ? "review" : state.mode === "auto" || state.planPassNote ? state.reason : "");
    // The plan check only manages the plan: planning's instructions, its note the request.
    if (planCheck) intent = "planning";
    if (checks) intent = "checks";
    // A workflow turn's outcome instructions follow its request, except where Genesis's request must stay the
    // message's last paragraph: a plan's pass and the whole-project checks carry their own, and Senior's review
    // running the plan's Review pass gets them before its request.
    const outcomeInstructions = !pass && !checks && !planCheck && (state.workflow || autoOutcome)
      ? assistantWorkflowInstructions(state, { autoSave: savesAutomatically(context.session.metadata) }) : "";
    const planInstructions = includePlanInstructions
      ? workPlanInstructions(role, {
        autoOutcome, auto: state.mode === "auto", passTitles: await passTitlesFor(context, role), passesRun: Boolean(state.afterPlan)
      }) : "";
    let message = assistantModePrompt(role, request, {
      intent,
      // Auto's Junior leaves browser checks to Senior's check of the plan it implemented.
      browserReview: assistantPlanCompletionFollows(state),
      // Auto's Senior hands rework to Junior; a direct chat's own agent does it in its workflow.
      rework: state.mode === "auto" ? "junior" : state.workflow ? "self" : "report",
      // A pass covers the connected repositories the app is built from as it does this one, and so does the Review
      // pass Senior's review of a plan runs.
      connected: taskPurpose || reviewPass ? connectedCopyNames(context.session) : [],
      runsPass: Boolean(reviewPass),
      planInstructions: pass ? passInstructions
        : checks
          ? assistantWholeChecksInstructions({ autoSave: savesAutomatically(context.session.metadata), passes: state.wholeChecks?.passes })
          : reviewPass ? [planInstructions, outcomeInstructions].filter(Boolean).join("\n") : planInstructions
    });
    // A turn that starts while a planned restart is near hears about it first, as the turns running when it came did.
    const restartWarning = plannedRestart().warning();
    if (restartWarning) {
      message = `[${restartWarning}]\n\n${message}`;
      plannedRestart().noteTold({ sessionId, conversationId: context.routingConversationId || "", sessionName: context.session.sessionName });
    }
    // A pass renders its own Genesis task, and a review Genesis's review task. Senior's
    // check of a plan Junior implemented is not a pass: it renders no task of its own, unless it runs the
    // plan's Review pass, whose task it renders as that pass's own turn would.
    let genesisTask = taskPurpose ? pass?.id || state.task : "";
    if (!genesisTask && state.stage === "review" &&
        !((followup || state.reviewReply) && (state.mode === "auto" || state.planReview) && state.planInvolved)) genesisTask = "review";
    if (reviewPass) genesisTask = reviewPass.id;
    // The plan check renders no task and reports no outcome: the request settles as the turn before it would have.
    if (planCheck) genesisTask = "";
    if (outcomeInstructions && !reviewPass) message += "\n\n" + outcomeInstructions;
    // What a turn that may tick an active plan starts from, read while its selection is prepared: its plan check
    // compares the plan and the source with it when the turn ends. Main chat only.
    const planCheckStarting = routingState.allowAuto ? planCheckStart(context, state).catch(() => null) : null;
    await prepareSelection(sessionId, selection, context);
    const planCheckFrom = await planCheckStarting;
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
    const automatic = followup && context.continuedByPerson !== true;
    const sent = (sendContext) => dispatch(sessionId, {
      ...(followup ? {} : state.input),
      messageId,
      message,
      displayMessage,
      // An automatic turn's task is Vibe64's choice, not the person's: without a
      // Blueprint it goes as written instead of becoming the Blueprint's task.
      ...(genesisTask ? { genesisTask, ...(!taskPurpose || pass ? { automaticGenesisTask: true } : {}) } : {}),
      turnMetadata: {
        ...(!followup ? state.input.turnMetadata : {}),
        assistantRouting: attribution(state, followup),
        ...(followup ? { actor: "app", actorLabel: followupLabel } : {}),
        // The chat shows the plan check as Vibe64's note, never as the person's words.
        ...(planCheck ? { [MAIN_CHAT_NOTE_TURN_METADATA_KEY]: true } : {})
      },
      onPromptSending: async ({ threadId }) => {
        if (!followup) await onPromptSending({ threadId, assistantSelection: selection });
        state.threadId = threadId;
        state.attemptedMessageId = messageId;
        // The run that sends a turn is the one whose end can interrupt it.
        state.serverRunId = serverRun.id;
        // A turn sent now is no longer waiting to be resumed later.
        delete state.resumeAt;
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
    }, sendContext);
    const timelineTrigger = automatic ? followupTimelineTrigger(state, { planCheck, checks, pass }) : "";
    const result = automatic
      ? await runWithoutActionRequest(() => sent({ ...selectedContext, timelineTrigger }))
      : await sent(selectedContext);
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
    state.serverRunId = serverRun.id;
    state.turnId = receiptTurnId(result);
    rememberPlanCheckStart(routingState, records.keyFor(sessionId, context), messageId, planCheckFrom);
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
    const pass = assistantPlanPass(state);
    if (pass) resolvedMode = state.mode === "custom" ? state.resolvedMode : assistantTaskPurpose(pass.id);
    else if (state.stage === "review" && (state.mode === "auto" || modelRole === "senior")) resolvedMode = "review";
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
  FOLLOWUP_OVERTAKEN_CODES,
  createAssistantRoutingDelivery
};
