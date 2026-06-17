import {
  isVibe64BrowserFlagEnabled,
  isVibe64DebugLoggingEnabled
} from "@local/vibe64-core/shared";

const VIBE64_SESSION_DEBUG_MARKER = "VIBE64_SESSION_DEBUG";
const VIBE64_SESSION_DEBUG_ENV = "VIBE64_SESSION_DEBUG";
const VIBE64_SESSION_DEBUG_QUERY_PARAM = "vibe64_session_debug";
const VIBE64_SESSION_DEBUG_STORAGE_KEY = "vibe64:session-debug";

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

function vibe64SessionDebugEnabled({
  env = globalThis?.process?.env || {},
  globalObject = globalThis,
  level = ""
} = {}) {
  return isVibe64DebugLoggingEnabled({
    env,
    flagName: VIBE64_SESSION_DEBUG_ENV,
    level
  }) || isVibe64BrowserFlagEnabled({
    globalObject,
    queryParam: VIBE64_SESSION_DEBUG_QUERY_PARAM,
    storageKey: VIBE64_SESSION_DEBUG_STORAGE_KEY
  });
}

function vibe64SessionDebugLog(event = "", details = {}, options = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    marker: VIBE64_SESSION_DEBUG_MARKER,
    timestamp,
    event: String(event || ""),
    ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
  };
  entry.marker = VIBE64_SESSION_DEBUG_MARKER;
  entry.timestamp = timestamp;

  if (!vibe64SessionDebugEnabled(options)) {
    return entry;
  }

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
  VIBE64_SESSION_DEBUG_ENV,
  VIBE64_SESSION_DEBUG_MARKER,
  VIBE64_SESSION_DEBUG_QUERY_PARAM,
  VIBE64_SESSION_DEBUG_STORAGE_KEY,
  vibe64SessionDebugEnabled,
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
};
