// A composed host that runs a project's services for it (its database servers, a cache and the like) gives a session's
// AI control of them through `vibe64-helper services` (agentServicesCommand.js), for the project's development or its
// Staging (target "staging"): their state, their recent logs, a restart, stop or start, and on the session's own
// databases their connections, who waits on whom and an end for one. The host acts only on the services and databases
// of the session's own project, runs every privileged step itself (the AI never gets a database login, an
// administrator's password or a root command: it gets the results), restarts or stops a database server every project
// shares only with the session's Need help raised (the call's needHelp), and records each action, with the session,
// the service and the time, where its people see it. Without a host, Vibe64 runs no such services: a project's
// database server is the person's own.

const TERMINALS_SERVICE_CONTROL_TOKEN = "vibe64.terminals.service-control";

const SERVICE_CONTROL_OPERATIONS = Object.freeze(["listServices", "readServiceLogs", "controlService", "listDatabaseSessions",
  "listDatabaseLocks", "endDatabaseConnection"]);

const SERVICE_CONTROL_UNAVAILABLE = "This Vibe64 runs none of the project's servers itself: its database server and " +
  "any other server it uses are the person's own, reached with the connection values in its Env. Ask the person before " +
  "you restart or stop one of them. The app and its App Services run in Preview (vibe64-helper preview).";

function serviceControlUnavailable() {
  const error = new Error(SERVICE_CONTROL_UNAVAILABLE);
  error.code = "vibe64_service_control_unavailable";
  throw error;
}

/**
 * Without a host: no services to list, and every action refused with why.
 * @type {import("./types.js").ServiceControl}
 */
const NO_SERVICE_CONTROL = Object.freeze({
  listServices: async () => ({ services: [], note: SERVICE_CONTROL_UNAVAILABLE }),
  readServiceLogs: async () => serviceControlUnavailable(),
  controlService: async () => serviceControlUnavailable(),
  listDatabaseSessions: async () => serviceControlUnavailable(),
  listDatabaseLocks: async () => serviceControlUnavailable(),
  endDatabaseConnection: async () => serviceControlUnavailable()
});

/** @param {unknown} provider */
function assertServiceControl(provider) {
  if (provider === null || provider === undefined) return;
  // readable-check: allow method-probe - input validation: a host's service control is checked when it is received
  const missing = SERVICE_CONTROL_OPERATIONS.filter((operation) => typeof provider?.[operation] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`A host's service control needs ${missing.join(", ")}.`);
  }
}

export {
  NO_SERVICE_CONTROL,
  SERVICE_CONTROL_UNAVAILABLE,
  TERMINALS_SERVICE_CONTROL_TOKEN,
  assertServiceControl
};
