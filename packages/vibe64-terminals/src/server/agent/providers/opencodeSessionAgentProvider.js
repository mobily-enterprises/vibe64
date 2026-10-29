import { randomUUID } from "node:crypto";
import { captureProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64HelperExecutionProfileResolution,
  emitVibe64AgentExecutionProfile,
  vibe64HelperExecutionProfileRequest
} from "@local/vibe64-runtime/shared";
import { OPENCODE_EXPECTED_VERSION, throwVibe64OpenCodeError as runtimeFailure } from "../../opencodeServerProcess.js";
import { openCodeSessionId as safeSessionId, opencodeTerminalNamespace } from "../../terminalShared.js";

const OPENCODE_HELPER_PROFILE_REVISION =
  `opencode-${OPENCODE_EXPECTED_VERSION}-selected-model-tool-free-v1`;

function resolveOpenCodeHelperExecutionProfile(context = {}, request = {}) {
  const { executionProfile, limits } = vibe64HelperExecutionProfileRequest(request, "OpenCode");
  const selection = context.assistantSelection || {};
  const modelId = String(selection.modelId || "").trim();
  if (
    selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE ||
    !String(selection.modelProviderId || "").trim() ||
    !modelId
  ) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "Choose this helper's model in Models."
    );
  }
  return defineVibe64HelperExecutionProfileResolution({
    executionProfile,
    limits,
    model: modelId,
    providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    revision: OPENCODE_HELPER_PROFILE_REVISION,
    thinking: String(selection.variantId || "").trim()
  });
}

function createOpenCodeSessionAgentProvider({
  sharedRuntime,
  runNativeDetachedConversation,
  hostPreparation = {},
  accounts,
  mainMessagePreparation = {},
  scopedPreparation = {},
  lifecyclePreparation = {},
  renewalPreparation = {},
  terminals = {},
  publishSessionChanged,
  prepareSessionCleanup
} = {}) {
  if (!accounts) {
    throw new TypeError("OpenCode session agent providers require their account facility.");
  }
  const { configuredConnections, prepareSharedProcess, sessionEnvironments, storedUpstreamSessionId } = hostPreparation;
  const { contextFor, prepareMessageInput, inspection: prepareMessageInspection } = mainMessagePreparation;
  const { prepareConversationCreation, prepareDetachedChatTurn, prepareExistingDetachedTarget } = scopedPreparation;
  const { processRelease, prepareInterruption, prepareSessionReadiness, prepareSessionReconciliation } = lifecyclePreparation;
  const { prepareRenewalHandover, prepareRenewalSeed } = renewalPreparation;
  const { terminalHost } = terminals;

  function prepareConversationHost(sessionId, openingContext = {}, mode = "main") {
    if (mode === "activity") return { native: { owner: sharedRuntime, sessionId: safeSessionId(sessionId) } };
    if (mode === "storage") return {
      native: { owner: sharedRuntime, preparation: {
        storage(options) {
          const context = { sessionId, runtime: options.runtime, session: options.session };
          return { process: () => prepareSharedProcess(context, options), failure: runtimeFailure };
        }
      } }
    };
    if (mode === "renewalProof") return {
      native: { owner: sharedRuntime, preparation: {
        get cleanup() {
          return prepareSessionCleanup(openingContext.sessionId, {
            runtime: openingContext.runtime, session: openingContext.session
          });
        },
        get sessionId() { return safeSessionId(openingContext.sessionId); }
      } }
    };
    if (mode === "renewal") return {
      native: { owner: sharedRuntime, preparation: {
        handover: (input, context) => prepareRenewalHandover(sessionId, input, context),
        seed: (input, context) => prepareRenewalSeed(sessionId, input, context)
      } }
    };
    if (mode === "reconciliation") return {
      native: { owner: sharedRuntime, preparation: { session: prepareSessionReconciliation } }
    };
    if (mode === "invalidation") return {
      native: { owner: sharedRuntime, preparation: {
        // A connection change gives the running server every saved connection.
        connections: () => configuredConnections(),
        get release() { return {
          ...processRelease,
          ownsTarget: (target) => sessionEnvironments.has(target.key)
        }; }
      } }
    };
    if (mode === "projectCleanup") return {
      native: { owner: sharedRuntime, preparation: { projectCleanup: () => ({
        ...processRelease,
        ownsTarget: (target) => sessionEnvironments.has(target.key)
      }) } }
    };
    return (async () => {
      if (mode === "readiness") return {
        native: { owner: sharedRuntime, preparation: { readiness: options => prepareSessionReadiness(sessionId, options) } }
      };
      if (mode === "dispose") return {
        namespace: opencodeTerminalNamespace(sessionId),
        native: { owner: sharedRuntime, preparation: {
          // Preserve the original uncached provider's field projection.
          cleanup: current => prepareSessionCleanup(sessionId, {
            assistantScope: current.assistantScope, runtime: current.runtime, session: current.session,
            renewalCleanup: current.renewalCleanup
          })
        } }
      };
      if (mode === "scoped" || mode === "create" || mode === "detached" || mode === "detachedCleanup") return {
        namespace: opencodeTerminalNamespace(sessionId),
        native: {
          owner: sharedRuntime,
          preparation: {
            cleanup: current => prepareSessionCleanup(sessionId, current),
            creation: (input, options) => prepareConversationCreation(sessionId, input, options),
            turn: (input, options) => prepareDetachedChatTurn(sessionId, input, options, { waitForCompletion: mode === "detached" }),
            existing: (input, options, { operation } = {}) => prepareExistingDetachedTarget(sessionId,
              operation === "delete" ? { ...input, persistent: input.persistent || Boolean(options?.assistantScope) } : input,
              options)
          }
        }
      };
      const context = await contextFor(sessionId, openingContext);
      const { runtime } = context;
      return {
        context, namespace: opencodeTerminalNamespace(sessionId), publish: publishSessionChanged,
        state: {
          async read(current, representation, nativeResult) {
            if (representation === "native") return { nativeResult };
            const session = await runtime.getSession(sessionId, { inspectSource: false });
            return { session, threadId: nativeResult.thread.id, turn: nativeResult.turn, nativeResult };
          }
        },
        native: {
          owner: sharedRuntime,
          async acquire(current) {
            const options = current || context;
            const selected = await contextFor(sessionId, options);
            const projectContext = captureProjectRequestContext();
            return { key: selected.key, options,
              runInContext: operation => runWithProjectRequestContext(projectContext || {}, operation) };
          },
          preparation: {
            state: {
              context: current => contextFor(sessionId, current || context),
              storedThreadId: storedUpstreamSessionId,
              terminalHost
            },
            cleanup: current => prepareSessionCleanup(sessionId, { ...context, ...current }),
            message: (input, options) => mainMessagePreparation.message(sessionId, input, options),
            inspection: (input, options) => prepareMessageInspection(sessionId, input, options),
            interruption: options => prepareInterruption(sessionId, options)
          }
        }
      };
    })();
  }

  async function runDetachedChatTurn(context, input = {}) {
    const executionProfile = emitVibe64AgentExecutionProfile(context, input.executionProfile);
    const result = await runNativeDetachedConversation({
      id: context.sessionId, context, input,
      options: { onEvent: context.onEvent, runtime: context.runtime, session: context.session, vibe64User: context.vibe64User }
    });
    return executionProfile ? { ...result, executionProfile } : result;
  }

  return Object.freeze({
    prepareConversationHost,
    conversationOperations: Object.freeze(["createConversation", "ensureSession", "sendMessage", "sessionState", "inspectMessageAdmission", "interruptTurn", "readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation", "closeSession", "closeProject", "invalidateRuntimes", "reconcileSessions", "generateSessionRenewalHandover", "seedSessionRenewalHandover", "releaseRenewalPredecessorProcessExitProof", "releaseRenewalSuccessorProcessExitProof", "interruptDetachedChatTurn", "deleteDetachedChatThread", "listNativeConversationStorage", "retireConversationHistory", "hasActiveTemporaryConversation"]),
    runDetachedChatTurn,
    streamDetachedChatTurn: runDetachedChatTurn,
    prepareConversationRequest(method, context, input = {}) {
      if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") return {
        input, context: { runtime: context.runtime, session: context.session, vibe64User: context.vibe64User }
      };
      if (method === "interruptDetachedChatTurn" || method === "deleteDetachedChatThread") return {
        input: { conversationId: input.threadId || input.conversationId },
        context: { runtime: context.runtime, session: context.session, vibe64User: context.vibe64User }
      };
      if (method === "ensureSession") return {
        context: { runtime: context.runtime, session: context.session, vibe64User: context.vibe64User }
      };
      if (method === "createConversation") return {
        input,
        context: { assistantScope: context.assistantScope, assistantSelection: context.assistantSelection,
          runtime: context.runtime, session: context.session, vibe64User: context.vibe64User }
      };
      if (method === "closeSession") return {
        namespace: opencodeTerminalNamespace(context.sessionId), sessionId: context.sessionId,
        context, options: context
      };
      if (["readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation"].includes(method)) {
        return { scopedConversationId: String(input.conversationId || "").trim() ? input.conversationId : undefined, input };
      }
      if (method === "sessionState") return {};
      if (method !== "sendMessage") return { input };
      const request = message => ({ input: message, prepareInput(prepared) {
        const current = { ...message, ...prepared };
        return context.prepareMessage ? context.prepareMessage(current) : current;
      } });
      if (String(input.message || "").trim()) {
        return request({ ...input, messageId: String(input.messageId || "").trim() || randomUUID() });
      }
      // The original native preparation distinguishes false/0 from empty text
      // and resolves its application context before allocating a message id.
      return prepareMessageInput(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        turnOwnership: context.turnOwnership,
        vibe64User: context.vibe64User
      }).then(prepared => Object.hasOwn(prepared, "value") ? prepared
        : request({ ...input, message: prepared.message, messageId: prepared.messageId }));
    },
    async projectConversationResult(method, perform) {
      if (method === "hasActiveTemporaryConversation") return { active: await perform(), ok: true };
      return method === "sendMessage" || method === "interruptTurn" ? (await perform()).value : perform();
    },
    executionProfiles: Object.freeze([
      VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER
    ]),
    id: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.OPENCODE_SERVER,
    async capabilities(context, input = {}) {
      return accounts.capabilities(input, context);
    },
    async closeTerminal(context, input = {}) {
      return terminals.closeTerminal(context.sessionId, input.terminalSessionId);
    },
    async describeProvider(context) {
      return accounts.describeProvider(context.sessionId, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async readTerminal(context, input = {}) {
      return terminals.readTerminal(context.sessionId, input.terminalSessionId);
    },
    async releaseRenewalPredecessorAttachments() {
      return { ok: true, released: 0 };
    },
    async resizeTerminal(context, input = {}) {
      return terminals.resizeTerminal(context.sessionId, input.terminalSessionId, input.size);
    },
    resolveExecutionProfile(context, input = {}) {
      return resolveOpenCodeHelperExecutionProfile(context, input);
    },
    async startTerminal(context, input = {}) {
      return terminals.startTerminal(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async subscribeTerminal(context, input = {}) {
      return terminals.subscribeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.subscriber
      );
    },
    async unsubscribeSessions() {
      return { ok: true };
    },
    async writeTerminal(context, input = {}) {
      return terminals.writeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.data,
        input.input,
        {
          runtime: context.runtime,
          session: context.session,
          vibe64User: context.vibe64User
        }
      );
    }
  });
}

export {
  OPENCODE_HELPER_PROFILE_REVISION,
  createOpenCodeSessionAgentProvider,
  resolveOpenCodeHelperExecutionProfile
};
