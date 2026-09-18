import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import path from "node:path";
import { spawn as spawnPty } from "node-pty";

import {
  drainProcessGroup
} from "./detached.js";

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
const stores = new Map();
const namespaceAdmissions = new Map();
const namespaceOperationCounts = new Map();

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

function sessionsForNamespace(namespace) {
  const normalizedNamespace = normalizeNamespace(namespace);
  if (!stores.has(normalizedNamespace)) {
    stores.set(normalizedNamespace, new Map());
  }
  return stores.get(normalizedNamespace);
}

function terminalNamespaceAdmission(namespace = "default") {
  return namespaceAdmissions.get(normalizeNamespace(namespace)) || null;
}

function terminalNamespaceAdmissionFailure(namespace = "default") {
  const admission = terminalNamespaceAdmission(namespace);
  if (!admission) {
    return null;
  }
  return {
    code: admission.code,
    error: admission.error,
    ok: false
  };
}

function freezeTerminalNamespaceAdmission(namespace = "default", {
  code = "terminal_admission_frozen",
  error = "Terminal input is temporarily unavailable.",
  owner = ""
} = {}) {
  const normalizedNamespace = normalizeNamespace(namespace);
  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner) {
    throw new TypeError("Terminal admission freeze requires an owner.");
  }
  const current = namespaceAdmissions.get(normalizedNamespace);
  if (current && current.owner !== normalizedOwner) {
    return {
      code: "terminal_admission_conflict",
      error: "Terminal input is already frozen by another operation.",
      ok: false
    };
  }
  if (!current && Number(namespaceOperationCounts.get(normalizedNamespace) || 0) > 0) {
    return {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    };
  }
  const admission = current || {
    code: String(code || "terminal_admission_frozen").trim() || "terminal_admission_frozen",
    error: String(error || "Terminal input is temporarily unavailable.").trim() ||
      "Terminal input is temporarily unavailable.",
    owner: normalizedOwner
  };
  namespaceAdmissions.set(normalizedNamespace, admission);
  return {
    frozen: true,
    namespace: normalizedNamespace,
    ok: true,
    owner: normalizedOwner
  };
}

function beginTerminalNamespaceOperation(namespace = "default") {
  const normalizedNamespace = normalizeNamespace(namespace);
  const failure = terminalNamespaceAdmissionFailure(normalizedNamespace);
  if (failure) {
    return failure;
  }
  namespaceOperationCounts.set(
    normalizedNamespace,
    Number(namespaceOperationCounts.get(normalizedNamespace) || 0) + 1
  );
  let released = false;
  return {
    namespace: normalizedNamespace,
    ok: true,
    release() {
      if (released) {
        return;
      }
      released = true;
      const remaining = Number(namespaceOperationCounts.get(normalizedNamespace) || 0) - 1;
      if (remaining > 0) {
        namespaceOperationCounts.set(normalizedNamespace, remaining);
      } else {
        namespaceOperationCounts.delete(normalizedNamespace);
      }
    }
  };
}

function thawTerminalNamespaceAdmission(namespace = "default", {
  owner = ""
} = {}) {
  const normalizedNamespace = normalizeNamespace(namespace);
  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner) {
    throw new TypeError("Terminal admission thaw requires an owner.");
  }
  const current = namespaceAdmissions.get(normalizedNamespace);
  if (!current) {
    return {
      frozen: false,
      namespace: normalizedNamespace,
      ok: true,
      owner: normalizedOwner
    };
  }
  if (current.owner !== normalizedOwner) {
    return {
      code: "terminal_admission_conflict",
      error: "Terminal input is frozen by another operation.",
      ok: false
    };
  }
  namespaceAdmissions.delete(normalizedNamespace);
  return {
    frozen: false,
    namespace: normalizedNamespace,
    ok: true,
    owner: normalizedOwner
  };
}

function namespacesForPrefix(namespacePrefix = "") {
  const normalizedPrefix = String(namespacePrefix || "");
  return [...stores.keys()].filter((namespace) => namespace.startsWith(normalizedPrefix));
}

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

function terminalSessionMatchesFilter(session = {}, filter = null) {
  if (typeof filter !== "function") {
    return true;
  }
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

function terminalSessionOutput(output = "", {
  outputLimit = 0
} = {}) {
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

function normalizeTerminalDimension(value, {
  max,
  min
} = {}) {
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

function applySessionMetadata(session, metadata = {}) {
  if (!session || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return terminalSessionResponse(session);
  }
  session.metadata = {
    ...(session.metadata || {}),
    ...metadata
  };
  sendToSubscribers(session, {
    metadata: session.metadata,
    type: "metadata"
  });
  return terminalSessionResponse(session);
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

function timestampMs(value = "") {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
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
  if (session?.subscribers?.size) {
    return 0;
  }
  const startedAt = detachedIdleStartedAtMs(session);
  return startedAt > 0 ? Math.max(0, Number(now) - startedAt) : 0;
}

function clearDetachedCleanupTimer(session = {}) {
  if (!session?.detachedCleanupTimer) {
    return;
  }
  clearTimeout(session.detachedCleanupTimer);
  session.detachedCleanupTimer = null;
}

function scheduleDetachedCleanup(session = {}, namespace = "default") {
  clearDetachedCleanupTimer(session);
  if (!sessionUsesDetachedCleanup(session) || session?.subscribers?.size) {
    return;
  }
  const timeoutMs = normalizeDetachedIdleTimeoutMs(session.detachedIdleTimeoutMs);
  if (timeoutMs < 1) {
    return;
  }
  const remainingMs = Math.max(0, timeoutMs - detachedIdleForMs(session));
  session.detachedCleanupTimer = setTimeout(() => {
    session.detachedCleanupTimer = null;
    void closeDetachedTerminalSessions({
      namespace
    });
  }, remainingMs);
}

function terminalMovementState(snapshot = {}, {
  now = Date.now(),
  quietThresholdMs = DEFAULT_QUIET_THRESHOLD_MS
} = {}) {
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

function readTerminalSessionControlState(id, {
  namespace = "default",
  quietThresholdMs = DEFAULT_QUIET_THRESHOLD_MS
} = {}) {
  return terminalSessionControlSnapshot(readTerminalSession(id, {
    namespace
  }), {
    quietThresholdMs
  });
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

async function writeTerminalSessionText(id, text = "", {
  namespace = "default",
  quietThresholdMs = DEFAULT_QUIET_THRESHOLD_MS
} = {}) {
  return terminalSessionControlSnapshot(writeTerminalSession(id, text, {
    namespace
  }), {
    quietThresholdMs
  });
}

function writeTerminalSessionKey(id, key = "", {
  namespace = "default",
  quietThresholdMs = DEFAULT_QUIET_THRESHOLD_MS
} = {}) {
  const input = terminalKeyInput(key);
  if (!input) {
    return {
      ok: false,
      error: `Unsupported terminal key: ${String(key || "")}`
    };
  }
  return terminalSessionControlSnapshot(writeTerminalSession(id, input, {
    namespace
  }), {
    quietThresholdMs
  });
}

function recordTerminalInput(session, data = "") {
  const bytes = byteLength(data);
  if (bytes < 1) {
    return;
  }
  session.inputVersion = Number(session.inputVersion || 0) + 1;
  session.lastInputAt = new Date().toISOString();
  session.lastInputBytes = bytes;
}

function recordTerminalOutput(session, data = "") {
  const bytes = byteLength(data);
  if (bytes < 1) {
    return;
  }
  session.outputVersion = Number(session.outputVersion || 0) + 1;
  session.lastOutputAt = new Date().toISOString();
  session.lastOutputBytes = bytes;
}

function sendToSubscribers(session, message) {
  if (!session?.subscribers?.size) {
    return;
  }
  for (const subscriber of [...session.subscribers]) {
    try {
      subscriber(message);
    } catch {
      session.subscribers.delete(subscriber);
    }
  }
}

function terminalErrorDetails(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "Terminal PTY error.");
  return {
    code,
    message
  };
}

function reportTerminalWriteError(session, error) {
  if (!session) {
    return;
  }
  const details = terminalErrorDetails(error);
  session.lastWriteErrorAt = new Date().toISOString();
  session.lastWriteErrorCode = details.code;
  session.lastWriteError = details.message;
  console.warn("Vibe64 terminal PTY write error.", {
    code: details.code,
    id: session.id,
    metadata: session.metadata || {},
    message: details.message,
    namespace: session.namespace || ""
  });
  sendToSubscribers(session, {
    code: details.code,
    error: details.message,
    type: "error"
  });
}

function attachTerminalWriteErrorHandler(session) {
  const writeStream = session?.terminal?._writeStream;
  if (!writeStream || typeof writeStream.on !== "function") {
    return;
  }
  writeStream.on("error", (error) => {
    reportTerminalWriteError(session, error);
  });
}

function listStoredSessions({ namespace = "", namespacePrefix = "", runningOnly = false } = {}) {
  const namespaces = namespace
    ? [normalizeNamespace(namespace)]
    : namespacesForPrefix(namespacePrefix);
  const results = [];
  for (const currentNamespace of namespaces) {
    const sessions = sessionsForNamespace(currentNamespace);
    for (const session of sessions.values()) {
      if (runningOnly && !isRunningSession(session)) {
        continue;
      }
      results.push({
        namespace: currentNamespace,
        session
      });
    }
  }
  return results;
}

function countRunningTerminalSessions({
  filter = null,
  namespacePrefix = ""
} = {}) {
  return listStoredSessions({
    namespacePrefix,
    runningOnly: true
  }).filter((entry) => terminalSessionMatchesFilter(entry.session, filter)).length;
}

function pathIsWithinRoot(pathValue = "", rootValue = "") {
  const root = String(rootValue || "").trim();
  const source = String(pathValue || "").trim();
  if (!root || !source) {
    return false;
  }
  const normalizedRoot = path.resolve(root);
  const normalizedSource = path.resolve(source);
  return normalizedSource === normalizedRoot || normalizedSource.startsWith(`${normalizedRoot}${path.sep}`);
}

function listTerminalSessions({
  namespace = "",
  namespacePrefix = "",
  outputLimit = 0,
  runningOnly = false
} = {}) {
  return listStoredSessions({
    namespace,
    namespacePrefix,
    runningOnly
  }).map((entry) => ({
    namespace: entry.namespace,
    ...terminalSessionResponse(entry.session, {
      outputLimit
    })
  }));
}

async function runCloseHook(session, reason) {
  if (!session || session.closeHookStarted) {
    return;
  }
  session.closeHookStarted = true;
  if (typeof session.onClose !== "function") {
    return null;
  }
  try {
    await session.onClose({
      exitCode: session.exitCode,
      id: session.id,
      output: session.output,
      reason,
      status: session.status
    });
    return null;
  } catch (error) {
    const message = String(error?.message || error || "Terminal finalization failed.");
    const failure = error instanceof Error ? error : new Error(message);
    failure.code ||= "terminal_close_hook_failed";
    const chunk = `\r\n[studio] Terminal finalization failed: ${message}\r\n`;
    session.closeError = message;
    session.output = trimBuffer(`${session.output}${chunk}`);
    sendToSubscribers(session, {
      chunk,
      type: "output"
    });
    sendToSubscribers(session, {
      error: message,
      type: "error"
    });
    return failure;
  }
}

async function runStopHook(session, reason) {
  if (!session || session.stopHookStarted) {
    return;
  }
  session.stopHookStarted = true;
  if (typeof session.onStop !== "function") {
    return null;
  }
  try {
    await session.onStop({
      id: session.id,
      output: session.output,
      reason,
      status: session.status
    });
    return null;
  } catch (error) {
    const message = String(error?.message || error || "Terminal stop failed.");
    const failure = error instanceof Error ? error : new Error(message);
    failure.code ||= "terminal_stop_hook_failed";
    const chunk = `\r\n[studio] Terminal stop failed: ${message}\r\n`;
    session.closeError = message;
    session.output = trimBuffer(`${session.output}${chunk}`);
    sendToSubscribers(session, {
      chunk,
      type: "output"
    });
    sendToSubscribers(session, {
      error: message,
      type: "error"
    });
    return failure;
  }
}

function reportTerminalLifecycleFailure(session, error) {
  const key = `${String(error?.code || "terminal_cleanup_failed")}:${String(error?.message || "")}`;
  session.reportedLifecycleFailures ||= new Set();
  if (session.reportedLifecycleFailures.has(key)) {
    return error;
  }
  session.reportedLifecycleFailures.add(key);
  const message = String(error?.message || error || "Terminal cleanup failed.");
  const chunk = `\r\n[studio] ${message}\r\n`;
  session.closeError = message;
  session.output = trimBuffer(`${session.output}${chunk}`);
  sendToSubscribers(session, {
    chunk,
    type: "output"
  });
  sendToSubscribers(session, {
    error: message,
    type: "error"
  });
  return error;
}

function terminalCloseAggregateFailure(session, failures = []) {
  const error = new AggregateError(
    failures,
    `Terminal session could not close cleanly: ${session.id}`
  );
  error.code = failures.some((failure) => String(failure?.code || "").startsWith("terminal_exit_"))
    ? "terminal_exit_unverified"
    : "terminal_cleanup_failed";
  error.terminalSessionId = session.id;
  return error;
}

function beginTerminalStopHook(session, reason) {
  if (!session.stopHookCompletion) {
    session.stopHookCompletion = Promise.resolve().then(() => runStopHook(session, reason));
  }
  return session.stopHookCompletion;
}

function beginTerminalCloseHook(session, reason) {
  if (!session.closeHookCompletion) {
    session.closeHookCompletion = Promise.resolve().then(() => runCloseHook(session, reason));
  }
  return session.closeHookCompletion;
}

function markTerminalExited(session) {
  if (session.status === "exited") {
    return;
  }
  session.status = "exited";
  sendToSubscribers(session, {
    closeError: session.closeError || "",
    exitCode: session.exitCode,
    status: session.status,
    type: "status"
  });
}

function beginTerminalScopeDrain(session) {
  if (!session.scopeDrainCompletion) {
    session.scopeDrainCompletion = (async () => {
      if (process.platform !== "win32" && !await drainProcessGroup(session.terminal.pid)) {
        const error = new Error(`Terminal execution scope did not become empty: ${session.id}`);
        error.code = "terminal_execution_drain_failed";
        throw error;
      }
    })();
    session.scopeDrainCompletion.catch(() => null);
  }
  return session.scopeDrainCompletion;
}

async function settleTerminalExitStatus(session) {
  try {
    await session.scopeDrainCompletion;
  } catch (error) {
    reportTerminalLifecycleFailure(session, error);
  }
  try {
    await Promise.all([
      beginTerminalCloseHook(session, session.stopReason || "exit"),
      session.stopHookCompletion
    ]);
  } catch (error) {
    reportTerminalLifecycleFailure(session, error);
  }
  markTerminalExited(session);
}

function startTerminalSession({
  args,
  command,
  commandPreview,
  cwd = process.cwd(),
  env = {},
  maxRunning = 0,
  metadata = null,
  namespace = "default",
  namespaceLimitPrefix = "",
  runningLimitFilter = null,
  onClose = null,
  onOutput = null,
  onStop = null,
  reuseRunning = false,
  detachedIdleTimeoutMs = 0
}) {
  const admissionFailure = terminalNamespaceAdmissionFailure(namespace);
  if (admissionFailure) {
    return admissionFailure;
  }
  const sessions = sessionsForNamespace(namespace);
  const id = crypto.randomUUID();
  const canReuseRunningSession = typeof reuseRunning === "function"
    ? reuseRunning
    : () => Boolean(reuseRunning);
  const existingSession = reuseRunning
    ? [...sessions.values()].find((session) => isRunningSession(session) && canReuseRunningSession(session))
    : null;
  if (existingSession) {
    return terminalSessionResponse(existingSession);
  }

  const runningLimit = Number(maxRunning || 0);
  const runningLimitPrefix = namespaceLimitPrefix || namespace;
  if (runningLimit > 0 && countRunningTerminalSessions({
    filter: runningLimitFilter,
    namespacePrefix: runningLimitPrefix
  }) >= runningLimit) {
    return {
      ok: false,
      code: "terminal_limit",
      error: `Terminal limit reached (${runningLimit}).`
    };
  }

  const resolvedEnv = typeof env === "function"
    ? env({
      id,
      namespace
    })
    : env;
  const resolvedArgs = typeof args === "function"
    ? args({
      env: resolvedEnv,
      id,
      namespace
    })
    : args;
  const resolvedCommandPreview = typeof commandPreview === "function"
    ? commandPreview({
      args: resolvedArgs,
      env: resolvedEnv,
      id,
      namespace
    })
    : commandPreview;
  const resolvedMetadata = typeof metadata === "function"
    ? metadata({
      args: resolvedArgs,
      env: resolvedEnv,
      id,
      namespace
    })
    : metadata;
  const terminal = spawnPty(command, resolvedArgs, {
    cols: DEFAULT_TERMINAL_COLS,
    cwd,
    env: {
      ...process.env,
      ...(resolvedEnv && typeof resolvedEnv === "object" && !Array.isArray(resolvedEnv) ? resolvedEnv : {})
    },
    name: "xterm-color",
    rows: DEFAULT_TERMINAL_ROWS
  });

  let resolveExitCompletion;
  const exitCompletion = new Promise((resolve) => {
    resolveExitCompletion = resolve;
  });
  const session = {
    id,
    closeHookCompletion: null,
    closePromise: null,
    commandPreview: resolvedCommandPreview,
    cols: DEFAULT_TERMINAL_COLS,
    createdAt: new Date().toISOString(),
    cwd,
    detachedCleanupTimer: null,
    detachedIdleTimeoutMs: normalizeDetachedIdleTimeoutMs(detachedIdleTimeoutMs),
    exitCompletion,
    exitCode: null,
    lastSubscriberAttachedAt: "",
    lastSubscriberDetachedAt: new Date().toISOString(),
    metadata: resolvedMetadata && typeof resolvedMetadata === "object" && !Array.isArray(resolvedMetadata)
      ? resolvedMetadata
      : {},
    onClose,
    onStop,
    inputVersion: 0,
    lastInputAt: "",
    lastInputBytes: 0,
    lastOutputAt: "",
    lastOutputBytes: 0,
    lastWriteError: "",
    lastWriteErrorAt: "",
    lastWriteErrorCode: "",
    output: "",
    outputVersion: 0,
    processExited: false,
    killStarted: false,
    reportedLifecycleFailures: new Set(),
    resolveExitCompletion,
    rows: DEFAULT_TERMINAL_ROWS,
    status: "running",
    stopHookCompletion: null,
    scopeDrainCompletion: null,
    namespace,
    subscribers: new Set(),
    terminal
  };
  attachTerminalWriteErrorHandler(session);

  terminal.onData((data) => {
    recordTerminalOutput(session, data);
    session.output = trimBuffer(session.output + data);
    sendToSubscribers(session, {
      chunk: data,
      lastOutputAt: session.lastOutputAt,
      outputVersion: session.outputVersion,
      type: "output"
    });
    if (typeof onOutput === "function") {
      try {
        onOutput({
          chunk: data,
          output: session.output,
          session: terminalSessionResponse(session),
          updateMetadata(metadata) {
            return applySessionMetadata(session, metadata);
          }
        });
      } catch (error) {
        const message = String(error?.message || error || "Terminal output hook failed.");
        sendToSubscribers(session, {
          error: message,
          type: "error"
        });
      }
    }
    scheduleDetachedCleanup(session, namespace);
  });

  terminal.onExit(({ exitCode }) => {
    session.processExited = true;
    session.exitCode = exitCode;
    session.status = "closing";
    beginTerminalScopeDrain(session);
    sendToSubscribers(session, {
      exitCode,
      status: session.status,
      type: "status"
    });
    beginTerminalCloseHook(session, session.stopReason || "exit");
    session.resolveExitCompletion();
    void settleTerminalExitStatus(session);
  });

  sessions.set(id, session);
  scheduleDetachedCleanup(session, namespace);
  return readTerminalSession(id, { namespace });
}

function readTerminalSession(id, { namespace = "default", outputLimit = 0 } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }

  return terminalSessionResponse(session, {
    outputLimit
  });
}

function updateTerminalSessionMetadata(id, metadata = {}, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }
  return applySessionMetadata(session, metadata);
}

function subscribeTerminalSession(id, subscriber, { namespace = "default", outputLimit = 0 } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }
  if (typeof subscriber !== "function") {
    return {
      ok: false,
      error: "Terminal subscriber must be a function."
    };
  }

  session.subscribers.add(subscriber);
  session.lastSubscriberAttachedAt = new Date().toISOString();
  clearDetachedCleanupTimer(session);
  return {
    ...terminalSessionResponse(session, {
      outputLimit
    }),
    unsubscribe() {
      session.subscribers.delete(subscriber);
      if (session.subscribers.size < 1) {
        session.lastSubscriberDetachedAt = new Date().toISOString();
        scheduleDetachedCleanup(session, namespace);
      }
    }
  };
}

function writeTerminalSession(id, data, { namespace = "default" } = {}) {
  const admissionFailure = terminalNamespaceAdmissionFailure(namespace);
  if (admissionFailure) {
    return admissionFailure;
  }
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }
  if (session.status !== "running") {
    return readTerminalSession(id, { namespace });
  }

  const input = String(data || "");
  if (input) {
    recordTerminalInput(session, input);
    try {
      session.terminal.write(input);
    } catch (error) {
      reportTerminalWriteError(session, error);
      return readTerminalSession(id, { namespace });
    }
    scheduleDetachedCleanup(session, namespace);
  }
  return readTerminalSession(id, { namespace });
}

function resizeTerminalSession(id, size = {}, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }

  const nextSize = normalizeTerminalSize(size);
  if (!nextSize) {
    return {
      ok: false,
      error: "Terminal size must include valid cols and rows."
    };
  }

  if (session.cols === nextSize.cols && session.rows === nextSize.rows) {
    return terminalSessionResponse(session);
  }

  if (session.status === "running" || session.status === "closing") {
    try {
      session.terminal.resize(nextSize.cols, nextSize.rows);
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || "Terminal resize failed.")
      };
    }
  }
  session.cols = nextSize.cols;
  session.rows = nextSize.rows;
  return terminalSessionResponse(session);
}

async function beginTerminalStop(session, reason = "stop") {
  if (!session || session.processExited) {
    return {
      failures: []
    };
  }
  session.stopReason ||= String(reason || "stop");
  if (session.status === "running") {
    session.status = "closing";
    sendToSubscribers(session, {
      exitCode: session.exitCode,
      status: session.status,
      type: "status"
    });
  }
  const failures = [];
  // Cleanup and process termination have independent completion signals.
  // A queued hook must neither keep the child alive nor be declared failed.
  beginTerminalStopHook(session, session.stopReason);
  if (!session.processExited && !session.killStarted) {
    session.killStarted = true;
    try {
      session.terminal.kill();
    } catch (error) {
      session.killStarted = false;
      const failure = error instanceof Error
        ? error
        : new Error(String(error || "Terminal process could not be killed."));
      failure.code ||= "terminal_kill_failed";
      failures.push(reportTerminalLifecycleFailure(session, failure));
    }
  }
  try {
    await beginTerminalScopeDrain(session);
  } catch (error) {
    failures.push(reportTerminalLifecycleFailure(session, error));
  }
  return {
    failures
  };
}

function stopTerminalSession(id, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }

  if (session.status === "running") {
    void beginTerminalStop(session, "stop");
  }

  return terminalSessionResponse(session);
}

async function closeTerminalSession(id, {
  namespace = "default"
} = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: true,
      closed: false
    };
  }
  if (session.closePromise) {
    return session.closePromise;
  }

  const closing = (async () => {
    const fatalFailures = [];
    clearDetachedCleanupTimer(session);
    if (!session.processExited) {
      const stopped = await beginTerminalStop(session, "close");
      if (stopped.failures.length) {
        throw terminalCloseAggregateFailure(session, stopped.failures);
      }
    }
    try {
      await session.exitCompletion;
    } catch (error) {
      fatalFailures.push(reportTerminalLifecycleFailure(session, error));
    }
    try {
      await session.scopeDrainCompletion;
    } catch (error) {
      fatalFailures.push(reportTerminalLifecycleFailure(session, error));
    }

    const hookResults = await Promise.all([
      session.stopHookCompletion,
      session.closeHookCompletion
    ]);
    const cleanupWarnings = hookResults.filter(Boolean);

    if (session.processExited) {
      markTerminalExited(session);
    }

    if (fatalFailures.length > 0) {
      throw terminalCloseAggregateFailure(session, [
        ...fatalFailures,
        ...cleanupWarnings
      ]);
    }
    sessions.delete(id);

    return {
      ok: true,
      closed: true,
      ...(cleanupWarnings.length > 0 ? {
        cleanupErrors: cleanupWarnings.map((error) => String(error?.message || error))
      } : {})
    };
  })();
  session.closePromise = closing;
  try {
    return await closing;
  } finally {
    if (session.closePromise === closing) {
      session.closePromise = null;
    }
  }
}

function terminalSessionCloseFailure(reason, { id, namespace }) {
  const cause = reason instanceof Error
    ? reason
    : new Error(String(reason || "Terminal close failed."));
  const error = new Error(
    `Failed to close terminal session "${id}" in namespace "${namespace}": ${cause.message}`,
    { cause }
  );
  error.code = String(cause.code || "terminal_close_failed");
  error.namespace = namespace;
  error.terminalSessionId = id;
  return error;
}

async function closeTerminalSessionTargets(targets = []) {
  const uniqueTargets = [...new Map(targets.map((target) => {
    const normalizedTarget = {
      id: String(target?.id || ""),
      namespace: normalizeNamespace(target?.namespace)
    };
    return [`${normalizedTarget.namespace}\u0000${normalizedTarget.id}`, normalizedTarget];
  })).values()].filter((target) => target.id);
  const results = await Promise.allSettled(uniqueTargets.map((target) => (
    closeTerminalSession(target.id, {
      namespace: target.namespace
    })
  )));
  let closed = 0;
  const failures = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      if (result.value.closed) {
        closed += 1;
      }
      continue;
    }
    failures.push(terminalSessionCloseFailure(result.reason, uniqueTargets[index]));
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to close ${failures.length} of ${uniqueTargets.length} terminal sessions.`
    );
  }
  return closed;
}

async function closeDetachedTerminalSessions({
  idleMs = null,
  namespace = "",
  namespacePrefix = "",
  now = Date.now()
} = {}) {
  let closed = 0;
  for (const { namespace: currentNamespace, session } of listStoredSessions({
    namespace,
    namespacePrefix
  })) {
    if (!sessionUsesDetachedCleanup(session) || session.subscribers?.size) {
      continue;
    }
    const timeoutMs = idleMs == null
      ? normalizeDetachedIdleTimeoutMs(session.detachedIdleTimeoutMs)
      : normalizeDetachedIdleTimeoutMs(idleMs);
    if (timeoutMs < 1 && idleMs == null) {
      continue;
    }
    if (detachedIdleForMs(session, now) < timeoutMs) {
      scheduleDetachedCleanup(session, currentNamespace);
      continue;
    }
    const result = await closeTerminalSession(session.id, {
      namespace: currentNamespace
    });
    if (result.closed) {
      closed += 1;
    }
  }

  return {
    ok: true,
    closed
  };
}

async function closeTerminalSessionsForNamespace(namespace = "default") {
  const sessions = sessionsForNamespace(namespace);
  const closed = await closeTerminalSessionTargets([...sessions.keys()].map((id) => ({
    id,
    namespace
  })));

  return {
    ok: true,
    closed
  };
}

async function closeTerminalSessionsForCwdRoot(cwdRoot = "") {
  const normalizedCwdRoot = String(cwdRoot || "").trim();
  if (!normalizedCwdRoot) {
    return {
      closed: 0,
      cwdRoot: "",
      namespaceCount: 0,
      namespaces: [],
      ok: true
    };
  }
  const targets = listStoredSessions({
    runningOnly: true
  }).filter((entry) => pathIsWithinRoot(entry.session?.cwd, normalizedCwdRoot));
  const namespaces = [...new Set(targets.map((entry) => entry.namespace))].sort();
  const closed = await closeTerminalSessionTargets(targets.map((entry) => ({
    id: entry.session.id,
    namespace: entry.namespace
  })));

  return {
    closed,
    cwdRoot: path.resolve(normalizedCwdRoot),
    namespaceCount: namespaces.length,
    namespaces,
    ok: true
  };
}

async function closeTerminalSessionsForNamespacePrefix(namespacePrefix = "") {
  const closed = await closeTerminalSessionTargets(listStoredSessions({
    namespacePrefix
  }).map((entry) => ({
    id: entry.session.id,
    namespace: entry.namespace
  })));
  return {
    ok: true,
    closed
  };
}

export {
  beginTerminalNamespaceOperation,
  MAX_TERMINAL_BUFFER_LENGTH,
  MAX_TERMINAL_BUFFER_ROWS,
  closeDetachedTerminalSessions,
  closeTerminalSession,
  closeTerminalSessionsForCwdRoot,
  closeTerminalSessionsForNamespace,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  listTerminalSessions,
  readTerminalSession,
  freezeTerminalNamespaceAdmission,
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  terminalKeyInput,
  terminalMovementState,
  terminalSessionContainsText,
  terminalSessionControlSnapshot,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission,
  updateTerminalSessionMetadata,
  readTerminalSessionControlState,
  writeTerminalSession,
  writeTerminalSessionKey,
  writeTerminalSessionText
};
