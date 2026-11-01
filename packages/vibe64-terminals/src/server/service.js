import process from "node:process";
import { inspectGenesisSkills } from "@local/vibe64-genesis/server";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { throwIfAgentWriteBusy } from "@local/vibe64-runtime/server/agentWriteLock";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { createPreviewDiagnosticRecorder } from "./previewDiagnostics.js";
import { createAssistantRouting } from "./assistantRouting.js";
import { createSessionConversations } from "./sessionConversations.js";
import { discardAssistantChangeoverMessage, requireCompletedConversationRewind } from "./assistantChangeover.js";
import { createProviderUsage } from "./providerUsage.js";
import { createSessionNaming } from "./sessionNaming.js";
import { createTerminalControls } from "./terminalControls.js";
import { requestMainGoalControl } from "./mainGoalControl.js";
import { createWorkspaceSetupRunner } from "./workspaceSetup.js";
import { createSessionPromptHintsService } from "./sessionPromptHints.js";
import { AGENT_WRITE_WAIT_MS, createServiceSessionAccess } from "./serviceSessionAccess.js";
import { createServiceState } from "./serviceState.js";
import { createServiceWorkspacePreparation } from "./serviceWorkspacePreparation.js";
import { createServiceAssistantContext } from "./serviceAssistantContext.js";
import { createServiceAssistantPreparation } from "./serviceAssistantPreparation.js";
import { createServiceSessionTerminals } from "./serviceSessionTerminals.js";
import { createServiceGoals } from "./serviceGoals.js";
import { createServiceAssistant } from "./serviceAssistant.js";
import { createServiceMainConversationHost } from "./serviceMainConversationHost.js";
import { createServiceAgentConversations } from "./serviceAgentConversations.js";
import { createServiceSessionWork } from "./serviceSessionWork.js";
import { createServiceSessionWorkInspection } from "./serviceSessionWorkInspection.js";
import { createServiceAgentReconcile } from "./serviceAgentReconcile.js";
import { createServiceProjectRuntime } from "./serviceProjectRuntime.js";
import { createServiceShutdown } from "./serviceShutdown.js";
import { createServiceHostSlots } from "./serviceHostSlots.js";
import { createServiceTurnPublication } from "./serviceTurnPublication.js";
import { createServiceCommandServices } from "./serviceCommandServices.js";
import { createServiceAgentProviders } from "./serviceAgentProviders.js";

/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {import("./types.js").ServiceAssistant} ServiceAssistant */
/** @typedef {import("./types.js").ServiceMainConversationHost} ServiceMainConversationHost */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProjectRuntimeChangedPublisher} ProjectRuntimeChangedPublisher */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */
/** @typedef {import("./types.js").RunVibe64Command} RunVibe64Command */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */

/**
 * @param {object} input
 * @param {object} input.codexTerminalController a host's Codex terminal settings
 * @param {RuntimeEnv} input.env
 */
function selfTargetCodexAppServerProviderOptions({ codexTerminalController, env }) {
  const context = codexRuntimeContext({
    env,
    providerOptions: codexTerminalController.codexAppServerProviderOptions || {},
    toolHomeSource: codexTerminalController.codexToolHomeSource || ""
  });
  if (context?.ok === false) {
    throw new Error(context.error || "Codex runtime context could not be resolved.");
  }
  return context.providerOptions;
}

/**
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {object} [dependencies.codexTerminalController] a host's Codex terminal settings
 * @param {RuntimeEnv} [dependencies.env]
 * @param {typeof inspectGenesisSkills} [dependencies.inspectAgentSkills]
 * @param {RuntimeLogger} dependencies.logger
 * @param {object} [dependencies.opencodeTerminalController] a host's OpenCode terminal settings
 * @param {ProductionEnvironmentProvider} dependencies.productionEnvironmentProvider a host's production Env, or none
 * @param {ProjectServices} dependencies.projectServices
 * @param {ProjectService} dependencies.project
 * @param {ProjectRuntimeChangedPublisher} dependencies.publishProjectRuntimeChanged
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {RunVibe64Command} dependencies.runCodexGitGatewayCommand
 * @param {SavedEnvValueLinks} dependencies.savedEnvValueLinks a host's saved values to link, or none
 */
function createService({
  actions,
  // readable-check: allow dependency-default - data: a host's Codex terminal settings, none by default
  codexTerminalController = {},
  env = process.env,
  inspectAgentSkills = inspectGenesisSkills,
  logger,
  // readable-check: allow dependency-default - data: a host's OpenCode terminal settings, none by default
  opencodeTerminalController = {},
  productionEnvironmentProvider,
  projectServices,
  project,
  publishProjectRuntimeChanged,
  publishSessionChanged,
  runCodexGitGatewayCommand,
  savedEnvValueLinks
}) {
  const previewDiagnostics = createPreviewDiagnosticRecorder({ logger });

  /**
   * The one Claude Code account status read, with the inputs Claude
   * conversations run with. Accounts and readiness read it too, so one
   * account costs one status read per cache period.
   */
  const readClaudeAccountStatus = () => readClaudeCodeAuthStatus({ env });
  const state = createServiceState({ readClaudeAccountStatus });
  const codexProviderOptions = selfTargetCodexAppServerProviderOptions({ codexTerminalController, env });
  const codexProviderConnections = createCodexProviderConnectionStore({ systemRoot: codexProviderOptions.systemRoot });
  const providerUsage = createProviderUsage({
    resolveConnection: (selection) => selection.engineId === "opencode"
      ? state.assistantRuntime.resolveConnection(selection)
      : codexProviderConnections.read(selection.modelProviderId, selection.engineId),
    logger
  });
  /*
   * The parts that call back into each other: a turn's follow-up reaches routing, goals and temporary chats, which
   * publish through it; routing interrupts through goals; the Main conversation host and the assistant read each
   * other. They are built below, after the collaborators that call back into them.
   */
  /** @type {AssistantRouting} */
  let assistantRouting;
  /** @type {SessionConversations} */
  let sessionConversations;
  /** @type {ServiceGoals} */
  let goals;
  /** @type {ServiceAssistant} */
  let assistant;
  /** @type {ServiceMainConversationHost} */
  let mainConversationHost;

  const workspaceSetup = createWorkspaceSetupRunner({
    project,
    connectedPreparation: options => {
      if (!state.slots.connectedPreparation) throw new Error("Connected workspace preparation is unavailable.");
      return state.slots.connectedPreparation(options);
    }
  });
  const sessionAccess = createServiceSessionAccess({
    logger,
    project,
    publishSessionChanged
  });
  const workspacePreparation = createServiceWorkspacePreparation({
    sessionAccess,
    project,
    publishSessionChanged,
    workspaceSetup
  });
  const { publishAgentSessionChanged } = createServiceTurnPublication({
    afterTemporaryTurn: (sessionId, payload) => sessionConversations.afterTemporaryTurn(sessionId, payload),
    afterRoutedTurn: (sessionId, payload, options) => assistantRouting.afterTurn(sessionId, payload, options),
    cancelGoalIfMainAiChanged: (sessionId, vibe64User, options) => goals.cancelGoalIfMainAiChanged(sessionId, vibe64User, options),
    logger,
    providerUsage,
    publishSessionChanged,
    state,
    workspacePreparation
  });
  const commands = createServiceCommandServices({
    env,
    inspectAssistantAccess: (sessionId, options) => assistant.inspectAssistantAccess(sessionId, options),
    logger,
    productionEnvironmentProvider,
    project,
    projectServices,
    publishAgentSessionChanged,
    publishSessionChanged,
    recordWorkflowOutcome: (sessionId, input, options) => assistantRouting.recordOutcome(sessionId, input, options),
    runCodexGitGatewayCommand,
    savedEnvValueLinks,
    sendAgentMessage: (sessionId, message, options) => assistant.sendAgentMessage(sessionId, message, options),
    sessionAccess,
    state,
    workspacePreparation,
    workspaceSetup
  });
  const {
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    outputTarget
  } = commands;
  const assistantContext = createServiceAssistantContext({ sessionAccess, actions });
  const {
    codex,
    mainConversations,
    opencode,
    readRoutingConfiguration,
    sessionAgent,
    sessionAttachments
  } = createServiceAgentProviders({
    assistantContext,
    authorizeMainConversation: (request) => mainConversationHost.authorizeMainConversation(request),
    codexProviderOptions,
    codexProviderConnections,
    codexTerminalController,
    commands,
    continueGoalAfterAccountChange: (sessionId, input) => goals.continueGoalAfterAccountChange(sessionId, input),
    env,
    logger,
    opencodeTerminalController,
    prepareMainConversationOperation: (request) => mainConversationHost.prepareMainConversationOperation(request),
    project,
    providerUsage,
    publishAgentSessionChanged,
    readClaudeAccountStatus,
    state
  });
  const sessionPromptHints = createSessionPromptHintsService({
    publishSessionChanged: publishAgentSessionChanged,
    agent: sessionAgent,
    diagnostic: (event = {}) => logOperationalEvent(logger, "warn", {
      code: event.code,
      component: "vibe64.prompt_hints",
      details: event.details,
      error: event.error,
      event: event.event
    }, "Vibe64 prompt hints were unavailable."),
    project
  });
  const assistantPreparation = createServiceAssistantPreparation({
    sessionAccess,
    workspacePreparation,
    inspectAgentSkills,
    logger,
    project,
    sessionAgent
  });

  const sessionNaming = createSessionNaming({
    agent: sessionAgent,
    publishSessionChanged: publishAgentSessionChanged,
    logger,
    signal: state.shutdownSignal.signal
  });
  assistantRouting = createAssistantRouting({
    systemRoot: codexProviderOptions.systemRoot,
    logger,
    agent: sessionAgent,
    exclusive: async (sessionId, options, operation) => {
      const result = await sessionAccess.runMainAgentWrite(
        sessionId,
        options,
        operation,
        { operation: "assistant-routing", waitMs: options.lockWaitMs ?? AGENT_WRITE_WAIT_MS }
      );
      return throwIfAgentWriteBusy(result);
    },
    publish: publishAgentSessionChanged,
    prepareSelection: assistantPreparation.prepareRoutingSelection,
    open: (sessionId, options) => sessionAccess.readAssistantSession(sessionId, options),
    /**
     * Cancel's interrupt: goal continuation pauses, then the native turn stops.
     * The pause never waits for the goal settings lock (requestGoalStop).
     */
    async interrupt(sessionId, context) {
      await goals.requestGoalStop(sessionId, context).catch((error) => logOperationalEvent(logger, "warn", {
        component: "vibe64.agent_goal",
        event: "vibe64.agent_goal.stop_request_failed",
        sessionId: sessionId,
        code: error?.code,
        error: error?.message
      }, "Goal continuation could not be paused for a Cancel; the native turn still stops."));
      return sessionAgent.interruptTurn(sessionId, { reason: "cancel-message" }, context);
    },
    discardPending: discardAssistantChangeoverMessage,
    /**
     * The Save owner supplies what follows a completed plan (automatic save).
     */
    // readable-check: allow optional-call - cycle: vibe64.sessions requires vibe64.terminals
    onPlanCompleted: (sessionId, input) => state.slots.planCompleted?.(sessionId, input) || "",
    onTiming(event) {
      // Timing is diagnostic only; a failing log sink must not fail the send.
      try {
        logOperationalEvent(logger, event.elapsedMs >= 1000 ? "warn" : "info", {
          event: "vibe64.agent_message.routing_timing",
          component: "vibe64.agent_message",
          ...event
        }, "Assistant routing timing.");
      } catch {
        // Ignore: timing diagnostics are best-effort.
      }
    },
    async dispatch(sessionId, input, context) {
      requireCompletedConversationRewind(context.session);
      await assistantPreparation.prepareAgentSkillsInsideAgentWrite(sessionId, context);
      // A Main send needs the session's durable selection; this refuses without one.
      vibe64AssistantSelectionFromMetadata(context.session.metadata);
      return sessionAgent.sendMessage(sessionId, input, context);
    }
  });

  sessionConversations = createSessionConversations({
    actions,
    logger,
    conversationRuntime: mainConversations,
    systemRoot: codexProviderOptions.systemRoot,
    prepareSelection: (sessionId, selection, context) => sessionAgent.prepareSelection(sessionId, selection, context),
    sessionAgent,
    attachments: sessionAttachments,
    runAgentWrite: sessionAccess.runMainAgentWrite,
    // A temporary chat's routing waits for a sibling's assistant startup as long as Main chat does.
    routingWaitMs: AGENT_WRITE_WAIT_MS,
    /**
     * Always rereads the session; a conversation's caller may hold an older copy.
     */
    readSessionContext: async (sessionId, options = {}) => ({
      ...options,
      ...await sessionAccess.sessionContext(sessionId, { runtime: options.runtime })
    }),
    prepareAgentSkills: assistantPreparation.prepareAgentSkillsInsideAgentWrite,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event)
  });
  const terminals = createServiceSessionTerminals({
    state,
    sessionAccess,
    assistantContext,
    assistantPreparation,
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codex,
    env,
    logger,
    outputTarget,
    previewDiagnostics,
    project,
    projectServices,
    providerUsage,
    sessionAgent,
    sessionConversations,
    sessionNaming,
    sessionPromptHints
  });
  goals = createServiceGoals({
    state,
    sessionAccess,
    assistantContext,
    assistantPreparation,
    actions,
    assistantRouting,
    logger,
    project,
    publishAgentSessionChanged,
    readRoutingConfiguration,
    sessionAgent
  });
  assistant = createServiceAssistant({
    state,
    sessionAccess,
    assistantContext,
    goals,
    assistantRouting,
    codexProviderConnections,
    codexProviderOptions,
    env,
    logger,
    mainConversations,
    opencode,
    opencodeTerminalController,
    sessionAgent,
    sessionConversations,
    sessionNaming,
    sessionPromptHints
  });
  mainConversationHost = createServiceMainConversationHost({
    assistantContext,
    goals,
    assistant,
    actions,
    env,
    logger,
    project,
    sessionAgent,
    sessionConversations
  });
  const agentConversations = createServiceAgentConversations({
    sessionAccess,
    assistantContext,
    mainConversations,
    project,
    publishAgentSessionChanged,
    sessionAgent,
    sessionAttachments,
    workspaceSetup
  });
  const sessionWork = createServiceSessionWork({
    state,
    sessionAccess,
    workspacePreparation,
    agentConversations,
    codexGitCommand,
    env,
    logger,
    project,
    sessionAgent,
    workspaceSetup
  });
  const workInspection = createServiceSessionWorkInspection({
    sessionAccess,
    sessionWork,
    codexGitCommand,
    project
  });
  const reconcile = createServiceAgentReconcile({
    project,
    sessionAgent,
    sessionConversations
  });
  const projectRuntime = createServiceProjectRuntime({
    sessionAccess,
    terminals,
    goals,
    reconcile,
    agentPreviewCommand,
    outputTarget,
    project,
    projectServices,
    publishProjectRuntimeChanged,
    sessionAgent
  });
  const shutdown = createServiceShutdown({
    state,
    assistantRouting,
    mainConversations,
    outputTarget,
    projectServices,
    sessionAgent,
    sessionConversations,
    sessionNaming
  });
  const hostSlots = createServiceHostSlots({ state });

  const terminalControls = createTerminalControls({
    readAgentScreen: (sessionId, terminalSessionId, options) => terminals.readAgentTerminal(sessionId, terminalSessionId, options),
    writeAgentInput: (sessionId, terminalSessionId, data, input) => terminals.writeAgentTerminal(sessionId, terminalSessionId, data, input),
    readGlobalScreen: (terminalSessionId) => terminals.readGlobalCodexTerminal(terminalSessionId),
    writeGlobalInput: (terminalSessionId, data, options) => terminals.writeGlobalCodexTerminal(terminalSessionId, data, options)
  });

  /**
   * Main chat pauses its own goal.
   * @param {object} input
   * @param {object} context
   */
  function pauseMainGoal(input, context) {
    return requestMainGoalControl("pause", input, context);
  }

  /**
   * Main chat blocks its own goal.
   * @param {object} input
   * @param {object} context
   */
  function blockMainGoal(input, context) {
    return requestMainGoalControl("block", input, context);
  }

  return Object.freeze({
    temporaryConversationDataSchema: sessionConversations.temporaryConversationDataSchema,
    temporaryConversationSelectionSchema: sessionConversations.temporaryConversationSelectionSchema,
    conversationBinding: sessionConversations.conversationBinding,
    inspectTemporaryConversationDelivery: sessionConversations.inspectTemporaryConversationDelivery,
    createTemporaryConversation: sessionConversations.createTemporaryConversation,
    listTemporaryConversations: sessionConversations.listTemporaryConversations,
    readTemporaryConversation: sessionConversations.readTemporaryConversation,
    updateTemporaryConversation: sessionConversations.updateTemporaryConversation,
    cancelTemporaryConversationMessage: sessionConversations.cancelTemporaryConversationMessage,
    cancelTemporaryConversationRouting: sessionConversations.cancelTemporaryConversationRouting,
    stopTemporaryConversation: sessionConversations.stopTemporaryConversation,
    deleteTemporaryConversation: sessionConversations.deleteTemporaryConversation,
    retireTemporaryConversations: sessionConversations.retireTemporaryConversations,
    afterTemporaryTurn: sessionConversations.afterTemporaryTurn,
    startTemporaryConversationTurn: assistant.startTemporaryConversationTurn,
    readClaudeAccountStatus,
    recordPreviewDiagnostic: terminals.recordPreviewDiagnostic,
    configureAssistantRuntime: hostSlots.configureAssistantRuntime,
    createSessionSource: sessionWork.createSessionSource,
    // readable-check: allow setter-seam - cycle: vibe64.source-editor requires vibe64.terminals
    setSourceEditorProvider: hostSlots.setSourceEditorProvider,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
    setConnectedPreparation: hostSlots.setConnectedPreparation,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
    setPlanCompleted: hostSlots.setPlanCompleted,
    // readable-check: allow setter-seam - cycle: vibe64.database-tools requires vibe64.terminals
    setDatabaseToolsProvider: hostSlots.setDatabaseToolsProvider,
    prepareWorkspaceSetup: workspacePreparation.prepareWorkspaceSetup,
    prepareRenewalWorkspaceSetup: workspacePreparation.prepareRenewalWorkspaceSetup,
    workspaceSetupIsRunning: workspacePreparation.workspaceSetupIsRunning,
    workspaceSetupIsPrepared: workspacePreparation.workspaceSetupIsPrepared,
    waitForWorkspaceSetup: workspacePreparation.waitForWorkspaceSetup,
    close: shutdown.close,
    openProjectRuntime: projectRuntime.openProjectRuntime,
    closeDormantProjectRuntime: projectRuntime.closeDormantProjectRuntime,
    closeDormantProjectRuntimes: projectRuntime.closeDormantProjectRuntimes,
    closeSessionTerminals: terminals.closeSessionTerminals,
    freezeSessionTerminalAdmissionForRenewal: terminals.freezeSessionTerminalAdmissionForRenewal,
    closeRenewalPredecessorSessionTerminals: terminals.closeRenewalPredecessorSessionTerminals,
    closeRenewalSuccessorSessionTerminals: terminals.closeRenewalSuccessorSessionTerminals,
    releaseRenewalPredecessorAttachments: terminals.releaseRenewalPredecessorAttachments,
    releaseRenewalPredecessorProcessExitProof: terminals.releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof: terminals.releaseRenewalSuccessorProcessExitProof,
    closeSessionNonAgentTerminals: terminals.closeSessionNonAgentTerminals,
    thawSessionTerminalAdmissionForRenewal: terminals.thawSessionTerminalAdmissionForRenewal,
    recordSessionGitCommandActor: sessionWork.recordSessionGitCommandActor,
    saveSessionWork: sessionWork.saveSessionWork,
    runConnectedSessionSave: sessionWork.runConnectedSessionSave,
    runConnectedSourcePreparation: sessionWork.runConnectedSourcePreparation,
    runSessionSourceReadExclusive: sessionWork.runSessionSourceReadExclusive,
    createSessionPullRequest: sessionWork.createSessionPullRequest,
    checkSessionUpdates: workInspection.checkSessionUpdates,
    readRepositoryAuthorityHeads: workInspection.readRepositoryAuthorityHeads,
    updateSessionWork: sessionWork.updateSessionWork,
    recoverSessionWorkUpdate: sessionWork.recoverSessionWorkUpdate,
    recoverSessionWorkSave: sessionWork.recoverSessionWorkSave,
    retireSessionWorkSave: sessionWork.retireSessionWorkSave,
    inspectSessionWork: workInspection.inspectSessionWork,
    inspectSessionUpdateFailure: workInspection.inspectSessionUpdateFailure,
    inspectIncomingContributions: workInspection.inspectIncomingContributions,
    changeIncomingContribution: sessionWork.changeIncomingContribution,
    inspectSessionChanges: workInspection.inspectSessionChanges,
    inspectSessionChangeDiff: workInspection.inspectSessionChangeDiff,
    inspectRepositoryHistory: workInspection.inspectRepositoryHistory,
    inspectRepositoryVersionFiles: workInspection.inspectRepositoryVersionFiles,
    inspectRepositoryVersionFileDiff: workInspection.inspectRepositoryVersionFileDiff,
    closeProjectRuntime: projectRuntime.closeProjectRuntime,
    closeAgentTerminal: terminals.closeAgentTerminal,
    closeGlobalCodexTerminal: terminals.closeGlobalCodexTerminal,
    closeOutputTargetTerminal: terminals.closeOutputTargetTerminal,
    listAgentConversationStorage: agentConversations.listAgentConversationStorage,
    scanAgentConversationStorage: agentConversations.scanAgentConversationStorage,
    retireAgentConversationHistory: agentConversations.retireAgentConversationHistory,
    replaceAgentConversation: agentConversations.replaceAgentConversation,
    createEphemeralAgentConversation: agentConversations.createEphemeralAgentConversation,
    resolveEphemeralAgentExecutionProfile: agentConversations.resolveEphemeralAgentExecutionProfile,
    runEphemeralAgentChatTurn: agentConversations.runEphemeralAgentChatTurn,
    deleteEphemeralAgentConversation: agentConversations.deleteEphemeralAgentConversation,
    runDetachedAgentChatTurn: agentConversations.runDetachedAgentChatTurn,
    streamDetachedAgentChatTurn: agentConversations.streamDetachedAgentChatTurn,
    deleteDetachedAgentChatThread: agentConversations.deleteDetachedAgentChatThread,
    inspectAssistantAccess: assistant.inspectAssistantAccess,
    requireAssistantAccess: assistant.requireAssistantAccess,
    requireAssistantSelectionAccess: assistant.requireAssistantSelectionAccess,
    createConversationHost: assistant.createConversationHost,
    resolveConversationConfiguration: assistant.resolveConversationConfiguration,
    resolveConversationConnection: assistant.resolveConversationConnection,
    listAssistantCapabilities: assistant.listAssistantCapabilities,
    resolveAssistantPurpose: assistant.resolveAssistantPurpose,
    inspectAssistantRoutingConfiguration: assistant.inspectAssistantRoutingConfiguration,
    updateAssistantModelAccess: assistant.updateAssistantModelAccess,
    verifyAssistantConnection: assistant.verifyAssistantConnection,
    resolveAssistantSelection: assistant.resolveAssistantSelection,
    generateSessionRenewalHandover: agentConversations.generateSessionRenewalHandover,
    createSessionRenewalManualHandoverTemplate: agentConversations.createSessionRenewalManualHandoverTemplate,
    resolveAgentExecutionProfile: assistant.resolveAgentExecutionProfile,
    seedSessionRenewalHandover: agentConversations.seedSessionRenewalHandover,
    validateSessionRenewalHandover: agentConversations.validateSessionRenewalHandover,
    interruptDetachedAgentChatTurn: agentConversations.interruptDetachedAgentChatTurn,
    cancelAgentMessage: assistant.cancelAgentMessage,
    interruptAgentTurn: assistant.interruptAgentTurn,
    generateSessionPromptHints: assistant.generateSessionPromptHints,
    cancelSessionPromptHints: assistant.cancelSessionPromptHints,
    resumeIntegrationContinuation: assistant.resumeIntegrationContinuation,
    sendAgentMessage: assistant.sendAgentMessage,
    pauseMainGoal,
    blockMainGoal,
    readAgentGoal: goals.readAgentGoal,
    readCanonicalAgentGoal: goals.readCanonicalAgentGoal,
    updateAgentGoal: goals.updateAgentGoal,
    updateCanonicalAgentGoal: goals.updateCanonicalAgentGoal,
    readAgentPlanUsage: assistant.readAgentPlanUsage,
    readSessionWorkPlan: agentConversations.readSessionWorkPlan,
    archiveSessionWorkPlan: agentConversations.archiveSessionWorkPlan,
    restoreSessionWorkPlan: agentConversations.restoreSessionWorkPlan,
    ensureAgentSession: assistant.ensureAgentSession,
    assertSessionRenewalIdle: agentConversations.assertSessionRenewalIdle,
    invalidateAgentRuntimes: shutdown.invalidateAgentRuntimes,
    continueGoalAfterAccountChange: goals.continueGoalAfterAccountChange,
    recoverActiveGoals: goals.recoverActiveGoals,
    reconcileAgentSessions: reconcile.reconcileAgentSessions,
    reconcileOpenAgentSessions: projectRuntime.reconcileOpenAgentSessions,
    openBrowserConversation: assistant.openBrowserConversation,
    openTemporaryBrowserConversation: assistant.openTemporaryBrowserConversation,
    agentSessionState: assistant.agentSessionState,
    prepareAssistantChangeover: assistantPreparation.prepareAssistantChangeover,
    prepareRoutingSelection: assistantPreparation.prepareRoutingSelection,
    applyGoalSelection: goals.applyGoalSelection,
    cancelAssistantRoutingForSelection: assistant.cancelAssistantRoutingForSelection,
    globalCodexTerminalState: terminals.globalCodexTerminalState,
    readGlobalCodexTerminal: terminals.readGlobalCodexTerminal,
    readAgentTerminal: terminals.readAgentTerminal,
    readAgentTerminalControl: terminalControls.readAgentTerminalControl,
    checkAgentTerminalText: terminalControls.checkAgentTerminalText,
    writeAgentTerminalText: terminalControls.writeAgentTerminalText,
    writeAgentTerminalKey: terminalControls.writeAgentTerminalKey,
    readGlobalCodexTerminalControl: terminalControls.readGlobalCodexTerminalControl,
    checkGlobalCodexTerminalText: terminalControls.checkGlobalCodexTerminalText,
    writeGlobalCodexTerminalText: terminalControls.writeGlobalCodexTerminalText,
    writeGlobalCodexTerminalKey: terminalControls.writeGlobalCodexTerminalKey,
    readEphemeralAgentConversation: agentConversations.readEphemeralAgentConversation,
    readOutputTargetTerminal: terminals.readOutputTargetTerminal,
    testApprovalStatus: terminals.testApprovalStatus,
    resumeTestApproval: terminals.resumeTestApproval,
    cancelTestApproval: terminals.cancelTestApproval,
    outputTargetStatus: projectRuntime.outputTargetStatus,
    openOutputTarget: terminals.openOutputTarget,
    readOutputResult: terminals.readOutputResult,
    removeOutputResultsForSession: terminals.removeOutputResultsForSession,
    removeSessionCommandHelpers: terminals.removeSessionCommandHelpers,
    selectPreviewIdentity: terminals.selectPreviewIdentity,
    startAgentTerminal: terminals.startAgentTerminal,
    startEphemeralAgentConversationTurn: agentConversations.startEphemeralAgentConversationTurn,
    stopEphemeralAgentConversation: agentConversations.stopEphemeralAgentConversation,
    startGlobalCodexTerminal: terminals.startGlobalCodexTerminal,
    startOutputTargetTerminal: terminals.startOutputTargetTerminal,
    usageRecordingTargets: terminals.usageRecordingTargets,
    stopOutputTargetTerminal: terminals.stopOutputTargetTerminal,
    subscribeAgentTerminal: terminals.subscribeAgentTerminal,
    subscribeGlobalCodexTerminal: terminals.subscribeGlobalCodexTerminal,
    subscribeOutputTargetTerminal: terminals.subscribeOutputTargetTerminal,
    uploadAgentAttachment: agentConversations.uploadAgentAttachment,
    readAgentAttachment: agentConversations.readAgentAttachment,
    deleteAgentAttachment: agentConversations.deleteAgentAttachment,
    waitForEphemeralAgentConversationTurn: agentConversations.waitForEphemeralAgentConversationTurn,
    writeAgentTerminal: terminals.writeAgentTerminal,
    writeGlobalCodexTerminal: terminals.writeGlobalCodexTerminal,
    resizeAgentTerminal: terminals.resizeAgentTerminal,
    resizeGlobalCodexTerminal: terminals.resizeGlobalCodexTerminal,
    writeOutputTargetTerminal: terminals.writeOutputTargetTerminal,
    resizeOutputTargetTerminal: terminals.resizeOutputTargetTerminal
  });
}

export {
  createService
};
