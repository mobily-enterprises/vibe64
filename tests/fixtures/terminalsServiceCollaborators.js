import { createProjectServices } from "../../packages/vibe64-terminals/src/server/projectServices.js";
import { NO_PRODUCTION_ENVIRONMENT } from "../../packages/vibe64-terminals/src/server/productionEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS } from "../../packages/vibe64-terminals/src/server/savedEnvValueLinks.js";

const publishNothing = async () => null;

// The action catalogue the feature always passes, for a test that runs no actions: it lists none and refuses any.
const NO_ACTIONS = Object.freeze({
  listDefinitions: () => [],
  execute: async ({ actionId }) => {
    throw new Error(`This test registers no action ${actionId}.`);
  }
});

// The project service operations a test's plain project double may leave out, answering as a project without
// prepared resources, practice projects, a selected namespace or a runtime root of its own would.
const PROJECT_SERVICE_DOUBLE_DEFAULTS = Object.freeze({
  currentProjectRuntimeRoot: () => "",
  currentTargetRoot: () => "",
  listPracticeProjectSlugs: async () => [],
  projectEnvironmentStatus: async () => ({ status: "ready" }),
  projectExecutionEnvironment: async () => ({}),
  projectInspectionEnvironment: async () => ({})
});

/**
 * Completes a plain project double in place, so the operations the test sets or replaces later stay its own. A real
 * (frozen) project service is left as it is.
 * @param {object} [project]
 */
function completedProjectDouble(project) {
  if (project && Object.isExtensible(project) && Object.getPrototypeOf(project) === Object.prototype) {
    Object.setPrototypeOf(project, PROJECT_SERVICE_DOUBLE_DEFAULTS);
  }
  return project;
}

/**
 * The terminals service's dependencies with the collaborators its feature always passes filled in: an empty action
 * catalogue, every session change publisher (a test's own publishers replace the matching ones), the project runtime
 * publisher, fresh project services, the default production Env and saved values, and the project service operations
 * a plain project double leaves out.
 * @param {object} dependencies
 */
function terminalsServiceCollaborators({ publishSessionChanged = {}, projectServices = null, ...dependencies }) {
  completedProjectDouble(dependencies.project);
  return {
    env: process.env,
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT,
    publishProjectRuntimeChanged: publishNothing,
    runtimeProfile: null,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    ...dependencies,
    // A test helper that has no catalogue of its own passes null.
    actions: dependencies.actions || NO_ACTIONS,
    projectServices: projectServices ?? createProjectServices(),
    publishSessionChanged: {
      agentTerminal: publishNothing,
      agentTerminalClosed: publishNothing,
      outputTarget: publishNothing,
      outputTargetClosed: publishNothing,
      outputTargetStopped: publishNothing,
      ...publishSessionChanged
    }
  };
}

export { NO_ACTIONS, completedProjectDouble, terminalsServiceCollaborators };
