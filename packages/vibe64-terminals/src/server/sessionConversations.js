import { randomUUID } from "node:crypto";
import { normalizeVibe64AgentTaskResult } from "@local/vibe64-runtime/shared";

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

  async function snapshot(ctx, record) {
    const sessionId = ctx.session.sessionId;
    const scope = { sessionId, conversationId: record.conversationId };
    let response = {};
    let turns = await ctx.runtime.store.readConversationLog(scope);
    const savedIds = new Set(turns.flatMap((turn) => turn.messages.map((message) => message.messageId)));
    let appended = false;
    if (record.providerConversationId && record.state !== "closing") {
      try {
        response = requireSuccess(await sessionAgent.readConversation(sessionId, providerInput(record), ctx));
        for (const message of response.messages || []) {
          const operation = messageWriters[message.role];
          if (operation && message.text && message.complete !== false && !savedIds.has(message.id)) {
            const outcome = message.role === "assistant" ? normalizeVibe64AgentTaskResult(message.text) : null;
            await ctx.runtime.store[operation](scope, { ...message, text: outcome?.message || message.text, messageId: message.id });
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
      status: "completed"
    })));
    for (const message of response.messages || []) {
      if (message.complete === false && !messages.some((saved) => saved.id === message.id)) {
        const outcome = message.role === "assistant" ? normalizeVibe64AgentTaskResult(message.text) : null;
        if (message.role === "assistant" && record.recoveryOperation === "update" && !outcome) continue;
        messages.push({ ...message, text: outcome?.message || message.text, status: response.status });
      }
    }
    const outcome = response.outcome || normalizeVibe64AgentTaskResult(response.text);
    return {
      ...record,
      ...response,
      outcome,
      conversationId: record.conversationId,
      messages,
      ok: true,
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

  return {
    async createTemporaryConversation(sessionId, input = {}, options = {}) {
      return write(sessionId, options, async (ctx) => {
        await sessionAgent.requireAssistantAccess(sessionId, { ...ctx, vibe64User: input.vibe64User });
        const conversationId = input.conversationId || randomUUID();
        const existing = await ctx.runtime.store.readSessionConversation(sessionId, conversationId);
        if (existing) return snapshot(ctx, existing);
        const record = await ctx.runtime.store.writeSessionConversation(sessionId, conversationId, {
          ...presentation(input.presentation),
          agentSettings: input.agentSettings || {},
          providerConversationId: "",
          state: "open",
          status: "ready",
          attachments: []
        });
        return snapshot(ctx, record);
      });
    },

    async listTemporaryConversations(sessionId, options = {}) {
      return write(sessionId, options, async (ctx) => {
        const records = await ctx.runtime.store.listSessionConversations(sessionId);
        const conversations = [];
        for (const record of records) conversations.push(await snapshot(ctx, record));
        return { ok: true, conversations };
      });
    },

    async readTemporaryConversation(sessionId, input = {}, options = {}) {
      return write(sessionId, options, async (ctx) => snapshot(ctx, await recordFor(ctx, input.conversationId)));
    },

    async updateTemporaryConversation(sessionId, input = {}, options = {}) {
      return write(sessionId, options, async (ctx) => {
        const record = await recordFor(ctx, input.conversationId);
        if (record.state === "closing") throw new Error("This conversation is closing.");
        const fields = presentation(input.presentation);
        if (Object.hasOwn(input, "attachmentIds")) {
          const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, {
            message: "", attachmentIds: input.attachmentIds
          }, { durable: true, conversationId: record.conversationId });
          fields.attachments = prepared.displayAttachments;
        }
        await save(ctx, record, { ...fields, ...(input.agentSettings ? { agentSettings: input.agentSettings } : {}) });
        if (fields.recoveryOutcome === "succeeded") {
          await ctx.runtime.store.writeConversationSystemMessage({ sessionId, conversationId: record.conversationId }, {
            messageId: `recovery_${record.runId || record.conversationId}`,
            text: fields.recoveryOutcomeMessage || "Repair verified."
          });
        }
        return { ok: true };
      });
    },

    async startTemporaryConversationTurn(sessionId, input = {}, options = {}) {
      return write(sessionId, options, async (ctx) => {
        let record = await recordFor(ctx, input.conversationId);
        if (record.state === "closing") throw new Error("This conversation is closing.");
        await prepareAgentSkills(sessionId, { ...ctx, vibe64User: input.vibe64User });
        if (!record.providerConversationId) {
          const created = requireSuccess(await sessionAgent.createConversation(sessionId, {
            agentSettings: input.agentSettings || record.agentSettings, persistent: true, vibe64User: input.vibe64User
          }, ctx));
          record = await save(ctx, record, { providerConversationId: created.conversationId });
        }
        const previous = await snapshot(ctx, { ...record, messageId: input.messageId });
        if (previous.readError) throw new Error(previous.error);
        if (previous.admitted) return previous;
        if (["starting", "inProgress"].includes(previous.status)) throw new Error("This conversation is still working.");
        const prepared = await attachments.prepareMessage({ ...ctx, sessionId }, input, {
          durable: true, conversationId: record.conversationId
        });
        await ctx.runtime.store.writeConversationUserMessage({ sessionId, conversationId: record.conversationId }, {
          messageId: input.messageId, text: input.displayMessage || input.message, attachments: prepared.displayAttachments
        });
        record = await save(ctx, record, {
          ...presentation(input.presentation),
          agentSettings: input.agentSettings || record.agentSettings,
          messageId: input.messageId,
          status: "starting",
          runId: "",
          error: ""
        });
        try {
          const result = requireSuccess(await sessionAgent.startConversationTurn(sessionId,
            providerInput(record, prepared), { ...ctx, attachmentsPrepared: true }));
          await save(ctx, record, { runId: result.runId, status: result.status || "inProgress", draft: "", attachments: [] });
          return { ...result, conversationId: record.conversationId };
        } catch (error) {
          const observed = await snapshot(ctx, record);
          if (observed.admitted || observed.readError) return { ...observed, error: error.message };
          await save(ctx, record, { error: error.message, status: "failed" });
          throw error;
        }
      });
    },

    async stopTemporaryConversation(sessionId, input = {}, options = {}) {
      return write(sessionId, options, async (ctx) => {
        const record = await recordFor(ctx, input.conversationId);
        if (record.providerConversationId) requireSuccess(await sessionAgent.stopConversation(sessionId,
          providerInput(record, { runId: record.runId }), ctx));
        await save(ctx, record, { status: "interrupted", error: "" });
        return { ok: true, status: "interrupted", conversationId: record.conversationId };
      });
    },

    async deleteTemporaryConversation(sessionId, input = {}, options = {}) {
      const result = await write(sessionId, options, async (ctx) => {
        let record = await ctx.runtime.store.readSessionConversation(sessionId, input.conversationId);
        if (!record) return { ok: true, deleted: true };
        record = await save(ctx, record, { state: "closing", error: "" });
        try {
          if (record.providerConversationId) {
            requireSuccess(await sessionAgent.stopConversation(sessionId, providerInput(record, { runId: record.runId }), ctx));
            requireSuccess(await sessionAgent.deleteConversation(sessionId, providerInput(record), ctx));
            record = await save(ctx, record, { providerConversationId: "" });
          }
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
    }
  };
}

export { createSessionConversations };
