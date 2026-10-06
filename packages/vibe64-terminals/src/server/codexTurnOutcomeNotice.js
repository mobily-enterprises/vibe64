import crypto from "node:crypto";

const CODEX_TURN_OUTCOME = Object.freeze({
  PROVIDER_FAILURE: "provider_failure",
  RESPONSE_DELIVERY_FAILURE: "response_delivery_failure",
  SERVICE_RESTART: "service_restart",
  USER_CANCELLED: "user_cancelled"
});

const CODEX_TURN_OUTCOME_MESSAGES = Object.freeze({
  [CODEX_TURN_OUTCOME.PROVIDER_FAILURE]:
    "Codex could not finish because its provider failed. Saved file changes remain; send a message to continue.",
  [CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE]:
    "Codex finished, but Vibe64 could not recover its final response. Saved file changes remain; send a message to continue.",
  [CODEX_TURN_OUTCOME.SERVICE_RESTART]:
    "Codex was interrupted by a Vibe64 restart before it could finish. Saved file changes remain; send a message to continue.",
  [CODEX_TURN_OUTCOME.USER_CANCELLED]:
    "You stopped Codex before it finished. Saved file changes remain; send a message to continue."
});
const CODEX_USAGE_BILLING_LINK =
  "[View Codex usage & billing](https://chatgpt.com/codex/settings/usage)";

function normalizeText(value) {
  return String(value || "").trim();
}

const CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE =
  "Codex app-server finished this turn, but Vibe64 did not receive the assistant result text.";

function codexAppServerResultDeliveryFailureMessage({
  error = ""
} = {}) {
  const normalizedError = normalizeText(error);
  if (!normalizedError) {
    return CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE;
  }
  const punctuation = [".", "!", "?"].some((character) => normalizedError.endsWith(character)) ? "" : ".";
  return `Codex completed, but Vibe64 could not process its response: ${normalizedError}${punctuation}`;
}

function codexTurnOutcomeNoticeMessage(outcome = "", detail = "", {
  usageLimitExceeded = false
} = {}) {
  const normalizedOutcome = normalizeText(outcome);
  const message = CODEX_TURN_OUTCOME_MESSAGES[normalizedOutcome] ||
    CODEX_TURN_OUTCOME_MESSAGES[CODEX_TURN_OUTCOME.PROVIDER_FAILURE];
  const normalizedDetail = normalizeText(detail);
  let notice = message;
  if (normalizedDetail) {
    notice = !normalizedOutcome || normalizedOutcome === CODEX_TURN_OUTCOME.PROVIDER_FAILURE
      ? `Codex could not finish: ${normalizedDetail} Saved file changes remain.`
      : `${message} Details: ${normalizedDetail}`;
  }
  return usageLimitExceeded === true
    ? `${notice} ${CODEX_USAGE_BILLING_LINK}`
    : notice;
}

function codexTurnOutcomeNoticeMessageId(threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  if (!normalizedThreadId || !normalizedTurnId) {
    return "";
  }
  const digest = crypto.createHash("sha256")
    .update([normalizedThreadId, normalizedTurnId, "turn-outcome"].join("\u0000"))
    .digest("hex");
  return `codex-turn-outcome-${digest}`;
}

async function writeCodexTurnOutcomeNotice({
  detail = "",
  outcome = CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
  publishSessionChanged = async () => null,
  sessionId = "",
  store = null,
  threadId = "",
  turnId = "",
  usageLimitExceeded = false
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const messageId = codexTurnOutcomeNoticeMessageId(threadId, turnId);
  if (
    !normalizedSessionId ||
    !messageId ||
    typeof store?.writeConversationSystemMessage !== "function"
  ) {
    return {
      reason: "unavailable",
      written: false
    };
  }
  const turn = await store.writeConversationSystemMessage(normalizedSessionId, {
    messageId,
    text: codexTurnOutcomeNoticeMessage(outcome, detail, { usageLimitExceeded })
  });
  if (!turn) {
    return {
      messageId,
      reason: "already_written",
      written: false
    };
  }
  await publishSessionChanged(normalizedSessionId, {
    payload: {
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      }
    },
    reason: "codex-turn-outcome"
  });
  return {
    messageId,
    reason: "written",
    turn,
    written: true
  };
}

export {
  codexAppServerResultDeliveryFailureMessage,
  CODEX_TURN_OUTCOME,
  codexTurnOutcomeNoticeMessage,
  codexTurnOutcomeNoticeMessageId,
  writeCodexTurnOutcomeNotice
};
