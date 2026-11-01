/**
 * The Save and Update operations this process is running: at most one of each
 * per session, by operation id.
 */
function createSessionWorkOperations() {
  const running = Object.freeze({ save: new Map(), update: new Map() });

  /**
   * @param {"save" | "update"} kind
   * @param {string} sessionId
   * @returns {string | undefined}
   */
  function runningOperationId(kind, sessionId) {
    return running[kind].get(sessionId);
  }

  /**
   * @param {"save" | "update"} kind
   * @param {string} sessionId
   * @param {string} operationId
   */
  function start(kind, sessionId, operationId) {
    running[kind].set(sessionId, operationId);
  }

  /**
   * Ends the operation unless a later one of its kind already replaced it.
   * @param {"save" | "update"} kind
   * @param {string} sessionId
   * @param {string} operationId
   */
  function finish(kind, sessionId, operationId) {
    if (running[kind].get(sessionId) === operationId) {
      running[kind].delete(sessionId);
    }
  }

  /** @param {string} sessionId */
  function isRunning(sessionId) {
    return running.save.has(sessionId) || running.update.has(sessionId);
  }

  return Object.freeze({ operationId: runningOperationId, start, finish, isRunning });
}

export { createSessionWorkOperations };
