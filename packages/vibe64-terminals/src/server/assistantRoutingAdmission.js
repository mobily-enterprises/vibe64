import { readWorkPlan } from "./assistantWorkPlan.js";
import { sameVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingStatusIsPending,
  assistantRoutingRequestCanBeReplaced,
  assistantRoutingFromMetadata,
  assistantGoalIsActive
} from "@local/vibe64-runtime/shared/assistantRouting";
import { failure, readCancelled, read, usesWorkPlan } from "./assistantRoutingRequests.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {ReturnType<typeof import("./assistantRoutingCancellation.js").createAssistantRoutingCancellation>} AssistantRoutingCancellation */

/**
 * Sending: a message's admission into a new or resumed request, its routing and delivery, and the
 * shutdown that closes the requests still being prepared.
 * @param {object} dependencies
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDecisions} dependencies.decisions
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {AssistantRoutingCancellation} dependencies.cancellation
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>} dependencies.exclusive
 * @param {(sessionId: string, input: object, context: object) => Promise<object>} dependencies.dispatch
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.interrupt
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
  dispatch,
  interrupt,
  onTiming
}) {
  let closing = false;

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
    const explicitDeslop = !options.purpose && (input.genesisTask === "deslop" || /^\s*deslop[.!]?\s*$/iu.test(input.message));
    let context;
    let state;
    let direct;
    const task = { cancelled: false, finished: Promise.withResolvers() };
    let key;
    // A new message refused here, including while the lock is busy, has not
    // reached the AI. Saying so lets the chat show it as not sent, with Edit and
    // Cancel, instead of an unconfirmed receipt that no delivery check can settle.
    // A retry of an existing request keeps that request's own delivery state.
    let refusedBeforeAdmission = input.reviewAction !== "retry";
    await exclusive(sessionId, options, async (current) => {
      records.mark(input.messageId, "lock-acquired");
      if (closing) throw failure("The assistant is shutting down. Reconnect before sending.");
      context = current;
      key = records.keyFor(sessionId, context);
      // Finish earlier cancels' cleanup first; it never blocks this admission.
      await cancellation.settle(sessionId, context).catch(() => {});
      if ((await readCancelled(context.runtime.store, sessionId)).some(entry => entry.messageId === input.messageId)) {
        throw Object.assign(failure("This message was cancelled. Send it again as a new message.", "vibe64_assistant_message_cancelled"),
          { delivery: "not-sent" });
      }
      const preferences = assistantRoutingFromMetadata(context.session.metadata) ||
        (options.purpose || explicitDeslop ? { mode: options.purpose || "senior", review: false } : null);
      if (!routingState.allowAuto && preferences?.mode === "auto") {
        throw failure("Auto is available in Main chat only. Choose Senior or Junior.");
      }
      if (input.reviewAction === "retry") {
        if (routingState.running.has(key)) throw failure("Wait for request preparation to finish, or stop it.");
        state = await read(context.runtime.store, sessionId);
        if (!routingState.allowAuto && state?.mode === "auto") {
          throw failure("Auto is available in Main chat only. Choose Senior or Junior and send a fresh request.");
        }
        if (state?.messageId !== input.messageId || state.status !== "waiting" ||
            !state.followup &&
              state.delivery !== "uncertain" &&
              !(state.delivery === "accepted" && (state.workflow || state.stage === "planning"))) {
          throw failure("There is no pending workflow to resume.");
        }
        if (state.awaitingAnswer) throw failure("Answer the question in chat. Your reply starts the next step.");
        if (state.delivery !== "uncertain") {
          if (state.delivery === "accepted" || state.followup && !Array.isArray(state.followup.messages)) {
            const plan = usesWorkPlan(state) ? await readWorkPlan(context) : null;
            if (usesWorkPlan(state) && plan?.revision !== (state.followup?.planRevision || state.workPlan?.revision)) {
              throw failure("The retained plan changed. Inspect it and send a fresh request.");
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
          throw failure("A retry must keep the original message. Cancel it to send an edited request.");
        }
        try { direct = await delivery.deliver(sessionId, context, state); }
        catch (error) {
          state.error = error.message;
          await records.save(context, state);
          throw error;
        }
        return;
      }
      const native = await agent.sessionState(sessionId, context);
      records.mark(input.messageId, "native-state");
      // Steering keeps the running model and its instructions. It never goes
      // through the classifier, including while a review turn is running.
      if (native?.turn?.active) {
        if (explicitDeslop) {
          throw failure("Deslop uses the Senior model in its own turn. Finish or stop the current turn, then send Deslop again.");
        }
        if (input.submissionKind === "send") throw failure("The assistant started another turn. Review it before sending.");
        // A steered message joins the running turn on that turn's mode and model,
        // even after the saved Chat mode (or Custom model) changed.
        if (state?.workflow === true) task.steeringRequestId = state.messageId;
        direct = true;
        return;
      }
      if (input.submissionKind === "steer") {
        const completed = ["complete", "completed"].includes(native?.turn?.runState || native?.turn?.state || native?.turn?.status);
        throw Object.assign(failure("That turn has finished. Send this as a new request.",
          completed ? "conversation_steer_turn_finished" : "conversation_not_steerable"), { delivery: "not-sent" });
      }
      if (routingState.running.has(key)) {
        throw failure("This conversation is preparing a request. Cancel it or wait before sending another.");
      }
      if (state?.messageId !== input.messageId && assistantRoutingRequestCanBeReplaced(state)) {
        state.stopped = true;
        state.review = false;
        state.status = "waiting";
        delete state.error;
        await records.save(context, state);
      }
      if (assistantRoutingStatusIsPending(state) && state.messageId !== input.messageId &&
          !assistantRoutingRequestCanBeReplaced(state, vibe64AssistantSelectionFromMetadata(context.session.metadata))) {
        throw failure("Resolve or cancel the pending request before sending another.");
      }
      if (state?.helper && state.messageId !== input.messageId) {
        throw failure("Retry cleanup of the previous routing helper before sending another request.");
      }
      if (state?.messageId !== input.messageId && state?.status === "working" && state.delivery === "accepted" && state.workflow === true) {
        throw failure("The coding turn is preparing its Senior review. Wait for it to finish before sending another request.");
      }
      if (state?.messageId === input.messageId) {
        if (!routingState.allowAuto && state.mode === "auto") {
          throw failure("Auto is available in Main chat only. Cancel this request and send a new one to Senior or Junior.");
        }
        if (state.input.message !== input.message) {
          throw failure("A retry must keep the original message. Cancel it to send an edited request.");
        }
        if (state.stopped) throw failure("This request was cancelled. Send your draft as a new request.");
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
        if (explicitDeslop && assistantGoalIsActive(goal)) {
          throw failure(
            "Deslop can't start during the current goal. Open Goal and choose Resume goal to finish it, or Cancel goal to end it, then send Deslop again."
          );
        }
        if (!options.purpose && preferences.mode === "auto" && assistantGoalIsActive(goal) && !savedGoal) {
          throw failure("Choose Senior or Junior before working on a goal.");
        }
        const saved = await records.readRoutingSettings();
        const pinnedGoal = assistantGoalIsActive(goal) && savedGoal;
        if (options.purpose && assistantGoalIsActive(goal) && pinnedGoal?.mode !== options.purpose) {
          throw failure("Finish or cancel the current goal before starting this Junior task.");
        }
        const mode = pinnedGoal?.mode || options.purpose || preferences.mode;
        const hasPlanRevision = Boolean(input.planRevision);
        const plan = mode === "auto" ? await readWorkPlan(context) : null;
        if (hasPlanRevision && mode !== "auto") throw failure("Choose Auto to implement its plan. Direct roles work from your message.");
        if (hasPlanRevision && (!plan || plan.status !== "active" || plan.revision !== input.planRevision)) {
          throw failure("The active plan changed. Read the current plan before sending your request.");
        }
        let resolvedMode = mode;
        if (explicitDeslop) resolvedMode = ["custom", "fix"].includes(mode) ? mode : "senior";
        else if (mode === "auto") resolvedMode = "";
        const review = mode === "auto" && !explicitDeslop && !options.purpose && !assistantGoalIsActive(goal);
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
                  .map(name => [name, input.turnMetadata[name]]))
            } : {})
          },
          mode,
          resolvedMode,
          ...(explicitDeslop ? { task: "deslop" } : {}),
          reason: explicitDeslop ? "review" : "",
          workPlan: plan,
          schemaVersion: 5,
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
          workflow: false,
          stage: null,
          steps: 0,
          stalledTurns: 0,
          steering: [],
          deslop: preferences.review === true,
          planInvolved: hasPlanRevision,
          submittedBy: context.vibe64User ? Object.fromEntries(["username", "id", "role", "email", "preferredName"]
            .filter((name) => context.vibe64User[name] !== undefined)
            .map((name) => [name, context.vibe64User[name]])) : null,
          reviewMessage: [
            preferences.review ? "Automatic review and Deslop:" : "Automatic review:",
            "Check the preceding implementation against my request, accepted steering and any plan explicitly involved in that work. Inspect the implementation and evidence, fix in-scope issues, and run relevant checks. Read every page of BOTH Plan and Progress before reviewing, including the complete technical implementation plan; checklist marks do not establish completion. Leave unrelated plans unchanged. Do not ask for permission merely to review or complete verified work.",
            ...(preferences.review ? [
              "Then perform Deslop on the coding changes and your review fixes, following the project's Deslop guidance. Keep that cleanup behavior-preserving and preserve unrelated work and staging.",
              "Perform both parts yourself in this turn; do not delegate cleanup or start a separate Deslop turn. Run relevant checks after cleanup."
            ] : []),
            "Only after review, any enabled Deslop and their checks are finished: Explicitly complete an involved plan when every requirement is verified; otherwise leave Plan active and record specific gaps and verification evidence in its paired Progress document. Report findings, fixes, actual checks and anything unverified."
          ].join(" ")
        };
        state.decision = await decisions.resolve(context, state);
        // The tool at admission; main chat's is the owner's Senior and Junior tool.
        state.workflowEngineId = pinnedGoal?.workflowEngineId || state.decision.engineId;
        records.mark(input.messageId, "resolved");
        if (assistantGoalIsActive(goal) &&
            !pinnedGoal &&
            !sameVibe64AssistantSelection(decisions.destinations(state.decision)[mode]?.effectiveSelection, selection)) {
          throw failure("Finish or cancel the current goal before changing its AI.");
        }
        // A goal pins its model, not a login that may have been replaced. This
        // new request captures current access; validateDecision still fences delivery.
        if (pinnedGoal?.selection &&
            !sameVibe64AssistantSelection(decisions.destinations(state.decision)[mode]?.effectiveSelection, pinnedGoal.selection)) {
          throw failure("The goal's pinned AI is no longer available. Choose its destination before resuming.");
        }
        state.assignments = Object.fromEntries(
          Object.entries(decisions.destinations(state.decision)).map(([role, destination]) => [role, destination.effectiveSelection])
        );
        await records.save(context, state);
        records.mark(input.messageId, "route-saved");
      }
      if (closing) throw failure("The assistant is shutting down. Reconnect before sending.");
      task.close = async () => {
        await cancellation.cancel(sessionId, options, { waitForCleanup: true });
        const persisted = await read(context.runtime.store, sessionId);
        if (persisted?.messageId === state.messageId && persisted.helper) {
          throw failure("The routing helper could not be closed. Retry after reconnecting the assistant.");
        }
      };
      task.messageId = state.messageId;
      routingState.running.set(key, task);
    }).catch((error) => {
      if (refusedBeforeAdmission && error && typeof error === "object" && !error.delivery) error.delivery = "not-sent";
      throw error;
    });
    if (direct === true) return exclusive(sessionId, options, async (current) => {
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
        await interrupt(sessionId, current).catch(() => {});
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
    if (direct) return direct;
    try {
      if (!state.resolvedMode) {
        // The explicit Implement plan action already supplies its intent and
        // exact plan revision. Do not ask Router to reinterpret that approval.
        const decision = state.input.planRevision ? { mode: "junior", reason: "implementation" }
          : await decisions.classify(sessionId, context, state, task, options);
        // An addressed role is an instruction, not a classifier suggestion.
        const requestedRole = /^\s*(senior|junior)(?:\s+developer)?\s*[:,]\s*\S/iu.exec(state.input.message)?.[1]?.toLowerCase();
        state.resolvedMode = requestedRole || decision.mode;
        state.reason = decision.reason;
        state.stage = decision.reason === "conversation" ? null : decision.reason;
        state.workflow = ["implementation", "review"].includes(decision.reason);
        state.review = state.workflow;
        if (decision.reason === "conversation") state.workPlan = null;
      }
      if (task.cancelled) throw failure("Routing cancelled.");
      return await exclusive(sessionId, options, async (current) => {
        records.mark(state.messageId, "delivery-lock-acquired");
        const persisted = await read(current.runtime.store, sessionId);
        if (task.cancelled || persisted?.stopped) throw failure("Routing cancelled.");
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
