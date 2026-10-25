import { vibe64Result } from "@local/vibe64-core/server/serverResponses";

// The session service's result envelope: a thrown error becomes { ok: false }.
function sessionResult(operation, fallbackMessage = "Vibe64 session request failed.") {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage
  });
}

function publicSession(session = {}, extra = {}) {
  return {
    ...session,
    ...extra,
    ok: true
  };
}

export { publicSession, sessionResult };
