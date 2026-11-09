import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

/** @typedef {import("./types.js").ReadClaudeAccountStatus} ReadClaudeAccountStatus */
/** @typedef {import("./types.js").AssistantRuntime} AssistantRuntime */

/**
 * What the service's parts share: the work in flight that shutdown waits for, the shutdown signal, and the assistant
 * runtime a host configures. What changes after construction has one place each: shutdown progress and
 * the running goal recovery in `lifecycle`, and in `slots` the providers other owners fill and clear at their shutdown.
 * @param {object} dependencies
 * @param {ReadClaudeAccountStatus} dependencies.readClaudeAccountStatus
 */
function createServiceState({ readClaudeAccountStatus }) {
  const shutdownWork = new Set();
  /**
   * Work that writes the session after the call that started it has returned: a turn's checkpoint
   * and follow-up work, a Cancel's goal pause. Shutdown waits for it before it stops anything, so
   * nothing writes a session after the service closed. Its owner reports its failure.
   * @template T
   * @param {Promise<T>} work
   * @returns {Promise<T>}
   */
  function trackShutdownWork(work) {
    shutdownWork.add(work);
    const forget = () => shutdownWork.delete(work);
    work.then(forget, forget);
    return work;
  }
  // Server shutdown happens once. Its signal stops discarded background AI
  // work (session naming).
  const shutdownSignal = new AbortController();
  /**
   * The defaults keep their own types, so a call through serviceState reaches the default it runs.
   * @satisfies {AssistantRuntime}
   */
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

  /**
   * The sessions whose agent-write lock a write that runs while the AI works (Save, Update, Save's recovery)
   * holds now. Stop and steers never wait for it (`stop` in assistantRoutingCancellation.js).
   * @type {Set<string>}
   */
  const writesWhileAssistantWorks = new Set();

  return Object.freeze({
    assistantRuntime,
    lifecycle: Object.seal({ closing: false, goalRecovery: undefined }),
    shutdownSignal,
    slots: Object.seal({
      databaseToolsProvider: null,
      pagesProvider: null,
      planCompleted: null,
      sourceEditorProvider: null
    }),
    shutdownWork,
    trackShutdownWork,
    writesWhileAssistantWorks
  });
}

export {
  createServiceState
};
