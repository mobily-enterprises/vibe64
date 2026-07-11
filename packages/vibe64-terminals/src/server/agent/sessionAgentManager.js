import {
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
} from "@local/vibe64-runtime/shared";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE = "vibe64_agent_provider_binding_conflict";

function sessionAgentProviderId(options = {}, fallbackProviderId = "") {
  return normalizeText(
    options?.providerId ||
    options?.agentSettings?.providerId ||
    options?.session?.agentSession?.providerId ||
    options?.session?.metadata?.agent_identity_provider ||
    fallbackProviderId
  );
}

function providerNotImplementedError(providerId = "") {
  const normalizedProviderId = normalizeText(providerId);
  const error = new Error(`Assistant provider is not implemented: ${normalizedProviderId || "(missing)"}.`);
  error.code = VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE;
  error.providerId = normalizedProviderId;
  return error;
}

function providerBindingConflictError(sessionId = "", currentProviderId = "", requestedProviderId = "") {
  const error = new Error(
    `Assistant session ${normalizeText(sessionId)} is bound to ${normalizeText(currentProviderId)}, not ${normalizeText(requestedProviderId)}.`
  );
  error.code = SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE;
  error.currentProviderId = normalizeText(currentProviderId);
  error.requestedProviderId = normalizeText(requestedProviderId);
  error.sessionId = normalizeText(sessionId);
  return error;
}

function normalizeAdapter(adapter = {}) {
  const id = normalizeText(adapter?.id);
  const transportId = normalizeText(adapter?.transportId);
  if (!id || !transportId) {
    throw new TypeError("Session agent adapters require product provider and transport ids.");
  }
  return Object.freeze({
    ...adapter,
    id,
    transportId
  });
}

function agentOperationResult(adapter = {}, sessionId = "", result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : { value: result };
  return {
    ...source,
    providerId: adapter.id,
    sessionId: normalizeText(sessionId),
    transportId: adapter.transportId
  };
}

function createSessionAgentManager({
  adapters = [],
  defaultProviderId = "codex"
} = {}) {
  const adapterById = new Map();
  const bindings = new Map();
  const operations = new Map();

  for (const candidate of adapters) {
    const adapter = normalizeAdapter(candidate);
    if (adapterById.has(adapter.id)) {
      throw new TypeError(`Duplicate session agent adapter: ${adapter.id}.`);
    }
    adapterById.set(adapter.id, adapter);
  }

  function adapterFor(options = {}) {
    const providerId = sessionAgentProviderId(options, defaultProviderId);
    const adapter = adapterById.get(providerId);
    if (!adapter) {
      throw providerNotImplementedError(providerId);
    }
    return adapter;
  }

  function bindSession(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw new TypeError("Session agent operations require a session id.");
    }
    const currentProviderId = bindings.get(normalizedSessionId);
    const requestedProviderId = sessionAgentProviderId(options);
    if (currentProviderId && requestedProviderId && currentProviderId !== requestedProviderId) {
      throw providerBindingConflictError(normalizedSessionId, currentProviderId, requestedProviderId);
    }
    const adapter = adapterFor({
      ...options,
      providerId: requestedProviderId || currentProviderId || defaultProviderId
    });
    bindings.set(normalizedSessionId, adapter.id);
    return adapter;
  }

  function operationKey(sessionId = "", providerId = "", operation = "", identity = "") {
    return [
      normalizeText(sessionId),
      normalizeText(providerId),
      normalizeText(operation),
      normalizeText(identity)
    ].join(":");
  }

  async function coalescedOperation(key = "", operation) {
    const existing = operations.get(key);
    if (existing) {
      return existing;
    }
    const pending = Promise.resolve().then(operation);
    operations.set(key, pending);
    try {
      return await pending;
    } finally {
      if (operations.get(key) === pending) {
        operations.delete(key);
      }
    }
  }

  async function callSessionAdapter(method = "", sessionId = "", input = {}, options = {}, {
    coalesceIdentity = ""
  } = {}) {
    const operationOptions = {
      ...options,
      agentSettings: options?.agentSettings || input?.agentSettings || null
    };
    const adapter = bindSession(sessionId, operationOptions);
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`Assistant provider ${adapter.id} does not implement ${method}().`);
    }
    const context = {
      agentSettings: operationOptions.agentSettings,
      lifecycle: typeof operationOptions.lifecycle === "function" ? operationOptions.lifecycle : null,
      prepareHandoff: typeof operationOptions.prepareHandoff === "function"
        ? operationOptions.prepareHandoff
        : null,
      providerId: adapter.id,
      runtime: operationOptions.runtime || null,
      session: operationOptions.session || null,
      sessionId: normalizeText(sessionId),
      transportId: adapter.transportId,
      turnOwnership: operationOptions.turnOwnership || null,
      vibe64User: operationOptions.vibe64User || null
    };
    const run = async () => agentOperationResult(
      adapter,
      sessionId,
      await adapter[method](context, input)
    );
    const identity = normalizeText(coalesceIdentity);
    return identity
      ? coalescedOperation(operationKey(sessionId, adapter.id, method, identity), run)
      : run();
  }

  async function callProviderAdapter(method = "", input = {}, options = {}) {
    const adapter = adapterFor(options);
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`Assistant provider ${adapter.id} does not implement ${method}().`);
    }
    return agentOperationResult(adapter, "", await adapter[method]({
      providerId: adapter.id,
      transportId: adapter.transportId
    }, input, options));
  }

  function ensureSession(sessionId = "", options = {}) {
    return callSessionAdapter("ensureSession", sessionId, {}, options, {
      coalesceIdentity: "session"
    });
  }

  function deliverPrompt(sessionId = "", handoff = {}, options = {}) {
    const handoffId = normalizeText(handoff?.handoffId);
    if (!handoffId) {
      throw new TypeError("Assistant prompt delivery requires a handoff id.");
    }
    return callSessionAdapter("deliverPrompt", sessionId, handoff, options, {
      coalesceIdentity: handoffId
    });
  }

  async function closeSession(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const adapter = bindSession(normalizedSessionId, options);
    const result = typeof adapter.closeSession !== "function"
      ? agentOperationResult(adapter, normalizedSessionId, {
          closed: false,
          ok: true
        })
      : agentOperationResult(
          adapter,
          normalizedSessionId,
          await adapter.closeSession({
            providerId: adapter.id,
            sessionId: normalizedSessionId,
            transportId: adapter.transportId
          })
        );
    if (result.ok !== false) {
      bindings.delete(normalizedSessionId);
    }
    return result;
  }

  return Object.freeze({
    binding(sessionId = "") {
      return bindings.get(normalizeText(sessionId)) || "";
    },
    closeProject(input = {}, options = {}) {
      return callProviderAdapter("closeProject", input, options);
    },
    closeSession,
    closeTerminal(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("closeTerminal", sessionId, input, options);
    },
    deleteDetachedChatThread(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("deleteDetachedChatThread", sessionId, input, options);
    },
    describeProvider(options = {}) {
      const adapter = adapterFor(options);
      return Object.freeze({
        providerId: adapter.id,
        transportId: adapter.transportId
      });
    },
    deliverPrompt,
    ensureSession,
    invalidateRuntimes(input = {}, options = {}) {
      return callProviderAdapter("invalidateRuntimes", input, options);
    },
    interruptDetachedChatTurn(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("interruptDetachedChatTurn", sessionId, input, options);
    },
    interruptTurn(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("interruptTurn", sessionId, input, options);
    },
    async reconcileSessions(sessions = [], options = {}) {
      const adapter = adapterFor(options);
      if (typeof adapter.reconcileSessions !== "function") {
        throw new TypeError(`Assistant provider ${adapter.id} does not implement reconcileSessions().`);
      }
      return agentOperationResult(adapter, "", await adapter.reconcileSessions({
        providerId: adapter.id,
        transportId: adapter.transportId
      }, sessions, options));
    },
    readTerminal(sessionId = "", terminalSessionId = "", options = {}) {
      return callSessionAdapter("readTerminal", sessionId, {
        terminalSessionId
      }, options);
    },
    resizeTerminal(sessionId = "", terminalSessionId = "", size = {}, options = {}) {
      return callSessionAdapter("resizeTerminal", sessionId, {
        size,
        terminalSessionId
      }, options);
    },
    runDetachedChatTurn(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("runDetachedChatTurn", sessionId, input, options);
    },
    sessionState(sessionId = "", options = {}) {
      return callSessionAdapter("sessionState", sessionId, {}, options);
    },
    startTerminal(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("startTerminal", sessionId, input, options);
    },
    sendMessage(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("sendMessage", sessionId, input, options);
    },
    streamDetachedChatTurn(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("streamDetachedChatTurn", sessionId, input, options);
    },
    subscribeTerminal(sessionId = "", terminalSessionId = "", subscriber = null, options = {}) {
      return callSessionAdapter("subscribeTerminal", sessionId, {
        subscriber,
        terminalSessionId
      }, options);
    },
    uploadAttachment(sessionId = "", input = {}, options = {}) {
      return callSessionAdapter("uploadAttachment", sessionId, input, options);
    },
    unsubscribeSessions(sessions = [], options = {}) {
      return callProviderAdapter("unsubscribeSessions", sessions, options);
    },
    writeTerminal(sessionId = "", terminalSessionId = "", data = "", input = {}, options = {}) {
      return callSessionAdapter("writeTerminal", sessionId, {
        data,
        input,
        terminalSessionId
      }, options);
    }
  });
}

export {
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager,
  sessionAgentProviderId
};
