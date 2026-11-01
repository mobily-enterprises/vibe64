import { createProjectServices } from "../../packages/vibe64-terminals/src/server/projectServices.js";
import { NO_PRODUCTION_ENVIRONMENT } from "../../packages/vibe64-terminals/src/server/productionEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS } from "../../packages/vibe64-terminals/src/server/savedEnvValueLinks.js";

const publishNothing = async () => null;

/**
 * The terminals service's dependencies with the collaborators its feature always passes filled in: every session
 * change publisher (a test's own publishers replace the matching ones), the project runtime publisher, fresh project
 * services and the default production Env and saved values.
 * @param {object} dependencies
 */
function terminalsServiceCollaborators({ publishSessionChanged = {}, projectServices = null, ...dependencies }) {
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

export { terminalsServiceCollaborators };
