import {
  closeTerminalSession,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession,
  writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";
import {
  terminalOwnerMatchesRequest
} from "./terminalOwnership.js";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";

function terminalOwnerCheck(snapshot = {}) {
  if (!snapshot || snapshot.ok === false) {
    return snapshot;
  }
  return terminalOwnerMatchesRequest(snapshot.metadata || {});
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

const DEFAULT_OWNED_TERMINAL_ACCESSOR_OPERATIONS = {
  close: closeOwnedTerminalSession,
  read: readOwnedTerminalSession,
  resize: resizeOwnedTerminalSession,
  subscribe: subscribeOwnedTerminalSession,
  write: writeOwnedTerminalSession
};

function validateOwnedTerminalAccessorOperation(name, operation) {
  if (typeof operation !== "function") {
    throw new TypeError(`Owned terminal accessor operation "${name}" must be a function.`);
  }
}

function createOwnedTerminalAccessors({
  accessOptions,
  operations = {},
  wrap = null
} = {}) {
  if (typeof accessOptions !== "function") {
    throw new TypeError("Owned terminal accessors require an accessOptions function.");
  }
  if (wrap != null && typeof wrap !== "function") {
    throw new TypeError("Owned terminal accessor wrap option must be a function.");
  }
  for (const [name, operation] of Object.entries(operations || {})) {
    if (!Object.hasOwn(DEFAULT_OWNED_TERMINAL_ACCESSOR_OPERATIONS, name)) {
      throw new TypeError(`Unknown owned terminal accessor operation "${name}".`);
    }
    validateOwnedTerminalAccessorOperation(name, operation);
  }
  const resolvedOperations = {
    ...DEFAULT_OWNED_TERMINAL_ACCESSOR_OPERATIONS,
    ...operations
  };
  const run = (callback) => typeof wrap === "function" ? wrap(callback) : callback();
  return {
    close(terminalSessionId, input = {}) {
      return run(() => resolvedOperations.close(
        terminalSessionId,
        accessOptions(input)
      ));
    },
    read(terminalSessionId, input = {}) {
      return run(() => resolvedOperations.read(
        terminalSessionId,
        accessOptions(input)
      ));
    },
    resize(terminalSessionId, size = {}, input = {}) {
      return run(() => resolvedOperations.resize(
        terminalSessionId,
        size,
        accessOptions(input)
      ));
    },
    subscribe(terminalSessionId, subscriber, input = {}) {
      return run(() => resolvedOperations.subscribe(
        terminalSessionId,
        subscriber,
        accessOptions(input)
      ));
    },
    write(terminalSessionId, data, input = {}) {
      return run(() => resolvedOperations.write(
        terminalSessionId,
        data,
        accessOptions(input)
      ));
    }
  };
}

export {
  closeOwnedTerminalSession,
  createOwnedTerminalAccessors,
  listOwnedTerminalSessions,
  readOwnedTerminalSession,
  resizeOwnedTerminalSession,
  subscribeOwnedTerminalSession,
  terminalOwnerCheck,
  writeOwnedTerminalSession,
  writeOwnedTerminalSessionText
};
