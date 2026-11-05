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
  codexDeliveredConversationMetadata,
  codexTerminalConversationMetadata
} from "./conversationActor.js";
import {
  createCodexConversationStorage
} from "./codexConversationStorage.js";
import {
  createCodexHelperThreadLedger,
  codexHelperThreadLedgerOwner
} from "./codexHelperThreadLedger.js";
import { runtimeProfileIsLocal } from "@local/vibe64-core/server/studioRoots";
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
  createCodexDeferredTurnCheckpoint,
  createCodexSessionTurnCheckpoint,
  shutdownStoppedRun
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
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  codexAppServerControlsLog,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost,
  CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
  assertCodexAuthPreflightReady,
  createCodexAppServerAgentProvider
} from "@local/vibe64-runtime/server/codexAppServerAgent";
import {
  createCodexProviderConnectionStore
} from "@local/vibe64-core/server/codexProviderConnections";
import {
  publishMainConversationEvent
} from "./mainConversationBinding.js";
import {
  createCodexSessionAttachmentRenewal
} from "./sessionAttachments.js";
import {
  createCodexSessionAgentProvider
} from "./agent/providers/codexSessionAgentProvider.js";
import {
  codexTerminalNamespace
} from "./terminalShared.js";
import {
  captureProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  codexRuntimeContext
} from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  normalizeVibe64AgentRunState
} from "@local/vibe64-runtime/server/sessionStore";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("@local/vibe64-core/server/types").CodexProviderConnectionStore} CodexProviderConnectionStore */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").PublishNativeConversation} PublishNativeConversation */
/** @typedef {import("./types.js").ContinueGoalAfterAccountChange} ContinueGoalAfterAccountChange */

const CODEX_AGENT_TURN_STEER_FAILED_CODE = "vibe64_codex_turn_steer_failed";

const CODEX_APP_SERVER_ACTIVE_RECONCILE_MS = 2000;

const CODEX_APP_SERVER_DAEMON_WELLBEING_MS = 15000;

/**
 * @param {object} dependencies
 * @param {(context: object) => Promise<boolean>} dependencies.connectionStatus
 * @param {CodexProviderConnectionStore["list"]} dependencies.listConnections
 * @param {AgentDatabaseCommandService} dependencies.agentDatabaseCommand
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {AgentSessionCommandService} dependencies.agentSessionCommand
 * @param {typeof assertCodexAuthPreflightReady} [dependencies.codexAuthPreflight]
 * @param {number} [dependencies.codexAppServerActiveReconcileMs]
 * @param {number} [dependencies.codexAppServerDaemonWellbeingMs]
 * @param {object} dependencies.codexAppServerProviderOptions
 * @param {typeof createCodexAppServerAgentProvider} [dependencies.codexAppServerProviderFactory]
 * @param {typeof createCodexHelperThreadLedger} [dependencies.codexHelperThreadLedgerFactory]
 * @param {boolean} [dependencies.codexToolHomeRequired]
 * @param {string} [dependencies.codexToolHomeSource]
 * @param {RuntimeEnv} dependencies.env
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishNativeConversation} dependencies.publishConversation
 * @param {ContinueGoalAfterAccountChange} dependencies.continueGoalAfterAccountChange
 * @param {ConversationRuntime["runNativeDetachedConversation"]} dependencies.runNativeDetachedConversation
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {object | null} dependencies.runtimeProfile the server's runtime profile, or none
 */
function createCodexSessionRegistration({
  connectionStatus,
  listConnections,
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codexAuthPreflight = assertCodexAuthPreflightReady,
  codexAppServerActiveReconcileMs = CODEX_APP_SERVER_ACTIVE_RECONCILE_MS,
  codexAppServerDaemonWellbeingMs = CODEX_APP_SERVER_DAEMON_WELLBEING_MS,
  codexAppServerProviderOptions,
  codexAppServerProviderFactory = createCodexAppServerAgentProvider,
  codexHelperThreadLedgerFactory = createCodexHelperThreadLedger,
  codexToolHomeRequired = false,
  codexToolHomeSource = "",
  env,
  codexGitCommand,
  logger,
  project,
  publishConversation,
  continueGoalAfterAccountChange,
  runNativeDetachedConversation,
  publishSessionChanged,
  runCommand = runVibe64Command,
  runtimeProfile
}) {
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
  const codexRuntimeHost = createCodexRuntimeHost({
    env,
    codexAppServerProviderOptions,
    codexToolHomeSource
  });
  const {
    codexAppServerProviderKeyFields
  } = codexRuntimeHost;
  const localRuntime = runtimeProfileIsLocal(runtimeProfile);
  // Only a local run with a system root has a standalone profile.
  const actorProfile = localRuntime && normalizeText(codexAppServerProviderOptions.systemRoot)
    ? {
        personalProfileStore: createPersonalAiProfileStore({
          systemRoot: codexAppServerProviderOptions.systemRoot
        })
      }
    : {};

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
    project,
    runCommand
  });

  const codexSessionRuntimeHost = createCodexSessionRuntimeHost({
    runtimeHost: codexRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    project,
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
    /**
     * The native owner consumes these preparations only after construction.
     */
    get runOwner() {
      return codexAppServerRunOwner;
    }
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
      const host = { ...codexAppServerRuntimeHost(parameters), log: codexAppServerControlsLog(logger) };
      host.parameters.runtimeDir ||= codexAppServerRuntimeDir(parameters);
      return host;
    }
  });
  async function publishCodexConversationEvent(sessionId, event) {
    const { nativeGoal: _nativeGoal, ...publicEvent } = event;
    return publishMainConversationEvent(codexTerminalNamespace, publishSessionChanged, publishConversation, sessionId, event, publicEvent);
  }
  const checkpointCodexAppServerTurn = createCodexSessionTurnCheckpoint({ project, publishSessionChanged });
  const codexAppServerRunOwner = createCodexAppServerRunOwner({
    namespace: codexTerminalNamespace,
    normalizeRunState: normalizeVibe64AgentRunState,
    debugLog: (event, details) => vibe64SessionDebugLog(`server.codexTerminal.${event}`, details),
    debugError: vibe64SessionDebugError,
    createRuntime: createRuntimeForSession,
    createStore: createStoreForSession,
    publish: publishCodexConversationEvent,
    providerSessions: {
      owner: codexAppServerProviderOwner,
      wellbeingMs: codexAppServerDaemonWellbeingMs,
      keyFields: codexAppServerProviderKeyFields,
      context: codexAppServerSessionProviderContext,
      outputContext: codexAppServerOutputContext,
      connectionPolicy: codexAppServerConnectionPolicy
    },
    helperThreads: {
      ledgerOwner: {
        ...codexHelperThreadLedgerOwner,
        createCodexHelperThreadLedger: codexHelperThreadLedgerFactory
      },
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
    sessionIdRequiredError: "Vibe64 session ID is required.",
    turnAlreadyRunningError: "Codex is already working on this Vibe64 session.",
    messageIdPrefix: "vibe64:",
    idlePublishPayload: VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD,
    checkpoint: checkpointCodexAppServerTurn,
    deferCheckpoint: createCodexDeferredTurnCheckpoint({ project }),
    messageMetadata: {
      actor: currentConversationActorMetadata,
      delivered: codexDeliveredConversationMetadata,
      terminal: codexTerminalConversationMetadata
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
    continueGoalAfterAccountChange,
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
  const codexConversationStorage = createCodexConversationStorage({ project, runOwner: codexAppServerRunOwner });
  const codexAttachments = createCodexSessionAttachmentRenewal({
    sessionRuntimeHost: codexSessionRuntimeHost,
    sessionEnvironment: codexSessionEnvironment
  });
  const codexStartupHealth = createCodexStartupHealth(publishSessionChanged);
  const blockCodexAppServerForUnavailableWorktree = createCodexUnavailableWorktreeHandler({
    runOwner: codexAppServerRunOwner,
    sessionRuntimeHost: codexSessionRuntimeHost,
    health: codexStartupHealth
  });
  const codexConversationPreparation = createCodexConversationPreparation({
    project,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    health: codexStartupHealth,
    unavailableWorktree: blockCodexAppServerForUnavailableWorktree,
    publishSessionChanged,
    checkpoint: checkpointCodexAppServerTurn
  });
  const codexLifecyclePreparation = createCodexLifecyclePreparation({
    project,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    sessionEnvironment: codexSessionEnvironment,
    providerHost: codexSessionProviderHost,
    conversationPreparation: codexConversationPreparation,
    helperPreparation: codexHelperPreparation,
    health: codexStartupHealth
  });
  const codexAssistantCatalog = createCodexAssistantCatalog({
    accountPreparation: codexAccountPreparation,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    conversationPreparation: codexConversationPreparation,
    helperPreparation: codexHelperPreparation,
    providerOwner: codexAppServerProviderOwner,
    runOwner: codexAppServerRunOwner,
    providerFactory: codexAppServerProviderFactory
  });
  const codexScopedConversationPreparation = createCodexScopedConversationPreparation({
    conversationPreparation: codexConversationPreparation,
    helperPreparation: codexHelperPreparation,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    actorMetadata: currentConversationActorMetadata
  });
  const markCodexAppServerContextRefreshPending = createCodexContextRefreshMarker({ project, runOwner: codexAppServerRunOwner });

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
      ...actorProfile,
      vibe64User
    });
  }

  const codexInteractiveTerminals = createCodexInteractiveTerminals({
    env,
    project,
    runCommand,
    runtimeHost: codexRuntimeHost,
    sessionRuntimeHost: codexSessionRuntimeHost,
    accountPreparation: codexAccountPreparation,
    sessionEnvironment: codexSessionEnvironment,
    runOwner: codexAppServerRunOwner,
    withThreadReadiness: codexConversationPreparation.threadReadiness,
    unavailableWorktree: blockCodexAppServerForUnavailableWorktree
  });

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} [sessionId]
   * @param {string} [threadId]
   * @param {string} [turnId]
   * @param {string} [outcome]
   * @param {string} [detail]
   * @param {object} [options]
   * @param {boolean} [options.usageLimitExceeded]
   */
  async function writeCodexAppServerTurnOutcomeNotice(
    runtime,
    sessionId = "",
    threadId = "",
    turnId = "",
    outcome = CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
    detail = "",
    options = {}
  ) {
    const { usageLimitExceeded = false } = options;
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

  function codexAppServerEphemeralScopePreparation(sessionId, input, scope) {
    return codexScopedConversationPreparation.scope(sessionId, input, scope);
  }

  function codexAppServerConversationPreparation(sessionId, input, options) {
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
    renewalPreparation: codexRenewalPreparation,
    storage: codexConversationStorage,
    catalog: codexAssistantCatalog,
    terminals: codexInteractiveTerminals,
    attachments: codexAttachments,
    runNativeDetachedConversation,
    env,
    publishSessionChanged: publishCodexConversationEvent,
    checkpoint: checkpointCodexAppServerTurn,
    shutdownStoppedRun: (context, stop) => shutdownStoppedRun({ project, publishSessionChanged }, context, stop)
  });
  return Object.freeze({
    provider,
    terminals: codexInteractiveTerminals,
    accounts: codexAccountPreparation,
    catalog: codexAssistantCatalog,
    attachments: codexAttachments
  });
}

export {
  createCodexSessionRegistration
};
