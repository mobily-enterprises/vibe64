import { AppError } from "@jskit-ai/kernel/server/runtime";
import { conversationConfiguration } from "./conversationConfiguration.js";
import {
  createCodexSessionRenewalPreparation
} from "./sessionRenewalReceipts.js";
import {
  createCodexContextRefreshMarker,
  recordCodexContextUsageSignal
} from "./codexContextRenewalSignals.js";
import {
  CODEX_TURN_OUTCOME,
  codexAppServerResultDeliveryFailureMessage,
  writeCodexTurnOutcomeNotice
} from "./codexTurnOutcomeNotice.js";
import {
  conversationActorMetadata,
  codexDeliveredConversationMetadata as deliveredConversationMetadata,
  codexTerminalConversationMetadata as terminalConversationMetadata
} from "./conversationActor.js";
import {
  createCodexConversationStorage
} from "./codexConversationStorage.js";
import {
  createCodexHelperThreadLedger,
  codexHelperThreadLedgerOwner
} from "./codexHelperThreadLedger.js";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  createPersonalAiProfileStore
} from "@local/vibe64-core/server/personalAiProfile";
import {
  VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD
} from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  codexAppServerHelperIsolation
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  createCodexAppServerRunOwner
} from "@jskit-ai/assistant-core/server/codex-turn";
import {
  createCodexSessionTurnCheckpoint
} from "./sessionTurnCheckpoint.js";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";
import {
  createCodexAppServerProviderOwner
} from "@jskit-ai/assistant-core/server/codex-provider";
import {
  createCodexInteractiveTerminals
} from "./codexInteractiveTerminals.js";
import {
  codexAppServerTaskFinishedAfterRun,
  createCodexStartupHealth,
  createCodexUnavailableWorktreeHandler
} from "./codexStartupHealth.js";
import {
  createCodexSessionProviderHost,
  codexAppServerAdmissionError,
  CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE,
  runWithCodexAppServerProjectContext
} from "./codexSessionProviderHost.js";
import {
  createCodexRuntimeHost,
  createCodexSessionRuntimeHost
} from "./codexRuntimeHost.js";
import {
  createCodexAccountPreparation
} from "./codexAccountPreparation.js";
import {
  createCodexSessionEnvironment
} from "./codexSessionEnvironment.js";
import {
  createCodexAssistantCatalog
} from "./codexAssistantCatalog.js";
import {
  createCodexConversationPreparation
} from "./codexConversationPreparation.js";
import {
  createCodexHelperPreparation
} from "./codexHelperPreparation.js";
import {
  createCodexLifecyclePreparation
} from "./codexLifecyclePreparation.js";
import {
  createCodexScopedConversationPreparation,
  codexAppServerConversationResponse,
  codexAppServerExpiredEphemeralConversation
} from "./codexScopedConversationPreparation.js";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createProjectServices } from "./projectServices.js";
import {
  actorHomeEnv,
  appCredentialContext,
  createVibe64ConversationExecution,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost,
  CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
  assertCodexAuthPreflightReady,
  createCodexAppServerAgentProvider
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import { STUDIO_MANAGED_CLAUDE_COMMAND, STUDIO_MANAGED_CODEX_COMMAND } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { nativeConversationBindings } from "./nativeConversationRetirement.js";
import { manageWorkPlan, readWorkPlanPage } from "./assistantWorkPlan.js";
import { assertSessionRepositoryReview, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { createClaudeConversationHost } from "./agent/providers/claudeConversationHost.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { createAssistantRouting } from "./assistantRouting.js";
import { assistantModePrompt, assistantRoutingFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { createSessionConversations } from "./sessionConversations.js";
import {
  createOpenCodeMainMessagePreparation,
  createSessionConversationBinding,
  prepareSessionConversationActivity,
  prepareSessionConversationCreation,
  prepareSessionConversationRenewal,
  prepareSessionConversationRenewalProof,
  prepareSessionConversationReadiness,
  prepareSessionConversationDisposal,
  prepareProjectConversationCleanup,
  prepareConversationRuntimeInvalidation,
  prepareConversationReconciliation,
  prepareConversationSubscriptionReset,
  prepareSessionDetachedConversationCleanup,
  prepareSessionDetachedConversationRun,
  prepareSessionConversationStorage,
  publishMainConversationEvent
} from "./mainConversationBinding.js";
import { rememberAssistantBeforeChangeover, replaceNativeConversation, requireCompletedConversationRewind, requireCompletedNativeConversationReplacement, sendWithAssistantChangeover } from "./assistantChangeover.js";
import {
  createSessionAttachments,
  createCodexSessionAttachmentRenewal
} from "./sessionAttachments.js";
import { createProviderUsage } from "./providerUsage.js";
import {
  createSessionAgentManager
} from "./agent/sessionAgentManager.js";
import {
  createCodexSessionAgentProvider
} from "./agent/providers/codexSessionAgentProvider.js";
import {
  createOpenCodeSessionAgentProvider
} from "./agent/providers/opencodeSessionAgentProvider.js";
import { createOpenCodeSharedRuntime } from "@jskit-ai/assistant-core/server/opencode-process";
import { createOpenCodeLifecyclePreparation } from "./openCodeLifecyclePreparation.js";
import { createOpenCodeConversationAccounts } from "./openCodeConversationAccounts.js";
import { createOpenCodeConversationPresentation } from "./openCodeConversationPresentation.js";
import { createOpenCodeConversationEvents } from "./openCodeConversationEvents.js";
import { createOpenCodeScopedPreparation } from "./openCodeScopedPreparation.js";
import { createOpenCodeInteractiveTerminals } from "./openCodeInteractiveTerminals.js";
import { createOpenCodeSessionRenewalPreparation } from "./sessionRenewalReceipts.js";
import {
  createOpenCodeServerProcess,
  createOpenCodeHostPreparation,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  verifyOpenCodeApiKey
} from "./opencodeServerProcess.js";
import process from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createAgentEnvCommandService } from "./agentEnvCommand.js";
import { createAgentDatabaseCommandService } from "./agentDatabaseCommand.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createAgentSessionCommandService } from "./agentSessionCommand.js";
import { closeAgentSessionCommandEnvironment, prepareAgentSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { createCodexGitCommandService } from "./codexGitCommand.js";
import {
  checkSessionUpdates as checkManagedSessionUpdates,
  inspectSessionChangeDiff as inspectManagedSessionChangeDiff,
  inspectSessionChanges as inspectManagedSessionChanges,
  inspectSessionWork as inspectManagedSessionWork,
  prepareSessionPullRequestBranch,
  prepareSessionWorkSaveMessage as prepareManagedSessionWorkSaveMessage,
  recoverSessionWorkSave as recoverManagedSessionWorkSave,
  recoverSessionWorkUpdate as recoverManagedSessionWorkUpdate,
  saveSessionWork as saveManagedSessionWork,
  updateSessionWork as updateManagedSessionWork
} from "./sessionWorkSave.js";
import {
  cleanupSessionSaveCommitMessage,
  generateSessionSaveCommitMessage
} from "./sessionSaveCommitMessage.js";
import { createSessionNaming } from "./sessionNaming.js";
import {
  inspectRepositoryHistory as inspectManagedRepositoryHistory,
  repositoryVersionFileDiff as inspectManagedRepositoryVersionFileDiff,
  repositoryVersionFiles as inspectManagedRepositoryVersionFiles
} from "./repositoryHistory.js";
import { createOutputTargetTerminalController } from "./outputTargetTerminal.js";
import {
  recordSessionGitCommandActor as writeSessionGitCommandActor
} from "./sessionGitCommandActor.js";
import {
  createSessionSource as createManagedSessionSource
} from "./sessionSource.js";
import {
  GENESIS_BLUEPRINT_PATH,
  GENESIS_DERIVED_ARTIFACT_PATHS,
  inspectGenesisProjectFormat,
  inspectGenesisAgentIntegrations,
  inspectGenesisSkills,
  syncGenesisAgentIntegrations,
  syncGenesisSkills,
  vibe64HostContextEnvironment
} from "@local/vibe64-genesis/server";
import {
  codexTerminalNamespace,
  directoryExists,
  ensureTerminalSessionSourceGitSelfContained,
  outputTargetTerminalNamespace,
  opencodeTerminalNamespace,
  terminalSessionSourceRoot,
  terminalWorktreePath,
  terminalProjectScopeKey,
  vibe64Result
} from "./terminalShared.js";
import {
  closeTerminalSessionsForCwdRoot,
  closeTerminalSessionsForNamespace,
  freezeTerminalNamespaceAdmission,
  listTerminalSessions,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission
} from "@local/vibe64-execution/server/terminalSessions";
import {
  projectServiceNamespaceRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  assertProjectEffectAdmission,
  captureProjectRequestContext,
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  clearProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
} from "@local/vibe64-core/server/projectRuntimeOpenState";
import {
  codexRuntimeContext
} from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  VIBE64_SESSION_STATUS,
  assertValidVibe64SessionId,
  vibe64AgentRunStateIsActive,
  normalizeVibe64AgentRunState
} from "@local/vibe64-runtime/server/sessionStore";
import {
  sessionIsClosing
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  resolveVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantConversationKey,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { createWorkspaceSetupRunner } from "./workspaceSetup.js";
import {
  defineSessionRenewalHandoverText,
  sessionRenewalManualHandoverTemplate
} from "./sessionRenewalHandover.js";
import {
  createSessionPromptHintsService
} from "./sessionPromptHints.js";

const CODEX_AGENT_TURN_STEER_FAILED_CODE = "vibe64_codex_turn_steer_failed";
const CODEX_APP_SERVER_ACTIVE_RECONCILE_MS = 2000;
const CODEX_APP_SERVER_DAEMON_WELLBEING_MS = 15000;
function normalizeText(value) {
  return String(value || "").trim();
}

function codexAppServerPromptDeliveryEnabledByDefault({
  env = process.env
} = {}) {
  const configured = normalizeText(env.VIBE64_CODEX_APP_SERVER_PROMPTS).toLowerCase();
  if (["0", "false", "no", "off"].includes(configured)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(configured)) {
    return true;
  }
  return true;
}

const CODEX_APP_SERVER_PROMPT_DELIVERY_ENABLED = codexAppServerPromptDeliveryEnabledByDefault();

function createCodexSessionRegistration({
  connectionStatus = async () => true,
  listConnections = async () => [],
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  agentSessionCommand = null,
  codexAuthPreflight = assertCodexAuthPreflightReady,
  codexAppServerActiveReconcileMs = CODEX_APP_SERVER_ACTIVE_RECONCILE_MS,
  codexAppServerDaemonWellbeingMs = CODEX_APP_SERVER_DAEMON_WELLBEING_MS,
  codexAppServerProviderOptions = {},
  codexAppServerProviderFactory = createCodexAppServerAgentProvider,
  codexAppServerPromptDeliveryEnabled = CODEX_APP_SERVER_PROMPT_DELIVERY_ENABLED,
  codexHelperThreadLedgerFactory = createCodexHelperThreadLedger,
  codexToolHomeRequired = false,
  codexToolHomeSource = "",
  env = process.env,
  codexGitCommand = null,
  logger = null,
  projectService,
  publishConversation = null,
  runNativeDetachedConversation,
  publishSessionChanged = async () => null,
  runCommand = runVibe64Command
} = {}) {
  const initialCodexRuntime = codexRuntimeContext({
    env,
    providerOptions: codexAppServerProviderOptions,
    toolHomeSource: codexToolHomeSource
  });
  if (initialCodexRuntime?.ok === false) {
    throw new Error(initialCodexRuntime.error || "Codex runtime context could not be resolved.");
  }
  codexAppServerProviderOptions = initialCodexRuntime.providerOptions;
  codexToolHomeSource = initialCodexRuntime.toolHomeSource;
  const codexRuntimeHost = createCodexRuntimeHost({ env, codexAppServerProviderOptions, codexToolHomeSource });
  const {
    codexAppServerProviderKeyFields,
  } = codexRuntimeHost;
  const studioRuntimeProfile = getStudioProjectContext().runtimeProfile || {};
  const localRuntime = studioRuntimeProfile.local === true ||
    ["local", "local-editor"].includes(normalizeText(studioRuntimeProfile.mode).toLowerCase());
  const personalProfileStore = localRuntime && normalizeText(codexAppServerProviderOptions.systemRoot)
    ? createPersonalAiProfileStore({
        systemRoot: codexAppServerProviderOptions.systemRoot
      })
    : null;

  const providerConnections = createCodexProviderConnectionStore({ systemRoot: codexAppServerProviderOptions.systemRoot });
  const codexAccountPreparation = createCodexAccountPreparation({
    runtimeHost: codexRuntimeHost,
    providerConnections,
    codexToolHomeRequired,
    codexAuthPreflight,
    codexToolHomeSource,
    codexAppServerProviderOptions
  });

  const codexSessionEnvironment = createCodexSessionEnvironment({
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    env,
    projectService,
    runCommand
  });

  const codexSessionRuntimeHost = createCodexSessionRuntimeHost({
    runtimeHost: codexRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    projectService,
    runCommand
  });
  const {
    createRuntimeForSession,
    createStoreForSession,
    sessionHasCodexAppServerRuntime,
    codexAppServerOutputContext
  } = codexSessionRuntimeHost;
  const codexRenewalPreparation = createCodexSessionRenewalPreparation({
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    sessionEnvironment: codexSessionEnvironment
  });
  const codexSessionProviderHost = createCodexSessionProviderHost({
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    sessionEnvironment: codexSessionEnvironment,
    providerConnections,
    env,
    logger,
    // The native owner consumes these preparations only after construction.
    get runOwner() { return codexAppServerRunOwner; }
  });
  const {
    codexAppServerSessionProviderContext,
    codexAppServerConnectionPolicy,
    codexAppServerRecoveryEvent
  } = codexSessionProviderHost;

  const codexAppServerProviderOwner = createCodexAppServerProviderOwner({
    runtimeRoot: codexAppServerRuntimeBaseDir({ env }),
    exitUnverifiedCode: "vibe64_codex_runtime_exit_unverified",
    requiredStopCode: "vibe64_session_renewal_process_exit_unverified",
    runtimeCloseError: "Vibe64 Codex app-server runtime close failed.",
    onRecoveryEvent: codexAppServerRecoveryEvent,
    debugLog: (event, details) => vibe64SessionDebugLog(`server.codexTerminal.${event}`, details),
    debugError: vibe64SessionDebugError,
    runtimeBusyCode: CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
    providerFactory: codexAppServerProviderFactory === createCodexAppServerAgentProvider
      ? null : codexAppServerProviderFactory,
    prepareNativeHost(parameters) {
      const host = codexAppServerRuntimeHost(parameters);
      host.parameters.runtimeDir ||= codexAppServerRuntimeDir(parameters);
      return host;
    }
  });
  const codexAppServerRenewalSessionClosures = new WeakSet();
  const checkpointCodexAppServerTurn = createCodexSessionTurnCheckpoint({ projectService, publishSessionChanged });
  const codexAppServerRunOwner = createCodexAppServerRunOwner({
    namespace: codexTerminalNamespace,
    normalizeRunState: normalizeVibe64AgentRunState,
    debugLog: (event, details) => vibe64SessionDebugLog(`server.codexTerminal.${event}`, details),
    debugError: vibe64SessionDebugError,
    createRuntime: createRuntimeForSession,
    createStore: createStoreForSession,
    async publish(sessionId, event) {
      const { nativeGoal: _nativeGoal, ...publicEvent } = event;
      return publishMainConversationEvent(
        codexTerminalNamespace, publishSessionChanged, publishConversation, sessionId, event, publicEvent
      );
    },
    providerSessions: {
      owner: codexAppServerProviderOwner,
      wellbeingMs: codexAppServerDaemonWellbeingMs,
      keyFields: codexAppServerProviderKeyFields,
      context: codexAppServerSessionProviderContext,
      outputContext: codexAppServerOutputContext,
      connectionPolicy: codexAppServerConnectionPolicy
    },
    helperThreads: {
      ledgerOwner: { ...codexHelperThreadLedgerOwner,
        createCodexHelperThreadLedger: codexHelperThreadLedgerFactory },
      applicationName: "Vibe64"
    },
    conversationPreparation: {
      context: codexAppServerConversationPreparation,
      scope: codexAppServerEphemeralScopePreparation,
      execution: codexAppServerConversationExecution,
      detached: (sessionId, input) => codexScopedConversationPreparation.detached(sessionId, input),
      control: codexAppServerConversationControl,
      admissionError: codexAppServerAdmissionError,
      isolation: codexAppServerHelperIsolation,
      response: codexAppServerConversationResponse,
      expired: codexAppServerExpiredEphemeralConversation,
      failure: error => vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_terminal_request_failed",
        fallbackMessage: "Vibe64 terminal request failed."
      })
    },
    serverClosingError: {
      message: "The Vibe64 server is shutting down and cannot acquire Codex runtimes.",
      code: "vibe64_server_stopping",
      retryable: true
    },
    storeReadError: "Vibe64 session store does not support agent-run reads.",
    sessionIdRequiredError: "Vibe64 session ID is required.",
    turnClaimsUnsupportedError: "Vibe64 session runtime does not support Codex turn claims.",
    turnAlreadyRunningError: "Codex is already working on this Vibe64 session.",
    messageIdPrefix: "vibe64:",
    idlePublishPayload: VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD,
    checkpoint: checkpointCodexAppServerTurn,
    messageMetadata: {
      actor: currentConversationActorMetadata,
      delivered: deliveredConversationMetadata,
      terminal: terminalConversationMetadata
    },
    deliveryStateMetadataKey: "assistant_changeover",
    hasRuntime: sessionHasCodexAppServerRuntime,
    admissionTaskFinished: codexAppServerTaskFinishedAfterRun,
    outcomeNotice: writeCodexAppServerTurnOutcomeNotice,
    resultDeliveryFailureMessage: codexAppServerResultDeliveryFailureMessage,
    orphanedPromptMessage: "Vibe64 restarted before Codex confirmed the message. Your message is safe; retry it.",
    onNotificationSignal: recordCodexAppServerProductSignal,
    captureContext: captureProjectRequestContext,
    runInContext: runWithCodexAppServerProjectContext,
    activeReconcileMs: codexAppServerActiveReconcileMs,
    steerFailedCode: CODEX_AGENT_TURN_STEER_FAILED_CODE,
    interruptFailedCode: CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE,
    errorPrefix: "vibe64_"
  });
  const codexHelperPreparation = createCodexHelperPreparation({
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    providerHost: codexSessionProviderHost,
    runOwner: codexAppServerRunOwner
  });
  const codexConversationStorage = createCodexConversationStorage({ projectService, runOwner: codexAppServerRunOwner });
  const codexAttachments = createCodexSessionAttachmentRenewal({
    sessionRuntimeHost: codexSessionRuntimeHost, sessionEnvironment: codexSessionEnvironment
  });
  const codexStartupHealth = createCodexStartupHealth(publishSessionChanged);
  const blockCodexAppServerForUnavailableWorktree = createCodexUnavailableWorktreeHandler({
    runOwner: codexAppServerRunOwner,
    sessionRuntimeHost: codexSessionRuntimeHost,
    health: codexStartupHealth
  });
  const codexConversationPreparation = createCodexConversationPreparation({
    projectService,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    health: codexStartupHealth,
    unavailableWorktree: blockCodexAppServerForUnavailableWorktree,
    enabled: codexAppServerPromptDeliveryEnabled,
    publishSessionChanged,
    checkpoint: checkpointCodexAppServerTurn
  });
  const codexLifecyclePreparation = createCodexLifecyclePreparation({
    projectService,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    sessionEnvironment: codexSessionEnvironment,
    providerHost: codexSessionProviderHost,
    conversationPreparation: codexConversationPreparation,
    helperPreparation: codexHelperPreparation,
    health: codexStartupHealth,
    runtimeLifecycle: codexAppServerRunOwner.runtimeLifecycle,
    renewalSessionClosures: codexAppServerRenewalSessionClosures,
    enabled: codexAppServerPromptDeliveryEnabled
  });
  const codexAssistantCatalog = createCodexAssistantCatalog({
    accountPreparation: codexAccountPreparation,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    conversationPreparation: codexConversationPreparation,
    helperPreparation: codexHelperPreparation,
    providerOwner: codexAppServerProviderOwner,
    runOwner: codexAppServerRunOwner,
    providerFactory: codexAppServerProviderFactory,
    enabled: codexAppServerPromptDeliveryEnabled
  });
  const codexScopedConversationPreparation = createCodexScopedConversationPreparation({
    conversationPreparation: codexConversationPreparation,
    helperPreparation: codexHelperPreparation,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    actorMetadata: currentConversationActorMetadata,
    enabled: codexAppServerPromptDeliveryEnabled
  });
  const markCodexAppServerContextRefreshPending = createCodexContextRefreshMarker({ projectService, runOwner: codexAppServerRunOwner });

  function recordCodexAppServerProductSignal(kind, { store, sessionId, threadId, notification, reason }) {
    if (kind === "usage") {
      return recordCodexContextUsageSignal(store, sessionId, notification, { expectedThreadId: threadId });
    }
    if (kind === "context_refresh") {
      return markCodexAppServerContextRefreshPending(sessionId, threadId, notification, { reason });
    }
    return null;
  }

  function currentConversationActorMetadata(vibe64User = null) {
    return conversationActorMetadata({
      personalProfileStore,
      vibe64User
    });
  }

  const codexInteractiveTerminals = createCodexInteractiveTerminals({
    env,
    projectService,
    runCommand,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    runOwner: codexAppServerRunOwner,
    withThreadReadiness: codexConversationPreparation.threadReadiness,
    unavailableWorktree: blockCodexAppServerForUnavailableWorktree
  });

  async function writeCodexAppServerTurnOutcomeNotice(
    runtime,
    sessionId = "",
    threadId = "",
    turnId = "",
    outcome = CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
    detail = "",
    { usageLimitExceeded = false } = {}
  ) {
    return writeCodexTurnOutcomeNotice({
      detail,
      outcome,
      publishSessionChanged,
      sessionId,
      store: runtime?.store,
      threadId,
      turnId,
      usageLimitExceeded
    });
  }

  function codexAppServerEphemeralScopePreparation(sessionId = "", input = {}, scope = {}) {
    return codexScopedConversationPreparation.scope(sessionId, input, scope);
  }

  function codexAppServerConversationPreparation(sessionId = "", input = {}, options) {
    return codexScopedConversationPreparation.context(sessionId, input, options);
  }

  function codexAppServerConversationExecution(sessionId, input, options, context, conversationState, operation, identity = {}) {
    return codexScopedConversationPreparation.execution(sessionId, input, options, context, conversationState, operation, identity);
  }

  function codexAppServerConversationControl(sessionId, input, operation) {
    return codexScopedConversationPreparation.control(sessionId, input, operation);
  }

  const provider = createCodexSessionAgentProvider({
    connectionStatus,
    listConnections,
    runOwner: codexAppServerRunOwner,
    providerOwner: codexAppServerProviderOwner,
    conversationPreparation: codexConversationPreparation,
    lifecyclePreparation: codexLifecyclePreparation,
    helperPreparation: codexHelperPreparation,
    renewalPreparation: codexRenewalPreparation,
    sessionRuntimeHost: codexSessionRuntimeHost,
    storage: codexConversationStorage,
    catalog: codexAssistantCatalog,
    terminals: codexInteractiveTerminals,
    attachments: codexAttachments,
    enabled: codexAppServerPromptDeliveryEnabled,
    runNativeDetachedConversation,
    env,
    publishSessionChanged,
    checkpoint: checkpointCodexAppServerTurn
  });
  return Object.freeze({
    provider,
    terminals: codexInteractiveTerminals,
    accounts: codexAccountPreparation,
    catalog: codexAssistantCatalog,
    attachments: codexAttachments
  });
}

function createOpenCodeSessionRegistration({
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  agentSessionCommand = null,
  codexGitCommand = null,
  command = "opencode",
  createServerProcess = createOpenCodeServerProcess,
  env = process.env,
  getAssistantManager = () => null,
  listConnections = async () => [],
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  projectService,
  publishSessionChanged: publishApplicationSessionChanged = async () => null,
  publishConversation,
  runNativeDetachedConversation,
  readCatalogCommand = readOpenCodeCatalog,
  readZenModelsCommand = readOpenCodeZenModelIds,
  recordGitActor = writeSessionGitCommandActor,
  resolveConnection = async () => null,
  verifyConnectionCommand = verifyOpenCodeApiKey
} = {}) {
  if (!projectService) {
    throw new TypeError("OpenCode terminal controllers require vibe64.project.");
  }
  const publishSessionChanged = publishMainConversationEvent.bind(
    null, opencodeTerminalNamespace, publishApplicationSessionChanged, publishConversation
  );
  const sharedRuntime = createOpenCodeSharedRuntime({
    onStop: details => vibe64SessionDebugLog("server.opencode.shared-process.stop", details)
  });
  const { turns, temporaryConversations } = sharedRuntime;
  const hostPreparation = createOpenCodeHostPreparation({
    agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
    codexGitCommand, command, createServerProcess, env, getAssistantManager,
    listConnections, prepareCommandEnvironment, projectService, resolveConnection,
    sharedRuntime
  });
  const presentation = createOpenCodeConversationPresentation({ getAssistantManager, publishSessionChanged, turns, temporaryConversations });
  const events = createOpenCodeConversationEvents({ projectService, publishSessionChanged, sharedRuntime, presentation });
  const mainMessagePreparation = createOpenCodeMainMessagePreparation({
    projectService, env, recordGitActor, hostPreparation, events, presentation
  });
  const { contextFor } = mainMessagePreparation;
  const accounts = createOpenCodeConversationAccounts({
    command, createServerProcess, env, listConnections, readCatalogCommand,
    readZenModelsCommand, sharedRoots: hostPreparation.sharedRoots, verifyConnectionCommand,
    mainMessagePreparation, resolveConnection
  });
  const scopedPreparation = createOpenCodeScopedPreparation({
    projectService, contextFor, hostPreparation, events, publishSessionChanged, prepareSessionCleanup
  });

  const lifecyclePreparation = createOpenCodeLifecyclePreparation({
    projectService, getAssistantManager, sharedRuntime, hostPreparation,
    mainMessagePreparation, events, presentation, resolveConnection
  });
  const renewalPreparation = createOpenCodeSessionRenewalPreparation({
    mainMessagePreparation, hostPreparation, lifecyclePreparation
  });

  const terminals = createOpenCodeInteractiveTerminals({
    sharedRuntime, contextFor, hostPreparation, env, recordGitActor
  });

  function prepareSessionCleanup(sessionId = "", options = {}) {
    return lifecyclePreparation.prepareSessionCleanup(sessionId, options);
  }

  const provider = createOpenCodeSessionAgentProvider({
    sharedRuntime, hostPreparation, accounts, mainMessagePreparation, scopedPreparation,
    lifecyclePreparation, renewalPreparation, terminals, publishSessionChanged,
    prepareSessionCleanup, runNativeDetachedConversation
  });
  return { provider, hostPreparation, accounts, terminals };
}

const AGENT_WRITE_WAIT_MS = 60_000;

const PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS = 30 * 60 * 1000;
const PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const PROJECT_RUNTIME_IDLE_TIMEOUT_REASON = "idle-timeout";
const PROJECT_RUNTIME_MARKER_MISSING_REASON = "project-runtime-marker-missing";

function normalizeAgentProviderId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function recordValue(value = null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function renewalPredecessorTerminalCleanupContext(session = {}, {
  renewalId = "",
  runtime = null
} = {}) {
  const sessionRecord = recordValue(session);
  const normalizedRenewalId = String(renewalId || "").trim();
  const sessionId = String(sessionRecord?.sessionId || "").trim();
  const metadata = recordValue(sessionRecord?.metadata) || {};
  const status = String(sessionRecord?.status || "").trim();
  const quiescedId = String(metadata.renewal_quiesced_id || "").trim();
  const isActive = status === VIBE64_SESSION_STATUS.ACTIVE;
  const isExactQuiesced = status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
    quiescedId === normalizedRenewalId;
  // renewal_restored_id is historical proof of a completed rollback. An
  // active session is unowned once current quiescence and renewal links clear.
  if (
    !runtime ||
    !sessionId ||
    !normalizedRenewalId ||
    (!isActive && !isExactQuiesced) ||
    (isActive && (
      quiescedId ||
      String(metadata.renewed_to || "").trim()
    ))
  ) {
    throw new TypeError("Renewal predecessor terminal cleanup requires its exact active or quiesced session and runtime.");
  }
  return {
    renewalCleanup: Object.freeze({
      kind: "predecessor",
      renewalId: normalizedRenewalId,
      sourceSessionId: sessionId
    }),
    runtime,
    session: sessionRecord,
    sessionId
  };
}

function renewalSuccessorTerminalCleanupContext(session = {}, {
  renewalId = "",
  runtime = null
} = {}) {
  const sessionRecord = recordValue(session);
  const normalizedRenewalId = String(renewalId || "").trim();
  const sessionId = String(sessionRecord?.sessionId || "").trim();
  const metadata = recordValue(sessionRecord?.metadata) || {};
  if (
    !runtime ||
    !sessionId ||
    !normalizedRenewalId ||
    sessionRecord.status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
    String(metadata.renewal_id || "").trim() !== normalizedRenewalId ||
    !String(metadata.renewed_from || "").trim()
  ) {
    throw new TypeError("Renewal terminal cleanup requires the exact hidden successor and runtime.");
  }
  return {
    renewalCleanup: Object.freeze({
      kind: "successor",
      renewalId: normalizedRenewalId,
      sourceSessionId: String(metadata.renewed_from).trim()
    }),
    runtime,
    session: sessionRecord,
    sessionId
  };
}

function terminalNamespaceMatchesProjectScope(namespace = "", projectScope = "") {
  const normalizedNamespace = String(namespace || "").trim();
  const normalizedScope = String(projectScope || "").trim();
  if (!normalizedNamespace || !normalizedScope) {
    return false;
  }
  const marker = `:${normalizedScope}`;
  return normalizedNamespace.endsWith(marker) || normalizedNamespace.includes(`${marker}:`);
}

function projectScopedTerminalNamespaces(projectScope = "") {
  const namespaces = new Set();
  for (const entry of listTerminalSessions({})) {
    const namespace = String(entry?.namespace || "").trim();
    if (terminalNamespaceMatchesProjectScope(namespace, projectScope)) {
      namespaces.add(namespace);
    }
  }
  return [...namespaces].sort();
}

function normalizePositiveDurationMs(value, fallback) {
  const normalized = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function timestampMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampIso(ms = 0) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

function agentRunIsActive(run = {}) {
  // Codex acknowledges Resume before its scheduler starts the next turn.
  if (run?.providerGoalStatus === "active" && run.providerGoalThreadId &&
      run.providerGoalThreadId === run.providerThreadId) {
    return true;
  }
  if (run?.active === true) {
    return true;
  }
  try {
    return vibe64AgentRunStateIsActive(run?.state);
  } catch {
    return false;
  }
}

function sessionHasActiveAgentRun(session = {}) {
  return (Array.isArray(session?.agentRuns) ? session.agentRuns : []).some(agentRunIsActive);
}

function sessionRecordId(session = {}) {
  return String(session?.sessionId || session?.id || "").trim();
}

function sessionActivityTimestamps(session = {}) {
  const manifest = session?.manifest && typeof session.manifest === "object" && !Array.isArray(session.manifest)
    ? session.manifest
    : {};
  return [
    timestampMs(session.updatedAt),
    timestampMs(manifest.updatedAt),
    ...(Array.isArray(session?.agentRuns) ? session.agentRuns.map((run) => timestampMs(run?.updatedAt)) : []),
    ...(Array.isArray(session?.backgroundTasks) ? session.backgroundTasks.map((task) => timestampMs(task?.updatedAt)) : [])
  ].filter((value) => value > 0);
}

function projectRuntimeDormancyState({
  idleAfterMs = PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS,
  nowMs = Date.now(),
  runtime = {},
  sessions = []
} = {}) {
  const normalizedIdleAfterMs = normalizePositiveDurationMs(idleAfterMs, PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS);
  const normalizedNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const sessionRecords = Array.isArray(sessions) ? sessions : [];
  const activeAgentSessionIds = sessionRecords
    .filter(sessionHasActiveAgentRun)
    .map((session) => String(session?.sessionId || session?.id || "").trim())
    .filter(Boolean)
    .sort();
  const activityMs = [
    timestampMs(runtime.updatedAt),
    timestampMs(runtime.openedAt),
    ...sessionRecords.flatMap(sessionActivityTimestamps)
  ].filter((value) => value > 0);
  const lastActivityMs = activityMs.length ? Math.max(...activityMs) : 0;
  const idleMs = lastActivityMs > 0 ? Math.max(0, normalizedNowMs - lastActivityMs) : 0;
  const open = runtime?.open === true;
  return {
    activeAgentSessionIds,
    dormant: open && activeAgentSessionIds.length === 0 && lastActivityMs > 0 && idleMs >= normalizedIdleAfterMs,
    idleAfterMs: normalizedIdleAfterMs,
    idleMs,
    lastActivityAt: timestampIso(lastActivityMs),
    now: timestampIso(normalizedNowMs),
    open,
    sessionCount: sessionRecords.length
  };
}

function selfTargetCodexAppServerProviderOptions({
  codexTerminalController = {},
  env = process.env
} = {}) {
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

function codexToolHomeSourceFromEnv(env = process.env) {
  const context = codexRuntimeContext({
    env
  });
  return context?.ok === true ? context.toolHomeSource : "";
}

async function closeTerminalControllerForSession({
  controller,
  controllerOptions = {},
  eventPrefix = "server.terminals.closeSessionTerminals",
  label = "",
  sessionId = ""
} = {}) {
  if (typeof controller?.closeAllForSession !== "function") {
    return {
      closed: 0,
      ok: true
    };
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog(`${eventPrefix}.controller.start`, {
    controller: label,
    sessionId
  });
  try {
    const result = await controller.closeAllForSession(sessionId, controllerOptions);
    vibe64SessionDebugLog(`${eventPrefix}.controller.done`, {
      closed: Number(result?.closed || 0),
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      ok: result?.ok !== false,
      sessionId
    });
    return result;
  } catch (error) {
    vibe64SessionDebugLog(`${eventPrefix}.controller.error`, {
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId
    });
    throw error;
  }
}

async function closeTerminalControllersForSession(sessionId = "", controllers = [], {
  controllerOptions = {},
  eventPrefix = "server.terminals.closeSessionTerminals"
} = {}) {
  let closed = 0;
  for (const entry of controllers) {
    const result = await closeTerminalControllerForSession({
      ...entry,
      controllerOptions,
      eventPrefix,
      sessionId
    });
    if (result?.ok === false) {
      const error = new Error(result.error || `Session ${entry.label} could not be stopped.`);
      error.code = result.code || "vibe64_session_stop_failed";
      throw error;
    }
    closed += Number(result?.closed || 0);
  }
  return {
    closed,
    ok: true
  };
}

function createService({
  actions = null,
  authorizeCodexGitActorAccess = null,
  codexTerminalController = {},
  env = process.env,
  logger = null,
  opencodeTerminalController = {},
  projectService,
  publishProjectRuntimeChanged = async () => null,
  publishSessionChanged = {}
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires vibe64.project.");
  }
  const projectRuntimeOpenOperations = new Map();
  const projectServices = createProjectServices();
  let assistantRouting;
  let sessionConversations;
  const turnCompletions = new Set();
  let closing = false;

  const assistantRuntime = {
    claudeConnectionStatus: async () => (await readClaudeCodeAuthStatus({ env })).loggedIn === true,
    codexConnectionStatus: async () => true,
    listConnections: async () => [],
    readAssistantAccess: async () => ({ ownerOnly: false }),
    resolveAssistantUser: async (user) => user || currentProjectRequestContext()?.vibe64User || null,
    resolveConnection: async () => null,
    updateModelAccess: null
  };

  let databaseToolsProvider = null;
  let sourceEditorProvider = null;
  const workspaceSetup = createWorkspaceSetupRunner({
    projectService
  });
  const publishAgentSessionChanged = async (sessionId, payload = {}) => {
    if (!closing) {
      providerUsage.observe(terminalProjectScopeKey(), sessionId, payload, () => {
        if (!closing) return publishSessionChanged.agentTerminal?.(sessionId, { reason: "agent-plan-usage" });
      });
    }
    const publisher = publishSessionChanged.agentTerminal;
    if (typeof publisher === "function") {
      await publisher(sessionId, payload);
    }
    if (closing) return;
    if (payload.reason === "temporary-agent-turn-idle") {
      const completion = sessionConversations?.afterTemporaryTurn(sessionId, payload.payload).catch((error) => {
        logOperationalEvent(logger, "warn", { component: "vibe64.assistant_routing", event: "vibe64.assistant_routing.temporary_review_deferred", sessionId, code: error.code }, "Temporary chat review needs attention.");
      });
      if (completion) {
        turnCompletions.add(completion);
        void completion.finally(() => turnCompletions.delete(completion));
      }
      return;
    }
    if (!["claude-stream-turn-idle", "codex-app-server-turn-idle", "opencode-server-turn-idle"].includes(
      String(payload?.reason || "").trim()
    )) {
      return;
    }
    const completion = Promise.all([
      assistantRouting?.afterTurn(sessionId, payload, {}).catch((error) => {
        logOperationalEvent(logger, "warn", { component: "vibe64.assistant_routing", event: "vibe64.assistant_routing.review_deferred", sessionId, code: error.code }, "Automatic review needs attention.");
      }),
      prepareWorkspaceSetup(sessionId, {
        publish: true,
        waitMs: AGENT_WRITE_WAIT_MS
      }).catch((error) => {
        vibe64SessionDebugLog("server.terminals.workspaceSetup.afterTurn.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      })
    ]);
    turnCompletions.add(completion);
    void completion.finally(() => turnCompletions.delete(completion));
  };

  const codexGitCommand = createCodexGitCommandService({
    authorizeActorAccess: authorizeCodexGitActorAccess,
    env,
    logger,
    projectService
  });
  const outputTarget = createOutputTargetTerminalController({
    ensureProjectServices: projectServices.ensure,
    env,
    ensureWorkspacePrepared: async (sessionId, context = {}) => {
      if (await workspaceSetup.isPrepared(context)) {
        return { completion: null, state: context.session.workspaceSetup };
      }
      return prepareWorkspaceSetup(sessionId, { publish: true, waitForCompletion: true });
    },
    projectService,
    publishSessionChanged: publishSessionChanged.outputTarget,
    sessionAdmissionFailure: (sessionId) => sessionTerminalAdmissionFailure(sessionId, "output")
  });
  const agentPreviewCommand = createAgentPreviewCommandService({
    launchTarget: outputTarget,
    logger,
    projectService,
    publishSessionChanged: publishSessionChanged.outputTarget
  });
  const agentEnvCommand = createAgentEnvCommandService({
    logger,
    projectService
  });
  const agentDatabaseCommand = createAgentDatabaseCommandService({
    logger,
    projectService
  });
  const agentSessionCommand = createAgentSessionCommandService({
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    projectService
  });
  const codexProviderOptions = selfTargetCodexAppServerProviderOptions({ codexTerminalController, env });
  const codexProviderConnections = createCodexProviderConnectionStore({ systemRoot: codexProviderOptions.systemRoot });
  const providerUsage = createProviderUsage({
    resolveConnection: (selection) => selection.engineId === "opencode"
      ? assistantRuntime.resolveConnection(selection)
      : codexProviderConnections.read(selection.modelProviderId)
  });
  const runNativeDetachedConversation = request => mainConversations.runNativeDetachedConversation(request);
  const codex = createCodexSessionRegistration({
    ...codexTerminalController,
    listConnections: codexProviderConnections.list,
    connectionStatus: (context) => assistantRuntime.codexConnectionStatus(context),
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
    projectService,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    runNativeDetachedConversation
  });
  const mainToolCatalog = actions ? createServiceToolCatalog(actions, {
    isActionAvailable: ({ actionId, context }) => Boolean(context.runtime?.learningScope &&
      context.runtime.learningTeaching?.actionIds.includes(actionId))
  }) : null;
  function learningToolManifest(context) {
    if (!context.runtime?.learningScope || !context.runtime.learningTeaching || !mainToolCatalog) return context;
    const toolSet = mainToolCatalog.resolveToolSet(context, { discoveryOnly: true });
    return { ...context, applicationTools: { schemas: toolSet.tools.map(mainToolCatalog.toOpenAiToolSchema) } };
  }
  const mainConversations = createConversationRuntime({
    engine: "codex",
    ...(mainToolCatalog ? { toolCatalog: mainToolCatalog } : {}),
    async authorize({ context, conversationId }) {
      if (context?.sessionId !== conversationId) return false;
      const authority = context.browserAuthority;
      if (!authority) return true; // Existing, already-authorized manager callers.
      if (!actions || authority.sessionId !== conversationId) return false;
      const grant = await actions.execute({
        actionId: "vibe64.sessions.conversation.context.read",
        input: authority.learningAttemptId
          ? { learningAttemptId: authority.learningAttemptId, sessionId: conversationId }
          : { projectSlug: authority.projectSlug, sessionId: conversationId },
        context: authority.requestContext
      });
      return grant.actor.id === authority.actorId;
    },
    host: {
      nativeTools: true,
      conversation({ id, context, input, options, operation }) {
        if (operation === "closeProject") {
          return prepareProjectConversationCleanup(
            sessionAgent.conversationProvider(context.providerId), context, input
          );
        }
        if (operation === "invalidateRuntimes") {
          return prepareConversationRuntimeInvalidation(
            sessionAgent.conversationProvider(context.providerId), context, input
          );
        }
        if (operation === "reconcileSessions") {
          return prepareConversationReconciliation(
            sessionAgent.conversationProvider(context.providerId), context, input, options
          );
        }
        if (operation === "releaseRenewalPredecessorProcessExitProof" || operation === "releaseRenewalSuccessorProcessExitProof") {
          return prepareSessionConversationRenewalProof(
            sessionAgent.conversationProvider(context.providerId), id, context, input, operation
          );
        }
        if (operation === "inspectTemporaryActivity") {
          return prepareSessionConversationActivity(sessionAgent.conversationProvider(context.providerId), id, context);
        }
        if (operation === "unsubscribeSessions") {
          return prepareConversationSubscriptionReset(
            sessionAgent.conversationProvider(context.providerId), context, input
          );
        }
        return (async () => {
          if (operation === "listNativeConversationStorage" || operation === "retireConversationHistory") {
            return prepareSessionConversationStorage(
              sessionAgent.conversationProvider(input.engineId), id, context, input
            );
          }
          if (operation === "runDetachedConversation") {
            return prepareSessionDetachedConversationRun(
              sessionAgent.conversationProvider(context.providerId), id, context, input, options
            );
          }
          if (operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation") {
            return prepareSessionDetachedConversationCleanup(
              sessionAgent.conversationProvider(context.providerId), id, context, input,
              operation === "interruptDetachedConversation" ? "interruptDetachedChatTurn" : "deleteDetachedChatThread"
            );
          }
          if (operation !== "create" && operation !== "ensure" && operation !== "dispose" &&
              operation !== "generateRenewalHandover" && operation !== "seedRenewalHandover" && context.temporaryConversationId && !context.scopedConversationId && !context.assistantScope) {
            return sessionConversations.conversationBinding(id, context);
          }
          const engine = context.providerId || context.assistantSelection?.engineId || vibe64AssistantSelectionFromMetadata(context.session?.metadata).engineId;
          const provider = sessionAgent.conversationProvider(engine, "codex");
          if (operation === "generateRenewalHandover" || operation === "seedRenewalHandover") {
            return prepareSessionConversationRenewal(provider, id, context, input);
          }
          if (operation === "create") return prepareSessionConversationCreation(provider, id, context, input);
          if (operation === "ensure") return prepareSessionConversationReadiness(provider, id, learningToolManifest(context));
          if (operation === "dispose") {
            const runtime = context.runtime;
            if (runtime?.learningScope && runtime.learningTeaching) {
              await runtime.learningTeaching.cleanupConversation({ runtime, sessionId: id, terminals: service, context });
            }
            return prepareSessionConversationDisposal(provider, id, context, input);
          }
          // Scoped work already has its own authorized host and native identity;
          // opening its existing handle must not hydrate a project session.
          if (context.assistantScope) return createSessionConversationBinding(provider, id, context);
          const runtime = context.runtime || await projectService.createRuntime({ inspectSource: false });
          return createSessionConversationBinding(provider, id, {
            ...context, runtime,
            ...(runtime.learningScope && runtime.learningTeaching ? { teachingTerminals: service, teachingActions: actions } : {}),
            prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
          });
        })();
      }
    }
  });
  const opencode = createOpenCodeSessionRegistration({
    ...opencodeTerminalController,
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    command: opencodeTerminalController.command || env.VIBE64_OPENCODE_COMMAND || "opencode",
    env,
    getAssistantManager: () => sessionAgent,
    listConnections: (context) => assistantRuntime.listConnections(context),
    projectService,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    resolveConnection: (context) => assistantRuntime.resolveConnection(context),
    runNativeDetachedConversation
  });
  const sessionAttachments = createSessionAttachments({ projectService, env });
  const claudeProvider = createClaudeConversationHost({
    env, projectService, publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    systemRoot: codexProviderOptions.systemRoot,
    runNativeDetachedConversation,
    codexGitCommand, agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
    connectionStatus: (context) => assistantRuntime.claudeConnectionStatus(context)
  });
  const sessionAgent = createSessionAgentManager({
    attachments: sessionAttachments,
    conversationRuntime: mainConversations,
    readProviderUsage: providerUsage.read,
    resolveAssistantUser: (user) => assistantRuntime.resolveAssistantUser(user),
    readRoutingConfiguration: () => createAssistantRoutingStore({ systemRoot: codexProviderOptions.systemRoot }).read(),
    providers: [
      claudeProvider,
      codex.provider,
      opencode.provider
    ],
    async readAssistantAccess(context) {
      if (context.engineId === "claude") {
        return claudeProvider.assistantAccess(context);
      }
      if (context.engineId !== "codex") {
        return assistantRuntime.readAssistantAccess(context);
      }
      const curated = curatedCodexProvider(context.assistantSelection?.modelProviderId || context.modelProviderId);
      if (curated) {
        const connection = (await codexProviderConnections.list()).find(({ id }) => id === curated.id);
        return {
          available: connection?.connected === true,
          connectionIdentity: connection?.connectionIdentity || "",
          ownerOnly: curated.ownerOnly,
          endpointCode: curated.id
        };
      }
      const available = await assistantRuntime.codexConnectionStatus(context);
      try {
        return { ...await codex.accounts.assistantAccess(context), available };
      } catch (error) {
        if (available) throw error;
        return { available: false, ownerOnly: true, connectionIdentity: "" };
      }
    }
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
    projectService
  });

  async function closeAgentSession(sessionId, options = {}) {
    const result = await sessionAgent.closeSession(sessionId, options);
    if (result?.ok === false) return result;
    const runtime = options.runtime || (currentProjectRequestContext()?.learningScope
      ? await projectService.createRuntime({ inspectSource: false }) : null);
    if (runtime?.learningScope && runtime.learningTeaching) {
      await runtime.learningTeaching.cleanupConversation({ runtime, sessionId, terminals: service, context: options });
    }
    return result;
  }

  async function prepareAssistantChangeover(sessionId, context) {
    requireCompletedConversationRewind(context.session);
    const engineId = vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
    const metadata = context.session.metadata;
    if (engineId === "codex" && metadata.agent_identity_provider === "codex" && metadata.agent_identity_conversation_id) {
      const modelProviderId = metadata.agent_identity_model_provider || "openai";
      const prefix = modelProviderId === "openai" ? "codex" : `codex_${modelProviderId}`;
      await context.runtime.store.writeMetadataValue(sessionId, `${prefix}_conversation_id`, metadata.agent_identity_conversation_id);
      await context.runtime.store.writeMetadataValue(sessionId, `${prefix}_conversation_workdir`, metadata.agent_identity_workdir);
      // Resuming a Codex thread can resume an active native goal. Pause it
      // before that resume so only the user's next Send starts work.
      await context.runtime.store.writeMetadataValue(sessionId, "codex_changeover_pause_goal", "yes");
    }
    const closed = await closeAgentSession(sessionId, { ...context, changeover: true });
    if (closed?.ok === false) return closed;
    const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    await rememberAssistantBeforeChangeover(context, vibe64AssistantConversationKey(selection));
    logOperationalEvent(logger, "info", {
      event: "vibe64.assistant_changeover.previous_stopped", component: "vibe64.agent_message", sessionId, engineId
    }, "Previous assistant stopped; its conversation is retained.");
    return { ok: true };
  }

  async function prepareRoutingSelection(sessionId, selection, context) {
    const previous = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    if (previous.engineId !== selection.engineId) {
      const result = await prepareAssistantChangeover(sessionId, context);
      if (result?.ok === false) throw Object.assign(new Error(result.error || "The previous assistant could not stop."), result);
    }
    const preparation = sessionAgent.prepareSelection(sessionId, selection, context);
    if (preparation) await preparation;
  }

  const sessionNaming = createSessionNaming({ agent: sessionAgent, publishSessionChanged: publishAgentSessionChanged, logger });
  assistantRouting = createAssistantRouting({
    systemRoot: codexProviderOptions.systemRoot, agent: sessionAgent,
    exclusive: async (sessionId, options, operation) => {
      const result = await runMainAgentWrite(sessionId, options, operation,
        { operation: "assistant-routing", waitMs: AGENT_WRITE_WAIT_MS });
      if (result?.code === "vibe64_agent_write_mode_busy") throw Object.assign(new Error(result.error), result);
      return result;
    },
    publish: publishAgentSessionChanged,
    prepareSelection: prepareRoutingSelection,
    async dispatch(sessionId, input, context) {
      requireCompletedConversationRewind(context.session);
      await prepareAgentSkillsInsideAgentWrite(sessionId, context);
      return ["codex", "claude", "opencode"].includes(vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId)
        ? sessionAgent.sendMessage(sessionId, input, context)
        : sendWithAssistantChangeover(sessionId, input, context, sessionAgent);
    }
  });

  async function runMainAgentWrite(sessionId = "", options = {}, operation, lockOptions = {}) {
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      async () => {
        const session = typeof runtime.getSession === "function"
          ? await runtime.getSession(sessionId, {
              inspectSource: false
            })
          : options.session;
        if (lockOptions.operation !== "replace-agent-conversation") requireCompletedNativeConversationReplacement(session);
        return operation({
          ...options,
          runtime,
          session
        });
      },
      lockOptions
    );
    return exclusive.value;
  }

  function changeSessionWorkPlan(sessionId, operation, input) {
    const restoring = operation === "restore";
    return vibe64Result(() => runMainAgentWrite(sessionId, {}, async (context) => {
      const request = JSON.parse(context.session.metadata.assistant_routing_request || "null");
      if (sessionHasActiveAgentRun(context.session) || assistantRoutingStatusIsPending(request?.status) ||
          ["sent", "reviewing", "planning"].includes(request?.status)) {
        return { ok: false, error: "Wait for the assistant and its review to finish before " +
          (restoring ? "making a plan current." : "archiving the plan.") };
      }
      const result = await manageWorkPlan(context, restoring
        ? { operation: "reopen", archiveId: input.archiveId }
        : { operation: "archive", expectedRevision: input.expectedRevision, expectedProgressRevision: input.expectedProgressRevision }, "user");
      if (restoring) result.notice = "The archived plan is now current and active. Ask in chat to continue its work.";
      await publishAgentSessionChanged(sessionId, { reason: "work-plan-changed", payload: { planNotice: result.notice } });
      return { ok: true, sessionId, ...result };
    }, { operation: operation + "-work-plan" }));
  }

  async function authorizeGlobalCodexTerminal(options = {}) {
    await sessionAgent.requireAssistantAccessForEngine("codex", options);
  }

  async function prepareAgentSkillsInsideAgentWrite(sessionId, context) {
    await sessionAgent.requireAssistantAccess(sessionId, context);
    if (sessionHasActiveAgentRun(context.session)) return;
    const projectRoot = terminalWorktreePath(context.session);
    if (!projectRoot || !existsSync(path.join(projectRoot, GENESIS_BLUEPRINT_PATH))) return;
    const temporary = await sessionAgent.hasActiveTemporaryConversation(sessionId, {}, context);
    if (temporary.active) return;
    const format = await inspectGenesisProjectFormat({ projectRoot });
    if (format.status !== "current") return;
    let inspection;
    try {
      inspection = await inspectGenesisSkills({ projectRoot });
    } catch (error) {
      if (error?.code === "STACK_PROJECT_CONTRACTS_INCOMPLETE") {
        logOperationalEvent(logger, "warn", {
          code: error.code,
          component: "vibe64.agent_skills",
          event: "vibe64.agent_skills.refresh_deferred",
          sessionId
        }, "Project contracts need repair; skill refresh deferred so chat remains available.");
        return;
      }
      if (error?.code !== "AGENT_SKILL_UNAVAILABLE") throw error;
      await invalidateWorkspaceSetup(context,
        `${error.message} Run workspace preparation to restore the project's declared dependencies. Chat remains available.`);
      logOperationalEvent(logger, "warn", {
        code: error.code,
        component: "vibe64.agent_skills",
        event: "vibe64.agent_skills.preparation_required",
        sessionId
      }, "Project skill refresh requires workspace preparation.");
      return;
    }
    const guidance = await inspectGenesisAgentIntegrations({ projectRoot });
    const refreshSkills = ["missing", "outdated"].includes(inspection.status);
    if (!refreshSkills && guidance.status === "current") return;
    const result = await projectService.runProjectSourceExclusive(
      async () => {
        const skills = refreshSkills ? await syncGenesisSkills({ projectRoot }) : { changedFiles: [] };
        const integrations = await syncGenesisAgentIntegrations({ projectRoot });
        return { changedFiles: [...integrations.changedFiles, ...skills.changedFiles] };
      },
      { operation: "sync-agent-skills" }
    );
    if (result.changedFiles.length > 0) {
      await publishTerminalSessionChanged("agentTerminal", sessionId, "agent-skills-updated", {
        changedFiles: result.changedFiles
      });
    }
  }

  async function assistantSessionOptions(sessionId = "", options = {}) {
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const session = options.session || await runtime.getSession(sessionId, {
      inspectSource: false
    });
    return { ...options, runtime, session };
  }

  async function applyAgentGoalReadResult(sessionId, context, result) {
    const pinned = JSON.parse(context.session.metadata.assistant_routing_goal || "null");
    if (pinned && result.status === "available") {
      const status = result.goal?.status || "complete";
      if (pinned.status !== status) {
        await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({ ...pinned, status }));
        await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
      }
      if (result.goal) return { ...result, goal: { ...result.goal,
        objective: result.goal.objective === assistantModePrompt(pinned.mode, pinned.objective) ? pinned.objective : result.goal.objective },
        routing: { mode: pinned.mode, selection: pinned.selection } };
    }
    return result;
  }

  async function invalidateWorkspaceSetup(context, diagnostic = "Run this session's declared setup steps after updating its source.") {
    await workspaceSetup.invalidate({ ...context, diagnostic });
    await publishTerminalSessionChanged("agentTerminal", context.session.sessionId, "workspace-setup-updated");
  }

  async function prepareWorkspaceSetup(sessionId = "", options = {}) {
    return runMainAgentWrite(sessionId, options, async (context) => {
      const setup = await prepareWorkspaceSetupInsideAgentWrite(sessionId, context);
      if (options.waitForCompletion && setup.completion) {
        await setup.completion;
      }
      return setup;
    }, { operation: "prepare-workspace", waitMs: options.waitMs });
  }

  async function prepareRenewalWorkspaceSetup(sessionId = "", options = {}) {
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const exclusive = await runVibe64RenewalAgentWriteExclusive(
      runtime,
      sessionId,
      async () => prepareWorkspaceSetupInsideAgentWrite(sessionId, {
        ...options,
        renewal: true,
        runtime,
        session: await renewalSession(runtime, sessionId)
      }),
      { operation: "prepare-renewal-workspace" }
    );
    if (!exclusive.acquired) {
      const error = new Error(
        exclusive.value?.error || "Another session operation is starting. Try again in a moment."
      );
      error.code = exclusive.value?.code || "vibe64_agent_write_mode_busy";
      error.retryable = true;
      throw error;
    }
    return exclusive.value;
  }

  async function renewalSession(runtime, sessionId = "") {
    if (typeof runtime?.getSessionForRenewal === "function") {
      return runtime.getSessionForRenewal(sessionId, {
        inspectSource: false
      });
    }
    const error = new Error("Session renewal requires an internal renewal session reader.");
    error.code = "vibe64_session_renewal_reader_unavailable";
    throw error;
  }

  async function runSessionRenewalOperation(
    input = {},
    options = {},
    context = {},
    operation,
    readSession
  ) {
    const beforeStart = typeof options.beforeStart === "function"
      ? await options.beforeStart({
          ...context,
          input
        })
      : null;
    if (beforeStart?.ok === false) {
      return beforeStart;
    }
    const nextInput = recordValue(beforeStart?.input)
      ? {
          ...input,
          ...beforeStart.input
        }
      : input;
    // beforeStart is deliberately inside the agent-write lock and may
    // persist the exact basis used by orchestration. Rehydrate before the
    // provider operation so it observes that durable state.
    const session = typeof options.beforeStart === "function"
      ? await readSession()
      : context.session;
    return operation(nextInput, {
      ...context,
      session
    });
  }

  async function runHiddenSessionRenewalAgentWrite(
    sessionId = "",
    input = {},
    options = {},
    operation
  ) {
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const exclusive = await runVibe64RenewalAgentWriteExclusive(
      runtime,
      sessionId,
      async () => {
        const readSession = () => renewalSession(runtime, sessionId);
        const session = await readSession();
        return runSessionRenewalOperation(
          input,
          options,
          {
            ...options,
            runtime,
            session
          },
          operation,
          readSession
        );
      },
      { operation: "seed-renewal-handover" }
    );
    return exclusive.value;
  }

  async function saveSessionWorkInsideWrite(sessionId, input, context) {
    const { execution, normalizedSessionId, runtime, session } = await sessionWorkExecution(
      sessionId,
      context,
      "session-save"
    );
    const project = await projectService.readCurrentProject();
    const destination = assertSessionRepositoryReview(project, session, input.destinationReview);
    const assertWorkflow = async () => {
      if (destination.mode !== "github") return;
      const workflow = await projectService.readRepositoryWorkflow();
      if (workflow.requirePullRequest && !context.creatingPullRequest &&
          !JSON.parse(session.metadata?.github_pull_request || "null")?.number) {
        const error = new Error("This project requires a pull request. Create or open a pull request before publishing this session.");
        error.code = "vibe64_pull_request_required";
        throw error;
      }
    };
    await assertWorkflow();
    const saveMessageInput = await prepareManagedSessionWorkSaveMessage({
      commandOptions: execution.commandOptions,
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      limit: 40,
      operationId: input.operationId,
      project,
      runCommand: execution.runCommand,
      session
    });
    await input.onProgress?.({
      checkpointCommit: saveMessageInput.checkpoint.checkpointCommit,
      checkpointTree: saveMessageInput.checkpoint.checkpointTree,
      kind: "message",
      message: "Writing a concise name for this work.",
      stage: "message-writing"
    });
    const agentContext = {
      runtime,
      session,
      vibe64User: input.vibe64User || null
    };
    let commitTitle;
    try {
      commitTitle = await generateSessionSaveCommitMessage({
        agent: sessionAgent, agentContext, changes: saveMessageInput.changes
      });
    } catch (error) {
      // Naming is optional. Leave failed thread ownership intact and let the
      // repository owner enforce the normal checkpoint and publish checks.
      commitTitle = {
        executionProfile: null,
        subject: `Save work ${saveMessageInput.checkpoint.checkpointTree.slice(0, 12)}`
      };
      logOperationalEvent(logger, "warn", {
        code: error.code || "vibe64_session_save_message_failed",
        component: "vibe64.session_save",
        event: "vibe64.session_save.message_fallback",
        operationId: input.operationId,
        sessionId: normalizedSessionId
      }, "Assistant naming was unavailable; Save is using a checkpoint-based version name.");
      await input.onProgress?.({
        code: error.code || "vibe64_session_save_message_failed",
        kind: "message",
        message: "Assistant naming is unavailable. Saving with a checkpoint-based version name.",
        stage: "message-fallback"
      });
    }
    await input.onProgress?.({
      executionProfile: commitTitle.executionProfile,
      kind: "message",
      message: "Version name ready.",
      stage: "message-ready"
    });
    const saved = await saveManagedSessionWork({
      checkpoint: saveMessageInput.checkpoint,
      commandOptions: execution.commandOptions,
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      identity: execution.identity,
      message: commitTitle.subject,
      onCacheMaintenance(cacheMaintenance = {}) {
        if (cacheMaintenance.retryable !== true) {
          return;
        }
        logOperationalEvent(logger, "warn", {
          code: cacheMaintenance.code,
          component: "vibe64.session_save",
          event: "vibe64.session_save.cache_maintenance_failed",
          operationId: input.operationId,
          reason: cacheMaintenance.reason,
          sessionId: normalizedSessionId
        }, cacheMaintenance.message || "Vibe64 Save cache maintenance failed.");
      },
      onProgress: input.onProgress,
      operationId: input.operationId,
      project,
      runCommand: execution.runCommand,
      runProjectSourceExclusive: (operation, options) => projectService.runProjectSourceExclusive(async () => {
        assertSessionRepositoryReview(await projectService.readCurrentProject(), session, input.destinationReview);
        await assertWorkflow();
        return operation();
      }, options),
      session
    });
    return {
      ...saved,
      commitTitleExecutionProfile: commitTitle.executionProfile
    };
  }

  async function runSessionRepositoryWrite(
    sessionId = "",
    options = {},
    {
      operation: operationName = "repository-write",
      activeCode = "vibe64_session_repository_agent_active",
      activeMessage = "Wait for the assistant turn to finish before changing this session's repository."
    } = {},
    operation
  ) {
    const result = await runMainAgentWrite(sessionId, options, async (context) => {
      if (sessionHasActiveAgentRun(context.session)) {
        const activityCheck = await sessionAgent.ensureSession(sessionId, context);
        context.session = await context.runtime.getSession(sessionId, { inspectSource: false });
        if (sessionHasActiveAgentRun(context.session)) {
          const error = new Error(activityCheck?.error || activeMessage);
          error.code = activeCode;
          error.retryable = true;
          throw error;
        }
      }
      await options.onRepositoryWriteAcquired?.();
      return operation(context);
    }, { operation: operationName, waitMs: 10_000 });
    if (result?.ok === false && result?.code === "vibe64_agent_write_mode_busy") {
      const error = new Error(result.error || "Another session operation is starting. Try again in a moment.");
      error.code = result.code;
      error.details = result.details;
      error.retryable = true;
      throw error;
    }
    return result;
  }

  async function publishTerminalSessionChanged(
    kind = "",
    sessionId = "",
    reason = "",
    payload = {}
  ) {
    const publisher = publishSessionChanged?.[kind];
    if (typeof publisher !== "function" || !String(sessionId || "").trim()) {
      return null;
    }
    return publisher(sessionId, {
      ...payload,
      reason
    });
  }

  async function prepareWorkspaceSetupInsideAgentWrite(sessionId = "", {
    publish = false,
    renewal = false,
    retry = false,
    runtime: existingRuntime = null,
    session: existingSession = null
  } = {}) {
    const requestContext = captureProjectRequestContext();
    const runtime = existingRuntime || await projectService.createRuntime({
      inspectSource: false
    });
    const session = existingSession || await runtime.getSession(sessionId, {
      inspectSource: false
    });
    if (runtime.learningScope?.noExercise === true) {
      return { completion: null, state: session.workspaceSetup };
    }
    const setup = await workspaceSetup.start({
      renewal,
      retry,
      runtime,
      session
    });
    const setupChanged = String(setup.state?.updatedAt || "") !==
      String(session.workspaceSetup?.updatedAt || "");
    if (publish && setupChanged && typeof publishSessionChanged.agentTerminal === "function") {
      await publishSessionChanged.agentTerminal(sessionId, {
        reason: "workspace-setup-updated",
        session: await runtime.getSession(sessionId, {
          inspectSource: false
        })
      });
      if (setup.completion) {
        const publishCompleted = async () => {
          await publishSessionChanged.agentTerminal(sessionId, {
            reason: "workspace-setup-completed",
            session: await runtime.getSession(sessionId, {
              inspectSource: false
            })
          });
        };
        void setup.completion.then(() => requestContext
          ? runWithProjectRequestContext(requestContext, publishCompleted)
          : publishCompleted()).catch((error) => {
          vibe64SessionDebugLog("server.terminals.workspaceSetup.publish.error", {
            error: vibe64SessionDebugError(error),
            sessionId
          });
        });
      }
    }
    return setup;
  }

  function projectRuntimeContext() {
    const requestContext = currentProjectRequestContext();
    const projectContextRoot = requestContext?.targetRoot ||
      projectServiceNamespaceRoot(projectService) ||
      "";
    const projectRuntimeRoot = requestContext?.projectRuntimeRoot ||
      (typeof projectService.currentProjectRuntimeRoot === "function"
        ? projectService.currentProjectRuntimeRoot()
        : "");
    const projectSlug = String(requestContext?.slug || "").trim() ||
      String(terminalProjectScopeKey()).replace(/^project:/u, "").trim();
    return {
      projectContextRoot,
      projectRuntimeRoot,
      projectSlug
    };
  }

  async function currentProjectRuntimeOpenState() {
    const context = projectRuntimeContext();
    const runtime = await readProjectRuntimeOpenState({
      projectRuntimeRoot: context.projectRuntimeRoot
    });
    return {
      context,
      runtime
    };
  }

  let knownAgentSessionReset = null;

  async function resetKnownAgentSessionsOnce() {
    if (!knownAgentSessionReset) {
      knownAgentSessionReset = (async () => {
        const runtime = await projectService.createRuntime({
          inspectSource: false
        });
        const listOptions = {
          statusGroup: "all"
        };
        const sessions = typeof runtime?.listSessionSummaries === "function"
          ? await runtime.listSessionSummaries(listOptions)
          : typeof runtime?.listSessions === "function"
            ? await runtime.listSessions(listOptions)
            : [];
        return sessionAgent.unsubscribeSessions(sessions);
      })();
    }
    return knownAgentSessionReset;
  }

  async function resetKnownAgentSessionsBeforeReconcile() {
    const startedAtMs = Date.now();
    try {
      const result = await resetKnownAgentSessionsOnce();
      vibe64SessionDebugLog("server.terminals.agentSession.resetKnown.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        failedCount: Array.isArray(result?.failed) ? result.failed.length : 0,
        ok: result?.ok !== false,
        sessionCount: Number(result?.sessionCount || 0),
        skipped: result?.skipped === true
      });
      return result;
    } catch (error) {
      knownAgentSessionReset = null;
      vibe64SessionDebugLog("server.terminals.agentSession.resetKnown.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error)
      });
      return {
        error: error instanceof Error ? error.message : String(error || "Vibe64 Codex app-server thread reset failed."),
        ok: false
      };
    }
  }

  async function sessionForSourceRepair(session = {}) {
    if (terminalWorktreePath(session)) {
      return session;
    }
    const sessionId = sessionRecordId(session);
    if (!sessionId || typeof projectService.createRuntime !== "function") {
      return session;
    }
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    if (typeof runtime?.getSession !== "function") {
      return session;
    }
    return runtime.getSession(sessionId, {
      inspectSource: false
    });
  }

  async function ensureReconciledSessionSourcesSelfContained(sessions = []) {
    const failed = [];
    for (const sessionEntry of Array.isArray(sessions) ? sessions : []) {
      const sessionId = sessionRecordId(sessionEntry);
      try {
        const session = await sessionForSourceRepair(sessionEntry);
        const workdir = terminalWorktreePath(session);
        if (!workdir || !await directoryExists(workdir)) {
          continue;
        }
        const result = await ensureTerminalSessionSourceGitSelfContained({
          session,
          workdir
        });
        if (result.repaired === true) {
          vibe64SessionDebugLog("server.terminals.codexAppServerThread.sourceGit.repaired", {
            sessionId: sessionRecordId(session) || sessionId,
            sourceRoot: result.sourceRoot
          });
        }
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_session_source_git_repair_failed",
          error: error instanceof Error ? error.message : String(error || "Session source Git repair failed."),
          sessionId
        });
        vibe64SessionDebugLog("server.terminals.codexAppServerThread.sourceGit.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      }
    }
    return failed;
  }

  function reconcileResultWithSourceFailures(result = {}, sourceFailures = []) {
    if (!sourceFailures.length) {
      return result;
    }
    return {
      ...(result || {}),
      failed: [
        ...(Array.isArray(result?.failed) ? result.failed : []),
        ...sourceFailures
      ],
      ok: false
    };
  }

  async function migrateLegacyAssistantSelections(sessions = [], options = {}) {
    const failed = [];
    const migrated = [];
    const legacy = [];
    for (const session of sessions) {
      const sessionId = String(session?.sessionId || session?.id || "").trim();
      if (!String(session?.metadata?.[VIBE64_ASSISTANT_SELECTION_METADATA] || "").trim()) {
        legacy.push(session);
        continue;
      }
      try {
        vibe64AssistantSelectionFromMetadata(session.metadata);
        migrated.push(session);
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_assistant_selection_migration_failed",
          error: error instanceof Error ? error.message : String(error || "Assistant selection is invalid."),
          sessionId
        });
      }
    }
    if (!legacy.length) {
      return { failed, sessions: migrated };
    }
    const capabilitiesResult = await sessionAgent.listCapabilities({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX
    }, options);
    const capabilities = capabilitiesResult.engines?.[0];
    const migrationCapabilities = {
      ...capabilities,
      modelProviders: capabilities.modelProviders.map((provider) => ({
        ...provider,
        connected: true
      }))
    };
    const runtime = await projectService.createRuntime({ inspectSource: false });
    for (const session of legacy) {
      const sessionId = String(session?.sessionId || session?.id || "").trim();
      try {
        const metadata = session.metadata || {};
        const selection = resolveVibe64AssistantSelection(migrationCapabilities, {
          agentId: "codex",
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
          modelProviderId: "openai",
          ...(String(metadata.agent_settings_model || "").trim()
            ? { modelId: String(metadata.agent_settings_model).trim() }
            : {}),
          ...(String(metadata.agent_settings_thinking || "").trim()
            ? { variantId: String(metadata.agent_settings_thinking).trim() }
            : {})
        });
        const serialized = serializeVibe64AssistantSelection(selection);
        await runtime.store.writeMetadataValue(
          sessionId,
          VIBE64_ASSISTANT_SELECTION_METADATA,
          serialized
        );
        migrated.push({
          ...session,
          metadata: {
            ...metadata,
            [VIBE64_ASSISTANT_SELECTION_METADATA]: serialized
          }
        });
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_assistant_selection_migration_failed",
          error: error instanceof Error ? error.message : String(error || "Assistant selection migration failed."),
          sessionId
        });
        migrated.push(session);
      }
    }
    return { failed, sessions: migrated };
  }

  async function reconcileAgentSessions(sessions = [], options = {}) {
    const replacementFailures = [];
    const admittedSessions = sessions.filter((session) => {
      if (String(session?.status || "").trim() === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED || sessionIsClosing(session)) {
        return false;
      }
      try {
        requireCompletedNativeConversationReplacement(session);
        return true;
      } catch (error) {
        replacementFailures.push({ sessionId: session.sessionId, code: error.code, error: error.message });
        return false;
      }
    });
    const migration = await migrateLegacyAssistantSelections(admittedSessions, options);
    const sourceFailures = await ensureReconciledSessionSourcesSelfContained(migration.sessions);
    await resetKnownAgentSessionsBeforeReconcile();
    const temporaryFailures = [];
    for (const session of migration.sessions) {
      try {
        const restored = await sessionConversations.listTemporaryConversations(session.sessionId, options);
        for (const conversation of restored.conversations) {
          if (conversation.state === "closing") {
            await sessionConversations.deleteTemporaryConversation(session.sessionId, { conversationId: conversation.conversationId }, options);
          } else if (conversation.readError) {
            throw new Error(conversation.error);
          }
        }
      } catch (error) {
        temporaryFailures.push({ sessionId: session.sessionId, error: error.message });
      }
    }
    const result = await sessionAgent.reconcileSessions(migration.sessions, options);
    return reconcileResultWithSourceFailures(result, [
      ...replacementFailures,
      ...temporaryFailures,
      ...migration.failed,
      ...sourceFailures
    ]);
  }

  async function closeProjectScopedTerminalNamespaces({
    eventPrefix = "server.terminals.closeProjectRuntime",
    projectScope = terminalProjectScopeKey()
  } = {}) {
    const namespaces = projectScopedTerminalNamespaces(projectScope);
    let closed = 0;
    for (const namespace of namespaces) {
      const result = await closeTerminalSessionsForNamespace(namespace);
      closed += Number(result?.closed || 0);
      vibe64SessionDebugLog(`${eventPrefix}.namespace.done`, {
        closed: Number(result?.closed || 0),
        namespace,
        ok: result?.ok !== false,
        projectScope
      });
    }
    return {
      closed,
      namespaceCount: namespaces.length,
      namespaces,
      ok: true,
      projectScope
    };
  }

  function closeAllSessionTerminals(sessionId, controllerOptions = {}) {
    return closeAgentSessionCommandEnvironment(sessionId, async () => {
      let learningNativeAvailable = false;
      if (controllerOptions.session?.sourceReady === false && controllerOptions.session?.purpose === "learning") {
        const runtime = controllerOptions.runtime || await projectService.createRuntime({ inspectSource: false });
        if (runtime.learningScope) {
          await runtime.getNativeExecutionRoot(sessionId, { allowClosing: true });
          learningNativeAvailable = true;
        }
      }
      return closeTerminalControllersForSession(sessionId, [
        {
          controller: { closeAllForSession: async (id, options) => {
            const agentContext = await assistantSessionOptions(id, options);
            await sessionNaming.closeSession(agentContext);
            await cleanupSessionSaveCommitMessage({ agent: sessionAgent, agentContext });
            return { ok: true };
          } },
          label: "Naming helpers"
        },
        {
          controller: { closeAllForSession: (id, options) => sessionPromptHints.cancelSessionPromptHintsForSession(id, options) },
          label: "Prompt suggestions"
        },
        { controller: { closeAllForSession: (id, options) => databaseToolsProvider?.closeAssistantsForSession(id, options) },
          label: "Database copilot" },
        { controller: { closeAllForSession: (id) => sourceEditorProvider?.closeExplanationsForSession(id) },
          label: "Source explanations" },
        { controller: outputTarget, label: "outputTarget" },
        ...(!controllerOptions.renewalCleanup && (controllerOptions.session?.sourceReady !== false || learningNativeAvailable) ? [{
          controller: { closeAllForSession: (id) => sessionAgent.interruptTurn(id) },
          label: "assistantTurn"
        }] : []),
        {
          controller: {
            closeAllForSession: (id, options) => closeAgentSession(id, options)
          },
          label: "assistant"
        },
        { controller: agentDatabaseCommand, label: "agentDatabase" },
        { controller: agentEnvCommand, label: "agentEnv" },
        { controller: agentPreviewCommand, label: "agentPreview" },
        { controller: agentSessionCommand, label: "agentSessionCommand" }
      ], {
        controllerOptions
      });
    }).finally(() => providerUsage.forget(terminalProjectScopeKey(), sessionId));
  }

  function renewalTerminalAdmissionOwner(renewalId = "") {
    const normalizedRenewalId = String(renewalId || "").trim();
    if (!normalizedRenewalId) {
      throw new TypeError("Terminal renewal admission requires a renewal id.");
    }
    return `session-renewal:${normalizedRenewalId}`;
  }

  function renewalTerminalAdmissionNamespaces(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw new TypeError("Terminal renewal admission requires a session id.");
    }
    return [
      codexTerminalNamespace(normalizedSessionId),
      outputTargetTerminalNamespace(normalizedSessionId)
    ];
  }

  function assertTerminalAdmissionResult(result = {}) {
    if (result?.ok !== false) {
      return result;
    }
    const error = new Error(result.error || "Terminal admission could not be changed.");
    error.code = result.code || "vibe64_session_renewal_terminal_admission_failed";
    throw error;
  }

  async function freezeSessionTerminalAdmissionForRenewal(sessionId = "", options = {}) {
    await sessionPromptHints.cancelSessionPromptHintsForSession(sessionId);
    const namespaces = renewalTerminalAdmissionNamespaces(sessionId);
    const owner = renewalTerminalAdmissionOwner(options.renewalId);
    const frozen = [];
    try {
      for (const namespace of namespaces) {
        assertTerminalAdmissionResult(freezeTerminalNamespaceAdmission(namespace, {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal has frozen terminal input.",
          owner
        }));
        frozen.push(namespace);
      }
    } catch (error) {
      for (const namespace of frozen) {
        thawTerminalNamespaceAdmission(namespace, { owner });
      }
      throw error;
    }
    return {
      frozen: true,
      namespaces,
      ok: true,
      renewalId: String(options.renewalId || "").trim(),
      sessionId: String(sessionId || "").trim()
    };
  }

  function thawSessionTerminalAdmissionForRenewal(sessionId = "", options = {}) {
    const namespaces = renewalTerminalAdmissionNamespaces(sessionId);
    const owner = renewalTerminalAdmissionOwner(options.renewalId);
    for (const namespace of namespaces) {
      assertTerminalAdmissionResult(thawTerminalNamespaceAdmission(namespace, { owner }));
    }
    return {
      frozen: false,
      namespaces,
      ok: true,
      renewalId: String(options.renewalId || "").trim(),
      sessionId: String(sessionId || "").trim()
    };
  }

  function sessionTerminalAdmissionFailure(sessionId = "", kind = "agent") {
    const namespaces = renewalTerminalAdmissionNamespaces(sessionId);
    return terminalNamespaceAdmissionFailure(
      kind === "output" ? namespaces[1] : namespaces[0]
    );
  }

  async function closeProjectRuntimeIfOpenMarkerMissing(eventName = "server.terminals.projectRuntime.markerMissing") {
    const { context, runtime } = await currentProjectRuntimeOpenState();
    if (runtime.open === true) {
      return null;
    }
    const reason = PROJECT_RUNTIME_MARKER_MISSING_REASON;
    vibe64SessionDebugLog(eventName, {
      projectContextRoot: context.projectContextRoot,
      projectSlug: context.projectSlug,
      reason
    });
    const closeResult = await service.closeProjectRuntime({
      reason
    });
    return {
      closeResult,
      context,
      reason,
      runtime: closeResult?.runtime || runtime
    };
  }

  function closedProjectOutputTargetStatus({
    closeResult = null,
    reason = PROJECT_RUNTIME_MARKER_MISSING_REASON,
    runtime = null
  } = {}) {
    return {
      activeTerminal: null,
      closeResult,
      outputTargets: [],
      lastOutputTarget: null,
      ok: closeResult?.ok !== false,
      openTarget: {
        available: false,
        disabledReason: "Project is closed.",
        href: "",
        kind: "url",
        label: "Open browser"
      },
      preview: {
        canRestart: false,
        canShowLog: false,
        canStart: false,
        href: "",
        message: "Project is closed.",
        reason: reason || PROJECT_RUNTIME_MARKER_MISSING_REASON,
        recovery: null,
        state: "project_closed",
        targetHref: "",
        terminalId: ""
      },
      previewTarget: {
        available: false,
        disabledReason: "Project is closed.",
        href: "",
        kind: "url",
        label: "Preview",
        targetHref: ""
      },
      reason,
      runtime
    };
  }

  async function listOpenProjectRuntimeSessions() {
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    const listOptions = {
      statusGroup: "open"
    };
    if (typeof runtime?.listSessions === "function") {
      return runtime.listSessions(listOptions);
    }
    if (typeof runtime?.listSessionSummaries === "function") {
      return runtime.listSessionSummaries(listOptions);
    }
    return [];
  }

  async function closeDormantCurrentProjectRuntime(input = {}) {
    const { context, runtime } = await currentProjectRuntimeOpenState();
    if (runtime.open !== true) {
      return {
        dormant: false,
        ok: true,
        projectSlug: context.projectSlug,
        reason: PROJECT_RUNTIME_MARKER_MISSING_REASON,
        runtime,
        skipped: true,
        projectContextRoot: context.projectContextRoot
      };
    }
    const sessions = await listOpenProjectRuntimeSessions();
    const dormancy = projectRuntimeDormancyState({
      idleAfterMs: input.idleAfterMs,
      nowMs: input.nowMs,
      runtime,
      sessions
    });
    if (!dormancy.dormant) {
      return {
        dormancy,
        dormant: false,
        ok: true,
        projectSlug: context.projectSlug,
        reason: dormancy.activeAgentSessionIds.length ? "active-agent-run" : "not-dormant",
        runtime,
        skipped: true,
        projectContextRoot: context.projectContextRoot
      };
    }
    for (const session of sessions) {
      const temporary = await sessionAgent.hasActiveTemporaryConversation(session.sessionId, {}, { session });
      if (temporary.active) {
        return {
          dormancy,
          dormant: false,
          ok: true,
          skipped: true,
          reason: "active-temporary-conversation",
          runtime,
          projectSlug: context.projectSlug,
          projectContextRoot: context.projectContextRoot
        };
      }
    }
    vibe64SessionDebugLog("server.terminals.projectRuntime.dormantClose.start", {
      idleMs: dormancy.idleMs,
      lastActivityAt: dormancy.lastActivityAt,
      projectContextRoot: context.projectContextRoot,
      projectSlug: context.projectSlug,
    });
    const closeResult = await service.closeProjectRuntime({
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON
    });
    return {
      closeResult,
      dormancy,
      dormant: true,
      ok: closeResult?.ok !== false,
      projectSlug: context.projectSlug,
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON,
      runtime: closeResult?.runtime || runtime,
      skipped: false,
      projectContextRoot: context.projectContextRoot
    };
  }

  function openProjectRuntimeRecords(listed = {}) {
    const entries = [
      ...(Array.isArray(listed?.projects) ? listed.projects : []),
      listed?.currentProject
    ].filter((project) => project?.runtime?.open === true);
    const seenSlugs = new Set();
    return entries.filter((project) => {
      const slug = project?.slug;
      if (!slug || seenSlugs.has(slug)) {
        return false;
      }
      seenSlugs.add(slug);
      return true;
    });
  }

  async function closeDormantListedProjectRuntime(project = {}, input = {}) {
    if (typeof projectService.runInProjectContext !== "function") {
      throw new TypeError("Vibe64 project service must own project request-context resolution.");
    }
    return projectService.runInProjectContext(
      project.slug,
      () => closeDormantCurrentProjectRuntime(input)
    );
  }

  async function sessionWorkExecution(sessionId, input = {}, reason = "session-work") {
    const normalizedSessionId = String(sessionId || "").trim();
    const runtime = input.runtime || await projectService.createRuntime({ inspectSource: false });
    let session = input.session?.sessionId === normalizedSessionId
      ? input.session
      : await runtime.getSession(normalizedSessionId, { inspectSource: false });
    let execution = await codexGitCommand.sessionWorkSaveContext({
      session,
      sessionId: normalizedSessionId
    });
    if (execution?.ok === false) {
      const sessionSourceRoot = terminalSessionSourceRoot(session);
      const workdir = terminalWorktreePath(session);
      const recorded = sessionSourceRoot && workdir
        ? await writeSessionGitCommandActor({
            env,
            reason,
            runtime,
            session,
            sourceRoot: sessionSourceRoot,
            threadId: session.metadata?.agent_identity_conversation_id || "",
            vibe64User: input.vibe64User,
            workdir
          })
        : null;
      if (recorded?.ok !== false && recorded) {
        session = recorded.session || await runtime.getSession(normalizedSessionId, { inspectSource: false });
        execution = await codexGitCommand.sessionWorkSaveContext({
          session,
          sessionId: normalizedSessionId
        });
      }
    }
    if (execution?.ok === false) {
      const error = new Error(execution.error || "The Git actor for this repository operation is not available.");
      error.code = execution.code || "vibe64_session_work_actor_unavailable";
      throw error;
    }
    return { execution, normalizedSessionId, runtime, session };
  }

  sessionConversations = createSessionConversations({
    actions,
    conversationRuntime: mainConversations,
    systemRoot: codexProviderOptions.systemRoot,
    prepareSelection: (sessionId, selection, context) => sessionAgent.prepareSelection(sessionId, selection, context),
    sessionAgent,
    attachments: sessionAttachments,
    runAgentWrite: runMainAgentWrite,
    prepareAgentSkills: prepareAgentSkillsInsideAgentWrite,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event)
  });
  const service = {
    ...sessionConversations,
    configureAssistantRuntime(input = {}) {
      for (const name of [
        "claudeConnectionStatus",
        "codexConnectionStatus",
        "listConnections",
        "readAssistantAccess",
        "resolveAssistantUser",
        "resolveConnection",
        "updateModelAccess"
      ]) {
        if (Object.hasOwn(input, name)) {
          if (typeof input[name] !== "function") {
            throw new TypeError(`Assistant runtime ${name} must be a function.`);
          }
          assistantRuntime[name] = input[name];
        }
      }
      return { configured: true, ok: true };
    },

    async createSessionSource(input = {}) {
      if (typeof projectService.runProjectSourceExclusive !== "function") {
        const error = new Error("Session source creation requires the project source mutation lock.");
        error.code = "vibe64_project_source_lock_unavailable";
        throw error;
      }
      return projectService.runProjectSourceExclusive(async () => {
        const source = await createManagedSessionSource({
          ...input,
          env,
          project: await projectService.readCurrentProject()
        });
        if (input.session?.metadata?.github_pull_request) {
          const session = input.session.metadata.renewed_from
            ? await input.store.readSessionForRenewal(input.session.sessionId)
            : await input.store.readSession(input.session.sessionId);
          const recorded = await writeSessionGitCommandActor({
            env,
            reason: "pull-request-session",
            runtime: input.runtime,
            session,
            sourceRoot: source.sourcePath,
            workdir: source.sourcePath,
            threadId: "",
            vibe64User: input.vibe64User || null
          });
          if (recorded?.ok === false) {
            throw new Error(recorded.error || "Your GitHub identity is unavailable.");
          }
        }
        return source;
      }, { operation: "session-source-create" });
    },

    setSourceEditorProvider(provider = null) {
      sourceEditorProvider = provider;
    },

    setDatabaseToolsProvider(provider = null) {
      databaseToolsProvider = provider;
      agentDatabaseCommand.setDatabaseToolsProvider(provider);
    },

    setProductionEnvironmentProvider(provider = null) {
      agentEnvCommand.setProductionEnvironmentProvider(provider);
    },

    prepareWorkspaceSetup(sessionId, options = {}) {
      return prepareWorkspaceSetup(sessionId, options);
    },

    prepareRenewalWorkspaceSetup(sessionId, options = {}) {
      return prepareRenewalWorkspaceSetup(sessionId, options);
    },

    workspaceSetupIsRunning(sessionId = "") {
      return workspaceSetup.isRunning(sessionId);
    },

    async workspaceSetupIsPrepared(sessionId = "") {
      const normalizedSessionId = assertValidVibe64SessionId(sessionId);
      const runtime = await projectService.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(normalizedSessionId, { inspectSource: false });
      return workspaceSetup.isPrepared({ runtime, session });
    },

    waitForWorkspaceSetup(sessionId = "") {
      return workspaceSetup.wait(sessionId);
    },

    async close() {
      closing = true;
      await Promise.allSettled(turnCompletions);
      const [agentClose, outputTargetClose] = await Promise.allSettled([
        Promise.resolve().then(() => service.invalidateAgentRuntimes({
          reason: "server-shutdown"
        })),
        Promise.resolve().then(() => outputTarget.close())
      ]);
      const failures = [];
      const agentResult = agentClose.status === "fulfilled"
        ? agentClose.value
        : null;
      if (agentClose.status === "rejected") {
        failures.push(agentClose.reason);
      } else if (agentResult?.ok === false) {
        const error = new Error("Assistant runtime shutdown did not complete successfully.");
        error.code = "vibe64_agent_runtime_shutdown_failed";
        error.details = agentResult;
        failures.push(error);
      }
      if (outputTargetClose.status === "rejected") {
        failures.push(outputTargetClose.reason);
      }
      try {
        await projectServices.closeAll();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Vibe64 terminal shutdown did not complete successfully.");
      }
      return {
        agentResult,
        ok: true
      };
    },

    async openProjectRuntime(input = {}) {
      const context = projectRuntimeContext();
      const reason = String(input?.reason || "project-open").trim() || "project-open";
      projectServices.opened(context);
      const key = context.projectRuntimeRoot;
      const previous = projectRuntimeOpenOperations.get(key) || Promise.resolve();
      // Tabs share a runtime. Serialize opens so they observe one transition,
      // while every visit still refreshes the dormant-runtime grace period.
      const operation = previous.catch(() => {}).then(async () => {
        const previousRuntime = await readProjectRuntimeOpenState({ projectRuntimeRoot: key });
        const runtime = await writeProjectRuntimeOpenState({
          projectRuntimeRoot: key,
          projectSlug: context.projectSlug,
          reason
        });
        const result = {
          ok: true,
          projectContextRoot: context.projectContextRoot,
          projectSlug: context.projectSlug,
          reason,
          runtime
        };
        if (!previousRuntime.open) {
          await publishProjectRuntimeChanged(result, { action: "runtime-opened" });
        }
        return result;
      });
      projectRuntimeOpenOperations.set(key, operation);
      try {
        return await operation;
      } finally {
        if (projectRuntimeOpenOperations.get(key) === operation) {
          projectRuntimeOpenOperations.delete(key);
        }
      }
    },

    closeDormantProjectRuntime(input = {}) {
      return closeDormantCurrentProjectRuntime(input);
    },

    async closeDormantProjectRuntimes(input = {}) {
      if (typeof projectService.listProjects !== "function") {
        const result = await closeDormantCurrentProjectRuntime(input);
        return {
          closedCount: result.dormant ? 1 : 0,
          failed: result.ok === false ? [result] : [],
          ok: result.ok !== false,
          projectCount: 1,
          results: [result]
        };
      }
      const listed = await projectService.listProjects();
      if (listed?.ok === false) {
        return {
          closedCount: 0,
          error: listed.error || "Vibe64 projects could not be listed for dormant runtime cleanup.",
          failed: [listed],
          ok: false,
          projectCount: 0,
          results: []
        };
      }
      const projects = openProjectRuntimeRecords(listed);
      const results = [];
      for (const project of projects) {
        try {
          results.push(await closeDormantListedProjectRuntime(project, input));
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
            ok: false,
            projectContextRoot: String(project.projectContextRoot || project.projectRoot || "").trim(),
            projectSlug: project.slug
          });
        }
      }
      const failed = results.filter((result) => result?.ok === false);
      return {
        closedCount: results.filter((result) => result?.dormant === true && result?.ok !== false).length,
        failed,
        ok: failed.length === 0,
        projectCount: projects.length,
        results
      };
    },

    async closeSessionTerminals(sessionId, options = {}) {
      return closeAllSessionTerminals(sessionId, options);
    },

    freezeSessionTerminalAdmissionForRenewal(sessionId, options = {}) {
      return freezeSessionTerminalAdmissionForRenewal(sessionId, options);
    },

    async closeRenewalPredecessorSessionTerminals(session, options = {}) {
      const context = renewalPredecessorTerminalCleanupContext(session, options);
      return closeAllSessionTerminals(context.sessionId, context);
    },

    async closeRenewalSuccessorSessionTerminals(session, options = {}) {
      const context = renewalSuccessorTerminalCleanupContext(session, options);
      return closeAllSessionTerminals(context.sessionId, context);
    },

    async releaseRenewalPredecessorAttachments(session, options = {}) {
      const sessionId = String(session?.sessionId || "").trim();
      return sessionAgent.releaseRenewalPredecessorAttachments(
        sessionId,
        {
          renewalId: String(options.renewalId || "").trim()
        },
        {
          runtime: options.runtime || null,
          session
        }
      );
    },

    async releaseRenewalPredecessorProcessExitProof(session, options = {}) {
      const sessionId = String(session?.sessionId || "").trim();
      return sessionAgent.releaseRenewalPredecessorProcessExitProof(
        sessionId,
        {
          renewalId: String(options.renewalId || "").trim()
        },
        {
          runtime: options.runtime || null,
          session
        }
      );
    },

    async releaseRenewalSuccessorProcessExitProof(session, options = {}) {
      const sessionId = String(session?.sessionId || "").trim();
      return sessionAgent.releaseRenewalSuccessorProcessExitProof(
        sessionId,
        {
          authorization: options.authorization || null,
          renewalId: String(options.renewalId || "").trim()
        },
        {
          runtime: options.runtime || null,
          session
        }
      );
    },

    async closeSessionNonAgentTerminals(sessionId) {
      return closeTerminalControllersForSession(sessionId, [
        { controller: outputTarget, label: "outputTarget" }
      ], {
        eventPrefix: "server.terminals.closeSessionNonAgentTerminals"
      });
    },

    thawSessionTerminalAdmissionForRenewal(sessionId, options = {}) {
      return thawSessionTerminalAdmissionForRenewal(sessionId, options);
    },

    async recordSessionGitCommandActor(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedSessionId) {
        return {
          ok: false,
          error: "Session id is required to record the Git command actor."
        };
      }
      const runtime = input.runtime || await projectService.createRuntime({
        inspectSource: false
      });
      const session = input.session?.sessionId === normalizedSessionId
        ? input.session
        : await runtime.getSession(normalizedSessionId, {
            inspectSource: false
          });
      const sessionSourceRoot = terminalSessionSourceRoot(session);
      if (!sessionSourceRoot) {
        return {
          code: "vibe64_session_git_command_actor_source_root_missing",
          error: "Vibe64 session source root is not available for Git command actor tracking.",
          ok: false
        };
      }
      const workdir = terminalWorktreePath(session);
      return writeSessionGitCommandActor({
        env,
        reason: input.reason || "session-interaction",
        runtime,
        session,
        sourceRoot: sessionSourceRoot,
        threadId: session.metadata?.agent_identity_conversation_id || "",
        vibe64User: input.vibe64User || null,
        workdir
      });
    },

    async saveSessionWork(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, {
        operation: "save-session-work",
        activeCode: "vibe64_session_save_agent_active",
        activeMessage: "Wait for the assistant turn to finish before saving this work."
      }, (context) => saveSessionWorkInsideWrite(sessionId, input, context));
    },

    // Internal server facility: callbacks are never accepted by an action or
    // model. Snapshot validation/installation remains with its content owner.
    async runSessionSourceReadExclusive(sessionId, operation) {
      const id = assertValidVibe64SessionId(sessionId);
      if (typeof operation !== "function") {
        throw new TypeError("Exclusive session source reads require an internal operation.");
      }
      if (typeof projectService.runProjectSourceExclusive !== "function") {
        throw Object.assign(new Error("Session source reads require the project source mutation lock."), {
          code: "vibe64_project_source_lock_unavailable"
        });
      }
      return runSessionRepositoryWrite(id, {}, {
        operation: "read-session-source",
        activeCode: "vibe64_session_source_read_agent_active",
        activeMessage: "Wait for the assistant turn to finish before reading its committed source snapshot."
      }, async (context) => {
        if (closing || context.session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(context.session)) {
          throw Object.assign(new Error("Committed source reads require an open session that is not closing or renewing."), {
            code: "vibe64_session_source_read_unavailable", statusCode: 409
          });
        }
        if (workspaceSetup.isRunning(id) || context.session.workspaceSetup?.status === "running") {
          throw Object.assign(new Error("Workspace setup must finish before reading this session's committed source snapshot."), {
            code: "vibe64_session_source_read_setup_running", statusCode: 409, retryable: true
          });
        }
        requireCompletedConversationRewind(context.session);
        await service.assertSessionRenewalIdle(id, context);
        // Repository admission owns the session lease. Save takes this same
        // project lock downstream; acquiring it here preserves that order.
        return projectService.runProjectSourceExclusive(async () => {
          const session = await context.runtime.getSession(id, { inspectSource: false });
          const sourceRoot = terminalSessionSourceRoot(session);
          if (session.sessionId !== id || !sourceRoot) {
            throw Object.assign(new Error("This exact session has no available managed source."), {
              code: "vibe64_session_source_root_missing", statusCode: 409
            });
          }
          return operation({ runtime: context.runtime, session, sourceRoot });
        }, { operation: "read-session-source" });
      });
    },

    async createSessionPullRequest(sessionId, input = {}) {
      if (
        typeof input.title !== "string" || !input.title.trim() || input.title.length > 256 ||
        (input.body != null && (typeof input.body !== "string" || input.body.length > 65536)) ||
        (input.draft != null && typeof input.draft !== "boolean")
      ) {
        throw new Error("Enter a pull request title and a description of up to 65,536 characters.");
      }
      return runSessionRepositoryWrite(sessionId, input, { operation: "create-pull-request" }, async (context) => {
        const { runtime } = context;
        let session = context.session;
        const project = await projectService.readCurrentProject();
        assertSessionRepositoryReview(project, session, input.destinationReview);
        let source = session.metadata?.github_pull_request
          ? JSON.parse(session.metadata.github_pull_request)
          : await projectService.preparePullRequestSource(session, input);
        if (source.number) {
          return { ok: true, pullRequest: source };
        }

        // Bind before any remote write: an interrupted attempt must never send a later Save to main.
        await runtime.store.mutateSession(sessionId, async () => {
          await runtime.store.writeMetadataValue(sessionId, "github_pull_request", JSON.stringify(source));
          await runtime.store.writeMetadataValue(sessionId, "source_remote_url", `https://github.com/${source.headRepository}.git`);
          await runtime.store.writeMetadataValue(sessionId, "repository_mode", "github");
          await runtime.store.writeMetadataValue(sessionId, "repository_update_check", "");
        });
        session = await runtime.getSession(sessionId, { inspectSource: false });
        const recorded = await writeSessionGitCommandActor({
          env,
          reason: "create-pull-request",
          runtime,
          session,
          sourceRoot: terminalSessionSourceRoot(session),
          workdir: terminalWorktreePath(session),
          threadId: session.metadata?.agent_identity_conversation_id || "",
          vibe64User: input.vibe64User || null
        });
        if (recorded?.ok === false) {
          throw new Error(recorded.error || "Your GitHub identity is unavailable.");
        }
        session = recorded?.session || await runtime.getSession(sessionId, { inspectSource: false });
        const { execution } = await sessionWorkExecution(sessionId, { ...context, session }, "create-pull-request");
        await prepareSessionPullRequestBranch({
          project: await projectService.readCurrentProject(),
          session,
          commandOptions: execution.commandOptions,
          runCommand: execution.runCommand
        });

        const saved = await saveSessionWorkInsideWrite(sessionId, {
          ...input,
          destinationReview: sessionRepositoryDestination(project, session)
        }, { ...context, session, creatingPullRequest: true });
        await runtime.store.writeMetadataValue(sessionId, "canonical_commit", saved.saveCommit);
        if (saved.reconciled === true) {
          await runtime.store.writeMetadataValue(sessionId, "base_commit", saved.saveCommit);
        }
        await runtime.store.writeMetadataValue(sessionId, "base_branch", source.headBranch);
        await runtime.store.writeMetadataValue(sessionId, "source_default_branch", source.headBranch);

        source = await projectService.publishSessionPullRequest(source, input);
        await runtime.store.writeMetadataValue(sessionId, "github_pull_request", JSON.stringify(source));
        return { ok: true, pullRequest: source, saveCommit: saved.saveCommit };
      });
    },

    async checkSessionUpdates(sessionId, input = {}) {
      // This refreshes canonical authority under the project source lock but
      // never changes the session worktree. Periodic checks must not occupy
      // assistant-write admission and reject a foreground chat message.
      const { execution, session } = await sessionWorkExecution(
        sessionId,
        input,
        "session-update-check"
      );
      return checkManagedSessionUpdates({
        commandOptions: execution.commandOptions,
        operationId: input.operationId,
        project: await projectService.readCurrentProject(),
        runCommand: execution.runCommand,
        runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
        session
      });
    },

    async updateSessionWork(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, {
        operation: "update-session-work",
        activeCode: "vibe64_session_update_agent_active",
        activeMessage: "Wait for the assistant turn to finish before updating this session."
      }, async (context) => {
        const { execution, session } = await sessionWorkExecution(sessionId, context, "session-update");
        return updateManagedSessionWork({
          beforeSourceChange: () => invalidateWorkspaceSetup(context),
          commandOptions: execution.commandOptions,
          historyReview: input.historyReview,
          conflictRecovery: input.conflictRecovery,
          reviewedConflictId: input.reviewedConflictId,
          identity: execution.identity,
          onProgress: input.onProgress,
          operationId: input.operationId,
          project: await projectService.readCurrentProject(),
          derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
          runCommand: execution.runCommand,
          runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
          session
        });
      });
    },

    async recoverSessionWorkUpdate(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-update" }, async (context) => {
        const { execution, session } = await sessionWorkExecution(
          sessionId,
          context,
          "session-update-recovery"
        );
        return recoverManagedSessionWorkUpdate({
          beforeSourceChange: () => invalidateWorkspaceSetup(context),
          commandOptions: execution.commandOptions,
          project: await projectService.readCurrentProject(),
          recovery: input.recovery || {},
          runCommand: execution.runCommand,
          runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
          session
        });
      });
    },

    async recoverSessionWorkSave(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-save" }, async (context) => {
        const normalizedSessionId = String(sessionId || "").trim();
        const { session } = context;
        const execution = await codexGitCommand.sessionWorkSaveContext({
          session,
          sessionId: normalizedSessionId
        });
        if (execution?.ok === false) {
          const error = new Error(execution.error || "The Git actor for Save recovery is not available.");
          error.code = execution.code || "vibe64_session_save_actor_unavailable";
          throw error;
        }
        return recoverManagedSessionWorkSave({
          commandOptions: execution.commandOptions,
          project: await projectService.readCurrentProject(),
          recovery: input.recovery || {},
          runCommand: execution.runCommand,
          runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
          session
        });
      });
    },

    async inspectSessionWork(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      const runtime = input.runtime || await projectService.createRuntime({
        inspectSource: false
      });
      const session = input.session?.sessionId === normalizedSessionId
        ? input.session
        : await runtime.getSession(normalizedSessionId, {
            inspectSource: false
          });
      const work = await inspectManagedSessionWork({
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        project: await projectService.readCurrentProject(),
        session
      });
      return {
        ...work,
        publicationRequiresPullRequest: work.destination?.mode === "github" &&
          (await projectService.readRepositoryWorkflow()).requirePullRequest
      };
    },

    async inspectSessionChanges(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      const runtime = input.runtime || await projectService.createRuntime({
        inspectSource: false
      });
      const session = input.session?.sessionId === normalizedSessionId
        ? input.session
        : await runtime.getSession(normalizedSessionId, {
            inspectSource: false
          });
      const work = await inspectManagedSessionChanges({
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        limit: input.limit,
        offset: input.offset,
        project: await projectService.readCurrentProject(),
        session
      });
      return {
        ...work,
        publicationRequiresPullRequest: work.destination?.mode === "github" &&
          (await projectService.readRepositoryWorkflow()).requirePullRequest
      };
    },

    async inspectSessionChangeDiff(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      const runtime = input.runtime || await projectService.createRuntime({
        inspectSource: false
      });
      const session = input.session?.sessionId === normalizedSessionId
        ? input.session
        : await runtime.getSession(normalizedSessionId, {
            inspectSource: false
          });
      return inspectManagedSessionChangeDiff({
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        lineLimit: input.lineLimit,
        path: input.path,
        project: await projectService.readCurrentProject(),
        session
      });
    },

    async inspectRepositoryHistory(input = {}) {
      return inspectManagedRepositoryHistory({
        cursor: input.cursor,
        limit: input.limit,
        project: await projectService.readCurrentProject(),
        session: input.session || null
      });
    },

    async inspectRepositoryVersionFiles(input = {}) {
      return inspectManagedRepositoryVersionFiles({
        commit: input.commit,
        historySnapshotCommit: input.historySnapshotCommit,
        limit: input.limit,
        offset: input.offset,
        project: await projectService.readCurrentProject(),
        session: input.session || null
      });
    },

    async inspectRepositoryVersionFileDiff(input = {}) {
      return inspectManagedRepositoryVersionFileDiff({
        commit: input.commit,
        historySnapshotCommit: input.historySnapshotCommit,
        lineLimit: input.lineLimit,
        path: input.path,
        project: await projectService.readCurrentProject(),
        session: input.session || null
      });
    },

    async closeProjectRuntime(input = {}) {
      const startedAtMs = Date.now();
      const context = projectRuntimeContext();
      const projectScope = context.projectSlug ? `project:${context.projectSlug}` : terminalProjectScopeKey();
      const projectContextRoot = context.projectContextRoot;
      const reason = String(input?.reason || "project-close").trim() || "project-close";
      projectServices.beginClose(context);
      const failed = [];
      let agentProviderRuntimesStopped = 0;
      let projectCwdTerminalClosed = 0;
      let projectCwdNamespaceCount = 0;
      let projectNamespaceCount = 0;
      let projectTerminalClosed = 0;
      let sessionCount = 0;
      let sessionTerminalClosed = 0;
      vibe64SessionDebugLog("server.terminals.closeProjectRuntime.start", {
        projectScope,
        reason
      });
      try {
        let sessionIds = [];
        try {
          const sessions = await listOpenProjectRuntimeSessions();
          sessionIds = (Array.isArray(sessions) ? sessions : [])
            .map((session) => String(session?.sessionId || session?.id || "").trim())
            .filter(Boolean);
          sessionCount = sessionIds.length;
        } catch (error) {
          failed.push({
            controller: "sessions",
            error: error instanceof Error ? error.message : String(error || "Project sessions could not be listed."),
            operation: "list-project-sessions"
          });
          vibe64SessionDebugLog("server.terminals.closeProjectRuntime.sessions.error", {
            error: vibe64SessionDebugError(error),
            projectScope,
            reason
          });
        }
        for (const sessionId of sessionIds) {
          try {
            const result = await closeAllSessionTerminals(sessionId, {
              preserveProcessExitProof: true
            });
            sessionTerminalClosed += Number(result?.closed || 0);
          } catch (error) {
            failed.push({
              error: error instanceof Error ? error.message : String(error || "Session runtime close failed."),
              sessionId
            });
          }
        }

        const agentResult = await sessionAgent.closeProject({
          preserveProcessExitProof: true,
          projectContextRoot,
          reason
        });
        agentProviderRuntimesStopped = Number(agentResult?.stopped || 0);
        for (const error of Array.isArray(agentResult?.failed) ? agentResult.failed : []) {
          failed.push({
            ...error,
            controller: "assistant-provider"
          });
        }

        const namespaceResult = await closeProjectScopedTerminalNamespaces({
          projectScope
        });
        projectNamespaceCount = Number(namespaceResult.namespaceCount || 0);
        projectTerminalClosed = Number(namespaceResult.closed || 0);
        const cwdResult = await closeTerminalSessionsForCwdRoot(
          projectContextRoot
        );
        projectCwdTerminalClosed = Number(cwdResult.closed || 0);
        projectCwdNamespaceCount = Number(cwdResult.namespaceCount || 0);
        try {
          await projectServices.close(context);
        } catch (error) {
          failed.push({ controller: "project-services", error: error.message });
        }
        const result = {
          agentProviderRuntimesStopped,
          failed,
          ok: failed.length === 0,
          projectCwdNamespaceCount,
          projectCwdTerminalClosed,
          projectContextRoot,
          projectNamespaceCount,
          projectSlug: context.projectSlug,
          projectScope,
          projectTerminalClosed,
          reason,
          sessionCount,
          sessionTerminalClosed
        };
        if (result.ok === true) {
          const runtime = await clearProjectRuntimeOpenState({
            projectRuntimeRoot: context.projectRuntimeRoot
          });
          result.runtime = runtime;
        }
        await publishProjectRuntimeChanged(result, {
          action: "runtime-closed"
        });
        vibe64SessionDebugLog("server.terminals.closeProjectRuntime.done", {
          ...result,
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          failedCount: failed.length
        });
        return result;
      } catch (error) {
        vibe64SessionDebugLog("server.terminals.closeProjectRuntime.error", {
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          error: vibe64SessionDebugError(error),
          projectScope,
          reason
        });
        throw error;
      }
    },

    async closeAgentTerminal(sessionId, terminalSessionId, options = {}) {
      const result = await sessionAgent.closeTerminal(sessionId, {
        terminalSessionId
      }, options);
      await publishTerminalSessionChanged("agentTerminalClosed", sessionId, "agent-terminal-closed");
      return result;
    },

    closeGlobalCodexTerminal(terminalSessionId) {
      return codex.terminals.closeGlobalTerminal(terminalSessionId);
    },

    async closeOutputTargetTerminal(sessionId, terminalSessionId) {
      const result = await outputTarget.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("outputTargetClosed", sessionId, "output-target-closed");
      return result;
    },

    async listAgentConversationStorage(sessionId, options = {}) {
      const runtime = options.runtime || await projectService.createRuntime({ inspectSource: false });
      const session = await runtime.store.readSession(sessionId);
      if (session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
        return runtime.store.withArchivedSession(sessionId, (archived) => nativeConversationBindings(archived));
      }
      return runMainAgentWrite(sessionId, { ...options, runtime }, ({ session }) =>
        nativeConversationBindings(session, { retiredOnly: true }), { operation: "inspect-native-storage" });
    },

    async scanAgentConversationStorage(sessionId, options = {}) {
      const runtime = options.runtime || await projectService.createRuntime({ inspectSource: false });
      const session = options.session || await runtime.store.readSession(sessionId);
      const bindings = nativeConversationBindings(session);
      const scopes = new Map();
      for (const binding of bindings) {
        if (!path.isAbsolute(binding.workdir || "")) throw new Error("Native storage ownership has no saved absolute directory.");
        const scope = { engineId: binding.engineId, modelProviderId: binding.modelProviderId || "", workdir: binding.workdir };
        scopes.set(JSON.stringify(scope), scope);
      }
      const conversations = [];
      for (const scope of scopes.values()) {
        const rows = await sessionAgent.listNativeConversationStorage(sessionId, scope, { ...options, runtime, session });
        for (const row of rows) {
          const tracked = bindings.some((binding) => binding.engineId === row.engineId &&
            binding.conversationId === row.conversationId);
          conversations.push({ ...row, tracked, discoveredIn: scope });
        }
      }
      return { scopes: [...scopes.values()], conversations };
    },

    async retireAgentConversationHistory(sessionId, input = {}, options = {}) {
      if (typeof options.beforeDelete !== "function") throw new TypeError("Native retirement requires a host preservation callback.");
      const runtime = options.runtime || await projectService.createRuntime({ inspectSource: false });
      const retire = async (session, archived, publishArtifacts) => {
        if (!archived && (session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(session) ||
            sessionHasActiveAgentRun(session) || workspaceSetup.isRunning(sessionId))) {
          throw new Error("Native history retirement requires an idle open session or a finalized archive.");
        }
        const bindings = nativeConversationBindings(session, { retiredOnly: !archived });
        let binding = bindings.find((binding) =>
          binding.engineId === input.engineId && binding.conversationId === input.conversationId);
        // Native /new and forks may have no Vibe64 binding. Only a finalized
        // archive can nominate an additional native id in an exact saved scope.
        // The provider re-reads its real directory; the host must still prove
        // exclusivity against every live project/session and preserve its text.
        if (!binding && archived && input.discoveredIn) {
          const scope = bindings.find((entry) => entry.engineId === input.engineId &&
            entry.engineId === input.discoveredIn.engineId && entry.workdir === input.discoveredIn.workdir &&
            (entry.modelProviderId || "") === input.discoveredIn.modelProviderId);
          if (scope) binding = { ...scope, conversationId: input.conversationId, discovered: true };
        }
        if (!binding) throw new Error("The requested native conversation is not an archived binding or accepted predecessor.");
        const currentBindings = archived ? [] : nativeConversationBindings(session).filter((entry) => !entry.retired);
        const currentIds = new Set(currentBindings.map((entry) => entry.conversationId));
        const result = await sessionAgent.retireConversationHistory(sessionId, binding, {
          ...options, runtime, session,
          beforeDelete: async (inventory) => {
            if (inventory.conversations.some((entry) => currentIds.has(entry.conversationId))) {
              throw new Error("Native deletion would include a current Vibe64 conversation.");
            }
            return options.beforeDelete({ ...inventory, session, archived, ...(publishArtifacts ? { publishArtifacts } : {}) });
          }
        });
        if (!archived && result?.ok === true) {
          const state = JSON.parse(await runtime.store.readMetadataValue(sessionId, "assistant_changeover"));
          state.retiredConversations = state.retiredConversations.filter((entry) =>
            entry.conversationId !== binding.conversationId || entry.assistantSelection.engineId !== binding.engineId);
          await runtime.store.writeMetadataValue(sessionId, "assistant_changeover", JSON.stringify(state));
        }
        return result;
      };
      const session = await runtime.store.readSession(sessionId);
      if (session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
        return runtime.store.withArchivedSession(sessionId, (archived, { publishArtifacts }) => retire(archived, true, publishArtifacts), {
          beforeWork: options.beforeArchiveWork
        });
      }
      return runMainAgentWrite(sessionId, { ...options, runtime }, ({ session }) => retire(session, false),
        { operation: "retire-native-history" });
    },

    replaceAgentConversation(sessionId, input = {}, options = {}) {
      return runMainAgentWrite(sessionId, options, async (context) => {
        const fail = (message) => { throw Object.assign(new Error(message), {
          code: "vibe64_conversation_replacement_unavailable", statusCode: 409
        }); };
        if (context.session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(context.session) ||
            sessionHasActiveAgentRun(context.session) || workspaceSetup.isRunning(sessionId)) {
          fail("Native context can be replaced only in an idle, open session.");
        }
        await sessionAgent.requireAssistantAccess(sessionId, context);
        const conversations = await context.runtime.store.listSessionConversations(sessionId);
        for (const metadata of [context.session.metadata, ...conversations.map((record) => record.routingMetadata || {})]) {
          const routing = JSON.parse(metadata.assistant_routing_request || "null");
          if (assistantRoutingStatusIsPending(routing?.status) || routing?.helper) fail("Finish pending routing and helper cleanup first.");
        }
        const saved = JSON.parse(context.session.metadata.assistant_changeover || "null");
        if (saved?.replacement?.status !== "preparing") {
          requireCompletedConversationRewind(context.session);
          const goal = await sessionAgent.readGoal(sessionId, context);
          if (!["available", "unsupported"].includes(goal?.status) ||
              goal?.goal && !["complete", "completed", "cancelled"].includes(goal.goal.status)) {
            fail("Finish the native goal before replacing its conversation.");
          }
          const pinnedGoal = JSON.parse(context.session.metadata.assistant_routing_goal || "null");
          if (pinnedGoal && !["complete", "completed", "cancelled"].includes(pinnedGoal.status)) fail("Finish the routed goal first.");
          const native = await sessionAgent.sessionState(sessionId, context);
          if (native?.ok === false || native?.turn?.active || native?.terminal?.status === "running") {
            fail("Stop native work and close its terminal before replacing context.");
          }
          const temporary = await sessionAgent.hasActiveTemporaryConversation(sessionId, {}, context);
          if (temporary?.ok === false || temporary?.active) fail("Finish temporary assistant work before replacing native context.");
        }
        const conversation = ["codex", "claude", "opencode"].includes(vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId)
          ? await mainConversations.open({ id: sessionId, context: { ...context, sessionId }, representation: "native" }) : null;
        const result = await replaceNativeConversation(sessionId, input, context, sessionAgent, conversation);
        await publishAgentSessionChanged(sessionId, { reason: "native-conversation-replaced" });
        return result;
      }, { operation: "replace-agent-conversation" });
    },

    createEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.createEphemeralConversation(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    resolveEphemeralAgentExecutionProfile(scope = {}, input = {}, options = {}) {
      return sessionAgent.resolveEphemeralExecutionProfile(scope, input, options);
    },

    runEphemeralAgentChatTurn(scope = {}, input = {}, options = {}) {
      return sessionAgent.runEphemeralChatTurn(scope, input, options);
    },

    deleteEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.deleteEphemeralConversation(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    async runDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
      assertProjectEffectAdmission();
      if (input.executionProfile) {
        return sessionAgent.runDetachedChatTurn(
          sessionId,
          input,
          await assistantSessionOptions(sessionId, options)
        );
      }
      return runMainAgentWrite(sessionId, options, (context) => (
        sessionAgent.runDetachedChatTurn(sessionId, input, context)
      ), { operation: "run-temporary-chat" });
    },

    async streamDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
      assertProjectEffectAdmission();
      if (input.executionProfile) {
        return sessionAgent.streamDetachedChatTurn(
          sessionId,
          input,
          await assistantSessionOptions(sessionId, options)
        );
      }
      return runMainAgentWrite(sessionId, options, (context) => (
        sessionAgent.streamDetachedChatTurn(sessionId, input, context)
      ), { operation: "stream-temporary-chat" });
    },

    deleteDetachedAgentChatThread(sessionId, input = {}, options = {}) {
      return sessionAgent.deleteDetachedChatThread(sessionId, input, options);
    },

    describeAgentProvider(options = {}) {
      return sessionAgent.describeProvider(options);
    },

    async inspectAssistantAccess(sessionId, options = {}) {
      const context = await assistantSessionOptions(sessionId, options);
      const preferences = assistantRoutingFromMetadata(context.session.metadata);
      const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
      const native = await sessionAgent.assistantAccess(sessionId, context);
      const purposes = await sessionAgent.inspectAssistantPurposes({ ...preferences,
        workflowEngineId: preferences?.workflowEngineId || selection.engineId
      }, context);
      const currentMode = preferences?.mode || "";
      const steering = sessionHasActiveAgentRun(context.session);
      const available = currentMode && !steering ? purposes[currentMode]?.available === true : native.available;
      const canUse = currentMode && !steering ? purposes[currentMode]?.available === true : native.canUse;
      return { ...native, available, canUse, nativeCanUse: native.canUse, steering, canUseAny: Object.values(purposes).some(({ available }) => available),
        currentMode, purposes };
    },

    async requireAssistantAccess(sessionId, options = {}) {
      return sessionAgent.requireAssistantAccess(
        sessionId,
        await assistantSessionOptions(sessionId, options)
      );
    },

    requireAssistantSelectionAccess(assistantSelection, options = {}) {
      return sessionAgent.requireAssistantAccessForSelection(assistantSelection, options);
    },

    createConversationHost(scope) {
      const credentialHome = appCredentialContext();
      if (credentialHome.ok === false) throw new Error(credentialHome.error);
      return {
        workdir: scope.workdir, stateDirectory: path.join(scope.runtimeRoot, "native"),
        env: { ...actorHomeEnv(credentialHome, env),
          CODEX_HOME: path.join(codexProviderOptions.toolHomeSource, ".codex") },
        commands: { codex: codexProviderOptions.codexCommand || STUDIO_MANAGED_CODEX_COMMAND,
          claude: env.VIBE64_CLAUDE_COMMAND || STUDIO_MANAGED_CLAUDE_COMMAND,
          opencode: opencodeTerminalController.command || env.VIBE64_OPENCODE_COMMAND || "opencode" },
        execution: createVibe64ConversationExecution({ credentialHome, capturePurpose: "account",
          execution: { ownerId: scope.id }, operationId: "conversation", label: "Assistant conversation" }),
        opencode: input => opencode.hostPreparation.conversationHost(input),
        async codex({ providerId }) {
          // Same account/runtime scope as main chat. The conversation's workdir
          // and command environment belong to its thread, not this service.
          const options = { ...codexProviderOptions,
            ...(providerId === "openai" ? {} : await codexProviderConnections.runtimeOptions(providerId)),
            executionMode: "", executionRoot: "", workdir: "", project: {}, session: {},
            terminalEnv: await vibe64HostContextEnvironment(codexAppServerRuntimeBaseDir({ env })), userKey: "" };
          options.runtimeDir ||= codexAppServerRuntimeDir(options);
          return { ...codexAppServerRuntimeHost(options), options };
        }
      };
    },

    async resolveConversationConfiguration(assistantSelection, systemPrompt, options = {}) {
      await sessionAgent.requireAssistantAccessForSelection(assistantSelection, options);
      return conversationConfiguration(assistantSelection, systemPrompt);
    },

    async resolveConversationConnection({ integrationId, assistantSelection }, options = {}) {
      await sessionAgent.requireAssistantAccessForSelection(assistantSelection, options);
      if (integrationId !== assistantSelection.modelProviderId) throw new Error("The requested connection differs from the authorized assistant selection.");
      let connection;
      if (assistantSelection.engineId === "opencode") connection = await assistantRuntime.resolveConnection(assistantSelection);
      else if (assistantSelection.engineId === "claude") connection = await codexProviderConnections.claudeProviderSettings(integrationId);
      else {
        await codexProviderConnections.runtimeOptions(integrationId);
        connection = await codexProviderConnections.read(integrationId);
      }
      if (!connection?.apiKey) throw new Error("Reconnect the selected AI account before continuing.");
      return { providerId: integrationId, model: assistantSelection.modelId, apiKey: connection.apiKey,
        ...(connection.canonicalUrl ? { baseURL: connection.canonicalUrl } : {}) };
    },

    listAssistantCapabilities(input = {}, options = {}) {
      return sessionAgent.listCapabilities(input, options);
    },

    resolveAssistantPurpose(input = {}, options = {}) {
      return sessionAgent.resolveAssistantPurpose(input, options);
    },

    inspectAssistantRoutingConfiguration(configuration, options = {}) {
      return sessionAgent.inspectRoutingConfiguration(configuration, options);
    },

    updateAssistantModelAccess(input = {}, options = {}) {
      if (input.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
        const error = new Error("Only OpenCode providers expose configurable model access.");
        error.code = "vibe64_assistant_model_access_not_configurable";
        error.statusCode = 400;
        throw error;
      }
      if (typeof assistantRuntime.updateModelAccess !== "function") {
        const error = new Error("This Vibe64 host does not support changing provider model access.");
        error.code = "vibe64_assistant_model_access_unavailable";
        error.statusCode = 503;
        throw error;
      }
      return assistantRuntime.updateModelAccess({
        engineId: input.engineId,
        modelProviderId: String(input.modelProviderId || "").trim(),
        unlocked: input.unlocked === true,
        vibe64User: options.vibe64User || null
      });
    },

    verifyAssistantConnection(input = {}, options = {}) {
      void options;
      return opencode.accounts.verifyConnection(input);
    },

    resolveAssistantSelection(input = {}, options = {}) {
      return sessionAgent.resolveSelection(input, options);
    },

    generateSessionRenewalHandover(sessionId, input = {}, options = {}) {
      return runMainAgentWrite(sessionId, options, (context) => (
        runSessionRenewalOperation(
          input,
          options,
          context,
          (trustedInput, trustedContext) => sessionAgent.generateSessionRenewalHandover(
            sessionId,
            trustedInput,
            trustedContext
          ),
          () => context.runtime.getSession(sessionId, { inspectSource: false })
        )
      ), { operation: "generate-renewal-handover" });
    },

    createSessionRenewalManualHandoverTemplate(input = {}) {
      return sessionRenewalManualHandoverTemplate(input);
    },

    resolveAgentExecutionProfile(sessionId, input = {}, options = {}) {
      return sessionAgent.resolveExecutionProfile(sessionId, input, options);
    },

    seedSessionRenewalHandover(sessionId, input = {}, options = {}) {
      return runHiddenSessionRenewalAgentWrite(
        sessionId,
        input,
        options,
        (trustedInput, context) => sessionAgent.seedSessionRenewalHandover(
          sessionId,
          trustedInput,
          context
        )
      );
    },

    validateSessionRenewalHandover(handover = "", {
      source = null
    } = {}) {
      return defineSessionRenewalHandoverText(handover, {
        requireStructure: true,
        source
      });
    },

    interruptDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
      return sessionAgent.interruptDetachedChatTurn(sessionId, input, options);
    },

    async interruptAgentTurn(sessionId, input = {}, options = {}) {
      if (await assistantRouting.cancel(sessionId, options)) return { ok: true, interrupted: true, routingCancelled: true };
      return sessionAgent.interruptTurn(sessionId, input, options);
    },

    generateSessionPromptHints(sessionId, input = {}) {
      return sessionPromptHints.generateSessionPromptHints(sessionId, input);
    },

    cancelSessionPromptHints(sessionId, input = {}) {
      return sessionPromptHints.cancelSessionPromptHints(sessionId, input);
    },

    async resumeIntegrationContinuation(sessionId, input = {}, options = {}) {
      const inspectConfiguration = async (saved) => {
        if (typeof options.readIntegrationConfiguration !== "function") {
          return { ok: false, code: "vibe64_integration_configuration_unavailable",
            error: "Integration configuration cannot be checked before continuing.", integrationSetup: saved };
        }
        const current = await options.readIntegrationConfiguration();
        if (current?.ok === false) return current;
        if (current?.baseHash !== saved.configurationHash ||
            !Object.hasOwn(current?.configuration?.integrations || {}, saved.integrationId)) {
          return { ok: false, code: "vibe64_integration_configuration_changed",
            error: "Integration configuration changed after verification. Return to chat and request setup for the updated configuration.",
            integrationSetup: saved };
        }
        return null;
      };
      const unconfirmed = (saved) => ({ ok: false, code: "vibe64_integration_continuation_unconfirmed",
        error: "Assistant delivery could not be confirmed. Check again to inspect delivery; this will not send a duplicate message.",
        integrationSetup: saved });
      const prepared = await runMainAgentWrite(sessionId, options, async (context) => {
        requireCompletedConversationRewind(context.session);
        const store = context.runtime.store;
        const saved = await store.readIntegrationSetupRequest(sessionId, input.turnId);
        if (!saved || saved.requestId !== input.requestId || saved.outcome !== "completed") {
          return { ok: false, code: "vibe64_integration_setup_not_completed",
            error: "This integration request has not been completed." };
        }
        if (saved.continuation.status === "accepted") {
          return { ok: true, integrationSetup: saved };
        }
        const route = JSON.parse(context.session.metadata.assistant_routing_request || "null");
        // A previously claimed delivery without a routing request is only
        // inspected. Never turn its old receipt into a fresh routed Send.
        if (saved.continuation.status === "sending" && route?.messageId !== saved.continuationMessageId) {
          let delivered = await store.conversationMessageIdExists(sessionId, saved.continuationMessageId);
          if (!delivered && vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId === saved.continuation.engineId) {
            try {
              const admission = await sessionAgent.inspectMessageAdmission(sessionId, {
                messageId: saved.continuationMessageId, threadId: saved.continuation.threadId
              }, context);
              delivered = admission.ok !== false && admission.admission === "accepted";
            } catch {
              // Keep the original receipt for another read after reconnection.
            }
          }
          if (!delivered) return unconfirmed(saved);
          const accepted = await store.acceptIntegrationContinuation(sessionId, {
            ...input, continuationMessageId: saved.continuationMessageId, ...saved.continuation
          });
          return { ok: true, integrationSetup: accepted.integrationSetup };
        }
        if (saved.continuation.status === "pending") {
          const failure = await inspectConfiguration(saved);
          if (failure) return failure;
        }
        return { saved, runtime: context.runtime };
      }, { operation: "resume-integration-continuation", waitMs: AGENT_WRITE_WAIT_MS });
      if (!prepared.saved) return prepared;
      const { saved, runtime } = prepared;
      let delivered = false;
      let failure;
      try {
        const result = await assistantRouting.send(sessionId, {
          messageId: saved.continuationMessageId, submissionKind: "send",
          message: `Integration setup completed for slot ${JSON.stringify(saved.integrationId)}. Continue the implementation from your integration setup request. Read the project's saved integration configuration; do not request or expose credentials in chat.`
        }, { ...options, runtime, purpose: "junior",
          onPromptSending: async ({ threadId, assistantSelection }) => {
            const changed = await inspectConfiguration(saved);
            if (changed) throw Object.assign(new Error(changed.error), { code: changed.code });
            await runtime.store.claimIntegrationContinuation(sessionId, {
              ...input, continuationMessageId: saved.continuationMessageId, engineId: assistantSelection.engineId, threadId
            });
          }
        });
        delivered = result?.ok !== false && result?.delivered === true;
      } catch (error) {
        failure = { ok: false, code: error.code, error: error.message };
        logOperationalEvent(logger, "warn", {
          code: error.code, component: "vibe64.integration_continuation",
          event: "vibe64.integration_continuation.delivery_failed", sessionId, messageId: saved.continuationMessageId
        }, "Integration continuation delivery failed; its request remains available for recovery.");
      }
      return runMainAgentWrite(sessionId, { ...options, runtime }, async () => {
        const current = await runtime.store.readIntegrationSetupRequest(sessionId, input.turnId);
        if (!current || current.requestId !== saved.requestId) return unconfirmed(current);
        if (current.continuation.status === "accepted") return { ok: true, integrationSetup: current };
        if (current.continuation.status === "pending") return failure || unconfirmed(current);
        if (!delivered) return unconfirmed(current);
        const accepted = await runtime.store.acceptIntegrationContinuation(sessionId, {
          ...input, continuationMessageId: current.continuationMessageId, ...current.continuation
        });
        return { ok: true, integrationSetup: accepted.integrationSetup };
      }, { operation: "complete-integration-continuation", waitMs: AGENT_WRITE_WAIT_MS });
    },

    async sendAgentMessage(sessionId, input = {}, options = {}) {
      assertProjectEffectAdmission();
      const startedAt = Date.now();
      const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || null;
      void sessionPromptHints.cancelSessionPromptHintsForSession(sessionId).catch((error) => {
        logOperationalEvent(logger, "warn", { event: "vibe64.prompt_hints.cleanup_failed", error: error.message, sessionId },
          "Prompt suggestion cleanup will be retried on session close.");
      });
      try {
        let request = input;
        if (options.runtime?.learningScope && options.runtime.learningTeaching) {
          try {
            request = await options.runtime.learningTeaching.captureMessage({ runtime: options.runtime, sessionId, input,
              context: options, actions });
          } catch (error) {
            // This host gate precedes routing and native admission. Do not expose
            // arbitrary internal exceptions or classify failures after dispatch.
            const delivery = { status: "not-sent", messageId: input.messageId };
            if (error instanceof AppError && error.status >= 400 && error.status < 500) {
              error.details = { ...error.details, delivery };
            } else if (error?.code === "VIBE64_TRAINING_PREPARATION_BUSY" && error.statusCode === 409) {
              throw new AppError(409, error.message, { code: error.code, details: { delivery } });
            }
            throw error;
          }
        }
        const result = await assistantRouting.send(sessionId, request, options);
        if (result?.ok === true && !result.duplicate && !options.purpose && !input.reviewAction && !closing) {
          try {
            sessionNaming.start(await assistantSessionOptions(sessionId, options), input.messageId);
          } catch (error) {
            logger?.warn({ error: error.message, sessionId }, "Session naming could not start.");
          }
        }
        if (result?.ok === false) {
          logOperationalEvent(logger, "warn", {
            code: result.code,
            component: "vibe64.agent_message",
            durationMs: Date.now() - startedAt,
            error: result.error || result.errors?.[0]?.message,
            event: "vibe64.agent_message.delivery_failed",
            username,
            messageId: input.messageId,
            operationOutcome: result.operationOutcome,
            refreshRecommended: result.refreshRecommended,
            retryable: result.retryable,
            sessionId,
            threadId: result.thread?.id,
            turnId: result.turn?.id
          }, "Vibe64 assistant message delivery failed.");
        }
        return result;
      } catch (error) {
        logOperationalEvent(logger, "warn", {
          code: error?.code,
          component: "vibe64.agent_message",
          durationMs: Date.now() - startedAt,
          error,
          event: "vibe64.agent_message.delivery_failed",
          username,
          messageId: input.messageId,
          sessionId
        }, "Vibe64 assistant message delivery failed.");
        throw error;
      }
    },

    async readAgentGoal(sessionId, options = {}, { canonical = false } = {}) {
      const context = await assistantSessionOptions(sessionId, options);
      let view;
      let target;
      const result = await sessionAgent.readGoal(sessionId, { ...context, canonicalGoal: canonical,
        ...(canonical ? { async onGoalResult(nativeResult, readTarget) {
          view = await applyAgentGoalReadResult(sessionId, context, nativeResult);
          target = readTarget;
        } } : {}) });
      if (!canonical) return applyAgentGoalReadResult(sessionId, context, result);
      return { status: view.status, goal: result ? { ...result, objective: view.goal.objective } : null,
        target, ...(view.routing ? { routing: view.routing } : {}) };
    },

    async updateAgentGoal(sessionId, input = {}, { canonical = false } = {}) {
      if (["set", "resume"].includes(input.action)) {
        assertProjectEffectAdmission();
        return runMainAgentWrite(sessionId, input, async (context) => {
          requireCompletedConversationRewind(context.session);
          if (assistantRoutingFromMetadata(context.session.metadata)?.mode === "auto") {
            return { ok: false, code: "vibe64_goal_explicit_mode_required", error: "Choose Senior or Junior before starting or resuming a goal." };
          }
          const pendingRoute = JSON.parse(context.session.metadata.assistant_routing_request || "null");
          if (assistantRoutingStatusIsPending(pendingRoute?.status) || pendingRoute?.helper) {
            return { ok: false, error: "Finish or cancel the pending request before starting a goal." };
          }
          const changeover = JSON.parse(context.session.metadata?.assistant_changeover || "null");
          const engineId = vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
          if (changeover && changeover.lastEngine !== engineId) {
            return { ok: false, code: "vibe64_changeover_message_required",
              error: "Send a message to catch this AI up before starting or resuming its goal." };
          }
          await prepareAgentSkillsInsideAgentWrite(sessionId, context);
          const prepared = await assistantRouting.prepareGoal(sessionId, input, context);
          const completeResult = async result => {
            if (result?.ok !== false && prepared.pinned) {
              await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify(prepared.pinned));
            }
            return result;
          };
          const result = await sessionAgent.updateGoal(sessionId, prepared.input, { ...prepared.context, canonicalGoal: canonical,
            ...(canonical ? { onGoalResult: completeResult } : {}) });
          return canonical ? result : completeResult(result);
        }, { operation: input.action === "set" ? "set-agent-goal" : "resume-agent-goal" });
      }
      const context = await assistantSessionOptions(sessionId, input);
      const pinned = JSON.parse(context.session.metadata.assistant_routing_goal || "null");
      const completeResult = async result => {
        if (result?.ok !== false && result.status === "available" && pinned) {
          await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({
            ...pinned, status: result.goal?.status || "complete"
          }));
          await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
        }
        return result;
      };
      const result = await sessionAgent.updateGoal(sessionId, pinned && input.objective === pinned.objective
        ? { ...input, objective: assistantModePrompt(pinned.mode, input.objective) } : input,
      { ...context, canonicalGoal: canonical, ...(canonical ? { onGoalResult: completeResult } : {}) });
      return canonical ? result : completeResult(result);
    },

    async readAgentPlanUsage(sessionId, options = {}) {
      return sessionAgent.readPlanUsage(sessionId, await assistantSessionOptions(sessionId, options));
    },

    readSessionWorkPlan(sessionId, input = {}) {
      return vibe64Result(async () => ({
        ok: true, sessionId,
        ...await readWorkPlanPage(await assistantSessionOptions(sessionId), input)
      }));
    },

    archiveSessionWorkPlan(sessionId, input = {}) {
      return changeSessionWorkPlan(sessionId, "archive", input);
    },

    restoreSessionWorkPlan(sessionId, input = {}) {
      return changeSessionWorkPlan(sessionId, "restore", input);
    },

    async ensureAgentSession(sessionId, options = {}) {
      const startedAt = Date.now();
      const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || null;
      const logFailure = (fields) => logOperationalEvent(logger, "warn", {
        ...fields,
        component: "vibe64.agent_session",
        durationMs: Date.now() - startedAt,
        event: "vibe64.agent_session.reconciliation_failed",
        username,
        sessionId
      }, "Vibe64 assistant status could not be verified.");

      try {
        const context = await assistantSessionOptions(sessionId, options);
        const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
        if (selection.engineId === "codex" && (context.session.metadata.agent_identity_provider !== "codex" ||
            !context.session.metadata.agent_identity_conversation_id)) {
          await sessionAgent.prepareSelection(sessionId, selection, context);
        }
        const result = await sessionAgent.ensureSession(sessionId, ["codex", "opencode"].includes(selection.engineId) ? learningToolManifest(context) : context);
        if (result?.ok !== false) await assistantRouting.reconcile(sessionId, context);
        if (result?.ok === false) {
          logFailure({
            code: result.code,
            error: result.error,
            retryable: result.retryable
          });
        }
        return result;
      } catch (error) {
        logFailure({ code: error?.code, error });
        throw error;
      }
    },

    async assertSessionRenewalIdle(sessionId, options = {}) {
      const runtime = options.runtime || await projectService.createRuntime({
        inspectSource: false
      });
      const session = options.session?.sessionId === sessionId
        ? options.session
        : await runtime.getSession(sessionId, { inspectSource: false });
      const records = await runtime.store.listSessionConversations(sessionId);
      const requests = [session.metadata, ...records.map((record) => record.routingMetadata || {})]
        .map((metadata) => JSON.parse(metadata.assistant_routing_request || "null"));
      if (requests.some((request) => assistantRoutingStatusIsPending(request?.status) || request?.helper)) {
        throw Object.assign(new Error("Finish or cancel pending chat routing and reviews before renewing this session."), { code: "vibe64_assistant_routing_pending", retryable: true });
      }
      const conversation = await sessionAgent.hasActiveTemporaryConversation(
        sessionId,
        {},
        {
          ...options,
          runtime,
          session
        }
      );
      if (conversation?.active === true) {
        const error = new Error(
          "Wait for the temporary assistant task to finish before renewing this session."
        );
        error.code = "vibe64_session_renewal_temporary_ai_active";
        error.retryable = true;
        throw error;
      }
      return {
        idle: true,
        ok: true
      };
    },

    async invalidateAgentRuntimes(input = {}) {
      if (input.reason === "server-shutdown") {
        closing = true;
        const routing = await Promise.allSettled([assistantRouting.close(), sessionConversations.close(), sessionNaming.close()]);
        await Promise.allSettled(turnCompletions);
        const [native] = await Promise.allSettled([sessionAgent.invalidateRuntimes(input, {
          providerId: normalizeAgentProviderId(input.provider)
        })]);
        const failures = [...routing, native].filter((result) => result.status === "rejected").map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Assistant runtime shutdown did not complete successfully.");
        await mainConversations.close();
        return native.value;
      }
      return sessionAgent.invalidateRuntimes(input, {
        providerId: normalizeAgentProviderId(input.provider)
      });
    },

    reconcileAgentSessions,

    async reconcileOpenAgentSessions(options = {}) {
      const closedRuntime = await closeProjectRuntimeIfOpenMarkerMissing(
        "server.terminals.reconcileOpenAgentSessions.closedProject"
      );
      if (closedRuntime) {
        return {
          closeResult: closedRuntime.closeResult,
          failed: Array.isArray(closedRuntime.closeResult?.failed) ? closedRuntime.closeResult.failed : [],
          ok: closedRuntime.closeResult?.ok !== false,
          reason: closedRuntime.reason,
          results: [],
          runtime: closedRuntime.runtime,
          sessionCount: 0,
          skipped: true
        };
      }
      const sessions = await listOpenProjectRuntimeSessions();
      return reconcileAgentSessions(sessions, options);
    },

    async openBrowserConversation(sessionId, options = {}) {
      if (!options.browserAuthority || options.browserAuthority.sessionId !== sessionId) {
        throw Object.assign(new Error("Main browser conversations require current project access."), {
          code: "conversation_forbidden", statusCode: 403
        });
      }
      const context = await assistantSessionOptions(sessionId, options);
      const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
      if (!["codex", "claude", "opencode"].includes(selection.engineId)) {
        throw Object.assign(new Error("This Main conversation's engine is not connected to the browser facade yet."), {
          code: "conversation_unsupported", statusCode: 400
        });
      }
      const current = { ...context, sessionId, assistantSelection: selection, providerId: selection.engineId };
      const conversation = await mainConversations.open({ id: sessionId, context: current });
      if (!context.runtime.learningScope || !context.runtime.learningTeaching) return conversation;
      return Object.freeze({ ...conversation, async read(query) {
        const result = await conversation.read(query);
        const trainingQuestion = await context.runtime.learningTeaching.readQuestion({ runtime: context.runtime,
          sessionId, context: current, actions });
        return { ...result, trainingQuestion };
      } });
    },

    async openTemporaryBrowserConversation(sessionId, conversationId, options = {}) {
      const authority = options.browserAuthority;
      if (!authority || authority.sessionId !== sessionId || authority.conversationId !== conversationId) {
        throw Object.assign(new Error("Temporary browser conversations require current project access."), {
          code: "conversation_forbidden", statusCode: 403
        });
      }
      const context = await assistantSessionOptions(sessionId, options);
      return mainConversations.open({ id: sessionId, context: { ...context, sessionId, temporaryConversationId: conversationId } });
    },

    agentSessionState(sessionId, options = {}) {
      return sessionAgent.sessionState(sessionId, options);
    },

    // Called inside the selection writer's existing session lock. Closing a
    // controller stops observation/execution, never deletes native history.
    prepareAssistantChangeover,
    prepareRoutingSelection,

    // Prepare a new routing pin without starting, clearing or changing the native goal.
    async preparePausedGoalSelection(sessionId, selection, preferences, context) {
      const prepared = await assistantRouting.prepareGoal(sessionId, { action: "rebind", selection }, {
        ...context, session: { ...context.session, metadata: { ...context.session.metadata,
          assistant_routing: JSON.stringify(preferences) } }
      });
      return prepared.pinned;
    },

    globalCodexTerminalState() {
      return codex.terminals.globalTerminalState();
    },

    readGlobalCodexTerminal(terminalSessionId) {
      return codex.terminals.readGlobalTerminal(terminalSessionId);
    },

    readAgentTerminal(sessionId, terminalSessionId, options = {}) {
      return sessionAgent.readTerminal(sessionId, terminalSessionId, options);
    },

    readEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.readEphemeralConversation(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    readOutputTargetTerminal(sessionId, terminalSessionId) {
      return outputTarget.readTerminal(sessionId, terminalSessionId);
    },

    testApprovalStatus(sessionId) {
      return agentPreviewCommand.testApprovalStatus(sessionId);
    },

    resumeTestApproval(identity, authorizeStart) {
      return agentPreviewCommand.resumeTestApproval(identity, authorizeStart);
    },

    cancelTestApproval(identity) {
      return agentPreviewCommand.cancelTestApproval(identity);
    },

    async outputTargetStatus(sessionId, options = {}) {
      const closedRuntime = await closeProjectRuntimeIfOpenMarkerMissing(
        "server.terminals.outputTargetStatus.closedProject"
      );
      if (closedRuntime) {
        return closedProjectOutputTargetStatus(closedRuntime);
      }
      const result = { ...await outputTarget.launchStatus(sessionId, options), testApproval: agentPreviewCommand.testApprovalStatus(sessionId) };
      if (result.ok !== true) return result;
      if (options.outputTargetId != null || options.targetOffset != null || options.runOffset != null) {
        const targets = (result.outputTargets || []).filter(target => !options.outputTargetId || target.id === options.outputTargetId);
        const targetOffset = options.targetOffset ?? 0;
        const runs = result.outputRuns || [];
        const runOffset = options.runOffset ?? 0;
        return { ...result,
          requestedOutputTargetId: options.outputTargetId || "",
          outputTargets: targets.slice(targetOffset, targetOffset + 10), outputTargetCount: targets.length, targetOffset,
          outputRuns: runs.slice(runOffset, runOffset + 5), outputRunCount: runs.length, runOffset
        };
      }
      return result;
    },

    openOutputTarget(sessionId) {
      return outputTarget.openOutputTarget(sessionId);
    },

    readOutputResult(sessionId, resultId) {
      return outputTarget.readResult(sessionId, resultId);
    },

    removeOutputResultsForSession(sessionId) {
      return outputTarget.removeResultsForSession(sessionId);
    },

    selectPreviewIdentity(sessionId, input = {}, options = {}) {
      return outputTarget.selectPreviewIdentity(sessionId, input, options);
    },

    startAgentTerminal(sessionId, input = {}, options = {}) {
      assertProjectEffectAdmission();
      return runMainAgentWrite(sessionId, options, async (context) => {
        await prepareAgentSkillsInsideAgentWrite(sessionId, context);
        return sessionAgent.startTerminal(sessionId, input, context);
      }, { operation: "start-agent-terminal" });
    },

    startEphemeralAgentConversationTurn(scope = {}, input = {}, options = {}) {
      return sessionAgent.startEphemeralConversationTurn(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    stopEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.stopEphemeralConversation(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    async startGlobalCodexTerminal(options = {}) {
      await authorizeGlobalCodexTerminal(options);
      return codex.terminals.startGlobalTerminal();
    },

    async startOutputTargetTerminal(sessionId, input = {}) {
      const result = await outputTarget.startTerminal(sessionId, input);
      await publishTerminalSessionChanged(
        "outputTarget",
        sessionId,
        "output-target-started",
        { originId: input.originId }
      );
      return result;
    },

    async stopOutputTargetTerminal(sessionId, terminalSessionId) {
      const result = await outputTarget.stopTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("outputTargetStopped", sessionId, "output-target-stopped");
      return result;
    },

    subscribeAgentTerminal(sessionId, terminalSessionId, subscriber, options = {}) {
      return sessionAgent.subscribeTerminal(sessionId, terminalSessionId, subscriber, options);
    },

    subscribeGlobalCodexTerminal(terminalSessionId, subscriber) {
      return codex.terminals.subscribeGlobalTerminal(terminalSessionId, subscriber);
    },

    subscribeOutputTargetTerminal(sessionId, terminalSessionId, subscriber) {
      return outputTarget.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    uploadAgentAttachment(sessionId, input = {}, options = {}) {
      return runMainAgentWrite(sessionId, options, (context) => (
        sessionAgent.uploadAttachment(sessionId, input, context)
      ), { operation: "upload-agent-attachment", waitMs: AGENT_WRITE_WAIT_MS });
    },

    readAgentAttachment(sessionId, attachmentId) {
      return sessionAttachments.readAttachment({ sessionId }, attachmentId);
    },

    deleteAgentAttachment(sessionId, input = {}, options = {}) {
      return runMainAgentWrite(sessionId, options, (context) => (
        sessionAgent.deleteAttachment(sessionId, input, context)
      ), { operation: "delete-agent-attachment" });
    },

    waitForEphemeralAgentConversationTurn(scope = {}, input = {}, options = {}) {
      return sessionAgent.waitForEphemeralConversationTurn(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    writeAgentTerminal(sessionId, terminalSessionId, data, input = {}, options = {}) {
      assertProjectEffectAdmission();
      // A terminal write targets an already-open, namespace-owned PTY. It is
      // transport authorized against its captured connection by the manager.
      // Putting raw input through
      // runMainAgentWrite() hydrates the complete session and acquires
      // the assistant-operation lock for every WebSocket input chunk—often
      // every keystroke. Long-lived sessions therefore became progressively
      // slower and terminal restarts contended with ordinary typing.
      const admissionFailure = sessionTerminalAdmissionFailure(sessionId, "agent");
      if (admissionFailure) return admissionFailure;
      if (input.attachmentIds?.length) {
        return runMainAgentWrite(sessionId, options, (context) =>
          sessionAgent.writeTerminal(sessionId, terminalSessionId, data, input, context),
        { operation: "attach-agent-terminal-files", waitMs: AGENT_WRITE_WAIT_MS });
      }
      return sessionAgent.writeTerminal(sessionId, terminalSessionId, data, input, options);
    },

    async writeGlobalCodexTerminal(terminalSessionId, data, options = {}) {
      await authorizeGlobalCodexTerminal(options);
      return codex.terminals.writeGlobalTerminal(terminalSessionId, data);
    },

    resizeAgentTerminal(sessionId, terminalSessionId, size, options = {}) {
      return sessionAgent.resizeTerminal(sessionId, terminalSessionId, size, options);
    },

    resizeGlobalCodexTerminal(terminalSessionId, size) {
      return codex.terminals.resizeGlobalTerminal(terminalSessionId, size);
    },

    writeOutputTargetTerminal(sessionId, terminalSessionId, data) {
      return sessionTerminalAdmissionFailure(sessionId, "output") ||
        outputTarget.writeTerminal(sessionId, terminalSessionId, data);
    },

    resizeOutputTargetTerminal(sessionId, terminalSessionId, size) {
      return outputTarget.resizeTerminal(sessionId, terminalSessionId, size);
    },

  };

  return Object.freeze(service);
}

function startProjectRuntimeDormancyCleanupSchedule({
  clearIntervalImpl = clearInterval,
  idleAfterMs = PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS,
  intervalMs = PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS,
  logger = null,
  serviceFactory = null,
  setIntervalImpl = setInterval
} = {}) {
  if (typeof serviceFactory !== "function") {
    throw new TypeError("startProjectRuntimeDormancyCleanupSchedule requires serviceFactory().");
  }
  const normalizedIdleAfterMs = normalizePositiveDurationMs(idleAfterMs, PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS);
  const normalizedIntervalMs = normalizePositiveDurationMs(intervalMs, PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS);
  let running = false;
  let stopped = false;

  async function runNow() {
    if (running || stopped) {
      return null;
    }
    running = true;
    try {
      const service = serviceFactory();
      if (typeof service?.closeDormantProjectRuntimes !== "function") {
        return null;
      }
      const result = await service.closeDormantProjectRuntimes({
        idleAfterMs: normalizedIdleAfterMs
      });
      vibe64SessionDebugLog("server.terminals.projectRuntime.dormantCleanup.done", {
        closedCount: Number(result?.closedCount || 0),
        failedCount: Array.isArray(result?.failed) ? result.failed.length : 0,
        idleAfterMs: normalizedIdleAfterMs,
        ok: result?.ok !== false,
        projectCount: Number(result?.projectCount || 0)
      });
      return result;
    } catch (error) {
      logger?.warn?.({
        component: "vibe64-project-runtime-cleanup",
        error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
        event: "vibe64.project_runtime.dormant_cleanup_failed"
      }, "Scheduled dormant Vibe64 project runtime cleanup failed.");
      vibe64SessionDebugLog("server.terminals.projectRuntime.dormantCleanup.error", {
        error: vibe64SessionDebugError(error),
        idleAfterMs: normalizedIdleAfterMs
      });
      return {
        error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
        ok: false
      };
    } finally {
      running = false;
    }
  }

  const interval = setIntervalImpl(() => {
    void runNow();
  }, normalizedIntervalMs);
  interval?.unref?.();

  return {
    idleAfterMs: normalizedIdleAfterMs,
    intervalMs: normalizedIntervalMs,
    runNow,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearIntervalImpl(interval);
    }
  };
}

export {
  createCodexSessionRegistration,
  createOpenCodeSessionRegistration,
  createService,
  projectRuntimeDormancyState,
  startProjectRuntimeDormancyCleanupSchedule,
  terminalNamespaceMatchesProjectScope
};
