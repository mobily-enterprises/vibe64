import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

/** @typedef {() => ReturnType<typeof import("@local/studio-terminal-core/server/claudeRuntime").readClaudeCodeAuthStatus>} ReadClaudeAccountStatus */

/**
 * What the service's parts share: the turn completions in flight, the shutdown signal, and the assistant
 * runtime a host configures. What changes after construction has one place each: shutdown progress and
 * the running goal recovery in `lifecycle`, and the providers a composing host fills in `slots`.
 * @param {object} dependencies
 * @param {ReadClaudeAccountStatus} dependencies.readClaudeAccountStatus
 */
function createServiceState({ readClaudeAccountStatus }) {
  const turnCompletions = new Set();
  // Server shutdown happens once. Its signal stops discarded background AI
  // work (session naming).
  const shutdownSignal = new AbortController();
  const assistantRuntime = {
    claudeConnectionStatus: async () => (await readClaudeAccountStatus()).loggedIn === true,
    codexConnectionStatus: async () => true,
    listConnections: async () => [],
    readAssistantAccess: async () => ({ ownerOnly: false }),
    resolveAssistantUser: async (user) => user || currentProjectRequestContext()?.vibe64User || null,
    createActionContext: (actor) => ({ surface: "app", channel: "internal", requestMeta: { request: { vibe64User: actor } } }),
    authorizeProjectMessage: async (actor) => actor,
    resolveConnection: async () => null,
    updateModelAccess: null
  };

  return Object.freeze({
    assistantRuntime,
    lifecycle: Object.seal({ closing: false, goalRecovery: undefined }),
    shutdownSignal,
    slots: Object.seal({ connectedPreparation: null, databaseToolsProvider: null, planCompleted: null, sourceEditorProvider: null }),
    turnCompletions
  });
}

export {
  createServiceState
};
