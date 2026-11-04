import { openMainConversation } from "../mainConversationBinding.js";

/** @typedef {import("../types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("../types.js").SessionAgentProvider} SessionAgentProvider */
/** @typedef {import("../types.js").SessionAgentProviderMethod} SessionAgentProviderMethod */

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
// Operations served directly by the shared conversation runtime: whether the
// provider projects the result, and the runtime call.
const RUNTIME_CONVERSATION_OPERATIONS = Object.freeze({
  closeProject: {
    project: true,
    run: (runtime, context, input) => runtime.closeNativeProject({ context, input })
  },
  invalidateRuntimes: {
    project: true,
    run: (runtime, context, input) => runtime.invalidateNativeRuntimes({ context, input })
  },
  reconcileSessions: {
    project: true,
    run: (runtime, context, sessions, options) => runtime.reconcileNativeSessions({ context, sessions, options })
  },
  unsubscribeSessions: {
    project: true,
    run: (runtime, context, sessions) => runtime.unsubscribeNativeSessions({ context, sessions })
  },
  hasActiveAiTaskConversation: {
    project: true,
    run: (runtime, context) => runtime.inspectNativeTemporaryActivity({ id: context.sessionId, context })
  },
  interruptDetachedChatTurn: {
    run: (runtime, context, input) => runtime.interruptNativeDetachedConversation({ id: context.sessionId, context, input })
  },
  deleteDetachedChatThread: {
    run: (runtime, context, input) => runtime.deleteNativeDetachedConversation({ id: context.sessionId, context, input })
  },
  listNativeConversationStorage: {
    run: (runtime, context, binding) => runtime.listNativeConversationStorage({ id: context.sessionId, context, binding })
  },
  retireConversationHistory: {
    run: (runtime, context, binding) => runtime.retireNativeConversationHistory({ id: context.sessionId, context, binding })
  },
  updateSessionSettings: {
    project: true,
    run: (runtime, context, input) => runtime.updateNativeConversationSettings({ id: context.sessionId, context, input })
  },
  ensureSession: {
    project: true,
    run: (runtime, context) => runtime.ensureNativeConversation({ id: context.sessionId, context })
  },
  createConversation: {
    run: (runtime, context, input) => runtime.createNativeConversation({
      id: context.sessionId,
      context,
      input
    })
  },
  releaseRenewalPredecessorProcessExitProof: {
    run: (runtime, context, input) => runtime.releaseNativeRenewalPredecessorProcessExitProof({ id: context.sessionId, context, input })
  },
  releaseRenewalSuccessorProcessExitProof: {
    run: (runtime, context, input) => runtime.releaseNativeRenewalSuccessorProcessExitProof({ id: context.sessionId, context, input })
  }
});

const SCOPED_CONVERSATION_METHODS = new Set([
  "readConversation",
  "startConversationTurn",
  "waitForConversationTurn",
  "stopConversation",
  "deleteConversation"
]);

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
    if (runtimeOperation) {
      return (context, ...args) => {
        const perform = () => runtimeOperation.run(conversationRuntime, context, ...args);
        return runtimeOperation.project ? provider.projectConversationResult(method, perform) : perform();
      };
    }
    if (method === "closeSession") {
      return async context => {
        const closed = await conversationRuntime.disposeNative(provider.prepareConversationRequest(method, context));
        if (!closed) throw new TypeError("Native conversation cleanup requires its configured conversation host.");
        return closed.result;
      };
    }
    if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") {
      return (context, input) => {
      // Preserve the provider's original input/options projection before its result boundary.
        const request = provider.prepareConversationRequest(method, context, input);
        const current = request.context === context ? context : {
          ...request.context,
          sessionId: context.sessionId,
          providerId: context.providerId
        };
        return provider.projectConversationResult(method, () => method === "generateSessionRenewalHandover"
          ? conversationRuntime.generateNativeRenewalHandover({ id: context.sessionId, context: current, input: request.input })
          : conversationRuntime.seedNativeRenewalHandover({ id: context.sessionId, context: current, input: request.input }));
      };
    }
    const command = CONVERSATION_COMMANDS[method];
    if (!command) {
      throw new TypeError("Conversation operations require their request and result adapters.");
    }
    const scoped = SCOPED_CONVERSATION_METHODS.has(method);
    return (context, input) => {
      if (!scoped && context.assistantScope) {
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
          return conversationRuntime.open({
            id: context.sessionId,
            representation: "native",
            context: { ...context, scopedConversationId: request.scopedConversationId }
          }).then(conversation => command(conversation, request));
        }
        if (Object.hasOwn(request, "value")) return request.value;
        return provider.projectConversationResult(method, async () => {
          const goalOperation = method === "readGoal" ? "read" : method === "updateGoal" ? "update" : "";
          const conversation = await openMainConversation(
            conversationRuntime,
            method === "interruptTurn" ? { ...context, allowClosing: true } :
              context.canonicalGoal && goalOperation ? { ...context, goalOperation } : context,
            request.prepareInput,
            context.canonicalGoal && goalOperation ? "canonical" : "native"
          );
          return command(conversation, request);
        });
      };
      return prepared instanceof Promise ? prepared.then(dispatch) : dispatch(prepared);
    };
  }

  /**
   * The operation the provider serves for a contract method, or undefined when its engine has none.
   * @param {SessionAgentProvider} provider
   * @param {SessionAgentProviderMethod} method
   */
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
