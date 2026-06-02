const VIBE64_SESSION_DEBUG_MARKER = "VIBE64_SESSION_DEBUG";

function normalizeErrorStatus(error = {}) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) ? status : null;
}

function normalizeErrorStack(error = {}) {
  return typeof error?.stack === "string" ? error.stack : "";
}

function normalizeErrorCause(error = {}) {
  const cause = error?.cause;
  if (!cause) {
    return null;
  }
  return {
    code: String(cause?.code || ""),
    message: String(cause?.message || cause || ""),
    name: String(cause?.name || ""),
    status: normalizeErrorStatus(cause),
    stack: normalizeErrorStack(cause)
  };
}

function vibe64SessionDebugError(error = {}) {
  return {
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
    name: String(error?.name || ""),
    status: normalizeErrorStatus(error),
    stack: normalizeErrorStack(error),
    cause: normalizeErrorCause(error)
  };
}

function vibe64SessionDebugDurationMs(startedAtMs) {
  return Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
}

function vibe64SessionDebugLog(event = "", details = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    marker: VIBE64_SESSION_DEBUG_MARKER,
    timestamp,
    event: String(event || ""),
    ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
  };
  entry.marker = VIBE64_SESSION_DEBUG_MARKER;
  entry.timestamp = timestamp;

  const logger = globalThis.console;
  if (!logger || typeof logger.info !== "function") {
    return entry;
  }

  try {
    logger.info(`[${VIBE64_SESSION_DEBUG_MARKER}] ${JSON.stringify(entry)}`);
  } catch {
    logger.info(`[${VIBE64_SESSION_DEBUG_MARKER}] ${timestamp} ${entry.event}`);
  }
  return entry;
}

function vibe64SessionDebugSummary(session = {}) {
  return {
    currentStep: String(session?.currentStep || ""),
    nextEnabled: session?.next?.enabled === true,
    nextStepId: String(session?.next?.stepId || ""),
    sessionId: String(session?.sessionId || ""),
    status: String(session?.status || ""),
    stepStatus: String(session?.stepMachine?.status || "")
  };
}

export {
  VIBE64_SESSION_DEBUG_MARKER,
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
};
