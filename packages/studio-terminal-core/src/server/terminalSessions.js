import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { spawn as spawnPty } from "node-pty";

const MAX_BUFFER_LENGTH = 2 * 1024 * 1024;
const DEFAULT_TERMINAL_COLS = 100;
const DEFAULT_TERMINAL_ROWS = 28;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MAX_TERMINAL_COLS = 300;
const MAX_TERMINAL_ROWS = 120;
const stores = new Map();

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

function namespacesForPrefix(namespacePrefix = "") {
  const normalizedPrefix = String(namespacePrefix || "");
  return [...stores.keys()].filter((namespace) => namespace.startsWith(normalizedPrefix));
}

function trimBuffer(output) {
  if (output.length <= MAX_BUFFER_LENGTH) {
    return output;
  }
  return output.slice(output.length - MAX_BUFFER_LENGTH);
}

function isRunningSession(session = {}) {
  return session.status === "running" || session.status === "closing";
}

function terminalSessionResponse(session) {
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
    output: session.output,
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

function recordTerminalInput(session, data = "") {
  const bytes = byteLength(data);
  if (bytes < 1) {
    return;
  }
  session.inputVersion = Number(session.inputVersion || 0) + 1;
  session.lastInputAt = new Date().toISOString();
  session.lastInputBytes = bytes;
  sendToSubscribers(session, {
    bytes,
    inputVersion: session.inputVersion,
    lastInputAt: session.lastInputAt,
    type: "input"
  });
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

function countRunningTerminalSessions({ namespacePrefix = "" } = {}) {
  return listStoredSessions({
    namespacePrefix,
    runningOnly: true
  }).length;
}

function listTerminalSessions({
  namespace = "",
  namespacePrefix = "",
  runningOnly = false
} = {}) {
  return listStoredSessions({
    namespace,
    namespacePrefix,
    runningOnly
  }).map((entry) => ({
    namespace: entry.namespace,
    ...terminalSessionResponse(entry.session)
  }));
}

async function runCloseHook(session, reason) {
  if (!session || session.closeHookStarted) {
    return;
  }
  session.closeHookStarted = true;
  if (typeof session.onClose !== "function") {
    return;
  }
  try {
    await session.onClose({
      exitCode: session.exitCode,
      id: session.id,
      output: session.output,
      reason,
      status: session.status
    });
  } catch (error) {
    const message = String(error?.message || error || "Terminal finalization failed.");
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
  }
}

async function runStopHook(session, reason) {
  if (!session || session.stopHookStarted) {
    return;
  }
  session.stopHookStarted = true;
  if (typeof session.onStop !== "function") {
    return;
  }
  try {
    await session.onStop({
      id: session.id,
      output: session.output,
      reason,
      status: session.status
    });
  } catch (error) {
    const message = String(error?.message || error || "Terminal stop failed.");
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
  }
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
  onClose = null,
  onOutput = null,
  onStop = null,
  reuseRunning = false
}) {
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
  if (runningLimit > 0 && countRunningTerminalSessions({ namespacePrefix: runningLimitPrefix }) >= runningLimit) {
    return {
      ok: false,
      code: "terminal_limit",
      error: `Terminal limit reached (${runningLimit}).`
    };
  }

  const resolvedArgs = typeof args === "function" ? args({ id, namespace }) : args;
  const resolvedCommandPreview = typeof commandPreview === "function"
    ? commandPreview({
      args: resolvedArgs,
      id,
      namespace
    })
    : commandPreview;
  const resolvedMetadata = typeof metadata === "function"
    ? metadata({
      args: resolvedArgs,
      id,
      namespace
    })
    : metadata;
  const resolvedEnv = typeof env === "function"
    ? env({
      args: resolvedArgs,
      id,
      namespace
    })
    : env;
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

  const session = {
    id,
    commandPreview: resolvedCommandPreview,
    cols: DEFAULT_TERMINAL_COLS,
    createdAt: new Date().toISOString(),
    exitCode: null,
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
    output: "",
    outputVersion: 0,
    rows: DEFAULT_TERMINAL_ROWS,
    status: "running",
    subscribers: new Set(),
    terminal
  };

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
  });

  terminal.onExit(({ exitCode }) => {
    session.exitCode = exitCode;
    session.status = "closing";
    sendToSubscribers(session, {
      exitCode,
      status: session.status,
      type: "status"
    });
    void (async () => {
      await runCloseHook(session, "exit");
      session.status = "exited";
      sendToSubscribers(session, {
        closeError: session.closeError || "",
        exitCode,
        status: session.status,
        type: "status"
      });
    })();
  });

  sessions.set(id, session);
  return readTerminalSession(id, { namespace });
}

function readTerminalSession(id, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }

  return terminalSessionResponse(session);
}

function updateTerminalSessionMetadata(id, metadata = {}, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }
  return applySessionMetadata(session, metadata);
}

function subscribeTerminalSession(id, subscriber, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }
  if (typeof subscriber !== "function") {
    return {
      ok: false,
      error: "Terminal subscriber must be a function."
    };
  }

  session.subscribers.add(subscriber);
  return {
    ...terminalSessionResponse(session),
    unsubscribe() {
      session.subscribers.delete(subscriber);
    }
  };
}

function writeTerminalSession(id, data, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }
  if (session.status !== "running") {
    return readTerminalSession(id, { namespace });
  }

  const input = String(data || "");
  if (input) {
    recordTerminalInput(session, input);
    session.terminal.write(input);
  }
  return readTerminalSession(id, { namespace });
}

function resizeTerminalSession(id, size = {}, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
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
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }

  if (session.status === "running") {
    session.status = "closing";
    sendToSubscribers(session, {
      exitCode: session.exitCode,
      status: session.status,
      type: "status"
    });
    void (async () => {
      await runStopHook(session, "stop");
      if (session.status === "closing") {
        session.terminal.kill();
      }
    })();
  }

  return terminalSessionResponse(session);
}

async function closeTerminalSession(id, { namespace = "default" } = {}) {
  const sessions = sessionsForNamespace(namespace);
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: true,
      closed: false
    };
  }

  if (session.status === "running") {
    session.status = "closing";
    await runStopHook(session, "close");
    session.terminal.kill();
  }
  await runCloseHook(session, "close");
  sessions.delete(id);

  return {
    ok: true,
    closed: true
  };
}

async function closeTerminalSessionsForNamespace(namespace = "default") {
  const sessions = sessionsForNamespace(namespace);
  let closed = 0;

  for (const id of [...sessions.keys()]) {
    const result = await closeTerminalSession(id, { namespace });
    if (result.closed) {
      closed += 1;
    }
  }

  return {
    ok: true,
    closed
  };
}

async function closeTerminalSessionsForNamespacePrefix(namespacePrefix = "") {
  let closed = 0;
  for (const namespace of namespacesForPrefix(namespacePrefix)) {
    const result = await closeTerminalSessionsForNamespace(namespace);
    closed += Number(result.closed || 0);
  }
  return {
    ok: true,
    closed
  };
}

export {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  updateTerminalSessionMetadata,
  writeTerminalSession
};
