import {
  closeTerminalSession,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession,
  writeTerminalSessionText
} from "./terminalSessions.js";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV
} from "./providerHomes.js";
import {
  terminalOwnerFromMetadata,
  terminalOwnerMatchesRequest
} from "./terminalOwnership.js";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";

function terminalActorInput(input = {}) {
  return {
    vibe64User: input?.vibe64User || input?.request?.vibe64User || null
  };
}

const DEFAULT_LEGACY_OWNERLESS_TERMINAL_TTL_MS = 60 * 60 * 1000;

function timestampMs(value = "") {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function terminalLastActivityMs(snapshot = {}) {
  return Math.max(
    timestampMs(snapshot.lastInputAt),
    timestampMs(snapshot.lastOutputAt),
    timestampMs(snapshot.createdAt)
  );
}

function terminalIsLegacyOwnerless(snapshot = {}) {
  return !terminalOwnerFromMetadata(snapshot.metadata || {});
}

function terminalOwnerCheck(snapshot = {}, {
  accountMode = "",
  env = process.env,
  input = {}
} = {}) {
  if (!snapshot || snapshot.ok === false) {
    return snapshot;
  }
  return terminalOwnerMatchesRequest(snapshot.metadata || {}, {
    accountMode,
    env,
    providerHomesRoot: String(env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "").trim(),
    ...terminalActorInput(input)
  });
}

function logTerminalOwnerDenied(logger, {
  action = "",
  id = "",
  namespace = "",
  owner = {},
  snapshot = {}
} = {}) {
  if (owner?.ok !== false) {
    return false;
  }
  const metadata = snapshot?.metadata || {};
  return logOperationalEvent(logger, "warn", {
    action,
    code: owner.code || "",
    component: "vibe64.terminal",
    event: "vibe64.terminal.owner_denied",
    expectedOwnerScope: owner.ownerScope || "",
    expectedOwnerUserKey: owner.ownerUserKey || "",
    observedOwnerScope: owner.observedOwnerScope || "",
    observedOwnerUserKey: owner.observedOwnerUserKey || "",
    sessionId: metadata.sessionId || "",
    statusCode: owner.statusCode || 0,
    terminalId: id,
    terminalKind: metadata.terminalKind || "",
    terminalNamespace: namespace,
    toolId: metadata.toolId || metadata.projectSetupActionId || ""
  }, "Vibe64 terminal owner check denied access.");
}

function logLegacyOwnerlessTerminalAccess(logger, {
  action = "",
  id = "",
  namespace = "",
  snapshot = {}
} = {}) {
  const metadata = snapshot?.metadata || {};
  return logOperationalEvent(logger, "warn", {
    action,
    code: "vibe64_terminal_legacy_ownerless",
    component: "vibe64.terminal",
    event: "vibe64.terminal.legacy_ownerless_access",
    sessionId: metadata.sessionId || "",
    terminalId: id,
    terminalKind: metadata.terminalKind || "",
    terminalNamespace: namespace,
    toolId: metadata.toolId || metadata.projectSetupActionId || ""
  }, "Vibe64 allowed access to a legacy terminal without recorded owner metadata.");
}

function logLegacyOwnerlessTerminalCleanup(logger, {
  idleForMs = 0,
  namespace = "",
  snapshot = {},
  ttlMs = 0
} = {}) {
  const metadata = snapshot?.metadata || {};
  return logOperationalEvent(logger, "warn", {
    code: "vibe64_terminal_legacy_ownerless_cleanup",
    component: "vibe64.terminal",
    event: "vibe64.terminal.legacy_ownerless_cleanup",
    idleForMs: Number(idleForMs || 0),
    sessionId: metadata.sessionId || "",
    terminalId: snapshot.id || "",
    terminalKind: metadata.terminalKind || "",
    terminalNamespace: namespace,
    toolId: metadata.toolId || metadata.projectSetupActionId || "",
    ttlMs: Number(ttlMs || 0)
  }, "Vibe64 closed a legacy terminal without recorded owner metadata.");
}

async function closeLegacyOwnerlessTerminalSessions({
  logger = null,
  namespace = "",
  namespacePrefix = "",
  now = Date.now(),
  ttlMs = DEFAULT_LEGACY_OWNERLESS_TERMINAL_TTL_MS
} = {}) {
  const thresholdMs = Math.max(0, Number(ttlMs || 0));
  const currentMs = Number(now || Date.now());
  const closedTerminals = [];
  for (const snapshot of listTerminalSessions({
    namespace,
    namespacePrefix,
    runningOnly: true
  })) {
    if (!terminalIsLegacyOwnerless(snapshot)) {
      continue;
    }
    const lastActivityMs = terminalLastActivityMs(snapshot);
    const idleForMs = lastActivityMs > 0 ? Math.max(0, currentMs - lastActivityMs) : thresholdMs + 1;
    if (idleForMs < thresholdMs) {
      continue;
    }
    const result = await closeTerminalSession(snapshot.id, {
      namespace: snapshot.namespace
    });
    if (result?.closed) {
      logLegacyOwnerlessTerminalCleanup(logger, {
        idleForMs,
        namespace: snapshot.namespace,
        snapshot,
        ttlMs: thresholdMs
      });
      closedTerminals.push({
        id: snapshot.id,
        namespace: snapshot.namespace
      });
    }
  }
  return {
    closed: closedTerminals.length,
    closedTerminals,
    ok: true
  };
}

function readOwnedTerminalSession(id, {
  accountMode = "",
  action = "read",
  env = process.env,
  input = {},
  logger = null,
  namespace = "default"
} = {}) {
  const snapshot = readTerminalSession(id, {
    namespace
  });
  const owner = terminalOwnerCheck(snapshot, {
    accountMode,
    env,
    input
  });
  if (owner?.ok === false) {
    logTerminalOwnerDenied(logger, {
      action,
      id,
      namespace,
      owner,
      snapshot
    });
    return owner;
  }
  if (owner?.legacyOwnerless === true) {
    logLegacyOwnerlessTerminalAccess(logger, {
      action,
      id,
      namespace,
      snapshot
    });
  }
  return snapshot;
}

function listOwnedTerminalSessions({
  accountMode = "",
  env = process.env,
  input = {},
  logger = null,
  logDenied = false,
  namespace = "",
  namespacePrefix = "",
  runningOnly = false
} = {}) {
  return listTerminalSessions({
    namespace,
    namespacePrefix,
    runningOnly
  }).filter((snapshot) => {
    const owner = terminalOwnerCheck(snapshot, {
      accountMode,
      env,
      input
    });
    if (owner?.ok === false) {
      if (logDenied) {
        logTerminalOwnerDenied(logger, {
          action: "list",
          id: snapshot.id,
          namespace: snapshot.namespace || namespace,
          owner,
          snapshot
        });
      }
      return false;
    }
    return true;
  });
}

async function closeOwnedTerminalSession(id, {
  accountMode = "",
  env = process.env,
  input = {},
  logger = null,
  namespace = "default"
} = {}) {
  const snapshot = readTerminalSession(id, {
    namespace
  });
  if (snapshot?.ok !== false) {
    const owner = terminalOwnerCheck(snapshot, {
      accountMode,
      env,
      input
    });
    if (owner?.ok === false) {
      logTerminalOwnerDenied(logger, {
        action: "close",
        id,
        namespace,
        owner,
        snapshot
      });
      return owner;
    }
    if (owner?.legacyOwnerless === true) {
      logLegacyOwnerlessTerminalAccess(logger, {
        action: "close",
        id,
        namespace,
        snapshot
      });
    }
  }
  return closeTerminalSession(id, {
    namespace
  });
}

function subscribeOwnedTerminalSession(id, subscriber, {
  accountMode = "",
  env = process.env,
  input = {},
  logger = null,
  namespace = "default"
} = {}) {
  const snapshot = readOwnedTerminalSession(id, {
    accountMode,
    action: "subscribe",
    env,
    input,
    logger,
    namespace
  });
  if (snapshot?.ok === false) {
    return snapshot;
  }
  return subscribeTerminalSession(id, subscriber, {
    namespace
  });
}

function writeOwnedTerminalSession(id, data, {
  accountMode = "",
  env = process.env,
  input = {},
  logger = null,
  namespace = "default"
} = {}) {
  const snapshot = readOwnedTerminalSession(id, {
    accountMode,
    action: "write",
    env,
    input,
    logger,
    namespace
  });
  if (snapshot?.ok === false) {
    return snapshot;
  }
  return writeTerminalSession(id, data, {
    namespace
  });
}

function writeOwnedTerminalSessionText(id, data, {
  accountMode = "",
  env = process.env,
  input = {},
  logger = null,
  namespace = "default"
} = {}) {
  const snapshot = readOwnedTerminalSession(id, {
    accountMode,
    action: "write-text",
    env,
    input,
    logger,
    namespace
  });
  if (snapshot?.ok === false) {
    return snapshot;
  }
  return writeTerminalSessionText(id, data, {
    namespace
  });
}

function resizeOwnedTerminalSession(id, size, {
  accountMode = "",
  env = process.env,
  input = {},
  logger = null,
  namespace = "default"
} = {}) {
  const snapshot = readOwnedTerminalSession(id, {
    accountMode,
    action: "resize",
    env,
    input,
    logger,
    namespace
  });
  if (snapshot?.ok === false) {
    return snapshot;
  }
  return resizeTerminalSession(id, size, {
    namespace
  });
}

export {
  closeLegacyOwnerlessTerminalSessions,
  closeOwnedTerminalSession,
  DEFAULT_LEGACY_OWNERLESS_TERMINAL_TTL_MS,
  listOwnedTerminalSessions,
  readOwnedTerminalSession,
  resizeOwnedTerminalSession,
  subscribeOwnedTerminalSession,
  terminalOwnerCheck,
  writeOwnedTerminalSession,
  writeOwnedTerminalSessionText
};
