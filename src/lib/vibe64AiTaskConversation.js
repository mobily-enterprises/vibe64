import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { chatTurnsWithRouting } from "@/lib/vibe64ChatDelivery.js";
import { conversationAttribution } from "@/lib/vibe64ConversationAttribution.js";
import { thinkingMessagesPresentation, usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";

/**
 * The refusal an AI task request answered with, as an error carrying its code.
 * @param {{ code?: string, conversationExpired?: boolean, status?: string, error?: string }} response
 */
function aiTaskRequestError(response, fallback = "AI task request failed.") {
  return Object.assign(new Error(vibe64ApiResponseError(response, fallback)), {
    code: normalizeText(response.code),
    conversationExpired: response.conversationExpired === true || response.code === "vibe64_conversation_closed",
    status: normalizeText(response.status)
  });
}

/**
 * Sends one AI task request, and throws the refusal it answers with.
 * @param {string} path
 * @param {object} options
 */
async function aiTaskRequest(path, options) {
  const response = await getHttpWebClient().request(path, options);
  if (response?.ok === false) {
    throw aiTaskRequestError(response);
  }
  return response;
}

function aiTaskMessageId() {
  return `message_${crypto.randomUUID()}`;
}

/** @param {string} status a turn status the server reported */
function aiTaskTurnIsActive(status) {
  return ["preparing", "starting", "inProgress"].includes(normalizeText(status));
}

/** The conversation's messages in order, each carrying the selection and routing of its turn. */
function aiTaskMessages(turns) {
  return turns.flatMap((turn) => (turn.messages || [turn.system, turn.user,
    ...(turn.thinking || []), ...(turn.commentary || []), turn.assistant].filter(Boolean)).map((message) => ({
    ...message, id: message.messageId || message.id,
    ...(message.role === "user" ? { attachments: turn.user?.attachments || [] } : {}),
    status: message.status || (message.complete === false ? "inProgress" : "completed"),
    assistantSelection: turn.metadata?.assistantSelection, assistantRouting: turn.metadata?.assistantRouting
  })));
}

/**
 * The task's conversation as the chat reads it: its draft, attachments, delivery and messages are read from
 * the conversation binding, which owns them.
 * @param {object} value the conversation's record fields and its binding
 */
function aiTaskConversationView(value) {
  const conversation = { ...value };
  const runtime = conversation.binding.runtime.value;
  Object.defineProperties(conversation, {
    draft: { enumerable: true, configurable: true, get: () => runtime.draft.value, set: (draft) => { runtime.draft.value = draft; } },
    attachments: { enumerable: true, configurable: true, get: () => runtime.draftAttachments.value,
      set: (attachments) => { runtime.draftAttachments.value = attachments; } },
    delivery: { enumerable: true, configurable: true, get: () => runtime.delivery },
    messages: { enumerable: true, configurable: true, get: () => aiTaskMessages(runtime.turns.value) },
    adapter: { enumerable: true, configurable: true, get: () => conversation.binding.adapter.value }
  });
  return conversation;
}

function presentedMessages(message, turn) {
  if (!message) return [];
  const selection = message.assistantSelection || message.metadata?.assistantSelection || turn.metadata?.assistantSelection;
  const attribution = conversationAttribution(selection,
    message.assistantRouting || message.metadata?.assistantRouting || turn.metadata?.assistantRouting);
  return thinkingMessagesPresentation(message, selection).map(displayed => ({ ...displayed, ...attribution }));
}

/**
 * The binding's adapter as the task chat shows it: attributed turns, the routed request and the
 * delivery receipts projected once, and the message actions answered by the chat.
 * @param {object} adapter the conversation binding's adapter
 * @param {object} options
 * @param {object | null} options.routingRequest
 * @param {boolean} options.working
 * @param {string} options.scrollKey
 * @param {{ resend: (id: string) => void, cancel: (id: string) => void, edit: (id: string) => void }} options.actions
 */
function aiTaskTranscript(adapter, { routingRequest, working, scrollKey, actions }) {
  const presented = (adapter.conversation.turns || []).map(turn => ({ ...turn,
    ...conversationAttribution(turn.metadata?.assistantSelection, turn.metadata?.assistantRouting),
    assistant: turn.assistant && presentedMessages(turn.assistant, turn)[0],
    thinking: turn.thinking?.flatMap(message => presentedMessages(message, turn)),
    commentary: turn.commentary?.flatMap(message => presentedMessages(message, turn)),
    messages: turn.messages?.flatMap(message => presentedMessages(message, turn))
  }));
  const turns = chatTurnsWithRouting(adapter.delivery ? adapter.delivery.turns(presented) : presented,
    routingRequest, adapter.delivery?.state.sending === true);
  return { ...adapter,
    // The delivery receipts are projected once, above, before the routed request's status.
    delivery: null,
    conversation: { ...adapter.conversation, cancellableDelivery: true, working, turns,
      assistantLabel: "AI", scrollKey, variant: "task", visible: true, userMessageFormat: "plain",
      progressPreviewLimit: usesCommentaryForThinking(turns.at(-1)?.metadata?.assistantSelection) ? 1 : 0,
      systemLabel: "System", welcomeMessage: ""
    },
    actions: { ...adapter.actions, resend: actions.resend, checkDelivery: actions.resend, cancel: actions.cancel, edit: actions.edit }
  };
}

export {
  aiTaskConversationView,
  aiTaskMessageId,
  aiTaskMessages,
  aiTaskRequest,
  aiTaskRequestError,
  aiTaskTranscript,
  aiTaskTurnIsActive
};
