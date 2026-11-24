import assert from "node:assert/strict";
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
  noteMainChat: async () => ({ delivered: false, waiting: false }),
  openProjectRuntime: async () => ({ ok: true, runtime: { open: true } }),
  readAgentGoal: async () => null,
  removeOutputResultsForSession: async () => {},
  removeSessionCommandHelpers: async () => {},
  retireSessionWorkSave: async () => {},
  setPlanCompleted() {},
  setSessionSave() {},
  setSessionUpdate() {},
  waitForWorkspaceSetup: () => null,
  workspaceSetupIsRunning: () => false
});
const NEUTRAL_PROJECT_OPERATIONS = Object.freeze({
  releaseSessionResources: async () => {},
  runProjectSourceExclusive: operation => operation()
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

/**
 * A Main chat send through a browser conversation, followed to its delivery as the page follows it: a send whose
 * delivery outlasts the editor's two-second answer (a loaded machine, a slow project open after a restart) answers as
 * held (`status: "queued"`), and its delivery check then reports `accepted`, `not-sent` or `unknown`. The receipt is
 * the send's own when it was not held, and otherwise the held answer with `delivered` from the check, and the check
 * as `delivery`.
 * @param {{ send: (input: object) => Promise<object>, inspectDelivery: (input: object) => Promise<object> }} conversation
 * @param {{ messageId: string }} input
 * @param {{ timeoutMs?: number }} [options]
 */
async function sendFollowed(conversation, input, { timeoutMs = 30_000 } = {}) {
  const receipt = await conversation.send(input);
  if (receipt?.delivered !== false || receipt.status !== "queued") return receipt;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const delivery = await conversation.inspectDelivery({ messageId: input.messageId });
    if (delivery?.status !== "pending") return { ...receipt, delivered: delivery?.status === "accepted", delivery };
    assert.ok(Date.now() < deadline, `${input.messageId} was still held after ${timeoutMs} ms: ${JSON.stringify(delivery)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export { createSessionsService, sendFollowed, withMainChatOperations };
