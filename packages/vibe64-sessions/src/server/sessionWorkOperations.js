/**
 * The Save and Update operations this process is running: at most one of each
 * per session, by operation id.
 */
function createSessionWorkOperations() {
  const running = Object.freeze({ save: new Map(), update: new Map() });

  return Object.freeze({
    /**
     * @param {"save" | "update"} kind
     * @param {string} sessionId
     * @returns {string | undefined}
     */
    operationId(kind, sessionId) {
      return running[kind].get(sessionId);
    },

    /**
     * @param {"save" | "update"} kind
     * @param {string} sessionId
     * @param {string} operationId
     */
    start(kind, sessionId, operationId) {
      running[kind].set(sessionId, operationId);
    },

    /**
     * Ends the operation unless a later one of its kind already replaced it.
     * @param {"save" | "update"} kind
     * @param {string} sessionId
     * @param {string} operationId
     */
    finish(kind, sessionId, operationId) {
      if (running[kind].get(sessionId) === operationId) {
        running[kind].delete(sessionId);
      }
    },

    /** @param {string} sessionId */
    isRunning(sessionId) {
      return running.save.has(sessionId) || running.update.has(sessionId);
    }
  });
}

export { createSessionWorkOperations };
