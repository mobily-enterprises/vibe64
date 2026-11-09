import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { findVibe64AgentProvider } from "@local/vibe64-runtime/shared";

/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ClaudeSessionAgentProvider} ClaudeSessionAgentProvider */
/** @typedef {import("./types.js").CodexSessionRegistration} CodexSessionRegistration */
/** @typedef {import("@local/vibe64-core/server/types").CodexProviderConnectionStore} CodexProviderConnectionStore */

/**
 * Whether a session's assistant can be used: Claude's own account, a curated Codex provider's
 * connection, the Codex account, or the host's assistant runtime for every other engine.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {ClaudeSessionAgentProvider} dependencies.claudeProvider
 * @param {CodexSessionRegistration} dependencies.codex
 * @param {CodexProviderConnectionStore} dependencies.codexProviderConnections
 */
function createServiceProviderAccess({
  state,
  claudeProvider,
  codex,
  codexProviderConnections
}) {
  async function readAssistantAccess(context) {
    if (context.engineId === "claude") {
      return claudeProvider.assistantAccess(context);
    }
    const curated = curatedCodexProvider(context.assistantSelection?.modelProviderId || context.modelProviderId);
    // OpenCode reaches the custom endpoint through the same saved connections.
    const openCodeCustom = context.engineId === "opencode" && curated?.custom === true;
    if (context.engineId !== "codex" && !openCodeCustom) {
      return state.assistantRuntime.readAssistantAccess(context);
    }
    if (curated) {
      const connection = await codexProviderConnections.connectionFor(curated.id);
      const engineState = connection?.engineStates?.[openCodeCustom ? "opencode" : "codex"];
      const available = engineState?.connected === true;
      return {
        available,
        connectionIdentity: engineState?.connectionIdentity || "",
        missingAccountLabel: available ? "" : curated.label,
        ownerOnly: curated.ownerOnly,
        endpointCode: curated.id
      };
    }
    const available = await state.assistantRuntime.codexConnectionStatus(context);
    const missingAccountLabel = available ? "" : findVibe64AgentProvider("codex").accountLabel;
    try {
      return { ...await codex.accounts.assistantAccess(context), available, missingAccountLabel };
    } catch (error) {
      if (available) throw error;
      return { available: false, missingAccountLabel, ownerOnly: true, connectionIdentity: "" };
    }
  }

  return Object.freeze({
    readAssistantAccess
  });
}

export {
  createServiceProviderAccess
};
