import { Buffer } from "node:buffer";
import { timestampMs } from "../normalize.js";

// Terminal session limits and the plain views of a session: its size, output,
// response, control snapshot and idle timing.
const MAX_TERMINAL_BUFFER_LENGTH = 256 * 1024;
const MAX_TERMINAL_BUFFER_ROWS = 300;
const DEFAULT_TERMINAL_COLS = 100;
const DEFAULT_TERMINAL_ROWS = 28;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MAX_TERMINAL_COLS = 300;
const MAX_TERMINAL_ROWS = 120;
const DEFAULT_QUIET_THRESHOLD_MS = 3000;
const MAX_QUIET_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_DETACHED_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const TERMINAL_KEY_INPUTS = Object.freeze({
  "ctrl-c": "\u0003",
  "enter": "\r",
  "escape": "\u001b",
  "tab": "\t"
});

function terminalSessionNotFound() {
  return {
    code: "terminal_session_not_found",
    error: "Terminal session not found.",
    ok: false
  };
}

function normalizeNamespace(namespace = "") {
  return String(namespace || "default").trim() || "default";
}

// Never written: a namespace with no started terminal has no record.
const NO_SESSIONS = new Map();

function trimBuffer(output) {
  let transcript = String(output || "");
  let rowBoundary = transcript.length;
  for (let row = 0; row < MAX_TERMINAL_BUFFER_ROWS; row += 1) {
    rowBoundary = transcript.lastIndexOf("\n", rowBoundary - 1);
    if (rowBoundary < 0) {
      break;
    }
  }
  if (rowBoundary >= 0) {
    transcript = transcript.slice(rowBoundary + 1);
  }
  if (transcript.length > MAX_TERMINAL_BUFFER_LENGTH) {
    transcript = transcript.slice(transcript.length - MAX_TERMINAL_BUFFER_LENGTH);
  }
  return transcript;
}

function isRunningSession(session = {}) {
  return session.status === "running" || session.status === "closing";
}

function sessionUsesDetachedCleanup(session = {}) {
  return isRunningSession(session) || session.status === "exited";
}

function terminalSessionMatchesFilter(session, filter) {
  try {
    return filter(terminalSessionResponse(session)) === true;
  } catch {
    return false;
  }
}

function normalizeOutputLimit(value = 0) {
  const limit = Math.floor(Number(value || 0));
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function terminalSessionOutput(output = "", options = {}) {
  const {
    outputLimit = 0
  } = options;
  const normalizedOutput = String(output || "");
  const limit = normalizeOutputLimit(outputLimit);
  if (!limit || normalizedOutput.length <= limit) {
    return {
      output: normalizedOutput,
      outputTruncated: false
    };
  }
  return {
    output: normalizedOutput.slice(normalizedOutput.length - limit),
    outputTruncated: true
  };
}

function terminalSessionResponse(session, options = {}) {
  const output = terminalSessionOutput(session.output, options);
  return {
    ok: true,
    closeError: session.closeError || "",
    cols: session.cols || DEFAULT_TERMINAL_COLS,
    createdAt: session.createdAt || "",
    id: session.id,
    commandPreview: session.commandPreview,
    exitCode: session.exitCode,
    inputVersion: session.inputVersion || 0,
    lastInputAt: session.lastInputAt || "",
    lastInputBytes: session.lastInputBytes || 0,
    lastOutputAt: session.lastOutputAt || "",
    lastOutputBytes: session.lastOutputBytes || 0,
    metadata: session.metadata || {},
    output: output.output,
    outputTruncated: output.outputTruncated,
    outputVersion: session.outputVersion || 0,
    rows: session.rows || DEFAULT_TERMINAL_ROWS,
    status: session.status
  };
}

function normalizeTerminalDimension(value, options = {}) {
  const {
    max,
    min
  } = options;
  const dimension = Math.floor(Number(value));
  if (!Number.isFinite(dimension) || dimension < min) {
    return null;
  }
  return Math.min(max, dimension);
}

function normalizeTerminalSize({
  cols,
  rows
} = {}) {
  const normalizedCols = normalizeTerminalDimension(cols, {
    max: MAX_TERMINAL_COLS,
    min: MIN_TERMINAL_COLS
  });
  const normalizedRows = normalizeTerminalDimension(rows, {
    max: MAX_TERMINAL_ROWS,
    min: MIN_TERMINAL_ROWS
  });
  if (!normalizedCols || !normalizedRows) {
    return null;
  }
  return {
    cols: normalizedCols,
    rows: normalizedRows
  };
}

function byteLength(value = "") {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function normalizeQuietThresholdMs(value = DEFAULT_QUIET_THRESHOLD_MS) {
  const threshold = Math.floor(Number(value));
  if (!Number.isFinite(threshold) || threshold < 0) {
    return DEFAULT_QUIET_THRESHOLD_MS;
  }
  return Math.min(threshold, MAX_QUIET_THRESHOLD_MS);
}

function normalizeDetachedIdleTimeoutMs(value = 0) {
  const timeout = Math.floor(Number(value));
  if (!Number.isFinite(timeout) || timeout < 0) {
    return 0;
  }
  return Math.min(timeout, MAX_DETACHED_IDLE_TIMEOUT_MS);
}

function detachedIdleStartedAtMs(session = {}) {
  return Math.max(
    timestampMs(session.lastSubscriberDetachedAt),
    timestampMs(session.lastInputAt),
    timestampMs(session.lastOutputAt),
    timestampMs(session.createdAt)
  );
}

function detachedIdleForMs(session = {}, now = Date.now()) {
  if (session.subscribers?.size) {
    return 0;
  }
  const startedAt = detachedIdleStartedAtMs(session);
  return startedAt > 0 ? Math.max(0, Number(now) - startedAt) : 0;
}

function clearDetachedCleanupTimer(session = {}) {
  if (!session.detachedCleanupTimer) {
    return;
  }
  clearTimeout(session.detachedCleanupTimer);
  session.detachedCleanupTimer = null;
}

function terminalMovementState(snapshot = {}, options = {}) {
  const {
    now = Date.now(),
    quietThresholdMs = DEFAULT_QUIET_THRESHOLD_MS
  } = options;
  const threshold = normalizeQuietThresholdMs(quietThresholdMs);
  const candidates = [
    {
      at: snapshot.lastInputAt || "",
      direction: "input"
    },
    {
      at: snapshot.lastOutputAt || "",
      direction: "output"
    },
    {
      at: snapshot.createdAt || "",
      direction: "created"
    }
  ]
    .map((candidate) => ({
      ...candidate,
      ms: timestampMs(candidate.at)
    }))
    .filter((candidate) => candidate.ms > 0)
    .sort((left, right) => right.ms - left.ms);
  const lastMovement = candidates[0] || {
    at: "",
    direction: "",
    ms: Number(now)
  };
  const idleForMs = Math.max(0, Number(now) - lastMovement.ms);
  return {
    idleForMs,
    lastMovementAt: lastMovement.at,
    lastMovementDirection: lastMovement.direction,
    quiet: idleForMs >= threshold,
    quietThresholdMs: threshold
  };
}

function terminalSessionControlSnapshot(snapshot = {}, options = {}) {
  if (!snapshot || snapshot.ok === false) {
    return snapshot;
  }
  return {
    ...snapshot,
    ...terminalMovementState(snapshot, options)
  };
}

function terminalSessionContainsText(snapshot = {}, text = "", options = {}) {
  const controlSnapshot = terminalSessionControlSnapshot(snapshot, options);
  if (!controlSnapshot || controlSnapshot.ok === false) {
    return controlSnapshot;
  }
  const needle = String(text || "");
  return {
    ...controlSnapshot,
    checkedTextLength: needle.length,
    containsText: needle ? String(controlSnapshot.output || "").includes(needle) : false
  };
}

function terminalKeyInput(key = "") {
  const normalizedKey = String(key || "").trim().toLowerCase().replace(/_/gu, "-");
  return TERMINAL_KEY_INPUTS[normalizedKey] || "";
}

export {
  byteLength,
  clearDetachedCleanupTimer,
  DEFAULT_QUIET_THRESHOLD_MS,
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  detachedIdleForMs,
  isRunningSession,
  NO_SESSIONS,
  normalizeDetachedIdleTimeoutMs,
  normalizeNamespace,
  normalizeTerminalSize,
  sessionUsesDetachedCleanup,
  terminalKeyInput,
  terminalSessionContainsText,
  terminalSessionControlSnapshot,
  terminalSessionMatchesFilter,
  terminalSessionNotFound,
  terminalSessionResponse,
  trimBuffer
};
