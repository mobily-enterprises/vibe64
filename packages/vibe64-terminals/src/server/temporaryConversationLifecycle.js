import { randomUUID } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingPreferences,
  assistantRoutingFromMetadata,
  isAssistantRoutingOwner
} from "@local/vibe64-runtime/shared/assistantRouting";
import { throwIfAgentWriteBusy } from "@local/vibe64-runtime/server/agentWriteLock";
import {
  teamTemporaryModesRefusal,
  temporaryAutoModeRefusal,
  presentation,
  recentChatContext,
  numberedConversations,
  temporaryConversationNamespace,
  routingRequest
} from "./temporaryConversationRules.js";

/** @typedef {import("./types.js").ReadSessionContext} ReadSessionContext */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").TemporaryConversationRecords} TemporaryConversationRecords */
/** @typedef {import("./types.js").TemporaryConversationTurns} TemporaryConversationTurns */
/** @typedef {import("./types.js").ConversationTurnPublishers} ConversationTurnPublishers */

/**
 * A temporary chat from creation to Close: creating, listing and reading chats, stopping a turn,
 * closing and retiring chats, and saving an idle turn before its review.
 * @param {object} dependencies
 * @param {TemporaryConversationRecords} dependencies.chatRecords
 * @param {TemporaryConversationTurns} dependencies.chatTurns
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {ReadSessionContext} dependencies.readSessionContext
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {number} dependencies.temporaryCompletionAttempts
 * @param {number} dependencies.temporaryCompletionRetryMs
 * @param {AssistantRouting} dependencies.routing
 * @param {ConversationTurnPublishers} dependencies.conversationTurns
 */
function createTemporaryConversationLifecycle({
  chatRecords,
  chatTurns,
  conversationRuntime,
  readSessionContext,
  publishSessionChanged,
  temporaryCompletionAttempts,
  temporaryCompletionRetryMs,
  routing,
  conversationTurns
}) {
  /**
   * `options.aiTask`, from the AI tasks feature only, makes this chat that task's conversation: it receives
   * the session's conversations inside this write, and returns the task to save or throws its refusal.
   */
  async function createTemporaryConversation(sessionId, input, options = {}) {
    let created = false;
    const { aiTask = null, ...writeOptions } = options;
    const result = await chatTurns.writeSnapshot(sessionId, writeOptions, async (ctx) => {
      const conversationId = input.conversationId || randomUUID();
      const existing = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
      if (existing) return chatTurns.snapshotWithAccess(ctx, existing);
      const task = aiTask ? aiTask(await ctx.runtime.store.listSessionConversations(sessionId)) : null;
      created = true;
      const parentPreferences = assistantRoutingFromMetadata(ctx.session.metadata);
      const parentSelection = vibe64AssistantSelectionFromMetadata(ctx.session.metadata);
      // Team members' temporary chats run on their own Fix it with AI or Custom model.
      const owner = isAssistantRoutingOwner(input.vibe64User || options.vibe64User);
      let inheritedPreferences = { mode: "fix" };
      if (owner) {
        inheritedPreferences = parentPreferences
          ? { ...parentPreferences, mode: parentPreferences.mode === "auto" ? "senior" : parentPreferences.mode }
          : { mode: "senior", override: parentSelection };
      }
      const fixRequired = task?.turn.routing === "fix";
      const requestedPreferences = fixRequired ? { mode: "fix" } : input.assistantRouting || inheritedPreferences;
      if (requestedPreferences.mode === "auto") throw temporaryAutoModeRefusal();
      if (!owner && ["senior", "junior"].includes(requestedPreferences.mode)) throw teamTemporaryModesRefusal();
      const preferences = assistantRoutingPreferences({ ...requestedPreferences, review: false, autoSave: false });
      const initialPresentation = presentation(input.presentation);
      const recentContext = input.includeRecentChatContext === true
        ? await ctx.runtime.store.mutateSession(sessionId, () => recentChatContext(ctx.runtime.store, sessionId)) : null;
      const numbers = numberedConversations(await ctx.runtime.store.listSessionConversations(sessionId)).map(item => item.number);
      const record = await ctx.runtime.store.writeSessionConversation(sessionId, conversationId, {
        ...initialPresentation,
        ...(task ? { task } : {}),
        number: Math.max(0, ...numbers) + 1,
        ...(Object.hasOwn(initialPresentation, "draft") ? { draftRevision: randomUUID() } : {}),
        ...(preferences ? {
          routingMetadata: {
            assistant_routing: JSON.stringify(preferences),
            ...(recentContext ? { assistant_changeover: JSON.stringify({ lastEngine: "", engines: {} }) } : {})
          }
        } : {}),
        ...(recentContext ? { recentChatContext: recentContext } : {}),
        agentSettings: input.agentSettings || {},
        assistantSelection: parentSelection,
        providerConversationId: "",
        nativeBindings: {},
        state: "open",
        status: "ready",
        attachments: []
      });
      return chatTurns.snapshotWithAccess(ctx, record);
    });
    // Other open views of this session list the new chat; Close has the same notice.
    if (created && result?.ok !== false) {
      await publishSessionChanged(sessionId, {
        reason: "temporary-conversation-created",
        payload: { conversationId: result.conversationId }
      });
    }
    return result;
  }

  /**
   * The person's temporary chats, as their tabs and Colleague's list read them. An AI task's conversation
   * belongs to its task's window, so it is listed only with `includeAiTasks`, for startup's reconcile.
   */
  async function listTemporaryConversations(sessionId, options = {}) {
    const { includeAiTasks = false, ...writeOptions } = options;
    let context;
    const list = async (ctx, savedOnly = false) => {
      context = ctx;
      const records = (await ctx.runtime.store.listSessionConversations(sessionId))
        .filter(record => includeAiTasks || !record.task);
      const conversations = [];
      for (const record of records) {
        conversations.push(savedOnly
          ? await chatTurns.savedSnapshot(ctx, record) : await chatTurns.displaySnapshot(ctx, record));
      }
      return { ok: true, conversations: numberedConversations(conversations) };
    };
    let result = await chatTurns.write(sessionId, { ...writeOptions, lockWaitMs: 0 }, list);
    if (result?.code === "vibe64_agent_write_mode_busy") {
      context = await readSessionContext(sessionId, writeOptions);
      result = await list(context, true);
    }
    if (result?.ok === false) return result;
    if (result.conversations.some(record => record.deferredReconciliation)) return result;
    // Provider availability is read-only and can be slow. Polling must not
    // hold the session write lock while looking up every chat's modes.
    return {
      ...result,
      conversations: await Promise.all(result.conversations.map(async (record) => ({
        ...record,
        purposes: await chatRecords.purposes(context, record)
      })))
    };
  }

  /**
   * A temporary chat as its views show it, or the requested page of its messages. `options.transcriptQuery` narrows
   * the transcript the conversation runtime reads.
   * @param {string} sessionId
   * @param {object} input
   * @param {object} [options]
   * @param {object} [options.transcriptQuery]
   */
  async function readTemporaryConversation(sessionId, input, options = {}) {
    const { transcriptQuery, ...context } = options;
    let deferred = false;
    try {
      await routing.reconcile(sessionId, { ...context, conversationId: input.conversationId, lockWaitMs: 0 });
    } catch (error) {
      if (error.code !== "vibe64_agent_write_mode_busy") throw error;
      deferred = true;
    }
    let result = deferred ? { code: "vibe64_agent_write_mode_busy" }
      : await chatTurns.writeSnapshot(sessionId, { ...context, lockWaitMs: 0 }, async (ctx) =>
        chatTurns.displaySnapshot(ctx, await chatRecords.recordFor(ctx, input.conversationId), transcriptQuery));
    if (result?.code === "vibe64_agent_write_mode_busy") {
      const ctx = await readSessionContext(sessionId, context);
      result = await chatTurns.savedSnapshot(ctx, await chatRecords.recordFor(ctx, input.conversationId), transcriptQuery);
    }
    if (result.ok === false || (!input.beforeMessageId && input.messageLimit === undefined)) return result;
    const messages = result.messages || [];
    const end = input.beforeMessageId ? messages.findIndex((message) => message.id === input.beforeMessageId) : messages.length;
    if (end < 0) {
      throw new AppError(409, "This message cursor no longer exists. Read the latest messages again.", { code: "vibe64_conversation_cursor_missing" });
    }
    const start = Math.max(0, end - (input.messageLimit || 12));
    return { ...result, messages: messages.slice(start, end), earlierMessages: start > 0 };
  }

  async function stopTemporaryConversation(sessionId, input, options = {}) {
    await routing.cancel(sessionId, { ...options, conversationId: input.conversationId });
    const stopped = await chatTurns.write(sessionId, options, async (ctx) => {
      const record = await chatRecords.recordFor(ctx, input.conversationId);
      const result = await conversationRuntime.stopPersistentConversation(chatTurns.persistentConversationOptions(ctx, record));
      return { ...result, routingMetadata: record.routingMetadata };
    });
    await conversationTurns.settled(sessionId, input.conversationId);
    return stopped;
  }

  /**
   * How a chat's turn stands, read from its assistant as a turn's end reads it; null once the chat is closed.
   * @param {string} sessionId
   * @param {string} conversationId
   * @param {object} [options]
   */
  function readConversationTurn(sessionId, conversationId, options = {}) {
    return chatTurns.write(sessionId, options, async (ctx) => {
      const record = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
      if (!record) return null;
      const observed = await chatTurns.snapshot(ctx, record);
      const saved = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
      return {
        status: observed.status,
        messageId: saved?.messageId || record.messageId || "",
        outcome: observed.outcome || null,
        error: observed.error || "",
        readError: observed.readError === true,
        routingPending: observed.routingPending === true
      };
    });
  }

  /** Removes a chat's open runtime entry, with its handles, from memory. */
  function retireOpenEntry(runtime, sessionId, conversationId) {
    return conversationRuntime.retireOpenConversation({
      namespace: temporaryConversationNamespace(runtime, sessionId, conversationId),
      sessionId
    });
  }

  async function deleteTemporaryConversation(sessionId, input, options = {}) {
    try {
      await routing.cancel(sessionId, { ...options, conversationId: input.conversationId }, { waitForCleanup: true });
    } catch (error) {
      if (!["vibe64_conversation_closed", "vibe64_conversation_closing"].includes(error.code)) throw error;
    }
    let context;
    const result = await chatTurns.write(sessionId, options, async (ctx) => {
      context = ctx;
      const record = await ctx.runtime.store.readSessionConversation(sessionId, input.conversationId);
      if (!record) return { ok: true, deleted: true };
      if (routingRequest(record)?.helper) {
        throw new Error("The routing helper could not be closed. Retry closing this conversation to finish cleanup.");
      }
      return conversationRuntime.deletePersistentConversation(chatTurns.persistentConversationOptions(ctx, record));
    });
    if (result.ok) {
      await chatRecords.publish(context, input.conversationId, {
        payload: {
          conversationStream: context.runtime.store.clearConversationStream({
            sessionId,
            conversationId: input.conversationId
          })
        }
      });
      // The closed chat's open runtime entry and its handles leave memory now.
      await retireOpenEntry(context.runtime, sessionId, input.conversationId);
      await publishSessionChanged(sessionId, {
        reason: "temporary-conversation-closed",
        payload: { conversationId: input.conversationId }
      });
    }
    return result;
  }

  /**
   * Archive: once its source is gone a session's temporary chats cannot
   * reopen, so their open runtime entries leave memory with it.
   */
  async function retireTemporaryConversations(sessionId, options = {}) {
    const { runtime } = await readSessionContext(sessionId, options);
    for (const record of await runtime.store.listSessionConversations(sessionId)) {
      await retireOpenEntry(runtime, sessionId, record.conversationId);
    }
    return { ok: true };
  }

  async function afterTemporaryTurn(sessionId, payload, options = {}) {
    // No browser event follows this idle completion, so a busy lease is
    // retried instead of leaving the saved turn in progress; the last try throws.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const record = await chatTurns.write(sessionId, options, async (ctx) => {
          const conversations = await ctx.runtime.store.listSessionConversations(sessionId);
          const completed = conversations.find((item) =>
            item.providerConversationId === payload.conversationId && item.state !== "closing");
          if (!completed) return null;
          // Persist the completed reply before review checks for unanswered questions.
          const observed = await chatTurns.snapshot(ctx, completed);
          if (observed.readError) throw new Error(observed.error);
          return completed;
        });
        throwIfAgentWriteBusy(record);
        if (record?.conversationId) {
          await routing.afterTurn(sessionId, { payload: { agentRun: payload.temporaryRun } }, {
            ...options,
            conversationId: record.conversationId
          });
          await conversationTurns.settled(sessionId, record.conversationId);
        }
        return;
      } catch (error) {
        if (error?.code !== "vibe64_agent_write_mode_busy" || attempt >= temporaryCompletionAttempts) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, temporaryCompletionRetryMs));
    }
  }

  return Object.freeze({
    createTemporaryConversation,
    listTemporaryConversations,
    readTemporaryConversation,
    stopTemporaryConversation,
    readConversationTurn,
    deleteTemporaryConversation,
    retireTemporaryConversations,
    afterTemporaryTurn
  });
}

export {
  createTemporaryConversationLifecycle
};
