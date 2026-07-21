import {
  sessionRecordHasComposerMenuProjection
} from "@/lib/vibe64SessionComposerMenuProjection.js";
import {
  vibe64SessionRevision
} from "@/lib/vibe64SessionViewModel.js";

const MOUNTED_SESSION_IGNORED_REALTIME_REASONS = new Set([
  "assistant-response-bundle",
  "codex-app-server-prompt-injected",
  "codex-app-server-ready",
  "codex-app-server-final-assistant-message",
  "codex-app-server-live-progress",
  "codex-app-server-reasoning-summary",
  "codex-app-server-running",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-thinking-message",
  "codex-app-server-terminal-user-message",
  "codex-app-server-turn-active",
  "codex-app-server-turn-claimed",
  "codex-app-server-turn-finalizing",
  "codex-app-server-turn-idle",
  "codex-app-server-turn-state",
  "codex-app-server-message-delivered",
  "codex-context-replaced",
  "codex-prompt-injected",
  "launch-target-started",
  "launch-target-ready",
  "launch-target-closed",
  "launch-target-stopped"
]);

function sessionRecordHasRuntimeProjection(session = null) {
  return Boolean(
    session?.presentation &&
    typeof session.presentation === "object" &&
    !Array.isArray(session.presentation)
  );
}

function sessionRecordHasActiveAgentWork(session = null) {
  return Boolean(
    session?.agentSession?.turn?.active ||
    session?.composerHandoff?.pending ||
    (Array.isArray(session?.composerMessages) && session.composerMessages.some((message) => (
      String(message?.state || "").trim() === "accepted"
    )))
  );
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
    !sessionRecordMatchesId(candidate, sessionId) ||
    !sessionRecordHasRuntimeProjection(candidate)
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
      sessionRecordHasRuntimeProjection(detailSession) &&
      !sessionRecordHasRuntimeProjection(listSession)
    ) {
      return detailSession;
    }
    if (
      sessionRecordHasComposerMenuProjection(detailSession) &&
      !sessionRecordHasComposerMenuProjection(listSession)
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
    sessionRecordHasRuntimeProjection(detailSession) &&
    !sessionRecordHasRuntimeProjection(listSession)
  ) {
    return "newer_summary_without_runtime_projection";
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
      state: "summaryOnly",
      suppressPassiveComposer: false
    };
  }
  if (error && !hasDetail) {
    return {
      error,
      label: "Session controls could not load.",
      loading: false,
      ready: false,
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailError",
      suppressPassiveComposer: false
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
      state: "detailReady",
      suppressPassiveComposer: false
    };
  }
  if (loading || fetching) {
    return {
      error: "",
      label: "Loading session controls...",
      loading: true,
      ready: false,
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailLoading",
      suppressPassiveComposer: true
    };
  }
  return {
    error: "",
    label: hasSummary ? "Session controls could not load." : "Loading session...",
    loading: false,
    ready: false,
    restoring: false,
    sessionId: normalizedSessionId,
    state: "summaryOnly",
    suppressPassiveComposer: !hasSummary
  };
}

function mountedSessionRealtimeShouldRefresh({ payload = {} } = {}, sessionId = "") {
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(sessionId || "").trim()) {
    return false;
  }
  const reason = String(payload?.reason || "").trim();
  return !reason || !MOUNTED_SESSION_IGNORED_REALTIME_REASONS.has(reason);
}

export {
  latestSessionDetailRecord,
  mountedSessionDetailLoadState,
  mountedSessionDetailRefreshReason,
  mountedSessionRealtimeShouldRefresh,
  mountedSessionRecord,
  sessionRecordHasActiveAgentWork
};
