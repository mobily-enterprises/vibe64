// Lookups in a project's listed sessions.

function sessionIdExistsInList(sessionId = "", nextSessions = []) {
  const normalizedSessionId = String(sessionId || "").trim();
  return Boolean(normalizedSessionId) && nextSessions.some((session) => session.sessionId === normalizedSessionId);
}

/** The one listed session renewed from a predecessor, or "" when none or several claim it. */
function renewedSuccessorSessionId({
  predecessorSessionId = "",
  sessions = []
} = {}) {
  const predecessorId = String(predecessorSessionId || "").trim();
  if (!predecessorId) {
    return "";
  }
  const matches = sessions.filter((session) => (
    String(session?.metadata?.renewed_from || "").trim() === predecessorId
  ));
  return matches.length === 1 ? String(matches[0]?.sessionId || "").trim() : "";
}

export {
  renewedSuccessorSessionId,
  sessionIdExistsInList
};
