import { readWorkPlan } from "./assistantWorkPlan.js";
import { workPlanAtPasses } from "../shared/assistantWorkPlan.js";
import { applyPlanPasses, nextPlanPass, readPassRequest } from "./planPasses.js";
import { sameVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingRequestCanBeReplaced,
  assistantRoutingRequestIsUnresolved,
  assistantRoutingFromMetadata,
  assistantGoalIsActive
} from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantExplicitTask, assistantTaskPurpose } from "@local/vibe64-runtime/shared/assistantExplicitTask";
import { ASSISTANT_ROUTING_REQUEST_SCHEMA, failure, readCancelled, read, usesWorkPlan, STATE_KEY } from "./assistantRoutingRequests.js";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {ReturnType<typeof import("./assistantRoutingCancellation.js").createAssistantRoutingCancellation>} AssistantRoutingCancellation */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * The pass a message starts, as a refusal names it: its Genesis title, and its purpose as the
 * suffix of the refusal's codes. A task Genesis does not list as a pass, or as its Master pass,
 * for the session's source is refused before it is sent, and so is a run sent by name (genesisTask,
 * as Run in Passes sends it) of a pass the Genesis serving the project cannot run, with Genesis's
 * reason.
 * @param {{ genesisTask?: string }} input
 * @param {string} task
 * @param {object} context
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} listPasses
 * @returns {Promise<{ name: string, code: string } | null>}
 */
async function explicitPass(input, task, context, listPasses) {
  if (!task) return null;
  const { passes, master } = await listPasses({ projectRoot: sessionSourcePath(context.session) });
  const pass = [...passes, master].find((entry) => entry?.id === task);
  if (!pass) {
    throw Object.assign(
      failure("That pass is not available in this project. Open Passes to choose one.", "vibe64_assistant_routing_pass_unknown"),
      { delivery: "not-sent" }
    );
  }
  if (input.genesisTask && pass.unavailable) {
    throw Object.assign(failure(pass.unavailable, "vibe64_assistant_routing_pass_unavailable"), { delivery: "not-sent" });
  }
  return { name: pass.title, code: assistantTaskPurpose(task) };
}

// How long a message sent while a stopped turn is still ending waits for it to end, and how often it looks.
const STOPPED_TURN_WAIT_MS = 10_000;
const STOPPED_TURN_POLL_MS = 100;

/** Whether the person stopped the saved request after its turn was accepted. */
const isStoppedRequest = request => request?.stopped === true && request.delivery === "accepted" && Boolean(request.turnId);

/**
 * Whether the running native turn is the one the person stopped: the saved request was stopped after its turn was
 * accepted, and the turn running is that turn (or reports no id of its own).
 */
function isStoppedTurn(request, native) {
  return Boolean(native?.turn?.active) && isStoppedRequest(request) && (!native.turn.id || native.turn.id === request.turnId);
}

/**
 * Sending: a message's admission into a new or resumed request, its routing and delivery, and the
 * shutdown that closes the requests still being prepared.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDecisions} dependencies.decisions
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {AssistantRoutingCancellation} dependencies.cancellation
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>} dependencies.exclusive
 * @param {(sessionId: string, options: object) => Promise<object>} dependencies.open
 * @param {(sessionId: string, input: object, context: object) => Promise<object>} dependencies.dispatch
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.interrupt
 * @param {import("./types.js").WritesWhileAssistantWorks} dependencies.writesWhileAssistantWorks
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} dependencies.listPasses
 * @param {import("@local/vibe64-core/server/types").PublishSessionChanged} dependencies.publish
 * @param {(timing: object) => void} dependencies.onTiming
 */
function createAssistantRoutingAdmission({
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
  listPasses,
  publish,
  onTiming,
  logger
}) {
  let closing = false;

  /**
   * A steer joins the running turn, so while a Save or Update holds the agent-write lock it goes straight to that turn
   * instead of waiting for the lock, with the locked path's own checks: none while routing closes, and a message being
   * cancelled is not sent, or its turn is stopped once sent. Its entry in a workflow's steering list joins the
   * request's latest record unless the request was stopped or replaced. Null leaves every other case (no running
   * turn, a cancelled or repeated message) to the ordinary admission.
   */
  async function steerWithoutLock(sessionId, input, options) {
    const notSent = (message, code) => Object.assign(failure(message, code), { delivery: "not-sent" });
    if (closing) throw notSent("The assistant is shutting down. Reconnect before sending.", "vibe64_assistant_routing_unavailable");
    const context = await open(sessionId, options);
    const store = context.runtime.store;
    if ((await readCancelled(store, sessionId)).some(entry => entry.messageId === input.messageId) ||
        await store.conversationMessageIdExists(sessionId, input.messageId)) return null;
    const native = await agent.sessionState(sessionId, context);
    if (!native?.turn?.active) return null;
    if (records.isCancelling(sessionId, context, input.messageId)) {
      throw notSent("Routing cancelled. Your message was not sent.", "vibe64_assistant_routing_cancelled");
    }
    const steered = await read(store, sessionId);
    // A turn the person stopped takes no steering; the ordinary admission routes the message once it ends.
    if (isStoppedTurn(steered, native)) return null;
    const result = await dispatch(sessionId, input, context);
    if (result?.delivered === true && records.isCancelling(sessionId, context, input.messageId)) {
      await interrupt(sessionId, context).catch((error) => logInterruptFailure(sessionId, error));
    }
    let persisted = null;
    if (result?.delivered === true && steered?.workflow === true) {
      await store.mutateSession(sessionId, async () => {
        const latest = await read(store, sessionId);
        if (!latest || latest.stopped || latest.messageId !== steered.messageId ||
            latest.steering.some(({ messageId }) => messageId === input.messageId)) return;
        latest.steering.push({ messageId: input.messageId, text: input.displayMessage || input.message });
        delete latest.outcome;
        await store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(latest));
        persisted = latest;
      });
    }
    if (persisted) await records.announce(context, persisted);
    return result;
  }

  /**
   * Stop ends the turn: the next message is a new request, which Router routes afresh. Sent while the stopped turn is
   * still ending, it waits for that turn to end rather than join it, and is refused, unsent, if it outlasts the wait.
   */
  async function afterStoppedTurn(sessionId, context, state, native) {
    const deadline = Date.now() + STOPPED_TURN_WAIT_MS;
    let current = native;
    while (isStoppedTurn(state, current)) {
      if (Date.now() >= deadline) {
        throw Object.assign(failure(
          "The turn you stopped is still ending. Send your message again once it has stopped.",
          "vibe64_assistant_routing_stopped_turn_ending"
        ), { delivery: "not-sent" });
      }
      await new Promise(resolve => setTimeout(resolve, STOPPED_TURN_POLL_MS));
      current = await agent.sessionState(sessionId, context);
    }
    return current;
  }

  function logInterruptFailure(sessionId, error) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.assistant_routing",
      event: "vibe64.assistant_routing.interrupt_failed",
      sessionId: sessionId,
      code: error?.code,
      error: error?.message
    }, "Stopping a cancelled message's turn failed; the cancel stays recorded.");
  }

  async function send(sessionId, input, options) {
    const owned = Boolean(input?.messageId) && !routingState.timings.has(input.messageId);
    if (owned) routingState.timings.set(input.messageId, { started: performance.now(), stages: {} });
    try {
      return await route(sessionId, input, options);
    } finally {
      const timing = owned && routingState.timings.get(input.messageId);
      if (timing) {
        routingState.timings.delete(input.messageId);
        onTiming({
          sessionId,
          messageId: input.messageId,
          stages: timing.stages,
          elapsedMs: Math.round(performance.now() - timing.started)
        });
      }
    }
  }

  async function route(sessionId, input, options) {
    if (options.purpose && options.purpose !== "junior") throw new TypeError("Generated main-chat work must declare Junior.");
    // Each pass, Deslop and the UI pass among them, runs in its own Senior turn.
    let explicitTask = options.purpose ? "" : assistantExplicitTask(input);
    let explicit = null;
    let context;
    let state;
    let direct;
    // Auto was implementing a plan, waiting (for an answer, say) rather than stopped: a plan change this
    // message asks for lets that implementation go on once Senior has saved it.
    let implementing = false;
    const task = { cancelled: false, finished: Promise.withResolvers() };
    let key;
    // A new message refused here, including while the lock is busy, has not
    // reached the AI. Saying so lets the chat show it as not sent, with Edit and
    // Cancel, instead of an unconfirmed receipt that no delivery check can settle.
    // A retry of an existing request keeps that request's own delivery state.
    let refusedBeforeAdmission = input.reviewAction !== "retry";
    if (input.submissionKind === "steer" && !explicitTask) {
      const steered = await writesWhileAssistantWorks.withoutLock(sessionId, () => steerWithoutLock(sessionId, input, options));
      if (steered) return steered;
    }
    await exclusive(sessionId, options, async (current) => {
      records.mark(input.messageId, "lock-acquired");
      if (closing) throw failure("The assistant is shutting down. Reconnect before sending.", "vibe64_assistant_routing_unavailable");
      context = current;
      key = records.keyFor(sessionId, context);
      // Finish earlier cancels' cleanup first; it never blocks this admission.
      await cancellation.settle(sessionId, context).catch((error) => logOperationalEvent(logger, "warn", {
        component: "vibe64.assistant_routing",
        event: "vibe64.assistant_routing.settle_failed",
        sessionId: sessionId,
        code: error?.code,
        error: error?.message
      }, "Earlier cancels' cleanup failed; this message is still admitted."));
      if ((await readCancelled(context.runtime.store, sessionId)).some(entry => entry.messageId === input.messageId)) {
        throw Object.assign(
          failure("This message was cancelled. Send it again as a new message.", "vibe64_assistant_message_cancelled"),
          { delivery: "not-sent" }
        );
      }
      const preferences = assistantRoutingFromMetadata(context.session.metadata) ||
        (options.purpose || explicitTask ? { mode: options.purpose || "senior" } : null);
      if (!routingState.allowAuto && preferences?.mode === "auto") {
        throw failure("Auto is available in Main chat only. Choose Senior or Junior.", "vibe64_assistant_routing_auto_main_chat_only");
      }
      // Main chat's own passes live in its plan: a pass the person starts (from Passes or by typing)
      // joins the plan, and so do Continue, Run this pass again and Restart from the first pass.
      // Temporary chats, Fix it with AI and lessons run a pass the person starts as its own turn.
      const plansPasses = routingState.allowAuto && !context.runtime?.learningScope && !options.purpose &&
        Boolean(preferences) && preferences.mode !== "fix" && input.reviewAction !== "retry";
      // A steer joins the running turn as written, even when its words name a pass.
      const { listing: passListing, request: passRequest } = plansPasses
        ? await readPassRequest(input, context, listPasses, { typed: input.submissionKind !== "steer" }) : {};
      if (passRequest) {
        explicitTask = "";
        const one = passRequest.ids?.length === 1 ? passRequest.ids[0] : "";
        explicit = one ? { name: passListing.passes.find((pass) => pass.id === one).title, code: assistantTaskPurpose(one) }
          : { name: "The plan's passes", code: "pass" };
      } else {
        explicit = await explicitPass(input, explicitTask, context, listPasses);
      }
      if (input.reviewAction === "retry") {
        if (routingState.running.has(key)) throw failure("Wait for request preparation to finish, or stop it.", "vibe64_assistant_routing_preparation_running");
        state = await read(context.runtime.store, sessionId);
        if (!routingState.allowAuto && state?.mode === "auto") {
          throw failure("Auto is available in Main chat only. Choose Senior or Junior and send a fresh request.", "vibe64_assistant_routing_auto_retry_unavailable");
        }
        if (state?.messageId !== input.messageId || state.status !== "waiting" ||
            !state.followup &&
              state.delivery !== "uncertain" &&
              !(state.delivery === "accepted" && (state.workflow || state.stage === "planning"))) {
          throw failure("There is no pending workflow to resume.", "vibe64_assistant_routing_nothing_to_resume");
        }
        if (state.awaitingAnswer) throw failure("Answer the question in chat. Your reply starts the next step.", "vibe64_assistant_routing_answer_required");
        if (state.delivery !== "uncertain") {
          // Continuing a plan's passes, after Stop too, runs the plan's next pass as the plan now says.
          if (state.stage === "pass") {
            const plan = await readWorkPlan(context);
            const next = workPlanAtPasses(plan) ? await nextPlanPass(context, plan, listPasses) : null;
            if (!next) throw failure("This plan has no pass left to run. Open the plan to check it.", "vibe64_assistant_routing_plan_passes_done");
            if (next.problem) throw failure(`${next.title} can't run: ${next.problem}`, "vibe64_assistant_routing_plan_pass_blocked");
            state.pass = { id: next.id, title: next.title, item: next.item, request: next.request };
            state.planInvolved = true;
            for (const field of ["outcome", "passReply", "planPassNote"]) delete state[field];
            await records.prepareFollowup(context, state, "pass");
          } else if (state.delivery === "accepted" || state.followup && !Array.isArray(state.followup.messages)) {
            const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
            // Continue resumes an implementation from the plan as it now is; another stage needs the plan it left.
            if (usesWorkPlan(state) && plan?.revision !== (state.followup?.planRevision || state.workPlan?.revision) &&
                !(state.stage === "implementation" && plan?.status === "active")) {
              throw failure("The retained plan changed. Inspect it and send a fresh request.", "vibe64_assistant_routing_retained_plan_changed");
            }
            await records.prepareFollowup(context, state, state.stage);
          }
          state.stopped = false;
          state.status = "working";
          state.delivery = "pending";
          state.steps = 0;
          state.stalledTurns = 0;
        }
        try {
          await decisions.admitMigratedRequest(context, state);
          direct = await delivery.deliver(sessionId, context, state, Boolean(state.followup));
        } catch (error) {
          state.delivery = state.attemptedMessageId ? "uncertain" : "pending";
          state.status = "waiting";
          state.error = error.message;
          await records.save(context, state);
          throw error;
        }
        return;
      }
      if (!preferences) {
        direct = true;
        return;
      }
      const store = context.runtime.store;
      state = await read(store, sessionId);
      if (state?.messageId === input.messageId) refusedBeforeAdmission = false;
      // A plan's pass waiting for the person's answer: their next message goes straight back to it.
      const waitingPass = state?.messageId !== input.messageId && state?.stage === "pass" && state.status === "waiting" &&
        state.awaitingAnswer === true && !state.stopped && state.pass?.request ? state.pass : null;
      const duplicate = await store.conversationMessageIdExists(sessionId, input.messageId);
      records.mark(input.messageId, "duplicate-checked");
      if (duplicate) {
        if (state?.messageId === input.messageId && ["uncertain", "sending"].includes(state.delivery)) {
          state.status = "working";
          state.delivery = "accepted";
          delete state.error;
          await records.save(context, state);
        }
        direct = { ok: true, delivered: true, duplicate: true, messageId: input.messageId };
        return;
      }
      if (state?.messageId === input.messageId &&
          (state.delivery === "uncertain" || state.delivery === "sending" && state.attemptedMessageId === input.messageId)) {
        if (state.input.message !== input.message) {
          throw failure("A retry must keep the original message. Cancel it to send an edited request.", "vibe64_assistant_routing_retry_message_changed");
        }
        try {
          direct = await delivery.deliver(sessionId, context, state);
        } catch (error) {
          state.error = error.message;
          await records.save(context, state);
          throw error;
        }
        return;
      }
      let native = await agent.sessionState(sessionId, context);
      records.mark(input.messageId, "native-state");
      // Stop ends the turn: the next message is a new request, also when the composer sent it as a steer of the
      // stopped turn, which it never joins.
      const afterStop = isStoppedRequest(state) && (!native?.turn?.active || isStoppedTurn(state, native));
      if (isStoppedTurn(state, native)) native = await afterStoppedTurn(sessionId, context, state, native);
      // Steering keeps the running model and its instructions. It never goes
      // through the classifier, including while a review turn is running.
      if (native?.turn?.active) {
        if (explicit) {
          throw failure(
            `${explicit.name} uses the Senior model in its own turn. Finish or stop the current turn, then send ${explicit.name} again.`,
            `vibe64_assistant_routing_${explicit.code}_turn_active`
          );
        }
        if (input.submissionKind === "send") throw failure("The assistant started another turn. Review it before sending.", "vibe64_assistant_routing_turn_started");
        // A steered message joins the running turn on that turn's mode and model,
        // even after the saved Chat mode (or Custom model) changed.
        if (state?.workflow === true) task.steeringRequestId = state.messageId;
        direct = true;
        return;
      }
      if (input.submissionKind === "steer" && !afterStop) {
        const completed = ["complete", "completed"].includes(native?.turn?.runState || native?.turn?.state || native?.turn?.status);
        throw Object.assign(failure(
          "That turn has finished. Send this as a new request.",
          completed ? "conversation_steer_turn_finished" : "conversation_not_steerable"
        ), { delivery: "not-sent" });
      }
      if (routingState.running.has(key)) {
        throw failure("This conversation is preparing a request. Cancel it or wait before sending another.", "vibe64_assistant_routing_request_preparing");
      }
      implementing = state?.messageId !== input.messageId && state?.mode === "auto" && state.stage === "implementation" &&
        state.planInvolved === true && state.status === "waiting" && !state.stopped;
      if (state?.messageId !== input.messageId && assistantRoutingRequestCanBeReplaced(state)) {
        state.stopped = true;
        state.review = false;
        state.status = "waiting";
        delete state.error;
        await records.save(context, state);
      }
      if (state?.messageId !== input.messageId &&
          assistantRoutingRequestIsUnresolved(state, vibe64AssistantSelectionFromMetadata(context.session.metadata))) {
        throw failure("Resolve or cancel the pending request before sending another.", "vibe64_assistant_routing_request_unresolved");
      }
      if (state?.helper && state.messageId !== input.messageId) {
        throw failure("Retry cleanup of the previous routing helper before sending another request.", "vibe64_assistant_routing_helper_cleanup_required");
      }
      // A direct chat waits only once its agent has reported, while its next step is prepared.
      if (state?.messageId !== input.messageId && state?.status === "working" && state.delivery === "accepted" && state.workflow === true &&
          (state.mode === "auto" || state.outcome)) {
        const next = state.mode === "auto" ? "Senior review" : "next step";
        throw failure(`The coding turn is preparing its ${next}. Wait for it to finish before sending another request.`, "vibe64_assistant_routing_review_preparing");
      }
      if (state?.messageId === input.messageId) {
        if (!routingState.allowAuto && state.mode === "auto") {
          throw failure("Auto is available in Main chat only. Cancel this request and send a new one to Senior or Junior.", "vibe64_assistant_routing_auto_resend_unavailable");
        }
        if (state.input.message !== input.message) {
          throw failure("A retry must keep the original message. Cancel it to send an edited request.", "vibe64_assistant_routing_retry_message_changed");
        }
        if (state.stopped) throw failure("This request was cancelled. Send your draft as a new request.", "vibe64_assistant_routing_request_stopped");
        await decisions.admitMigratedRequest(context, state);
        if (!state.attemptedMessageId) {
          state.status = "working";
          state.delivery = state.resolvedMode ? "sending" : "routing";
          delete state.error;
          await records.save(context, state);
        }
      } else {
        const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
        const { goal, pinned: savedGoal } = await records.currentGoal(sessionId, context);
        records.mark(input.messageId, "goal-read");
        if (explicit && assistantGoalIsActive(goal)) {
          throw failure(
            `${explicit.name} can't start during the current goal. Open Goal and choose Resume goal to finish it, or Cancel goal to end it, then send ${explicit.name} again.`,
            `vibe64_assistant_goal_${explicit.code}_blocked`
          );
        }
        if (!options.purpose && preferences.mode === "auto" && assistantGoalIsActive(goal) && !savedGoal) {
          throw failure("Choose Senior or Junior before working on a goal.", "vibe64_assistant_goal_auto_unsupported");
        }
        const saved = await records.readRoutingSettings();
        const pinnedGoal = assistantGoalIsActive(goal) && savedGoal;
        if (options.purpose && assistantGoalIsActive(goal) && pinnedGoal?.mode !== options.purpose) {
          throw failure("Finish or cancel the current goal before starting this Junior task.", "vibe64_assistant_goal_junior_task_blocked");
        }
        const mode = pinnedGoal?.mode || options.purpose || preferences.mode;
        const hasPlanRevision = Boolean(input.planRevision);
        // Main chat's own requests are workflows whose plan runs its passes once
        // Senior has reviewed it; an explicit task, generated work, a goal,
        // temporary chats and lessons never are. Deslop must never rewrite a
        // learner's code, and a lesson teaches Save.
        const finishes = routingState.allowAuto && !context.runtime?.learningScope && mode !== "fix" && !explicitTask &&
          !options.purpose && !assistantGoalIsActive(goal);
        // A pass the person asks for joins the plan's Passes (a plan of its own when none is open) and,
        // once the plan is at its Passes step, this message runs the plan's next pass. A reply to a
        // waiting pass runs that pass again, on Senior, with the reply. Passes that can't start yet
        // leave Senior to say so.
        let planPass = null;
        let planPassNote = "";
        if (finishes && (passRequest || waitingPass)) {
          let current = await readWorkPlan(context);
          if (passRequest && passRequest.action !== "add" && current && !workPlanAtPasses(current)) {
            throw failure("This plan's passes start once Senior has reviewed the plan.", "vibe64_assistant_routing_plan_passes_not_yet");
          }
          let added = [];
          if (passRequest) {
            const applied = await applyPlanPasses(context, passRequest, passListing);
            added = applied.added;
            current = await readWorkPlan(context);
            if (applied.notice) {
              await records.writeNotice(context, state, { messageId: `assistant-plan-passes:${input.messageId}`, text: applied.notice });
            }
            await publish(sessionId, { reason: "work-plan-changed", payload: { planNotice: applied.plan?.notice || "" } });
          }
          const next = workPlanAtPasses(current) ? await nextPlanPass(context, current, listPasses) : null;
          // A message that only answers goes back to the pass that asked, while that pass is still the plan's next;
          // otherwise it is an ordinary request.
          if (next && !next.problem && (passRequest || next.item === waitingPass.item)) {
            planPass = { id: next.id, title: next.title, item: next.item, request: next.request };
            if (waitingPass && added.length) planPassNote = `Vibe64 added ${added.join(", ")} to the plan's Passes for this message: each runs after this pass, in its own turn, so don't run it here.`;
          } else if (passRequest && next) {
            planPassNote = `${next.title} can't run: ${next.problem}`;
          } else if (passRequest) {
            planPassNote = current?.status === "active" && added.length
              ? `Vibe64 added ${added.join(", ")} to the current plan's Passes: they run once Senior has reviewed the plan.`
              : "The plan has no pass left to run.";
          }
        }
        const answering = Boolean(planPass && waitingPass && planPass.item === waitingPass.item &&
          (!passRequest || passRequest.action === "add"));
        // The plan as this request found it: only a plan reviewed or completed
        // during the request moves on to its passes, never one already there.
        // Auto works from its plan; a direct chat only notes it, and an
        // unreadable one is none there, as before passes ran after plans.
        const plan = mode === "auto" ? await readWorkPlan(context)
          : finishes ? await readWorkPlan(context).catch(() => null) : null;
        if (hasPlanRevision && mode !== "auto") throw failure("Choose Auto to implement its plan. Direct roles work from your message.", "vibe64_assistant_routing_plan_requires_auto");
        if (hasPlanRevision && (!plan || plan.status !== "active" || plan.revision !== input.planRevision)) {
          throw failure("The active plan changed. Read the current plan before sending your request.", "vibe64_assistant_routing_plan_changed");
        }
        let resolvedMode = mode;
        if (explicitTask || planPass || planPassNote) resolvedMode = ["custom", "fix"].includes(mode) ? mode : "senior";
        else if (mode === "auto") resolvedMode = "";
        const review = mode === "auto" && finishes && !planPass && !planPassNote;
        // A Senior, Junior or Custom chat's request is its agent's work from the
        // start; Auto's becomes a workflow when Router classifies it.
        const direct = finishes && mode !== "auto" && !planPassNote;
        state = {
          messageId: input.messageId,
          input: {
            ...Object.fromEntries(Object.entries(input).filter(([name]) => [
              "message", "displayMessage", "attachmentIds", "displayAttachments", "genesisTask",
              "originId", "presentation", "promptLabel", "outputSchema", "planRevision"
            ].includes(name))),
            ...(input.turnMetadata?.projectMessage || input.turnMetadata?.source || input.turnMetadata?.sender ? {
              turnMetadata: Object.fromEntries(
                ["projectMessage", "source", "sender"].filter(name => input.turnMetadata[name])
                  .map(name => [name, input.turnMetadata[name]])
              )
            } : {})
          },
          mode,
          resolvedMode,
          ...(explicitTask ? { task: explicitTask } : {}),
          ...(planPass ? { pass: planPass } : {}),
          ...(answering ? { passReply: true } : {}),
          ...(planPassNote ? { planPassNote } : {}),
          reason: explicitTask || planPass ? "review" : planPassNote ? "conversation" : "",
          afterPlan: finishes ? { planAtAdmission: plan ? { status: plan.status, revision: plan.revision } : null } : null,
          workPlan: mode === "auto" || planPass ? plan : null,
          schemaVersion: ASSISTANT_ROUTING_REQUEST_SCHEMA,
          observedSelection: selection,
          configuration: pinnedGoal?.configuration || { revision: saved.revision, owner: saved.owner, nonOwner: saved.nonOwner },
          override: pinnedGoal ? pinnedGoal.override || (!pinnedGoal.configuration ? {
            role: mode,
            selection: pinnedGoal.selection
          } : undefined)
            : !options.purpose && preferences.override ? { role: mode, selection: preferences.override } : undefined,
          settingsRevision: pinnedGoal?.settingsRevision ?? saved.revision,
          status: "working",
          delivery: resolvedMode ? "sending" : "routing",
          createdAt: new Date().toISOString(),
          review,
          workflow: direct || Boolean(planPass),
          stage: planPass ? "pass" : direct ? "implementation" : null,
          steps: 0,
          stalledTurns: 0,
          steering: [],
          planInvolved: hasPlanRevision || Boolean(planPass),
          submittedBy: context.vibe64User ? Object.fromEntries(["username", "id", "role", "email", "preferredName"]
            .filter((name) => context.vibe64User[name] !== undefined)
            .map((name) => [name, context.vibe64User[name]])) : null
        };
        state.decision = await decisions.resolve(context, state);
        // The tool at admission; main chat's is the owner's Senior and Junior tool.
        state.workflowEngineId = pinnedGoal?.workflowEngineId || state.decision.engineId;
        records.mark(input.messageId, "resolved");
        if (assistantGoalIsActive(goal) &&
            !pinnedGoal &&
            !sameVibe64AssistantSelection(decisions.destinations(state.decision)[mode]?.effectiveSelection, selection)) {
          throw failure("Finish or cancel the current goal before changing its AI.", "vibe64_assistant_goal_ai_change_blocked");
        }
        // A goal pins its model, not a login that may have been replaced. This
        // new request captures current access; validateDecision still fences delivery.
        if (pinnedGoal?.selection &&
            !sameVibe64AssistantSelection(decisions.destinations(state.decision)[mode]?.effectiveSelection, pinnedGoal.selection)) {
          throw failure("The goal's pinned AI is no longer available. Choose its destination before resuming.", "vibe64_assistant_goal_pinned_ai_unavailable");
        }
        state.assignments = Object.fromEntries(
          Object.entries(decisions.destinations(state.decision)).map(([role, destination]) => [role, destination.effectiveSelection])
        );
        await records.save(context, state);
        records.mark(input.messageId, "route-saved");
      }
      if (closing) throw failure("The assistant is shutting down. Reconnect before sending.", "vibe64_assistant_routing_unavailable");
      task.close = async () => {
        await cancellation.cancel(sessionId, options, { waitForCleanup: true });
        const persisted = await read(context.runtime.store, sessionId);
        if (persisted?.messageId === state.messageId && persisted.helper) {
          throw failure("The routing helper could not be closed. Retry after reconnecting the assistant.", "vibe64_assistant_routing_helper_close_failed");
        }
      };
      task.messageId = state.messageId;
      routingState.running.set(key, task);
    }).catch((error) => {
      if (refusedBeforeAdmission && error && typeof error === "object" && !error.delivery) error.delivery = "not-sent";
      throw error;
    });
    if (direct === true) {
      return exclusive(sessionId, options, async (current) => {
        records.mark(input.messageId, "dispatch-called");
        if (records.isCancelling(sessionId, current, input.messageId)) {
          throw Object.assign(
            failure("Routing cancelled. Your message was not sent.", "vibe64_assistant_routing_cancelled"),
            { delivery: "not-sent" }
          );
        }
        const result = await dispatch(sessionId, input, current);
        records.mark(input.messageId, "dispatched");
        // A Cancel that arrived during dispatch stops the turn this message started.
        if (result?.delivered === true && records.isCancelling(sessionId, current, input.messageId)) {
          await interrupt(sessionId, current).catch((error) => logInterruptFailure(sessionId, error));
        }
        if (result?.delivered === true && task.steeringRequestId) {
          const persisted = await read(current.runtime.store, sessionId);
          if (persisted?.messageId === task.steeringRequestId &&
            !persisted.steering.some(({ messageId }) => messageId === input.messageId)) {
            persisted.steering.push({ messageId: input.messageId, text: input.displayMessage || input.message });
            delete persisted.outcome;
            await records.save(current, persisted);
          }
        }
        return result;
      });
    }
    if (direct) return direct;
    try {
      if (!state.resolvedMode) {
        // The explicit Implement plan action already supplies its intent and
        // exact plan revision. Do not ask Router to reinterpret that approval.
        const decision = state.input.planRevision ? { mode: "junior", reason: "implementation" }
          : await decisions.classify(sessionId, context, state, task, options);
        // An addressed role is an instruction, not a classifier suggestion; only Senior makes a plan, so
        // planning is Senior's whatever role the Router or the message names.
        const requestedRole = /^\s*(senior|junior)(?:\s+developer)?\s*[:,]\s*\S/iu.exec(state.input.message)?.[1]?.toLowerCase();
        state.resolvedMode = decision.reason === "planning" ? "senior" : requestedRole || decision.mode;
        state.reason = decision.reason;
        if (decision.reason === "planning" && implementing && state.mode === "auto") state.resumeImplementation = true;
        state.stage = decision.reason === "conversation" ? null : decision.reason;
        state.workflow = ["implementation", "review"].includes(decision.reason);
        state.review = state.workflow;
        if (decision.reason === "conversation") state.workPlan = null;
      }
      if (task.cancelled) throw failure("Routing cancelled.", "vibe64_assistant_routing_task_cancelled");
      return await exclusive(sessionId, options, async (current) => {
        records.mark(state.messageId, "delivery-lock-acquired");
        const persisted = await read(current.runtime.store, sessionId);
        if (task.cancelled || persisted?.stopped) throw failure("Routing cancelled.", "vibe64_assistant_routing_task_cancelled");
        return delivery.deliver(sessionId, current, state);
      });
    } catch (error) {
      // A fully persisted cancellation needs no further mutation. Another
      // conversation starting must not turn it into a write-admission error.
      const persisted = await read(context.runtime.store, sessionId);
      if (persisted?.messageId === state.messageId && persisted.stopped &&
          !persisted.helper && !persisted.attemptedMessageId) {
        throw failure("Routing cancelled. Your message was not sent.", "vibe64_assistant_routing_cancelled");
      }
      const cancelled = await exclusive(sessionId, options, async (current) => {
        const latest = await read(current.runtime.store, sessionId);
        if (latest?.messageId !== state.messageId) return;
        if (latest.stopped) {
          if (latest.helper) {
            latest.error = error.message;
            await records.save(current, latest);
          }
          return !latest.helper && !latest.attemptedMessageId;
        }
        state.delivery = state.attemptedMessageId ? "uncertain" : "failed";
        state.status = "waiting";
        state.error = error.message;
        await records.save(current, state);
      });
      if (cancelled) throw failure("Routing cancelled. Your message was not sent.", "vibe64_assistant_routing_cancelled");
      throw error;
    } finally {
      routingState.running.delete(key);
      task.finished.resolve();
    }
  }

  async function close() {
    closing = true;
    const tasks = [...routingState.running.values()];
    for (const task of tasks) task.cancelled = true;
    const results = await Promise.allSettled(tasks.map((task) => task.close()));
    await Promise.allSettled(routingState.settling);
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Assistant routing shutdown did not complete successfully.");
  }

  function isClosing() {
    return closing;
  }

  return Object.freeze({
    send,
    close,
    isClosing
  });
}

export {
  createAssistantRoutingAdmission
};
