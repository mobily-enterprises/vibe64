// When a session's outputs can be loaded, how loading them is retried, and how
// a failed load is described.
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { isArchivedVibe64Session } from "@/lib/vibe64SessionViewModel.js";
import { vibe64RealtimePayloadFromCurrentTab } from "@/lib/vibe64BrowserTabOrigin.js";

const LAUNCH_STATUS_RETRY_LIMIT = 2;
const LAUNCH_STATUS_RETRY_BASE_DELAY_MS = 1000;
const LAUNCH_STATUS_RETRY_MAX_DELAY_MS = 5000;
const OUTPUTS_REALTIME_REASONS = new Set([
  "preview-test-state-changed",
  "output-target-started",
  "output-target-ready",
  "output-target-closed",
  "output-target-stopped",
  "output-target-stale-cleared",
  "output-results-ready",
  "output-results-failed"
]);

function outputTargetWorktreePath(session = {}) {
  return String(session?.sourcePath || "");
}

function launchControlsSessionCanRun(session = {}) {
  const metadata = normalizeObject(session?.metadata);
  return Boolean(
    String(session?.sessionId || "").trim() &&
    !isArchivedVibe64Session(session) &&
    !String(metadata.session_closing_reason || "").trim() &&
    outputTargetWorktreePath(session)
  );
}

function launchControlsCanLoadTargets({
  displayed = true,
  session = {},
  sourceOperationsSuspended = false
} = {}) {
  return Boolean(
    displayed &&
    sourceOperationsSuspended !== true &&
    launchControlsSessionCanRun(session)
  );
}

function launchControlScopeKey(projectSlug = "", sessionId = "") {
  return `${String(projectSlug || "").trim()}::${String(sessionId || "").trim()}`;
}

function outputTargetsRealtimeShouldRefresh({
  localLaunchStarting = false,
  payload = {}
} = {}, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!normalizedSessionId || changedSessionId !== normalizedSessionId) {
    return false;
  }
  const reason = String(payload.reason || "").trim();
  if (
    reason === "output-target-started" &&
    (localLaunchStarting || vibe64RealtimePayloadFromCurrentTab(payload))
  ) {
    return false;
  }
  return payload.clientRefresh?.includeOutputs === true ||
    !reason ||
    OUTPUTS_REALTIME_REASONS.has(reason);
}

function launchStatusRetryDelay(attempt = 0) {
  const attemptNumber = Math.max(0, Number(attempt) || 0);
  return Math.min(
    LAUNCH_STATUS_RETRY_MAX_DELAY_MS,
    LAUNCH_STATUS_RETRY_BASE_DELAY_MS * (attemptNumber + 1)
  );
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) ? status : null;
}

function launchStatusShouldRetry(failureCount = 0, error = null) {
  if (Math.max(0, Number(failureCount) || 0) >= LAUNCH_STATUS_RETRY_LIMIT) {
    return false;
  }
  if (launchStatusAgentWriteBusy(error)) {
    return true;
  }
  const status = normalizeHttpStatus(error?.status ?? error?.statusCode);
  return status == null ||
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500;
}

function launchStatusErrorText({
  error = null,
  fallback = "",
  path = ""
} = {}) {
  const fallbackText = String(fallback || "").trim();
  if (!error) {
    return fallbackText;
  }
  if (launchStatusAgentWriteBusy(error)) {
    return "";
  }
  const message = String(error?.message || fallbackText || "Request failed.").trim();
  const status = normalizeHttpStatus(error?.status ?? error?.statusCode);
  const code = String(error?.code || "").trim();
  const requestPath = String(path || error?.path || error?.url || "").trim();
  const details = [
    status === 0 ? "network" : status == null ? "" : `HTTP ${status}`,
    code,
    requestPath
  ].filter(Boolean).join(", ");
  return details ? `${message} (${details})` : message;
}

function launchStatusAgentWriteBusy(error = null) {
  const code = String(
    error?.code ||
    error?.response?.code ||
    error?.response?.errors?.[0]?.code ||
    ""
  ).trim();
  return code === "vibe64_agent_write_mode_busy" || code === "VIBE64_TRAINING_PREPARATION_BUSY";
}

export {
  LAUNCH_STATUS_RETRY_LIMIT,
  launchControlScopeKey,
  launchControlsCanLoadTargets,
  launchControlsSessionCanRun,
  launchStatusAgentWriteBusy,
  launchStatusErrorText,
  launchStatusRetryDelay,
  launchStatusShouldRetry,
  outputTargetWorktreePath,
  outputTargetsRealtimeShouldRefresh
};
