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

export { thinkingMessagePresentation, usesCommentaryForThinking };
