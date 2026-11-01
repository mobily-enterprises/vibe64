import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { serializeVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingPreferences,
  assistantRoutingFromMetadata
} from "@local/vibe64-runtime/shared/assistantRouting";
import { sessionConversationKey } from "./assistantChangeover.js";
import { isNativeConversationBindingKey } from "./nativeConversationRetirement.js";
import { temporaryConversationNamespace } from "./temporaryConversationRules.js";

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManager.js").createSessionAgentManager>} SessionAgentManager */

/**
 * A temporary chat's saved record: reading and saving it under the session mutation, its change
 * events, the context its assistant sees, its native bindings and the modes it offers.
 * @param {object} dependencies
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {(event: object) => unknown} dependencies.publishConversation
 */
function createTemporaryConversationRecords({ sessionAgent, publishConversation }) {
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

  async function save(ctx, record, changes, { lifecycle = false, requireOpen = false } = {}) {
    let patch;
    const saved = await ctx.runtime.store.mutateSession(ctx.session.sessionId, async () => {
      const current = await recordFor(ctx, record.conversationId);
      if (requireOpen && current.state === "closing") throw Object.assign(new Error("This conversation is closing."), {
        code: "vibe64_conversation_closing", statusCode: 409
      });
      patch = typeof changes === "function" ? changes(current) : changes;
      const next = { ...patch };
      const newTurn = lifecycle && next.messageId && next.messageId !== record.messageId;
      if (newTurn) {
        next.submittedDraftRevision = record.draftRevision || randomUUID();
        if (!current.draftRevision && !record.draftRevision) next.draftRevision = next.submittedDraftRevision;
      }
      if (lifecycle && (Object.hasOwn(next, "draft") || Object.hasOwn(next, "attachments"))) {
        const submittedRevision = newTurn ? record.draftRevision || "" : current.submittedDraftRevision || "";
        if (newTurn ? (current.draftRevision || "") !== submittedRevision
          : !submittedRevision || (current.draftRevision || "") !== submittedRevision) {
          delete next.draft;
          delete next.attachments;
        }
      }
      return ctx.runtime.store.writeSessionConversation(ctx.session.sessionId, record.conversationId, next);
    });
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
      if (isNativeConversationBindingKey(key)) delete metadata[key];
    }
    Object.assign(metadata, record.routingMetadata || {}, {
      assistant_selection: serializeVibe64AssistantSelection(selection),
      agent_identity_provider: record.providerConversationId ? selection.engineId : "",
      agent_identity_conversation_id: record.providerConversationId || "",
      agent_identity_model_provider: record.providerConversationId ? selection.modelProviderId : ""
    });
    if (record.recoveryOperation === "update" && assistantRoutingFromMetadata(metadata)?.mode !== "custom") {
      // Enforce repair policy for future turns without rewriting saved requests or history.
      metadata.assistant_routing = JSON.stringify(assistantRoutingPreferences({ mode: "fix" }));
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
    const decisions = await sessionAgent.inspectAssistantPurposes({ ...preferences, temporaryChat: true }, selected);
    const autoUnavailable = { available: false, message: "Auto is available in Main chat only. Choose Senior or Junior." };
    return JSON.parse(JSON.stringify({ ...decisions, auto: autoUnavailable, review: autoUnavailable }, (key, value) =>
      ["connectionIdentity", "routerConnectionIdentity"].includes(key) ? undefined : value));
  }

  return Object.freeze({
    recordFor,
    providerInput,
    save,
    publish,
    selectedContext,
    nativeBinding,
    bindingKey,
    purposes
  });
}

export {
  createTemporaryConversationRecords
};
