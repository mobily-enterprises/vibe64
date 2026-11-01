/** @typedef {ReturnType<typeof import("./serviceState.js").createServiceState>} ServiceState */
/** @typedef {ReturnType<typeof import("./agentEnvCommand.js").createAgentEnvCommandService>} AgentEnvCommandService */

/**
 * What a composing host fills after construction: the source editor, connected preparation, plan
 * completion and database tools providers, the agent environment's providers, and the assistant
 * runtime's functions.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 */
function createServiceHostSlots({ state, agentEnvCommand }) {
  function configureAssistantRuntime(input = {}) {
    for (const name of [
      "claudeConnectionStatus",
      "codexConnectionStatus",
      "listConnections",
      "readAssistantAccess",
      "resolveAssistantUser",
      "createActionContext",
      "authorizeProjectMessage",
      "resolveConnection",
      "updateModelAccess"
    ]) {
      if (Object.hasOwn(input, name)) {
        // readable-check: allow method-probe - input validation: a host's assistant runtime configuration names functions
        if (typeof input[name] !== "function") {
          throw new TypeError(`Assistant runtime ${name} must be a function.`);
        }
        state.assistantRuntime[name] = input[name];
      }
    }
    return { configured: true, ok: true };
  }

  function setSourceEditorProvider(provider = null) {
    state.slots.sourceEditorProvider = provider;
  }

  function setConnectedPreparation(prepare) {
    if (typeof prepare !== "function") throw new TypeError("Connected preparation requires its Sessions owner.");
    state.slots.connectedPreparation = prepare;
  }

  function setPlanCompleted(handler) {
    if (typeof handler !== "function") throw new TypeError("Plan completion requires its Sessions owner.");
    state.slots.planCompleted = handler;
  }

  function setDatabaseToolsProvider(provider = null) {
    state.slots.databaseToolsProvider = provider;
  }

  function setProductionEnvironmentProvider(provider = null) {
    // readable-check: allow setter-seam - filled by a composing host repository; convert with its supplier
    agentEnvCommand.setProductionEnvironmentProvider(provider);
  }

  function setSavedEnvValueProvider(provider = null) {
    // readable-check: allow setter-seam - filled by a composing host repository; convert with its supplier
    agentEnvCommand.setSavedEnvValueProvider(provider);
  }

  return Object.freeze({
    configureAssistantRuntime,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
    setConnectedPreparation,
    // readable-check: allow setter-seam - cycle: vibe64.database-tools requires vibe64.terminals
    setDatabaseToolsProvider,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
    setPlanCompleted,
    // readable-check: allow setter-seam - filled by a composing host repository; convert with its supplier
    setProductionEnvironmentProvider,
    // readable-check: allow setter-seam - filled by a composing host repository; convert with its supplier
    setSavedEnvValueProvider,
    // readable-check: allow setter-seam - cycle: vibe64.source-editor requires vibe64.terminals
    setSourceEditorProvider
  });
}

export {
  createServiceHostSlots
};
