import { createConversationStorage, prepareConversationRuntimeCopy } from "@jskit-ai/assistant-core/server/conversation";

// The product record owns chat identities; JSKIT still owns every canonical turn.
export function validateColleagueConversationRecord(record, ownerKey) {
  const invalid = () => { throw new Error("Colleague history has an unsupported shape. Inspect it before upgrading."); };
  const chat = value => {
    if (!value || typeof value.scopeId !== "string" || !/^colleague_[\w-]+$/u.test(value.scopeId) ||
        !Array.isArray(value.conversationLog) || value.conversationLog.some(turn =>
          !turn || typeof turn.turnId !== "string" || !Array.isArray(turn.messages) ||
          turn.messages.some(message => !message || typeof message.text !== "string" || typeof message.role !== "string"))) invalid();
  };
  if (![1, 2, 3].includes(record?.schemaVersion)) invalid();
  chat(record);
  if (record.schemaVersion !== 3) return;
  if (!Array.isArray(record.previousConversations)) invalid();
  const scopes = new Set(), runtimes = new Set(), operations = new Set();
  for (const value of [record, ...record.previousConversations]) {
    chat(value);
    if (typeof value.runtimeId !== "string" || !/^[\w-]+(?::colleague_[\w-]+)?$/u.test(value.runtimeId) ||
        (ownerKey && value.runtimeId !== ownerKey && value.runtimeId !== `${ownerKey}:${value.scopeId}`) ||
        scopes.has(value.scopeId) || runtimes.has(value.runtimeId)) invalid();
    scopes.add(value.scopeId);
    runtimes.add(value.runtimeId);
  }
  for (const [index, old] of record.previousConversations.entries()) {
    if (typeof old.archivedAt !== "string" || !Number.isFinite(Date.parse(old.archivedAt)) ||
        !old.freshOperation || typeof old.freshOperation.operationId !== "string" ||
        !old.freshOperation.operationId || old.freshOperation.operationId.length > 128 ||
        old.freshOperation.conversationId !== (record.previousConversations[index + 1]?.scopeId || record.scopeId) ||
        operations.has(old.freshOperation.operationId) || !Array.isArray(old.unconfirmedMessages) ||
        old.unconfirmedMessages.length > 8) invalid();
    operations.add(old.freshOperation.operationId);
    const ids = new Set();
    for (const message of old.unconfirmedMessages) {
      if (!message || typeof message.messageId !== "string" || !message.messageId || message.messageId.length > 128 ||
          typeof message.clientId !== "string" || !message.clientId || message.clientId.length > 128 ||
          typeof message.text !== "string" || !message.text.trim() || message.text.length > 24000 ||
          message.source !== "client-reported" || message.status !== "unconfirmed" || ids.has(message.messageId)) invalid();
      ids.add(message.messageId);
    }
  }
}

/** Explicit offline copy; never called by normal loading or recovery. */
export async function prepareCopiedColleagueConversation(record, ownerKey, { at }) {
  validateColleagueConversationRecord(record, ownerKey);
  if (record.schemaVersion !== 3) throw new Error("Upgrade the parent's Colleague history before copying it.");
  const copy = structuredClone(record);
  if (copy.summaryHelper) copy.summaryHelper.executionId = "";
  for (const chat of [copy, ...copy.previousConversations]) {
    const storage = createConversationStorage({
      readRecord: async () => ({ metadata: chat.conversationMetadata || {},
        turns: new Map(chat.conversationLog.map(turn => [turn.turnId, turn])) }),
      async writeRecord(_key, { turns, metadata }, transaction) {
        chat.conversationMetadata = metadata;
        chat.conversationLog = await Promise.all([...turns.keys()].map(id => transaction.readTurn(id)));
      }
    });
    await storage.write(chat.runtimeId, transaction => prepareConversationRuntimeCopy(transaction, { at }));
    if (chat.status === "working") {
      chat.status = "interrupted";
      chat.error = "Copied into a stopped development environment.";
    }
  }
  for (const watch of copy.watches || []) {
    if (["active", "pending"].includes(watch.status)) watch.status = "paused";
  }
  for (const assignment of copy.assignments || []) {
    if (["active", "waiting"].includes(assignment.status)) {
      assignment.status = "needs-user";
      assignment.summary = "Copied assignment is paused. Inspect its target before continuing.";
    }
  }
  // These are queued notifications that could otherwise launch an autonomous
  // turn when the copied user's browser reconnects; written history is retained.
  copy.observations = [];
  return copy;
}
