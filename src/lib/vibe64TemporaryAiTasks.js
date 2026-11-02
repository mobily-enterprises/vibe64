import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";

// The task fields a temporary conversation saves as its presentation.
const TEMPORARY_AI_PRESENTATION_FIELDS = Object.freeze([
  "title", "draft", "displayMessage", "completionMessage", "dedupeKey", "failureMessage", "nextStepMessage",
  "recoveryNotice", "recoveryOperation", "recoveryConflictId", "recoveryContext", "recoveryOutcome",
  "recoveryOutcomeMessage", "recoveryRequestId", "recoveryAutoPaused", "recoveryRetryKeys", "runConflictId"
]);

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
    messages: { enumerable: true, configurable: true, get() {
      const messages = temporaryAiMessages(runtime.turns.value);
      return task.recoveryMessage && !messages.some(message => message.id === task.recoveryMessage.id)
        ? [...messages, task.recoveryMessage] : messages;
    } },
    adapter: { enumerable: true, configurable: true, get: () => task.binding.adapter.value }
  });
  return task;
}

/** The task's saved presentation, or only its selected fields. */
function temporaryAiTaskPresentation(task, selected) {
  return Object.fromEntries(TEMPORARY_AI_PRESENTATION_FIELDS.filter(key => !selected || selected.has(key)).map((key) => [key, task[key]]));
}

export {
  temporaryAiId,
  temporaryAiMessages,
  temporaryAiRequest,
  temporaryAiRequestError,
  temporaryAiTaskPresentation,
  temporaryAiTaskView,
  temporaryAiTurnIsActive
};
