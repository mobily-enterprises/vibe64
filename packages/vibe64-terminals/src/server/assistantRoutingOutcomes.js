import { workPlanScope } from "../shared/assistantWorkPlan.js";
import { readWorkPlan, manageWorkPlan } from "./assistantWorkPlan.js";
import {
  assistantRoutingOutcomeNotice,
  assistantWorkflowRole
} from "@local/vibe64-runtime/shared/assistantRouting";
import {
  assistantFinishingNotice,
  assistantFinishingParts
} from "@local/vibe64-runtime/shared/assistantFinishing";
import {
  assistantReplyAsksPerson,
  latestAssistantMessageAwaitingUserReply
} from "@local/vibe64-runtime/shared/conversationQuestions";
import { read, failure, activeMessage, savesAutomatically, usesWorkPlan } from "./assistantRoutingRequests.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {ReturnType<typeof import("./assistantRoutingAdmission.js").createAssistantRoutingAdmission>} AssistantRoutingAdmission */

const MAX_WORKFLOW_STEPS = 8;

/**
 * What follows a workflow turn: the outcome its agent reports, the next automatic step, and the
 * reconciliation of a request that a restart interrupted.
 * @param {object} dependencies
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDecisions} dependencies.decisions
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {AssistantRoutingAdmission} dependencies.admission
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>} dependencies.exclusive
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>}
 *   dependencies.exclusiveAfterWrites The lock for what a turn leaves behind, which waits out a Save or Update.
 * @param {PublishSessionChanged} dependencies.publish
 * @param {(sessionId: string, details: object) => unknown} dependencies.onPlanCompleted
 */
function createAssistantRoutingOutcomes({
  routingState,
  records,
  decisions,
  delivery,
  admission,
  agent,
  exclusive,
  exclusiveAfterWrites,
  publish,
  onPlanCompleted
}) {
  /**
   * The active agent declares an outcome; this does not dispatch while its turn runs.
   */
  async function recordOutcome(sessionId, input, options) {
    return exclusiveAfterWrites(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || (!state.workflow && state.stage !== "planning") || state.stopped ||
          state.status !== "working" || state.delivery !== "accepted" || input.messageId !== state.messageId ||
          input.turnId !== state.turnId || input.stage !== state.stage) {
        throw failure("The workflow outcome does not match the active request and turn.", "vibe64_assistant_workflow_outcome_mismatch");
      }
      await decisions.validateDecision(context, state, Boolean(state.followup));
      const native = await agent.sessionState(sessionId, context);
      if (!native?.turn?.active || native.turn.id && native.turn.id !== state.turnId) {
        throw failure("Only the active workflow turn can report its outcome.", "vibe64_assistant_workflow_turn_inactive");
      }
      if (!["continue", "handoff", "wait", "complete"].includes(input.decision) ||
          typeof input.explanation !== "string" || !input.explanation.trim() || input.explanation.length > 2000 || typeof input.progress !== "boolean") {
        throw failure("Report continue, handoff, wait or complete with a concrete explanation and progress boolean.", "vibe64_assistant_workflow_outcome_invalid");
      }
      if (state.stage === "planning" && !["continue", "wait"].includes(input.decision)) {
        throw failure("Planning alone does not authorise implementation or plan completion.", "vibe64_assistant_workflow_planning_outcome_refused");
      }
      const involvesPlan = input.expectedRevision !== undefined || state.planInvolved;
      // In Auto only Senior completes, after review. A direct chat's agent
      // completes its own finishing turn, or work that changed no files.
      const direct = state.mode !== "auto";
      if (input.decision === "complete" && !(state.stage === "review" && (direct || assistantWorkflowRole(state) === "senior"))) {
        if (!direct) throw failure("Only Senior can complete a verified review.", "vibe64_assistant_workflow_completion_senior_only");
        if (involvesPlan) throw failure("A plan's work finishes with handoff, then its finishing turn.", "vibe64_assistant_workflow_plan_handoff_required");
      }
      const plan = await readWorkPlan(context);
      // Only Senior completes an involved plan; Junior and Custom leave it active.
      const completesPlan = state.stage === "review" && assistantWorkflowRole(state) === "senior";
      if (involvesPlan && (!plan || input.expectedRevision !== plan.revision ||
          (input.expectedProgressRevision || null) !== plan.progressRevision)) {
        throw failure("Read the complete current Plan and Progress before reporting this outcome.", "vibe64_assistant_workflow_plan_unread");
      }
      if (involvesPlan && input.decision === "complete" && completesPlan && (plan.status !== "completed" || state.workPlan &&
          workPlanScope(plan.text) !== workPlanScope(state.workPlan.text))) {
        throw failure("Senior must explicitly complete the exact reviewed plan before completing the workflow.", "vibe64_assistant_workflow_plan_incomplete");
      }
      if (involvesPlan && input.decision !== "complete" && plan.status !== "active") {
        throw failure("The involved plan is no longer active.", "vibe64_assistant_workflow_plan_inactive");
      }
      state.planInvolved = involvesPlan;
      state.workPlan = involvesPlan ? plan : null;
      state.outcome = {
        decision: input.decision,
        explanation: input.explanation.trim(),
        progress: input.progress,
        turnId: state.turnId,
        stage: state.stage,
        planRevision: state.workPlan?.revision || null,
        progressRevision: state.workPlan?.progressRevision || null
      };
      await records.save(context, state);
      return { ok: true, outcome: state.outcome };
    });
  }

  /**
   * Finished work is saved when the chat's Automatically save changes is on
   * now; Save itself runs after the lock.
   */
  function saveAfter(context, state) {
    return savesAutomatically(context.session.metadata) ? { context, state } : null;
  }

  async function afterTurn(sessionId, payload, routingOptions, options = {}) {
    const { recovered = false } = options;
    const run = payload?.payload?.agentRun;
    if (!run || run.active) return;
    let completed;
    await exclusiveAfterWrites(sessionId, routingOptions, async context => {
      const key = records.keyFor(sessionId, context);
      if (admission.isClosing() || routingState.running.has(key)) return;
      const state = await read(context.runtime.store, sessionId);
      if (!state || state.status !== "working" || state.delivery !== "accepted") return;
      if (!routingState.allowAuto && state.mode === "auto") {
        state.status = "waiting";
        state.error = "Auto is available in Main chat only. Choose Senior or Junior and send a fresh request.";
        await records.save(context, state);
        return;
      }
      if (!state.turnId) {
        const receipt = await agent.inspectMessageAdmission(sessionId, {
          messageId: activeMessage(state).messageId || state.messageId,
          threadId: state.threadId
        }, context);
        if (receipt?.admission === "accepted") state.turnId = receipt.turnId || "";
      }
      if (!state.turnId) {
        state.status = "waiting";
        state.error = "The original native turn could not be confirmed. Inspect its delivery before resuming.";
        await records.save(context, state);
        return;
      }
      if (state.turnId !== (run.providerTurnId || run.turnId)) return;
      const live = routingState.liveFollowupRequests.get(key) === state.messageId;
      routingState.liveFollowupRequests.delete(key);
      if (!state.workflow && state.stage !== "planning") {
        state.status = run.state === "completed" ? "complete" : "waiting";
        await records.save(context, state);
        return;
      }
      // A final reply asking the person waits for their answer, whatever outcome
      // was reported. Their reply is a new request; nothing resumes this one.
      if (!state.stopped && run.state === "completed" && assistantReplyAsksPerson(latestAssistantMessageAwaitingUserReply(
        await context.runtime.store.readConversationTail(sessionId, { userLimit: 1 })
      ))) {
        Object.assign(state, { status: "waiting", awaitingAnswer: true, error: "Waiting for your answer. Reply in chat to continue." });
        await records.save(context, state);
        return;
      }
      const outcome = state.outcome;
      // A direct chat's implementation turn that ends without reporting is an
      // ordinary reply: nothing finishes, and its changes fold into the next
      // finishing turn.
      if (state.mode !== "auto" && state.stage === "implementation" && !state.stopped && run.state === "completed" &&
          outcome?.turnId !== state.turnId) {
        state.status = "complete";
        await records.save(context, state);
        return;
      }
      const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
      if (state.stopped || run.state !== "completed" || !outcome || outcome.turnId !== state.turnId ||
          (plan?.revision || null) !== outcome.planRevision || (plan?.progressRevision || null) !== outcome.progressRevision) {
        state.status = "waiting";
        state.error = state.stopped ? "Paused at your request." : run.state !== "completed" ? `The ${state.stage} turn ${run.state || "stopped"}. Resume when ready.`
          : "The turn ended without a confirmed workflow outcome. Resume the retained stage to finish it.";
        if (state.workflow && !state.stopped) await records.prepareFollowup(context, state, state.stage);
        await records.save(context, state);
        return;
      }
      if (outcome.decision === "complete") {
        const steered = (state.steering || []).map(({ messageId }) => messageId);
        const entries = await context.runtime.store.readConversationTail(sessionId, { userLimit: 2 + steered.length });
        // The turn's span: its own entry, then each later one that a steer of it or no user message starts, up to any other message.
        const own = entries.findIndex(turn => turn.user?.messageId === (activeMessage(state).messageId || state.messageId));
        const other = entries.findIndex((turn, index) => index > own && turn.user && !steered.includes(turn.user.messageId));
        const hasFinal = own >= 0 && entries.slice(own, other < 0 ? undefined : other).some(turn => turn.assistant?.text?.trim());
        if (!hasFinal) {
          state.status = "waiting";
          state.error = "Review finished, but its final explanation was not confirmed. Check delivery before completing recovery.";
          await records.save(context, state);
          return;
        }
        // Junior and Custom leave an involved plan active for Senior.
        if (plan?.status === "completed") {
          let archived;
          try {
            archived = await manageWorkPlan(context, {
              operation: "archive",
              expectedRevision: plan.revision,
              expectedProgressRevision: plan.progressRevision || ""
            }, "review");
          } catch (error) {
            state.status = "waiting";
            state.error = `Review completed, but the plan could not be archived: ${error.message}. Use Plan history recovery after inspecting the saved pair.`;
            await records.save(context, state);
            return;
          }
          await records.writeNotice(context, state, {
            messageId: `assistant-plan-archived:${state.turnId}`,
            text: `Completed plan archived: ${plan.title}.\n\n[View plan history](#vibe64-plan-history)`
          });
          await publish(sessionId, {
            reason: "work-plan-changed",
            payload: { planNotice: archived.notice, assistantRoutingRequest: state }
          });
        }
        state.status = "complete";
        await records.save(context, state);
        // Work that reached its finishing turn is saved last; an answer or
        // work that changed no files is not.
        if (state.stage === "review") completed = await saveAfter(context, state);
        return;
      }
      if (outcome.decision === "wait") {
        state.status = "waiting";
        state.error = outcome.explanation;
        await records.prepareFollowup(context, state, state.stage);
        await records.save(context, state);
        await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
        return;
      }
      state.stalledTurns = outcome.progress ? 0 : (state.stalledTurns || 0) + 1;
      if (state.stalledTurns >= 2 || state.steps >= MAX_WORKFLOW_STEPS) {
        state.status = "waiting";
        state.error = state.stalledTurns >= 2
          ? "Two turns reported no progress. Inspect the blocker before resuming."
          : "Eight automatic workflow steps completed. Inspect progress before resuming.";
        await records.prepareFollowup(context, state, state.stage);
        await records.save(context, state);
        return;
      }
      let nextStage = state.stage;
      if (outcome.decision === "handoff") {
        // Rework returns to implementation: Junior's in Auto, the same agent's otherwise.
        const auto = state.mode === "auto";
        const returning = state.stage === "review" && (!auto || assistantWorkflowRole(state) === "senior");
        nextStage = returning ? "implementation" : "review";
        if (returning && auto) state.resolvedMode = "junior";
      }
      const finishingParts = assistantFinishingParts(state);
      // With review, Deslop and the UI pass all off, finished work goes straight to Save.
      if (nextStage === "review" && state.stage === "implementation" && !finishingParts.length) {
        state.status = "complete";
        await records.save(context, state);
        await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
        completed = await saveAfter(context, state);
        return;
      }
      state.steps = (state.steps || 0) + 1;
      const finishingStarts = nextStage === "review" && outcome.decision === "handoff";
      await records.prepareFollowup(context, state, nextStage);
      state.status = "working";
      await records.save(context, state);
      await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
      if (recovered && !live) {
        state.status = "waiting";
        state.error = "Scheduling was disconnected. Resume the retained stage when ready.";
        await records.save(context, state);
        return;
      }
      // Each step the chat's settings start says so, in order, as its turn starts.
      if (finishingStarts) {
        for (const step of finishingParts) {
          await records.writeNotice(context, state, assistantFinishingNotice(step, state.followup.messageId));
        }
      }
      try {
        await delivery.deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
      } catch (error) {
        state.status = "waiting";
        state.delivery = state.attemptedMessageId ? "uncertain" : "pending";
        state.error = error.message;
        await records.save(context, state);
      }
    });
    // After the lock: finished work's automatic save runs last, once the turn
    // has ended; its start notice and short result note join the chat.
    if (!completed) return;
    const { context, state } = completed;
    await records.writeNotice(context, state, assistantFinishingNotice("autoSave", state.turnId));
    let note;
    try {
      note = await onPlanCompleted(sessionId, { submittedBy: state.submittedBy });
    } catch (error) {
      note = `Automatic save didn't run: ${error.message}`;
    }
    if (note) await records.writeNotice(context, state, { messageId: `assistant-plan-saved:${state.turnId}`, text: note });
  }

  async function reconcile(sessionId, options) {
    let outcome;
    await exclusive(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || routingState.running.has(records.keyFor(sessionId, context))) return;
      if (state.helper) {
        try {
          await records.cleanupHelper(context, state);
          state.helper = null;
        } catch (error) {
          state.status = "waiting";
          state.error = error.message;
          await records.save(context, state);
          return;
        }
        await records.save(context, state);
      }
      if (["sending", "uncertain"].includes(state.delivery) && state.attemptedMessageId &&
          await context.runtime.store.conversationMessageIdExists(sessionId, state.attemptedMessageId)) {
        state.delivery = "accepted";
        state.status = state.stopped ? "waiting" : "working";
        if (!state.stopped) delete state.error;
        await records.save(context, state);
      }
      if (["routing", "sending"].includes(state.delivery)) {
        state.delivery = state.attemptedMessageId ? "uncertain" : state.followup ? "pending" : "failed";
        state.status = "waiting";
        state.error = state.attemptedMessageId
          ? "Delivery was interrupted. Check its original receipt before continuing."
          : "Preparation was interrupted. Resume when ready.";
        await records.save(context, state);
      }
      if (state.status === "working" && state.delivery === "accepted") {
        const run = state.turnId && context.session.agentRuns?.find(row => (row.providerTurnId || row.turnId) === state.turnId);
        if (run && !["starting", "active", "finalizing"].includes(run.state)) {
          outcome = run;
          return;
        }
        // Accepted work runs only inside its native turn. A restart or lost
        // process can leave no turn (or no turn ID) to report its end, so
        // the native turn itself decides: when none is running, it ended.
        const native = await agent.sessionState(sessionId, context).catch(() => null);
        const turn = native?.turn;
        if (!native || native.ok === false || turn?.active === true) return;
        if (state.turnId && turn?.id === state.turnId) {
          outcome = { active: false, state: turn.runState || turn.state || turn.status, providerTurnId: turn.id };
        } else {
          state.status = "waiting";
          state.error = "The assistant stopped before this request finished. Send it again if it is unfinished.";
          await records.save(context, state);
        }
      }
    });
    if (outcome) await afterTurn(sessionId, { payload: { agentRun: outcome } }, options, { recovered: true });
  }

  return Object.freeze({
    recordOutcome,
    afterTurn,
    reconcile
  });
}

export {
  createAssistantRoutingOutcomes
};
