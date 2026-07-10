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
  localComposerSubmissionPending = false,
  remoteComposerSubmissionPending = false
} = {}) {
  const agentStopVisible = Boolean(agentInterruptVisible);
  const browserHandoffPending = Boolean(
    (localComposerSubmissionPending || remoteComposerSubmissionPending) && !agentStopVisible
  );
  const handoffPending = Boolean(
    agentHandoffPending || browserHandoffPending
  );
  return {
    browserHandoffPending,
    handoffPending,
    agentStopEnabled: agentStopVisible && !agentInterruptBlocked,
    agentStopVisible,
    thinkingLabel: String(agentHandoffLabel || "").trim() ||
      (browserHandoffPending ? "Sending to assistant..." : "Assistant is working...")
  };
}

export {
  createComposerSubmissionId,
  optimisticComposerTurnIsLocalPending,
  vibe64ComposerSubmissionStatusState
};
