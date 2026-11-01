import { createProjectServices } from "../../packages/vibe64-terminals/src/server/projectServices.js";
import { NO_PRODUCTION_ENVIRONMENT } from "../../packages/vibe64-terminals/src/server/productionEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS } from "../../packages/vibe64-terminals/src/server/savedEnvValueLinks.js";

const publishNothing = async () => null;

// The project service operations a test's plain project double may leave out, answering as a project without
// prepared resources, practice projects or a runtime root of its own would.
const PROJECT_SERVICE_DOUBLE_DEFAULTS = Object.freeze({
  currentProjectRuntimeRoot: () => "",
  listPracticeProjectSlugs: async () => [],
  projectEnvironmentStatus: async () => ({ status: "ready" }),
  projectExecutionEnvironment: async () => ({}),
  projectInspectionEnvironment: async () => ({})
});

/**
 * Completes a plain project double in place, so the operations the test sets or replaces later stay its own.
 * @param {object} [project]
 */
function completedProjectDouble(project) {
  if (project && Object.getPrototypeOf(project) === Object.prototype) {
    Object.setPrototypeOf(project, PROJECT_SERVICE_DOUBLE_DEFAULTS);
  }
  return project;
}

/**
 * The terminals service's dependencies with the collaborators its feature always passes filled in: every session
 * change publisher (a test's own publishers replace the matching ones), the project runtime publisher, fresh project
 * services, the default production Env and saved values, and the project service operations a plain project double
 * leaves out.
 * @param {object} dependencies
 */
function terminalsServiceCollaborators({ publishSessionChanged = {}, projectServices = null, ...dependencies }) {
  completedProjectDouble(dependencies.project);
  return {
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT,
    publishProjectRuntimeChanged: publishNothing,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    ...dependencies,
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

export { completedProjectDouble, terminalsServiceCollaborators };
