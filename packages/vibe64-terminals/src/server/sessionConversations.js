import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { ACTION_START_TEMPORARY_CONVERSATION_TURN, ACTION_STOP_TEMPORARY_CONVERSATION,
  ACTION_UPDATE_TEMPORARY_CONVERSATION } from "./actions.js";
import { temporaryConversationTurnActionInputValidator, temporaryConversationUpdateInputValidator } from "./inputSchemas.js";
import { normalizeVibe64AgentTaskResult, serializeVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { assistantRoutingPreferences, assistantRoutingFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { createAssistantRouting } from "./assistantRouting.js";
import { requireCompletedConversationRewind, sendWithAssistantChangeover, sessionConversationKey } from "./assistantChangeover.js";
import { createMainConversationBinding, readMainConversationHistory, MAIN_CONVERSATION_PRESENTATION } from "./mainConversationBinding.js";

const textFields = [
  "title", "draft", "displayMessage", "completionMessage", "dedupeKey", "failureMessage", "nextStepMessage",
  "recoveryNotice", "recoveryOperation", "recoveryConflictId", "recoveryContext", "recoveryOutcome",
  "recoveryOutcomeMessage", "runConflictId"
];
const messageFields = Object.keys(temporaryConversationTurnActionInputValidator.schema.getFieldDefinitions())
  .filter(key => !["sessionId", "conversationId", "vibe64User", "message", "messageId", "attachmentIds", "submissionKind"].includes(key));
const temporaryConversationNamespace = (runtime, sessionId, conversationId) =>
  `${runtime.stateRoot}\0${sessionId}\0temporary\0${conversationId}`;

function presentation(input = {}) {
  const result = {};
  for (const key of textFields) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== "string" || input[key].length > 100_000) throw new Error(`Invalid conversation ${key}.`);
    result[key] = input[key];
  }
  if (Object.hasOwn(input, "recoveryAutoPaused")) result.recoveryAutoPaused = input.recoveryAutoPaused === true;
  if (Object.hasOwn(input, "recoveryRetryKeys")) {
    if (!Array.isArray(input.recoveryRetryKeys) || input.recoveryRetryKeys.length > 3 ||
        input.recoveryRetryKeys.some((key) => typeof key !== "string" || key.length > 1000)) {
      throw new Error("Invalid conversation repair retries.");
    }
    result.recoveryRetryKeys = input.recoveryRetryKeys;
  }
  return result;
}

function requireSuccess(result) {
  if (result?.ok === false) throw Object.assign(new Error(result.error || "Assistant conversation operation failed."), result);
  return result;
}

// Session storage owns discovery and the transcript. Existing provider adapters
// own native turns. Only explicit Close removes a user-facing temporary chat.
function createSessionConversations({
  sessionAgent,
  conversationRuntime,
  actions,
  attachments,
  runAgentWrite,
  prepareAgentSkills,
  systemRoot,
  prepareSelection = async () => {},
  publishSessionChanged = async () => {},
  publishConversation = async () => {}
}) {
  async function recordFor(ctx, conversationId) {
    const record = await ctx.runtime.store.readSessionConversation(ctx.session.sessionId, conversationId);
    if (!record) throw Object.assign(new Error("This conversation has been closed."), {
      code: "vibe64_conversation_closed", statusCode: 404, conversationExpired: true
    });
    return record;
  }

  function providerInput(record, input = {}) {
    return {
      messageId: record.messageId,
      ...input,
      conversationId: record.providerConversationId,
      persistent: true,
      agentSettings: input.agentSettings || record.agentSettings
    };
  }

  async function save(ctx, record, patch) {
    const saved = await ctx.runtime.store.writeSessionConversation(ctx.session.sessionId, record.conversationId, patch);
    if (Object.keys(patch).some(key => !isDeepStrictEqual(record[key], saved[key]))) {
      await publish(ctx, saved.conversationId, { type: "phase",
        phase: ["starting", "inProgress"].includes(saved.status) ? "working" : "" });
    }
    return saved;
  }

  function publish(ctx, conversationId, event) {
    const sessionId = ctx.session.sessionId;
    return publishConversation({ sessionId, namespace: temporaryConversationNamespace(ctx.runtime, sessionId, conversationId), event });
  }

  function selectedContext(ctx, record) {
    const selection = record.assistantSelection || vibe64AssistantSelectionFromMetadata(ctx.session.metadata);
    const metadata = { ...ctx.session.metadata };
    for (const key of ["assistant_routing", "assistant_routing_request", "assistant_routing_goal", "codex_routing_home_provider", "assistant_changeover"]) delete metadata[key];
    // Native history belongs to this chat, never to the parent session.
    for (const key of Object.keys(metadata)) {
      if (/^(?:codex(?:_[a-z0-9_-]+)?|claude|opencode)_conversation_id$/u.test(key)) delete metadata[key];
    }
    Object.assign(metadata, record.routingMetadata || {}, {
      assistant_selection: serializeVibe64AssistantSelection(selection),
      agent_identity_provider: record.providerConversationId ? selection.engineId : "",
      agent_identity_conversation_id: record.providerConversationId || "",
      agent_identity_model_provider: record.providerConversationId ? selection.modelProviderId : ""
    });
    if (record.recoveryOperation === "update") {
      const preferences = assistantRoutingFromMetadata(metadata);
      // Enforce repair policy for future turns without rewriting saved requests or history.
      metadata.assistant_routing = JSON.stringify(assistantRoutingPreferences({
        ...preferences, mode: "senior", review: false,
        workflowEngineId: preferences?.workflowEngineId || selection.engineId,
        override: preferences?.mode === "senior" ? preferences.override : undefined
      }));
    }
    return { ...ctx, routingConversationId: record.conversationId, assistantSelection: selection,
      session: { ...ctx.session, metadata } };
  }

  function nativeBinding(record) {
    return { conversationId: record.providerConversationId, assistantSelection: record.assistantSelection,
      agentSettings: record.agentSettings || {}, runId: record.runId || "", messageId: record.messageId || "" };
  }

  function bindingKey(ctx, record) {
    return sessionConversationKey(selectedContext(ctx, record).session);
  }

  async function purposes(ctx, record) {
    const selected = selectedContext(ctx, record);
    const preferences = assistantRoutingFromMetadata(selected.session.metadata);
    const decisions = await sessionAgent.inspectAssistantPurposes({ ...preferences,
      workflowEngineId: preferences?.workflowEngineId || record.assistantSelection.engineId
    }, selected);
    const autoUnavailable = { available: false, message: "Auto is available in Main chat only. Choose Senior or Junior." };
    return JSON.parse(JSON.stringify({ ...decisions, auto: autoUnavailable, review: autoUnavailable }, (key, value) =>
      ["connectionIdentity", "routerConnectionIdentity"].includes(key) ? undefined : value));
  }

  const persistentConversationFacilities = {
    operations: sessionAgent,
    publish,
    records: {
      input: providerInput,
      read: recordFor,
      save,
      bind(ctx, record, patch, binding) {
        return save(ctx, record, { ...patch,
          nativeBindings: { ...record.nativeBindings,
            [bindingKey(ctx, { ...record, assistantSelection: binding.assistantSelection })]: nativeBinding(binding) }
        });
      },
      retained: record => Object.entries(record.nativeBindings || {}),
      select: (record, binding) => ({ ...record, assistantSelection: binding.assistantSelection, providerConversationId: binding.conversationId,
        agentSettings: binding.agentSettings || {}, runId: binding.runId || "", messageId: binding.messageId || "" }),
      release(ctx, record, key, binding) {
        const nativeBindings = { ...record.nativeBindings };
        delete nativeBindings[key];
        return save(ctx, record, { nativeBindings,
          ...(record.providerConversationId === binding.conversationId ? { providerConversationId: "" } : {}) });
      },
      async delete(ctx, record, sessionId) {
        if (record.providerConversationId) throw new Error("This conversation's native history has not been upgraded for cleanup. Run the state upgrade before closing it.");
        await attachments.deleteConversationAttachments({ ...ctx, sessionId }, {
          conversationId: record.conversationId
        });
        await ctx.runtime.store.deleteSessionConversation(sessionId, record.conversationId);
      }
    },
    receipts: {
      persisted: turn => Boolean(turn.metadata?.assistantRouting),
      afterAdmission: input => Boolean(input.turnMetadata?.assistantRouting),
      pending: ctx => JSON.parse(ctx.session.metadata.assistant_changeover || "null")?.engines?.[sessionConversationKey(ctx.session)]?.pending
    },
    projection: {
      context: selectedContext,
      messageScope(ctx, scope, requestTurn) {
        const assistantSelection = requestTurn?.metadata?.assistantSelection || ctx.assistantSelection;
        return { ...scope, turnMetadata: { engineId: assistantSelection.engineId, assistantSelection,
          ...(requestTurn?.metadata?.assistantRouting ? { assistantRouting: requestTurn.metadata.assistantRouting } : {}) } };
      },
      messageMetadata(turn) {
        return { assistantSelection: turn.metadata?.assistantSelection, assistantRouting: turn.metadata?.assistantRouting };
      },
      message(message, record, phase) {
        if (phase === "stream") {
          if (record.recoveryOperation !== "update" || (message.role || "assistant") !== "assistant") return message;
          const outcome = normalizeVibe64AgentTaskResult(message.text);
          return outcome ? { ...message, text: outcome.message, delta: undefined } : null;
        }
        const outcome = message.role === "assistant" ? normalizeVibe64AgentTaskResult(message.text) : null;
        if (phase === "incomplete" && message.role === "assistant" && record.recoveryOperation === "update" && !outcome) return null;
        return { ...message, text: outcome?.message || message.text,
          ...(phase === "incomplete" ? { assistantSelection: record.assistantSelection,
            assistantRouting: JSON.parse(record.routingMetadata?.assistant_routing_request || "null") } : {}) };
      },
      async snapshot({ context: ctx, record, response, messages, includeAccess, readPage }) {
        const sessionId = ctx.session.sessionId;
        const outcome = response.outcome || normalizeVibe64AgentTaskResult(response.text);
        const route = JSON.parse(record.routingMetadata?.assistant_routing_request || "null");
        if (route && route.status === "working" && route.delivery === "accepted" && response.runId &&
            !["starting", "inProgress", "ready"].includes(response.status)) {
          // Schedule after releasing the existing write lock. Native idle events
          // normally do this; a read also recovers a missed completion notification.
          void routing.afterTurn(sessionId, { payload: { agentRun: { state: response.status,
            providerTurnId: response.runId, active: false } } }, { ...ctx, conversationId: record.conversationId }, { recovered: true }).catch(() => {});
        }
        const page = readPage ? await readPage() : null;
        return {
          ...record,
          ...response,
          ...(page ? { conversationLog: page.conversationLog, pagination: page.pagination } : {}),
          outcome,
          ...(includeAccess ? {
            canSteer: ["starting", "inProgress"].includes(response.status)
              ? (await sessionAgent.assistantAccess(sessionId, ctx)).canUse : null } : {}),
          conversationId: record.conversationId,
          routingMetadata: { ...record.routingMetadata, assistant_routing: ctx.session.metadata.assistant_routing },
          messages,
          ok: true,
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
      async continuity(sessionId, ctx, { remember = false } = {}) {
        let engineId = remember ? sessionConversationKey(ctx.session) : undefined;
        requireCompletedConversationRewind(ctx.session);
        const store = ctx.runtime.store;
        if (!remember) engineId = sessionConversationKey(ctx.session);
        const id = remember ? ctx.session.sessionId : sessionId;
        const messages = await readMainConversationHistory(store, id);
        const binding = createMainConversationBinding(store, id, remember ? undefined : ctx);
        return { state: binding.state, identity: binding.identity, transcript: binding.transcript,
          presentation: MAIN_CONVERSATION_PRESENTATION, engineId, messages,
          ...(!remember ? { turnMetadata: { engineId: engineId.split("/")[0] } } : {}) };
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
        return { context: ctx, settings, assistantSelection,
          get creation() {
            return { agentSettings: input.agentSettings || record.agentSettings, persistent: true, vibe64User: input.vibe64User };
          }
        };
      },
      async message(sessionId, input, record, ctx, assistantSelection) {
        const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, input, {
          durable: true, conversationId: record.conversationId
        });
        const receipt = { messageId: input.messageId, text: input.displayMessage || input.message,
          attachments: prepared.displayAttachments, turnMetadata: { ...input.turnMetadata, assistantSelection } };
        return { input: prepared, receipt,
          get presentation() { return presentation(input.presentation); }
        };
      }
    }
  };

  function persistentConversationOptions(ctx, record) {
    return { ...persistentConversationFacilities, sessionId: ctx.session.sessionId,
      context: ctx, record, store: ctx.runtime.store };
  }

  async function snapshot(ctx, record, includeAccess = false, transcriptQuery) {
    return conversationRuntime.readPersistentConversation({
      ...persistentConversationOptions(ctx, record), includeAccess, transcriptQuery
    });
  }

  // All state transitions, including transcript reconciliation, use the existing
  // session write coordinator so a late read cannot recreate a closed record.
  const write = (sessionId, options, operation) => runAgentWrite(sessionId, options, operation, {
    operation: "temporary-conversation",
    waitMs: 10_000
  });

  async function writeSnapshot(sessionId, options, operation) {
    let context;
    const result = await write(sessionId, options, (ctx) => {
      context = ctx;
      return operation(ctx);
    });
    if (result?.ok === false) return result;
    return { ...result, purposes: await purposes(context, result) };
  }

  // Reuse the routing lifecycle with the temporary chat's existing metadata and
  // transcript scope. Native providers continue to receive the actual store.
  async function routingContext(ctx, conversationId) {
    const record = await recordFor(ctx, conversationId);
    if (record.state === "closing") throw Object.assign(new Error("This conversation is closing."), { code: "vibe64_conversation_closing" });
    const selected = selectedContext(ctx, record);
    const metadata = selected.session.metadata;
    const store = ctx.runtime.store;
    const scope = { sessionId: ctx.session.sessionId, conversationId };
    const scopedStore = { ...store,
      readMetadataValue: async (_id, key) => (await recordFor(ctx, conversationId)).routingMetadata?.[key],
      // Completion recovery can share the selection update's outer write lease.
      // Read and replace this field together inside the existing store mutation.
      writeMetadataValue: async (_id, key, value) => store.mutateSession(ctx.session.sessionId, async () => {
        const current = await recordFor(ctx, conversationId);
        if (current.state === "closing") throw new Error("This conversation is closing.");
        const routingMetadata = { ...current.routingMetadata, [key]: value };
        const patch = { routingMetadata };
        if (key === "assistant_selection") {
          patch.assistantSelection = JSON.parse(value);
          const nextKey = bindingKey(ctx, { ...current, ...patch });
          if (nextKey !== bindingKey(ctx, current)) {
            const retained = current.nativeBindings?.[nextKey];
            Object.assign(patch, { providerConversationId: retained?.conversationId || "", runId: retained?.runId || "",
              messageId: retained?.messageId || "", status: "ready", error: "",
              agentSettings: { model: patch.assistantSelection.modelId, thinking: patch.assistantSelection.variantId } });
          }
        }
        await save(ctx, current, patch);
        metadata[key] = value;
      })
    };
    scopedStore.readConversationTail = async () => (await store.readConversationLog(scope)).slice(-12);
    scopedStore.readConversationLog = async () => (await store.readConversationLog(scope)).map(turn =>
      turn.metadata?.assistantRouting ? turn : { ...turn,
        ...(turn.user ? { user: { ...turn.user, receipt: false } } : {}),
        messages: turn.messages.map(message => message.role === "user" ? { ...message, receipt: false } : message) });
    scopedStore.writeConversationUserMessage = (_id, ...args) => store.writeConversationUserMessage(scope, ...args);
    const context = { ...selected, routingConversationId: conversationId, conversationContext: ctx,
      requiredAssistantMode: record.recoveryOperation === "update" ? "senior" : "",
      runtime: { ...ctx.runtime, store: scopedStore }, session: { ...ctx.session, metadata } };
    scopedStore.conversationMessageIdExists = async (_id, messageId) => {
      if (!await store.conversationMessageIdExists(scope, messageId)) return false;
      const turn = (await scopedStore.readConversationLog()).find(turn => turn.user?.messageId === messageId);
      if (turn?.user?.receipt !== false) return true;
      const receipt = await routingAgent.inspectMessageAdmission(ctx.session.sessionId, { messageId }, context).catch(() => null);
      return receipt?.admission === "accepted";
    };
    return context;
  }
  const nativeContext = (ctx) => ({ ...ctx, runtime: ctx.conversationContext.runtime });
  async function nativeState(sessionId, ctx, messageId) {
    const record = await recordFor(ctx.conversationContext, ctx.routingConversationId);
    return record.providerConversationId ? requireSuccess(await sessionAgent.readConversation(sessionId,
      providerInput(record, { ...(messageId ? { messageId } : {}) }), nativeContext(ctx))) : { status: "ready" };
  }
  const routingAgent = {
    listCapabilities: (input, ctx) => sessionAgent.listCapabilities(input, nativeContext(ctx)),
    requireAssistantAccessForSelection: (input, ctx) => sessionAgent.requireAssistantAccessForSelection(input, nativeContext(ctx)),
    resolveAssistantPurpose: (input, ctx) => sessionAgent.resolveAssistantPurpose(input, nativeContext(ctx)),
    ...Object.fromEntries(["resolveEphemeralExecutionProfile", "createEphemeralConversation", "startEphemeralConversationTurn",
      "waitForEphemeralConversationTurn", "stopEphemeralConversation", "deleteEphemeralConversation"]
      .map((name) => [name, (...args) => sessionAgent[name](...args)])),
    async sessionState(id, ctx) {
      const state = await nativeState(id, ctx);
      return { turn: { id: state.runId, active: ["starting", "inProgress"].includes(state.status) } };
    },
    async readGoal(id, ctx) {
      return { goal: (await nativeState(id, ctx)).goal };
    },
    async inspectMessageAdmission(id, input, ctx) {
      let record = await recordFor(ctx.conversationContext, ctx.routingConversationId);
      const turn = (await ctx.conversationContext.runtime.store.readConversationLog({
        sessionId: id, conversationId: record.conversationId
      })).find(turn => turn.user?.messageId === input.messageId);
      if (turn?.metadata?.assistantSelection) {
        const requested = { ...record, assistantSelection: turn.metadata.assistantSelection };
        const key = bindingKey(ctx.conversationContext, requested);
        if (key !== bindingKey(ctx.conversationContext, record)) {
          const retained = record.nativeBindings?.[key];
          if (!retained?.conversationId) return { admission: "unknown", turnId: "" };
          record = { ...record, ...retained, conversationId: record.conversationId,
            providerConversationId: retained.conversationId };
        }
      }
      return conversationRuntime.inspectPersistentConversationAdmission({
        sessionId: id, record, input, operations: sessionAgent, inputFor: providerInput,
        get context() { return selectedContext(nativeContext(ctx), record); }
      });
    }
  };
  const routing = createAssistantRouting({ systemRoot, allowAuto: false, agent: routingAgent, publish: publishSessionChanged,
    exclusive: async (id, options, operation) => {
      const result = await write(id, options, async (ctx) => operation(await routingContext(ctx, options.conversationId)));
      if (result?.code === "vibe64_agent_write_mode_busy") throw Object.assign(new Error(result.error), result);
      return result;
    },
    prepareSelection: async (id, selection, ctx) => {
      const record = await recordFor(ctx.conversationContext, ctx.routingConversationId);
      if (selection.engineId === "codex" && Object.entries(record.nativeBindings || {}).some(([key, binding]) =>
        binding.assistantSelection.engineId === "codex" && key !== "codex")) {
        throw Object.assign(new Error("This temporary chat has unsupported Codex history. Start a new temporary chat to use Codex. Its saved history has not been changed."), {
          code: "vibe64_codex_history_unsupported", statusCode: 409
        });
      }
      if (record.assistantSelection.engineId !== selection.engineId) {
        await conversationRuntime.preparePersistentConversationChangeover({
          ...persistentConversationOptions(nativeContext(ctx), record), sessionId: id, changeoverContext: ctx
        });
      }
      await prepareSelection(id, selection, ctx);
    },
    dispatch: (id, input, ctx) => sendWithAssistantChangeover(id, input, ctx, {
      inspectMessageAdmission: routingAgent.inspectMessageAdmission,
      sendMessage: (sessionId, message, context) => startInsideWrite(sessionId, {
        ...message, conversationId: context.routingConversationId,
        ...(message.turnMetadata?.assistantRouting ? { agentSettings: {
          model: context.assistantSelection.modelId, thinking: context.assistantSelection.variantId } } : {})
      }, nativeContext(context))
    })
  });

  async function startInsideWrite(sessionId, input, ctx) {
    const record = await recordFor(ctx, input.conversationId);
    if (record.state === "closing") throw new Error("This conversation is closing.");
    return conversationRuntime.startPersistentConversationTurn({
      ...persistentConversationOptions(ctx, record), sessionId, input
    });
  }

  const service = {
    close: routing.close,
    temporaryConversationDataSchema: createSchema(Object.fromEntries(messageFields.map(key =>
      [key, temporaryConversationTurnActionInputValidator.schema.getFieldDefinitions()[key]]))),
    temporaryConversationSelectionSchema: createSchema(Object.fromEntries(["agentSettings", "assistantRouting"].map(key =>
      [key, temporaryConversationUpdateInputValidator.schema.getFieldDefinitions()[key]]))),
    async conversationBinding(sessionId, openingContext) {
      const conversationId = openingContext.temporaryConversationId;
      const record = await recordFor(openingContext, conversationId);
      const scope = { sessionId, conversationId };
      const { runtime } = openingContext;
      async function execute(actionId, input, context) {
        const authority = context?.browserAuthority;
        if (!actions || !authority || authority.sessionId !== sessionId || authority.conversationId !== conversationId) {
          throw Object.assign(new Error("Temporary commands require their original action authority."), { code: "conversation_forbidden", statusCode: 403 });
        }
        return actions.execute({ actionId, input: { ...input, sessionId, conversationId, projectSlug: authority.projectSlug },
          context: authority.requestContext });
      }
      return {
        sessionId, namespace: temporaryConversationNamespace(runtime, sessionId, conversationId),
        engine: record.assistantSelection.engineId,
        async read(context, query = { limit: 12 }) {
          const observed = requireSuccess(await service.readTemporaryConversation(sessionId, { conversationId }, context, query));
          const { conversationLog, pagination, messages: _messages, nativeBindings: _bindings,
            providerConversationId: _nativeId, ...presentation } = observed;
          const route = JSON.parse(observed.routingMetadata?.assistant_routing_request || "null");
          const pending = Object.values(JSON.parse(observed.routingMetadata?.assistant_changeover || "null")?.engines || {})
            .map(value => value.pending).find(value => value?.attempted);
          const request = route?.delivery === "uncertain" && route.input ? {
            messageId: route.messageId, text: route.input.displayMessage || route.input.message,
            attachments: route.input.displayAttachments || [], error: route.error || ""
          } : pending ? { messageId: pending.messageId, text: pending.displayMessage,
            attachments: pending.displayAttachments || [], error: pending.error || "" } : null;
          return { engine: observed.assistantSelection.engineId, threadId: observed.providerConversationId || "",
            configuration: observed.agentSettings, conversationLog, pagination, presentation,
            status: observed.readError ? "unavailable" : request ? "unconfirmed"
              : ["starting", "inProgress"].includes(observed.status) || observed.routingPending === true ? "working" : "ready",
            phase: ["starting", "inProgress"].includes(observed.status) ? "working"
              : observed.routingPending === true ? "preparing" : "",
            error: observed.error || "", pendingRequest: request };
        },
        readStream: () => runtime.store.readConversationStream(scope),
        transcript: {
          readConversationLog: () => runtime.store.readConversationLog(scope),
          readConversationLogPage: query => runtime.store.readConversationLogPage(scope, query)
        },
        commands: {
          send(input, context) {
            return execute(ACTION_START_TEMPORARY_CONVERSATION_TURN, {
              ...Object.fromEntries(messageFields.filter(key => Object.hasOwn(input.data || {}, key)).map(key => [key, input.data[key]])),
              messageId: input.messageId, message: input.text, submissionKind: input.steer === true ? "steer" : "send",
              ...(Object.hasOwn(input, "attachmentIds") ? { attachmentIds: input.attachmentIds } : {})
            }, context);
          },
          cancel: (_input, context) => execute(ACTION_STOP_TEMPORARY_CONVERSATION, {}, context),
          select(input, context) {
            if (!input || Object.keys(input).some(key => !["agentSettings", "assistantRouting"].includes(key))) {
              throw Object.assign(new TypeError("Choose this conversation's declared mode or model."), { code: "conversation_input_invalid", statusCode: 400 });
            }
            return execute(ACTION_UPDATE_TEMPORARY_CONVERSATION, input, context);
          },
          inspectDelivery: (input, context) => service.inspectTemporaryConversationDelivery(sessionId, { ...input, conversationId }, context)
        }
      };
    },

    async inspectTemporaryConversationDelivery(sessionId, input, options = {}) {
      const routed = await routing.inspectDelivery(sessionId, input, { ...options, conversationId: input.conversationId });
      if (routed?.delivered === false) return { status: "unknown", messageId: input.messageId };
      return write(sessionId, options, async ctx => {
        const context = await routingContext(ctx, input.conversationId);
        return conversationRuntime.inspectPersistentConversationDelivery({
          ...persistentConversationOptions(context), sessionId, input,
          delivered: routed?.delivered === true, operations: routingAgent
        });
      });
    },

    async createTemporaryConversation(sessionId, input = {}, options = {}) {
      return writeSnapshot(sessionId, options, async (ctx) => {
        const conversationId = input.conversationId || randomUUID();
        const existing = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
        if (existing) return snapshot(ctx, existing, true);
        const parentPreferences = assistantRoutingFromMetadata(ctx.session.metadata);
        const parentSelection = vibe64AssistantSelectionFromMetadata(ctx.session.metadata);
        const inheritedPreferences = parentPreferences
          ? { ...parentPreferences, mode: parentPreferences.mode === "auto" ? "senior" : parentPreferences.mode }
          : { mode: "senior", override: parentSelection };
        const requestedPreferences = input.presentation?.recoveryOperation === "update" ? { mode: "senior", review: false }
          : input.assistantRouting || inheritedPreferences;
        if (requestedPreferences.mode === "auto") throw new Error("Temporary chats use Senior or Junior. Auto is available in Main chat only.");
        const preferences = assistantRoutingPreferences({ ...requestedPreferences, review: false,
          workflowEngineId: parentPreferences?.workflowEngineId || parentSelection.engineId
        });
        const record = await ctx.runtime.store.writeSessionConversation(sessionId, conversationId, {
          ...presentation(input.presentation),
          ...(preferences ? { routingMetadata: { assistant_routing: JSON.stringify(preferences) } } : {}),
          agentSettings: input.agentSettings || {},
          assistantSelection: parentSelection,
          providerConversationId: "", nativeBindings: {},
          state: "open",
          status: "ready",
          attachments: []
        });
        return snapshot(ctx, record, true);
      });
    },

    async listTemporaryConversations(sessionId, options = {}) {
      let context;
      const result = await write(sessionId, options, async (ctx) => {
        context = ctx;
        const records = await ctx.runtime.store.listSessionConversations(sessionId);
        const conversations = [];
        for (const record of records) conversations.push(await snapshot(ctx, record, true));
        return { ok: true, conversations };
      });
      if (result?.ok === false) return result;
      // Provider availability is read-only and can be slow. Polling must not
      // hold the session write lock while looking up every chat's modes.
      return { ...result, conversations: await Promise.all(result.conversations.map(async (record) => ({
        ...record, purposes: await purposes(context, record)
      }))) };
    },

    async readTemporaryConversation(sessionId, input = {}, options = {}, transcriptQuery) {
      await routing.reconcile(sessionId, { ...options, conversationId: input.conversationId });
      const result = await writeSnapshot(sessionId, options, async (ctx) => snapshot(ctx, await recordFor(ctx, input.conversationId), true, transcriptQuery));
      if (result.ok === false || (!input.beforeMessageId && input.messageLimit === undefined)) return result;
      const messages = result.messages || [];
      const end = input.beforeMessageId ? messages.findIndex((message) => message.id === input.beforeMessageId) : messages.length;
      if (end < 0) throw Object.assign(new Error("This message cursor no longer exists. Read the latest messages again."), {
        code: "vibe64_conversation_cursor_missing", statusCode: 409
      });
      const start = Math.max(0, end - (input.messageLimit || 12));
      return { ...result, messages: messages.slice(start, end), earlierMessages: start > 0 };
    },

    async updateTemporaryConversation(sessionId, input = {}, options = {}) {
      return write(sessionId, options, async (ctx) => {
        const record = await recordFor(ctx, input.conversationId);
        if (record.state === "closing") throw new Error("This conversation is closing.");
        const fields = presentation(input.presentation);
        const settingsChanged = input.agentSettings && ["model", "thinking"].some((key) =>
          input.agentSettings[key] !== record.agentSettings?.[key]);
        if (input.assistantRouting || settingsChanged) {
          const current = await snapshot(ctx, record);
          if (current.readError) throw new Error("Reconnect this conversation before changing its mode or model.");
          if (current.goal && !["complete", "completed"].includes(current.goal.status)) throw new Error("Finish this goal before changing chat modes or models.");
          if (record.recoveryOperation === "update" && (["starting", "inProgress"].includes(current.status) || current.routingPending === true)) {
            throw new Error("Stop this repair before changing its model.");
          }
        }
        if (input.assistantRouting) {
          const requested = assistantRoutingPreferences(input.assistantRouting);
          if (requested.mode === "auto") throw new Error("Temporary chats use Senior or Junior. Auto is available in Main chat only.");
          const repair = record.recoveryOperation === "update";
          if (repair && !["senior", "custom"].includes(requested.mode)) throw new Error("Merge repairs always use Senior. You can choose a different model for Senior.");
          const selectingModel = requested.mode === "custom" || repair && requested.override;
          const override = selectingModel
            ? await sessionAgent.resolveSelection(requested.override, ctx) : requested.override;
          if (selectingModel) await sessionAgent.requireAssistantAccessForSelection(override, ctx);
          const preferences = assistantRoutingPreferences({ ...requested, mode: repair ? "senior" : requested.mode, override, review: false,
            workflowEngineId: selectingModel ? override.engineId
              : JSON.parse(record.routingMetadata?.assistant_routing || "null")?.workflowEngineId || record.assistantSelection.engineId });
          fields.routingMetadata = { ...record.routingMetadata, assistant_routing: JSON.stringify(preferences) };
        }
        if (settingsChanged && !input.assistantRouting) {
          const preferences = assistantRoutingFromMetadata(selectedContext(ctx, record).session.metadata);
          if (preferences.mode === "auto") throw new Error("Choose Senior or Junior before customizing its model.");
          const selection = record.assistantSelection;
          if (["senior", "junior"].includes(preferences.mode) && selection.engineId !== preferences.workflowEngineId) {
            throw new Error("Senior and Junior model overrides must use the workflow orchestrator. Configure its shared backup in Model routing.");
          }
          const override = await sessionAgent.resolveSelection({ engineId: selection.engineId, modelProviderId: selection.modelProviderId,
            agentId: selection.agentId, modelId: input.agentSettings.model || selection.modelId,
            variantId: input.agentSettings.thinking || "" }, ctx);
          fields.routingMetadata = { ...record.routingMetadata,
            assistant_routing: JSON.stringify(assistantRoutingPreferences({ ...preferences, override })) };
        }
        if (Object.hasOwn(input, "attachmentIds")) {
          const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, {
            message: "", attachmentIds: input.attachmentIds
          }, { durable: true, conversationId: record.conversationId });
          fields.attachments = prepared.displayAttachments;
        }
        const saved = await ctx.runtime.store.mutateSession(sessionId, async () => {
          const current = await recordFor(ctx, record.conversationId);
          const patch = { ...fields, ...(input.agentSettings ? { agentSettings: input.agentSettings } : {}) };
          if (fields.routingMetadata) {
            patch.routingMetadata = { ...current.routingMetadata,
              assistant_routing: fields.routingMetadata.assistant_routing };
          }
          return save(ctx, current, patch);
        });
        if (fields.recoveryOutcome === "succeeded") {
          await ctx.runtime.store.writeConversationSystemMessage({ sessionId, conversationId: record.conversationId }, {
            messageId: `recovery_${record.runId || record.conversationId}`,
            text: fields.recoveryOutcomeMessage || "Repair verified."
          });
        }
        return { ok: true, ...(fields.routingMetadata ? { routingMetadata: saved.routingMetadata, purposes: await purposes(ctx, saved) } : {}) };
      });
    },

    async startTemporaryConversationTurn(sessionId, input = {}, options = {}) {
      return routing.send(sessionId, input, {
        ...options, conversationId: input.conversationId, vibe64User: input.vibe64User || options.vibe64User
      });
    },

    async stopTemporaryConversation(sessionId, input = {}, options = {}) {
      await routing.cancel(sessionId, { ...options, conversationId: input.conversationId });
      return write(sessionId, options, async (ctx) => {
        const record = await recordFor(ctx, input.conversationId);
        const result = await conversationRuntime.stopPersistentConversation(persistentConversationOptions(ctx, record));
        return { ...result, routingMetadata: record.routingMetadata };
      });
    },

    async deleteTemporaryConversation(sessionId, input = {}, options = {}) {
      try { await routing.cancel(sessionId, { ...options, conversationId: input.conversationId }, { waitForCleanup: true }); }
      catch (error) { if (!["vibe64_conversation_closed", "vibe64_conversation_closing"].includes(error.code)) throw error; }
      let context;
      const result = await write(sessionId, options, async (ctx) => {
        context = ctx;
        const record = await ctx.runtime.store.readSessionConversation(sessionId, input.conversationId);
        if (!record) return { ok: true, deleted: true };
        if (JSON.parse(record.routingMetadata?.assistant_routing_request || "null")?.helper) {
          throw new Error("The routing helper could not be closed. Retry closing this conversation to finish cleanup.");
        }
        return conversationRuntime.deletePersistentConversation(persistentConversationOptions(ctx, record));
      });
      if (result.ok) {
        await publish(context, input.conversationId, { payload: { conversationStream: context.runtime.store.clearConversationStream({
          sessionId, conversationId: input.conversationId
        }) } });
        await publishSessionChanged(sessionId, {
          reason: "temporary-conversation-closed",
          payload: { conversationId: input.conversationId }
        });
      }
      return result;
    },

    async afterTemporaryTurn(sessionId, payload, options = {}) {
      const record = await write(sessionId, options, async (ctx) => {
        const conversations = await ctx.runtime.store.listSessionConversations(sessionId);
        const completed = conversations.find((item) => item.providerConversationId === payload.conversationId && item.state !== "closing");
        if (!completed) return null;
        // Persist the completed reply before review checks for unanswered questions.
        const observed = await snapshot(ctx, completed);
        if (observed.readError) throw new Error(observed.error);
        return completed;
      });
      if (record?.conversationId) await routing.afterTurn(sessionId, { payload: { agentRun: payload.temporaryRun } }, { ...options, conversationId: record.conversationId });
    }
  };
  return service;
}

export { createSessionConversations, temporaryConversationNamespace };
