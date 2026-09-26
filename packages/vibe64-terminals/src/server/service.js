import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { nativeConversationBindings } from "./nativeConversationRetirement.js";
import { assertSessionRepositoryReview, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { createClaudeSessionAgentProvider } from "./agent/providers/claudeSessionAgentProvider.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { createCodexTerminalController } from "./codexTerminal.js";
import { createAssistantRouting } from "./assistantRouting.js";
import { assistantModePrompt, assistantRoutingFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { createSessionConversations } from "./sessionConversations.js";
import { readConversationRewindState, rememberAssistantBeforeChangeover, replaceNativeConversation, requireCompletedConversationRewind, requireCompletedNativeConversationReplacement, rewindLastConversationTurn, sendWithAssistantChangeover, sessionConversationKey } from "./assistantChangeover.js";
import { createSessionAttachments } from "./sessionAttachments.js";
import {
  createSessionAgentManager
} from "./agent/sessionAgentManager.js";
import {
  createCodexSessionAgentProvider
} from "./agent/providers/codexSessionAgentProvider.js";
import {
  createOpenCodeSessionAgentProvider
} from "./agent/providers/opencodeSessionAgentProvider.js";
import { createOpenCodeTerminalController } from "./opencodeTerminal.js";
import process from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createAgentEnvCommandService } from "./agentEnvCommand.js";
import { createAgentDatabaseCommandService } from "./agentDatabaseCommand.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createAgentSessionCommandService } from "./agentSessionCommand.js";
import { closeAgentSessionCommandEnvironment } from "./agentCommandEnvironment.js";
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
  inspectGenesisOpenCodePlugin,
  inspectGenesisSkills,
  syncGenesisOpenCodePlugin,
  syncGenesisSkills
} from "@local/vibe64-genesis/server";
import {
  codexTerminalNamespace,
  directoryExists,
  ensureTerminalSessionSourceGitSelfContained,
  outputTargetTerminalNamespace,
  terminalSessionSourceRoot,
  terminalWorktreePath,
  terminalProjectScopeKey
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
  currentProjectRequestContext
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
  vibe64AgentRunStateIsActive
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
        publish: true
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
    projectService
  });
  const codexProviderOptions = selfTargetCodexAppServerProviderOptions({ codexTerminalController, env });
  const codexProviderConnections = createCodexProviderConnectionStore({ systemRoot: codexProviderOptions.systemRoot });
  const codex = createCodexTerminalController({
    ...codexTerminalController,
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
    publishSessionChanged: publishAgentSessionChanged
  });
  const opencode = createOpenCodeTerminalController({
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
    resolveConnection: (context) => assistantRuntime.resolveConnection(context)
  });
  const sessionAttachments = createSessionAttachments({ projectService, env });
  const claudeProvider = createClaudeSessionAgentProvider({
    env, projectService, publishSessionChanged: publishAgentSessionChanged,
    systemRoot: codexProviderOptions.systemRoot,
    codexGitCommand, agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
    connectionStatus: (context) => assistantRuntime.claudeConnectionStatus(context)
  });
  const sessionAgent = createSessionAgentManager({
    attachments: sessionAttachments,
    resolveAssistantUser: (user) => assistantRuntime.resolveAssistantUser(user),
    readRoutingConfiguration: () => createAssistantRoutingStore({ systemRoot: codexProviderOptions.systemRoot }).read(),
    providers: [
      claudeProvider,
      createCodexSessionAgentProvider({
        listConnections: codexProviderConnections.list,
        connectionStatus: (context) => assistantRuntime.codexConnectionStatus(context),
        controller: codex
      }),
      createOpenCodeSessionAgentProvider({
        controller: opencode
      })
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
        return { ...await codex.assistantAccess(context), available };
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
    const closed = await sessionAgent.closeSession(sessionId, { ...context, changeover: true });
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
    if (selection.engineId === "codex") await codex.prepareModelRouting(sessionId, selection, context);
  }

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
      return sendWithAssistantChangeover(sessionId, input, context, sessionAgent);
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
    const guidance = await inspectGenesisOpenCodePlugin({ projectRoot });
    const refreshSkills = ["missing", "outdated"].includes(inspection.status);
    if (!refreshSkills && guidance.status === "current") return;
    const result = await projectService.runProjectSourceExclusive(
      async () => {
        const plugin = await syncGenesisOpenCodePlugin({ projectRoot });
        const skills = refreshSkills ? await syncGenesisSkills({ projectRoot }) : { changedFiles: [] };
        return { changedFiles: [...plugin.changedFiles, ...skills.changedFiles] };
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
    }, { operation: "prepare-workspace" });
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
    const runtime = existingRuntime || await projectService.createRuntime({
      inspectSource: false
    });
    const session = existingSession || await runtime.getSession(sessionId, {
      inspectSource: false
    });
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
        void setup.completion.then(async () => {
          await publishSessionChanged.agentTerminal(sessionId, {
            reason: "workspace-setup-completed",
            session: await runtime.getSession(sessionId, {
              inspectSource: false
            })
          });
        }).catch((error) => {
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
    return closeAgentSessionCommandEnvironment(sessionId, () => closeTerminalControllersForSession(sessionId, [
      {
        controller: { closeAllForSession: async (id, options) => {
          await cleanupSessionSaveCommitMessage({ agent: sessionAgent, agentContext: await assistantSessionOptions(id, options) });
          return { ok: true };
        } },
        label: "Save naming helper"
      },
      {
        controller: { closeAllForSession: (id) => sessionPromptHints.cancelSessionPromptHintsForSession(id) },
        label: "Prompt suggestions"
      },
      { controller: { closeAllForSession: (id) => databaseToolsProvider?.closeAssistantsForSession(id) },
        label: "Database copilot" },
      { controller: { closeAllForSession: (id) => sourceEditorProvider?.closeExplanationsForSession(id) },
        label: "Source explanations" },
      { controller: outputTarget, label: "outputTarget" },
      ...(!controllerOptions.renewalCleanup && controllerOptions.session?.sourceReady !== false ? [{
        controller: { closeAllForSession: (id) => sessionAgent.interruptTurn(id) },
        label: "assistantTurn"
      }] : []),
      {
        controller: {
          closeAllForSession: (id, options) => sessionAgent.closeSession(id, options)
        },
        label: "assistant"
      },
      { controller: agentDatabaseCommand, label: "agentDatabase" },
      { controller: agentEnvCommand, label: "agentEnv" },
      { controller: agentPreviewCommand, label: "agentPreview" },
      { controller: agentSessionCommand, label: "agentSessionCommand" }
    ], {
      controllerOptions
    }));
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
    systemRoot: codexProviderOptions.systemRoot,
    prepareSelection: (sessionId, selection, context) => selection.engineId === "codex"
      ? codex.prepareModelRouting(sessionId, selection, context) : null,
    sessionAgent,
    attachments: sessionAttachments,
    runAgentWrite: runMainAgentWrite,
    prepareAgentSkills: prepareAgentSkillsInsideAgentWrite,
    publishSessionChanged: publishAgentSessionChanged
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
      return codex.closeGlobalTerminal(terminalSessionId);
    },

    async closeOutputTargetTerminal(sessionId, terminalSessionId) {
      const result = await outputTarget.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("outputTargetClosed", sessionId, "output-target-closed");
      return result;
    },

    createAgentConversation(sessionId, input = {}, options = {}) {
      return runMainAgentWrite(sessionId, options, (context) => (
        sessionAgent.createConversation(sessionId, input, context)
      ), { operation: "create-agent-conversation" });
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
        const result = await replaceNativeConversation(sessionId, input, context, sessionAgent);
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

    deleteAgentConversation(sessionId, input = {}, options = {}) {
      return sessionAgent.deleteConversation(sessionId, input, options);
    },

    deleteEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.deleteEphemeralConversation(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    async runDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
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
      return opencode.verifyConnection(input);
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

    async readConversationRewindState(sessionId, options = {}) {
      const context = await assistantSessionOptions(sessionId, options);
      const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata, { required: false });
      return selection ? readConversationRewindState(context.runtime.store, sessionId, sessionConversationKey(context.session)) : null;
    },

    async rewindConversation(sessionId, input = {}, options = {}) {
      await assistantRouting.cancel(sessionId, options);
      return runMainAgentWrite(sessionId, options, async (context) => {
        await sessionAgent.requireAssistantAccess(sessionId, context);
        if (sessionHasActiveAgentRun(context.session)) {
          return { ok: false, error: "Stop the assistant before undoing a turn." };
        }
        return rewindLastConversationTurn(sessionId, input, context, sessionAgent);
      }, { operation: "rewind-conversation" });
    },

    async sendAgentMessage(sessionId, input = {}, options = {}) {
      const startedAt = Date.now();
      const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || null;
      void sessionPromptHints.cancelSessionPromptHintsForSession(sessionId).catch((error) => {
        logOperationalEvent(logger, "warn", { event: "vibe64.prompt_hints.cleanup_failed", error: error.message, sessionId },
          "Prompt suggestion cleanup will be retried on session close.");
      });
      try {
        const result = await assistantRouting.send(sessionId, input, options);
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

    async readAgentGoal(sessionId, options = {}) {
      const context = await assistantSessionOptions(sessionId, options);
      const result = await sessionAgent.readGoal(sessionId, context);
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
    },

    async updateAgentGoal(sessionId, input = {}) {
      if (["set", "resume"].includes(input.action)) {
        return runMainAgentWrite(sessionId, input, async (context) => {
          requireCompletedConversationRewind(context.session);
          if (assistantRoutingFromMetadata(context.session.metadata)?.mode === "auto") {
            return { ok: false, code: "vibe64_goal_explicit_mode_required", error: "Choose Senior, Junior, or Intern before starting or resuming a goal." };
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
          const prepared = await assistantRouting.prepareGoal(sessionId, input, context);
          const result = await sessionAgent.updateGoal(sessionId, prepared.input, prepared.context);
          if (result?.ok !== false && prepared.pinned) {
            await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify(prepared.pinned));
          }
          return result;
        }, { operation: input.action === "set" ? "set-agent-goal" : "resume-agent-goal" });
      }
      const context = await assistantSessionOptions(sessionId, input);
      const pinned = JSON.parse(context.session.metadata.assistant_routing_goal || "null");
      const result = await sessionAgent.updateGoal(sessionId, pinned && input.objective === pinned.objective
        ? { ...input, objective: assistantModePrompt(pinned.mode, input.objective) } : input, context);
      if (result?.ok !== false && result.status === "available" && pinned) {
        await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({
          ...pinned, status: result.goal?.status || "complete"
        }));
        await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
      }
      return result;
    },

    async readAgentPlanUsage(sessionId, options = {}) {
      return sessionAgent.readPlanUsage(sessionId, await assistantSessionOptions(sessionId, options));
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
        if (selection.engineId === "codex" && !context.session.metadata.agent_identity_conversation_id) {
          await codex.prepareModelRouting(sessionId, selection, context);
        }
        const result = await sessionAgent.ensureSession(sessionId, context);
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
        const routing = await Promise.allSettled([assistantRouting.close(), sessionConversations.close()]);
        await Promise.allSettled(turnCompletions);
        const [native] = await Promise.allSettled([sessionAgent.invalidateRuntimes(input, {
          providerId: normalizeAgentProviderId(input.provider)
        })]);
        const failures = [...routing, native].filter((result) => result.status === "rejected").map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Assistant runtime shutdown did not complete successfully.");
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

    agentSessionState(sessionId, options = {}) {
      return sessionAgent.sessionState(sessionId, options);
    },

    // Called inside the selection writer's existing session lock. Closing a
    // controller stops observation/execution, never deletes native history.
    prepareAssistantChangeover,

    globalCodexTerminalState() {
      return codex.globalTerminalState();
    },

    readGlobalCodexTerminal(terminalSessionId) {
      return codex.readGlobalTerminal(terminalSessionId);
    },

    readAgentTerminal(sessionId, terminalSessionId, options = {}) {
      return sessionAgent.readTerminal(sessionId, terminalSessionId, options);
    },

    readAgentConversation(sessionId, input = {}, options = {}) {
      return sessionAgent.readConversation(sessionId, input, options);
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
      return { ...await outputTarget.launchStatus(sessionId, options), testApproval: agentPreviewCommand.testApprovalStatus(sessionId) };
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
      return runMainAgentWrite(sessionId, options, async (context) => {
        await prepareAgentSkillsInsideAgentWrite(sessionId, context);
        return sessionAgent.startTerminal(sessionId, input, context);
      }, { operation: "start-agent-terminal" });
    },

    startAgentConversationTurn(sessionId, input = {}, options = {}) {
      void sessionPromptHints.cancelSessionPromptHintsForSession(sessionId).catch((error) => {
        logOperationalEvent(logger, "warn", { event: "vibe64.prompt_hints.cleanup_failed", error: error.message, sessionId },
          "Prompt suggestion cleanup will be retried on session close.");
      });
      return runMainAgentWrite(sessionId, options, async (context) => {
        await prepareAgentSkillsInsideAgentWrite(sessionId, context);
        return sessionAgent.startConversationTurn(sessionId, input, context);
      }, { operation: "start-agent-turn" });
    },

    startEphemeralAgentConversationTurn(scope = {}, input = {}, options = {}) {
      return sessionAgent.startEphemeralConversationTurn(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    stopAgentConversation(sessionId, input = {}, options = {}) {
      return sessionAgent.stopConversation(sessionId, input, options);
    },

    stopEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
      return sessionAgent.stopEphemeralConversation(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    async startGlobalCodexTerminal(options = {}) {
      await authorizeGlobalCodexTerminal(options);
      return codex.startGlobalTerminal();
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
      return codex.subscribeGlobalTerminal(terminalSessionId, subscriber);
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

    waitForAgentConversationTurn(sessionId, input = {}, options = {}) {
      return sessionAgent.waitForConversationTurn(sessionId, input, options);
    },

    waitForEphemeralAgentConversationTurn(scope = {}, input = {}, options = {}) {
      return sessionAgent.waitForEphemeralConversationTurn(scope, {
        ...input,
        ephemeral: input.persistent !== true
      }, options);
    },

    writeAgentTerminal(sessionId, terminalSessionId, data, input = {}, options = {}) {
      // A terminal write targets an already-open, namespace-owned PTY. It is
      // transport authorized against its captured connection by the manager.
      // Putting raw input through
      // runMainAgentWrite() hydrates the complete session and acquires
      // the assistant-operation lock for every WebSocket input chunk—often
      // every keystroke. Long-lived sessions therefore became progressively
      // slower and terminal restarts contended with ordinary typing.
      return sessionTerminalAdmissionFailure(sessionId, "agent") ||
        sessionAgent.writeTerminal(sessionId, terminalSessionId, data, input, options);
    },

    async writeGlobalCodexTerminal(terminalSessionId, data, options = {}) {
      await authorizeGlobalCodexTerminal(options);
      return codex.writeGlobalTerminal(terminalSessionId, data);
    },

    resizeAgentTerminal(sessionId, terminalSessionId, size, options = {}) {
      return sessionAgent.resizeTerminal(sessionId, terminalSessionId, size, options);
    },

    resizeGlobalCodexTerminal(terminalSessionId, size) {
      return codex.resizeGlobalTerminal(terminalSessionId, size);
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
  createService,
  projectRuntimeDormancyState,
  startProjectRuntimeDormancyCleanupSchedule,
  terminalNamespaceMatchesProjectScope
};
