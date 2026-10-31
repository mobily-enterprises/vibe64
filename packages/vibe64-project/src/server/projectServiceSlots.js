/**
 * The slots one project service fills after construction: a composing host
 * repository sets the resource environment and saved value providers, and
 * Sessions the observer of an applied starter, through the service's setters.
 * Each concern reads them when it runs.
 * @typedef {object} ProjectServiceSlots
 * @property {object | null} resourceEnvironmentProvider The host's managed resource environment.
 * @property {object | null} savedEnvValueProvider The host's saved values (vibe64.saved-env-values.v1).
 * @property {((change: { sessionId: string }) => unknown) | null} templateApplicationObserver Workspace preparation after a starter.
 */

/** @returns {ProjectServiceSlots} */
function createProjectServiceSlots() {
  return {
    resourceEnvironmentProvider: null,
    savedEnvValueProvider: null,
    templateApplicationObserver: null
  };
}

export { createProjectServiceSlots };
