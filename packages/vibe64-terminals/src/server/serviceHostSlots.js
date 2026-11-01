/** @typedef {import("./types.js").ServiceState} ServiceState */

/**
 * What a composing host fills after construction: the source editor, connected preparation, plan
 * completion and database tools providers, and the assistant runtime's functions.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 */
function createServiceHostSlots({ state }) {
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

  return Object.freeze({
    configureAssistantRuntime,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
    setConnectedPreparation,
    // readable-check: allow setter-seam - cycle: vibe64.database-tools requires vibe64.terminals
    setDatabaseToolsProvider,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
    setPlanCompleted,
    // readable-check: allow setter-seam - cycle: vibe64.source-editor requires vibe64.terminals
    setSourceEditorProvider
  });
}

export {
  createServiceHostSlots
};
