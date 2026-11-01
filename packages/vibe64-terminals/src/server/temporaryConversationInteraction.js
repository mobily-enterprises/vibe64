import { randomUUID } from "node:crypto";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import {
  ACTION_START_TEMPORARY_CONVERSATION_TURN,
  ACTION_STOP_TEMPORARY_CONVERSATION,
  ACTION_UPDATE_TEMPORARY_CONVERSATION
} from "./terminalActions.js";
import {
  temporaryConversationTurnActionInputValidator,
  temporaryConversationUpdateInputValidator
} from "./inputSchemas.js";
import {
  assistantRoutingPreferences,
  assistantRoutingFromMetadata,
  isAssistantRoutingOwner
} from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantCancelledMessageIds } from "./assistantRouting.js";
import {
  messageFields,
  temporaryConversationNamespace,
  requireSuccess,
  routingRequest,
  attemptedChangeover,
  presentation,
  teamTemporaryModesRefusal
} from "./temporaryConversationRules.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").SessionAttachments} SessionAttachments */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").TemporaryConversationRecords} TemporaryConversationRecords */
/** @typedef {import("./types.js").TemporaryConversationTurns} TemporaryConversationTurns */
/** @typedef {ReturnType<typeof import("./temporaryConversationLifecycle.js").createTemporaryConversationLifecycle>} TemporaryConversationLifecycle */

/**
 * What a person does in a temporary chat: its browser binding and the commands it carries, sending
 * and cancelling messages, checking a delivery, and changing its name, draft, mode or model.
 * @param {object} dependencies
 * @param {TemporaryConversationRecords} dependencies.chatRecords
 * @param {TemporaryConversationTurns} dependencies.chatTurns
 * @param {TemporaryConversationLifecycle} dependencies.chatLifecycle
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {ActionCatalogue | null} dependencies.actions
 * @param {SessionAttachments} dependencies.attachments
 * @param {(sessionId: string, options?: object) => Promise<object>} dependencies.readSessionContext
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {AssistantRouting} dependencies.routing
 */
function createTemporaryConversationInteraction({
  chatRecords,
  chatTurns,
  chatLifecycle,
  sessionAgent,
  conversationRuntime,
  actions,
  attachments,
  readSessionContext,
  publishSessionChanged,
  routing
}) {
  const temporaryConversationDataSchema = createSchema(Object.fromEntries(messageFields.map(key =>
    [key, temporaryConversationTurnActionInputValidator.schema.getFieldDefinitions()[key]])));
  const temporaryConversationSelectionSchema = createSchema(Object.fromEntries(["agentSettings", "assistantRouting"].map(key =>
    [key, temporaryConversationUpdateInputValidator.schema.getFieldDefinitions()[key]])));

  async function conversationBinding(sessionId, openingContext) {
    const conversationId = openingContext.temporaryConversationId;
    const record = await chatRecords.recordFor(openingContext, conversationId);
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
        const observed = requireSuccess(await chatLifecycle.readTemporaryConversation(sessionId, { conversationId }, context, query));
        const { conversationLog, pagination, messages: _messages, nativeBindings: _bindings,
          providerConversationId: _nativeId, ...shown } = observed;
        const route = routingRequest(observed);
        // A stopped or cancelled request, including its retained changeover
        // attempt, is not offered for recovery, as in Main.
        const attempted = attemptedChangeover(observed);
        const pending = route?.stopped && attempted?.messageId === route.messageId ||
          assistantCancelledMessageIds(observed.routingMetadata).includes(attempted?.messageId) ? null : attempted;
        const request = route?.delivery === "uncertain" && !route.stopped && route.input ? {
          messageId: route.messageId, text: route.input.displayMessage || route.input.message,
          attachments: route.input.displayAttachments || [], error: route.error || ""
        } : pending ? { messageId: pending.messageId, text: pending.displayMessage,
          attachments: pending.displayAttachments || [], error: pending.error || "" } : null;
        return { engine: observed.assistantSelection.engineId, threadId: observed.providerConversationId || "",
          configuration: observed.agentSettings, conversationLog, pagination, presentation: shown,
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
            messageId: input.messageId, message: input.text, ...(input.steer === true ? { submissionKind: "steer" } : {}),
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
        inspectDelivery: (input, context) => inspectTemporaryConversationDelivery(sessionId, { ...input, conversationId }, context)
      }
    };
  }

  async function inspectTemporaryConversationDelivery(sessionId, input, options = {}) {
    // A cancelled message has no other receipt.
    if (await routing.isCancelled(sessionId, input.messageId, { ...options, conversationId: input.conversationId })) {
      return { status: "cancelled", messageId: input.messageId };
    }
    const routed = await routing.inspectDelivery(sessionId, input, { ...options, conversationId: input.conversationId });
    if (routed?.delivered === false) return { status: "unknown", messageId: input.messageId };
    return chatTurns.write(sessionId, options, async ctx => {
      const context = await chatTurns.routingContext(ctx, input.conversationId);
      // A changeover that attempted the same prompt settles it separately.
      if (routed?.status === "not-sent" && attemptedChangeover(await chatRecords.recordFor(ctx, input.conversationId))?.messageId !== input.messageId) return routed;
      return conversationRuntime.inspectPersistentConversationDelivery({
        ...chatTurns.persistentConversationOptions(context), sessionId, input,
        delivered: routed?.delivered === true, operations: chatTurns.routingAgent
      });
    });
  }

  async function updateTemporaryConversation(sessionId, input = {}, options = {}) {
    // Drafts and names save while the assistant works, without its write lock.
    const presentationOnly = input.presentation && Object.keys(input.presentation).length === 1 &&
      ["draft", "title"].includes(Object.keys(input.presentation)[0]) &&
      Object.keys(input).every(key => ["sessionId", "conversationId", "vibe64User", "presentation"].includes(key));
    if (presentationOnly) {
      const ctx = await readSessionContext(sessionId, options);
      const fields = presentation(input.presentation);
      if (!Object.hasOwn(fields, "title")) {
        await chatRecords.save(ctx, { conversationId: input.conversationId }, { ...fields, draftRevision: randomUUID() }, { requireOpen: true });
        return { ok: true };
      }
      await chatRecords.save(ctx, { conversationId: input.conversationId }, fields, { requireOpen: true });
      await publishSessionChanged(sessionId, {
        reason: "temporary-conversation-renamed",
        payload: { conversationId: input.conversationId }
      });
      return { ok: true, title: fields.title };
    }
    const update = async (ctx) => {
      const record = await chatRecords.recordFor(ctx, input.conversationId);
      if (record.state === "closing") throw new Error("This conversation is closing.");
      const fields = presentation(input.presentation);
      const settingsChanged = input.agentSettings && ["model", "thinking"].some((key) =>
        input.agentSettings[key] !== record.agentSettings?.[key]);
      if (input.assistantRouting) {
        const requested = assistantRoutingPreferences(input.assistantRouting);
        if (requested.mode === "auto") throw new Error("Temporary chats use Senior or Junior. Auto is available in Main chat only.");
        if (record.recoveryOperation === "update" && !["fix", "custom"].includes(requested.mode)) {
          throw new Error("Repair chats use Fix it with AI. Choose Custom to pick a different model.");
        }
        if (!isAssistantRoutingOwner(input.vibe64User || options.vibe64User) && ["senior", "junior"].includes(requested.mode)) throw teamTemporaryModesRefusal();
        const selectingModel = requested.mode === "custom";
        const override = selectingModel
          ? await sessionAgent.resolveSelection(requested.override, ctx) : requested.override;
        if (selectingModel) await sessionAgent.requireAssistantAccessForSelection(override, ctx);
        const preferences = assistantRoutingPreferences({ ...requested, override, review: false, autoSave: false });
        fields.routingMetadata = { ...record.routingMetadata, assistant_routing: JSON.stringify(preferences) };
      }
      if (settingsChanged && !input.assistantRouting) {
        const preferences = assistantRoutingFromMetadata(chatRecords.selectedContext(ctx, record).session.metadata);
        if (preferences.mode === "auto") throw new Error("Choose Senior or Junior before customizing its model.");
        if (preferences.mode === "fix") throw new Error("Fix it with AI uses the model chosen in Models. Choose Custom to pick another model.");
        const selection = record.assistantSelection;
        const override = await sessionAgent.resolveSelection({ engineId: selection.engineId, modelProviderId: selection.modelProviderId,
          agentId: selection.agentId, modelId: input.agentSettings.model || selection.modelId,
          variantId: input.agentSettings.thinking || "" }, ctx);
        fields.routingMetadata = { ...record.routingMetadata,
          assistant_routing: JSON.stringify(assistantRoutingPreferences({ ...preferences, override })) };
      }
      if (fields.routingMetadata) {
        const preferences = assistantRoutingFromMetadata(fields.routingMetadata);
        await routing.applyGoalSelection(sessionId, null, preferences,
          await chatTurns.routingContext(ctx, record.conversationId));
      }
      if (Object.hasOwn(input, "attachmentIds")) {
        const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, {
          message: "", attachmentIds: input.attachmentIds
        }, { durable: true, conversationId: record.conversationId });
        fields.attachments = prepared.displayAttachments;
      }
      const saved = await chatRecords.saveWith(ctx, record, current => {
        const patch = { ...fields, ...(input.agentSettings ? { agentSettings: input.agentSettings } : {}) };
        if (fields.routingMetadata) {
          patch.routingMetadata = { ...current.routingMetadata,
            assistant_routing: fields.routingMetadata.assistant_routing };
        }
        if (Object.hasOwn(patch, "draft") || Object.hasOwn(patch, "attachments")) patch.draftRevision = randomUUID();
        return patch;
      }, { requireOpen: true });
      if (fields.recoveryOutcome === "succeeded") {
        await ctx.runtime.store.writeConversationSystemMessage({ sessionId, conversationId: record.conversationId }, {
          messageId: `recovery_${record.runId || record.conversationId}`,
          text: fields.recoveryOutcomeMessage || "Repair verified."
        });
      }
      return { ok: true, ...(fields.routingMetadata ? { routingMetadata: saved.routingMetadata, purposes: await chatRecords.purposes(ctx, saved) } : {}) };
    };
    const settingsOnly = (input.assistantRouting || input.agentSettings) && Object.keys(input).every(key =>
      ["sessionId", "conversationId", "vibe64User", "assistantRouting", "agentSettings"].includes(key));
    if (!settingsOnly) return chatTurns.write(sessionId, options, update);
    const context = await readSessionContext(sessionId, options);
    const result = await context.runtime.store.runSessionExclusive(sessionId,
      `assistant-settings-${input.conversationId}`, () => update(context),
      { operation: "temporary-assistant-settings", waitMs: 10_000 });
    if (!result.acquired) throw new Error("Another settings change is being saved. Try again in a moment.");
    return result.value;
  }

  async function startTemporaryConversationTurn(sessionId, input = {}, options = {}) {
    return routing.send(sessionId, input, {
      ...options, conversationId: input.conversationId, vibe64User: input.vibe64User || options.vibe64User
    });
  }

  // Cancel of one unsent or unconfirmed message in this chat; it always succeeds.
  function cancelTemporaryConversationMessage(sessionId, input = {}, options = {}) {
    return routing.cancelMessage(sessionId, { messageId: input.messageId }, { ...options, conversationId: input.conversationId });
  }

  function cancelTemporaryConversationRouting(sessionId, input = {}, options = {}) {
    return routing.cancel(sessionId, { ...options, conversationId: input.conversationId, routingCleanup: true }, {
      waitForCleanup: true, expectedMessageId: input.messageId
    });
  }

  return Object.freeze({
    temporaryConversationDataSchema,
    temporaryConversationSelectionSchema,
    conversationBinding,
    inspectTemporaryConversationDelivery,
    updateTemporaryConversation,
    startTemporaryConversationTurn,
    cancelTemporaryConversationMessage,
    cancelTemporaryConversationRouting
  });
}

export {
  createTemporaryConversationInteraction
};
