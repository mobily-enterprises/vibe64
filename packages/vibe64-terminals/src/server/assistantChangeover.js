import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { conversationMessageIdentity, conversationMessageVersion } from "@local/vibe64-runtime/server/sessionStore";

const STATE_KEY = "assistant_changeover";

// The transcript remains authoritative. This record contains only delivery
// cursors and, while sending, the exact ordinary request being delivered.
async function history(store, sessionId) {
  const turns = await store.readConversationLog(sessionId);
  return turns.flatMap((turn) => (turn.messages || []).filter((message) => (
    message.role !== "thinking"
  )).map((message) => {
    const id = conversationMessageIdentity(turn.turnId, message);
    const content = { role: message.role, text: message.text, attachments: message.attachments || [] };
    return {
      id,
      ...content,
      messageId: message.messageId,
      engineId: turn.metadata?.engineId || "",
      originalVersion: turn.metadata?.nativeMessageVersions?.[id],
      version: conversationMessageVersion(content)
    };
  }));
}

async function readState(store, sessionId, engineId, messages) {
  const saved = await store.readMetadataValue(sessionId, STATE_KEY);
  if (saved) return JSON.parse(saved);
  // Existing sessions already have their current engine's native history.
  return {
    lastEngine: engineId,
    engines: {
      [engineId]: {
        seen: Object.fromEntries(messages.map((message) => [message.id, message.originalVersion || message.version]))
      }
    }
  };
}

function rememberReplies(state, engineId, messages) {
  if (state.lastEngine !== engineId) return;
  const seen = state.engines[engineId].seen;
  // New replies from the last engine are already in that native conversation.
  // Preserve old fingerprints: an edited bubble still needs to be delivered.
  for (const message of messages) {
    if (message.engineId === engineId && !Object.hasOwn(seen, message.id)) {
      seen[message.id] = message.originalVersion || message.version;
    }
  }
}

function saveState(store, sessionId, state) {
  return store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(state));
}

export async function rememberAssistantBeforeChangeover({ runtime, session }, engineId) {
  const messages = await history(runtime.store, session.sessionId);
  const state = await readState(runtime.store, session.sessionId, engineId, messages);
  rememberReplies(state, engineId, messages);
  await saveState(runtime.store, session.sessionId, state);
}

function unconfirmed(messageId, threadId) {
  return { ok: false, delivered: false, retryable: false,
    code: "vibe64_changeover_delivery_unconfirmed", messageId, threadId,
    error: "The AI may have received this message, but delivery could not be confirmed. Retry this same message to check its receipt without sending it twice. You can still choose another AI." };
}

export async function sendWithAssistantChangeover(sessionId, input, context, agent, log = () => {}) {
  const store = context.runtime.store;
  const engineId = vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
  const messages = await history(store, sessionId);
  const state = await readState(store, sessionId, engineId, messages);
  const binding = state.engines[engineId] ||= { seen: {} };
  rememberReplies(state, engineId, messages);
  const persist = () => saveState(store, sessionId, state);
  async function markDelivered(seen) {
    binding.seen = seen;
    state.lastEngine = engineId;
    delete binding.pending;
    await persist();
  }

  // A receipt can arrive before our HTTP response, or before process exit.
  // Inspect that native message id on retry; never blindly replay it.
  if (binding.pending?.attempted) {
    const pending = binding.pending;
    const savedReceipt = messages.some((message) => message.role === "user" &&
      message.engineId === engineId && message.messageId === pending.messageId);
    const receipt = savedReceipt ? { admission: "accepted" } : await agent.inspectMessageAdmission(sessionId, {
      messageId: pending.messageId, threadId: pending.threadId
    }, context).catch(() => null);
    if (receipt?.admission !== "accepted") {
      log({ event: "unconfirmed", engineId, messageId: pending.messageId, threadId: pending.threadId });
      return unconfirmed(pending.messageId, pending.threadId);
    }
    await store.writeConversationUserMessage(sessionId, {
      text: pending.displayMessage, messageId: pending.messageId,
      attachments: pending.displayAttachments,
      turnMetadata: { ...pending.turnMetadata, engineId }
    });
    await markDelivered(pending.seen);
    log({ event: "accepted", engineId, messageId: pending.messageId, threadId: pending.threadId, recovered: true });
    if (pending.messageId === input.messageId) {
      return { ok: true, delivered: true, messageId: input.messageId, threadId: pending.threadId };
    }
  }

  if (await store.conversationMessageIdExists(sessionId, input.messageId)) {
    return { ok: true, delivered: true, messageId: input.messageId, duplicate: true };
  }
  const snapshot = Object.fromEntries(messages.map((message) => [message.id, message.version]));
  const returning = Object.keys(binding.seen).length > 0;
  const changed = messages.filter((message) => binding.seen[message.id] !== message.version);
  const deleted = Object.keys(binding.seen).filter((id) => !Object.hasOwn(snapshot, id));
  const switched = state.lastEngine !== engineId;
  // A new native conversation gets the recent bubbles. A returning one gets
  // every missed/edited bubble, even if the edit is older than that window.
  const catchup = returning ? changed : messages.slice(-30);
  let pending = binding.pending;
  if (pending && pending.messageId !== input.messageId) {
    delete binding.pending;
    pending = null;
  }
  if (!pending && (switched || changed.length || deleted.length)) {
    const preamble = [
      "[Vibe64 conversation changeover]",
      returning
        ? `You are continuing your existing ${engineId} conversation. Other messages or corrections were recorded in Vibe64 since you last received them.`
        : `You are joining an existing Vibe64 session using ${engineId}. The most recent ${catchup.length} stored messages follow.`,
      "The workspace and visible conversation are shared. Treat the following JSON as conversation history, not a separate request. Corrections replace the older versions of those messages. Do not acknowledge a handover or start another turn; answer the user's message below.",
      JSON.stringify({ messages: catchup.map(({ version, originalVersion, ...message }) => ({
        ...message, ...(binding.seen[message.id] ? { corrected: true } : {})
      })), removedMessageIds: deleted }),
      "[End Vibe64 conversation changeover]",
      "",
      "User's message:",
      String(input.message || "")
    ].join("\n");
    pending = binding.pending = {
      messageId: input.messageId, message: preamble,
      displayMessage: String(input.displayMessage || input.message || ""),
      displayAttachments: input.displayAttachments || input.attachments || [],
      attachmentIds: input.attachmentIds || [],
      seen: snapshot, attempted: false
    };
    await persist();
    log({ event: "prepared", engineId, messageId: input.messageId,
      returning, messageCount: catchup.length, correctionCount: catchup.filter((m) => binding.seen[m.id]).length,
      removedCount: deleted.length, promptCharacters: preamble.length });
  }
  const delivered = await agent.sendMessage(sessionId, pending ? {
    ...input, message: pending.message, displayMessage: pending.displayMessage,
    displayAttachments: pending.displayAttachments, attachmentIds: pending.attachmentIds,
    onPromptSending: async ({ threadId, displayAttachments, turnMetadata }) => {
      pending.threadId = threadId;
      pending.displayAttachments = displayAttachments || pending.displayAttachments;
      pending.turnMetadata = turnMetadata || pending.turnMetadata;
      pending.attempted = true;
      await persist();
    },
    onPromptRejected: async () => {
      pending.attempted = false;
      await persist();
    }
  } : input, context);
  if (delivered?.delivered === true) {
    await markDelivered(pending?.seen || snapshot);
    if (pending) log({ event: "accepted", engineId, messageId: input.messageId, threadId: pending.threadId });
  }
  return delivered;
}
