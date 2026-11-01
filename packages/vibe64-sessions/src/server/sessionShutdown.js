/** @typedef {import("./types.js").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Stops a sessions service's work at server shutdown: renewal admission,
 * presence and startup recovery close, and every agent runtime is invalidated.
 * Each step runs even when another fails; the failures are reported together.
 * @param {object} dependencies
 * @param {SessionsService} dependencies.sessions
 * @param {TerminalsService} dependencies.terminals
 */
async function stopSessionWork({ sessions, terminals }) {
  const operations = [
    Promise.resolve(sessions.closeSessionRenewalWork()),
    Promise.resolve(sessions.closeSessionPresence()),
    sessions.stopResumingInterruptedWork(),
    Promise.resolve().then(async () => {
      const result = await terminals.invalidateAgentRuntimes({
        reason: "server-shutdown"
      });
      if (result?.ok === false) {
        const error = new Error("Assistant runtime shutdown did not complete successfully.");
        error.code = "vibe64_agent_runtime_shutdown_failed";
        error.details = result;
        throw error;
      }
      return result;
    })
  ];
  const results = await Promise.allSettled(operations);
  const failures = results.flatMap((result) => (
    result.status === "rejected" ? [result.reason] : []
  ));
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Session renewal work did not stop cleanly."
    );
  }
}

export { stopSessionWork };
