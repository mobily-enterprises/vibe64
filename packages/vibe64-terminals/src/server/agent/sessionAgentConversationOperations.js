import { openMainConversation } from "../mainConversationBinding.js";

/** @typedef {import("../types.js").ConversationRuntime} ConversationRuntime */

const CONVERSATION_COMMANDS = Object.freeze({
  sendMessage: (conversation, request) => conversation.send(request.input),
  sessionState: conversation => conversation.read(),
  inspectMessageAdmission: (conversation, request) => conversation.inspectDelivery(request.input),
  interruptTurn: (conversation, request) => Object.hasOwn(request, "input") ? conversation.cancel(request.input) : conversation.cancel(),
  readGoal: conversation => conversation.readGoal(),
  updateGoal: (conversation, request) => conversation.updateGoal(request.input),
  readConversation: (conversation, request) => conversation.read(request.input),
  startConversationTurn: (conversation, request) => conversation.send(request.input),
  waitForConversationTurn: (conversation, request) => conversation.wait(request.input),
  stopConversation: (conversation, request) => conversation.cancel(request.input),
  deleteConversation: (conversation, request) => conversation.dispose(request.input)
});
// Operations served directly by the shared conversation runtime: the error when
// it is absent, whether the provider projects the result, and the runtime call.
const RUNTIME_CONVERSATION_OPERATIONS = Object.freeze({
  closeProject: { missing: "Native project cleanup requires the shared runtime.", project: true,
    run: (runtime, context, input) => runtime.closeNativeProject({ context, input }) },
  invalidateRuntimes: { missing: "Native runtime invalidation requires the shared runtime.", project: true,
    run: (runtime, context, input) => runtime.invalidateNativeRuntimes({ context, input }) },
  reconcileSessions: { missing: "Native reconciliation requires the shared runtime.", project: true,
    run: (runtime, context, sessions, options) => runtime.reconcileNativeSessions({ context, sessions, options }) },
  unsubscribeSessions: { missing: "Native subscription reset requires the shared runtime.", project: true,
    run: (runtime, context, sessions) => runtime.unsubscribeNativeSessions({ context, sessions }) },
  hasActiveTemporaryConversation: { missing: "Native activity requires the shared runtime.", project: true,
    run: (runtime, context) => runtime.inspectNativeTemporaryActivity({ id: context.sessionId, context }) },
  interruptDetachedChatTurn: { missing: "Historical native cleanup requires the shared runtime.",
    run: (runtime, context, input) => runtime.interruptNativeDetachedConversation({ id: context.sessionId, context, input }) },
  deleteDetachedChatThread: { missing: "Historical native cleanup requires the shared runtime.",
    run: (runtime, context, input) => runtime.deleteNativeDetachedConversation({ id: context.sessionId, context, input }) },
  listNativeConversationStorage: { missing: "Native history storage requires the shared runtime.",
    run: (runtime, context, binding) => runtime.listNativeConversationStorage({ id: context.sessionId, context, binding }) },
  retireConversationHistory: { missing: "Native history storage requires the shared runtime.",
    run: (runtime, context, binding) => runtime.retireNativeConversationHistory({ id: context.sessionId, context, binding }) },
  updateSessionSettings: { missing: "Native settings require the shared runtime.", project: true,
    run: (runtime, context, input) => runtime.updateNativeConversationSettings({ id: context.sessionId, context, input }) },
  ensureSession: { missing: "Native conversation readiness requires the shared runtime.", project: true,
    run: (runtime, context) => runtime.ensureNativeConversation({ id: context.sessionId, context }) },
  createConversation: { missing: "Native conversation creation requires the shared runtime.",
    run: (runtime, context, input) => runtime.createNativeConversation({ id: context.sessionId, context, input }) },
  releaseRenewalPredecessorProcessExitProof: { missing: "Native renewal proof release requires the shared runtime.",
    run: (runtime, context, input) => runtime.releaseNativeRenewalPredecessorProcessExitProof({ id: context.sessionId, context, input }) },
  releaseRenewalSuccessorProcessExitProof: { missing: "Native renewal proof release requires the shared runtime.",
    run: (runtime, context, input) => runtime.releaseNativeRenewalSuccessorProcessExitProof({ id: context.sessionId, context, input }) }
});

const SCOPED_CONVERSATION_METHODS = new Set(["readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation"]);

/**
 * The operation a provider serves for a method: the shared conversation
 * runtime's when the provider routes the method there (runtime-wide
 * operations, native cleanup and renewal, and the conversation commands, each
 * with its provider's request and result adapters), otherwise the provider's
 * own method.
 * @param {object} dependencies
 * @param {ConversationRuntime} dependencies.conversationRuntime
 */
function createSessionAgentConversationOperations({ conversationRuntime }) {
  function conversationOperation(provider, method) {
    if (!provider.conversationOperations?.includes(method)) return null;
    const runtimeOperation = RUNTIME_CONVERSATION_OPERATIONS[method];
    if (runtimeOperation) return (context, ...args) => {
      if (!conversationRuntime) throw new TypeError(runtimeOperation.missing);
      const perform = () => runtimeOperation.run(conversationRuntime, context, ...args);
      return runtimeOperation.project ? provider.projectConversationResult(method, perform) : perform();
    };
    if (method === "closeSession") return async context => {
      if (!conversationRuntime) throw new TypeError("Native conversation cleanup requires the shared runtime.");
      const closed = await conversationRuntime.disposeNative(provider.prepareConversationRequest(method, context));
      if (!closed) throw new TypeError("Native conversation cleanup requires its configured conversation host.");
      return closed.result;
    };
    if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") return (context, input) => {
      if (!conversationRuntime) throw new TypeError("Native renewal requires the shared runtime.");
      // Preserve the provider's original input/options projection before its result boundary.
      const request = provider.prepareConversationRequest(method, context, input);
      const current = request.context === context ? context : {
        ...request.context, sessionId: context.sessionId, providerId: context.providerId
      };
      return provider.projectConversationResult(method, () => method === "generateSessionRenewalHandover"
        ? conversationRuntime.generateNativeRenewalHandover({ id: context.sessionId, context: current, input: request.input })
        : conversationRuntime.seedNativeRenewalHandover({ id: context.sessionId, context: current, input: request.input }));
    };
    const command = CONVERSATION_COMMANDS[method];
    // readable-check: allow method-probe - optional operation: a provider without conversation adapters has no conversation commands
    if (!command || typeof provider.prepareConversationRequest !== "function" ||
        // readable-check: allow method-probe - optional operation: a provider without conversation adapters has no conversation commands
        typeof provider.projectConversationResult !== "function") {
      throw new TypeError("Conversation operations require their request and result adapters.");
    }
    const scoped = SCOPED_CONVERSATION_METHODS.has(method);
    return (context, input) => {
      if (!conversationRuntime || !scoped && context.assistantScope) {
        throw new TypeError("Conversation operations require the shared runtime and their original session or scope.");
      }
      // Request normalization retains its original position outside the Codex
      // result/error boundary. Only the original OpenCode context read is async.
      const prepared = provider.prepareConversationRequest(method, context, input);
      const dispatch = request => {
        if (scoped) {
          if (!(context.assistantScope || context.routingConversationId && input.persistent === true) ||
              request.scopedConversationId === undefined) {
            throw new TypeError("A retained conversation operation requires its original scope and native identity.");
          }
          return conversationRuntime.open({ id: context.sessionId, representation: "native",
            context: { ...context, scopedConversationId: request.scopedConversationId }
          }).then(conversation => command(conversation, request));
        }
        if (Object.hasOwn(request, "value")) return request.value;
        return provider.projectConversationResult(method, async () => {
          const goalOperation = method === "readGoal" ? "read" : method === "updateGoal" ? "update" : "";
          const conversation = await openMainConversation(conversationRuntime,
            method === "interruptTurn" ? { ...context, allowClosing: true } :
              context.canonicalGoal && goalOperation ? { ...context, goalOperation } : context,
            request.prepareInput, context.canonicalGoal && goalOperation ? "canonical" : "native");
          return command(conversation, request);
        });
      };
      // readable-check: allow method-probe - data: a request adapter answers with its request or a promise of it
      return prepared && typeof prepared.then === "function" ? prepared.then(dispatch) : dispatch(prepared);
    };
  }

  function providerOperation(provider, method) {
    return conversationOperation(provider, method) || provider[method];
  }

  return Object.freeze({
    providerOperation
  });
}

export {
  createSessionAgentConversationOperations
};
