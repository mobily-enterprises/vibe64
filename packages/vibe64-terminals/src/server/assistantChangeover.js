import { createMainConversationBinding, readMainConversationHistory as history, MAIN_CONVERSATION_PRESENTATION, requireCompletedNativeConversationReplacement, requireCompletedConversationRewind, requireMainConversationAdmission } from "./mainConversationBinding.js";
import { createConversationChangeover } from "@jskit-ai/assistant-core/server/conversation";
import { vibe64AssistantConversationKey, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
export function sessionConversationKey(session) {
  const selection = vibe64AssistantSelectionFromMetadata(session.metadata);
  return selection.engineId === "codex" ? "codex" : vibe64AssistantConversationKey(selection);
}

export { requireCompletedNativeConversationReplacement, requireCompletedConversationRewind, requireMainConversationAdmission };

// The caller holds the main agent-write lock and has checked access, idle work,
// routing and goals. No provider history is removed by this operation. The next
// ordinary Send delivers the briefing through the existing admission receipt.
export async function replaceNativeConversation(sessionId, input, context, agent, conversation) {
  const { store } = context.runtime;
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
  if (conversation) return conversation.replace({ operationId,
    expectedSegmentId: `${engineId}:${expectedId}`, reason: "renewal", briefing: handover });
  const messages = await history(store, sessionId);
  return changeoverFor(store, sessionId, { agent, context }).replace({
    engineId, messages, operationId, expectedId, handover
  });
}

function changeoverFor(store, sessionId, { agent, context, log } = {}) {
  const binding = createMainConversationBinding(store, sessionId, context);
  return createConversationChangeover({
    state: binding.state,
    identity: binding.identity,
    transcript: binding.transcript,
    agent: agent && {
      sendMessage: (input) => agent.sendMessage(sessionId, input, context),
      inspectMessageAdmission: (input) => agent.inspectMessageAdmission(sessionId, input, context),
      closeSession: () => agent.closeSession(sessionId, { ...context, changeover: true, forgetConversationBinding: true })
    },
    presentation: MAIN_CONVERSATION_PRESENTATION,
    log
  });
}

export async function rememberAssistantBeforeChangeover({ runtime, session }, engineId) {
  requireCompletedConversationRewind(session);
  const messages = await history(runtime.store, session.sessionId);
  await changeoverFor(runtime.store, session.sessionId).remember({ engineId, messages });
}

export async function sendWithAssistantChangeover(sessionId, input, context, agent, log = () => {}) {
  requireCompletedConversationRewind(context.session);
  const store = context.runtime.store;
  const engineId = sessionConversationKey(context.session);
  const messages = await history(store, sessionId);
  return changeoverFor(store, sessionId, { agent, context, log }).send({
    engineId, messages, input,
    turnMetadata: { engineId: engineId.split("/")[0] }
  });
}
