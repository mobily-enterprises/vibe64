import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { failure } from "./colleagueFailure.js";
import { colleagueBrowserState, releaseObserver } from "./colleaguePresentation.js";
import {
  ACTION_COLLEAGUE_CONTEXT_READ,
  ACTION_COLLEAGUE_MESSAGE_SEND,
  ACTION_COLLEAGUE_MODEL_SELECT,
  ACTION_COLLEAGUE_TURN_STOP
} from "./colleagueActions.js";
import { colleagueConversationDataSchema, colleagueConversationSelectionSchema } from "./colleagueSchemas.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */
/** @typedef {import("./types.js").ColleagueConversations} ColleagueConversations */

/**
 * The browser's view of a person's current Colleague conversation: reading,
 * sending, delivery and subscribing, each fenced by Colleague's own actions.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 * @param {ColleagueConversations} dependencies.conversations
 */
function createColleagueBrowserConversations({
  actions,
  serviceState,
  records,
  threads,
  conversations
}) {
  async function open({ id, context } = {}) {
    // Action contributors own authority; never retain their cached result
    // when a subscription or subsequent model operation checks the request.
    if (serviceState.lifecycle.closed) throw failure("Colleague is shutting down.");
    const request = context?.requestMeta?.request;
    const requestContext = {
      surface: "app",
      channel: "internal",
      requestMeta: request ? {
        ...context.requestMeta,
        request: { ...request, headers: request.headers, vibe64User: authenticatedVibe64User(context) }
      } : context?.requestMeta,
      colleague: { userKey: threads.userKey(context), clientId: "", focus: null }
    };
    await actions.execute({ actionId: ACTION_COLLEAGUE_CONTEXT_READ, input: {}, context: requestContext });
    const state = await threads.stateFor(context);
    if (state.record.previousConversations.some(old => old.scopeId === id)) threads.assertCurrentConversation(state, id);
    if (id !== state.record.scopeId) throw failure("This Colleague conversation is unavailable.", "conversation_forbidden", 403);
    requestContext.colleague.conversationId = id;
    requestContext.assistantSelection = state.record.assistantSelection;
    async function preparedConversation() {
      threads.assertCurrentConversation(state, id);
      if (!state.record.conversationMetadata?.runtime) return null;
      return conversations.openConversation(state, requestContext);
    }
    return {
      async read(options = {}) {
        threads.assertCurrentConversation(state, id);
        await actions.execute({ actionId: ACTION_COLLEAGUE_CONTEXT_READ, input: {}, context: requestContext });
        const pageOptions = {};
        for (const key of ["beforeTurnId", "limit"]) {
          if (Object.hasOwn(options, key)) pageOptions[key] = options[key];
        }
        const paged = Object.keys(pageOptions).length > 0;
        const conversation = await preparedConversation();
        // Reading an empty Colleague must not require AI Accounts setup or
        // choose a native engine. Its original transcript remains readable.
        if (!conversation) return colleagueBrowserState({
          id,
          status: "ready",
          phase: "",
          error: state.record.error || "",
          interimReply: state.interimReply,
          capabilities: { steering: false, goals: false, attachments: false },
          pendingRequest: null,
          ...(paged ? await records.transcript.readConversationLogPage(state.record.runtimeId, { ...pageOptions, presentation: true })
            : { conversationLog: await records.transcript.readConversationLog(state.record.runtimeId, { presentation: true }) }),
          streaming: { revision: 0, messages: [] }
        });
        const owner = state.runtimeOwner;
        let current = paged ? await conversation.read(pageOptions) : await conversation.read();
        if (paged && owner === conversations.runtime) {
          // Ordinary API work may follow private native envelopes. Project
          // before counting/cursor selection through the existing store.
          const page = await records.transcript.readConversationLogPage(state.record.runtimeId, { ...pageOptions, presentation: true });
          threads.assertCurrentConversation(state, id);
          current = { ...current, ...page };
        }
        return colleagueBrowserState({
          ...current,
          id,
          ...(state.runtimeOwner === conversations.nativeRuntime && state.running ? { status: "working" } : {}),
          interimReply: state.interimReply,
          capabilities: { ...current.capabilities, steering: false, goals: false, attachments: false }
        });
      },
      async send(input) {
        if (input.attachmentIds?.length) throw failure("Colleague does not accept attachments.", "conversation_unsupported");
        return actions.execute({
          actionId: ACTION_COLLEAGUE_MESSAGE_SEND,
          // The browser reads the delivery receipt, not the whole conversation.
          context: { ...requestContext, colleagueReceiptOnly: true },
          input: {
            ...input.data,
            expectedConversationId: id,
            messageId: input.messageId,
            message: input.text
          }
        });
      },
      async cancel() {
        return actions.execute({ actionId: ACTION_COLLEAGUE_TURN_STOP, input: { expectedConversationId: id }, context: requestContext });
      },
      async select(input) {
        return actions.execute({
          actionId: ACTION_COLLEAGUE_MODEL_SELECT,
          input: { ...input, expectedConversationId: id },
          context: requestContext
        });
      },
      async inspectDelivery(input) {
        threads.assertCurrentConversation(state, id);
        await actions.execute({ actionId: ACTION_COLLEAGUE_CONTEXT_READ, input: {}, context: requestContext });
        const turn = state.record.conversationLog.find(item => !item.metadata?.runtime?.engine &&
          item.user?.messageId === input.messageId);
        if (turn) return { status: "accepted", messageId: input.messageId, turnId: turn.turnId, origin: "user", duplicate: true };
        const conversation = await preparedConversation();
        return conversation ? conversation.inspectDelivery(input) : { status: "unknown", messageId: input.messageId };
      },
      /**
       * Cancel always succeeds: an accepted message stays history, and an
       * unsent or unconfirmed one is discarded by its native conversation.
       */
      async cancelDelivery(input) {
        threads.assertCurrentConversation(state, id);
        await actions.execute({ actionId: ACTION_COLLEAGUE_CONTEXT_READ, input: {}, context: requestContext });
        if (state.record.conversationLog.some(item => !item.metadata?.runtime?.engine && item.user?.messageId === input.messageId)) {
          return { ok: true, cancelled: false, messageId: input.messageId, status: "accepted" };
        }
        const conversation = await preparedConversation();
        return conversation ? conversation.cancelDelivery(input) : { ok: true, cancelled: true, messageId: input.messageId };
      },
      async readGoal() { return null; },
      async updateGoal() {
        throw failure("Colleague does not support native goals.", "conversation_unsupported", 400);
      },
      async subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("A conversation listener is required.");
        const observer = { context: requestContext, listener, release: null };
        state.browserObservers.add(observer);
        try {
          await preparedConversation();
          await conversations.attachBrowserObserver(state, observer);
        }
        catch (error) {
          state.browserObservers.delete(observer);
          releaseObserver(observer);
          throw error;
        }
        return () => {
          state.browserObservers.delete(observer);
          releaseObserver(observer);
        };
      }
    };
  }

  return Object.freeze({
    open,
    conversationDataSchema: colleagueConversationDataSchema,
    conversationSelectionSchema: colleagueConversationSelectionSchema
  });
}

export { createColleagueBrowserConversations };
