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

const LISTED_CONFLICTS = 5;

/**
 * Why automatic save stopped at the Update it ran first, in words, with the one button that leads on: the Update
 * notice's Fix it with AI, which repairs a conflict, or any other Update problem, and then runs Update itself.
 * @param {{ error?: string, details?: object }} update the Update's refusal: its message, and a conflict's
 *   `conflictRecovery`, `conflictPaths` and `connectedRepository`
 */
function automaticUpdateStopped(update) {
  const details = update.details || {};
  const recovery = details.conflictRecovery || null;
  const repository = normalizeText(details.connectedRepository || recovery?.connectedRepository);
  const files = recovery?.conflictPaths || details.conflictPaths || [];
  const listed = files.slice(0, LISTED_CONFLICTS).join(", ") + (files.length > LISTED_CONFLICTS ? ` and ${files.length - LISTED_CONFLICTS} more` : "");
  const stopped = recovery
    ? `it conflicts with the newer saved work${repository ? ` in ${repository}` : ""}${listed ? `: ${listed}` : ""}.`
    : `Update stopped: ${(normalizeText(update.error) || "it did not finish").replace(/[.\s]+$/u, "")}.`;
  return `Automatic save didn't run: this session needed an Update first, and ${stopped} Nothing was saved. ` +
    "Choose Fix it with AI on the Update notice: it repairs that and runs Update. Then choose Save.";
}

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
   * Automatic save: once finished work's last turn ends, Main chat's autoSave
   * preference runs the ordinary Save, in any chat mode. When Save needs the
   * newer saved work first, it runs the ordinary Update, then Save again; it
   * stops only when that Update does. Returns the short chat note.
   * @param {string} sessionId
   * @param {{ submittedBy?: object | null }} details
   */
  async function saveAfterCompletedPlan(sessionId, details) {
    const runtime = await project.createRuntimeWithoutSource();
    const session = await runtime.getSessionWithoutSource(sessionId);
    const preferences = assistantRoutingFromMetadata(session.metadata);
    if (!preferences?.autoSave) return "";
    const input = { vibe64User: details.submittedBy };
    let saved = await work.saveToCurrentDestination(sessionId, input);
    const updateFirst = saved?.ok === false && saved.code === "vibe64_session_save_update_required";
    if (updateFirst) {
      const updated = await work.updateSessionWork(sessionId, input);
      if (updated?.ok === false) return automaticUpdateStopped(updated);
      saved = await work.saveToCurrentDestination(sessionId, input);
    }
    if (saved?.ok !== false) return updateFirst ? "Updated this session onto the newer saved work, then saved automatically." : "Saved automatically.";
    return saved.code === "vibe64_session_save_no_changes"
      ? "Automatic save: nothing new to save."
      : `Automatic save didn't run: ${normalizeText(saved.error) || "Save was refused."}`;
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
    settleStartedWork: work.settleStartedWork,
    startSessionSave: work.startSessionSave,
    startSessionUpdate: work.startSessionUpdate,
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
  // The sessions feature's shutdown clears them.
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
  terminals.setPlanCompleted(saveAfterCompletedPlan);
  // `vibe64-helper session update` runs this same Update.
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
  terminals.setSessionUpdate(work.updateSessionWork);
  // `vibe64-helper session save` runs the Save automatic save runs, once the session command has found that the
  // main chat's AI asks, with its Automatically save changes on.
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
  terminals.setSessionSave(work.saveToCurrentDestination);
  return service;
}

export { createService };
