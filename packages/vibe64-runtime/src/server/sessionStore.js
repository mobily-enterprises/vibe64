import { conversationMessageIdentity, conversationMessageVersion } from "@jskit-ai/assistant-core/server/conversation";
import {
  assertValidVibe64SessionId,
  isValidVibe64SessionId,
  learningSessionBinding,
  normalizeVibe64AgentRunState,
  validateLearningSessionScope,
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_STATUS,
  vibe64AgentRunStateIsActive,
  vibe64SessionStatusIsHidden,
  vibe64SessionStatusIsOpen
} from "./sessionRecordRules.js";
import { readActiveSessionMetadataValues, systemClock } from "./sessionStoreLayout.js";
import { createSessionStoreState } from "./sessionStoreState.js";
import { createSessionStorePaths } from "./sessionStorePaths.js";
import { createSessionStoreLocks } from "./sessionStoreLocks.js";
import { createSessionRecordFiles } from "./sessionRecordFiles.js";
import { createSessionArchiveRecords } from "./sessionArchiveRecords.js";
import { createSessionArchiveAccess } from "./sessionArchiveAccess.js";
import { createSessionRecords } from "./sessionRecords.js";
import { createSessionConversationStore } from "./sessionConversationStore.js";
import { createSessionArchivePublishing } from "./sessionArchivePublishing.js";
import { createSessionRenewalArchives } from "./sessionRenewalArchives.js";
import { createCurrentSessionRecords } from "./currentSessionRecords.js";
import { createSessionListing } from "./sessionListing.js";
import { createSessionCreation } from "./sessionCreation.js";
import { createSessionRenewalTransitions } from "./sessionRenewalTransitions.js";
import { createSessionStateUpgrades } from "./sessionStateUpgrades.js";
import { createSessionTemporaryConversationRemoval } from "./sessionTemporaryConversationRemoval.js";

/**
 * A project runtime's session store. Each concern is built once, in
 * dependency order, and the store offers its functions by name.
 * @param {Parameters<typeof createSessionStoreState>[0]} [options]
 */
function createVibe64SessionStore(options = {}) {
  const state = createSessionStoreState(options);
  const storePaths = createSessionStorePaths({ state });
  const locks = createSessionStoreLocks({ state, storePaths });
  const recordFiles = createSessionRecordFiles({ state, storePaths });
  const archiveRecords = createSessionArchiveRecords({ state, storePaths });
  const archiveAccess = createSessionArchiveAccess({
    state,
    storePaths,
    locks,
    recordFiles,
    archiveRecords
  });
  const sessionRecords = createSessionRecords({
    state,
    storePaths,
    locks,
    recordFiles,
    archiveRecords,
    archiveAccess
  });
  const conversationStore = createSessionConversationStore({
    state,
    storePaths,
    recordFiles,
    archiveAccess,
    sessionRecords
  });
  const archivePublishing = createSessionArchivePublishing({
    state,
    storePaths,
    locks,
    recordFiles,
    archiveRecords
  });
  const renewalArchives = createSessionRenewalArchives({
    state,
    storePaths,
    locks,
    recordFiles,
    archiveRecords,
    archiveAccess,
    archivePublishing
  });
  const currentSession = createCurrentSessionRecords({
    state,
    storePaths,
    recordFiles,
    archiveAccess,
    sessionRecords,
    renewalArchives
  });
  const listing = createSessionListing({
    state,
    storePaths,
    archiveRecords,
    sessionRecords,
    archivePublishing,
    currentSession
  });
  const creation = createSessionCreation({
    state,
    storePaths,
    locks,
    sessionRecords,
    listing
  });
  const renewalTransitions = createSessionRenewalTransitions({
    state,
    storePaths,
    locks,
    recordFiles,
    archiveRecords,
    archiveAccess,
    sessionRecords,
    renewalArchives
  });
  const upgrades = createSessionStateUpgrades({
    state,
    storePaths,
    recordFiles,
    archiveRecords,
    archiveAccess,
    conversationStore
  });
  const temporaryConversationRemoval = createSessionTemporaryConversationRemoval({
    storePaths,
    recordFiles,
    archiveRecords,
    archiveAccess,
    prepareSessionStateUpgrade: upgrades.prepareSessionStateUpgrade
  });

  return Object.freeze({
    assertSessionCreationAbsent: storePaths.assertSessionCreationAbsent,
    createSession: creation.createSession,
    createRenewalPendingSession: creation.createRenewalPendingSession,
    commitRenewalArchive: renewalArchives.commitRenewalArchive,
    commitRenewalCurrentSession: currentSession.commitRenewalCurrentSession,
    commitRenewalSuccessor: renewalTransitions.commitRenewalSuccessor,
    publishSessionArchive: archivePublishing.publishSessionArchive,
    prepareRenewalSessionArchive: renewalArchives.prepareRenewalSessionArchive,
    prepareAssistantRoutingStateUpgrade: upgrades.prepareAssistantRoutingStateUpgrade,
    prepareConversationStorageUpgrade: upgrades.prepareConversationStorageUpgrade,
    prepareConversationMessageDataUpgrade: upgrades.prepareConversationMessageDataUpgrade,
    prepareLearningSessionBindingUpgrade: upgrades.prepareLearningSessionBindingUpgrade,
    prepareTemporaryConversationRemoval: temporaryConversationRemoval.prepareTemporaryConversationRemoval,
    readArchivedConversations: temporaryConversationRemoval.readArchivedConversations,
    removeEmptyConversationFolders: temporaryConversationRemoval.removeEmptyConversationFolders,
    conversationMessageIdExists: conversationStore.conversationMessageIdExists,
    conversationMessageIdExistsForRenewal: conversationStore.conversationMessageIdExistsForRenewal,
    findSubmittedConversationTurn: conversationStore.findSubmittedConversationTurn,
    readConversationLogTurn: conversationStore.readConversationLogTurn,
    conversationStorage: conversationStore.conversationStorage,
    deleteMetadataValue: sessionRecords.deleteMetadataValue,
    deleteMetadataValues: sessionRecords.deleteMetadataValues,
    detachRenewedSessionForArchive: renewalArchives.detachRenewedSessionForArchive,
    finalizeRenewalArchiveCommit: renewalArchives.finalizeRenewalArchiveCommit,
    listSessions: listing.listSessions,
    listSessionsForRenewal: listing.listSessionsForRenewal,
    listSessionRenewalStateSessionIds: locks.listSessionRenewalStateSessionIds,
    listSessionSummaries: listing.listSessionSummaries,
    recoverSessionArchives: listing.recoverSessionArchives,
    mutateSession: sessionRecords.mutateSession,
    mutateSessionForRenewal: sessionRecords.mutateSessionForRenewal,
    paths: storePaths.paths,
    prepareProjectFileAreas: storePaths.prepareProjectFileAreas,
    readArtifact: sessionRecords.readArtifact,
    withReadableSessionPaths: archiveAccess.withReadableSessionPaths,
    withReadableSessionPathsForRenewal: archiveAccess.withReadableSessionPathsForRenewal,
    readArtifactForRenewal: sessionRecords.readArtifactForRenewal,
    readAgentRun: sessionRecords.readAgentRun,
    readAgentRunActivity: sessionRecords.readAgentRunActivity,
    readAgentRuns: sessionRecords.readAgentRuns,
    readBackgroundTask: sessionRecords.readBackgroundTask,
    readBackgroundTasks: sessionRecords.readBackgroundTasks,
    readConversationLog: conversationStore.readConversationLog,
    readConversationStream: conversationStore.readConversationStream,
    readFirstUserMessage: conversationStore.readFirstUserMessage,
    updateConversationStream: conversationStore.updateConversationStream,
    completeConversationStreamMessage: conversationStore.completeConversationStreamMessage,
    clearConversationStream: conversationStore.clearConversationStream,
    readSessionConversation: conversationStore.readSessionConversation,
    listSessionConversations: conversationStore.listSessionConversations,
    writeSessionConversation: conversationStore.writeSessionConversation,
    deleteSessionConversation: conversationStore.deleteSessionConversation,
    skipIntegrationSetupRequest: conversationStore.skipIntegrationSetupRequest,
    completeIntegrationSetupRequest: conversationStore.completeIntegrationSetupRequest,
    claimIntegrationContinuation: conversationStore.claimIntegrationContinuation,
    acceptIntegrationContinuation: conversationStore.acceptIntegrationContinuation,
    readIntegrationSetupRequest: conversationStore.readIntegrationSetupRequest,
    readConversationLogPage: conversationStore.readConversationLogPage,
    readCurrentSession: currentSession.readCurrentSession,
    readPinnedSessionId: recordFiles.readPinnedSessionId,
    withUnpinnedProject: currentSession.withUnpinnedProject,
    updatePinnedSession: currentSession.updatePinnedSession,
    assertSessionNotPinned: recordFiles.assertSessionNotPinned,
    readConversationTail: conversationStore.readConversationTail,
    readManifest: sessionRecords.readManifest,
    readMetadata: sessionRecords.readMetadata,
    readMetadataValue: sessionRecords.readMetadataValue,
    readSession: sessionRecords.readSession,
    readSessionForRenewal: sessionRecords.readSessionForRenewal,
    readSessionRenewalStateRecord: locks.readSessionRenewalStateRecord,
    readSessionSourceDescriptor: sessionRecords.readSessionSourceDescriptor,
    readSessionNativeDescriptor: sessionRecords.readSessionNativeDescriptor,
    readSessionSummary: sessionRecords.readSessionSummary,
    readStatus: sessionRecords.readStatus,
    readStatusForRenewal: sessionRecords.readStatusForRenewal,
    quiesceSessionForRenewal: renewalTransitions.quiesceSessionForRenewal,
    removeRenewalPendingSession: renewalTransitions.removeRenewalPendingSession,
    activateRenewalSuccessor: renewalTransitions.activateRenewalSuccessor,
    rollbackRenewalSuccessorActivation: renewalTransitions.rollbackRenewalSuccessorActivation,
    restoreRenewalClosingSession: renewalArchives.restoreRenewalClosingSession,
    restoreSessionAfterRenewalCancellation: renewalTransitions.restoreSessionAfterRenewalCancellation,
    runSessionExclusive: sessionRecords.runSessionExclusive,
    runSessionExclusiveForRenewal: sessionRecords.runSessionExclusiveForRenewal,
    learningScope: state.admittedLearningScope,
    runSessionRenewalStateExclusive: locks.runSessionRenewalStateExclusive,
    runSessionRenewalWorkflowExclusive: locks.runSessionRenewalWorkflowExclusive,
    updateCurrentSession: currentSession.updateCurrentSession,
    transitionRenewalSuccessor: renewalTransitions.transitionRenewalSuccessor,
    finalizeRenewalCurrentSession: currentSession.finalizeRenewalCurrentSession,
    writeArtifact: sessionRecords.writeArtifact,
    writeJsonArtifact: sessionRecords.writeJsonArtifact,
    writeAgentRunEvent: sessionRecords.writeAgentRunEvent,
    writeBackgroundTaskEvent: sessionRecords.writeBackgroundTaskEvent,
    upsertConversationAssistantMessage: conversationStore.upsertConversationAssistantMessage,
    writeConversationAssistantMessage: conversationStore.writeConversationAssistantMessage,
    writeConversationCommentaryMessage: conversationStore.writeConversationCommentaryMessage,
    writeConversationSystemMessage: conversationStore.writeConversationSystemMessage,
    writeConversationThinkingMessage: conversationStore.writeConversationThinkingMessage,
    writeConversationUserMessage: conversationStore.writeConversationUserMessage,
    writeMetadataValue: sessionRecords.writeMetadataValue,
    writeMetadataValueForRenewal: sessionRecords.writeMetadataValueForRenewal,
    writeJsonArtifactForRenewal: sessionRecords.writeJsonArtifactForRenewal,
    writeSessionRenewalStateRecord: locks.writeSessionRenewalStateRecord,
    withPublishedRenewalSession: archiveAccess.withPublishedRenewalSession,
    withArchivedSession: archiveAccess.withArchivedSession,
    pruneArchivedSessionAttachments: archiveAccess.pruneArchivedSessionAttachments,
    pruneArchivedSessionArtifacts: archiveAccess.pruneArchivedSessionArtifacts,
    writeSessionLabel: sessionRecords.writeSessionLabel,
    writeStatus: sessionRecords.writeStatus
  });
}

export {
  systemClock,
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_STATUS,
  assertValidVibe64SessionId,
  conversationMessageIdentity,
  conversationMessageVersion,
  createVibe64SessionStore,
  learningSessionBinding,
  validateLearningSessionScope,
  isValidVibe64SessionId,
  normalizeVibe64AgentRunState,
  readActiveSessionMetadataValues,
  vibe64AgentRunStateIsActive,
  vibe64SessionStatusIsHidden,
  vibe64SessionStatusIsOpen
};
