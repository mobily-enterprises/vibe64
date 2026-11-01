import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import {
  pathInsideOrEqual,
  recordValue
} from "../normalize.js";
import {
  clearDetachedCleanupTimer,
  DEFAULT_QUIET_THRESHOLD_MS,
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  detachedIdleForMs,
  isRunningSession,
  MAX_TERMINAL_BUFFER_LENGTH,
  MAX_TERMINAL_BUFFER_ROWS,
  NO_SESSIONS,
  normalizeDetachedIdleTimeoutMs,
  normalizeNamespace,
  normalizeTerminalSize,
  sessionUsesDetachedCleanup,
  terminalKeyInput,
  terminalMovementState,
  terminalSessionContainsText,
  terminalSessionControlSnapshot,
  terminalSessionMatchesFilter,
  terminalSessionNotFound,
  terminalSessionResponse,
  trimBuffer
} from "./terminalSessionViews.js";
import {
  applySessionMetadata,
  attachTerminalWriteErrorHandler,
  beginTerminalCloseHook,
  beginTerminalScopeDrain,
  beginTerminalStop,
  markTerminalExited,
  recordTerminalInput,
  recordTerminalOutput,
  reportTerminalLifecycleFailure,
  reportTerminalWriteError,
  sendToSubscribers,
  settleTerminalExitStatus,
  terminalCloseAggregateFailure,
  terminalSessionCloseFailure
} from "./terminalSessionLifecycle.js";
import {
  beginTerminalNamespaceOperation,
  freezeTerminalNamespaceAdmission,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission
} from "./terminalNamespaceAdmission.js";

const stores = new Map();
const requirePty = createRequire(import.meta.url);
// Reading a namespace never creates it. Only a started terminal does, and the
// namespace is forgotten with its last closed terminal.
function sessionsForNamespace(namespace) {
  return stores.get(normalizeNamespace(namespace)) || NO_SESSIONS;
}

function startedSessionsForNamespace(namespace) {
  const normalizedNamespace = normalizeNamespace(namespace);
  if (!stores.has(normalizedNamespace)) {
    stores.set(normalizedNamespace, new Map());
  }
  return stores.get(normalizedNamespace);
}

function forgetTerminalSession(sessions, namespace, id) {
  sessions.delete(id);
  const normalizedNamespace = normalizeNamespace(namespace);
  if (sessions.size < 1 && stores.get(normalizedNamespace) === sessions) {
    stores.delete(normalizedNamespace);
  }
}

function namespacesForPrefix(namespacePrefix = "") {
  const normalizedPrefix = String(namespacePrefix || "");
  return [...stores.keys()].filter((namespace) => namespace.startsWith(normalizedPrefix));
}

function scheduleDetachedCleanup(session = {}, namespace = "default") {
  clearDetachedCleanupTimer(session);
  if (!sessionUsesDetachedCleanup(session) || session.subscribers?.size) {
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
  // Offline state upgrades share command capture, but never need a native PTY.
  // The child gets exactly the env it was given, like capture and detached
  // commands: nothing the policy left out comes back from this server process.
  const terminal = requirePty("node-pty").spawn(command, resolvedArgs, {
    cols: DEFAULT_TERMINAL_COLS,
    cwd,
    env: recordValue(resolvedEnv),
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
          updateMetadata(nextMetadata) {
            return applySessionMetadata(session, nextMetadata);
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

  startedSessionsForNamespace(namespace).set(id, session);
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

async function stopTerminalSessionAndWait(id, { namespace = "default" } = {}) {
  const session = sessionsForNamespace(namespace).get(id);
  if (!session) return terminalSessionNotFound();
  const stopped = await beginTerminalStop(session, "stop");
  if (stopped.failures.length) {
    throw terminalCloseAggregateFailure(session, stopped.failures);
  }
  await session.exitCompletion;
  await session.scopeDrainCompletion;
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
    forgetTerminalSession(sessions, namespace, id);

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
  }).filter((entry) => pathInsideOrEqual(normalizedCwdRoot, entry.session?.cwd));
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
  stopTerminalSessionAndWait,
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
