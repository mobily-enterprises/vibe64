import { workPlanScope } from "../shared/assistantWorkPlan.js";
import { readWorkPlan, manageWorkPlan } from "./assistantWorkPlan.js";
import { assistantRoutingOutcomeNotice, assistantWorkflowRole } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  assistantReplyAsksPerson,
  latestAssistantMessageAwaitingUserReply
} from "@local/vibe64-runtime/shared/conversationQuestions";
import { read, failure, activeMessage, usesWorkPlan } from "./assistantRoutingRequests.js";

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
  publish,
  onPlanCompleted
}) {
  /**
   * The active agent declares an outcome; this does not dispatch while its turn runs.
   */
  async function recordOutcome(sessionId, input, options) {
    return exclusive(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || state.mode !== "auto" || (!state.workflow && state.stage !== "planning") || state.stopped ||
          state.status !== "working" || state.delivery !== "accepted" || input.messageId !== state.messageId ||
          input.turnId !== state.turnId || input.stage !== state.stage) throw failure("The workflow outcome does not match the active request and turn.");
      await decisions.validateDecision(context, state, Boolean(state.followup));
      const native = await agent.sessionState(sessionId, context);
      if (!native?.turn?.active || native.turn.id && native.turn.id !== state.turnId) throw failure("Only the active workflow turn can report its outcome.");
      if (!["continue", "handoff", "wait", "complete"].includes(input.decision) ||
          typeof input.explanation !== "string" || !input.explanation.trim() || input.explanation.length > 2000 || typeof input.progress !== "boolean") {
        throw failure("Report continue, handoff, wait or complete with a concrete explanation and progress boolean.");
      }
      if (state.stage === "planning" && !["continue", "wait"].includes(input.decision)) throw failure("Planning alone does not authorise implementation or plan completion.");
      if (input.decision === "complete" && (state.stage !== "review" || assistantWorkflowRole(state) !== "senior")) throw failure("Only Senior can complete a verified review.");
      const plan = await readWorkPlan(context);
      const involvesPlan = input.expectedRevision !== undefined || state.planInvolved;
      if (involvesPlan && (!plan || input.expectedRevision !== plan.revision ||
          (input.expectedProgressRevision || null) !== plan.progressRevision)) throw failure("Read the complete current Plan and Progress before reporting this outcome.");
      if (involvesPlan && input.decision === "complete" && (plan.status !== "completed" || state.workPlan &&
          workPlanScope(plan.text) !== workPlanScope(state.workPlan.text))) {
        throw failure("Senior must explicitly complete the exact reviewed plan before completing the workflow.");
      }
      if (involvesPlan && input.decision !== "complete" && plan.status !== "active") throw failure("The involved plan is no longer active.");
      state.planInvolved = involvesPlan;
      state.workPlan = involvesPlan ? plan : null;
      state.outcome = { decision: input.decision, explanation: input.explanation.trim(), progress: input.progress,
        turnId: state.turnId, stage: state.stage, planRevision: state.workPlan?.revision || null,
        progressRevision: state.workPlan?.progressRevision || null };
      await records.save(context, state);
      return { ok: true, outcome: state.outcome };
    });
  }

  async function afterTurn(sessionId, payload, options, { recovered = false } = {}) {
    const run = payload?.payload?.agentRun;
    if (!run || run.active) return;
    let completed;
    await exclusive(sessionId, options, async context => {
      const key = records.keyFor(sessionId, context);
      if (admission.isClosing() || routingState.running.has(key)) return;
      const state = await read(context.runtime.store, sessionId);
      if (!state || state.status !== "working" || state.delivery !== "accepted") return;
      if (!routingState.allowAuto && state.mode === "auto") {
        state.status = "waiting"; state.error = "Auto is available in Main chat only. Choose Senior or Junior and send a fresh request.";
        await records.save(context, state); return;
      }
      if (!state.turnId) {
        const receipt = await agent.inspectMessageAdmission(sessionId, { messageId: activeMessage(state).messageId || state.messageId, threadId: state.threadId }, context);
        if (receipt?.admission === "accepted") state.turnId = receipt.turnId || "";
      }
      if (!state.turnId) {
        state.status = "waiting";
        state.error = "The original native turn could not be confirmed. Inspect its delivery before resuming.";
        await records.save(context, state); return;
      }
      if (state.turnId !== (run.providerTurnId || run.turnId)) return;
      const live = routingState.liveFollowupRequests.get(key) === state.messageId;
      routingState.liveFollowupRequests.delete(key);
      if (!state.workflow && state.stage !== "planning") { state.status = run.state === "completed" ? "complete" : "waiting"; await records.save(context, state); return; }
      // A final reply asking the person waits for their answer, whatever outcome
      // was reported. Their reply is a new request; nothing resumes this one.
      if (!state.stopped && run.state === "completed" && assistantReplyAsksPerson(latestAssistantMessageAwaitingUserReply(
        await context.runtime.store.readConversationTail(sessionId, { userLimit: 1 })))) {
        Object.assign(state, { status: "waiting", awaitingAnswer: true, error: "Waiting for your answer. Reply in chat to continue." });
        await records.save(context, state); return;
      }
      const outcome = state.outcome;
      const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
      if (state.stopped || run.state !== "completed" || !outcome || outcome.turnId !== state.turnId ||
          (plan?.revision || null) !== outcome.planRevision || (plan?.progressRevision || null) !== outcome.progressRevision) {
        state.status = "waiting";
        state.error = state.stopped ? "Paused at your request." : run.state !== "completed" ? `The ${state.stage} turn ${run.state || "stopped"}. Resume when ready.`
          : "The turn ended without a confirmed workflow outcome. Resume the retained stage to finish it.";
        if (state.workflow && !state.stopped) await records.prepareFollowup(context, state, state.stage);
        await records.save(context, state); return;
      }
      if (outcome.decision === "complete") {
        const replies = await context.runtime.store.readConversationTail(sessionId, { userLimit: 2 });
        const hasFinal = replies.some(turn => turn.user?.messageId === (activeMessage(state).messageId || state.messageId) && turn.assistant?.text?.trim());
        if (!hasFinal) { state.status = "waiting"; state.error = "Review finished, but its final explanation was not confirmed. Check delivery before completing recovery."; await records.save(context, state); return; }
        if (plan) {
          let archived;
          try { archived = await manageWorkPlan(context, { operation: "archive", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review"); }
          catch (error) {
            state.status = "waiting"; state.error = `Review completed, but the plan could not be archived: ${error.message}. Use Plan history recovery after inspecting the saved pair.`;
            await records.save(context, state); return;
          }
          await records.writeNotice(context, state, { messageId: `assistant-plan-archived:${state.turnId}`, text: `Completed plan archived: ${plan.title}.\n\n[View plan history](#vibe64-plan-history)` });
          await publish(sessionId, { reason: "work-plan-changed", payload: { planNotice: archived.notice, assistantRoutingRequest: state } });
          completed = { context, state };
        }
        state.status = "complete";
        await records.save(context, state); return;
      }
      if (outcome.decision === "wait") { state.status = "waiting"; state.error = outcome.explanation; await records.prepareFollowup(context, state, state.stage); await records.save(context, state); await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state)); return; }
      state.stalledTurns = outcome.progress ? 0 : (state.stalledTurns || 0) + 1;
      if (state.stalledTurns >= 2 || state.steps >= MAX_WORKFLOW_STEPS) {
        state.status = "waiting"; state.error = state.stalledTurns >= 2 ? "Two turns reported no progress. Inspect the blocker before resuming." : "Eight automatic workflow steps completed. Inspect progress before resuming.";
        await records.prepareFollowup(context, state, state.stage); await records.save(context, state); return;
      }
      let nextStage = state.stage;
      if (outcome.decision === "handoff") {
        const returningToJunior = state.stage === "review" && assistantWorkflowRole(state) === "senior";
        nextStage = returningToJunior ? "implementation" : "review";
        if (returningToJunior) state.resolvedMode = "junior";
      }
      state.steps = (state.steps || 0) + 1;
      await records.prepareFollowup(context, state, nextStage);
      state.status = "working";
      await records.save(context, state);
      await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
      if (recovered && !live) { state.status = "waiting"; state.error = "Scheduling was disconnected. Resume the retained stage when ready."; await records.save(context, state); return; }
      try { await delivery.deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, true); }
      catch (error) { state.status = "waiting"; state.delivery = state.attemptedMessageId ? "uncertain" : "pending"; state.error = error.message; await records.save(context, state); }
    });
    // After the lock: a completed plan's follow-up (automatic save) runs once
    // the turn has ended, and its short result note joins the chat.
    if (!completed) return;
    const { context, state } = completed;
    let note;
    try { note = await onPlanCompleted(sessionId, { submittedBy: state.submittedBy }); }
    catch (error) { note = `Automatic save didn't run: ${error.message}`; }
    if (note) await records.writeNotice(context, state, { messageId: `assistant-plan-saved:${state.turnId}`, text: note });
  }

  async function reconcile(sessionId, options) {
    let outcome;
    await exclusive(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || routingState.running.has(records.keyFor(sessionId, context))) return;
      if (state.helper) {
        try { await records.cleanupHelper(context, state); state.helper = null; }
        catch (error) { state.status = "waiting"; state.error = error.message; await records.save(context, state); return; }
        await records.save(context, state);
      }
      if (["sending", "uncertain"].includes(state.delivery) && state.attemptedMessageId &&
          await context.runtime.store.conversationMessageIdExists(sessionId, state.attemptedMessageId)) {
        state.delivery = "accepted"; state.status = state.stopped ? "waiting" : "working";
        if (!state.stopped) delete state.error;
        await records.save(context, state);
      }
      if (["routing", "sending"].includes(state.delivery)) {
        state.delivery = state.attemptedMessageId ? "uncertain" : state.followup ? "pending" : "failed";
        state.status = "waiting"; state.error = state.attemptedMessageId ? "Delivery was interrupted. Check its original receipt before continuing." : "Preparation was interrupted. Resume when ready.";
        await records.save(context, state);
      }
      if (state.status === "working" && state.delivery === "accepted") {
        const run = state.turnId && context.session.agentRuns?.find(row => (row.providerTurnId || row.turnId) === state.turnId);
        if (run && !["starting", "active", "finalizing"].includes(run.state)) { outcome = run; return; }
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
