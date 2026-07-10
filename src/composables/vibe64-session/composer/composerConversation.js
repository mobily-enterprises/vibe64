function normalizedComposerText(value = "") {
  return String(value || "").trim();
}

function conversationLogTurns(conversationLog = {}) {
  const turns = Array.isArray(conversationLog?.turns) ? conversationLog.turns : [];
  return turns.length
    ? turns
    : Array.isArray(conversationLog)
      ? conversationLog
      : [];
}

function conversationTurnUserText(turn = {}) {
  return normalizedComposerText(turn?.user?.text);
}

function latestAssistantMessageAwaitingUserReply(conversationLog = {}) {
  const turns = conversationLogTurns(conversationLog);
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const messages = Array.isArray(turn?.messages) ? turn.messages : [];
    if (messages.length) {
      for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex];
        const role = String(message?.role || "").trim();
        const text = normalizedComposerText(message?.text);
        if (!text) {
          continue;
        }
        if (role === "user") {
          return "";
        }
        if (role === "assistant") {
          return text;
        }
      }
      continue;
    }
    if (conversationTurnUserText(turn)) {
      return "";
    }
    const assistantText = normalizedComposerText(turn?.assistant?.text);
    if (assistantText) {
      return assistantText;
    }
  }
  return "";
}

function latestSubmittedConversationText(conversationLog = {}) {
  const turns = conversationLogTurns(conversationLog);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = conversationTurnUserText(turns[index]);
    if (text) {
      return text;
    }
  }
  return "";
}

export {
  latestAssistantMessageAwaitingUserReply,
  latestSubmittedConversationText
};
