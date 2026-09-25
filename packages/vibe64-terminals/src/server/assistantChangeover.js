import { vibe64AssistantConversationKey, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { conversationMessageIdentity, conversationMessageVersion } from "@local/vibe64-runtime/server/sessionStore";

const STATE_KEY = "assistant_changeover";
function turnConversationKey(turn) {
  const selection = turn.metadata?.assistantSelection || turn.metadata;
  return selection?.engineId === "codex" ? "codex" : vibe64AssistantConversationKey(selection);
}
export function sessionConversationKey(session) {
  const selection = vibe64AssistantSelectionFromMetadata(session.metadata);
  return selection.engineId === "codex" ? "codex" : vibe64AssistantConversationKey(selection);
}

export async function readConversationRewindState(store, sessionId, engineId) {
  const state = JSON.parse(await store.readMetadataValue(sessionId, STATE_KEY) || "null");
  if (state?.rewind && !state.rewind.completed) {
    return { turnId: state.rewind.turnId, text: state.rewind.text, pending: true };
  }
  const turns = await store.readConversationTail(sessionId);
  const users = turns.filter((turn) => turn.user);
  const last = users.at(-1);
  const previous = users.at(-2);
  if (!last?.user.messageId || !previous?.user.messageId ||
      turnConversationKey(previous) !== engineId ||
      turnConversationKey(last) !== engineId) return null;
  return { turnId: last.turnId, text: last.user.text, pending: false };
}

export function requireCompletedNativeConversationReplacement(session, { requireBriefing = false } = {}) {
  const state = JSON.parse(session?.metadata?.[STATE_KEY] || "null");
  if (state?.replacement?.status === "preparing") {
    throw Object.assign(new Error("Native conversation replacement is unfinished. Retry that operation before starting assistant work."),
      { code: "vibe64_conversation_replacement_pending", statusCode: 409 });
  }
  if (requireBriefing && state?.replacement?.status === "ready") {
    throw Object.assign(new Error("Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal."),
      { code: "vibe64_conversation_replacement_briefing_pending", statusCode: 409 });
  }
}

export function requireCompletedConversationRewind(session) {
  requireCompletedNativeConversationReplacement(session);
  const state = JSON.parse(session?.metadata?.[STATE_KEY] || "null");
  if (state?.rewind && !state.rewind.completed) {
    throw Object.assign(new Error("Finish undoing the last turn before continuing. Choose Undo last turn again to retry."),
      { code: "vibe64_conversation_rewind_pending", statusCode: 409 });
  }
}

// The caller holds the main agent-write lock and has checked access, idle work,
// routing and goals. No provider history is removed by this operation. The next
// ordinary Send delivers the briefing through the existing admission receipt.
export async function replaceNativeConversation(sessionId, input, context, agent) {
  const { store } = context.runtime;
  const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
  const engineId = sessionConversationKey(context.session);
  const operationId = String(input.operationId || "");
  const expectedId = String(input.expectedConversationId || "");
  const handover = typeof input.handover === "string" ? input.handover.trim() : "";
  const fail = (message) => { throw Object.assign(new Error(message), {
    code: "vibe64_conversation_replacement_unavailable", statusCode: 409
  }); };
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(operationId) || !expectedId || !handover || handover.length > 64 * 1024) {
    fail("Replacement requires an operation id, exact predecessor id and a handover of at most 65536 characters.");
  }
  const messages = await history(store, sessionId);
  const state = await readState(store, sessionId, engineId, messages);
  let replacement = state.replacement;
  if (replacement?.operationId === operationId) {
    if (replacement.previous.conversationId !== expectedId || replacement.engineId !== engineId ||
        replacement.status === "preparing" && replacement.handover !== handover) {
      fail("Replacement retry does not match the saved operation.");
    }
    if (replacement.status !== "preparing") return { ok: true, replacement };
  } else {
    if (replacement && replacement.status !== "accepted") fail("Finish the previous native conversation replacement first.");
    if (state.rewind && !state.rewind.completed || Object.values(state.engines).some((binding) => binding.pending)) {
      fail("Finish pending delivery or Undo before replacing native context.");
    }
    const metadata = context.session.metadata;
    if (metadata.agent_identity_provider !== selection.engineId || metadata.agent_identity_conversation_id !== expectedId ||
        !metadata.agent_identity_workdir) fail("The native predecessor identity changed or is incomplete.");
    const bindingNames = Object.keys(metadata).filter((name) =>
      (name === "agent_identity_conversation_id" || /^(?:codex(?:_[a-z0-9_-]+)?|claude|opencode)_conversation_id$/u.test(name)) &&
      metadata[name] === expectedId);
    if (bindingNames.length < 2) fail("The native conversation binding is incomplete.");
    replacement = state.replacement = {
      operationId, engineId, status: "preparing", handover, bindingNames,
      previous: { conversationId: expectedId, assistantSelection: selection,
        modelProviderId: metadata.codex_routing_home_provider || metadata.agent_identity_model_provider || selection.modelProviderId,
        workdir: metadata.agent_identity_workdir },
      preparedAt: new Date().toISOString()
    };
    await saveState(store, sessionId, state);
  }
  const closed = await agent.closeSession(sessionId, { ...context, changeover: true, forgetConversationBinding: true });
  if (closed?.ok !== true) fail(closed?.error || "Native conversation shutdown was not confirmed.");
  await store.mutateSession(sessionId, async () => {
    for (const name of replacement.bindingNames) await store.deleteMetadataValue(sessionId, name);
    // A stopped terminal's resume command must not advertise the predecessor.
    await store.deleteMetadataValue(sessionId, "agent_resume_command");
    for (const run of context.session.agentRuns || []) {
      if (run.providerThreadId === expectedId || run.threadId === expectedId) {
        await store.writeAgentRunEvent(sessionId, run.id, {
          event: { kind: "native-context-replaced" },
          patch: { providerThreadId: "", threadId: "", providerTurnId: "", turnId: "", providerGoalThreadId: "" }
        });
      }
    }
    state.engines[engineId] = { seen: {} };
    state.lastEngine = "";
    replacement.status = "ready";
    await saveState(store, sessionId, state);
  });
  return { ok: true, replacement };
}

// The caller holds the main assistant write lock. Providers inspect an exact
// boundary first, then apply that same boundary idempotently after it is saved.
export async function rewindLastConversationTurn(sessionId, input, context, agent) {
  const { store } = context.runtime;
  const engineId = sessionConversationKey(context.session);
  const messages = await history(store, sessionId);
  const state = await readState(store, sessionId, engineId, messages);
  const fail = (message) => { throw Object.assign(new Error(message), { code: "vibe64_conversation_rewind_unavailable", statusCode: 409 }); };
  let rewind = state.rewind;
  if (rewind?.turnId === input.turnId && rewind.completed) return { ok: true, text: rewind.text };
  if (rewind && !rewind.completed) {
    if (rewind.turnId !== input.turnId || rewind.engineId !== engineId) fail("Retry the unfinished Undo last turn first.");
  } else {
    if (Object.values(state.engines).some((binding) => binding.pending)) fail("Confirm the pending message delivery before undoing a turn.");
    const turns = await store.readConversationLog(sessionId);
    const users = turns.filter((turn) => turn.user);
    const previous = users.at(-2);
    const last = users.at(-1);
    if (!previous || last.turnId !== input.turnId || !last.user.messageId || !previous.user.messageId ||
        turnConversationKey(previous) !== engineId ||
        turnConversationKey(last) !== engineId) {
      fail("Undo is available only for the latest turn, with the same AI as the turn before it.");
    }
    const tail = turns.slice(turns.indexOf(last));
    if (tail.some((turn) => turnConversationKey(turn) !== engineId)) {
      fail("Undo cannot cross an AI change.");
    }
    const inspected = await agent.rewindConversation(sessionId, {
      messageId: last.user.messageId, previousMessageId: previous.user.messageId
    }, context);
    if (inspected.ok === false) return inspected;
    if (!inspected.checkpoint) fail("The AI could not identify the last turn.");
    rewind = state.rewind = { engineId, turnId: last.turnId, turnIds: tail.map((turn) => turn.turnId),
      text: last.user.text, checkpoint: inspected.checkpoint, completed: false };
    await saveState(store, sessionId, state);
  }
  const result = await agent.rewindConversation(sessionId, { checkpoint: rewind.checkpoint }, context);
  if (result.ok === false) return result;
  await store.rewindConversationLog(sessionId, rewind.turnIds);
  const seen = state.engines[engineId]?.seen || {};
  for (const id of Object.keys(seen)) {
    if (rewind.turnIds.includes(id.split("/")[0])) delete seen[id];
  }
  rewind.completed = true;
  await saveState(store, sessionId, state);
  store.clearConversationStream(sessionId);
  return { ok: true, text: rewind.text };
}

// The transcript remains authoritative. Delivery cursors and pending native
// writes share one record so Send, AI changes and Undo use the same boundary.
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
      engineId: turnConversationKey(turn) || "",
      assistantSelection: turn.metadata?.assistantSelection,
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
  requireCompletedConversationRewind(session);
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
  requireCompletedConversationRewind(context.session);
  const store = context.runtime.store;
  const engineId = sessionConversationKey(context.session);
  const messages = await history(store, sessionId);
  const state = await readState(store, sessionId, engineId, messages);
  const binding = state.engines[engineId] ||= { seen: {} };
  rememberReplies(state, engineId, messages);
  const persist = () => saveState(store, sessionId, state);
  async function markDelivered(seen) {
    const replacement = state.replacement;
    if (replacement?.engineId === engineId && replacement.status === "ready") {
      if (!binding.pending?.threadId || binding.pending.threadId === replacement.previous.conversationId) {
        throw new Error("Native replacement delivery did not identify a fresh successor. The predecessor was retained.");
      }
      replacement.status = "accepted";
      replacement.successorConversationId = binding.pending.threadId;
      replacement.acceptedAt = new Date().toISOString();
      delete replacement.handover;
      delete replacement.bindingNames;
      state.retiredConversations ||= [];
      state.retiredConversations.push({ ...replacement.previous, operationId: replacement.operationId,
        successorConversationId: replacement.successorConversationId, acceptedAt: replacement.acceptedAt });
    }
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
      turnMetadata: {
        ...pending.turnMetadata,
        engineId: engineId.split("/")[0],
        assistantSelection: vibe64AssistantSelectionFromMetadata(context.session.metadata)
      }
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
    const handover = state.replacement?.engineId === engineId && state.replacement.status === "ready"
      ? state.replacement.handover : "";
    const preamble = [
      "[Vibe64 conversation changeover]",
      returning
        ? `You are continuing your existing ${engineId} conversation. Other messages or corrections were recorded in Vibe64 since you last received them.`
        : `You are joining an existing Vibe64 session using ${engineId}. The most recent ${catchup.length} stored messages follow.`,
      "The workspace and visible conversation are shared. Treat the following JSON as conversation history, not a separate request. Corrections replace the older versions of those messages. Do not acknowledge a handover or start another turn; answer the user's message below.",
      ...(handover ? ["This is a fresh native context. Earlier native history remains separate. The saved continuity briefing follows:",
        JSON.stringify({ handover })] : []),
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
      const replacement = state.replacement;
      if (replacement?.engineId === engineId && replacement.status === "ready" &&
          (!threadId || threadId === replacement.previous.conversationId)) {
        throw new Error("Native replacement must use a fresh successor before sending its briefing.");
      }
      await input.onPromptSending?.({ threadId, displayAttachments, turnMetadata });
      pending.threadId = threadId;
      pending.displayAttachments = displayAttachments || pending.displayAttachments;
      pending.turnMetadata = turnMetadata || pending.turnMetadata;
      pending.attempted = true;
      await persist();
    },
    onPromptRejected: async () => {
      await input.onPromptRejected?.();
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
