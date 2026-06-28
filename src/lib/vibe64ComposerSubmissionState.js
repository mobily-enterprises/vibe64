function normalizedText(value = "") {
  return String(value || "").trim();
}

function optimisticComposerTurnIsLocalPending(turn = null) {
  return Boolean(
    turn &&
    typeof turn === "object" &&
    turn.remote !== true &&
    normalizedText(turn.status) === "pending"
  );
}

function localComposerSubmissionCanClear({
  assistantReplyText = "",
  codexHandoffComplete = false,
  optimisticTurn = null,
  submittedText = ""
} = {}) {
  if (!optimisticComposerTurnIsLocalPending(optimisticTurn)) {
    return false;
  }
  const optimisticText = normalizedText(optimisticTurn.text);
  if (!optimisticText || optimisticText !== normalizedText(submittedText)) {
    return false;
  }
  return Boolean(codexHandoffComplete || normalizedText(assistantReplyText));
}

function vibe64ComposerSubmissionStatusState({
  codexInterruptBlocked = false,
  codexInterruptVisible = false,
  localComposerSubmissionPending = false,
  remoteComposerSubmissionPending = false
} = {}) {
  const codexStopVisible = Boolean(codexInterruptVisible);
  const codexHandoffPending = Boolean(
    (localComposerSubmissionPending || remoteComposerSubmissionPending) &&
    !codexStopVisible
  );
  return {
    codexHandoffPending,
    codexStopEnabled: codexStopVisible && !codexInterruptBlocked,
    codexStopVisible,
    thinkingLabel: codexHandoffPending ? "Sending to Codex..." : "Thinking..."
  };
}

export {
  localComposerSubmissionCanClear,
  optimisticComposerTurnIsLocalPending,
  vibe64ComposerSubmissionStatusState
};
