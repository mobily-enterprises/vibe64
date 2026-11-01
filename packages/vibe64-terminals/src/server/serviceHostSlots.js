/** @typedef {import("./types.js").ServiceState} ServiceState */

/**
 * What a composing host fills after construction: the source editor, connected preparation, plan
 * completion and database tools providers, and the assistant runtime's functions.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 */
function createServiceHostSlots({ state }) {
  /**
   * Replaces the named assistant runtime functions a composing host supplies; the rest keep their defaults.
   * Slot filled by a composing host (vibe64.accounts signInStatusRuntime.js and aiConnectionRuntime.js):
   * convert with its supplier.
   * @param {object} input
   */
  function configureAssistantRuntime(input) {
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

  /**
   * Fills or, at its owner's shutdown, clears the source editor provider.
   * @param {object | null} provider
   */
  function setSourceEditorProvider(provider) {
    state.slots.sourceEditorProvider = provider;
  }

  /**
   * Fills or, at its owner's shutdown, clears connected workspace preparation.
   * @param {Function | null} prepare
   */
  function setConnectedPreparation(prepare) {
    state.slots.connectedPreparation = prepare;
  }

  /**
   * Fills or, at its owner's shutdown, clears what follows a completed plan.
   * @param {Function | null} handler
   */
  function setPlanCompleted(handler) {
    state.slots.planCompleted = handler;
  }

  /**
   * Fills or, at its owner's shutdown, clears the database tools provider.
   * @param {object | null} provider
   */
  function setDatabaseToolsProvider(provider) {
    state.slots.databaseToolsProvider = provider;
  }

  return Object.freeze({
    // readable-check: allow setter-seam - filled by vibe64.accounts and a composing host's auth setup; convert with its supplier
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
