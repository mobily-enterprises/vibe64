import { randomUUID } from "node:crypto";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { sameVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { suspendAssignment } from "./assignments.js";
import { COLLEAGUE_MODEL_UNAVAILABLE, failure } from "./colleagueFailure.js";
import { answerPendingNavigation, releaseObserver } from "./colleaguePresentation.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */
/** @typedef {import("./types.js").ColleagueConversations} ColleagueConversations */
/** @typedef {import("./types.js").ColleagueWorker} ColleagueWorker */

/**
 * A person's turns with Colleague: reading the conversation, sending, choosing
 * the model, summarizing, stopping and waiting, and closing every thread when
 * the service stops.
 * @param {object} dependencies
 * @param {TerminalsService} dependencies.terminals
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 * @param {ColleagueConversations} dependencies.conversations
 * @param {ColleagueWorker} dependencies.worker
 */
function createColleagueTurns({
  terminals,
  serviceState,
  records,
  threads,
  conversations,
  worker
}) {
  const turns = Object.freeze({
    async read(input = {}, context = {}) {
      const state = await threads.stateFor(context);
      state.requestContext = context;
      worker.scheduleWatches(state);
      worker.wakeForObservations(state);
      // Until a send commits a model, every read re-checks current
      // availability, so Teach me and the composer say "no usable model"
      // without sending, and an earlier failure stops blocking them as soon
      // as an AI becomes usable.
      if (!state.record.assistantSelection) {
        const available = await conversations.selectionAvailable(context);
        if (available && state.record.error === COLLEAGUE_MODEL_UNAVAILABLE) {
          state.record.error = "";
          if (state.record.status === "failed") state.record.status = "ready";
        }
        const result = await records.snapshot(state, input.clientId);
        return available ? result : { ...result, modelSetupRequired: true };
      }
      return records.snapshot(state, input.clientId);
    },
    async summarize(input, context) {
      const state = await threads.stateFor(context);
      if (serviceState.lifecycle.closed || state.stopping || state.summaryRunning) {
        throw failure("Finish or stop the current Colleague summary first.");
      }
      state.requestContext = context;
      const scoped = threads.actionContext(state, {
        clientId: context.colleague?.clientId || "",
        focus: { projectSlug: input.projectSlug }
      });
      state.summaryAbort = new AbortController();
      state.summaryRunning = records.summaries.read(state, input, scoped).finally(() => {
        state.summaryRunning = null;
        state.summaryAbort = null;
      });
      return state.summaryRunning;
    },
    async selectModel(input, context) {
      const state = await threads.stateFor(context);
      const expected = input.expectedConversationId || context.colleague?.conversationId || state.record.scopeId;
      const selecting = state.admission.then(async () => {
        threads.assertCurrentConversation(state, expected);
        if (serviceState.lifecycle.closed || state.stopping || state.running) {
          throw failure("Finish or stop Colleague's current turn before changing its model.");
        }
        if (!input.assistantSelection) throw failure("Choose a model for Colleague.");
        const selected = await conversations.chooseSelection(context, input.assistantSelection);
        const settings = await terminals.resolveConversationConfiguration(
          selected,
          conversations.promptFor(state),
          { vibe64User: authenticatedVibe64User(context) }
        );
        const changed = !sameVibe64AssistantSelection(state.record.assistantSelection, selected);
        const pendingRequest = state.record.conversationMetadata?.runtime?.replacement?.request;
        state.requestContext = context;
        const scoped = { ...threads.actionContext(state, { clientId: "", focus: null }), assistantSelection: selected };
        let conversation = state.record.conversationMetadata?.runtime ? await conversations.openConversation(state, scoped) : null;
        let current = await conversation?.read();
        const savedRuntime = state.record.conversationMetadata?.runtime;
        if (current?.status === "working" || savedRuntime?.engine === "codex" &&
            codexAppServerTurnStateFromAgentRun(savedRuntime.binding?.codexAppServerRun || {}).active) {
          throw failure("Stop Colleague's previous native turn before changing its model.");
        }
        if (conversation && state.runtimeOwner === conversations.nativeRuntime && settings.engine === "api") {
          // The completed native envelope is not the ordinary API's response
          // contract. Remove it through the same idle/authorized config owner
          // before the destination validates the saved configuration.
          if (current.configuration.outputSchema !== undefined) await conversation.configure({ outputSchema: undefined });
          conversation = await conversations.transferConversation(state, scoped, conversations.runtime);
          current = await conversation.read();
        }
        if (!state.record.conversationMetadata?.runtime || !changed && !pendingRequest) {
          // Preserve the native binding while retaining the common owner's
          // failed-cleanup and storage guards for an unchanged selection.
          if (conversation) await conversation.configure(settings.configuration);
          const previous = state.record.assistantSelection;
          state.record.assistantSelection = selected;
          try { await records.persist(state); } catch (error) {
            state.record.assistantSelection = previous;
            throw error;
          }
          return;
        }
        // The common runtime owns the native change and continuity. Publish the
        // product selection in the same record commit as its final configuration.
        state.selecting = { ...settings, assistantSelection: selected };
        try {
          // A pending request keeps its original policy, including historical
          // absence, so a retry cannot become a different replacement operation.
          const request = {
            ...settings,
            operationId: current.replacement?.operationId || randomUUID(),
            expectedSegmentId: current.segmentId
          };
          if (pendingRequest) {
            if (Object.hasOwn(pendingRequest, "retireNative")) request.retireNative = pendingRequest.retireNative;
          } else request.retireNative = true;
          await conversation.select(request);
        } finally { state.selecting = null; }
        state.conversation = conversation;
        if (settings.engine !== "api" && state.runtimeOwner === conversations.runtime) {
          await conversations.transferConversation(state, scoped, conversations.nativeRuntime);
        }
        state.record.status = "ready";
        state.record.error = "";
        await records.persist(state);
      });
      state.admission = selecting.catch(() => {});
      await selecting;
      return records.snapshot(state);
    },
    async send(input, context, { receiptOnly = false } = {}) {
      const state = await threads.stateFor(context);
      const expected = input.expectedConversationId || context.colleague?.conversationId || state.record.scopeId;
      const admitted = state.admission.then(async () => {
        threads.assertCurrentConversation(state, expected);
        if (serviceState.lifecycle.closed) throw failure("Colleague is shutting down.");
        if (state.stopping) throw failure("Colleague is stopping its previous turn. Send again once it has stopped.");
        if (state.record.previousConversations.some(old => old.unconfirmedMessages.some(message => message.messageId === input.messageId) ||
            old.conversationLog.some(turn => turn.messages.some(message => message.messageId === input.messageId)) ||
            [
              old.conversationMetadata?.runtime,
              ...(old.conversationMetadata?.runtime?.predecessors || [])
            ].some(segment => segment?.request?.messageId === input.messageId))) {
          throw failure(
            "This message belongs to retained Colleague history. Nothing was resent; write a new message in the current conversation.",
            "ACTION_VALIDATION_FAILED",
            400
          );
        }
        const previousTurn = state.record.conversationLog.find(turn =>
          turn.messages.some(message => message.messageId === input.messageId));
        const previousMessage = previousTurn?.messages.find(message => message.messageId === input.messageId);
        if (previousMessage) {
          if (previousMessage.text !== input.message) {
            throw failure("This message ID belongs to a different request. Use a new message ID.");
          }
          return { status: "accepted", messageId: input.messageId, turnId: previousTurn.turnId, duplicate: true };
        }
        const engine = state.record.conversationMetadata?.runtime?.engine;
        const native = Boolean(engine && engine !== "api");
        if (!native && state.running) {
          state.generation += 1;
          await state.conversation?.cancel();
          await state.running;
        }
        state.requestContext = context;
        state.streamingReply = null;
        state.interimReply = null;
        state.record.error = "";
        records.publishReply(state);
        const previous = state.connections.get(input.clientId) || {};
        const connection = {
          ...previous,
          clientId: input.clientId,
          focus: input.focus || previous.focus || null,
          assistantSelection: input.assistantSelection
        };
        state.connections.set(input.clientId, connection);
        if (native) {
          // App admission is independent of native admission: these are the
          // actual authored rows, not fabricated native acknowledgements.
          const turn = await records.transcript.writeConversationUserMessage(state.record.runtimeId, {
            messageId: input.messageId,
            text: input.message
          });
          if (!turn) throw failure("The authored Colleague message could not be admitted.");
          state.pendingMessages.push({ messageId: input.messageId, text: input.message, turnId: turn.turnId });
          state.nextConnection = { ...connection, focus: structuredClone(connection.focus) };
          if (!state.running) void worker.startWorker(state, state.nextConnection, null, true).catch(() => {});
          return { status: "accepted", messageId: input.messageId, turnId: turn.turnId, origin: "user" };
        }
        return worker.startWorker(state, {
          ...connection,
          focus: structuredClone(connection.focus)
        }, {
          messageId: input.messageId,
          text: input.message
        });
      });
      state.admission = admitted.catch(() => {});
      const receipt = await admitted;
      if (receipt?.ok === false) return receipt;
      return receiptOnly ? receipt : records.snapshot(state, input.clientId);
    },
    async stop(input, context) {
      const state = await threads.stateFor(context);
      const expected = input.expectedConversationId || context.colleague?.conversationId || state.record.scopeId;
      threads.assertCurrentConversation(state, expected);
      state.stopping = true;
      state.workerAbort?.abort();
      await state.admission;
      try { threads.assertCurrentConversation(state, expected); } catch (error) {
        state.stopping = false;
        throw error;
      }
      state.generation += 1;
      state.pendingMessages = [];
      state.streamingReply = null;
      state.interimReply = null;
      records.publishReply(state);
      state.summaryAbort?.abort();
      for (const connection of state.connections.values()) answerPendingNavigation(connection, {
        ok: false,
        error: "Navigation was cancelled when Colleague stopped."
      });
      state.record.status = "interrupted";
      for (const assignment of state.record.assignments || []) {
        suspendAssignment(
          state.record,
          assignment.assignmentId,
          "Colleague was stopped. Ask to resume this assignment when ready.",
          { pauseWatches: true }
        );
      }
      state.requestContext = context;
      try {
        if (!state.conversation && state.record.conversationMetadata?.runtime) await conversations.openConversation(state,
          threads.actionContext(state,
          {
          clientId: "",
          focus: null
        }));
        await state.conversation?.cancel();
        await state.running;
        await state.summaryRunning;
        // The stop is saved before the summary Helper's cleanup, which keeps
        // its receipt for a retry when its close cannot be confirmed.
        await records.persist(state);
        await records.summaries.cleanup(state, context);
      } finally { state.stopping = false; }
      return records.snapshot(state);
    },
    async wait(context) {
      const state = await threads.stateFor(context);
      await state.admission;
      while (state.running) await state.running;
      return records.snapshot(state);
    },
    async close() {
      serviceState.lifecycle.closed = true;
      threads.unregisterReleaser();
      // Each thread stops on its own. One that cannot stop cleanly is reported
      // by name and never keeps the other threads, or the conversation
      // runtimes, from stopping.
      const threadStops = await Promise.allSettled([...serviceState.users.values()].map(async (pending) => {
        // A thread that failed to load has nothing to stop.
        const state = await pending.catch(() => null);
        if (!state) return;
        try {
          clearTimeout(state.watchTimer);
          clearTimeout(state.replyTimer);
          for (const observer of state.browserObservers) releaseObserver(observer);
          state.browserObservers.clear();
          await state.watchAdmission;
          await state.polling;
          // Stop running work only, in this thread rather than whichever one the
          // person's mode shows now. A summary receipt left by an earlier run is
          // retried before the thread's next summary, not at shutdown.
          if (state.running || state.summaryRunning) await turns.stop({}, {
            ...state.requestContext,
            colleague: { ...state.requestContext?.colleague, threadKey: state.key }
          });
          await state.running;
          await state.saving;
        } catch (error) {
          throw Object.assign(new Error(`Colleague thread ${state.key} did not stop cleanly: ${error?.message || error}`, { cause: error }),
            { threadKey: state.key });
        }
      }));
      const runtimes = await Promise.allSettled([conversations.runtime.close(), conversations.nativeRuntime.close()]);
      const failures = [...threadStops, ...runtimes].filter(({ status }) => status === "rejected").map(({ reason }) => reason);
      if (failures.length) {
        throw new AggregateError(failures, `Colleague did not stop cleanly: ${failures.map(({ message }) => message).join(" ")}`);
      }
    }
  });
  return turns;
}

export { createColleagueTurns };
