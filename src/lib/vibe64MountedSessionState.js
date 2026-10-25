import {
  vibe64SessionRevision
} from "@/lib/vibe64SessionViewModel.js";

function sessionRecordHasDetailProjection(session = null) {
  return Boolean(
    session &&
    typeof session === "object" &&
    Object.hasOwn(session, "agentSession")
  );
}

function sessionRecordHasActiveAgentWork(session = null) {
  return (session?.agentSession?.turn?.active ?? session?.agentActivity?.active) === true;
}

function sessionRecordMatchesId(session = null, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  return Boolean(
    normalizedSessionId &&
    session?.sessionId === normalizedSessionId &&
    session?.ok !== false
  );
}

function latestSessionDetailRecord(current = null, candidate = null, sessionId = "") {
  if (
    !sessionRecordMatchesId(candidate, sessionId)
  ) {
    return current;
  }
  if (!sessionRecordMatchesId(current, sessionId)) {
    return candidate;
  }
  const currentRevision = vibe64SessionRevision(current);
  const candidateRevision = vibe64SessionRevision(candidate);
  if (
    currentRevision !== null &&
    candidateRevision !== null &&
    candidateRevision < currentRevision
  ) {
    return current;
  }
  return candidate;
}

function mountedSessionRecord(detailSession = null, listSession = null, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const listSessionMatches = sessionRecordMatchesId(listSession, normalizedSessionId);
  if (!sessionRecordMatchesId(detailSession, normalizedSessionId)) {
    return listSessionMatches ? listSession : null;
  }
  const detailRevision = vibe64SessionRevision(detailSession);
  const listRevision = vibe64SessionRevision(listSession);
  if (listSessionMatches && listRevision !== null && detailRevision !== null && listRevision > detailRevision) {
    if (
      sessionRecordHasDetailProjection(detailSession) &&
      !sessionRecordHasDetailProjection(listSession)
    ) {
      return detailSession;
    }
    return listSession;
  }
  return detailSession;
}

function mountedSessionDetailRefreshReason(detailSession = null, listSession = null, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (
    !sessionRecordMatchesId(detailSession, normalizedSessionId) ||
    !sessionRecordMatchesId(listSession, normalizedSessionId)
  ) {
    return "";
  }
  const detailRevision = vibe64SessionRevision(detailSession);
  const listRevision = vibe64SessionRevision(listSession);
  if (
    listRevision !== null &&
    detailRevision !== null &&
    listRevision > detailRevision &&
    sessionRecordHasDetailProjection(detailSession) &&
    !sessionRecordHasDetailProjection(listSession)
  ) {
    return "newer_summary_without_detail";
  }
  return "";
}

function mountedSessionDetailLoadState({
  detailSession = null,
  fetching = false,
  listSession = null,
  loadError = "",
  loading = false,
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const hasDetail = sessionRecordMatchesId(detailSession, normalizedSessionId);
  const hasSummary = sessionRecordMatchesId(listSession, normalizedSessionId);
  const error = String(loadError || "").trim();
  if (!normalizedSessionId) {
    return {
      error: "",
      label: "",
      loading: false,
      ready: false,
      restoring: false,
      sessionId: "",
      state: "summaryOnly"
    };
  }
  if (error && !hasDetail) {
    return {
      error,
      label: "Session could not load.",
      loading: false,
      ready: false,
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailError"
    };
  }
  if (hasDetail) {
    return {
      error: "",
      label: "",
      loading: false,
      ready: true,
      refreshing: Boolean(fetching || loading),
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailReady"
    };
  }
  if (loading || fetching) {
    return {
      error: "",
      label: "Loading session...",
      loading: true,
      ready: false,
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailLoading"
    };
  }
  return {
    error: "",
    label: hasSummary ? "Session could not load." : "Loading session...",
    loading: false,
    ready: false,
    restoring: false,
    sessionId: normalizedSessionId,
    state: "summaryOnly"
  };
}

// The server's clientRefresh names the reads a change invalidates; a read it
// does not mention is invalidated. `read` is the session read this caller owns.
function mountedSessionRealtimeShouldRefresh({ payload = {} } = {}, sessionId = "", read = "includeDetail") {
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(sessionId || "").trim()) {
    return false;
  }
  return payload?.clientRefresh?.[read] !== false;
}

export {
  latestSessionDetailRecord,
  mountedSessionDetailLoadState,
  mountedSessionDetailRefreshReason,
  mountedSessionRealtimeShouldRefresh,
  mountedSessionRecord,
  sessionRecordHasActiveAgentWork
};
