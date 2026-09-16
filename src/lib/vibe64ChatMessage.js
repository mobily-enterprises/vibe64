import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";

function chatText(value = "") {
  return String(value || "").trim();
}

function createChatMessageId({
  now = Date.now(),
  originId = vibe64BrowserTabOriginId(),
  sequence = 0
} = {}) {
  const origin = chatText(originId);
  const timestamp = Number(now);
  if (!origin || !Number.isFinite(timestamp)) {
    throw new TypeError("Chat message ids require a browser origin and timestamp.");
  }
  const number = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  const safeOrigin = origin.replace(/[^A-Za-z0-9_-]+/gu, "_");
  return `message_${safeOrigin}_${timestamp.toString(36)}_${number.toString(36)}`;
}

function chatMessagePayload(message = "", attachments = []) {
  const text = chatText(message);
  if (!text) {
    return null;
  }
  const files = Array.isArray(attachments) ? attachments : [];
  const attachmentIds = files
    .map((attachment) => chatText(attachment?.attachmentId))
    .filter(Boolean);
  const displayAttachments = normalizeVibe64ConversationAttachments(
    files.filter((attachment) => chatText(attachment?.attachmentId))
  );
  return {
    ...(attachmentIds.length ? { attachmentIds } : {}),
    ...(displayAttachments.length ? { displayAttachments } : {}),
    displayMessage: text,
    message: text
  };
}

export { chatMessagePayload, createChatMessageId };
