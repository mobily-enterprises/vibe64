import {
  normalizeText
} from "@local/vibe64-core/server/core";

const VIBE64_SESSION_CLOSING_AT_METADATA = "session_closing_at";
const VIBE64_SESSION_CLOSING_REASON_METADATA = "session_closing_reason";

function sessionClosingReason(session = {}) {
  return normalizeText(session?.metadata?.[VIBE64_SESSION_CLOSING_REASON_METADATA]);
}

function sessionIsClosing(session = {}) {
  return Boolean(sessionClosingReason(session));
}

function sessionClosingMetadata(reason = "closing", {
  closedAt = new Date().toISOString()
} = {}) {
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
