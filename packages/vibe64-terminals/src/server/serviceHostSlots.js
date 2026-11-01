/** @typedef {import("./types.js").ServiceState} ServiceState */

/**
 * What other owners fill after construction: the source editor, connected preparation, plan
 * completion and database tools providers, and the assistant runtime's functions.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 */
function createServiceHostSlots({ state }) {
  /**
   * Replaces the named assistant runtime functions an owner supplies; the rest keep their defaults.
   * vibe64.accounts fills them (signInStatusRuntime.js and aiConnectionRuntime.js), and so does a
   * composing host's auth setup.
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
    if (provider !== null && typeof provider !== "object") {
      throw new TypeError("The source editor provider must be an object or null.");
    }
    state.slots.sourceEditorProvider = provider;
  }

  /**
   * Fills or, at its owner's shutdown, clears connected workspace preparation.
   * @param {Function | null} prepare
   */
  function setConnectedPreparation(prepare) {
    if (prepare !== null && typeof prepare !== "function") {
      throw new TypeError("Connected workspace preparation must be a function or null.");
    }
    state.slots.connectedPreparation = prepare;
  }

  /**
   * Fills or, at its owner's shutdown, clears what follows a completed plan.
   * @param {Function | null} handler
   */
  function setPlanCompleted(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new TypeError("The completed plan handler must be a function or null.");
    }
    state.slots.planCompleted = handler;
  }

  /**
   * Fills or, at its owner's shutdown, clears the database tools provider.
   * @param {object | null} provider
   */
  function setDatabaseToolsProvider(provider) {
    if (provider !== null && typeof provider !== "object") {
      throw new TypeError("The database tools provider must be an object or null.");
    }
    state.slots.databaseToolsProvider = provider;
  }

  return Object.freeze({
    // readable-check: allow setter-seam - cycle: vibe64.accounts requires vibe64.terminals, and a composing host's auth setup fills it too
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
