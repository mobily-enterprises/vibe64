function codexLiveProgressMessagesVisible(conversationLog = {}) {
  return Boolean(
    Array.isArray(conversationLog?.activityMessages) &&
    conversationLog.activityMessages.length > 0
  );
}

function codexInteractionLocksControls({
  codexThinking = false
} = {}) {
  return Boolean(codexThinking);
}

export {
  codexInteractionLocksControls,
  codexLiveProgressMessagesVisible
};
