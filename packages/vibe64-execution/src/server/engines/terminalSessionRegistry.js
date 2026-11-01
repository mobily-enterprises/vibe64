import {
  isRunningSession,
  NO_SESSIONS,
  normalizeNamespace
} from "./terminalSessionViews.js";

// The process's running terminal sessions, by namespace. A namespace exists only while it holds a started terminal.
const stores = new Map();

/**
 * Reading a namespace never creates it. Only a started terminal does, and the
 * namespace is forgotten with its last closed terminal.
 */
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

/**
 * Forgets a closed session, and its namespace once that held its last session.
 * @param {Map<string, object>} sessions the namespace's sessions
 * @param {string} namespace
 * @param {string} id
 */
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

export {
  forgetTerminalSession,
  listStoredSessions,
  sessionsForNamespace,
  startedSessionsForNamespace
};
