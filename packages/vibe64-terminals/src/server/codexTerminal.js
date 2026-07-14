import crypto from "node:crypto";
import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  readTerminalSessionControlState,
  resizeTerminalSession,
  subscribeTerminalSession,
  writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  codexRuntimeContext
} from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  repairManagedSourcePermissions
} from "@local/vibe64-execution/server";
import {
  terminalAppOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerRequestIsInvalid,
  codexAppServerRuntimeDir,
  createCodexAppServerAgentProvider,
  stopCodexAppServerRuntime
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import {
  VIBE64_AGENT_RUN_STATE,
  normalizeVibe64AgentRunState,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal
} from "@local/vibe64-runtime/server/sessionStore";
import {
  CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME,
  codexAppServerThreadHasReadableHistory,
  codexAppServerThreadSettings,
  ensureCodexAppServerThreadForSession,
  sendCodexAppServerPromptForSession
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  effectiveVibe64AgentExecutionSettings,
  effectiveVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import {
  validateAgentTurnResult
} from "@local/vibe64-runtime/server/agentTurnResults";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  sessionClosingReason,
  sessionIsClosing
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  currentProjectRequestContext,
  currentProjectTargetRoot,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "@local/vibe64-core/shared";
import {
  markCodexReconnectRequired
} from "@local/vibe64-core/server/codexAuthState";
import {
  claimSessionWorkflowDriver
} from "@local/vibe64-core/server/sessionWorkflowDriver";
import {
  VIBE64_LAUNCH_TARGETS_CLIENT_REFRESH_PAYLOAD
} from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  promptSessionBriefing
} from "@local/vibe64-adapters/server/promptRenderer";
import {
  vibe64Result,
  codexTerminalNamespace,
  directoryExists,
  ensureTerminalSessionSourceGitSelfContained,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace,
  pathInsideOrEqual,
  terminalTargetRoot,
  terminalWorktreePath
} from "./terminalShared.js";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  cleanupCodexAttachments,
  prepareCodexAttachmentRoot,
  storeCodexAttachment
} from "./codexAttachments.js";
import {
  loadProjectExecutionEnv,
  executionEnvFingerprint
} from "./projectExecutionEnv.js";
import {
  runVibe64Command,
  stableHash
} from "@local/vibe64-execution/server";
import {
  defaultFixCodexJobStore,
  fixCodexReportInstructions,
  prepareFixCodexReportHelper,
  reportFixCodexJob
} from "./fixCodexJobs.js";
import {
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV,
  prepareCodexGitCommand
} from "./codexGitCommand.js";
import {
  recordSessionGitCommandActor,
  sessionGitCommandActorFromMetadata
} from "./sessionGitCommandActor.js";
import {
  prepareAgentPreviewCommand
} from "./agentPreviewCommand.js";
import {
  agentTerminalIdentityForWorkdir,
  agentTerminalIdentityState
} from "./agentTerminalIdentity.js";
import {
  classifyCodexAppServerEvent,
  codexAppServerAssistantItemText,
  codexAppServerContentText,
  codexAppServerContextRefreshReason,
  codexAppServerErrorText,
  codexAppServerNotificationError,
  codexAppServerNotificationEvent,
  codexAppServerNotificationEventPayload,
  codexAppServerNotificationEventType,
  codexAppServerNotificationItem,
  codexAppServerNotificationItemId,
  codexAppServerNotificationParams,
  codexAppServerNotificationThreadId,
  codexAppServerNotificationTurnId,
  codexAppServerNotificationTurnStatus,
  codexAppServerProviderThreadAssistantSegments,
  codexAppServerStatusFromValue,
  codexAppServerUserMessageText
} from "./codexAppServerEvents.js";

const CODEX_AGENT_PROVIDER = "codex";
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const DEBUG_PROMPTS_ENABLED = String(process.env.DEBUG_PROMPTS || "").trim() === "1";
const CODEX_PROMPT_SUBMIT_PAUSE_MS = 20;
const TERMINAL_BRACKETED_PASTE_START = "\u001b[200~";
const TERMINAL_BRACKETED_PASTE_END = "\u001b[201~";
const CODEX_APP_SERVER_TASK_ID = "codex_app_server";
const CODEX_CONTEXT_TASK_ID = "codex_context";
const CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER = "\u001f";
const CODEX_APP_SERVER_WORKFLOW_RESULT_EVENT = "codex-app-server-workflow-result-accepted";
const CODEX_CONTEXT_REFRESH_PENDING_METADATA = Object.freeze([
  "codex_context_refresh_pending",
  "codex_context_refresh_pending_at",
  "codex_context_refresh_reason",
  "codex_context_refresh_thread_id",
  "codex_context_refresh_turn_id"
]);
const CODEX_APP_SERVER_AGENT_RUN_ID = CODEX_APP_SERVER_TASK_ID;
const CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE = "vibe64_session_worktree_unavailable";
const CODEX_AGENT_TURN_ALREADY_RUNNING_CODE = "vibe64_agent_turn_already_running";
const CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE = "vibe64_codex_turn_interrupt_failed";
const CODEX_AGENT_TURN_STEER_FAILED_CODE = "vibe64_codex_turn_steer_failed";
const MAX_OPEN_CODEX_TERMINALS = 3;
const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_APP_SERVER_ACTIVE_RECONCILE_MS = 2000;
const CODEX_APP_SERVER_DAEMON_WELLBEING_MS = 15000;
const CODEX_APP_SERVER_FINALIZING_GRACE_MS = 10000;
const CODEX_APP_SERVER_LIVE_PROGRESS_MAX_LENGTH = 320;
const CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS = 180_000;
const CODEX_APP_SERVER_DETACHED_FAILURE_DETAIL_GRACE_MS = 500;
const CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS = 5_000;
const CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE =
  "Codex app-server finished this turn, but Vibe64 did not receive the assistant result text.";
const CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH = 4 * 1024 * 1024;
const CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS = new Set([
  "VIBE64_CODEX_GIT_COMMAND_SOCKET",
  "VIBE64_CODEX_GIT_COMMAND_TOKEN"
]);
function normalizeText(value) {
  return String(value || "").trim();
}

function firstTextValue(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return normalizeText(rawValue);
}

function inputOriginId(input = {}) {
  return firstTextValue(input?.originId || input?.request?.query?.originId || input?.request?.input?.query?.originId || "");
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function codexAttachmentEnvForController(env = process.env) {
  const explicitRoot = normalizeText(env?.[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]) ||
    normalizeText(process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]);
  return explicitRoot
    ? {
        [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: explicitRoot
      }
    : process.env;
}

function codexAppTerminalOwnerMetadata(toolHome = {}) {
  return terminalAppOwnerMetadata({
    githubToolHomeSource: toolHome.toolHomeSource,
    ownerUserKey: "codex"
  });
}

function codexEffectiveAgentSettings(agentSettings = {}) {
  return effectiveVibe64AgentSettings(agentSettings);
}

function codexDetachedChatTurnError(error, {
  agentSettings = {},
  status = ""
} = {}) {
  const settings = effectiveVibe64AgentExecutionSettings(agentSettings);
  const terminalStatus = ["failed", "interrupted"].includes(normalizeText(status))
    ? normalizeText(status)
    : "";
  const requestDetails = [
    settings.model ? `model ${settings.model}` : "",
    settings.request.reasoning !== false && settings.thinking
      ? `reasoning effort ${settings.thinking}`
      : "",
    terminalStatus ? `turn status ${terminalStatus}` : ""
  ].filter(Boolean);
  const message = errorMessage(error, "Codex app-server turn failed.");
  const contextualMessage = requestDetails.length && !message.includes("Request details:")
    ? `${message}\n\nRequest details: ${requestDetails.join("; ")}.`
    : message;
  const contextualError = new Error(contextualMessage);
  contextualError.code = error?.code;
  contextualError.statusCode = error?.statusCode;
  return contextualError;
}

function codexAgentSettingsFromSession(session = {}) {
  const metadata = session.metadata || {};
  return {
    model: normalizeText(metadata.agent_settings_model),
    providerId: normalizeText(metadata.agent_settings_provider),
    thinking: normalizeText(metadata.agent_settings_thinking)
  };
}

function errorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeText(value?.error || value?.message || value) || fallback;
}

function retryableTerminalFailure(result = {}) {
  return {
    ...result,
    retryable: false
  };
}

function codexReconnectTerminalFailure(error = null) {
  if (error?.code !== CODEX_RECONNECT_REQUIRED_CODE) {
    return null;
  }
  return retryableTerminalFailure({
    code: CODEX_RECONNECT_REQUIRED_CODE,
    errors: [
      {
        code: CODEX_RECONNECT_REQUIRED_CODE,
        message: CODEX_RECONNECT_REQUIRED_MESSAGE
      }
    ],
    ok: false,
    error: CODEX_RECONNECT_REQUIRED_MESSAGE
  });
}

function codexSessionWorktreeWasRemoved(session = {}) {
  return normalizeText(session.metadata?.source_removed) === "yes";
}

function codexSessionWorktreeIsClosing(session = {}) {
  return sessionIsClosing(session);
}

function codexSessionWorktreeIsUnavailable(session = {}) {
  return codexSessionWorktreeWasRemoved(session) || codexSessionWorktreeIsClosing(session);
}

function codexSessionWorktreeUnavailableFailure({
  session = {},
  workdir = ""
} = {}) {
  const removed = codexSessionWorktreeWasRemoved(session);
  const closingReason = sessionClosingReason(session);
  return retryableTerminalFailure({
    code: CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE,
    ok: false,
    error: removed
      ? "Session clone was removed. Recover this session before continuing with Codex."
      : closingReason
        ? `Session is ${closingReason}. Codex cannot start while the worktree is being archived.`
      : `Session clone directory does not exist: ${workdir}`,
    workdir: normalizeText(workdir)
  });
}

function codexManagedSourcePermissionFailure(repair = {}, workdir = "") {
  const pathLabel = normalizeText(repair.path) || normalizeText(workdir);
  return retryableTerminalFailure({
    code: repair.code || "vibe64_managed_source_permission_repair_failed",
    ok: false,
    error: repair.error || `Managed source permission repair failed: ${pathLabel}`
  });
}

async function ensureCodexManagedSourcePermissions(paths = []) {
  const repair = await repairManagedSourcePermissions(paths);
  return repair?.ok === false
    ? codexManagedSourcePermissionFailure(repair)
    : null;
}

async function repairCodexManagedSourcePermissions(paths = []) {
  const failure = await ensureCodexManagedSourcePermissions(paths);
  if (failure) {
    throw new Error(failure.error || "Managed source permission repair failed.");
  }
  return {
    ok: true
  };
}

async function repairCodexSessionWorkdirPermissions(session = {}) {
  const workdir = terminalWorktreePath(session);
  if (!workdir) {
    return {
      ok: true,
      skipped: true
    };
  }
  return repairCodexManagedSourcePermissions([workdir]);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function codexAppServerAgentRun(session = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.find((run) => normalizeText(run?.id) === CODEX_APP_SERVER_AGENT_RUN_ID) || null;
}

function codexAppServerPendingUserMessageClientIds(session = {}) {
  const ids = codexAppServerAgentRun(session)?.pendingUserMessageClientIds;
  return (Array.isArray(ids) ? ids : [])
    .map((id) => normalizeText(id))
    .filter(Boolean);
}

function codexAppServerWorkflowResultEvent(session = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const events = codexAppServerAgentRun(session)?.events;
  return (Array.isArray(events) ? events : []).findLast((event) => (
    normalizeText(event?.kind) === CODEX_APP_SERVER_WORKFLOW_RESULT_EVENT &&
    normalizeText(event?.providerThreadId) === normalizedThreadId &&
    normalizeText(event?.providerTurnId) === normalizedTurnId &&
    isRecord(event?.workflowResult)
  )) || null;
}

function codexAppServerTurnStateFromAgentRun(run = {}) {
  const runState = normalizeVibe64AgentRunState(run.state);
  const active = vibe64AgentRunStateIsActive(runState);
  const state = runState === VIBE64_AGENT_RUN_STATE.FINALIZING
    ? "finalizing"
    : runState === VIBE64_AGENT_RUN_STATE.STARTING
      ? "starting"
      : active
        ? "active"
        : "idle";
  return {
    active,
    completedAt: normalizeText(run.finishedAt),
    error: normalizeText(run.error),
    handoffId: normalizeText(run.handoffId),
    inputSource: normalizeText(run.inputSource),
    runId: normalizeText(run.id),
    runState,
    startedAt: normalizeText(run.startedAt),
    state,
    status: normalizeText(run.providerStatus || run.status || runState),
    threadId: normalizeText(run.providerThreadId),
    turnId: normalizeText(run.providerTurnId),
    updatedAt: normalizeText(run.updatedAt)
  };
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

async function terminalTargetRootForSession(projectService, sessionId) {
  try {
    const runtime = await projectService.createRuntime({
      input: {
        sessionId
      }
    });
    const session = await runtime.getSession(sessionId);
    return terminalTargetRoot(session, projectService) ||
      await globalCodexTargetRoot(projectService, runtime);
  } catch {
    return globalCodexTargetRoot(projectService);
  }
}

async function globalCodexTargetRoot(projectService = {}, runtime = null) {
  const serviceRoot = terminalTargetRoot({}, projectService);
  if (serviceRoot) {
    return serviceRoot;
  }

  const runtimeRoot = terminalTargetRoot({
    targetRoot: runtime?.targetRoot
  });
  if (runtimeRoot) {
    return runtimeRoot;
  }

  if (typeof projectService.readProjectType !== "function") {
    return "";
  }

  try {
    const projectType = await projectService.readProjectType();
    return terminalTargetRoot({
      targetRoot: projectType?.projectType?.targetRoot || projectType?.targetRoot
    });
  } catch {
    return "";
  }
}

function fixCodexRepairTarget({
  scope = "project",
  targetRoot = "",
  workdir = ""
} = {}) {
  if (normalizeText(scope) === "session") {
    return "session_worktree";
  }
  const resolvedTargetRoot = normalizeText(targetRoot) ? path.resolve(targetRoot) : "";
  const resolvedWorkdir = normalizeText(workdir) ? path.resolve(workdir) : "";
  return resolvedTargetRoot && resolvedWorkdir && resolvedTargetRoot !== resolvedWorkdir
    ? "repair_worktree"
    : "main_checkout";
}

function codexSessionWorkdirAllowed({
  session = {},
  workdir = ""
} = {}) {
  if (!workdir) {
    return false;
  }
  const sessionWorktree = terminalWorktreePath(session);
  return Boolean(sessionWorktree) && path.resolve(sessionWorktree) === path.resolve(workdir);
}

function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) {
    return "";
  }
  return threadId.toLowerCase();
}

function normalizeCodexConversationId(value) {
  return normalizeCodexThreadId(value);
}

function normalizeCodexPromptHandoffId(value) {
  const normalizedValue = String(value || "").trim();
  if (
    !normalizedValue ||
    normalizedValue.length > 512 ||
    normalizedValue.includes("\n") ||
    normalizedValue.includes("\r")
  ) {
    return "";
  }
  return normalizedValue;
}

function codexPromptInputFromHandoff(handoff = {}) {
  if (DEBUG_PROMPTS_ENABLED) {
    const prompt = String(handoff.prompt || "");
    if (prompt) {
      return prompt;
    }
  }
  const terminalInput = normalizeText(handoff.terminalInput);
  if (terminalInput) {
    return terminalInput;
  }
  const prompt = normalizeText(handoff.prompt);
  return prompt ? codexPromptInput(prompt) : "";
}

function codexPromptInput(prompt = "") {
  const source = String(prompt || "");
  if (!source) {
    return "";
  }
  return source;
}

function codexPromptPasteInput(prompt = "") {
  const input = codexPromptInput(prompt);
  if (!input) {
    return "";
  }
  return `${TERMINAL_BRACKETED_PASTE_START}${input}${TERMINAL_BRACKETED_PASTE_END}`;
}

function globalCodexTerminalSnapshot(terminalSessionId = "") {
  return readTerminalSessionControlState(terminalSessionId, {
    namespace: globalCodexTerminalNamespace()
  });
}

function codexTerminalStatus(terminal = null) {
  if (!terminal) {
    return null;
  }
  return {
    commandPreview: terminal.commandPreview || "",
    id: terminal.id || "",
    inputVersion: terminal.inputVersion || 0,
    lastInputAt: terminal.lastInputAt || "",
    lastInputBytes: terminal.lastInputBytes || 0,
    lastOutputAt: terminal.lastOutputAt || "",
    lastOutputBytes: terminal.lastOutputBytes || 0,
    outputVersion: terminal.outputVersion || 0,
    status: terminal.status || ""
  };
}

function activeCodexTerminalSnapshots(session = {}) {
  const sessionId = normalizeText(session.sessionId);
  if (!sessionId) {
    return [];
  }
  const workdir = terminalWorktreePath(session);
  return listTerminalSessions({
    namespace: codexTerminalNamespace(sessionId)
  })
    .filter((terminal) => terminal.status !== "exited")
    .filter((terminal) => !workdir || terminal.metadata?.workdir === workdir)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function activeCodexTerminal(session = {}) {
  const terminals = activeCodexTerminalSnapshots(session);
  const terminal = terminals[0] || null;
  return codexTerminalStatus(terminal);
}

function activeGlobalCodexTerminal(targetRoot = "") {
  const terminals = listTerminalSessions({
    namespace: globalCodexTerminalNamespace()
  })
    .filter((terminal) => terminal.status !== "exited")
    .filter((terminal) => !targetRoot || terminal.metadata?.targetRoot === targetRoot)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return codexTerminalStatus(terminals[0] || null);
}

async function writeCodexPromptIntoNamespace(terminalSessionId = "", prompt = "", {
  namespace = "default"
} = {}) {
  const input = codexPromptPasteInput(prompt);
  if (!input) {
    return {
      ok: false,
      error: "Codex prompt input is empty."
    };
  }
  const written = await writeTerminalSessionText(terminalSessionId, input, {
    namespace
  });
  if (written.ok === false) {
    return written;
  }
  await delay(CODEX_PROMPT_SUBMIT_PAUSE_MS);
  return writeTerminalSessionText(terminalSessionId, "\r", {
    namespace
  });
}

function codexAppServerTurnState(session = {}) {
  const run = codexAppServerAgentRun(session);
  if (run) {
    return codexAppServerTurnStateFromAgentRun(run);
  }
  return {
    active: false,
    completedAt: "",
    error: "",
    runId: "",
    runState: "",
    startedAt: "",
    state: "idle",
    status: "",
    threadId: "",
    turnId: "",
    updatedAt: ""
  };
}

function codexAppServerTurnMatches(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  if (normalizedThreadId && normalizeText(turn.threadId) !== normalizedThreadId) {
    return false;
  }
  if (normalizedTurnId && currentTurnId && currentTurnId !== normalizedTurnId) {
    return false;
  }
  if (!normalizedTurnId && currentTurnId) {
    return false;
  }
  if (!normalizedThreadId && currentThreadId) {
    return false;
  }
  return true;
}

function codexAppServerTurnCanReceiveProviderCompletion(turn = {}, threadId = "", turnId = "") {
  return codexAppServerTurnMatches(turn, threadId, turnId) &&
    ["active", "finalizing"].includes(normalizeText(turn.state));
}

function codexAppServerTurnAwaitsProviderIdentity(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  return normalizeText(turn.state) === "starting" &&
    Boolean(normalizedTurnId) &&
    !normalizeText(turn.turnId) &&
    (!normalizedThreadId || !currentThreadId || normalizedThreadId === currentThreadId);
}

function codexAppServerTurnCanReceiveProviderActivity(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  if (!["starting", "active"].includes(normalizeText(turn.state))) {
    return false;
  }
  if (normalizedThreadId && currentThreadId && currentThreadId !== normalizedThreadId) {
    return false;
  }
  if (normalizedTurnId && currentTurnId && currentTurnId !== normalizedTurnId) {
    return false;
  }
  if (normalizedThreadId && !currentThreadId) {
    return false;
  }
  return true;
}

function dateValueMs(value = "") {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function codexAppServerFinalizingExpired(turn = {}, nowMs = Date.now()) {
  if (normalizeText(turn.state) !== "finalizing") {
    return false;
  }
  const referenceMs = dateValueMs(turn.completedAt) || dateValueMs(turn.updatedAt);
  return Boolean(referenceMs && nowMs - referenceMs >= CODEX_APP_SERVER_FINALIZING_GRACE_MS);
}

function codexAppServerFinalizingRemainingMs(turn = {}, nowMs = Date.now()) {
  const referenceMs = dateValueMs(turn.completedAt) || dateValueMs(turn.updatedAt);
  if (!referenceMs) {
    return CODEX_APP_SERVER_FINALIZING_GRACE_MS;
  }
  return Math.max(0, CODEX_APP_SERVER_FINALIZING_GRACE_MS - (nowMs - referenceMs));
}

function codexAppServerBackgroundTasks(session = {}) {
  return [
    ...(Array.isArray(session.backgroundTasks) ? session.backgroundTasks : []),
    ...(Array.isArray(session.presentation?.backgroundTasks) ? session.presentation.backgroundTasks : [])
  ];
}

function codexAppServerTaskFinishedAfterRun(session = {}, run = {}) {
  const runUpdatedMs = dateValueMs(run?.updatedAt || run?.startedAt || run?.at);
  if (!runUpdatedMs) {
    return false;
  }
  return codexAppServerBackgroundTasks(session).some((task) => (
    normalizeText(task?.id) === CODEX_APP_SERVER_TASK_ID &&
    ["failed", "ready"].includes(normalizeText(task?.status)) &&
    dateValueMs(task?.updatedAt || task?.finishedAt || task?.at) > runUpdatedMs
  ));
}

function abandonedCodexAppServerPromptClaim(session = {}) {
  const run = codexAppServerAgentRun(session);
  if (!run) {
    return null;
  }
  return (
    (run.active === true || vibe64AgentRunStateIsActive(run.state)) &&
    normalizeText(run.state) === VIBE64_AGENT_RUN_STATE.STARTING &&
    !normalizeText(run.providerThreadId) &&
    !normalizeText(run.providerTurnId) &&
    codexAppServerTaskFinishedAfterRun(session, run)
  ) ? run : null;
}

async function recoverAbandonedCodexAppServerPromptClaim(runtime, session = {}) {
  const run = abandonedCodexAppServerPromptClaim(session);
  if (!run || !session?.sessionId || typeof runtime?.store?.writeAgentRunEvent !== "function") {
    return {
      recovered: false,
      session
    };
  }
  const error = "Codex app-server prompt delivery ended before a provider turn was created.";
  await runtime.store.writeAgentRunEvent(session.sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
    event: {
      kind: "codex-prompt-delivery-abandoned",
      message: error,
      state: VIBE64_AGENT_RUN_STATE.FAILED
    },
    patch: {
      error,
      provider: CODEX_AGENT_PROVIDER,
      providerInterface: "codex_app_server",
      providerStatus: "delivery_failed",
      providerThreadId: "",
      providerTurnId: "",
      state: VIBE64_AGENT_RUN_STATE.FAILED,
      stepId: normalizeText(session.currentStep),
      stepStatus: normalizeText(session.stepMachine?.status),
      updatedAt: new Date().toISOString()
    }
  });
  vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.abandoned", {
    runUpdatedAt: normalizeText(run.updatedAt),
    sessionId: session.sessionId
  });
  return {
    recovered: true,
    session: await runtime.getSession(session.sessionId)
  };
}

function codexState(session = {}, {
  codexTerminal = activeCodexTerminal(session)
} = {}) {
  const workdir = terminalWorktreePath(session);
  const codexConversationId = codexConversationIdForWorkdir(session, workdir);
  const codexThreadId = normalizeCodexThreadId(codexConversationId);
  const agentIdentity = codexAgentIdentityState(session, workdir);
  const agentTurn = codexAppServerTurnState(session);
  return {
    agentIdentity,
    codexAgentTurn: agentTurn,
    codexWorkdir: workdir,
    codexTerminal,
    codexThreadId
  };
}

function codexConversationIdForWorkdir(session = {}, workdir = "") {
  return codexReadyIdentityForWorkdir(session, workdir)?.conversationId || "";
}

function codexThreadIdForWorkdir(session = {}, workdir = "") {
  return normalizeCodexThreadId(codexConversationIdForWorkdir(session, workdir));
}

function codexRemoteEndpointForWorkdir(session = {}, workdir = "") {
  if (!codexThreadIdForWorkdir(session, workdir)) {
    return "";
  }
  const metadata = session.metadata || {};
  const endpoint = normalizeText(metadata.agent_transport_endpoint);
  return endpoint ? codexAppServerEndpointForTarget(endpoint) : "";
}

function codexReadyIdentityForWorkdir(session = {}, workdir = "") {
  const normalizedWorkdir = workdir ? path.resolve(workdir) : terminalWorktreePath(session);
  const identity = agentTerminalIdentityForWorkdir(session, {
    provider: CODEX_AGENT_PROVIDER,
    validateConversationId: normalizeCodexConversationId,
    workdir: normalizedWorkdir
  });
  if (identity) {
    return identity;
  }

  return null;
}

function codexAgentIdentityState(session = {}, workdir = "") {
  const normalizedWorkdir = workdir ? path.resolve(workdir) : terminalWorktreePath(session);
  const readyIdentity = codexReadyIdentityForWorkdir(session, workdir);
  if (readyIdentity) {
    return readyIdentity;
  }

  return agentTerminalIdentityState(session, {
    provider: CODEX_AGENT_PROVIDER,
    validateConversationId: normalizeCodexConversationId,
    workdir: normalizedWorkdir
  });
}

function withCodexState(response = {}, session = {}) {
  return {
    ...response,
    ...codexState(session)
  };
}

function codexAppServerTurnAlreadyRunningResponse(session = {}) {
  const turn = codexAppServerTurnState(session);
  return withCodexState({
    ok: false,
    code: CODEX_AGENT_TURN_ALREADY_RUNNING_CODE,
    error: "Codex is already working on this Vibe64 session.",
    operationOutcome: "agent_already_running",
    refreshRecommended: true,
    threadId: normalizeText(turn.threadId),
    turnId: normalizeText(turn.turnId)
  }, session);
}

function codexAppServerInterruptFailure(result = {}) {
  if (!isRecord(result)) {
    return null;
  }
  if (result.ok !== false && result.interrupted !== false) {
    return null;
  }
  return {
    code: normalizeText(result.code) || CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE,
    error: errorMessage(result, "Codex app-server turn could not be interrupted."),
    ok: false,
    operationOutcome: normalizeText(result.operationOutcome) || "interrupt_failed",
    refreshRecommended: true,
    retryable: result.retryable === true
  };
}

function codexAppServerInterruptUnavailableResponse({
  active = false,
  threadId = "",
  turnId = ""
} = {}) {
  return {
    active: active === true,
    code: CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE,
    error: active
      ? "The active Codex app-server turn is not ready to interrupt yet."
      : "No active Codex app-server turn is available to interrupt.",
    ok: false,
    operationOutcome: "interrupt_unavailable",
    refreshRecommended: true,
    retryable: active === true,
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
  };
}

function codexAppServerSteerFailure(result = {}) {
  if (!isRecord(result)) {
    return null;
  }
  if (result.ok !== false) {
    return null;
  }
  return {
    code: normalizeText(result.code) || CODEX_AGENT_TURN_STEER_FAILED_CODE,
    error: errorMessage(result, "Codex app-server turn could not be steered."),
    ok: false,
    operationOutcome: normalizeText(result.operationOutcome) || "steer_failed",
    refreshRecommended: true,
    retryable: result.retryable === true
  };
}

function codexAppServerMessageRequiresNewTurn(session = {}, {
  reason = "provider_idle",
  threadId = "",
  turnId = ""
} = {}) {
  return withCodexState({
    delivered: false,
    deliveryMode: "new_turn",
    newTurnRequired: true,
    ok: true,
    operationOutcome: "new_turn_required",
    reason: normalizeText(reason),
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
  }, session);
}

function codexAppServerMessageDeferred(session = {}, {
  threadId = "",
  turnId = ""
} = {}) {
  return withCodexState({
    code: CODEX_AGENT_TURN_STEER_FAILED_CODE,
    delivered: false,
    error: "The active assistant operation cannot accept messages yet.",
    ok: false,
    operationOutcome: "active_turn_not_steerable",
    refreshRecommended: true,
    retryable: true,
    threadId,
    turnId
  }, session);
}

function codexAppServerMessageText(input = {}) {
  if (typeof input === "string") {
    return normalizeText(input);
  }
  if (!isRecord(input)) {
    return "";
  }
  const fields = isRecord(input.fields) ? input.fields : {};
  const displayFields = isRecord(input.displayFields) ? input.displayFields : {};
  return normalizeText(
    fields.conversationRequest ||
    fields.message ||
    input.message ||
    input.text ||
    displayFields.conversationRequest ||
    displayFields.message
  );
}

function codexAppServerMessageDisplayText(input = {}, fallback = "") {
  if (!isRecord(input)) {
    return normalizeText(fallback || input);
  }
  const fields = isRecord(input.fields) ? input.fields : {};
  const displayFields = isRecord(input.displayFields) ? input.displayFields : {};
  return normalizeText(
    displayFields.conversationRequest ||
    displayFields.message ||
    fields.conversationRequest ||
    fields.message ||
    input.text ||
    input.message ||
    fallback
  );
}

function sessionBriefingIsDelivered(session = {}) {
  return normalizeText(session.metadata?.agent_briefing_delivered) === "yes";
}

function codexAppServerDeveloperInstructions(session = {}) {
  const briefing = promptSessionBriefing({
    config: session.config,
    session
  });
  return [
    briefing,
    "",
    "Session briefing instruction:",
    "Keep this Vibe64 briefing as the source of truth for this Codex session. Do not start project work from this briefing alone.",
    "",
    "Live progress instruction:",
    "When you send progress updates before the final answer, keep each update short, calm, and friendly to non-technical users.",
    "Use progress only for brief status notes, not for the plan or final answer.",
    "Describe the visible user-facing work in plain language. Keep detailed commands, package names, and logs for the terminal or final answer when they matter.",
    "",
    "GitHub operation instruction:",
    "`git` and `gh` are available in this session.",
    "They run as the GitHub account recorded as this session's Git command actor.",
    "Use normal `git` and `gh` commands for status, commits, pushes, issues, pull requests, and merges.",
    "If GitHub authentication is unavailable, report the command error clearly instead of trying to log in or inspect credentials."
  ].join("\n").trim();
}

function codexContextRefreshPending(session = {}) {
  return normalizeText(session.metadata?.codex_context_refresh_pending) === "yes";
}

function createCodexAppServerHealthAttempt() {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString()
  };
}

function codexGitCommandWrapperSetupLines() {
  return [
    `if [ -n "\${${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}:-}" ]; then`,
    "  if [ \"$(id -u)\" = \"0\" ]; then",
    "    for VIBE64_CODEX_GIT_COMMAND_NAME in git gh; do",
    `      if [ -x "$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}/$VIBE64_CODEX_GIT_COMMAND_NAME" ]; then`,
    `        ln -sfn "$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}/$VIBE64_CODEX_GIT_COMMAND_NAME" "/usr/local/bin/$VIBE64_CODEX_GIT_COMMAND_NAME"`,
    "      fi",
    "    done",
    "    unset VIBE64_CODEX_GIT_COMMAND_NAME",
    "  fi",
    "fi"
  ];
}

function codexGitCommandShimDirs(codexRuntime = {}) {
  const terminalProcessEnv = codexRuntime?.terminalProcessEnv || {};
  const terminalEnv = codexRuntime?.terminalEnv || {};
  const wrapperDir = normalizeText(
    terminalProcessEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV] ||
    terminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]
  );
  return wrapperDir && path.isAbsolute(wrapperDir) ? [path.resolve(wrapperDir)] : [];
}

function codexStartupScript(codexThreadId = "", {
  agentSettings = {},
  remoteEndpoint = ""
} = {}) {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const normalizedRemoteEndpoint = normalizeText(remoteEndpoint);
  const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
  const codexReasoningConfig = `model_reasoning_effort="${effectiveSettings.thinking}"`;
  const codexCommand = [
    STUDIO_MANAGED_CODEX_COMMAND,
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    ...(normalizedRemoteEndpoint ? ["--remote", normalizedRemoteEndpoint] : []),
    "--model",
    effectiveSettings.model,
    "-c",
    codexReasoningConfig,
    "--dangerously-bypass-approvals-and-sandbox",
    ...(normalizedThreadId ? ["resume", normalizedThreadId] : [])
  ];
  return studioUserStartupScript(codexCommand, {
    setupLines: [
      "umask 0007",
      ...codexGitCommandWrapperSetupLines()
    ]
  });
}

function codexTerminalArgs({
  agentSettings = {},
  codexRemoteEndpoint = "",
  codexThreadId
}) {
  return [
    "-lc",
    codexStartupScript(codexThreadId, {
      agentSettings,
      remoteEndpoint: codexRemoteEndpoint
    })
  ];
}

function createCodexTerminalController({
  agentPreviewCommand = null,
  codexAuthPreflight = assertCodexAuthPreflightReady,
  codexAppServerActiveReconcileMs = CODEX_APP_SERVER_ACTIVE_RECONCILE_MS,
  codexAppServerProviderOptions = {},
  codexAppServerProviderFactory = createCodexAppServerAgentProvider,
  codexAppServerPromptDeliveryEnabled = CODEX_APP_SERVER_PROMPT_DELIVERY_ENABLED,
  codexToolHomeRequired = false,
  codexToolHomeSource = "",
  env = process.env,
  fixJobStore = defaultFixCodexJobStore,
  codexGitCommand = null,
  projectService,
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

  const codexAppServerProviders = new Map();
  const codexAppServerEventSubscriptions = new Map();
  const codexAppServerManagedSessions = new Map();
  const codexAppServerWellbeingTimers = new Map();
  const codexAppServerCompletedTurns = new Set();
  const codexAppServerFinalizedTurns = new Set();
  const codexAppServerActiveTimers = new Map();
  const codexAppServerFinalizingTimers = new Map();
  const codexAppServerResultFinalizations = new Map();
  const codexAppServerThreadReconciliations = new Map();
  let codexAppServerThreadReconcileGeneration = 0;
  const codexAppServerFinalAssistantResults = new Map();
  const codexAppServerReasoningTurns = new Map();
  const codexAppServerReasoningPersistQueues = new Map();
  const codexAppServerLiveProgressItems = new Set();
  const codexAppServerMirroredTerminalItems = new Set();
  const codexAppServerNotificationTasks = new Map();

  function createRuntimeForSession(sessionId = "") {
    return projectService.createRuntime({
      input: {
        sessionId
      }
    });
  }

  function resolvedCodexToolHomeSource() {
    return normalizeText(codexToolHomeSource || codexAppServerProviderOptions.toolHomeSource);
  }

  function codexAttachmentEnv() {
    return codexAttachmentEnvForController(env);
  }

  function codexRuntimeForTerminalEnv({
    terminalEnv = {},
    toolHomeSource = ""
  } = {}) {
    const runtimeContext = codexRuntimeContext({
      env,
      providerOptions: codexAppServerProviderOptions,
      terminalEnv,
      toolHomeSource: normalizeText(toolHomeSource) || resolvedCodexToolHomeSource()
    });
    if (runtimeContext?.ok === false) {
      throw new Error(runtimeContext.error || "Codex runtime context could not be resolved.");
    }
    return runtimeContext;
  }

  async function startCodexGatewayTerminal({
    args,
    codexRuntime,
    cwd = "",
    detachedIdleTimeoutMs = 0,
    maxRunning = MAX_OPEN_CODEX_TERMINALS,
    metadata = {},
    namespace = "",
    onClose = async () => null,
    reuseRunning = false,
    session = {},
    targetRoot = "",
    workdir = ""
  } = {}) {
    return runCommand({
      actor: "app",
      allowedRoots: [
        targetRoot,
        cwd,
        workdir
      ].filter(Boolean),
      args,
      baseEnv: codexRuntime?.env || {},
      command: "bash",
      credentialHome: {
        home: codexRuntime?.toolHomeSource || "",
        username: codexRuntime?.username || codexRuntime?.userKey || ""
      },
      cwd,
      env: codexRuntime?.terminalEnv || {},
      envPolicy: "auth",
      mode: "pty",
      project: {
        targetRoot
      },
      purpose: "codex",
      session,
      shimDirs: codexGitCommandShimDirs(codexRuntime),
      terminal: {
        commandPreview: "codex",
        detachedIdleTimeoutMs,
        maxRunning,
        metadata,
        namespace,
        onClose,
        reuseRunning
      }
    });
  }

  async function rememberCodexReconnectRequired({
    reason = "codex-terminal",
    toolHomeSource = ""
  } = {}) {
    void toolHomeSource;
    const systemRoot = normalizeText(codexAppServerProviderOptions.systemRoot);
    if (!systemRoot) {
      return;
    }
    try {
      await markCodexReconnectRequired(systemRoot, {
        reason
      });
    } catch (error) {
      vibe64SessionDebugLog("server.terminals.codex.reconnect_marker.error", {
        error: vibe64SessionDebugError(error),
        reason
      });
    }
  }

  async function codexReconnectTerminalFailureForError(error = null, {
    reason = "codex-terminal",
    toolHomeSource = ""
  } = {}) {
    const reconnectFailure = codexReconnectTerminalFailure(error);
    if (!reconnectFailure) {
      return null;
    }
    await rememberCodexReconnectRequired({
      reason,
      toolHomeSource
    });
    return reconnectFailure;
  }

  async function codexToolHomeResult() {
    const toolHomeSource = resolvedCodexToolHomeSource();
    if (!toolHomeSource) {
      return codexToolHomeRequired
        ? retryableTerminalFailure({
            ok: false,
            error: "Codex account storage is not available. Connect Codex before starting a Codex terminal."
          })
        : {
            ok: true,
            toolHomeSource: ""
          };
    }
    if (codexToolHomeRequired && !await directoryExists(toolHomeSource)) {
      return retryableTerminalFailure({
        ok: false,
        error: "Codex is not ready for terminals. Connect Codex before continuing."
      });
    }
    return {
      ok: true,
      toolHomeSource
    };
  }

  async function codexGitCommandEnv({
    runtime = null,
    sessionId = ""
  } = {}) {
    if (!codexGitCommand || !normalizeText(sessionId)) {
      return {};
    }
    const prepared = await prepareCodexGitCommand({
      commandService: codexGitCommand,
      env: codexAttachmentEnv(),
      sessionId,
      stateRoot: normalizeText(runtime?.stateRoot)
    });
    if (prepared?.ok !== true) {
      return prepared?.env || {};
    }
    const previewPrepared = await prepareAgentPreviewCommand({
      commandService: agentPreviewCommand,
      env,
      sessionId,
      wrapperHostDir: prepared.hostWrapperDir
    });
    return {
      ...(prepared.env || {}),
      ...(previewPrepared?.env || {})
    };
  }

  async function withCodexSessionStartupGate({
    operation,
    runtime,
    session = {},
    sessionId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const runOperation = async (currentSession = session) => {
      if (codexSessionWorktreeIsUnavailable(currentSession)) {
        const failure = codexSessionWorktreeUnavailableFailure({
          session: currentSession,
          workdir: terminalWorktreePath(currentSession)
        });
        const error = new Error(failure.error);
        error.code = failure.code;
        error.retryable = failure.retryable;
        error.workdir = failure.workdir;
        throw error;
      }
      return operation(currentSession);
    };

    if (
      !normalizedSessionId ||
      typeof runtime?.store?.mutateSession !== "function" ||
      typeof runtime?.getSession !== "function"
    ) {
      return runOperation(session);
    }

    return runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSession(normalizedSessionId);
      return runOperation(currentSession);
    });
  }

  async function codexProjectTerminalEnv({
    runtime,
    session = {},
    sessionId = "",
    target = "codex",
    targetRoot = ""
  } = {}) {
    const terminalEnvForSession = async (currentSession = session) => ({
      ...await loadProjectExecutionEnv({
        projectService,
        runtime,
        session: currentSession,
        target,
        targetRoot
      }),
      ...await codexGitCommandEnv({
        runtime,
        sessionId
      })
    });

    return withCodexSessionStartupGate({
      operation: terminalEnvForSession,
      runtime,
      session,
      sessionId
    });
  }

  async function codexProjectTerminalEnvFailureResult(error = null, {
    runtime,
    sessionId = ""
  } = {}) {
    if (normalizeText(error?.code) !== CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE) {
      return null;
    }
    const session = typeof runtime?.getSession === "function"
      ? await runtime.getSession(sessionId).catch(() => null)
      : null;
    const failure = codexSessionWorktreeUnavailableFailure({
      session: session || {},
      workdir: normalizeText(error?.workdir)
    });
    return {
      ...failure,
      error: errorMessage(error, failure.error)
    };
  }

  async function codexAuthPreflightFailure({
    reason = "codex-terminal",
    terminalEnv = {},
    toolHomeSource = ""
  } = {}) {
    if (typeof codexAuthPreflight !== "function") {
      return null;
    }
    try {
      await codexAuthPreflight({
        ...codexAppServerProviderOptions,
        terminalEnv,
        toolHomeSource
      }, {
        reason
      });
      return null;
    } catch (error) {
      const reconnectFailure = await codexReconnectTerminalFailureForError(error, {
        reason,
        toolHomeSource
      });
      if (reconnectFailure) {
        return reconnectFailure;
      }
      return retryableTerminalFailure({
        code: error?.code || "",
        errors: Array.isArray(error?.errors) ? error.errors : undefined,
        ok: false,
        error: `Codex authentication could not be checked: ${errorMessage(error)}`
      });
    }
  }

  function codexAppServerProviderKey(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw new Error("Vibe64 session ID is required.");
    }
    const runtimeIdsHash = stableHash(JSON.stringify(Array.isArray(options.runtimes) ? options.runtimes : []));
    return [
      normalizedSessionId,
      normalizeText(options.targetRoot),
      normalizeText(options.runtimeInstanceId),
      runtimeIdsHash,
      executionEnvFingerprint(codexAppServerProviderIdentityEnv(options.terminalEnv)),
      normalizeText(options.toolHomeSource),
      normalizeText(options.workdir)
    ].join(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
  }

  function codexAppServerProviderKeyFields(providerKey = "") {
    const [
      sessionId = "",
      targetRoot = "",
      runtimeInstanceId = "",
      runtimesHash = "",
      envHash = "",
      toolHomeSource = "",
      workdir = ""
    ] = normalizeText(providerKey).split(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
    return {
      envHash: normalizeText(envHash),
      runtimeInstanceId: normalizeText(runtimeInstanceId),
      runtimesHash: normalizeText(runtimesHash),
      sessionId: normalizeText(sessionId),
      targetRoot: normalizeText(targetRoot),
      toolHomeSource: normalizeText(toolHomeSource),
      workdir: normalizeText(workdir)
    };
  }

  function codexAppServerProviderIdentityEnv(env = {}) {
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      return {};
    }
    return Object.fromEntries(Object.entries(env)
      .filter(([key]) => !CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS.has(String(key || "").trim())));
  }

  function codexAppServerProviderForSession(sessionId = "", options = {}) {
    const providerKey = codexAppServerProviderKey(sessionId, options);
    const existing = codexAppServerProviders.get(providerKey);
    if (existing) {
      return existing;
    }
    const provider = codexAppServerProviderFactory(options);
    codexAppServerProviders.set(providerKey, provider);
    return provider;
  }

  function codexAppServerProviderIsAvailableForSession(sessionId = "", options = {}) {
    const providerOptions = codexAppServerRuntimeOptions(options);
    const providerKey = codexAppServerProviderKey(sessionId, providerOptions);
    const provider = codexAppServerProviders.get(providerKey);
    return provider?.isAvailable?.() === true;
  }

  function availableManagedCodexAppServerProvider(sessionId = "", {
    targetRoot = "",
    workdir = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedTargetRoot = normalizeText(targetRoot);
    const normalizedWorkdir = normalizeText(workdir);
    for (const [providerKey, managed] of codexAppServerManagedSessions.entries()) {
      const fields = codexAppServerProviderKeyFields(providerKey);
      if (
        fields.sessionId !== normalizedSessionId ||
        (normalizedTargetRoot && fields.targetRoot !== normalizedTargetRoot) ||
        (normalizedWorkdir && fields.workdir !== normalizedWorkdir) ||
        normalizeText(managed?.sessionId) !== normalizedSessionId
      ) {
        continue;
      }
      const provider = codexAppServerProviders.get(providerKey);
      if (provider?.isAvailable?.() === true) {
        return provider;
      }
    }
    return null;
  }

  async function ensureCodexAppServerDaemonForSession(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const providerOptions = codexAppServerRuntimeOptions(options);
    const provider = codexAppServerProviderForSession(normalizedSessionId, providerOptions);
    try {
      if (typeof provider.ensureAvailable === "function") {
        await provider.ensureAvailable();
      } else if (typeof provider.listLoadedThreads === "function") {
        await provider.listLoadedThreads({
          limit: 1
        });
      } else {
        await provider.ensureRuntime?.();
      }
      return provider;
    } catch (error) {
      closeCodexAppServerProviderForSession(normalizedSessionId, providerOptions);
      throw error;
    }
  }

  function codexAppServerEventSubscriptionKey(providerKey = "", threadId = "") {
    return `${normalizeText(providerKey)}:${normalizeText(threadId)}`;
  }

  function codexAppServerProviderConnectionGeneration(provider = null) {
    const generation = typeof provider?.currentConnectionGeneration === "function"
      ? provider.currentConnectionGeneration()
      : typeof provider?.connectionGeneration === "function"
        ? provider.connectionGeneration()
        : provider?.connectionGeneration;
    return normalizeText(generation);
  }

  function codexAppServerEventSubscriptionRecord(value = null) {
    if (typeof value === "function") {
      return {
        connectionGeneration: "",
        unsubscribe: value
      };
    }
    if (!isRecord(value)) {
      return null;
    }
    return {
      connectionGeneration: normalizeText(value.connectionGeneration),
      unsubscribe: typeof value.unsubscribe === "function" ? value.unsubscribe : null
    };
  }

  function codexAppServerEventSubscriptionIsCurrent(key = "", provider = null) {
    const record = codexAppServerEventSubscriptionRecord(
      codexAppServerEventSubscriptions.get(key)
    );
    if (!record) {
      return false;
    }
    const providerGeneration = codexAppServerProviderConnectionGeneration(provider);
    return !providerGeneration || record.connectionGeneration === providerGeneration;
  }

  function unsubscribeCodexAppServerEventSubscription(key = "") {
    const record = codexAppServerEventSubscriptionRecord(
      codexAppServerEventSubscriptions.get(key)
    );
    record?.unsubscribe?.();
    codexAppServerEventSubscriptions.delete(key);
  }

  function codexAppServerRuntimeOptions({
    project = {},
    runtimeDir = "",
    runtimeInstanceId = "",
    session = {},
    targetRoot = "",
    terminalEnv = {},
    toolHomeSource = "",
    userKey = "",
    workdir = ""
  } = {}) {
    const runtimeContext = codexRuntimeForTerminalEnv({
      terminalEnv,
      toolHomeSource
    });
    return {
      ...runtimeContext.providerOptions,
      project,
      runtimeDir: normalizeText(runtimeDir),
      runtimeInstanceId: normalizeText(runtimeInstanceId),
      session,
      targetRoot: normalizeText(targetRoot),
      terminalEnv: runtimeContext.terminalEnv,
      toolHomeSource: runtimeContext.toolHomeSource,
      userKey: normalizeText(userKey),
      workdir: normalizeText(workdir)
    };
  }

  function codexAppServerProjectContext(terminalEnv = {}) {
    return {
      tenant: normalizeText(terminalEnv.VIBE64_RUNTIME_NAMESPACE || terminalEnv.VIBE64_WORKSPACE),
      workspace: normalizeText(terminalEnv.VIBE64_WORKSPACE || terminalEnv.VIBE64_RUNTIME_NAMESPACE)
    };
  }

  function codexAppServerSessionRequestContext(session = {}, {
    targetRoot = ""
  } = {}) {
    return {
      metadata: isRecord(session.metadata) ? session.metadata : {},
      sessionId: normalizeText(session.sessionId || session.id),
      targetRoot: normalizeText(targetRoot || session.targetRoot)
    };
  }

  function codexAppServerUserKey(session = {}) {
    return normalizeText(session.metadata?.workflow_driver_username);
  }

  async function codexAppServerRuntimeOptionsForSession(session = {}, {
    runtime = null,
    runtimeDir = "",
    targetRoot = "",
    terminalEnv,
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    const metadata = session.metadata || {};
    const effectiveRuntimeInstanceId = normalizeText(session.sessionId || session.id);
    const effectiveTargetRoot = normalizeText(targetRoot) || terminalTargetRoot(session, projectService);
    const effectiveWorkdir = normalizeText(workdir) || terminalWorktreePath(session);
    const effectiveRuntime = runtime || await createRuntimeForSession(effectiveRuntimeInstanceId);
    const baseTerminalEnv = isRecord(terminalEnv)
      ? terminalEnv
      : await loadProjectExecutionEnv({
          projectService,
          runtime: effectiveRuntime,
          session,
          target: "codex",
          targetRoot: effectiveTargetRoot
        });
    const effectiveTerminalEnv = {
      ...baseTerminalEnv,
        ...await codexGitCommandEnv({
          runtime: effectiveRuntime,
          sessionId: effectiveRuntimeInstanceId
        })
    };
    const expectedRuntimeDir = codexAppServerRuntimeDir({
      ...codexAppServerProviderOptions,
      runtimeInstanceId: effectiveRuntimeInstanceId,
      targetRoot: effectiveTargetRoot,
      workdir: effectiveWorkdir
    });
    const metadataRuntimeDir = normalizeText(metadata.agent_transport_runtime_dir);
    const reusableMetadataRuntimeDir = metadataRuntimeDir && path.resolve(metadataRuntimeDir) === path.resolve(expectedRuntimeDir)
      ? metadataRuntimeDir
      : "";
    return codexAppServerRuntimeOptions({
      project: codexAppServerProjectContext(effectiveTerminalEnv),
      runtimeDir: normalizeText(runtimeDir) || reusableMetadataRuntimeDir,
      runtimeInstanceId: effectiveRuntimeInstanceId,
      session: codexAppServerSessionRequestContext(session, {
        targetRoot: effectiveTargetRoot
      }),
      targetRoot: effectiveTargetRoot,
      terminalEnv: effectiveTerminalEnv,
      toolHomeSource,
      userKey: codexAppServerUserKey(session),
      workdir: effectiveWorkdir
    });
  }

  function sessionHasCodexAppServerRuntime(session = {}) {
    const metadata = session.metadata || {};
    return Boolean(
      normalizeText(metadata.agent_transport_endpoint) ||
      normalizeText(metadata.agent_transport_runtime_dir) ||
      normalizeText(metadata.agent_transport_socket_path)
    );
  }

  function clearCodexAppServerActiveTimer(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const timer = codexAppServerActiveTimers.get(normalizedSessionId);
    if (timer) {
      clearTimeout(timer);
      codexAppServerActiveTimers.delete(normalizedSessionId);
    }
  }

  function scheduleCodexAppServerActiveRecovery(sessionId = "", delayMs = codexAppServerActiveReconcileMs) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId || codexAppServerActiveTimers.has(normalizedSessionId)) {
      return;
    }
    const timer = setTimeout(() => {
      codexAppServerActiveTimers.delete(normalizedSessionId);
      void recoverCodexAppServerActiveTurn(normalizedSessionId);
    }, delayMs);
    timer.unref?.();
    codexAppServerActiveTimers.set(normalizedSessionId, timer);
  }

  function clearCodexAppServerFinalizingTimer(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerResultFinalizationKey(sessionId, threadId, turnId);
    const timer = codexAppServerFinalizingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      codexAppServerFinalizingTimers.delete(key);
    }
  }

  function scheduleCodexAppServerFinalizingRecovery(sessionId = "", threadId = "", turnId = "", {
    completedAt = "",
    status = "completed",
    updatedAt = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return;
    }
    clearCodexAppServerFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const delayMs = codexAppServerFinalizingRemainingMs({
      completedAt,
      state: "finalizing",
      updatedAt
    });
    const timer = setTimeout(() => {
      codexAppServerFinalizingTimers.delete(
        codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId)
      );
      void recoverCodexAppServerFinalizingTurn(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          status
        }
      );
    }, delayMs);
    timer.unref?.();
    codexAppServerFinalizingTimers.set(
      codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId),
      timer
    );
  }

  function codexAppServerThreadStatus(thread = {}) {
    let rawThread = thread;
    if (isRecord(thread.raw)) {
      rawThread = thread.raw;
    } else if (isRecord(thread.response?.thread)) {
      rawThread = thread.response.thread;
    }
    return codexAppServerStatusFromValue(rawThread.status || thread.status);
  }

  function codexAppServerThreadRawValue(thread = {}) {
    if (isRecord(thread.raw)) {
      return thread.raw;
    }
    if (isRecord(thread.response?.thread)) {
      return thread.response.thread;
    }
    return isRecord(thread) ? thread : {};
  }

  function codexAppServerThreadTurnId(thread = {}) {
    const rawThread = codexAppServerThreadRawValue(thread);
    const status = isRecord(rawThread.status) ? rawThread.status : {};
    return normalizeText(
      thread.turnId ||
      thread.turn_id ||
      thread.turn?.id ||
      rawThread.turnId ||
      rawThread.turn_id ||
      rawThread.turn?.id ||
      rawThread.currentTurnId ||
      rawThread.current_turn_id ||
      rawThread.activeTurnId ||
      rawThread.active_turn_id ||
      status.turnId ||
      status.turn_id ||
      status.turn?.id ||
      status.currentTurnId ||
      status.current_turn_id ||
      status.activeTurnId ||
      status.active_turn_id
    );
  }

  function codexAppServerThreadError(thread = {}) {
    const rawThread = codexAppServerThreadRawValue(thread);
    const status = isRecord(rawThread.status) ? rawThread.status : {};
    return codexAppServerErrorText(rawThread.error || status.error);
  }

  function codexAppServerReadyTurnFailureMessage(reason = "", error = "") {
    const detail = normalizeText(error);
    if (detail) {
      return detail;
    }
    switch (normalizeText(reason)) {
      case "thread_replaced":
        return "Codex app-server resumed a different thread before this turn completed.";
      case "provider_unreadable":
        return "Codex app-server could not confirm the active turn after restart.";
      case "missing_status":
        return "Codex app-server did not report the active turn status after restart.";
      case "missing_turn":
        return "Codex app-server did not report the active turn after restart.";
      case "turn_mismatch":
        return "Codex app-server reported a different active turn after restart.";
      default:
        return "Codex app-server could not recover the active turn after restart.";
    }
  }

  async function failCodexAppServerTrackedReadyTurn(sessionId = "", turn = {}, {
    error = "",
    reason = "",
    status = "failed",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId) || normalizeText(turn.threadId);
    const normalizedTurnId = normalizeText(turnId) || normalizeText(turn.turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return {
        ok: false,
        processed: false,
        reason: "missing_tracked_turn"
      };
    }
    return stopCodexAppServerTurnWithProviderFailure(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        error: codexAppServerReadyTurnFailureMessage(reason, error),
        status
      }
    );
  }

  async function reconcileCodexAppServerThreadStatus(sessionId = "", provider = null, threadId = "", {
    failUnconfirmedTrackedTurn = false,
    requireTrackedTurn = false,
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const runtime = normalizedSessionId
      ? await createRuntimeForSession(normalizedSessionId)
      : null;
    const session = runtime
      ? await runtime.getSession(normalizedSessionId)
      : {};
    const trackedTurn = codexAppServerTurnState(session);
    const trackedActiveTurn = trackedTurn.state === "active" && trackedTurn.active && trackedTurn.threadId
      ? trackedTurn
      : null;
    const statusThreadId = normalizeText(trackedActiveTurn?.threadId) || normalizedThreadId;
    const shouldFailUnconfirmed = failUnconfirmedTrackedTurn && trackedActiveTurn;
    if (!normalizedSessionId || !normalizedThreadId) {
      return {
        ok: true,
        status: "notRead"
      };
    }
    if (requireTrackedTurn && !trackedActiveTurn) {
      return {
        ok: true,
        status: "notTracked"
      };
    }

    if (shouldFailUnconfirmed && statusThreadId !== normalizedThreadId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.trackedThreadReplaced", {
        currentThreadId: normalizedThreadId,
        sessionId: normalizedSessionId,
        source: normalizeText(source),
        trackedThreadId: statusThreadId,
        trackedTurnId: trackedActiveTurn.turnId
      });
      return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedActiveTurn, {
        reason: "thread_replaced"
      });
    }

    if (typeof provider?.readThreadStatus !== "function") {
      if (shouldFailUnconfirmed) {
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedActiveTurn, {
          reason: "provider_unreadable"
        });
      }
      return {
        ok: true,
        status: "notRead"
      };
    }

    let thread = null;
    try {
      thread = await codexAppServerReadThreadStatus(provider, statusThreadId);
    } catch (error) {
      if (shouldFailUnconfirmed) {
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.readFailed", {
          error: vibe64SessionDebugError(error),
          sessionId: normalizedSessionId,
          source: normalizeText(source),
          threadId: statusThreadId,
          turnId: trackedActiveTurn.turnId
        });
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedActiveTurn, {
          error: errorMessage(error, "Codex app-server could not confirm the active turn after restart."),
          reason: "provider_unreadable"
        });
      }
      throw error;
    }

    const status = codexAppServerThreadStatus(thread);
    const turnId = codexAppServerThreadTurnId(thread);
    if (!status) {
      if (shouldFailUnconfirmed) {
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedActiveTurn, {
          reason: "missing_status"
        });
      }
      return {
        ok: true,
        status: "unknown"
      };
    }
    if (codexAppServerTurnStatusIsActive(status)) {
      if (!turnId) {
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.activeWithoutTurn", {
          sessionId: normalizedSessionId,
          status,
          source: normalizeText(source),
          threadId: statusThreadId,
          trackedTurnId: trackedActiveTurn?.turnId || ""
        });
        return {
          ok: true,
          status
        };
      }
      if (
        shouldFailUnconfirmed &&
        trackedActiveTurn.turnId &&
        normalizeText(trackedActiveTurn.turnId) !== turnId
      ) {
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedActiveTurn, {
          reason: "turn_mismatch"
        });
      }
      await markCodexAppServerProviderTurnActive(normalizedSessionId, {
        status,
        threadId: statusThreadId,
        turnId
      });
      return {
        ok: true,
        status,
        turnId
      };
    }
    const completedTurnId = turnId || normalizeText(trackedActiveTurn?.turnId);
    if (
      shouldFailUnconfirmed &&
      turnId &&
      trackedActiveTurn.turnId &&
      normalizeText(trackedActiveTurn.turnId) !== turnId
    ) {
      return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedActiveTurn, {
        reason: "turn_mismatch"
      });
    }
    if (!completedTurnId) {
      return {
        ok: true,
        status
      };
    }
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      await stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, statusThreadId, completedTurnId, {
        error: codexAppServerThreadError(thread),
        status,
        verifyInactive: false
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await completeCodexAppServerTurn(normalizedSessionId, statusThreadId, completedTurnId, {
        status,
        verifyInactive: false
      });
    }
    return {
      ok: true,
      status,
      turnId: completedTurnId
    };
  }

  async function reconcileCodexAppServerLoadedThreadStatus(sessionId = "", provider = null, threadId = "") {
    return reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
      source: "loaded_thread"
    });
  }

  async function reconcileCodexAppServerActiveTurn(session = {}) {
    const sessionId = normalizeText(session.sessionId);
    const turn = codexAppServerTurnState(session);
    if (!sessionId || !turn.active || !turn.threadId || !sessionHasCodexAppServerRuntime(session)) {
      return session;
    }
    if (turn.state === "finalizing") {
      const result = await finalizeCodexAppServerAssistantResult(sessionId, turn.threadId, turn.turnId, {
        recoverFromProvider: true,
        status: turn.status || "completed"
      });
      const runtime = await createRuntimeForSession(sessionId);
      const currentSession = await runtime.getSession(sessionId);
      if (result?.processed) {
        return currentSession;
      }
      const currentTurn = codexAppServerTurnState(currentSession);
      if (codexAppServerFinalizingExpired(currentTurn)) {
        await stopCodexAppServerTurnWithResultDeliveryFailure(sessionId, turn.threadId, turn.turnId, {
          error: result?.error,
          reason: result?.reason || "missing_assistant_text",
          status: turn.status || "completed"
        });
        return runtime.getSession(sessionId);
      }
      scheduleCodexAppServerFinalizingRecovery(sessionId, turn.threadId, turn.turnId, {
        completedAt: currentTurn.completedAt,
        status: turn.status || "completed",
        updatedAt: currentTurn.updatedAt
      });
      return currentSession;
    }
    const provider = await ensureCodexAppServerDaemonForSession(
      sessionId,
      await codexAppServerRuntimeOptionsForSession(session)
    );
    if (typeof provider?.readThreadStatus !== "function") {
      return session;
    }
    const thread = await codexAppServerReadThreadStatus(provider, turn.threadId);
    const status = codexAppServerThreadStatus(thread);
    if (!status || codexAppServerTurnStatusIsActive(status)) {
      scheduleCodexAppServerActiveRecovery(sessionId);
      return session;
    }
    if (!codexAppServerTurnStatusIsComplete(status)) {
      return session;
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerTurn.reconcile.complete", {
      sessionId,
      status,
      threadId: turn.threadId,
      turnId: turn.turnId
    });
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      await stopCodexAppServerTurnWithProviderFailure(sessionId, turn.threadId, turn.turnId, {
        status,
        verifyInactive: false
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await completeCodexAppServerTurn(sessionId, turn.threadId, turn.turnId, {
        status,
        verifyInactive: false
      });
    }
    const runtime = await createRuntimeForSession(sessionId);
    return runtime.getSession(sessionId);
  }

  async function codexAppServerRuntimeForVisibleTerminal(sessionId = "", threadId = "", options = {}) {
    if (!normalizeText(threadId)) {
      return null;
    }
    const runtime = options.runtime || await createRuntimeForSession(sessionId);
    const session = options.session || await runtime.getSession(sessionId);
    const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
      ...options,
      runtime
    });
    const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
    return provider.ensureRuntime();
  }

  async function unsubscribeCodexAppServerThreadForSession(sessionId = "", {
    runtime: providedRuntime = null,
    session: providedSession = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: true,
        sessionId: normalizedSessionId,
        status: "notSubscribed"
      };
    }
    const runtime = providedRuntime || await createRuntimeForSession(normalizedSessionId);
    const session = providedSession || await runtime.getSession(normalizedSessionId);
    const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
      runtime
    });
    const workdir = terminalWorktreePath(session);
    const threadId = codexThreadIdForWorkdir(session, workdir);
    if (!threadId) {
      return {
        ok: true,
        providerOptions,
        sessionId: normalizedSessionId,
        status: "notSubscribed"
      };
    }
    const providerKey = codexAppServerProviderKey(normalizedSessionId, providerOptions);
    const provider = codexAppServerProviders.get(providerKey);
    if (!provider || typeof provider.unsubscribeThread !== "function") {
      return {
        ok: true,
        providerOptions,
        sessionId: normalizedSessionId,
        status: "notSubscribed"
      };
    }
    const result = await provider.unsubscribeThread(threadId);
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.unsubscribe.done", {
      sessionId: normalizedSessionId,
      status: normalizeText(result?.status),
      threadId
    });
    return {
      ok: true,
      providerOptions,
      result,
      sessionId: normalizedSessionId,
      status: normalizeText(result?.status) || "unsubscribed",
      threadId
    };
  }

  async function unsubscribeCodexAppServerThreadsForSessions(sessions = []) {
    const results = [];
    const failed = [];
    const seenSessionIds = new Set();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const sessionId = normalizeText(session?.sessionId || session?.id || session);
      if (!sessionId || seenSessionIds.has(sessionId)) {
        continue;
      }
      seenSessionIds.add(sessionId);
      let providerOptions = null;
      try {
        const result = await unsubscribeCodexAppServerThreadForSession(sessionId, {
          session: isRecord(session) ? session : null
        });
        providerOptions = result?.providerOptions || null;
        results.push(result);
      } catch (error) {
        failed.push({
          error: errorMessage(error, "Vibe64 Codex app-server thread unsubscribe failed."),
          sessionId
        });
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.unsubscribeKnown.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      } finally {
        if (providerOptions) {
          closeCodexAppServerProviderForSession(sessionId, providerOptions);
        }
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      results,
      sessionCount: seenSessionIds.size
    };
  }

  function closeCodexAppServerProvider(providerKey = "", {
    closeProvider = true
  } = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = codexAppServerProviders.get(normalizedProviderKey);
    stopCodexAppServerWellbeing(normalizedProviderKey);
    codexAppServerManagedSessions.delete(normalizedProviderKey);
    if (!provider) {
      return;
    }
    const subscriptionPrefix = `${normalizedProviderKey}:`;
    for (const key of [...codexAppServerEventSubscriptions.keys()]) {
      if (key.startsWith(subscriptionPrefix)) {
        unsubscribeCodexAppServerEventSubscription(key);
      }
    }
    if (closeProvider) {
      provider.close?.();
    }
    codexAppServerProviders.delete(normalizedProviderKey);
  }

  function codexAppServerProviderKeyToolHomeSource(providerKey = "") {
    return codexAppServerProviderKeyFields(providerKey).toolHomeSource;
  }

  function codexAppServerProviderKeySessionId(providerKey = "") {
    return codexAppServerProviderKeyFields(providerKey).sessionId;
  }

  async function stopCachedCodexAppServerProvider(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = codexAppServerProviders.get(normalizedProviderKey);
    if (!provider) {
      closeCodexAppServerProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        stopped: false
      };
    }
    if (typeof provider.stopRuntime !== "function") {
      closeCodexAppServerProvider(normalizedProviderKey);
      throw new Error("Codex app-server provider must implement stopRuntime().");
    }
    let providerStoppedRuntime = false;
    try {
      await provider.stopRuntime();
      providerStoppedRuntime = true;
      return {
        providerKey: normalizedProviderKey,
        stopped: true
      };
    } finally {
      closeCodexAppServerProvider(normalizedProviderKey, {
        closeProvider: !providerStoppedRuntime
      });
    }
  }

  async function stopCachedCodexAppServerProvidersForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        failed: [],
        ok: true,
        providerCount: 0,
        results: [],
        stopped: 0
      };
    }
    const providerKeys = [...codexAppServerProviders.keys()]
      .filter((providerKey) => codexAppServerProviderKeySessionId(providerKey) === normalizedSessionId);
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        results.push(await stopCachedCodexAppServerProvider(providerKey));
      } catch (error) {
        failed.push({
          error: errorMessage(error, "Vibe64 Codex app-server runtime close failed."),
          providerKey
        });
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      providerCount: providerKeys.length,
      results,
      stopped: results.filter((result) => result.stopped).length
    };
  }

  function codexAppServerRuntimeOptionsFromSessionMetadata(session = {}, fallbackOptions = {}) {
    const metadata = session?.metadata || {};
    const runtimeDir = normalizeText(metadata.agent_transport_runtime_dir);
    if (!runtimeDir) {
      return null;
    }
    const metadataSourcePath = normalizeText(metadata.source_path);
    const metadataWorkdir = normalizeText(metadata.agent_identity_workdir) || metadataSourcePath ||
      normalizeText(fallbackOptions.workdir);
    const metadataTargetRoot = normalizeText(fallbackOptions.targetRoot) ||
      terminalTargetRoot(session, projectService) ||
      metadataSourcePath;
    return codexAppServerRuntimeOptions({
      ...fallbackOptions,
      runtimeDir,
      runtimeInstanceId: normalizeText(session.sessionId || session.id) ||
        normalizeText(fallbackOptions.runtimeInstanceId),
      targetRoot: metadataTargetRoot,
      workdir: metadataWorkdir
    });
  }

  async function stopPersistedCodexAppServerRuntimeForSession(session = {}, fallbackOptions = {}) {
    const runtimeOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session, fallbackOptions);
    if (!runtimeOptions) {
      return {
        stopped: false
      };
    }
    return stopCodexAppServerRuntime(runtimeOptions);
  }

  async function invalidateCodexAppServerRuntimes({
    reason = "",
    toolHomeSource = ""
  } = {}) {
    const normalizedToolHomeSource = normalizeText(toolHomeSource);
    const providerKeys = [...codexAppServerProviders.keys()]
      .filter((providerKey) => {
        return !normalizedToolHomeSource ||
          codexAppServerProviderKeyToolHomeSource(providerKey) === normalizedToolHomeSource;
      });
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        results.push(await stopCachedCodexAppServerProvider(providerKey));
      } catch (error) {
        failed.push({
          error: errorMessage(error, "Vibe64 Codex app-server runtime invalidation failed."),
          providerKey
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.invalidate.done", {
      failedCount: failed.length,
      providerCount: providerKeys.length,
      reason: normalizeText(reason),
      stopped,
      toolHomeSource: normalizedToolHomeSource
    });
    return {
      failed,
      ok: failed.length === 0,
      providerCount: providerKeys.length,
      results,
      stopped
    };
  }

  async function stopCodexAppServerProvidersForTargetRoot({
    reason = "",
    targetRoot = ""
  } = {}) {
    const normalizedTargetRoot = normalizeText(targetRoot);
    if (!normalizedTargetRoot) {
      return {
        failed: [],
        ok: true,
        providerCount: 0,
        reason: normalizeText(reason),
        results: [],
        stopped: 0,
        targetRoot: normalizedTargetRoot
      };
    }
    const providerKeys = [...codexAppServerProviders.keys()]
      .filter((providerKey) => {
        const managed = codexAppServerManagedSessions.get(providerKey);
        const keyTargetRoot = codexAppServerProviderKeyFields(providerKey).targetRoot;
        return keyTargetRoot === normalizedTargetRoot ||
          normalizeText(managed?.targetRoot) === normalizedTargetRoot ||
          normalizeText(managed?.projectContext?.targetRoot) === normalizedTargetRoot;
      });
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        results.push(await stopCachedCodexAppServerProvider(providerKey));
      } catch (error) {
        failed.push({
          error: errorMessage(error, "Vibe64 Codex app-server runtime close failed."),
          providerKey
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeProject.done", {
      failedCount: failed.length,
      providerCount: providerKeys.length,
      reason: normalizeText(reason),
      stopped,
      targetRoot: normalizedTargetRoot
    });
    return {
      failed,
      ok: failed.length === 0,
      providerCount: providerKeys.length,
      reason: normalizeText(reason),
      results,
      stopped,
      targetRoot: normalizedTargetRoot
    };
  }

  function stopCodexAppServerWellbeing(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const timer = codexAppServerWellbeingTimers.get(normalizedProviderKey);
    if (timer) {
      clearTimeout(timer);
      codexAppServerWellbeingTimers.delete(normalizedProviderKey);
    }
  }

  function runWithCodexAppServerProjectContext(projectContext = null, operation = async () => null) {
    if (projectContext?.targetRoot) {
      return runWithProjectRequestContext(projectContext, operation);
    }
    return operation();
  }

  function runCodexAppServerNotificationTask(context = {}, operation = async () => null) {
    const taskSessionId = normalizeText(context.sessionId);
    const previous = codexAppServerNotificationTasks.get(taskSessionId) || Promise.resolve();
    const task = previous
      .catch(() => null)
      .then(operation)
      .catch((error) => {
        vibe64SessionDebugLog("server.codexTerminal.appServerNotification.error", {
          error: vibe64SessionDebugError(error),
          method: normalizeText(context.method),
          sessionId: normalizeText(context.sessionId),
          threadId: normalizeText(context.threadId),
          turnId: normalizeText(context.turnId)
        });
      });
    codexAppServerNotificationTasks.set(taskSessionId, task);
    void task.finally(() => {
      if (codexAppServerNotificationTasks.get(taskSessionId) === task) {
        codexAppServerNotificationTasks.delete(taskSessionId);
      }
    });
  }

  async function drainCodexAppServerNotificationTasks(sessionId = "") {
    const taskSessionId = normalizeText(sessionId);
    while (true) {
      const task = codexAppServerNotificationTasks.get(taskSessionId);
      if (!task) {
        return;
      }
      await task;
    }
  }

  function scheduleCodexAppServerWellbeing(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const managed = codexAppServerManagedSessions.get(normalizedProviderKey);
    if (!managed) {
      stopCodexAppServerWellbeing(normalizedProviderKey);
      return;
    }
    stopCodexAppServerWellbeing(normalizedProviderKey);
    const timer = setTimeout(() => {
      void (async () => {
        const current = codexAppServerManagedSessions.get(normalizedProviderKey);
        if (!current) {
          return;
        }
        await runWithCodexAppServerProjectContext(current.projectContext, async () => {
          await reconcileCodexAppServerThreadForSession(current.sessionId, {
            agentSettings: current.agentSettings || {},
            source: "wellbeing"
          });
        });
      })()
        .catch((error) => {
          vibe64SessionDebugLog("server.codexTerminal.appServerDaemon.wellbeing.error", {
            error: vibe64SessionDebugError(error),
            providerKey: normalizedProviderKey,
            sessionId: managed.sessionId
          });
        })
        .finally(() => {
          if (codexAppServerManagedSessions.has(normalizedProviderKey)) {
            scheduleCodexAppServerWellbeing(normalizedProviderKey);
          }
        });
    }, CODEX_APP_SERVER_DAEMON_WELLBEING_MS);
    timer.unref?.();
    codexAppServerWellbeingTimers.set(normalizedProviderKey, timer);
  }

  function rememberCodexAppServerManagedSession(providerKey = "", {
    agentSettings = {},
    sessionId = "",
    targetRoot = "",
    workdir = ""
  } = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    if (!normalizedProviderKey) {
      return;
    }
    codexAppServerManagedSessions.set(normalizedProviderKey, {
      agentSettings,
      projectContext: currentProjectRequestContext(),
      sessionId: normalizeText(sessionId),
      targetRoot: normalizeText(targetRoot),
      workdir: normalizeText(workdir)
    });
    scheduleCodexAppServerWellbeing(normalizedProviderKey);
  }

  function pruneCodexAppServerManagedSessions({
    closeOtherTargets = false,
    keepProviderKeys = new Set(),
    targetRoot = ""
  } = {}) {
    const normalizedTargetRoot = normalizeText(targetRoot);
    if (!normalizedTargetRoot && !closeOtherTargets) {
      return;
    }
    for (const [providerKey, managed] of [...codexAppServerManagedSessions.entries()]) {
      if (keepProviderKeys.has(providerKey)) {
        continue;
      }
      if (closeOtherTargets || normalizeText(managed.targetRoot) === normalizedTargetRoot) {
        closeCodexAppServerProvider(providerKey);
      }
    }
  }

  async function waitForOtherCodexAppServerThreadReconciliations({
    keepProviderKeys = new Set(),
    targetRoot = ""
  } = {}) {
    const pending = [...codexAppServerThreadReconciliations.entries()]
      .filter(([providerKey]) => !keepProviderKeys.has(providerKey));
    if (pending.length === 0) {
      return;
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.pruneWait.start", {
      pendingCount: pending.length,
      targetRoot: normalizeText(targetRoot)
    });
    await Promise.allSettled(pending.map(([, reconciliation]) => reconciliation));
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.pruneWait.done", {
      pendingCount: pending.length,
      targetRoot: normalizeText(targetRoot)
    });
  }

  function closeCodexAppServerProviderForSession(sessionId = "", options = null) {
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !normalizedSessionId ||
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      return;
    }
    closeCodexAppServerProvider(codexAppServerProviderKey(normalizedSessionId, options));
  }

  async function stopCodexAppServerProviderForSession(sessionId = "", options = null) {
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !normalizedSessionId ||
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      return;
    }
    const providerKey = codexAppServerProviderKey(normalizedSessionId, options);
    const provider = codexAppServerProviders.get(providerKey);
    if (!provider) {
      await stopCodexAppServerRuntime(options);
      return;
    }
    await stopCachedCodexAppServerProvider(providerKey);
  }

  function codexAppServerControlDisabledResult() {
    return {
      ok: false,
      error: "Codex app-server control is disabled. Session Codex control has no terminal fallback."
    };
  }

  async function writeCodexAppServerControlDisabledFailure(sessionId = "") {
    const result = codexAppServerControlDisabledResult();
    let context = null;
    try {
      context = await codexAppServerSessionContext(sessionId);
    } catch {
      return result;
    }
    if (context.ok === false) {
      return result;
    }
    await writeCodexAppServerFailure(context.runtime, sessionId, {
      ...result,
      retryable: false
    });
    return result;
  }

  function codexAppServerTurnKey(threadId = "", turnId = "") {
    return `${normalizeText(threadId)}:${normalizeText(turnId)}`;
  }

  function codexAppServerResultFinalizationKey(sessionId = "", threadId = "", turnId = "") {
    return [
      normalizeText(sessionId),
      codexAppServerTurnKey(threadId, turnId || "*")
    ].filter(Boolean).join(":");
  }

  function codexAppServerLiveProgressCandidate(notification = {}) {
    const method = normalizeText(notification.method);
    const event = codexAppServerNotificationEvent(notification);
    if (isRecord(event)) {
      const eventType = codexAppServerNotificationEventType(notification, event);
      const payload = codexAppServerNotificationEventPayload(notification, event);
      const payloadType = normalizeText(payload.type);
      const phase = normalizeText(payload.phase || event.phase);
      if (eventType === "event_msg" && payloadType === "agent_message" && phase && phase !== "final_answer") {
        return {
          explicit: Boolean(phase),
          source: "event",
          text: normalizeText(
            codexAppServerContentText(payload.message) ||
            codexAppServerContentText(payload.text) ||
            codexAppServerContentText(payload.content)
          )
        };
      }
    }

    if (method !== "item/completed") {
      return null;
    }
    const item = codexAppServerNotificationItem(notification);
    const text = codexAppServerAssistantItemText(item);
    if (!text) {
      return null;
    }
    const phase = normalizeText(item?.phase || item?.purpose || item?.category);
    if (phase === "final_answer") {
      return null;
    }
    return {
      explicit: ["progress", "status", "thinking"].includes(phase),
      source: "item",
      text
    };
  }

  function codexAppServerLiveProgressText(notification = {}) {
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = normalizeText(candidate?.text);
    if (!text || text.length > CODEX_APP_SERVER_LIVE_PROGRESS_MAX_LENGTH) {
      return "";
    }
    if (text.includes("\n") || text.includes("\r") || text.includes("```")) {
      return "";
    }
    return text;
  }

  function codexAppServerLiveProgressKey(sessionId = "", threadId = "", notification = {}) {
    const itemId = codexAppServerNotificationItemId(notification);
    if (!itemId) {
      return "";
    }
    return [
      normalizeText(sessionId),
      normalizeText(threadId),
      codexAppServerNotificationTurnId(notification) || "*",
      "live-progress",
      itemId
    ].join(":");
  }

  function codexAppServerRunInputSource(session = {}) {
    return normalizeText(codexAppServerAgentRun(session)?.inputSource);
  }

  function codexAppServerFinalAssistantResultKey(sessionId = "", threadId = "", turnId = "") {
    return codexAppServerResultFinalizationKey(sessionId, threadId, turnId || "*");
  }

  function readCodexAppServerFinalAssistantResult(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return null;
    }
    return codexAppServerFinalAssistantResults.get(
      codexAppServerFinalAssistantResultKey(normalizedSessionId, normalizedThreadId, normalizedTurnId)
    ) || codexAppServerFinalAssistantResults.get(
      codexAppServerFinalAssistantResultKey(normalizedSessionId, normalizedThreadId, "*")
    ) || null;
  }

  function codexAppServerFinalAssistantConversationText(text = "", segments = []) {
    const rawText = normalizeText(text);
    if (!rawText) {
      return "";
    }
    return normalizeText(
      (Array.isArray(segments) && segments.length ? segments : [{ text: rawText }])
        .map((segment) => normalizeText(segment?.text))
        .filter(Boolean)
        .join("\n\n")
    );
  }

  async function persistCodexAppServerAssistantResponseBundle(runtime, sessionId = "", record = {}) {
    const conversationText = normalizeText(record.conversationText);
    if (!conversationText) {
      return null;
    }
    const existingTurnId = normalizeText(record.conversationTurn?.turnId);
    let written = null;
    if (existingTurnId && typeof runtime.store?.upsertConversationAssistantMessage === "function") {
      written = await runtime.store.upsertConversationAssistantMessage(sessionId, {
        text: conversationText,
        turnId: existingTurnId
      });
    } else if (!existingTurnId && typeof runtime.store?.writeConversationAssistantMessage === "function") {
      written = await runtime.store.writeConversationAssistantMessage(sessionId, {
        text: conversationText
      });
    }
    if (!written) {
      return null;
    }
    record.conversationTurn = written;
    await publishSessionChanged(sessionId, {
      payload: {
        conversationLogPatch: {
          turn: written,
          type: "upsert-turn"
        }
      },
      reason: "assistant-response-bundle"
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerAssistantResponseBundle.persisted", {
      conversationTurnId: normalizeText(written.turnId),
      segmentCount: Array.isArray(record.segments) ? record.segments.length : 1,
      sessionId: normalizeText(sessionId),
      textLength: conversationText.length,
      threadId: normalizeText(record.threadId),
      turnId: normalizeText(record.turnId)
    });
    return written;
  }

  async function recordCodexAppServerFinalAssistantResult({
    itemId = "",
    notification = {},
    sessionId = "",
    source = "",
    text = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const assistantText = normalizeText(text);
    const normalizedItemId = normalizeText(itemId) || codexAppServerNotificationItemId(notification);
    if (!normalizedSessionId || !normalizedThreadId || !assistantText || !normalizedItemId) {
      return {
        recorded: false,
        reason: normalizedItemId ? "empty" : "missing_item_id"
      };
    }

    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const currentTurn = codexAppServerTurnState(session);
    const normalizedTurnId = normalizeText(turnId) ||
      codexAppServerNotificationTurnId(notification) ||
      normalizeText(currentTurn.turnId);
    const key = codexAppServerFinalAssistantResultKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const existing = codexAppServerFinalAssistantResults.get(key) || null;
    if (
      !existing &&
      codexAppServerTurnAwaitsProviderIdentity(currentTurn, normalizedThreadId, normalizedTurnId)
    ) {
      return {
        recorded: false,
        reason: "turn_identity_pending",
        turnId: normalizedTurnId
      };
    }
    if (
      !existing &&
      !codexAppServerTurnCanReceiveProviderCompletion(currentTurn, normalizedThreadId, normalizedTurnId)
    ) {
      const staleKey = codexAppServerResultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      );
      if (!codexAppServerFinalizedTurns.has(staleKey)) {
        codexAppServerFinalizedTurns.add(staleKey);
        vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.stale", {
          currentState: currentTurn.state,
          currentStatus: currentTurn.status,
          currentThreadId: currentTurn.threadId,
          currentTurnId: currentTurn.turnId,
          sessionId: normalizedSessionId,
          source: normalizeText(source),
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      return {
        recorded: false,
        reason: "stale_turn_state",
        turnId: normalizedTurnId
      };
    }

    const normalizedSource = normalizeText(source);
    let segments = Array.isArray(existing?.segments)
      ? existing.segments.map((segment) => ({ ...segment }))
      : [];
    const existingItemIndex = segments.findIndex((segment) => (
      normalizeText(segment.itemId) === normalizedItemId
    ));
    const segment = {
      itemId: normalizedItemId,
      source: normalizedSource,
      text: assistantText
    };
    if (existingItemIndex >= 0) {
      segments.splice(existingItemIndex, 1, segment);
    } else {
      segments.push(segment);
    }

    const bundledText = segments.map((entry) => normalizeText(entry.text)).filter(Boolean).join("\n\n");
    const record = {
      ...existing,
      conversationText: codexAppServerFinalAssistantConversationText(bundledText, segments),
      itemId: normalizedItemId,
      notification,
      recordedAt: normalizeText(existing?.recordedAt) || new Date().toISOString(),
      segments,
      source: normalizedSource,
      text: bundledText,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      updatedAt: new Date().toISOString()
    };
    codexAppServerFinalAssistantResults.set(key, record);

    try {
      if (existing?.conversationTurn) {
        await persistCodexAppServerAssistantResponseBundle(runtime, normalizedSessionId, record);
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerFinalAssistantResult.recorded", {
        bundleSegmentCount: segments.length,
        itemId: record.itemId,
        sessionId: normalizedSessionId,
        source: record.source,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ...record,
        recorded: true,
        reason: existing ? "appended" : "recorded"
      };
    } catch (error) {
      if (existing) {
        codexAppServerFinalAssistantResults.set(key, existing);
      } else {
        codexAppServerFinalAssistantResults.delete(key);
      }
      throw error;
    }
  }

  function codexAppServerReasoningTurnKey(threadId = "", turnId = "") {
    return codexAppServerTurnKey(threadId, turnId || "*");
  }

  function codexAppServerReasoningTurnState(threadId = "", turnId = "") {
    const key = codexAppServerReasoningTurnKey(threadId, turnId);
    const existing = codexAppServerReasoningTurns.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      createdAt: new Date().toISOString(),
      segments: [],
      summaries: new Map()
    };
    codexAppServerReasoningTurns.set(key, created);
    return created;
  }

  function codexAppServerReasoningExistingTurnState(threadId = "", turnId = "") {
    return codexAppServerReasoningTurns.get(codexAppServerReasoningTurnKey(threadId, turnId)) ||
      codexAppServerReasoningTurns.get(codexAppServerReasoningTurnKey(threadId, "*"));
  }

  function codexAppServerReasoningSummaryKey(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const item = codexAppServerNotificationItem(notification);
    const itemId = normalizeText(params.itemId || item?.id || "summary");
    const summaryIndex = String(params.summaryIndex ?? params.index ?? 0).trim() || "0";
    return `${itemId}:${summaryIndex}`;
  }

  function createCodexAppServerReasoningSegment(state = {}, summary = null, summaryKey = "") {
    const segment = {
      chunks: [],
      persistedAt: "",
      persistedText: "",
      summaryKey
    };
    if (Array.isArray(state.segments)) {
      state.segments.push(segment);
    }
    if (summary) {
      summary.currentSegment = segment;
    }
    return segment;
  }

  function codexAppServerReasoningSummaryDisplayText(value = "") {
    let text = normalizeText(value).replace(/\r\n/gu, "\n");
    if (!text) {
      return "";
    }
    text = text.replace(/\*\*([^*\n][\s\S]*?)\*\*/gu, "$1");
    text = text.replace(/^\*\*\s*/u, "").replace(/\s*\*\*$/u, "");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function codexAppServerReasoningDisplayText(value = "") {
    return normalizeText(value)
      .replace(/\r\n/gu, "\n")
      .split(/\n{2,}/u)
      .map(codexAppServerReasoningSummaryDisplayText)
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function recordCodexAppServerReasoningNotification(threadId = "", notification = {}) {
    const method = normalizeText(notification.method);
    if (method !== "item/reasoning/summaryPartAdded" && method !== "item/reasoning/summaryTextDelta") {
      return false;
    }
    const normalizedThreadId = normalizeText(threadId);
    const turnId = codexAppServerNotificationTurnId(notification);
    if (!normalizedThreadId) {
      return false;
    }
    const state = codexAppServerReasoningTurnState(normalizedThreadId, turnId);
    const summaryKey = codexAppServerReasoningSummaryKey(notification);
    const summary = state.summaries.get(summaryKey) || {
      currentSegment: null
    };
    if (!summary.currentSegment) {
      createCodexAppServerReasoningSegment(state, summary, summaryKey);
    }
    if (method === "item/reasoning/summaryTextDelta") {
      const params = codexAppServerNotificationParams(notification);
      let delta = codexAppServerContentText(params.delta || params.text);
      if (delta) {
        const startsNewSegment = /^\s*\n/u.test(delta) &&
          summary.currentSegment?.chunks?.length &&
          summary.currentSegment?.persistedText;
        if (startsNewSegment) {
          delta = delta.replace(/^\s*\n+/u, "");
          createCodexAppServerReasoningSegment(state, summary, summaryKey);
        }
        summary.currentSegment.chunks.push(delta);
        state.summaries.set(summaryKey, summary);
        return true;
      }
    }
    state.summaries.set(summaryKey, summary);
    return false;
  }

  function readCodexAppServerReasoningText(threadId = "", turnId = "") {
    const state = codexAppServerReasoningExistingTurnState(threadId, turnId);
    if (!state) {
      return "";
    }
    return (Array.isArray(state.segments) ? state.segments : [])
      .map((segment) => codexAppServerReasoningDisplayText(segment.chunks.join("")))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function codexAppServerReasoningPersistKey(sessionId = "", threadId = "", turnId = "") {
    return [
      normalizeText(sessionId),
      normalizeText(threadId),
      normalizeText(turnId) || "*"
    ].filter(Boolean).join(":");
  }

  async function persistCodexAppServerReasoningSummary(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const state = codexAppServerReasoningExistingTurnState(threadId, turnId);
    const segments = Array.isArray(state?.segments) ? state.segments : [];
    const pendingSegments = segments
      .map((segment) => ({
        segment,
        text: codexAppServerReasoningDisplayText(segment.chunks.join(""))
      }))
      .filter(({ segment, text }) => text && segment.persistedText !== text);
    if (!normalizedSessionId || !state || !pendingSegments.length) {
      return;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    if (codexAppServerRunInputSource(session) === "terminal") {
      return;
    }
    const turn = codexAppServerTurnState(session);
    if (!codexAppServerTurnCanReceiveProviderActivity(turn, threadId, turnId)) {
      vibe64SessionDebugLog("server.codexTerminal.appServerReasoningSummary.ignored", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizeText(threadId),
        turnId: normalizeText(turnId)
      });
      return;
    }
    for (const {
      segment,
      text
    } of pendingSegments) {
      segment.persistedAt ||= new Date().toISOString();
      const written = await runtime.store.writeConversationThinkingMessage(normalizedSessionId, {
        at: segment.persistedAt,
        requireOpenTurn: false,
        text
      });
      if (!written) {
        continue;
      }
      segment.persistedText = text;
      await publishSessionChanged(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason: "codex-app-server-reasoning-summary"
      });
    }
  }

  function queueCodexAppServerReasoningPersist(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerReasoningPersistKey(sessionId, threadId, turnId);
    if (!key) {
      return Promise.resolve();
    }
    return runQueuedCodexAppServerReasoningPersist(key, sessionId, threadId, turnId);
  }

  async function flushCodexAppServerReasoningPersist(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerReasoningPersistKey(sessionId, threadId, turnId);
    const queued = key ? codexAppServerReasoningPersistQueues.get(key) : null;
    if (queued) {
      await queued.catch(() => null);
    }
    await persistCodexAppServerReasoningSummary(sessionId, threadId, turnId);
  }

  function runQueuedCodexAppServerReasoningPersist(key = "", sessionId = "", threadId = "", turnId = "") {
    const previous = codexAppServerReasoningPersistQueues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => null)
      .then(() => persistCodexAppServerReasoningSummary(sessionId, threadId, turnId));
    codexAppServerReasoningPersistQueues.set(key, next);
    next
      .finally(() => {
        if (codexAppServerReasoningPersistQueues.get(key) === next) {
          codexAppServerReasoningPersistQueues.delete(key);
        }
      })
      .catch(() => null);
    return next;
  }

  function cleanupCodexAppServerReasoningTurn(threadId = "", turnId = "") {
    codexAppServerReasoningTurns.delete(codexAppServerReasoningTurnKey(threadId, turnId));
    codexAppServerReasoningTurns.delete(codexAppServerReasoningTurnKey(threadId, "*"));
  }

  function splitCodexAppServerReasoningTurn(threadId = "", turnId = "") {
    const state = codexAppServerReasoningExistingTurnState(threadId, turnId);
    if (!state) {
      return false;
    }
    for (const summary of state.summaries.values()) {
      summary.currentSegment = null;
    }
    return true;
  }

  function cleanupCodexAppServerUntrackedTurn(threadId = "", turnId = "") {
    cleanupCodexAppServerReasoningTurn(threadId, turnId);
  }

  async function writeCodexAppServerLiveProgress(sessionId = "", threadId = "", notification = {}) {
    // Live progress is durable thinking only; final assistant ownership stays with recordCodexAppServerFinalAssistantResult.
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = codexAppServerLiveProgressText(notification);
    if (!normalizedSessionId || !normalizedThreadId || !text) {
      return null;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!codexAppServerTurnCanReceiveProviderActivity(
      turn,
      normalizedThreadId,
      codexAppServerNotificationTurnId(notification)
    )) {
      return null;
    }
    if (
      codexAppServerRunInputSource(session) === "terminal" &&
      candidate?.source === "item" &&
      candidate.explicit !== true &&
      !codexAppServerSessionIsWaitingForAgent(session)
    ) {
      return null;
    }
    const key = codexAppServerLiveProgressKey(normalizedSessionId, normalizedThreadId, notification);
    if (!key) {
      return null;
    }
    if (codexAppServerLiveProgressItems.has(key)) {
      return null;
    }
    codexAppServerLiveProgressItems.add(key);
    let written = null;
    try {
      written = await runtime.store.writeConversationThinkingMessage(normalizedSessionId, {
        requireOpenTurn: false,
        text
      });
      if (!written) {
        codexAppServerLiveProgressItems.delete(key);
        return null;
      }
      await publishSessionChanged(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason: "codex-app-server-live-progress"
      });
      return written;
    } catch (error) {
      if (!written) {
        codexAppServerLiveProgressItems.delete(key);
      }
      throw error;
    }
  }

  function codexAppServerTerminalItemMirrorKey(sessionId = "", threadId = "", notification = {}, role = "") {
    const itemId = codexAppServerNotificationItemId(notification);
    if (!itemId) {
      return "";
    }
    return [
      normalizeText(sessionId),
      normalizeText(threadId),
      codexAppServerNotificationTurnId(notification) || "*",
      normalizeText(role),
      itemId
    ].join(":");
  }

  async function codexAppServerNotificationIsTrackedWorkflowTurn(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return false;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    if (codexAppServerRunInputSource(session) === "terminal") {
      return false;
    }
    const turn = codexAppServerTurnState(session);
    const turnId = codexAppServerNotificationTurnId(notification);
    return codexAppServerTurnCanReceiveProviderActivity(turn, threadId, turnId) ||
      codexAppServerTurnCanReceiveProviderCompletion(turn, threadId, turnId);
  }

  async function writeMirroredCodexAppServerTerminalMessage({
    notification = {},
    role = "",
    sessionId = "",
    text = "",
    threadId = ""
  } = {}) {
    const normalizedRole = normalizeText(role);
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedText = normalizeText(text);
    if (!normalizedSessionId || !normalizedText || !["assistant", "user"].includes(normalizedRole)) {
      return null;
    }
    const key = codexAppServerTerminalItemMirrorKey(
      normalizedSessionId,
      threadId,
      notification,
      normalizedRole
    );
    if (!key) {
      return null;
    }
    if (codexAppServerMirroredTerminalItems.has(key)) {
      return null;
    }
    codexAppServerMirroredTerminalItems.add(key);
    let written = null;
    try {
      const runtime = await createRuntimeForSession(sessionId);
      const writer = normalizedRole === "user"
        ? runtime.store?.writeConversationUserMessage
        : runtime.store?.writeConversationAssistantMessage;
      if (typeof writer !== "function") {
        codexAppServerMirroredTerminalItems.delete(key);
        return null;
      }
      written = await writer.call(runtime.store, normalizedSessionId, {
        text: normalizedText
      });
      if (!written) {
        codexAppServerMirroredTerminalItems.delete(key);
        return null;
      }
      const reason = normalizedRole === "user"
        ? "codex-app-server-terminal-user-message"
        : "codex-app-server-terminal-assistant-message";
      await publishSessionChanged(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason
      });
      vibe64SessionDebugLog(`server.codexTerminal.appServerTerminal${normalizedRole === "user" ? "User" : "Assistant"}Message.mirrored`, {
        itemId: normalizeText(codexAppServerNotificationItem(notification)?.id),
        sessionId: normalizedSessionId,
        threadId: normalizeText(threadId),
        turnId: codexAppServerNotificationTurnId(notification)
      });
      return written;
    } catch (error) {
      if (!written) {
        codexAppServerMirroredTerminalItems.delete(key);
      }
      throw error;
    }
  }

  async function writeCodexAppServerContextRefreshPending(runtime, sessionId = "", {
    reason = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId || typeof runtime?.store?.writeMetadataValue !== "function") {
      return null;
    }
    const at = new Date().toISOString();
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      await Promise.all([
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_pending", "yes"),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_pending_at", at),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_reason", reason),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_thread_id", threadId),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_turn_id", turnId)
      ]);
    });
    return {
      at,
      reason,
      threadId,
      turnId
    };
  }

  async function clearCodexAppServerContextRefreshPending(runtime, sessionId = "", {
    deliveredAt = new Date().toISOString(),
    delivery = "prompt",
    reason = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId || !runtime?.store) {
      return false;
    }
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      await Promise.all([
        ...(typeof runtime.store.deleteMetadataValues === "function"
          ? [runtime.store.deleteMetadataValues(normalizedSessionId, CODEX_CONTEXT_REFRESH_PENDING_METADATA)]
          : CODEX_CONTEXT_REFRESH_PENDING_METADATA.map((name) => runtime.store.deleteMetadataValue?.(normalizedSessionId, name))),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_at", deliveredAt),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivery", delivery),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_reason", reason),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_thread_id", threadId),
        runtime.store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_turn_id", turnId)
      ].filter(Boolean));
    });
    return true;
  }

  async function markCodexAppServerContextRefreshPending(sessionId = "", threadId = "", notification = {}, {
    reason = codexAppServerContextRefreshReason(notification)
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!reason || !normalizedSessionId || !normalizedThreadId) {
      return null;
    }

    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    if (!sessionBriefingIsDelivered(session)) {
      return null;
    }
    const currentThreadId = normalizeText(
      session.metadata?.agent_identity_conversation_id
    );
    if (currentThreadId && currentThreadId !== normalizedThreadId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerContextRefresh.staleThread", {
        currentThreadId,
        reason,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId
      });
      return null;
    }

    const turn = codexAppServerTurnState(session);
    const turnId = normalizeText(codexAppServerNotificationTurnId(notification) || turn.turnId);
    const pending = await writeCodexAppServerContextRefreshPending(runtime, normalizedSessionId, {
      reason,
      threadId: normalizedThreadId,
      turnId
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerContextRefresh.pending", {
      reason,
      sessionId: normalizedSessionId,
      threadId: normalizedThreadId,
      turnId
    });
    return pending;
  }

  async function writeCodexAppServerUserMessageOwnership(runtime, sessionId = "", clientId = "", {
    eventKind = "codex-app-server-user-message-ownership-updated",
    owned = false
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedClientId = normalizeText(clientId);
    if (!normalizedSessionId || !normalizedClientId) {
      return false;
    }
    let wasOwned = false;
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      const session = await runtime.getSession(normalizedSessionId);
      const currentIds = codexAppServerPendingUserMessageClientIds(session);
      wasOwned = currentIds.indexOf(normalizedClientId) >= 0;
      if (wasOwned === owned) {
        return;
      }
      const pendingUserMessageClientIds = owned
        ? [...currentIds, normalizedClientId]
        : currentIds.filter((id) => id !== normalizedClientId);
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          clientId: normalizedClientId,
          kind: eventKind,
          message: ""
        },
        patch: {
          pendingUserMessageClientIds
        }
      });
    });
    return wasOwned;
  }

  async function mirrorCodexAppServerTerminalUserMessage(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const item = codexAppServerNotificationItem(notification);
    const text = codexAppServerUserMessageText(item);
    const clientId = normalizeText(item?.clientId);
    if (!normalizedSessionId || !text) {
      return;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    if (clientId && await writeCodexAppServerUserMessageOwnership(
      runtime,
      normalizedSessionId,
      clientId,
      {
        eventKind: "codex-app-server-user-message-consumed",
        owned: false
      }
    )) {
      return;
    }
    await markCodexAppServerProviderTurnActive(normalizedSessionId, {
      status: "inProgress",
      threadId: normalizedThreadId,
      turnId: codexAppServerNotificationTurnId(notification)
    });
    await writeMirroredCodexAppServerTerminalMessage({
      notification,
      role: "user",
      sessionId: normalizedSessionId,
      text,
      threadId: normalizedThreadId
    });
  }

  async function mirrorCodexAppServerTerminalAssistantMessage(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (codexAppServerLiveProgressCandidate(notification)?.explicit === true) {
      return;
    }
    const classification = classifyCodexAppServerEvent(notification);
    const text = normalizeText(
      (classification.kind === "final_assistant_result" ? classification.text : "") ||
      codexAppServerAssistantItemText(codexAppServerNotificationItem(notification))
    );
    if (!normalizedSessionId || !text) {
      return;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    if (codexAppServerSessionIsWaitingForAgent(session)) {
      return;
    }
    if (codexAppServerRunInputSource(session) !== "terminal") {
      return;
    }
    if (await codexAppServerNotificationIsTrackedWorkflowTurn(normalizedSessionId, normalizedThreadId, notification)) {
      return;
    }
    await writeMirroredCodexAppServerTerminalMessage({
      notification,
      role: "assistant",
      sessionId: normalizedSessionId,
      text,
      threadId: normalizedThreadId
    });
  }

  function codexAppServerSessionIsWaitingForAgent(session = {}) {
    return normalizeText(session.stepMachine?.status) === "awaiting_agent_result";
  }

  async function codexAppServerReadThreadStatus(provider = null, threadId = "") {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    if (typeof provider?.readThreadStatus === "function") {
      return provider.readThreadStatus(normalizedThreadId);
    }
    return null;
  }

  async function codexAppServerProviderStillActive(sessionId = "", provider = null, threadId = "", turnId = "", {
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return false;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!turn.active || !codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, normalizedTurnId)) {
      return false;
    }
    try {
      const providerThread = await codexAppServerReadThreadStatus(provider, normalizedThreadId);
      if (!providerThread) {
        return false;
      }
      const status = codexAppServerThreadStatus(providerThread);
      if (!codexAppServerTurnStatusIsActive(status)) {
        return false;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.releaseBlockedActive", {
        sessionId: normalizedSessionId,
        source: normalizeText(source),
        status,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId || turn.turnId
      });
      scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      return true;
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.releaseCheck.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId,
        source: normalizeText(source),
        threadId: normalizedThreadId,
        turnId: normalizedTurnId || turn.turnId
      });
      return false;
    }
  }

  function codexAppServerRunMatchesAgentResult(session = {}, input = {}, threadId = "", turnId = "") {
    const run = codexAppServerAgentRun(session);
    if (!run) {
      return false;
    }
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    return normalizeText(run.providerThreadId) === normalizedThreadId &&
      (!normalizedTurnId || normalizeText(run.providerTurnId) === normalizedTurnId) &&
      normalizeText(run.stepId) === normalizeText(input.stepId) &&
      normalizeText(run.stepStatus) === normalizeText(input.stepStatus);
  }

  function codexAppServerRecoveryStateMatchesAgentResult(session = {}, input = {}) {
    const stepMachine = session.stepMachine || {};
    return normalizeText(session.currentStep) === normalizeText(input.stepId) &&
      normalizeText(stepMachine.status) === "waiting_for_input" &&
      normalizeText(stepMachine.from) === normalizeText(input.stepStatus) &&
      normalizeText(stepMachine.source) === "system_recovery";
  }

  async function restoreCodexAppServerAgentWaitForResult(runtime, session = {}, input = {}) {
    const stepMachine = session.stepMachine || {};
    const {
      at: _previousAt,
      from: _previousFrom,
      message: _previousMessage,
      schemaVersion: _previousSchemaVersion,
      source: _previousSource,
      status: _previousStatus,
      stepId: _previousStepId,
      ...previousDetails
    } = stepMachine;
    await runtime.store.writeStepState(session.sessionId, input.stepId, {
      ...previousDetails,
      schemaVersion: Number(stepMachine.schemaVersion) || 1,
      status: normalizeText(input.stepStatus)
    });
  }

  async function applyCodexAppServerAgentResult(runtime, session = {}, input = {}, conversationText = "", threadId = "", turnId = "") {
    const visibleText = normalizeText(conversationText);
    const submission = visibleText
      ? {
          ...input,
          conversationText: visibleText
        }
      : input;
    if (codexAppServerSessionIsWaitingForAgent(session)) {
      await runtime.submitCurrentStepInput(session.sessionId, submission, {
        recordConversationMessage: false
      });
      return true;
    }
    if (
      codexAppServerRunMatchesAgentResult(session, input, threadId, turnId) &&
      codexAppServerRecoveryStateMatchesAgentResult(session, input)
    ) {
      await restoreCodexAppServerAgentWaitForResult(runtime, session, input);
      await runtime.submitCurrentStepInput(session.sessionId, submission, {
        recordConversationMessage: false
      });
      return true;
    }
    return false;
  }

  function codexAppServerTurnResultContract(session = {}, threadId = "", turnId = "") {
    const run = codexAppServerAgentRun(session);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (
      !run ||
      normalizeText(run.inputSource) !== "workflow" ||
      (normalizedThreadId && normalizeText(run.providerThreadId) && normalizeText(run.providerThreadId) !== normalizedThreadId) ||
      (normalizedTurnId && normalizeText(run.providerTurnId) && normalizeText(run.providerTurnId) !== normalizedTurnId)
    ) {
      return null;
    }
    return isRecord(run.workflowResultContract) ? run.workflowResultContract : null;
  }

  function codexAppServerTurnAcceptsPlainAgentResponse(session = {}, threadId = "", turnId = "") {
    return normalizeText(codexAppServerTurnResultContract(session, threadId, turnId)?.mode) === "plain";
  }

  async function recoverCodexAppServerAssistantSegmentsFromProvider(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return [];
    }
    try {
      const runtime = await createRuntimeForSession(normalizedSessionId);
      const session = await runtime.getSession(normalizedSessionId);
      if (!sessionHasCodexAppServerRuntime(session)) {
        return [];
      }
      const provider = await ensureCodexAppServerDaemonForSession(
        normalizedSessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        })
      );
      if (typeof provider?.resumeThread !== "function" || typeof provider?.readThread !== "function") {
        return [];
      }
      await provider.resumeThread(normalizedThreadId, {
        cwd: terminalWorktreePath(session)
      });
      const thread = await provider.readThread(normalizedThreadId);
      const assistantSegments = codexAppServerProviderThreadAssistantSegments(thread, normalizedTurnId);
      if (assistantSegments.length) {
        vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.recovered", {
          assistantSegmentCount: assistantSegments.length,
          sessionId: normalizedSessionId,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      return assistantSegments;
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.recovery.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return [];
    }
  }

  async function submitCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
    recoverFromProvider = false
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    let finalResult = readCodexAppServerFinalAssistantResult(normalizedSessionId, threadId, turnId);
    let assistantText = normalizeText(finalResult?.text);
    const reasoningText = readCodexAppServerReasoningText(threadId, turnId);
    if (normalizedSessionId && recoverFromProvider) {
      const recoveredSegments = await recoverCodexAppServerAssistantSegmentsFromProvider(
        normalizedSessionId,
        threadId,
        turnId
      );
      for (const recoveredSegment of recoveredSegments) {
        await recordCodexAppServerFinalAssistantResult({
          itemId: recoveredSegment.itemId,
          sessionId: normalizedSessionId,
          source: "provider-recovery",
          text: recoveredSegment.text,
          threadId,
          turnId
        });
      }
      if (recoveredSegments.length) {
        finalResult = readCodexAppServerFinalAssistantResult(normalizedSessionId, threadId, turnId);
        assistantText = normalizeText(finalResult?.text);
      }
    }
    if (!normalizedSessionId || !assistantText && !reasoningText) {
      return {
        ok: false,
        processed: false,
        reason: "empty"
      };
    }
    try {
      const runtime = await createRuntimeForSession(normalizedSessionId);
      if (reasoningText) {
        await flushCodexAppServerReasoningPersist(normalizedSessionId, threadId, turnId);
      }
      if (!assistantText) {
        return {
          ok: true,
          processed: false,
          reason: "missing_assistant_text"
        };
      }
      if (finalResult) {
        await persistCodexAppServerAssistantResponseBundle(runtime, normalizedSessionId, finalResult);
      }
      const session = await runtime.getSession(normalizedSessionId);
      const resultContract = codexAppServerTurnResultContract(session, threadId, turnId);
      const persistedWorkflowResult = codexAppServerWorkflowResultEvent(session, threadId, turnId)?.workflowResult;
      let workflowResultError = "";
      let workflowResult = null;
      if (persistedWorkflowResult) {
        const validated = validateAgentTurnResult(persistedWorkflowResult, resultContract, {
          source: "codex"
        });
        if (validated.ok) {
          workflowResult = validated.input;
        } else {
          workflowResultError = validated.error;
        }
      }
      if (workflowResult) {
        const applied = await applyCodexAppServerAgentResult(
          runtime,
          session,
          workflowResult,
          finalResult?.conversationText || assistantText,
          threadId,
          turnId
        );
        if (applied) {
          await publishSessionChanged(normalizedSessionId, {
            reason: "codex-app-server-agent-result"
          });
          return {
            ok: true,
            processed: true,
            reason: "agent_result"
          };
        }
      }

      const visibleText = finalResult?.conversationText || assistantText;
      if (visibleText && codexAppServerTurnAcceptsPlainAgentResponse(session, threadId, turnId)) {
        const applied = await applyCodexAppServerAgentResult(
          runtime,
          session,
          {
            fields: {},
            kind: "ready",
            source: "codex",
            stepId: normalizeText(session.currentStep),
            stepStatus: normalizeText(session.stepMachine?.from || session.stepMachine?.status)
          },
          visibleText,
          threadId,
          turnId
        );
        if (applied) {
          await publishSessionChanged(normalizedSessionId, {
            reason: "codex-app-server-agent-result"
          });
          return {
            ok: true,
            processed: true,
            reason: "plain_agent_response"
          };
        }
      }

      if (!codexAppServerSessionIsWaitingForAgent(session)) {
        if (visibleText) {
          vibe64SessionDebugLog("server.codexTerminal.appServerTerminalAssistantMessage.ignored", {
            sessionId: normalizedSessionId,
            threadId: normalizeText(threadId),
            turnId: normalizeText(turnId)
          });
        }
        return {
          ok: true,
          processed: true,
          reason: "terminal_assistant_ignored"
        };
      }

      const missingResultMessage = workflowResultError ||
        "Codex did not submit the required Vibe64 workflow result before completing its response.";
      await runtime.returnControlFromAgentWait(normalizedSessionId, {
        inputPrompt: `${missingResultMessage} Retry the step.`,
        message: missingResultMessage
      });
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-app-server-agent-result-invalid"
      });
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.invalid", {
        error: missingResultMessage,
        sessionId: normalizedSessionId,
        threadId: normalizeText(threadId),
        turnId: normalizeText(turnId)
      });
      return {
        ok: true,
        processed: true,
        reason: "invalid_agent_result"
      };
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId,
        threadId: normalizeText(threadId),
        turnId: normalizeText(turnId)
      });
      return {
        error: errorMessage(error, "Codex app-server response could not be processed."),
        ok: false,
        processed: false,
        reason: "error"
      };
    } finally {
      cleanupCodexAppServerReasoningTurn(threadId, turnId);
    }
  }

  function codexAppServerTurnStatusIsActive(status = "") {
    return normalizeText(status) === "inProgress";
  }

  function codexAppServerTurnStatusIsComplete(status = "") {
    return ["completed", "interrupted", "failed"].includes(normalizeText(status));
  }

  function codexAppServerTurnStatusIsSuccessfulComplete(status = "") {
    return normalizeText(status) === "completed";
  }

  function codexAppServerTurnStatusIsProviderFailure(status = "") {
    return ["failed", "interrupted"].includes(normalizeText(status));
  }

  function terminalCodexAppServerAgentRunState(status = "") {
    const normalizedStatus = normalizeText(status);
    if (normalizedStatus === "interrupted") {
      return VIBE64_AGENT_RUN_STATE.INTERRUPTED;
    }
    if (normalizedStatus === "failed") {
      return VIBE64_AGENT_RUN_STATE.FAILED;
    }
    return VIBE64_AGENT_RUN_STATE.COMPLETED;
  }

  function codexAppServerAgentRunPatch({
    error = "",
    handoffId = "",
    inputSource = "",
    runState = VIBE64_AGENT_RUN_STATE.COMPLETED,
    session = {},
    status = "",
    threadId = "",
    turnId = "",
    updatedAt = ""
  } = {}) {
    const normalizedRunState = normalizeVibe64AgentRunState(runState);
    const patch = {
      error: normalizeText(error),
      provider: CODEX_AGENT_PROVIDER,
      providerInterface: "codex_app_server",
      providerStatus: normalizeText(status),
      providerThreadId: normalizeText(threadId),
      providerTurnId: normalizeText(turnId),
      state: normalizedRunState,
      stepId: normalizeText(session.currentStep),
      stepStatus: normalizeText(session.stepMachine?.status),
      updatedAt: normalizeText(updatedAt)
    };
    const normalizedInputSource = normalizeText(inputSource);
    const normalizedHandoffId = normalizeCodexPromptHandoffId(handoffId);
    if (normalizedHandoffId) {
      patch.handoffId = normalizedHandoffId;
    }
    if (normalizedInputSource) {
      patch.inputSource = normalizedInputSource;
    }
    if (
      normalizedRunState === VIBE64_AGENT_RUN_STATE.STARTING ||
      vibe64AgentRunStateIsTerminal(normalizedRunState) ||
      normalizedInputSource === "terminal"
    ) {
      patch.pendingUserMessageClientIds = [];
    }
    if (normalizedInputSource === "terminal") {
      patch.handoffId = "";
      patch.workflowResultContract = null;
    }
    if ([VIBE64_AGENT_RUN_STATE.ACTIVE, VIBE64_AGENT_RUN_STATE.STARTING].includes(normalizedRunState)) {
      patch.startedAt = normalizeText(updatedAt);
    }
    if (!vibe64AgentRunStateIsActive(normalizedRunState)) {
      patch.finishedAt = normalizeText(updatedAt);
    }
    return patch;
  }

  function codexAppServerAgentRunRealtimePayload(runPatch = {}) {
    const runState = normalizeVibe64AgentRunState(runPatch.state);
    const active = vibe64AgentRunStateIsActive(runState);
    const state = runState === VIBE64_AGENT_RUN_STATE.FINALIZING
      ? "finalizing"
      : runState === VIBE64_AGENT_RUN_STATE.STARTING
        ? "starting"
        : active
          ? "active"
          : "idle";
    const turn = {
      active,
      completedAt: normalizeText(runPatch.finishedAt),
      error: normalizeText(runPatch.error),
      inputSource: normalizeText(runPatch.inputSource),
      runId: CODEX_APP_SERVER_AGENT_RUN_ID,
      runState,
      startedAt: normalizeText(runPatch.startedAt),
      state,
      status: normalizeText(runPatch.providerStatus || runState),
      threadId: normalizeText(runPatch.providerThreadId),
      turnId: normalizeText(runPatch.providerTurnId),
      updatedAt: normalizeText(runPatch.updatedAt)
    };
    return {
      agentRun: {
        active,
        id: CODEX_APP_SERVER_AGENT_RUN_ID,
        inputSource: turn.inputSource,
        provider: CODEX_AGENT_PROVIDER,
        providerInterface: "codex_app_server",
        providerStatus: turn.status,
        providerThreadId: turn.threadId,
        providerTurnId: turn.turnId,
        state: runState,
        updatedAt: turn.updatedAt
      },
      agentSession: {
        providerId: CODEX_AGENT_PROVIDER,
        thread: {
          id: turn.threadId
        },
        transportId: "codex_app_server",
        turn: {
          active: turn.active,
          completedAt: turn.completedAt,
          error: turn.error,
          id: turn.turnId,
          inputSource: turn.inputSource,
          runState: turn.runState,
          startedAt: turn.startedAt,
          state: turn.state,
          status: turn.status,
          updatedAt: turn.updatedAt
        }
      }
    };
  }

  function codexAppServerRunIdentityForPatch(session = {}, {
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (normalizedTurnId) {
      return {
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      };
    }
    const currentTurn = codexAppServerTurnState(session);
    const currentThreadId = normalizeText(currentTurn.threadId);
    if (
      normalizeText(currentTurn.turnId) &&
      ["active", "finalizing"].includes(normalizeText(currentTurn.state)) &&
      (!normalizedThreadId || !currentThreadId || normalizedThreadId === currentThreadId)
    ) {
      return {
        threadId: normalizedThreadId || currentThreadId,
        turnId: currentTurn.turnId
      };
    }
    return {
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    };
  }

  function codexAppServerRunPatchIsStaleAfterTerminalState(currentTurn = {}, patch = {}) {
    const currentRunState = normalizeVibe64AgentRunState(currentTurn.runState);
    const patchRunState = normalizeVibe64AgentRunState(patch.state);
    if (!vibe64AgentRunStateIsTerminal(currentRunState)) {
      return false;
    }
    if (patchRunState === VIBE64_AGENT_RUN_STATE.STARTING) {
      return false;
    }
    const currentThreadId = normalizeText(currentTurn.threadId);
    const patchThreadId = normalizeText(patch.providerThreadId);
    const currentTurnId = normalizeText(currentTurn.turnId);
    const patchTurnId = normalizeText(patch.providerTurnId);
    const threadMatches = !patchThreadId || !currentThreadId || patchThreadId === currentThreadId;
    const turnMatches = !patchTurnId || (
      Boolean(currentTurnId) &&
      currentTurnId === patchTurnId
    );
    return threadMatches && turnMatches;
  }

  function codexAppServerTurnIsPendingPromptHandoff(turn = {}) {
    return turn.active === true &&
      normalizeText(turn.status) === "prompt_ready" &&
      !normalizeText(turn.turnId);
  }

  async function claimCodexAppServerTurnStart(runtime, sessionId = "", {
    handoffId = "",
    resultContract = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedHandoffId = normalizeCodexPromptHandoffId(handoffId);
    if (!normalizedSessionId) {
      return {
        claimed: false,
        response: {
          ok: false,
          error: "Vibe64 session ID is required."
        }
      };
    }
    if (typeof runtime?.store?.mutateSession !== "function" || typeof runtime?.getSession !== "function") {
      throw new Error("Vibe64 session runtime does not support Codex turn claims.");
    }
    let claimResult = null;
    const mutationResult = await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      const resumesSameClaim = Boolean(
        normalizedHandoffId &&
        currentTurn.active &&
        !normalizeText(currentTurn.turnId) &&
        normalizeText(currentTurn.handoffId) === normalizedHandoffId
      );
      if (
        currentTurn.active &&
        !codexAppServerTurnIsPendingPromptHandoff(currentTurn) &&
        !resumesSameClaim
      ) {
        claimResult = {
          claimed: false,
          response: codexAppServerTurnAlreadyRunningResponse(currentSession),
          session: currentSession
        };
        return claimResult;
      }
      const updatedAt = new Date().toISOString();
      const runPatch = codexAppServerAgentRunPatch({
        handoffId: normalizedHandoffId,
        inputSource: "workflow",
        runState: VIBE64_AGENT_RUN_STATE.STARTING,
        session: currentSession,
        status: "starting",
        updatedAt
      });
      runPatch.workflowResultContract = isRecord(resultContract) ? resultContract : null;
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: "codex-app-server-turn-claimed",
          message: "",
          state: runPatch.state
        },
        patch: runPatch
      });
      claimResult = {
        claimed: true,
        session: await runtime.getSession(normalizedSessionId)
      };
      return claimResult;
    });
    const result = claimResult || mutationResult;
    if (result?.claimed) {
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-app-server-turn-claimed"
      });
    }
    return result;
  }

  async function writeCodexAppServerAgentRun(sessionId = "", {
    error = "",
    inputSource = "",
    publishPayload = null,
    publishReason = "",
    runState = VIBE64_AGENT_RUN_STATE.COMPLETED,
    status = "",
    threadId = "",
    turnId = "",
    updatedAt = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: "Vibe64 session ID is required."
      };
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    let runPatch = null;
    let wrote = false;
    let stale = null;
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = typeof runtime?.getSession === "function"
        ? await runtime.getSession(normalizedSessionId).catch(() => null)
        : null;
      const identity = codexAppServerRunIdentityForPatch(currentSession || {}, {
        threadId,
        turnId
      });
      runPatch = codexAppServerAgentRunPatch({
        error,
        inputSource,
        runState,
        session: currentSession || {},
        status,
        threadId: identity.threadId,
        turnId: identity.turnId,
        updatedAt: normalizeText(updatedAt) || new Date().toISOString()
      });
      const currentTurn = codexAppServerTurnState(currentSession || {});
      if (codexAppServerRunPatchIsStaleAfterTerminalState(currentTurn, runPatch)) {
        stale = {
          currentState: currentTurn.state,
          currentStatus: currentTurn.status,
          currentThreadId: currentTurn.threadId,
          currentTurnId: currentTurn.turnId,
          patchState: runPatch.state,
          patchStatus: runPatch.providerStatus,
          patchThreadId: runPatch.providerThreadId,
          patchTurnId: runPatch.providerTurnId
        };
        vibe64SessionDebugLog("server.codexTerminal.appServerAgentRun.staleTerminalPatch", {
          ...stale,
          publishReason,
          sessionId: normalizedSessionId
        });
        return;
      }
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: publishReason || "codex-app-server-turn-state",
          message: normalizeText(error),
          state: runPatch.state
        },
        patch: runPatch
      });
      wrote = true;
    });
    if (!wrote) {
      return {
        ok: true,
        processed: false,
        reason: "stale_terminal_turn_state",
        stale
      };
    }
    await publishSessionChanged(normalizedSessionId, {
      payload: {
        ...codexAppServerAgentRunRealtimePayload(runPatch),
        ...(isRecord(publishPayload) ? publishPayload : {})
      },
      reason: publishReason || "codex-app-server-turn-state"
    });
    return {
      ok: true
    };
  }

  async function markCodexAppServerTurnActive(sessionId = "", input = {}) {
    if (input.requireTrackedTurn === true) {
      const runtime = await createRuntimeForSession(sessionId);
      const session = await runtime.getSession(sessionId);
      const turn = codexAppServerTurnState(session);
      if (!codexAppServerTurnCanReceiveProviderActivity(turn, input.threadId, input.turnId)) {
        vibe64SessionDebugLog("server.codexTerminal.appServerTurn.active.ignored", {
          currentState: turn.state,
          currentStatus: turn.status,
          currentThreadId: turn.threadId,
          currentTurnId: turn.turnId,
          sessionId: normalizeText(sessionId),
          threadId: normalizeText(input.threadId),
          turnId: normalizeText(input.turnId)
        });
        return {
          ok: true,
          processed: false,
          reason: "untracked_terminal_turn"
        };
      }
    }
    const status = normalizeText(input.status) || "inProgress";
    const result = await writeCodexAppServerAgentRun(sessionId, {
      inputSource: normalizeText(input.inputSource),
      publishReason: "codex-app-server-turn-active",
      runState: status === "starting" ? VIBE64_AGENT_RUN_STATE.STARTING : VIBE64_AGENT_RUN_STATE.ACTIVE,
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    scheduleCodexAppServerActiveRecovery(sessionId);
    return result;
  }

  async function markCodexAppServerProviderTurnActive(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(input.threadId);
    const normalizedTurnId = normalizeText(input.turnId);
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, normalizedTurnId)) {
      return markCodexAppServerTurnActive(normalizedSessionId, {
        status: normalizeText(input.status) || "inProgress",
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    if (turn.active || !normalizedTurnId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerProviderTurn.active.ignored", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: turn.active ? "active_turn_mismatch" : "missing_turn"
      };
    }
    return markCodexAppServerTurnActive(normalizedSessionId, {
      inputSource: "terminal",
      status: normalizeText(input.status) || "inProgress",
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
  }

  async function markCodexAppServerTurnFinalizing(sessionId = "", input = {}) {
    clearCodexAppServerActiveTimer(sessionId);
    return writeCodexAppServerAgentRun(sessionId, {
      error: normalizeText(input.error),
      publishReason: "codex-app-server-turn-finalizing",
      runState: VIBE64_AGENT_RUN_STATE.FINALIZING,
      status: normalizeText(input.status) || "completed",
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
  }

  async function markCodexAppServerTurnIdle(sessionId = "", input = {}) {
    clearCodexAppServerActiveTimer(sessionId);
    clearCodexAppServerFinalizingTimer(sessionId, input.threadId, input.turnId);
    const status = normalizeText(input.status) || "completed";
    const result = await writeCodexAppServerAgentRun(sessionId, {
      error: normalizeText(input.error),
      publishPayload: VIBE64_LAUNCH_TARGETS_CLIENT_REFRESH_PAYLOAD,
      publishReason: "codex-app-server-turn-idle",
      runState: terminalCodexAppServerAgentRunState(status),
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    return result;
  }

  async function currentCodexAppServerTurnId(sessionId = "", threadId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId) {
      return "";
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!turn.active) {
      return "";
    }
    if (normalizedThreadId && turn.threadId && turn.threadId !== normalizedThreadId) {
      return "";
    }
    return turn.turnId;
  }

  async function resolveCodexAppServerTurnId(sessionId = "", threadId = "", turnId = "") {
    return normalizeText(turnId) || await currentCodexAppServerTurnId(sessionId, threadId);
  }

  async function finalizeCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
    recoverFromProvider = false,
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return {
        ok: false,
        processed: false,
        reason: "missing_turn"
      };
    }
    if (codexAppServerFinalizedTurns.has(key)) {
      return {
        ok: true,
        processed: true,
        reason: "already_finalized"
      };
    }
    const existing = codexAppServerResultFinalizations.get(key);
    if (existing) {
      return existing;
    }
    const operation = (async () => {
      const runtime = await createRuntimeForSession(normalizedSessionId);
      const session = await runtime.getSession(normalizedSessionId);
      const turn = codexAppServerTurnState(session);
      if (codexAppServerTurnAwaitsProviderIdentity(turn, normalizedThreadId, normalizedTurnId)) {
        return {
          ok: true,
          processed: false,
          reason: "turn_identity_pending"
        };
      }
      if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
        codexAppServerFinalizedTurns.add(key);
        cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
        vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.stale", {
          currentState: turn.state,
          currentStatus: turn.status,
          currentThreadId: turn.threadId,
          currentTurnId: turn.turnId,
          sessionId: normalizedSessionId,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
        return {
          ok: true,
          processed: false,
          reason: "stale_turn_state"
        };
      }
      const result = await submitCodexAppServerAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          recoverFromProvider
        }
      );
      if (result?.processed) {
        codexAppServerFinalizedTurns.add(key);
        const currentSession = await runtime.getSession(normalizedSessionId);
        const currentTurn = codexAppServerTurnState(currentSession);
        if (!codexAppServerTurnCanReceiveProviderCompletion(currentTurn, normalizedThreadId, normalizedTurnId)) {
          cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
          vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.finalizedStale", {
            currentState: currentTurn.state,
            currentStatus: currentTurn.status,
            currentThreadId: currentTurn.threadId,
            currentTurnId: currentTurn.turnId,
            sessionId: normalizedSessionId,
            threadId: normalizedThreadId,
            turnId: normalizedTurnId
          });
          return {
            ok: true,
            processed: true,
            reason: "stale_turn_state"
          };
        }
        await repairCodexSessionWorkdirPermissions(currentSession);
        await markCodexAppServerTurnIdle(normalizedSessionId, {
          status,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      return result;
    })().finally(() => {
      codexAppServerResultFinalizations.delete(key);
    });
    codexAppServerResultFinalizations.set(key, operation);
    return operation;
  }

  async function recoverCodexAppServerFinalizingTurn(sessionId = "", threadId = "", turnId = "", {
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const result = await finalizeCodexAppServerAssistantResult(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        recoverFromProvider: true,
        status
      }
    );
    if (result?.processed) {
      return result;
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!codexAppServerFinalizingExpired(turn)) {
      scheduleCodexAppServerFinalizingRecovery(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
        completedAt: turn.completedAt,
        status,
        updatedAt: turn.updatedAt
      });
      return result;
    }
    return stopCodexAppServerTurnWithResultDeliveryFailure(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        error: result?.error,
        reason: result?.reason || "missing_assistant_text",
        status
      }
    );
  }

  async function recoverCodexAppServerActiveTurn(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    try {
      const runtime = await createRuntimeForSession(normalizedSessionId);
      const session = await runtime.getSession(normalizedSessionId);
      const turn = codexAppServerTurnState(session);
      if (turn.state !== "active" || !turn.threadId) {
        return session;
      }
      const reconciledSession = await reconcileCodexAppServerActiveTurn(session);
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      if (currentTurn.state === "active" && currentTurn.threadId) {
        scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      }
      return reconciledSession;
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.reconcile.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId
      });
      scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      return null;
    }
  }

  async function completeCodexAppServerTurn(sessionId = "", threadId = "", turnId = "", {
    provider = null,
    status = "completed",
    verifyInactive = true
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedStatus = normalizeText(status) || "completed";
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const existingTurn = codexAppServerTurnState(session);
    if (codexAppServerTurnAwaitsProviderIdentity(existingTurn, normalizedThreadId, normalizedTurnId)) {
      return {
        ok: true,
        processed: false,
        reason: "turn_identity_pending"
      };
    }
    if (!normalizedTurnId) {
      if (!codexAppServerTurnCanReceiveProviderCompletion(existingTurn, normalizedThreadId, "")) {
        cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
        vibe64SessionDebugLog("server.codexTerminal.appServerTurn.complete.stale", {
          currentState: existingTurn.state,
          currentStatus: existingTurn.status,
          currentThreadId: existingTurn.threadId,
          currentTurnId: existingTurn.turnId,
          sessionId: normalizedSessionId,
          status: normalizedStatus,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
        return {
          ok: true,
          processed: false,
          reason: "stale_turn_state"
        };
      }
      if (verifyInactive && await codexAppServerProviderStillActive(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
        source: "complete_missing_turn"
      })) {
        return {
          ok: true,
          processed: false,
          reason: "provider_still_active",
          status: "inProgress"
        };
      }
      await repairCodexSessionWorkdirPermissions(session);
      await markCodexAppServerTurnIdle(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "missing_turn"
      };
    }
    const key = codexAppServerResultFinalizationKey(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId
    );
    if (codexAppServerFinalizedTurns.has(key)) {
      return {
        ok: true,
        processed: true,
        reason: "already_finalized"
      };
    }
    if (!codexAppServerTurnCanReceiveProviderCompletion(existingTurn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerFinalizedTurns.add(key);
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.complete.stale", {
        currentState: existingTurn.state,
        currentStatus: existingTurn.status,
        currentThreadId: existingTurn.threadId,
        currentTurnId: existingTurn.turnId,
        sessionId: normalizedSessionId,
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "stale_turn_state"
      };
    }
    if (verifyInactive && await codexAppServerProviderStillActive(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
      source: "complete"
    })) {
      return {
        ok: true,
        processed: false,
        reason: "provider_still_active",
        status: "inProgress"
      };
    }
    if (codexAppServerRunInputSource(session) === "terminal") {
      codexAppServerCompletedTurns.add(codexAppServerTurnKey(normalizedThreadId, normalizedTurnId));
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      await repairCodexSessionWorkdirPermissions(session);
      await markCodexAppServerTurnIdle(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: true,
        reason: "terminal_turn_completed"
      };
    }
    const alreadyFinalizing = existingTurn.state === "finalizing" &&
      existingTurn.threadId === normalizedThreadId &&
      existingTurn.turnId === normalizedTurnId;
    codexAppServerCompletedTurns.add(codexAppServerTurnKey(normalizedThreadId, normalizedTurnId));
    if (!alreadyFinalizing) {
      await markCodexAppServerTurnFinalizing(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    scheduleCodexAppServerFinalizingRecovery(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
      completedAt: alreadyFinalizing ? existingTurn.completedAt : "",
      status: normalizedStatus,
      updatedAt: alreadyFinalizing ? existingTurn.updatedAt : ""
    });
    const result = await finalizeCodexAppServerAssistantResult(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
      recoverFromProvider: true,
      status: normalizedStatus
    });
    if (!result?.processed) {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      if (codexAppServerFinalizingExpired(currentTurn)) {
        return recoverCodexAppServerFinalizingTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            status: normalizedStatus
          }
        );
      }
    }
    return result;
  }

  function codexAppServerStoppedTurnMessage(status = "", error = "") {
    const normalizedStatus = normalizeText(status);
    const base = normalizedStatus === "interrupted"
      ? "Codex app-server was interrupted before completing this turn."
      : "Codex app-server failed before completing this turn.";
    const normalizedError = normalizeText(error);
    return normalizedError ? `${base} ${normalizedError}` : base;
  }

  function codexAppServerResultDeliveryFailureMessage({
    error = ""
  } = {}) {
    const normalizedError = normalizeText(error);
    if (!normalizedError) {
      return `${CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE} Retry the step.`;
    }
    const punctuation = [".", "!", "?"].some((character) => normalizedError.endsWith(character)) ? "" : ".";
    return `Codex returned a workflow result, but Vibe64 could not process it: ${normalizedError}${punctuation} Retry the step.`;
  }

  async function stopCodexAppServerTurnWithProviderFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    ok = false,
    provider = null,
    status = "failed",
    verifyInactive = true
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedStatus = normalizeText(status) || "failed";
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.failure.stale", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "stale_turn_state"
      };
    }
    if (verifyInactive && await codexAppServerProviderStillActive(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
      source: "provider_failure"
    })) {
      return {
        ok: true,
        processed: false,
        reason: "provider_still_active",
        status: "inProgress"
      };
    }
    const message = codexAppServerStoppedTurnMessage(normalizedStatus, error);
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
    const currentSession = await runtime.getSession(normalizedSessionId);
    if (codexAppServerSessionIsWaitingForAgent(currentSession)) {
      await runtime.returnControlFromAgentWait(normalizedSessionId, {
        inputPrompt: `${message} Retry the step.`,
        message
      });
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-app-server-agent-result-provider-failed"
      });
    }
    return {
      ok,
      error: message,
      status: normalizedStatus
    };
  }

  async function stopCodexAppServerTurnWithResultDeliveryFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    reason = "",
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedStatus = normalizeText(status) || "completed";
    const normalizedTurnId = await resolveCodexAppServerTurnId(normalizedSessionId, normalizedThreadId, turnId);
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const currentSession = await runtime.getSession(normalizedSessionId);
    const currentTurn = codexAppServerTurnState(currentSession);
    if (readCodexAppServerFinalAssistantResult(normalizedSessionId, normalizedThreadId, normalizedTurnId)?.text) {
      const recovered = await finalizeCodexAppServerAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          status: normalizedStatus
        }
      );
      if (recovered?.processed) {
        return recovered;
      }
    }
    if (!codexAppServerTurnCanReceiveProviderCompletion(currentTurn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerFinalizedTurns.add(codexAppServerResultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      ));
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.missing.stale", {
        currentState: currentTurn.state,
        currentStatus: currentTurn.status,
        currentThreadId: currentTurn.threadId,
        currentTurnId: currentTurn.turnId,
        reason: normalizeText(reason),
        sessionId: normalizedSessionId,
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "stale_turn_state",
        status: currentTurn.status
      };
    }
    const message = codexAppServerResultDeliveryFailureMessage({
      error
    });
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
    const session = await runtime.getSession(normalizedSessionId);
    if (codexAppServerSessionIsWaitingForAgent(session)) {
      await runtime.returnControlFromAgentWait(normalizedSessionId, {
        inputPrompt: message,
        message
      });
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-app-server-agent-result-missing"
      });
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.missing", {
      error: normalizeText(error),
      reason: normalizeText(reason),
      sessionId: normalizedSessionId,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    return {
      ok: false,
      error: message,
      status: normalizedStatus
    };
  }

  function codexAppServerWorkflowResultToolResponse(success = false, text = "") {
    return {
      contentItems: [{
        text: normalizeText(text),
        type: "inputText"
      }],
      success
    };
  }

  async function acceptCodexAppServerWorkflowResult({
    arguments: resultArguments = null,
    callId = "",
    runtime,
    sessionId = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedCallId = normalizeText(callId);
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    let outcome = null;
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      const session = await runtime.getSession(normalizedSessionId);
      const existing = codexAppServerWorkflowResultEvent(session, normalizedThreadId, normalizedTurnId);
      if (existing) {
        outcome = normalizeText(existing.callId) === normalizedCallId
          ? {
              duplicate: true,
              input: existing.workflowResult,
              ok: true
            }
          : {
              error: "Vibe64 already accepted a workflow result for this Codex turn.",
              ok: false
            };
        return;
      }
      if (!codexAppServerTurnCanReceiveProviderActivity(
        codexAppServerTurnState(session),
        normalizedThreadId,
        normalizedTurnId
      )) {
        outcome = {
          error: "Vibe64 rejected a workflow result because this Codex turn is no longer active.",
          ok: false
        };
        return;
      }
      const validated = validateAgentTurnResult(
        isRecord(resultArguments) ? resultArguments : null,
        codexAppServerTurnResultContract(session, normalizedThreadId, normalizedTurnId),
        {
          source: "codex"
        }
      );
      if (!validated.ok) {
        outcome = validated;
        return;
      }
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          callId: normalizedCallId,
          kind: CODEX_APP_SERVER_WORKFLOW_RESULT_EVENT,
          message: "",
          providerThreadId: normalizedThreadId,
          providerTurnId: normalizedTurnId,
          workflowResult: validated.input
        }
      });
      outcome = {
        duplicate: false,
        input: validated.input,
        ok: true
      };
    });
    return outcome || {
      error: "Vibe64 could not persist the workflow result.",
      ok: false
    };
  }

  async function handleCodexAppServerWorkflowResultRequest(sessionId = "", threadId = "", request = {}) {
    if (normalizeText(request.method) !== "item/tool/call") {
      const error = new Error(`Unsupported Codex app-server request: ${normalizeText(request.method) || "(missing method)"}`);
      error.code = -32601;
      throw error;
    }
    const params = isRecord(request.params) ? request.params : {};
    if (normalizeText(params.tool) !== CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME) {
      const error = new Error(`Unsupported Codex dynamic tool: ${normalizeText(params.tool) || "(missing tool)"}`);
      error.code = -32601;
      throw error;
    }
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const requestThreadId = normalizeText(params.threadId);
    const requestTurnId = normalizeText(params.turnId);
    const callId = normalizeText(params.callId);
    if (!callId || !requestTurnId || requestThreadId !== normalizedThreadId) {
      return codexAppServerWorkflowResultToolResponse(false, "Vibe64 rejected a workflow result for an unknown Codex turn.");
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const accepted = await acceptCodexAppServerWorkflowResult({
      arguments: params.arguments,
      callId,
      runtime,
      sessionId: normalizedSessionId,
      threadId: requestThreadId,
      turnId: requestTurnId
    });
    if (!accepted.ok) {
      vibe64SessionDebugLog("server.codexTerminal.appServerWorkflowResult.rejected", {
        callId,
        error: accepted.error,
        sessionId: normalizedSessionId,
        threadId: requestThreadId,
        turnId: requestTurnId
      });
      return codexAppServerWorkflowResultToolResponse(false, accepted.error);
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerWorkflowResult.accepted", {
      callId,
      duplicate: accepted.duplicate,
      kind: accepted.input.kind,
      sessionId: normalizedSessionId,
      threadId: requestThreadId,
      turnId: requestTurnId
    });
    return codexAppServerWorkflowResultToolResponse(
      true,
      "Vibe64 accepted the workflow result. Now reply to the user normally without JSON or transport metadata."
    );
  }

  function subscribeCodexAppServerEvents(sessionId = "", provider = null, threadId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId || !normalizedThreadId || typeof provider?.subscribe !== "function") {
      return;
    }
    const providerKey = codexAppServerProviderKey(normalizedSessionId, options);
    const key = codexAppServerEventSubscriptionKey(providerKey, normalizedThreadId);
    const existing = codexAppServerEventSubscriptionRecord(codexAppServerEventSubscriptions.get(key));
    if (existing && codexAppServerEventSubscriptionIsCurrent(key, provider)) {
      return {
        ok: true,
        status: "alreadySubscribed"
      };
    }
    if (existing) {
      unsubscribeCodexAppServerEventSubscription(key);
    }
    const unsubscribeNotifications = provider.subscribe((notification = {}) => {
      const method = normalizeText(notification.method);
      const notificationThreadId = codexAppServerNotificationThreadId(notification);
      if (notificationThreadId && notificationThreadId !== normalizedThreadId) {
        return;
      }
      const notificationContext = {
        method,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: codexAppServerNotificationTurnId(notification)
      };
      const classification = classifyCodexAppServerEvent(notification);
      const contextRefreshReason = codexAppServerContextRefreshReason(notification);
      if (contextRefreshReason) {
        runCodexAppServerNotificationTask(notificationContext, () => {
          return markCodexAppServerContextRefreshPending(
            normalizedSessionId,
            normalizedThreadId,
            notification,
            {
              reason: contextRefreshReason
            }
          );
        });
      }
      if (
        classification.kind === "reasoning_summary" &&
        recordCodexAppServerReasoningNotification(normalizedThreadId, notification)
      ) {
        runCodexAppServerNotificationTask(notificationContext, () => queueCodexAppServerReasoningPersist(
          normalizedSessionId,
          normalizedThreadId,
          codexAppServerNotificationTurnId(notification)
        ));
      }
      if (classification.kind === "final_assistant_result") {
        const event = codexAppServerNotificationEvent(notification);
        const payload = codexAppServerNotificationEventPayload(notification, event);
        vibe64SessionDebugLog("server.codexTerminal.appServerFinalAssistantResult.received", {
          eventId: normalizeText(event?.id),
          eventType: codexAppServerNotificationEventType(notification, event),
          itemId: normalizeText(codexAppServerNotificationItem(notification)?.id),
          method,
          payloadId: normalizeText(payload?.id),
          stableItemId: classification.itemId,
          source: classification.source,
          sessionId: normalizedSessionId,
          threadId: normalizedThreadId,
          turnId: classification.turnId
        });
      }
      if (
        classification.kind === "thinking" ||
        classification.kind === "live_progress"
      ) {
        runCodexAppServerNotificationTask(notificationContext, () => {
          return writeCodexAppServerLiveProgress(normalizedSessionId, normalizedThreadId, notification);
        });
      }
      if (method === "item/completed") {
        const item = codexAppServerNotificationItem(notification);
        if (normalizeText(item?.type) === "userMessage") {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return mirrorCodexAppServerTerminalUserMessage(normalizedSessionId, normalizedThreadId, notification);
          });
          return;
        }
        if (codexAppServerAssistantItemText(item)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return mirrorCodexAppServerTerminalAssistantMessage(normalizedSessionId, normalizedThreadId, notification);
          });
          return;
        }
      }
      if (method === "turn/started") {
        runCodexAppServerNotificationTask(notificationContext, () => markCodexAppServerProviderTurnActive(normalizedSessionId, {
          status: codexAppServerNotificationTurnStatus(notification) || "inProgress",
          threadId: normalizedThreadId,
          turnId: codexAppServerNotificationTurnId(notification)
        }));
        return;
      }
      if (method === "turn/completed") {
        const turnId = codexAppServerNotificationTurnId(notification);
        const status = codexAppServerNotificationTurnStatus(notification) || "completed";
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
              error: codexAppServerNotificationError(notification),
              provider,
              status
            });
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, turnId, {
              provider,
              status
            });
          });
        }
        return;
      }
      if (method === "thread/status/changed") {
        const status = codexAppServerNotificationTurnStatus(notification);
        if (codexAppServerTurnStatusIsActive(status)) {
          runCodexAppServerNotificationTask(notificationContext, async () => {
            const turnId = await resolveCodexAppServerTurnId(
              normalizedSessionId,
              normalizedThreadId,
              codexAppServerNotificationTurnId(notification)
            );
            await markCodexAppServerProviderTurnActive(normalizedSessionId, {
              status,
              threadId: normalizedThreadId,
              turnId
            });
          });
          return;
        }
        const turnId = codexAppServerNotificationTurnId(notification);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
              error: codexAppServerNotificationError(notification),
              provider,
              status,
            });
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, turnId, {
              provider,
              status
            });
          });
        }
      }
    });
    const unsubscribeRequests = typeof provider.setServerRequestHandler === "function"
      ? provider.setServerRequestHandler((request = {}) => {
          return handleCodexAppServerWorkflowResultRequest(
            normalizedSessionId,
            normalizedThreadId,
            request
          );
        })
      : null;
    const unsubscribe = () => {
      unsubscribeNotifications?.();
      unsubscribeRequests?.();
    };
    codexAppServerEventSubscriptions.set(key, {
      connectionGeneration: codexAppServerProviderConnectionGeneration(provider),
      unsubscribe
    });
    return {
      ok: true,
      status: existing ? "resubscribed" : "subscribed"
    };
  }

  async function startCodexTerminalSession(sessionId) {
    const runtime = await createRuntimeForSession(sessionId);
    const session = await runtime.getSession(sessionId);
    const targetRoot = terminalTargetRoot(session, projectService);
    if (!targetRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Vibe64 Codex target root is not available."
      });
    }
    const workdir = terminalWorktreePath(session);
    if (codexSessionWorktreeIsUnavailable(session)) {
      return blockCodexAppServerForUnavailableWorktree(
        runtime,
        sessionId,
        codexSessionWorktreeUnavailableFailure({
          session,
          workdir
        })
      );
    }
    if (!codexSessionWorkdirAllowed({
      session,
      targetRoot,
      workdir
    })) {
      return retryableTerminalFailure({
        ok: false,
        error: workdir
          ? "Vibe64 Codex workdir is outside the target root."
          : "Create the session clone before starting Codex."
      });
    }
    if (!await directoryExists(workdir)) {
      return blockCodexAppServerForUnavailableWorktree(
        runtime,
        sessionId,
        codexSessionWorktreeUnavailableFailure({
          session,
          workdir
        })
      );
    }
    await ensureTerminalSessionSourceGitSelfContained({
      session,
      workdir
    });
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }

    await prepareCodexAttachmentRoot({
      env: codexAttachmentEnv()
    });
    try {
      return await withCodexSessionStartupGate({
        operation: async (currentSession) => {
          const currentWorkdir = terminalWorktreePath(currentSession);
          const baseTerminalEnv = await codexProjectTerminalEnv({
            runtime,
            session: currentSession,
            sessionId,
            targetRoot
          });
          const codexThreadId = codexConversationIdForWorkdir(currentSession, currentWorkdir);
          let appServerRuntime = null;
          if (codexThreadId) {
            try {
              appServerRuntime = await codexAppServerRuntimeForVisibleTerminal(sessionId, codexThreadId, {
                runtime,
                session: currentSession,
                terminalEnv: baseTerminalEnv,
                targetRoot,
                toolHomeSource: toolHome.toolHomeSource,
                workdir: currentWorkdir
              });
            } catch (error) {
              const reconnectFailure = await codexReconnectTerminalFailureForError(error, {
                reason: "codex-visible-terminal-app-server",
                toolHomeSource: toolHome.toolHomeSource
              });
              if (reconnectFailure) {
                return reconnectFailure;
              }
              return retryableTerminalFailure({
                code: error?.code || "",
                errors: Array.isArray(error?.errors) ? error.errors : undefined,
                ok: false,
                error: `Codex app-server is not available: ${errorMessage(error)}`
              });
            }
          }
          const terminalEnv = baseTerminalEnv;
          const codexRuntime = codexRuntimeForTerminalEnv({
            terminalEnv,
            toolHomeSource: toolHome.toolHomeSource
          });
          const terminalEnvHash = executionEnvFingerprint(terminalEnv);
          const namespace = codexTerminalNamespace(sessionId);
          const terminalResponse = await startCodexGatewayTerminal({
            args: () => codexTerminalArgs({
              agentSettings: codexAgentSettingsFromSession(currentSession),
              codexRemoteEndpoint: appServerRuntime?.endpoint || codexRemoteEndpointForWorkdir(currentSession, currentWorkdir),
              codexThreadId
            }),
            codexRuntime,
            cwd: targetRoot,
            detachedIdleTimeoutMs: CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS,
            maxRunning: MAX_OPEN_CODEX_TERMINALS,
            metadata: {
              envHash: terminalEnvHash,
              sessionId,
              targetRoot,
              terminalExecution: "host",
              workdir: currentWorkdir,
              ...codexAppTerminalOwnerMetadata(toolHome)
            },
            namespace,
            onClose: async () => {
              await cleanupCodexAttachments(targetRoot, sessionId);
              await repairCodexSessionWorkdirPermissions(currentSession);
            },
            reuseRunning: (terminalSession) => {
              return terminalSession.metadata?.targetRoot === targetRoot &&
                terminalSession.metadata?.envHash === terminalEnvHash &&
                terminalSession.metadata?.workdir === currentWorkdir;
            },
            session: currentSession,
            targetRoot,
            workdir: currentWorkdir
          });
          return withCodexState(terminalResponse, currentSession);
        },
        runtime,
        session,
        sessionId
      });
    } catch (error) {
      const unavailableFailure = await codexProjectTerminalEnvFailureResult(error, {
        runtime,
        sessionId
      });
      if (unavailableFailure) {
        return blockCodexAppServerForUnavailableWorktree(runtime, sessionId, unavailableFailure);
      }
      throw error;
    }
  }

  async function startGlobalCodexTerminalSession() {
    const runtime = await projectService.createRuntime();
    const targetRoot = await globalCodexTargetRoot(projectService, runtime);
    if (!targetRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Global Codex target root is not available."
      });
    }
    if (!await directoryExists(targetRoot)) {
      return retryableTerminalFailure({
        ok: false,
        error: `Main repo directory does not exist: ${targetRoot}`
      });
    }
    const permissionFailure = await ensureCodexManagedSourcePermissions([targetRoot]);
    if (permissionFailure) {
      return permissionFailure;
    }

    const session = {
      targetRoot
    };
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }

    await prepareCodexAttachmentRoot({
      env: codexAttachmentEnv()
    });
    const terminalEnv = await loadProjectExecutionEnv({
      projectService,
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    const preflightFailure = await codexAuthPreflightFailure({
      reason: "codex-global-terminal",
      terminalEnv,
      toolHomeSource: toolHome.toolHomeSource
    });
    if (preflightFailure) {
      return preflightFailure;
    }
    const terminalEnvHash = executionEnvFingerprint(terminalEnv);
    const namespace = globalCodexTerminalNamespace();
    const codexRuntime = codexRuntimeForTerminalEnv({
      terminalEnv,
      toolHomeSource: toolHome.toolHomeSource
    });
    const terminalResponse = await startCodexGatewayTerminal({
      args: () => codexTerminalArgs({
        codexThreadId: ""
      }),
      codexRuntime,
      cwd: targetRoot,
      detachedIdleTimeoutMs: CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS,
      maxRunning: MAX_OPEN_CODEX_TERMINALS,
      metadata: {
        envHash: terminalEnvHash,
        scope: GLOBAL_CODEX_TERMINAL_SCOPE,
        targetRoot,
        terminalExecution: "host",
        workdir: targetRoot,
        ...codexAppTerminalOwnerMetadata(toolHome)
      },
      namespace,
      onClose: async () => {
        await cleanupCodexAttachments(targetRoot, GLOBAL_CODEX_TERMINAL_SCOPE);
        await repairCodexManagedSourcePermissions([targetRoot]);
      },
      reuseRunning: (terminalSession) => {
        return terminalSession.metadata?.scope === GLOBAL_CODEX_TERMINAL_SCOPE &&
          terminalSession.metadata?.targetRoot === targetRoot &&
          terminalSession.metadata?.envHash === terminalEnvHash &&
          terminalSession.metadata?.workdir === targetRoot;
      },
      session,
      targetRoot,
      workdir: targetRoot
    });
    const codexTerminal = activeGlobalCodexTerminal(targetRoot);
    return {
      ...terminalResponse,
      codexTerminal,
      globalCodexTerminal: codexTerminal
    };
  }

  async function writePromptIntoGlobalCodexTerminal(terminalSessionId, prompt) {
    return writeCodexPromptIntoNamespace(terminalSessionId, prompt, {
      namespace: globalCodexTerminalNamespace()
    });
  }

  async function waitForGlobalCodexReady(terminalSessionId) {
    const startedAt = Date.now();
    let lastOutput = "";
    let lastChangedAt = Date.now();
    while (Date.now() - startedAt <= CODEX_BOOT_TIMEOUT_MS) {
      const snapshot = globalCodexTerminalSnapshot(terminalSessionId);
      if (snapshot.ok === false || snapshot.status === "exited") {
        return {
          ok: false,
          error: snapshot.error || "Global Codex terminal is not running."
        };
      }
      const output = String(snapshot.output || "");
      if (output !== lastOutput) {
        lastOutput = output;
        lastChangedAt = Date.now();
      }
      if (
        output &&
        Date.now() - startedAt >= CODEX_BOOT_MIN_AGE_MS &&
        Date.now() - lastChangedAt >= CODEX_BOOT_QUIET_MS
      ) {
        return {
          ok: true,
          output
        };
      }
      await delay(250);
    }
    return {
      ok: true,
      output: lastOutput
    };
  }

  async function injectPromptIntoGlobalCodex(handoff = {}) {
    const terminalInput = codexPromptInputFromHandoff(handoff);
    if (!terminalInput) {
      return {
        ok: false,
        error: "Codex prompt handoff is empty."
      };
    }

    const terminalResponse = await startGlobalCodexTerminalSession();
    if (terminalResponse.ok === false) {
      return terminalResponse;
    }
    const terminalSessionId = terminalResponse.id || terminalResponse.terminalSessionId || "";
    if (!terminalSessionId) {
      return {
        ok: false,
        error: "Global Codex terminal did not start."
      };
    }

    const ready = await waitForGlobalCodexReady(terminalSessionId);
    if (ready.ok === false) {
      return ready;
    }

    const injected = await writePromptIntoGlobalCodexTerminal(
      terminalSessionId,
      terminalInput
    );
    if (injected.ok === false) {
      return injected;
    }

    const targetRoot = await globalCodexTargetRoot(projectService);
    const codexTerminal = activeGlobalCodexTerminal(targetRoot);
    return {
      ...injected,
      globalCodexTerminal: codexTerminal,
      terminalSessionId
    };
  }

  async function waitForCodexReadyInNamespace(namespace = "", terminalSessionId = "") {
    const startedAt = Date.now();
    let lastOutput = "";
    let lastChangedAt = Date.now();
    while (Date.now() - startedAt <= CODEX_BOOT_TIMEOUT_MS) {
      const snapshot = readTerminalSession(terminalSessionId, {
        namespace
      });
      if (snapshot.ok === false || snapshot.status === "exited") {
        return {
          ok: false,
          error: snapshot.error || "Fix Codex terminal is not running."
        };
      }
      const output = String(snapshot.output || "");
      if (output !== lastOutput) {
        lastOutput = output;
        lastChangedAt = Date.now();
      }
      if (
        output &&
        Date.now() - startedAt >= CODEX_BOOT_MIN_AGE_MS &&
        Date.now() - lastChangedAt >= CODEX_BOOT_QUIET_MS
      ) {
        return {
          ok: true,
          output
        };
      }
      await delay(250);
    }
    return {
      ok: true,
      output: lastOutput
    };
  }

  async function startFixCodexJob(input = {}) {
    const runtime = await projectService.createRuntime();
    const targetRoot = terminalTargetRoot({
      targetRoot: input.targetRoot || runtime?.targetRoot
    }, projectService);
    if (!targetRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Fix Codex target root is not available."
      });
    }
    if (!await directoryExists(targetRoot)) {
      return retryableTerminalFailure({
        ok: false,
        error: `Main repo directory does not exist: ${targetRoot}`
      });
    }
    const workdir = path.resolve(normalizeText(input.workdir) || targetRoot);
    const scope = normalizeText(input.scope) || "project";
    const session = {
      metadata: {
        source_path: workdir
      },
      sessionRoot: normalizeText(input.sessionRoot),
      targetRoot
    };
    if (!pathInsideOrEqual(targetRoot, workdir) && (scope !== "session" || !codexSessionWorkdirAllowed({
      session,
      targetRoot,
      workdir
    }))) {
      return retryableTerminalFailure({
        ok: false,
        error: "Fix Codex workdir is outside the target root."
      });
    }
    if (!await directoryExists(workdir)) {
      return retryableTerminalFailure({
        ok: false,
        error: `Fix Codex workdir does not exist: ${workdir}`
      });
    }
    const permissionFailure = await ensureCodexManagedSourcePermissions([workdir]);
    if (permissionFailure) {
      return permissionFailure;
    }
    const repairTarget = fixCodexRepairTarget({
      scope,
      targetRoot,
      workdir
    });
    const jobSeed = fixJobStore.createJob({
      prompt: input.prompt,
      repairTarget,
      scope,
      subject: input.subject,
      targetRoot,
      workdir
    });
    const fullPrompt = [
      input.prompt,
      "",
      fixCodexReportInstructions(jobSeed)
    ].join("\n").trim();
    const jobId = jobSeed.job.id;
    const namespace = fixCodexTerminalNamespace(jobId);
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }

    await prepareCodexAttachmentRoot({
      env: codexAttachmentEnv()
    });
    const reportHelper = await prepareFixCodexReportHelper({
      fixJobStore,
      jobId,
      stateRoot: runtime.stateRoot,
      token: jobSeed.token
    });
    const terminalEnv = await loadProjectExecutionEnv({
      projectService,
      runtime,
      session,
      target: "fix-codex",
      targetRoot
    });
    const effectiveTerminalEnv = {
      ...terminalEnv,
      ...reportHelper.env
    };
    const codexRuntime = codexRuntimeForTerminalEnv({
      terminalEnv: effectiveTerminalEnv,
      toolHomeSource: toolHome.toolHomeSource
    });
    const terminalEnvHash = executionEnvFingerprint(effectiveTerminalEnv);
    const terminalResponse = await startCodexGatewayTerminal({
      args: () => codexTerminalArgs({
        codexThreadId: ""
      }),
      codexRuntime,
      cwd: targetRoot,
      maxRunning: 1,
      metadata: {
        envHash: terminalEnvHash,
        fixJobId: jobId,
        scope: "fix-codex",
        targetRoot,
        terminalExecution: "host",
        workdir,
        ...codexAppTerminalOwnerMetadata(toolHome)
      },
      namespace,
      onClose: async () => {
        await cleanupCodexAttachments(targetRoot, `fix:${jobId}`);
        await repairCodexManagedSourcePermissions([workdir]);
      },
      reuseRunning: false,
      session,
      targetRoot,
      workdir
    });
    if (terminalResponse.ok === false) {
      return terminalResponse;
    }

    const job = fixJobStore.attachTerminal(jobId, terminalResponse.id);
    void (async () => {
      const ready = await waitForCodexReadyInNamespace(namespace, terminalResponse.id);
      if (ready.ok === false) {
        return;
      }
      await writeCodexPromptIntoNamespace(terminalResponse.id, fullPrompt, {
        namespace
      });
    })();

    return {
      ...terminalResponse,
      fixJob: job
    };
  }

  async function writeCodexAppServerTaskEvent(runtime, sessionId, {
    error = "",
    healthAttempt = null,
    kind = "",
    message = "",
    publishReason = "",
    retryable = true,
    status = "running",
    terminalSessionId = ""
  } = {}) {
    const normalizedStatus = normalizeText(status) || "running";
    const healthAttemptId = normalizeText(healthAttempt?.id);
    const healthAttemptStartedAt = normalizeText(healthAttempt?.startedAt);
    const patch = {
      error: normalizeText(error),
      kind: "codex_app_server",
      label: "Codex app-server",
      message: normalizeText(message),
      retry: normalizedStatus === "failed" && retryable !== false
        ? {
            control: {
              action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
            },
            label: "Reconnect Codex"
          }
        : null,
      status: normalizedStatus,
      terminalSessionId: normalizeText(terminalSessionId)
    };
    if (healthAttemptId) {
      patch.healthAttemptId = healthAttemptId;
    }
    if (healthAttemptStartedAt && normalizedStatus === "running") {
      patch.healthAttemptStartedAt = healthAttemptStartedAt;
    }
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_APP_SERVER_TASK_ID, {
      event: {
        error: normalizeText(error),
        healthAttemptId,
        kind: normalizeText(kind || normalizedStatus),
        message: normalizeText(message),
        status: normalizedStatus
      },
      patch,
      shouldWrite: ({ previous = {} } = {}) => {
        if (normalizedStatus === "running" || !healthAttemptId) {
          return true;
        }
        return normalizeText(previous.healthAttemptId) === healthAttemptId &&
          normalizeText(previous.status) === "running";
      }
    });
    const publishedStatus = normalizeText(task?.status) || normalizedStatus;
    await publishSessionChanged(sessionId, {
      reason: normalizeText(publishReason) || `codex-app-server-${publishedStatus}`
    });
    return task;
  }

  async function writeCodexAppServerRunning(runtime, sessionId, {
    healthAttempt = createCodexAppServerHealthAttempt(),
    kind = "running",
    message,
    terminalSessionId = ""
  } = {}) {
    const task = await writeCodexAppServerTaskEvent(runtime, sessionId, {
      healthAttempt,
      kind,
      message,
      status: "running",
      terminalSessionId
    });
    return {
      healthAttempt,
      task
    };
  }

  async function writeCodexAppServerReady(runtime, sessionId, terminalSessionId, {
    healthAttempt = null
  } = {}) {
    if (!healthAttempt && typeof runtime?.getSession === "function") {
      const currentSession = await runtime.getSession(sessionId).catch(() => null);
      const currentTask = (Array.isArray(currentSession?.presentation?.backgroundTasks)
        ? currentSession.presentation.backgroundTasks
        : [])
        .find((task) => String(task?.id || "").trim() === CODEX_APP_SERVER_TASK_ID) || null;
      if (
        currentTask?.status === "ready" &&
        normalizeText(currentTask?.message) === "Codex is ready." &&
        !normalizeText(currentTask?.error) &&
        normalizeText(currentTask?.terminalSessionId) === normalizeText(terminalSessionId)
      ) {
        return currentTask;
      }
    }
    const task = await writeCodexAppServerTaskEvent(runtime, sessionId, {
      healthAttempt,
      kind: "ready",
      message: "Codex is ready.",
      status: "ready",
      terminalSessionId
    });
    await writeCodexContextReplacementReady(runtime, sessionId, {
      terminalSessionId
    });
    return task;
  }

  async function writeCodexAppServerFailure(runtime, sessionId, result, {
    healthAttempt = null,
    terminalSessionId = ""
  } = {}) {
    await writeCodexAppServerTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
      healthAttempt,
      kind: "failed",
      message: "Codex app-server preparation failed.",
      retryable: result?.retryable !== false,
      status: "failed",
      terminalSessionId
    });
    return result;
  }

  async function writeCodexContextReplacementWarning(runtime, sessionId, thread = {}) {
    const replacedThreadId = normalizeText(thread.replacedThreadId);
    if (!replacedThreadId || !thread.replacedThreadError) {
      return null;
    }
    const message = "Previous Codex context could not be resumed. Vibe64 started a fresh Codex thread for this session.";
    const userMessage = "Codex could not resume its previous internal thread, so Vibe64 started a fresh Codex thread and gave it this session's saved chat history.";
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_CONTEXT_TASK_ID, {
      event: {
        error: errorMessage(thread.replacedThreadError),
        kind: "thread_replaced",
        message,
        replacedThreadId,
        status: "failed",
        threadId: normalizeText(thread.threadId)
      },
      patch: {
        error: errorMessage(thread.replacedThreadError),
        kind: "codex_context",
        label: "Codex context",
        message,
        retry: null,
        status: "failed",
        terminalSessionId: ""
      }
    });
    const currentSession = typeof runtime.getSession === "function"
      ? await runtime.getSession(sessionId).catch(() => null)
      : null;
    if (
      currentSession?.metadata?.codex_context_replacement_notice_thread_id !== replacedThreadId &&
      typeof runtime.store?.writeConversationSystemMessage === "function"
    ) {
      await runtime.store.writeConversationSystemMessage(sessionId, {
        text: userMessage
      });
      if (typeof runtime.store?.writeMetadataValue === "function") {
        await runtime.store.writeMetadataValue(
          sessionId,
          "codex_context_replacement_notice_thread_id",
          replacedThreadId
        );
      }
    }
    await publishSessionChanged(sessionId, {
      reason: "codex-context-replaced"
    });
    return task;
  }

  async function writeCodexContextReplacementReady(runtime, sessionId, {
    terminalSessionId = ""
  } = {}) {
    if (
      typeof runtime.getSession !== "function" ||
      typeof runtime.store?.writeBackgroundTaskEvent !== "function"
    ) {
      return null;
    }
    const currentSession = await runtime.getSession(sessionId).catch(() => null);
    const replacedThreadId = normalizeText(currentSession?.metadata?.codex_context_replacement_notice_thread_id);
    const currentThreadId = normalizeText(
      currentSession?.metadata?.agent_identity_conversation_id
    );
    const currentTask = (Array.isArray(currentSession?.presentation?.backgroundTasks)
      ? currentSession.presentation.backgroundTasks
      : [])
      .find((task) => String(task?.id || "").trim() === CODEX_CONTEXT_TASK_ID) || null;
    if (
      !replacedThreadId ||
      !currentThreadId ||
      currentThreadId === replacedThreadId ||
      currentTask?.status !== "failed"
    ) {
      return null;
    }
    const message = "Codex context recovered with a fresh Codex thread.";
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_CONTEXT_TASK_ID, {
      event: {
        kind: "thread_replacement_ready",
        message,
        replacedThreadId,
        status: "ready",
        threadId: currentThreadId
      },
      patch: {
        error: "",
        kind: "codex_context",
        label: "Codex context",
        message,
        retry: null,
        status: "ready",
        terminalSessionId: normalizeText(terminalSessionId)
      }
    });
    await publishSessionChanged(sessionId, {
      reason: "codex-context-ready"
    });
    return task;
  }

  async function writeCodexAppServerBlocked(runtime, sessionId, result, {
    terminalSessionId = ""
  } = {}) {
    await writeCodexAppServerTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
      kind: "blocked",
      message: errorMessage(result) || "Codex cannot start for this session clone.",
      publishReason: "codex-app-server-blocked",
      retryable: false,
      status: "ready",
      terminalSessionId
    });
    return result;
  }

  async function blockCodexAppServerForUnavailableWorktree(runtime, sessionId, result) {
    // The app-server runtime is session-scoped; detach this removed session's client/subscription.
    const session = await runtime.getSession(sessionId).catch(() => null);
    if (session) {
      closeCodexAppServerProviderForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        })
      );
    }
    return writeCodexAppServerBlocked(runtime, sessionId, result);
  }

  async function codexAppServerSessionContext(sessionId, {
    runtime: providedRuntime = null,
    session: providedSession = null
  } = {}) {
    const runtime = providedRuntime || await createRuntimeForSession(sessionId);
    const session = providedSession?.sessionId === sessionId
      ? providedSession
      : await runtime.getSession(sessionId);
    const targetRoot = terminalTargetRoot(session, projectService);
    if (!targetRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Vibe64 Codex target root is not available."
      });
    }
    const workdir = terminalWorktreePath(session);
    if (codexSessionWorktreeIsUnavailable(session)) {
      return blockCodexAppServerForUnavailableWorktree(
        runtime,
        sessionId,
        codexSessionWorktreeUnavailableFailure({
          session,
          workdir
        })
      );
    }
    if (!codexSessionWorkdirAllowed({
      session,
      targetRoot,
      workdir
    })) {
      return retryableTerminalFailure({
        ok: false,
        error: workdir
          ? "Vibe64 Codex workdir is outside the target root."
          : "Create the session clone before starting Codex."
      });
    }
    if (!await directoryExists(workdir)) {
      return blockCodexAppServerForUnavailableWorktree(
        runtime,
        sessionId,
        codexSessionWorktreeUnavailableFailure({
          session,
          workdir
        })
      );
    }
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }
    return {
      ok: true,
      runtime,
      session,
      targetRoot,
      toolHomeSource: toolHome.toolHomeSource,
      workdir
    };
  }

  function codexAppServerReconcileSessionId(value = {}) {
    if (typeof value === "string") {
      return normalizeText(value);
    }
    return normalizeText(value?.sessionId || value?.id);
  }

  async function codexAppServerLoadedThreadIds(provider = null) {
    if (typeof provider?.listLoadedThreads !== "function") {
      return null;
    }
    const threadIds = new Set();
    let cursor = null;
    do {
      const response = await provider.listLoadedThreads({
        ...(cursor ? { cursor } : {}),
        limit: 100
      });
      for (const threadId of Array.isArray(response?.data) ? response.data : []) {
        const normalizedThreadId = normalizeText(threadId);
        if (normalizedThreadId) {
          threadIds.add(normalizedThreadId);
        }
      }
      cursor = normalizeText(response?.nextCursor);
    } while (cursor);
    return threadIds;
  }

  async function reconcileCodexAppServerThreadForSession(sessionId = "", {
    agentSettings = {}
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: "Vibe64 session ID is required."
      };
    }
    const context = await codexAppServerSessionContext(normalizedSessionId);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      targetRoot,
      toolHomeSource,
      workdir
    } = context;
    const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
      runtime,
      targetRoot,
      toolHomeSource,
      workdir
    });
    const providerKey = codexAppServerProviderKey(normalizedSessionId, providerOptions);
    const existing = codexAppServerThreadReconciliations.get(providerKey);
    if (existing) {
      return existing;
    }
    const reconciliation = (async () => {
      const threadId = codexThreadIdForWorkdir(session, workdir);
      const provider = await ensureCodexAppServerDaemonForSession(normalizedSessionId, providerOptions);
      if (threadId) {
        try {
          const loadedThreadIds = await codexAppServerLoadedThreadIds(provider);
          if (loadedThreadIds?.has(threadId)) {
            const subscription = subscribeCodexAppServerEvents(
              normalizedSessionId,
              provider,
              threadId,
              providerOptions
            );
            rememberCodexAppServerManagedSession(providerKey, {
              agentSettings,
              sessionId: normalizedSessionId,
              targetRoot,
              workdir
            });
            const subscriptionStatus = normalizeText(subscription?.status) || "subscribed";
            await reconcileCodexAppServerLoadedThreadStatus(
              normalizedSessionId,
              provider,
              threadId
            ).catch((error) => {
              vibe64SessionDebugLog("server.codexTerminal.appServerThread.statusReconcile.error", {
                error: vibe64SessionDebugError(error),
                sessionId: normalizedSessionId,
                threadId
              });
            });
            await writeCodexAppServerReady(runtime, normalizedSessionId, "");
            if (subscriptionStatus === "alreadySubscribed") {
              return {
                ok: true,
                providerKey,
                sessionId: normalizedSessionId,
                status: "alreadySubscribed",
                threadId
              };
            }
            return {
              ok: true,
              providerKey,
              sessionId: normalizedSessionId,
              status: subscriptionStatus === "resubscribed" ? "resubscribed" : "loaded",
              threadId
            };
          }
        } catch (error) {
          vibe64SessionDebugLog("server.codexTerminal.appServerThread.loadedList.error", {
            error: vibe64SessionDebugError(error),
            sessionId: normalizedSessionId,
            threadId
          });
        }
      }
      const prepared = await ensureCodexAppServerThreadReady(normalizedSessionId, {
        agentSettings
      });
      return {
        ...prepared,
        providerKey
      };
    })().finally(() => {
      codexAppServerThreadReconciliations.delete(providerKey);
    });
    codexAppServerThreadReconciliations.set(providerKey, reconciliation);
    return reconciliation;
  }

  async function reconcileCodexAppServerThreads(sessions = [], {
    agentSettings = {}
  } = {}) {
    const selectedTargetRoot = currentProjectTargetRoot();
    const reconcileGeneration = ++codexAppServerThreadReconcileGeneration;
    const sessionIds = [...new Set((Array.isArray(sessions) ? sessions : [])
      .map((session) => codexAppServerReconcileSessionId(session))
      .filter(Boolean))];
    const results = await Promise.all(sessionIds.map(async (sessionId) => {
      try {
        return await reconcileCodexAppServerThreadForSession(sessionId, {
          agentSettings
        });
      } catch (error) {
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
        return {
          ok: false,
          error: errorMessage(error, "Vibe64 Codex app-server thread reconciliation failed."),
          sessionId
        };
      }
    }));
    const failed = results.filter((result) => result?.ok === false);
    const keepProviderKeys = new Set(results
      .map((result) => normalizeText(result?.providerKey))
      .filter(Boolean));
    if (reconcileGeneration === codexAppServerThreadReconcileGeneration) {
      await waitForOtherCodexAppServerThreadReconciliations({
        keepProviderKeys,
        targetRoot: selectedTargetRoot
      });
    }
    if (reconcileGeneration === codexAppServerThreadReconcileGeneration) {
      pruneCodexAppServerManagedSessions({
        closeOtherTargets: Boolean(selectedTargetRoot),
        keepProviderKeys,
        targetRoot: selectedTargetRoot
      });
    } else {
      vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.pruneSkipped", {
        reason: "stale_reconcile",
        sessionCount: sessionIds.length,
        targetRoot: normalizeText(selectedTargetRoot)
      });
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.done", {
      failedCount: failed.length,
      sessionCount: sessionIds.length
    });
    return {
      failed,
      ok: failed.length === 0,
      results,
      sessionCount: sessionIds.length
    };
  }

  async function ensureCodexAppServerThreadReady(sessionId, {
    agentSettings = {}
  } = {}) {
    const context = await codexAppServerSessionContext(sessionId);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      targetRoot,
      toolHomeSource,
      workdir
    } = context;

    let healthAttempt = null;
    try {
      const prepared = await withCodexSessionStartupGate({
        operation: async (currentSession) => {
          const terminalEnv = await codexProjectTerminalEnv({
            runtime,
            session: currentSession,
            sessionId,
            targetRoot
          });
          const providerOptions = await codexAppServerRuntimeOptionsForSession(currentSession, {
            terminalEnv,
            runtime,
            targetRoot,
            toolHomeSource,
            workdir
          });
          const health = await writeCodexAppServerRunning(runtime, sessionId, {
            kind: "app_server_started",
            message: "Preparing Codex app-server for this session."
          });
          healthAttempt = health.healthAttempt;
          const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
          const promptSession = await runtime.promptSessionForAction(currentSession);
          const developerInstructions = codexAppServerDeveloperInstructions(promptSession);
          const thread = await ensureCodexAppServerThreadForSession({
            agentSettings,
            developerInstructions,
            provider,
            runtime,
            session: currentSession,
            workdir
          });
          return {
            currentSession,
            provider,
            providerOptions,
            thread
          };
        },
        runtime,
        session,
        sessionId
      });
      const preparedSession = prepared.currentSession;
      const provider = prepared.provider;
      const providerOptions = prepared.providerOptions;
      const thread = prepared.thread;
      await writeCodexContextReplacementWarning(runtime, sessionId, thread);
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        agentSettings,
        sessionId,
        targetRoot,
        workdir
      });
      await reconcileCodexAppServerThreadStatus(sessionId, provider, thread.threadId, {
        failUnconfirmedTrackedTurn: true,
        requireTrackedTurn: true,
        source: "thread_ready"
      });
      const briefingWasDelivered = !sessionBriefingIsDelivered(preparedSession);
      const deliveredAt = new Date().toISOString();
      if (briefingWasDelivered) {
        await runtime.store.mutateSession(sessionId, async () => {
          await Promise.all([
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered_at", deliveredAt),
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server")
          ]);
        });
      }
      await writeCodexAppServerReady(runtime, sessionId, "", {
        healthAttempt
      });
      const currentSession = await runtime.getSession(sessionId);
      return {
        ...withCodexState({
          ok: true
        }, currentSession),
        appServerEndpoint: thread.appServerRuntime?.endpoint || "",
        codexAppServerThreadReady: true,
        codexIdentityReady: Boolean(codexConversationIdForWorkdir(currentSession, workdir)),
        codexThreadReady: Boolean(codexThreadIdForWorkdir(currentSession, workdir)),
        codexThreadId: thread.threadId,
        codexSessionBriefingDelivered: briefingWasDelivered,
        terminalSessionId: ""
      };
    } catch (error) {
      const unavailableFailure = await codexProjectTerminalEnvFailureResult(error, {
        runtime,
        sessionId
      });
      if (unavailableFailure) {
        return blockCodexAppServerForUnavailableWorktree(runtime, sessionId, unavailableFailure);
      }
      await writeCodexAppServerFailure(runtime, sessionId, error, {
        healthAttempt
      });
      const reconnectFailure = await codexReconnectTerminalFailureForError(error, {
        reason: "codex-app-server-thread-ready",
        toolHomeSource
      });
      if (reconnectFailure) {
        return reconnectFailure;
      }
      throw error;
    }
  }

  async function injectPromptIntoCodexAppServer(sessionId, handoff = {}, {
    agentSettings = {},
    lifecycle = null,
    prepareHandoff = null,
    runtime: providedRuntime = null,
    session: providedSession = null,
    vibe64User = null
  } = {}) {
    const handoffId = normalizeCodexPromptHandoffId(handoff.handoffId);
    const messageId = normalizeText(handoff.clientSubmissionId);
    let lifecycleState = "";
    async function publishLifecycle(state = "", input = {}) {
      const normalizedState = normalizeText(state);
      if (typeof lifecycle === "function") {
        await lifecycle({
          connectionReused: typeof input.connectionReused === "boolean" ? input.connectionReused : null,
          error: normalizeText(input.error),
          handoffId,
          providerId: CODEX_AGENT_PROVIDER,
          state: normalizedState,
          threadId: normalizeText(input.threadId),
          transportId: "codex_app_server",
          turnId: normalizeText(input.turnId)
        });
      }
      lifecycleState = normalizedState;
    }
    if (!codexPromptInputFromHandoff(handoff)) {
      return {
        ok: false,
        error: "Codex prompt handoff is empty."
      };
    }

    const context = await codexAppServerSessionContext(sessionId, {
      runtime: providedRuntime,
      session: providedSession
    });
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      targetRoot,
      toolHomeSource,
      workdir
    } = context;
    vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.start", {
      handoffId,
      messageId,
      sessionId
    });

    const claim = await claimCodexAppServerTurnStart(runtime, sessionId, {
      handoffId,
      resultContract: handoff.resultContract
    });
    if (!claim?.claimed) {
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.claimObserved", {
        code: String(claim?.response?.code || ""),
        messageId,
        operationOutcome: String(claim?.response?.operationOutcome || ""),
        sessionId
      });
      return claim?.response || {
        ok: false,
        error: "Codex is already working on this Vibe64 session."
      };
    }

    let activeThreadId = "";
    let healthAttempt = null;
    let providerFailure = "";
    let turnFailureHandled = false;
    try {
      const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
      const prepared = await withCodexSessionStartupGate({
        operation: async (currentSession) => {
          const terminalEnv = await codexProjectTerminalEnv({
            runtime,
            session: currentSession,
            sessionId,
            targetRoot
          });
          const providerOptions = await codexAppServerRuntimeOptionsForSession(currentSession, {
            terminalEnv,
            runtime,
            targetRoot,
            toolHomeSource,
            workdir
          });
          const providerAlreadyAvailable = codexAppServerProviderIsAvailableForSession(
            sessionId,
            providerOptions
          );
          if (!providerAlreadyAvailable) {
            await publishLifecycle("connecting", {
              connectionReused: false
            });
            const health = await writeCodexAppServerRunning(runtime, sessionId, {
              kind: "app_server_started",
              message: "Connecting to Codex for this session."
            });
            healthAttempt = health.healthAttempt;
          }
          const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
          const promptSession = await runtime.promptSessionForAction(currentSession);
          const developerInstructions = codexAppServerDeveloperInstructions(promptSession);
          const thread = await ensureCodexAppServerThreadForSession({
            agentSettings,
            developerInstructions,
            provider,
            runtime,
            session: currentSession,
            workdir
          });
          return {
            currentSession,
            developerInstructions,
            provider,
            providerAlreadyAvailable,
            providerOptions,
            thread
          };
        },
        runtime,
        session,
        sessionId
      });
      const preparedSession = prepared.currentSession;
      const developerInstructions = prepared.developerInstructions;
      const provider = prepared.provider;
      const providerAlreadyAvailable = prepared.providerAlreadyAvailable;
      const providerOptions = prepared.providerOptions;
      const thread = prepared.thread;
      await writeCodexContextReplacementWarning(runtime, sessionId, thread);
      activeThreadId = thread.threadId;
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        agentSettings,
        sessionId,
        targetRoot,
        workdir
      });
      await writeCodexAppServerReady(runtime, sessionId, "", {
        healthAttempt
      });
      await markCodexAppServerTurnActive(sessionId, {
        status: "starting",
        threadId: thread.threadId
      });
      const actorResult = await recordSessionGitCommandActor({
        env,
        reason: "codex-prompt",
        runtime,
        session: preparedSession,
        targetRoot,
        threadId: thread.threadId,
        vibe64User,
        workdir
      });
      if (actorResult?.ok === false) {
        throw new Error(actorResult.error || "GitHub identity is not available for the user who authorized this Codex prompt.");
      }
      const refreshMetadata = preparedSession.metadata || {};
      const contextRefresh = codexContextRefreshPending(preparedSession) ? developerInstructions : "";
      const deliveryHandoff = typeof prepareHandoff === "function"
        ? await prepareHandoff(handoff) || handoff
        : handoff;
      const terminalInput = codexPromptInputFromHandoff(deliveryHandoff);
      if (!terminalInput) {
        throw new Error("Codex prompt handoff is empty after delivery preparation.");
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.prepared", {
        handoffId,
        messageCount: Array.isArray(deliveryHandoff.clientSubmissionIds)
          ? deliveryHandoff.clientSubmissionIds.length
          : messageId ? 1 : 0,
        messageId,
        messageIds: Array.isArray(deliveryHandoff.clientSubmissionIds)
          ? deliveryHandoff.clientSubmissionIds
          : [messageId].filter(Boolean),
        sessionId,
        threadId: thread.threadId
      });
      let delivery = null;
      const clientUserMessageId = normalizeText(deliveryHandoff.clientSubmissionId) ||
        `vibe64:${crypto.randomUUID()}`;
      await writeCodexAppServerUserMessageOwnership(runtime, sessionId, clientUserMessageId, {
        eventKind: "codex-app-server-user-message-owned",
        owned: true
      });
      try {
        delivery = await sendCodexAppServerPromptForSession({
          agentSettings,
          clientUserMessageId,
          contextRefresh,
          prompt: terminalInput,
          provider,
          threadId: thread.threadId,
          workdir
        });
      } catch (error) {
        await writeCodexAppServerUserMessageOwnership(runtime, sessionId, clientUserMessageId, {
          eventKind: "codex-app-server-user-message-released",
          owned: false
        });
        await markCodexAppServerTurnIdle(sessionId, {
          error: errorMessage(error, "Codex app-server prompt delivery failed."),
          status: "failed",
          threadId: thread.threadId
        });
        turnFailureHandled = true;
        throw error;
      }
      const deliveredTurnId = normalizeText(delivery.turn?.id);
      const deliveredTurnStatus = normalizeText(delivery.turn?.status || delivery.turn?.raw?.status);
      let deliveredTurnIsActive = false;
      if (!deliveredTurnId) {
        throw new Error("Codex app-server accepted the prompt without returning a turn id.");
      }
      await publishLifecycle("delivered", {
        connectionReused: providerAlreadyAvailable,
        threadId: thread.threadId,
        turnId: deliveredTurnId
      });
      const identity = await markCodexAppServerTurnActive(sessionId, {
        requireTrackedTurn: true,
        status: "inProgress",
        threadId: thread.threadId,
        turnId: deliveredTurnId
      });
      if (!codexAppServerTurnStatusIsComplete(deliveredTurnStatus)) {
        deliveredTurnIsActive = identity?.processed !== false &&
          !codexAppServerCompletedTurns.has(codexAppServerTurnKey(thread.threadId, deliveredTurnId));
      } else if (codexAppServerTurnStatusIsProviderFailure(deliveredTurnStatus)) {
        providerFailure = `Codex turn ${deliveredTurnStatus}.`;
        await stopCodexAppServerTurnWithProviderFailure(sessionId, thread.threadId, deliveredTurnId, {
          provider,
          status: deliveredTurnStatus
        });
        await publishLifecycle("failed", {
          connectionReused: providerAlreadyAvailable,
          error: providerFailure,
          threadId: thread.threadId,
          turnId: deliveredTurnId
        });
      } else if (codexAppServerTurnStatusIsSuccessfulComplete(deliveredTurnStatus)) {
        const completion = await completeCodexAppServerTurn(sessionId, thread.threadId, deliveredTurnId, {
          provider,
          status: deliveredTurnStatus
        });
        if (completion?.ok === false) {
          providerFailure = normalizeText(completion.error) || "Codex completed, but its response could not be processed.";
          await publishLifecycle("failed", {
            connectionReused: providerAlreadyAvailable,
            error: providerFailure,
            threadId: thread.threadId,
            turnId: deliveredTurnId
          });
        } else {
          deliveredTurnIsActive = completion?.reason === "provider_still_active";
        }
      }
      if (lifecycleState !== "failed" && deliveredTurnIsActive) {
        await publishLifecycle("active", {
          connectionReused: providerAlreadyAvailable,
          threadId: thread.threadId,
          turnId: deliveredTurnId
        });
      }
      const briefingWasDelivered = !sessionBriefingIsDelivered(preparedSession);
      const deliveredAt = new Date().toISOString();
      await runtime.store.mutateSession(sessionId, async () => {
        await Promise.all([
          runtime.store.writeMetadataValue(sessionId, "agent_settings_model", effectiveSettings.model),
          runtime.store.writeMetadataValue(sessionId, "agent_settings_provider", effectiveSettings.providerId),
          runtime.store.writeMetadataValue(sessionId, "agent_settings_thinking", effectiveSettings.thinking),
          ...(briefingWasDelivered ? [
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered_at", deliveredAt),
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server")
          ] : [])
        ]);
      });
      if (contextRefresh) {
        await clearCodexAppServerContextRefreshPending(runtime, sessionId, {
          delivery: "prompt",
          reason: refreshMetadata.codex_context_refresh_reason,
          threadId: refreshMetadata.codex_context_refresh_thread_id || thread.threadId,
          turnId: refreshMetadata.codex_context_refresh_turn_id
        });
      }
      const currentSession = await runtime.getSession(sessionId);
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.delivered", {
        handoffId,
        messageId,
        sessionId,
        threadId: thread.threadId,
        turnId: deliveredTurnId
      });
      return {
        ...withCodexState({
          ...(providerFailure ? { error: providerFailure } : {}),
          ok: !providerFailure
        }, currentSession),
        connectionReused: providerAlreadyAvailable,
        turnId: delivery.turn?.id || ""
      };
    } catch (error) {
      if (!["active", "failed"].includes(lifecycleState)) {
        await publishLifecycle("failed", {
          error: errorMessage(error, "Codex app-server prompt delivery failed."),
          threadId: activeThreadId
        }).catch(() => null);
      }
      if (!turnFailureHandled) {
        await markCodexAppServerTurnIdle(sessionId, {
          error: errorMessage(error, "Codex app-server prompt delivery failed."),
          status: "failed",
          threadId: activeThreadId
        }).catch(() => null);
      }
      const unavailableFailure = await codexProjectTerminalEnvFailureResult(error, {
        runtime,
        sessionId
      });
      if (unavailableFailure) {
        return blockCodexAppServerForUnavailableWorktree(runtime, sessionId, unavailableFailure);
      }
      await writeCodexAppServerFailure(runtime, sessionId, error, {
        healthAttempt
      });
      throw error;
    }
  }

  function codexAppServerDetachedChatInstructions(session = {}) {
    return [
      codexAppServerDeveloperInstructions(session),
      "",
      "Detached Vibe64 chat instruction:",
      "This is not the main Vibe64 workflow conversation.",
      "Respond normally without structured Vibe64 workflow output.",
      "Do not edit files or run commands that change project state.",
      "Answer the prompt as a focused source-code chat response."
    ].join("\n").trim();
  }

  function createCodexAppServerDetachedTurnWatcher(provider = null, threadId = "", {
    onEvent = null,
    timeoutMs = CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
  } = {}) {
    const normalizedThreadId = normalizeText(threadId);
    let targetTurnId = "";
    let finalText = "";
    let failureDetailTimeout = null;
    let settled = false;
    let timeout = null;
    let unsubscribe = null;
    let pendingCompletionStatus = "";
    let pendingFailure = null;
    let resolveWaiter = null;
    let rejectWaiter = null;

    function cleanup() {
      clearTimeout(timeout);
      timeout = null;
      clearTimeout(failureDetailTimeout);
      failureDetailTimeout = null;
      unsubscribe?.();
      unsubscribe = null;
    }

    function finish(result = {}) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolveWaiter?.(result);
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectWaiter?.(error);
    }

    function emitWatcherEvent(classification = {}) {
      if (typeof onEvent !== "function" || !classification?.kind) {
        return;
      }
      onEvent({
        ...classification,
        threadId: classification.threadId || normalizedThreadId,
        turnId: classification.turnId || targetTurnId
      });
    }

    async function resultFromThread() {
      if (!normalizedThreadId || !targetTurnId || typeof provider?.readThread !== "function") {
        return {
          status: "",
          statusType: "",
          text: ""
        };
      }
      const thread = await provider.readThread(normalizedThreadId);
      const rawStatus = thread.raw?.status || thread.response?.thread?.status;
      return {
        status: codexAppServerStatusFromValue(rawStatus),
        statusType: normalizeText(typeof rawStatus === "string" ? rawStatus : rawStatus?.type),
        text: codexAppServerProviderThreadAssistantSegments(thread, targetTurnId)
          .map((segment) => segment.text)
          .join("\n\n")
      };
    }

    function failAfterDetailGrace(error) {
      if (settled || failureDetailTimeout) {
        return;
      }
      failureDetailTimeout = setTimeout(() => {
        failureDetailTimeout = null;
        fail(error);
      }, CODEX_APP_SERVER_DETACHED_FAILURE_DETAIL_GRACE_MS);
    }

    async function finishFromCompletion(status = "completed") {
      try {
        if (!targetTurnId) {
          pendingCompletionStatus = normalizeText(status) || "completed";
          return;
        }
        const authoritative = await resultFromThread().catch(() => ({
          status: "",
          statusType: "",
          text: ""
        }));
        finalText = authoritative.text || finalText;
        if (!finalText) {
          const systemError = authoritative.statusType === "systemError" || authoritative.status === "failed";
          failAfterDetailGrace(new Error(systemError
            ? "Codex app-server thread entered a system error before producing an assistant response."
            : "Codex app-server completed without producing an assistant response."));
          return;
        }
        finish({
          status,
          text: finalText,
          threadId: normalizedThreadId,
          turnId: targetTurnId
        });
      } catch (error) {
        fail(error);
      }
    }

    function notificationMatches(notification = {}) {
      const notificationThreadId = codexAppServerNotificationThreadId(notification);
      if (notificationThreadId && notificationThreadId !== normalizedThreadId) {
        return false;
      }
      const notificationTurnId = codexAppServerNotificationTurnId(notification);
      return !targetTurnId || !notificationTurnId || notificationTurnId === targetTurnId;
    }

    return {
      async completeNow(status = "completed") {
        await finishFromCompletion(status);
      },
      failNow(error) {
        fail(error);
      },
      failAfterDetailGrace(error) {
        failAfterDetailGrace(error);
      },
      setTurnId(turnId = "") {
        targetTurnId = normalizeText(turnId);
        if (pendingFailure) {
          failAfterDetailGrace(pendingFailure);
          return;
        }
        if (pendingCompletionStatus) {
          const status = pendingCompletionStatus;
          pendingCompletionStatus = "";
          void finishFromCompletion(status);
        }
      },
      wait() {
        if (settled) {
          return Promise.reject(new Error("Codex app-server detached turn watcher was already settled."));
        }
        return new Promise((resolve, reject) => {
          resolveWaiter = resolve;
          rejectWaiter = reject;
          timeout = setTimeout(() => {
            fail(new Error("Timed out waiting for Codex app-server response."));
          }, timeoutMs);
          unsubscribe = typeof provider?.subscribe === "function"
            ? provider.subscribe((notification = {}) => {
                if (!notificationMatches(notification)) {
                  return;
                }
                const classification = classifyCodexAppServerEvent(notification);
                emitWatcherEvent(classification);
                if (
                  classification.kind === "provider_error" &&
                  classification.text &&
                  codexAppServerNotificationParams(notification).willRetry !== true
                ) {
                  const error = new Error(classification.text);
                  if (!targetTurnId) {
                    pendingFailure = error;
                    return;
                  }
                  fail(error);
                  return;
                }
                if (classification.kind === "final_assistant_result" && classification.text) {
                  finalText = classification.text;
                }
                const method = normalizeText(notification.method);
                if (method !== "turn/completed" && method !== "thread/status/changed") {
                  return;
                }
                const status = codexAppServerNotificationTurnStatus(notification) || "completed";
                if (codexAppServerTurnStatusIsProviderFailure(status)) {
                  const error = new Error(codexAppServerNotificationError(notification) || `Codex app-server turn ${status}.`);
                  if (!targetTurnId) {
                    pendingFailure = error;
                    return;
                  }
                  failAfterDetailGrace(error);
                  return;
                }
                if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
                  void finishFromCompletion(status);
                }
              })
            : null;
        });
      }
    };
  }

  async function runDetachedCodexAppServerChatTurn(sessionId, input = {}) {
    return detachedCodexAppServerChatTurn(sessionId, input);
  }

  async function streamDetachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    return detachedCodexAppServerChatTurn(sessionId, input, options);
  }

  async function detachedCodexAppServerChatTurn(sessionId, input = {}, {
    onEvent = null
  } = {}) {
    const emitDetachedEvent = (event = {}) => {
      if (typeof onEvent === "function") {
        onEvent(event);
      }
    };
    return vibe64Result(async () => {
      if (!codexAppServerPromptDeliveryEnabled) {
        return codexAppServerControlDisabledResult();
      }
      const prompt = normalizeText(input.prompt || input.message);
      if (!prompt) {
        return {
          code: "vibe64_codex_detached_prompt_empty",
          error: "Codex prompt is empty.",
          ok: false
        };
      }
      const context = await codexAppServerSessionContext(sessionId);
      if (context.ok === false) {
        return context;
      }
      const {
        runtime,
        session,
        targetRoot,
        toolHomeSource,
        workdir
      } = context;
      const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
        runtime,
        targetRoot,
        toolHomeSource,
        workdir
      });
      const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
      const promptSession = typeof runtime.promptSessionForAction === "function"
        ? await runtime.promptSessionForAction(session)
        : session;
      const agentSettings = isRecord(input.agentSettings) ? input.agentSettings : {};
      const threadSettings = codexAppServerThreadSettings({
        agentSettings,
        cwd: workdir,
        developerInstructions: codexAppServerDetachedChatInstructions(promptSession)
      });
      const requestedThreadId = normalizeText(input.threadId || input.codexSessionId);
      let thread = null;
      let replacedThreadId = "";
      if (requestedThreadId) {
        try {
          thread = await provider.resumeThread(requestedThreadId, threadSettings);
        } catch (error) {
          if (
            !codexAppServerRequestIsInvalid(error, "thread/resume") ||
            await codexAppServerThreadHasReadableHistory(provider, requestedThreadId)
          ) {
            throw error;
          }
          replacedThreadId = requestedThreadId;
        }
      }
      if (!thread) {
        thread = await provider.startThread(threadSettings);
      }
      const threadId = normalizeText(thread.id || thread.response?.thread?.id || requestedThreadId);
      if (!threadId) {
        throw new Error("Codex app-server did not return a detached chat thread id.");
      }
      emitDetachedEvent({
        replacedThreadId,
        threadId,
        type: "thread"
      });
      const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
        onEvent: (classification) => {
          emitDetachedEvent({
            classification,
            threadId,
            turnId: classification.turnId,
            type: "notification"
          });
        },
        timeoutMs: Number(input.timeoutMs || 0) > 0
          ? Number(input.timeoutMs)
          : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
      });
      const waitForResult = watcher.wait();
      const throwWatcherFailure = async (fallbackError, status = "", {
        waitForDetail = false
      } = {}) => {
        if (waitForDetail) {
          watcher.failAfterDetailGrace(fallbackError);
        } else {
          watcher.failNow(fallbackError);
        }
        const error = await waitForResult.then(
          () => fallbackError,
          (watcherError) => watcherError
        );
        throw codexDetachedChatTurnError(error, {
          agentSettings,
          status
        });
      };
      let delivery = null;
      try {
        delivery = await sendCodexAppServerPromptForSession({
          agentSettings,
          prompt,
          promptLabel: normalizeText(input.promptLabel) || "Detached Vibe64 source chat",
          provider,
          threadId,
          workdir
        });
      } catch (error) {
        await throwWatcherFailure(error);
      }
      const turnId = normalizeText(delivery.turn?.id);
      const status = normalizeText(delivery.turn?.status || delivery.turn?.raw?.status);
      watcher.setTurnId(turnId);
      emitDetachedEvent({
        status,
        threadId,
        turnId,
        type: "turn"
      });
      if (codexAppServerTurnStatusIsProviderFailure(status)) {
        const providerError = codexAppServerErrorText(
          delivery.turn?.raw?.error ||
          delivery.turn?.response?.turn?.error ||
          delivery.turn?.error
        );
        const error = new Error(providerError || `Codex app-server turn ${status}.`);
        await throwWatcherFailure(error, status, {
          waitForDetail: true
        });
      }
      if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
        await watcher.completeNow(status);
      }
      let result = null;
      try {
        result = await waitForResult;
      } catch (error) {
        throw codexDetachedChatTurnError(error, {
          agentSettings,
          status
        });
      }
      emitDetachedEvent({
        status: result.status || "completed",
        text: result.text,
        threadId,
        turnId: result.turnId || turnId,
        type: "completed"
      });
      return {
        ok: true,
        replacedThreadId,
        text: result.text,
        threadId,
        turnId: result.turnId || turnId
      };
    });
  }

  async function deleteDetachedCodexAppServerChatThread(sessionId, input = {}) {
    return vibe64Result(async () => {
      if (!codexAppServerPromptDeliveryEnabled) {
        return codexAppServerControlDisabledResult();
      }
      const threadId = normalizeText(input.threadId || input.codexSessionId);
      if (!threadId) {
        return {
          ok: true,
          status: "notFound"
        };
      }
      const context = await codexAppServerSessionContext(sessionId);
      if (context.ok === false) {
        return context;
      }
      const {
        runtime,
        session,
        targetRoot,
        toolHomeSource,
        workdir
      } = context;
      const provider = await ensureCodexAppServerDaemonForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime,
          targetRoot,
          toolHomeSource,
          workdir
        })
      );
      if (typeof provider.deleteThread !== "function") {
        return {
          code: "vibe64_codex_detached_thread_delete_unavailable",
          error: "Codex app-server thread deletion is not available.",
          ok: false,
          statusCode: 409,
          threadId
        };
      }
      try {
        const result = await provider.deleteThread(threadId);
        return {
          ok: true,
          result,
          status: "deleted",
          threadId
        };
      } catch (error) {
        if (
          codexAppServerRequestIsInvalid(error, "thread/delete") &&
          !await codexAppServerThreadHasReadableHistory(provider, threadId)
        ) {
          return {
            ok: true,
            status: "notFound",
            threadId
          };
        }
        throw error;
      }
    });
  }

  async function interruptDetachedCodexAppServerChatTurn(sessionId, input = {}) {
    return vibe64Result(async () => {
      if (!codexAppServerPromptDeliveryEnabled) {
        return codexAppServerControlDisabledResult();
      }
      const threadId = normalizeText(input.threadId || input.codexSessionId);
      const turnId = normalizeText(input.turnId || input.codexTurnId);
      if (!threadId || !turnId) {
        return codexAppServerInterruptUnavailableResponse({
          active: false,
          threadId,
          turnId
        });
      }
      const context = await codexAppServerSessionContext(sessionId);
      if (context.ok === false) {
        return context;
      }
      const {
        runtime,
        session,
        targetRoot,
        toolHomeSource,
        workdir
      } = context;
      const provider = await ensureCodexAppServerDaemonForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime,
          targetRoot,
          toolHomeSource,
          workdir
        })
      );
      const result = await provider.interruptTurn(threadId, turnId);
      const interruptFailure = codexAppServerInterruptFailure(result);
      if (interruptFailure) {
        return {
          ...interruptFailure,
          result,
          threadId,
          turnId
        };
      }
      return {
        ok: true,
        result,
        status: "interrupted",
        threadId,
        turnId
      };
    });
  }

  function codexAppServerVisibleTerminalAttachState(session = {}) {
    const turn = codexAppServerTurnState(session);
    if (!(turn.active && turn.state === "active" && turn.threadId)) {
      return null;
    }
    const workdir = terminalWorktreePath(session);
    const threadId = codexThreadIdForWorkdir(session, workdir);
    if (!threadId || normalizeText(turn.threadId) !== threadId) {
      return null;
    }
    return {
      appServerEndpoint: normalizeText(session.metadata?.agent_transport_endpoint),
      codexThreadId: threadId,
      codexThreadReady: true,
      trackedTurnId: turn.turnId
    };
  }

  async function startCodexAppServerTerminal(sessionId, input = {}) {
    const runtime = await createRuntimeForSession(sessionId);
    await claimSessionWorkflowDriver(runtime, sessionId, {
      originId: input?.originId || "",
      reason: "codex-terminal-start",
      vibe64User: input?.vibe64User || null
    });
    const attachState = codexAppServerVisibleTerminalAttachState(await runtime.getSession(sessionId));
    let prepared = attachState;
    if (attachState) {
      vibe64SessionDebugLog("server.codexTerminal.start.attachActiveTurn", {
        sessionId,
        threadId: attachState.codexThreadId,
        turnId: attachState.trackedTurnId
      });
    } else {
      prepared = await ensureCodexAppServerThreadReady(sessionId);
      if (prepared?.ok === false) {
        return prepared;
      }
    }
    const terminalResponse = await startCodexTerminalSession(sessionId);
    if (terminalResponse?.ok === false) {
      return terminalResponse;
    }
    return {
      ...terminalResponse,
      appServerEndpoint: prepared.appServerEndpoint,
      codexAppServerThreadReady: true,
      codexThreadReady: prepared.codexThreadReady,
      codexThreadId: prepared.codexThreadId,
      pendingCodexPromptInjected: false
    };
  }

  async function interruptCodexAppServerTurn(sessionId, input = {}) {
    const context = await codexAppServerSessionContext(sessionId);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      targetRoot,
      toolHomeSource,
      workdir
    } = context;
    await claimSessionWorkflowDriver(runtime, sessionId, {
      originId: input?.originId || "",
      reason: "codex-turn-interrupt",
      vibe64User: input?.vibe64User || null
    });
    const turn = codexAppServerTurnState(session);
    const threadId = normalizeText(turn.threadId) || codexThreadIdForWorkdir(session, workdir);
    const turnId = normalizeText(turn.turnId);
    const controlRequestId = normalizeText(input?.controlRequestId);
    if (!turn.active || !threadId || !turnId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.unavailable", {
        active: turn.active,
        controlRequestId,
        sessionId,
        threadId,
        turnId
      });
      if (turn.active) {
        return codexAppServerInterruptUnavailableResponse({
          active: true,
          threadId,
          turnId
        });
      }
      return withCodexState({
        interrupted: false,
        ok: true,
        operationOutcome: "already_idle",
        threadId,
        turnId
      }, session);
    }
    const provider = await ensureCodexAppServerDaemonForSession(
      sessionId,
      await codexAppServerRuntimeOptionsForSession(session, {
        runtime,
        targetRoot,
        toolHomeSource,
        workdir
      })
    );
    vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.start", {
      controlRequestId,
      sessionId,
      threadId,
      turnId
    });
    async function recoverAfterInterruptFailure(error = null) {
      await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
        source: "interrupt_race"
      }).catch(() => null);
      const currentSession = await runtime.getSession(sessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      const sameTurnIsActive = currentTurn.state === "active" &&
        currentTurn.active === true &&
        normalizeText(currentTurn.threadId) === threadId &&
        normalizeText(currentTurn.turnId) === turnId;
      if (sameTurnIsActive) {
        return codexAppServerRequestIsInvalid(error, "turn/interrupt")
          ? codexAppServerInterruptUnavailableResponse({
              active: true,
              threadId,
              turnId
            })
          : null;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.alreadyIdle", {
        controlRequestId,
        sessionId,
        threadId,
        turnId
      });
      return withCodexState({
        interrupted: false,
        ok: true,
        operationOutcome: "already_idle",
        threadId,
        turnId
      }, currentSession);
    }
    let result;
    try {
      result = await provider.interruptTurn(threadId, turnId);
    } catch (error) {
      const recovered = await recoverAfterInterruptFailure(error);
      if (recovered) {
        return recovered;
      }
      throw error;
    }
    const interruptFailure = codexAppServerInterruptFailure(result);
    if (interruptFailure) {
      const recovered = await recoverAfterInterruptFailure(result);
      if (recovered) {
        return recovered;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.failed", {
        controlRequestId,
        error: interruptFailure.error,
        operationOutcome: interruptFailure.operationOutcome,
        sessionId,
        threadId,
        turnId
      });
      return {
        ...interruptFailure,
        result,
        threadId,
        turnId
      };
    }
    const stopped = await stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, turnId, {
      error: "Stopped by user.",
      ok: true,
      status: "interrupted",
      verifyInactive: false
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.done", {
      controlRequestId,
      sessionId,
      threadId,
      turnId
    });
    return {
      ...stopped,
      operationOutcome: "interrupted",
      result,
      threadId,
      turnId
    };
  }

  async function writeCodexAppServerDeliveredUserMessage(runtime, sessionId = "", text = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const message = normalizeText(text);
    if (
      !normalizedSessionId ||
      !message ||
      typeof runtime?.store?.writeConversationUserMessage !== "function"
    ) {
      return null;
    }
    const written = await runtime.store.writeConversationUserMessage(normalizedSessionId, {
      text: message
    });
    if (!written) {
      return null;
    }
    await publishSessionChanged(normalizedSessionId, {
      payload: {
        conversationLogPatch: {
          turn: written,
          type: "upsert-turn"
        }
      },
      reason: "codex-app-server-message-delivered"
    });
    return written;
  }

  async function recordCodexTerminalInputGitActor(sessionId = "", data = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!input?.trackGitActor || !normalizedSessionId || String(data ?? "").length === 0) {
      return {
        ok: true
      };
    }
    const runtime = await createRuntimeForSession(normalizedSessionId);
    const session = await runtime.getSession(normalizedSessionId);
    if (!session) {
      return {
        code: "vibe64_codex_terminal_session_missing",
        error: "Vibe64 session is not available for Codex terminal input.",
        ok: false
      };
    }
    const targetRoot = terminalTargetRoot(session, projectService);
    if (!targetRoot) {
      return {
        code: "vibe64_codex_terminal_target_root_missing",
        error: "Vibe64 Codex target root is not available for GitHub actor tracking.",
        ok: false
      };
    }
    const workdir = terminalWorktreePath(session) || targetRoot;
    const vibe64User = input?.vibe64User || input?.request?.vibe64User || null;
    let driverResult;
    try {
      driverResult = await claimSessionWorkflowDriver(runtime, normalizedSessionId, {
        originId: inputOriginId(input),
        reason: "codex-terminal-input",
        vibe64User
      });
    } catch (error) {
      return {
        code: error?.code || "vibe64_workflow_driver_failed",
        error: error?.message || "This session cannot be driven from this browser tab.",
        ok: false,
        statusCode: error?.statusCode
      };
    }
    const driverSession = driverResult.session || session;
    const actorMetadata = await recordSessionGitCommandActor({
      env,
      reason: "codex-terminal-input",
      runtime,
      session: driverSession,
      targetRoot,
      threadId: codexThreadIdForWorkdir(driverSession, workdir),
      vibe64User,
      workdir
    });
    if (actorMetadata?.ok === false) {
      return actorMetadata;
    }
    return {
      ok: true
    };
  }

  async function sendCodexAppServerMessage(sessionId, input = {}, {
    turnOwnership = null
  } = {}) {
    const message = codexAppServerMessageText(input);
    const displayMessage = codexAppServerMessageDisplayText(input, message);
    const displayMessages = (Array.isArray(input?.displayMessages) ? input.displayMessages : [displayMessage])
      .map((value) => normalizeText(value))
      .filter(Boolean);
    const messageId = normalizeText(input?.messageId || input?.composerSubmissionId);
    if (!message) {
      return {
        code: CODEX_AGENT_TURN_STEER_FAILED_CODE,
        error: "Codex message input is empty.",
        ok: false,
        operationOutcome: "message_empty",
        refreshRecommended: false
      };
    }
    const context = await codexAppServerSessionContext(sessionId);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      targetRoot,
      toolHomeSource,
      workdir
    } = context;
    const vibe64User = input?.vibe64User || null;
    let currentSession = session;
    let turn = codexAppServerTurnState(currentSession);
    const threadId = normalizeText(turn.threadId) || codexThreadIdForWorkdir(currentSession, workdir);
    if (!threadId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.newTurn", {
        messageId,
        reason: "thread_missing",
        sessionId,
        threadId: "",
        turnId: ""
      });
      return codexAppServerMessageRequiresNewTurn(currentSession, {
        reason: "thread_missing"
      });
    }
    const ownershipMatchesTrackedTurn = Boolean(
      turnOwnership &&
      normalizeText(turnOwnership.threadId) === threadId &&
      normalizeText(turnOwnership.turnId) === normalizeText(turn.turnId)
    );
    let provider = ownershipMatchesTrackedTurn
      ? availableManagedCodexAppServerProvider(sessionId, {
          targetRoot,
          workdir
        })
      : null;
    if (provider) {
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.providerReused", {
        messageId,
        sessionId,
        threadId,
        turnId: normalizeText(turn.turnId)
      });
    } else {
      provider = await ensureCodexAppServerDaemonForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(currentSession, {
          runtime,
          targetRoot,
          toolHomeSource,
          workdir
        })
      );
    }
    await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
      source: "message_delivery"
    });
    currentSession = await runtime.getSession(sessionId);
    turn = codexAppServerTurnState(currentSession);
    const turnId = normalizeText(turn.turnId);
    if (!turn.active) {
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.newTurn", {
        messageId,
        reason: "provider_idle",
        sessionId,
        threadId,
        turnId
      });
      return codexAppServerMessageRequiresNewTurn(currentSession, {
        reason: "provider_idle",
        threadId,
        turnId
      });
    }
    if (!turnId || turn.state === "finalizing") {
      return withCodexState({
        code: CODEX_AGENT_TURN_STEER_FAILED_CODE,
        delivered: false,
        error: "The active assistant turn is not ready to accept this message yet.",
        ok: false,
        operationOutcome: "active_turn_not_ready",
        refreshRecommended: true,
        retryable: true,
        threadId,
        turnId
      }, currentSession);
    }
    const ownershipMatchesTurn = Boolean(
      turnOwnership &&
      normalizeText(turnOwnership.threadId) === threadId &&
      normalizeText(turnOwnership.turnId) === turnId
    );
    if (ownershipMatchesTurn && turnOwnership.reusable !== true) {
      return withCodexState({
        code: "vibe64_agent_turn_owner_conflict",
        delivered: false,
        error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
        ok: false,
        operationOutcome: "active_turn_owned_by_another_user",
        refreshRecommended: true,
        retryable: true,
        threadId,
        turnId
      }, currentSession);
    }
    let actorMetadata = ownershipMatchesTurn && turnOwnership.reusable === true
      ? sessionGitCommandActorFromMetadata(currentSession)
      : null;
    if (actorMetadata?.ok !== true) {
      let driverSession = currentSession;
      if (!(ownershipMatchesTurn && turnOwnership.reusable === true)) {
        const driverResult = await claimSessionWorkflowDriver(runtime, sessionId, {
          originId: input?.originId || "",
          reason: "agent-message",
          vibe64User
        });
        driverSession = driverResult.session || currentSession;
      }
      actorMetadata = await recordSessionGitCommandActor({
        env,
        reason: "agent-message",
        runtime,
        session: driverSession,
        targetRoot,
        threadId,
        vibe64User,
        workdir
      });
    } else {
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.turnOwnershipReused", {
        messageId,
        sessionId,
        threadId,
        turnId
      });
    }
    if (actorMetadata?.ok === false) {
      return {
        code: actorMetadata.code || CODEX_AGENT_TURN_STEER_FAILED_CODE,
        error: actorMetadata.error || "GitHub identity is not available for the user who authorized this assistant message.",
        ok: false,
        operationOutcome: "steer_git_actor_unavailable",
        refreshRecommended: true,
        threadId,
        turnId
      };
    }
    const clientUserMessageId = messageId || `vibe64:${crypto.randomUUID()}`;
    await writeCodexAppServerUserMessageOwnership(runtime, sessionId, clientUserMessageId, {
      eventKind: "codex-app-server-user-message-owned",
      owned: true
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerMessage.activeTurn.start", {
      messageId,
      sessionId,
      threadId,
      turnId
    });
    async function recoverAfterSteerFailure(error = null) {
      await writeCodexAppServerUserMessageOwnership(runtime, sessionId, clientUserMessageId, {
        eventKind: "codex-app-server-user-message-released",
        owned: false
      });
      await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
        source: "message_delivery_steer_race"
      }).catch(() => null);
      currentSession = await runtime.getSession(sessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      const sameTurnIsActive = currentTurn.active === true &&
        normalizeText(currentTurn.threadId) === threadId &&
        normalizeText(currentTurn.turnId) === turnId &&
        currentTurn.state !== "finalizing";
      if (sameTurnIsActive) {
        return codexAppServerRequestIsInvalid(error, "turn/steer")
          ? codexAppServerMessageDeferred(currentSession, {
              threadId,
              turnId
            })
          : null;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.newTurn", {
        error: vibe64SessionDebugError(error),
        messageId,
        reason: "active_turn_completed_before_delivery",
        sessionId,
        threadId,
        turnId
      });
      return codexAppServerMessageRequiresNewTurn(currentSession, {
        reason: "active_turn_completed_before_delivery",
        threadId,
        turnId
      });
    }
    let result;
    try {
      result = await provider.steerTurn(threadId, turnId, message, {
        clientUserMessageId
      });
    } catch (error) {
      const recovered = await recoverAfterSteerFailure(error);
      if (recovered) {
        return recovered;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.activeTurn.error", {
        error: vibe64SessionDebugError(error),
        messageId,
        sessionId,
        threadId,
        turnId
      });
      throw error;
    }
    const steerFailure = codexAppServerSteerFailure(result);
    if (steerFailure) {
      const recovered = await recoverAfterSteerFailure(result);
      if (recovered) {
        return recovered;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.activeTurn.failed", {
        error: steerFailure.error,
        messageId,
        operationOutcome: steerFailure.operationOutcome,
        sessionId,
        threadId,
        turnId
      });
      return {
        ...steerFailure,
        result,
        threadId,
        turnId
      };
    }
    const conversationTurns = [];
    for (const text of displayMessages.length ? displayMessages : [displayMessage || message]) {
      conversationTurns.push(await writeCodexAppServerDeliveredUserMessage(runtime, sessionId, text));
    }
    const conversationTurn = conversationTurns.at(-1) || null;
    splitCodexAppServerReasoningTurn(threadId, turnId);
    currentSession = await runtime.getSession(sessionId);
    vibe64SessionDebugLog("server.codexTerminal.appServerMessage.activeTurn.done", {
      conversationTurnId: normalizeText(conversationTurn?.turnId || conversationTurn?.id),
      messageId,
      sessionId,
      threadId,
      turnId
    });
    return withCodexState({
      conversationTurn,
      conversationTurns,
      delivered: true,
      deliveryMode: "active_turn",
      newTurnRequired: false,
      ok: true,
      operationOutcome: "delivered_to_active_turn",
      result,
      threadId,
      turnId
    }, currentSession);
  }

  return Object.freeze({
    closeGlobalTerminal(terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: globalCodexTerminalNamespace()
      });
    },

    closeFixTerminal(jobId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: fixCodexTerminalNamespace(jobId)
      });
    },

    async closeAllForSession(sessionId) {
      let session = null;
      let providerOptions = null;
      let unsubscribeResult = null;
      try {
        const runtime = await createRuntimeForSession(sessionId);
        session = await runtime.getSession(sessionId);
        providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        });
      } catch (error) {
        vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeSession.prepare.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
        providerOptions = null;
      }
      try {
        unsubscribeResult = await unsubscribeCodexAppServerThreadForSession(sessionId);
        providerOptions = unsubscribeResult?.providerOptions || providerOptions;
      } catch (error) {
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.unsubscribe.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      } finally {
        await drainCodexAppServerNotificationTasks(sessionId);
        const cachedProviders = await stopCachedCodexAppServerProvidersForSession(sessionId);
        if (cachedProviders.ok === false) {
          vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeSession.cached.error", {
            failed: cachedProviders.failed,
            sessionId
          });
        }
        if (!cachedProviders.providerCount && providerOptions) {
          await stopCodexAppServerProviderForSession(sessionId, providerOptions);
        }
        if (session) {
          const persistedRuntime = await stopPersistedCodexAppServerRuntimeForSession(session, providerOptions || {});
          vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeSession.persisted.done", {
            removed: persistedRuntime?.removed === true,
            runtimeDirRemoved: persistedRuntime?.runtimeDirRemoved === true,
            sessionId,
            stopped: persistedRuntime?.removed === true || persistedRuntime?.runtimeDirRemoved === true
          });
        }
      }
      await closeTerminalSessionsForNamespace(codexTerminalNamespace(sessionId));
      const targetRoot = await terminalTargetRootForSession(projectService, sessionId);
      if (targetRoot) {
        await cleanupCodexAttachments(targetRoot, sessionId);
      }
    },

    async closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: codexTerminalNamespace(sessionId)
      });
    },

    readGlobalTerminal(terminalSessionId) {
      return vibe64Result(async () => {
        const targetRoot = await globalCodexTargetRoot(projectService);
        const snapshot = readTerminalSession(terminalSessionId, {
          namespace: globalCodexTerminalNamespace()
        });
        const codexTerminal = activeGlobalCodexTerminal(targetRoot);
        return {
          ...snapshot,
          codexTerminal,
          globalCodexTerminal: codexTerminal
        };
      });
    },

    readFixTerminal(jobId, terminalSessionId) {
      return vibe64Result(async () => {
        return readTerminalSession(terminalSessionId, {
          namespace: fixCodexTerminalNamespace(jobId)
        });
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession(sessionId);
        const session = await runtime.getSession(sessionId);
        return withCodexState(readTerminalSession(terminalSessionId, {
          namespace: codexTerminalNamespace(sessionId),
          outputLimit: CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
        }), session);
      });
    },

    async injectCodexPrompt(sessionId, handoff = {}, options = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return injectPromptIntoCodexAppServer(sessionId, handoff, options);
      });
    },

    runDetachedChatTurn(sessionId, input = {}) {
      return runDetachedCodexAppServerChatTurn(sessionId, input);
    },

    streamDetachedChatTurn(sessionId, input = {}, options = {}) {
      return streamDetachedCodexAppServerChatTurn(sessionId, input, options);
    },

    deleteDetachedChatThread(sessionId, input = {}) {
      return deleteDetachedCodexAppServerChatThread(sessionId, input);
    },

    interruptDetachedChatTurn(sessionId, input = {}) {
      return interruptDetachedCodexAppServerChatTurn(sessionId, input);
    },

    async injectGlobalCodexPrompt(handoff = {}) {
      return vibe64Result(async () => {
        return injectPromptIntoGlobalCodex(handoff);
      });
    },

    async startFixJob(input = {}) {
      return vibe64Result(async () => {
        return startFixCodexJob(input);
      });
    },

    async reportFixJob(jobId, input = {}) {
      return vibe64Result(async () => {
        const fixJob = await reportFixCodexJob({
          fixJobStore,
          input,
          jobId
        });
        return {
          fixJob,
          ok: true
        };
      });
    },

    async ensureThread(sessionId) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return ensureCodexAppServerThreadReady(sessionId);
      });
    },

    async invalidateAppServerRuntimes(input = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        return invalidateCodexAppServerRuntimes(input);
      });
    },

    async closeAllForProject(input = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        return stopCodexAppServerProvidersForTargetRoot(input);
      });
    },

    async reconcileThreads(sessions = [], options = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        return reconcileCodexAppServerThreads(sessions, options);
      });
    },

    async unsubscribeKnownAppServerThreads(sessions = []) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        return unsubscribeCodexAppServerThreadsForSessions(sessions);
      });
    },

    async interruptTurn(sessionId, input = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return interruptCodexAppServerTurn(sessionId, input);
      });
    },

    async sendMessage(sessionId, input = {}, options = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return sendCodexAppServerMessage(sessionId, input, options);
      });
    },

    async terminalState(sessionId) {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession(sessionId);
        const abandonedClaim = await recoverAbandonedCodexAppServerPromptClaim(
          runtime,
          await runtime.getSession(sessionId)
        );
        const session = await reconcileCodexAppServerActiveTurn(
          abandonedClaim.session
        );
        const contextTask = await writeCodexContextReplacementReady(runtime, session.sessionId);
        return {
          ok: true,
          sessionId,
          sessionUpdated: abandonedClaim.recovered || Boolean(contextTask),
          ...codexState(session)
        };
      });
    },

    async startTerminal(sessionId, input = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return startCodexAppServerTerminal(sessionId, input);
      });
    },

    async startGlobalTerminal() {
      return vibe64Result(async () => {
        return startGlobalCodexTerminalSession();
      });
    },

    async globalTerminalState() {
      return vibe64Result(async () => {
        const targetRoot = await globalCodexTargetRoot(projectService);
        const codexTerminal = activeGlobalCodexTerminal(targetRoot);
        return {
          codexTerminal,
          globalCodexTerminal: codexTerminal,
          ok: true
        };
      });
    },

    subscribeGlobalTerminal(terminalSessionId, subscriber) {
      return vibe64Result(async () => {
        const targetRoot = await globalCodexTargetRoot(projectService);
        const subscribed = subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: globalCodexTerminalNamespace()
        });
        const codexTerminal = activeGlobalCodexTerminal(targetRoot);
        return {
          ...subscribed,
          codexTerminal,
          globalCodexTerminal: codexTerminal
        };
      });
    },

    subscribeFixTerminal(jobId, terminalSessionId, subscriber) {
      return vibe64Result(async () => {
        return subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: fixCodexTerminalNamespace(jobId)
        });
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession(sessionId);
        const session = await runtime.getSession(sessionId);
        return withCodexState(subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: codexTerminalNamespace(sessionId),
          outputLimit: CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
        }), session);
      });
    },

    async uploadAttachment(sessionId, input = {}) {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession(sessionId);
        const session = await runtime.getSession(sessionId);
        const targetRoot = terminalTargetRoot(session, projectService);
        if (!targetRoot) {
          return {
            ok: false,
            error: "Vibe64 Codex target root is not available."
          };
        }
        return storeCodexAttachment({
          input,
          sessionId,
          targetRoot
        });
      });
    },

    async writeTerminal(sessionId, terminalSessionId, data, input = {}) {
      const actorResult = await recordCodexTerminalInputGitActor(sessionId, data, input);
      if (actorResult?.ok === false) {
        return actorResult;
      }
      return writeTerminalSessionText(terminalSessionId, data, {
        namespace: codexTerminalNamespace(sessionId)
      });
    },

    writeGlobalTerminal(terminalSessionId, data) {
      return writeTerminalSessionText(terminalSessionId, data, {
        namespace: globalCodexTerminalNamespace()
      });
    },

    writeFixTerminal(jobId, terminalSessionId, data) {
      return writeTerminalSessionText(terminalSessionId, data, {
        namespace: fixCodexTerminalNamespace(jobId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: codexTerminalNamespace(sessionId)
      });
    },

    resizeGlobalTerminal(terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: globalCodexTerminalNamespace()
      });
    },

    resizeFixTerminal(jobId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: fixCodexTerminalNamespace(jobId)
      });
    }
  });
}

export {
  codexAppTerminalOwnerMetadata,
  codexGitCommandShimDirs,
  codexRemoteEndpointForWorkdir,
  codexTerminalArgs,
  createCodexTerminalController
};
