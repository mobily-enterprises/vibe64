import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { randomUUID } from "node:crypto";
import { VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  ROUTING_REASONS, assistantModePrompt, assistantRoutingStatusIsPending, assistantRoutingFromMetadata,
  assistantRoutingPrompt, parseRoutingDecision, routingAssignmentSelection
} from "@local/vibe64-runtime/shared/assistantRouting";

const STATE_KEY = "assistant_routing_request";
const PROFILE = Object.freeze({ profileId: "economy", workloadId: "request_routing" });
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "reason"],
  properties: {
    mode: { type: "string", enum: ["plan", "code"] },
    reason: { type: "string", enum: [...ROUTING_REASONS] }
  }
};
const activeGoal = (goal) => goal && !["complete", "completed"].includes(goal.status);
function failure(message, code = "vibe64_assistant_routing_unavailable") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}
function read(store, sessionId) {
  return store.readMetadataValue(sessionId, STATE_KEY).then((value) => value ? JSON.parse(value) : null);
}
function withSelection(context, selection) {
  return {
    ...context,
    assistantSelection: selection,
    session: {
      ...context.session,
      metadata: {
        ...context.session.metadata,
        [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection)
      }
    }
  };
}

// The ordinary conversation owns delivery and history. This record only holds
// the one request being prepared and its optional, single review continuation.
function createAssistantRouting({ systemRoot, agent, exclusive, dispatch, publish, prepareSelection = async () => {} }) {
  const running = new Map();
  const keyFor = (sessionId, context) => `${context.runtime.stateRoot}\0${sessionId}\0${context.routingConversationId || ""}`;
  async function save(context, state) {
    await context.runtime.store.writeMetadataValue(context.session.sessionId, STATE_KEY, JSON.stringify(state));
    await publish(context.session.sessionId, { reason: "assistant-routing-changed", payload: {
      assistantRoutingRequest: state, ...(context.routingConversationId ? { conversationId: context.routingConversationId } : {})
    } });
  }
  async function validate(selection, context) {
    const catalog = await agent.listCapabilities({ engineId: selection.engineId }, context);
    const result = routingAssignmentSelection(catalog.engines[0], selection);
    await agent.requireAssistantAccessForSelection(result, context);
    return result;
  }
  async function classify(sessionId, context, state, task) {
    const helperContext = withSelection(context, state.assignments.economy);
    delete helperContext.session.metadata.codex_routing_home_provider;
    let threadId = "";
    let retired = "";
    let interrupt;
    task.stop = () => {
      task.cancelled = true;
      if (threadId && !interrupt) interrupt = agent.interruptDetachedChatTurn(sessionId, { threadId, executionProfile: PROFILE }, helperContext);
      return interrupt;
    };
    let decision;
    let generationError;
    try {
      const turns = await context.runtime.store.readConversationTail(sessionId);
      const exchanges = turns.filter((turn) => turn.user && (turn.messages || []).some(({ role }) => role === "assistant")).slice(-12).map((turn) => ({
        user: turn.user.text, assistant: turn.messages.filter(({ role }) => role === "assistant").map(({ text }) => text).join("\n")
      }));
      const executionProfile = await agent.resolveExecutionProfile(sessionId, PROFILE, helperContext);
      if (executionProfile.model !== state.assignments.economy.modelId) throw failure("The routing helper could not use the selected Economy model.");
      if (task.cancelled) throw failure("Routing cancelled.");
      const result = await agent.streamDetachedChatTurn(sessionId, {
        executionProfile, outputSchema: OUTPUT_SCHEMA, promptLabel: "Choose Plan or Code",
        prompt: assistantRoutingPrompt({ message: state.input.message, exchanges, attachments: state.input.attachments || state.input.displayAttachments })
      }, { ...helperContext, onEvent(event) {
        if (event.threadId) threadId = event.threadId;
        if (event.type === "thread-retired") retired = event.threadId;
        if (task.cancelled) void task.stop()?.catch(() => {});
      } });
      threadId ||= result?.threadId;
      if (result?.ok !== true) throw failure(result?.error || "Routing could not finish. Retry or choose a mode.");
      decision = parseRoutingDecision(result.text);
    } catch (error) { generationError = error; }
    try {
      await interrupt;
      if (threadId && retired !== threadId) {
        const cleanup = await agent.deleteDetachedChatThread(sessionId, { threadId, executionProfile: PROFILE }, helperContext);
        if (cleanup?.ok !== true) throw failure("The routing helper could not be closed. Retry after reconnecting the assistant.");
      }
    } catch (error) { generationError = error; }
    if (generationError) throw generationError;
    return decision;
  }

  async function deliver(sessionId, context, state, review = false) {
    const store = context.runtime.store;
    const selection = await validate(review ? state.assignments.plan : state.assignments[state.resolvedMode], context);
    if (selection.engineId !== vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId) {
      throw failure("The orchestrator changed while this request was being prepared. Cancel it and send a new request.");
    }
    const messageId = review ? state.reviewMessageId : state.messageId;
    const selectedContext = withSelection(context, selection);
    const uncertain = state.status === (review ? "review_uncertain" : "uncertain");
    if (uncertain || state.attemptedMessageId === messageId) {
      const receipt = await agent.inspectMessageAdmission(sessionId, { messageId, threadId: state.threadId }, selectedContext);
      if (receipt?.admission !== "accepted") throw failure("Delivery is uncertain. Retry to check the receipt; this will not send a duplicate.", "vibe64_assistant_routing_delivery_uncertain");
      await store.writeConversationUserMessage(sessionId, {
        messageId, text: review ? state.reviewMessage : state.input.displayMessage || state.input.message,
        attachments: review ? [] : state.input.displayAttachments,
        turnMetadata: { assistantSelection: selection, assistantRouting: attribution(state, review),
          ...(review ? { actorId: "app", actorDisplayName: "Automatic review" } : {}) }
      });
      state.status = review ? "reviewing" : "sent";
      state.turnId = receipt.turnId || "";
      await save(context, state);
      return { ok: true, delivered: true, messageId, threadId: state.threadId };
    }
    const native = await agent.sessionState(sessionId, context);
    if (native?.turn?.active) throw failure("Wait for the current turn to finish before sending a new request.");
    if (review && activeGoal((await agent.readGoal(sessionId, context))?.goal)) {
      state.status = "sent"; state.reviewStatus = "skipped_goal"; await save(context, state);
      return { ok: true, skipped: true };
    }
    await prepareSelection(sessionId, selection, context);
    selectedContext.session.metadata = { ...context.session.metadata, [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection) };
    await store.writeMetadataValue(sessionId, VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection(selection));
    state.status = review ? "review_sending" : "sending";
    await save(context, state);
    const displayMessage = review ? state.reviewMessage : state.input.displayMessage || state.input.message;
    const message = assistantModePrompt(review ? "review" : state.resolvedMode, review ? state.reviewMessage : state.input.message);
    const result = await dispatch(sessionId, {
      ...(review ? {} : state.input), messageId, message, displayMessage,
      turnMetadata: { assistantRouting: attribution(state, review), ...(review ? { actor: "app", actorLabel: "Automatic review" } : {}) },
      onPromptSending: async ({ threadId }) => {
        state.threadId = threadId; state.attemptedMessageId = messageId;
        state.status = review ? "review_uncertain" : "uncertain";
        await save(context, state);
      },
      onPromptRejected: async () => { delete state.attemptedMessageId; state.status = review ? "review_pending" : "failed"; await save(context, state); }
    }, selectedContext);
    if (result?.delivered !== true) throw failure(result?.error || "The assistant did not confirm delivery.");
    state.status = review ? "reviewing" : "sent";
    state.turnId = result.turnId || result.turn?.id || result.codexAgentTurn?.turnId || "";
    if (review) state.reviewStatus = "running";
    delete state.error;
    await save(context, state);
    return { ...result, assistantRoutingRequest: state };
  }
  function attribution(state, review) {
    return { requestedMode: state.mode, resolvedMode: review ? "review" : state.resolvedMode,
      reason: state.reason || "", parentMessageId: review ? state.messageId : "", settingsRevision: state.settingsRevision };
  }

  async function send(sessionId, input, options) {
    let context;
    let state;
    let direct;
    const task = { cancelled: false };
    let key;
    await exclusive(sessionId, options, async (current) => {
      context = current; key = keyFor(sessionId, context);
      const preferences = assistantRoutingFromMetadata(context.session.metadata);
      if (input.reviewAction === "retry") {
        state = await read(context.runtime.store, sessionId);
        if (state?.messageId !== input.messageId || !["review_pending", "review_uncertain"].includes(state.status)) throw failure("There is no pending review to retry.");
        try { direct = await deliver(sessionId, context, state, true); }
        catch (error) {
          state.status = state.attemptedMessageId ? "review_uncertain" : "review_pending";
          state.error = error.message; await save(context, state); throw error;
        }
        return;
      }
      if (!preferences) { direct = true; return; }
      const native = await agent.sessionState(sessionId, context);
      // Steering keeps the running model and its instructions. It never goes
      // through the classifier, including while a review turn is running.
      if (native?.turn?.active) {
        if (input.submissionKind === "send") throw failure("The assistant started another turn. Review it before sending.");
        direct = true; return;
      }
      if (input.submissionKind === "steer") throw failure("That turn has finished. Send this as a new request.");
      const store = context.runtime.store;
      state = await read(store, sessionId);
      if (await store.conversationMessageIdExists(sessionId, input.messageId)) {
        if (state?.messageId === input.messageId && ["uncertain", "sending"].includes(state.status)) {
          state.status = "sent"; state.turnId ||= native?.turn?.id || ""; delete state.error;
          await save(context, state);
        }
        direct = { ok: true, delivered: true, duplicate: true, messageId: input.messageId }; return;
      }
      if (running.has(key)) throw failure("This conversation is preparing a request. Cancel it or wait before sending another.");
      if (assistantRoutingStatusIsPending(state?.status) && state.messageId !== input.messageId) throw failure("Resolve or cancel the pending request before sending another.");
      if (state?.messageId !== input.messageId && state?.status === "sent" && state.review && state.resolvedMode === "code") {
        throw failure("The coding turn is preparing its review. Wait for it, or skip the review before sending another request.");
      }
      if (state?.messageId === input.messageId) {
        if (state.input.message !== input.message) throw failure("A retry must keep the original message. Cancel it to send an edited request.");
        if (state.status === "cancelled") throw failure("This request was cancelled. Send your draft as a new request.");
        if (!state.attemptedMessageId) {
          state.status = state.resolvedMode ? "sending" : "routing";
          delete state.error;
          await save(context, state);
        }
      } else {
        const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
        const goal = (await agent.readGoal(sessionId, context))?.goal;
        if (preferences.mode === "auto" && activeGoal(goal)) throw failure("Choose Plan, Code, or Economy before working on a goal.");
        const saved = await createAssistantRoutingStore({ systemRoot }).read();
        const roles = saved.orchestrators[selection.engineId] || {};
        const catalog = await agent.listCapabilities({ engineId: selection.engineId }, context);
        const assignments = {};
        const pinnedGoal = activeGoal(goal) && JSON.parse(context.session.metadata.assistant_routing_goal || "null");
        const mode = pinnedGoal?.mode || preferences.mode;
        const review = preferences.review && !activeGoal(goal) && ["auto", "code"].includes(mode);
        const required = new Set(mode === "auto" ? ["plan", "code", "economy"] : [mode]);
        if (review) required.add("plan");
        for (const role of required) {
          const assignment = pinnedGoal?.selection || (preferences.mode === role && preferences.override) || roles[role];
          assignments[role] = routingAssignmentSelection(catalog.engines[0], assignment);
          await agent.requireAssistantAccessForSelection(assignments[role], context);
        }
        state = {
          messageId: input.messageId,
          input: Object.fromEntries(Object.entries(input).filter(([name]) => [
            "message", "displayMessage", "attachmentIds", "displayAttachments", "genesisTask",
            "originId", "presentation", "promptLabel", "outputSchema"
          ].includes(name))),
          mode,
          resolvedMode: mode === "auto" ? "" : mode,
          assignments,
          settingsRevision: saved.revision,
          status: mode === "auto" ? "routing" : "sending",
          createdAt: new Date().toISOString(),
          review,
          reviewMessageId: review ? randomUUID() : "",
          submittedBy: context.vibe64User ? Object.fromEntries(["username", "id", "role", "email", "preferredName"]
            .filter((name) => context.vibe64User[name] !== undefined)
            .map((name) => [name, context.vibe64User[name]])) : null,
          reviewMessage: "Automatic review: check the preceding coding work against my request and steering. Fix in-scope issues, run relevant checks, and explain the result."
        };
        await save(context, state);
      }
      running.set(key, task);
    });
    if (direct === true) return exclusive(sessionId, options, (current) => dispatch(sessionId, input, current));
    if (direct) return direct;
    try {
      if (!state.resolvedMode) {
        const decision = await classify(sessionId, context, state, task);
        state.resolvedMode = decision.mode; state.reason = decision.reason;
      }
      return await exclusive(sessionId, options, async (current) => {
        const persisted = await read(current.runtime.store, sessionId);
        if (task.cancelled || persisted?.status === "cancelled") throw failure("Routing cancelled.");
        return deliver(sessionId, current, state);
      });
    } catch (error) {
      await exclusive(sessionId, options, async (current) => {
        const persisted = await read(current.runtime.store, sessionId);
        if (persisted?.messageId !== state.messageId || persisted.status === "cancelled") return;
        state.status = state.attemptedMessageId ? "uncertain" : "failed";
        state.error = error.message;
        await save(current, state);
      });
      throw error;
    } finally { running.delete(key); }
  }

  async function cancel(sessionId, options) {
    let stop;
    const result = await exclusive(sessionId, options, async (context) => {
      const state = await read(context.runtime.store, sessionId);
      const task = running.get(keyFor(sessionId, context));
      if (task) { task.cancelled = true; stop = task.stop; }
      if (!state) return false;
      const preparingReview = state.status === "review_pending";
      state.review = false;
      if (preparingReview) state.status = "sent";
      else if (["routing", "sending", "failed"].includes(state.status) && !state.attemptedMessageId) state.status = "cancelled";
      state.reviewStatus = "cancelled";
      await save(context, state);
      return state.status === "cancelled" || preparingReview;
    });
    await stop?.();
    return result;
  }

  async function afterTurn(sessionId, payload, options, { recovered = false } = {}) {
    const run = payload?.payload?.agentRun;
    if (!run || run.active) return;
    return exclusive(sessionId, options, async (context) => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || !["sent", "reviewing"].includes(state.status)) return;
      if (!state.turnId) {
        const receipt = await agent.inspectMessageAdmission(sessionId, {
          messageId: state.status === "reviewing" ? state.reviewMessageId : state.messageId,
          threadId: state.threadId
        }, context);
        if (receipt?.admission === "accepted") state.turnId = receipt.turnId || "";
        if (!state.turnId) {
          state.reviewStatus = state.status === "reviewing" ? "incomplete" : "skipped_unconfirmed";
          state.status = "done";
          state.error = "The completed turn could not be matched to this request. Automatic review needs a new explicit request.";
          await save(context, state); return;
        }
        await save(context, state);
      }
      if (state.turnId !== (run.providerTurnId || run.turnId)) return;
      if (state.status === "reviewing") {
        state.status = "done";
        state.reviewStatus = state.reviewStatus !== "cancelled" && run.state === "completed" ? "completed" : "incomplete";
        await save(context, state); return;
      }
      if (!state.review || state.resolvedMode !== "code" || run.state !== "completed") {
        state.status = "done";
        if (state.review) state.reviewStatus = "skipped_incomplete";
        await save(context, state); return;
      }
      const native = await agent.sessionState(sessionId, context);
      if (native?.turn?.active || native?.pendingRequests?.length || native?.turn?.waitingForInput) return;
      state.status = "review_pending";
      delete state.attemptedMessageId;
      if (recovered) state.error = "Coding finished while review scheduling was disconnected. Retry or skip this review.";
      await save(context, state);
      if (recovered) return;
      try { await deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, true); }
      catch (error) {
        state.status = state.attemptedMessageId ? "review_uncertain" : "review_pending";
        state.error = error.message;
        await save(context, state);
      }
    });
  }

  async function reconcile(sessionId, options) {
    let outcome;
    await exclusive(sessionId, options, async (context) => {
      const state = await read(context.runtime.store, sessionId);
      if (!state || running.has(keyFor(sessionId, context))) return;
      if (["routing", "sending", "review_sending"].includes(state.status)) {
        const review = state.status === "review_sending";
        state.status = state.attemptedMessageId ? (review ? "review_uncertain" : "uncertain") : (review ? "review_pending" : "failed");
        state.error = state.attemptedMessageId
          ? "Delivery was interrupted. Check its receipt before continuing."
          : review ? "Review preparation was interrupted. Retry or skip this review."
            : "Request preparation was interrupted before delivery. Retry this request or choose a mode.";
        await save(context, state);
      }
      if (["sent", "reviewing"].includes(state.status) && state.turnId) {
        const run = context.session.agentRuns?.find((run) => (run.providerTurnId || run.turnId) === state.turnId);
        if (run && !["starting", "active", "finalizing"].includes(run.state)) outcome = run;
      }
    });
    if (outcome) await afterTurn(sessionId, { payload: { agentRun: outcome } }, options, { recovered: true });
  }

  async function prepareGoal(sessionId, input, context) {
    const preferences = assistantRoutingFromMetadata(context.session.metadata);
    if (!preferences) return { input, context };
    if (preferences.mode === "auto") throw failure("Choose Plan, Code, or Economy before starting or resuming a goal.");
    const previous = JSON.parse(context.session.metadata.assistant_routing_goal || "null");
    const saved = await createAssistantRoutingStore({ systemRoot }).read();
    const current = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    const mode = input.action === "resume" && previous ? previous.mode : preferences.mode;
    const assignment = input.action === "resume" && previous ? previous.selection
      : preferences.override || saved.orchestrators[current.engineId]?.[mode];
    if (!assignment) throw failure("Configure this mode in Model routing before starting a goal.");
    const selection = await validate(assignment, context);
    await prepareSelection(sessionId, selection, context);
    await context.runtime.store.writeMetadataValue(sessionId, VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection(selection));
    const pinned = { mode, selection, objective: input.action === "set" ? input.objective : previous?.objective || "", status: "active" };
    return { pinned, context: withSelection(context, selection), input: { ...input,
      ...(["set", "resume"].includes(input.action) && pinned.objective ? { objective: assistantModePrompt(mode, pinned.objective) } : {}) } };
  }
  return { send, cancel, afterTurn, prepareGoal, reconcile };
}

export { createAssistantRouting };
