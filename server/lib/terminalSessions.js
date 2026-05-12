import crypto from "node:crypto";
import { spawn as spawnPty } from "node-pty";

const MAX_BUFFER_LENGTH = 160000;
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
    id: session.id,
    commandPreview: session.commandPreview,
    exitCode: session.exitCode,
    output: session.output,
    status: session.status
  };
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
      reason,
      status: session.status
    });
  } catch (error) {
    session.output = trimBuffer(`${session.output}\r\n[terminal cleanup failed] ${String(error?.message || error)}\r\n`);
  }
}

function startTerminalSession({
  args,
  command,
  commandPreview,
  cwd = process.cwd(),
  maxRunning = 0,
  namespace = "default",
  namespaceLimitPrefix = "",
  onClose = null,
  reuseRunning = false
}) {
  const sessions = sessionsForNamespace(namespace);
  const id = crypto.randomUUID();
  const existingSession = reuseRunning
    ? [...sessions.values()].find((session) => isRunningSession(session))
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
  const terminal = spawnPty(command, resolvedArgs, {
    cols: 100,
    cwd,
    env: process.env,
    name: "xterm-color",
    rows: 28
  });

  const session = {
    id,
    commandPreview: resolvedCommandPreview,
    exitCode: null,
    onClose,
    output: "",
    status: "running",
    subscribers: new Set(),
    terminal
  };

  terminal.onData((data) => {
    session.output = trimBuffer(session.output + data);
    sendToSubscribers(session, {
      chunk: data,
      type: "output"
    });
  });

  terminal.onExit(({ exitCode }) => {
    session.exitCode = exitCode;
    session.status = "exited";
    sendToSubscribers(session, {
      exitCode,
      status: session.status,
      type: "status"
    });
    void runCloseHook(session, "exit");
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

  session.terminal.write(String(data || ""));
  return readTerminalSession(id, { namespace });
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
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
};
