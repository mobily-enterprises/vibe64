import { vibe64ProviderPresentation } from "@local/vibe64-runtime/shared";

function usesCommentaryForThinking(selection) {
  return vibe64ProviderPresentation(selection).commentaryAsThinking;
}

function thinkingMessagePresentation(message, selection) {
  if (!message || !usesCommentaryForThinking(message.assistantSelection || selection)) return message;
  if (message.role === "commentary") return { ...message, role: "thinking" };
  if (message.role === "thinking") return null;
  return message;
}

// One summary per paragraph. A block holding a code fence stays whole, so its code is never cut apart.
function thinkingParagraphs(text) {
  if (text.includes("```")) return [text];
  return text.split(/\n[ \t]*\n/u).map((paragraph) => paragraph.trim()).filter(Boolean);
}

/**
 * The messages one saved message is shown as: none, itself, or, when its engine joins
 * several reasoning summaries into one block, one progress update per summary. Each
 * later update has its own message ID, so keys and narration tell the updates apart.
 */
function thinkingMessagesPresentation(message, selection) {
  const displayed = thinkingMessagePresentation(message, selection);
  if (!displayed) return [];
  if (displayed.role !== "thinking" ||
      !vibe64ProviderPresentation(message.assistantSelection || selection).thinkingParagraphUpdates) return [displayed];
  const paragraphs = thinkingParagraphs(String(displayed.text || ""));
  if (paragraphs.length < 2) return [displayed];
  return paragraphs.map((text, index) => ({ ...displayed, text,
    ...(index && displayed.messageId ? { messageId: `${displayed.messageId}:${index + 1}` } : {}) }));
}

export { thinkingMessagesPresentation, usesCommentaryForThinking };
