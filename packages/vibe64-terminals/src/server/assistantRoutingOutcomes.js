import { parseWorkPlanLines, workPlanAtPasses, workPlanPassItems, workPlanScope, workPlanStep } from "../shared/assistantWorkPlan.js";
import { readWorkPlan, manageWorkPlan } from "./assistantWorkPlan.js";
import { rememberAfterPlanBase } from "./afterPlanBase.js";
import { nextPlanPass } from "./planPasses.js";
import { assistantRoutingOutcomeNotice, assistantWorkflowRole } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  assistantAutoSaveNotice,
  assistantPlanCompletionFollows,
  planPassNotice
} from "@local/vibe64-runtime/shared/assistantFinishing";
import {
  assistantReplyAsksPerson,
  latestAssistantQuestionsAwaitingUserReply
} from "@local/vibe64-runtime/shared/conversationQuestions";
import { read, failure, activeMessage, assistantPlanHandsOff, savesAutomatically, usesWorkPlan } from "./assistantRoutingRequests.js";
import { askWholeChecks, writeWholeChecksQuestion } from "./assistantWholeChecks.js";
import { PLAN_HANDOFF_OPERATIONS, assistantPlanHandoffNotice } from "./assistantPlanHandoff.js";
import { createAssistantRoutingInterruptions } from "./assistantRoutingInterruptions.js";
import { createAssistantRoutingOwedSteps } from "./assistantRoutingOwedSteps.js";
import { createAssistantPlanCheck } from "./assistantPlanCheck.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {import("./types.js").AssistantRoutingAdmission} AssistantRoutingAdmission */

const MAX_WORKFLOW_STEPS = 8;
// The items a plan has built: a turn that builds one more starts a fresh allowance of steps.
const builtItems = (plan) => typeof plan?.text === "string"
  ? parseWorkPlanLines(plan.text).filter((entry) => !entry.passes && entry.built).length : 0;
// Whether a plan completed during a request asks only for a readable plan: an
// unreadable one is none, so a request that never used the plan finishes as it did.
const readablePlan = context => readWorkPlan(context).catch(() => null);

/**
 * Whether this request brought its plan to its passes, or completed it: a request the chat runs a
 * plan's passes for, whose plan reached its Passes step or completed during it rather than being
 * found that way when it was admitted. Only Senior's review brings a plan to its passes: Junior's
 * ticks leave it for that review.
 * @param {object} request the saved routing request
 * @param {{ status: string, revision: string, text: string } | null} plan the current plan
 */
function planFinishedDuringRequest(request, plan) {
  return Boolean(request?.afterPlan) && Boolean(plan) &&
    (plan.status === "completed" || workPlanAtPasses(plan) && assistantWorkflowRole(request) === "senior") &&
    request.afterPlan.planAtAdmission?.revision !== plan.revision;
}

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
 *   Genesis offers for the session's source, read as each of a plan's passes starts.
 * @param {import("./types.js").ServerRun} dependencies.serverRun This editor process's run, against which a turn an
 *   earlier run sent is told apart, with how that run ended.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger Where each interrupted turn's
 *   outcome is recorded.
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
  listPasses,
  serverRun,
  logger
}) {
  // An automatic step another turn or message came before: owed, then decided again (assistantRoutingOwedSteps.js).
  const owed = createAssistantRoutingOwedSteps({ routingState, records, delivery, admission, agent, exclusiveAfterWrites });
  const { exclusiveAtTurnEnd, oweRefusedStep, settleRefusedStep, owesStep, continueOwed, continueRecovered } = owed;
  // What follows a turn an interruption ended: its red entry, and its resume once (assistantRoutingInterruptions.js).
  const { interruptionOf, afterInterruption, resumeUnsent, scheduleResume, stopUnrecovered } = createAssistantRoutingInterruptions({
    routingState,
    records,
    delivery,
    admission,
    exclusiveAfterWrites,
    oweRefusedStep,
    serverRun,
    logger
  });
  const planCheck = createAssistantPlanCheck({ routingState, records, delivery });

  /**
   * The active agent declares an outcome; this does not dispatch while its turn runs. Its identity is the workflow a
   * plan read returns (messageId, turnId, stage and, when given, status), under the same names.
   */
  async function recordOutcome(sessionId, input, options) {
    return exclusiveAfterWrites(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || (!state.workflow && state.stage !== "planning") || state.stopped ||
          state.status !== "working" || state.delivery !== "accepted" || input.messageId !== state.messageId ||
          input.turnId !== state.turnId || input.stage !== state.stage || (input.status !== undefined && input.status !== state.status)) {
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
      // A plan change made while the plan is being implemented hands the implementation back once it is saved.
      const resumes = state.stage === "planning" && state.resumeImplementation === true && input.decision === "handoff";
      if (state.stage === "planning" && !["continue", "wait"].includes(input.decision) && !resumes) {
        throw failure("Planning alone does not authorise implementation or plan completion.", "vibe64_assistant_workflow_planning_outcome_refused");
      }
      const pass = state.stage === "pass" ? state.pass : null;
      if (pass && input.decision === "handoff") {
        throw failure("A pass reports continue, wait or complete: it fixes what it finds itself.", "vibe64_assistant_workflow_pass_handoff_refused");
      }
      const involvesPlan = Boolean(pass) || resumes || input.expectedRevision !== undefined || state.planInvolved;
      // Only Senior completes a plan, and in Auto only Senior completes the work
      // at all. A direct chat's Junior or Custom completes only work that changed
      // no files and involves no plan; a plan's pass, a Custom chat's too, completes its own item.
      const senior = assistantWorkflowRole(state) === "senior" || Boolean(pass);
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
      // A plan stays in Implementation until every item outside its Passes is built: Auto's
      // implementation reaches Senior's review only then.
      const open = state.mode === "auto" && state.stage === "implementation" && input.decision === "handoff" &&
        involvesPlan && plan.status === "active" ? workPlanStep(plan) : null;
      if (open?.step === "implementation") {
        const message = `The plan stays in Implementation until every item is built: item ${open.item} of ${open.items}, ` +
          `“${open.title}”, is still - [ ]. Implement it in the plan's order and half-tick it, then report handoff; ` +
          "report wait with numbered questions if it needs the person.";
        throw failure(message, "vibe64_assistant_workflow_plan_items_open");
      }
      // A pass is Done once its own Passes item is ticked; the plan stays active for the next one.
      if (pass && input.decision === "complete" &&
          !(plan.status === "active" && workPlanPassItems(plan.text).some((item) => item.text === pass.item && item.checked))) {
        const message = `Full-tick this pass's Passes item (- [x] ${pass.item}) once everything in its scope is fixed and proven, ` +
          "then report complete.";
        throw failure(message, "vibe64_assistant_workflow_pass_unticked");
      }
      // Senior's review is Done once every item outside Passes is ticked: a plan with passes then
      // moves on to them, and one without is completed by Senior.
      const scope = (text) => workPlanScope(text, { passes: false });
      if (!pass && involvesPlan && input.decision === "complete" && (!(plan.status === "completed" || workPlanAtPasses(plan)) ||
          state.workPlan && scope(plan.text) !== scope(state.workPlan.text))) {
        const message = "Senior must verify and full-tick every item of the exact agreed plan outside its Passes, " +
          "and explicitly complete a plan that has no Passes items, before completing the workflow.";
        throw failure(message, "vibe64_assistant_workflow_plan_incomplete");
      }
      if (involvesPlan && input.decision !== "complete" && plan.status !== "active") {
        throw failure("The involved plan is no longer active.", "vibe64_assistant_workflow_plan_inactive");
      }
      // A turn that built another of the plan's items has made progress: its next steps get a fresh allowance.
      if (involvesPlan && builtItems(plan) > builtItems(state.workPlan)) state.steps = 0;
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
   * Finished work is saved when the chat's Automatically save changes is on
   * now; Save itself runs after the lock.
   */
  function saveAfter(context, state) {
    return savesAutomatically(context.session.metadata) ? { context, state, save: true } : null;
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
   * A plan that reached its Passes step, or whose pass is Done: Vibe64 starts its next pass, the
   * first Passes item not yet ticked, read from the plan, in a Senior turn of its own. A pass the
   * Genesis serving this project cannot run, or the plan's changes without a start in the session's
   * history, leaves the plan waiting at that pass with the reason. With every pass ticked the plan
   * is completed.
   * @returns {Promise<{ context: object, state: object } | null>} the finished work to save, if any
   */
  async function continuePlanPasses(context, state, { recovered, live, ended }) {
    const plan = await readablePlan(context);
    const atPasses = workPlanAtPasses(plan);
    const next = atPasses ? await nextPlanPass(context, plan, listPasses) : null;
    if (!next && (atPasses || plan?.status === "completed")) return finishPlan(context, state, plan);
    // The plan changed under the request (an item was unticked, say): its work ends here, and Senior
    // or Passes takes it on from what the plan now says.
    if (!next) {
      state.status = "complete";
      await records.save(context, state);
      return null;
    }
    // The passes are this request's workflow, whatever its own turn was.
    Object.assign(state, { workflow: true, stage: "pass", planInvolved: true, steps: 0, stalledTurns: 0 });
    for (const field of ["outcome", "awaitingAnswer", "passReply", "error"]) delete state[field];
    state.pass = { id: next.id, title: next.title, item: next.item, request: next.request };
    if (next.problem) {
      state.pass = { title: next.title, item: next.item };
      state.status = "waiting";
      state.error = `${next.title} can't run: ${next.problem} ${next.fix || "Change the plan's Passes, or put it right and choose Continue in Passes."}`;
      await records.save(context, state);
      await records.writeNotice(context, state, { messageId: `assistant-plan-pass-blocked:${state.turnId}:${next.item}`, text: state.error });
      return null;
    }
    await records.prepareFollowup(context, state, "pass");
    state.status = "working";
    await records.save(context, state);
    await records.writeNotice(context, state, planPassNotice(state.pass, state.followup.messageId));
    if (recovered && !live) {
      await continueRecovered(context, state, ended);
      return null;
    }
    try {
      await delivery.deliver(context.session.sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
    } catch (error) {
      await settleRefusedStep(context, state, error);
    }
    return null;
  }

  /**
   * Every step of the plan is Done: Vibe64 completes it (Senior completed a plan without passes
   * already), archives it, moves the next passes' base to the session's HEAD, and saves the finished
   * work when Automatically save changes is on, then asks the person whether to run the whole-project checks.
   */
  async function finishPlan(context, state, plan) {
    let current = plan;
    if (current?.status === "active") {
      try {
        await manageWorkPlan(context, {
          operation: "complete",
          expectedRevision: current.revision,
          expectedProgressRevision: current.progressRevision || ""
        }, "review");
        current = await readWorkPlan(context);
      } catch (error) {
        state.status = "waiting";
        state.error = `The plan's steps are done, but the plan could not be completed: ${error.message}`;
        await records.save(context, state);
        return null;
      }
    }
    if (current?.status === "completed" && !await archiveCompletedPlan(context, state, current)) return null;
    await rememberAfterPlanBase(context.runtime.store, context.session);
    state.status = "complete";
    askWholeChecks(state, current);
    await records.save(context, state);
    return { context, state, save: savesAutomatically(context.session.metadata), ask: true };
  }

  /** Main chat's owed step, decided again when the planned restart that paused it did not happen. */
  async function decideOwed(sessionId) {
    await exclusiveAtTurnEnd(sessionId, {}, async context => {
      if (admission.isClosing() || routingState.running.has(records.keyFor(sessionId, context))) return;
      const state = await read(context.runtime.store, sessionId);
      if (owesStep(state)) await continueOwed(context, state);
    });
  }

  async function afterTurn(sessionId, payload, routingOptions, options = {}) {
    const { recovered = false } = options;
    const run = payload?.payload?.agentRun;
    if (!run || run.active) return;
    let completed;
    await exclusiveAtTurnEnd(sessionId, routingOptions, async context => {
      const key = records.keyFor(sessionId, context);
      if (admission.isClosing() || routingState.running.has(key)) return;
      const state = await read(context.runtime.store, sessionId);
      // A step another turn came before is decided again now that a turn has ended, whichever turn it was.
      if (owesStep(state)) return continueOwed(context, state);
      // A stopped turn, a plan's pass too, is already paused: it waits for Continue.
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
      // The message the ended turn was sent as.
      const ended = activeMessage(state).messageId || state.messageId;
      const planCheckFrom = planCheck.takeStart(key, ended);
      // A plan change only Senior may make, refused in this turn, makes the request Senior's planning turn, unless
      // the person stopped it or the turn did not complete.
      if (state.planHandoff) {
        if (state.planHandoff.turnId === state.turnId && !state.stopped && run.state === "completed") {
          await continueWithSeniorPlan(context, state, { recovered, live, ended });
          return;
        }
        delete state.planHandoff;
      }
      const interruption = await interruptionOf(state, run);
      if (interruption && await afterInterruption(sessionId, context, state, interruption, routingOptions)) return;
      // The plan check's own turn ended: the request settles as the turn before it would have. Any other turn that
      // changed the source but not the plan gets the check first.
      if (await planCheck.afterTurn(context, state, run, recovered && !live ? null : planCheckFrom)) return;
      if (!state.workflow && state.stage !== "planning") {
        // An answer in which Senior reviewed or completed the plan (asked to, say) moves it on too.
        const current = run.state === "completed" && !state.stopped && state.afterPlan ? await readablePlan(context) : null;
        if (planFinishedDuringRequest(state, current)) {
          completed = await continuePlanPasses(context, state, { recovered, live, ended });
          return;
        }
        state.status = run.state === "completed" ? "complete" : "waiting";
        await records.save(context, state);
        return;
      }
      // Questions the composer offers answer controls for wait for the person's
      // answer, whatever outcome was reported, also when the AI added a short
      // message after them. The tail holds every message since the person's latest
      // one, as far as the lookback can read. Their reply is a new request, which
      // goes straight back to a plan's waiting pass; nothing resumes any other.
      // Vibe64's own handoff of a built plan to Senior's review goes ahead: Senior asks what is still open.
      const reviewing = state.outcome?.vibe64 === true && state.outcome.turnId === state.turnId;
      if (!state.stopped && run.state === "completed" && !reviewing && assistantReplyAsksPerson(latestAssistantQuestionsAwaitingUserReply(
        await context.runtime.store.readConversationTail(sessionId, { userLimit: 1 })
      ))) {
        Object.assign(state, { status: "waiting", awaitingAnswer: true, error: "Waiting for your answer. Reply in chat to continue." });
        await records.save(context, state);
        return;
      }
      const outcome = state.outcome;
      const schedule = { recovered, live, ended };
      // A direct chat's implementation turn that ends without reporting is an
      // ordinary reply: nothing is saved, unless Senior reviewed or completed a
      // plan in it, which moves the plan on like a reported completion.
      if (state.mode !== "auto" && (state.stage === "implementation" || state.stage === "review" && state.planReview) &&
          !state.stopped && run.state === "completed" && outcome?.turnId !== state.turnId) {
        const current = state.afterPlan ? await readablePlan(context) : null;
        if (planFinishedDuringRequest(state, current)) {
          completed = await continuePlanPasses(context, state, schedule);
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
      // A Done pass, or a plan this request reviewed or completed, moves the plan on: its next
      // pass starts, or, after the last, the plan is completed, archived and the work saved.
      const current = ["complete", "handoff"].includes(outcome.decision) && state.afterPlan ? plan || await readablePlan(context) : null;
      if (state.stage === "pass" && outcome.decision === "complete" || planFinishedDuringRequest(state, current)) {
        completed = await continuePlanPasses(context, state, schedule);
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
        // A pass that needs the person waits for their reply, which goes straight back to it.
        if (state.stage === "pass") {
          Object.assign(state, { awaitingAnswer: true, error: "Waiting for your answer. Reply in chat to continue." });
          await records.save(context, state);
          return;
        }
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
      if (outcome.decision === "handoff" && state.stage === "planning") {
        // Senior saved a change to the plan being implemented: the implementation goes on, Junior's in Auto.
        nextStage = "implementation";
        Object.assign(state, { resolvedMode: "junior", reason: "implementation", workflow: true, review: true, planInvolved: true });
      } else if (outcome.decision === "handoff") {
        // Rework returns to implementation: Junior's in Auto, the same agent's otherwise.
        const auto = state.mode === "auto";
        const returning = state.stage === "review" && (!auto || assistantWorkflowRole(state) === "senior");
        nextStage = returning ? "implementation" : "review";
        if (returning && auto) state.resolvedMode = "junior";
        // Finished implementation ends the work, saved when Automatically save
        // changes is on; only an involved plan Auto's Junior cannot complete gets
        // Senior's turn to check and complete it.
        if (state.stage === "implementation" && !((assistantPlanCompletionFollows(state) || outcome.vibe64) && plan?.status === "active")) {
          state.status = "complete";
          await records.save(context, state);
          await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
          completed = saveAfter(context, state);
          return;
        }
      }
      state.steps = (state.steps || 0) + 1;
      await records.prepareFollowup(context, state, nextStage);
      if (nextStage === "implementation") delete state.resumeImplementation;
      state.status = "working";
      await records.save(context, state);
      await records.writeNotice(context, state, assistantRoutingOutcomeNotice(state));
      // A restart cut off this turn's scheduling: the next server's recovery decides the step as an owed one.
      if (recovered && !live) return continueRecovered(context, state, ended);
      try {
        await delivery.deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
      } catch (error) {
        await settleRefusedStep(context, state, error);
      }
    });
    // After the lock: finished work's automatic save runs last, once the turn
    // has ended; its start notice and short result note join the chat. A
    // finished plan's question about the whole-project checks follows it.
    if (!completed) return;
    const { context, state } = completed;
    if (completed.save) {
      await records.writeNotice(context, state, assistantAutoSaveNotice(state.turnId));
      let note;
      try {
        note = await onPlanCompleted(sessionId, { submittedBy: state.submittedBy });
      } catch (error) {
        note = `Automatic save didn't run: ${error.message}`;
      }
      if (note) await records.writeNotice(context, state, { messageId: `assistant-plan-saved:${state.turnId}`, text: note });
    }
    if (completed.ask) await writeWholeChecksQuestion(records, context, state);
  }

  async function reconcile(sessionId, options) {
    let outcome;
    await exclusive(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || routingState.running.has(records.keyFor(sessionId, context))) return;
      // An earlier server still running (a brief overlap at restart) owns what it sent; recovery tries again later.
      if (await serverRun.isRunning(state.serverRunId || "")) return;
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
      // A request left preparing or sending ended with the run that sent it, or (in this run) with an error.
      const leftSending = ["routing", "sending"].includes(state.delivery);
      if (leftSending) {
        state.delivery = state.attemptedMessageId ? "uncertain" : state.followup ? "pending" : "failed";
        state.status = "waiting";
        state.error = state.attemptedMessageId
          ? "Delivery was interrupted. Check its original receipt before continuing."
          : "Preparation was interrupted. Resume when ready.";
        await records.save(context, state);
      }
      const savedToSend = state.status === "working" && state.delivery === "pending" && state.followup && !state.attemptedMessageId;
      if ((leftSending || savedToSend) && !state.stopped && (state.serverRunId || "") !== serverRun.id &&
          await resumeUnsent(sessionId, context, state)) {
        return;
      }
      if (state.status === "waiting" && state.resumeAt && state.followup && !state.stopped) {
        // A resume waiting out its backoff, which an earlier run (or this one) scheduled: it is resumed at its time.
        scheduleResume(sessionId, state, options);
        return;
      }
      // An owed step an earlier server left is decided at recovery; within one run only a turn's end decides it.
      if (owesStep(state) && (state.serverRunId || "") !== serverRun.id) return continueOwed(context, state);
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
        } else if (state.turnId && (state.serverRunId || "") !== serverRun.id) {
          // A turn an earlier run sent that nothing runs now ended with that run, without reporting its end.
          outcome = { active: false, state: "interrupted", providerTurnId: state.turnId };
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
    handPlanToSenior,
    afterTurn,
    decideOwed,
    reconcile,
    stopUnrecovered
  });
}

export {
  createAssistantRoutingOutcomes
};
