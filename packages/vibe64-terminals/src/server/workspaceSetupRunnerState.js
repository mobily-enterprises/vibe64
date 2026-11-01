/**
 * What every part of the workspace setup runner shares: the one workspace
 * inspection it uses, and the runs in progress by run key.
 * @param {object} dependencies
 * @param {(request: object) => Promise<object>} dependencies.inspect
 */
function createWorkspaceSetupRunnerState({ inspect }) {
  const activeRuns = new Map();

  return Object.freeze({
    activeRuns,
    inspect
  });
}

export {
  createWorkspaceSetupRunnerState
};
