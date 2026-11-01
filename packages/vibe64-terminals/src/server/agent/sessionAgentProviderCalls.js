import { requireCompletedConversationRewind, requireCompletedNativeConversationReplacement } from "../assistantChangeover.js";
import {
  defineVibe64AgentExecutionProfileRequest,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { normalizeText } from "@local/vibe64-core/server/core";
import { hasOwn } from "../hasOwn.js";
import {
  agentOperationResult,
  assistantUser,
  bindingKey,
  connectionChangeBusy,
  defineEphemeralAssistantScope,
  sessionAgentProviderId,
  sessionAssistantSelection,
  untrustedExecutionProfileResolutionError,
  verifiedExecutionProfileResolution
} from "./sessionAgentRules.js";

/** @typedef {import("../types.js").SessionAttachments} SessionAttachments */
/** @typedef {import("../types.js").SessionAgentManagerState} SessionAgentManagerState */
/** @typedef {import("../types.js").SessionAgentBindings} SessionAgentBindings */
/** @typedef {import("../types.js").SessionAgentAccess} SessionAgentAccess */
/** @typedef {import("../types.js").SessionAgentConversationOperations} SessionAgentConversationOperations */

const EXECUTION_PROFILE_RESOLUTION_FIELDS = new Set([
  "limits",
  "policy",
  "providerId",
  "request",
  "revision",
  "thinking"
]);

const EXECUTION_PROFILE_RESOLUTION_METHODS = new Set(["runDetachedChatTurn", "streamDetachedChatTurn"]);
const AI_METHODS = new Set([
  "runDetachedChatTurn",
  "streamDetachedChatTurn",
  "createConversation",
  "ensureSession",
  "generateSessionRenewalHandover",
  "resolveExecutionProfile",
  "seedSessionRenewalHandover",
  "sendMessage",
  "startConversationTurn",
  "startTerminal",
  "writeTerminal"
]);

function looksLikeExecutionProfileResolution(value = null) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).some((field) => EXECUTION_PROFILE_RESOLUTION_FIELDS.has(field))
  );
}

function operationKey(sessionId = "", providerId = "", operation = "", identity = "") {
  return [sessionId, providerId, operation, identity].map(normalizeText).join(":");
}

/**
 * Calls into a session's provider: each operation's binding, access,
 * verified execution profile and attachments, coalesced identical calls,
 * and calls to one provider or to all of them.
 * @param {object} dependencies
 * @param {SessionAgentManagerState} dependencies.state
 * @param {SessionAgentBindings} dependencies.sessionBindings
 * @param {SessionAgentAccess} dependencies.accessChecks
 * @param {SessionAgentConversationOperations} dependencies.conversationOperations
 * @param {SessionAttachments} [dependencies.attachments] the session's attachments; without them messages carry none
 */
function createSessionAgentProviderCalls({
  state,
  sessionBindings,
  accessChecks,
  conversationOperations,
  attachments
}) {
  const operations = new Map();
  // A full profile selects provider-owned execution details. Only the exact
  // in-process object issued by this manager may carry those details into a
  // turn; clones and durable snapshots are audit records, not capabilities.
  const verifiedExecutionProfiles = new WeakMap();

  async function coalescedOperation(key = "", operation) {
    const existing = operations.get(key);
    if (existing) {
      return existing;
    }
    const pending = Promise.resolve().then(operation);
    operations.set(key, pending);
    try {
      return await pending;
    } finally {
      if (operations.get(key) === pending) {
        operations.delete(key);
      }
    }
  }

  function rememberVerifiedExecutionProfile(provider = {}, sessionId = "", resolution = null, context = {}) {
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(resolution);
    if (context.assistantScope && snapshot.model !== context.assistantSelection?.modelId) {
      throw untrustedExecutionProfileResolutionError(provider, sessionId, { reason: "selection_changed" });
    }
    const attributed = Object.freeze(agentOperationResult(provider, sessionId, snapshot));
    verifiedExecutionProfiles.set(attributed, Object.freeze({
      providerId: provider.id,
      sessionBinding: state.bindingTokens.get(bindingKey(sessionId, context)),
      sessionId: normalizeText(sessionId),
      snapshot,
      scope: context.assistantScope ? JSON.stringify(context.assistantScope) : "",
      selection: context.assistantScope ? JSON.stringify(context.assistantSelection) : "",
      actor: context.assistantScope ? JSON.stringify(context.vibe64User) : "",
      connectionIdentity: context.assistantScope ? context.assistantAccess?.connectionIdentity : "",
      transportId: provider.transportId
    }));
    return attributed;
  }

  function trustedExecutionProfile(provider = {}, sessionId = "", value = null, context = {}) {
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(value);
    const provenance = verifiedExecutionProfiles.get(value);
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !provenance ||
      provenance.providerId !== provider.id ||
      provenance.sessionBinding !== state.bindingTokens.get(bindingKey(normalizedSessionId, context)) ||
      provenance.sessionId !== normalizedSessionId ||
      provenance.transportId !== provider.transportId ||
      provenance.scope !== (context.assistantScope ? JSON.stringify(context.assistantScope) : "") ||
      context.assistantScope && (
        provenance.selection !== JSON.stringify(context.assistantSelection) ||
        provenance.actor !== JSON.stringify(context.vibe64User) ||
        provenance.connectionIdentity !== context.assistantAccess?.connectionIdentity
      )
    ) {
      throw untrustedExecutionProfileResolutionError(provider, normalizedSessionId);
    }
    const expected = provenance.snapshot;
    if (JSON.stringify(snapshot) !== JSON.stringify(expected)) {
      throw untrustedExecutionProfileResolutionError(provider, normalizedSessionId, {
        reason: "changed"
      });
    }
    return verifiedExecutionProfileResolution(provider, {
      profileId: expected.profileId,
      workloadId: expected.workloadId
    }, expected);
  }

  async function callSessionProvider(method, ...args) {
    const opening = method === "startTerminal" ? Promise.withResolvers() : null;
    if (opening) state.terminalStarts.add(opening.promise);
    try {
      return await invokeSessionProvider(method, ...args);
    } finally {
      if (opening) { state.terminalStarts.delete(opening.promise); opening.resolve(); }
    }
  }

  async function invokeSessionProvider(method = "", sessionId = "", input = {}, options = {}, {
    coalesceIdentity = ""
  } = {}) {
    let operationOptions = {
      ...options,
      agentSettings: options.agentSettings || input.agentSettings || null
    };
    if (AI_METHODS.has(method)) {
      requireCompletedNativeConversationReplacement(options.session, { requireBriefing: method === "startTerminal" });
    }
    if (["sendMessage", "startTerminal", "generateSessionRenewalHandover"].includes(method)) {
      requireCompletedConversationRewind(options.session);
    }
    const terminalId = normalizeText(input.terminalSessionId);
    const terminalBinding = terminalId ? state.terminalBindings.get(terminalId) : null;
    if (method === "writeTerminal" && (!terminalBinding || terminalBinding.invalidated ||
        terminalBinding.sessionId !== normalizeText(sessionId))) {
      throw Object.assign(new Error("Reopen the AI terminal before sending input. Its connection is no longer bound to this session."), {
        code: "vibe64_assistant_terminal_reopen_required", statusCode: 409
      });
    }
    const boundTerminal = terminalBinding?.sessionId === normalizeText(sessionId) && method.endsWith("Terminal");
    if (boundTerminal) {
      operationOptions = { ...operationOptions, session: null, assistantSelection: terminalBinding.selection,
        expectedConnectionIdentity: terminalBinding.connectionIdentity };
    }
    const provider = boundTerminal ? state.providerById.get(terminalBinding.providerId) : sessionBindings.bindSession(sessionId, operationOptions);
    if (method === "startTerminal" && state.connectionChanges.has(provider.id)) {
      throw connectionChangeBusy(provider.id);
    }
    const operation = attachments?.[method] || conversationOperations.providerOperation(provider, method);
    if (typeof operation !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    const authorization = AI_METHODS.has(method)
      ? await accessChecks.requireAccessContext(provider, sessionId, operationOptions)
      : null;
    const context = {
      agentSettings: operationOptions.agentSettings,
      assistantAccess: authorization?.access || null,
      assistantSelection: sessionAssistantSelection(operationOptions),
      assistantScope: operationOptions.assistantScope || null,
      // readable-check: allow method-probe - input validation: a caller's optional event stream
      onEvent: typeof operationOptions.onEvent === "function" ? operationOptions.onEvent : null,
      providerId: provider.id,
      runtime: operationOptions.runtime || null,
      ...(method === "sendMessage" && operationOptions.browserAuthority
        ? { browserAuthority: operationOptions.browserAuthority } : {}),
      routingConversationId: operationOptions.routingConversationId || "",
      session: operationOptions.session || null,
      sessionId: normalizeText(sessionId),
      signal: operationOptions.signal || null,
      transportId: provider.transportId,
      turnOwnership: operationOptions.turnOwnership || null,
      vibe64User: authorization ? authorization.vibe64User : assistantUser(operationOptions)
    };
    const run = async () => {
      const executionProfileRequest = method === "resolveExecutionProfile"
        ? defineVibe64AgentExecutionProfileRequest(input)
        : null;
      let providerInput = executionProfileRequest || input;
      if (method !== "resolveExecutionProfile" && hasOwn(input, "executionProfile")) {
        if (EXECUTION_PROFILE_RESOLUTION_METHODS.has(method) ||
            context.assistantScope && ["createConversation", "startConversationTurn"].includes(method)) {
          if (looksLikeExecutionProfileResolution(input.executionProfile)) {
            providerInput = {
              ...input,
              executionProfile: trustedExecutionProfile(
                provider,
                sessionId,
                input.executionProfile,
                context
              )
            };
          } else {
            // readable-check: allow method-probe - test asserts error: a provider without execution profiles is refused
            if (typeof provider.resolveExecutionProfile !== "function") {
              throw new TypeError(
                `Assistant provider ${provider.id} does not implement resolveExecutionProfile().`
              );
            }
            const requestedExecutionProfile = defineVibe64AgentExecutionProfileRequest(
              input.executionProfile
            );
            providerInput = {
              ...input,
              executionProfile: verifiedExecutionProfileResolution(
                provider,
                requestedExecutionProfile,
                await provider.resolveExecutionProfile(
                  context,
                  requestedExecutionProfile
                )
              )
            };
          }
        } else {
          if (
            !input.executionProfile ||
            typeof input.executionProfile !== "object" ||
            Array.isArray(input.executionProfile)
          ) {
            defineVibe64AgentExecutionProfileRequest(input.executionProfile);
          }
          providerInput = {
            ...input,
            executionProfile: Object.keys(input.executionProfile).length === 2
              ? defineVibe64AgentExecutionProfileRequest(input.executionProfile)
              : vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile)
          };
        }
      }
      if (context.assistantScope && providerInput.executionProfile?.model &&
          providerInput.executionProfile.model !== context.assistantSelection?.modelId) {
        throw untrustedExecutionProfileResolutionError(provider, sessionId, { reason: "selection_changed" });
      }
      if (context.assistantScope && providerInput.executionProfile &&
          (providerInput.attachments?.length || providerInput.steer)) {
        throw new TypeError("Bounded helpers accept supplied text only; start a new request to change their input.");
      }
      if (attachments && !options.attachmentsPrepared && ["sendMessage", "startConversationTurn"].includes(method)) {
        if (method === "sendMessage" && provider.conversationOperations?.includes(method) && !context.assistantScope) {
          // The original sender chooses historical attachment IDs before this
          // same authorized storage resolver prepares their native input.
          context.prepareMessage = input => attachments.prepareMessage(context, input, { durable: true });
        } else providerInput = await attachments.prepareMessage(context, providerInput, { durable: method === "sendMessage" });
      }
      if (method === "writeTerminal" && provider.id === "opencode") {
        providerInput = { ...providerInput, input: { ...input.input, attachments: [] } };
        if (input.input?.attachmentIds?.length) {
          const prepared = await attachments.prepareMessage(context, { attachmentIds: input.input.attachmentIds });
          // The browser supplies IDs only. Paths come from retained session files,
          // and terminal input deliberately has no newline or Enter keystroke.
          providerInput.data = prepared.attachments.map(({ path }) => `[${path}] `).join("");
          providerInput.input.attachments = prepared.attachments;
        }
      }
      const result = await operation(context, providerInput);
      if (method === "startTerminal" && result?.ok !== false && normalizeText(result?.id)) {
        // A reused PTY keeps its original connection until explicitly closed.
        if (!state.terminalBindings.has(result.id)) {
          state.terminalBindings.set(result.id, { sessionId: context.sessionId, providerId: provider.id,
            selection: context.assistantSelection, connectionIdentity: context.assistantAccess.connectionIdentity });
        }
      }
      if (method === "closeTerminal" && result?.ok !== false) state.terminalBindings.delete(terminalId);
      return executionProfileRequest
        ? rememberVerifiedExecutionProfile(
            provider,
            sessionId,
            verifiedExecutionProfileResolution(provider, executionProfileRequest, result),
            context
          )
        : agentOperationResult(provider, sessionId, result);
    };
    const identity = normalizeText(coalesceIdentity);
    return identity
      ? coalescedOperation(operationKey(sessionId, provider.id, method, identity), run)
      : run();
  }

  async function callProviderOperation(provider, method, input, options) {
    const operation = conversationOperations.providerOperation(provider, method);
    if (typeof operation !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    return agentOperationResult(provider, "", await operation.call(provider, {
      providerId: provider.id,
      transportId: provider.transportId
    }, input, options));
  }

  async function callProvider(method = "", input = {}, options = {}) {
    return callProviderOperation(sessionBindings.providerFor(options), method, input, options);
  }

  async function callAllProviders(method = "", input = {}, options = {}) {
    const requestedProviderId = sessionAgentProviderId(options);
    const targets = requestedProviderId
      ? [sessionBindings.providerFor(options)]
      : [...state.providerById.values()];
    if (targets.length === 1) {
      return callProviderOperation(targets[0], method, input, options);
    }
    // Each provider settles on its own: one that throws is reported by name,
    // and the caller resumes only after every other provider has finished.
    const settled = await Promise.allSettled(targets.map(provider => callProviderOperation(provider, method, input, options)));
    const results = settled.map((outcome, index) => outcome.status === "fulfilled"
      ? outcome.value
      : agentOperationResult(targets[index], "", {
          code: normalizeText(outcome.reason?.code),
          error: normalizeText(outcome.reason?.message || outcome.reason) || `Assistant provider ${targets[index].id} failed.`,
          ok: false
        }));
    const failed = results.filter((result) => result.ok === false);
    return Object.freeze({
      closed: results.reduce((total, result) => total + Number(result.closed || 0), 0),
      failed,
      ok: failed.length === 0,
      results: Object.freeze(results),
      stopped: results.reduce((total, result) => total + Number(result.stopped || 0), 0)
    });
  }

  // An ephemeral assistant scope runs outside any session, routing
  // conversation or project runtime.
  function callEphemeralScope(method, assistantScope, input = {}, options = {}) {
    return callSessionProvider(method, assistantScope.id, input, {
      ...options,
      assistantScope,
      routingConversationId: "",
      runtime: null,
      session: null
    });
  }

  function closeTerminal(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("closeTerminal", sessionId, input, options);
  }

  function createConversation(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("createConversation", sessionId, input, options);
  }

  function deleteAttachment(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("deleteAttachment", sessionId, input, options);
  }

  function deleteDetachedChatThread(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("deleteDetachedChatThread", sessionId, input, options);
  }

  function updateSessionSettings(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("updateSessionSettings", sessionId, input, options);
  }

  function generateSessionRenewalHandover(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("generateSessionRenewalHandover", sessionId, input, options);
  }

  function hasActiveTemporaryConversation(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("hasActiveTemporaryConversation", sessionId, input, options);
  }

  function interruptDetachedChatTurn(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("interruptDetachedChatTurn", sessionId, input, options);
  }

  function interruptTurn(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("interruptTurn", sessionId, input, options);
  }

  function readConversation(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("readConversation", sessionId, input, options);
  }

  function resolveExecutionProfile(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("resolveExecutionProfile", sessionId, input, options);
  }

  function runDetachedChatTurn(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("runDetachedChatTurn", sessionId, input, options);
  }

  function seedSessionRenewalHandover(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("seedSessionRenewalHandover", sessionId, input, options);
  }

  function sendMessage(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("sendMessage", sessionId, input, options);
  }

  function inspectMessageAdmission(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("inspectMessageAdmission", sessionId, input, options);
  }

  function streamDetachedChatTurn(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("streamDetachedChatTurn", sessionId, input, options);
  }

  function startConversationTurn(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("startConversationTurn", sessionId, input, options);
  }

  function startTerminal(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("startTerminal", sessionId, input, options);
  }

  function stopConversation(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("stopConversation", sessionId, input, options);
  }

  function uploadAttachment(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("uploadAttachment", sessionId, input, options);
  }

  function waitForConversationTurn(sessionId = "", input = {}, options = {}) {
    return callSessionProvider("waitForConversationTurn", sessionId, input, options);
  }

  function createEphemeralConversation(scope = {}, input = {}, options = {}) {
    return callEphemeralScope("createConversation", defineEphemeralAssistantScope(scope), input, options);
  }

  function resolveEphemeralExecutionProfile(scope = {}, input = {}, options = {}) {
    return callEphemeralScope("resolveExecutionProfile", defineEphemeralAssistantScope(scope), input, options);
  }

  function readEphemeralConversation(scope = {}, input = {}, options = {}) {
    return callEphemeralScope("readConversation", defineEphemeralAssistantScope(scope), input, options);
  }

  function startEphemeralConversationTurn(scope = {}, input = {}, options = {}) {
    return callEphemeralScope("startConversationTurn", defineEphemeralAssistantScope(scope), input, options);
  }

  function stopEphemeralConversation(scope = {}, input = {}, options = {}) {
    return callEphemeralScope("stopConversation", defineEphemeralAssistantScope(scope), input, options);
  }

  function waitForEphemeralConversationTurn(scope = {}, input = {}, options = {}) {
    return callEphemeralScope("waitForConversationTurn", defineEphemeralAssistantScope(scope), input, options);
  }

  function ensureSession(sessionId = "", options = {}) {
    return callSessionProvider("ensureSession", sessionId, {}, options, {
      coalesceIdentity: "session"
    });
  }

  function readTerminal(sessionId = "", terminalSessionId = "", options = {}) {
    return callSessionProvider("readTerminal", sessionId, { terminalSessionId }, options);
  }

  function resizeTerminal(sessionId = "", terminalSessionId = "", size = {}, options = {}) {
    return callSessionProvider("resizeTerminal", sessionId, { size, terminalSessionId }, options);
  }

  function sessionState(sessionId = "", options = {}) {
    return callSessionProvider("sessionState", sessionId, {}, options);
  }

  function subscribeTerminal(sessionId = "", terminalSessionId = "", subscriber = null, options = {}) {
    return callSessionProvider("subscribeTerminal", sessionId, { subscriber, terminalSessionId }, options);
  }

  function unsubscribeSessions(sessions = [], options = {}) {
    return callProvider("unsubscribeSessions", sessions, options);
  }

  function writeTerminal(sessionId = "", terminalSessionId = "", data = "", input = {}, options = {}) {
    return callSessionProvider("writeTerminal", sessionId, { data, input, terminalSessionId }, options);
  }

  return Object.freeze({
    callAllProviders,
    callEphemeralScope,
    callSessionProvider,
    closeTerminal,
    createConversation,
    createEphemeralConversation,
    deleteAttachment,
    deleteDetachedChatThread,
    ensureSession,
    generateSessionRenewalHandover,
    hasActiveTemporaryConversation,
    inspectMessageAdmission,
    interruptDetachedChatTurn,
    interruptTurn,
    readConversation,
    readEphemeralConversation,
    readTerminal,
    resizeTerminal,
    resolveEphemeralExecutionProfile,
    resolveExecutionProfile,
    runDetachedChatTurn,
    seedSessionRenewalHandover,
    sendMessage,
    sessionState,
    startConversationTurn,
    startEphemeralConversationTurn,
    startTerminal,
    stopConversation,
    stopEphemeralConversation,
    streamDetachedChatTurn,
    subscribeTerminal,
    unsubscribeSessions,
    updateSessionSettings,
    uploadAttachment,
    waitForConversationTurn,
    waitForEphemeralConversationTurn,
    writeTerminal
  });
}

export {
  createSessionAgentProviderCalls
};
