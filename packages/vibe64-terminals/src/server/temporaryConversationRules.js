import { AppError } from "@jskit-ai/kernel/server/runtime";
import { conversationMessageVersion } from "@jskit-ai/assistant-core/server/conversation";
import { temporaryConversationTurnActionInputValidator } from "./inputSchemas.js";
import { parseIntegrationSetupRequest } from "@local/vibe64-runtime/shared";
import {
  assistantGoalManagementMessage,
  assistantGoalObjective,
  assistantRoutingRequestFromMetadata
} from "@local/vibe64-runtime/shared/assistantRouting";

/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

const textFields = [
  "title", "draft", "displayMessage", "completionMessage", "dedupeKey", "failureMessage", "nextStepMessage",
  "recoveryNotice", "recoveryOperation", "recoveryConflictId", "recoveryContext", "recoveryOutcome",
  "recoveryOutcomeMessage", "recoveryRequestId", "runConflictId"
];
const messageFields = Object.keys(temporaryConversationTurnActionInputValidator.schema.getFieldDefinitions())
  .filter(key => !["sessionId", "conversationId", "vibe64User", "message", "messageId", "attachmentIds", "submissionKind"].includes(key));
/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {string} conversationId
 */
const temporaryConversationNamespace = (runtime, sessionId, conversationId) =>
  `${runtime.stateRoot}\0${sessionId}\0temporary\0${conversationId}`;

/** Destination-only preparation; native bindings and the unsent draft survive. */
function prepareCopiedSessionConversation(record) {
  const copy = structuredClone(record);
  if (["starting", "inProgress"].includes(copy.status)) {
    copy.status = "interrupted";
    copy.error = "Copied into a stopped development environment.";
  }
  // Nothing runs in the copy, so an AI task there waits for a person, as after a restart.
  if (copy.task?.active) {
    copy.task = { ...copy.task, phase: "needs_you", reason: "interrupted", message: "", waiting: false, pending: null, active: false };
  }
  return copy;
}

/**
 * Whether an AI task of this session has something running. This one saved flag is all terminals reads of a task's progress.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
async function sessionHasActiveAiTask(store, sessionId) {
  return (await store.listSessionConversations(sessionId)).some(record => record.task?.active === true);
}

const TITLE_MAX_LENGTH = 80;
const LEGACY_DEFAULT_TITLE = /^Temporary \d+$/;

/**
 * A chat's number is assigned once, at creation. Chats saved before that kept
 * the browser's "Temporary N" title, which restarted at 1 on every page load;
 * they are numbered by creation order (they always predate numbered chats).
 */
function numberedConversations(records) {
  let highest = 0;
  return records.map((record) => {
    if (Number.isInteger(record.number)) {
      highest = Math.max(highest, record.number);
      return record;
    }
    highest += 1;
    return { ...record, number: highest, title: LEGACY_DEFAULT_TITLE.test(record.title || "") ? "" : record.title };
  });
}

function presentation(input = {}) {
  const result = {};
  for (const key of textFields) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== "string" || input[key].length > 100_000) {
      throw new AppError(400, `Invalid conversation ${key}.`, { code: "vibe64_conversation_field_invalid", params: { field: key } });
    }
    result[key] = input[key];
  }
  if (Object.hasOwn(result, "title")) {
    result.title = result.title.replace(/[\s\p{Cc}]+/gu, " ").trim();
    if (result.title.length > TITLE_MAX_LENGTH) {
      throw new AppError(400, `Chat names can be at most ${TITLE_MAX_LENGTH} characters.`, {
        code: "vibe64_conversation_title_too_long",
        params: { max: TITLE_MAX_LENGTH }
      });
    }
  }
  if (Object.hasOwn(input, "recoveryAutoPaused")) result.recoveryAutoPaused = input.recoveryAutoPaused === true;
  if (Object.hasOwn(input, "recoveryRetryKeys")) {
    if (!Array.isArray(input.recoveryRetryKeys) || input.recoveryRetryKeys.length > 3 ||
        input.recoveryRetryKeys.some((key) => typeof key !== "string" || key.length > 1000)) {
      throw new AppError(400, "Invalid conversation repair retries.", { code: "vibe64_conversation_repair_retries_invalid" });
    }
    result.recoveryRetryKeys = input.recoveryRetryKeys;
  }
  return result;
}

function visibleContextText(message) {
  const prefix = message.role === "user" ? "/goal "
    : ["Goal set: ", "Goal cleared: ", "Goal active: "].find(value => message.text.startsWith(value));
  if (!prefix || !message.text.startsWith(prefix)) return parseIntegrationSetupRequest(message)?.text ?? message.text;
  const objective = message.text.slice(prefix.length);
  const separator = objective.indexOf("\n\n");
  return separator < 0 ? message.text : prefix + assistantGoalObjective(objective, { objective: objective.slice(separator + 2) });
}

/**
 * Capture only the canonical visible transcript, never native prompts or live reasoning.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
async function recentChatContext(store, sessionId) {
  const turns = await store.readConversationLog(sessionId, { presentation: true });
  const selected = turns.flatMap(turn => (turn.messages || []).filter(message =>
    ["user", "assistant", "commentary"].includes(message.role) && message.text?.trim() &&
    !assistantGoalManagementMessage(message, turn) && !(message.role === "user" && turn.metadata?.projectMessage)).map((message, index) => ({
    id: `main-context/${turn.turnId}/${index}`,
    role: message.role,
    text: visibleContextText(message),
    at: message.at,
    attachments: [],
    receipt: false
  }))).filter(message => message.text.trim()).sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).slice(-40);
  let remaining = 64 * 1024;
  let truncated = false;
  const messages = [];
  for (const message of selected.reverse()) {
    if (!remaining) {
      truncated = true;
      continue;
    }
    const bytes = Buffer.from(message.text, "utf8");
    let text = message.text;
    if (bytes.length > remaining) {
      // TextDecoder drops an incomplete UTF-8 suffix rather than splitting a character.
      text = new TextDecoder().decode(bytes.subarray(0, remaining), { stream: true });
      truncated = true;
    }
    remaining -= Buffer.byteLength(text, "utf8");
    const value = { ...message, text };
    messages.unshift({ ...value, version: conversationMessageVersion(value) });
  }
  return { messages, truncated, capturedAt: new Date().toISOString() };
}

function routingRequest(record) {
  return assistantRoutingRequestFromMetadata(record.routingMetadata);
}

/**
 * A native changeover keeps its own record of a prompt it attempted.
 */
function attemptedChangeover(record) {
  return Object.values(JSON.parse(record.routingMetadata?.assistant_changeover || "null")?.engines || {})
    .map(value => value.pending).find(value => value?.attempted);
}

function requireSuccess(result) {
  if (result?.ok === false) throw Object.assign(new Error(result.error || "Assistant conversation operation failed."), result);
  return result;
}

const teamTemporaryModesRefusal = () => new AppError(403, "Senior and Junior are for the workspace owner. Choose Fix it with AI or Custom.", { code: "vibe64_assistant_owner_required" });
const temporaryAutoModeRefusal = () => new AppError(400, "Temporary chats use Senior or Junior. Auto is available in Main chat only.", {
  code: "vibe64_temporary_chat_auto_unavailable"
});
const conversationClosingRefusal = () => new AppError(409, "This conversation is closing.", { code: "vibe64_conversation_closing" });

export {
  attemptedChangeover,
  conversationClosingRefusal,
  messageFields,
  numberedConversations,
  prepareCopiedSessionConversation,
  sessionHasActiveAiTask,
  presentation,
  recentChatContext,
  requireSuccess,
  routingRequest,
  teamTemporaryModesRefusal,
  temporaryAutoModeRefusal,
  temporaryConversationNamespace
};
