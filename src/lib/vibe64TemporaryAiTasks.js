import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { chatTurnsWithRouting } from "@/lib/vibe64ChatDelivery.js";
import { conversationAttribution } from "@/lib/vibe64ConversationAttribution.js";
import { thinkingMessagesPresentation, usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";

// The task fields a temporary conversation saves as its presentation.
const TEMPORARY_AI_PRESENTATION_FIELDS = Object.freeze(["title", "draft"]);

function temporaryAiId(prefix = "temporary") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function temporaryAiRequestError(response = {}, fallback = "Temporary AI request failed.") {
  return Object.assign(new Error(vibe64ApiResponseError(response, fallback)), {
    code: normalizeText(response.code),
    conversationExpired: response.conversationExpired === true || response.code === "vibe64_conversation_closed",
    status: normalizeText(response.status)
  });
}

/** Sends one temporary conversation request, and throws the refusal it answers with. */
async function temporaryAiRequest(path = "", options = {}) {
  const response = await getHttpWebClient().request(path, options);
  if (response?.ok === false) {
    throw temporaryAiRequestError(response);
  }
  return response;
}

function temporaryAiTurnIsActive(status = "") {
  const normalizedStatus = normalizeText(status);
  return ["starting", "inProgress"].includes(normalizedStatus) || normalizedStatus === "preparing";
}

function temporaryAiMessages(turns = []) {
  return turns.flatMap((turn) => (turn.messages || [turn.system, turn.user,
    ...(turn.thinking || []), ...(turn.commentary || []), turn.assistant].filter(Boolean)).map((message) => ({
    ...message, id: message.messageId || message.id,
    ...(message.role === "user" ? { attachments: turn.user?.attachments || [] } : {}),
    status: message.status || (message.complete === false ? "inProgress" : "completed"),
    assistantSelection: turn.metadata?.assistantSelection, assistantRouting: turn.metadata?.assistantRouting
  })));
}

/** A task as the view reads it, its draft, attachments and messages read from its retained conversation. */
function temporaryAiTaskView(value) {
  const task = { ...value };
  task.label = task.title || `Temporary ${task.number}`;
  const runtime = task.binding.runtime.value;
  // Draft and delivery belong to the supplied retained owner. This flattened
  // read projection serves product feedback only; the element renders its
  // canonical turns directly, without regrouping native/history identities.
  Object.defineProperties(task, {
    draft: { enumerable: true, configurable: true, get: () => runtime.draft.value, set: value => { runtime.draft.value = value; } },
    attachments: { enumerable: true, configurable: true, get: () => runtime.draftAttachments.value, set: value => { runtime.draftAttachments.value = value; } },
    delivery: { enumerable: true, configurable: true, get: () => runtime.delivery },
    messages: { enumerable: true, configurable: true, get: () => temporaryAiMessages(runtime.turns.value) },
    adapter: { enumerable: true, configurable: true, get: () => task.binding.adapter.value }
  });
  return task;
}

/** The task's saved presentation, or only its selected fields. */
function temporaryAiTaskPresentation(task, selected) {
  return Object.fromEntries(TEMPORARY_AI_PRESENTATION_FIELDS.filter(key => !selected || selected.has(key)).map((key) => [key, task[key]]));
}

/**
 * A temporary chat's adapter as its message list shows it: attributed turns, the routed request and the delivery
 * receipts projected once, and the message actions answered by the list.
 * @param {object} supplied the chat binding's adapter
 * @param {object} options
 * @param {object | null} options.routingRequest
 * @param {boolean | undefined} options.working whether the assistant works now; undefined leaves the adapter's own
 * @param {string} options.scrollKey
 * @param {string} options.assistantLabel
 * @param {string} options.emptyMessage the welcome line of a chat with no turns yet
 * @param {{ resend: (id: string) => void, cancel: (id: string) => void, edit: (id: string) => void }} options.actions
 */
function temporaryAiTranscript(supplied, { routingRequest, working, scrollKey, assistantLabel, emptyMessage, actions }) {
  const turns = (supplied.conversation.turns || []).map(turn => {
    const selection = turn.metadata?.assistantSelection;
    const present = message => {
      if (!message) return [];
      const recordedSelection = message.assistantSelection || message.metadata?.assistantSelection || selection;
      const attribution = conversationAttribution(recordedSelection,
        message.assistantRouting || message.metadata?.assistantRouting || turn.metadata?.assistantRouting);
      return thinkingMessagesPresentation(message, recordedSelection).map(displayed => ({ ...displayed, ...attribution }));
    };
    return { ...turn,
      ...conversationAttribution(selection, turn.metadata?.assistantRouting),
      assistant: turn.assistant && present(turn.assistant)[0],
      thinking: turn.thinking?.flatMap(present),
      commentary: turn.commentary?.flatMap(present),
      messages: turn.messages?.flatMap(present)
    };
  });
  const routedTurns = chatTurnsWithRouting(supplied.delivery ? supplied.delivery.turns(turns) : turns,
    routingRequest, supplied.delivery?.state.sending === true);
  return { ...supplied,
    // Apply the existing receipt projection once, before product Router status.
    delivery: null,
    conversation: { ...supplied.conversation, cancellableDelivery: true,
      working: working ?? supplied.conversation.working, turns: routedTurns,
      assistantLabel, scrollKey, variant: "task", visible: true,
      userMessageFormat: "plain", progressPreviewLimit: usesCommentaryForThinking(routedTurns.at(-1)?.metadata?.assistantSelection) ? 1 : 0,
      systemLabel: "System", welcomeMessage: routedTurns.length ? "" : emptyMessage
    },
    actions: { ...supplied.actions,
      resend: actions.resend, checkDelivery: actions.resend,
      cancel: actions.cancel, edit: actions.edit
    }
  };
}

export {
  temporaryAiId,
  temporaryAiMessages,
  temporaryAiRequest,
  temporaryAiRequestError,
  temporaryAiTaskPresentation,
  temporaryAiTaskView,
  temporaryAiTranscript,
  temporaryAiTurnIsActive
};
