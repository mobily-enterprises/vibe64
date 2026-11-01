import { createPreviewDiagnosticRecorder } from "./previewDiagnostics.js";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { readProjectPreview, sendProjectMessage } from "./projectMessage.js";
import { createProjectServices } from "./projectServices.js";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { createClaudeConversationHost } from "./agent/providers/claudeConversationHost.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { createAssistantRouting } from "./assistantRouting.js";
import { createSessionConversations } from "./sessionConversations.js";
import { CLAUDE_PREPARATION_DELIVERY_STAGES } from "./mainConversationBinding.js";
import { discardAssistantChangeoverMessage, requireCompletedConversationRewind } from "./assistantChangeover.js";
import { createSessionAttachments } from "./sessionAttachments.js";
import { createProviderUsage } from "./providerUsage.js";
import { createSessionAgentManager } from "./agent/sessionAgentManager.js";
import process from "node:process";
import { createAgentEnvCommandService } from "./agentEnvCommand.js";
import { NO_PRODUCTION_ENVIRONMENT } from "./productionEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS } from "./savedEnvValueLinks.js";
import { createAgentDatabaseCommandService } from "./agentDatabaseCommand.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createAgentSessionCommandService } from "./agentSessionCommand.js";
import { createCodexGitCommandService } from "./codexGitCommand.js";
import { createSessionNaming } from "./sessionNaming.js";
import { createOutputTargetTerminalController } from "./outputTargetTerminal.js";
import { inspectGenesisSkills } from "@local/vibe64-genesis/server";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { throwIfAgentWriteBusy } from "@local/vibe64-runtime/server/agentWriteLock";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { createTerminalControls } from "./terminalControls.js";
import { requestMainGoalControl } from "./mainGoalControl.js";
import { createWorkspaceSetupRunner } from "./workspaceSetup.js";
import { createCodexSessionRegistration } from "./codexSessionRegistration.js";
import { createOpenCodeSessionRegistration } from "./openCodeSessionRegistration.js";
import { createSessionPromptHintsService } from "./sessionPromptHints.js";
import { startProjectRuntimeDormancyCleanupSchedule } from "./projectRuntimeDormancy.js";
import { AGENT_WRITE_WAIT_MS } from "./serviceSessionAccess.js";
import { sessionTerminalAdmissionFailure } from "./serviceSessionTerminals.js";
import { createServiceState } from "./serviceState.js";
import { createServiceSessionAccess } from "./serviceSessionAccess.js";
import { createServiceWorkspacePreparation } from "./serviceWorkspacePreparation.js";
import { createServiceAssistantContext } from "./serviceAssistantContext.js";
import { createServiceProviderAccess } from "./serviceProviderAccess.js";
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

/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {import("./types.js").ServiceAssistant} ServiceAssistant */
/** @typedef {ReturnType<typeof import("./serviceMainConversationHost.js").createServiceMainConversationHost>} ServiceMainConversationHost */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProjectRuntimeChangedPublisher} ProjectRuntimeChangedPublisher */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */
/** @typedef {typeof import("@local/vibe64-execution/server").runVibe64Command} RunVibe64Command */
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

/** @param {RuntimeEnv} env */
function codexToolHomeSourceFromEnv(env) {
  const context = codexRuntimeContext({
    env
  });
  return context?.ok === true ? context.toolHomeSource : "";
}

/**
 * @param {object} dependencies
 * @param {ActionCatalogue | null} [dependencies.actions]
 * @param {object} [dependencies.codexTerminalController] a host's Codex terminal settings
 * @param {RuntimeEnv} [dependencies.env]
 * @param {typeof inspectGenesisSkills} [dependencies.inspectAgentSkills]
 * @param {RuntimeLogger} dependencies.logger
 * @param {object} [dependencies.opencodeTerminalController] a host's OpenCode terminal settings
 * @param {ProductionEnvironmentProvider} [dependencies.productionEnvironmentProvider] a host's production Env
 * @param {ProjectServices | null} [dependencies.projectServices]
 * @param {ProjectService} dependencies.project
 * @param {ProjectRuntimeChangedPublisher} [dependencies.publishProjectRuntimeChanged]
 * @param {TerminalSessionChangedPublishers} [dependencies.publishSessionChanged]
 * @param {RunVibe64Command} dependencies.runCodexGitGatewayCommand
 * @param {SavedEnvValueLinks} [dependencies.savedEnvValueLinks] a host's saved values to link
 */
function createService({
  // readable-check: allow dependency-default - optional operation: without an action catalogue the assistant has no Vibe64 tools
  actions = null,
  // readable-check: allow dependency-default - data: a host's Codex terminal settings, none by default
  codexTerminalController = {},
  env = process.env,
  inspectAgentSkills = inspectGenesisSkills,
  logger,
  // readable-check: allow dependency-default - data: a host's OpenCode terminal settings, none by default
  opencodeTerminalController = {},
  productionEnvironmentProvider = NO_PRODUCTION_ENVIRONMENT,
  // readable-check: allow dependency-default - optional operation: without supplied project services the service creates its own
  projectServices: suppliedProjectServices = null,
  project,
  // readable-check: allow dependency-default - optional operation: without a project runtime publisher runtime changes are not announced
  publishProjectRuntimeChanged = async () => null,
  // readable-check: allow dependency-default - optional operation: without session publishers session changes are not announced
  publishSessionChanged = {},
  runCodexGitGatewayCommand,
  savedEnvValueLinks = NO_SAVED_ENV_VALUE_LINKS
}) {
  if (!project) {
    throw new TypeError("createService requires vibe64.project.");
  }
  const previewDiagnostics = createPreviewDiagnosticRecorder({ logger });
  const projectServices = suppliedProjectServices || createProjectServices();
  let assistantRouting;
  let sessionConversations;

  /**
   * The one Claude Code account status read, with the inputs Claude
   * conversations run with. Accounts and readiness read it too, so one
   * account costs one status read per cache period.
   */
  const readClaudeAccountStatus = () => readClaudeCodeAuthStatus({ env });
  const state = createServiceState({ readClaudeAccountStatus });
  /**
   * The goals, assistant and Main conversation host parts are built at the end, after the
   * collaborators that call back into them.
   * @type {ServiceGoals}
   */
  let goals;
  /** @type {ServiceAssistant} */
  let assistant;
  /** @type {ServiceMainConversationHost} */
  let mainConversationHost;

  const workspaceSetup = createWorkspaceSetupRunner({
    project,
    connectedPreparation: options => {
      // readable-check: allow method-probe - cycle: vibe64.sessions requires vibe64.terminals
      if (typeof state.slots.connectedPreparation !== "function") throw new Error("Connected workspace preparation is unavailable.");
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

  const publishAgentSessionChanged = async (sessionId, payload = {}) => {
    if (!state.lifecycle.closing) {
      providerUsage.observe(currentProjectScopeKey(), sessionId, payload, () => {
        // readable-check: allow optional-call - optional operation: a service without session publishers announces no plan usage
        if (!state.lifecycle.closing) return publishSessionChanged.agentTerminal?.(sessionId, { reason: "agent-plan-usage" });
      });
    }
    const publisher = publishSessionChanged.agentTerminal;
    if (typeof publisher === "function") {
      await publisher(sessionId, payload);
    }
    if (state.lifecycle.closing) return;
    if (payload.reason === "temporary-agent-turn-idle") {
      const completion = sessionConversations?.afterTemporaryTurn(sessionId, payload.payload).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.assistant_routing",
          event: "vibe64.assistant_routing.temporary_review_deferred",
          sessionId,
          code: error.code
        }, "Temporary chat review needs attention.");
      });
      if (completion) {
        state.turnCompletions.add(completion);
        void completion.finally(() => state.turnCompletions.delete(completion));
      }
      return;
    }
    if (!["claude-stream-turn-idle", "codex-app-server-turn-idle", "opencode-server-turn-idle"].includes(
      String(payload.reason || "").trim()
    )) {
      return;
    }
    const completion = Promise.all([
      assistantRouting?.afterTurn(sessionId, payload, {}).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.assistant_routing",
          event: "vibe64.assistant_routing.review_deferred",
          sessionId,
          code: error.code
        }, "Automatic review needs attention.");
      }),
      // A goal's automatic continuation follows each of its turns.
      goals.cancelGoalIfMainAiChanged(sessionId, null, { activeOnly: true }).catch((error) => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_goal",
          event: "vibe64.agent_goal.main_ai_cancel_failed",
          sessionId,
          code: error.code
        }, "A goal on the previous main AI could not be cancelled.");
      }),
      workspacePreparation.prepareWorkspaceSetup(sessionId, {
        publish: true,
        waitMs: AGENT_WRITE_WAIT_MS
      }).catch((error) => {
        vibe64SessionDebugLog("server.terminals.workspaceSetup.afterTurn.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      })
    ]);
    state.turnCompletions.add(completion);
    void completion.finally(() => state.turnCompletions.delete(completion));
  };

  const codexGitCommand = createCodexGitCommandService({
    env,
    logger,
    project,
    runGatewayCommand: runCodexGitGatewayCommand
  });
  let agentPreviewCommand;
  const outputTarget = createOutputTargetTerminalController({
    ensureProjectServices: projectServices.ensure,
    env,
    ensureWorkspacePrepared: async (sessionId, context = {}) => {
      if (await workspaceSetup.isPrepared(context)) {
        return { completion: null, state: context.session.workspaceSetup };
      }
      return workspacePreparation.prepareWorkspaceSetup(sessionId, {
        publish: true,
        rerunFailed: context.rerunFailedSetup === true,
        waitForCompletion: true
      });
    },
    project,
    stopPreviewBrowsers: (sessionId) => agentPreviewCommand.stopBrowsersForSession(sessionId),
    publishSessionChanged: publishSessionChanged.outputTarget,
    sessionAdmissionFailure: (sessionId) => sessionTerminalAdmissionFailure(sessionId, "output")
  });
  agentPreviewCommand = createAgentPreviewCommandService({
    launchTarget: outputTarget,
    logger,
    project,
    publishSessionChanged: publishSessionChanged.outputTarget
  });
  const agentEnvCommand = createAgentEnvCommandService({
    logger,
    productionEnvironmentProvider,
    project,
    savedEnvValueLinks
  });
  const agentDatabaseCommand = createAgentDatabaseCommandService({
    logger,
    project,
    readDatabaseTools: () => state.slots.databaseToolsProvider
  });
  const agentSessionCommand = createAgentSessionCommandService({
    retryWorkspaceSetup: sessionId => workspacePreparation.prepareWorkspaceSetup(sessionId, { publish: true, retry: true }),
    readProjectPreview: input => readProjectPreview(input, {
      project,
      authorize: (actor, slug) => state.assistantRuntime.authorizeProjectMessage(actor, slug),
      assertOpen: () => projectServices.assertOpen(sessionAccess.projectRuntimeContext()),
      launchTarget: outputTarget
    }),
    sendProjectMessage: input => sendProjectMessage(input, {
      project,
      publish: publishAgentSessionChanged,
      authorize: (actor, slug) => state.assistantRuntime.authorizeProjectMessage(actor, slug),
      assertOpen: () => projectServices.assertOpen(sessionAccess.projectRuntimeContext()),
      prepare: async (sessionId, options) => {
        const access = await assistant.inspectAssistantAccess(sessionId, options);
        if (access.available !== true || access.canUse !== true) {
          throw vibe64Error(
            access.disabledReason || "The selected session has no available assistant.",
            "vibe64_project_message_assistant_unavailable"
          );
        }
        const { runtime: openState } = await sessionAccess.currentProjectRuntimeOpenState();
        projectServices.assertOpen(sessionAccess.projectRuntimeContext());
        const destination = options.requireSelectedSession
          ? await options.runtime.store.readCurrentSession()
          : await options.runtime.store.readSession(sessionId);
        if (!openState.open || destination?.sessionId !== sessionId ||
            (!options.requireSelectedSession && destination.status !== VIBE64_SESSION_STATUS.ACTIVE)) {
          throw vibe64Error(
            "The destination closed, became unavailable or its selected session changed. Check it before sending again.",
            "vibe64_project_message_destination_changed"
          );
        }
      },
      send: (sessionId, message, options) => assistant.sendAgentMessage(sessionId, message, options),
      reportFailure: (error, receipt) => logger.warn({
        event: "vibe64.project_message.delivery_failed",
        error: error.message,
        code: error.code,
        sourceProject: input.sourceProject,
        sourceSession: input.sourceSession,
        ...receipt
      }, "Accepted project message failed during asynchronous delivery.")
    }),
    reportWorkflowOutcome: (sessionId, input, options) => assistantRouting.recordOutcome(sessionId, input, options),
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    project
  });
  const codexProviderOptions = selfTargetCodexAppServerProviderOptions({ codexTerminalController, env });
  const codexProviderConnections = createCodexProviderConnectionStore({ systemRoot: codexProviderOptions.systemRoot });
  const providerUsage = createProviderUsage({
    resolveConnection: (selection) => selection.engineId === "opencode"
      ? state.assistantRuntime.resolveConnection(selection)
      : codexProviderConnections.read(selection.modelProviderId, selection.engineId)
  });
  const runNativeDetachedConversation = request => mainConversations.runNativeDetachedConversation(request);
  const codex = createCodexSessionRegistration({
    ...codexTerminalController,
    listConnections: codexProviderConnections.list,
    connectionStatus: (context) => state.assistantRuntime.codexConnectionStatus(context),
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexAppServerProviderOptions: codexProviderOptions,
    codexToolHomeRequired: codexTerminalController.codexToolHomeRequired ?? true,
    codexToolHomeSource: codexTerminalController.codexToolHomeSource || codexToolHomeSourceFromEnv(env),
    codexGitCommand,
    env,
    logger,
    project,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    continueGoalAfterAccountChange: (sessionId, input) => goals.continueGoalAfterAccountChange(sessionId, input),
    runNativeDetachedConversation
  });
  const assistantContext = createServiceAssistantContext({ sessionAccess, actions });

  const mainConversations = createConversationRuntime({
    engine: "codex",
    hostDeliveryStages: CLAUDE_PREPARATION_DELIVERY_STAGES,
    onDeliveryTiming(event) {
      const slow = event.elapsedMs >= 1000 && ["accepted", "first-response"].includes(event.stage);
      logOperationalEvent(logger, slow || event.stage === "failed" ? "warn" : "info", {
        event: "vibe64.agent_message.delivery_timing",
        component: "vibe64.agent_message",
        sessionId: event.conversationId,
        engineId: event.engine,
        messageId: event.messageId,
        stage: event.stage,
        previousStage: event.previousStage,
        durationMs: event.durationMs,
        elapsedMs: event.elapsedMs,
        timings: event.timings
      }, "Assistant delivery timing.");
    },
    ...(assistantContext.mainToolCatalog ? { toolCatalog: assistantContext.mainToolCatalog } : {}),
    authorize: (request) => mainConversationHost.authorizeMainConversation(request),
    host: {
      nativeTools: true,
      conversation: (request) => mainConversationHost.prepareMainConversationOperation(request)
    }
  });

  const opencode = createOpenCodeSessionRegistration({
    ...opencodeTerminalController,
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    env,
    getAssistantManager: () => sessionAgent,
    listConnections: (context) => state.assistantRuntime.listConnections(context),
    logger,
    project,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    resolveConnection: (context) => state.assistantRuntime.resolveConnection(context),
    runNativeDetachedConversation
  });
  const sessionAttachments = createSessionAttachments({ project, env });
  const claudeProvider = createClaudeConversationHost({
    env,
    project,
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    systemRoot: codexProviderOptions.systemRoot,
    runNativeDetachedConversation,
    codexGitCommand,
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    accountStatus: readClaudeAccountStatus,
    connectionStatus: (context) => state.assistantRuntime.claudeConnectionStatus(context)
  });
  const providerAccess = createServiceProviderAccess({
    state,
    claudeProvider,
    codex,
    codexProviderConnections
  });

  const readRoutingConfiguration = () => createAssistantRoutingStore({ systemRoot: codexProviderOptions.systemRoot }).read();

  const sessionAgent = createSessionAgentManager({
    attachments: sessionAttachments,
    conversationRuntime: mainConversations,
    readProviderUsage: providerUsage.read,
    resolveAssistantUser: (user) => state.assistantRuntime.resolveAssistantUser(user),
    readRoutingConfiguration,
    providers: [
      claudeProvider,
      codex.provider,
      opencode.provider
    ],
    readAssistantAccess: providerAccess.readAssistantAccess
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
    systemRoot: codexProviderOptions.systemRoot, agent: sessionAgent,
    exclusive: async (sessionId, options, operation) => {
      const result = await sessionAccess.runMainAgentWrite(sessionId, options, operation,
        { operation: "assistant-routing", waitMs: options.lockWaitMs ?? AGENT_WRITE_WAIT_MS });
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
      await goals.requestGoalStop(sessionId, context).catch(() => {});
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
    describeAgentProvider: assistant.describeAgentProvider,
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
    requestMainGoalControl,
    readAgentGoal: goals.readAgentGoal,
    updateAgentGoal: goals.updateAgentGoal,
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
  createService,
  startProjectRuntimeDormancyCleanupSchedule
};
