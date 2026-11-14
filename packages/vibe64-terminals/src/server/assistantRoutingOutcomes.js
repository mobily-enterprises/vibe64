import { workPlanScope } from "../shared/assistantWorkPlan.js";
import { readWorkPlan, manageWorkPlan } from "./assistantWorkPlan.js";
import { afterPlanBase, rememberAfterPlanBase } from "./afterPlanBase.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import {
  assistantAfterPlanPass,
  assistantRoutingFromMetadata,
  assistantRoutingOutcomeNotice,
  assistantWorkflowRole
} from "@local/vibe64-runtime/shared/assistantRouting";
import {
  AFTER_PLAN_PASS_ORDER,
  AFTER_PLAN_PASS_TITLES,
  ASSISTANT_FINISHING_DEFAULTS,
  afterPlanPassNotice,
  assistantAutoSaveNotice,
  assistantPlanCompletionFollows,
  planCompletedDuringRequest
} from "@local/vibe64-runtime/shared/assistantFinishing";
import {
  assistantReplyAsksPerson,
  latestAssistantQuestionsAwaitingUserReply
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
// Whether a plan completed during a request asks only for a readable plan: an
// unreadable one is none, so a request that never used the plan finishes as it did.
const readablePlan = context => readWorkPlan(context).catch(() => null);

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
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} dependencies.listPasses The passes
 *   Genesis offers for the session's source, read once as a completed plan's passes start.
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
  onPlanCompleted,
  listPasses
}) {
  /**
   * The active agent declares an outcome; this does not dispatch while its turn runs.
   */
  async function recordOutcome(sessionId, input, options) {
    return exclusiveAfterWrites(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      // An after-plan pass reports nothing: its turn ending starts the next pass.
      if (!state || (!state.workflow && state.stage !== "planning") || state.stage === "pass" || state.stopped ||
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
      // Only Senior completes a plan, and in Auto only Senior completes the work
      // at all. A direct chat's Junior or Custom completes only work that changed
      // no files and involves no plan.
      const senior = assistantWorkflowRole(state) === "senior";
      if (input.decision === "complete" && !senior) {
        if (state.mode === "auto") throw failure("Only Senior can complete the work.", "vibe64_assistant_workflow_completion_senior_only");
        if (involvesPlan) {
          throw failure("Only Senior completes a plan: leave it active and report handoff once its work is finished.", "vibe64_assistant_workflow_plan_handoff_required");
        }
      }
      const plan = await readWorkPlan(context);
      if (involvesPlan && (!plan || input.expectedRevision !== plan.revision ||
          (input.expectedProgressRevision || null) !== plan.progressRevision)) {
        throw failure("Read the complete current Plan and Progress before reporting this outcome.", "vibe64_assistant_workflow_plan_unread");
      }
      if (involvesPlan && input.decision === "complete" && (plan.status !== "completed" || state.workPlan &&
          workPlanScope(plan.text) !== workPlanScope(state.workPlan.text))) {
        throw failure("Senior must explicitly complete the exact agreed plan before completing the workflow.", "vibe64_assistant_workflow_plan_incomplete");
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

  /**
   * Archives the completed plan once its work is finished, with a notice and a plan change; a plan
   * that cannot be archived leaves the request waiting with the reason.
   * @returns {Promise<boolean>} whether the work may finish
   */
  async function archiveCompletedPlan(context, state, plan) {
    let archived;
    try {
      archived = await manageWorkPlan(context, {
        operation: "archive",
        expectedRevision: plan.revision,
        expectedProgressRevision: plan.progressRevision || ""
      }, "review");
    } catch (error) {
      state.status = "waiting";
      state.error = `The work finished, but the plan could not be archived: ${error.message}. Use Plan history recovery after inspecting the saved pair.`;
      await records.save(context, state);
      return false;
    }
    await records.writeNotice(context, state, {
      messageId: `assistant-plan-archived:${state.turnId}`,
      text: `Completed plan archived: ${plan.title}.\n\n[View plan history](#vibe64-plan-history)`
    });
    await publish(context.session.sessionId, {
      reason: "work-plan-changed",
      payload: { planNotice: archived.notice, assistantRoutingRequest: state }
    });
    return true;
  }

  /**
   * A plan completed during this request: the passes the chat ticks in Passes (After a plan) run
   * one after another in Genesis's Master pass order, each its own Senior turn over the changes
   * since the session's after-plan base. A pass this project's Genesis cannot run is skipped with
   * its reason, and with no base none runs. Genesis's list and the ticks are read once, here.
   * @returns {Promise<{ context: object, state: object } | null>} the finished work to save, if any
   */
  async function startAfterPlanPasses(context, state, plan, schedule) {
    let choice = ASSISTANT_FINISHING_DEFAULTS;
    try {
      choice = assistantRoutingFromMetadata(context.session.metadata) || choice;
    } catch {
      // Unreadable preferences run the defaults; the chat's settings say why when opened.
    }
    // The passes are this request's workflow, whatever its own turn was.
    state.workflow = true;
    state.stage = "pass";
    state.passChain = {
      base: "",
      plan: { title: plan.title, revision: plan.revision, progressRevision: plan.progressRevision || null },
      passes: [],
      index: 0
    };
    const notice = (id, text) => records.writeNotice(context, state, { messageId: `assistant-after-plan-skipped:${state.turnId}:${id}`, text });
    let listing;
    try {
      listing = await listPasses({ projectRoot: sessionSourcePath(context.session) });
    } catch (error) {
      await notice("all", `The passes didn't run after the plan: ${error.message} Run them from Passes.`);
      return finishAfterPlanPasses(context, state);
    }
    state.passChain.base = await afterPlanBase(context.session);
    if (!state.passChain.base) {
      await notice("all", "The passes didn't run after the plan: Vibe64 can't tell where this plan's work started in the session's history. Run them from Passes.");
      return finishAfterPlanPasses(context, state);
    }
    for (const id of AFTER_PLAN_PASS_ORDER.filter((pass) => choice.afterPlan.includes(pass))) {
      const pass = listing.passes.find((entry) => entry.id === id);
      if (!pass?.sinceBase) {
        await notice(id, `${pass?.title || AFTER_PLAN_PASS_TITLES[id]} skipped after the plan: ${pass?.unavailable || "this project's Genesis doesn't offer it."}`);
        continue;
      }
      const deep = choice.afterPlanDeep.includes(id) && Boolean(pass.sinceBase.deep);
      state.passChain.passes.push({
        id,
        title: pass.title,
        deep,
        request: (deep ? pass.sinceBase.deep : pass.sinceBase.request).replace("{base}", state.passChain.base)
      });
    }
    return continueAfterPlanPasses(context, state, schedule);
  }

  /** Starts the chain's current pass, or finishes the chain after its last one. */
  async function continueAfterPlanPasses(context, state, { recovered, live }) {
    const pass = assistantAfterPlanPass(state);
    if (!pass) return finishAfterPlanPasses(context, state);
    await records.prepareFollowup(context, state, "pass");
    state.status = "working";
    await records.save(context, state);
    if (recovered && !live) {
      state.status = "waiting";
      state.error = "Scheduling was disconnected. Resume the retained stage when ready.";
      await records.save(context, state);
      return null;
    }
    await records.writeNotice(context, state, afterPlanPassNotice(pass.title, state.followup.messageId, { deep: pass.deep }));
    try {
      await delivery.deliver(context.session.sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
    } catch (error) {
      state.status = "waiting";
      state.delivery = state.attemptedMessageId ? "uncertain" : "pending";
      state.error = error.message;
      await records.save(context, state);
    }
    return null;
  }

  /**
   * After the last pass: the completed plan is archived, the next passes' base moves to the
   * session's HEAD, and the finished work is saved when Automatically save changes is on.
   */
  async function finishAfterPlanPasses(context, state) {
    const plan = await readablePlan(context);
    if (plan?.status === "completed" && !await archiveCompletedPlan(context, state, plan)) return null;
    await rememberAfterPlanBase(context.runtime.store, context.session);
    state.status = "complete";
    await records.save(context, state);
    return saveAfter(context, state);
  }

  /**
   * A pass turn that was stopped, failed or was interrupted ends the chain: the passes after it
   * never start, nothing is saved automatically, and the plan stays completed for the person.
   */
  async function stopAfterPlanPasses(context, state, ending) {
    const pass = assistantAfterPlanPass(state);
    const unfinished = state.passChain.passes.slice(state.passChain.index).map(({ title }) => title);
    state.passChain.stopped = true;
    state.status = "complete";
    await records.save(context, state);
    await records.writeNotice(context, state, {
      messageId: `assistant-after-plan-stopped:${state.followup?.messageId || state.turnId}`,
      text: `The passes after the plan stopped: ${pass.title} ${ending === "stopped" ? "was stopped" : `ended (${ending})`}, so ` +
        `${unfinished.join(", ")} didn't finish and nothing was saved automatically. Run them from Passes.`
    });
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
      // Stop ends the after-plan passes once the stopped pass's turn ends.
      if (state?.stage === "pass" && state.stopped && !state.passChain.stopped && state.delivery === "accepted" &&
          state.turnId && state.turnId === (run.providerTurnId || run.turnId)) {
        await stopAfterPlanPasses(context, state, "stopped");
        return;
      }
      if (!state || state.status !== "working" || state.delivery !== "accepted") return;
      if (!routingState.allowAuto && state.mode === "auto") {
        state.status = "waiting";
        state.error = "Auto is available in Main chat only. Choose Senior or Junior and send a fresh request.";
        await records.save(context, state);
        return;
      }
      if (!state.turnId) {
        // An inspection that fails decides nothing; the request still settles
        // as waiting, never stays working.
        const receipt = await agent.inspectMessageAdmission(sessionId, {
          messageId: activeMessage(state).messageId || state.messageId,
          threadId: state.threadId
        }, context).catch(() => null);
        if (receipt?.admission === "accepted") state.turnId = receipt.turnId || "";
      }
      if (!state.turnId) {
        state.status = "waiting";
        state.error = "The AI's turn for this request could not be confirmed. Resume to continue it, or Cancel this request.";
        await records.save(context, state);
        return;
      }
      if (state.turnId !== (run.providerTurnId || run.turnId)) return;
      const live = routingState.liveFollowupRequests.get(key) === state.messageId;
      routingState.liveFollowupRequests.delete(key);
      if (!state.workflow && state.stage !== "planning") {
        // An answer in which Senior completed the plan (asked to, say) starts the passes too.
        const current = run.state === "completed" && !state.stopped && state.afterPlan ? await readablePlan(context) : null;
        if (planCompletedDuringRequest(state, current)) {
          completed = await startAfterPlanPasses(context, state, current, { recovered, live });
          return;
        }
        state.status = run.state === "completed" ? "complete" : "waiting";
        await records.save(context, state);
        return;
      }
      // Each after-plan pass's turn ending starts the next pass; one that did not complete ends them.
      if (state.stage === "pass") {
        if (state.stopped || run.state !== "completed") {
          await stopAfterPlanPasses(context, state, state.stopped ? "stopped" : run.state || "stopped");
          return;
        }
        state.passChain.index += 1;
        completed = await continueAfterPlanPasses(context, state, { recovered, live });
        return;
      }
      // Questions the composer offers answer controls for wait for the person's
      // answer, whatever outcome was reported, also when the AI added a short
      // message after them. The tail holds every message since the person's latest
      // one, as far as the lookback can read. Their reply is a new request;
      // nothing resumes this one.
      if (!state.stopped && run.state === "completed" && assistantReplyAsksPerson(latestAssistantQuestionsAwaitingUserReply(
        await context.runtime.store.readConversationTail(sessionId, { userLimit: 1 })
      ))) {
        Object.assign(state, { status: "waiting", awaitingAnswer: true, error: "Waiting for your answer. Reply in chat to continue." });
        await records.save(context, state);
        return;
      }
      const outcome = state.outcome;
      const schedule = { recovered, live };
      // A direct chat's implementation turn that ends without reporting is an
      // ordinary reply: nothing is saved, unless Senior completed a plan in it,
      // which starts the after-plan passes like a reported completion.
      if (state.mode !== "auto" && state.stage === "implementation" && !state.stopped && run.state === "completed" &&
          outcome?.turnId !== state.turnId) {
        const current = state.afterPlan ? await readablePlan(context) : null;
        if (planCompletedDuringRequest(state, current)) {
          completed = await startAfterPlanPasses(context, state, current, schedule);
          return;
        }
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
          state.error = "The work finished, but its final explanation was not confirmed. Check delivery before completing recovery.";
          await records.save(context, state);
          return;
        }
      }
      // A plan completed during this request starts the after-plan passes,
      // which archive it and save the work once the last one ends.
      const current = ["complete", "handoff"].includes(outcome.decision) && state.afterPlan ? plan || await readablePlan(context) : null;
      if (planCompletedDuringRequest(state, current)) {
        completed = await startAfterPlanPasses(context, state, current, schedule);
        return;
      }
      if (outcome.decision === "complete") {
        // A plan completed where no pass runs after it (during a goal) is archived at once.
        if (plan?.status === "completed" && !await archiveCompletedPlan(context, state, plan)) return;
        state.status = "complete";
        await records.save(context, state);
        // A finished review is saved last; an answer or work that changed no files is not.
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
        // Finished implementation ends the work, saved when Automatically save
        // changes is on; only an involved plan Auto's Junior cannot complete gets
        // Senior's turn to check and complete it.
        if (state.stage === "implementation" && !(assistantPlanCompletionFollows(state) && plan?.status === "active")) {
          state.status = "complete";
          await records.save(context, state);
          await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
          completed = saveAfter(context, state);
          return;
        }
      }
      state.steps = (state.steps || 0) + 1;
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
    await records.writeNotice(context, state, assistantAutoSaveNotice(state.turnId));
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
