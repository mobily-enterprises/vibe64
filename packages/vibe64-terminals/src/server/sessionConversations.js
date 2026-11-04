import { createAiTaskConversationRecords } from "./aiTaskConversationRecords.js";
import { createAiTaskConversationTurns } from "./aiTaskConversationTurns.js";
import { createAiTaskConversationLifecycle } from "./aiTaskConversationLifecycle.js";
import { createAiTaskConversationInteraction } from "./aiTaskConversationInteraction.js";

/** @typedef {import("./types.js").PublishNativeConversation} PublishNativeConversation */
/** @typedef {import("./types.js").PrepareAssistantSelection} PrepareAssistantSelection */
/** @typedef {import("./types.js").PrepareAgentSkills} PrepareAgentSkills */
/** @typedef {import("./types.js").RunMainAgentWrite} RunMainAgentWrite */
/** @typedef {import("./types.js").ReadSessionContext} ReadSessionContext */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").SessionAttachments} SessionAttachments */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * A session's AI task chats. Session storage owns discovery and the
 * transcript, existing provider adapters own native turns, and only an
 * explicit Close removes a user-facing AI task chat. The parts are built
 * once, in dependency order, and the result names each of their functions.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {ActionCatalogue} dependencies.actions
 * @param {SessionAttachments} dependencies.attachments
 * @param {RunMainAgentWrite} dependencies.runAgentWrite
 * @param {number} dependencies.routingWaitMs
 * @param {ReadSessionContext} dependencies.readSessionContext
 * @param {PrepareAgentSkills} dependencies.prepareAgentSkills
 * @param {string} dependencies.systemRoot
 * @param {PrepareAssistantSelection} dependencies.prepareSelection
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {PublishNativeConversation} dependencies.publishConversation
 * @param {ConversationTurnPublishers} dependencies.conversationTurns
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
  conversationTurns,
  logger,
  temporarySaveDelayMs = 1_000,
  temporaryCompletionAttempts = 6,
  temporaryCompletionRetryMs = 500
}) {
  const chatRecords = createAiTaskConversationRecords({ sessionAgent, publishConversation });
  const chatTurns = createAiTaskConversationTurns({
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
    temporarySaveDelayMs,
    logger,
    conversationTurns
  });
  const chatLifecycle = createAiTaskConversationLifecycle({
    chatRecords,
    chatTurns,
    conversationRuntime,
    readSessionContext,
    publishSessionChanged,
    temporaryCompletionAttempts,
    temporaryCompletionRetryMs,
    routing: chatTurns.routing,
    conversationTurns
  });
  const chatInteraction = createAiTaskConversationInteraction({
    chatRecords,
    chatTurns,
    chatLifecycle,
    sessionAgent,
    conversationRuntime,
    actions,
    attachments,
    readSessionContext,
    publishSessionChanged,
    routing: chatTurns.routing,
    conversationTurns
  });

  return Object.freeze({
    close: chatTurns.close,
    aiTaskConversationDataSchema: chatInteraction.aiTaskConversationDataSchema,
    aiTaskConversationSelectionSchema: chatInteraction.aiTaskConversationSelectionSchema,
    conversationBinding: chatInteraction.conversationBinding,
    inspectAiTaskConversationDelivery: chatInteraction.inspectAiTaskConversationDelivery,
    createAiTaskConversation: chatLifecycle.createAiTaskConversation,
    listAiTaskConversations: chatLifecycle.listAiTaskConversations,
    readAiTaskConversation: chatLifecycle.readAiTaskConversation,
    updateAiTaskConversation: chatInteraction.updateAiTaskConversation,
    startAiTaskConversationTurn: chatInteraction.startAiTaskConversationTurn,
    cancelAiTaskConversationMessage: chatInteraction.cancelAiTaskConversationMessage,
    cancelAiTaskConversationRouting: chatInteraction.cancelAiTaskConversationRouting,
    stopAiTaskConversation: chatLifecycle.stopAiTaskConversation,
    readConversationTurn: chatLifecycle.readConversationTurn,
    deleteAiTaskConversation: chatLifecycle.deleteAiTaskConversation,
    retireAiTaskConversations: chatLifecycle.retireAiTaskConversations,
    afterTemporaryTurn: chatLifecycle.afterTemporaryTurn
  });
}

export {
  prepareCopiedSessionConversation
} from "./aiTaskConversationRules.js";
export {
  createSessionConversations
};
