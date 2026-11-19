import { unavailableStagingStatus } from "./agentEnvCommandText.js";
import { STAGING_UNAVAILABLE_REASON } from "./agentStagingStatus.js";

/** @typedef {import("./types.js").StagingEnvironmentProvider} StagingEnvironmentProvider */

// A composed host's staging Env (the variables of a project's staging
// app), a names-only view of that staging and, where the host
// allows a session, staging itself (its values and an SSH login) are
// provided to the agent Env command through this token. Without one the
// command offers Development Env only and reports that the installation does
// not deploy.
const TERMINALS_STAGING_ENVIRONMENT_TOKEN = "vibe64.terminals.staging-environment";

async function stagingEnvironmentUnavailable() {
  return {
    ok: false,
    code: "vibe64_agent_env_command_staging_unavailable",
    error: unavailableStagingStatus().reason
  };
}

async function stagingStatusUnavailable() {
  return {
    ok: false,
    code: "vibe64_agent_staging_status_unavailable",
    error: STAGING_UNAVAILABLE_REASON
  };
}

/**
 * The workspace without a staging Env: it has no records, Staging status or staging to reach, and refuses
 * every change.
 * @type {StagingEnvironmentProvider}
 */
const NO_STAGING_ENVIRONMENT = Object.freeze({
  isUserValueRecord: () => false,
  openStagingSsh: stagingStatusUnavailable,
  readStagingStatus: stagingStatusUnavailable,
  readStagingValues: stagingStatusUnavailable,
  readRecords: stagingEnvironmentUnavailable,
  removeVariable: stagingEnvironmentUnavailable,
  // readable-check: allow setter-seam - not a slot: setVariable saves one staging Env variable
  setVariable: stagingEnvironmentUnavailable
});

/** @param {StagingEnvironmentProvider} provider */
function offersStagingEnvironment(provider) {
  return provider !== NO_STAGING_ENVIRONMENT;
}

const STAGING_OPERATIONS = Object.freeze([
  "readRecords",
  "readStagingStatus",
  "readStagingValues",
  "openStagingSsh",
  "isUserValueRecord",
  "setVariable",
  "removeVariable"
]);

/** @param {unknown} provider */
function assertStagingEnvironmentProvider(provider) {
  if (
    provider &&
    (typeof provider !== "object" ||
      // readable-check: allow method-probe - input validation: a host's staging Env provider is checked when it is received
      STAGING_OPERATIONS.some((name) => typeof provider[name] !== "function"))
  ) {
    throw new TypeError(
      `Vibe64 staging Env provider must expose ${STAGING_OPERATIONS.map((name) => `${name}()`).join(", ")}, or be null.`
    );
  }
}

export {
  NO_STAGING_ENVIRONMENT,
  TERMINALS_STAGING_ENVIRONMENT_TOKEN,
  assertStagingEnvironmentProvider,
  offersStagingEnvironment
};
