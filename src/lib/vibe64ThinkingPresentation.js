function usesCommentaryForThinking(selection) {
  return ["codex", "claude"].includes(selection?.engineId) &&
    ["deepseek", "zai-coding-plan"].includes(selection?.modelProviderId);
}

function thinkingMessagePresentation(message, selection) {
  if (!message || !usesCommentaryForThinking(message.assistantSelection || selection)) return message;
  if (message.role === "commentary") return { ...message, role: "thinking" };
  if (message.role === "thinking") return null;
  return message;
}

export { thinkingMessagePresentation, usesCommentaryForThinking };
