import { isVibe64DebugLoggingEnabled } from "@local/vibe64-core/shared";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const VIBE64_SESSION_DEBUG_MARKER = "VIBE64_SESSION_DEBUG";
const VIBE64_SESSION_DEBUG_ENV = "VIBE64_SESSION_DEBUG";

// The env that turns session debug logging on, named once by the server at startup; none logs nothing.
let sessionDebugEnv = Object.freeze({});

/**
 * Names the env whose VIBE64_SESSION_DEBUG flag or debug log level turns session debug logging on.
 * @param {RuntimeEnv} env the server's runtime env
 */
function configureVibe64SessionDebugLog(env) {
  sessionDebugEnv = env;
}

function normalizeErrorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) ? status : null;
}

function normalizeErrorStack(error = {}) {
  return typeof error.stack === "string" ? error.stack : "";
}

function normalizeErrorCause(error) {
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
    code: String(error.code || ""),
    message: String(error.message || error || ""),
    name: String(error.name || ""),
    status: normalizeErrorStatus(error),
    stack: normalizeErrorStack(error),
    cause: normalizeErrorCause(error)
  };
}

function vibe64SessionDebugDurationMs(startedAtMs) {
  return Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
}

/** @param {{ level?: string }} [options] a log level that wins over the configured env's */
function vibe64SessionDebugEnabled({ level = "" } = {}) {
  return isVibe64DebugLoggingEnabled({
    env: sessionDebugEnv,
    flagName: VIBE64_SESSION_DEBUG_ENV,
    level
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
  // readable-check: allow method-probe - platform object: a runtime may have no console
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

function vibe64SessionDebugSummary(session) {
  return {
    revision: Number(session?.revision) || 0,
    sessionId: String(session?.sessionId || ""),
    sourceReady: session?.sourceReady === true,
    status: String(session?.status || "")
  };
}

export {
  configureVibe64SessionDebugLog,
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
};
