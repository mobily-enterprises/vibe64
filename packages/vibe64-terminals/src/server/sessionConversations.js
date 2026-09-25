import { randomUUID } from "node:crypto";
import { normalizeVibe64AgentTaskResult, serializeVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { assistantRoutingPreferences, assistantRoutingFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { createAssistantRouting } from "./assistantRouting.js";
import { rememberAssistantBeforeChangeover, sendWithAssistantChangeover, sessionConversationKey } from "./assistantChangeover.js";

const textFields = [
  "title", "draft", "displayMessage", "completionMessage", "dedupeKey", "failureMessage", "nextStepMessage",
  "recoveryNotice", "recoveryOperation", "recoveryConflictId", "recoveryContext", "recoveryOutcome",
  "recoveryOutcomeMessage", "runConflictId"
];
const messageWriters = {
  assistant: "writeConversationAssistantMessage",
  commentary: "writeConversationCommentaryMessage",
  thinking: "writeConversationThinkingMessage",
  system: "writeConversationSystemMessage"
};

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
  attachments,
  runAgentWrite,
  prepareAgentSkills,
  systemRoot,
  prepareSelection = async () => {},
  publishSessionChanged = async () => {}
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

  function save(ctx, record, patch) {
    return ctx.runtime.store.writeSessionConversation(ctx.session.sessionId, record.conversationId, patch);
  }

  function selectedContext(ctx, record) {
    const selection = record.assistantSelection || vibe64AssistantSelectionFromMetadata(ctx.session.metadata);
    const metadata = { ...ctx.session.metadata };
    for (const key of ["assistant_routing", "assistant_routing_request", "assistant_routing_goal", "codex_routing_home_provider", "assistant_changeover"]) delete metadata[key];
    Object.assign(metadata, record.routingMetadata || {}, {
      assistant_selection: serializeVibe64AssistantSelection(selection),
      agent_identity_provider: record.providerConversationId ? selection.engineId : "",
      agent_identity_conversation_id: record.providerConversationId || "",
      agent_identity_model_provider: record.providerConversationId ? selection.modelProviderId : ""
    });
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
    return JSON.parse(JSON.stringify(decisions, (key, value) =>
      ["connectionIdentity", "routerConnectionIdentity"].includes(key) ? undefined : value));
  }

  async function snapshot(ctx, record, includeAccess = false) {
    ctx = selectedContext(ctx, record);
    const sessionId = ctx.session.sessionId;
    const scope = { sessionId, conversationId: record.conversationId };
    let response = {};
    let turns = await ctx.runtime.store.readConversationLog(scope);
    const requestTurn = turns.findLast((turn) => turn.user?.messageId === record.messageId);
    const assistantSelection = requestTurn?.metadata?.assistantSelection || ctx.assistantSelection;
    const messageScope = { ...scope, turnMetadata: { engineId: assistantSelection.engineId, assistantSelection,
      ...(requestTurn?.metadata?.assistantRouting ? { assistantRouting: requestTurn.metadata.assistantRouting } : {}) } };
    const savedIds = new Set(turns.flatMap((turn) => turn.messages.map((message) => message.messageId)));
    let appended = false;
    if (record.providerConversationId && record.state !== "closing") {
      try {
        response = requireSuccess(await sessionAgent.readConversation(sessionId, providerInput(record), ctx));
        for (const message of response.messages || []) {
          const operation = messageWriters[message.role];
          if (operation && message.text && message.complete !== false && !savedIds.has(message.id)) {
            const outcome = message.role === "assistant" ? normalizeVibe64AgentTaskResult(message.text) : null;
            await ctx.runtime.store[operation](messageScope, { ...message, text: outcome?.message || message.text, messageId: message.id });
            appended = true;
          }
        }
        const patch = {
          status: response.status || record.status,
          runId: response.runId || record.runId,
          error: response.error || ""
        };
        if (record.status === "starting" && response.admitted) Object.assign(patch, { draft: "", attachments: [] });
        if (Object.entries(patch).some(([key, value]) => record[key] !== value)) record = await save(ctx, record, patch);
      } catch (error) {
        // A failed read cannot establish that work stopped. Keep Stop available.
        response = { error: error.message, readError: true };
      }
    }
    if (appended) turns = await ctx.runtime.store.readConversationLog(scope);
    const messages = turns.flatMap((turn) => turn.messages.map((message) => ({
      ...message,
      id: message.messageId || `${turn.turnId}:${message.role}:${message.at}`,
      ...(message.role === "user" ? { attachments: turn.user?.attachments || [] } : {}),
      status: "completed",
      assistantSelection: turn.metadata?.assistantSelection, assistantRouting: turn.metadata?.assistantRouting
    })));
    for (const message of response.messages || []) {
      if (message.complete === false && !messages.some((saved) => saved.id === message.id)) {
        const outcome = message.role === "assistant" ? normalizeVibe64AgentTaskResult(message.text) : null;
        if (message.role === "assistant" && record.recoveryOperation === "update" && !outcome) continue;
        messages.push({ ...message, text: outcome?.message || message.text, status: response.status,
          assistantSelection: record.assistantSelection, assistantRouting: JSON.parse(record.routingMetadata?.assistant_routing_request || "null") });
      }
    }
    const outcome = response.outcome || normalizeVibe64AgentTaskResult(response.text);
    const route = JSON.parse(record.routingMetadata?.assistant_routing_request || "null");
    if (route && ["sent", "reviewing"].includes(route.status) && response.runId &&
        !["starting", "inProgress", "ready"].includes(response.status)) {
      // Schedule after releasing the existing write lock. Native idle events
      // normally do this; a read also recovers a missed completion notification.
      void routing.afterTurn(sessionId, { payload: { agentRun: { state: response.status,
        providerTurnId: response.runId, active: false } } }, { ...ctx, conversationId: record.conversationId }, { recovered: true }).catch(() => {});
    }
    return {
      ...record,
      ...response,
      outcome,
      ...(includeAccess ? {
        canSteer: ["starting", "inProgress"].includes(response.status)
          ? (await sessionAgent.assistantAccess(sessionId, ctx)).canUse : null } : {}),
      conversationId: record.conversationId,
      messages,
      ok: true,
      ...(route && assistantRoutingStatusIsPending(route.status)
        ? { status: route.status } : {}),
      ...(record.state === "closing" ? {
        status: "closing",
        error: record.error || "Close did not finish. Try Close again."
      } : {})
    };
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
      writeMetadataValue: async (_id, key, value) => {
        const current = await recordFor(ctx, conversationId);
        if (current.state === "closing") throw new Error("This conversation is closing.");
        const routingMetadata = { ...current.routingMetadata, [key]: value };
        const patch = { routingMetadata };
        if (key === "codex_routing_home_provider") {
          const legacyKey = `codex/${value}`;
          const legacy = current.nativeBindings?.[legacyKey];
          if (legacy) {
            const nativeBindings = { ...current.nativeBindings };
            if (nativeBindings.codex && nativeBindings.codex.conversationId !== legacy.conversationId) {
              throw new Error("This Codex conversation already has another retained native history.");
            }
            nativeBindings.codex = legacy;
            delete nativeBindings[legacyKey];
            patch.nativeBindings = nativeBindings;
          }
        }
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
      }
    };
    scopedStore.readConversationTail = async () => (await store.readConversationLog(scope)).slice(-12);
    for (const name of ["readConversationLog", "conversationMessageIdExists", "writeConversationUserMessage"]) {
      scopedStore[name] = (_id, ...args) => store[name](scope, ...args);
    }
    return { ...selected, routingConversationId: conversationId, conversationContext: ctx,
      runtime: { ...ctx.runtime, store: scopedStore }, session: { ...ctx.session, metadata } };
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
      const record = await recordFor(ctx.conversationContext, ctx.routingConversationId);
      if (input.threadId && input.threadId !== record.providerConversationId) return { admission: "unknown", turnId: "" };
      const state = await nativeState(id, ctx, input.messageId);
      return { admission: state.admitted ? "accepted" : "unknown", turnId: state.runId };
    }
  };
  const routing = createAssistantRouting({ systemRoot, agent: routingAgent, publish: publishSessionChanged,
    exclusive: async (id, options, operation) => {
      const result = await write(id, options, async (ctx) => operation(await routingContext(ctx, options.conversationId)));
      if (result?.code === "vibe64_agent_write_mode_busy") throw Object.assign(new Error(result.error), result);
      return result;
    },
    prepareSelection: async (id, selection, ctx) => {
      let record = await recordFor(ctx.conversationContext, ctx.routingConversationId);
      if (record.assistantSelection.engineId !== selection.engineId) {
        const observed = await snapshot(nativeContext(ctx), record);
        if (observed.readError) throw new Error(observed.error);
        if (["starting", "inProgress"].includes((await nativeState(id, ctx)).status)) throw new Error("Stop this temporary conversation before changing its AI.");
        record = await recordFor(ctx.conversationContext, ctx.routingConversationId);
        if (record.providerConversationId) {
          requireSuccess(await sessionAgent.stopConversation(id, providerInput(record, { runId: record.runId }), nativeContext(ctx)));
          record = await save(ctx, record, { nativeBindings: { ...record.nativeBindings, [bindingKey(ctx, record)]: nativeBinding(record) } });
        }
        await rememberAssistantBeforeChangeover(ctx, sessionConversationKey(ctx.session));
      }
      let preparation = ctx;
      if (selection.engineId === "codex" && !ctx.session.metadata.codex_routing_home_provider && record.assistantSelection.engineId !== "codex") {
        const retained = Object.values(record.nativeBindings || {}).find((binding) => binding.assistantSelection.engineId === "codex");
        if (retained) preparation = { ...ctx, session: { ...ctx.session, metadata: { ...ctx.session.metadata,
          agent_identity_provider: "codex", agent_identity_conversation_id: retained.conversationId,
          agent_identity_model_provider: retained.assistantSelection.modelProviderId } } };
      }
      await prepareSelection(id, selection, preparation);
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
    let record = await recordFor(ctx, input.conversationId);
    if (record.state === "closing") throw new Error("This conversation is closing.");
    const previous = await snapshot(ctx, { ...record, messageId: input.messageId });
    if (previous.readError) throw new Error(previous.error);
    if (previous.admitted) return { ...previous, delivered: true, turnId: previous.runId };
    const steering = ["starting", "inProgress"].includes(previous.status);
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
    if (!record.providerConversationId) {
      const created = requireSuccess(await sessionAgent.createConversation(sessionId, {
        agentSettings: input.agentSettings || record.agentSettings, persistent: true, vibe64User: input.vibe64User
      }, ctx));
      record = await save(ctx, record, { providerConversationId: created.conversationId,
        nativeBindings: { ...record.nativeBindings, [bindingKey(ctx, { ...record, assistantSelection })]:
          nativeBinding({ ...record, providerConversationId: created.conversationId, assistantSelection, agentSettings: settings }) } });
    }
    const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, input, {
      durable: true, conversationId: record.conversationId
    });
    const receipt = { messageId: input.messageId, text: input.displayMessage || input.message,
      attachments: prepared.displayAttachments, turnMetadata: { ...input.turnMetadata, assistantSelection } };
    const writeReceipt = () => ctx.runtime.store.writeConversationUserMessage({ sessionId, conversationId: record.conversationId }, receipt);
    if (!input.turnMetadata?.assistantRouting) await writeReceipt();
    record = await save(ctx, record, {
      ...presentation(input.presentation),
      agentSettings: settings,
      assistantSelection,
      messageId: input.messageId,
      status: steering ? previous.status : "starting",
      runId: steering ? previous.runId : "",
      error: ""
    });
    try {
      const result = requireSuccess(await sessionAgent.startConversationTurn(sessionId,
        providerInput(record, { ...input, ...prepared, steer: steering }), { ...ctx, attachmentsPrepared: true }));
      if (input.turnMetadata?.assistantRouting) await writeReceipt();
      await save(ctx, record, { runId: result.runId, status: result.status || "inProgress", draft: "", attachments: [],
        nativeBindings: { ...record.nativeBindings, [bindingKey(ctx, record)]: nativeBinding({ ...record, runId: result.runId }) } });
      return { ...result, delivered: true, turnId: result.runId, conversationId: record.conversationId };
    } catch (error) {
      const observed = await snapshot(ctx, record);
      if (observed.admitted) {
        if (input.turnMetadata?.assistantRouting) await writeReceipt();
        return { ...observed, delivered: true, turnId: observed.runId };
      }
      if (observed.readError && !input.turnMetadata?.assistantRouting) return { ...observed, error: error.message };
      await save(ctx, record, { error: error.message, status: "failed" });
      throw error;
    }
  }

  return {
    async createTemporaryConversation(sessionId, input = {}, options = {}) {
      return writeSnapshot(sessionId, options, async (ctx) => {
        const conversationId = input.conversationId || randomUUID();
        const existing = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
        if (existing) return snapshot(ctx, existing, true);
        const parentPreferences = assistantRoutingFromMetadata(ctx.session.metadata);
        const requestedPreferences = input.presentation?.recoveryOperation ? { mode: "code", review: false }
          : input.assistantRouting || { mode: "plan", review: false };
        const preferences = assistantRoutingPreferences({ ...requestedPreferences,
          workflowEngineId: parentPreferences?.workflowEngineId || vibe64AssistantSelectionFromMetadata(ctx.session.metadata).engineId
        });
        const record = await ctx.runtime.store.writeSessionConversation(sessionId, conversationId, {
          ...presentation(input.presentation),
          ...(preferences ? { routingMetadata: { assistant_routing: JSON.stringify(preferences) } } : {}),
          agentSettings: input.agentSettings || {},
          assistantSelection: vibe64AssistantSelectionFromMetadata(ctx.session.metadata),
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

    async readTemporaryConversation(sessionId, input = {}, options = {}) {
      await routing.reconcile(sessionId, { ...options, conversationId: input.conversationId });
      return writeSnapshot(sessionId, options, async (ctx) => snapshot(ctx, await recordFor(ctx, input.conversationId), true));
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
        }
        if (input.assistantRouting) {
          if (record.recoveryOperation) throw new Error("Repair conversations keep their dedicated instructions and model settings.");
          const preferences = assistantRoutingPreferences({ ...input.assistantRouting,
            workflowEngineId: JSON.parse(record.routingMetadata?.assistant_routing || "null")?.workflowEngineId || record.assistantSelection.engineId });
          fields.routingMetadata = { ...record.routingMetadata, assistant_routing: JSON.stringify(preferences) };
        }
        if (settingsChanged && !input.assistantRouting) {
          const preferences = assistantRoutingFromMetadata(record.routingMetadata);
          if (preferences.mode === "auto") throw new Error("Choose Plan, Code or Economy before customizing its model.");
          const selection = record.assistantSelection;
          if (["plan", "code"].includes(preferences.mode) && selection.engineId !== preferences.workflowEngineId) {
            throw new Error("Plan and Code model overrides must use the workflow orchestrator. Configure its shared backup in Model routing.");
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
        const saved = await save(ctx, record, { ...fields, ...(input.agentSettings ? { agentSettings: input.agentSettings } : {}) });
        if (fields.recoveryOutcome === "succeeded") {
          await ctx.runtime.store.writeConversationSystemMessage({ sessionId, conversationId: record.conversationId }, {
            messageId: `recovery_${record.runId || record.conversationId}`,
            text: fields.recoveryOutcomeMessage || "Repair verified."
          });
        }
        return { ok: true, ...(fields.routingMetadata ? { routingMetadata: fields.routingMetadata, purposes: await purposes(ctx, saved) } : {}) };
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
        if (record.providerConversationId) requireSuccess(await sessionAgent.stopConversation(sessionId,
          providerInput(record, { runId: record.runId }), selectedContext(ctx, record)));
        await save(ctx, record, { status: "interrupted", error: "" });
        return { ok: true, status: "interrupted", conversationId: record.conversationId, routingMetadata: record.routingMetadata };
      });
    },

    async deleteTemporaryConversation(sessionId, input = {}, options = {}) {
      try { await routing.cancel(sessionId, { ...options, conversationId: input.conversationId }, { waitForCleanup: true }); }
      catch (error) { if (!["vibe64_conversation_closed", "vibe64_conversation_closing"].includes(error.code)) throw error; }
      const result = await write(sessionId, options, async (ctx) => {
        let record = await ctx.runtime.store.readSessionConversation(sessionId, input.conversationId);
        if (!record) return { ok: true, deleted: true };
        if (JSON.parse(record.routingMetadata?.assistant_routing_request || "null")?.helper) {
          throw new Error("The routing helper could not be closed. Retry closing this conversation to finish cleanup.");
        }
        record = await save(ctx, record, { state: "closing", error: "" });
        ctx = selectedContext(ctx, record);
        try {
          for (const [key, binding] of Object.entries(record.nativeBindings || {})) {
            const retained = { ...record, assistantSelection: binding.assistantSelection, providerConversationId: binding.conversationId,
              agentSettings: binding.agentSettings || {}, runId: binding.runId || "", messageId: binding.messageId || "" };
            const selected = selectedContext(ctx, retained);
            requireSuccess(await sessionAgent.stopConversation(sessionId, providerInput(retained, { runId: retained.runId }), selected));
            requireSuccess(await sessionAgent.deleteConversation(sessionId, providerInput(retained), selected));
            const nativeBindings = { ...record.nativeBindings };
            delete nativeBindings[key];
            record = await save(ctx, record, { nativeBindings,
              ...(record.providerConversationId === binding.conversationId ? { providerConversationId: "" } : {}) });
          }
          if (record.providerConversationId) throw new Error("This conversation's native history has not been upgraded for cleanup. Run the state upgrade before closing it.");
          await attachments.deleteConversationAttachments({ ...ctx, sessionId }, {
            conversationId: record.conversationId
          });
          await ctx.runtime.store.deleteSessionConversation(sessionId, record.conversationId);
          return { ok: true, deleted: true, conversationId: record.conversationId };
        } catch (error) {
          await save(ctx, record, { error: error.message });
          throw error;
        }
      });
      if (result.ok) {
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
}

export { createSessionConversations };
