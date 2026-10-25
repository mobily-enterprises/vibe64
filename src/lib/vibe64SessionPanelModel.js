import {
  isOpenVibe64Session,
  shortVibe64SessionId
} from "@/lib/vibe64SessionViewModel.js";

function visibleVibe64Sessions(sessions = []) {
  return sessions
    .filter(isOpenVibe64Session)
    .sort((left, right) => String(
      left.createdAt || left.manifest?.createdAt || left.sessionId || ""
    ).localeCompare(String(
      right.createdAt || right.manifest?.createdAt || right.sessionId || ""
    )));
}

function vibe64SessionLimits({ payloadLimits = {}, sessions = [] } = {}) {
  const maxOpenSessions = Number(payloadLimits.maxOpenSessions);
  const openSessionCount = Number(payloadLimits.openSessionCount);
  return {
    maxOpenSessions: Number.isFinite(maxOpenSessions) && maxOpenSessions > 0
      ? maxOpenSessions
      : 0,
    openSessionCount: Number.isFinite(openSessionCount) && openSessionCount >= 0
      ? openSessionCount
      : sessions.filter(isOpenVibe64Session).length
  };
}

function blockingVibe64SessionPageError({
  hasMountedRuntime = false,
  runtimePageError = "",
  selectedSession = null,
  sessionListLoadError = "",
  sessions = []
} = {}) {
  const runtimeError = String(runtimePageError || "").trim();
  if (runtimeError) {
    return runtimeError;
  }
  const hasSelectedSession = Boolean(selectedSession?.sessionId || selectedSession);
  const listError = String(sessionListLoadError || "").trim();
  return listError && !hasMountedRuntime && !hasSelectedSession && sessions.length < 1 ? listError : "";
}

function enrichVibe64SessionForDisplay(session = null) {
  if (!session) {
    return null;
  }
  return {
    ...session,
    sessionName: session.sessionName || session.metadata?.label || ""
  };
}

export {
  blockingVibe64SessionPageError,
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId,
  vibe64SessionLimits,
  visibleVibe64Sessions
};
