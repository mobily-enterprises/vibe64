import { VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE } from "@local/vibe64-runtime/shared";
import { bindingKey, providerBindingConflictError, sessionAgentProviderId, sessionAssistantSelection } from "./sessionAgentRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("../types.js").SessionAgentManagerState} SessionAgentManagerState */

function providerNotImplementedError(providerId = "") {
  const id = toText(providerId);
  const error = new Error(`Assistant provider is not implemented: ${id || "(missing)"}.`);
  error.code = VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE;
  error.providerId = id;
  return error;
}

/**
 * Which provider serves each session: the binding a session's first
 * operation makes, its conflicts, and the provider a goal read or stop uses
 * without rebinding.
 * @param {object} dependencies
 * @param {SessionAgentManagerState} dependencies.state
 */
function createSessionAgentBindings({ state }) {
  const bindings = new Map();

  function providerFor(options = {}) {
    const providerId = sessionAgentProviderId(options, state.defaultProviderId);
    const provider = state.providerById.get(providerId);
    if (!provider) {
      throw providerNotImplementedError(providerId);
    }
    return provider;
  }

  function forgetBinding(key) {
    bindings.delete(key);
    state.bindingTokens.delete(key);
  }

  function bindSession(sessionId = "", options = {}) {
    const id = toText(sessionId);
    if (!id) {
      throw new TypeError("Session agent operations require a session id.");
    }
    const key = bindingKey(id, options);
    const currentProviderId = bindings.get(key);
    const selection = sessionAssistantSelection(options);
    const durableProviderId = toText(selection?.engineId);
    const explicitEngineId = toText(options.engineId);
    if (selection && explicitEngineId && selection.engineId !== explicitEngineId) {
      throw providerBindingConflictError(id, selection.engineId, explicitEngineId);
    }
    const requestedProviderId = sessionAgentProviderId(options);
    if (
      !durableProviderId &&
      currentProviderId &&
      requestedProviderId &&
      currentProviderId !== requestedProviderId
    ) {
      throw providerBindingConflictError(id, currentProviderId, requestedProviderId);
    }
    const provider = providerFor({
      ...options,
      providerId: durableProviderId || requestedProviderId || currentProviderId || state.defaultProviderId
    });
    if (selection && !options.routingConversationId) {
      for (const terminal of state.terminalBindings.values()) {
        if (terminal.sessionId === id && (terminal.providerId !== provider.id ||
            terminal.selection?.modelProviderId !== selection.modelProviderId)) {
          terminal.invalidated = true;
        }
      }
    }
    bindings.set(key, provider.id);
    if (!state.bindingTokens.has(key) || (currentProviderId && currentProviderId !== provider.id)) {
      state.bindingTokens.set(key, Object.freeze({}));
    }
    return provider;
  }

  /**
   * Reading or stopping a goal uses the session's current provider without rebinding it.
   */
  function goalProvider(sessionId, options) {
    return providerFor({
      ...options,
      providerId: sessionAgentProviderId(options,
        bindings.get(bindingKey(sessionId, options)) || state.defaultProviderId)
    });
  }

  function binding(sessionId = "", options = {}) {
    return bindings.get(bindingKey(sessionId, options)) || "";
  }

  function conversationProvider(providerId, fallbackProviderId) {
    const provider = state.providerById.get(providerId) || state.providerById.get(fallbackProviderId);
    if (!provider) throw providerNotImplementedError(providerId);
    return provider;
  }

  return Object.freeze({
    bindSession,
    binding,
    conversationProvider,
    forgetBinding,
    goalProvider,
    providerFor
  });
}

export {
  createSessionAgentBindings
};
