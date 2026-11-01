/**
 * The preview command service's shared state: each session's registered
 * browser workers, by socket path, and the one browser test run a session may
 * have.
 */
function createAgentPreviewCommandState() {
  const browserWorkers = new Map();
  const browserTestRuns = new Map();

  return Object.freeze({
    browserTestRuns,
    browserWorkers
  });
}

export {
  createAgentPreviewCommandState
};
