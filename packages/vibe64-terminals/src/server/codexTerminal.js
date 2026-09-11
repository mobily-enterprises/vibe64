import crypto from "node:crypto";
import path from "node:path";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";

import {
  beginTerminalNamespaceOperation,
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  subscribeTerminalSession,
  terminalNamespaceAdmissionFailure,
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
  SESSION_CONTEXT_INSTALLED_ENV,
  composeVibe64SessionContext,
  withGenesisCommandShim
} from "@local/vibe64-genesis/server";
import {
  terminalAppOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_PROVIDER_ID,
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerRequestIsInvalid,
  codexAppServerRuntimeDir,
  createCodexAppServerAgentProvider,
  readCodexSelectedAccountAccess,
  stopCodexAppServerRuntime
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import {
  VIBE64_SESSION_STATUS,
  VIBE64_AGENT_RUN_STATE,
  normalizeVibe64AgentRunState,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal
} from "@local/vibe64-runtime/server/sessionStore";
import {
  assertCodexAppServerEconomyCompatibility,
  assertCodexAppServerEconomyOutputWithinLimit,
  codexAppServerProjectHookTrustConfig,
  codexAppServerThreadHasReadableHistory,
  codexAppServerThreadSettings,
  ensureCodexAppServerThreadForSession,
  resumeExactCodexAppServerThreadForSession,
  resumeCodexAppServerEconomyThread,
  sendCodexAppServerEconomyTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerEconomyThread,
  startFreshCodexAppServerThreadForSession
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_AGENT_TASK_RESULT_SCHEMA,
  VIBE64_AGENT_WORKSPACE_WRITE_POLICY,
  defineVibe64AgentExecutionProfileRequest,
  effectiveVibe64AgentExecutionSettings,
  effectiveVibe64AgentSettings,
  normalizeVibe64AgentTaskResult,
  vibe64AssistantSelectionFromMetadata,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
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
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import {
  markCodexReconnectRequired
} from "@local/vibe64-core/server/codexAuthState";
import {
  VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD
} from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  createPersonalAiProfileStore
} from "@local/vibe64-core/server/personalAiProfile";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  vibe64Result,
  codexTerminalNamespace,
  directoryExists,
  ensureTerminalSessionSourceGitSelfContained,
  globalCodexTerminalNamespace,
  terminalSessionSourceRoot,
  terminalWorktreePath
} from "./terminalShared.js";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  cleanupCodexAttachments,
  pinCodexAttachments,
  prepareCodexAttachmentRoot,
  releaseCodexSessionAttachments,
  renewCodexAttachments,
  storeCodexAttachment,
  unpinCodexAttachments
} from "./codexAttachments.js";
import {
  loadProjectExecutionEnv,
  executionEnvFingerprint
} from "./projectExecutionEnv.js";
import {
  createGitTurnCheckpoint,
  runVibe64Command,
  stableHash
} from "@local/vibe64-execution/server";
import {
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV
} from "./codexGitCommand.js";
import {
  recordSessionGitCommandActor,
  sessionGitCommandActorFromMetadata
} from "./sessionGitCommandActor.js";
import {
  CODEX_ECONOMY_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_ECONOMY_THREAD_LIFECYCLES,
  createCodexEconomyThreadLedger,
  defineCodexEconomyThreadRecord
} from "./codexEconomyThreadLedger.js";
import {
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV
} from "./agentEnvCommand.js";
import {
  prepareAgentSessionCommandEnvironment
} from "./agentCommandEnvironment.js";
import {
  agentTerminalIdentityForWorkdir,
  agentTerminalIdentityState
} from "./agentTerminalIdentity.js";
import { conversationActorMetadata } from "./conversationActor.js";
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
  codexAppServerNotificationUsageLimitExceeded,
  codexAppServerProviderThreadAssistantSegments,
  codexAppServerOutputOwnerTurnId,
  codexAppServerStatusFromValue,
  codexAppServerUserMessageText
} from "./codexAppServerEvents.js";
import {
  CODEX_TURN_OUTCOME,
  writeCodexTurnOutcomeNotice
} from "./codexTurnOutcomeNotice.js";
import {
  recordCodexContextRenewalSignal,
  recordCodexContextUsageSignal
} from "./codexContextRenewalSignals.js";
import {
  defineSessionRenewalApprovedHandover,
  defineSessionRenewalOperationId,
  defineSessionRenewalSourceEnvelope,
  parseSessionRenewalAcknowledgement,
  parseSessionRenewalHandoverOutput,
  sessionRenewalAcknowledgementOutputSchema,
  sessionRenewalClientMessageId,
  sessionRenewalHandoverPrompt,
  sessionRenewalSeedPrompt
} from "./sessionRenewalHandover.js";

const CODEX_AGENT_PROVIDER = "codex";
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_APP_SERVER_TASK_ID = "codex_app_server";
const CODEX_CONTEXT_TASK_ID = "codex_context";
const CODEX_TURN_CHECKPOINT_TASK_ID = "codex_turn_checkpoint";
const CODEX_SESSION_BRIEFING_FINGERPRINT_METADATA = "agent_briefing_fingerprint";
const CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER = "\u001f";
const CODEX_APP_SERVER_RESULT_PROCESSED_EVENT = "codex-app-server-result-processed";
const RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND =
  "vibe64.session_renewal_successor_process_exit_proof_release";
const CODEX_CONTEXT_REFRESH_PENDING_METADATA = Object.freeze([
  "codex_context_refresh_pending",
  "codex_context_refresh_pending_at",
  "codex_context_refresh_reason",
  "codex_context_refresh_thread_id",
  "codex_context_refresh_turn_id"
]);
const CODEX_STATE_METADATA_NAMES = Object.freeze([
  "agent_identity_captured_at",
  "agent_identity_conversation_id",
  "agent_identity_error",
  "agent_identity_provider",
  "agent_identity_resume_strategy",
  "agent_identity_status",
  "agent_identity_terminal_session_id",
  "agent_identity_workdir"
]);
const CODEX_APP_SERVER_AGENT_RUN_ID = CODEX_APP_SERVER_TASK_ID;
const CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE = "vibe64_session_worktree_unavailable";
const CODEX_ATTACHMENT_SESSION_UNAVAILABLE_CODE = "vibe64_agent_attachment_session_unavailable";
const CODEX_AGENT_TURN_ALREADY_RUNNING_CODE = "vibe64_agent_turn_already_running";
const CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE = "vibe64_codex_turn_interrupt_failed";
const CODEX_AGENT_TURN_STEER_FAILED_CODE = "vibe64_codex_turn_steer_failed";
const MAX_OPEN_CODEX_TERMINALS = 3;
const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_APP_SERVER_ACTIVE_RECONCILE_MS = 2000;
const CODEX_APP_SERVER_DAEMON_WELLBEING_MS = 15000;
const CODEX_APP_SERVER_FINALIZING_GRACE_MS = 10000;
const CODEX_APP_SERVER_PROMPT_CLAIM_GRACE_MS = 15000;
const CODEX_APP_SERVER_LIVE_PROGRESS_MAX_LENGTH = 320;
const CODEX_APP_SERVER_GOAL_STATUSES = new Set([
  "active",
  "blocked",
  "budgetLimited",
  "complete",
  "paused",
  "usageLimited"
]);
const CODEX_APP_SERVER_SNAPSHOT_RECOVERY_ITEM_LIMIT = 25;
const CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS = 180_000;
const CODEX_APP_SERVER_DETACHED_FAILURE_DETAIL_GRACE_MS = 500;
const CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS = 10 * 60_000;
const CODEX_APP_SERVER_EPHEMERAL_PROGRESS_LIMIT = 24;
const CODEX_APP_SERVER_MODEL_CATALOG_CACHE_MS = 30_000;
const CODEX_APP_SERVER_MODEL_CATALOG_TIMEOUT_MS = 30_000;
const CODEX_EPHEMERAL_DISABLED_FEATURES = Object.freeze([
  "apps",
  "artifact",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode",
  "code_mode_host",
  "computer_use",
  "default_mode_request_user_input",
  "deferred_executor",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "psp",
  "recommended_plugins",
  "request_permissions_tool",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "unified_exec_zsh_fork",
  "view_image"
]);
const CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS = 5_000;
const CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE =
  "Codex app-server finished this turn, but Vibe64 did not receive the assistant result text.";
const CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH = 4 * 1024 * 1024;
const CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS = new Set([
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV,
  "VIBE64_CODEX_GIT_COMMAND_SOCKET",
  "VIBE64_CODEX_GIT_COMMAND_TOKEN"
]);
function normalizeText(value) {
  return String(value || "").trim();
}

function codexAppServerModelCatalogDeadlineError(timeoutMs = 0) {
  const error = new Error("Codex model discovery exceeded the low-cost workload deadline.");
  error.code = "vibe64_codex_model_catalog_timeout";
  error.retryable = true;
  error.details = {
    retryable: true,
    timeoutMs
  };
  return error;
}

async function withCodexAppServerModelCatalogDeadline(operation, {
  signal = null,
  timeoutMs = CODEX_APP_SERVER_MODEL_CATALOG_TIMEOUT_MS
} = {}) {
  const boundedTimeoutMs = Number.isSafeInteger(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS)
    : CODEX_APP_SERVER_MODEL_CATALOG_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted === true) {
    abortFromCaller();
  } else {
    signal?.addEventListener?.("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(codexAppServerModelCatalogDeadlineError(boundedTimeoutMs));
  }, boundedTimeoutMs);
  const aborted = new Promise((resolve, reject) => {
    void resolve;
    const rejectAborted = () => {
      reject(timedOut
        ? codexAppServerModelCatalogDeadlineError(boundedTimeoutMs)
        : controller.signal.reason || new Error("Codex model discovery was cancelled."));
    };
    if (controller.signal.aborted) {
      rejectAborted();
      return;
    }
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      aborted
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortFromCaller);
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
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
  executionProfile = null,
  status = ""
} = {}) {
  const profile = isRecord(executionProfile) ? executionProfile : null;
  const settings = profile || effectiveVibe64AgentExecutionSettings(agentSettings);
  const terminalStatus = ["failed", "interrupted"].includes(normalizeText(status))
    ? normalizeText(status)
    : "";
  const requestDetails = [
    settings.model ? `model ${settings.model}` : "",
    settings.request?.reasoning !== false && settings.thinking
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
  const selection = vibe64AssistantSelectionFromMetadata(metadata, {
    required: false
  });
  if (selection?.engineId === VIBE64_ASSISTANT_ENGINE_IDS.CODEX) {
    return {
      model: selection.modelId,
      providerId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
      thinking: selection.variantId
    };
  }
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

function codexAttachmentSessionUnavailableError(session = {}) {
  const closingReason = sessionClosingReason(session);
  const error = new Error(closingReason
    ? `Session is ${closingReason}. Attachments cannot be added while it is closing.`
    : "This session is closing. Attachments cannot be added now.");
  error.code = CODEX_ATTACHMENT_SESSION_UNAVAILABLE_CODE;
  error.statusCode = 409;
  return error;
}

function codexAppServerAgentRun(session = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.find((run) => normalizeText(run?.id) === CODEX_APP_SERVER_AGENT_RUN_ID) || null;
}

function codexAppServerPendingUserMessageClientIds(run = {}) {
  const ids = run?.pendingUserMessageClientIds;
  return (Array.isArray(ids) ? ids : [])
    .map((id) => normalizeText(id))
    .filter(Boolean);
}

function codexAppServerPendingUserMessageOwnership(run = {}, clientId = "") {
  const pendingClientIds = codexAppServerPendingUserMessageClientIds(run);
  const normalizedClientId = normalizeText(clientId);
  const ownedClientId = normalizedClientId
    ? pendingClientIds.find((id) => id === normalizedClientId)
    : pendingClientIds[0];
  if (!ownedClientId) {
    return null;
  }
  return {
    clientId: ownedClientId,
    inputSource: normalizeText(run?.inputSource)
  };
}

function codexAppServerProcessedResultEvent(session = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const events = codexAppServerAgentRun(session)?.events;
  return (Array.isArray(events) ? events : []).findLast((event) => (
    normalizeText(event?.kind) === CODEX_APP_SERVER_RESULT_PROCESSED_EVENT &&
    normalizeText(event?.providerThreadId) === normalizedThreadId &&
    normalizeText(event?.providerTurnId) === normalizedTurnId
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
    goalStatus: normalizeText(run.providerGoalStatus),
    goalThreadId: normalizeText(run.providerGoalThreadId),
    inputSource: normalizeText(run.inputSource),
    outerTurnId: normalizeText(run.outerTurnId),
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

async function terminalSessionSourceRootForSession(projectService, sessionId) {
  try {
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    const session = await runtime.getSession(sessionId);
    return terminalSessionSourceRoot(session);
  } catch {
    return "";
  }
}

function renewalCleanupContext(sessionId = "", options = {}) {
  const renewalCleanup = options?.renewalCleanup;
  if (!renewalCleanup) {
    return null;
  }
  const normalizedSessionId = normalizeText(sessionId);
  const runtime = options.runtime;
  const session = options.session;
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const cleanupKind = normalizeText(renewalCleanup.kind);
  const renewalId = normalizeText(renewalCleanup.renewalId);
  const sourceSessionId = normalizeText(renewalCleanup.sourceSessionId);
  const status = normalizeText(session?.status);
  const successorIsExact = cleanupKind === "successor" &&
    status === VIBE64_SESSION_STATUS.RENEWAL_PENDING &&
    normalizeText(metadata.renewal_id) === renewalId &&
    normalizeText(metadata.renewed_from) === sourceSessionId &&
    Boolean(normalizeText(metadata.renewed_from));
  // renewal_restored_id belongs to a completed rollback, not the next
  // transition. Current quiescence or renewed_to still owns the predecessor.
  const predecessorIsExact = cleanupKind === "predecessor" &&
    sourceSessionId === normalizedSessionId &&
    (
      (
        status === VIBE64_SESSION_STATUS.ACTIVE &&
        !normalizeText(metadata.renewal_quiesced_id) &&
        !normalizeText(metadata.renewed_to)
      ) ||
      (
        status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
        normalizeText(metadata.renewal_quiesced_id) === renewalId
      )
    );
  if (
    !runtime ||
    normalizeText(session?.sessionId) !== normalizedSessionId ||
    !renewalId ||
    (!successorIsExact && !predecessorIsExact)
  ) {
    throw new TypeError("Renewal terminal cleanup requires its exact predecessor or successor and runtime.");
  }
  return {
    kind: cleanupKind,
    runtime,
    session
  };
}

function renewalArchivedPredecessorContext(sessionId = "", options = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const runtime = options.runtime;
  const session = options.session;
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const renewalId = normalizeText(options.renewalId);
  if (
    !runtime ||
    !renewalId ||
    normalizeText(session?.sessionId) !== normalizedSessionId ||
    session?.archived !== true ||
    normalizeText(session?.status) !== VIBE64_SESSION_STATUS.ARCHIVED ||
    normalizeText(metadata.renewal_id) !== renewalId ||
    !normalizeText(metadata.renewed_to)
  ) {
    throw new TypeError("Renewal maintenance requires its exact archived predecessor and runtime.");
  }
  return {
    renewalId,
    runtime,
    session
  };
}

function renewalSuccessorProcessExitProofReleaseContext(sessionId = "", options = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const runtime = options.runtime;
  const session = options.session;
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const renewalId = normalizeText(options.renewalId);
  const authorization = options.authorization && typeof options.authorization === "object"
    ? options.authorization
    : {};
  const authorizedAt = normalizeText(authorization.authorizedAt);
  const authorizedAtMs = Date.parse(authorizedAt);
  if (
    !runtime ||
    !renewalId ||
    normalizeText(session?.sessionId) !== normalizedSessionId ||
    normalizeText(session?.status) !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
    normalizeText(metadata.renewal_id) !== renewalId ||
    !normalizeText(metadata.renewed_from) ||
    normalizeText(authorization.kind) !== RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND ||
    Number(authorization.schemaVersion) !== 1 ||
    normalizeText(authorization.renewalId) !== renewalId ||
    normalizeText(authorization.sourceSessionId) !== normalizeText(metadata.renewed_from) ||
    normalizeText(authorization.successorSessionId) !== normalizedSessionId ||
    normalizeText(authorization.runtimeDir) !== normalizeText(metadata.agent_transport_runtime_dir) ||
    !Number.isFinite(authorizedAtMs) ||
    new Date(authorizedAtMs).toISOString() !== authorizedAt
  ) {
    throw new TypeError(
      "Renewal successor process-exit proof release requires its exact authorization, pending successor, and runtime."
    );
  }
  return {
    authorization,
    renewalId,
    runtime,
    session
  };
}

async function globalCodexRuntimeRoot(projectService = {}, runtime = null) {
  const serviceRoot = typeof projectService.currentProjectRuntimeRoot === "function"
    ? normalizeText(projectService.currentProjectRuntimeRoot())
    : "";
  if (serviceRoot) {
    return serviceRoot;
  }
  return normalizeText(runtime?.stateRoot);
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

function codexPromptInputFromRequest(input = {}) {
  if (typeof input === "string") {
    return normalizeText(input);
  }
  const terminalInput = normalizeText(input.terminalInput);
  if (terminalInput) {
    return terminalInput;
  }
  return codexAppServerMessageText(input);
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

function activeGlobalCodexTerminal(executionRoot = "") {
  const terminals = listTerminalSessions({
    namespace: globalCodexTerminalNamespace()
  })
    .filter((terminal) => terminal.status !== "exited")
    .filter((terminal) => !executionRoot || terminal.metadata?.executionRoot === executionRoot)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return codexTerminalStatus(terminals[0] || null);
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
    goalStatus: "",
    goalThreadId: "",
    outerTurnId: "",
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

function codexAppServerTurnOwnsActiveGoal(turn = {}, threadId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const goalThreadId = normalizeText(turn.goalThreadId);
  const inputSource = normalizeText(turn.inputSource);
  return normalizeText(turn.goalStatus) === "active" &&
    Boolean(normalizedThreadId) &&
    goalThreadId === normalizedThreadId &&
    Boolean(normalizeText(turn.outerTurnId)) &&
    Boolean(inputSource) &&
    inputSource !== "terminal";
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

function codexAppServerTurnCanAdoptSuccessor(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  return turn.active === true &&
    ["active", "finalizing"].includes(normalizeText(turn.state)) &&
    Boolean(normalizedThreadId) &&
    normalizedThreadId === currentThreadId &&
    Boolean(normalizedTurnId) &&
    Boolean(currentTurnId) &&
    normalizedTurnId !== currentTurnId;
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
  return Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [];
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

function abandonedCodexAppServerPromptClaim(session = {}, {
  nowMs = Date.now(),
  promptDeliveryActive = false
} = {}) {
  const run = codexAppServerAgentRun(session);
  if (!run) {
    return null;
  }
  const runUpdatedMs = dateValueMs(run.updatedAt || run.startedAt || run.at);
  const claimExpired = Boolean(
    runUpdatedMs &&
    nowMs - runUpdatedMs >= CODEX_APP_SERVER_PROMPT_CLAIM_GRACE_MS
  );
  return (
    (run.active === true || vibe64AgentRunStateIsActive(run.state)) &&
    normalizeText(run.state) === VIBE64_AGENT_RUN_STATE.STARTING &&
    !normalizeText(run.providerThreadId) &&
    !normalizeText(run.providerTurnId) &&
    promptDeliveryActive !== true &&
    (codexAppServerTaskFinishedAfterRun(session, run) || claimExpired)
  ) ? run : null;
}

async function recoverAbandonedCodexAppServerPromptClaim(runtime, session = {}, options = {}) {
  const run = abandonedCodexAppServerPromptClaim(session, options);
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

function codexAppServerAdmissionError(sessionId = "") {
  const failure = terminalNamespaceAdmissionFailure(
    codexTerminalNamespace(sessionId)
  );
  if (!failure) {
    return null;
  }
  const error = new Error(failure.error || "Codex admission is unavailable.");
  error.code = failure.code || "vibe64_session_renewal_quiesced";
  error.retryable = false;
  return error;
}

function codexAppServerFrozenThreadDeleteResponse(threadId = "") {
  return {
    deleted: false,
    ok: true,
    status: "notFound",
    threadId: normalizeText(threadId)
  };
}

function codexAppServerFrozenTurnInterruptResponse({
  threadId = "",
  turnId = ""
} = {}) {
  return {
    interrupted: false,
    ok: true,
    operationOutcome: "already_idle",
    status: "interrupted",
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

function codexAppServerThreadIsMissing(error = null, threadId = "") {
  const normalizedThreadId = normalizeText(threadId).toLowerCase();
  if (
    !normalizedThreadId ||
    !codexAppServerRequestIsInvalid(error, "thread/read")
  ) {
    return false;
  }
  // Codex also uses -32600 for unrelated invalid requests, so recovery must
  // match both the missing-thread wording and the exact durable thread id.
  const message = normalizeText(error?.message).toLowerCase();
  return [
    `thread not loaded: ${normalizedThreadId}`,
    `thread ${normalizedThreadId} not found`,
    `no rollout found for thread id ${normalizedThreadId}`
  ].includes(message);
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
  return normalizeText(input.message);
}

function codexAppServerMessageDisplayText(input = {}, fallback = "") {
  if (!isRecord(input)) {
    return normalizeText(fallback || input);
  }
  return normalizeText(input.displayMessage || input.message || fallback);
}

function sessionBriefingIsDelivered(session = {}) {
  return normalizeText(session.metadata?.agent_briefing_delivered) === "yes";
}

function codexSessionBriefingFingerprint(developerInstructions = "") {
  return stableHash(normalizeText(developerInstructions));
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
  return withGenesisCommandShim(
    wrapperDir && path.isAbsolute(wrapperDir) ? [path.resolve(wrapperDir)] : []
  );
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
    "--dangerously-bypass-hook-trust",
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
  codexEconomyThreadLedgerFactory = createCodexEconomyThreadLedger,
  composeSessionContext = composeVibe64SessionContext,
  codexToolHomeRequired = false,
  codexToolHomeSource = "",
  env = process.env,
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
  const studioRuntimeProfile = getStudioProjectContext().runtimeProfile || {};
  const localRuntime = studioRuntimeProfile.local === true ||
    ["local", "local-editor"].includes(normalizeText(studioRuntimeProfile.mode).toLowerCase());
  const personalProfileStore = localRuntime && normalizeText(codexAppServerProviderOptions.systemRoot)
    ? createPersonalAiProfileStore({
        systemRoot: codexAppServerProviderOptions.systemRoot
      })
    : null;

  const codexAppServerProviders = new Map();
  const codexAppServerProviderSessionKeys = new Map();
  const codexAppServerModelCatalogs = new WeakMap();
  const codexAppServerEconomyThreads = new Map();
  const codexAppServerEconomyProjectOperations = new Map();
  const codexAppServerEconomyThreadCleanups = new Map();
  const codexAppServerEconomyThreadLedgers = new Map();
  const codexAppServerEconomyThreadMutations = new Map();
  const codexAppServerEconomyTurnStarts = new Map();
  const codexAppServerEconomyThreadRestores = new Map();
  const codexAppServerEphemeralConversations = new Map();
  const codexAppServerSessionContexts = new Map();
  const codexAppServerSessionClosures = new Map();
  const codexAppServerRenewalSessionClosures = new WeakSet();
  const codexAppServerMessageDeliveries = new Map();
  const codexAppServerPendingUserMessages = new Map();
  const codexAppServerConversationTurnStarts = new Map();
  const codexAppServerEventSubscriptions = new Map();
  const codexAppServerManagedSessions = new Map();
  const codexAppServerWellbeingTimers = new Map();
  const codexAppServerOwnedRuntimes = new Map();
  const codexAppServerProviderLifecycleTasks = new Set();
  const codexAppServerRuntimeAcquisitions = new Set();
  const codexAppServerReconcileTasks = new Set();
  const codexAppServerCompletedTurns = new Set();
  const codexAppServerFinalizedTurns = new Set();
  const codexAppServerProcessedTurns = new Set();
  const codexAppServerActiveTimers = new Map();
  const codexAppServerFinalizingTimers = new Map();
  const codexAppServerResultFinalizations = new Map();
  const codexAppServerThreadReconciliations = new Map();
  let codexAppServerThreadReconcileGeneration = 0;
  const codexAppServerFinalAssistantResults = new Map();
  const codexAppServerPromptDeliveries = new Set();
  const codexAppServerReasoningTurns = new Map();
  const codexAppServerReasoningPersistQueues = new Map();
  const codexAppServerLiveProgressItems = new Set();
  const codexAppServerLiveProgressFingerprints = new Set();
  const codexAppServerAutomaticHookThreads = new Set();
  const codexAppServerMirroredTerminalItems = new Set();
  const codexAppServerNotificationTasks = new Map();
  let codexAppServerProviderLifecycle = Promise.resolve();
  let codexAppServerServerClosing = false;
  let codexAppServerShutdownPromise = null;

  function currentConversationActorMetadata(vibe64User = null) {
    return conversationActorMetadata({
      personalProfileStore,
      vibe64User
    });
  }

  function vibe64SessionContextInput(conversationKind = "main") {
    return {
      conversationKind,
      session: {
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedGit: Boolean(codexGitCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  function clearCodexAppServerSessionContexts(sessionId = "") {
    const prefix = `${normalizeText(sessionId)}\0`;
    for (const key of codexAppServerSessionContexts.keys()) {
      if (key.startsWith(prefix)) codexAppServerSessionContexts.delete(key);
    }
  }

  async function codexAppServerSessionInstructions(session = {}, {
    conversationKind = "main",
    workdir = ""
  } = {}) {
    const sessionId = normalizeText(session.sessionId || session.id);
    const projectRoot = normalizeText(workdir) || terminalWorktreePath(session);
    if (!sessionId || !projectRoot) {
      throw new Error("Codex session context requires a session and source worktree.");
    }
    if (codexContextRefreshPending(session)) {
      clearCodexAppServerSessionContexts(sessionId);
    }
    const key = [sessionId, conversationKind, projectRoot].join("\0");
    let pending = codexAppServerSessionContexts.get(key);
    if (!pending) {
      const input = vibe64SessionContextInput(conversationKind);
      pending = composeSessionContext({
        ...input,
        projectRoot
      });
      codexAppServerSessionContexts.set(key, pending);
      pending.catch(() => {
        if (codexAppServerSessionContexts.get(key) === pending) {
          codexAppServerSessionContexts.delete(key);
        }
      });
    }
    return pending;
  }

  function codexAppServerTurnResultWasProcessed(session = {}, threadId = "", turnId = "") {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      return false;
    }
    return codexAppServerProcessedTurns.has(codexAppServerResultFinalizationKey(
      session.sessionId,
      normalizedThreadId,
      normalizedTurnId
    )) || Boolean(codexAppServerProcessedResultEvent(session, normalizedThreadId, normalizedTurnId));
  }

  function codexAppServerTurnWasCompleted(session = {}, threadId = "", turnId = "") {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      return false;
    }
    return codexAppServerCompletedTurns.has(codexAppServerTurnKey(
      normalizedThreadId,
      normalizedTurnId
    )) || codexAppServerTurnResultWasProcessed(session, normalizedThreadId, normalizedTurnId);
  }

  function createRuntimeForSession() {
    return projectService.createRuntime({
      inspectSource: false
    });
  }

  // Provider notifications are a high-frequency stream. Creating a session
  // runtime here hydrates the persisted conversation history even
  // with inspectSource disabled; during an active turn that previously caused
  // repeated multi-megabyte reads and hundreds of MB of churn. Event handlers
  // must use this bounded store and reserve full runtimes for mutations.
  // Do not mask a regression with throttles or caches: keep the hot path bounded.
  function createStoreForSession(sessionId = "") {
    return projectService.createSessionStore({
      sessionId
    });
  }

  async function readCodexStateSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const store = await createStoreForSession(normalizedSessionId);
    const [
      sourceDescriptor,
      run,
      metadataEntries
    ] = await Promise.all([
      store.readSessionSourceDescriptor(normalizedSessionId),
      readCodexAppServerAgentRunForSession(store, normalizedSessionId),
      Promise.all(CODEX_STATE_METADATA_NAMES.map(async (name) => [
        name,
        await store.readMetadataValue(normalizedSessionId, name)
      ]))
    ]);
    return {
      ...sourceDescriptor,
      agentRuns: run ? [run] : [],
      metadata: {
        ...(sourceDescriptor?.metadata || {}),
        ...Object.fromEntries(metadataEntries)
      }
    };
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
      shimDirs: codexGitCommandShimDirs({ terminalEnv }),
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
    executionRoot = "",
    workdir = ""
  } = {}) {
    return runCommand({
      actor: "app",
      allowedRoots: [
        executionRoot,
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
        sourceRoot: executionRoot
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

  async function codexManagedCommandEnv({
    runtime = null,
    session = {},
    sessionId = ""
  } = {}) {
    if (!codexGitCommand || !normalizeText(sessionId)) {
      return {};
    }
    const project = typeof projectService?.readCurrentProject === "function"
      ? await projectService.readCurrentProject()
      : projectService?.selectedProject || {};
    const prepared = await prepareAgentSessionCommandEnvironment({
      agentDatabaseCommand,
      agentEnvCommand,
      agentPreviewCommand,
      agentSessionCommand,
      env,
      gitCommand: codexGitCommand,
      gitEnvironment: codexAttachmentEnv(),
      project,
      runtime,
      sessionId,
      worktreePath: terminalWorktreePath(session)
    });
    return prepared.env;
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
    target = "codex"
  } = {}) {
    const terminalEnvForSession = async (currentSession = session) => {
      const projectEnvStartedAt = Date.now();
      const projectEnvPromise = loadProjectExecutionEnv({
        prepare: true,
        projectService,
        runCommand,
        runtime,
        session: currentSession,
        target
      }).then((projectEnv) => {
        vibe64SessionDebugLog("server.codexTerminal.projectTerminalEnv.stage", {
          durationMs: Date.now() - projectEnvStartedAt,
          sessionId,
          stage: "project-env"
        });
        return projectEnv;
      });
      const managedCommandEnvStartedAt = Date.now();
      const managedCommandEnvPromise = codexManagedCommandEnv({
        runtime,
        session: currentSession,
        sessionId
      }).then((managedCommandEnv) => {
        vibe64SessionDebugLog("server.codexTerminal.projectTerminalEnv.stage", {
          durationMs: Date.now() - managedCommandEnvStartedAt,
          sessionId,
          stage: "managed-command-env"
        });
        return managedCommandEnv;
      });
      const [projectEnv, managedCommandEnv] = await Promise.all([
        projectEnvPromise,
        managedCommandEnvPromise
      ]);
      return {
        ...projectEnv,
        ...managedCommandEnv
      };
    };

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
      normalizeText(options.threadExecutionRoot || options.executionRoot),
      normalizeText(options.runtimeInstanceId),
      runtimeIdsHash,
      executionEnvFingerprint(codexAppServerProviderIdentityEnv(
        options.threadEnv || options.terminalEnv
      )),
      normalizeText(options.toolHomeSource),
      normalizeText(options.threadWorkdir || options.workdir),
      normalizeText(options.executionMode)
    ].join(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
  }

  function codexAppServerProviderKeyFields(providerKey = "") {
    const [
      sessionId = "",
      executionRoot = "",
      runtimeInstanceId = "",
      runtimesHash = "",
      envHash = "",
      toolHomeSource = "",
      workdir = "",
      executionMode = ""
    ] = normalizeText(providerKey).split(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
    return {
      envHash: normalizeText(envHash),
      executionMode: normalizeText(executionMode),
      runtimeInstanceId: normalizeText(runtimeInstanceId),
      runtimesHash: normalizeText(runtimesHash),
      sessionId: normalizeText(sessionId),
      executionRoot: normalizeText(executionRoot),
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

  function codexAppServerServerClosingError() {
    const error = new Error("The Vibe64 server is shutting down and cannot acquire Codex runtimes.");
    error.code = "vibe64_server_stopping";
    error.retryable = true;
    return error;
  }

  function assertCodexAppServerControllerOpen() {
    if (codexAppServerServerClosing) {
      throw codexAppServerServerClosingError();
    }
  }

  function withCodexAppServerProviderLifecycle(operation) {
    const run = codexAppServerProviderLifecycle.catch(() => null).then(operation);
    const tracked = run.catch(() => null).finally(() => {
      codexAppServerProviderLifecycleTasks.delete(tracked);
    });
    codexAppServerProviderLifecycle = tracked;
    codexAppServerProviderLifecycleTasks.add(tracked);
    return run;
  }

  function codexAppServerOwnedRuntimeKey(providerKey = "", providerOptions = {}) {
    const runtimeDir = normalizeText(providerOptions?.runtimeDir);
    return runtimeDir
      ? `runtime:${path.resolve(runtimeDir)}`
      : `provider:${normalizeText(providerKey)}`;
  }

  function rememberCodexAppServerOwnedRuntime({
    provider = null,
    providerKey = "",
    providerOptions = {}
  } = {}) {
    const runtimeKey = codexAppServerOwnedRuntimeKey(providerKey, providerOptions);
    const record = {
      provider,
      providerKey: normalizeText(providerKey),
      providerOptions,
      runtimeDir: normalizeText(providerOptions?.runtimeDir),
      runtimeKey
    };
    codexAppServerOwnedRuntimes.set(runtimeKey, record);
    return record;
  }

  function forgetCodexAppServerOwnedRuntime(provider = null) {
    for (const [runtimeKey, record] of codexAppServerOwnedRuntimes.entries()) {
      if (record.provider === provider) {
        codexAppServerOwnedRuntimes.delete(runtimeKey);
      }
    }
  }

  async function acquireCodexAppServerRuntime({
    operation,
    provider = null,
    providerKey = "",
    providerOptions = {}
  } = {}) {
    assertCodexAppServerControllerOpen();
    rememberCodexAppServerOwnedRuntime({
      provider,
      providerKey,
      providerOptions
    });
    const acquisition = Promise.resolve().then(operation);
    codexAppServerRuntimeAcquisitions.add(acquisition);
    try {
      const result = await acquisition;
      assertCodexAppServerControllerOpen();
      return result;
    } finally {
      codexAppServerRuntimeAcquisitions.delete(acquisition);
    }
  }

  async function codexAppServerProviderForSessionUnlocked(sessionId = "", options = {}) {
    assertCodexAppServerControllerOpen();
    const admissionError = codexAppServerAdmissionError(sessionId);
    if (admissionError) {
      throw admissionError;
    }
    const providerKey = codexAppServerProviderKey(sessionId, options);
    const existing = codexAppServerProviders.get(providerKey);
    if (existing) {
      return existing;
    }
    const nextFields = codexAppServerProviderKeyFields(providerKey);
    for (const currentKey of [...codexAppServerProviders.keys()]) {
      const currentFields = codexAppServerProviderKeyFields(currentKey);
      if (
        currentFields.sessionId === nextFields.sessionId &&
        currentFields.executionMode === nextFields.executionMode &&
        currentFields.executionRoot === nextFields.executionRoot &&
        currentFields.runtimeInstanceId === nextFields.runtimeInstanceId &&
        currentFields.workdir === nextFields.workdir
      ) {
        await retireAndCloseCodexAppServerProviderUnlocked(currentKey);
      }
    }
    const currentAdmissionError = codexAppServerAdmissionError(sessionId);
    if (currentAdmissionError) {
      throw currentAdmissionError;
    }
    assertCodexAppServerControllerOpen();
    const provider = codexAppServerProviderFactory(options);
    codexAppServerProviders.set(providerKey, provider);
    codexAppServerProviderSessionKeys.set(
      providerKey,
      codexTerminalNamespace(sessionId)
    );
    return provider;
  }

  function codexAppServerProviderForSession(sessionId = "", options = {}) {
    return withCodexAppServerProviderLifecycle(
      () => codexAppServerProviderForSessionUnlocked(sessionId, options)
    );
  }

  function codexAppServerProviderIsAvailableForSession(sessionId = "", options = {}) {
    const providerKey = codexAppServerProviderKey(sessionId, options);
    const provider = codexAppServerProviders.get(providerKey);
    return provider?.isAvailable?.() === true;
  }

  async function ensureCodexAppServerProviderForManagedThread(session = {}, {
    executionRoot = "",
    workdir = ""
  } = {}) {
    const normalizedSessionId = normalizeText(session.sessionId || session.id);
    const turn = codexAppServerTurnState(session);
    if (!normalizedSessionId || !turn.threadId) {
      return null;
    }
    const normalizedExecutionRoot = normalizeText(executionRoot) || terminalSessionSourceRoot(session);
    const normalizedWorkdir = normalizeText(workdir) || terminalWorktreePath(session);
    for (const [providerKey, managed] of codexAppServerManagedSessions.entries()) {
      const fields = codexAppServerProviderKeyFields(providerKey);
      if (
        fields.sessionId !== normalizedSessionId ||
        (normalizedExecutionRoot && fields.executionRoot !== normalizedExecutionRoot) ||
        (normalizedWorkdir && fields.workdir !== normalizedWorkdir) ||
        normalizeText(managed?.sessionId) !== normalizedSessionId ||
        normalizeText(managed?.threadId) !== turn.threadId
      ) {
        continue;
      }
      const provider = codexAppServerProviders.get(providerKey);
      if (provider) {
        return {
          provider: await ensureCodexAppServerDaemonForSession(
            normalizedSessionId,
            managed.providerOptions
          ),
          providerKey,
          providerOptions: managed.providerOptions
        };
      }
    }
    return null;
  }

  // Project Env is provider startup input. Once a turn is active, its managed
  // provider remains authoritative through steering, recovery, and completion;
  // an idle acquisition is the boundary that may adopt changed Env.
  async function ensureCodexAppServerProviderForActiveTurn(session = {}, options = {}) {
    if (!codexAppServerTurnState(session).active) {
      return null;
    }
    return ensureCodexAppServerProviderForManagedThread(session, options);
  }

  async function ensureCodexAppServerDaemonForSession(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const providerOptions = options;
    const provider = await codexAppServerProviderForSession(normalizedSessionId, providerOptions);
    const providerKey = codexAppServerProviderKey(normalizedSessionId, providerOptions);
    try {
      const admissionError = codexAppServerAdmissionError(normalizedSessionId);
      if (admissionError) {
        throw admissionError;
      }
      await acquireCodexAppServerRuntime({
        operation: () => {
          if (typeof provider.ensureAvailable === "function") {
            return provider.ensureAvailable();
          }
          if (typeof provider.listLoadedThreads === "function") {
            return provider.listLoadedThreads({
              limit: 1
            });
          }
          return provider.ensureRuntime?.();
        },
        provider,
        providerKey,
        providerOptions
      });
      return provider;
    } catch (error) {
      if (!codexAppServerServerClosing) {
        await stopCodexAppServerProviderForSession(normalizedSessionId, providerOptions);
      }
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
    runtimeDir = "",
    session = {},
    executionRoot = "",
    terminalEnv = {},
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    const runtimeContext = codexRuntimeForTerminalEnv({
      terminalEnv,
      toolHomeSource
    });
    const sharedRuntimeDir = normalizeText(runtimeDir) ||
      codexAppServerRuntimeDir(runtimeContext.providerOptions);
    const sessionId = normalizeText(session?.sessionId || session?.id);
    return {
      ...runtimeContext.providerOptions,
      economyWorkdir: path.join(
        sharedRuntimeDir,
        "economy-workspaces",
        stableHash(sessionId || normalizeText(workdir) || "unattributed")
      ),
      executionMode: "",
      executionRoot: "",
      project: {},
      runtimeDir: sharedRuntimeDir,
      runtimeInstanceId: "",
      session: {},
      terminalEnv: {},
      threadEnv: runtimeContext.terminalProcessEnv,
      threadExecutionRoot: normalizeText(executionRoot),
      threadWorkdir: normalizeText(workdir),
      toolHomeSource: runtimeContext.toolHomeSource,
      userKey: "",
      workdir: ""
    };
  }

  async function codexAppServerRuntimeOptionsForSession(session = {}, {
    runtime = null,
    runtimeDir = "",
    executionRoot = "",
    terminalEnv,
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    const metadata = session.metadata || {};
    const effectiveExecutionRoot = normalizeText(executionRoot) || terminalSessionSourceRoot(session);
    const effectiveWorkdir = normalizeText(workdir) || terminalWorktreePath(session);
    const effectiveRuntime = runtime || await createRuntimeForSession();
    const suppliedTerminalEnv = isRecord(terminalEnv);
    const baseTerminalEnv = suppliedTerminalEnv
      ? terminalEnv
      : await loadProjectExecutionEnv({
          projectService,
          runCommand,
          runtime: effectiveRuntime,
          session,
          target: "codex"
        });
    const effectiveTerminalEnv = suppliedTerminalEnv
      ? baseTerminalEnv
      : {
        ...baseTerminalEnv,
        ...await codexManagedCommandEnv({
          runtime: effectiveRuntime,
          session,
          sessionId: normalizeText(session.sessionId || session.id)
        })
      };
    const expectedRuntimeDir = codexAppServerRuntimeDir(codexAppServerProviderOptions);
    const metadataRuntimeDir = normalizeText(metadata.agent_transport_runtime_dir);
    const reusableMetadataRuntimeDir = metadataRuntimeDir && expectedRuntimeDir &&
      path.resolve(metadataRuntimeDir) === path.resolve(expectedRuntimeDir)
      ? metadataRuntimeDir
      : "";
    return codexAppServerRuntimeOptions({
      runtimeDir: normalizeText(runtimeDir) || reusableMetadataRuntimeDir || expectedRuntimeDir,
      session,
      executionRoot: effectiveExecutionRoot,
      terminalEnv: {
        ...effectiveTerminalEnv,
        [SESSION_CONTEXT_INSTALLED_ENV]: "1"
      },
      toolHomeSource,
      workdir: effectiveWorkdir
    });
  }

  async function codexAppServerEconomyRuntimeOptionsForSession(session = {}, options = {}) {
    // Resolve without provisioning, retaining the shared provider identity used
    // by interactive chat and durable helper-thread cleanup.
    return codexAppServerRuntimeOptionsForSession(session, options);
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
    const sessionKey = codexTerminalNamespace(normalizedSessionId);
    const timer = codexAppServerActiveTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      codexAppServerActiveTimers.delete(sessionKey);
    }
  }

  function scheduleCodexAppServerActiveRecovery(sessionId = "", delayMs = codexAppServerActiveReconcileMs) {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionKey = codexTerminalNamespace(normalizedSessionId);
    const projectContext = currentProjectRequestContext();
    if (!normalizedSessionId || codexAppServerActiveTimers.has(sessionKey)) {
      return;
    }
    const timer = setTimeout(() => {
      codexAppServerActiveTimers.delete(sessionKey);
      void runWithCodexAppServerProjectContext(
        projectContext,
        () => recoverCodexAppServerActiveTurn(normalizedSessionId)
      );
    }, delayMs);
    timer.unref?.();
    codexAppServerActiveTimers.set(sessionKey, timer);
  }

  function clearCodexAppServerFinalizingTimer(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerResultFinalizationKey(sessionId, threadId, turnId);
    const timer = codexAppServerFinalizingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      codexAppServerFinalizingTimers.delete(key);
    }
  }

  function clearCodexAppServerSessionRecoveryTimers(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    clearCodexAppServerActiveTimer(normalizedSessionId);
    const finalizingKeyPrefix = `${codexTerminalNamespace(normalizedSessionId)}:`;
    for (const [key, timer] of codexAppServerFinalizingTimers.entries()) {
      if (key.startsWith(finalizingKeyPrefix)) {
        clearTimeout(timer);
        codexAppServerFinalizingTimers.delete(key);
      }
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
    const key = codexAppServerResultFinalizationKey(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId
    );
    const projectContext = currentProjectRequestContext();
    const delayMs = codexAppServerFinalizingRemainingMs({
      completedAt,
      state: "finalizing",
      updatedAt
    });
    const timer = setTimeout(() => {
      codexAppServerFinalizingTimers.delete(key);
      void runWithCodexAppServerProjectContext(
        projectContext,
        () => recoverCodexAppServerFinalizingTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          { status }
        )
      );
    }, delayMs);
    timer.unref?.();
    codexAppServerFinalizingTimers.set(key, timer);
  }

  function codexAppServerThreadStatus(thread = {}) {
    if (isRecord(thread.observedTurn)) {
      const observedStatus = codexAppServerStatusFromValue(thread.observedTurn.status);
      if (observedStatus) {
        return observedStatus;
      }
    }
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
    const observedTurnId = normalizeText(thread.observedTurn?.id);
    if (observedTurnId) {
      return observedTurnId;
    }
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
        outcome: CODEX_TURN_OUTCOME.SERVICE_RESTART,
        status
      }
    );
  }

  async function reconcileCodexAppServerThreadStatus(sessionId = "", provider = null, threadId = "", {
    failUnconfirmedTrackedTurn = false,
    observeLatestTurn = false,
    requireTrackedTurn = false,
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const runtime = normalizedSessionId
      ? await createRuntimeForSession()
      : null;
    const session = runtime
      ? await runtime.getSession(normalizedSessionId)
      : {};
    const trackedTurn = codexAppServerTurnState(session);
    const trackedStartingTurn = trackedTurn.active && trackedTurn.state === "starting"
      ? trackedTurn
      : null;
    const trackedProviderTurn = ["active", "finalizing"].includes(trackedTurn.state) &&
      trackedTurn.active &&
      trackedTurn.threadId
      ? trackedTurn
      : null;
    const statusThreadId = normalizeText(trackedProviderTurn?.threadId) || normalizedThreadId;
    const shouldFailUnconfirmed = failUnconfirmedTrackedTurn && trackedProviderTurn;
    if (!normalizedSessionId || !normalizedThreadId) {
      return {
        ok: true,
        status: "notRead"
      };
    }
    if (requireTrackedTurn && !trackedProviderTurn) {
      return {
        ok: true,
        status: "notTracked"
      };
    }
    if (
      trackedProviderTurn?.state === "finalizing" &&
      codexAppServerTurnResultWasProcessed(
        session,
        trackedProviderTurn.threadId,
        trackedProviderTurn.turnId
      )
    ) {
      await finalizeCodexAppServerAssistantResult(
        normalizedSessionId,
        trackedProviderTurn.threadId,
        trackedProviderTurn.turnId,
        {
          status: trackedProviderTurn.status || "completed"
        }
      );
      return {
        ok: true,
        status: trackedProviderTurn.status || "completed",
        turnId: trackedProviderTurn.turnId
      };
    }

    if (shouldFailUnconfirmed && statusThreadId !== normalizedThreadId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.trackedThreadReplaced", {
        currentThreadId: normalizedThreadId,
        sessionId: normalizedSessionId,
        source: normalizeText(source),
        trackedThreadId: statusThreadId,
        trackedTurnId: trackedProviderTurn.turnId
      });
      return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
        reason: "thread_replaced"
      });
    }

    if (typeof provider?.readThreadStatus !== "function") {
      if (shouldFailUnconfirmed) {
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
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
      thread = await codexAppServerReadThreadStatus(provider, statusThreadId, {
        observeLatestTurn
      });
    } catch (error) {
      if (shouldFailUnconfirmed) {
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.readFailed", {
          error: vibe64SessionDebugError(error),
          sessionId: normalizedSessionId,
          source: normalizeText(source),
          threadId: statusThreadId,
          turnId: trackedProviderTurn.turnId
        });
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
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
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
          reason: "missing_status"
        });
      }
      return {
        ok: true,
        status: "unknown"
      };
    }
    // A STARTING run has durable Vibe64 ownership but no provider identity yet.
    // A thread snapshot may describe the predecessor (or an unrelated terminal
    // turn), so only the active-turn recovery path may bind it after matching
    // the provider's client message id.
    if (trackedStartingTurn) {
      return {
        ok: true,
        status,
        turnId
      };
    }
    if (
      trackedProviderTurn &&
      turnId &&
      codexAppServerTurnCanAdoptSuccessor(trackedProviderTurn, statusThreadId, turnId)
    ) {
      const adoption = await adoptCodexAppServerSuccessorTurn(normalizedSessionId, {
        previousTurnId: trackedProviderTurn.turnId,
        source: normalizeText(source) || "thread_status",
        status: "inProgress",
        threadId: statusThreadId,
        turnId
      });
      if (!adoption.processed && adoption.reason !== "already_current") {
        if (shouldFailUnconfirmed) {
          return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
            reason: "turn_mismatch"
          });
        }
        return {
          ok: true,
          reason: adoption.reason,
          status,
          turnId
        };
      }
    }
    if (codexAppServerTurnStatusIsActive(status)) {
      if (!turnId) {
        vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.activeWithoutTurn", {
          sessionId: normalizedSessionId,
          status,
          source: normalizeText(source),
          threadId: statusThreadId,
          trackedTurnId: trackedProviderTurn?.turnId || ""
        });
        return {
          ok: true,
          status
        };
      }
      await markCodexAppServerProviderTurnActive(normalizedSessionId, {
        source: normalizeText(source) || "thread_status",
        status,
        threadId: statusThreadId,
        turnId
      });
      await reconcileCodexAppServerObservedTurnItems(
        normalizedSessionId,
        statusThreadId,
        thread?.observedTurn
      );
      return {
        ok: true,
        status,
        turnId
      };
    }
    if (
      codexAppServerTurnStatusIsComplete(status) &&
      isRecord(thread?.observedTurn) &&
      turnId
    ) {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      if (!currentTurn.active && normalizeText(currentTurn.turnId) !== turnId) {
        await markCodexAppServerProviderTurnActive(normalizedSessionId, {
          inputSource: "terminal",
          source: normalizeText(source) || "thread_snapshot",
          status: "inProgress",
          threadId: statusThreadId,
          turnId
        });
      }
      const recoverableSession = await runtime.getSession(normalizedSessionId);
      if (codexAppServerTurnCanReceiveProviderCompletion(
        codexAppServerTurnState(recoverableSession),
        statusThreadId,
        turnId
      )) {
        await reconcileCodexAppServerObservedTurnItems(
          normalizedSessionId,
          statusThreadId,
          thread.observedTurn
        );
      }
    }
    const completedTurnId = turnId || normalizeText(trackedProviderTurn?.turnId);
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

  async function reconcileCodexAppServerLoadedThreadStatus(
    sessionId = "",
    provider = null,
    threadId = "",
    {
      observeLatestTurn = false
    } = {}
  ) {
    return reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
      observeLatestTurn,
      source: "loaded_thread"
    });
  }

  async function failOrphanedCodexAppServerPromptDelivery(runtime, session = {}, turn = {}) {
    const sessionId = normalizeText(session.sessionId);
    if (!sessionId) {
      return session;
    }
    const error = "Vibe64 restarted before Codex confirmed the message. Your message is safe; retry it.";
    const updatedAt = new Date().toISOString();
    const runPatch = codexAppServerAgentRunPatch({
      error,
      inputSource: turn.inputSource,
      runState: VIBE64_AGENT_RUN_STATE.FAILED,
      session,
      status: "delivery_failed",
      threadId: turn.threadId,
      turnId: turn.turnId,
      updatedAt
    });
    delete runPatch.pendingUserMessageClientIds;
    const updatedSession = await runtime.store.mutateSession(sessionId, async () => {
      await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: "codex-prompt-delivery-abandoned",
          message: error,
          state: VIBE64_AGENT_RUN_STATE.FAILED
        },
        patch: runPatch
      });
      return runtime.getSession(sessionId);
    });
    await publishSessionChanged(sessionId, {
      payload: codexAppServerAgentRunRealtimePayload(runPatch),
      reason: "codex-prompt-delivery-abandoned",
      session: updatedSession
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.orphaned", {
      sessionId,
      threadId: turn.threadId
    });
    return runtime.getSession(sessionId);
  }

  async function reconcileCodexAppServerActiveTurn(session = {}, {
    provider: suppliedProvider = null,
    runtime = null
  } = {}) {
    const sessionId = normalizeText(session.sessionId);
    const trackedTurn = codexAppServerTurnState(session);
    if (!sessionId || !trackedTurn.active || !trackedTurn.threadId || !sessionHasCodexAppServerRuntime(session)) {
      return session;
    }
    const activeProvider = suppliedProvider
      ? null
      : await ensureCodexAppServerProviderForActiveTurn(session);
    const provider = suppliedProvider || activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
      sessionId,
      await codexAppServerRuntimeOptionsForSession(session, {
        runtime
      })
    );
    if (typeof provider?.readThreadStatus !== "function") {
      if (trackedTurn.state === "finalizing") {
        await recoverCodexAppServerFinalizingTurn(
          sessionId,
          trackedTurn.threadId,
          trackedTurn.turnId,
          {
            status: trackedTurn.status || "completed"
          }
        );
        const runtime = await createRuntimeForSession();
        return runtime.getSession(sessionId);
      }
      return session;
    }
    const activeRuntime = runtime || await createRuntimeForSession();
    let currentSession = session;
    let currentTurn = trackedTurn;
    let thread = await codexAppServerReadThreadStatus(provider, trackedTurn.threadId);
    let status = codexAppServerThreadStatus(thread);
    let providerTurnId = codexAppServerThreadTurnId(thread);
    const promptDeliveryIsLocal = codexAppServerPromptDeliveries.has(
      codexTerminalNamespace(sessionId)
    );
    if (
      currentTurn.state === "starting" &&
      !currentTurn.turnId &&
      !promptDeliveryIsLocal
    ) {
      const ownership = codexAppServerPendingUserMessageOwnership(
        codexAppServerAgentRun(currentSession)
      );
      if (!ownership || typeof provider?.readThread !== "function") {
        return failOrphanedCodexAppServerPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      const providerThread = await provider.readThread(currentTurn.threadId);
      const ownedProviderTurn = codexAppServerProviderTurnForOperation(providerThread, {
        clientMessageId: ownership.clientId
      });
      if (!ownedProviderTurn) {
        return failOrphanedCodexAppServerPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      thread = {
        ...providerThread,
        observedTurn: ownedProviderTurn
      };
      status = codexAppServerThreadStatus(thread);
      providerTurnId = codexAppServerThreadTurnId(thread);
      if (!providerTurnId) {
        return failOrphanedCodexAppServerPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      await markCodexAppServerProviderTurnActive(sessionId, {
        inputSource: ownership.inputSource,
        source: "owned_prompt_recovery",
        status: codexAppServerTurnStatusIsActive(status) ? status : "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      await writeCodexAppServerUserMessageOwnership(
        activeRuntime.store,
        sessionId,
        ownership.clientId,
        {
          eventKind: "codex-app-server-user-message-consumed",
          owned: false
        }
      );
      currentSession = await activeRuntime.getSession(sessionId);
      currentTurn = codexAppServerTurnState(currentSession);
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.recovered", {
        clientMessageId: ownership.clientId,
        sessionId,
        status,
        threadId: currentTurn.threadId,
        turnId: currentTurn.turnId
      });
    }
    if (
      providerTurnId &&
      codexAppServerTurnCanAdoptSuccessor(currentTurn, currentTurn.threadId, providerTurnId)
    ) {
      const adoption = await adoptCodexAppServerSuccessorTurn(sessionId, {
        previousTurnId: currentTurn.turnId,
        source: "active_reconciliation",
        status: "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      currentSession = await activeRuntime.getSession(sessionId);
      currentTurn = codexAppServerTurnState(currentSession);
      if (!adoption.processed && adoption.reason !== "already_current") {
        if (currentTurn.state === "starting") {
          scheduleCodexAppServerActiveRecovery(sessionId);
        }
        return currentSession;
      }
    }
    if (currentTurn.state === "finalizing") {
      await recoverCodexAppServerFinalizingTurn(sessionId, currentTurn.threadId, currentTurn.turnId, {
        status: currentTurn.status || "completed"
      });
      return activeRuntime.getSession(sessionId);
    }
    if (currentTurn.state === "starting") {
      if (codexAppServerTurnStatusIsActive(status) && providerTurnId) {
        await markCodexAppServerProviderTurnActive(sessionId, {
          source: "active_reconciliation",
          status,
          threadId: currentTurn.threadId,
          turnId: providerTurnId
        });
        return activeRuntime.getSession(sessionId);
      }
      if (codexAppServerTurnStatusIsActive(status) || !status) {
        scheduleCodexAppServerActiveRecovery(sessionId);
        return currentSession;
      }
      if (!promptDeliveryIsLocal && (!providerTurnId || !codexAppServerTurnStatusIsComplete(status))) {
        return failOrphanedCodexAppServerPromptDelivery(activeRuntime, currentSession, currentTurn);
      }
      if (promptDeliveryIsLocal) {
        return currentSession;
      }
      await markCodexAppServerProviderTurnActive(sessionId, {
        source: "active_reconciliation",
        status: "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      currentSession = await activeRuntime.getSession(sessionId);
      currentTurn = codexAppServerTurnState(currentSession);
    }
    if (!status || codexAppServerTurnStatusIsActive(status)) {
      if (currentTurn.state === "starting") {
        scheduleCodexAppServerActiveRecovery(sessionId);
      }
      return currentSession;
    }
    if (!codexAppServerTurnStatusIsComplete(status)) {
      return currentSession;
    }
    const completedTurnId = providerTurnId || currentTurn.turnId;
    vibe64SessionDebugLog("server.codexTerminal.appServerTurn.reconcile.complete", {
      sessionId,
      status,
      threadId: currentTurn.threadId,
      turnId: completedTurnId
    });
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      await stopCodexAppServerTurnWithProviderFailure(sessionId, currentTurn.threadId, completedTurnId, {
        error: codexAppServerThreadError(thread),
        status,
        verifyInactive: false
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await completeCodexAppServerTurn(sessionId, currentTurn.threadId, completedTurnId, {
        status,
        verifyInactive: false
      });
    }
    return activeRuntime.getSession(sessionId);
  }

  async function codexAppServerRuntimeForVisibleTerminal(sessionId = "", threadId = "", options = {}) {
    if (!normalizeText(threadId)) {
      return null;
    }
    const runtime = options.runtime || await createRuntimeForSession();
    const session = options.session || await runtime.getSession(sessionId);
    const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session, options);
    const providerOptions = activeProvider?.providerOptions ||
      await codexAppServerRuntimeOptionsForSession(session, {
        ...options,
        runtime
      });
    const provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
      sessionId,
      providerOptions
    );
    await codexAppServerProjectHookTrustConfig(provider, options.workdir, {
      persist: true
    });
    const providerKey = activeProvider?.providerKey || codexAppServerProviderKey(
      sessionId,
      providerOptions
    );
    return acquireCodexAppServerRuntime({
      operation: () => provider.ensureRuntime(),
      provider,
      providerKey,
      providerOptions
    });
  }

  async function unsubscribeCodexAppServerThreadForSession(sessionId = "", {
    providerOptions: providedProviderOptions = undefined,
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
    const runtime = providedRuntime || await createRuntimeForSession();
    const session = providedSession || await runtime.getSession(normalizedSessionId);
    const providerOptions = providedProviderOptions === undefined
      ? await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        })
      : providedProviderOptions;
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
          try {
            await retireAndCloseCodexAppServerProviderForSession(
              sessionId,
              providerOptions
            );
          } catch (error) {
            failed.push({
              code: normalizeText(error?.code),
              error: errorMessage(error, "Vibe64 Codex app-server provider cleanup failed."),
              retryable: error?.retryable === true,
              sessionId
            });
          }
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
    if (!provider) {
      stopCodexAppServerWellbeing(normalizedProviderKey);
      codexAppServerManagedSessions.delete(normalizedProviderKey);
      codexAppServerProviderSessionKeys.delete(normalizedProviderKey);
      return;
    }
    if (codexAppServerEconomyThreadRecords({ provider }).length > 0) {
      throw new Error(
        "Codex provider cannot close while it still owns low-cost assistant threads."
      );
    }
    stopCodexAppServerWellbeing(normalizedProviderKey);
    codexAppServerManagedSessions.delete(normalizedProviderKey);
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
    codexAppServerProviderSessionKeys.delete(normalizedProviderKey);
  }

  async function retireAndCloseCodexAppServerProviderUnlocked(providerKey = "", options = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = codexAppServerProviders.get(normalizedProviderKey);
    if (provider) {
      assertCodexAppServerEconomyThreadsRetired(
        await retireCodexAppServerEconomyThreads({ provider })
      );
    }
    closeCodexAppServerProvider(normalizedProviderKey, options);
  }

  function retireAndCloseCodexAppServerProvider(providerKey = "", options = {}) {
    return withCodexAppServerProviderLifecycle(
      () => retireAndCloseCodexAppServerProviderUnlocked(providerKey, options)
    );
  }

  function codexAppServerProviderKeyToolHomeSource(providerKey = "") {
    return codexAppServerProviderKeyFields(providerKey).toolHomeSource;
  }

  function codexAppServerRuntimeStopWasVerified(result = {}) {
    return result?.stopped === true ||
      result?.processExitVerified === true ||
      result?.runtimeDirRemoved === true;
  }

  function codexAppServerRuntimeExitUnverifiedError(providerKey = "") {
    const error = new Error("Codex app-server process exit could not be verified.");
    error.code = "vibe64_codex_runtime_exit_unverified";
    error.providerKey = normalizeText(providerKey);
    error.retryable = true;
    return error;
  }

  async function stopOwnedCodexAppServerRuntime(record = {}, {
    cached = false,
    preserveProcessExitProof = false,
    requireVerifiedExit = true
  } = {}) {
    const provider = record.provider;
    const providerKey = normalizeText(record.providerKey);
    const retirement = Promise.resolve().then(async () => {
      assertCodexAppServerEconomyThreadsRetired(
        await retireCodexAppServerEconomyThreads({ provider })
      );
    });
    const runtimeStop = Promise.resolve().then(async () => {
      if (typeof provider?.stopRuntime !== "function") {
        throw new Error("Codex app-server provider must implement stopRuntime().");
      }
      const result = await provider.stopRuntime({
        preserveProcessExitProof
      });
      if (requireVerifiedExit && !codexAppServerRuntimeStopWasVerified(result)) {
        throw codexAppServerRuntimeExitUnverifiedError(providerKey);
      }
      return result;
    });
    const [retired, stopped] = await Promise.allSettled([
      retirement,
      runtimeStop
    ]);
    if (
      stopped.status === "fulfilled" &&
      codexAppServerRuntimeStopWasVerified(stopped.value)
    ) {
      forgetCodexAppServerOwnedRuntime(provider);
    } else {
      provider?.close?.();
    }
    if (retired.status === "fulfilled" && cached) {
      closeCodexAppServerProvider(providerKey, {
        closeProvider: stopped.status !== "fulfilled"
      });
    }
    const failures = [retired, stopped]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Codex app-server shutdown failed for provider "${providerKey}".`
      );
    }
    return {
      ...stopped.value,
      providerKey,
      stopped: codexAppServerRuntimeStopWasVerified(stopped.value)
    };
  }

  async function stopCachedCodexAppServerProviderUnlocked(providerKey = "", {
    preserveProcessExitProof = false,
    requireStopped = false
  } = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = codexAppServerProviders.get(normalizedProviderKey);
    if (!provider) {
      closeCodexAppServerProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        stopped: false
      };
    }
    assertCodexAppServerEconomyThreadsRetired(
      await retireCodexAppServerEconomyThreads({ provider })
    );
    const sharedProcessRetained = [...codexAppServerProviders.keys()]
      .some((key) => key !== normalizedProviderKey);
    if (sharedProcessRetained) {
      closeCodexAppServerProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        sessionDetached: true,
        sharedProcessRetained: true,
        stopped: false
      };
    }
    if (typeof provider.stopRuntime !== "function") {
      closeCodexAppServerProvider(normalizedProviderKey);
      throw new Error("Codex app-server provider must implement stopRuntime().");
    }
    let providerStoppedRuntime = false;
    try {
      const stoppedRuntime = await provider.stopRuntime({
        preserveProcessExitProof: preserveProcessExitProof || requireStopped
      });
      providerStoppedRuntime = codexAppServerRuntimeStopWasVerified(stoppedRuntime);
      if (requireStopped && !providerStoppedRuntime) {
        const error = new Error("Codex app-server process exit could not be verified.");
        error.code = "vibe64_session_renewal_process_exit_unverified";
        error.retryable = true;
        throw error;
      }
      if (providerStoppedRuntime) {
        forgetCodexAppServerOwnedRuntime(provider);
      }
      return {
        ...(stoppedRuntime && typeof stoppedRuntime === "object" ? stoppedRuntime : {}),
        providerKey: normalizedProviderKey,
        stopped: providerStoppedRuntime
      };
    } finally {
      closeCodexAppServerProvider(normalizedProviderKey, {
        closeProvider: !providerStoppedRuntime
      });
    }
  }

  function stopCachedCodexAppServerProvider(providerKey = "", options = {}) {
    return withCodexAppServerProviderLifecycle(
      () => stopCachedCodexAppServerProviderUnlocked(providerKey, options)
    );
  }

  async function stopCachedCodexAppServerProvidersForSession(sessionId = "", options = {}) {
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
    const sessionKey = codexTerminalNamespace(normalizedSessionId);
    const providerKeys = [...codexAppServerProviders.keys()]
      .filter((providerKey) => (
        codexAppServerProviderSessionKeys.get(providerKey) === sessionKey
      ));
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        results.push(await stopCachedCodexAppServerProvider(providerKey, options));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: errorMessage(error, "Vibe64 Codex app-server runtime close failed."),
          providerKey,
          retryable: error?.retryable === true
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
    const metadataExecutionRoot = normalizeText(fallbackOptions.executionRoot) ||
      terminalSessionSourceRoot(session) ||
      metadataSourcePath;
    return codexAppServerRuntimeOptions({
      ...fallbackOptions,
      runtimeDir,
      executionRoot: metadataExecutionRoot,
      workdir: metadataWorkdir
    });
  }

  async function stopPersistedCodexAppServerRuntimeForSession(session = {}, fallbackOptions = {}, {
    preserveProcessExitProof = false
  } = {}) {
    const runtimeOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session, fallbackOptions);
    if (!runtimeOptions) {
      return {
        stopped: false
      };
    }
    const result = await stopCodexAppServerRuntime({
      ...runtimeOptions,
      preserveProcessExitProof
    });
    return {
      ...result,
      runtimeDirExists: await directoryExists(runtimeOptions.runtimeDir),
      verifiedStopped: result?.stopped === true ||
        result?.processExitVerified === true ||
        result?.runtimeDirRemoved === true
    };
  }

  async function releaseRenewalProcessExitProof(session = {}) {
    const runtimeOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session);
    if (!runtimeOptions) {
      return {
        alreadyReleased: true,
        ok: true,
        released: true,
        runtimeRecorded: false
      };
    }
    const existed = await directoryExists(runtimeOptions.runtimeDir);
    if (!existed) {
      return {
        alreadyReleased: true,
        ok: true,
        released: true,
        runtimeDir: runtimeOptions.runtimeDir,
        runtimeRecorded: true
      };
    }
    const result = await stopPersistedCodexAppServerRuntimeForSession(
      session,
      runtimeOptions
    );
    if (result.runtimeDirExists) {
      const error = new Error("The verified Codex process-exit proof could not be released.");
      error.code = "vibe64_session_renewal_process_exit_proof_release_failed";
      error.retryable = true;
      error.details = result;
      throw error;
    }
    return {
      ...result,
      alreadyReleased: false,
      ok: true,
      released: true,
      runtimeDir: runtimeOptions.runtimeDir,
      runtimeRecorded: true
    };
  }

  async function invalidateCodexAppServerRuntimes({
    includeOwned = false,
    reason = "",
    requireVerifiedExit = false,
    stopOwnedRuntimes = false,
    toolHomeSource = ""
  } = {}) {
    const normalizedToolHomeSource = normalizeText(toolHomeSource);
    const ownedRecordsByProvider = new Map(
      [...codexAppServerOwnedRuntimes.values()].map((record) => [record.provider, record])
    );
    const targets = [...codexAppServerProviders.keys()]
      .filter((providerKey) => {
        return !normalizedToolHomeSource ||
          codexAppServerProviderKeyToolHomeSource(providerKey) === normalizedToolHomeSource;
      })
      .map((providerKey) => ({
        kind: "cached",
        provider: codexAppServerProviders.get(providerKey),
        providerKey,
        record: ownedRecordsByProvider.get(codexAppServerProviders.get(providerKey)) || null
      }));
    const targetedProviders = new Set(targets.map((target) => target.provider));
    if (includeOwned) {
      for (const record of codexAppServerOwnedRuntimes.values()) {
        if (targetedProviders.has(record.provider)) {
          continue;
        }
        const recordToolHomeSource = normalizeText(
          record.providerOptions?.toolHomeSource ||
          codexAppServerProviderKeyToolHomeSource(record.providerKey)
        );
        if (
          normalizedToolHomeSource &&
          recordToolHomeSource !== normalizedToolHomeSource
        ) {
          continue;
        }
        targets.push({
          kind: "owned",
          provider: record.provider,
          providerKey: record.providerKey,
          record
        });
        targetedProviders.add(record.provider);
      }
    }
    targets.sort((left, right) => Number(Boolean(left.record)) - Number(Boolean(right.record)));
    const failed = [];
    const results = [];
    for (const target of targets) {
      const fields = codexAppServerProviderKeyFields(target.providerKey);
      const preserveProcessExitProof = Boolean(
        fields.sessionId &&
        fields.executionMode !== CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
      );
      try {
        const result = stopOwnedRuntimes && target.record
          ? await stopOwnedCodexAppServerRuntime({
              ...(target.record || {}),
              provider: target.provider,
              providerKey: target.providerKey
            }, {
              cached: target.kind === "cached",
              preserveProcessExitProof,
              requireVerifiedExit
            })
          : await stopCachedCodexAppServerProvider(target.providerKey, {
              preserveProcessExitProof,
              requireStopped: stopOwnedRuntimes && target.record != null
            });
        if (
          requireVerifiedExit &&
          target.record &&
          !codexAppServerRuntimeStopWasVerified(result)
        ) {
          throw codexAppServerRuntimeExitUnverifiedError(target.providerKey);
        }
        results.push(result);
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: errorMessage(error, "Vibe64 Codex app-server runtime invalidation failed."),
          providerKey: target.providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.invalidate.done", {
      failedCount: failed.length,
      providerCount: targets.length,
      reason: normalizeText(reason),
      stopped,
      toolHomeSource: normalizedToolHomeSource
    });
    return {
      failed,
      ok: failed.length === 0,
      providerCount: targets.length,
      results,
      stopped
    };
  }

  function shutdownCodexAppServerRuntimes(input = {}) {
    beginCodexAppServerShutdown();
    if (!codexAppServerShutdownPromise) {
      codexAppServerShutdownPromise = (async () => {
        const invalidation = invalidateCodexAppServerRuntimes({
          ...input,
          includeOwned: true,
          reason: "server-shutdown",
          requireVerifiedExit: true,
          stopOwnedRuntimes: true
        });
        const drain = drainCodexAppServerControllerTasks();
        const [invalidated, drained] = await Promise.allSettled([
          invalidation,
          drain
        ]);
        if (drained.status === "rejected") {
          throw drained.reason;
        }
        const verified = await invalidateCodexAppServerRuntimes({
          ...input,
          includeOwned: true,
          reason: "server-shutdown",
          requireVerifiedExit: true,
          stopOwnedRuntimes: true
        });
        if (invalidated.status === "rejected") {
          throw invalidated.reason;
        }
        const initial = invalidated.value;
        const resultsByProvider = new Map([
          ...initial.results,
          ...verified.results
        ].map((result) => [normalizeText(result?.providerKey), result]));
        const results = [...resultsByProvider.values()];
        return {
          ...verified,
          providerCount: Math.max(initial.providerCount, verified.providerCount),
          results,
          stopped: results.filter((result) => result?.stopped === true).length
        };
      })();
    }
    return codexAppServerShutdownPromise;
  }

  async function stopCodexAppServerProvidersForProjectContext({
    preserveProcessExitProof = false,
    projectContextRoot = "",
    reason = "",
  } = {}) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    if (!normalizedProjectContextRoot) {
      return {
        failed: [],
        ok: true,
        projectContextRoot: normalizedProjectContextRoot,
        providerCount: 0,
        reason: normalizeText(reason),
        results: [],
        stopped: 0
      };
    }
    const economyProviders = new Set(
      codexAppServerEconomyThreadRecords({
        projectContextRoot: normalizedProjectContextRoot
      }).map((record) => record.provider)
    );
    const providerKeys = [...codexAppServerProviders.keys()]
      .filter((providerKey) => {
        const managed = codexAppServerManagedSessions.get(providerKey);
        return normalizeText(managed?.projectContext?.targetRoot) === normalizedProjectContextRoot ||
          economyProviders.has(codexAppServerProviders.get(providerKey));
      });
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        const fields = codexAppServerProviderKeyFields(providerKey);
        results.push(await stopCachedCodexAppServerProvider(providerKey, {
          preserveProcessExitProof: Boolean(
            preserveProcessExitProof &&
            fields.sessionId &&
            fields.executionMode !== CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
          )
        }));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: errorMessage(error, "Vibe64 Codex app-server runtime close failed."),
          providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeProject.done", {
      failedCount: failed.length,
      providerCount: providerKeys.length,
      projectContextRoot: normalizedProjectContextRoot,
      reason: normalizeText(reason),
      stopped
    });
    return {
      failed,
      ok: failed.length === 0,
      projectContextRoot: normalizedProjectContextRoot,
      providerCount: providerKeys.length,
      reason: normalizeText(reason),
      results,
      stopped
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

  function beginCodexAppServerShutdown() {
    if (codexAppServerServerClosing) {
      return;
    }
    codexAppServerServerClosing = true;
    codexAppServerThreadReconcileGeneration += 1;
    for (const providerKey of [...codexAppServerWellbeingTimers.keys()]) {
      stopCodexAppServerWellbeing(providerKey);
    }
  }

  async function drainCodexAppServerControllerTasks() {
    while (true) {
      const pending = new Set([
        ...codexAppServerConversationTurnStarts.values(),
        ...codexAppServerEconomyProjectOperations.values(),
        ...codexAppServerEconomyThreadCleanups.values(),
        ...codexAppServerEconomyThreadMutations.values(),
        ...codexAppServerEconomyThreadRestores.values(),
        ...codexAppServerEconomyTurnStarts.values(),
        ...codexAppServerMessageDeliveries.values(),
        ...codexAppServerReasoningPersistQueues.values(),
        ...codexAppServerResultFinalizations.values(),
        ...codexAppServerProviderLifecycleTasks,
        ...codexAppServerRuntimeAcquisitions,
        ...codexAppServerReconcileTasks,
        ...codexAppServerSessionClosures.values(),
        ...codexAppServerThreadReconciliations.values(),
        ...codexAppServerNotificationTasks.values()
      ]);
      if (pending.size === 0) {
        return;
      }
      await Promise.allSettled([...pending]);
    }
  }

  function runWithCodexAppServerProjectContext(projectContext = null, operation = async () => null) {
    if (projectContext?.targetRoot) {
      return runWithProjectRequestContext(projectContext, operation);
    }
    return operation();
  }

  function runCodexAppServerNotificationTask(context = {}, operation = async () => null) {
    if (codexAppServerServerClosing) {
      return;
    }
    const taskSessionId = normalizeText(context.sessionId);
    const taskSessionKey = normalizeText(context.sessionKey) ||
      codexTerminalNamespace(taskSessionId);
    const previous = codexAppServerNotificationTasks.get(taskSessionKey) || Promise.resolve();
    const task = previous
      .catch(() => null)
      .then(() => runWithCodexAppServerProjectContext(context.projectContext, operation))
      .catch((error) => {
        vibe64SessionDebugLog("server.codexTerminal.appServerNotification.error", {
          error: vibe64SessionDebugError(error),
          method: normalizeText(context.method),
          sessionId: normalizeText(context.sessionId),
          threadId: normalizeText(context.threadId),
          turnId: normalizeText(context.turnId)
        });
      });
    codexAppServerNotificationTasks.set(taskSessionKey, task);
    void task.finally(() => {
      if (codexAppServerNotificationTasks.get(taskSessionKey) === task) {
        codexAppServerNotificationTasks.delete(taskSessionKey);
      }
    });
  }

  async function drainCodexAppServerNotificationTasks(sessionId = "") {
    const taskSessionKey = codexTerminalNamespace(sessionId);
    while (true) {
      const task = codexAppServerNotificationTasks.get(taskSessionKey);
      if (!task) {
        return;
      }
      await task;
    }
  }

  function scheduleCodexAppServerWellbeing(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const managed = codexAppServerManagedSessions.get(normalizedProviderKey);
    if (!managed || codexAppServerServerClosing) {
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
          await maintainCodexAppServerManagedConnection(normalizedProviderKey);
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
          if (
            !codexAppServerServerClosing &&
            codexAppServerManagedSessions.has(normalizedProviderKey)
          ) {
            scheduleCodexAppServerWellbeing(normalizedProviderKey);
          }
        });
    }, codexAppServerDaemonWellbeingMs);
    timer.unref?.();
    codexAppServerWellbeingTimers.set(normalizedProviderKey, timer);
  }

  function rememberCodexAppServerManagedSession(providerKey = "", {
    providerOptions = {},
    sessionId = "",
    executionRoot = "",
    threadId = "",
    workdir = ""
  } = {}) {
    assertCodexAppServerControllerOpen();
    const normalizedProviderKey = normalizeText(providerKey);
    if (!normalizedProviderKey) {
      return;
    }
    codexAppServerManagedSessions.set(normalizedProviderKey, {
      projectContext: currentProjectRequestContext(),
      providerOptions,
      sessionId: normalizeText(sessionId),
      executionRoot: normalizeText(executionRoot),
      threadId: normalizeText(threadId),
      workdir: normalizeText(workdir)
    });
    scheduleCodexAppServerWellbeing(normalizedProviderKey);
  }

  async function maintainCodexAppServerManagedConnection(providerKey = "", {
    reconnect = true
  } = {}) {
    assertCodexAppServerControllerOpen();
    const normalizedProviderKey = normalizeText(providerKey);
    const managed = codexAppServerManagedSessions.get(normalizedProviderKey);
    const provider = codexAppServerProviders.get(normalizedProviderKey);
    const sessionId = normalizeText(managed?.sessionId);
    const threadId = normalizeText(managed?.threadId);
    if (!managed || !provider || !sessionId) {
      throw new Error("Codex app-server managed connection is incomplete.");
    }

    if (reconnect) {
      await acquireCodexAppServerRuntime({
        operation: () => provider.ensureAvailable?.(),
        provider,
        providerKey: normalizedProviderKey,
        providerOptions: managed.providerOptions || {}
      });
    }
    if (!threadId) {
      return {
        ok: true,
        status: "available"
      };
    }
    let providerThread;
    try {
      providerThread = await codexAppServerReadThreadStatus(provider, threadId);
    } catch (error) {
      if (reconnect || !codexAppServerThreadIsMissing(error, threadId)) {
        throw error;
      }
      providerThread = { status: "notLoaded" };
    }
    // A status request may outlive closure or renewal. Never attach its late
    // result to a removed/replaced session or reconnect a stopped provider.
    assertCodexAppServerControllerOpen();
    const admissionError = codexAppServerAdmissionError(sessionId);
    if (admissionError) {
      throw admissionError;
    }
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    if (
      sessionIsClosing(session) || session.status === VIBE64_SESSION_STATUS.ARCHIVED ||
      codexAppServerManagedSessions.get(normalizedProviderKey) !== managed ||
      codexAppServerProviders.get(normalizedProviderKey) !== provider ||
      codexThreadIdForWorkdir(session, managed.workdir) !== threadId
    ) {
      throw Object.assign(new Error("The assistant session changed while its connection was being checked."), {
        code: "vibe64_agent_session_changed",
        retryable: true
      });
    }
    const nativeStatus = codexAppServerThreadRawValue(providerThread).status;
    const subscriptionKey = codexAppServerEventSubscriptionKey(
      normalizedProviderKey,
      threadId
    );
    const subscriptionIsCurrent = codexAppServerEventSubscriptionIsCurrent(subscriptionKey, provider);
    if (!reconnect && (
      nativeStatus === "notLoaded" || nativeStatus?.type === "notLoaded" || !subscriptionIsCurrent
    )) {
      return { ok: true, requiresPreparation: true };
    }
    if (!subscriptionIsCurrent) {
      subscribeCodexAppServerEvents(
        sessionId,
        provider,
        threadId,
        managed.providerOptions || {}
      );
      await provider.resumeThread?.(threadId, {
        cwd: normalizeText(managed.workdir)
      });
      return reconcileCodexAppServerLoadedThreadStatus(
        sessionId,
        provider,
        threadId,
        {
          observeLatestTurn: true
        }
      );
    }

    const trackedTurn = codexAppServerTurnState(session);
    const providerStatus = codexAppServerThreadStatus(providerThread);
    const providerTurnId = codexAppServerThreadTurnId(providerThread);
    const providerIsActive = codexAppServerTurnStatusIsActive(providerStatus);
    const trackedIdentityMatches = (
      trackedTurn.threadId === threadId &&
      (!providerTurnId || trackedTurn.turnId === providerTurnId)
    );
    if (
      (providerIsActive && (
        !trackedTurn.active ||
        trackedTurn.state !== "active" ||
        !trackedIdentityMatches
      )) ||
      (!providerIsActive && trackedTurn.active)
    ) {
      return reconcileCodexAppServerThreadStatus(
        sessionId,
        provider,
        threadId,
        {
          observeLatestTurn: true,
          source: "wellbeing"
        }
      );
    }
    return {
      ok: true,
      status: "healthy",
      threadId
    };
  }

  async function pruneCodexAppServerManagedSessions({
    keepProviderKeys = new Set(),
    projectContextRoot = ""
  } = {}) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    if (!normalizedProjectContextRoot) {
      return;
    }
    for (const [providerKey, managed] of [...codexAppServerManagedSessions.entries()]) {
      if (keepProviderKeys.has(providerKey)) {
        continue;
      }
      if (normalizeText(managed.projectContext?.targetRoot) === normalizedProjectContextRoot) {
        await retireAndCloseCodexAppServerProvider(providerKey);
      }
    }
  }

  async function waitForOtherCodexAppServerThreadReconciliations({
    keepProviderKeys = new Set(),
    projectContextRoot = ""
  } = {}) {
    const pending = [...codexAppServerThreadReconciliations.entries()]
      .filter(([providerKey]) => !keepProviderKeys.has(providerKey));
    if (pending.length === 0) {
      return;
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.pruneWait.start", {
      pendingCount: pending.length,
      projectContextRoot: normalizeText(projectContextRoot)
    });
    await Promise.allSettled(pending.map(([, reconciliation]) => reconciliation));
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.pruneWait.done", {
      pendingCount: pending.length,
      projectContextRoot: normalizeText(projectContextRoot)
    });
  }

  async function retireAndCloseCodexAppServerProviderForSession(sessionId = "", options = null) {
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !normalizedSessionId ||
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      return;
    }
    await retireAndCloseCodexAppServerProvider(
      codexAppServerProviderKey(normalizedSessionId, options)
    );
  }

  async function stopCodexAppServerProviderForSession(sessionId = "", options = null, {
    preserveProcessExitProof = false,
    requireStopped = false
  } = {}) {
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
      if (codexAppServerProviders.size > 0) {
        return {
          providerKey,
          sessionDetached: true,
          sharedProcessRetained: true,
          stopped: false
        };
      }
      const stoppedRuntime = await stopCodexAppServerRuntime({
        ...options,
        preserveProcessExitProof
      });
      const stopped = codexAppServerRuntimeStopWasVerified(stoppedRuntime);
      if (requireStopped && !stopped) {
        throw codexAppServerRuntimeExitUnverifiedError(providerKey);
      }
      return {
        ...(isRecord(stoppedRuntime) ? stoppedRuntime : {}),
        providerKey,
        stopped
      };
    }
    return stopCachedCodexAppServerProvider(providerKey, {
      preserveProcessExitProof,
      requireStopped
    });
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
      codexTerminalNamespace(sessionId),
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
          phase,
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
      explicit: ["commentary", "progress", "status", "thinking"].includes(phase),
      phase,
      source: "item",
      text
    };
  }

  function codexAppServerLiveProgressText(notification = {}) {
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = normalizeText(candidate?.text);
    if (!text) {
      return "";
    }
    if (candidate?.phase === "commentary") {
      return text;
    }
    if (text.length > CODEX_APP_SERVER_LIVE_PROGRESS_MAX_LENGTH) {
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

  function codexAppServerLiveProgressFingerprintKey(
    sessionId = "",
    threadId = "",
    turnId = "",
    text = ""
  ) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return "";
    }
    return [
      normalizeText(sessionId),
      normalizeText(threadId),
      normalizeText(turnId) || "*",
      "live-progress-text",
      crypto.createHash("sha256").update(normalizedText).digest("hex")
    ].join(":");
  }

  function codexAppServerConversationMessageId(
    threadId = "",
    turnId = "",
    role = "",
    text = ""
  ) {
    const normalizedText = normalizeText(text);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedText || !normalizedThreadId) {
      return "";
    }
    const digest = crypto.createHash("sha256")
      .update([
        normalizedThreadId,
        normalizeText(turnId) || "*",
        normalizeText(role),
        normalizedText
      ].join("\u0000"))
      .digest("hex");
    return `codex-${digest}`;
  }

  function codexAppServerRunInputSource(run = {}) {
    return normalizeText(run?.inputSource);
  }

  async function readCodexAppServerAgentRunForSession(store, sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    if (typeof store?.readAgentRun !== "function") {
      throw new Error("Vibe64 session store does not support agent-run reads.");
    }
    return store.readAgentRun(
      normalizedSessionId,
      CODEX_APP_SERVER_AGENT_RUN_ID
    );
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
        messageId: codexAppServerConversationMessageId(
          record.threadId,
          record.turnId,
          "assistant",
          conversationText
        ),
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

    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const currentTurn = codexAppServerTurnState(session);
    const currentTurnId = normalizeText(currentTurn.turnId);
    const normalizedTurnId = codexAppServerOutputOwnerTurnId({
      notificationThreadId: normalizedThreadId,
      notificationTurnId: normalizeText(turnId) || codexAppServerNotificationTurnId(notification),
      trackedActive: currentTurn.active,
      trackedState: currentTurn.state,
      trackedThreadId: currentTurn.threadId,
      trackedTurnId: currentTurnId
    });
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
    const segment = {
      itemId: normalizedItemId,
      source: normalizedSource,
      text: assistantText
    };
    const segments = [segment];
    const bundledText = assistantText;
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
        reason: existing ? "updated" : "recorded"
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

  function recordCodexAppServerReasoningNotification(threadId = "", notification = {}, {
    turnId = ""
  } = {}) {
    const method = normalizeText(notification.method);
    if (method !== "item/reasoning/summaryPartAdded" && method !== "item/reasoning/summaryTextDelta") {
      return false;
    }
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId) || codexAppServerNotificationTurnId(notification);
    if (!normalizedThreadId) {
      return false;
    }
    const state = codexAppServerReasoningTurnState(normalizedThreadId, normalizedTurnId);
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

  async function recordCodexAppServerReasoningForSession(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const currentTurn = codexAppServerTurnState(session);
    const ownerTurnId = codexAppServerOutputOwnerTurnId({
      notificationThreadId: normalizedThreadId,
      notificationTurnId: codexAppServerNotificationTurnId(notification),
      trackedActive: currentTurn.active,
      trackedState: currentTurn.state,
      trackedThreadId: currentTurn.threadId,
      trackedTurnId: currentTurn.turnId
    });
    if (!recordCodexAppServerReasoningNotification(normalizedThreadId, notification, {
      turnId: ownerTurnId
    })) {
      return false;
    }
    await queueCodexAppServerReasoningPersist(
      normalizedSessionId,
      normalizedThreadId,
      ownerTurnId
    );
    return true;
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
    const store = await createStoreForSession(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    if (normalizeText(run?.inputSource) === "terminal") {
      return;
    }
    const turn = codexAppServerTurnStateFromAgentRun(run || {});
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
      const written = await store.writeConversationThinkingMessage(normalizedSessionId, {
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
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId) {
      return;
    }
    const markers = [
      `:${normalizedThreadId}:*:`,
      ...(normalizedTurnId ? [`:${normalizedThreadId}:${normalizedTurnId}:`] : [])
    ];
    for (const set of [
      codexAppServerLiveProgressItems,
      codexAppServerLiveProgressFingerprints,
      codexAppServerMirroredTerminalItems
    ]) {
      for (const key of set) {
        if (markers.some((marker) => key.includes(marker))) {
          set.delete(key);
        }
      }
    }
  }

  async function writeCodexAppServerLiveProgress(sessionId = "", threadId = "", notification = {}) {
    // Explicit commentary is user-facing progress. Reasoning and ambiguous
    // progress remain thinking; final answers are recorded separately.
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = codexAppServerLiveProgressText(notification);
    if (!normalizedSessionId || !normalizedThreadId || !text) {
      return null;
    }
    const store = await createStoreForSession(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    const turn = codexAppServerTurnStateFromAgentRun(run || {});
    if (!codexAppServerTurnCanReceiveProviderActivity(
      turn,
      normalizedThreadId,
      codexAppServerNotificationTurnId(notification)
    )) {
      return null;
    }
    const key = codexAppServerLiveProgressKey(normalizedSessionId, normalizedThreadId, notification);
    if (!key) {
      return null;
    }
    const fingerprintKey = codexAppServerLiveProgressFingerprintKey(
      normalizedSessionId,
      normalizedThreadId,
      codexAppServerNotificationTurnId(notification) || turn.turnId,
      text
    );
    if (
      codexAppServerLiveProgressItems.has(key) ||
      codexAppServerLiveProgressFingerprints.has(fingerprintKey)
    ) {
      return null;
    }
    codexAppServerLiveProgressItems.add(key);
    codexAppServerLiveProgressFingerprints.add(fingerprintKey);
    let written = null;
    try {
      const role = candidate.phase === "commentary" ? "commentary" : "thinking";
      const writer = role === "commentary"
        ? store.writeConversationCommentaryMessage
        : store.writeConversationThinkingMessage;
      written = await writer.call(store, normalizedSessionId, {
        messageId: codexAppServerConversationMessageId(
          normalizedThreadId,
          codexAppServerNotificationTurnId(notification) || turn.turnId,
          role,
          text
        ),
        requireOpenTurn: false,
        text
      });
      if (!written) {
        codexAppServerLiveProgressItems.delete(key);
        codexAppServerLiveProgressFingerprints.delete(fingerprintKey);
        return null;
      }
      await publishSessionChanged(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason: role === "commentary"
          ? "codex-app-server-commentary"
          : "codex-app-server-live-progress"
      });
      return written;
    } catch (error) {
      if (!written) {
        codexAppServerLiveProgressItems.delete(key);
        codexAppServerLiveProgressFingerprints.delete(fingerprintKey);
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
      const store = await createStoreForSession(sessionId);
      const writer = normalizedRole === "user"
        ? store?.writeConversationUserMessage
        : store?.writeConversationAssistantMessage;
      if (typeof writer !== "function") {
        codexAppServerMirroredTerminalItems.delete(key);
        return null;
      }
      let turnMetadata = null;
      if (normalizedRole === "user" && typeof store.readConversationLog === "function") {
        const turns = await store.readConversationLog(normalizedSessionId);
        turnMetadata = [...turns].reverse().find((turn) => (
          turn?.user && turn?.metadata
        ))?.metadata || null;
      }
      written = await writer.call(store, normalizedSessionId, {
        messageId: codexAppServerConversationMessageId(
          threadId,
          codexAppServerNotificationTurnId(notification),
          normalizedRole,
          normalizedText
        ),
        text: normalizedText,
        ...(turnMetadata ? { turnMetadata } : {})
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

  async function writeCodexAppServerContextRefreshPending(store, sessionId = "", {
    reason = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId || typeof store?.writeMetadataValue !== "function") {
      return null;
    }
    clearCodexAppServerSessionContexts(normalizedSessionId);
    const at = new Date().toISOString();
    await store.mutateSession(normalizedSessionId, async () => {
      await Promise.all([
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_pending", "yes"),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_pending_at", at),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_reason", reason),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_thread_id", threadId),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_turn_id", turnId)
      ]);
    });
    return {
      at,
      reason,
      threadId,
      turnId
    };
  }

  async function clearCodexAppServerContextRefreshPending(store, sessionId = "", {
    deliveredAt = new Date().toISOString(),
    delivery = "prompt",
    reason = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId || !store) {
      return false;
    }
    await store.mutateSession(normalizedSessionId, async () => {
      await Promise.all([
        ...(typeof store.deleteMetadataValues === "function"
          ? [store.deleteMetadataValues(normalizedSessionId, CODEX_CONTEXT_REFRESH_PENDING_METADATA)]
          : CODEX_CONTEXT_REFRESH_PENDING_METADATA.map((name) => store.deleteMetadataValue?.(normalizedSessionId, name))),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_at", deliveredAt),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivery", delivery),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_reason", reason),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_thread_id", threadId),
        store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_turn_id", turnId)
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

    const store = await createStoreForSession(normalizedSessionId);
    const [
      run,
      briefingDelivered,
      currentThreadId
    ] = await Promise.all([
      readCodexAppServerAgentRunForSession(store, normalizedSessionId),
      store.readMetadataValue(normalizedSessionId, "agent_briefing_delivered"),
      store.readMetadataValue(normalizedSessionId, "agent_identity_conversation_id")
    ]);
    if (normalizeText(briefingDelivered) !== "yes") {
      return null;
    }
    const normalizedCurrentThreadId = normalizeText(currentThreadId);
    if (normalizedCurrentThreadId && normalizedCurrentThreadId !== normalizedThreadId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerContextRefresh.staleThread", {
        currentThreadId: normalizedCurrentThreadId,
        reason,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId
      });
      return null;
    }

    const turn = codexAppServerTurnStateFromAgentRun(run || {});
    const turnId = normalizeText(codexAppServerNotificationTurnId(notification) || turn.turnId);
    await recordCodexContextRenewalSignal(store, normalizedSessionId, {
      eventId: normalizeText(
        codexAppServerNotificationItemId(notification) ||
        codexAppServerNotificationEvent(notification)?.id
      ),
      reason,
      threadId: normalizedThreadId,
      turnId
    });
    const pending = await writeCodexAppServerContextRefreshPending(store, normalizedSessionId, {
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

  async function writeCodexAppServerUserMessageOwnership(store, sessionId = "", clientId = "", {
    eventKind = "codex-app-server-user-message-ownership-updated",
    owned = false
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedClientId = normalizeText(clientId);
    if (!normalizedSessionId || !normalizedClientId) {
      return false;
    }
    let wasOwned = false;
    await store.mutateSession(normalizedSessionId, async () => {
      const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
      const currentIds = codexAppServerPendingUserMessageClientIds(run);
      wasOwned = currentIds.indexOf(normalizedClientId) >= 0;
      if (wasOwned === owned) {
        return;
      }
      const pendingUserMessageClientIds = owned
        ? [...currentIds, normalizedClientId]
        : currentIds.filter((id) => id !== normalizedClientId);
      await store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
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
    const store = await createStoreForSession(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    const ownership = codexAppServerPendingUserMessageOwnership(run, clientId);
    if (ownership) {
      // The provider's user-message receipt precedes its answer notifications.
      // Persist the authored message here so answers cannot overtake it while
      // the original HTTP request is still finishing startup bookkeeping.
      const pendingMessage = codexAppServerPendingUserMessages.get(
        `${codexTerminalNamespace(normalizedSessionId)}\0${ownership.clientId}`
      );
      if (pendingMessage) {
        await writeCodexAppServerDeliveredUserMessage(
          { store },
          normalizedSessionId,
          pendingMessage.text,
          ownership.clientId,
          await currentConversationActorMetadata(pendingMessage.vibe64User),
          pendingMessage.attachments
        );
      }
      const turn = codexAppServerTurnStateFromAgentRun(run || {});
      const providerTurnId = codexAppServerNotificationTurnId(notification);
      const providerTurnAlreadyTracked = normalizeText(turn.state) === "active" &&
        (!normalizedThreadId || normalizeText(turn.threadId) === normalizedThreadId) &&
        (!providerTurnId || normalizeText(turn.turnId) === providerTurnId);
      if (!providerTurnAlreadyTracked) {
        await markCodexAppServerProviderTurnActive(normalizedSessionId, {
          inputSource: ownership.inputSource,
          status: "inProgress",
          threadId: normalizedThreadId,
          turnId: providerTurnId
        });
      }
      await writeCodexAppServerUserMessageOwnership(
        store,
        normalizedSessionId,
        ownership.clientId,
        {
          eventKind: "codex-app-server-user-message-consumed",
          owned: false
        }
      );
      if (providerTurnId) {
        pendingMessage?.receipt.resolve({ id: providerTurnId });
      }
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
    const store = await createStoreForSession(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    if (normalizeText(run?.inputSource) !== "terminal") {
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

  function codexAppServerSnapshotCursor(run = {}) {
    const cursor = run?.providerSnapshotCursor;
    if (!isRecord(cursor)) {
      return {
        itemId: "",
        turnId: ""
      };
    }
    return {
      itemId: normalizeText(cursor.itemId),
      turnId: normalizeText(cursor.turnId)
    };
  }

  async function recordCodexAppServerSnapshotCursor(store, sessionId = "", {
    itemId = "",
    turnId = ""
  } = {}) {
    const normalizedItemId = normalizeText(itemId);
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedItemId || !normalizedSessionId || !normalizedTurnId) {
      return;
    }
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    const current = codexAppServerSnapshotCursor(run);
    if (current.itemId === normalizedItemId && current.turnId === normalizedTurnId) {
      return;
    }
    await store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "codex-app-server-thread-snapshot-observed",
        message: "",
        providerThreadId: codexAppServerTurnStateFromAgentRun(run || {}).threadId,
        providerTurnId: normalizedTurnId
      },
      patch: {
        providerSnapshotCursor: {
          itemId: normalizedItemId,
          turnId: normalizedTurnId
        }
      }
    });
  }

  async function reconcileCodexAppServerObservedTurnItems(
    sessionId = "",
    threadId = "",
    observedTurn = null
  ) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(observedTurn?.id);
    const items = (Array.isArray(observedTurn?.items) ? observedTurn.items : [])
      .filter((item) => isRecord(item) && normalizeText(item.id));
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId || !items.length) {
      return;
    }
    const store = await createStoreForSession(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    if (codexAppServerRunInputSource(run) !== "terminal") {
      return;
    }
    const cursor = codexAppServerSnapshotCursor(run);
    const cursorIndex = cursor.turnId === normalizedTurnId
      ? items.findIndex((item) => normalizeText(item.id) === cursor.itemId)
      : -1;
    const unseenItems = cursorIndex >= 0
      ? items.slice(cursorIndex + 1)
      : items.slice(-CODEX_APP_SERVER_SNAPSHOT_RECOVERY_ITEM_LIMIT);
    for (const item of unseenItems) {
      if (!codexAppServerAssistantItemText(item)) {
        continue;
      }
      const notification = {
        method: "item/completed",
        params: {
          item,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        }
      };
      await writeCodexAppServerLiveProgress(
        normalizedSessionId,
        normalizedThreadId,
        notification
      );
      await mirrorCodexAppServerTerminalAssistantMessage(
        normalizedSessionId,
        normalizedThreadId,
        notification
      );
    }
    await recordCodexAppServerSnapshotCursor(store, normalizedSessionId, {
      itemId: normalizeText(items.at(-1)?.id),
      turnId: normalizedTurnId
    });
  }

  async function codexAppServerReadThreadStatus(provider = null, threadId = "", {
    observeLatestTurn = false
  } = {}) {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    if (typeof provider?.readThreadStatus === "function") {
      const thread = await provider.readThreadStatus(normalizedThreadId);
      if (!observeLatestTurn || typeof provider?.listThreadTurns !== "function") {
        return thread;
      }
      const response = await provider.listThreadTurns(normalizedThreadId, {
        itemsView: "summary",
        limit: 1,
        sortDirection: "desc"
      });
      const observedTurn = Array.isArray(response?.data) ? response.data[0] : null;
      return isRecord(observedTurn)
        ? {
            ...thread,
            observedTurn
          }
        : thread;
    }
    return null;
  }

  async function codexAppServerProviderBlocksTurnRelease(sessionId = "", provider = null, threadId = "", turnId = "", {
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return false;
    }
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!turn.active || !codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, normalizedTurnId)) {
      return false;
    }
    try {
      const providerThread = await codexAppServerReadThreadStatus(provider, normalizedThreadId, {
        observeLatestTurn: true
      });
      if (!providerThread) {
        return false;
      }
      const status = codexAppServerThreadStatus(providerThread);
      const providerTurnId = codexAppServerThreadTurnId(providerThread);
      if (
        providerTurnId &&
        providerTurnId !== normalizeText(turn.turnId)
      ) {
        vibe64SessionDebugLog("server.codexTerminal.appServerTurn.releaseAllowedSuccessor", {
          providerTurnId,
          sessionId: normalizedSessionId,
          source: normalizeText(source),
          threadId: normalizedThreadId,
          turnId: turn.turnId
        });
        return false;
      }
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

  async function recoverCodexAppServerAssistantSegmentsFromProvider(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return [];
    }
    try {
      const runtime = await createRuntimeForSession();
      const session = await runtime.getSession(normalizedSessionId);
      if (!sessionHasCodexAppServerRuntime(session)) {
        return [];
      }
      const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session);
      const provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
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
      const runtime = await createRuntimeForSession();
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
      return {
        ok: true,
        processed: true,
        reason: "assistant_response"
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
    inputSource = "",
    outerTurnId = "",
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
      updatedAt: normalizeText(updatedAt)
    };
    const normalizedInputSource = normalizeText(inputSource);
    if (normalizedInputSource) {
      patch.inputSource = normalizedInputSource;
    }
    const normalizedOuterTurnId = normalizeText(outerTurnId) ||
      normalizeText(codexAppServerAgentRun(session)?.outerTurnId);
    if (normalizedOuterTurnId) {
      patch.outerTurnId = normalizedOuterTurnId;
    }
    if (
      normalizedRunState === VIBE64_AGENT_RUN_STATE.STARTING ||
      vibe64AgentRunStateIsTerminal(normalizedRunState) ||
      normalizedInputSource === "terminal"
    ) {
      patch.pendingUserMessageClientIds = [];
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
      outerTurnId: normalizeText(runPatch.outerTurnId),
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
        outerTurnId: turn.outerTurnId,
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
          outerTurnId: turn.outerTurnId,
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

  async function claimCodexAppServerTurnStart(runtime, sessionId = "", outerTurnId = "", {
    inputSource = "chat"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedOuterTurnId = normalizeText(outerTurnId) ||
      `vibe64:${crypto.randomUUID()}`;
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
      if (currentTurn.active) {
        claimResult = {
          claimed: false,
          response: codexAppServerTurnAlreadyRunningResponse(currentSession),
          session: currentSession
        };
        return claimResult;
      }
      const updatedAt = new Date().toISOString();
      const runPatch = codexAppServerAgentRunPatch({
        inputSource: normalizeText(inputSource) || "chat",
        outerTurnId: normalizedOuterTurnId,
        runState: VIBE64_AGENT_RUN_STATE.STARTING,
        session: currentSession,
        status: "starting",
        updatedAt
      });
      runPatch.providerGoalStatus = "";
      runPatch.providerGoalThreadId = "";
      runPatch.providerGoalUpdatedAt = "";
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
    const runtime = await createRuntimeForSession();
    let runPatch = null;
    let wrote = false;
    let stale = null;
    const updatedSession = await runtime.store.mutateSession(normalizedSessionId, async () => {
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
      if (
        vibe64AgentRunStateIsActive(runPatch.state) &&
        currentTurn.threadId === normalizeText(runPatch.providerThreadId) &&
        currentTurn.turnId === normalizeText(runPatch.providerTurnId) &&
        currentTurn.startedAt
      ) {
        runPatch.startedAt = currentTurn.startedAt;
      }
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
        return currentSession;
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
      return runtime.getSession(normalizedSessionId);
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
      reason: publishReason || "codex-app-server-turn-state",
      session: updatedSession
    });
    return {
      ok: true
    };
  }

  async function markCodexAppServerTurnActive(sessionId = "", input = {}) {
    if (input.requireTrackedTurn === true) {
      const runtime = await createRuntimeForSession();
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
    if (status === "starting") {
      scheduleCodexAppServerActiveRecovery(sessionId);
    } else {
      clearCodexAppServerActiveTimer(sessionId);
    }
    return result;
  }

  async function adoptCodexAppServerSuccessorTurn(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(input.threadId);
    const normalizedTurnId = normalizeText(input.turnId);
    const expectedPreviousTurnId = normalizeText(input.previousTurnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId || !expectedPreviousTurnId) {
      return {
        ok: true,
        processed: false,
        reason: "missing_successor_identity"
      };
    }
    const runtime = await createRuntimeForSession();
    let continuesOwnedGoal = false;
    let previousTurnId = "";
    let runPatch = null;
    let outcome = {
      ok: true,
      processed: false,
      reason: "turn_changed"
    };
    const updatedSession = await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = codexAppServerTurnState(currentSession);
      if (
        normalizeText(currentTurn.threadId) === normalizedThreadId &&
        normalizeText(currentTurn.turnId) === normalizedTurnId
      ) {
        outcome = {
          ok: true,
          processed: false,
          reason: "already_current"
        };
        return currentSession;
      }
      if (codexAppServerTurnWasCompleted(currentSession, normalizedThreadId, normalizedTurnId)) {
        outcome = {
          ok: true,
          processed: false,
          reason: "completed_turn"
        };
        return currentSession;
      }
      if (
        normalizeText(currentTurn.turnId) !== expectedPreviousTurnId ||
        !codexAppServerTurnCanAdoptSuccessor(currentTurn, normalizedThreadId, normalizedTurnId)
      ) {
        outcome = {
          ok: true,
          processed: false,
          reason: "turn_changed"
        };
        return currentSession;
      }
      continuesOwnedGoal = codexAppServerTurnOwnsActiveGoal(currentTurn, normalizedThreadId);
      previousTurnId = normalizeText(currentTurn.turnId);
      const updatedAt = new Date().toISOString();
      runPatch = codexAppServerAgentRunPatch({
        runState: VIBE64_AGENT_RUN_STATE.ACTIVE,
        session: currentSession,
        status: normalizeText(input.status) || "inProgress",
        threadId: normalizedThreadId,
        turnId: normalizedTurnId,
        updatedAt
      });
      const currentInputSource = codexAppServerRunInputSource(codexAppServerAgentRun(currentSession));
      if (currentInputSource) {
        runPatch.inputSource = currentInputSource;
      }
      runPatch.finishedAt = "";
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: "codex-app-server-turn-continued",
          message: "",
          previousProviderTurnId: previousTurnId,
          providerThreadId: normalizedThreadId,
          providerTurnId: normalizedTurnId,
          source: normalizeText(input.source),
          state: runPatch.state
        },
        patch: runPatch
      });
      outcome = {
        ok: true,
        previousTurnId,
        processed: true,
        reason: "successor_turn_adopted",
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      };
      return runtime.getSession(normalizedSessionId);
    });
    if (!outcome.processed) {
      return outcome;
    }

    clearCodexAppServerFinalizingTimer(
      normalizedSessionId,
      normalizedThreadId,
      previousTurnId
    );
    codexAppServerCompletedTurns.add(codexAppServerTurnKey(
      normalizedThreadId,
      previousTurnId
    ));
    const previousResultKey = codexAppServerResultFinalizationKey(
      normalizedSessionId,
      normalizedThreadId,
      previousTurnId
    );
    codexAppServerProcessedTurns.delete(previousResultKey);
    codexAppServerFinalizedTurns.add(previousResultKey);
    try {
      await flushCodexAppServerReasoningPersist(
        normalizedSessionId,
        normalizedThreadId,
        previousTurnId
      );
      const previousAssistantResult = readCodexAppServerFinalAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        previousTurnId
      );
      // A provider-turn final inside an active goal is an internal checkpoint.
      // The final provider turn is promoted when the outer goal stops being active.
      if (previousAssistantResult?.text && !continuesOwnedGoal) {
        await persistCodexAppServerAssistantResponseBundle(
          runtime,
          normalizedSessionId,
          previousAssistantResult
        );
      }
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.continuedOutput.error", {
        error: vibe64SessionDebugError(error),
        previousTurnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, previousTurnId);
    await publishSessionChanged(normalizedSessionId, {
      payload: codexAppServerAgentRunRealtimePayload(runPatch),
      reason: "codex-app-server-turn-active",
      session: updatedSession
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerTurn.continued", {
      previousTurnId,
      sessionId: normalizedSessionId,
      source: normalizeText(input.source),
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    clearCodexAppServerActiveTimer(normalizedSessionId);
    return outcome;
  }

  async function markCodexAppServerProviderTurnActive(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(input.threadId);
    const normalizedTurnId = normalizeText(input.turnId);
    const requestedStatus = normalizeText(input.status) || "inProgress";
    const store = await createStoreForSession(normalizedSessionId);
    const persistedRun = await readCodexAppServerAgentRunForSession(
      store,
      normalizedSessionId
    );
    const persistedTurn = codexAppServerTurnStateFromAgentRun(persistedRun || {});
    const requestedInputSource = normalizeText(input.inputSource);
    if (
      persistedTurn.active &&
      persistedTurn.state === "active" &&
      persistedTurn.threadId === normalizedThreadId &&
      persistedTurn.turnId === normalizedTurnId &&
      codexAppServerTurnStatusIsActive(requestedStatus) &&
      (!requestedInputSource || requestedInputSource === persistedTurn.inputSource)
    ) {
      clearCodexAppServerActiveTimer(normalizedSessionId);
      return {
        ok: true,
        processed: false,
        reason: "already_active"
      };
    }
    const runtime = await createRuntimeForSession();
    let session = await runtime.getSession(normalizedSessionId);
    let turn = codexAppServerTurnState(session);
    if (codexAppServerTurnWasCompleted(session, normalizedThreadId, normalizedTurnId)) {
      vibe64SessionDebugLog("server.codexTerminal.appServerProviderTurn.completed.ignored", {
        currentState: turn.state,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "completed_turn"
      };
    }
    if (
      turn.state === "finalizing" &&
      codexAppServerTurnCanAdoptSuccessor(turn, normalizedThreadId, normalizedTurnId) &&
      codexAppServerTurnResultWasProcessed(session, normalizedThreadId, turn.turnId)
    ) {
      await finalizeCodexAppServerAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        turn.turnId,
        {
          status: turn.status || "completed"
        }
      );
      session = await runtime.getSession(normalizedSessionId);
      turn = codexAppServerTurnState(session);
    }
    const currentRun = codexAppServerAgentRun(session);
    const pendingInputSource = codexAppServerPendingUserMessageClientIds(currentRun).length > 0
      ? codexAppServerRunInputSource(currentRun)
      : "";
    const goalInputSource = codexAppServerTurnOwnsActiveGoal(turn, normalizedThreadId)
      ? codexAppServerRunInputSource(currentRun)
      : "";
    const inputSource = normalizeText(input.inputSource) || pendingInputSource || goalInputSource;
    if (codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, normalizedTurnId)) {
      return markCodexAppServerTurnActive(normalizedSessionId, {
        inputSource,
        status: requestedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    if (codexAppServerTurnCanAdoptSuccessor(turn, normalizedThreadId, normalizedTurnId)) {
      return adoptCodexAppServerSuccessorTurn(normalizedSessionId, {
        previousTurnId: turn.turnId,
        source: normalizeText(input.source) || "provider_activity",
        status: requestedStatus,
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
      inputSource: inputSource || "terminal",
      status: requestedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
  }

  async function markCodexAppServerTurnFinalizing(sessionId = "", input = {}) {
    const result = await writeCodexAppServerAgentRun(sessionId, {
      error: normalizeText(input.error),
      publishReason: "codex-app-server-turn-finalizing",
      runState: VIBE64_AGENT_RUN_STATE.FINALIZING,
      status: normalizeText(input.status) || "completed",
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    clearCodexAppServerActiveTimer(sessionId);
    return result;
  }

  function checkpointOutcomeForCodexTurn(status = "", turnOutcome = "") {
    const normalizedTurnOutcome = normalizeText(turnOutcome);
    if (normalizedTurnOutcome === CODEX_TURN_OUTCOME.USER_CANCELLED) {
      return "cancelled";
    }
    if (normalizedTurnOutcome === CODEX_TURN_OUTCOME.SERVICE_RESTART) {
      return "interrupted";
    }
    if (normalizedTurnOutcome === CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE) {
      return "failed";
    }
    const normalizedStatus = normalizeText(status);
    if (normalizedStatus === "interrupted") {
      return "interrupted";
    }
    if (normalizedStatus === "completed") {
      return "completed";
    }
    return "failed";
  }

  async function checkpointCodexAppServerTurn(sessionId = "", {
    status = "completed",
    turnOutcome = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    const outerTurnId = normalizeText(turn.outerTurnId);
    if (!outerTurnId || normalizeText(turn.inputSource) === "terminal") {
      return {
        ok: true,
        processed: false,
        reason: "outer_turn_unavailable"
      };
    }
    const worktreePath = terminalWorktreePath(session);
    const outcome = checkpointOutcomeForCodexTurn(status, turnOutcome);
    const timestamp = normalizeText(turn.completedAt || turn.updatedAt);
    try {
      const project = typeof projectService?.readCurrentProject === "function"
        ? await projectService.readCurrentProject()
        : projectService?.selectedProject || {};
      const checkpoint = await createGitTurnCheckpoint({
        outerTurnId,
        outcome,
        project,
        sessionId: normalizedSessionId,
        timestamp,
        worktreePath
      });
      const task = await runtime.store.writeBackgroundTaskEvent(
        normalizedSessionId,
        CODEX_TURN_CHECKPOINT_TASK_ID,
        {
          event: {
            kind: checkpoint.created ? "checkpoint-created" : "checkpoint-confirmed",
            message: ""
          },
          patch: {
            checkpointCommit: checkpoint.commit,
            checkpointOutcome: outcome,
            checkpointTurnId: outerTurnId,
            error: "",
            status: "ready"
          },
          shouldWrite({ previous }) {
            return normalizeText(previous.checkpointCommit) !== checkpoint.commit ||
              normalizeText(previous.checkpointTurnId) !== outerTurnId ||
              normalizeText(previous.status) !== "ready";
          }
        }
      );
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-turn-checkpoint-updated",
        session: await runtime.getSession(normalizedSessionId)
      });
      return {
        checkpoint,
        ok: true,
        processed: true,
        task
      };
    } catch (error) {
      const checkpointError = errorMessage(error, "Vibe64 could not create a recoverable turn checkpoint.");
      const task = await runtime.store.writeBackgroundTaskEvent(
        normalizedSessionId,
        CODEX_TURN_CHECKPOINT_TASK_ID,
        {
          event: {
            kind: "checkpoint-failed",
            message: checkpointError
          },
          patch: {
            checkpointOutcome: outcome,
            checkpointTurnId: outerTurnId,
            error: checkpointError,
            status: "failed"
          },
          shouldWrite({ previous }) {
            return normalizeText(previous.checkpointTurnId) !== outerTurnId ||
              normalizeText(previous.error) !== checkpointError ||
              normalizeText(previous.status) !== "failed";
          }
        }
      );
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-turn-checkpoint-failed",
        session: await runtime.getSession(normalizedSessionId)
      });
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.checkpoint.error", {
        error: vibe64SessionDebugError(error),
        outerTurnId,
        sessionId: normalizedSessionId
      });
      return {
        error: checkpointError,
        ok: false,
        processed: true,
        task
      };
    }
  }

  async function markCodexAppServerTurnIdle(sessionId = "", input = {}) {
    const status = normalizeText(input.status) || "completed";
    const result = await writeCodexAppServerAgentRun(sessionId, {
      error: normalizeText(input.error),
      publishPayload: VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD,
      publishReason: "codex-app-server-turn-idle",
      runState: terminalCodexAppServerAgentRunState(status),
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    clearCodexAppServerActiveTimer(sessionId);
    clearCodexAppServerFinalizingTimer(sessionId, input.threadId, input.turnId);
    if (result?.processed === false) {
      return result;
    }
    return {
      ...result,
      checkpoint: await checkpointCodexAppServerTurn(sessionId, {
        status,
        turnOutcome: normalizeText(input.turnOutcome)
      })
    };
  }

  async function currentCodexAppServerTurnId(sessionId = "", threadId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId) {
      return "";
    }
    const runtime = await createRuntimeForSession();
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

  async function recordCodexAppServerProcessedResult(runtime, sessionId = "", threadId = "", turnId = "", result = {}) {
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: CODEX_APP_SERVER_RESULT_PROCESSED_EVENT,
        providerThreadId: normalizeText(threadId),
        providerTurnId: normalizeText(turnId),
        resultReason: normalizeText(result.reason)
      },
      patch: {}
    });
  }

  async function settleCodexAppServerProcessedTurn(sessionId = "", threadId = "", turnId = "", {
    result = {
      ok: true,
      processed: true,
      reason: "already_processed"
    },
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerProcessedTurns.delete(key);
      codexAppServerFinalizedTurns.add(key);
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.processedSettlementStale", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ...result,
        reason: "stale_turn_state"
      };
    }
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      status,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    codexAppServerProcessedTurns.delete(key);
    codexAppServerFinalizedTurns.add(key);
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
    return result;
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
    if (codexAppServerProcessedTurns.has(key)) {
      return settleCodexAppServerProcessedTurn(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          status
        }
      );
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
      const runtime = await createRuntimeForSession();
      const session = await runtime.getSession(normalizedSessionId);
      const turn = codexAppServerTurnState(session);
      const processedEvent = codexAppServerProcessedResultEvent(
        session,
        normalizedThreadId,
        normalizedTurnId
      );
      if (processedEvent) {
        codexAppServerProcessedTurns.add(key);
        return settleCodexAppServerProcessedTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            result: {
              ok: true,
              processed: true,
              reason: normalizeText(processedEvent.resultReason) || "already_processed"
            },
            status
          }
        );
      }
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
        codexAppServerProcessedTurns.add(key);
        await recordCodexAppServerProcessedResult(
          runtime,
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          result
        );
        return settleCodexAppServerProcessedTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            result,
            status
          }
        );
      }
      return result;
    })().finally(() => {
      codexAppServerResultFinalizations.delete(key);
    });
    codexAppServerResultFinalizations.set(key, operation);
    return operation;
  }

  async function recoverCodexAppServerFinalResponseBeforeOutcome(
    sessionId = "",
    threadId = "",
    turnId = "",
    status = ""
  ) {
    const result = await finalizeCodexAppServerAssistantResult(
      sessionId,
      threadId,
      turnId,
      {
        recoverFromProvider: true,
        status
      }
    );
    if (result?.processed !== true) {
      return result;
    }
    if (result.reason !== "already_finalized") {
      return result;
    }
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(sessionId);
    return codexAppServerTurnResultWasProcessed(session, threadId, turnId)
      ? result
      : {
          ...result,
          processed: false,
          reason: "already_finalized_without_response"
        };
  }

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

  async function recoverCodexAppServerFinalizingTurn(sessionId = "", threadId = "", turnId = "", {
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session);
    if (codexAppServerTurnOwnsActiveGoal(turn, normalizedThreadId)) {
      clearCodexAppServerFinalizingTimer(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      );
      return {
        ok: true,
        processed: false,
        reason: "goal_continuation_pending"
      };
    }
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

  async function recoverCodexAppServerActiveTurn(sessionId = "", {
    provider = null,
    retryOnError = true,
    runtime: suppliedRuntime = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    try {
      const runtime = suppliedRuntime || await createRuntimeForSession();
      const storedSession = await runtime.getSession(normalizedSessionId);
      const abandonedClaim = await recoverAbandonedCodexAppServerPromptClaim(
        runtime,
        storedSession,
        {
          promptDeliveryActive: codexAppServerPromptDeliveries.has(
            codexTerminalNamespace(normalizedSessionId)
          )
        }
      );
      const session = abandonedClaim.session;
      if (abandonedClaim.recovered) {
        return session;
      }
      const turn = codexAppServerTurnState(session);
      if (!["active", "starting"].includes(turn.state) || !turn.threadId) {
        return session;
      }
      const reconciledSession = await reconcileCodexAppServerActiveTurn(session, {
        provider,
        runtime
      });
      const currentTurn = codexAppServerTurnState(reconciledSession);
      if (currentTurn.state === "starting" && currentTurn.threadId) {
        scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      }
      return reconciledSession;
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerTurn.reconcile.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId
      });
      if (!retryOnError) {
        throw error;
      }
      const store = await createStoreForSession(normalizedSessionId).catch(() => null);
      const run = store
        ? await readCodexAppServerAgentRunForSession(store, normalizedSessionId).catch(() => null)
        : null;
      if (codexAppServerTurnStateFromAgentRun(run || {}).state === "starting") {
        scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      }
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
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    const existingTurn = codexAppServerTurnState(session);
    const continuesOwnedGoal = codexAppServerTurnOwnsActiveGoal(
      existingTurn,
      normalizedThreadId
    );
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
      if (verifyInactive && await codexAppServerProviderBlocksTurnRelease(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
        source: "complete_missing_turn"
      })) {
        return {
          ok: true,
          processed: false,
          reason: "provider_still_active",
          status: "inProgress"
        };
      }
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
    if (!codexAppServerTurnCanReceiveProviderCompletion(existingTurn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerFinalizedTurns.add(codexAppServerResultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      ));
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
    if (verifyInactive && await codexAppServerProviderBlocksTurnRelease(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
      source: "complete"
    })) {
      return {
        ok: true,
        processed: false,
        reason: "provider_still_active",
        status: "inProgress"
      };
    }
    if (codexAppServerRunInputSource(codexAppServerAgentRun(session)) === "terminal") {
      codexAppServerCompletedTurns.add(codexAppServerTurnKey(normalizedThreadId, normalizedTurnId));
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
    if (continuesOwnedGoal) {
      // Keep the outer Vibe64 turn active so the next provider turn can adopt
      // its chat ownership without exposing this internal final as an answer.
      clearCodexAppServerFinalizingTimer(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      );
      return {
        ok: true,
        processed: true,
        reason: "goal_continuation_pending"
      };
    }
    return recoverCodexAppServerFinalizingTurn(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        status: normalizedStatus
      }
    );
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
      return CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE;
    }
    const punctuation = [".", "!", "?"].some((character) => normalizedError.endsWith(character)) ? "" : ".";
    return `Codex completed, but Vibe64 could not process its response: ${normalizedError}${punctuation}`;
  }

  async function stopCodexAppServerTurnWithProviderFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    ok = false,
    outcome = CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
    provider = null,
    status = "failed",
    usageLimitExceeded = false,
    verifyInactive = true
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedStatus = normalizeText(status) || "failed";
    const runtime = await createRuntimeForSession();
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
    if (verifyInactive && await codexAppServerProviderBlocksTurnRelease(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
      source: "provider_failure"
    })) {
      return {
        ok: true,
        processed: false,
        reason: "provider_still_active",
        status: "inProgress"
      };
    }
    const recovered = await recoverCodexAppServerFinalResponseBeforeOutcome(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      normalizedStatus
    );
    if (recovered?.processed) {
      return recovered;
    }
    const message = codexAppServerStoppedTurnMessage(normalizedStatus, error);
    await writeCodexAppServerTurnOutcomeNotice(
      runtime,
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      outcome,
      error,
      { usageLimitExceeded }
    );
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: outcome
    });
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
    const runtime = await createRuntimeForSession();
    const currentSession = await runtime.getSession(normalizedSessionId);
    const currentTurn = codexAppServerTurnState(currentSession);
    const recovered = await recoverCodexAppServerFinalResponseBeforeOutcome(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      normalizedStatus
    );
    if (recovered?.processed) {
      return recovered;
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
    await writeCodexAppServerTurnOutcomeNotice(
      runtime,
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE
    );
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE
    });
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
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

  async function reconcileCodexAppServerGoalUpdated(
    sessionId = "",
    provider = null,
    threadId = "",
    notification = {}
  ) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const notificationTurnId = codexAppServerNotificationTurnId(notification);
    const goalStatus = normalizeText(notification.params?.goal?.status);
    const runtime = await createRuntimeForSession();
    let run = await readCodexAppServerAgentRunForSession(
      runtime.store,
      normalizedSessionId
    );
    const currentThreadId = normalizeText(run?.providerThreadId);
    if (
      run &&
      CODEX_APP_SERVER_GOAL_STATUSES.has(goalStatus) &&
      (!currentThreadId || currentThreadId === normalizedThreadId) &&
      (
        normalizeText(run.providerGoalStatus) !== goalStatus ||
        normalizeText(run.providerGoalThreadId) !== normalizedThreadId
      )
    ) {
      const updatedAt = new Date().toISOString();
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          goalStatus,
          kind: "codex-app-server-goal-status-updated",
          message: "",
          providerThreadId: normalizedThreadId
        },
        patch: {
          providerGoalStatus: goalStatus,
          providerGoalThreadId: normalizedThreadId,
          providerGoalUpdatedAt: updatedAt
        }
      });
      run = await readCodexAppServerAgentRunForSession(
        runtime.store,
        normalizedSessionId
      );
    }
    const turn = codexAppServerTurnStateFromAgentRun(run || {});
    const alreadyFollowingGoalTurn = (
      goalStatus === "active" &&
      turn.active &&
      ["active", "finalizing"].includes(turn.state) &&
      turn.threadId === normalizedThreadId &&
      (!notificationTurnId || turn.turnId === notificationTurnId)
    );
    if (alreadyFollowingGoalTurn) {
      return {
        ok: true,
        processed: false,
        reason: "goal_turn_already_active"
      };
    }
    if (
      CODEX_APP_SERVER_GOAL_STATUSES.has(goalStatus) &&
      goalStatus !== "active" &&
      turn.state === "finalizing" &&
      turn.threadId === normalizedThreadId &&
      (!notificationTurnId || turn.turnId === notificationTurnId)
    ) {
      return recoverCodexAppServerFinalizingTurn(
        normalizedSessionId,
        normalizedThreadId,
        turn.turnId,
        {
          status: turn.status || "completed"
        }
      );
    }
    return reconcileCodexAppServerThreadStatus(
      normalizedSessionId,
      provider,
      normalizedThreadId,
      {
        observeLatestTurn: true,
        source: "goal_updated"
      }
    );
  }

  function subscribeCodexAppServerEvents(sessionId = "", provider = null, threadId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId || !normalizedThreadId || typeof provider?.subscribe !== "function") {
      return;
    }
    const projectContext = currentProjectRequestContext();
    const sessionKey = codexTerminalNamespace(normalizedSessionId);
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
      if (notificationThreadId !== normalizedThreadId) {
        return;
      }
      const notificationContext = {
        method,
        projectContext,
        sessionId: normalizedSessionId,
        sessionKey,
        threadId: normalizedThreadId,
        turnId: codexAppServerNotificationTurnId(notification)
      };
      if (method === "thread/tokenUsage/updated") {
        runCodexAppServerNotificationTask(notificationContext, async () => {
          const store = await createStoreForSession(normalizedSessionId);
          return recordCodexContextUsageSignal(
            store,
            normalizedSessionId,
            notification,
            { expectedThreadId: normalizedThreadId }
          );
        });
      }
      const classification = classifyCodexAppServerEvent(notification);
      if (classification.kind === "hook_prompt") {
        codexAppServerAutomaticHookThreads.add(normalizedThreadId);
        return;
      }
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
      if (method === "thread/goal/updated") {
        runCodexAppServerNotificationTask(notificationContext, () => {
          return reconcileCodexAppServerGoalUpdated(
            normalizedSessionId,
            provider,
            normalizedThreadId,
            notification
          );
        });
        return;
      }
      if (
        classification.kind === "reasoning_summary" &&
        !codexAppServerAutomaticHookThreads.has(normalizedThreadId)
      ) {
        runCodexAppServerNotificationTask(notificationContext, () => {
          return recordCodexAppServerReasoningForSession(
            normalizedSessionId,
            normalizedThreadId,
            notification
          );
        });
      }
      if (classification.kind === "final_assistant_result") {
        const event = codexAppServerNotificationEvent(notification);
        const payload = codexAppServerNotificationEventPayload(notification, event);
        const params = codexAppServerNotificationParams(notification);
        runCodexAppServerNotificationTask(notificationContext, () => {
          return recordCodexAppServerFinalAssistantResult({
            itemId: classification.itemId,
            notification,
            sessionId: normalizedSessionId,
            source: classification.source,
            text: classification.text,
            threadId: normalizedThreadId,
            turnId: normalizeText(
              params.turnId ||
              params.turn_id ||
              params.turn?.id
            )
          });
        });
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
        if (codexAppServerAutomaticHookThreads.has(normalizedThreadId)) {
          return;
        }
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
        codexAppServerAutomaticHookThreads.delete(normalizedThreadId);
        runCodexAppServerNotificationTask(notificationContext, () => markCodexAppServerProviderTurnActive(normalizedSessionId, {
          source: "turn_started",
          status: codexAppServerNotificationTurnStatus(notification) || "inProgress",
          threadId: normalizedThreadId,
          turnId: codexAppServerNotificationTurnId(notification)
        }));
        return;
      }
      if (method === "turn/completed") {
        codexAppServerAutomaticHookThreads.delete(normalizedThreadId);
        const turnId = codexAppServerNotificationTurnId(notification);
        const status = codexAppServerNotificationTurnStatus(notification) || "completed";
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
              error: codexAppServerNotificationError(notification),
              provider,
              status,
              usageLimitExceeded: codexAppServerNotificationUsageLimitExceeded(notification)
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
              source: "thread_status_changed",
              status,
              threadId: normalizedThreadId,
              turnId
            });
          });
          return;
        }
        codexAppServerAutomaticHookThreads.delete(normalizedThreadId);
        const turnId = codexAppServerNotificationTurnId(notification);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
              error: codexAppServerNotificationError(notification),
              provider,
              status,
              usageLimitExceeded: codexAppServerNotificationUsageLimitExceeded(notification)
            });
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          runCodexAppServerNotificationTask(notificationContext, async () => {
            const resolvedTurnId = await resolveCodexAppServerTurnId(
              normalizedSessionId,
              normalizedThreadId,
              turnId
            );
            return completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, resolvedTurnId, {
              provider,
              status
            });
          });
        }
      }
    });
    const unsubscribe = () => {
      unsubscribeNotifications?.();
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
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(sessionId);
    const executionRoot = terminalSessionSourceRoot(session);
    if (!executionRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Vibe64 Codex execution root is not available."
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
      executionRoot,
      workdir
    })) {
      return retryableTerminalFailure({
        ok: false,
        error: workdir
          ? "Vibe64 Codex workdir is outside the execution root."
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
            sessionId
          });
          const codexThreadId = codexConversationIdForWorkdir(currentSession, currentWorkdir);
          let appServerRuntime = null;
          if (codexThreadId) {
            try {
              appServerRuntime = await codexAppServerRuntimeForVisibleTerminal(sessionId, codexThreadId, {
                runtime,
                session: currentSession,
                terminalEnv: baseTerminalEnv,
                executionRoot,
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
            cwd: executionRoot,
            detachedIdleTimeoutMs: CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS,
            maxRunning: MAX_OPEN_CODEX_TERMINALS,
            metadata: {
              envHash: terminalEnvHash,
              sessionId,
              executionRoot,
              terminalExecution: "host",
              workdir: currentWorkdir,
              ...codexAppTerminalOwnerMetadata(toolHome)
            },
            namespace,
            reuseRunning: (terminalSession) => {
              return terminalSession.metadata?.executionRoot === executionRoot &&
                terminalSession.metadata?.envHash === terminalEnvHash &&
                terminalSession.metadata?.workdir === currentWorkdir;
            },
            session: currentSession,
            executionRoot,
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
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    const executionRoot = await globalCodexRuntimeRoot(projectService, runtime);
    if (!executionRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Global Codex runtime root is not available."
      });
    }
    if (!await directoryExists(executionRoot)) {
      return retryableTerminalFailure({
        ok: false,
        error: `Main repo directory does not exist: ${executionRoot}`
      });
    }
    const session = {
      executionRoot
    };
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }

    await prepareCodexAttachmentRoot({
      env: codexAttachmentEnv()
    });
    const terminalEnv = await loadProjectExecutionEnv({
      prepare: true,
      projectService,
      runCommand,
      runtime,
      session,
      target: "codex"
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
      cwd: executionRoot,
      detachedIdleTimeoutMs: CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS,
      maxRunning: MAX_OPEN_CODEX_TERMINALS,
      metadata: {
        envHash: terminalEnvHash,
        scope: GLOBAL_CODEX_TERMINAL_SCOPE,
        executionRoot,
        terminalExecution: "host",
        workdir: executionRoot,
        ...codexAppTerminalOwnerMetadata(toolHome)
      },
      namespace,
      onClose: async () => {
        await cleanupCodexAttachments(executionRoot, GLOBAL_CODEX_TERMINAL_SCOPE, "", {
          env: codexAttachmentEnv()
        });
      },
      reuseRunning: (terminalSession) => {
        return terminalSession.metadata?.scope === GLOBAL_CODEX_TERMINAL_SCOPE &&
          terminalSession.metadata?.executionRoot === executionRoot &&
          terminalSession.metadata?.envHash === terminalEnvHash &&
          terminalSession.metadata?.workdir === executionRoot;
      },
      session,
      executionRoot,
      workdir: executionRoot
    });
    const codexTerminal = activeGlobalCodexTerminal(executionRoot);
    return {
      ...terminalResponse,
      codexTerminal,
      globalCodexTerminal: codexTerminal
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
      retryable: normalizedStatus === "failed" && retryable !== false,
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
      const currentTask = (Array.isArray(currentSession?.backgroundTasks)
        ? currentSession.backgroundTasks
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
    const currentTask = (Array.isArray(currentSession?.backgroundTasks)
      ? currentSession.backgroundTasks
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
      await retireAndCloseCodexAppServerProviderForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        })
      );
    }
    return writeCodexAppServerBlocked(runtime, sessionId, result);
  }

  async function codexAppServerSessionContext(sessionId, {
    allowClosing = false,
    runtime: providedRuntime = null,
    session: providedSession = null
  } = {}) {
    const admissionFailure = terminalNamespaceAdmissionFailure(
      codexTerminalNamespace(sessionId)
    );
    if (admissionFailure) {
      return admissionFailure;
    }
    const runtime = providedRuntime || await createRuntimeForSession();
    const session = providedSession?.sessionId === sessionId
      ? providedSession
      : await runtime.getSession(sessionId);
    if (sessionIsClosing(session) && !allowClosing) {
      const renewing = normalizeText(session.status) === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED;
      return {
        code: renewing ? "vibe64_session_renewal_quiesced" : "vibe64_session_closing",
        error: `Session is ${sessionClosingReason(session)} and cannot start Codex.`,
        ok: false
      };
    }
    const executionRoot = terminalSessionSourceRoot(session);
    if (!executionRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Vibe64 Codex execution root is not available."
      });
    }
    const workdir = terminalWorktreePath(session);
    if (codexSessionWorktreeWasRemoved(session)) {
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
      executionRoot,
      workdir
    })) {
      return retryableTerminalFailure({
        ok: false,
        error: workdir
          ? "Vibe64 Codex workdir is outside the execution root."
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
      executionRoot,
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
    assertCodexAppServerControllerOpen();
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
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    const threadId = codexThreadIdForWorkdir(session, workdir);
    if (!threadId) {
      const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
        runtime,
        executionRoot,
        toolHomeSource,
        workdir
      });
      const providerKey = codexAppServerProviderKey(normalizedSessionId, providerOptions);
      await ensureCodexAppServerDaemonForSession(normalizedSessionId, providerOptions);
      rememberCodexAppServerManagedSession(providerKey, {
        providerOptions,
        sessionId: normalizedSessionId,
        executionRoot,
        workdir
      });
      return {
        ok: true,
        providerKey,
        sessionId: normalizedSessionId,
        status: "notStarted",
        threadId: ""
      };
    }
    const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session, {
      executionRoot,
      workdir
    });
    const providerOptions = activeProvider?.providerOptions || await codexAppServerRuntimeOptionsForSession(session, {
      runtime,
      executionRoot,
      toolHomeSource,
      workdir
    });
    const providerKey = activeProvider?.providerKey || codexAppServerProviderKey(
      normalizedSessionId,
      providerOptions
    );
    const existing = codexAppServerThreadReconciliations.get(providerKey);
    if (existing) {
      return existing;
    }
    const reconciliation = (async () => {
      const provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
        normalizedSessionId,
        providerOptions
      );
      try {
        const loadedThreadIds = await codexAppServerLoadedThreadIds(provider);
        if (loadedThreadIds?.has(threadId)) {
          const subscription = subscribeCodexAppServerEvents(
            normalizedSessionId,
            provider,
            threadId,
            providerOptions
          );
          const subscriptionStatus = normalizeText(subscription?.status) || "subscribed";
          if (subscriptionStatus !== "alreadySubscribed") {
            await provider.resumeThread(threadId, {
              cwd: workdir
            });
          }
          rememberCodexAppServerManagedSession(providerKey, {
            providerOptions,
            sessionId: normalizedSessionId,
            executionRoot,
            threadId,
            workdir
          });
          await reconcileCodexAppServerLoadedThreadStatus(
            normalizedSessionId,
            provider,
            threadId,
            {
              observeLatestTurn: subscriptionStatus !== "alreadySubscribed"
            }
          ).catch((error) => {
            vibe64SessionDebugLog("server.codexTerminal.appServerThread.statusReconcile.error", {
              error: vibe64SessionDebugError(error),
              sessionId: normalizedSessionId,
              threadId
            });
          });
          let loadedSession = await runtime.getSession(normalizedSessionId);
          if (codexAppServerTurnState(loadedSession).state === "starting") {
            loadedSession = await recoverCodexAppServerActiveTurn(normalizedSessionId, {
              provider,
              retryOnError: false,
              runtime
            });
          }
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
    assertCodexAppServerControllerOpen();
    const runtime = await createRuntimeForSession();
    assertCodexAppServerControllerOpen();
    const projectContextRoot = normalizeText(runtime.projectContextRoot);
    const economyRestore = await restoreCodexAppServerEconomyThreads({ runtime });
    const reconcileGeneration = ++codexAppServerThreadReconcileGeneration;
    const sessionIds = [...new Set((Array.isArray(sessions) ? sessions : [])
      .map((session) => codexAppServerReconcileSessionId(session))
      .filter(Boolean))];
    const results = await Promise.all(sessionIds.map(async (sessionId) => {
      try {
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        let economyFailure = null;
        let economyInventory = null;
        if (economyRestore.ok !== false) {
          try {
            economyInventory = await reconcileCodexAppServerEconomyRuntime({ runtime, session });
          } catch (error) {
            economyFailure = codexAppServerEconomyFailure({
              projectRuntimeRoot: runtime.stateRoot,
              sessionId
            }, error);
            vibe64SessionDebugLog("server.codexTerminal.appServerEconomy.reconcile.error", {
              error: vibe64SessionDebugError(error),
              sessionId
            });
          }
        }
        const result = await reconcileCodexAppServerThreadForSession(sessionId, {
          agentSettings
        });
        return {
          ...result,
          economyFailure,
          economyInventory
        };
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
    const failed = [
      ...economyRestore.failed,
      ...results.flatMap((result) => [
        result?.ok === false ? result : null,
        result?.economyFailure || null
      ].filter(Boolean))
    ];
    const keepProviderKeys = new Set(results
      .map((result) => normalizeText(result?.providerKey))
      .filter(Boolean));
    if (reconcileGeneration === codexAppServerThreadReconcileGeneration) {
      await waitForOtherCodexAppServerThreadReconciliations({
        keepProviderKeys,
        projectContextRoot
      });
    }
    if (reconcileGeneration === codexAppServerThreadReconcileGeneration) {
      await pruneCodexAppServerManagedSessions({
        keepProviderKeys,
        projectContextRoot
      });
    } else {
      vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.pruneSkipped", {
        reason: "stale_reconcile",
        sessionCount: sessionIds.length,
        projectContextRoot
      });
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerThread.reconcile.done", {
      failedCount: failed.length,
      sessionCount: sessionIds.length
    });
    return {
      economyRestore,
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
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    let healthAttempt = null;
    try {
      const prepared = await withCodexSessionStartupGate({
        operation: async (currentSession) => {
          const health = await writeCodexAppServerRunning(runtime, sessionId, {
            kind: "app_server_started",
            message: "Preparing Codex app-server for this session."
          });
          healthAttempt = health.healthAttempt;
          const activeProvider = await ensureCodexAppServerProviderForActiveTurn(currentSession, {
            executionRoot,
            workdir
          });
          let providerOptions = activeProvider?.providerOptions;
          if (!providerOptions) {
            const terminalEnv = await codexProjectTerminalEnv({
              runtime,
              session: currentSession,
              sessionId
            });
            providerOptions = await codexAppServerRuntimeOptionsForSession(currentSession, {
              terminalEnv,
              runtime,
              executionRoot,
              toolHomeSource,
              workdir
            });
          }
          const provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
            sessionId,
            providerOptions
          );
          const developerInstructions = (await codexAppServerSessionInstructions(
            currentSession,
            { workdir }
          )).output;
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
      const providerOptions = prepared.providerOptions;
      const thread = prepared.thread;
      await writeCodexContextReplacementWarning(runtime, sessionId, thread);
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        providerOptions,
        sessionId,
        executionRoot,
        threadId: thread.threadId,
        workdir
      });
      await reconcileCodexAppServerThreadStatus(sessionId, provider, thread.threadId, {
        failUnconfirmedTrackedTurn: true,
        observeLatestTurn: true,
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
            runtime.store.writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server"),
            runtime.store.writeMetadataValue(
              sessionId,
              CODEX_SESSION_BRIEFING_FINGERPRINT_METADATA,
              codexSessionBriefingFingerprint(developerInstructions)
            )
          ]);
        });
      }
      await writeCodexAppServerReady(runtime, sessionId, "", {
        healthAttempt
      });
      let currentSession = await runtime.getSession(sessionId);
      if (codexAppServerTurnState(currentSession).state === "starting") {
        currentSession = await recoverCodexAppServerActiveTurn(sessionId, {
          provider,
          retryOnError: false,
          runtime
        });
      }
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

  async function startCodexAppServerTurn(sessionId, input = {}, options = {}) {
    const startedAt = Date.now();
    const agentSettings = isRecord(options.agentSettings)
      ? options.agentSettings
      : isRecord(input.agentSettings) ? input.agentSettings : {};
    const vibe64User = options.vibe64User || input.vibe64User || null;
    const messageId = normalizeText(input.messageId) ||
      `vibe64:${crypto.randomUUID()}`;
    const userRequest = codexPromptInputFromRequest(input);
    if (!userRequest) {
      return {
        ok: false,
        error: "Codex message is empty."
      };
    }

    const context = await codexAppServerSessionContext(sessionId, options);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    const turnMetadata = await currentConversationActorMetadata(vibe64User);
    vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.start", {
      durationMs: Date.now() - startedAt,
      messageId,
      sessionId
    });

    const claim = await claimCodexAppServerTurnStart(runtime, sessionId, messageId);
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

    const normalizedSessionId = normalizeText(sessionId);
    const promptDeliveryKey = codexTerminalNamespace(normalizedSessionId);
    codexAppServerPromptDeliveries.add(promptDeliveryKey);
    let activeThreadId = "";
    let healthAttempt = null;
    let providerFailure = "";
    let turnFailureHandled = false;
    try {
      const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
      const prepared = await withCodexSessionStartupGate({
        operation: async (currentSession) => {
          let stageStartedAt = Date.now();
          const terminalEnv = await codexProjectTerminalEnv({
            runtime,
            session: currentSession,
            sessionId
          });
          vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
            durationMs: Date.now() - stageStartedAt,
            messageId,
            sessionId,
            stage: "terminal-env"
          });
          stageStartedAt = Date.now();
          const providerOptions = await codexAppServerRuntimeOptionsForSession(currentSession, {
            terminalEnv,
            runtime,
            executionRoot,
            toolHomeSource,
            workdir
          });
          vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
            durationMs: Date.now() - stageStartedAt,
            messageId,
            sessionId,
            stage: "provider-options"
          });
          const providerAlreadyAvailable = codexAppServerProviderIsAvailableForSession(
            sessionId,
            providerOptions
          );
          if (!providerAlreadyAvailable) {
            const health = await writeCodexAppServerRunning(runtime, sessionId, {
              kind: "app_server_started",
              message: "Connecting to Codex for this session."
            });
            healthAttempt = health.healthAttempt;
          }
          stageStartedAt = Date.now();
          const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
          vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
            durationMs: Date.now() - stageStartedAt,
            messageId,
            sessionId,
            stage: "provider"
          });
          const developerInstructions = (await codexAppServerSessionInstructions(
            currentSession,
            { workdir }
          )).output;
          stageStartedAt = Date.now();
          const thread = await ensureCodexAppServerThreadForSession({
            agentSettings,
            developerInstructions,
            provider,
            runtime,
            session: currentSession,
            workdir
          });
          vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
            durationMs: Date.now() - stageStartedAt,
            messageId,
            sessionId,
            stage: "thread"
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
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
        durationMs: Date.now() - startedAt,
        messageId,
        sessionId,
        stage: "startup-ready"
      });
      await writeCodexContextReplacementWarning(runtime, sessionId, thread);
      activeThreadId = thread.threadId;
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        providerOptions,
        sessionId,
        executionRoot,
        threadId: thread.threadId,
        workdir
      });
      await writeCodexAppServerReady(runtime, sessionId, "", {
        healthAttempt
      });
      await markCodexAppServerTurnActive(sessionId, {
        status: "starting",
        threadId: thread.threadId
      });
      let stageStartedAt = Date.now();
      const actorResult = await recordSessionGitCommandActor({
        env,
        overwrite: true,
        reason: "codex-prompt",
        runtime,
        session: preparedSession,
        sourceRoot: executionRoot,
        threadId: thread.threadId,
        vibe64User,
        workdir
      });
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
        durationMs: Date.now() - stageStartedAt,
        messageId,
        sessionId,
        stage: "git-actor"
      });
      if (actorResult?.ok === false) {
        throw new Error(actorResult.error || "GitHub identity is not available for the user who authorized this Codex prompt.");
      }
      const refreshMetadata = preparedSession.metadata || {};
      const providerContextRefreshPending = codexContextRefreshPending(preparedSession);
      stageStartedAt = Date.now();
      const genesisTask = normalizeText(input.genesisTask);
      const needsOpeningPrompt = !sessionBriefingIsDelivered(preparedSession) &&
        !normalizeText(preparedSession.metadata?.renewal_handover_delivered_at);
      const rendered = genesisTask || needsOpeningPrompt
        ? await runtime.renderPrompt(sessionId, {
            input,
            request: userRequest,
            task: genesisTask || "start"
          })
        : { prompt: userRequest };
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
        durationMs: Date.now() - stageStartedAt,
        messageId,
        sessionId,
        stage: "prompt-render"
      });
      const renderedPrompt = normalizeText(rendered?.prompt);
      if (!renderedPrompt) {
        throw new Error("The assistant prompt is empty.");
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.prepared", {
        messageCount: 1,
        messageId,
        sessionId,
        threadId: thread.threadId
      });
      let delivery = null;
      const clientUserMessageId = messageId;
      await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
        eventKind: "codex-app-server-user-message-owned",
        owned: true
      });
      try {
        const response = sendCodexAppServerPromptForSession({
          agentSettings,
          clientUserMessageId,
          prompt: renderedPrompt,
          attachments: input.attachments,
          provider,
          threadId: thread.threadId,
          workdir
        });
        const receipt = codexAppServerPendingUserMessages.get(
          `${promptDeliveryKey}\0${clientUserMessageId}`
        )?.receipt;
        // An exact, persisted user-message receipt confirms delivery too.
        // Finish bookkeeping once; a late RPC reply must not hold admission
        // or change a turn that has already continued or completed.
        delivery = receipt
          ? await Promise.race([response, receipt.promise.then((turn) => ({ turn }))])
          : await response;
      } catch (error) {
        await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
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
      if (!deliveredTurnId) {
        throw new Error("Codex app-server accepted the prompt without returning a turn id.");
      }
      await markCodexAppServerTurnActive(sessionId, {
        requireTrackedTurn: true,
        status: "inProgress",
        threadId: thread.threadId,
        turnId: deliveredTurnId
      });
      if (codexAppServerTurnStatusIsProviderFailure(deliveredTurnStatus)) {
        providerFailure = `Codex turn ${deliveredTurnStatus}.`;
        await stopCodexAppServerTurnWithProviderFailure(sessionId, thread.threadId, deliveredTurnId, {
          provider,
          status: deliveredTurnStatus
        });
      } else if (codexAppServerTurnStatusIsSuccessfulComplete(deliveredTurnStatus)) {
        const completion = await completeCodexAppServerTurn(sessionId, thread.threadId, deliveredTurnId, {
          provider,
          status: deliveredTurnStatus
        });
        if (completion?.ok === false) {
          providerFailure = normalizeText(completion.error) || "Codex completed, but its response could not be processed.";
        }
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
          ] : []),
          ...(briefingWasDelivered || providerContextRefreshPending ? [
            runtime.store.writeMetadataValue(
              sessionId,
              CODEX_SESSION_BRIEFING_FINGERPRINT_METADATA,
              codexSessionBriefingFingerprint(developerInstructions)
            )
          ] : [])
        ]);
      });
      if (providerContextRefreshPending) {
        await clearCodexAppServerContextRefreshPending(runtime.store, sessionId, {
          delivery: "prompt",
          reason: refreshMetadata.codex_context_refresh_reason,
          threadId: refreshMetadata.codex_context_refresh_thread_id || thread.threadId,
          turnId: refreshMetadata.codex_context_refresh_turn_id
        });
      }
      const currentSession = await runtime.getSession(sessionId);
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.delivered", {
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
        turnMetadata,
        turnId: delivery.turn?.id || ""
      };
    } catch (error) {
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
    } finally {
      codexAppServerPromptDeliveries.delete(promptDeliveryKey);
    }
  }

  function codexAppServerEconomyThreadKey({
    projectRuntimeRoot = "",
    sessionId = "",
    threadId = ""
  } = {}) {
    return [
      normalizeText(projectRuntimeRoot),
      normalizeText(sessionId),
      normalizeText(threadId)
    ].join("\u001f");
  }

  async function withCodexAppServerEconomyProjectOperation(
    projectRuntimeRoot = "",
    operation
  ) {
    const key = normalizeText(projectRuntimeRoot);
    if (!key || typeof operation !== "function") {
      throw codexAppServerEconomyOwnershipError(
        "Vibe64 project runtime state is unavailable for low-cost assistant ownership."
      );
    }
    const previous = codexAppServerEconomyProjectOperations.get(key) || Promise.resolve();
    const current = previous.catch(() => null).then(operation);
    codexAppServerEconomyProjectOperations.set(key, current);
    try {
      return await current;
    } finally {
      if (codexAppServerEconomyProjectOperations.get(key) === current) {
        codexAppServerEconomyProjectOperations.delete(key);
      }
    }
  }

  function codexAppServerEconomyThreadUnavailableError(threadId = "") {
    const error = new Error(
      "This low-cost assistant thread is no longer available. Start the background task again instead of reusing another assistant conversation."
    );
    error.code = "vibe64_codex_economy_thread_unavailable";
    error.statusCode = 409;
    error.threadId = normalizeText(threadId);
    return error;
  }

  function codexAppServerEconomyThreadLedger(projectRuntimeRoot = "") {
    const normalizedProjectRuntimeRoot = normalizeText(projectRuntimeRoot);
    let ledger = codexAppServerEconomyThreadLedgers.get(normalizedProjectRuntimeRoot);
    if (!ledger) {
      ledger = codexEconomyThreadLedgerFactory({
        projectRuntimeRoot: normalizedProjectRuntimeRoot
      });
      codexAppServerEconomyThreadLedgers.set(normalizedProjectRuntimeRoot, ledger);
    }
    return ledger;
  }

  function codexAppServerProviderKeyForProvider(provider = null) {
    for (const [providerKey, candidate] of codexAppServerProviders.entries()) {
      if (candidate === provider) {
        return providerKey;
      }
    }
    return "";
  }

  function codexAppServerProviderKeyFingerprint(providerKey = "") {
    return `sha256:${crypto.createHash("sha256")
      .update(normalizeText(providerKey))
      .digest("hex")}`;
  }

  async function codexAppServerEconomyThreadIdentity({
    executionProfile = null,
    provider = null
  } = {}) {
    if (
      typeof provider?.currentRuntimeInfo !== "function" ||
      typeof provider?.currentServerInfo !== "function"
    ) {
      throw new Error("Codex provider cannot prove durable economy thread ownership.");
    }
    const runtime = await provider.currentRuntimeInfo();
    const server = provider.currentServerInfo();
    const providerKey = codexAppServerProviderKeyForProvider(provider);
    if (!providerKey) {
      throw new Error("Codex economy provider is not owned by this controller.");
    }
    return Object.freeze({
      providerId: normalizeText(executionProfile?.providerId),
      providerKeyFingerprint: codexAppServerProviderKeyFingerprint(
        providerKey
      ),
      runtime,
      server,
      transportId: CODEX_APP_SERVER_PROVIDER_ID
    });
  }

  function attachCodexAppServerEconomyThread({
    durable = null,
    ledger = null,
    provider = null
  } = {}) {
    const key = codexAppServerEconomyThreadKey(durable);
    const record = Object.freeze({
      ...durable,
      durable,
      ledger,
      provider
    });
    codexAppServerEconomyThreads.set(key, record);
    return record;
  }

  async function rememberCodexAppServerEconomyThread({
    executionProfile = null,
    lifecycle = CODEX_ECONOMY_THREAD_LIFECYCLES.READY,
    projectContextRoot = "",
    projectRuntimeRoot = "",
    provider = null,
    sessionId = "",
    threadId = "",
    turnId = "",
    workdir = ""
  } = {}) {
    if (
      !normalizeText(projectRuntimeRoot) ||
      !normalizeText(sessionId) ||
      !normalizeText(threadId) ||
      !provider
    ) {
      throw codexAppServerEconomyThreadUnavailableError(threadId);
    }
    const now = new Date().toISOString();
    const durable = defineCodexEconomyThreadRecord({
      createdAt: now,
      executionProfile: vibe64AgentExecutionProfileAuditSnapshot(executionProfile),
      identity: await codexAppServerEconomyThreadIdentity({ executionProfile, provider }),
      lifecycle,
      ownershipId: crypto.randomUUID(),
      projectContextRoot: normalizeText(projectContextRoot),
      projectRuntimeRoot: normalizeText(projectRuntimeRoot),
      revision: 1,
      schemaVersion: CODEX_ECONOMY_THREAD_LEDGER_SCHEMA_VERSION,
      sessionId: normalizeText(sessionId),
      threadId: normalizeText(threadId),
      turnId: normalizeText(turnId),
      updatedAt: now,
      workdir: normalizeText(workdir)
    });
    const ledger = codexAppServerEconomyThreadLedger(projectRuntimeRoot);
    await ledger.write(durable);
    return attachCodexAppServerEconomyThread({ durable, ledger, provider });
  }

  async function withCodexAppServerEconomyThreadMutation(record = null, operation) {
    const key = codexAppServerEconomyThreadKey(record);
    if (!record || typeof operation !== "function") {
      throw codexAppServerEconomyThreadUnavailableError(record?.threadId);
    }
    const previous = codexAppServerEconomyThreadMutations.get(key) || Promise.resolve();
    const mutation = previous.catch(() => null).then(operation);
    codexAppServerEconomyThreadMutations.set(key, mutation);
    try {
      return await mutation;
    } finally {
      if (codexAppServerEconomyThreadMutations.get(key) === mutation) {
        codexAppServerEconomyThreadMutations.delete(key);
      }
    }
  }

  async function updateCodexAppServerEconomyThreadUnlocked(record = null, {
    lifecycle = record?.lifecycle,
    turnId = record?.turnId
  } = {}) {
    const key = codexAppServerEconomyThreadKey(record);
    if (!record || codexAppServerEconomyThreads.get(key) !== record) {
      throw codexAppServerEconomyThreadUnavailableError(record?.threadId);
    }
    const durable = defineCodexEconomyThreadRecord({
      ...record.durable,
      lifecycle,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
      turnId: normalizeText(turnId)
    });
    await record.ledger.write(durable, { expected: record.durable });
    return attachCodexAppServerEconomyThread({
      durable,
      ledger: record.ledger,
      provider: record.provider
    });
  }

  async function updateCodexAppServerEconomyThread(record = null, changes = {}) {
    return withCodexAppServerEconomyThreadMutation(record, () => (
      updateCodexAppServerEconomyThreadUnlocked(record, changes)
    ));
  }

  function forgetCodexAppServerEconomyThreadInMemory(record = null) {
    const key = codexAppServerEconomyThreadKey(record);
    if (!record || codexAppServerEconomyThreads.get(key) !== record) {
      return false;
    }
    codexAppServerEconomyThreadCleanups.delete(key);
    return codexAppServerEconomyThreads.delete(key);
  }

  async function removeCodexAppServerEconomyThreadUnlocked(record = null) {
    const key = codexAppServerEconomyThreadKey(record);
    if (!record || codexAppServerEconomyThreads.get(key) !== record) {
      throw codexAppServerEconomyThreadUnavailableError(record?.threadId);
    }
    await record.ledger.remove(record.durable);
    forgetCodexAppServerEconomyThreadInMemory(record);
    return true;
  }

  async function removeCodexAppServerEconomyThread(record = null) {
    return withCodexAppServerEconomyThreadMutation(record, () => (
      removeCodexAppServerEconomyThreadUnlocked(record)
    ));
  }

  function codexAppServerEconomyThreadRecords({
    projectContextRoot = "",
    projectRuntimeRoot = "",
    provider = null,
    sessionId = ""
  } = {}) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    const normalizedProjectRuntimeRoot = normalizeText(projectRuntimeRoot);
    const normalizedSessionId = normalizeText(sessionId);
    return [...codexAppServerEconomyThreads.values()].filter((record) => {
      return (!provider || record.provider === provider) &&
        (!normalizedSessionId || record.sessionId === normalizedSessionId) &&
        (!normalizedProjectContextRoot || record.projectContextRoot === normalizedProjectContextRoot) &&
        (!normalizedProjectRuntimeRoot || record.projectRuntimeRoot === normalizedProjectRuntimeRoot);
    });
  }

  function codexAppServerEconomyThreadCleanupError(record = {}, error = null, interruptError = null) {
    const failure = new Error(
      "Vibe64 could not retire a low-cost assistant thread. Retry cleanup before shutting down its Codex provider."
    );
    failure.code = "vibe64_codex_economy_thread_cleanup_failed";
    failure.statusCode = 503;
    failure.retryable = true;
    failure.details = {
      cleanupError: errorMessage(error, "Codex economy thread deletion failed."),
      ...(interruptError
        ? { interruptError: errorMessage(interruptError, "Codex economy turn interruption failed.") }
        : {}),
      retryable: true,
      sessionId: normalizeText(record.sessionId),
      threadId: normalizeText(record.threadId),
      turnId: normalizeText(record.turnId)
    };
    return failure;
  }

  async function retireCodexAppServerEconomyThread(record = null) {
    const key = codexAppServerEconomyThreadKey(record);
    const pendingTurnStart = codexAppServerEconomyTurnStarts.get(key);
    if (pendingTurnStart) {
      await pendingTurnStart.catch(() => null);
    }
    const current = codexAppServerEconomyThreads.get(key);
    if (!record || !current) {
      return {
        deleted: false,
        ok: true,
        status: "notOwned",
        threadId: normalizeText(record?.threadId)
      };
    }
    const pending = codexAppServerEconomyThreadCleanups.get(key);
    if (pending) {
      return pending;
    }
    const cleanup = withCodexAppServerEconomyThreadMutation(record, async () => {
      let cleanupRecord = codexAppServerEconomyThreads.get(key);
      if (!cleanupRecord || cleanupRecord.ownershipId !== record.ownershipId) {
        return {
          deleted: false,
          ok: true,
          status: "notOwned",
          threadId: normalizeText(record.threadId)
        };
      }
      if (cleanupRecord.lifecycle !== CODEX_ECONOMY_THREAD_LIFECYCLES.CLEANUP_REQUIRED) {
        try {
          cleanupRecord = await updateCodexAppServerEconomyThreadUnlocked(cleanupRecord, {
            lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.CLEANUP_REQUIRED
          });
        } catch (error) {
          throw codexAppServerEconomyThreadCleanupError(cleanupRecord, error);
        }
      }
      const provider = cleanupRecord.provider;
      let interruptError = null;
      if (cleanupRecord.turnId) {
        if (typeof provider?.interruptTurn === "function") {
          try {
            await provider.interruptTurn(cleanupRecord.threadId, cleanupRecord.turnId);
          } catch (error) {
            interruptError = error;
          }
        } else {
          interruptError = new Error("Codex provider cannot interrupt an active economy turn.");
        }
      }
      if (typeof provider?.deleteThread !== "function") {
        throw codexAppServerEconomyThreadCleanupError(
          cleanupRecord,
          new Error("Codex provider cannot delete an economy thread."),
          interruptError
        );
      }
      try {
        const result = await provider.deleteThread(cleanupRecord.threadId);
        if (!isRecord(result)) {
          const error = new Error("Codex app-server returned an invalid thread deletion result.");
          error.code = "vibe64_codex_economy_thread_delete_unconfirmed";
          throw error;
        }
        await removeCodexAppServerEconomyThreadUnlocked(cleanupRecord);
        return {
          deleted: true,
          interrupted: Boolean(cleanupRecord.turnId) && !interruptError,
          ok: true,
          result,
          status: "deleted",
          threadId: cleanupRecord.threadId,
          turnId: cleanupRecord.turnId
        };
      } catch (error) {
        let absent = false;
        if (codexAppServerRequestIsInvalid(error, "thread/delete")) {
          try {
            absent = !await codexAppServerThreadHasReadableHistory(provider, cleanupRecord.threadId);
          } catch {
            absent = false;
          }
        }
        if (absent) {
          try {
            await removeCodexAppServerEconomyThreadUnlocked(cleanupRecord);
          } catch (ledgerError) {
            throw codexAppServerEconomyThreadCleanupError(
              cleanupRecord,
              ledgerError,
              interruptError
            );
          }
          return {
            deleted: false,
            interrupted: Boolean(cleanupRecord.turnId) && !interruptError,
            ok: true,
            status: "notFound",
            threadId: cleanupRecord.threadId,
            turnId: cleanupRecord.turnId
          };
        }
        throw codexAppServerEconomyThreadCleanupError(cleanupRecord, error, interruptError);
      }
    });
    codexAppServerEconomyThreadCleanups.set(key, cleanup);
    try {
      return await cleanup;
    } finally {
      if (codexAppServerEconomyThreadCleanups.get(key) === cleanup) {
        codexAppServerEconomyThreadCleanups.delete(key);
      }
    }
  }

  async function retireCodexAppServerEconomyThreads(filters = {}) {
    const records = codexAppServerEconomyThreadRecords(filters);
    const results = [];
    const failed = [];
    for (const record of records) {
      try {
        results.push(await retireCodexAppServerEconomyThread(record));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: errorMessage(error),
          retryable: error?.retryable === true,
          sessionId: record.sessionId,
          threadId: record.threadId,
          turnId: record.turnId
        });
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      owned: records.length,
      results
    };
  }

  function assertCodexAppServerEconomyThreadsRetired(result = {}) {
    if (result.ok !== false) {
      return result;
    }
    const failure = new Error(
      "Vibe64 could not retire every low-cost assistant thread. Retry cleanup before shutting down Codex."
    );
    failure.code = "vibe64_codex_economy_thread_cleanup_failed";
    failure.statusCode = 503;
    failure.retryable = true;
    failure.details = {
      failed: result.failed,
      retryable: true
    };
    throw failure;
  }

  function codexAppServerEconomyOwnershipError(message = "", details = {}) {
    const error = new Error(
      normalizeText(message) ||
      "Vibe64 could not prove ownership of a persisted low-cost assistant thread."
    );
    error.code = "vibe64_codex_economy_ownership_blocked";
    error.statusCode = 409;
    error.retryable = true;
    error.details = {
      ...details,
      retryable: true
    };
    return error;
  }

  function codexAppServerRuntimeIdentityMatches(expected = {}, actual = {}, {
    requireEndpoint = true
  } = {}) {
    return expected.accountIdentitySignature === normalizeText(actual.accountIdentitySignature) &&
      (!requireEndpoint || expected.endpoint === normalizeText(actual.endpoint)) &&
      expected.executionMode === normalizeText(actual.executionMode) &&
      expected.executionContextHash === normalizeText(actual.executionContextHash) &&
      expected.provider === normalizeText(actual.provider) &&
      expected.runtimeDir === normalizeText(actual.runtimeDir) &&
      expected.runtimesHash === normalizeText(actual.runtimesHash) &&
      expected.terminalEnvHash === normalizeText(actual.terminalEnvHash) &&
      expected.toolHomeSource === normalizeText(actual.toolHomeSource) &&
      expected.transport === normalizeText(actual.transport);
  }

  function codexAppServerEconomyThreadOwnershipMatches(record = {}, {
    providerKey = "",
    runtime = {},
    server = null
  } = {}, options = {}) {
    return record.identity?.providerId === normalizeText(record.executionProfile?.providerId) &&
      record.identity?.providerKeyFingerprint === codexAppServerProviderKeyFingerprint(providerKey) &&
      record.identity?.transportId === CODEX_APP_SERVER_PROVIDER_ID &&
      codexAppServerRuntimeIdentityMatches(record.identity?.runtime, runtime, options) &&
      (
        options.requireServer !== true ||
        record.identity?.server?.userAgent === normalizeText(server?.userAgent)
      );
  }

  function codexAppServerEconomyFailure(record = null, error = null) {
    return {
      code: normalizeText(error?.code) || "vibe64_codex_economy_ownership_blocked",
      error: errorMessage(error),
      projectRuntimeRoot: normalizeText(record?.projectRuntimeRoot),
      retryable: error?.retryable !== false,
      sessionId: normalizeText(record?.sessionId),
      threadId: normalizeText(record?.threadId)
    };
  }

  async function restoreCodexAppServerEconomyThread(record = {}, {
    ledger = null,
    runtime = null,
    session = null
  } = {}) {
    const projectRuntimeRoot = normalizeText(runtime?.stateRoot);
    if (
      !projectRuntimeRoot ||
      record.projectRuntimeRoot !== projectRuntimeRoot ||
      normalizeText(session?.sessionId || session?.id) !== record.sessionId ||
      normalizeText(runtime?.projectContextRoot) !== record.projectContextRoot ||
      terminalWorktreePath(session) !== record.workdir
    ) {
      throw codexAppServerEconomyOwnershipError(
        "Persisted Codex economy ownership does not match the current project session.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const key = codexAppServerEconomyThreadKey(record);
    const pendingMutation = codexAppServerEconomyThreadMutations.get(key);
    if (pendingMutation) {
      await pendingMutation.catch(() => null);
    }
    const existing = codexAppServerEconomyThreads.get(key);
    if (existing) {
      if (
        existing.ownershipId !== record.ownershipId ||
        existing.revision < record.revision
      ) {
        throw codexAppServerEconomyOwnershipError(
          "Persisted Codex economy ownership changed while the controller was running.",
          {
            sessionId: record.sessionId,
            threadId: record.threadId
          }
        );
      }
      if (
        session.status !== VIBE64_SESSION_STATUS.ARCHIVED &&
        !sessionIsClosing(session)
      ) {
        return { record: existing, retiredThreadId: "" };
      }
      await retireCodexAppServerEconomyThread(existing);
      return { record: null, retiredThreadId: existing.threadId };
    }
    if (!await directoryExists(record.identity.runtime.runtimeDir)) {
      await ledger.remove(record);
      return { record: null, retiredThreadId: record.threadId };
    }
    const executionRoot = terminalSessionSourceRoot(session);
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      throw codexAppServerEconomyOwnershipError(toolHome.error, {
        sessionId: record.sessionId,
        threadId: record.threadId
      });
    }
    const providerOptions = await codexAppServerEconomyRuntimeOptionsForSession(session, {
      runtime,
      executionRoot,
      toolHomeSource: toolHome.toolHomeSource,
      workdir: record.workdir
    });
    const providerKey = codexAppServerProviderKey(record.sessionId, providerOptions);
    if (codexAppServerProviderKeyFingerprint(providerKey) !== record.identity.providerKeyFingerprint) {
      const staleProvider = codexAppServerProviderFactory({
        ...providerOptions,
        runtimeDir: record.identity.runtime.runtimeDir
      });
      try {
        if (typeof staleProvider.currentRuntimeInfo !== "function") {
          throw codexAppServerEconomyOwnershipError(
            "The Codex provider cannot verify the account for stale economy ownership.",
            {
              sessionId: record.sessionId,
              threadId: record.threadId
            }
          );
        }
        const currentRuntime = await staleProvider.currentRuntimeInfo();
        if (
          record.identity.runtime.accountIdentitySignature !==
          normalizeText(currentRuntime.accountIdentitySignature)
        ) {
          throw codexAppServerEconomyOwnershipError(
            "The current Codex account does not match persisted economy ownership.",
            {
              sessionId: record.sessionId,
              threadId: record.threadId
            }
          );
        }
        const stopped = typeof staleProvider.stopRuntime === "function"
          ? await staleProvider.stopRuntime()
          : null;
        if (!codexAppServerRuntimeStopWasVerified(stopped)) {
          throw codexAppServerEconomyOwnershipError(
            "The earlier Codex economy runtime could not be retired after its provider context changed.",
            {
              sessionId: record.sessionId,
              threadId: record.threadId
            }
          );
        }
        await ledger.remove(record);
        return { record: null, retiredThreadId: record.threadId };
      } finally {
        staleProvider.close?.();
      }
    }
    let provider = codexAppServerProviders.get(providerKey);
    if (!provider) {
      assertCodexAppServerControllerOpen();
      provider = codexAppServerProviderFactory(providerOptions);
      codexAppServerProviders.set(providerKey, provider);
      codexAppServerProviderSessionKeys.set(
        providerKey,
        codexTerminalNamespace(record.sessionId)
      );
    }
    if (typeof provider.currentRuntimeInfo !== "function") {
      throw codexAppServerEconomyOwnershipError(
        "The Codex provider cannot prove persisted runtime ownership.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const expectedRuntime = await provider.currentRuntimeInfo();
    if (!codexAppServerEconomyThreadOwnershipMatches(record, {
      providerKey,
      runtime: expectedRuntime
    }, {
      requireEndpoint: false
    })) {
      throw codexAppServerEconomyOwnershipError(
        "The current Codex runtime/auth identity does not match persisted economy ownership.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    await acquireCodexAppServerRuntime({
      operation: () => provider.ensureAvailable?.(),
      provider,
      providerKey,
      providerOptions
    });
    const currentRuntime = await provider.currentRuntimeInfo();
    const currentServer = provider.currentServerInfo?.();
    if (!codexAppServerEconomyThreadOwnershipMatches(record, {
      providerKey,
      runtime: currentRuntime,
      server: currentServer
    }, {
      requireEndpoint: true,
      requireServer: true
    })) {
      throw codexAppServerEconomyOwnershipError(
        "The connected Codex server identity does not match persisted economy ownership.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const currentLedger = await ledger.readAll();
    if (currentLedger.failures.length > 0) {
      throw codexAppServerEconomyOwnershipError(
        "Persisted Codex economy ownership could not be revalidated before restore.",
        {
          failed: currentLedger.failures,
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const currentDurable = currentLedger.records.find((candidate) => (
      codexAppServerEconomyThreadKey(candidate) === key
    ));
    if (!currentDurable) {
      return { record: null, retiredThreadId: record.threadId };
    }
    if (
      currentDurable.ownershipId !== record.ownershipId ||
      currentDurable.revision !== record.revision
    ) {
      throw codexAppServerEconomyOwnershipError(
        "Persisted Codex economy ownership changed before it could be restored.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const attached = attachCodexAppServerEconomyThread({
      durable: currentDurable,
      ledger,
      provider
    });
    if (
      attached.lifecycle !== CODEX_ECONOMY_THREAD_LIFECYCLES.READY ||
      session.status === VIBE64_SESSION_STATUS.ARCHIVED ||
      sessionIsClosing(session)
    ) {
      await retireCodexAppServerEconomyThread(attached);
      return { record: null, retiredThreadId: attached.threadId };
    }
    return { record: attached, retiredThreadId: "" };
  }

  async function restoreCodexAppServerEconomyThreads({
    runtime = null,
    session = null,
    sessionId = ""
  } = {}) {
    const effectiveRuntime = runtime || await createRuntimeForSession();
    const projectRuntimeRoot = normalizeText(effectiveRuntime?.stateRoot);
    if (!projectRuntimeRoot) {
      throw codexAppServerEconomyOwnershipError(
        "Vibe64 project runtime state is unavailable for Codex economy ownership."
      );
    }
    const previous = codexAppServerEconomyThreadRestores.get(projectRuntimeRoot) || Promise.resolve();
    const restore = previous.catch(() => null).then(async () => {
      const ledger = codexAppServerEconomyThreadLedger(projectRuntimeRoot);
      const listed = await ledger.readAll();
      const failed = listed.failures.map((failure) => ({
        ...failure,
        projectRuntimeRoot
      }));
      const normalizedSessionId = normalizeText(sessionId || session?.sessionId || session?.id);
      const records = listed.records.filter((record) => {
        return !normalizedSessionId || record.sessionId === normalizedSessionId;
      });
      const retiredThreadIds = [];
      for (const record of records) {
        try {
          const currentSession = normalizeText(session?.sessionId || session?.id) === record.sessionId
            ? session
            : await effectiveRuntime.getSession(record.sessionId, { inspectSource: false });
          const restored = await restoreCodexAppServerEconomyThread(record, {
            ledger,
            runtime: effectiveRuntime,
            session: currentSession
          });
          if (normalizeText(restored?.retiredThreadId)) {
            retiredThreadIds.push(normalizeText(restored.retiredThreadId));
          }
        } catch (error) {
          failed.push(codexAppServerEconomyFailure(record, error));
        }
      }
      return {
        failed,
        ok: failed.length === 0,
        projectRuntimeRoot,
        recordCount: records.length,
        retiredThreadIds: [...new Set(retiredThreadIds)]
      };
    });
    codexAppServerEconomyThreadRestores.set(projectRuntimeRoot, restore);
    try {
      return await restore;
    } finally {
      if (codexAppServerEconomyThreadRestores.get(projectRuntimeRoot) === restore) {
        codexAppServerEconomyThreadRestores.delete(projectRuntimeRoot);
      }
    }
  }

  function assertCodexAppServerEconomyThreadsRestored(result = {}) {
    if (result.ok !== false) {
      return result;
    }
    throw codexAppServerEconomyOwnershipError(
      "Vibe64 could not reconcile persisted low-cost assistant thread ownership.",
      {
        failed: result.failed,
        projectRuntimeRoot: normalizeText(result.projectRuntimeRoot)
      }
    );
  }

  async function reconcileCodexAppServerEconomyRuntimeUnlocked({
    runtime = null,
    session = null
  } = {}) {
    const sessionId = normalizeText(session?.sessionId || session?.id);
    const projectRuntimeRoot = normalizeText(runtime?.stateRoot);
    if (!sessionId || !projectRuntimeRoot) {
      throw codexAppServerEconomyOwnershipError(
        "Vibe64 cannot inventory economy threads without project/session ownership."
      );
    }
    const ledger = codexAppServerEconomyThreadLedger(projectRuntimeRoot);
    const listed = await ledger.readAll();
    if (listed.failures.length > 0) {
      throw codexAppServerEconomyOwnershipError(
        "Vibe64 cannot inventory economy threads while durable ownership is malformed.",
        { failed: listed.failures, sessionId }
      );
    }
    const ownedRecords = listed.records.filter((record) => record.sessionId === sessionId);
    const remainingOwnedThreadIds = new Set(
      ownedRecords.map((record) => record.threadId)
    );
    const retireOwnedReadyThreadsMissingFrom = async (inventoryThreadIds) => {
      const retiredThreadIds = [];
      for (const durable of ownedRecords) {
        if (
          durable.lifecycle !== CODEX_ECONOMY_THREAD_LIFECYCLES.READY ||
          inventoryThreadIds.has(durable.threadId)
        ) {
          continue;
        }
        const record = codexAppServerEconomyThreads.get(
          codexAppServerEconomyThreadKey(durable)
        );
        if (!record || record.ownershipId !== durable.ownershipId) {
          throw codexAppServerEconomyOwnershipError(
            "Vibe64 cannot retire missing economy ownership without its verified controller record.",
            { sessionId, threadId: durable.threadId }
          );
        }
        if (
          record.lifecycle !== CODEX_ECONOMY_THREAD_LIFECYCLES.READY ||
          record.revision !== durable.revision
        ) {
          continue;
        }
        try {
          await removeCodexAppServerEconomyThread(record);
        } catch (error) {
          if (error?.code === "vibe64_codex_economy_thread_unavailable") {
            continue;
          }
          throw error;
        }
        remainingOwnedThreadIds.delete(durable.threadId);
        retiredThreadIds.push(durable.threadId);
      }
      return retiredThreadIds;
    };
    const executionRoot = terminalSessionSourceRoot(session);
    const workdir = terminalWorktreePath(session);
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      throw codexAppServerEconomyOwnershipError(toolHome.error, { sessionId });
    }
    const providerOptions = await codexAppServerEconomyRuntimeOptionsForSession(session, {
      executionRoot,
      runtime,
      toolHomeSource: toolHome.toolHomeSource,
      workdir
    });
    const providerKey = codexAppServerProviderKey(sessionId, providerOptions);
    let provider = codexAppServerProviders.get(providerKey);
    if (
      ownedRecords.length === 0 &&
      !provider &&
      !await directoryExists(providerOptions.runtimeDir)
    ) {
      const retiredMissingThreadIds = await retireOwnedReadyThreadsMissingFrom(new Set());
      return {
        deletedThreadIds: [],
        ok: true,
        ownedThreadIds: [...remainingOwnedThreadIds],
        providerKey,
        retiredMissingThreadIds,
        status: "runtimeAbsent"
      };
    }
    provider ||= await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
    if (typeof provider.listEconomyThreads !== "function") {
      throw codexAppServerEconomyOwnershipError(
        "The Codex economy provider cannot authoritatively inventory its threads.",
        { sessionId }
      );
    }
    const inventory = await provider.listEconomyThreads();
    if (!Array.isArray(inventory?.threadIds)) {
      throw codexAppServerEconomyOwnershipError(
        "The Codex economy provider returned an invalid thread inventory.",
        { sessionId }
      );
    }
    const inventoryThreadIds = new Set(inventory.threadIds.map(normalizeText).filter(Boolean));
    const unknownThreadIds = inventory.threadIds.filter((threadId) => {
      return normalizeText(threadId) && !remainingOwnedThreadIds.has(normalizeText(threadId));
    });
    const deletedThreadIds = [];
    for (const threadId of unknownThreadIds) {
      const result = await provider.deleteThread(threadId);
      if (!isRecord(result)) {
        throw codexAppServerEconomyOwnershipError(
          "Codex did not confirm deletion of an unowned economy thread.",
          { sessionId, threadId }
        );
      }
      deletedThreadIds.push(threadId);
    }
    const retiredMissingThreadIds = await retireOwnedReadyThreadsMissingFrom(
      inventoryThreadIds
    );
    return {
      deletedThreadIds,
      ok: true,
      ownedThreadIds: [...remainingOwnedThreadIds],
      providerKey,
      retiredMissingThreadIds,
      status: "reconciled"
    };
  }

  async function reconcileCodexAppServerEconomyRuntime({
    runtime = null,
    session = null
  } = {}) {
    return withCodexAppServerEconomyProjectOperation(runtime?.stateRoot, () => (
      reconcileCodexAppServerEconomyRuntimeUnlocked({ runtime, session })
    ));
  }

  function codexAppServerEconomyExecutionProfileMatches(recorded = {}, expected = {}) {
    const expectedKeys = Object.keys(expected).sort();
    if (
      expectedKeys.length === 2 &&
      expectedKeys[0] === "profileId" &&
      expectedKeys[1] === "workloadId"
    ) {
      const request = defineVibe64AgentExecutionProfileRequest(expected);
      return recorded.profileId === request.profileId &&
        recorded.workloadId === request.workloadId;
    }
    return JSON.stringify(recorded) === JSON.stringify(
      vibe64AgentExecutionProfileAuditSnapshot(expected)
    );
  }

  function codexAppServerEconomyThreadForOperation({
    executionProfile = null,
    lifecycles = [CODEX_ECONOMY_THREAD_LIFECYCLES.READY],
    projectRuntimeRoot = "",
    provider = null,
    sessionId = "",
    threadId = "",
    turnId = "",
    workdir = ""
  } = {}) {
    const record = codexAppServerEconomyThreads.get(
      codexAppServerEconomyThreadKey({ projectRuntimeRoot, sessionId, threadId })
    );
    if (
      !record ||
      !lifecycles.includes(record.lifecycle) ||
      record.provider !== provider ||
      record.workdir !== normalizeText(workdir) ||
      (normalizeText(turnId) && record.turnId !== normalizeText(turnId)) ||
      !codexAppServerEconomyExecutionProfileMatches(
        record.executionProfile,
        executionProfile || {}
      )
    ) {
      throw codexAppServerEconomyThreadUnavailableError(threadId);
    }
    return record;
  }

  function knownCodexAppServerEconomyThread(options = {}) {
    return codexAppServerEconomyThreadForOperation(options);
  }

  async function assertCodexAppServerEconomyAccountIdentity(provider, expectedSignature = "") {
    const expected = normalizeText(expectedSignature);
    if (!expected) {
      return;
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(expected) || typeof provider?.currentRuntimeInfo !== "function") {
      throw codexAppServerEconomyOwnershipError(
        "The requested low-cost assistant account identity is invalid. Refresh the task and retry."
      );
    }
    const actual = normalizeText((await provider.currentRuntimeInfo())?.accountIdentitySignature);
    if (actual !== expected) {
      throw codexAppServerEconomyOwnershipError(
        "The selected Codex account changed before low-cost assistant work could run. Retry the task with the current account."
      );
    }
  }

  async function codexAppServerEphemeralIsolationConfig(provider = null, workdir = "") {
    assertCodexAppServerEconomyCompatibility(provider);
    if (
      typeof provider?.readConfig !== "function" ||
      typeof provider?.listHooks !== "function" ||
      typeof provider?.currentConnectionGeneration !== "function"
    ) {
      throw new Error("Codex cannot verify tool isolation for this ephemeral conversation.");
    }
    const connectionGeneration = provider.currentConnectionGeneration();
    if (!Number.isSafeInteger(connectionGeneration) || connectionGeneration <= 0) {
      throw new Error("Codex has no active connection for this ephemeral conversation.");
    }
    const [configResult, hookResult] = await Promise.all([
      provider.readConfig({ cwd: workdir, includeLayers: false }),
      provider.listHooks([workdir])
    ]);
    if (provider.currentConnectionGeneration() !== connectionGeneration) {
      throw new Error("Codex reconnected while verifying this ephemeral conversation.");
    }
    const configuredMcp = configResult?.config?.mcp_servers;
    if (
      configuredMcp !== undefined &&
      configuredMcp !== null &&
      !isRecord(configuredMcp)
    ) {
      throw new Error("Codex returned an invalid MCP inventory for this ephemeral conversation.");
    }
    const mcpServerNames = Object.keys(configuredMcp || {});
    const hookRows = Array.isArray(hookResult?.data) ? hookResult.data : [];
    const matchingHooks = hookRows.find((entry) => (
      path.resolve(normalizeText(entry?.cwd) || "/") === path.resolve(workdir)
    ));
    if (
      mcpServerNames.length > 128 ||
      hookRows.length !== 1 ||
      !matchingHooks ||
      !Array.isArray(matchingHooks.hooks) ||
      !Array.isArray(matchingHooks.errors) ||
      matchingHooks.errors.length > 0 ||
      matchingHooks.hooks.length > 256
    ) {
      throw new Error("Codex could not prove hook and MCP isolation for this ephemeral conversation.");
    }
    const hookKeys = matchingHooks.hooks
      .map((hook) => normalizeText(hook?.key))
      .filter(Boolean);
    if (
      hookKeys.length !== matchingHooks.hooks.length ||
      matchingHooks.hooks.some((hook) => hook?.isManaged === true && hook?.enabled === true)
    ) {
      throw new Error("Codex cannot disable every hook for this ephemeral conversation.");
    }
    return {
      features: Object.fromEntries(
        CODEX_EPHEMERAL_DISABLED_FEATURES.map((feature) => [feature, false])
      ),
      hooks: {
        state: Object.fromEntries(hookKeys.map((key) => [key, { enabled: false }]))
      },
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      include_environment_context: false,
      include_permissions_instructions: false,
      mcp_servers: Object.fromEntries(
        mcpServerNames.map((name) => [name, { enabled: false }])
      ),
      memories: {
        dedicated_tools: false,
        generate_memories: false,
        use_memories: false
      },
      notify: [],
      orchestrator: {
        mcp: { enabled: false },
        skills: { enabled: false }
      },
      project_doc_max_bytes: 0,
      shell_environment_policy: {
        inherit: "none",
        set: {}
      },
      skills: { include_instructions: false },
      tools: {
        experimental_request_user_input: { enabled: false },
        update_plan: { enabled: false }
      },
      web_search: "disabled"
    };
  }

  async function codexAppServerEphemeralScopeContext(sessionId = "", input = {}, scope = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (normalizeText(scope.id) !== normalizedSessionId) {
      throw new TypeError("Codex ephemeral conversation scope does not match its provider binding.");
    }
    const requestedWorkdir = normalizeText(scope.workdir);
    if (!path.isAbsolute(requestedWorkdir)) {
      throw new TypeError("Codex ephemeral conversation workdir must be absolute.");
    }
    const workdir = path.resolve(requestedWorkdir);
    if (!await directoryExists(workdir)) {
      throw new TypeError("Codex ephemeral conversation workdir is unavailable.");
    }
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }
    const providerOptions = codexAppServerRuntimeOptions({
      session: { sessionId: normalizedSessionId },
      executionRoot: workdir,
      terminalEnv: scope.environment || {},
      toolHomeSource: toolHome.toolHomeSource,
      workdir
    });
    const provider = await ensureCodexAppServerDaemonForSession(
      normalizedSessionId,
      providerOptions
    );
    return {
      agentSettings: isRecord(input.agentSettings) ? input.agentSettings : {},
      assistantScope: scope,
      actorMetadata: {},
      economyRestore: null,
      executionRoot: workdir,
      isolationConfig: await codexAppServerEphemeralIsolationConfig(provider, workdir),
      ok: true,
      provider,
      providerOptions,
      runtime: null,
      session: null,
      toolHomeSource: toolHome.toolHomeSource,
      workdir
    };
  }

  async function codexAppServerConversationContext(sessionId = "", input = {}, {
    assistantScope = null,
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    if (!codexAppServerPromptDeliveryEnabled) {
      return codexAppServerControlDisabledResult();
    }
    if (assistantScope) {
      return codexAppServerEphemeralScopeContext(sessionId, input, assistantScope);
    }
    const context = await codexAppServerSessionContext(sessionId, {
      runtime: resolvedRuntime,
      session: resolvedSession
    });
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    if (hasOwn(input, "executionProfile") && !isRecord(input.executionProfile)) {
      throw codexAppServerEconomyOwnershipError(
        "The low-cost assistant execution profile is invalid."
      );
    }
    const economyTurn = isRecord(input.executionProfile);
    const economyRestore = assertCodexAppServerEconomyThreadsRestored(
      await restoreCodexAppServerEconomyThreads({ runtime, session })
    );
    const restoredAdmissionError = codexAppServerAdmissionError(sessionId);
    if (restoredAdmissionError) {
      throw restoredAdmissionError;
    }
    const activeProvider = economyTurn
      ? null
      : await ensureCodexAppServerProviderForActiveTurn(session, {
          executionRoot,
          workdir
        });
    const activeProviderAdmissionError = codexAppServerAdmissionError(sessionId);
    if (activeProviderAdmissionError) {
      throw activeProviderAdmissionError;
    }
    const providerOptions = activeProvider
      ? null
      : await (economyTurn
          ? codexAppServerEconomyRuntimeOptionsForSession
          : codexAppServerRuntimeOptionsForSession)(session, {
        runtime,
        executionRoot,
        toolHomeSource,
        workdir
      });
    const providerOptionsAdmissionError = codexAppServerAdmissionError(sessionId);
    if (providerOptionsAdmissionError) {
      throw providerOptionsAdmissionError;
    }
    const provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
      sessionId,
      providerOptions
    );
    const providerAdmissionError = codexAppServerAdmissionError(sessionId);
    if (providerAdmissionError) {
      throw providerAdmissionError;
    }
    const agentSettings = isRecord(input.agentSettings) ? input.agentSettings : {};
    return {
      ...context,
      agentSettings,
      actorMetadata: isRecord(input.executionProfile)
        ? {}
        : await currentConversationActorMetadata(input.vibe64User || null),
      economyRestore,
      provider
    };
  }

  function codexAppServerModelCatalogSnapshot(value = null) {
    if (!Array.isArray(value?.data)) {
      const error = new Error("Codex did not return a usable live model catalog.");
      error.code = "vibe64_codex_model_catalog_invalid";
      throw error;
    }
    return Object.freeze({
      data: Object.freeze(value.data.map((model = {}) => Object.freeze({
        hidden: model.hidden === true,
        model: normalizeText(model.model),
        supportedReasoningEfforts: Object.freeze((Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
          : []).map((option = {}) => Object.freeze({
          reasoningEffort: normalizeText(option.reasoningEffort)
        })))
      })))
    });
  }

  async function codexAppServerExecutionProfileModelCatalog(sessionId = "", {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null,
    signal = null
  } = {}) {
    if (!codexAppServerPromptDeliveryEnabled) {
      const error = new Error("Codex background work is disabled.");
      error.code = "vibe64_codex_control_disabled";
      throw error;
    }
    const context = await codexAppServerSessionContext(sessionId, {
      runtime: resolvedRuntime,
      session: resolvedSession
    });
    if (context.ok === false) {
      const error = new Error(normalizeText(context.error) || "Codex session is unavailable.");
      Object.assign(error, context);
      throw error;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    assertCodexAppServerEconomyThreadsRestored(
      await restoreCodexAppServerEconomyThreads({ runtime, session })
    );
    const provider = await ensureCodexAppServerDaemonForSession(
      sessionId,
      await codexAppServerEconomyRuntimeOptionsForSession(session, {
        runtime,
        executionRoot,
        toolHomeSource,
        workdir
      })
    );
    if (typeof provider.listModels !== "function") {
      const error = new Error("Codex live model discovery is unavailable.");
      error.code = "vibe64_codex_model_catalog_unavailable";
      throw error;
    }
    const connectionGeneration = codexAppServerProviderConnectionGeneration(provider);
    const now = Date.now();
    const cached = codexAppServerModelCatalogs.get(provider);
    if (
      cached?.connectionGeneration === connectionGeneration &&
      cached.value &&
      cached.expiresAt > now
    ) {
      return cached.value;
    }
    if (
      cached?.connectionGeneration === connectionGeneration &&
      cached.pending
    ) {
      return cached.pending;
    }

    const pending = provider.listModels({
      includeHidden: false,
      limit: 100
    }, { signal }).then((result) => {
      if (codexAppServerProviderConnectionGeneration(provider) !== connectionGeneration) {
        const error = new Error("Codex reconnected while resolving the economy model catalog.");
        error.code = "vibe64_codex_model_catalog_stale";
        throw error;
      }
      return codexAppServerModelCatalogSnapshot(result);
    });
    codexAppServerModelCatalogs.set(provider, {
      connectionGeneration,
      expiresAt: 0,
      pending,
      value: null
    });
    try {
      const value = await pending;
      codexAppServerModelCatalogs.set(provider, {
        connectionGeneration,
        expiresAt: Date.now() + CODEX_APP_SERVER_MODEL_CATALOG_CACHE_MS,
        pending: null,
        value
      });
      return value;
    } catch (error) {
      if (codexAppServerModelCatalogs.get(provider)?.pending === pending) {
        codexAppServerModelCatalogs.delete(provider);
      }
      throw error;
    }
  }

  async function describeCodexAppServerProvider(sessionId = "", {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    const context = await codexAppServerSessionContext(sessionId, {
      runtime: resolvedRuntime,
      session: resolvedSession
    });
    if (context.ok === false) {
      const error = new Error(normalizeText(context.error) || "Codex session is unavailable.");
      Object.assign(error, context);
      throw error;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    assertCodexAppServerEconomyThreadsRestored(
      await restoreCodexAppServerEconomyThreads({ runtime, session })
    );
    const provider = await codexAppServerProviderForSession(
      sessionId,
      await codexAppServerEconomyRuntimeOptionsForSession(session, {
        executionRoot,
        runtime,
        toolHomeSource,
        workdir
      })
    );
    if (typeof provider.currentRuntimeInfo !== "function") {
      throw codexAppServerEconomyOwnershipError(
        "The Codex provider cannot identify the selected account."
      );
    }
    const runtimeInfo = await provider.currentRuntimeInfo();
    const accountIdentitySignature = normalizeText(runtimeInfo?.accountIdentitySignature);
    if (!/^sha256:[a-f0-9]{64}$/u.test(accountIdentitySignature)) {
      throw codexAppServerEconomyOwnershipError(
        "The Codex provider did not return a stable selected-account identity."
      );
    }
    return Object.freeze({
      accountIdentitySignature,
      providerId: "codex",
      transportId: CODEX_APP_SERVER_PROVIDER_ID
    });
  }

  async function codexAppServerAssistantAccess() {
    return readCodexSelectedAccountAccess({ toolHomeSource: codexToolHomeSource });
  }

  async function codexAppServerConversationThreadSettings(context = {}, input = {}) {
    if (context.assistantScope) {
      return {
        ...codexAppServerThreadSettings({
          agentSettings: context.agentSettings,
          config: context.isolationConfig,
          cwd: context.workdir,
          developerInstructions: context.assistantScope.stableContext
        }),
        dynamicTools: [],
        environments: [],
        runtimeWorkspaceRoots: [],
        sandbox: "read-only",
        selectedCapabilityRoots: []
      };
    }
    const conversationKind = input.policy === VIBE64_AGENT_WORKSPACE_WRITE_POLICY
      ? "temporary-task"
      : "temporary-readonly";
    const sessionContext = await codexAppServerSessionInstructions(context.session, {
      conversationKind,
      workdir: context.workdir
    });
    return codexAppServerThreadSettings({
      agentSettings: context.agentSettings,
      cwd: context.workdir,
      developerInstructions: sessionContext.output
    });
  }

  function codexAppServerConversationResponse(text = "") {
    const rawText = String(text || "").trim();
    const outcome = normalizeVibe64AgentTaskResult(rawText);
    return {
      message: outcome?.message || rawText,
      outcome,
      rawText
    };
  }

  function codexAppServerEphemeralConversation(sessionId = "", conversationId = "") {
    return codexAppServerEphemeralConversations.get(
      codexTerminalNamespace(sessionId)
    )?.get(conversationId) || null;
  }

  function codexAppServerConversationTurnIsActive(status = "") {
    return ["starting", "inProgress"].includes(normalizeText(status));
  }

  function codexAppServerEphemeralConversationSnapshot(state = {}) {
    return {
      conversationId: normalizeText(state.conversationId),
      error: normalizeText(state.error),
      message: normalizeText(state.message),
      ok: true,
      outcome: state.outcome || null,
      progressUpdates: Array.isArray(state.progressUpdates)
        ? state.progressUpdates.map((update = {}) => ({
            id: normalizeText(update.id),
            text: normalizeText(update.text)
          })).filter((update) => update.id && update.text)
        : [],
      rawText: normalizeText(state.rawText),
      messageId: normalizeText(state.messageId),
      runId: normalizeText(state.runId),
      status: normalizeText(state.status) || "ready",
      turnMetadata: state.turnMetadata || null
    };
  }

  function codexAppServerExpiredEphemeralConversation(conversationId = "", input = {}) {
    return {
      conversationExpired: true,
      conversationId: normalizeText(conversationId),
      error: "This Temporary AI task ended when Vibe64 restarted. Send the message again to start a new task.",
      message: "",
      ok: true,
      progressUpdates: [],
      rawText: "",
      runId: normalizeText(input.runId),
      status: "failed"
    };
  }

  function appendCodexAppServerEphemeralProgress(state = {}, classification = {}) {
    const rawText = normalizeText(classification.text);
    const taskResult = normalizeVibe64AgentTaskResult(rawText);
    const text = taskResult?.kind === "continue" ? taskResult.message : rawText;
    if (!text) {
      return;
    }
    const progressUpdates = Array.isArray(state.progressUpdates) ? state.progressUpdates : [];
    if (progressUpdates.at(-1)?.text === text) {
      return;
    }
    state.nextProgressSequence = Number(state.nextProgressSequence || 0) + 1;
    state.progressUpdates = [
      ...progressUpdates,
      {
        id: `progress:${state.nextProgressSequence}`,
        text
      }
    ].slice(-CODEX_APP_SERVER_EPHEMERAL_PROGRESS_LIMIT);
  }

  function codexAppServerTurnTokenUsage(notification = {}) {
    if (normalizeText(notification.method) !== "thread/tokenUsage/updated") {
      return null;
    }
    const params = codexAppServerNotificationParams(notification);
    const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : {};
    const turnUsage = isRecord(tokenUsage.last) ? tokenUsage.last : tokenUsage;
    const snapshot = {};
    for (const field of [
      "cachedInputTokens",
      "cacheWriteInputTokens",
      "inputTokens",
      "outputTokens",
      "reasoningOutputTokens",
      "totalTokens"
    ]) {
      const value = Number(turnUsage[field]);
      if (Number.isSafeInteger(value) && value >= 0) {
        snapshot[field] = value;
      }
    }
    return Object.keys(snapshot).length ? Object.freeze(snapshot) : null;
  }

  function createCodexAppServerDetachedTurnWatcher(provider = null, threadId = "", {
    includeThreadHistory = true,
    onEvent = null,
    timeoutMs = CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
  } = {}) {
    const normalizedThreadId = normalizeText(threadId);
    let targetTurnId = "";
    let finalText = "";
    let usage = null;
    let failureDetailTimeout = null;
    let settled = false;
    let timeout = null;
    let connectionCheck = null;
    let unsubscribe = null;
    let pendingCompletionStatus = "";
    let pendingFailure = null;
    let resolveWaiter = null;
    let rejectWaiter = null;

    function cleanup() {
      clearTimeout(timeout);
      timeout = null;
      clearInterval(connectionCheck);
      connectionCheck = null;
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
      if (
        !includeThreadHistory ||
        !normalizedThreadId ||
        !targetTurnId ||
        typeof provider?.readThread !== "function"
      ) {
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
          pendingCompletionStatus = normalizeText(status) || "completed";
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
          turnId: targetTurnId,
          usage
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
          if (timeoutMs > 0) {
            timeout = setTimeout(() => {
              fail(new Error("Timed out waiting for Codex app-server response."));
            }, timeoutMs);
          } else {
            // Interactive repair turns may take longer than bounded helper jobs.
            // Retain their watcher until completion, interruption, or connection loss.
            const generation = provider?.currentConnectionGeneration?.();
            connectionCheck = setInterval(() => {
              if (provider?.isAvailable?.() === false ||
                provider?.currentConnectionGeneration?.() !== generation) {
                fail(new Error("Connection to Codex was lost while the temporary AI was working."));
              }
            }, 1000);
            connectionCheck.unref?.();
          }
          unsubscribe = typeof provider?.subscribe === "function"
            ? provider.subscribe((notification = {}) => {
                if (!notificationMatches(notification)) {
                  return;
                }
                usage = codexAppServerTurnTokenUsage(notification) || usage;
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
                  if (pendingCompletionStatus && targetTurnId) {
                    const status = pendingCompletionStatus;
                    pendingCompletionStatus = "";
                    clearTimeout(failureDetailTimeout);
                    failureDetailTimeout = null;
                    void finishFromCompletion(status);
                  }
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

  function codexAppServerRenewalThreadTurns(thread = null) {
    const rawThread = codexAppServerThreadRawValue(thread || {});
    return (Array.isArray(rawThread.turns) ? rawThread.turns : [])
      .filter((turn) => isRecord(turn));
  }

  function codexAppServerRenewalTurnId(turn = {}) {
    return normalizeText(turn.id || turn.turnId || turn.turn_id || turn.turn?.id);
  }

  function codexAppServerRenewalTurnStatus(turn = {}) {
    return codexAppServerStatusFromValue(turn.status || turn.state);
  }

  function codexAppServerRenewalTurnItems(turn = {}) {
    return [
      ...(Array.isArray(turn.items) ? turn.items : []),
      ...(Array.isArray(turn.itemsView) ? turn.itemsView : [])
    ].filter((item) => isRecord(item));
  }

  function codexAppServerRenewalTurnClientIds(turn = {}) {
    return codexAppServerRenewalTurnItems(turn)
      .map((item) => normalizeText(
        item.clientId ||
        item.client_id ||
        item.clientUserMessageId ||
        item.client_user_message_id
      ))
      .filter(Boolean);
  }

  function codexAppServerProviderTurnForOperation(thread = null, {
    clientMessageId = "",
    turnId = ""
  } = {}) {
    const normalizedTurnId = normalizeText(turnId);
    const normalizedClientMessageId = normalizeText(clientMessageId);
    const turns = codexAppServerRenewalThreadTurns(thread);
    if (normalizedTurnId) {
      return turns.find((turn) => (
        codexAppServerRenewalTurnId(turn) === normalizedTurnId
      )) || null;
    }
    if (!normalizedClientMessageId) {
      return null;
    }
    return [...turns].reverse().find((turn) => (
      codexAppServerRenewalTurnClientIds(turn).includes(normalizedClientMessageId)
    )) || null;
  }

  function codexAppServerRenewalTurnText(thread = null, turnId = "") {
    return codexAppServerProviderThreadAssistantSegments(thread || {}, turnId)
      .map((segment) => segment.text)
      .join("\n\n")
      .trim();
  }

  function codexAppServerRenewalTurnError(turn = {}) {
    return codexAppServerErrorText(turn.error || turn.status?.error || turn.state?.error);
  }

  function codexAppServerRenewalError(code, message, details = {}, {
    retryable = false
  } = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = {
      ...details,
      retryable
    };
    error.retryable = retryable;
    return error;
  }

  function codexAppServerRenewalErrorWithIdentity(error, identity = {}) {
    const source = error instanceof Error ? error : new Error(errorMessage(error));
    if (!normalizeText(source.code)) {
      source.code = "vibe64_session_renewal_turn_failed";
      source.retryable = true;
    }
    source.details = {
      ...(isRecord(source.details) ? source.details : {}),
      clientMessageId: normalizeText(identity.clientMessageId),
      ...(identity.handoverPromptAccepted === true
        ? { handoverPromptAccepted: true }
        : {}),
      operationId: normalizeText(identity.operationId),
      retryable: source.retryable === true,
      threadId: normalizeText(identity.threadId),
      turnId: normalizeText(identity.turnId)
    };
    return source;
  }

  async function writeCodexAppServerRenewalMetadata(runtime, sessionId = "", values = {}, {
    renewalInternal = false
  } = {}) {
    const entries = Object.entries(isRecord(values) ? values : {})
      .map(([name, value]) => [normalizeText(name), normalizeText(value)])
      .filter(([name]) => name.startsWith("agent_renewal_"));
    if (!entries.length) {
      return;
    }
    const mutateSession = renewalInternal
      ? runtime.store.mutateSessionForRenewal?.bind(runtime.store)
      : runtime.store.mutateSession?.bind(runtime.store);
    const writeMetadataValue = renewalInternal
      ? runtime.store.writeMetadataValueForRenewal?.bind(runtime.store)
      : runtime.store.writeMetadataValue?.bind(runtime.store);
    if (typeof mutateSession !== "function" || typeof writeMetadataValue !== "function") {
      throw new TypeError(renewalInternal
        ? "Renewed assistant metadata requires explicit internal renewal access."
        : "Assistant renewal metadata access is unavailable.");
    }
    await mutateSession(sessionId, async () => {
      await Promise.all(entries.map(([name, value]) => (
        writeMetadataValue(sessionId, name, value)
      )));
    });
  }

  function codexAppServerRenewalAgentSettings(session = {}) {
    // Renewal is continuity work, never a caller-selectable low-cost task.
    // Preserve the session's recorded interactive settings and otherwise let
    // the ordinary high-quality Codex defaults apply.
    return codexAgentSettingsFromSession(session);
  }

  async function waitForCodexAppServerRenewalTurn(provider, threadId = "", turn = null, {
    timeoutMs = CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS
  } = {}) {
    const normalizedThreadId = normalizeText(threadId);
    const turnId = codexAppServerRenewalTurnId(turn || {});
    const status = codexAppServerRenewalTurnStatus(turn || {});
    if (!normalizedThreadId || !turnId) {
      throw codexAppServerRenewalError(
        "vibe64_session_renewal_turn_identity_missing",
        "Codex did not return the exact session renewal turn identity.",
        { threadId: normalizedThreadId, turnId }
      );
    }
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      throw codexAppServerRenewalError(
        "vibe64_session_renewal_turn_failed",
        codexAppServerRenewalTurnError(turn || {}) || `Codex session renewal turn ${status}.`,
        { status, threadId: normalizedThreadId, turnId },
        { retryable: true }
      );
    }
    const existingText = codexAppServerRenewalTurnText({
      raw: { turns: [turn] }
    }, turnId);
    if (codexAppServerTurnStatusIsSuccessfulComplete(status) && existingText) {
      return {
        status,
        text: existingText,
        threadId: normalizedThreadId,
        turnId,
        usage: null
      };
    }
    const watcher = createCodexAppServerDetachedTurnWatcher(provider, normalizedThreadId, {
      timeoutMs
    });
    watcher.setTurnId(turnId);
    const pending = watcher.wait();
    void pending.catch(() => null);
    if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await watcher.completeNow(status);
    } else if (typeof provider?.readThread === "function") {
      const latestThread = await provider.readThread(normalizedThreadId);
      const latestTurn = codexAppServerProviderTurnForOperation(latestThread, { turnId });
      const latestStatus = codexAppServerRenewalTurnStatus(latestTurn || {});
      if (codexAppServerTurnStatusIsProviderFailure(latestStatus)) {
        watcher.failNow(codexAppServerRenewalError(
          "vibe64_session_renewal_turn_failed",
          codexAppServerRenewalTurnError(latestTurn || {}) || `Codex session renewal turn ${latestStatus}.`,
          { status: latestStatus, threadId: normalizedThreadId, turnId },
          { retryable: true }
        ));
      } else if (codexAppServerTurnStatusIsSuccessfulComplete(latestStatus)) {
        await watcher.completeNow(latestStatus);
      }
    }
    return pending;
  }

  async function generateCodexSessionRenewalHandover(sessionId = "", input = {}, {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    return vibe64Result(async () => {
      if (hasOwn(input, "executionProfile")) {
        throw codexAppServerRenewalError(
          "vibe64_session_renewal_interactive_provider_required",
          "Session handover generation must use the old session's normal interactive assistant settings."
        );
      }
      const operationId = defineSessionRenewalOperationId(
        input.operationId || input.operationKey
      );
      const source = defineSessionRenewalSourceEnvelope(input.source);
      const clientMessageId = sessionRenewalClientMessageId("handover", operationId);
      const context = await codexAppServerConversationContext(sessionId, input, {
        runtime: resolvedRuntime,
        session: resolvedSession
      });
      if (context.ok === false) {
        return context;
      }
      const {
        executionRoot,
        provider,
        runtime,
        session,
        toolHomeSource,
        workdir
      } = context;
      const agentSettings = codexAppServerRenewalAgentSettings(session);
      const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
      const developerInstructions = (await codexAppServerSessionInstructions(
        session,
        { workdir }
      )).output;
      const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
        runtime,
        executionRoot,
        toolHomeSource,
        workdir
      });
      const resumed = await resumeExactCodexAppServerThreadForSession({
        agentSettings,
        developerInstructions,
        expectedThreadId: input.expectedThreadId || input.threadId,
        provider,
        session,
        workdir
      });
      const threadId = resumed.threadId;
      const metadata = session.metadata || {};
      const sameOperation = normalizeText(metadata.agent_renewal_handover_operation_id) === operationId;
      const expectedTurnId = normalizeText(input.expectedTurnId) || (
        sameOperation ? normalizeText(metadata.agent_renewal_handover_turn_id) : ""
      );
      const snapshotTurns = codexAppServerRenewalThreadTurns(resumed.threadSnapshot);
      let targetTurn = codexAppServerProviderTurnForOperation(resumed.threadSnapshot, {
        clientMessageId,
        turnId: expectedTurnId
      });
      if (expectedTurnId && !targetTurn) {
        throw codexAppServerRenewalErrorWithIdentity(
          codexAppServerRenewalError(
            "vibe64_session_renewal_thread_unreadable",
            "The exact handover turn is no longer readable. Write or edit the handover manually instead.",
            { reason: "exact_handover_turn_missing" },
            { retryable: false }
          ),
          { clientMessageId, operationId, threadId, turnId: expectedTurnId }
        );
      }
      if (!targetTurn && snapshotTurns.length === 0) {
        throw codexAppServerRenewalErrorWithIdentity(
          codexAppServerRenewalError(
            "vibe64_session_renewal_thread_unreadable",
            "The old assistant thread has no readable conversation history. Write or edit the handover manually instead.",
            {},
            { retryable: false }
          ),
          { clientMessageId, operationId, threadId }
        );
      }

      subscribeCodexAppServerEvents(sessionId, provider, threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        providerOptions,
        sessionId,
        executionRoot,
        threadId,
        workdir
      });

      let result = null;
      let reconciled = Boolean(targetTurn);
      let turnId = codexAppServerRenewalTurnId(targetTurn || {});
      if (targetTurn) {
        try {
          result = await waitForCodexAppServerRenewalTurn(
            provider,
            threadId,
            targetTurn
          );
        } catch (error) {
          throw codexAppServerRenewalErrorWithIdentity(error, {
            clientMessageId,
            operationId,
            threadId,
            turnId
          });
        }
      } else {
        const claim = await claimCodexAppServerTurnStart(
          runtime,
          sessionId,
          clientMessageId,
          { inputSource: "session_renewal_handover" }
        );
        if (!claim?.claimed) {
          return claim?.response || {
            code: CODEX_AGENT_TURN_ALREADY_RUNNING_CODE,
            error: "Codex is already working on this Vibe64 session.",
            ok: false
          };
        }
        // The exact old thread is already known before prompt delivery. Bind
        // it to the durable claim now, so an immediate provider response can
        // supply the turn id and complete the run even when its notifications
        // arrive before sendTurn() returns.
        await markCodexAppServerTurnActive(sessionId, {
          status: "starting",
          threadId
        });
        await writeCodexAppServerRenewalMetadata(runtime, sessionId, {
          agent_renewal_handover_client_message_id: clientMessageId,
          agent_renewal_handover_operation_id: operationId,
          agent_renewal_handover_thread_id: threadId
        });
        await writeCodexAppServerUserMessageOwnership(
          runtime.store,
          sessionId,
          clientMessageId,
          {
            eventKind: "codex-app-server-renewal-handover-owned",
            owned: true
          }
        );
        const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
          timeoutMs: CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS
        });
        const pending = watcher.wait();
        void pending.catch(() => null);
        let delivery = null;
        let status = "";
        try {
          delivery = await sendCodexAppServerPromptForSession({
            agentSettings,
            clientUserMessageId: clientMessageId,
            prompt: sessionRenewalHandoverPrompt({ source }),
            provider,
            threadId,
            workdir
          });
          turnId = normalizeText(delivery.turn?.id);
          status = normalizeText(delivery.turn?.status || delivery.turn?.raw?.status);
          if (!turnId) {
            throw codexAppServerRenewalError(
              "vibe64_session_renewal_turn_identity_missing",
              "Codex accepted the handover request without returning its exact turn id."
            );
          }
          await writeCodexAppServerRenewalMetadata(runtime, sessionId, {
            agent_renewal_handover_turn_id: turnId
          });
          await markCodexAppServerTurnActive(sessionId, {
            requireTrackedTurn: true,
            status: "inProgress",
            threadId,
            turnId
          });
          watcher.setTurnId(turnId);
          if (codexAppServerTurnStatusIsProviderFailure(status)) {
            watcher.failAfterDetailGrace(codexAppServerRenewalError(
              "vibe64_session_renewal_turn_failed",
              codexAppServerRenewalTurnError(delivery.turn || {}) || `Codex session renewal turn ${status}.`,
              { status },
              { retryable: true }
            ));
          } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
            await watcher.completeNow(status);
          }
          result = await pending;
        } catch (error) {
          watcher.failNow(error);
          await writeCodexAppServerUserMessageOwnership(
            runtime.store,
            sessionId,
            clientMessageId,
            {
              eventKind: "codex-app-server-renewal-handover-released",
              owned: false
            }
          );
          await markCodexAppServerTurnIdle(sessionId, {
            error: errorMessage(error, "Codex handover generation failed."),
            status: "failed",
            threadId,
            turnId
          });
          throw codexAppServerRenewalErrorWithIdentity(error, {
            clientMessageId,
            operationId,
            threadId,
            turnId
          });
        }
      }

      await drainCodexAppServerNotificationTasks(sessionId);
      if (codexAppServerTurnStatusIsSuccessfulComplete(result.status)) {
        // A reconciled turn may already be complete before this process
        // subscribes, so no completion notification is guaranteed. Route it
        // through the ordinary finalizer as well; its turn identity guards
        // make the live-notification case an idempotent no-op.
        await completeCodexAppServerTurn(
          sessionId,
          threadId,
          result.turnId || turnId,
          {
            provider,
            status: result.status,
            verifyInactive: false
          }
        );
      }
      let parsed = null;
      try {
        parsed = parseSessionRenewalHandoverOutput(result.text, { source });
      } catch (error) {
        error.details = {
          ...(isRecord(error.details) ? error.details : {}),
          rawOutput: normalizeText(result.text)
        };
        throw codexAppServerRenewalErrorWithIdentity(error, {
          clientMessageId,
          operationId,
          threadId,
          turnId: result.turnId || turnId
        });
      }
      await writeCodexAppServerRenewalMetadata(runtime, sessionId, {
        agent_renewal_handover_hash: parsed.handoverHash,
        agent_renewal_handover_turn_id: result.turnId || turnId
      });
      return {
        ...parsed,
        agentSettings: effectiveSettings,
        clientMessageId,
        ok: true,
        operationId,
        reconciled,
        source,
        threadId,
        turnId: normalizeText(result.turnId || turnId),
        usage: result.usage || null
      };
    });
  }

  async function seedCodexSessionRenewalHandover(sessionId = "", input = {}, {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    return vibe64Result(async () => {
      if (hasOwn(input, "executionProfile")) {
        throw codexAppServerRenewalError(
          "vibe64_session_renewal_interactive_provider_required",
          "A renewed session must start with normal interactive assistant settings."
        );
      }
      const operationId = defineSessionRenewalOperationId(
        input.operationId || input.operationKey
      );
      const approved = defineSessionRenewalApprovedHandover({
        handover: input.handover,
        handoverHash: input.handoverHash,
        source: input.source
      });
      const oldThreadId = normalizeText(input.oldThreadId || input.forbiddenThreadId);
      const clientMessageId = sessionRenewalClientMessageId("seed", operationId);
      const context = await codexAppServerConversationContext(sessionId, input, {
        runtime: resolvedRuntime,
        session: resolvedSession
      });
      if (context.ok === false) {
        return context;
      }
      const {
        provider,
        runtime,
        session,
        workdir
      } = context;
      const agentSettings = codexAppServerRenewalAgentSettings(session);
      const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
      const developerInstructions = (await codexAppServerSessionInstructions(
        session,
        { workdir }
      )).output;
      const started = await startFreshCodexAppServerThreadForSession({
        additionalMetadata: {
          agent_renewal_seed_handover_hash: approved.handoverHash
        },
        agentSettings,
        developerInstructions,
        expectedThreadId: input.expectedThreadId || input.threadId,
        forbiddenThreadId: oldThreadId,
        operationId,
        provider,
        readOnly: true,
        runtime,
        session,
        workdir
      });
      const threadId = started.threadId;
      const currentSession = {
        ...session,
        metadata: {
          ...(session.metadata || {}),
          agent_identity_conversation_id: threadId,
          agent_renewal_seed_operation_id: operationId
        }
      };
      const metadata = currentSession.metadata;
      const sameOperation = normalizeText(metadata.agent_renewal_seed_operation_id) === operationId;
      const expectedTurnId = normalizeText(input.expectedTurnId) || (
        sameOperation ? normalizeText(metadata.agent_renewal_seed_turn_id) : ""
      );
      const snapshotTurns = codexAppServerRenewalThreadTurns(started.threadSnapshot);
      let targetTurn = codexAppServerProviderTurnForOperation(started.threadSnapshot, {
        clientMessageId,
        turnId: expectedTurnId
      });
      if (expectedTurnId && !targetTurn) {
        throw codexAppServerRenewalErrorWithIdentity(
          codexAppServerRenewalError(
            "vibe64_session_renewal_turn_unreadable",
            "The exact successor acknowledgement turn is no longer readable.",
            {},
            { retryable: false }
          ),
          { clientMessageId, operationId, threadId, turnId: expectedTurnId }
        );
      }
      if (
        snapshotTurns.some((turn) => (
          !targetTurn || codexAppServerRenewalTurnId(turn) !== codexAppServerRenewalTurnId(targetTurn)
        ))
      ) {
        throw codexAppServerRenewalErrorWithIdentity(
          codexAppServerRenewalError(
            "vibe64_session_renewal_fresh_thread_required",
            "The successor assistant thread contains unrelated conversation and cannot be used for renewal."
          ),
          {
            clientMessageId,
            operationId,
            threadId,
            turnId: codexAppServerRenewalTurnId(targetTurn || {})
          }
        );
      }

      let result = null;
      let turnId = codexAppServerRenewalTurnId(targetTurn || {});
      const reconciled = Boolean(targetTurn);
      if (targetTurn) {
        try {
          result = await waitForCodexAppServerRenewalTurn(provider, threadId, targetTurn);
        } catch (error) {
          throw codexAppServerRenewalErrorWithIdentity(error, {
            clientMessageId,
            handoverPromptAccepted: true,
            operationId,
            threadId,
            turnId
          });
        }
      } else {
        await writeCodexAppServerRenewalMetadata(runtime, sessionId, {
          agent_renewal_seed_client_message_id: clientMessageId,
          agent_renewal_seed_operation_id: operationId,
          agent_renewal_seed_thread_id: threadId
        }, { renewalInternal: true });
        const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
          timeoutMs: CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS
        });
        const pending = watcher.wait();
        void pending.catch(() => null);
        let delivery = null;
        let handoverPromptAccepted = false;
        let status = "";
        try {
          delivery = await sendCodexAppServerPromptForSession({
            agentSettings,
            clientUserMessageId: clientMessageId,
            outputSchema: sessionRenewalAcknowledgementOutputSchema({
              handoverHash: approved.handoverHash,
              source: approved.source
            }),
            prompt: sessionRenewalSeedPrompt(approved),
            provider,
            readOnly: true,
            threadId,
            workdir
          });
          turnId = normalizeText(delivery.turn?.id);
          status = normalizeText(delivery.turn?.status || delivery.turn?.raw?.status);
          if (!turnId) {
            throw codexAppServerRenewalError(
              "vibe64_session_renewal_turn_identity_missing",
              "Codex accepted the successor handover without returning its exact turn id."
            );
          }
          handoverPromptAccepted = true;
          await writeCodexAppServerRenewalMetadata(runtime, sessionId, {
            agent_renewal_seed_turn_id: turnId
          }, { renewalInternal: true });
          watcher.setTurnId(turnId);
          if (codexAppServerTurnStatusIsProviderFailure(status)) {
            watcher.failAfterDetailGrace(codexAppServerRenewalError(
              "vibe64_session_renewal_turn_failed",
              codexAppServerRenewalTurnError(delivery.turn || {}) || `Codex session renewal turn ${status}.`,
              { status },
              { retryable: true }
            ));
          } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
            await watcher.completeNow(status);
          }
          result = await pending;
        } catch (error) {
          watcher.failNow(error);
          throw codexAppServerRenewalErrorWithIdentity(error, {
            clientMessageId,
            handoverPromptAccepted,
            operationId,
            threadId,
            turnId
          });
        }
      }

      let acknowledgement = null;
      try {
        acknowledgement = parseSessionRenewalAcknowledgement(result.text, {
          handoverHash: approved.handoverHash,
          source: approved.source
        });
      } catch (error) {
        error.details = {
          ...(isRecord(error.details) ? error.details : {}),
          rawOutput: normalizeText(result.text)
        };
        throw codexAppServerRenewalErrorWithIdentity(error, {
          clientMessageId,
          handoverPromptAccepted: true,
          operationId,
          threadId,
          turnId: result.turnId || turnId
        });
      }
      const acknowledgedAt = new Date().toISOString();
      if (
        typeof runtime.store.mutateSessionForRenewal !== "function" ||
        typeof runtime.store.writeMetadataValueForRenewal !== "function"
      ) {
        throw new TypeError("Renewed assistant acknowledgement requires explicit internal renewal metadata access.");
      }
      await runtime.store.mutateSessionForRenewal(sessionId, async () => {
        const writeMetadataValue = runtime.store.writeMetadataValueForRenewal.bind(runtime.store);
        await Promise.all([
          writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
          writeMetadataValue(sessionId, "agent_briefing_delivered_at", acknowledgedAt),
          writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server"),
          writeMetadataValue(
            sessionId,
            CODEX_SESSION_BRIEFING_FINGERPRINT_METADATA,
            codexSessionBriefingFingerprint(developerInstructions)
          ),
          writeMetadataValue(sessionId, "agent_settings_model", effectiveSettings.model),
          writeMetadataValue(sessionId, "agent_settings_provider", effectiveSettings.providerId),
          writeMetadataValue(sessionId, "agent_settings_thinking", effectiveSettings.thinking),
          writeMetadataValue(sessionId, "agent_renewal_seed_acknowledged_at", acknowledgedAt),
          writeMetadataValue(sessionId, "agent_renewal_seed_handover_hash", approved.handoverHash),
          writeMetadataValue(sessionId, "agent_renewal_seed_operation_id", operationId),
          writeMetadataValue(sessionId, "agent_renewal_seed_thread_id", threadId),
          writeMetadataValue(sessionId, "agent_renewal_seed_turn_id", result.turnId || turnId)
        ]);
      });
      // The successor remains intentionally hidden until the sessions service
      // commits its renewal transition. Ordinary subscription and realtime
      // reconciliation start only after that transition exposes the session.
      return {
        acknowledgement,
        acknowledgedAt,
        agentSettings: effectiveSettings,
        clientMessageId,
        freshThread: started.fresh,
        handoverHash: approved.handoverHash,
        ok: true,
        operationId,
        reconciled,
        source: approved.source,
        subscriptionDeferred: true,
        threadId,
        turnId: normalizeText(result.turnId || turnId),
        usage: result.usage || null
      };
    });
  }

  async function runDetachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    return detachedCodexAppServerChatTurn(sessionId, input, options);
  }

  async function createCodexAppServerConversation(sessionId, input = {}, options = {}) {
    return vibe64Result(async () => {
      const context = await codexAppServerConversationContext(sessionId, input, options);
      if (context.ok === false) {
        return context;
      }
      const threadSettings = await codexAppServerConversationThreadSettings(context, input);
      const thread = await context.provider.startThread({
        ...threadSettings,
        ...(input.ephemeral === true ? { ephemeral: true } : {})
      });
      const conversationId = normalizeText(thread.id || thread.response?.thread?.id);
      if (!conversationId) {
        throw new Error("Codex app-server did not return a conversation id.");
      }
      if (input.ephemeral === true) {
        const sessionKey = codexTerminalNamespace(sessionId);
        const conversations = codexAppServerEphemeralConversations.get(sessionKey) || new Map();
        conversations.set(conversationId, {
          conversationId,
          error: "",
          message: "",
          messageId: "",
          nextProgressSequence: 0,
          outcome: null,
          progressUpdates: [],
          rawText: "",
          runId: "",
          status: "ready",
          turnMetadata: null,
          watcher: null,
          workspaceWrite: false
        });
        codexAppServerEphemeralConversations.set(sessionKey, conversations);
      }
      return {
        conversationId,
        ok: true,
        status: "ready"
      };
    });
  }

  async function startCodexAppServerConversationTurn(sessionId, input = {}, options = {}) {
    const messageId = normalizeText(input.messageId);
    const deliveryKey = messageId
      ? `${codexTerminalNamespace(sessionId)}\0${normalizeText(input.conversationId)}\0${messageId}`
      : "";
    const existing = deliveryKey ? codexAppServerConversationTurnStarts.get(deliveryKey) : null;
    if (existing) {
      return existing;
    }
    const start = vibe64Result(async () => {
      const conversationId = normalizeText(input.conversationId);
      const prompt = normalizeText(input.message || input.prompt);
      if (!conversationId || !prompt) {
        return {
          code: "vibe64_agent_conversation_turn_input_required",
          error: "Assistant conversation turns require a conversation and message.",
          ok: false
        };
      }
      const workspaceWrite = input.policy === VIBE64_AGENT_WORKSPACE_WRITE_POLICY;
      const context = await codexAppServerConversationContext(sessionId, input, options);
      if (context.ok === false) {
        return context;
      }
      const ephemeralConversation = codexAppServerEphemeralConversation(sessionId, conversationId);
      if (input.ephemeral === true && !ephemeralConversation) {
        return {
          ...codexAppServerExpiredEphemeralConversation(conversationId, input),
          code: "vibe64_temporary_conversation_expired",
          ok: false,
        };
      }
      if (ephemeralConversation && messageId && ephemeralConversation.messageId === messageId) {
        return codexAppServerEphemeralConversationSnapshot(ephemeralConversation);
      }
      if (ephemeralConversation && codexAppServerConversationTurnIsActive(ephemeralConversation.status)) {
        return {
          code: "vibe64_temporary_conversation_turn_active",
          error: "Temporary AI is already working on this conversation.",
          ok: false
        };
      }
      if (!ephemeralConversation || context.assistantScope) {
        const threadSettings = await codexAppServerConversationThreadSettings(context, input);
        await context.provider.resumeThread(conversationId, threadSettings);
      }
      let watcher = null;
      let waitForResult = null;
      if (ephemeralConversation) {
        Object.assign(ephemeralConversation, {
          error: "",
          message: "",
          messageId,
          outcome: null,
          progressUpdates: [],
          rawText: "",
          runId: "",
          status: "starting",
          turnMetadata: context.actorMetadata,
          workspaceWrite
        });
        watcher = createCodexAppServerDetachedTurnWatcher(context.provider, conversationId, {
          includeThreadHistory: false,
          timeoutMs: 0,
          onEvent(classification = {}) {
            const current = codexAppServerEphemeralConversation(sessionId, conversationId);
            if (!current || (classification.turnId && current.runId && classification.turnId !== current.runId)) {
              return;
            }
            if (["live_progress", "thinking"].includes(classification.kind)) {
              appendCodexAppServerEphemeralProgress(current, classification);
            }
          }
        });
        waitForResult = watcher.wait();
        void waitForResult.catch(() => null);
        ephemeralConversation.watcher = watcher;
      }
      let delivery = null;
      try {
        delivery = await sendCodexAppServerPromptForSession({
          agentSettings: context.agentSettings,
          outputSchema: workspaceWrite ? VIBE64_AGENT_TASK_RESULT_SCHEMA : null,
          prompt,
          attachments: input.attachments,
          provider: context.provider,
          readOnly: Boolean(context.assistantScope),
          threadId: conversationId,
          workdir: context.workdir
        });
      } catch (error) {
        watcher?.failNow(error);
        await waitForResult?.catch(() => null);
        if (ephemeralConversation) {
          Object.assign(ephemeralConversation, {
            error: errorMessage(error, "Temporary AI message could not be sent."),
            status: "failed",
            watcher: null
          });
        }
        throw error;
      }
      const runId = normalizeText(delivery.turn?.id);
      const status = normalizeText(delivery.turn?.status || delivery.turn?.raw?.status);
      if (!runId) {
        watcher?.failNow(new Error("Codex app-server accepted a conversation turn without returning its id."));
        await waitForResult?.catch(() => null);
        throw new Error("Codex app-server accepted a conversation turn without returning its id.");
      }
      if (ephemeralConversation) {
        Object.assign(ephemeralConversation, {
          runId,
          status: codexAppServerTurnStatusIsSuccessfulComplete(status) ? status : "inProgress"
        });
        watcher.setTurnId(runId);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          watcher.failNow(new Error(`Codex app-server turn ${status}.`));
        } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          await watcher.completeNow(status);
        }
        void waitForResult.then((result = {}) => {
          const current = codexAppServerEphemeralConversation(sessionId, conversationId);
          if (!current || current.runId !== runId) {
            return;
          }
          const response = codexAppServerConversationResponse(result.text);
          Object.assign(current, {
            error: "",
            ...response,
            status: result.status || "completed",
            watcher: null
          });
        }).catch((error) => {
          const current = codexAppServerEphemeralConversation(sessionId, conversationId);
          if (!current || current.runId !== runId || current.status === "interrupted") {
            return;
          }
          Object.assign(current, {
            error: errorMessage(error, "Temporary AI turn failed."),
            status: "failed",
            watcher: null
          });
        });
      }
      return {
        conversationId,
        messageId,
        ok: true,
        runId,
        status
      };
    });
    if (deliveryKey) {
      codexAppServerConversationTurnStarts.set(deliveryKey, start);
    }
    try {
      return await start;
    } finally {
      if (deliveryKey && codexAppServerConversationTurnStarts.get(deliveryKey) === start) {
        codexAppServerConversationTurnStarts.delete(deliveryKey);
      }
    }
  }

  async function readCodexAppServerConversation(sessionId, input = {}, options = {}) {
    return vibe64Result(async () => {
      const conversationId = normalizeText(input.conversationId);
      if (!conversationId) {
        return {
          code: "vibe64_agent_conversation_id_required",
          error: "Assistant conversation id is required.",
          ok: false
        };
      }
      const ephemeralConversation = codexAppServerEphemeralConversation(sessionId, conversationId);
      if (ephemeralConversation) {
        return codexAppServerEphemeralConversationSnapshot(ephemeralConversation);
      }
      if (input.ephemeral === true) {
        return codexAppServerExpiredEphemeralConversation(conversationId, input);
      }
      const context = await codexAppServerConversationContext(sessionId, input, options);
      if (context.ok === false) {
        return context;
      }
      const thread = await context.provider.readThread(conversationId);
      const runId = normalizeText(input.runId) || codexAppServerThreadTurnId(thread);
      const status = codexAppServerThreadStatus(thread);
      const text = runId
        ? codexAppServerProviderThreadAssistantSegments(thread, runId)
          .map((segment) => segment.text)
          .join("\n\n")
        : "";
      return {
        conversationId,
        error: codexAppServerThreadError(thread),
        ok: true,
        runId,
        status,
        ...codexAppServerConversationResponse(text)
      };
    });
  }

  async function waitForCodexAppServerConversationTurn(sessionId, input = {}, {
    assistantScope = null,
    onEvent = null
  } = {}) {
    return vibe64Result(async () => {
      const conversationId = normalizeText(input.conversationId);
      const runId = normalizeText(input.runId);
      if (!conversationId || !runId) {
        return {
          code: "vibe64_agent_conversation_run_required",
          error: "Waiting for an assistant conversation requires conversation and run ids.",
          ok: false
        };
      }
      const context = await codexAppServerConversationContext(sessionId, input, {
        assistantScope
      });
      if (context.ok === false) {
        return context;
      }
      const watcher = createCodexAppServerDetachedTurnWatcher(context.provider, conversationId, {
        onEvent,
        timeoutMs: Number(input.timeoutMs || 0) > 0
          ? Number(input.timeoutMs)
          : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
      });
      const waitForResult = watcher.wait();
      watcher.setTurnId(runId);
      const current = await context.provider.readThread(conversationId);
      const status = codexAppServerThreadStatus(current);
      if (codexAppServerTurnStatusIsProviderFailure(status)) {
        watcher.failNow(new Error(
          codexAppServerThreadError(current) || `Codex app-server turn ${status}.`
        ));
      } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
        await watcher.completeNow(status);
      }
      const result = await waitForResult;
      return {
        conversationId,
        ok: true,
        runId,
        status: result.status || status || "completed",
        ...codexAppServerConversationResponse(result.text)
      };
    });
  }

  async function stopCodexAppServerConversation(sessionId, input = {}, options = {}) {
    const conversationId = normalizeText(input.conversationId);
    const ephemeralConversation = codexAppServerEphemeralConversation(sessionId, conversationId);
    if (input.ephemeral === true && !ephemeralConversation) {
      return {
        conversationExpired: true,
        conversationId,
        ok: true,
        runId: normalizeText(input.runId),
        status: "interrupted"
      };
    }
    const result = await interruptDetachedCodexAppServerChatTurn(sessionId, {
      threadId: input.conversationId,
      turnId: input.runId
    }, options);
    if (result.ok !== false && ephemeralConversation) {
      ephemeralConversation.status = "interrupted";
      ephemeralConversation.watcher?.failNow(new Error("Temporary AI turn was stopped."));
      ephemeralConversation.watcher = null;
    }
    return {
      ...result,
      conversationId,
      runId: normalizeText(input.runId)
    };
  }

  async function deleteCodexAppServerConversation(sessionId, input = {}, options = {}) {
    const conversationId = normalizeText(input.conversationId);
    const sessionKey = codexTerminalNamespace(sessionId);
    const conversations = codexAppServerEphemeralConversations.get(sessionKey);
    const conversationExpired = input.ephemeral === true && !conversations?.has(conversationId);
    let result;
    if (conversationExpired) {
      result = {
        conversationExpired: true
      };
    } else {
      result = await deleteDetachedCodexAppServerChatThread(sessionId, {
        threadId: input.conversationId
      }, options);
      if (result.ok === false) {
        return { ...result, conversationId };
      }
      conversations?.get(conversationId)?.watcher?.failNow(new Error("Temporary AI conversation was closed."));
      conversations?.delete(conversationId);
      if (conversations?.size === 0) {
        codexAppServerEphemeralConversations.delete(sessionKey);
      }
    }
    let providerExit = null;
    if (options.assistantScope) {
      const context = await codexAppServerEphemeralScopeContext(
        sessionId,
        input,
        options.assistantScope
      );
      if (context.ok === false) {
        return context;
      }
      providerExit = await stopCodexAppServerProviderForSession(
        sessionId,
        context.providerOptions,
        { requireStopped: true }
      );
    }
    return {
      ...result,
      conversationId,
      ok: conversationExpired ? providerExit?.ok !== false : result?.ok !== false,
      ...(providerExit ? { providerExit } : {})
    };
  }

  async function cleanupCodexAppServerEphemeralConversations(sessionId) {
    const sessionKey = codexTerminalNamespace(sessionId);
    const conversationIds = [...(codexAppServerEphemeralConversations.get(sessionKey)?.keys() || [])];
    for (const conversationId of conversationIds) {
      await deleteCodexAppServerConversation(sessionId, { conversationId }).catch(() => null);
    }
    codexAppServerEphemeralConversations.delete(sessionKey);
  }

  async function startAndRememberCodexAppServerEconomyThread({
    context = {},
    executionProfile = null,
    projectRuntimeRoot = "",
    provider = null,
    sessionId = "",
    workdir = ""
  } = {}) {
    return withCodexAppServerEconomyProjectOperation(projectRuntimeRoot, async () => {
      const projectContextRoot = normalizeText(context.runtime?.projectContextRoot);
      let thread = null;
      try {
        const started = await startCodexAppServerEconomyThread({
          executionProfile,
          provider
        });
        thread = started.thread;
      } catch (error) {
        const failedThreadId = normalizeText(error?.codexAppServerEconomyThreadId);
        if (
          error?.codexAppServerEconomyThreadCleanupRequired === true &&
          failedThreadId
        ) {
          await rememberCodexAppServerEconomyThread({
            executionProfile,
            lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.CLEANUP_REQUIRED,
            projectContextRoot,
            projectRuntimeRoot,
            provider,
            sessionId,
            threadId: failedThreadId,
            workdir
          });
        }
        throw error;
      }
      const threadId = normalizeText(thread?.id || thread?.response?.thread?.id);
      if (!threadId) {
        throw new Error("Codex app-server did not return an economy thread id.");
      }
      try {
        const record = await rememberCodexAppServerEconomyThread({
          executionProfile,
          lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.STARTING_TURN,
          projectContextRoot,
          projectRuntimeRoot,
          provider,
          sessionId,
          threadId,
          workdir
        });
        return { record, thread, threadId };
      } catch (ledgerError) {
        try {
          const deletion = await provider.deleteThread(threadId);
          if (!isRecord(deletion)) {
            throw new Error("Codex app-server returned an invalid thread deletion result.");
          }
        } catch (cleanupError) {
          const failure = codexAppServerEconomyOwnershipError(
            "Vibe64 could not persist or retire a newly created low-cost assistant thread.",
            {
              cleanupError: errorMessage(cleanupError),
              ledgerError: errorMessage(ledgerError),
              sessionId,
              threadId
            }
          );
          failure.cause = ledgerError;
          throw failure;
        }
        throw ledgerError;
      }
    });
  }

  async function streamDetachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    return detachedCodexAppServerChatTurn(sessionId, input, options);
  }

  async function detachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    const admission = beginTerminalNamespaceOperation(codexTerminalNamespace(sessionId));
    if (admission.ok === false) {
      return admission;
    }
    try {
      return await admittedDetachedCodexAppServerChatTurn(sessionId, input, options);
    } finally {
      admission.release();
    }
  }

  async function admittedDetachedCodexAppServerChatTurn(sessionId, input = {}, {
    onEvent = null,
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
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
      const context = await codexAppServerConversationContext(sessionId, input, {
        runtime: resolvedRuntime,
        session: resolvedSession
      });
      if (context.ok === false) {
        return context;
      }
      const {
        agentSettings,
        provider,
        runtime,
        workdir
      } = context;
      const projectRuntimeRoot = normalizeText(runtime?.stateRoot);
      const executionProfile = isRecord(input.executionProfile) ? input.executionProfile : null;
      const economyTurn = Boolean(executionProfile);
      if (economyTurn) {
        await assertCodexAppServerEconomyAccountIdentity(
          provider,
          input.expectedAccountIdentitySignature
        );
      }
      const threadSettings = economyTurn
        ? null
        : await codexAppServerConversationThreadSettings(context, input);
      const requestedThreadId = normalizeText(input.threadId || input.codexSessionId);
      let thread = null;
      let replacedThreadId = "";
      let economyThreadRecord = null;
      if (requestedThreadId) {
        if (economyTurn) {
          economyThreadRecord = knownCodexAppServerEconomyThread({
            executionProfile,
            projectRuntimeRoot,
            provider,
            sessionId,
            threadId: requestedThreadId,
            workdir
          });
          try {
            economyThreadRecord = await updateCodexAppServerEconomyThread(
              economyThreadRecord,
              {
                lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.STARTING_TURN,
                turnId: ""
              }
            );
            const resumed = await resumeCodexAppServerEconomyThread({
              executionProfile,
              provider,
              threadId: requestedThreadId
            });
            thread = resumed.thread;
          } catch (error) {
            if (error?.codexAppServerEconomyThreadRetired === true) {
              try {
                await removeCodexAppServerEconomyThread(economyThreadRecord);
              } catch (ledgerError) {
                throw codexAppServerEconomyThreadCleanupError(
                  economyThreadRecord,
                  ledgerError
                );
              }
            } else if (error?.codexAppServerEconomyThreadCleanupRequired === true) {
              try {
                economyThreadRecord = await updateCodexAppServerEconomyThread(
                  economyThreadRecord,
                  {
                    lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.CLEANUP_REQUIRED
                  }
                );
              } catch (ledgerError) {
                throw codexAppServerEconomyThreadCleanupError(
                  economyThreadRecord,
                  ledgerError
                );
              }
            } else {
              try {
                await retireCodexAppServerEconomyThread(economyThreadRecord);
              } catch (cleanupError) {
                cleanupError.cause = error;
                throw cleanupError;
              }
            }
            throw error;
          }
        } else {
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
      }
      if (!thread) {
        if (economyTurn) {
          const started = await startAndRememberCodexAppServerEconomyThread({
            context,
            executionProfile,
            projectRuntimeRoot,
            provider,
            sessionId,
            workdir
          });
          economyThreadRecord = started.record;
          thread = started.thread;
        } else {
          thread = await provider.startThread({
            ...threadSettings,
            ...(input.ephemeral === true ? { ephemeral: true } : {})
          });
        }
      }
      const threadId = normalizeText(thread.id || thread.response?.thread?.id || requestedThreadId);
      if (!threadId) {
        throw new Error("Codex app-server did not return a detached chat thread id.");
      }
      const discardEconomyThread = async () => {
        if (!economyTurn || !economyThreadRecord) {
          return;
        }
        await retireCodexAppServerEconomyThread(economyThreadRecord);
      };
      emitDetachedEvent({
        replacedThreadId,
        threadId,
        type: "thread"
      });
      const requestedTimeoutMs = Number(input.timeoutMs || 0);
      const profileTimeoutMs = Number(executionProfile?.limits?.timeoutMs || 0);
      const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
        onEvent: (classification) => {
          emitDetachedEvent({
            classification,
            threadId,
            turnId: classification.turnId,
            type: "notification"
          });
        },
        timeoutMs: economyTurn
          ? Math.min(
              requestedTimeoutMs > 0 ? requestedTimeoutMs : profileTimeoutMs,
              profileTimeoutMs
            )
          : requestedTimeoutMs > 0
            ? requestedTimeoutMs
            : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
      });
      const waitForResult = watcher.wait();
      void waitForResult.catch(() => null);
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
        await discardEconomyThread();
        throw codexDetachedChatTurnError(error, {
          agentSettings,
          executionProfile,
          status
        });
      };
      let delivery = null;
      let turnId = "";
      let status = "";
      let economyTurnStart = null;
      try {
        if (economyTurn) {
          const economyThreadKey = codexAppServerEconomyThreadKey(economyThreadRecord);
          economyTurnStart = (async () => {
            const currentDelivery = await sendCodexAppServerEconomyTurn({
              executionProfile,
              outputSchema: input.outputSchema,
              prompt,
              provider,
              threadId
            });
            const currentTurnId = normalizeText(currentDelivery.turn?.id);
            const currentStatus = normalizeText(
              currentDelivery.turn?.status || currentDelivery.turn?.raw?.status
            );
            economyThreadRecord = await updateCodexAppServerEconomyThread(
              economyThreadRecord,
              {
                lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.ACTIVE,
                turnId: currentTurnId
              }
            );
            return {
              delivery: currentDelivery,
              status: currentStatus,
              turnId: currentTurnId
            };
          })();
          codexAppServerEconomyTurnStarts.set(economyThreadKey, economyTurnStart);
          ({ delivery, status, turnId } = await economyTurnStart);
        } else {
          delivery = await sendCodexAppServerPromptForSession({
            agentSettings,
            prompt,
            provider,
            threadId,
            workdir
          });
          turnId = normalizeText(delivery.turn?.id);
          status = normalizeText(delivery.turn?.status || delivery.turn?.raw?.status);
        }
      } catch (error) {
        await throwWatcherFailure(error);
      } finally {
        if (economyTurnStart) {
          const economyThreadKey = codexAppServerEconomyThreadKey(economyThreadRecord);
          if (codexAppServerEconomyTurnStarts.get(economyThreadKey) === economyTurnStart) {
            codexAppServerEconomyTurnStarts.delete(economyThreadKey);
          }
        }
      }
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
        await discardEconomyThread();
        throw codexDetachedChatTurnError(error, {
          agentSettings,
          executionProfile,
          status
        });
      }
      if (economyTurn) {
        try {
          await assertCodexAppServerEconomyAccountIdentity(
            provider,
            input.expectedAccountIdentitySignature
          );
        } catch (error) {
          await discardEconomyThread();
          throw error;
        }
      }
      try {
        if (economyTurn) {
          assertCodexAppServerEconomyOutputWithinLimit({
            executionProfile,
            rawOutput: result.text
          });
        }
      } catch (error) {
        await discardEconomyThread();
        throw error;
      }
      if (economyTurn) {
        try {
          economyThreadRecord = await updateCodexAppServerEconomyThread(economyThreadRecord, {
            lifecycle: CODEX_ECONOMY_THREAD_LIFECYCLES.READY,
            turnId: ""
          });
        } catch (error) {
          try {
            await retireCodexAppServerEconomyThread(economyThreadRecord);
          } catch (cleanupError) {
            cleanupError.cause = error;
            throw cleanupError;
          }
          throw error;
        }
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
        turnId: result.turnId || turnId,
        ...(economyTurn
          ? {
              inputCharacters: prompt.length,
              outputCharacters: result.text.length,
              usage: result.usage || null
            }
          : {})
      };
    });
  }

  async function deleteDetachedCodexAppServerChatThread(sessionId, input = {}, {
    assistantScope = null,
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
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
      const admission = beginTerminalNamespaceOperation(
        codexTerminalNamespace(sessionId)
      );
      if (admission.ok === false) {
        return codexAppServerFrozenThreadDeleteResponse(threadId);
      }
      try {
        let context = null;
        try {
          context = await codexAppServerConversationContext(sessionId, input, {
            assistantScope,
            runtime: resolvedRuntime,
            session: resolvedSession
          });
        } catch (error) {
          if (codexAppServerAdmissionError(sessionId)) {
            return codexAppServerFrozenThreadDeleteResponse(threadId);
          }
          throw error;
        }
        if (context.ok === false) {
          return context;
        }
        if (codexAppServerAdmissionError(sessionId)) {
          return codexAppServerFrozenThreadDeleteResponse(threadId);
        }
        if (context.economyRestore?.retiredThreadIds?.includes(threadId)) {
          return {
            deleted: true,
            ok: true,
            status: "deleted",
            threadId
          };
        }
        const economyThread = codexAppServerEconomyThreads.get(
          codexAppServerEconomyThreadKey({
            projectRuntimeRoot: context.runtime?.stateRoot,
            sessionId,
            threadId
          })
        );
        if (economyThread) {
          if (!isRecord(input.executionProfile)) {
            throw codexAppServerEconomyThreadUnavailableError(threadId);
          }
          return retireCodexAppServerEconomyThread(
            codexAppServerEconomyThreadForOperation({
              executionProfile: input.executionProfile,
              lifecycles: Object.values(CODEX_ECONOMY_THREAD_LIFECYCLES),
              projectRuntimeRoot: context.runtime?.stateRoot,
              provider: context.provider,
              sessionId,
              threadId,
              workdir: context.workdir
            })
          );
        }
        if (isRecord(input.executionProfile)) {
          throw codexAppServerEconomyThreadUnavailableError(threadId);
        }
        const provider = context.provider;
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
      } finally {
        admission.release();
      }
    });
  }

  async function interruptDetachedCodexAppServerChatTurn(sessionId, input = {}, {
    assistantScope = null,
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
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
      const admission = beginTerminalNamespaceOperation(
        codexTerminalNamespace(sessionId)
      );
      if (admission.ok === false) {
        return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
      }
      try {
        let context = null;
        try {
          context = await codexAppServerConversationContext(sessionId, input, {
            assistantScope,
            runtime: resolvedRuntime,
            session: resolvedSession
          });
        } catch (error) {
          if (codexAppServerAdmissionError(sessionId)) {
            return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
          }
          throw error;
        }
        if (context.ok === false) {
          return context;
        }
        if (codexAppServerAdmissionError(sessionId)) {
          return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
        }
        if (isRecord(input.executionProfile)) {
          codexAppServerEconomyThreadForOperation({
            executionProfile: input.executionProfile,
            lifecycles: [CODEX_ECONOMY_THREAD_LIFECYCLES.ACTIVE],
            projectRuntimeRoot: context.runtime?.stateRoot,
            provider: context.provider,
            sessionId,
            threadId,
            turnId,
            workdir: context.workdir
          });
        }
        if (codexAppServerAdmissionError(sessionId)) {
          return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
        }
        const result = await context.provider.interruptTurn(threadId, turnId);
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
      } finally {
        admission.release();
      }
    });
  }

  async function startCodexAppServerTerminal(sessionId, input = {}) {
    void input;
    // The visible TUI and the chat are two views of one app-server thread.
    // Always join that thread through the same lifecycle so Vibe64 installs
    // its event subscription and reconciles provider truth before the TUI
    // attaches. Trusting a persisted "active" run as an attach shortcut left
    // the TUI connected but the chat permanently busy after a server restart.
    // This is a one-time thread join, not status polling; subsequent state changes
    // come from the provider subscription.
    const prepared = await ensureCodexAppServerThreadReady(sessionId);
    if (prepared?.ok === false) {
      return prepared;
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

  async function interruptCodexAppServerTurnWithinAdmission(sessionId, input = {}) {
    if (codexAppServerAdmissionError(sessionId)) {
      return codexAppServerFrozenTurnInterruptResponse({
        threadId: input.threadId || input.codexSessionId,
        turnId: input.turnId || input.codexTurnId
      });
    }
    const context = await codexAppServerSessionContext(sessionId, { allowClosing: true });
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    const controlRequestId = normalizeText(input?.controlRequestId);
    let currentSession = await runtime.getSession(sessionId);
    let currentTurn = codexAppServerTurnState(currentSession);
    let threadId = normalizeText(currentTurn.threadId) ||
      codexThreadIdForWorkdir(currentSession, workdir);
    let provider = null;
    let providerPreflight = null;
    if (codexAppServerAdmissionError(sessionId)) {
      return codexAppServerFrozenTurnInterruptResponse({
        threadId,
        turnId: currentTurn.turnId
      });
    }
    if (currentTurn.active && threadId) {
      const activeProvider = await ensureCodexAppServerProviderForActiveTurn(currentSession, {
        executionRoot,
        workdir
      });
      provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(currentSession, {
          runtime,
          executionRoot,
          toolHomeSource,
          workdir
        })
      );
      try {
        const providerThread = await codexAppServerReadThreadStatus(provider, threadId, {
          observeLatestTurn: true
        });
        const providerStatus = codexAppServerThreadStatus(providerThread);
        const providerTurnId = codexAppServerThreadTurnId(providerThread);
        providerPreflight = {
          status: providerStatus,
          threadId,
          turnId: providerTurnId || normalizeText(currentTurn.turnId)
        };
        if (
          providerTurnId &&
          codexAppServerTurnCanAdoptSuccessor(currentTurn, threadId, providerTurnId)
        ) {
          await adoptCodexAppServerSuccessorTurn(sessionId, {
            previousTurnId: currentTurn.turnId,
            source: "interrupt_preflight",
            status: "inProgress",
            threadId,
            turnId: providerTurnId
          });
        }
      } catch (error) {
        vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.preflight.error", {
          controlRequestId,
          error: vibe64SessionDebugError(error),
          sessionId,
          threadId,
          turnId: currentTurn.turnId
        });
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      currentSession = await runtime.getSession(sessionId);
      currentTurn = codexAppServerTurnState(currentSession);
      threadId = normalizeText(currentTurn.threadId) ||
        codexThreadIdForWorkdir(currentSession, workdir);
      const turnId = normalizeText(currentTurn.turnId);
      if (codexAppServerAdmissionError(sessionId)) {
        return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
      }
      if (currentTurn.state === "finalizing" && threadId) {
        if (codexAppServerTurnResultWasProcessed(currentSession, threadId, turnId)) {
          await finalizeCodexAppServerAssistantResult(sessionId, threadId, turnId, {
            status: currentTurn.status || "completed"
          });
          currentSession = await runtime.getSession(sessionId);
          currentTurn = codexAppServerTurnState(currentSession);
        }
        if (!currentTurn.active) {
          return withCodexState({
            interrupted: false,
            ok: true,
            operationOutcome: "already_idle",
            threadId,
            turnId
          }, currentSession);
        }
        const stoppedThreadId = normalizeText(currentTurn.threadId) || threadId;
        const stoppedTurnId = normalizeText(currentTurn.turnId) || turnId;
        const stopped = await stopCodexAppServerTurnWithProviderFailure(
          sessionId,
          stoppedThreadId,
          stoppedTurnId,
          {
            error: "Stopped by user.",
            ok: true,
            outcome: CODEX_TURN_OUTCOME.USER_CANCELLED,
            status: "interrupted",
            verifyInactive: false
          }
        );
        return {
          ...stopped,
          operationOutcome: "interrupted",
          threadId: stoppedThreadId,
          turnId: stoppedTurnId
        };
      }
      if (!currentTurn.active || !threadId || !turnId) {
        vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.unavailable", {
          active: currentTurn.active,
          controlRequestId,
          sessionId,
          threadId,
          turnId
        });
        if (currentTurn.active) {
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
        }, currentSession);
      }
      if (!provider) {
        if (codexAppServerAdmissionError(sessionId)) {
          return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
        }
        const activeProvider = await ensureCodexAppServerProviderForActiveTurn(currentSession, {
          executionRoot,
          workdir
        });
        provider = activeProvider?.provider || await ensureCodexAppServerDaemonForSession(
          sessionId,
          await codexAppServerRuntimeOptionsForSession(currentSession, {
            runtime,
            executionRoot,
            toolHomeSource,
            workdir
          })
        );
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerInterrupt.start", {
        attempt,
        controlRequestId,
        sessionId,
        threadId,
        turnId
      });
      let result;
      let requestError = null;
      if (codexAppServerAdmissionError(sessionId)) {
        return codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
      }
      try {
        result = await provider.interruptTurn(threadId, turnId);
      } catch (error) {
        requestError = error;
      }
      const interruptFailure = requestError
        ? null
        : codexAppServerInterruptFailure(result);
      if (requestError || interruptFailure) {
        const preflightMatchesTurn = providerPreflight?.threadId === threadId &&
          providerPreflight?.turnId === turnId;
        if (
          preflightMatchesTurn &&
          codexAppServerTurnStatusIsComplete(providerPreflight.status)
        ) {
          if (codexAppServerTurnStatusIsProviderFailure(providerPreflight.status)) {
            await stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, turnId, {
              status: providerPreflight.status,
              verifyInactive: false
            });
          } else {
            await completeCodexAppServerTurn(sessionId, threadId, turnId, {
              status: providerPreflight.status,
              verifyInactive: false
            });
          }
          const settledSession = await runtime.getSession(sessionId);
          return withCodexState({
            interrupted: false,
            ok: true,
            operationOutcome: "already_idle",
            threadId,
            turnId
          }, settledSession);
        }
        providerPreflight = null;
        await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
          source: "interrupt_race"
        }).catch(() => null);
        const reconciledSession = await runtime.getSession(sessionId);
        const reconciledTurn = codexAppServerTurnState(reconciledSession);
        const successorIsActive = reconciledTurn.active === true &&
          normalizeText(reconciledTurn.threadId) === threadId &&
          Boolean(normalizeText(reconciledTurn.turnId)) &&
          normalizeText(reconciledTurn.turnId) !== turnId;
        if (successorIsActive && attempt < 2) {
          continue;
        }
        const sameTurnIsActive = reconciledTurn.state === "active" &&
          reconciledTurn.active === true &&
          normalizeText(reconciledTurn.threadId) === threadId &&
          normalizeText(reconciledTurn.turnId) === turnId;
        if (!sameTurnIsActive) {
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
          }, reconciledSession);
        }
        if (requestError) {
          if (codexAppServerRequestIsInvalid(requestError, "turn/interrupt")) {
            return codexAppServerInterruptUnavailableResponse({
              active: true,
              threadId,
              turnId
            });
          }
          throw requestError;
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
        outcome: CODEX_TURN_OUTCOME.USER_CANCELLED,
        status: "interrupted",
        verifyInactive: false
      });
      if (stopped?.reason === "stale_turn_state" && attempt < 2) {
        await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
          source: "interrupt_settlement_race"
        }).catch(() => null);
        continue;
      }
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
    currentSession = await runtime.getSession(sessionId);
    currentTurn = codexAppServerTurnState(currentSession);
    return codexAppServerInterruptUnavailableResponse({
      active: currentTurn.active,
      threadId: currentTurn.threadId,
      turnId: currentTurn.turnId
    });
  }

  async function interruptCodexAppServerTurn(sessionId, input = {}) {
    const admission = beginTerminalNamespaceOperation(
      codexTerminalNamespace(sessionId)
    );
    if (admission.ok === false) {
      return codexAppServerFrozenTurnInterruptResponse({
        threadId: input.threadId || input.codexSessionId,
        turnId: input.turnId || input.codexTurnId
      });
    }
    try {
      return await interruptCodexAppServerTurnWithinAdmission(sessionId, input);
    } finally {
      admission.release();
    }
  }

  async function writeCodexAppServerDeliveredUserMessage(
    runtime,
    sessionId = "",
    text = "",
    messageId = "",
    turnMetadata = null,
    attachments = []
  ) {
    const normalizedSessionId = normalizeText(sessionId);
    const message = normalizeText(text);
    if (
      !normalizedSessionId ||
      !message ||
      typeof runtime?.store?.writeConversationUserMessage !== "function"
    ) {
      return null;
    }
    const pendingMessage = codexAppServerPendingUserMessages.get(
      `${codexTerminalNamespace(normalizedSessionId)}\0${normalizeText(messageId)}`
    );
    if (pendingMessage?.recording) {
      return pendingMessage.recording;
    }
    const recording = (async () => {
      const written = await runtime.store.writeConversationUserMessage(normalizedSessionId, {
        attachments,
        messageId: normalizeText(messageId),
        text: message,
        turnMetadata
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
    })();
    if (pendingMessage) {
      pendingMessage.recording = recording;
    }
    return recording;
  }

  async function recordCodexTerminalInputGitActor(sessionId = "", data = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!input?.trackGitActor || !normalizedSessionId || String(data ?? "").length === 0) {
      return {
        ok: true
      };
    }
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(normalizedSessionId);
    if (!session) {
      return {
        code: "vibe64_codex_terminal_session_missing",
        error: "Vibe64 session is not available for Codex terminal input.",
        ok: false
      };
    }
    const executionRoot = terminalSessionSourceRoot(session);
    if (!executionRoot) {
      return {
        code: "vibe64_codex_terminal_source_root_missing",
        error: "Vibe64 Codex session source root is not available for GitHub actor tracking.",
        ok: false
      };
    }
    const workdir = terminalWorktreePath(session);
    const vibe64User = input?.vibe64User || input?.request?.vibe64User || null;
    const actorMetadata = await recordSessionGitCommandActor({
      env,
      reason: "codex-terminal-input",
      runtime,
      session,
      sourceRoot: executionRoot,
      threadId: codexThreadIdForWorkdir(session, workdir),
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

  async function sendCodexAppServerMessage(sessionId, input = {}, options = {}) {
    const startedAt = Date.now();
    const turnOwnership = options.turnOwnership || null;
    const message = codexAppServerMessageText(input);
    const displayMessage = codexAppServerMessageDisplayText(input, message);
    const messageId = normalizeText(input?.messageId);
    if (!message) {
      return {
        code: CODEX_AGENT_TURN_STEER_FAILED_CODE,
        error: "Codex message input is empty.",
        ok: false,
        operationOutcome: "message_empty",
        refreshRecommended: false
      };
    }
    const context = await codexAppServerSessionContext(sessionId, options);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    if (
      messageId &&
      typeof runtime.store.conversationMessageIdExists === "function" &&
      await runtime.store.conversationMessageIdExists(sessionId, messageId)
    ) {
      return withCodexState({
        delivered: true,
        duplicate: true,
        ok: true,
        operationOutcome: "message_already_delivered"
      }, session);
    }
    const vibe64User = input?.vibe64User || null;
    const turnMetadata = await currentConversationActorMetadata(vibe64User);
    vibe64SessionDebugLog("server.codexTerminal.appServerMessage.contextReady", {
      durationMs: Date.now() - startedAt,
      messageId,
      sessionId
    });
    let currentSession = session;
    let turn = codexAppServerTurnState(currentSession);
    if (
      turn.state === "starting" &&
      !turn.turnId &&
      !codexAppServerPromptDeliveries.has(codexTerminalNamespace(sessionId))
    ) {
      const abandonedClaim = await recoverAbandonedCodexAppServerPromptClaim(
        runtime,
        currentSession,
        { promptDeliveryActive: false }
      );
      currentSession = abandonedClaim.session;
      turn = codexAppServerTurnState(currentSession);
    }
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
    const activeProvider = await ensureCodexAppServerProviderForManagedThread(currentSession, {
      executionRoot,
      workdir
    });
    let provider = activeProvider?.provider || null;
    if (activeProvider) {
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
          executionRoot,
          toolHomeSource,
          workdir
        })
      );
    }
    const providerReadyAt = Date.now();
    vibe64SessionDebugLog("server.codexTerminal.appServerMessage.providerReady", {
      durationMs: providerReadyAt - startedAt,
      messageId,
      sessionId
    });
    try {
      await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
        source: "message_delivery"
      });
    } catch (error) {
      if (turn.active || !codexAppServerThreadIsMissing(error, threadId)) {
        throw error;
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerMessage.newTurn", {
        error: vibe64SessionDebugError(error),
        messageId,
        reason: "provider_thread_missing",
        sessionId,
        threadId,
        turnId: normalizeText(turn.turnId)
      });
      return codexAppServerMessageRequiresNewTurn(currentSession, {
        reason: "provider_thread_missing",
        threadId,
        turnId: normalizeText(turn.turnId)
      });
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerMessage.reconciled", {
      durationMs: Date.now() - providerReadyAt,
      messageId,
      sessionId
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
      actorMetadata = await recordSessionGitCommandActor({
        env,
        reason: "agent-message",
        runtime,
        session: currentSession,
        sourceRoot: executionRoot,
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
    await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
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
      await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
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
      const response = provider.steerTurn(
        threadId,
        turnId,
        input.attachments?.some((attachment) => attachment.contentType?.startsWith("image/"))
          ? [message, ...input.attachments
              .filter((attachment) => attachment.contentType?.startsWith("image/"))
              .map((attachment) => ({ type: "localImage", path: attachment.path }))]
          : message,
        {
          clientUserMessageId
        }
      );
      const receipt = codexAppServerPendingUserMessages.get(
        `${codexTerminalNamespace(sessionId)}\0${clientUserMessageId}`
      )?.receipt;
      result = receipt ? await Promise.race([response, receipt.promise]) : await response;
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
    const conversationTurn = await writeCodexAppServerDeliveredUserMessage(
      runtime,
      sessionId,
      displayMessage || message,
      messageId,
      turnMetadata,
      input?.displayAttachments
    );
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
      conversationTurns: [conversationTurn],
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

    async closeAllForSession(sessionId, options = {}) {
      const normalizedSessionId = normalizeText(sessionId);
      const sessionKey = codexTerminalNamespace(normalizedSessionId);
      const renewalCleanup = renewalCleanupContext(normalizedSessionId, options);
      const preserveProcessExitProof = Boolean(
        renewalCleanup || options.preserveProcessExitProof === true
      );
      let pending = codexAppServerSessionClosures.get(sessionKey);
      while (pending) {
        const pendingIsRenewalCleanup = codexAppServerRenewalSessionClosures.has(pending);
        if (renewalCleanup && !pendingIsRenewalCleanup) {
          await pending.catch(() => null);
          pending = codexAppServerSessionClosures.get(sessionKey);
          continue;
        }
        if (!renewalCleanup && pendingIsRenewalCleanup) {
          const publicRuntime = await createRuntimeForSession();
          await publicRuntime.getSession(normalizedSessionId);
        }
        return pending;
      }
      const closing = (async () => {
        clearCodexAppServerSessionRecoveryTimers(normalizedSessionId);
        clearCodexAppServerSessionContexts(normalizedSessionId);
        let runtime = null;
        let session = null;
        let providerOptions = null;
        let renewalExitError = null;
        let unsubscribeResult = null;
        try {
          runtime = renewalCleanup?.runtime || await createRuntimeForSession();
          session = renewalCleanup?.session || await runtime.getSession(normalizedSessionId);
          assertCodexAppServerEconomyThreadsRestored(
            await restoreCodexAppServerEconomyThreads({ runtime, session })
          );
          assertCodexAppServerEconomyThreadsRetired(
            await retireCodexAppServerEconomyThreads({
              projectRuntimeRoot: runtime.stateRoot,
              sessionId: normalizedSessionId
            })
          );
          providerOptions = renewalCleanup
            ? codexAppServerRuntimeOptionsFromSessionMetadata(session)
            : await codexAppServerRuntimeOptionsForSession(session, {
                runtime
              });
        } catch (error) {
          vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeSession.prepare.error", {
            error: vibe64SessionDebugError(error),
            sessionId: normalizedSessionId
          });
          throw error;
        }
        await cleanupCodexAppServerEphemeralConversations(normalizedSessionId);
        try {
          unsubscribeResult = await unsubscribeCodexAppServerThreadForSession(
            normalizedSessionId,
            renewalCleanup
              ? {
                  providerOptions,
                  runtime,
                  session
                }
              : {}
          );
          providerOptions = unsubscribeResult?.providerOptions || providerOptions;
        } catch (error) {
          vibe64SessionDebugLog("server.codexTerminal.appServerThread.unsubscribe.error", {
            error: vibe64SessionDebugError(error),
            sessionId: normalizedSessionId
          });
        } finally {
          await drainCodexAppServerNotificationTasks(normalizedSessionId);
          const cachedProviders = await stopCachedCodexAppServerProvidersForSession(
            normalizedSessionId,
            {
              preserveProcessExitProof,
              requireStopped: Boolean(renewalCleanup)
            }
          );
          if (cachedProviders.ok === false) {
            vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeSession.cached.error", {
              failed: cachedProviders.failed,
              sessionId: normalizedSessionId
            });
          }
          if (
            !renewalCleanup &&
            !cachedProviders.providerCount &&
            providerOptions &&
            sessionHasCodexAppServerRuntime(session)
          ) {
            await stopCodexAppServerProviderForSession(normalizedSessionId, providerOptions, {
              preserveProcessExitProof
            });
          }
          let persistedRuntime = null;
          if (session) {
            persistedRuntime = cachedProviders.stopped > 0
              ? {
                  stopped: true,
                  verifiedStopped: true
                }
              : codexAppServerProviders.size > 0
              ? {
                  sessionDetached: true,
                  sharedProcessRetained: true,
                  stopped: false,
                  verifiedStopped: false
                }
              : sessionHasCodexAppServerRuntime(session)
                ? await stopPersistedCodexAppServerRuntimeForSession(
                  session,
                  providerOptions || {},
                  {
                    preserveProcessExitProof
                  }
                )
                : {
                    stopped: false,
                    verifiedStopped: false
                  };
            vibe64SessionDebugLog("server.codexTerminal.appServerRuntime.closeSession.persisted.done", {
              removed: persistedRuntime?.removed === true,
              runtimeDirRemoved: persistedRuntime?.runtimeDirRemoved === true,
              sessionId: normalizedSessionId,
              stopped: persistedRuntime?.removed === true || persistedRuntime?.runtimeDirRemoved === true
            });
          }
          if (renewalCleanup) {
            const cachedRuntimeExitVerified = cachedProviders.providerCount > 0 &&
              cachedProviders.results.length === cachedProviders.providerCount &&
              cachedProviders.results.every((result) => (
                result?.stopped === true ||
                (result?.sessionDetached === true && result?.sharedProcessRetained === true)
              ));
            const persistedRuntimeExitVerified = persistedRuntime?.verifiedStopped === true ||
              (
                persistedRuntime?.sessionDetached === true &&
                persistedRuntime?.sharedProcessRetained === true
              );
            if (
              cachedProviders.failed.length > 0 ||
              (!cachedRuntimeExitVerified && !persistedRuntimeExitVerified)
            ) {
              const error = new Error(
                "Session renewal could not verify that every Codex process exited."
              );
              error.code = "vibe64_session_renewal_process_exit_unverified";
              error.retryable = true;
              error.details = {
                cachedFailures: cachedProviders.failed,
                cachedRuntimeExitVerified,
                persistedRuntime: persistedRuntime || null
              };
              renewalExitError = error;
            }
          }
        }
        if (renewalExitError) {
          throw renewalExitError;
        }
        await closeTerminalSessionsForNamespace(codexTerminalNamespace(normalizedSessionId));
        const executionRoot = renewalCleanup
          ? terminalSessionSourceRoot(session)
          : await terminalSessionSourceRootForSession(
              projectService,
              normalizedSessionId
            );
        if (executionRoot && renewalCleanup?.kind !== "predecessor") {
          await cleanupCodexAttachments(executionRoot, normalizedSessionId, "", {
            env: codexAttachmentEnv()
          });
        }
      })();
      codexAppServerSessionClosures.set(sessionKey, closing);
      if (renewalCleanup) {
        codexAppServerRenewalSessionClosures.add(closing);
      }
      try {
        return await closing;
      } finally {
        if (codexAppServerSessionClosures.get(sessionKey) === closing) {
          codexAppServerSessionClosures.delete(sessionKey);
        }
      }
    },

    async releaseRenewalPredecessorAttachments(sessionId, options = {}) {
      const context = renewalArchivedPredecessorContext(sessionId, options);
      const executionRoot = terminalSessionSourceRoot(context.session);
      if (!executionRoot) {
        throw new TypeError(
          "Renewal attachment release requires the archived predecessor source identity."
        );
      }
      return releaseCodexSessionAttachments(executionRoot, sessionId, {
        env: codexAttachmentEnv()
      });
    },

    async releaseRenewalPredecessorProcessExitProof(sessionId, options = {}) {
      const context = renewalArchivedPredecessorContext(sessionId, options);
      return releaseRenewalProcessExitProof(context.session);
    },

    async releaseRenewalSuccessorProcessExitProof(sessionId, options = {}) {
      const context = renewalSuccessorProcessExitProofReleaseContext(sessionId, options);
      return releaseRenewalProcessExitProof(context.session);
    },

    async closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: codexTerminalNamespace(sessionId)
      });
    },

    createConversation(sessionId, input = {}, options = {}) {
      return createCodexAppServerConversation(sessionId, input, options);
    },

    assistantAccess() {
      return codexAppServerAssistantAccess();
    },

    hasActiveTemporaryConversation(sessionId) {
      const conversations = codexAppServerEphemeralConversations.get(
        codexTerminalNamespace(sessionId)
      );
      return Boolean(conversations && [...conversations.values()].some((conversation) => (
        codexAppServerConversationTurnIsActive(conversation.status)
      )));
    },

    deleteConversation(sessionId, input = {}, options = {}) {
      return deleteCodexAppServerConversation(sessionId, input, options);
    },

    describeProvider(sessionId, options = {}) {
      return describeCodexAppServerProvider(sessionId, options);
    },

    readGlobalTerminal(terminalSessionId) {
      return vibe64Result(async () => {
        const executionRoot = await globalCodexRuntimeRoot(projectService);
        const snapshot = readTerminalSession(terminalSessionId, {
          namespace: globalCodexTerminalNamespace()
        });
        const codexTerminal = activeGlobalCodexTerminal(executionRoot);
        return {
          ...snapshot,
          codexTerminal,
          globalCodexTerminal: codexTerminal
        };
      });
    },

    readConversation(sessionId, input = {}, options = {}) {
      return readCodexAppServerConversation(sessionId, input, options);
    },

    modelCatalog(options = {}) {
      return withCodexAppServerModelCatalogDeadline((signal) => (
        withCodexAppServerProviderLifecycle(async () => {
          assertCodexAppServerControllerOpen();
          const toolHome = await codexToolHomeResult();
          if (toolHome.ok === false) throw new Error(toolHome.error);
          const providerOptions = codexAppServerRuntimeOptions({
            toolHomeSource: toolHome.toolHomeSource
          });
          const existing = codexAppServerOwnedRuntimes.get(
            codexAppServerOwnedRuntimeKey("", providerOptions)
          );
          if (existing?.provider) {
            return existing.provider.listModels({ includeHidden: false, limit: 100 }, { signal });
          }
          const provider = codexAppServerProviderFactory(providerOptions);
          let runtime = null;
          try {
            runtime = await acquireCodexAppServerRuntime({
              operation: () => provider.ensureRuntime(),
              provider,
              providerOptions
            });
            return await provider.listModels({ includeHidden: false, limit: 100 }, { signal });
          } finally {
            try {
              if ((runtime || provider.runtime)?.reused === false) {
                await stopOwnedCodexAppServerRuntime({ provider });
              } else {
                forgetCodexAppServerOwnedRuntime(provider);
              }
            } finally {
              provider.close();
            }
          }
        })
      ), options);
    },

    executionProfileModelCatalog(sessionId, options = {}) {
      return withCodexAppServerModelCatalogDeadline(
        (signal) => codexAppServerExecutionProfileModelCatalog(sessionId, {
          runtime: options.runtime,
          session: options.session,
          signal
        }),
        options
      );
    },

    generateSessionRenewalHandover(sessionId, input = {}, options = {}) {
      return generateCodexSessionRenewalHandover(sessionId, input, options);
    },

    readTerminal(sessionId, terminalSessionId) {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId);
        return withCodexState(readTerminalSession(terminalSessionId, {
          namespace: codexTerminalNamespace(sessionId),
          outputLimit: CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
        }), session);
      });
    },

    runDetachedChatTurn(sessionId, input = {}, options = {}) {
      return runDetachedCodexAppServerChatTurn(sessionId, input, options);
    },

    seedSessionRenewalHandover(sessionId, input = {}, options = {}) {
      return seedCodexSessionRenewalHandover(sessionId, input, options);
    },

    startConversationTurn(sessionId, input = {}, options = {}) {
      return startCodexAppServerConversationTurn(sessionId, input, options);
    },

    stopConversation(sessionId, input = {}, options = {}) {
      return stopCodexAppServerConversation(sessionId, input, options);
    },

    streamDetachedChatTurn(sessionId, input = {}, options = {}) {
      return streamDetachedCodexAppServerChatTurn(sessionId, input, options);
    },

    waitForConversationTurn(sessionId, input = {}, options = {}) {
      return waitForCodexAppServerConversationTurn(sessionId, input, options);
    },

    deleteDetachedChatThread(sessionId, input = {}, options = {}) {
      return deleteDetachedCodexAppServerChatThread(sessionId, input, options);
    },

    interruptDetachedChatTurn(sessionId, input = {}, options = {}) {
      return interruptDetachedCodexAppServerChatTurn(sessionId, input, options);
    },

    async ensureThread(sessionId) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const workdir = terminalWorktreePath(session);
        const threadId = codexThreadIdForWorkdir(session, workdir);
        if (
          threadId &&
          !sessionIsClosing(session) &&
          session.status !== VIBE64_SESSION_STATUS.ARCHIVED &&
          codexAppServerTurnState(session).state !== "starting"
        ) {
          for (const [providerKey, managed] of codexAppServerManagedSessions) {
            const provider = codexAppServerProviders.get(providerKey);
            if (
              managed.sessionId !== sessionId ||
              managed.workdir !== workdir ||
              managed.threadId !== threadId ||
              provider?.isAvailable?.() !== true
            ) {
              continue;
            }
            const observed = await maintainCodexAppServerManagedConnection(providerKey, { reconnect: false });
            if (observed.requiresPreparation) {
              break;
            }
            await writeCodexAppServerReady(runtime, sessionId, "");
            return withCodexState({
              ok: true,
              codexAppServerThreadReady: true,
              codexIdentityReady: true,
              codexThreadReady: true,
              codexThreadId: threadId,
              codexSessionBriefingDelivered: false,
              terminalSessionId: ""
            }, await runtime.getSession(sessionId, { inspectSource: false }));
          }
        }
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, () => (
          ensureCodexAppServerThreadReady(sessionId)
        ), { operation: "prepare-agent-session", waitMs: 10_000 });
        return exclusive.value;
      });
    },

    invalidateAppServerRuntimes(input = {}) {
      const serverShutdown = normalizeText(input?.reason) === "server-shutdown";
      if (serverShutdown) {
        beginCodexAppServerShutdown();
      }
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        if (serverShutdown) {
          return shutdownCodexAppServerRuntimes(input);
        }
        if (input.includeOwned === true) {
          return invalidateCodexAppServerRuntimes({
            ...input,
            includeOwned: true,
            requireVerifiedExit: true,
            stopOwnedRuntimes: true
          });
        }
        const runtime = await createRuntimeForSession();
        assertCodexAppServerEconomyThreadsRestored(
          await restoreCodexAppServerEconomyThreads({ runtime })
        );
        return invalidateCodexAppServerRuntimes({
          ...input,
          includeOwned: false,
          requireVerifiedExit: false
        });
      });
    },

    async closeAllForProject(input = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        const runtime = await createRuntimeForSession();
        assertCodexAppServerEconomyThreadsRestored(
          await restoreCodexAppServerEconomyThreads({ runtime })
        );
        const sessionNamespacePrefix = codexTerminalNamespace("");
        for (const sessionKey of [...codexAppServerEphemeralConversations.keys()]) {
          if (!sessionKey.startsWith(sessionNamespacePrefix)) {
            continue;
          }
          await cleanupCodexAppServerEphemeralConversations(
            sessionKey.slice(sessionNamespacePrefix.length)
          );
        }
        return stopCodexAppServerProvidersForProjectContext(input);
      });
    },

    async reconcileThreads(sessions = [], options = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        assertCodexAppServerControllerOpen();
        const reconciliation = Promise.resolve().then(() => (
          reconcileCodexAppServerThreads(sessions, options)
        ));
        codexAppServerReconcileTasks.add(reconciliation);
        try {
          return await reconciliation;
        } finally {
          codexAppServerReconcileTasks.delete(reconciliation);
        }
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
      const messageId = normalizeText(input?.messageId);
      const deliveryKey = messageId ? `${codexTerminalNamespace(sessionId)}\0${messageId}` : "";
      const existing = deliveryKey ? codexAppServerMessageDeliveries.get(deliveryKey) : null;
      if (existing) {
        return existing;
      }
      if (deliveryKey) {
        codexAppServerPendingUserMessages.set(deliveryKey, {
          attachments: input?.displayAttachments,
          receipt: Promise.withResolvers(),
          text: codexAppServerMessageDisplayText(input, codexAppServerMessageText(input)),
          vibe64User: input?.vibe64User || null
        });
      }
      const delivery = vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        const result = await sendCodexAppServerMessage(sessionId, input, options);
        if (result?.newTurnRequired !== true) {
          return result;
        }
        const message = codexAppServerMessageText(input);
        const messageId = normalizeText(input?.messageId) ||
          `vibe64:${crypto.randomUUID()}`;
        const started = await startCodexAppServerTurn(sessionId, isRecord(input) ? {
          ...input,
          message,
          messageId
        } : {
          message,
          messageId
        }, {
          agentSettings: input?.agentSettings || {},
          runtime: options.runtime || null,
          session: options.session || null,
          vibe64User: input?.vibe64User || null
        });
        if (started?.ok === false || started?.delivered === false) {
          return started;
        }
        const runtime = await createRuntimeForSession();
        const displayMessage = codexAppServerMessageDisplayText(input, message);
        const conversationTurn = await writeCodexAppServerDeliveredUserMessage(
          runtime,
          sessionId,
          displayMessage || message,
          messageId,
          started.turnMetadata || null,
          input?.displayAttachments
        );
        return {
          ...started,
          conversationTurn,
          conversationTurns: [conversationTurn],
          deliveryMode: "new_turn",
          newTurnRequired: false
        };
      });
      if (deliveryKey) {
        codexAppServerMessageDeliveries.set(deliveryKey, delivery);
      }
      try {
        return await delivery;
      } finally {
        if (deliveryKey && codexAppServerMessageDeliveries.get(deliveryKey) === delivery) {
          codexAppServerMessageDeliveries.delete(deliveryKey);
          codexAppServerPendingUserMessages.delete(deliveryKey);
        }
      }
    },

    async terminalState(sessionId, {
      session: existingSession = null
    } = {}) {
      return vibe64Result(async () => {
        // Status is rendered and polled frequently. It must project already
        // stored state only: recovery belongs to provider lifecycle work.
        // Hydrating or repairing a session here previously reread its complete
        // conversation and action history on every poll, starving the terminal
        // and moving hundreds of MB. Do not reintroduce recovery in this path.
        const session = existingSession || await readCodexStateSession(sessionId);
        return {
          ok: true,
          sessionId,
          sessionUpdated: false,
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
        const executionRoot = await globalCodexRuntimeRoot(projectService);
        const codexTerminal = activeGlobalCodexTerminal(executionRoot);
        return {
          codexTerminal,
          globalCodexTerminal: codexTerminal,
          ok: true
        };
      });
    },

    subscribeGlobalTerminal(terminalSessionId, subscriber) {
      return vibe64Result(async () => {
        const executionRoot = await globalCodexRuntimeRoot(projectService);
        const subscribed = subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: globalCodexTerminalNamespace()
        });
        const codexTerminal = activeGlobalCodexTerminal(executionRoot);
        return {
          ...subscribed,
          codexTerminal,
          globalCodexTerminal: codexTerminal
        };
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId);
        return withCodexState(subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: codexTerminalNamespace(sessionId),
          outputLimit: CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
        }), session);
      });
    },

    async uploadAttachment(sessionId, input = {}) {
      return vibe64Result(async () => {
        const normalizedSessionId = normalizeText(sessionId);
        const sessionKey = codexTerminalNamespace(normalizedSessionId);
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(normalizedSessionId);
        if (
          codexAppServerSessionClosures.has(sessionKey) ||
          codexSessionWorktreeIsUnavailable(session)
        ) {
          const error = codexAttachmentSessionUnavailableError(session);
          return {
            code: error.code,
            error: error.message,
            ok: false,
            statusCode: error.statusCode
          };
        }
        const executionRoot = terminalSessionSourceRoot(session);
        if (!executionRoot) {
          return {
            ok: false,
            error: "Vibe64 Codex session source root is not available."
          };
        }
        return storeCodexAttachment({
          beforeCreate: async () => {
            const currentSession = await runtime.getSession(normalizedSessionId);
            if (
              codexAppServerSessionClosures.has(sessionKey) ||
              codexSessionWorktreeIsUnavailable(currentSession)
            ) {
              throw codexAttachmentSessionUnavailableError(currentSession);
            }
          },
          env: codexAttachmentEnv(),
          input,
          sessionId: normalizedSessionId,
          executionRoot
        });
      });
    },

    async deleteAttachment(sessionId, input = {}) {
      return vibe64Result(async () => {
        const attachmentId = normalizeText(input.attachmentId);
        if (!attachmentId) {
          return {
            code: "vibe64_agent_attachment_id_required",
            error: "Attachment id is required.",
            ok: false
          };
        }
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId);
        const executionRoot = terminalSessionSourceRoot(session);
        if (!executionRoot) {
          return {
            ok: false,
            error: "Vibe64 Codex session source root is not available."
          };
        }
        await cleanupCodexAttachments(executionRoot, sessionId, attachmentId, {
          env: codexAttachmentEnv()
        });
        return {
          attachmentId,
          ok: true
        };
      });
    },

    async renewAttachments(sessionId, attachmentIds = []) {
      return vibe64Result(async () => {
        if (!Array.isArray(attachmentIds) || attachmentIds.length < 1) {
          return {
            missing: [],
            ok: true,
            retained: []
          };
        }
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId);
        const executionRoot = terminalSessionSourceRoot(session);
        if (!executionRoot) {
          return {
            code: "vibe64_agent_attachment_source_root_missing",
            error: "Vibe64 Codex session source root is not available.",
            ok: false
          };
        }
        return {
          ...await renewCodexAttachments(executionRoot, sessionId, attachmentIds, {
            env: codexAttachmentEnv()
          }),
          ok: true
        };
      });
    },

    async pinAttachments(sessionId, attachmentIds = [], suggestionId = "") {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId);
        const executionRoot = terminalSessionSourceRoot(session);
        if (!executionRoot) {
          return {
            code: "vibe64_agent_attachment_source_root_missing",
            error: "Vibe64 Codex session source root is not available.",
            ok: false
          };
        }
        return {
          ...await pinCodexAttachments(
            executionRoot,
            sessionId,
            attachmentIds,
            suggestionId,
            { env: codexAttachmentEnv() }
          ),
          ok: true
        };
      });
    },

    async unpinAttachments(sessionId, attachmentIds = [], suggestionId = "") {
      return vibe64Result(async () => {
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId);
        const executionRoot = terminalSessionSourceRoot(session);
        if (!executionRoot) {
          return { ok: true, released: [] };
        }
        return {
          ...await unpinCodexAttachments(
            executionRoot,
            sessionId,
            attachmentIds,
            suggestionId,
            { env: codexAttachmentEnv() }
          ),
          ok: true
        };
      });
    },

    async writeTerminal(sessionId, terminalSessionId, data, input = {}) {
      const admissionFailure = terminalNamespaceAdmissionFailure(
        codexTerminalNamespace(sessionId)
      );
      if (admissionFailure) {
        return admissionFailure;
      }
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

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: codexTerminalNamespace(sessionId)
      });
    },

    resizeGlobalTerminal(terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: globalCodexTerminalNamespace()
      });
    }
  });
}

export {
  codexAppTerminalOwnerMetadata,
  codexGitCommandShimDirs,
  codexRemoteEndpointForWorkdir,
  codexSessionBriefingFingerprint,
  codexTerminalArgs,
  createCodexTerminalController
};
