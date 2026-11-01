import { SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE, EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS, defineEphemeralAssistantScope,
  sessionAgentProviderId } from "./sessionAgentRules.js";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { normalizeText } from "@local/vibe64-core/server/core";
import { currentProjectVibe64User } from "@local/vibe64-core/server/projectRequestContext";
import { createSessionAgentManagerState } from "./sessionAgentManagerState.js";
import { createSessionAgentBindings } from "./sessionAgentBindings.js";
import { createSessionAgentAccess } from "./sessionAgentAccess.js";
import { createSessionAgentConversationOperations } from "./sessionAgentConversationOperations.js";
import { createSessionAgentProviderCalls } from "./sessionAgentProviderCalls.js";
import { createSessionAgentRouting } from "./sessionAgentRouting.js";
import { createSessionAgentGoals } from "./sessionAgentGoals.js";
import { createSessionAgentLifecycle } from "./sessionAgentLifecycle.js";

/** @typedef {import("../types.js").SessionAttachments} SessionAttachments */
/** @typedef {import("../types.js").ConversationRuntime} ConversationRuntime */

function normalizeProvider(provider) {
  const id = normalizeText(provider?.id);
  const transportId = normalizeText(provider?.transportId);
  if (!id || !transportId) {
    throw new TypeError("Session agent providers require product provider and transport ids.");
  }
  return Object.freeze({
    ...provider,
    id,
    transportId
  });
}

/**
 * The session agent manager. Each concern is built once, in dependency
 * order, and the manager offers its operations by name.
 * @param {object} dependencies
 * @param {SessionAttachments} [dependencies.attachments] the session's attachments; without them messages carry none
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {string} [dependencies.defaultProviderId]
 * @param {(context: object) => Promise<object>} [dependencies.readAssistantAccess]
 * @param {(selection: object) => Promise<object | null>} [dependencies.readProviderUsage] without it plan usage reads none
 * @param {(user: object | null) => Promise<object | null>} [dependencies.resolveAssistantUser]
 * @param {() => Promise<object>} [dependencies.readRoutingConfiguration] without it routing uses the configuration it is given
 * @param {object[]} [dependencies.providers] the session agent providers, one per engine
 */
function createSessionAgentManager({
  attachments,
  conversationRuntime,
  defaultProviderId = "codex",
  readAssistantAccess = async () => ({ ownerOnly: false }),
  readProviderUsage,
  resolveAssistantUser = async (user) => user || currentProjectVibe64User() || null,
  readRoutingConfiguration,
  providers = []
}) {
  if (typeof readAssistantAccess !== "function") {
    throw new TypeError("Session agent manager requires an assistant-access reader.");
  }

  const providerById = new Map();
  for (const candidate of providers) {
    const provider = normalizeProvider(candidate);
    if (providerById.has(provider.id)) {
      throw new TypeError(`Duplicate session agent provider: ${provider.id}.`);
    }
    providerById.set(provider.id, provider);
  }
  const state = createSessionAgentManagerState({ defaultProviderId, providerById });
  const sessionBindings = createSessionAgentBindings({ state });
  const accessChecks = createSessionAgentAccess({ sessionBindings, readAssistantAccess, readProviderUsage, resolveAssistantUser });
  const conversationOperations = createSessionAgentConversationOperations({ conversationRuntime });
  const providerCalls = createSessionAgentProviderCalls({
    state,
    sessionBindings,
    accessChecks,
    conversationOperations,
    attachments,
    conversationRuntime
  });
  const routing = createSessionAgentRouting({
    state,
    sessionBindings,
    readAssistantAccess,
    readRoutingConfiguration,
    resolveAssistantUser
  });
  const goals = createSessionAgentGoals({ sessionBindings, accessChecks, conversationOperations });
  const lifecycle = createSessionAgentLifecycle({
    state,
    sessionBindings,
    accessChecks,
    conversationOperations,
    providerCalls
  });

  async function runEphemeralChatTurn(scope = {}, input = {}, options = {}) {
    const executionProfile = input.executionProfile;
    if (!executionProfile) throw new TypeError("A bounded assistant turn requires an execution profile.");
    const profileSnapshot = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
    return conversationRuntime.runScopedTurn({ operations: manager, scope, input, context: options,
      executionProfile: profileSnapshot });
  }

  const manager = Object.freeze({
    conversationProvider: sessionBindings.conversationProvider,
    resolveAssistantPurpose: routing.resolvePurpose,
    inspectRoutingConfiguration: routing.inspectRoutingConfiguration,
    inspectAssistantPurposes: routing.inspectAssistantPurposes,
    readPlanUsage: accessChecks.readPlanUsage,
    readGoal: goals.readGoal,
    retireConversationHistory: lifecycle.retireConversationHistory,
    listNativeConversationStorage: lifecycle.listNativeConversationStorage,
    updateGoal: goals.updateGoal,
    assistantAccess: accessChecks.assistantAccess,
    requireAssistantAccess: accessChecks.requireAssistantAccess,
    requireAssistantAccessForEngine: accessChecks.requireAssistantAccessForEngine,
    requireAssistantAccessForSelection: accessChecks.requireAssistantAccessForSelection,
    binding: sessionBindings.binding,
    closeProject: lifecycle.closeProject,
    closeSession: lifecycle.closeSession,
    closeTerminal: providerCalls.closeTerminal,
    createConversation: providerCalls.createConversation,
    createEphemeralConversation: providerCalls.createEphemeralConversation,
    resolveEphemeralExecutionProfile: providerCalls.resolveEphemeralExecutionProfile,
    deleteConversation: lifecycle.deleteConversation,
    deleteEphemeralConversation: lifecycle.deleteEphemeralConversation,
    deleteAttachment: providerCalls.deleteAttachment,
    deleteDetachedChatThread: providerCalls.deleteDetachedChatThread,
    describeProvider: accessChecks.describeProvider,
    ensureSession: providerCalls.ensureSession,
    updateSessionSettings: providerCalls.updateSessionSettings,
    generateSessionRenewalHandover: providerCalls.generateSessionRenewalHandover,
    hasActiveTemporaryConversation: providerCalls.hasActiveTemporaryConversation,
    interruptDetachedChatTurn: providerCalls.interruptDetachedChatTurn,
    interruptTurn: providerCalls.interruptTurn,
    invalidateRuntimes: lifecycle.invalidateRuntimes,
    listCapabilities: routing.listCapabilities,
    reconcileSessions: lifecycle.reconcileSessions,
    prepareSelection: routing.prepareSelection,
    resolveSelection: routing.resolveSelection,
    readConversation: providerCalls.readConversation,
    readEphemeralConversation: providerCalls.readEphemeralConversation,
    resolveExecutionProfile: providerCalls.resolveExecutionProfile,
    readTerminal: providerCalls.readTerminal,
    resizeTerminal: providerCalls.resizeTerminal,
    runDetachedChatTurn: providerCalls.runDetachedChatTurn,
    runEphemeralChatTurn,
    releaseRenewalPredecessorAttachments: lifecycle.releaseRenewalPredecessorAttachments,
    releaseRenewalPredecessorProcessExitProof: lifecycle.releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof: lifecycle.releaseRenewalSuccessorProcessExitProof,
    seedSessionRenewalHandover: providerCalls.seedSessionRenewalHandover,
    sendMessage: providerCalls.sendMessage,
    inspectMessageAdmission: providerCalls.inspectMessageAdmission,
    sessionState: providerCalls.sessionState,
    streamDetachedChatTurn: providerCalls.streamDetachedChatTurn,
    startConversationTurn: providerCalls.startConversationTurn,
    startEphemeralConversationTurn: providerCalls.startEphemeralConversationTurn,
    startTerminal: providerCalls.startTerminal,
    stopConversation: providerCalls.stopConversation,
    stopEphemeralConversation: providerCalls.stopEphemeralConversation,
    subscribeTerminal: providerCalls.subscribeTerminal,
    unsubscribeSessions: providerCalls.unsubscribeSessions,
    uploadAttachment: providerCalls.uploadAttachment,
    waitForConversationTurn: providerCalls.waitForConversationTurn,
    waitForEphemeralConversationTurn: providerCalls.waitForEphemeralConversationTurn,
    writeTerminal: providerCalls.writeTerminal
  });
  return manager;
}

export {
  EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS,
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager,
  defineEphemeralAssistantScope,
  sessionAgentProviderId
};
