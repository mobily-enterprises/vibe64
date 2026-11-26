/**
 * The running commands of each session's agent, each cancelled by its caller's signal or by the session's close.
 */
function createSessionCommandRuns() {
  const sessionRuns = new Map();

  /**
   * A command run of the session's: its signal aborts when the caller's does or the session closes; end() forgets it.
   * @param {string} sessionId
   * @param {AbortSignal} [signal]
   */
  function track(sessionId, signal) {
    const abortController = new AbortController();
    const runs = sessionRuns.get(sessionId) || new Set();
    runs.add(abortController);
    sessionRuns.set(sessionId, runs);
    const abort = () => abortController.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    return {
      signal: abortController.signal,
      end() {
        signal?.removeEventListener("abort", abort);
        runs.delete(abortController);
        if (sessionRuns.get(sessionId) === runs && runs.size === 0) sessionRuns.delete(sessionId);
      }
    };
  }

  /** Cancels every command the session is running. @param {string} sessionId */
  function cancelSession(sessionId) {
    for (const abortController of sessionRuns.get(sessionId) || []) abortController.abort();
    sessionRuns.delete(sessionId);
  }

  return Object.freeze({ cancelSession, track });
}

export { createSessionCommandRuns };
