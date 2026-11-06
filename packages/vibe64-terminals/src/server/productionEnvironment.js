import { unavailableProductionStatus } from "./agentEnvCommandText.js";
import { DEPLOYMENT_UNAVAILABLE_REASON } from "./agentDeploymentStatus.js";

/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */

// A composed host's production Env (the variables of a project's deployed
// application) and a names-only view of that deployment are provided to the
// agent Env command through this token. Without one the command offers
// Development Env only and reports that the installation does not deploy.
const TERMINALS_PRODUCTION_ENVIRONMENT_TOKEN = "vibe64.terminals.production-environment";

async function productionEnvironmentUnavailable() {
  return {
    ok: false,
    code: "vibe64_agent_env_command_production_unavailable",
    error: unavailableProductionStatus().reason
  };
}

async function deploymentUnavailable() {
  return {
    ok: false,
    code: "vibe64_agent_deployment_unavailable",
    error: DEPLOYMENT_UNAVAILABLE_REASON
  };
}

/**
 * The workspace without a production Env: it has no records or deployment and refuses every change.
 * @type {ProductionEnvironmentProvider}
 */
const NO_PRODUCTION_ENVIRONMENT = Object.freeze({
  isUserValueRecord: () => false,
  readDeployment: deploymentUnavailable,
  readRecords: productionEnvironmentUnavailable,
  removeVariable: productionEnvironmentUnavailable,
  // readable-check: allow setter-seam - not a slot: setVariable saves one production Env variable
  setVariable: productionEnvironmentUnavailable
});

/** @param {ProductionEnvironmentProvider} provider */
function offersProductionEnvironment(provider) {
  return provider !== NO_PRODUCTION_ENVIRONMENT;
}

/** @param {unknown} provider */
function assertProductionEnvironmentProvider(provider) {
  if (
    provider &&
    (typeof provider !== "object" ||
      // readable-check: allow method-probe - input validation: a host's production Env provider is checked when it is received
      typeof provider.readRecords !== "function" ||
      // readable-check: allow method-probe - input validation: a host's production Env provider is checked when it is received
      typeof provider.readDeployment !== "function" ||
      // readable-check: allow method-probe - input validation: a host's production Env provider is checked when it is received
      typeof provider.isUserValueRecord !== "function" ||
      // readable-check: allow method-probe - input validation: a host's production Env provider is checked when it is received
      typeof provider.setVariable !== "function" ||
      // readable-check: allow method-probe - input validation: a host's production Env provider is checked when it is received
      typeof provider.removeVariable !== "function")
  ) {
    throw new TypeError(
      "Vibe64 production Env provider must expose readRecords(), readDeployment(), isUserValueRecord(), setVariable(), and removeVariable(), or be null."
    );
  }
}

export {
  NO_PRODUCTION_ENVIRONMENT,
  TERMINALS_PRODUCTION_ENVIRONMENT_TOKEN,
  assertProductionEnvironmentProvider,
  offersProductionEnvironment
};
