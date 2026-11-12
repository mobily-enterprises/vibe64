import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  createMainConversationBinding,
  readMainConversationHistory,
  MAIN_CONVERSATION_PRESENTATION,
  requireCompletedConversationRewind
} from "./mainConversationBinding.js";
import { requireCompletedNativeConversationReplacement } from "./mainConversationContext.js";
import { createConversationChangeover } from "@jskit-ai/assistant-core/server/conversation";
import { vibe64AssistantConversationKey, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
export function sessionConversationKey(session) {
  const selection = vibe64AssistantSelectionFromMetadata(session.metadata);
  return selection.engineId === "codex" ? "codex" : vibe64AssistantConversationKey(selection);
}

export { requireCompletedNativeConversationReplacement, requireCompletedConversationRewind };

/**
 * A changeover ends the previous assistant's use of the session. Its native
 * conversation stays saved for a later return; nothing is retained in memory.
 */
export function closeAssistantForChangeover(agent, sessionId, context) {
  return agent.closeSession(sessionId, { ...context, changeover: true, forgetConversationBinding: true });
}

/**
 * The caller holds the main agent-write lock and has checked access, idle work,
 * routing and goals. No provider history is removed by this operation. The next
 * ordinary Send delivers the briefing through the existing admission receipt.
 */
export async function replaceNativeConversation(sessionId, input, context, agent, conversation) {
  const { store } = context.runtime;
  const engineId = sessionConversationKey(context.session);
  const operationId = String(input.operationId || "");
  const expectedId = String(input.expectedConversationId || "");
  const handover = typeof input.handover === "string" ? input.handover.trim() : "";
  const fail = (message) => {
    throw new AppError(409, message, { code: "vibe64_conversation_replacement_unavailable" });
  };
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(operationId) || !expectedId || !handover || handover.length > 64 * 1024) {
    fail("Replacement requires an operation id, exact predecessor id and a handover of at most 65536 characters.");
  }
  if (conversation) {
    return conversation.replace({
      operationId,
      expectedSegmentId: `${engineId}:${expectedId}`,
      reason: "renewal",
      briefing: handover
    });
  }
  const messages = await readMainConversationHistory(store, sessionId);
  return changeoverFor(store, sessionId, { agent, context }).replace({
    engineId,
    messages,
    operationId,
    expectedId,
    handover
  });
}

function changeoverFor(store, sessionId, { agent, context, log, maximumInitialMessages } = {}) {
  const binding = createMainConversationBinding(store, sessionId, context);
  return createConversationChangeover({
    state: binding.state,
    identity: binding.identity,
    transcript: binding.transcript,
    agent: agent && {
      sendMessage: (input) => agent.sendMessage(sessionId, input, context),
      inspectMessageAdmission: (input) => agent.inspectMessageAdmission(sessionId, input, context),
      closeSession: () => closeAssistantForChangeover(agent, sessionId, context)
    },
    presentation: MAIN_CONVERSATION_PRESENTATION,
    log,
    ...(maximumInitialMessages ? { maximumInitialMessages } : {})
  });
}

export async function rememberAssistantBeforeChangeover({ runtime, session }, engineId) {
  requireCompletedConversationRewind(session);
  const messages = await readMainConversationHistory(runtime.store, session.sessionId);
  await changeoverFor(runtime.store, session.sessionId).remember({ engineId, messages });
}

/**
 * Cancel drops the message's pending native attempt, so no later send replays it
 * or waits on its receipt. The caller holds the agent-write lock.
 */
export function discardAssistantChangeoverMessage(sessionId, messageId, context) {
  return changeoverFor(context.runtime.store, sessionId, { context }).discard({ messageId });
}

/**
 * A changeover holds one native attempt at a time. While an earlier message's
 * receipt is undecided, it answers every other message with that earlier
 * message's unconfirmed result, before preparing or dispatching this one. This
 * message was therefore not sent: say so, and name the way out, instead of
 * reporting it as possibly received. Its own unconfirmed result passes unchanged.
 * @param {object} result the native send's result
 * @param {string} messageId the message this send carried
 */
export function requireOwnDeliveryResult(result, messageId) {
  if (result?.code !== MAIN_CONVERSATION_PRESENTATION.unconfirmedCode || !result.messageId ||
      result.messageId === messageId) return result;
  throw Object.assign(new AppError(
    409,
    "Not sent: this chat is waiting on an earlier message whose delivery to the AI could not be confirmed, so nothing is sent twice. " +
      "In this chat, Retry that earlier message to check its receipt, or Cancel it, then send this message again.",
    { code: "vibe64_assistant_earlier_delivery_unconfirmed", details: { unconfirmedMessageId: result.messageId } }
  ), { delivery: "not-sent" });
}

export async function sendWithAssistantChangeover(sessionId, input, context, agent, log = () => {}, initialMessages = []) {
  requireCompletedConversationRewind(context.session);
  const store = context.runtime.store;
  const engineId = sessionConversationKey(context.session);
  const messages = [...initialMessages, ...await readMainConversationHistory(store, sessionId)];
  return requireOwnDeliveryResult(await changeoverFor(store, sessionId, {
    agent,
    context,
    log,
    ...(initialMessages.length ? { maximumInitialMessages: 40 } : {})
  }).send({
    engineId,
    messages,
    input,
    turnMetadata: { engineId: engineId.split("/")[0] }
  }), input.messageId);
}
