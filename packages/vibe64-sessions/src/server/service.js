import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { createMainBrowserConversations } from "./mainBrowserConversations.js";
import { createMainConversationAuthority } from "./mainConversationAuthority.js";
import { createSessionArchive } from "./sessionArchive.js";
import { createSessionAssistant } from "./sessionAssistant.js";
import { createSessionCatalogue } from "./sessionCatalogue.js";
import { createSessionCreation } from "./sessionCreation.js";
import { createSessionMessages } from "./sessionMessages.js";
import { createSessionRenewalController } from "./sessionRenewal.js";
import { createSessionRepositoryReads } from "./sessionRepositoryReads.js";
import { createSessionRepositoryUpdates } from "./sessionRepositoryUpdates.js";
import { createSessionStartupRecovery } from "./sessionStartupRecovery.js";
import { createSessionWork } from "./sessionWork.js";
import { createSessionWorkOperations } from "./sessionWorkOperations.js";
import { createSessionWorkRecovery } from "./sessionWorkRecovery.js";
import { createSessionWorkspaceSetup } from "./sessionWorkspaceSetup.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionPresenceService} SessionPresenceService */
/** @typedef {import("@local/vibe64-project/server/types").PublishProjectChanged} PublishProjectChanged */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").RenewalActorRestoration} RenewalActorRestoration */
/** @typedef {import("./types.js").SessionArchivePreparation} SessionArchivePreparation */
/** @typedef {import("./types.js").AccountsInitializeModelRouting} AccountsInitializeModelRouting */

/**
 * The vibe64.sessions service: every session operation, each from the part
 * of the session that owns it.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {SessionArchivePreparation} dependencies.archivePreparation
 * @param {AccountsInitializeModelRouting} dependencies.initializeModelRouting
 * @param {boolean} dependencies.localhostCheckBypassed
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishProjectChanged} dependencies.publishProjectChanged
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {RenewalActorRestoration} dependencies.restoreRenewalActor
 * @param {SessionPresenceService} dependencies.sessionPresence
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {SourceEditorService} dependencies.sourceEditor
 * @param {TerminalsService} dependencies.terminals
 */
function createService({
  actions,
  archivePreparation,
  initializeModelRouting,
  localhostCheckBypassed,
  logger,
  project,
  publishProjectChanged,
  publishSessionChanged,
  restoreRenewalActor,
  sessionPresence,
  setupRunner,
  sourceEditor,
  terminals
}) {
  const workOperations = createSessionWorkOperations();
  const workspaceSetup = createSessionWorkspaceSetup({
    project,
    publishSessionChanged,
    setupRunner
  });
  const recovery = createSessionWorkRecovery({
    terminals,
    workOperations,
    workspaceSetup
  });
  const repositoryUpdates = createSessionRepositoryUpdates({
    project,
    publishSessionChanged,
    terminals,
    workOperations
  });
  const archive = createSessionArchive({
    archivePreparation,
    project,
    terminals,
    setupRunner,
    publishSessionChanged
  });
  const work = createSessionWork({
    project,
    publishSessionChanged,
    recovery,
    repositoryUpdates,
    terminals,
    workOperations,
    workspaceSetup
  });
  const catalogue = createSessionCatalogue({
    project,
    publishSessionChanged,
    sessionPresence,
    terminals
  });
  const assistant = createSessionAssistant({
    initializeModelRouting,
    project,
    publishSessionChanged,
    terminals
  });
  const creation = createSessionCreation({
    assistant,
    project,
    publishSessionChanged,
    setupRunner,
    terminals,
    workspaceSetup
  });
  const authority = createMainConversationAuthority({ localhostCheckBypassed });
  const messages = createSessionMessages({
    mainBrowserAuthority: authority.mainBrowserAuthority,
    project,
    publishProjectChanged,
    publishSessionChanged,
    setupRunner,
    sourceEditor,
    terminals
  });
  const repositoryReads = createSessionRepositoryReads({ project, terminals });
  const renewal = createSessionRenewalController({
    prepareArchive: archive.prepareArchive,
    project,
    publishSessionChanged,
    resolveSuccessorAssistant: assistant.resolveSessionStart,
    restoreRenewalActor,
    setupRunner,
    terminals
  });
  const startupRecovery = createSessionStartupRecovery({
    logger,
    project,
    resumeSessionArchives: archive.resumeSessionArchives,
    resumeSessionRenewals: renewal.resumeSessionRenewals
  });

  const browserConversations = createMainBrowserConversations({ actions, terminals });

  /**
   * Automatic save: once Auto's completing turn ends, Main chat's autoSave
   * preference runs the ordinary Save. Returns the short chat note.
   * @param {string} sessionId
   * @param {{ submittedBy?: object | null }} details
   */
  async function saveAfterCompletedPlan(sessionId, details) {
    const runtime = await project.createRuntimeWithoutSource();
    const session = await runtime.getSessionWithoutSource(sessionId);
    const preferences = assistantRoutingFromMetadata(session.metadata);
    if (preferences?.mode !== "auto" || !preferences.autoSave) return "";
    const skipped = reason => `Automatic save didn't run: ${reason}`;
    const inspection = await work.inspectSessionWork(sessionId);
    if (inspection?.ok === false) return skipped(normalizeText(inspection.error) || "this session's work could not be inspected.");
    if (!inspection.unsaved) return "Automatic save: nothing new to save.";
    const saved = await work.saveSessionWork(sessionId, { destinationReview: inspection.destination, vibe64User: details.submittedBy });
    return saved?.ok === false
      ? skipped(normalizeText(saved.error) || "Save was refused.")
      : "Saved automatically after completing the plan.";
  }

  const service = Object.freeze({
    browserConversations,
    readConversationContext: authority.conversationContextGrant,

    archiveSession: archive.archiveSession,
    resumeSessionArchives: archive.resumeSessionArchives,

    resumeInterruptedWork: startupRecovery.start,
    stopResumingInterruptedWork: startupRecovery.stop,

    cancelSessionRenewal: renewal.cancelSessionRenewal,
    closeSessionRenewalWork: renewal.closeSessionRenewalWork,
    confirmSessionRenewal: renewal.confirmSessionRenewal,
    inspectSessionRenewal: renewal.inspectSessionRenewal,
    requestSessionRenewalDraft: renewal.requestSessionRenewalDraft,
    resumeSessionRenewals: renewal.resumeSessionRenewals,
    retrySessionRenewal: renewal.retrySessionRenewal,
    updateSessionRenewalDraft: renewal.updateSessionRenewalDraft,

    broadcastSessionPreviewState: catalogue.broadcastSessionPreviewState,
    closeSessionPresence: catalogue.closeSessionPresence,
    inspectSession: catalogue.inspectSession,
    listArchivedSessions: catalogue.listArchivedSessions,
    listSessions: catalogue.listSessions,
    pinSession: catalogue.pinSession,
    readSessionConversationLog: catalogue.readSessionConversationLog,
    renameSession: catalogue.renameSession,
    updateCurrentSession: catalogue.updateCurrentSession,
    updateSessionPresence: catalogue.updateSessionPresence,

    createSession: creation.createSession,

    inspectAssistantAccess: assistant.inspectAssistantAccess,
    listAssistantCapabilities: assistant.listAssistantCapabilities,
    updateAssistantModelAccess: assistant.updateAssistantModelAccess,
    updateAssistantSelection: assistant.updateAssistantSelection,

    createSessionPullRequest: work.createSessionPullRequest,
    inspectSessionChangeDiff: work.inspectSessionChangeDiff,
    inspectSessionChanges: work.inspectSessionChanges,
    inspectSessionWork: work.inspectSessionWork,
    saveSessionWork: work.saveSessionWork,
    updateSessionWork: work.updateSessionWork,

    checkSessionUpdates: repositoryUpdates.checkSessionUpdates,
    probeRepositoryUpdates: repositoryUpdates.probeRepositoryUpdates,

    prepareStarterWorkspace: workspaceSetup.prepareStarterWorkspace,
    retryWorkspaceSetup: workspaceSetup.retryWorkspaceSetup,

    approveMainChatApproval: messages.approveMainChatApproval,
    approveMainChatMessage: messages.approveMainChatMessage,
    declineMainChatApproval: messages.declineMainChatApproval,
    editMainChatApproval: messages.editMainChatApproval,
    interruptAgentTurn: messages.interruptAgentTurn,
    readMainChatApprovals: messages.readMainChatApprovals,
    resumeIntegrationContinuation: messages.resumeIntegrationContinuation,
    sendAgentMessage: messages.sendAgentMessage,
    sendMainChatMessage: messages.sendMainChatMessage,
    skipIntegrationSetupRequest: messages.skipIntegrationSetupRequest,
    withdrawMainChatApproval: messages.withdrawMainChatApproval,

    inspectRepositoryHistory: repositoryReads.inspectRepositoryHistory,
    inspectRepositoryVersionFileDiff: repositoryReads.inspectRepositoryVersionFileDiff,
    inspectRepositoryVersionFiles: repositoryReads.inspectRepositoryVersionFiles
  });
  // The sessions feature's shutdown clears it.
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
  terminals.setPlanCompleted(saveAfterCompletedPlan);
  return service;
}

export { createService };
