/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */

// A composed host's Production Env (the settings its Deploy to production gives a project's app) is provided to the
// agent Env command through this token. The command only writes it and reads its names: no value of it ever comes
// back, and nothing reaches Production until the person deploys. Without one the command says the installation has no
// Production Env.
const TERMINALS_PRODUCTION_ENVIRONMENT_TOKEN = "vibe64.terminals.production-environment";

const PRODUCTION_UNAVAILABLE_REASON = "Production Env is not available in this Vibe64 installation.";

async function productionEnvironmentUnavailable() {
  return {
    ok: false,
    code: "vibe64_agent_env_command_production_unavailable",
    error: PRODUCTION_UNAVAILABLE_REASON
  };
}

/**
 * The workspace without a Production Env: it has no records and refuses every change.
 * @type {ProductionEnvironmentProvider}
 */
const NO_PRODUCTION_ENVIRONMENT = Object.freeze({
  readRecords: productionEnvironmentUnavailable,
  removeVariable: productionEnvironmentUnavailable,
  // readable-check: allow setter-seam - not a slot: setVariable saves one Production Env variable
  setVariable: productionEnvironmentUnavailable
});

/** @param {ProductionEnvironmentProvider} provider */
function offersProductionEnvironment(provider) {
  return provider !== NO_PRODUCTION_ENVIRONMENT;
}

const PRODUCTION_OPERATIONS = Object.freeze(["readRecords", "setVariable", "removeVariable"]);

/** @param {unknown} provider */
function assertProductionEnvironmentProvider(provider) {
  if (
    provider &&
    (typeof provider !== "object" ||
      // readable-check: allow method-probe - input validation: a host's Production Env provider is checked when it is received
      PRODUCTION_OPERATIONS.some((name) => typeof provider[name] !== "function"))
  ) {
    throw new TypeError(
      `Vibe64 Production Env provider must expose ${PRODUCTION_OPERATIONS.map((name) => `${name}()`).join(", ")}, or be null.`
    );
  }
}

export {
  NO_PRODUCTION_ENVIRONMENT,
  PRODUCTION_UNAVAILABLE_REASON,
  TERMINALS_PRODUCTION_ENVIRONMENT_TOKEN,
  assertProductionEnvironmentProvider,
  offersProductionEnvironment
};
