import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateColleagueConversationRecord } from "./conversationRecord.js";
import { failure, requireResult } from "./colleagueFailure.js";
import { answerPendingNavigation, colleagueBrowserState } from "./colleaguePresentation.js";

/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */
/** @typedef {import("./types.js").ColleagueWorker} ColleagueWorker */
/** @typedef {ReturnType<typeof import("./colleagueWatches.js").createColleagueWatches>} ColleagueWatches */

function hasUserReceipt(chat, messageId) {
  return chat.conversationLog.some(turn => turn.messages.some(message =>
    message.role === "user" && message.messageId === messageId && message.receipt !== false));
}

/**
 * A thread's retained conversations: starting fresh keeps the current one as
 * read-only history, which the person can list and page through.
 * @param {object} dependencies
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 * @param {ColleagueWorker} dependencies.worker
 * @param {ColleagueWatches} dependencies.watches
 */
function createColleagueHistory({ serviceState, records, threads, worker, watches }) {
  async function startFresh(input, context) {
    const state = await threads.stateFor(context);
    const reported = (input.unconfirmedMessages || []).map(message => ({ ...message,
      source: "client-reported", status: "unconfirmed" }));
    const rotating = state.admission.then(() => watches.changeWatches(state, async () => {
      const previous = state.record.previousConversations.find(old => old.freshOperation.operationId === input.operationId);
      if (previous) {
        if (previous.scopeId !== input.expectedConversationId || !isDeepStrictEqual(previous.unconfirmedMessages, reported)) {
          throw failure("This recovery ID belongs to another request. Use the original request or a new recovery ID.");
        }
        return { operationId: input.operationId, previousConversationId: previous.scopeId,
          conversationId: previous.freshOperation.conversationId, duplicate: true };
      }
      threads.assertCurrentConversation(state, input.expectedConversationId);
      for (const message of reported) {
        const saved = state.record.conversationLog.flatMap(turn => turn.messages).find(candidate => candidate.messageId === message.messageId);
        if (saved && saved.text !== message.text) throw failure("An unconfirmed message ID belongs to different saved words. Keep the original request before starting fresh.", "ACTION_VALIDATION_FAILED", 400);
      }
      const scopeId = `colleague_${randomUUID().replaceAll("-", "")}`;
      const old = { scopeId: state.record.scopeId, runtimeId: state.record.runtimeId,
        assistantSelection: structuredClone(state.record.assistantSelection),
        status: state.record.status === "working" ? "interrupted" : state.record.status,
        error: state.record.error, conversationLog: structuredClone(state.record.conversationLog),
        ...(state.record.conversationMetadata ? { conversationMetadata: structuredClone(state.record.conversationMetadata) } : {}),
        ...(state.record.retiredConversation ? { retiredConversation: structuredClone(state.record.retiredConversation) } : {}),
        archivedAt: new Date().toISOString(), unconfirmedMessages: structuredClone(reported),
        freshOperation: { operationId: input.operationId, conversationId: scopeId } };
      const patch = { runtimeId: `${state.key}:${scopeId}`, scopeId, status: "ready", error: "",
        conversationLog: [], conversationMetadata: {}, retiredConversation: undefined,
        previousConversations: [...state.record.previousConversations, old] };
      try { validateColleagueConversationRecord({ ...state.record, ...patch }, state.key); }
      catch (error) { throw failure(`Cannot start fresh: ${error.message}`, "ACTION_VALIDATION_FAILED", 400); }
      // A summary receipt left after its run is retried before the next
      // summary; it belongs to this thread, not to the conversation rotated here.
      if (serviceState.lifecycle.closed || state.stopping || state.running || state.opening || state.transfer || state.summaryRunning) {
        throw failure("Finish or stop Colleague's current turn or summary before starting fresh.");
      }
      state.rotating = true;
      try {
        // Suppress autonomous wake while the original chat owner drains. Its
        // watched coding conversations and assignments are never stopped.
        state.generation += 1;
        await state.polling;
        await state.saving;
        if (state.conversation) requireResult(await state.conversation.dispose());
        state.conversation = null;
        state.runtimeOwner = null;
        state.pendingMessages = [];
        state.host = null;
        old.conversationLog = structuredClone(state.record.conversationLog);
        if (state.record.conversationMetadata) old.conversationMetadata = structuredClone(state.record.conversationMetadata);
        old.archivedAt = new Date().toISOString();
        await records.persist(state, patch, old.runtimeId);
        state.streamingReply = null;
        state.interimReply = null;
        state.projectReply = null;
        clearTimeout(state.replyTimer);
        state.replyTimer = null;
        state.streamEpoch = randomUUID();
        state.streamRevision = 0;
        state.requestContext = context;
        for (const connection of state.connections.values()) {
          answerPendingNavigation(connection, { ok: false,
            error: "The previous Colleague conversation was retained as history before navigation completed." });
        }
        records.publishReply(state);
        return { operationId: input.operationId, previousConversationId: old.scopeId,
          conversationId: scopeId, duplicate: false };
      } finally {
        state.rotating = false;
        worker.scheduleWatches(state);
        worker.wakeForObservations(state);
      }
    }));
    state.admission = rotating.catch(() => {});
    const fresh = await rotating;
    return { ...await records.snapshot(state), fresh };
  }

  async function readHistory(input, context) {
    const state = await threads.stateFor(context);
    const offset = input.offset || 0, limit = input.limit || 20;
    const previous = state.record.previousConversations.slice().reverse();
    return { ok: true, conversations: previous.slice(offset, offset + limit).map(old => ({
      conversationId: old.scopeId, archivedAt: old.archivedAt, assistantSelection: old.assistantSelection,
      unconfirmedCount: old.unconfirmedMessages.filter(message => !hasUserReceipt(old, message.messageId)).length
    })), hasMore: offset + limit < previous.length,
    nextOffset: offset + limit < previous.length ? offset + limit : null };
  }

  async function readHistoryPage(input, context) {
    const state = await threads.stateFor(context);
    const old = state.record.previousConversations.find(chat => chat.scopeId === input.conversationId);
    if (!old) throw failure("This previous Colleague conversation is unavailable.", "conversation_forbidden", 403);
    const options = { ...(input.beforeTurnId ? { beforeTurnId: input.beforeTurnId } : {}), limit: input.limit || 50 };
    const page = await records.transcript.readConversationLogPage(old.runtimeId, { ...options, presentation: true });
    const runtimeState = old.conversationMetadata?.runtime;
    const request = runtimeState?.request;
    const unconfirmed = request?.messageId && request.origin !== "application" && (runtimeState.engine === "api" || request.attempted || request.inspectionOnly) &&
      !hasUserReceipt(old, request.messageId);
    return { ok: true, ...colleagueBrowserState({ id: old.scopeId, readOnly: true, ...page }),
      unconfirmedMessages: old.unconfirmedMessages.filter(message => !hasUserReceipt(old, message.messageId)),
      ...(unconfirmed ? { unconfirmedDelivery: { messageId: request.messageId, status: "unconfirmed" } } : {}) };
  }

  return Object.freeze({ startFresh, readHistory, readHistoryPage });
}

export { createColleagueHistory };
