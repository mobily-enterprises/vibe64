import crypto from "node:crypto";
import { createRequire } from "node:module";

import { recordValue } from "../normalize.js";
import {
  clearDetachedCleanupTimer,
  DEFAULT_QUIET_THRESHOLD_MS,
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  isRunningSession,
  normalizeDetachedIdleTimeoutMs,
  normalizeTerminalSize,
  terminalKeyInput,
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
  recordTerminalInput,
  recordTerminalOutput,
  reportTerminalWriteError,
  sendToSubscribers,
  settleTerminalExitStatus,
  terminalCloseAggregateFailure
} from "./terminalSessionLifecycle.js";
import {
  beginTerminalNamespaceOperation,
  freezeTerminalNamespaceAdmission,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission
} from "./terminalNamespaceAdmission.js";
import {
  closeTerminalSession,
  closeTerminalSessionsForCwdRoot,
  closeTerminalSessionsForNamespace,
  closeTerminalSessionsForNamespacePrefix,
  scheduleDetachedCleanup
} from "./terminalSessionClosing.js";
import {
  listStoredSessions,
  sessionsForNamespace,
  startedSessionsForNamespace
} from "./terminalSessionRegistry.js";

/** A stop, close or output hook for a terminal with nothing to do then. */
function noTerminalHook() {}

/** The running limit of a terminal whose caller does not narrow it counts every running terminal. */
function everyTerminal() {
  return true;
}

const requirePty = createRequire(import.meta.url);

async function writeTerminalSessionText(id, text = "", options = {}) {
  const {
    namespace = "default",
    quietThresholdMs = DEFAULT_QUIET_THRESHOLD_MS
  } = options;
  return terminalSessionControlSnapshot(writeTerminalSession(id, text, {
    namespace
  }), {
    quietThresholdMs
  });
}

function countRunningTerminalSessions({
  filter,
  namespacePrefix
}) {
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
  // readable-check: allow dependency-default - input validation: a terminal's env is a record or a function of the terminal input; none is empty
  env = {},
  maxRunning = 0,
  // readable-check: allow dependency-default - input validation: terminal metadata is a record or a function of the terminal input; none is empty
  metadata = {},
  namespace = "default",
  namespaceLimitPrefix = "",
  runningLimitFilter = everyTerminal,
  onClose = noTerminalHook,
  onOutput = noTerminalHook,
  onStop = noTerminalHook,
  reuseRunning = false,
  detachedIdleTimeoutMs = 0
}) {
  const admissionFailure = terminalNamespaceAdmissionFailure(namespace);
  if (admissionFailure) {
    return admissionFailure;
  }
  const sessions = sessionsForNamespace(namespace);
  const id = crypto.randomUUID();
  // readable-check: allow method-probe - input validation: reuse is a yes or no, or a function of a running terminal
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

  // readable-check: allow method-probe - input validation: a terminal's env is a record or a function of the terminal input
  const resolvedEnv = typeof env === "function"
    ? env({
      id,
      namespace
    })
    : env;
  // readable-check: allow method-probe - input validation: arguments are a list or a function of the terminal input
  const resolvedArgs = typeof args === "function"
    ? args({
      env: resolvedEnv,
      id,
      namespace
    })
    : args;
  // readable-check: allow method-probe - input validation: a command preview is text or a function of the terminal input
  const resolvedCommandPreview = typeof commandPreview === "function"
    ? commandPreview({
      args: resolvedArgs,
      env: resolvedEnv,
      id,
      namespace
    })
    : commandPreview;
  // readable-check: allow method-probe - input validation: terminal metadata is a record or a function of the terminal input
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

function readTerminalSession(id, options = {}) {
  const { namespace = "default", outputLimit = 0 } = options;
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }

  return terminalSessionResponse(session, {
    outputLimit
  });
}

function updateTerminalSessionMetadata(id, metadata = {}, options = {}) {
  const { namespace = "default" } = options;
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }
  return applySessionMetadata(session, metadata);
}

function subscribeTerminalSession(id, subscriber, options = {}) {
  const { namespace = "default", outputLimit = 0 } = options;
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return terminalSessionNotFound();
  }
  // readable-check: allow method-probe - input validation: a subscriber is a function that receives terminal messages
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

function writeTerminalSession(id, data, options = {}) {
  const { namespace = "default" } = options;
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

function resizeTerminalSession(id, size = {}, options = {}) {
  const { namespace = "default" } = options;
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

async function stopTerminalSessionAndWait(id, options = {}) {
  const { namespace = "default" } = options;
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

export {
  beginTerminalNamespaceOperation,
  closeTerminalSession,
  closeTerminalSessionsForCwdRoot,
  closeTerminalSessionsForNamespace,
  closeTerminalSessionsForNamespacePrefix,
  listTerminalSessions,
  readTerminalSession,
  freezeTerminalNamespaceAdmission,
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSessionAndWait,
  subscribeTerminalSession,
  terminalKeyInput,
  terminalSessionContainsText,
  terminalSessionControlSnapshot,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission,
  updateTerminalSessionMetadata,
  writeTerminalSession,
  writeTerminalSessionText
};
