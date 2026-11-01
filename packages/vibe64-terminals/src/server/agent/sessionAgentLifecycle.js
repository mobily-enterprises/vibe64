import { listTerminalSessions } from "@local/vibe64-execution/server/terminalSessions";
import {
  agentOperationResult,
  assistantUser,
  bindingKey,
  connectionChangeBusy,
  defineEphemeralAssistantScope,
  sessionAgentProviderId
} from "./sessionAgentRules.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("../types.js").SessionAgentManagerState} SessionAgentManagerState */
/** @typedef {import("../types.js").SessionAgentBindings} SessionAgentBindings */
/** @typedef {import("../types.js").SessionAgentAccess} SessionAgentAccess */
/** @typedef {import("../types.js").SessionAgentConversationOperations} SessionAgentConversationOperations */
/** @typedef {ReturnType<typeof import("./sessionAgentProviderCalls.js").createSessionAgentProviderCalls>} SessionAgentProviderCalls */
/** @typedef {import("../types.js").SessionAgentProviderMethod} SessionAgentProviderMethod */

/**
 * Closing and releasing what the manager holds: sessions, projects,
 * conversations and their bindings, native history storage, reconciliation,
 * and runtime invalidation, which waits for native terminals to close before
 * a connection changes.
 * @param {object} dependencies
 * @param {SessionAgentManagerState} dependencies.state
 * @param {SessionAgentBindings} dependencies.sessionBindings
 * @param {SessionAgentAccess} dependencies.accessChecks
 * @param {SessionAgentConversationOperations} dependencies.conversationOperations
 * @param {SessionAgentProviderCalls} dependencies.providerCalls
 */
function createSessionAgentLifecycle({
  state,
  sessionBindings,
  accessChecks,
  conversationOperations,
  providerCalls
}) {
  /**
   * The terminal store owns each native PTY's lifetime; a binding records only
   * the connection the PTY opened with. A PTY closed outside this manager (a
   * native runtime release, Remove AI) is forgotten, and an exited one holds no
   * connection. Each running PTY reports its own session.
   */
  function runningNativeTerminals(engineId = "") {
    const stored = listTerminalSessions({ namespacePrefix: `vibe64-${engineId}:` });
    const storedIds = new Set(stored.map(({ id }) => id));
    for (const [terminalId, binding] of state.terminalBindings) {
      if (binding.providerId === engineId && !storedIds.has(terminalId)) state.terminalBindings.delete(terminalId);
    }
    return stored.filter(({ status }) => status === "running" || status === "closing").map((terminal) => {
      const binding = state.terminalBindings.get(terminal.id);
      return {
        binding: binding?.providerId === engineId ? binding : null,
        sessionId: binding?.sessionId || String(terminal.namespace).split(":").at(-1)
      };
    });
  }

  async function deleteEphemeralConversation(scope = {}, input = {}, options = {}) {
    const assistantScope = defineEphemeralAssistantScope(scope);
    const result = await providerCalls.callEphemeralScope(
      input.conversationId || input.threadId ? "deleteConversation" : "closeSession",
      assistantScope,
      input,
      options
    );
    if (result?.ok !== false) {
      sessionBindings.forgetBinding(assistantScope.id);
    }
    return result;
  }

  async function closeSession(sessionId = "", options = {}) {
    const id = toText(sessionId);
    const provider = sessionBindings.bindSession(id, options);
    const context = {
      changeover: options.changeover === true,
      forgetConversationBinding: options.forgetConversationBinding === true,
      preserveProcessExitProof: options.preserveProcessExitProof === true,
      providerId: provider.id,
      renewalCleanup: options.renewalCleanup || null,
      runtime: options.runtime || null,
      session: options.session || null,
      sessionId: id,
      transportId: provider.transportId
    };
    const operation = conversationOperations.providerOperation(provider, "closeSession");
    const result = agentOperationResult(provider, id, await operation.call(provider, context));
    if (result.ok !== false) {
      sessionBindings.forgetBinding(id);
      for (const [terminalId, terminal] of state.terminalBindings) {
        if (terminal.sessionId === id && terminal.providerId === provider.id) state.terminalBindings.delete(terminalId);
      }
    }
    return result;
  }

  /**
   * A released renewal predecessor or successor no longer holds its session binding.
   * @param {SessionAgentProviderMethod} method
   * @param {string} sessionId
   * @param {object} input
   * @param {object} options
   */
  async function releaseAndForgetBinding(method, sessionId, input, options) {
    const id = toText(sessionId);
    const result = await providerCalls.callSessionProvider(method, id, input, options);
    if (result.ok !== false) sessionBindings.forgetBinding(id);
    return result;
  }

  function releaseRenewalPredecessorAttachments(sessionId = "", input = {}, options = {}) {
    return releaseAndForgetBinding("releaseRenewalPredecessorAttachments", sessionId, input, options);
  }

  function releaseRenewalPredecessorProcessExitProof(sessionId = "", input = {}, options = {}) {
    return releaseAndForgetBinding("releaseRenewalPredecessorProcessExitProof", sessionId, input, options);
  }

  function releaseRenewalSuccessorProcessExitProof(sessionId = "", input = {}, options = {}) {
    return releaseAndForgetBinding("releaseRenewalSuccessorProcessExitProof", sessionId, input, options);
  }

  /**
   * Local storage work is explicitly invoked by trusted host code. It neither
   * selects the current assistant nor authorizes a model inference.
   * One native history operation of the binding's engine, refused with its own message when no installed engine has it.
   * @param {SessionAgentProviderMethod} method
   * @param {string} unavailableMessage
   * @param {string} sessionId
   * @param {object} binding
   * @param {object} options
   */
  function callNativeHistoryOperation(method, unavailableMessage, sessionId, binding, options) {
    const provider = state.providerById.get(binding.engineId);
    if (!provider) throw new TypeError(unavailableMessage);
    const operation = conversationOperations.providerOperation(provider, method);
    return operation.call(provider, { ...options, sessionId }, binding);
  }

  function retireConversationHistory(sessionId, binding, options = {}) {
    return callNativeHistoryOperation(
      "retireConversationHistory",
      "Native history retirement is unavailable for this engine.",
      sessionId,
      binding,
      options
    );
  }

  function listNativeConversationStorage(sessionId, binding, options = {}) {
    return callNativeHistoryOperation(
      "listNativeConversationStorage",
      "Native history inventory is unavailable for this engine.",
      sessionId,
      binding,
      options
    );
  }

  async function closeProject(input = {}, options = {}) {
    const result = await providerCalls.callAllProviders("closeProject", input, options);
    if (result?.ok !== false) {
      const providerId = sessionAgentProviderId(options);
      for (const [terminalId, terminal] of state.terminalBindings) {
        if ((!providerId || terminal.providerId === providerId) &&
            (!input.modelProviderId || terminal.selection?.modelProviderId === input.modelProviderId)) {
          state.terminalBindings.delete(terminalId);
        }
      }
    }
    return result;
  }

  async function deleteConversation(sessionId, input = {}, options = {}) {
    const result = await providerCalls.callSessionProvider("deleteConversation", sessionId, input, options);
    if (result?.ok !== false && options.routingConversationId) sessionBindings.forgetBinding(bindingKey(sessionId, options));
    return result;
  }

  async function invalidateRuntimes(input = {}, options = {}) {
    const engineId = input.provider;
    // readable-check: allow method-probe - input validation: a credential change's optional publication of the reconnected sessions
    const credentialChange = typeof input.publish === "function" &&
      (engineId === "opencode" || engineId === "claude" && input.reason === "provider-key-change");
    if (!credentialChange) return providerCalls.callAllProviders("invalidateRuntimes", input, options);
    if (state.connectionChanges.has(engineId)) throw connectionChangeBusy(engineId);
    state.connectionChanges.add(engineId);
    try {
      await Promise.all([...state.terminalStarts]);
      // Every running OpenCode PTY shares the one service. A Claude PTY keeps
      // running only when it is known to use another provider.
      const holders = runningNativeTerminals(engineId).filter(({ binding }) => engineId === "opencode" ||
        !binding || binding.selection?.modelProviderId === input.modelProviderId);
      if (holders.length) throw connectionChangeBusy(engineId, [...new Set(holders.map(({ sessionId }) => sessionId))]);
      if (engineId === "claude") await input.prepare();
      const result = await providerCalls.callAllProviders("invalidateRuntimes", input, { ...options, engineId });
      if (engineId === "claude" && result?.ok !== false) await input.publish();
      return result;
    } finally {
      state.connectionChanges.delete(engineId);
    }
  }

  async function reconcileSessions(sessions = [], options = {}) {
    const grouped = new Map();
    for (const session of sessions) {
      const provider = sessionBindings.providerFor({ ...options, session });
      const values = grouped.get(provider.id) || [];
      values.push(session);
      grouped.set(provider.id, values);
    }
    const results = [];
    for (const [providerId, providerSessions] of grouped) {
      const provider = state.providerById.get(providerId);
      const operation = conversationOperations.providerOperation(provider, "reconcileSessions");
      if (assistantUser(options)) {
        for (const session of providerSessions) {
          await accessChecks.requireAccessFor(provider, session?.sessionId, {
            ...options,
            session
          });
        }
      }
      results.push(agentOperationResult(provider, "", await operation.call(provider, {
        providerId: provider.id,
        transportId: provider.transportId
      }, providerSessions, options)));
    }
    return Object.freeze({
      ok: true,
      results: Object.freeze(results)
    });
  }

  return Object.freeze({
    closeProject,
    closeSession,
    deleteConversation,
    deleteEphemeralConversation,
    invalidateRuntimes,
    listNativeConversationStorage,
    reconcileSessions,
    releaseRenewalPredecessorAttachments,
    releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof,
    retireConversationHistory
  });
}

export {
  createSessionAgentLifecycle
};
