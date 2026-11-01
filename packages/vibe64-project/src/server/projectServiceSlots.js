/**
 * The slot one project service fills after construction: Sessions sets the
 * observer of an applied starter through the service's setter, and the service
 * reads it when a starter is applied.
 * @typedef {object} ProjectServiceSlots
 * @property {((change: { sessionId: string }) => unknown) | null} templateApplicationObserver Workspace preparation after a starter.
 */

/** @returns {ProjectServiceSlots} */
function createProjectServiceSlots() {
  return {
    templateApplicationObserver: null
  };
}

export { createProjectServiceSlots };
