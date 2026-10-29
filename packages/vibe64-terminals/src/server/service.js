import { createPreviewDiagnosticRecorder } from "./previewDiagnostics.js";
import { excludeAgentGuidanceFromPracticeHistory, isPracticeProjectRuntime } from "./practiceAgentGuidance.js";
import { ACTION_PAUSE_MAIN_GOAL, ACTION_BLOCK_MAIN_GOAL } from "./assistantContracts.js";
import { randomUUID } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { conversationConfiguration } from "./conversationConfiguration.js";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { readProjectPreview, sendProjectMessage } from "./projectMessage.js";
import { createProjectServices } from "./projectServices.js";
import {
  appCredentialContext,
  createVibe64ConversationExecution,
  homeEnvForUser,
  operatorCliCommand
} from "@local/vibe64-execution/server";
import {
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { nativeConversationBindings } from "./nativeConversationRetirement.js";
import { manageWorkPlan, readWorkPlanPage } from "./assistantWorkPlan.js";
import { assertSessionRepositoryReview, sessionConnectedContribution, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { createClaudeConversationHost } from "./agent/providers/claudeConversationHost.js";
import { claudeNativeMessageId } from "@jskit-ai/assistant-core/server/claude-turn";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { createAssistantRouting } from "./assistantRouting.js";
import { assistantGoalObjective, assistantMainAiChanged, assistantRoutingFromMetadata, assistantRoutingGoalFromMetadata, assistantRoutingRequestFromMetadata, assistantRoutingStatusIsPending, goalStatusIsComplete } from "@local/vibe64-runtime/shared/assistantRouting";
import { createSessionConversations } from "./sessionConversations.js";
import {
  createSessionConversationBinding,
  prepareSessionConversationActivity,
  prepareSessionConversationCreation,
  prepareSessionConversationRenewal,
  prepareSessionConversationRenewalProof,
  prepareSessionConversationReadiness,
  prepareSessionConversationSettings,
  prepareSessionConversationDisposal,
  prepareProjectConversationCleanup,
  prepareConversationRuntimeInvalidation,
  prepareConversationReconciliation,
  prepareConversationSubscriptionReset,
  prepareSessionDetachedConversationCleanup,
  prepareSessionDetachedConversationRun,
  prepareSessionConversationStorage,
  CLAUDE_PREPARATION_DELIVERY_STAGES
} from "./mainConversationBinding.js";
import { closeAssistantForChangeover, rememberAssistantBeforeChangeover, replaceNativeConversation, requireCompletedConversationRewind, requireCompletedNativeConversationReplacement } from "./assistantChangeover.js";
import { createSessionAttachments } from "./sessionAttachments.js";
import { createProviderUsage } from "./providerUsage.js";
import {
  createSessionAgentManager
} from "./agent/sessionAgentManager.js";
import process from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createAgentEnvCommandService } from "./agentEnvCommand.js";
import { createAgentDatabaseCommandService } from "./agentDatabaseCommand.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createAgentSessionCommandService } from "./agentSessionCommand.js";
import { closeAgentSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { createCodexGitCommandService, removeCodexGitCommandSession } from "./codexGitCommand.js";
import {
  changeIncomingContribution as changeManagedIncomingContribution,
  inspectIncomingContributions as inspectManagedIncomingContributions
} from "./sessionIncomingContributions.js";
import {
  checkSessionUpdates as checkManagedSessionUpdates,
  readSessionAuthorityHeads as readManagedSessionAuthorityHeads,
  recoverSessionWorkUpdate as recoverManagedSessionWorkUpdate,
  updateSessionWork as updateManagedSessionWork
} from "./sessionWorkUpdate.js";
import {
  inspectSessionChangeDiff as inspectManagedSessionChangeDiff,
  inspectSessionChanges as inspectManagedSessionChanges,
  inspectSessionWork as inspectManagedSessionWork,
  prepareSessionPullRequestBranch,
  prepareSessionWorkSaveMessage as prepareManagedSessionWorkSaveMessage,
  recoverSessionWorkSave as recoverManagedSessionWorkSave,
  retireSessionWorkSave as retireManagedSessionWorkSave,
  saveSessionWork as saveManagedSessionWork
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
  genesisProjectContractNeedsAttention,
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
  currentProjectActionRequestMeta,
  currentProjectRequestContext,
  runWithProjectRequestContext,
  currentProjectScopeKey
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
  vibe64AgentRunStateIsActive
} from "@local/vibe64-runtime/server/sessionStore";
import {
  sessionIsClosing
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  agentWriteBusyError,
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive,
  throwIfAgentWriteBusy
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  findVibe64AgentProvider,
  resolveVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantConversationKey,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { createWorkspaceSetupRunner } from "./workspaceSetup.js";
import { createCodexSessionRegistration } from "./codexSessionRegistration.js";
import { createOpenCodeSessionRegistration } from "./openCodeSessionRegistration.js";
import {
  defineSessionRenewalHandoverText,
  sessionRenewalManualHandoverTemplate
} from "./sessionRenewalHandover.js";
import {
  createSessionPromptHintsService
} from "./sessionPromptHints.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

// The runtime proved this message never reached the assistant. Say so in the
// response, so the browser shows the failure instead of an uncertain receipt.
// Only Vibe64's own coded failures keep their message; internal ones do not.
function notSentDeliveryError(error, messageId) {
  const delivery = { status: "not-sent", messageId };
  const status = Number(error.status || error.statusCode);
  // conversation_* codes are the shared conversation protocol's definite
  // rejections; the browser recovers from them by code.
  const readable = error instanceof AppError || /^(vibe64|conversation)_/u.test(String(error.code || ""));
  return new AppError(status >= 400 && status < 500 ? status : 422,
    readable ? error.message : "The message was not sent because Vibe64 could not prepare it. Your chat is saved; try again.", {
      code: readable ? error.code : "vibe64_assistant_message_not_sent",
      details: { ...(readable && error.details && typeof error.details === "object" ? error.details : {}), delivery }
    });
}

const AGENT_WRITE_WAIT_MS = 60_000;
const MAIN_AI_CHANGED_GOAL_NOTICE = "Goal cancelled because the main AI changed in AI setup. The work done so far is kept. " +
  "To continue, choose Goal → Set goal and start it again; it will run on the new main AI.";

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

function ephemeralInput(input = {}) {
  return { ...input, ephemeral: input.persistent !== true };
}

function realtimeDebugEnabled(env = {}) {
  return ["1", "true", "yes", "on"].includes(String(env.JSKIT_REALTIME_DEBUG || "").trim().toLowerCase());
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
    .map((session) => sessionRecordId(session))
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

// Every step runs even after an earlier one fails, so one helper whose cleanup
// cannot finish never leaves the session's services, AI or commands running.
// The failure then names each step that failed, keeping a single step's fields.
async function closeTerminalControllersForSession(sessionId = "", controllers = [], {
  controllerOptions = {},
  eventPrefix = "server.terminals.closeSessionTerminals",
  logger = null
} = {}) {
  let closed = 0;
  const failures = [];
  for (const entry of controllers) {
    try {
      const result = await closeTerminalControllerForSession({
        ...entry,
        controllerOptions,
        eventPrefix,
        sessionId
      });
      if (result?.ok === false) {
        throw Object.assign(new Error(result.error || `Session ${entry.label} could not be stopped.`), {
          code: result.code || "vibe64_session_stop_failed"
        });
      }
      closed += Number(result?.closed || 0);
    } catch (error) {
      failures.push({ controller: entry.label, error });
      logOperationalEvent(logger, "warn", {
        component: "vibe64.session_close", event: "vibe64.session_close.step_failed",
        sessionId, controller: entry.label, code: error?.code || "", error: error?.message || String(error)
      }, "A session cleanup step failed; the remaining steps still ran.");
    }
  }
  if (failures.length) {
    const message = failures.map(({ controller, error }) =>
      `${controller}: ${error?.message || String(error) || "Cleanup failed."}`).join(" ");
    const [only] = failures;
    const labelled = { controllers: failures.map(({ controller }) => controller), sessionId };
    // A single failure keeps its own fields (code, statusCode, retryable...);
    // several keep any step's refusal of a retry.
    if (failures.length === 1) {
      const { cause: _cause, ...fields } = typeof only.error === "object" && only.error ? only.error : {};
      throw Object.assign(new Error(message, { cause: only.error }), fields,
        { code: only.error?.code || "vibe64_session_stop_failed" }, labelled);
    }
    throw Object.assign(new AggregateError(failures.map(({ error }) => error), message), {
      code: "vibe64_session_stop_failed",
      ...(failures.some(({ error }) => error?.retryable === false) ? { retryable: false } : {})
    }, labelled);
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
  inspectAgentSkills = inspectGenesisSkills,
  logger = null,
  opencodeTerminalController = {},
  projectServices: suppliedProjectServices = null,
  projectService,
  publishProjectRuntimeChanged = async () => null,
  publishSessionChanged = {},
  runCodexGitGatewayCommand
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires vibe64.project.");
  }
  const previewDiagnostics = createPreviewDiagnosticRecorder({ logger });
  const goalRuntimeId = randomUUID();
  const goalAdmissions = new Map();
  let goalRecovery;
  const projectRuntimeOpenOperations = new Map();
  const projectServices = suppliedProjectServices || createProjectServices();
  let assistantRouting;
  let sessionConversations;
  const turnCompletions = new Set();
  let closing = false;
  // Server shutdown happens once. Its signal stops discarded background AI
  // work (session naming); its one stop of every AI runtime is shared by each
  // feature that needs AI stopped before its own cleanup.
  const shutdownSignal = new AbortController();
  let shutdownStop = null;

  // The one Claude Code account status read, with the inputs Claude
  // conversations run with. Accounts and readiness read it too, so one
  // account costs one status read per cache period.
  const readClaudeAccountStatus = () => readClaudeCodeAuthStatus({ env });
  const assistantRuntime = {
    claudeConnectionStatus: async () => (await readClaudeAccountStatus()).loggedIn === true,
    codexConnectionStatus: async () => true,
    listConnections: async () => [],
    readAssistantAccess: async () => ({ ownerOnly: false }),
    resolveAssistantUser: async (user) => user || currentProjectRequestContext()?.vibe64User || null,
    createActionContext: (actor) => ({ surface: "app", channel: "internal", requestMeta: { request: { vibe64User: actor } } }),
    authorizeProjectMessage: async (actor) => actor,
    resolveConnection: async () => null,
    updateModelAccess: null
  };

  let databaseToolsProvider = null;
  let sourceEditorProvider = null;
  let connectedPreparation = null;
  let planCompleted = null;
  const workspaceSetup = createWorkspaceSetupRunner({
    projectService,
    connectedPreparation: options => {
      if (typeof connectedPreparation !== "function") throw new Error("Connected workspace preparation is unavailable.");
      return connectedPreparation(options);
    }
  });
  const publishAgentSessionChanged = async (sessionId, payload = {}) => {
    if (!closing) {
      providerUsage.observe(currentProjectScopeKey(), sessionId, payload, () => {
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
      // A goal's automatic continuation follows each of its turns.
      cancelGoalIfMainAiChanged(sessionId, null, { activeOnly: true }).catch((error) => {
        logOperationalEvent(logger, "warn", { component: "vibe64.agent_goal", event: "vibe64.agent_goal.main_ai_cancel_failed", sessionId, code: error.code }, "A goal on the previous main AI could not be cancelled.");
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
    projectService,
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
      return prepareWorkspaceSetup(sessionId, {
        publish: true, rerunFailed: context.rerunFailedSetup === true, waitForCompletion: true
      });
    },
    projectService,
    stopPreviewBrowsers: (sessionId) => agentPreviewCommand.stopBrowsersForSession(sessionId),
    publishSessionChanged: publishSessionChanged.outputTarget,
    sessionAdmissionFailure: (sessionId) => sessionTerminalAdmissionFailure(sessionId, "output")
  });
  agentPreviewCommand = createAgentPreviewCommandService({
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
    retryWorkspaceSetup: sessionId => prepareWorkspaceSetup(sessionId, { publish: true, retry: true }),
    readProjectPreview: input => readProjectPreview(input, {
      projectService,
      authorize: (actor, slug) => assistantRuntime.authorizeProjectMessage(actor, slug),
      assertOpen: () => projectServices.assertOpen(projectRuntimeContext()),
      launchTarget: outputTarget
    }),
    sendProjectMessage: input => sendProjectMessage(input, {
      projectService,
      publish: publishAgentSessionChanged,
      authorize: (actor, slug) => assistantRuntime.authorizeProjectMessage(actor, slug),
      assertOpen: () => projectServices.assertOpen(projectRuntimeContext()),
      prepare: async (sessionId, options) => {
        const access = await service.inspectAssistantAccess(sessionId, options);
        if (access.available !== true || access.canUse !== true) {
          throw vibe64Error(access.disabledReason || "The selected session has no available assistant.", "vibe64_project_message_assistant_unavailable");
        }
        const { runtime: openState } = await currentProjectRuntimeOpenState();
        projectServices.assertOpen(projectRuntimeContext());
        const destination = options.requireSelectedSession
          ? await options.runtime.store.readCurrentSession()
          : await options.runtime.store.readSession(sessionId);
        if (!openState.open || destination?.sessionId !== sessionId ||
            (!options.requireSelectedSession && destination.status !== VIBE64_SESSION_STATUS.ACTIVE)) {
          throw vibe64Error("The destination closed, became unavailable or its selected session changed. Check it before sending again.", "vibe64_project_message_destination_changed");
        }
      },
      send: (sessionId, message, options) => service.sendAgentMessage(sessionId, message, options),
      reportFailure: (error, receipt) => logger?.warn({
        event: "vibe64.project_message.delivery_failed", error: error.message, code: error.code,
        sourceProject: input.sourceProject, sourceSession: input.sourceSession, ...receipt
      }, "Accepted project message failed during asynchronous delivery.")
    }),
    reportWorkflowOutcome: (sessionId, input, options) => assistantRouting.recordOutcome(sessionId, input, options),
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    projectService
  });
  const codexProviderOptions = selfTargetCodexAppServerProviderOptions({ codexTerminalController, env });
  const codexProviderConnections = createCodexProviderConnectionStore({ systemRoot: codexProviderOptions.systemRoot });
  const providerUsage = createProviderUsage({
    resolveConnection: (selection) => selection.engineId === "opencode"
      ? assistantRuntime.resolveConnection(selection)
      : codexProviderConnections.read(selection.modelProviderId, selection.engineId)
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
    // Discovery adds an identity envelope to each bounded result.
    maxToolResultBytes: 128 * 1024 + 1024,
    // Main's application tools are Claude goal control only.
    isActionAvailable: ({ actionId, context }) => [ACTION_PAUSE_MAIN_GOAL, ACTION_BLOCK_MAIN_GOAL].includes(actionId) &&
      Boolean(!context.runtime?.learningScope && context.assistantSelection?.engineId === "claude" &&
        (context.browserAuthority || context.mainGoalControl) && !context.temporaryConversationId &&
        !context.assistantScope && !context.scopedConversationId)
  }) : null;
  function applicationToolManifest(context) {
    // Tools decorate the context; a missing selection must not block cleanup.
    const selection = context.assistantSelection ||
      vibe64AssistantSelectionFromMetadata(context.session?.metadata, { required: false });
    const mainClaude = selection?.engineId === "claude" && !context.runtime?.learningScope &&
      !context.assistantScope && !context.temporaryConversationId && !context.scopedConversationId;
    if (!mainToolCatalog || !mainClaude) return context;
    const toolSet = mainToolCatalog.resolveToolSet(context, { discoveryOnly: true });
    return { ...context, applicationTools: { schemas: toolSet.tools.map(mainToolCatalog.toOpenAiToolSchema) } };
  }
  const mainConversations = createConversationRuntime({
    engine: "codex",
    hostDeliveryStages: CLAUDE_PREPARATION_DELIVERY_STAGES,
    onDeliveryTiming(event) {
      const slow = event.elapsedMs >= 1000 && ["accepted", "first-response"].includes(event.stage);
      logOperationalEvent(logger, slow || event.stage === "failed" ? "warn" : "info", {
        event: "vibe64.agent_message.delivery_timing", component: "vibe64.agent_message",
        sessionId: event.conversationId, engineId: event.engine, messageId: event.messageId,
        stage: event.stage, previousStage: event.previousStage,
        durationMs: event.durationMs, elapsedMs: event.elapsedMs, timings: event.timings
      }, "Assistant delivery timing.");
    },
    ...(mainToolCatalog ? { toolCatalog: mainToolCatalog } : {}),
    async authorize({ context, conversationId, operation }) {
      if (context?.sessionId !== conversationId) return false;
      const authority = context.browserAuthority;
      if (!authority) return true; // Existing, already-authorized manager callers.
      if (!actions || authority.sessionId !== conversationId) return false;
      // Delayed publications retain CONTROL identity, never a cached access grant.
      const readGrant = () => actions.execute({
        actionId: "vibe64.sessions.conversation.context.read",
        input: { projectSlug: authority.projectSlug, sessionId: conversationId },
        context: authority.requestContext
      });
      const started = performance.now();
      let allowed = false;
      try {
        const grant = await (context.browserProjectContext
          ? runWithProjectRequestContext(context.browserProjectContext, readGrant) : readGrant());
        allowed = grant.actor.id === authority.actorId;
        return allowed;
      } finally {
        const durationMs = performance.now() - started;
        // Stream publications also reauthorize as "subscribe". Retain slow or
        // denied checks without adding a log write for every healthy token.
        if ((operation !== "subscribe" || !allowed || durationMs >= 100) &&
            realtimeDebugEnabled(env)) {
          logOperationalEvent(logger, "warn", { event: "vibe64.conversation.browser_timing",
            sessionId: conversationId, phase: "authorization", operation, allowed,
            durationMs }, "Browser conversation authorization timing.");
        }
      }
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
          if (operation !== "create" && operation !== "ensure" && operation !== "updateSettings" && operation !== "dispose" &&
              operation !== "generateRenewalHandover" && operation !== "seedRenewalHandover" && context.temporaryConversationId && !context.scopedConversationId && !context.assistantScope) {
            return sessionConversations.conversationBinding(id, context);
          }
          const engine = context.providerId || context.assistantSelection?.engineId || vibe64AssistantSelectionFromMetadata(context.session?.metadata).engineId;
          const provider = sessionAgent.conversationProvider(engine, "codex");
          if (operation === "generateRenewalHandover" || operation === "seedRenewalHandover") {
            return prepareSessionConversationRenewal(provider, id, context, input);
          }
          if (operation === "create") return prepareSessionConversationCreation(provider, id, context, input);
          if (operation === "ensure") return prepareSessionConversationReadiness(provider, id, applicationToolManifest(context));
          if (operation === "updateSettings") return prepareSessionConversationSettings(provider, id, context);
          if (operation === "dispose") return prepareSessionConversationDisposal(provider, id, context, input);
          // Scoped work already has its own authorized host and native identity;
          // opening its existing handle must not hydrate a project session.
          if (context.assistantScope) return createSessionConversationBinding(provider, id, context);
          const runtime = context.runtime || await projectService.createRuntime({ inspectSource: false });
          const binding = await createSessionConversationBinding(provider, id, {
            ...context, runtime,
            prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
          });
          if (engine === "claude" && !runtime.learningScope && !binding.native?.scoped && !context.temporaryConversationId && actions) {
            binding.applicationTools = {
              storage: runtime.store.conversationStorage,
              async prepareContext(current, admitted) {
                const authority = current.browserAuthority;
                if (!authority || authority.sessionId !== id || admitted.conversationId !== id ||
                    admitted.origin !== "user" || !admitted.nativeThreadId || !admitted.nativeTurnId) {
                  throw Object.assign(new Error("Goal control requires the current admitted Main request."), {
                    code: "vibe64_main_goal_control_required", statusCode: 403
                  });
                }
                const grant = await actions.execute({ actionId: "vibe64.sessions.conversation.context.read",
                  input: { projectSlug: authority.projectSlug, sessionId: id }, context: authority.requestContext });
                if (grant.actor.id !== authority.actorId) throw new Error("The Main conversation's acting user changed.");
                await service.requireAssistantSelectionAccess(current.assistantSelection, { vibe64User: grant.user });
                admitted.assertCurrent();
                async function retainGoal(action, reason) {
                  const options = { runtime, vibe64User: grant.user };
                  const observed = await service.readAgentGoal(id, options);
                  if (observed.threadId !== admitted.nativeThreadId || !observed.goal || observed.goal.status !== "active") {
                    throw new Error("This admitted Main turn no longer owns an active goal.");
                  }
                  admitted.assertCurrent();
                  const result = await service.updateAgentGoal(id, { ...options, action, reason,
                    threadId: observed.threadId, createdAt: observed.goal.createdAt, objective: observed.goal.objective });
                  const status = action === "block" ? "blocked" : "paused";
                  if (result?.ok === false || result?.goal?.status !== status) {
                    throw new Error(result?.error || `The goal ${action} could not be verified.`);
                  }
                  return { status };
                }
                return { ...authority.requestContext, runtime, assistantSelection: current.assistantSelection,
                  projectSlug: authority.projectSlug,
                  mainGoalControl: {
                    pause: () => retainGoal("pause"),
                    block: ({ reason }) => retainGoal("block", reason)
                  }
                };
              }
            };
          }
          return binding;
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
    env,
    getAssistantManager: () => sessionAgent,
    listConnections: (context) => assistantRuntime.listConnections(context),
    logger,
    projectService,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    resolveConnection: (context) => assistantRuntime.resolveConnection(context),
    runNativeDetachedConversation
  });
  const sessionAttachments = createSessionAttachments({ projectService, env });
  const claudeProvider = createClaudeConversationHost({
    env, projectService, logger, publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event),
    systemRoot: codexProviderOptions.systemRoot,
    runNativeDetachedConversation,
    codexGitCommand, agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
    accountStatus: readClaudeAccountStatus,
    connectionStatus: (context) => assistantRuntime.claudeConnectionStatus(context)
  });
  const readRoutingConfiguration = () => createAssistantRoutingStore({ systemRoot: codexProviderOptions.systemRoot }).read();
  const sessionAgent = createSessionAgentManager({
    attachments: sessionAttachments,
    conversationRuntime: mainConversations,
    readProviderUsage: providerUsage.read,
    resolveAssistantUser: (user) => assistantRuntime.resolveAssistantUser(user),
    readRoutingConfiguration,
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
        const available = connection?.connected === true;
        return {
          available,
          connectionIdentity: connection?.connectionIdentity || "",
          missingAccountLabel: available ? "" : curated.label,
          ownerOnly: curated.ownerOnly,
          endpointCode: curated.id
        };
      }
      const available = await assistantRuntime.codexConnectionStatus(context);
      const missingAccountLabel = available ? "" : findVibe64AgentProvider("codex").accountLabel;
      try {
        return { ...await codex.accounts.assistantAccess(context), available, missingAccountLabel };
      } catch (error) {
        if (available) throw error;
        return { available: false, missingAccountLabel, ownerOnly: true, connectionIdentity: "" };
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
    return sessionAgent.closeSession(sessionId, options);
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
    const closed = await closeAssistantForChangeover(sessionAgent, sessionId, context);
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

  const sessionNaming = createSessionNaming({ agent: sessionAgent, publishSessionChanged: publishAgentSessionChanged, logger,
    signal: shutdownSignal.signal });
  assistantRouting = createAssistantRouting({
    systemRoot: codexProviderOptions.systemRoot, agent: sessionAgent,
    exclusive: async (sessionId, options, operation) => {
      const result = await runMainAgentWrite(sessionId, options, operation,
        { operation: "assistant-routing", waitMs: options.lockWaitMs ?? AGENT_WRITE_WAIT_MS });
      return throwIfAgentWriteBusy(result);
    },
    publish: publishAgentSessionChanged,
    prepareSelection: prepareRoutingSelection,
    // The Save owner supplies what follows a completed plan (automatic save).
    onPlanCompleted: (sessionId, input) => planCompleted?.(sessionId, input) || "",
    onTiming(event) {
      // Timing is diagnostic only; a failing log sink must not fail the send.
      try {
        logOperationalEvent(logger, event.elapsedMs >= 1000 ? "warn" : "info", {
          event: "vibe64.agent_message.routing_timing", component: "vibe64.agent_message", ...event
        }, "Assistant routing timing.");
      } catch {
        // Ignore: timing diagnostics are best-effort.
      }
    },
    async dispatch(sessionId, input, context) {
      requireCompletedConversationRewind(context.session);
      await prepareAgentSkillsInsideAgentWrite(sessionId, context);
      // A Main send needs the session's durable selection; this refuses without one.
      vibe64AssistantSelectionFromMetadata(context.session.metadata);
      return sessionAgent.sendMessage(sessionId, input, context);
    }
  });

  async function runMainAgentWrite(sessionId = "", options = {}, operation, lockOptions = {}) {
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const lockStartedAt = performance.now();
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      async () => {
        if (options.deliveryMessageId) {
          const durationMs = performance.now() - lockStartedAt;
          logOperationalEvent(logger, durationMs >= 1000 ? "warn" : "info", {
            event: "vibe64.agent_message.lock_acquired", component: "vibe64.agent_message",
            sessionId, messageId: options.deliveryMessageId, operation: lockOptions.operation, durationMs
          }, "Assistant message acquired its application write lock.");
        }
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
      const request = assistantRoutingRequestFromMetadata(context.session.metadata);
      if (sessionHasActiveAgentRun(context.session) || assistantRoutingStatusIsPending(request) ||
          request?.status === "working" && request.workflow) {
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
    const projectRoot = sessionSourcePath(context.session);
    if (!projectRoot || !existsSync(path.join(projectRoot, GENESIS_BLUEPRINT_PATH))) return;
    const temporary = await sessionAgent.hasActiveTemporaryConversation(sessionId, {}, context);
    if (temporary.active) return;
    const format = await inspectGenesisProjectFormat({ projectRoot });
    if (format.status !== "current") return;
    if (isPracticeProjectRuntime(context.runtime)) await excludeAgentGuidanceFromPracticeHistory(projectRoot);
    let inspection;
    try {
      inspection = await inspectAgentSkills({ projectRoot });
    } catch (error) {
      if (genesisProjectContractNeedsAttention(error)) {
        logOperationalEvent(logger, "warn", {
          code: error.code,
          component: "vibe64.agent_skills",
          event: "vibe64.agent_skills.refresh_deferred",
          sessionId
        }, "Project contracts need repair or a project decision; skill refresh deferred so chat remains available.");
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

  // The project runtime and session a call works on: the caller's runtime and
  // session when given (the session only when it is this one), else fresh reads.
  async function sessionContext(sessionId = "", input = {}) {
    const runtime = input.runtime || await projectService.createRuntime({ inspectSource: false });
    const session = input.session?.sessionId === sessionId
      ? input.session
      : await runtime.getSession(sessionId, { inspectSource: false });
    return { runtime, session };
  }

  async function readAssistantSession(sessionId = "", options = {}) {
    return { ...options, ...await sessionContext(sessionId, options) };
  }

  async function assistantSessionOptions(sessionId = "", options = {}) {
    return applicationToolManifest(await readAssistantSession(sessionId, options));
  }

  function readGoalIntent(session) {
    const intent = JSON.parse(session.metadata?.assistant_goal_intent || "null");
    if (intent && (intent.version !== 1 || typeof intent.active !== "boolean" || !intent.id)) {
      throw new Error("Saved goal continuation intent is invalid. Inspect it before resuming.");
    }
    return intent;
  }

  async function changeGoalIntent(sessionId, context, change) {
    const result = await context.runtime.store.runSessionExclusive(sessionId, "assistant-settings", async () => {
      const latest = readGoalIntent(await context.runtime.getSession(sessionId, { inspectSource: false }));
      const changed = change(latest);
      if (changed) await context.runtime.store.writeMetadataValue(sessionId, "assistant_goal_intent", JSON.stringify(changed));
    }, { operation: "save-goal-continuation", waitMs: 10_000 });
    if (!result.acquired) throw new Error("Goal continuation settings are busy. Try the control again.");
  }

  async function stopGoalIntent(sessionId, context, expectedId) {
    await changeGoalIntent(sessionId, context, intent => {
      if (!intent?.active || expectedId && intent.id !== expectedId) return null;
      goalAdmissions.get(intent.id)?.abort(new Error("Goal continuation was stopped before dispatch."));
      return { ...intent, active: false, error: null };
    });
  }

  async function completeGoalIntent(sessionId, context, intent, result) {
    if (!intent || result?.ok === false || !result.goal) return;
    // Explicit Stop/Pause can run while native acknowledgement is outstanding.
    await changeGoalIntent(sessionId, context, latest => {
      if (!latest?.active || latest.id !== intent.id) return null;
      if (latest.pending?.messageId && latest.selection?.engineId === "claude" &&
          result.goalCommandId !== claudeNativeMessageId(latest.pending.messageId)) {
        throw new Error("The accepted goal command is still waiting for its own native goal attachment. Check its original receipt before retrying.");
      }
      const segment = latest.pending?.expectedSegmentId;
      const prefix = `${latest.selection?.engineId}:`;
      const threadId = result.threadId || result.goal.threadId || latest.native?.threadId ||
        (typeof segment === "string" && segment.startsWith(prefix) ? segment.slice(prefix.length) : null);
      if (!threadId) throw new Error("The accepted goal's native conversation identity is unavailable.");
      return { ...latest, daemonId: goalRuntimeId, pending: null, error: null,
        native: { threadId, createdAt: result.goal.createdAt, objective: result.goal.objective },
        active: !goalStatusIsComplete(result.goal.status) };
    });
  }

  // A goal never continues on a main AI the owner has since replaced in AI
  // setup: the next time it would continue, it is cancelled through the
  // ordinary Cancel goal path and the chat says why. A Custom goal runs the
  // person's own model, and a paused goal is checked when it is resumed.
  async function cancelGoalIfMainAiChanged(sessionId, vibe64User = null, { activeOnly = false } = {}) {
    const context = await assistantSessionOptions(sessionId, { vibe64User });
    const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
    if (!pinned || pinned.mode === "custom") return false;
    if (activeOnly ? pinned.status !== "active" : goalStatusIsComplete(pinned.status)) return false;
    if (!assistantMainAiChanged(pinned.configuration?.owner, (await readRoutingConfiguration()).owner)) return false;
    const observed = await service.readAgentGoal(sessionId, context);
    if (observed?.status !== "available" || !observed.goal || goalStatusIsComplete(observed.goal.status)) return false;
    const result = await service.updateAgentGoal(sessionId, { vibe64User, action: "cancel",
      threadId: observed.threadId, createdAt: observed.goal.createdAt, objective: observed.goal.objective });
    if (result?.ok === false) throw Object.assign(new Error(result.error || "The goal could not be cancelled."), result);
    const turn = await context.runtime.store.writeConversationSystemMessage(sessionId, {
      messageId: `main-ai-changed-goal-cancelled:${randomUUID()}`, text: MAIN_AI_CHANGED_GOAL_NOTICE });
    await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed",
      ...(turn ? { payload: { conversationLogPatch: { type: "upsert-turn", turn } } } : {}) });
    return true;
  }

  async function recoverSessionGoal(sessionId) {
    let context = await assistantSessionOptions(sessionId);
    let intent = readGoalIntent(context.session);
    if (!intent?.active || intent.daemonId === goalRuntimeId || sessionIsClosing(context.session) ||
        context.session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) return { sessionId, skipped: true };
    requireCompletedNativeConversationReplacement(context.session);
    requireCompletedConversationRewind(context.session);
    if (!Object.hasOwn(intent, "connectionIdentity")) {
      throw new Error("Goal preparation was interrupted before its AI connection was verified. Resume the intended goal explicitly.");
    }
    const actor = await assistantRuntime.authorizeProjectMessage(intent.actor, projectRuntimeContext().projectSlug);
    const pin = assistantRoutingGoalFromMetadata(context.session.metadata);
    context = { ...context, vibe64User: actor, assistantSelection: pin?.selection || intent.selection,
      expectedConnectionIdentity: intent.connectionIdentity };
    await sessionAgent.requireAssistantAccess(sessionId, context);
    // Native reconciliation retains custody until the previous execution is
    // verified stopped. It never starts inference or resumes a goal itself.
    const recovered = await sessionAgent.reconcileSessions([context.session], context);
    const failed = value => value?.ok === false || value?.failed?.length || value?.results?.some(failed);
    if (failed(recovered)) throw new Error("The goal's previous execution could not be verified stopped.");
    const native = await sessionAgent.readGoal(sessionId, context);
    if (native.status !== "available") throw new Error("The goal is unavailable after restart. Retry its status before resuming.");
    if (intent.pending) {
      const messageId = intent.pending.messageId;
      let accepted = messageId && await context.runtime.store.conversationMessageIdExists(sessionId, messageId);
      if (!accepted && messageId) {
        const receipt = await sessionAgent.inspectMessageAdmission(sessionId, { messageId, threadId: native.threadId }, context);
        accepted = receipt?.ok !== false && receipt?.admission === "accepted";
      }
      if (!accepted) throw new Error("The interrupted goal command's delivery is uncertain. Check its original receipt before resuming.");
      // The native history owner links this attachment to the exact authored
      // command. Its condition text alone is never sufficient for adoption.
      if (intent.selection?.engineId === "claude") {
        if (!native.goal || native.goalCommandId !== claudeNativeMessageId(messageId)) {
          throw new Error("The accepted goal command is still waiting for its own native goal attachment. Check its original receipt before retrying.");
        }
        await completeGoalIntent(sessionId, context, intent, native);
        const latest = readGoalIntent(await context.runtime.getSession(sessionId, { inspectSource: false }));
        if (latest?.id !== intent.id) throw new Error("Goal continuation changed while its attachment was being checked.");
        intent = latest;
      }
    }
    if (!native.goal || goalStatusIsComplete(native.goal.status)) {
      // An unresolved Set may have been accepted without its goal attachment
      // reaching storage. Its existing receipt must not be replaced by a send.
      if (intent.pending) throw new Error("The interrupted goal command needs its saved delivery receipt checked.");
      await stopGoalIntent(sessionId, context, intent.id);
      return { sessionId, completed: true };
    }
    if (!intent?.active || intent.native?.threadId !== native.threadId ||
        intent.native?.createdAt !== native.goal.createdAt || intent.native?.objective !== native.goal.objective) {
      throw new Error("The native goal changed after continuation was requested. Resume the intended goal explicitly.");
    }
    if (native.goal.status === "blocked") {
      return { sessionId, blocked: true, reason: native.goal.reason };
    }
    if (native.goal.status === "active") {
      const current = await sessionAgent.sessionState(sessionId, context);
      if (current?.ok !== false && current.turn?.active === true && current.thread?.id === native.threadId) {
        await completeGoalIntent(sessionId, context, intent, native);
        return { sessionId, alreadyActive: true };
      }
    }
    const observed = await service.readAgentGoal(sessionId, { vibe64User: actor }, { canonical: true });
    if (!observed.goal || goalStatusIsComplete(observed.goal.status)) return { sessionId, completed: true };
    const result = await service.updateAgentGoal(sessionId, { action: "resume", vibe64User: actor,
      expectedSegmentId: observed.target.segmentId, expectedGoalId: observed.goal.id,
      messageId: `goal-restart-${randomUUID()}` }, { canonical: true, restartIntentId: intent.id });
    if (result?.code === "vibe64_goal_main_ai_changed") return { sessionId, cancelled: true };
    if (result?.ok === false) throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
    return { sessionId, resumed: true };
  }

  async function applyAgentGoalReadResult(sessionId, context, result) {
    const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
    const recoveryError = readGoalIntent(context.session)?.error;
    if (recoveryError) result = { ...result, error: recoveryError };
    if (result.status === "available" && (!result.goal || goalStatusIsComplete(result.goal.status))) {
      const intent = readGoalIntent(context.session);
      if (intent?.active && !intent.pending) await stopGoalIntent(sessionId, context, intent.id);
    }
    if (pinned && result.status === "available") {
      // A new goal can become visible before Set acknowledgement saves its pin.
      // Only accepted Set/Resume may replace or reactivate a completed pin.
      if (result.goal && (assistantGoalObjective(result.goal.objective, pinned) !== pinned.objective ||
          goalStatusIsComplete(pinned.status) && !goalStatusIsComplete(result.goal.status))) return result;
      const status = result.goal?.status || "complete";
      if (pinned.status !== status) {
        await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({ ...pinned, status }));
        await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
      }
      if (result.goal) return { ...result, goal: { ...result.goal,
        objective: assistantGoalObjective(result.goal.objective, pinned) },
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
    if (!exclusive.acquired) throw agentWriteBusyError(exclusive.value || undefined);
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
      "session-save",
      { createsCommits: true }
    );
    const project = await projectService.readCurrentProject();
    const destination = assertSessionRepositoryReview(project, session, input.destinationReview);
    const assertWorkflow = async () => {
      if (destination.mode !== "github") return;
      const workflow = await projectService.readRepositoryWorkflow();
      if (workflow.requirePullRequest && !sessionConnectedContribution(session) && !context.creatingPullRequest &&
          !JSON.parse(session.metadata?.github_pull_request || "null")?.number) {
        const error = new Error("This project requires a pull request. Create or open a pull request before saving this session.");
        error.code = "vibe64_pull_request_required";
        throw error;
      }
    };
    await assertWorkflow();
    const connectedWorkSnapshots = await input.assertConnectedWorkSaved?.();
    const saveMessageInput = await prepareManagedSessionWorkSaveMessage({
      commandOptions: execution.commandOptions,
      connectedWorkSnapshots,
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
      readConnectedWorkSnapshots: input.assertConnectedWorkSaved,
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
    return throwIfAgentWriteBusy(result);
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
    rerunFailed = false,
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
    const setup = await workspaceSetup.start({
      renewal,
      rerunFailed,
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
    // "global" names the runtime used when no project request context is set.
    const projectSlug = String(requestContext?.slug || "").trim() || "global";
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
    if (sessionSourcePath(session)) {
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
        const workdir = sessionSourcePath(session);
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
      const sessionId = sessionRecordId(session);
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
      const sessionId = sessionRecordId(session);
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
    projectScope = currentProjectScopeKey()
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
      // A session whose source was never created never ran its assistant, and
      // its assistant cannot read a conversation context to close.
      const assistantRan = controllerOptions.session?.sourceReady !== false || learningNativeAvailable;
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
        { controller: { closeAllForSession: (id) => projectServices.closeSession(projectRuntimeContext(), id) },
          label: "sessionServices" },
        ...(!controllerOptions.renewalCleanup && assistantRan ? [{
          controller: { closeAllForSession: async (id, options) =>
            sessionAgent.interruptTurn(id, {}, await assistantSessionOptions(id, options)) },
          label: "assistantTurn"
        }] : []),
        ...(assistantRan ? [{
          controller: {
            closeAllForSession: (id, options) => closeAgentSession(id, options)
          },
          label: "assistant"
        }] : []),
        ...(controllerOptions.forgetConversationBinding === true ? [{
          controller: { closeAllForSession: (id, options) => sessionConversations.retireTemporaryConversations(id, options) },
          label: "Temporary chats"
        }] : []),
        { controller: agentDatabaseCommand, label: "agentDatabase" },
        { controller: agentEnvCommand, label: "agentEnv" },
        { controller: agentPreviewCommand, label: "agentPreview" },
        { controller: agentSessionCommand, label: "agentSessionCommand" }
      ], {
        controllerOptions,
        logger
      });
    }).finally(() => providerUsage.forget(currentProjectScopeKey(), sessionId));
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
    // A session whose state cannot be read is named, and the project stays
    // open rather than closing on a guess; the other sessions are still read.
    const unreadable = [];
    const sessionStateFailure = (session, error) => {
      unreadable.push({ error: error instanceof Error ? error.message : String(error || "Session state is unreadable."),
        sessionId: sessionRecordId(session) });
    };
    if (sessions.some((session) => {
      try {
        return readGoalIntent(session)?.active === true;
      } catch (error) {
        sessionStateFailure(session, error);
        return false;
      }
    })) {
      return { dormant: false, ok: true, skipped: true, reason: "active-goal-intent", runtime,
        projectSlug: context.projectSlug, projectContextRoot: context.projectContextRoot };
    }
    if (sessions.some((session) => session.pinnedSessionId)) {
      return {
        dormant: false,
        ok: true,
        skipped: true,
        reason: "pinned-session",
        runtime,
        projectSlug: context.projectSlug,
        projectContextRoot: context.projectContextRoot
      };
    }
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
      // A session whose source was never created has run no assistant.
      if (session.sourceReady === false && session.purpose !== "learning") continue;
      let temporary;
      try {
        temporary = await sessionAgent.hasActiveTemporaryConversation(session.sessionId, {}, { session });
      } catch (error) {
        sessionStateFailure(session, error);
        continue;
      }
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
    if (unreadable.length > 0) {
      return {
        dormancy,
        dormant: false,
        error: `Idle close skipped: ${unreadable.length} session${unreadable.length === 1 ? "" : "s"} could not be checked.`,
        failed: unreadable,
        ok: false,
        projectSlug: context.projectSlug,
        reason: "session-state-unreadable",
        runtime,
        skipped: true,
        projectContextRoot: context.projectContextRoot
      };
    }
    vibe64SessionDebugLog("server.terminals.projectRuntime.dormantClose.start", {
      idleMs: dormancy.idleMs,
      lastActivityAt: dormancy.lastActivityAt,
      projectContextRoot: context.projectContextRoot,
      projectSlug: context.projectSlug,
    });
    const closeResult = await service.closeProjectRuntime({
      reason: PROJECT_RUNTIME_IDLE_TIMEOUT_REASON
    }, { dormant: true });
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

  // The Git actor an earlier Save already recorded, for its recovery or retirement.
  async function saveExecution(session, sessionId, purpose) {
    const execution = await codexGitCommand.sessionWorkSaveContext({
      session,
      sessionId: String(sessionId || "").trim()
    });
    if (execution?.ok === false) {
      throw Object.assign(new Error(execution.error || `The Git actor for ${purpose} is not available.`), {
        code: execution.code || "vibe64_session_save_actor_unavailable"
      });
    }
    return execution;
  }

  // A write that records commits (Save, Update, Merge contribution) passes
  // `createsCommits`, so its commands carry the author's own Git name and email.
  async function sessionWorkExecution(sessionId, input = {}, reason = "session-work", { createsCommits = false } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const read = await sessionContext(normalizedSessionId, input);
    const { runtime } = read;
    let { session } = read;
    const executionInput = { createsCommits, sessionId: normalizedSessionId, vibe64User: input.vibe64User || null };
    let execution = await codexGitCommand.sessionWorkSaveContext({
      ...executionInput,
      session
    });
    if (execution?.ok === false) {
      const sessionSourceRoot = sessionSourcePath(session);
      const recorded = sessionSourceRoot
        ? await writeSessionGitCommandActor({
            env,
            reason,
            runtime,
            session,
            sourceRoot: sessionSourceRoot,
            threadId: session.metadata?.agent_identity_conversation_id || "",
            vibe64User: input.vibe64User,
            workdir: sessionSourceRoot
          })
        : null;
      if (recorded?.ok !== false && recorded) {
        session = recorded.session || await runtime.getSession(normalizedSessionId, { inspectSource: false });
        execution = await codexGitCommand.sessionWorkSaveContext({
          ...executionInput,
          session
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
    // A temporary chat's routing waits for a sibling's assistant startup as long as Main chat does.
    routingWaitMs: AGENT_WRITE_WAIT_MS,
    // Always rereads the session; a conversation's caller may hold an older copy.
    readSessionContext: async (sessionId, options = {}) => ({
      ...options, ...await sessionContext(sessionId, { runtime: options.runtime })
    }),
    prepareAgentSkills: prepareAgentSkillsInsideAgentWrite,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation: event => mainConversations.publishNative(event)
  });
  const service = {
    ...sessionConversations,
    // A temporary send refused before admission uses Main's definite rejection.
    async startTemporaryConversationTurn(sessionId, input = {}, options = {}) {
      try {
        return await sessionConversations.startTemporaryConversationTurn(sessionId, input, options);
      } catch (error) {
        if (error?.delivery === "not-sent") throw notSentDeliveryError(error, input.messageId);
        throw error;
      }
    },
    readClaudeAccountStatus,
    async recordPreviewDiagnostic(sessionId, input) {
      // Action admission owns project access; read the exact existing session without preparing it.
      const { session } = await assistantSessionOptions(sessionId);
      return previewDiagnostics(input, { projectSlug: currentProjectRequestContext()?.slug || "",
        sessionId: session.sessionId });
    },
    configureAssistantRuntime(input = {}) {
      for (const name of [
        "claudeConnectionStatus",
        "codexConnectionStatus",
        "listConnections",
        "readAssistantAccess",
        "resolveAssistantUser",
        "createActionContext",
        "authorizeProjectMessage",
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
        if (input.session?.metadata?.github_pull_request || input.session?.metadata?.connected_contribution) {
          const session = input.session.metadata.renewed_from
            ? await input.store.readSessionForRenewal(input.session.sessionId)
            : await input.store.readSession(input.session.sessionId);
          const recorded = await writeSessionGitCommandActor({
            env,
            reason: input.session.metadata.connected_contribution
              ? "connected-contribution-session"
              : "pull-request-session",
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
    setConnectedPreparation(prepare) {
      if (typeof prepare !== "function") throw new TypeError("Connected preparation requires its Sessions owner.");
      connectedPreparation = prepare;
    },
    setPlanCompleted(handler) {
      if (typeof handler !== "function") throw new TypeError("Plan completion requires its Sessions owner.");
      planCompleted = handler;
    },

    setDatabaseToolsProvider(provider = null) {
      databaseToolsProvider = provider;
      agentDatabaseCommand.setDatabaseToolsProvider(provider);
    },

    setProductionEnvironmentProvider(provider = null) {
      agentEnvCommand.setProductionEnvironmentProvider(provider);
    },

    setSavedEnvValueProvider(provider = null) {
      agentEnvCommand.setSavedEnvValueProvider(provider);
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
      return workspaceSetup.isPrepared(await sessionContext(assertValidVibe64SessionId(sessionId)));
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
      await Promise.allSettled([goalRecovery]);
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
      // Practice projects are outside the catalogue but run Preview and agents
      // like any project; the dormant close reads each one's own open state.
      const results = [];
      const listedSlugs = new Set(projects.map((project) => project.slug));
      try {
        for (const slug of await projectService.listPracticeProjectSlugs?.() || []) {
          if (!listedSlugs.has(slug)) projects.push({ slug });
        }
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error || "Practice projects could not be listed."),
          ok: false
        });
      }
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
        eventPrefix: "server.terminals.closeSessionNonAgentTerminals",
        logger
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
      const { runtime, session } = await sessionContext(normalizedSessionId, input);
      const sessionSourceRoot = sessionSourcePath(session);
      if (!sessionSourceRoot) {
        return {
          code: "vibe64_session_git_command_actor_source_root_missing",
          error: "Vibe64 session source root is not available for Git command actor tracking.",
          ok: false
        };
      }
      return writeSessionGitCommandActor({
        env,
        reason: input.reason || "session-interaction",
        runtime,
        session,
        sourceRoot: sessionSourceRoot,
        threadId: session.metadata?.agent_identity_conversation_id || "",
        vibe64User: input.vibe64User || null,
        workdir: sessionSourceRoot
      });
    },

    async saveSessionWork(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, {
        operation: "save-session-work",
        activeCode: "vibe64_session_save_agent_active",
        activeMessage: "Wait for the assistant turn to finish before saving this work."
      }, (context) => saveSessionWorkInsideWrite(sessionId, input, context));
    },

    async runConnectedSessionSave(sessionId, input, operation) {
      return runSessionRepositoryWrite(sessionId, input, {
        operation: "save-connected-work",
        activeCode: "vibe64_session_save_agent_active",
        activeMessage: "Wait for the assistant turn to finish before saving connected work."
      }, operation);
    },

    // Internal server facility: callbacks are never accepted by an action or
    // model. Snapshot validation/installation remains with its content owner.
    async runConnectedSourcePreparation(sessionId, input, operation) {
      if (typeof operation !== "function") throw new TypeError("Connected preparation requires an internal source operation.");
      return runSessionRepositoryWrite(sessionId, input, { operation: "prepare-connected-sources" }, operation);
    },

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
          const sourceRoot = sessionSourcePath(session);
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
          sourceRoot: sessionSourcePath(session),
          workdir: sessionSourcePath(session),
          threadId: session.metadata?.agent_identity_conversation_id || "",
          vibe64User: input.vibe64User || null
        });
        if (recorded?.ok === false) {
          throw new Error(recorded.error || "Your GitHub identity is unavailable.");
        }
        session = recorded?.session || await runtime.getSession(sessionId, { inspectSource: false });
        const { execution } = await sessionWorkExecution(sessionId, { ...context, session }, "create-pull-request");
        await prepareSessionPullRequestBranch({
          connectedWorkSnapshots: await input.assertConnectedWorkSaved?.(),
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

    // The update probe's head read for the current project's open sessions. It
    // uses each session's recorded Git actor as stored; it never records one,
    // because no person asked for this read.
    async readRepositoryAuthorityHeads({ sessions = [] } = {}) {
      return readManagedSessionAuthorityHeads({
        executionFor: (session) => codexGitCommand.sessionWorkSaveContext({ session }),
        project: await projectService.readCurrentProject(),
        sessions
      });
    },

    async updateSessionWork(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, {
        operation: "update-session-work",
        activeCode: "vibe64_session_update_agent_active",
        activeMessage: "Wait for the assistant turn to finish before updating this session."
      }, async (context) => {
        const { execution, session } = await sessionWorkExecution(sessionId, context, "session-update", { createsCommits: true });
        return updateManagedSessionWork({
          beforeSourceChange: () => invalidateWorkspaceSetup(context),
          commandOptions: execution.commandOptions,
          historyReview: input.historyReview,
          conflictRecovery: input.conflictRecovery,
          reviewedConflictId: input.reviewedConflictId,
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
          "session-update-recovery",
          { createsCommits: true }
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
      return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-save" }, async ({ session }) => {
        const execution = await saveExecution(session, sessionId, "Save recovery");
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

    // Retiring deletes only a Vibe64-internal ref and never touches the
    // worktree, so it takes the write lock (serialising with Save and its
    // recovery) without waiting for an assistant turn the person may already
    // have started after Save finished.
    async retireSessionWorkSave(sessionId, input = {}) {
      const result = await runMainAgentWrite(sessionId, input, async ({ session }) => {
        const execution = await saveExecution(session, sessionId, "retiring this Save");
        await retireManagedSessionWorkSave({
          commandOptions: execution.commandOptions,
          operationId: input.operationId,
          project: await projectService.readCurrentProject(),
          runCommand: execution.runCommand,
          session
        });
        return { ok: true };
      }, { operation: "retire-session-save", waitMs: 10_000 });
      if (result?.ok === false) {
        throw Object.assign(new Error(result.error), { code: result.code, details: result.details, retryable: true });
      }
      return result;
    },

    async inspectSessionWork(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      const { runtime, session } = await sessionContext(normalizedSessionId, input);
      const execution = input.inspectContributionPublication === true
        ? (await sessionWorkExecution(sessionId, { runtime, session }, "connected-publication-inspection")).execution
        : null;
      const work = await inspectManagedSessionWork({
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        ...(execution ? { commandOptions: execution.commandOptions, runCommand: execution.runCommand,
          inspectContributionPublication: true, knownSubmittedCommit: input.knownSubmittedCommit || "" } : {}),
        project: await projectService.readCurrentProject(),
        session
      });
      return {
        ...work,
        publicationRequiresPullRequest: work.destination?.mode === "github" && !sessionConnectedContribution(session) &&
          (await projectService.readRepositoryWorkflow()).requirePullRequest
      };
    },

    async inspectIncomingContributions(sessionId, input = {}) {
      const { project, actions } = await projectService.incomingRepository(input);
      const { execution, session } = await sessionWorkExecution(sessionId, input, "incoming-inspection");
      return { ...await inspectManagedIncomingContributions({ project, session,
        id: input.id, state: input.state, offset: input.offset, limit: input.limit,
        includeDiff: input.includeDiff === true,
        commandOptions: execution.commandOptions, runCommand: execution.runCommand }), actions };
    },

    async changeIncomingContribution(sessionId, input = {}) {
      return runSessionRepositoryWrite(sessionId, input, { operation: "incoming-contribution" }, context =>
        projectService.runProjectSourceExclusive(async () => {
          const { project } = await projectService.incomingRepository({ ...input,
            action: input.action === "review-repair" ? "merge" : input.action });
          // A receiving action belongs to its current actor, not the person
          // whose previous coding turn recorded this session's Git identity.
          const recorded = await service.recordSessionGitCommandActor(sessionId, {
            ...context, vibe64User: input.vibe64User, reason: "incoming-contribution"
          });
          if (recorded?.ok === false) throw Object.assign(new Error(recorded.error), { code: recorded.code });
          const session = await context.runtime.getSession(sessionId, { inspectSource: false });
          const { execution } = await sessionWorkExecution(sessionId, { ...context, session }, "incoming-contribution",
            { createsCommits: input.action !== "discard" });
          return changeManagedIncomingContribution({ project, session, action: input.action,
            derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
            id: input.id, review: input.review, repairReview: input.repairReview,
            commandOptions: execution.commandOptions, runCommand: execution.runCommand });
        }, { operation: `incoming-${input.action}` }));
    },

    async inspectSessionChanges(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      const { session } = await sessionContext(normalizedSessionId, input);
      const work = await inspectManagedSessionChanges({
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        limit: input.limit,
        offset: input.offset,
        project: await projectService.readCurrentProject(),
        session
      });
      return {
        ...work,
        publicationRequiresPullRequest: work.destination?.mode === "github" && !sessionConnectedContribution(session) &&
          (await projectService.readRepositoryWorkflow()).requirePullRequest
      };
    },

    async inspectSessionChangeDiff(sessionId, input = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      const { session } = await sessionContext(normalizedSessionId, input);
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

    async closeProjectRuntime(input = {}, { dormant = false } = {}) {
      const startedAtMs = Date.now();
      const context = projectRuntimeContext();
      const projectScope = currentProjectScopeKey();
      const projectContextRoot = context.projectContextRoot;
      const reason = String(input?.reason || "project-close").trim() || "project-close";
      const pinRuntime = await projectService.createRuntime({ inspectSource: false });
      return pinRuntime.store.withUnpinnedProject(async () => {
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
          let sessions = [];
          try {
            const listed = await listOpenProjectRuntimeSessions();
            sessions = (Array.isArray(listed) ? listed : []).filter((session) => sessionRecordId(session));
            sessionCount = sessions.length;
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
          for (const session of sessions) {
            const sessionId = sessionRecordId(session);
            try {
              // The listed session lets cleanup skip work a session without
              // source never started, as an archive's cleanup does.
              const result = await closeAllSessionTerminals(sessionId, {
                preserveProcessExitProof: true,
                session
              });
              sessionTerminalClosed += Number(result?.closed || 0);
            } catch (error) {
              failed.push({
                ...(Array.isArray(error?.controllers) ? { controllers: error.controllers } : {}),
                error: error instanceof Error ? error.message : String(error || "Session runtime close failed."),
                sessionId
              });
            }
          }

          try {
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
          } catch (error) {
            failed.push({
              controller: "assistant-provider",
              error: error instanceof Error ? error.message : String(error || "Assistant runtime cleanup failed.")
            });
          }

          try {
            const namespaceResult = await closeProjectScopedTerminalNamespaces({
              projectScope
            });
            projectNamespaceCount = Number(namespaceResult.namespaceCount || 0);
            projectTerminalClosed = Number(namespaceResult.closed || 0);
          } catch (error) {
            failed.push({
              controller: "project-terminals",
              error: error instanceof Error ? error.message : String(error || "Project terminal cleanup failed.")
            });
          }
          try {
            const cwdResult = await closeTerminalSessionsForCwdRoot(
              projectContextRoot
            );
            projectCwdTerminalClosed = Number(cwdResult.closed || 0);
            projectCwdNamespaceCount = Number(cwdResult.namespaceCount || 0);
          } catch (error) {
            failed.push({
              controller: "project-directory-terminals",
              error: error instanceof Error ? error.message : String(error || "Project directory terminal cleanup failed.")
            });
          }
          let projectServicesClosed = false;
          try {
            await projectServices.close(context);
            projectServicesClosed = true;
          } catch (error) {
            failed.push({ controller: "project-services", error: error.message });
          }
          if (projectServicesClosed && failed.length > 0) {
            // The project remains open when another controller cannot finish.
            // Restore service admission after its own cleanup completed so a
            // failed Close cannot strand Preview in a permanent closing state.
            projectServices.opened(context);
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
            action: "runtime-closed", dormant
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
      });
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
      // A summary names an archived session's status without extracting it.
      const session = await runtime.store.readSessionSummary(sessionId);
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
      // A host already working in the finalized archive passes it in, so the
      // archive is extracted once for all of that host's work.
      if (options.archivedSession) {
        const { session, publishArtifacts } = options.archivedSession;
        if (session?.sessionId !== sessionId || session.status !== VIBE64_SESSION_STATUS.ARCHIVED ||
            typeof publishArtifacts !== "function") {
          throw new TypeError("Native retirement in an open archive requires that archived session and its publication.");
        }
        return retire(session, true, publishArtifacts);
      }
      // A summary names an archived session's status without extracting it.
      const session = await runtime.store.readSessionSummary(sessionId);
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
          const routing = assistantRoutingRequestFromMetadata(metadata);
          if (assistantRoutingStatusIsPending(routing) || routing?.helper) fail("Finish pending routing and helper cleanup first.");
        }
        const saved = JSON.parse(context.session.metadata.assistant_changeover || "null");
        if (saved?.replacement?.status !== "preparing") {
          requireCompletedConversationRewind(context.session);
          const goal = await sessionAgent.readGoal(sessionId, context);
          if (!["available", "unsupported"].includes(goal?.status) ||
              goal?.goal && !["complete", "completed", "cancelled"].includes(goal.goal.status)) {
            fail("Finish the native goal before replacing its conversation.");
          }
          const pinnedGoal = assistantRoutingGoalFromMetadata(context.session.metadata);
          if (pinnedGoal && !["complete", "completed", "cancelled"].includes(pinnedGoal.status)) fail("Finish the routed goal first.");
          const native = await sessionAgent.sessionState(sessionId, context);
          if (native?.ok === false || native?.turn?.active || native?.terminal?.status === "running") {
            fail("Stop native work and close its terminal before replacing context.");
          }
          const temporary = await sessionAgent.hasActiveTemporaryConversation(sessionId, {}, context);
          if (temporary?.ok === false || temporary?.active) fail("Finish temporary assistant work before replacing native context.");
        }
        const conversation = await mainConversations.open({ id: sessionId, context: { ...context, sessionId }, representation: "native" });
        const result = await replaceNativeConversation(sessionId, input, context, sessionAgent, conversation);
        await publishAgentSessionChanged(sessionId, { reason: "native-conversation-replaced" });
        return result;
      }, { operation: "replace-agent-conversation" });
    },

    createEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.createEphemeralConversation(scope, ephemeralInput(input), options);
    },

    resolveEphemeralAgentExecutionProfile(scope = {}, input = {}, options = {}) {
      return sessionAgent.resolveEphemeralExecutionProfile(scope, input, options);
    },

    runEphemeralAgentChatTurn(scope = {}, input = {}, options = {}) {
      return sessionAgent.runEphemeralChatTurn(scope, input, options);
    },

    deleteEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.deleteEphemeralConversation(scope, ephemeralInput(input), options);
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
      const native = await sessionAgent.assistantAccess(sessionId, context);
      const purposes = await sessionAgent.inspectAssistantPurposes({ ...preferences }, context);
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
        allowAccountChange: scope.allowAccountChange === true,
        env: { ...homeEnvForUser(credentialHome, env),
          CODEX_HOME: path.join(codexProviderOptions.toolHomeSource, ".codex") },
        commands: { codex: codexProviderOptions.codexCommand || operatorCliCommand("codex", { env }),
          claude: operatorCliCommand("claude", { env }),
          opencode: opencodeTerminalController.command || operatorCliCommand("opencode", { env }) },
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
        connection = await codexProviderConnections.read(integrationId, "codex");
      }
      if (!connection?.apiKey) throw new Error("Reconnect the selected AI account before continuing.");
      return { providerId: integrationId, model: assistantSelection.modelId, apiKey: connection.apiKey,
        ...(connection.canonicalUrl ? { baseURL: connection.canonicalUrl } : {}) };
    },

    listAssistantCapabilities(input = {}, options = {}) {
      return sessionAgent.listCapabilities(input, options);
    },

    resolveAssistantPurpose(input = {}, options = {}, resolution = {}) {
      return sessionAgent.resolveAssistantPurpose(input, options, resolution);
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
      await stopGoalIntent(sessionId, await assistantSessionOptions(sessionId, options));
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
        const route = assistantRoutingRequestFromMetadata(context.session.metadata);
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
      const deliveryStartedAt = performance.now();
      const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || null;
      logOperationalEvent(logger, "info", {
        event: "vibe64.agent_message.received", component: "vibe64.agent_message",
        sessionId, messageId: input.messageId
      }, "Assistant message received.");
      void sessionPromptHints.cancelSessionPromptHintsForSession(sessionId).catch((error) => {
        logOperationalEvent(logger, "warn", { event: "vibe64.prompt_hints.cleanup_failed", error: error.message, sessionId },
          "Prompt suggestion cleanup will be retried on session close.");
      });
      try {
        const result = await assistantRouting.send(sessionId, input, { ...options, deliveryMessageId: input.messageId });
        const deliveryDurationMs = performance.now() - deliveryStartedAt;
        logOperationalEvent(logger, deliveryDurationMs >= 1000 ? "warn" : "info", {
          event: "vibe64.agent_message.delivery_finished", component: "vibe64.agent_message",
          sessionId, messageId: input.messageId, durationMs: deliveryDurationMs,
          delivered: result?.delivered === true, duplicate: result?.duplicate === true
        }, "Assistant message delivery finished.");
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
          nativeStartupStderr: error?.nativeStartupStderr,
          sessionId
        }, "Vibe64 assistant message delivery failed.");
        if (error?.delivery === "not-sent") throw notSentDeliveryError(error, input.messageId);
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
        target, ...(view.routing ? { routing: view.routing } : {}), ...(view.error ? { error: view.error } : {}) };
    },

    async updateAgentGoal(sessionId, input = {}, { canonical = false, restartIntentId = null } = {}) {
      if (input.action === "resume" && await cancelGoalIfMainAiChanged(sessionId, input.vibe64User || null)) {
        return { ok: false, code: "vibe64_goal_main_ai_changed", error: MAIN_AI_CHANGED_GOAL_NOTICE };
      }
      if (["set", "resume"].includes(input.action)) {
        assertProjectEffectAdmission();
        return runMainAgentWrite(sessionId, input, async (context) => {
          requireCompletedConversationRewind(context.session);
          const previousIntent = readGoalIntent(context.session);
          if (restartIntentId && (!previousIntent?.active || previousIntent.id !== restartIntentId || closing)) {
            throw new Error("Goal continuation was stopped before recovery.");
          }
          if (input.action === "set" && assistantRoutingFromMetadata(context.session.metadata)?.mode === "auto") {
            return { ok: false, code: "vibe64_goal_explicit_mode_required", error: "Choose Senior or Junior before starting or resuming a goal." };
          }
          const pendingRoute = assistantRoutingRequestFromMetadata(context.session.metadata);
          if (assistantRoutingStatusIsPending(pendingRoute) || pendingRoute?.helper) {
            return { ok: false, error: "Finish or cancel the pending request before starting a goal." };
          }
          const changeover = JSON.parse(context.session.metadata?.assistant_changeover || "null");
          const engineId = vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
          if (changeover && changeover.lastEngine !== engineId) {
            return { ok: false, code: "vibe64_changeover_message_required",
              error: "Send a message to catch this AI up before starting or resuming its goal." };
          }
          const duplicate = canonical && input.messageId &&
            await context.runtime.store.conversationMessageIdExists(sessionId, input.messageId);
          let intent;
          let admission;
          let dispatched = false;
          try {
            if (!duplicate) {
              const actor = context.vibe64User || currentProjectRequestContext()?.vibe64User;
              intent = { version: 1, id: randomUUID(), active: true, daemonId: goalRuntimeId,
                restartOf: restartIntentId,
                actor: actor ? { username: actor.username, role: actor.role } : null,
                pending: canonical ? { action: input.action, messageId: input.messageId || null,
                  expectedSegmentId: input.expectedSegmentId, expectedGoalId: input.expectedGoalId || null,
                  objective: input.objective || previousIntent?.native?.objective } : null,
                native: input.action === "resume" ? previousIntent?.native || null : null };
              admission = new AbortController();
              goalAdmissions.set(intent.id, admission);
              await changeGoalIntent(sessionId, context, latest => {
                if (latest?.id !== previousIntent?.id || latest?.active !== previousIntent?.active) {
                  throw new Error("Goal continuation was stopped or changed before preparation.");
                }
                return intent;
              });
            }
            await prepareAgentSkillsInsideAgentWrite(sessionId, context);
            const prepared = await assistantRouting.prepareGoal(sessionId, input, context);
            const goalSelection = prepared.pinned?.selection || vibe64AssistantSelectionFromMetadata(context.session.metadata);
            const connectionIdentity = prepared.pinned?.connectionIdentity ??
              (await sessionAgent.requireAssistantAccess(sessionId, { ...context, assistantSelection: goalSelection })).connectionIdentity;
            if (restartIntentId && previousIntent.connectionIdentity !== (connectionIdentity ?? null)) {
              throw new Error("The goal's AI connection changed. Resume it explicitly with the intended account.");
            }
            if (closing) throw new Error("The server is stopping. The goal will be available after restart.");
            if (intent) {
              const actor = await assistantRuntime.resolveAssistantUser(context.vibe64User || currentProjectRequestContext()?.vibe64User);
              // Set/Resume are admitted user requests too. Retain only CONTROL
              // identity, so each later goal tool rechecks current project access.
              const requestMeta = currentProjectActionRequestMeta();
              if (actions && (actor || requestMeta) && !prepared.context.browserAuthority) {
                const projectSlug = projectRuntimeContext().projectSlug;
                const requestContext = requestMeta ? { surface: "app", channel: "internal", requestMeta }
                  : await assistantRuntime.createActionContext(actor);
                const grant = await actions.execute({ actionId: "vibe64.sessions.conversation.context.read",
                  input: { projectSlug, sessionId }, context: requestContext });
                prepared.context.browserAuthority = { sessionId, projectSlug,
                  actorId: grant.actor.id, requestContext };
              }
              await changeGoalIntent(sessionId, context, latest => {
                if (!latest?.active || latest.id !== intent.id) throw new Error("Goal continuation was stopped during preparation.");
                return { ...latest, actor: actor ? { username: actor.username, role: actor.role } : null,
                  connectionIdentity: connectionIdentity ?? null, selection: goalSelection,
                  pending: latest.pending ? { ...latest.pending, objective: prepared.input.objective || prepared.pinned?.objective } : null };
              });
            }
            const completeResult = async result => {
              if (result?.ok !== false && prepared.pinned) {
                const commit = async () => {
                  const latest = await assistantSessionOptions(sessionId, { ...context, session: undefined });
                  const previousPin = context.session.metadata.assistant_routing_goal;
                  const latestPin = latest.session.metadata.assistant_routing_goal;
                  // A settings save can finish while the native goal command is
                  // awaiting acknowledgement. Keep its newer pin, then apply any
                  // preferences saved before the native goal became observable.
                  if (latestPin === previousPin) {
                    await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify(prepared.pinned));
                  } else if (JSON.parse(latestPin || "null")?.objective !== prepared.pinned.objective) return;
                  if (latest.session.metadata.assistant_routing !== context.session.metadata.assistant_routing) {
                    const refreshed = await assistantSessionOptions(sessionId, { ...context, session: undefined });
                    const preferences = assistantRoutingFromMetadata(refreshed.session.metadata);
                    if (preferences) await assistantRouting.applyGoalSelection(sessionId, null, preferences, refreshed);
                  }
                };
                const committed = await context.runtime.store.runSessionExclusive(sessionId, "assistant-settings", commit,
                  { operation: "apply-started-goal-settings", waitMs: 10_000 });
                if (!committed.acquired) throw new Error("The goal started, but its settings are still being saved. Pause it before retrying the settings change.");
              }
              await completeGoalIntent(sessionId, context, intent, result);
              return result;
            };
            dispatched = true;
            const result = await sessionAgent.updateGoal(sessionId, prepared.input, { ...applicationToolManifest(prepared.context), canonicalGoal: canonical,
              signal: admission?.signal, ...(canonical ? { onGoalResult: completeResult } : {}) });
            return canonical ? result : await completeResult(result);
          } catch (error) {
            if (intent && (!dispatched || error.delivery === "not-sent")) {
              await changeGoalIntent(sessionId, context, latest => latest?.active && latest.id === intent.id
                ? previousIntent || { ...latest, active: false } : null);
            }
            throw error;
          } finally {
            if (intent) goalAdmissions.delete(intent.id);
          }
        }, { operation: input.action === "set" ? "set-agent-goal" : "resume-agent-goal",
          ...(restartIntentId ? { waitMs: AGENT_WRITE_WAIT_MS } : {}) });
      }
      const context = await assistantSessionOptions(sessionId, input);
      const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
      // Validate the selected goal before recording the person's stop intent.
      // Native cleanup may fail, but a restart must never undo that intent.
      if (["pause", "cancel"].includes(input.action)) {
        const current = await service.readAgentGoal(sessionId, context, { canonical });
        const same = canonical
          ? current.target?.segmentId === input.expectedSegmentId && current.goal?.id === input.expectedGoalId
          : current.threadId === input.threadId && current.goal?.createdAt === input.createdAt && current.goal?.objective === input.objective;
        const capturedIntent = readGoalIntent(context.session);
        if (same && capturedIntent) await stopGoalIntent(sessionId, context, capturedIntent.id);
      }
      const completeResult = async result => {
        if (result?.ok !== false && result.status === "available" && pinned) {
          await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({
            ...pinned, status: result.goal?.status || "complete"
          }));
          await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
        }
        return result;
      };
      let nativeInput = input;
      if (!canonical && pinned && input.objective === pinned.objective) {
        const observed = await sessionAgent.readGoal(sessionId, context);
        if (observed?.status === "available" && assistantGoalObjective(observed.goal?.objective, pinned) === input.objective) {
          nativeInput = { ...input, objective: observed.goal.objective };
        }
      }
      const result = await sessionAgent.updateGoal(sessionId, nativeInput,
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
        // An archived session, such as a renewed predecessor, has no assistant to prepare.
        if (context.session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
          return { ok: false, code: "vibe64_session_archived", error: "This session is archived.", sessionId };
        }
        const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
        if (selection.engineId === "codex" && (context.session.metadata.agent_identity_provider !== "codex" ||
            !context.session.metadata.agent_identity_conversation_id)) {
          await sessionAgent.prepareSelection(sessionId, selection, context);
        }
        const result = await sessionAgent.ensureSession(sessionId, ["codex", "opencode"].includes(selection.engineId) ? applicationToolManifest(context) : context);
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
      const { runtime, session } = await sessionContext(sessionId, options);
      const records = await runtime.store.listSessionConversations(sessionId);
      const requests = [session.metadata, ...records.map((record) => record.routingMetadata || {})]
        .map(assistantRoutingRequestFromMetadata);
      if (requests.some((request) => assistantRoutingStatusIsPending(request) || request?.helper)) {
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
        shutdownStop ||= (async () => {
          closing = true;
          shutdownSignal.abort(Object.assign(new Error("Vibe64 is stopping."), { code: "vibe64_server_stopping" }));
          const routing = await Promise.allSettled([assistantRouting.close(), sessionConversations.close(), sessionNaming.close()]);
          await Promise.allSettled(turnCompletions);
          const [native] = await Promise.allSettled([sessionAgent.invalidateRuntimes(input, {
            providerId: normalizeAgentProviderId(input.provider)
          })]);
          const failures = [...routing, native].filter((result) => result.status === "rejected").map((result) => result.reason);
          if (failures.length) throw new AggregateError(failures, "Assistant runtime shutdown did not complete successfully.");
          await mainConversations.close();
          return native.value;
        })();
        return shutdownStop;
      }
      return sessionAgent.invalidateRuntimes(input, {
        providerId: normalizeAgentProviderId(input.provider)
      });
    },

    // Run once per daemon after all host admission and execution facilities are
    // configured. This is continuation of saved intent, never history repair.
    recoverActiveGoals() {
      if (goalRecovery) return goalRecovery;
      goalRecovery = (async () => {
        const results = [];
        const reportFailure = (error, target) => {
          const result = { ...target, ok: false, code: error.code, error: error.message };
          results.push(result);
          logOperationalEvent(logger, "warn", { ...result, event: "vibe64.agent_goal.recovery_failed",
            component: "vibe64.agent_goal" }, "An active goal needs attention after server restart.");
        };
        // A failure names its project and the person who set the goal: session
        // IDs repeat across projects, so the operator needs both.
        const recoverCurrentProject = async projectSlug => {
          for (const session of await listOpenProjectRuntimeSessions()) {
            if (closing) break;
            try { results.push(await recoverSessionGoal(session.sessionId)); }
            catch (error) {
              let actor = "";
              try { actor = String(readGoalIntent(session)?.actor?.username || ""); } catch { /* An unreadable intent names no one. */ }
              try {
                const context = await assistantSessionOptions(session.sessionId);
                const expected = readGoalIntent(session);
                await changeGoalIntent(session.sessionId, context, latest => latest?.active && (latest.id === expected?.id || latest.restartOf === expected?.id) ? {
                  ...latest, error: `Goal continuation after restart failed: ${String(error.message || "Recovery could not be verified.").slice(0, 500)}`
                } : null);
              } catch { /* The original recovery failure remains visible in the operational log. */ }
              reportFailure(error, { projectSlug, sessionId: session.sessionId, ...(actor ? { actor } : {}) });
            }
          }
        };
        if (typeof projectService.listProjects === "function") {
          const listed = await projectService.listProjects();
          if (listed?.ok === false) throw new Error(listed.error || "Goal recovery could not list projects.");
          for (const project of openProjectRuntimeRecords(listed)) {
            if (closing) break;
            try { await projectService.runInProjectContext(project.slug, () => recoverCurrentProject(project.slug)); }
            catch (error) { reportFailure(error, { projectSlug: project.slug }); }
          }
        } else await recoverCurrentProject(projectRuntimeContext().projectSlug);
        return { ok: results.every(result => result.ok !== false), results };
      })();
      return goalRecovery;
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
      const diagnostics = realtimeDebugEnabled(env);
      let phase = "session-read";
      let started = performance.now();
      let completed = false;
      try {
        const saved = await readAssistantSession(sessionId, options);
        if (diagnostics) logOperationalEvent(logger, "warn", { event: "vibe64.conversation.browser_timing",
          sessionId, phase, completed: true, durationMs: performance.now() - started }, "Browser conversation opening timing.");
        phase = "native-open";
        started = performance.now();
        // The tool manifest resolves the saved selection, so it belongs to opening.
        const context = applicationToolManifest(saved);
        const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
        const current = { ...context, sessionId, assistantSelection: selection, providerId: selection.engineId,
          browserProjectContext: captureProjectRequestContext() };
        const conversation = await mainConversations.open({ id: sessionId, context: current });
        completed = true;
        return Object.freeze({ ...conversation, async inspectDelivery(input) {
          const receipt = await conversation.inspectDelivery(input);
          if (receipt?.status !== "unknown") return receipt;
          const routed = await assistantRouting.inspectDelivery(sessionId, input, current);
          if (routed?.delivered === true) return conversation.inspectDelivery(input);
          return routed?.status === "not-sent" ? routed : receipt;
        } });
      } finally {
        if (diagnostics) logOperationalEvent(logger, "warn", { event: "vibe64.conversation.browser_timing",
          sessionId, phase, completed, durationMs: performance.now() - started }, "Browser conversation opening timing.");
      }
    },

    async openTemporaryBrowserConversation(sessionId, conversationId, options = {}) {
      const authority = options.browserAuthority;
      if (!authority || authority.sessionId !== sessionId || authority.conversationId !== conversationId) {
        throw Object.assign(new Error("Temporary browser conversations require current project access."), {
          code: "conversation_forbidden", statusCode: 403
        });
      }
      const context = await assistantSessionOptions(sessionId, options);
      return mainConversations.open({ id: sessionId, context: { ...context, sessionId, temporaryConversationId: conversationId,
        browserProjectContext: captureProjectRequestContext() } });
    },

    agentSessionState(sessionId, options = {}) {
      return sessionAgent.sessionState(sessionId, options);
    },

    // Called inside the selection writer's existing session lock. Closing a
    // controller stops observation/execution, never deletes native history.
    prepareAssistantChangeover,
    prepareRoutingSelection,

    async applyGoalSelection(sessionId, selection, preferences, context) {
      const result = await assistantRouting.applyGoalSelection(sessionId, selection, preferences, context);
      logOperationalEvent(logger, "info", {
        event: "vibe64.assistant_settings.updated", component: "vibe64.agent_settings", sessionId,
        engineId: selection.engineId, modelId: selection.modelId, mode: preferences.mode,
        goalSettings: result
      }, "Assistant settings prepared for subsequent turns.");
      return result;
    },

    cancelAssistantRoutingForSelection(sessionId, messageId, options = {}) {
      return assistantRouting.cancel(sessionId, options, { waitForCleanup: true, expectedMessageId: messageId });
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
      return sessionAgent.readEphemeralConversation(scope, ephemeralInput(input), options);
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

    // Only a session's final close (archive or renewal successor discard) calls this.
    removeSessionCommandHelpers(sessionId, { runtime = null } = {}) {
      return closeAgentSessionCommandEnvironment(sessionId, () => removeCodexGitCommandSession({
        env,
        sessionId,
        stateRoot: String(runtime?.stateRoot || "").trim()
      }));
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
      return sessionAgent.startEphemeralConversationTurn(scope, ephemeralInput(input), options);
    },

    stopEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.stopEphemeralConversation(scope, ephemeralInput(input), options);
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
      await publishTerminalSessionChanged("outputTargetStopped", sessionId, result?.ok === false ? "output-target-stop-failed" : "output-target-stopped");
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
      return sessionAgent.waitForEphemeralConversationTurn(scope, ephemeralInput(input), options);
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
      for (const failure of Array.isArray(result?.failed) ? result.failed : []) {
        const failed = Array.isArray(failure?.failed) ? failure.failed
          : Array.isArray(failure?.closeResult?.failed) ? failure.closeResult.failed : [];
        logger?.warn?.({
          component: "vibe64-project-runtime-cleanup",
          error: String(failure?.error || failed[0]?.error || "Dormant project runtime cleanup failed."),
          event: "vibe64.project_runtime.dormant_close_failed",
          projectSlug: String(failure?.projectSlug || ""),
          sessionIds: [...new Set(failed.map((entry) => String(entry?.sessionId || "")).filter(Boolean))]
        }, "An idle Vibe64 project could not be closed.");
      }
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
  createService,
  startProjectRuntimeDormancyCleanupSchedule
};
