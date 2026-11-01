import {
  normalizeText
} from "@local/vibe64-core/server/core";

const VIBE64_SESSION_CLOSING_AT_METADATA = "session_closing_at";
const VIBE64_SESSION_CLOSING_REASON_METADATA = "session_closing_reason";

function sessionClosingReason(session) {
  return normalizeText(session?.metadata?.[VIBE64_SESSION_CLOSING_REASON_METADATA]) ||
    (normalizeText(session?.status) === "renewal_quiesced" ? "renewing" : "");
}

function sessionIsClosing(session = {}) {
  return Boolean(sessionClosingReason(session));
}

function sessionClosingMetadata(reason = "closing", options = {}) {
  const {
    closedAt = new Date().toISOString()
  } = options;
  return {
    [VIBE64_SESSION_CLOSING_AT_METADATA]: closedAt,
    [VIBE64_SESSION_CLOSING_REASON_METADATA]: normalizeText(reason) || "closing"
  };
}

export {
  VIBE64_SESSION_CLOSING_AT_METADATA,
  VIBE64_SESSION_CLOSING_REASON_METADATA,
  sessionClosingMetadata,
  sessionClosingReason,
  sessionIsClosing
};
