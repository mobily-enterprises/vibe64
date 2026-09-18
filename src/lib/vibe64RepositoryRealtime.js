const REPOSITORY_STATUS_SESSION_REASONS = new Set([
  "codex-app-server-turn-idle",
  "codex-turn-checkpoint-failed",
  "codex-turn-checkpoint-updated",
  "opencode-server-turn-idle",
  "repository-canonical-changed",
  "session-pull-request",
  "session-repository-checked",
  "session-save-completed",
  "session-save-failed",
  "session-save-started",
  "session-update-completed",
  "session-update-failed",
  "session-update-started",
  "session-work-saved",
  "session-work-updated"
]);

const REPOSITORY_CANONICAL_RECHECK_REASONS = new Set([
  "repository-canonical-changed",
  "session-pull-request",
  "session-save-failed",
  "session-update-failed"
]);

function repositoryStatusSessionId(payload = {}) {
  return String(payload?.sessionId || payload?.session?.sessionId || "").trim();
}

function repositoryStatusRealtimeShouldRefresh(payload = {}) {
  return REPOSITORY_STATUS_SESSION_REASONS.has(String(payload?.reason || "").trim());
}

function repositoryStatusRealtimeNeedsCanonicalCheck(payload = {}) {
  return REPOSITORY_CANONICAL_RECHECK_REASONS.has(String(payload?.reason || "").trim());
}

export {
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
};
