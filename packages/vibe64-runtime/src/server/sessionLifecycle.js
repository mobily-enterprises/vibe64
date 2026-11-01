import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const VIBE64_SESSION_CLOSING_AT_METADATA = "session_closing_at";
const VIBE64_SESSION_CLOSING_REASON_METADATA = "session_closing_reason";

function sessionClosingReason(session) {
  return toText(session?.metadata?.[VIBE64_SESSION_CLOSING_REASON_METADATA]) ||
    (toText(session?.status) === "renewal_quiesced" ? "renewing" : "");
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
    [VIBE64_SESSION_CLOSING_REASON_METADATA]: toText(reason) || "closing"
  };
}

export {
  VIBE64_SESSION_CLOSING_AT_METADATA,
  VIBE64_SESSION_CLOSING_REASON_METADATA,
  sessionClosingMetadata,
  sessionClosingReason,
  sessionIsClosing
};
