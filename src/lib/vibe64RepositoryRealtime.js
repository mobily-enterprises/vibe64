// Session-change reasons, as the sessions and terminals servers publish them,
// after which a session's repository status may differ.
const REPOSITORY_STATUS_SESSION_REASONS = new Set([
  "claude-stream-turn-idle",
  "codex-app-server-turn-idle",
  "opencode-server-turn-idle",
  "repository-canonical-changed",
  "session-pull-request",
  "session-repository-checked",
  "session-save-completed",
  "session-save-failed",
  "session-save-started",
  "session-save-update-required",
  "session-starter-applied",
  "session-turn-checkpoint-failed",
  "session-turn-checkpoint-updated",
  "session-update-completed",
  "session-update-failed",
  "session-update-started"
]);

// The server's update probe could not check a session; the payload carries
// repositoryUpdateCheckError. Only the session's repository status shows it.
const REPOSITORY_UPDATE_CHECK_FAILED_REASON = "session-repository-check-failed";

const REPOSITORY_CANONICAL_RECHECK_REASONS = new Set([
  "repository-canonical-changed",
  "session-pull-request",
  "session-save-failed",
  "session-save-update-required",
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
  REPOSITORY_CANONICAL_RECHECK_REASONS,
  REPOSITORY_STATUS_SESSION_REASONS,
  REPOSITORY_UPDATE_CHECK_FAILED_REASON,
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
};
