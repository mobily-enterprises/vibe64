import { isDeepStrictEqual } from "node:util";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  VIBE64_AI_TASK_RESULT_SCHEMA,
  normalizeVibe64AgentTaskResult,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { assistantRoutingStatusIsPending, assistantGoalIsActive } from "@local/vibe64-runtime/shared/assistantRouting";
import { createAssistantRouting } from "./assistantRouting.js";
import { throwIfAgentWriteBusy } from "@local/vibe64-runtime/server/agentWriteLock";
import { outsideSessionLocks } from "@local/vibe64-runtime/server/sessionStoreLocks";
import { readSessionUpdateFirst, sessionUpdateFirstRepairBrief } from "@local/vibe64-core/shared";
import {
  discardAssistantChangeoverMessage,
  requireCompletedConversationRewind,
  sendWithAssistantChangeover,
  sessionConversationKey
} from "./assistantChangeover.js";
import {
  createMainConversationBinding,
  readMainConversationHistory,
  MAIN_CONVERSATION_PRESENTATION
} from "./mainConversationBinding.js";
import { conversationClosingRefusal, requireSuccess, routingRequest, presentation } from "./temporaryConversationRules.js";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("./types.js").PrepareAssistantSelection} PrepareAssistantSelection */
/** @typedef {import("./types.js").PrepareAgentSkills} PrepareAgentSkills */
/** @typedef {import("./types.js").RunMainAgentWrite} RunMainAgentWrite */
/** @typedef {import("./types.js").ReadSessionContext} ReadSessionContext */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").SessionAttachments} SessionAttachments */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").TemporaryConversationRecords} TemporaryConversationRecords */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").ConversationTurnPublishers} ConversationTurnPublishers */

// Its turns report a structured result, so their raw JSON never reaches the transcript.
const reportsStructuredResult = record => record.task?.turn.structured === true;

// A turn without an event stream may carry onEvent: null (the provider call context sets it so).
const onCompletedMessage = (ctx, onComplete) => {
  const onEvent = ctx.onEvent ?? doNothing;
  return {
    ...ctx,
    onEvent(event) {
      if (event?.type === "message" && event.message?.complete !== false && String(event.message?.text || "").trim()) {
        onComplete();
      }
      return onEvent(event);
    }
  };
};

const nativeContext = (ctx) => ({ ...ctx, runtime: ctx.conversationContext.runtime });

// The chat's log as its routing reads it: user messages of turns without routing metadata carry no receipt.
const turnWithoutReceipt = turn => turn.metadata?.assistantRouting ? turn : {
  ...turn,
  ...(turn.user ? { user: { ...turn.user, receipt: false } } : {}),
  messages: turn.messages.map(message => message.role === "user" ? { ...message, receipt: false } : message)
};

// Changing a chat's selection resumes the native conversation that selection kept, or starts afresh.
const reboundNativeConversation = (retained, assistantSelection) => ({
  providerConversationId: retained?.conversationId || "",
  runId: retained?.runId || "",
  messageId: retained?.messageId || "",
  status: "ready",
  error: "",
  agentSettings: { model: assistantSelection.modelId, thinking: assistantSelection.variantId }
});

async function withUpdateFirstBrief(ctx, sessionId, message, updateRepair) {
  const brief = sessionUpdateFirstRepairBrief(await readSessionUpdateFirst(ctx.runtime.store, sessionId), { updateRepair });
  return brief ? `${brief}\n\n${message}` : message;
}

/**
 * A turn of an AI task carries what its record says: Update's own brief, the reminder above the
 * person's message, and the result schema. Vibe64's own messages already say all of it.
 */
async function prepareAiTaskMessage(sessionId, input, record, ctx, prepared) {
  const { turn, pending } = record.task;
  const own = pending?.id === input.messageId;
  if (!own && turn.context) prepared.message = `${turn.context}\n\nUser message:\n${prepared.message}`;
  if (turn.updateRepair) prepared.message = await withUpdateFirstBrief(ctx, sessionId, prepared.message, true);
  if (turn.structured) prepared.outputSchema = VIBE64_AI_TASK_RESULT_SCHEMA;
}

/**
 * A temporary chat's turns on the shared conversation runtime: the facilities it lends that runtime,
 * snapshots, the session write coordinator, coalesced output saves, and the chat's own routing with
 * the scoped context and native agent it routes through.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {TemporaryConversationRecords} dependencies.chatRecords
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {SessionAttachments} dependencies.attachments
 * @param {RunMainAgentWrite} dependencies.runAgentWrite
 * @param {number} dependencies.routingWaitMs
 * @param {ReadSessionContext} dependencies.readSessionContext
 * @param {PrepareAgentSkills} dependencies.prepareAgentSkills
 * @param {string} dependencies.systemRoot
 * @param {PrepareAssistantSelection} dependencies.prepareSelection
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {number} dependencies.temporarySaveDelayMs
 * @param {ConversationTurnPublishers} dependencies.conversationTurns
 */
function createTemporaryConversationTurns({
  chatRecords,
  sessionAgent,
  conversationRuntime,
  attachments,
  runAgentWrite,
  routingWaitMs,
  readSessionContext,
  prepareAgentSkills,
  systemRoot,
  prepareSelection,
  publishSessionChanged,
  temporarySaveDelayMs,
  logger,
  conversationTurns
}) {
  if (!Number.isSafeInteger(routingWaitMs) || routingWaitMs < 0) {
    throw new TypeError("Temporary conversations require the assistant routing lock wait.");
  }

  /**
   * All state transitions, including transcript reconciliation, use the existing
   * session write coordinator so a late read cannot recreate a closed record.
   */
  const write = (sessionId, options, operation) => runAgentWrite(sessionId, options, operation, {
    operation: "temporary-conversation",
    waitMs: options.lockWaitMs ?? 10_000,
    // A zero-wait attempt always falls back to saved state or a later save,
    // so its refusal is routine rather than a warning.
    ...(options.lockWaitMs === 0 ? { expectedRefusal: true } : {})
  });

  // Temporary output is saved by the same transcript read as a browser read or
  // the idle completion. A completed native message marks its chat, and one
  // coalesced write per session saves every marked chat, so the session's chats
  // never contend with each other for the lease. Marks made during that write
  // are saved by one more write after it. The write does not wait for the
  // lease: when it is busy the marks stay, and the next completed message or
  // the idle completion read saves them.
  const temporarySaves = new Map();
  function scheduleTemporarySave(sessionId, conversationId, runtime) {
    let pending = temporarySaves.get(sessionId);
    if (!pending) temporarySaves.set(sessionId, pending = { conversationIds: new Set(), timer: null, saving: false });
    pending.conversationIds.add(conversationId);
    pending.runtime = runtime;
    if (!pending.timer && !pending.saving) armTemporarySave(sessionId, pending);
  }
  function armTemporarySave(sessionId, pending) {
    pending.timer = setTimeout(() => void saveTemporaryOutput(sessionId, pending), temporarySaveDelayMs);
    pending.timer.unref();
  }
  async function saveTemporaryOutput(sessionId, pending) {
    pending.timer = null;
    pending.saving = true;
    const conversationIds = [...pending.conversationIds];
    pending.conversationIds.clear();
    const result = await write(sessionId, { runtime: pending.runtime, lockWaitMs: 0 }, async (ctx) => {
      for (const conversationId of conversationIds) {
        const record = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
        if (record && record.state !== "closing") await snapshot(ctx, record);
      }
    }).catch(() => null); // Later reads and the idle completion retry the same save.
    pending.saving = false;
    if (temporarySaves.get(sessionId) !== pending) return;
    if (result?.code === "vibe64_agent_write_mode_busy") {
      for (const conversationId of conversationIds) pending.conversationIds.add(conversationId);
    } else if (pending.conversationIds.size) {
      armTemporarySave(sessionId, pending);
    } else {
      temporarySaves.delete(sessionId);
    }
  }
  function savingTemporaryOutput(sessionId, conversationId, ctx) {
    return onCompletedMessage(ctx, () => scheduleTemporarySave(sessionId, conversationId, ctx.runtime));
  }
  async function nativeState(sessionId, ctx, messageId) {
    const record = await chatRecords.recordFor(ctx.conversationContext, ctx.routingConversationId);
    return record.providerConversationId ? requireSuccess(await sessionAgent.readConversation(
      sessionId,
      chatRecords.providerInput(record, { ...(messageId ? { messageId } : {}) }),
      nativeContext(ctx)
    )) : { status: "ready" };
  }
  const routingAgent = Object.freeze({
    listCapabilities: (input, ctx) => sessionAgent.listCapabilities(input, nativeContext(ctx)),
    requireAssistantAccessForSelection: (input, ctx) => sessionAgent.requireAssistantAccessForSelection(input, nativeContext(ctx)),
    resolveAssistantPurpose: (input, ctx) => sessionAgent.resolveAssistantPurpose({ ...input, temporaryChat: true }, nativeContext(ctx)),
    resolveEphemeralExecutionProfile: (...args) => sessionAgent.resolveEphemeralExecutionProfile(...args),
    createEphemeralConversation: (...args) => sessionAgent.createEphemeralConversation(...args),
    startEphemeralConversationTurn: (...args) => sessionAgent.startEphemeralConversationTurn(...args),
    waitForEphemeralConversationTurn: (...args) => sessionAgent.waitForEphemeralConversationTurn(...args),
    stopEphemeralConversation: (...args) => sessionAgent.stopEphemeralConversation(...args),
    deleteEphemeralConversation: (...args) => sessionAgent.deleteEphemeralConversation(...args),
    async sessionState(id, ctx) {
      const state = await nativeState(id, ctx);
      return { turn: { id: state.runId, status: state.status, active: ["starting", "inProgress"].includes(state.status) } };
    },
    async readGoal(id, ctx) {
      const record = await chatRecords.recordFor(ctx.conversationContext, ctx.routingConversationId);
      try {
        const state = await nativeState(id, ctx);
        return { status: "available", threadId: record.providerConversationId, goal: state.goal };
      } catch (error) {
        return { status: "unavailable", threadId: record.providerConversationId, error: error.message };
      }
    },
    updateSessionSettings: (id, input, ctx) => sessionAgent.updateSessionSettings(id, input, nativeContext(ctx)),
    async inspectMessageAdmission(id, input, ctx) {
      let record = await chatRecords.recordFor(ctx.conversationContext, ctx.routingConversationId);
      const turn = (await ctx.conversationContext.runtime.store.readConversationLog({
        sessionId: id,
        conversationId: record.conversationId
      })).find(entry => entry.user?.messageId === input.messageId);
      if (turn?.metadata?.assistantSelection) {
        const requested = { ...record, assistantSelection: turn.metadata.assistantSelection };
        const key = chatRecords.bindingKey(ctx.conversationContext, requested);
        if (key !== chatRecords.bindingKey(ctx.conversationContext, record)) {
          const retained = record.nativeBindings?.[key];
          if (!retained?.conversationId) return { admission: "unknown", turnId: "" };
          record = {
            ...record,
            ...retained,
            conversationId: record.conversationId,
            providerConversationId: retained.conversationId
          };
        }
      }
      return conversationRuntime.inspectPersistentConversationAdmission({
        sessionId: id,
        record,
        input,
        operations: sessionAgent,
        inputFor: chatRecords.providerInput,
        get context() {
          return chatRecords.selectedContext(nativeContext(ctx), record);
        }
      });
    }
  });

  /**
   * Reuse the routing lifecycle with the temporary chat's existing metadata and
   * transcript scope. Native providers continue to receive the actual store.
   */
  async function routingContext(ctx, conversationId, options = {}) {
    const { cleanup = false } = options;
    const record = await chatRecords.recordFor(ctx, conversationId);
    if (record.state === "closing" && !cleanup) throw conversationClosingRefusal();
    const selected = chatRecords.selectedContext(ctx, record);
    const metadata = selected.session.metadata;
    const store = ctx.runtime.store;
    const scope = { sessionId: ctx.session.sessionId, conversationId };
    const scopedStore = {
      ...store,
      readMetadataValue: async (_id, key) => (await chatRecords.recordFor(ctx, conversationId)).routingMetadata?.[key],
      /**
       * Completion recovery can share the selection update's outer write lease.
       * Read and replace this field together inside the existing store mutation.
       */
      writeMetadataValue: async (_id, key, value) => store.mutateSession(ctx.session.sessionId, async () => {
        const current = await chatRecords.recordFor(ctx, conversationId);
        // Its own code: deleting a chat tolerates vibe64_conversation_closing from its cancel, not this write.
        if (current.state === "closing" && !(cleanup && key === "assistant_routing_request")) {
          throw new AppError(409, "This conversation is closing.", { code: "vibe64_conversation_routing_closing" });
        }
        const routingMetadata = { ...current.routingMetadata, [key]: value };
        const patch = { routingMetadata };
        if (key === "assistant_selection") {
          patch.assistantSelection = JSON.parse(value);
          const nextKey = chatRecords.bindingKey(ctx, { ...current, ...patch });
          if (nextKey !== chatRecords.bindingKey(ctx, current)) {
            Object.assign(patch, reboundNativeConversation(current.nativeBindings?.[nextKey], patch.assistantSelection));
          }
        }
        await chatRecords.save(ctx, current, patch);
        metadata[key] = value;
      })
    };
    scopedStore.readConversationTail = async () => (await store.readConversationLog(scope)).slice(-12);
    scopedStore.readConversationLog = async () => (await store.readConversationLog(scope)).map(turnWithoutReceipt);
    scopedStore.writeConversationUserMessage = (_id, ...args) => store.writeConversationUserMessage(scope, ...args);
    const context = {
      ...selected,
      routingConversationId: conversationId,
      conversationContext: ctx,
      recentChatContext: record.recentChatContext,
      runtime: { ...ctx.runtime, store: scopedStore },
      session: { ...ctx.session, metadata }
    };
    scopedStore.conversationMessageIdExists = async (_id, messageId) => {
      if (!await store.conversationMessageIdExists(scope, messageId)) return false;
      const turn = (await scopedStore.readConversationLog()).find(entry => entry.user?.messageId === messageId);
      if (turn?.user?.receipt !== false) return true;
      const receipt = await routingAgent.inspectMessageAdmission(ctx.session.sessionId, { messageId }, context).catch(() => null);
      return receipt?.admission === "accepted";
    };
    return context;
  }

  const routing = createAssistantRouting({
    systemRoot,
    allowAuto: false,
    agent: routingAgent,
    logger,
    publish: publishSessionChanged,
    /**
     * A send waits behind a sibling chat's slow assistant startup, as Main does,
     * instead of refusing after the shorter default wait.
     */
    exclusive: async (id, options, operation) => {
      const result = await write(
        id,
        { ...options, lockWaitMs: options.lockWaitMs ?? routingWaitMs },
        async (ctx) => operation(await routingContext(ctx, options.conversationId, { cleanup: options.routingCleanup === true }))
      );
      return throwIfAgentWriteBusy(result);
    },
    open: async (id, options) => routingContext(
      await readSessionContext(id, options),
      options.conversationId,
      { cleanup: options.routingCleanup === true }
    ),
    /**
     * Stop's interrupt of this chat's native turn.
     */
    async interrupt(id, ctx) {
      const record = await chatRecords.recordFor(ctx.conversationContext, ctx.routingConversationId);
      return conversationRuntime.stopPersistentConversation(persistentConversationOptions(ctx.conversationContext, record));
    },
    discardPending: discardAssistantChangeoverMessage,
    prepareSelection: async (id, selection, ctx) => {
      const record = await chatRecords.recordFor(ctx.conversationContext, ctx.routingConversationId);
      if (selection.engineId === "codex" && Object.entries(record.nativeBindings || {}).some(([key, binding]) =>
        binding.assistantSelection.engineId === "codex" && key !== "codex")) {
        throw new AppError(409, "This temporary chat has unsupported Codex history. Start a new temporary chat to use Codex. Its saved history has not been changed.", {
          code: "vibe64_codex_history_unsupported",
          messageCode: "vibe64_codex_temporary_history_unsupported"
        });
      }
      if (record.assistantSelection.engineId !== selection.engineId) {
        await conversationRuntime.preparePersistentConversationChangeover({
          ...persistentConversationOptions(nativeContext(ctx), record),
          sessionId: id,
          changeoverContext: ctx
        });
      }
      await prepareSelection(id, selection, ctx);
    },
    dispatch: (id, input, ctx) => sendWithAssistantChangeover(id, input, ctx, {
      inspectMessageAdmission: routingAgent.inspectMessageAdmission,
      sendMessage: (sessionId, message, context) => startInsideWrite(sessionId, {
        ...message,
        conversationId: context.routingConversationId,
        ...(message.turnMetadata?.assistantRouting ? {
          agentSettings: {
            model: context.assistantSelection.modelId,
            thinking: context.assistantSelection.variantId
          }
        } : {})
      }, nativeContext(context))
    }, undefined, ctx.recentChatContext?.messages)
  });

  async function startInsideWrite(sessionId, input, ctx) {
    const record = await chatRecords.recordFor(ctx, input.conversationId);
    if (record.state === "closing") throw conversationClosingRefusal();
    return conversationRuntime.startPersistentConversationTurn({
      ...persistentConversationOptions(savingTemporaryOutput(sessionId, record.conversationId, ctx), record),
      sessionId,
      input
    });
  }

  const persistentConversationFacilities = Object.freeze({
    operations: sessionAgent,
    publish: chatRecords.publish,
    records: {
      input: chatRecords.providerInput,
      read: chatRecords.recordFor,
      save: (ctx, record, patch) => chatRecords.save(ctx, record, patch, { lifecycle: true }),
      bind(ctx, record, patch, binding) {
        return chatRecords.save(ctx, record, {
          ...patch,
          nativeBindings: {
            ...record.nativeBindings,
            [chatRecords.bindingKey(ctx, {
              ...record,
              assistantSelection: binding.assistantSelection
            })]: chatRecords.nativeBinding(binding)
          }
        }, { lifecycle: true });
      },
      retained: record => Object.entries(record.nativeBindings || {}),
      select: (record, binding) => ({
        ...record,
        assistantSelection: binding.assistantSelection,
        providerConversationId: binding.conversationId,
        agentSettings: binding.agentSettings || {},
        runId: binding.runId || "",
        messageId: binding.messageId || ""
      }),
      release(ctx, record, key, binding) {
        const nativeBindings = { ...record.nativeBindings };
        delete nativeBindings[key];
        return chatRecords.save(ctx, record, {
          nativeBindings,
          ...(record.providerConversationId === binding.conversationId ? { providerConversationId: "" } : {})
        });
      },
      async delete(ctx, record, sessionId) {
        if (record.providerConversationId) {
          throw new Error("This conversation's native history has not been upgraded for cleanup. Run the state upgrade before closing it.");
        }
        await attachments.deleteConversationAttachments({ ...ctx, sessionId }, {
          conversationId: record.conversationId
        });
        await ctx.runtime.store.deleteSessionConversation(sessionId, record.conversationId);
      }
    },
    receipts: {
      persisted: turn => Boolean(turn.metadata?.assistantRouting),
      afterAdmission: input => Boolean(input.turnMetadata?.assistantRouting),
      pending: ctx =>
        JSON.parse(ctx.session.metadata.assistant_changeover || "null")?.engines?.[sessionConversationKey(ctx.session)]?.pending
    },
    projection: {
      context: chatRecords.selectedContext,
      messageScope(ctx, scope, requestTurn) {
        const assistantSelection = requestTurn?.metadata?.assistantSelection || ctx.assistantSelection;
        return {
          ...scope,
          turnMetadata: {
            engineId: assistantSelection.engineId,
            assistantSelection,
            ...(requestTurn?.metadata?.assistantRouting ? { assistantRouting: requestTurn.metadata.assistantRouting } : {})
          }
        };
      },
      messageMetadata(turn) {
        return { assistantSelection: turn.metadata?.assistantSelection, assistantRouting: turn.metadata?.assistantRouting };
      },
      message(message, record, phase) {
        if (phase === "stream") {
          // The scoped stream owner has already matched this captured native
          // thread. Keep its admitted selection, not a later composer choice.
          const route = routingRequest(record);
          const attributed = {
            ...message,
            metadata: {
              assistantSelection: record.assistantSelection,
              ...(route?.resolvedMode ? { assistantRouting: { resolvedMode: route.resolvedMode } } : {})
            }
          };
          if (!reportsStructuredResult(record) || (message.role || "assistant") !== "assistant") return attributed;
          const outcome = normalizeVibe64AgentTaskResult(message.text);
          return outcome ? { ...attributed, text: outcome.message, delta: undefined } : null;
        }
        const outcome = message.role === "assistant" ? normalizeVibe64AgentTaskResult(message.text) : null;
        if (phase === "incomplete" && message.role === "assistant" && reportsStructuredResult(record) && !outcome) return null;
        return {
          ...message,
          text: outcome?.message || message.text,
          ...(phase === "incomplete" ? {
            assistantSelection: record.assistantSelection,
            assistantRouting: routingRequest(record)
          } : {})
        };
      },
      async snapshot({ context: ctx, record, response, messages, includeAccess, readPage, savedOnly = false }) {
        const sessionId = ctx.session.sessionId;
        const outcome = response.outcome || normalizeVibe64AgentTaskResult(response.text);
        const route = routingRequest(record);
        if (!savedOnly && route && route.status === "working" && route.delivery === "accepted" && response.runId &&
            !["starting", "inProgress", "ready"].includes(response.status)) {
          // Schedule after releasing the existing write lock. Native idle events
          // normally do this; a read also recovers a missed completion notification.
          void routing.afterTurn(sessionId, {
            payload: {
              agentRun: {
                state: response.status,
                providerTurnId: response.runId,
                active: false
              }
            }
          }, {
            ...ctx,
            conversationId: record.conversationId
          }, { recovered: true }).then(() => outsideSessionLocks(() => conversationTurns.settled(sessionId, record.conversationId)))
            .catch((error) => logOperationalEvent(logger, "warn", {
              component: "vibe64.temporary_conversation",
              event: "vibe64.temporary_conversation.recovered_turn_failed",
              sessionId: sessionId,
              code: error?.code,
              error: error?.message
            }, "A recovered temporary chat turn could not be routed; the next read retries it."));
        }
        const page = readPage ? await readPage() : null;
        return {
          ...record,
          // A browser learns only that this chat belongs to an AI task, never what its task carries.
          ...(record.task ? { task: { kind: record.task.kind, turn: { routing: record.task.turn.routing } } } : {}),
          ...response,
          ...(page ? { conversationLog: page.conversationLog, pagination: page.pagination } : {}),
          outcome,
          ...(includeAccess ? {
            canSteer: ["starting", "inProgress"].includes(response.status)
              ? (await sessionAgent.assistantAccess(sessionId, ctx)).canUse : null
          } : {}),
          conversationId: record.conversationId,
          routingMetadata: { ...record.routingMetadata, assistant_routing: ctx.session.metadata.assistant_routing },
          messages,
          ok: true,
          ...(savedOnly ? { deferredReconciliation: true } : {}),
          ...(route && assistantRoutingStatusIsPending(route)
            ? { routingPending: true } : {}),
          ...(record.state === "closing" ? {
            status: "closing",
            error: record.error || "Close did not finish. Try Close again."
          } : {})
        };
      }
    },
    prepare: {
      async continuity(sessionId, ctx, options = {}) {
        const { remember = false } = options;
        requireCompletedConversationRewind(ctx.session);
        const engineId = sessionConversationKey(ctx.session);
        const store = ctx.runtime.store;
        const id = remember ? ctx.session.sessionId : sessionId;
        const messages = [...(ctx.recentChatContext?.messages || []), ...await readMainConversationHistory(store, id)];
        const binding = createMainConversationBinding(store, id, remember ? undefined : ctx);
        return {
          state: binding.state,
          identity: binding.identity,
          transcript: binding.transcript,
          presentation: MAIN_CONVERSATION_PRESENTATION,
          engineId,
          messages,
          ...(ctx.recentChatContext ? { maximumInitialMessages: 40 } : {}),
          ...(!remember ? { turnMetadata: { engineId: engineId.split("/")[0] } } : {})
        };
      },
      async selection(sessionId, input, record, steering, ctx) {
        const selection = vibe64AssistantSelectionFromMetadata(ctx.session.metadata);
        const settings = steering ? record.agentSettings : input.agentSettings || record.agentSettings;
        const assistantSelection = await sessionAgent.resolveSelection({
          engineId: selection.engineId,
          modelProviderId: selection.modelProviderId,
          agentId: selection.agentId,
          modelId: settings.model || selection.modelId,
          variantId: settings.thinking || ""
        }, { ...ctx, vibe64User: input.vibe64User || ctx.vibe64User });
        ctx = { ...ctx, assistantSelection };
        if (!steering) await prepareAgentSkills(sessionId, { ...ctx, vibe64User: input.vibe64User || ctx.vibe64User });
        return {
          context: ctx,
          settings,
          assistantSelection,
          get creation() {
            return { agentSettings: input.agentSettings || record.agentSettings, persistent: true, vibe64User: input.vibe64User };
          }
        };
      },
      async message(sessionId, input, record, ctx, assistantSelection) {
        const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, input, {
          durable: true,
          conversationId: record.conversationId
        });
        if (record.task) await prepareAiTaskMessage(sessionId, input, record, ctx, prepared);
        const receipt = {
          messageId: input.messageId,
          text: input.displayMessage || input.message,
          attachments: prepared.displayAttachments,
          turnMetadata: { ...input.turnMetadata, assistantSelection }
        };
        return {
          input: prepared,
          receipt,
          get presentation() {
            return presentation(input.presentation);
          }
        };
      }
    }
  });

  function persistentConversationOptions(ctx, record) {
    return {
      ...persistentConversationFacilities,
      sessionId: ctx.session.sessionId,
      context: ctx,
      record,
      store: ctx.runtime.store
    };
  }

  /**
   * A chat read from its assistant, saving the goal it reports when it changed.
   * @param {object} ctx
   * @param {object} record
   * @param {boolean} includeAccess whether the result carries the chat's access
   * @param {object | undefined} transcriptQuery
   */
  async function readSnapshot(ctx, record, includeAccess, transcriptQuery) {
    const result = await conversationRuntime.readPersistentConversation({
      ...persistentConversationOptions(ctx, record),
      includeAccess,
      transcriptQuery
    });
    // The record keeps the last goal its assistant reported; showing a settled
    // chat uses it instead of asking again.
    if (!result.readError && Object.hasOwn(result, "goal") && !isDeepStrictEqual(record.goal ?? null, result.goal ?? null)) {
      await chatRecords.save(ctx, record, { goal: result.goal ?? null });
    }
    return result;
  }

  /**
   * A chat read from its assistant, without its access.
   * @param {object} ctx
   * @param {object} record
   */
  function snapshot(ctx, record) {
    return readSnapshot(ctx, record, false, undefined);
  }

  /**
   * A chat read from its assistant with its access, as its own views show it.
   * @param {object} ctx
   * @param {object} record
   * @param {object} [transcriptQuery]
   */
  function snapshotWithAccess(ctx, record, transcriptQuery) {
    return readSnapshot(ctx, record, true, transcriptQuery);
  }

  async function savedSnapshot(ctx, record, transcriptQuery) {
    const projection = persistentConversationFacilities.projection;
    return conversationRuntime.projectStoredPersistentConversation({
      ...persistentConversationOptions(ctx, record),
      transcriptQuery,
      projection: { ...projection, snapshot: input => projection.snapshot({ ...input, savedOnly: true }) }
    });
  }

  /**
   * What a person sees of a chat. Only work that may still produce output or
   * change its goal is read from its assistant; a settled chat's saved
   * transcript and record are its answer, so showing it starts no assistant
   * process. Send, Stop and the turn's idle completion still read the assistant.
   */
  async function displaySnapshot(ctx, record, transcriptQuery) {
    if (record.providerConversationId && record.state !== "closing" &&
        (["starting", "inProgress"].includes(record.status) || assistantGoalIsActive(record.goal))) {
      return snapshotWithAccess(ctx, record, transcriptQuery);
    }
    return conversationRuntime.projectStoredPersistentConversation({
      ...persistentConversationOptions(ctx, record),
      includeAccess: true,
      transcriptQuery
    });
  }

  async function writeSnapshot(sessionId, options, operation) {
    let context;
    const result = await write(sessionId, options, (ctx) => {
      context = ctx;
      return operation(ctx);
    });
    if (result?.ok === false) return result;
    return { ...result, purposes: await chatRecords.purposes(context, result) };
  }

  function close() {
    for (const pending of temporarySaves.values()) clearTimeout(pending.timer);
    temporarySaves.clear();
    return routing.close();
  }

  return Object.freeze({
    write,
    routingAgent,
    routingContext,
    routing,
    persistentConversationOptions,
    snapshot,
    snapshotWithAccess,
    savedSnapshot,
    displaySnapshot,
    writeSnapshot,
    close
  });
}

export {
  createTemporaryConversationTurns
};
