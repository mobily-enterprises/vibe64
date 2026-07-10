import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";

function normalizedText(value = "") {
  return String(value || "").trim();
}

function createComposerSubmissionId({
  now = Date.now(),
  originId = vibe64BrowserTabOriginId(),
  sequence = 0
} = {}) {
  const normalizedOriginId = normalizedText(originId);
  const timestamp = Number(now);
  if (!normalizedOriginId || !Number.isFinite(timestamp)) {
    throw new TypeError("Composer submission ids require a browser origin and timestamp.");
  }
  const normalizedSequence = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  return `composer:${normalizedOriginId}:${timestamp.toString(36)}:${normalizedSequence.toString(36)}`;
}

function optimisticComposerTurnIsLocalPending(turn = null) {
  return Boolean(
    turn &&
    typeof turn === "object" &&
    turn.remote !== true &&
    normalizedText(turn.status) === "pending"
  );
}

function vibe64ComposerSubmissionStatusState({
  agentHandoffLabel = "",
  agentHandoffPending = false,
  agentInterruptBlocked = false,
  agentInterruptVisible = false,
  agentTurnActive = false,
  localComposerSubmissionPending = false,
  remoteComposerSubmissionPending = false
} = {}) {
  const browserHandoffPending = Boolean(
    localComposerSubmissionPending || remoteComposerSubmissionPending
  );
  const handoffPending = Boolean(
    agentHandoffPending || browserHandoffPending
  );
  const agentStopVisible = Boolean(agentInterruptVisible || handoffPending);
  return {
    browserHandoffPending,
    handoffPending,
    agentStopEnabled: agentStopVisible && !agentInterruptBlocked,
    agentStopVisible,
    thinkingLabel: agentTurnActive
      ? "Assistant is working..."
      : String(agentHandoffLabel || "").trim() ||
      (handoffPending ? "Sending to assistant..." : "")
  };
}

export {
  createComposerSubmissionId,
  optimisticComposerTurnIsLocalPending,
  vibe64ComposerSubmissionStatusState
};
