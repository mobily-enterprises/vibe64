import { sessionConnectedSources } from "@local/vibe64-core/server/projectRepository";
import { currentProjectActionRequestMeta } from "@local/vibe64-core/server/projectRequestContext";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { createConnectedContributions } from "./connectedContributions.js";
import { createMainBrowserConversations } from "./mainBrowserConversations.js";
import { createSessionArchive } from "./sessionArchive.js";
import { createSessionAssistant } from "./sessionAssistant.js";
import { createSessionCatalogue } from "./sessionCatalogue.js";
import { createSessionCreation } from "./sessionCreation.js";
import { createSessionMessages } from "./sessionMessages.js";
import { createSessionRenewalController } from "./sessionRenewal.js";
import { createSessionRepositoryReads } from "./sessionRepositoryReads.js";
import { createSessionRepositoryUpdates } from "./sessionRepositoryUpdates.js";
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
 * @param {ProjectService} dependencies.project
 * @param {PublishProjectChanged} dependencies.publishProjectChanged
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {RenewalActorRestoration} dependencies.restoreRenewalActor
 * @param {SessionPresenceService} dependencies.sessionPresence
 * @param {SourceEditorService} dependencies.sourceEditor
 * @param {TerminalsService} dependencies.terminals
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetupRunner
 */
function createService({
  actions,
  archivePreparation,
  initializeModelRouting,
  project,
  publishProjectChanged,
  publishSessionChanged,
  restoreRenewalActor,
  sessionPresence,
  sourceEditor,
  terminals,
  workspaceSetupRunner: setupRunner
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
  const connected = createConnectedContributions({
    actions,
    project,
    terminals,
    publishSessionChanged,
    workOperations,
    sessions: () => service
  });
  const work = createSessionWork({
    connectedContributions: connected,
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
  const messages = createSessionMessages({
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

  const service = Object.freeze({
    browserConversations: createMainBrowserConversations({ actions, terminals }),
    archiveSession: archive.archiveSession,
    resumeSessionArchives: archive.resumeSessionArchives,

    cancelSessionRenewal: renewal.cancelSessionRenewal,
    closeSessionRenewalWork: renewal.closeSessionRenewalWork,
    confirmSessionRenewal: renewal.confirmSessionRenewal,
    inspectSessionRenewal: renewal.inspectSessionRenewal,
    requestSessionRenewalDraft: renewal.requestSessionRenewalDraft,
    resumeSessionRenewals: renewal.resumeSessionRenewals,
    retrySessionRenewal: renewal.retrySessionRenewal,
    updateSessionRenewalDraft: renewal.updateSessionRenewalDraft,

    allocateConnectedSource: connected.methods.allocateConnectedSource,
    connectedContributionWork: connected.methods.connectedContributionWork,
    inspectConnectedContributionSource: connected.methods.inspectConnectedContributionSource,
    inspectConnectedDevelopmentInputs: connected.methods.inspectConnectedDevelopmentInputs,
    prepareConnectedSources: connected.methods.prepareConnectedSources,
    replaceConnectedSource: connected.methods.replaceConnectedSource,
    reviewConnectedReplacement: connected.methods.reviewConnectedReplacement,

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
    declineMainChatApproval: messages.declineMainChatApproval,
    editMainChatApproval: messages.editMainChatApproval,
    interruptAgentTurn: messages.interruptAgentTurn,
    readMainChatApprovals: messages.readMainChatApprovals,
    resumeIntegrationContinuation: messages.resumeIntegrationContinuation,
    sendAgentMessage: messages.sendAgentMessage,
    skipIntegrationSetupRequest: messages.skipIntegrationSetupRequest,
    withdrawMainChatApproval: messages.withdrawMainChatApproval,

    changeIncomingContribution: repositoryReads.changeIncomingContribution,
    inspectIncomingContributions: repositoryReads.inspectIncomingContributions,
    inspectRepositoryHistory: repositoryReads.inspectRepositoryHistory,
    inspectRepositoryVersionFileDiff: repositoryReads.inspectRepositoryVersionFileDiff,
    inspectRepositoryVersionFiles: repositoryReads.inspectRepositoryVersionFiles,
    reviewIncomingContribution: repositoryReads.reviewIncomingContribution
  });
  // Automatic save: once Auto's completing turn ends, Main chat's autoSave
  // preference runs the ordinary Save. Returns the short chat note.
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
  terminals.setPlanCompleted(async (sessionId, { submittedBy = null } = {}) => {
    const runtime = await project.createRuntime({ inspectSource: false });
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    const preferences = assistantRoutingFromMetadata(session.metadata);
    if (preferences?.mode !== "auto" || !preferences.autoSave) return "";
    const skipped = reason => `Automatic save didn't run: ${reason}`;
    // Connected Save needs the person's authenticated request to each project.
    if (sessionConnectedSources(session).length) return skipped("this session has connected repositories. Choose Save yourself.");
    const inspection = await service.inspectSessionWork(sessionId, {}, { includeConnected: false });
    if (inspection?.ok === false) return skipped(normalizeText(inspection.error) || "this session's work could not be inspected.");
    if (!inspection.unsaved) return "Automatic save: nothing new to save.";
    const saved = await service.saveSessionWork(sessionId, { destinationReview: inspection.destination, vibe64User: submittedBy });
    return saved?.ok === false
      ? skipped(normalizeText(saved.error) || "Save was refused.")
      : "Saved automatically after completing the plan.";
  });
  /**
   * @param {object} preparation
   * @param {"inspect" | "prepare"} preparation.mode
   * @param {Vibe64SessionRuntime} preparation.runtime
   * @param {{ sessionId: string }} preparation.session
   * @param {((label: string) => Promise<void>) | null} [preparation.onProgress]
   */
  const prepareConnected = async ({ mode, runtime, session, onProgress = null }) => {
    const requestContext = { requestMeta: currentProjectActionRequestMeta() };
    // Each progress label is saved by workspace setup, then published so the
    // open session shows which connected projects are still being prepared.
    const progress = typeof onProgress === "function" ? async label => {
      await onProgress(label);
      await publishSessionChanged(session.sessionId, {
        operation: "updated",
        reason: "workspace-setup-progress",
        session: await runtime.getSession(session.sessionId, { inspectSource: false })
      });
    } : null;
    return mode === "prepare"
      ? connected.prepareConnectedSourcesInsideAgentWrite({ runtime, session }, {}, requestContext, { onProgress: progress })
      : service.inspectConnectedDevelopmentInputs(session.sessionId, {}, requestContext);
  };
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
  terminals.setConnectedPreparation(prepareConnected);
  return service;
}

export { createService };
