import { createTemporaryConversationRecords } from "./temporaryConversationRecords.js";
import { createTemporaryConversationTurns } from "./temporaryConversationTurns.js";
import { createTemporaryConversationLifecycle } from "./temporaryConversationLifecycle.js";
import { createTemporaryConversationInteraction } from "./temporaryConversationInteraction.js";

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManager.js").createSessionAgentManager>} SessionAgentManager */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/conversation").createConversationRuntime>} ConversationRuntime */
/** @typedef {ReturnType<typeof import("./sessionAttachments.js").createSessionAttachments>} SessionAttachments */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/sessionRealtimeEvents").createSessionChangedPublisher>} PublishSessionChanged */

/**
 * A session's temporary chats. Session storage owns discovery and the
 * transcript, existing provider adapters own native turns, and only an
 * explicit Close removes a user-facing temporary chat. The parts are built
 * once, in dependency order, and the result names each of their functions.
 * @param {object} dependencies
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {ActionCatalogue | null} dependencies.actions
 * @param {SessionAttachments} dependencies.attachments
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>, lock: object) => Promise<object>} dependencies.runAgentWrite
 * @param {number} dependencies.routingWaitMs
 * @param {(sessionId: string, options?: object) => Promise<object>} dependencies.readSessionContext
 * @param {(sessionId: string, context: object) => Promise<unknown>} dependencies.prepareAgentSkills
 * @param {string} dependencies.systemRoot
 * @param {(sessionId: string, selection: object, context: object) => Promise<unknown>} dependencies.prepareSelection
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {(event: object) => unknown} dependencies.publishConversation
 * @param {number} [dependencies.temporarySaveDelayMs]
 * @param {number} [dependencies.temporaryCompletionAttempts]
 * @param {number} [dependencies.temporaryCompletionRetryMs]
 */
function createSessionConversations({
  sessionAgent,
  conversationRuntime,
  actions,
  attachments,
  runAgentWrite,
  routingWaitMs,
  readSessionContext,
  prepareAgentSkills,
  systemRoot,
  prepareSelection,
  publishSessionChanged,
  publishConversation,
  temporarySaveDelayMs = 1_000,
  temporaryCompletionAttempts = 6,
  temporaryCompletionRetryMs = 500
}) {
  const chatRecords = createTemporaryConversationRecords({ sessionAgent, publishConversation });
  const chatTurns = createTemporaryConversationTurns({
    chatRecords,
    sessionAgent,
    conversationRuntime,
    attachments,
    runAgentWrite,
    routingWaitMs,
    readSessionContext,
    prepareAgentSkills,
    systemRoot,
    prepareSelection,
    publishSessionChanged,
    temporarySaveDelayMs
  });
  const chatLifecycle = createTemporaryConversationLifecycle({
    chatRecords,
    chatTurns,
    conversationRuntime,
    readSessionContext,
    publishSessionChanged,
    temporaryCompletionAttempts,
    temporaryCompletionRetryMs,
    routing: chatTurns.routing
  });
  const chatInteraction = createTemporaryConversationInteraction({
    chatRecords,
    chatTurns,
    chatLifecycle,
    sessionAgent,
    conversationRuntime,
    actions,
    attachments,
    readSessionContext,
    publishSessionChanged,
    routing: chatTurns.routing
  });

  return Object.freeze({
    close: chatTurns.close,
    temporaryConversationDataSchema: chatInteraction.temporaryConversationDataSchema,
    temporaryConversationSelectionSchema: chatInteraction.temporaryConversationSelectionSchema,
    conversationBinding: chatInteraction.conversationBinding,
    inspectTemporaryConversationDelivery: chatInteraction.inspectTemporaryConversationDelivery,
    createTemporaryConversation: chatLifecycle.createTemporaryConversation,
    listTemporaryConversations: chatLifecycle.listTemporaryConversations,
    readTemporaryConversation: chatLifecycle.readTemporaryConversation,
    updateTemporaryConversation: chatInteraction.updateTemporaryConversation,
    startTemporaryConversationTurn: chatInteraction.startTemporaryConversationTurn,
    cancelTemporaryConversationMessage: chatInteraction.cancelTemporaryConversationMessage,
    cancelTemporaryConversationRouting: chatInteraction.cancelTemporaryConversationRouting,
    stopTemporaryConversation: chatLifecycle.stopTemporaryConversation,
    deleteTemporaryConversation: chatLifecycle.deleteTemporaryConversation,
    retireTemporaryConversations: chatLifecycle.retireTemporaryConversations,
    afterTemporaryTurn: chatLifecycle.afterTemporaryTurn
  });
}

export {
  temporaryConversationNamespace,
  prepareCopiedSessionConversation
} from "./temporaryConversationRules.js";
export {
  createSessionConversations
};
