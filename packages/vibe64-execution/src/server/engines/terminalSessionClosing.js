import path from "node:path";

import { pathInsideOrEqual } from "../normalize.js";
import {
  beginTerminalStop,
  markTerminalExited,
  reportTerminalLifecycleFailure,
  terminalCloseAggregateFailure,
  terminalSessionCloseFailure
} from "./terminalSessionLifecycle.js";
import {
  forgetTerminalSession,
  listStoredSessions,
  sessionsForNamespace
} from "./terminalSessionRegistry.js";
import {
  clearDetachedCleanupTimer,
  detachedIdleForMs,
  normalizeDetachedIdleTimeoutMs,
  normalizeNamespace,
  sessionUsesDetachedCleanup
} from "./terminalSessionViews.js";

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

async function closeTerminalSession(id, options = {}) {
  const {
    namespace = "default"
  } = options;
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

/** Closes the namespace's detached terminals whose own idle timeout has passed, and reschedules the rest. */
async function closeDetachedTerminalSessions({ namespace }) {
  for (const { namespace: currentNamespace, session } of listStoredSessions({ namespace })) {
    if (!sessionUsesDetachedCleanup(session) || session.subscribers?.size) {
      continue;
    }
    const timeoutMs = normalizeDetachedIdleTimeoutMs(session.detachedIdleTimeoutMs);
    if (timeoutMs < 1) {
      continue;
    }
    if (detachedIdleForMs(session) < timeoutMs) {
      scheduleDetachedCleanup(session, currentNamespace);
      continue;
    }
    await closeTerminalSession(session.id, {
      namespace: currentNamespace
    });
  }
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
  closeTerminalSession,
  closeTerminalSessionsForCwdRoot,
  closeTerminalSessionsForNamespace,
  closeTerminalSessionsForNamespacePrefix,
  scheduleDetachedCleanup
};
