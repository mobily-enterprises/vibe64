import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createMainConversationAuthority } from "../../packages/vibe64-sessions/src/server/mainConversationAuthority.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { prepareNothingForArchive } from "../../packages/vibe64-sessions/src/server/sessionArchive.js";
import { restoreStandaloneRenewalActor } from "../../packages/vibe64-sessions/src/server/sessionRenewalActors.js";
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
    archivePreparation: prepareNothingForArchive,
    localhostCheckBypassed: false,
    logger: silentLogger,
    publishProjectChanged: async () => null,
    restoreRenewalActor: restoreStandaloneRenewalActor,
    publishSessionChanged: async () => null,
    sessionPresence: { close() {}, update: async () => ({ ok: true, status: "unavailable" }) },
    setupRunner: createTerminalsSetupRunner({ terminals }),
    ...dependencies,
    project: withOperations(dependencies.project, NEUTRAL_PROJECT_OPERATIONS),
    terminals
  });
}

/**
 * A sessions double for action tests, completed with the service's own
 * conversation access grant and its Main chat send and approval, which carry
 * the person's browser authority to the double's sendAgentMessage and
 * approveMainChatApproval.
 * @param {object} sessions
 */
function withMainChatOperations(sessions) {
  const { conversationContextGrant, mainBrowserAuthority } = createMainConversationAuthority({ localhostCheckBypassed: false });
  return {
    readConversationContext: conversationContextGrant,
    sendMainChatMessage: ({ sessionId, ...message }, context) =>
      sessions.sendAgentMessage(sessionId, message, { browserAuthority: mainBrowserAuthority(sessionId, context) }),
    approveMainChatMessage: (input, context) => sessions.approveMainChatApproval(input.sessionId, input.approvalId, input,
      { browserAuthority: mainBrowserAuthority(input.sessionId, context) }),
    ...sessions
  };
}

export { createSessionsService, withMainChatOperations };
