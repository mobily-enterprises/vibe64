function messageText(value = "") {
  return String(value || "").trim();
}

function conversationTurns(conversationLog = {}) {
  if (Array.isArray(conversationLog?.turns)) {
    return conversationLog.turns;
  }
  return Array.isArray(conversationLog) ? conversationLog : [];
}

function latestAssistantMessageAwaitingUserReply(conversationLog = {}) {
  const turns = conversationTurns(conversationLog);
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const messages = Array.isArray(turn?.messages) ? turn.messages : [];
    if (messages.length) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const text = messageText(message?.text);
        if (!text) {
          continue;
        }
        if (message?.role === "user") {
          return "";
        }
        if (message?.role === "assistant") {
          if (message.status === "inProgress") return "";
          return text;
        }
      }
      continue;
    }
    if (messageText(turn?.user?.text)) {
      return "";
    }
    const assistantText = messageText(turn?.assistant?.text);
    if (assistantText) {
      if (turn.assistant.status === "inProgress") return "";
      return assistantText;
    }
  }
  return "";
}

export {
  latestAssistantMessageAwaitingUserReply
};
