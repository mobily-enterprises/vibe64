import { createTemporaryConversationRecords } from "./temporaryConversationRecords.js";
import { createTemporaryConversationTurns } from "./temporaryConversationTurns.js";
import { createTemporaryConversationLifecycle } from "./temporaryConversationLifecycle.js";
import { createTemporaryConversationInteraction } from "./temporaryConversationInteraction.js";

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
 * A session's temporary chats. Session storage owns discovery and the
 * transcript, existing provider adapters own native turns, and only an
 * explicit Close removes a user-facing temporary chat. The parts are built
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
  logger,
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
    temporarySaveDelayMs,
    logger
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
  prepareCopiedSessionConversation
} from "./temporaryConversationRules.js";
export {
  createSessionConversations
};
