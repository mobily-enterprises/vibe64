import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { createTerminalsSetupRunner } from "../../packages/vibe64-sessions/src/server/sessionWorkspaceSetup.js";

// The session service requires each collaborator and calls the terminal and
// project operations it uses unconditionally. A test that leaves one out gets
// the neutral value that operation's absence meant.
const NEUTRAL_TERMINAL_OPERATIONS = Object.freeze({
  agentSessionState: async () => null,
  inspectSessionUpdateFailure: async () => ({}),
  listAssistantCapabilities: async () => ({ engines: [], ok: true, unavailable: true }),
  readAgentGoal: async () => null,
  removeOutputResultsForSession: async () => {},
  removeSessionCommandHelpers: async () => {},
  retireSessionWorkSave: async () => {},
  setConnectedPreparation() {},
  setPlanCompleted() {},
  waitForWorkspaceSetup: () => null,
  workspaceSetupIsRunning: () => false
});
const NEUTRAL_PROJECT_OPERATIONS = Object.freeze({
  releaseSessionResources: async () => {}
});

function withOperations(double, operations) {
  const missing = Object.fromEntries(Object.entries(operations).filter(([name]) => !(name in double)));
  if (Object.keys(missing).length === 0) return double;
  if (!Object.isExtensible(double)) return Object.assign(Object.create(double), missing);
  return Object.assign(double, missing);
}

/**
 * The session service over a test's doubles, completed with neutral
 * collaborators and operations.
 * @param {Parameters<typeof createService>[0]} dependencies
 */
function createSessionsService(dependencies) {
  const terminals = withOperations(dependencies.terminals, NEUTRAL_TERMINAL_OPERATIONS);
  return createService({
    publishProjectChanged: async () => null,
    publishSessionChanged: async () => null,
    sessionPresence: { close() {}, update: async () => ({ ok: true, status: "unavailable" }) },
    workspaceSetupRunner: createTerminalsSetupRunner(terminals),
    ...dependencies,
    project: withOperations(dependencies.project, NEUTRAL_PROJECT_OPERATIONS),
    terminals
  });
}

export { createSessionsService };
