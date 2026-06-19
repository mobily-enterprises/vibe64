import crypto from "node:crypto";
import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  readTerminalSessionControlState,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSessionText
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  containerWorkspacePath
} from "@local/studio-terminal-core/server/containerRuntime";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  codexAppServerEndpointForTarget,
  createCodexAppServerAgentProvider
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import {
  VIBE64_AGENT_RUN_STATE,
  normalizeVibe64AgentRunState,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal
} from "@local/vibe64-runtime/server/sessionStore";
import {
  ensureCodexAppServerThreadForSession,
  sendCodexAppServerPromptForSession
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  effectiveVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import {
  parseAgentTurnResultEnvelope,
  stripAgentTurnResultEnvelope
} from "@local/vibe64-runtime/server/agentTurnResults";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  currentProjectRequestContext,
  currentProjectTargetRoot,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "@local/vibe64-core/shared";
import {
  promptSessionBriefing
} from "@local/vibe64-adapters/server/promptRenderer";
import {
  vibe64Result,
  codexTerminalNamespace,
  directoryExists,
  dockerCommand,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace,
  pathInsideOrEqual,
  terminalContainerName,
  terminalTargetRoot,
  terminalWorktreePath
} from "./terminalShared.js";
import {
  codexAttachmentMount,
  cleanupCodexAttachments,
  prepareCodexAttachmentRoot,
  storeCodexAttachment
} from "./codexAttachments.js";
import {
  resolveTerminalToolchainImage
} from "./terminalToolchainImage.js";
import {
  maskedTerminalDockerArgs,
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";
import {
  defaultFixCodexJobStore,
  fixCodexReportInstructions,
  prepareFixCodexReportHelper,
  reportFixCodexJob
} from "./fixCodexJobs.js";
import {
  agentTerminalIdentityForWorkdir,
  agentTerminalIdentityState
} from "./agentTerminalIdentity.js";

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
const CODEX_APP_SERVER_AGENT_RUN_ID = CODEX_APP_SERVER_TASK_ID;
const CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE = "vibe64_session_worktree_unavailable";
const CODEX_AGENT_TURN_ALREADY_RUNNING_CODE = "vibe64_agent_turn_already_running";
const CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE = "vibe64_codex_turn_interrupt_failed";
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();
const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_APP_SERVER_ACTIVE_RECONCILE_MS = 2000;
const CODEX_APP_SERVER_DAEMON_WELLBEING_MS = 15000;
const CODEX_APP_SERVER_FINALIZING_GRACE_MS = 10000;
const CODEX_APP_SERVER_LIVE_PROGRESS_WORD_WINDOW = 10;
const CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE =
  "Codex app-server finished this turn, but Vibe64 did not receive the assistant result text.";

function normalizeText(value) {
  return String(value || "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function codexAppServerLiveProgressSourceText(text = "") {
  const normalized = normalizeText(text);
  if (
    !normalized ||
    /VIBE64_AGENT_RESULT_BEGIN|VIBE64_AGENT_RESULT_END|"schema"\s*:\s*"vibe64\.agent\.turn_result\.v1"/u.test(normalized)
  ) {
    return "";
  }
  return normalized.replace(/\s+/gu, " ");
}

function codexAppServerLiveProgressText(text = "") {
  const source = codexAppServerLiveProgressSourceText(text);
  if (!source) {
    return "";
  }
  return source
    .split(/\s+/u)
    .filter(Boolean)
    .slice(-CODEX_APP_SERVER_LIVE_PROGRESS_WORD_WINDOW)
    .join(" ");
}

function codexEffectiveAgentSettings(agentSettings = {}) {
  return effectiveVibe64AgentSettings(agentSettings);
}

function codexAgentSettingsFromSession(session = {}) {
  const metadata = session.metadata || {};
  return {
    model: normalizeText(metadata.codex_agent_settings_model),
    providerId: normalizeText(metadata.codex_agent_settings_provider),
    thinking: normalizeText(metadata.codex_agent_settings_thinking)
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

function codexSessionWorktreeWasRemoved(session = {}) {
  return normalizeText(session.metadata?.worktree_removed) === "yes";
}

function codexSessionWorktreeUnavailableFailure({
  session = {},
  workdir = ""
} = {}) {
  const removed = codexSessionWorktreeWasRemoved(session);
  return retryableTerminalFailure({
    code: CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE,
    ok: false,
    error: removed
      ? "Session worktree was removed. Recover this session before continuing with Codex."
      : `Session worktree directory does not exist: ${workdir}`,
    workdir: normalizeText(workdir)
  });
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

function codexAppServerTurnStateFromAgentRun(run = {}) {
  const runState = normalizeVibe64AgentRunState(run.state);
  const active = vibe64AgentRunStateIsActive(runState);
  const state = runState === VIBE64_AGENT_RUN_STATE.FINALIZING
    ? "finalizing"
    : active
      ? "active"
      : "idle";
  return {
    active,
    completedAt: normalizeText(run.finishedAt),
    error: normalizeText(run.error),
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

function codexAppServerStatusFromValue(status = null) {
  if (typeof status === "string") {
    const normalized = normalizeText(status);
    if (normalized === "idle" || normalized === "notLoaded") {
      return "completed";
    }
    if (normalized === "systemError") {
      return "failed";
    }
    return normalized;
  }
  if (!isRecord(status)) {
    return "";
  }
  const type = normalizeText(status.type);
  if (type === "active") {
    return "inProgress";
  }
  if (type === "idle" || type === "notLoaded" || type === "completed") {
    return "completed";
  }
  if (type === "systemError" || type === "failed") {
    return "failed";
  }
  if (type === "interrupted") {
    return "interrupted";
  }
  return type;
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
    const runtime = await projectService.createRuntime();
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
  targetRoot = "",
  workdir = ""
} = {}) {
  if (!workdir) {
    return false;
  }
  if (containerWorkspacePath(targetRoot, workdir)) {
    return true;
  }
  const sessionWorktree = terminalWorktreePath(session);
  if (!sessionWorktree || path.resolve(sessionWorktree) !== path.resolve(workdir)) {
    return false;
  }
  const sessionRoot = String(session.sessionRoot || "").trim();
  return Boolean(sessionRoot) && pathInsideOrEqual(sessionRoot, workdir);
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

function normalizeCodexPromptHandoffSignature(sessionId, signature) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedSignature = String(signature || "").trim();
  if (
    !normalizedSessionId ||
    !normalizedSignature ||
    normalizedSignature.length > 512 ||
    normalizedSignature.includes("\n") ||
    normalizedSignature.includes("\r") ||
    !normalizedSignature.startsWith(`${normalizedSessionId}:`)
  ) {
    return "";
  }
  return normalizedSignature;
}

function normalizeCodexPromptHandoffOutputStart(value) {
  const normalizedValue = String(value ?? "").trim();
  if (!/^\d+$/u.test(normalizedValue)) {
    return 0;
  }
  const outputStart = Number(normalizedValue);
  return Number.isSafeInteger(outputStart) && outputStart >= 0 ? outputStart : 0;
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

function codexPromptHandoffTerminalInput(handoff = {}) {
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

function codexPromptHandoffSignature(sessionId = "") {
  return `${sessionId}:${Date.now()}`;
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

function activeCodexTerminal(session = {}) {
  const sessionId = normalizeText(session.sessionId);
  if (!sessionId) {
    return null;
  }
  const workdir = terminalWorktreePath(session);
  const terminals = listTerminalSessions({
    namespace: codexTerminalNamespace(sessionId)
  })
    .filter((terminal) => terminal.status !== "exited")
    .filter((terminal) => !workdir || terminal.metadata?.workdir === workdir)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
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

function codexAppServerTurnCanReceiveProviderActivity(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  if (!["active", "finalizing"].includes(normalizeText(turn.state))) {
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

function codexState(session = {}) {
  const metadata = session.metadata || {};
  const workdir = terminalWorktreePath(session);
  const codexConversationId = codexConversationIdForWorkdir(session, workdir);
  const codexThreadId = normalizeCodexThreadId(codexConversationId);
  const agentIdentity = codexAgentIdentityState(session, workdir);
  const agentTurn = codexAppServerTurnState(session);
  return {
    agentConversationId: agentIdentity?.conversationId || "",
    agentIdentity,
    agentIdentityProvider: agentIdentity?.provider || CODEX_AGENT_PROVIDER,
    agentIdentityStatus: agentIdentity?.status || "",
    agentResumeStrategy: agentIdentity?.resumeStrategy || "",
    codexAgentTurn: agentTurn,
    codexAgentTurnActive: agentTurn.active,
    agentWorkdir: agentIdentity?.workdir || workdir,
    codexWorkdir: workdir,
    codexPromptHandoffEchoInput: String(metadata.codex_prompt_handoff_echo_input || ""),
    codexPromptHandoffOutputStart: normalizeCodexPromptHandoffOutputStart(metadata.codex_prompt_handoff_output_start),
    codexPromptHandoffSignature: normalizeCodexPromptHandoffSignature(
      session.sessionId,
      metadata.codex_prompt_handoff_signature
    ),
    codexSessionBriefingEchoInput: String(metadata.codex_session_briefing_echo_input || ""),
    codexSessionBriefingOutputStart: normalizeCodexPromptHandoffOutputStart(metadata.codex_session_briefing_output_start),
    codexTerminal: activeCodexTerminal(session),
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
  const containerEndpoint = normalizeText(metadata.codex_app_server_container_endpoint);
  if (containerEndpoint) {
    return containerEndpoint;
  }
  const endpoint = normalizeText(metadata.codex_app_server_endpoint);
  return endpoint
    ? codexAppServerEndpointForTarget(endpoint, {
        target: "container"
      })
    : "";
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
    refreshRecommended: true
  };
}

function codexAppServerInterruptUnavailableResponse({
  active = false,
  threadId = "",
  turnId = ""
} = {}) {
  return {
    code: CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE,
    error: active
      ? "The active Codex app-server turn is not ready to interrupt yet."
      : "No active Codex app-server turn is available to interrupt.",
    ok: false,
    operationOutcome: "interrupt_unavailable",
    refreshRecommended: true,
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
  };
}

function sessionBriefingIsDelivered(session = {}) {
  return normalizeText(session.metadata?.codex_session_briefing_delivered) === "yes";
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
    "Describe the visible user-facing work in plain language. Keep detailed commands, package names, and logs for the terminal or final answer when they matter."
  ].join("\n").trim();
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
    "codex",
    ...(normalizedRemoteEndpoint ? ["--remote", normalizedRemoteEndpoint] : []),
    "--model",
    effectiveSettings.model,
    "-c",
    codexReasoningConfig,
    "--dangerously-bypass-approvals-and-sandbox",
    ...(normalizedThreadId ? ["resume", normalizedThreadId] : [])
  ];
  return studioUserStartupScript(codexCommand);
}

function codexTerminalArgs({
  agentSettings = {},
  codexRemoteEndpoint = "",
  codexThreadId,
  containerName,
  env = {},
  helperMount = null,
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  mounts = [],
  session = {},
  sessionId,
  targetRoot,
  terminalId,
  toolHomeSource = "",
  worktree
}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      codexStartupScript(codexThreadId, {
        agentSettings,
        remoteEndpoint: codexRemoteEndpoint
      })
    ],
    containerName,
    env,
    extraLabels: [
      studioDockerLabel("daemon", STUDIO_DAEMON_ID)
    ],
    image,
    kind: "codex-terminal",
    mounts: [
      codexAttachmentMount(),
      ...[helperMount].filter(Boolean),
      ...sessionExchangeMounts(session),
      ...mounts.filter(Boolean)
    ],
    sessionId,
    targetRoot,
    terminalId,
    toolHomeSource,
    workdir: worktree
  });
}

function sessionExchangeMounts(session = {}) {
  return [
    session.artifactsRoot,
    session.metadataRoot
  ]
    .map((source) => normalizeText(source))
    .filter(Boolean)
    .map((source) => ({
      source,
      target: source
    }));
}

function codexContainerName({
  scope = "",
  sessionId = "",
  targetRoot = "",
  terminalId = ""
} = {}) {
  const containerScope = normalizeText(scope || sessionId || GLOBAL_CODEX_TERMINAL_SCOPE);
  return terminalContainerName({
    kind: "codex",
    parts: [containerScope, terminalId],
    targetRoot
  });
}

function maskedCodexTerminalDockerArgs(args = []) {
  return maskedTerminalDockerArgs(args);
}

function createCodexTerminalController({
  codexAppServerActiveReconcileMs = CODEX_APP_SERVER_ACTIVE_RECONCILE_MS,
  codexAppServerProviderOptions = {},
  codexAppServerProviderFactory = createCodexAppServerAgentProvider,
  codexAppServerPromptDeliveryEnabled = CODEX_APP_SERVER_PROMPT_DELIVERY_ENABLED,
  codexToolHomeRequired = false,
  codexToolHomeSource = "",
  fixJobStore = defaultFixCodexJobStore,
  projectService,
  publishPromptInjected = async () => null,
  publishSessionChanged = async () => null
} = {}) {
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
  const codexAppServerAssistantTurns = new Map();
  const codexAppServerProgressTurns = new Map();
  const codexAppServerReasoningTurns = new Map();
  const codexAppServerReasoningPersistQueues = new Map();

  function resolvedCodexToolHomeSource() {
    return normalizeText(codexToolHomeSource || codexAppServerProviderOptions.toolHomeSource);
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

  function codexAppServerProviderKey(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw new Error("Vibe64 session ID is required.");
    }
    return [
      normalizedSessionId,
      normalizeText(options.targetRoot),
      terminalEnvironmentFingerprint(options.terminalEnv),
      normalizeText(options.toolHomeSource),
      normalizeText(options.workdir)
    ].join("\u001f");
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

  async function ensureCodexAppServerDaemonForSession(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const providerOptions = codexAppServerRuntimeOptions(options);
    const provider = codexAppServerProviderForSession(normalizedSessionId, providerOptions);
    try {
      if (codexAppServerProviderUsesDocker()) {
        await ensureTargetRuntimeNetwork(providerOptions.targetRoot);
      }
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

  function codexAppServerRuntimeOptions({
    runtimeDir = "",
    targetRoot = "",
    terminalEnv = {},
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    return {
      ...codexAppServerProviderOptions,
      runtimeDir: normalizeText(runtimeDir),
      targetRoot: normalizeText(targetRoot),
      terminalEnv: isRecord(terminalEnv) ? terminalEnv : {},
      toolHomeSource: normalizeText(toolHomeSource) || resolvedCodexToolHomeSource(),
      workdir: normalizeText(workdir)
    };
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
    const effectiveTargetRoot = normalizeText(targetRoot) || terminalTargetRoot(session, projectService);
    const effectiveWorkdir = normalizeText(workdir) || terminalWorktreePath(session);
    const effectiveTerminalEnv = isRecord(terminalEnv)
      ? terminalEnv
      : await projectTerminalEnvironment({
          projectService,
          runtime: runtime || await projectService.createRuntime(),
          session,
          target: "codex",
          targetRoot: effectiveTargetRoot
        });
    return codexAppServerRuntimeOptions({
      runtimeDir: normalizeText(runtimeDir) || normalizeText(metadata.codex_app_server_runtime_dir),
      targetRoot: effectiveTargetRoot,
      terminalEnv: effectiveTerminalEnv,
      toolHomeSource,
      workdir: effectiveWorkdir
    });
  }

  function sessionHasCodexAppServerRuntime(session = {}) {
    const metadata = session.metadata || {};
    return Boolean(
      normalizeText(metadata.codex_app_server_endpoint) ||
      normalizeText(metadata.codex_app_server_runtime_dir) ||
      normalizeText(metadata.codex_app_server_socket_path)
    );
  }

  function codexAppServerProviderUsesDocker() {
    return codexAppServerProviderOptions.useDocker !== false;
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

  async function reconcileCodexAppServerActiveTurn(session = {}) {
    const sessionId = normalizeText(session.sessionId);
    const turn = codexAppServerTurnState(session);
    if (!sessionId || !turn.active || !turn.threadId || !sessionHasCodexAppServerRuntime(session)) {
      return session;
    }
    if (turn.state === "finalizing") {
      const finalizingExpired = codexAppServerFinalizingExpired(turn);
      const result = await finalizeCodexAppServerAssistantResult(sessionId, turn.threadId, turn.turnId, {
        recoverFromProvider: finalizingExpired,
        status: turn.status || "completed"
      });
      const runtime = await projectService.createRuntime();
      const currentSession = await runtime.getSession(sessionId);
      if (result?.processed) {
        return currentSession;
      }
      const currentTurn = codexAppServerTurnState(currentSession);
      if (codexAppServerFinalizingExpired(currentTurn)) {
        await stopCodexAppServerTurnWithResultDeliveryFailure(sessionId, turn.threadId, turn.turnId, {
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
    if (typeof provider?.readThread !== "function") {
      return session;
    }
    const thread = await provider.readThread(turn.threadId);
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
        status
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await completeCodexAppServerTurn(sessionId, turn.threadId, turn.turnId, {
        status
      });
    }
    const runtime = await projectService.createRuntime();
    return runtime.getSession(sessionId);
  }

  async function codexAppServerRuntimeForVisibleTerminal(sessionId = "", threadId = "", options = {}) {
    if (!normalizeText(threadId)) {
      return null;
    }
    const runtime = options.runtime || await projectService.createRuntime();
    const session = options.session || await runtime.getSession(sessionId);
    const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
      ...options,
      runtime
    });
    const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
    return provider.ensureRuntime();
  }

  async function unsubscribeCodexAppServerThreadForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: true,
        sessionId: normalizedSessionId,
        status: "notSubscribed"
      };
    }
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
      runtime
    });
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

  function closeCodexAppServerProvider(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = codexAppServerProviders.get(normalizedProviderKey);
    stopCodexAppServerWellbeing(normalizedProviderKey);
    codexAppServerManagedSessions.delete(normalizedProviderKey);
    if (!provider) {
      return;
    }
    const subscriptionPrefix = `${normalizedProviderKey}:`;
    for (const [key, unsubscribe] of codexAppServerEventSubscriptions.entries()) {
      if (key.startsWith(subscriptionPrefix)) {
        unsubscribe?.();
        codexAppServerEventSubscriptions.delete(key);
      }
    }
    provider.close?.();
    codexAppServerProviders.delete(normalizedProviderKey);
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

  function codexAppServerNotificationParams(notification = {}) {
    const params = notification?.params;
    return params && typeof params === "object" && !Array.isArray(params) ? params : {};
  }

  function codexAppServerNotificationEvent(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const candidates = [
      params.event,
      params.msg,
      params.entry,
      params.record,
      notification.event,
      notification.msg,
      notification.entry,
      notification.record
    ];
    for (const candidate of candidates) {
      if (isRecord(candidate)) {
        return candidate;
      }
    }
    if (isRecord(params.payload) || normalizeText(params.type)) {
      return params;
    }
    if (isRecord(notification.payload) || normalizeText(notification.type)) {
      return notification;
    }
    return null;
  }

  function codexAppServerNotificationEventType(notification = {}, event = null) {
    const params = codexAppServerNotificationParams(notification);
    return normalizeText(event?.type || params.type || notification.type || notification.method);
  }

  function codexAppServerNotificationEventPayload(notification = {}, event = null) {
    if (isRecord(event?.payload)) {
      return event.payload;
    }
    const params = codexAppServerNotificationParams(notification);
    if (isRecord(params.payload)) {
      return params.payload;
    }
    if (isRecord(notification.payload)) {
      return notification.payload;
    }
    return {};
  }

  function codexAppServerNotificationThreadId(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const event = codexAppServerNotificationEvent(notification);
    const payload = codexAppServerNotificationEventPayload(notification, event);
    return normalizeText(
      params.threadId ||
      params.thread_id ||
      params.thread?.id ||
      event?.threadId ||
      event?.thread_id ||
      payload.threadId ||
      payload.thread_id
    );
  }

  function codexAppServerNotificationTurnId(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const event = codexAppServerNotificationEvent(notification);
    const payload = codexAppServerNotificationEventPayload(notification, event);
    return normalizeText(
      params.turnId ||
      params.turn_id ||
      params.turn?.id ||
      event?.turnId ||
      event?.turn_id ||
      payload.turnId ||
      payload.turn_id
    );
  }

  function codexAppServerNotificationTurnStatus(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const turnStatus = normalizeText(params.turn?.status);
    if (turnStatus) {
      return turnStatus;
    }
    return codexAppServerStatusFromValue(params.status);
  }

  function codexAppServerErrorText(value = null) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return normalizeText(value);
    }
    if (!isRecord(value)) {
      return "";
    }
    return normalizeText(value.message || value.error || value.reason || value.code);
  }

  function codexAppServerNotificationError(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const status = params.status && typeof params.status === "object" && !Array.isArray(params.status)
      ? params.status
      : {};
    const turn = params.turn && typeof params.turn === "object" && !Array.isArray(params.turn)
      ? params.turn
      : {};
    return normalizeText(
      codexAppServerErrorText(params.error) ||
      params.message ||
      codexAppServerErrorText(status.error) ||
      status.message ||
      codexAppServerErrorText(turn.error) ||
      turn.message
    );
  }

  function codexAppServerNotificationItem(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const item = params.item;
    return item && typeof item === "object" && !Array.isArray(item) ? item : null;
  }

  function codexAppServerTextInputText(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return "";
    }
    if (normalizeText(input.type) !== "text") {
      return "";
    }
    return normalizeText(input.text);
  }

  function codexAppServerUserMessageText(item = {}) {
    if (!item || normalizeText(item.type) !== "userMessage") {
      return "";
    }
    const content = Array.isArray(item.content) ? item.content : [];
    return content
      .map((input) => codexAppServerTextInputText(input))
      .filter(Boolean)
      .join("\n\n");
  }

  function codexAppServerContentText(value = null) {
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => codexAppServerContentText(entry)).filter(Boolean).join("");
    }
    if (!value || typeof value !== "object") {
      return "";
    }
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.value === "string") {
      return value.value;
    }
    if (typeof value.content === "string" || Array.isArray(value.content)) {
      return codexAppServerContentText(value.content);
    }
    if (typeof value.message === "string" || Array.isArray(value.message)) {
      return codexAppServerContentText(value.message);
    }
    if (value.message && typeof value.message === "object") {
      return codexAppServerContentText(value.message.content || value.message.text);
    }
    return "";
  }

  function codexAppServerAssistantItemText(item = {}) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "";
    }
    const type = normalizeText(item.type);
    const role = normalizeText(item.role || item.author?.role);
    const isAssistant = role === "assistant" ||
      type === "agentMessage" ||
      type === "assistantMessage" ||
      type === "assistant_message" ||
      type === "outputMessage" ||
      type === "message" && role === "assistant";
    if (!isAssistant) {
      return "";
    }
    return normalizeText(
      codexAppServerContentText(item.content) ||
      codexAppServerContentText(item.text) ||
      codexAppServerContentText(item.message)
    );
  }

  function codexAppServerTranscriptAssistantText(notification = {}) {
    const event = codexAppServerNotificationEvent(notification);
    if (!isRecord(event)) {
      return "";
    }
    const eventType = codexAppServerNotificationEventType(notification, event);
    const payload = codexAppServerNotificationEventPayload(notification, event);
    const payloadType = normalizeText(payload.type);
    const phase = normalizeText(payload.phase || event.phase);
    if (eventType === "task_complete") {
      return normalizeText(
        codexAppServerContentText(payload.last_agent_message) ||
        codexAppServerContentText(payload.lastAgentMessage)
      );
    }
    if (eventType === "event_msg" && payloadType === "agent_message") {
      if (phase && phase !== "final_answer") {
        return "";
      }
      return normalizeText(
        codexAppServerContentText(payload.message) ||
        codexAppServerContentText(payload.text) ||
        codexAppServerContentText(payload.content)
      );
    }
    if (eventType === "response_item") {
      if (phase && phase !== "final_answer") {
        return "";
      }
      return codexAppServerAssistantItemText(payload);
    }
    return "";
  }

  function codexAppServerNotificationFinalAssistantText(notification = {}) {
    const transcriptText = codexAppServerTranscriptAssistantText(notification);
    if (transcriptText) {
      return transcriptText;
    }
    const item = codexAppServerNotificationItem(notification);
    const phase = normalizeText(item?.phase);
    return phase === "final_answer" ? codexAppServerAssistantItemText(item) : "";
  }

  function codexAppServerNotificationAssistantText(notification = {}) {
    const finalText = codexAppServerNotificationFinalAssistantText(notification);
    if (finalText) {
      return finalText;
    }
    return "";
  }

  function codexAppServerNotificationProgressText(notification = {}) {
    if (codexAppServerNotificationFinalAssistantText(notification)) {
      return "";
    }
    const params = codexAppServerNotificationParams(notification);
    return normalizeText(
      codexAppServerAssistantItemText(codexAppServerNotificationItem(notification)) ||
      codexAppServerContentText(params.delta) ||
      codexAppServerContentText(params.text) ||
      codexAppServerContentText(params.output) ||
      codexAppServerContentText(params.response)
    );
  }

  function codexAppServerNotificationProgressDelta(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    return codexAppServerContentText(params.delta);
  }

  function codexAppServerNotificationAssistantItemId(notification = {}) {
    const item = codexAppServerNotificationItem(notification);
    const itemId = normalizeText(item?.id);
    if (itemId) {
      return itemId;
    }
    if (codexAppServerNotificationFinalAssistantText(notification)) {
      return "codex-app-server-final-assistant-message";
    }
    return "";
  }

  function codexAppServerProviderThread(value = {}) {
    if (isRecord(value?.raw)) {
      return value.raw;
    }
    if (isRecord(value?.response?.thread)) {
      return value.response.thread;
    }
    if (isRecord(value?.thread)) {
      return value.thread;
    }
    return isRecord(value) ? value : {};
  }

  function codexAppServerProviderTurnId(turn = {}) {
    return normalizeText(turn.id || turn.turnId || turn.turn_id || turn.turn?.id);
  }

  function codexAppServerProviderTurnItems(turn = {}) {
    return [
      ...(Array.isArray(turn.items) ? turn.items : []),
      ...(Array.isArray(turn.itemsView) ? turn.itemsView : [])
    ].filter(isRecord);
  }

  function codexAppServerProviderTurnAssistantText(turn = {}) {
    const seenItemIds = new Set();
    return codexAppServerProviderTurnItems(turn)
      .filter((item) => {
        const phase = normalizeText(item.phase);
        return !phase || phase === "final_answer";
      })
      .map((item) => {
        const itemId = normalizeText(item.id);
        if (itemId) {
          if (seenItemIds.has(itemId)) {
            return "";
          }
          seenItemIds.add(itemId);
        }
        return codexAppServerAssistantItemText(item);
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function codexAppServerProviderThreadAssistantText(value = {}, turnId = "") {
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedTurnId) {
      return "";
    }
    const thread = codexAppServerProviderThread(value);
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const turn = turns.find((candidate) => codexAppServerProviderTurnId(candidate) === normalizedTurnId);
    return turn ? codexAppServerProviderTurnAssistantText(turn) : "";
  }

  function codexAppServerAssistantTurnKey(threadId = "", turnId = "") {
    return codexAppServerTurnKey(threadId, turnId || "*");
  }

  function codexAppServerAssistantTurnState(threadId = "", turnId = "") {
    const key = codexAppServerAssistantTurnKey(threadId, turnId);
    const existing = codexAppServerAssistantTurns.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      chunks: [],
      items: new Map()
    };
    codexAppServerAssistantTurns.set(key, created);
    return created;
  }

  function recordCodexAppServerAssistantNotification(threadId = "", notification = {}) {
    const method = normalizeText(notification.method);
    if (method === "item/reasoning/summaryPartAdded" || method === "item/reasoning/summaryTextDelta") {
      return {
        recorded: false
      };
    }
    const normalizedThreadId = normalizeText(threadId);
    const turnId = codexAppServerNotificationTurnId(notification);
    const text = codexAppServerNotificationAssistantText(notification);
    if (!normalizedThreadId || !text) {
      return {
        progressText: normalizedThreadId ? codexAppServerNotificationProgressText(notification) : "",
        recorded: false,
        turnId
      };
    }
    const state = codexAppServerAssistantTurnState(normalizedThreadId, turnId);
    const itemId = codexAppServerNotificationAssistantItemId(notification);
    if (itemId) {
      state.items.set(itemId, text);
      return {
        recorded: true,
        turnId
      };
    }
    state.chunks.push(text);
    return {
      recorded: true,
      turnId
    };
  }

  function readCodexAppServerAssistantText(threadId = "", turnId = "") {
    const state = codexAppServerAssistantTurns.get(codexAppServerAssistantTurnKey(threadId, turnId)) ||
      codexAppServerAssistantTurns.get(codexAppServerAssistantTurnKey(threadId, "*"));
    if (!state) {
      return "";
    }
    const itemText = [...state.items.values()].filter(Boolean).join("\n\n").trim();
    if (itemText) {
      return itemText;
    }
    return state.chunks.join("").trim();
  }

  function cleanupCodexAppServerAssistantTurn(threadId = "", turnId = "") {
    codexAppServerAssistantTurns.delete(codexAppServerAssistantTurnKey(threadId, turnId));
    codexAppServerAssistantTurns.delete(codexAppServerAssistantTurnKey(threadId, "*"));
  }

  function codexAppServerProgressTurnKey(threadId = "", turnId = "") {
    return codexAppServerTurnKey(threadId, turnId || "*");
  }

  function codexAppServerProgressTurnState(threadId = "", turnId = "") {
    const key = codexAppServerProgressTurnKey(threadId, turnId);
    const existing = codexAppServerProgressTurns.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      items: new Map(),
      sequence: 0
    };
    codexAppServerProgressTurns.set(key, created);
    return created;
  }

  function codexAppServerNotificationProgressItemId(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const event = codexAppServerNotificationEvent(notification);
    const payload = codexAppServerNotificationEventPayload(notification, event);
    const item = codexAppServerNotificationItem(notification);
    const itemId = normalizeText(
      item?.id ||
      params.itemId ||
      params.item_id ||
      payload.itemId ||
      payload.item_id ||
      payload.id
    );
    if (itemId) {
      return itemId;
    }
    return codexAppServerNotificationProgressDelta(notification)
      ? `${normalizeText(notification.method) || "codex-app-server"}:delta`
      : "";
  }

  function codexAppServerProgressEventId({
    itemId = "",
    sequence = 0,
    sessionId = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const identity = [
      normalizeText(sessionId),
      normalizeText(threadId),
      normalizeText(turnId) || "*",
      normalizeText(itemId) || `sequence-${sequence}`
    ].join("\0");
    const hash = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 10);
    return [
      "codex-live-progress",
      normalizeText(turnId) || "turn",
      normalizeText(itemId) || `progress-${sequence}`,
      hash
    ].join(":");
  }

  function recordCodexAppServerProgressNotification(threadId = "", notification = {}, progressText = "", {
    sessionId = "",
    turnId = ""
  } = {}) {
    const normalizedThreadId = normalizeText(threadId);
    const sourceText = codexAppServerLiveProgressSourceText(progressText);
    const normalizedTurnId = normalizeText(turnId) || codexAppServerNotificationTurnId(notification);
    if (!normalizedThreadId || !sourceText) {
      return null;
    }
    const state = codexAppServerProgressTurnState(normalizedThreadId, normalizedTurnId);
    const itemId = codexAppServerNotificationProgressItemId(notification);
    const deltaText = codexAppServerLiveProgressSourceText(codexAppServerNotificationProgressDelta(notification));
    let fullText = sourceText;
    let sequence = 0;
    if (itemId) {
      const previousText = state.items.get(itemId) || "";
      fullText = deltaText
        ? [previousText, deltaText].filter(Boolean).join(" ")
        : sourceText;
      fullText = normalizeText(fullText);
      if (!fullText || fullText === previousText) {
        return null;
      }
      state.items.set(itemId, fullText);
    } else {
      state.sequence += 1;
      sequence = state.sequence;
    }
    const text = codexAppServerLiveProgressText(fullText);
    if (!text) {
      return null;
    }
    return {
      at: new Date().toISOString(),
      id: codexAppServerProgressEventId({
        itemId,
        sequence,
        sessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      }),
      itemId,
      replace: Boolean(itemId),
      text,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    };
  }

  function cleanupCodexAppServerProgressTurn(threadId = "", turnId = "") {
    codexAppServerProgressTurns.delete(codexAppServerProgressTurnKey(threadId, turnId));
    codexAppServerProgressTurns.delete(codexAppServerProgressTurnKey(threadId, "*"));
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
      persistedText: "",
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
      chunks: []
    };
    if (method === "item/reasoning/summaryTextDelta") {
      const params = codexAppServerNotificationParams(notification);
      const delta = codexAppServerContentText(params.delta || params.text);
      if (delta) {
        summary.chunks.push(delta);
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
    return [...state.summaries.values()]
      .map((summary) => summary.chunks.join("").trim())
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
    const reasoningText = readCodexAppServerReasoningText(threadId, turnId);
    if (!normalizedSessionId || !state || !reasoningText || state.persistedText === reasoningText) {
      return;
    }
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
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
    const written = await runtime.store.writeConversationThinkingMessage(normalizedSessionId, {
      at: state.createdAt,
      requireOpenTurn: false,
      text: reasoningText
    });
    if (!written) {
      return;
    }
    state.persistedText = reasoningText;
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

  function queueCodexAppServerReasoningPersist(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerReasoningPersistKey(sessionId, threadId, turnId);
    if (!key) {
      return Promise.resolve();
    }
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

  async function publishCodexAppServerLiveProgress(sessionId = "", threadId = "", notification = {}, progressText = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedText = normalizeText(progressText);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedText) {
      return null;
    }
    try {
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(normalizedSessionId);
      const turn = codexAppServerTurnState(session);
      const notificationTurnId = codexAppServerNotificationTurnId(notification);
      if (!codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, notificationTurnId)) {
        vibe64SessionDebugLog("server.codexTerminal.appServerLiveProgress.ignored", {
          currentState: turn.state,
          currentStatus: turn.status,
          currentThreadId: turn.threadId,
          currentTurnId: turn.turnId,
          sessionId: normalizedSessionId,
          threadId: normalizedThreadId,
          turnId: notificationTurnId
        });
        return null;
      }
      const progress = recordCodexAppServerProgressNotification(
        normalizedThreadId,
        notification,
        normalizedText,
        {
          sessionId: normalizedSessionId,
          turnId: notificationTurnId || turn.turnId
        }
      );
      if (!progress) {
        return null;
      }
      await publishSessionChanged(normalizedSessionId, {
        payload: {
          codexLiveProgress: progress
        },
        reason: "codex-app-server-live-progress"
      });
      return progress;
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerLiveProgress.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId
      });
      return null;
    }
  }

  async function flushCodexAppServerReasoningPersist(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerReasoningPersistKey(sessionId, threadId, turnId);
    const queued = key ? codexAppServerReasoningPersistQueues.get(key) : null;
    if (queued) {
      await queued.catch(() => null);
    }
    await persistCodexAppServerReasoningSummary(sessionId, threadId, turnId);
  }

  function cleanupCodexAppServerReasoningTurn(threadId = "", turnId = "") {
    codexAppServerReasoningTurns.delete(codexAppServerReasoningTurnKey(threadId, turnId));
    codexAppServerReasoningTurns.delete(codexAppServerReasoningTurnKey(threadId, "*"));
  }

  function cleanupCodexAppServerUntrackedTurn(threadId = "", turnId = "") {
    cleanupCodexAppServerAssistantTurn(threadId, turnId);
    cleanupCodexAppServerProgressTurn(threadId, turnId);
    cleanupCodexAppServerReasoningTurn(threadId, turnId);
  }

  function codexAppServerUserMessageIsVibe64Routed(text = "") {
    const message = normalizeText(text);
    return message.includes("VIBE64_ROUTED_TURN: yes") ||
      message.startsWith("VIBE64_SESSION_BOOTSTRAP:") ||
      message.startsWith("Vibe64 interactive conversation turn:") ||
      message.startsWith("Vibe64 session briefing") ||
      message.startsWith("Vibe64 workflow context:");
  }

  async function mirrorCodexAppServerTerminalUserMessage(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const item = codexAppServerNotificationItem(notification);
    const text = codexAppServerUserMessageText(item);
    if (!normalizedSessionId || !text || codexAppServerUserMessageIsVibe64Routed(text)) {
      return;
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerTerminalUserMessage.ignored", {
      itemId: normalizeText(item?.id),
      sessionId: normalizedSessionId,
      threadId: normalizedThreadId,
      turnId: codexAppServerNotificationTurnId(notification)
    });
  }

  function codexAppServerSessionIsWaitingForAgent(session = {}) {
    return normalizeText(session.stepMachine?.status) === "awaiting_agent_result";
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

  async function applyCodexAppServerAgentResult(runtime, session = {}, parsed = {}, threadId = "", turnId = "") {
    const input = parsed.visibleText
      ? {
          ...parsed.input,
          conversationText: parsed.visibleText
        }
      : parsed.input;
    if (codexAppServerSessionIsWaitingForAgent(session)) {
      await runtime.submitCurrentStepInput(session.sessionId, input);
      return true;
    }
    if (
      codexAppServerRunMatchesAgentResult(session, parsed.input, threadId, turnId) &&
      codexAppServerRecoveryStateMatchesAgentResult(session, parsed.input)
    ) {
      await restoreCodexAppServerAgentWaitForResult(runtime, session, parsed.input);
      await runtime.submitCurrentStepInput(session.sessionId, input);
      return true;
    }
    return false;
  }

  function codexAppServerSessionAcceptsPlainAgentResponse(session = {}) {
    return normalizeText(session.currentStepDefinition?.autopilot?.kind) === "agent_conversation";
  }

  async function recoverCodexAppServerAssistantTextFromProvider(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return "";
    }
    try {
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(normalizedSessionId);
      if (!sessionHasCodexAppServerRuntime(session)) {
        return "";
      }
      const provider = await ensureCodexAppServerDaemonForSession(
        normalizedSessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        })
      );
      if (typeof provider?.resumeThread !== "function") {
        return "";
      }
      const resumedThread = await provider.resumeThread(normalizedThreadId, {
        cwd: terminalWorktreePath(session)
      });
      const assistantText = codexAppServerProviderThreadAssistantText(resumedThread, normalizedTurnId);
      if (assistantText) {
        vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.recovered", {
          sessionId: normalizedSessionId,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      return assistantText;
    } catch (error) {
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.recovery.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return "";
    }
  }

  async function submitCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
    recoverFromProvider = false
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    let assistantText = readCodexAppServerAssistantText(threadId, turnId);
    const reasoningText = readCodexAppServerReasoningText(threadId, turnId);
    if (normalizedSessionId && !assistantText && recoverFromProvider) {
      assistantText = await recoverCodexAppServerAssistantTextFromProvider(
        normalizedSessionId,
        threadId,
        turnId
      );
    }
    if (!normalizedSessionId || !assistantText && !reasoningText) {
      return {
        ok: false,
        processed: false,
        reason: "empty"
      };
    }
    try {
      const runtime = await projectService.createRuntime();
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
      const session = await runtime.getSession(normalizedSessionId);
      const parsed = parseAgentTurnResultEnvelope(assistantText, {
        source: "codex"
      });
      if (parsed.ok) {
        const applied = await applyCodexAppServerAgentResult(runtime, session, parsed, threadId, turnId);
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

      if (!codexAppServerSessionIsWaitingForAgent(session)) {
        const visibleText = stripAgentTurnResultEnvelope(assistantText);
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

      const visibleText = stripAgentTurnResultEnvelope(assistantText);
      if (visibleText && codexAppServerSessionAcceptsPlainAgentResponse(session)) {
        await runtime.submitCurrentStepInput(normalizedSessionId, {
          fields: {
            response: visibleText
          },
          kind: "ready",
          source: "codex",
          stepId: normalizeText(session.currentStep),
          stepStatus: normalizeText(session.stepMachine?.status)
        });
        await publishSessionChanged(normalizedSessionId, {
          reason: "codex-app-server-agent-result"
        });
        return {
          ok: true,
          processed: true,
          reason: "plain_agent_response"
        };
      }

      await runtime.returnControlFromAgentWait(normalizedSessionId, {
        inputPrompt: "The agent response did not include the Vibe64 result envelope. Retry the step.",
        message: parsed.error
      });
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-app-server-agent-result-invalid"
      });
      vibe64SessionDebugLog("server.codexTerminal.appServerAgentResult.invalid", {
        error: parsed.error,
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
        error: errorMessage(error, "Codex app-server assistant result could not be processed."),
        ok: false,
        processed: false,
        reason: "error"
      };
    } finally {
      cleanupCodexAppServerAssistantTurn(threadId, turnId);
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
      providerInterface: "app-server",
      providerStatus: normalizeText(status),
      providerThreadId: normalizeText(threadId),
      providerTurnId: normalizeText(turnId),
      state: normalizedRunState,
      stepId: normalizeText(session.currentStep),
      stepStatus: normalizeText(session.stepMachine?.status),
      updatedAt: normalizeText(updatedAt)
    };
    if ([VIBE64_AGENT_RUN_STATE.ACTIVE, VIBE64_AGENT_RUN_STATE.STARTING].includes(normalizedRunState)) {
      patch.startedAt = normalizeText(updatedAt);
    }
    if (!vibe64AgentRunStateIsActive(normalizedRunState)) {
      patch.finishedAt = normalizeText(updatedAt);
    }
    return patch;
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

  async function claimCodexAppServerTurnStart(runtime, sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
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
      if (currentTurn.active && !codexAppServerTurnIsPendingPromptHandoff(currentTurn)) {
        claimResult = {
          claimed: false,
          response: codexAppServerTurnAlreadyRunningResponse(currentSession),
          session: currentSession
        };
        return claimResult;
      }
      const updatedAt = new Date().toISOString();
      const runPatch = codexAppServerAgentRunPatch({
        runState: VIBE64_AGENT_RUN_STATE.STARTING,
        session: currentSession,
        status: "starting",
        updatedAt
      });
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
    publishReason = "",
    runState = VIBE64_AGENT_RUN_STATE.COMPLETED,
    status = "",
    threadId = "",
    turnId = "",
    updatedAt = new Date().toISOString()
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: "Vibe64 session ID is required."
      };
    }
    const runtime = await projectService.createRuntime();
    const session = typeof runtime?.getSession === "function"
      ? await runtime.getSession(normalizedSessionId).catch(() => null)
      : null;
    const identity = codexAppServerRunIdentityForPatch(session || {}, {
      threadId,
      turnId
    });
    const runPatch = codexAppServerAgentRunPatch({
      error,
      runState,
      session: session || {},
      status,
      threadId: identity.threadId,
      turnId: identity.turnId,
      updatedAt
    });
    let wrote = false;
    let stale = null;
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = typeof runtime?.getSession === "function"
        ? await runtime.getSession(normalizedSessionId).catch(() => null)
        : null;
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
      reason: publishReason || "codex-app-server-turn-state"
    });
    return {
      ok: true
    };
  }

  async function markCodexAppServerTurnActive(sessionId = "", input = {}) {
    if (input.requireTrackedTurn === true) {
      const runtime = await projectService.createRuntime();
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
      publishReason: "codex-app-server-turn-active",
      runState: status === "starting" ? VIBE64_AGENT_RUN_STATE.STARTING : VIBE64_AGENT_RUN_STATE.ACTIVE,
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    scheduleCodexAppServerActiveRecovery(sessionId);
    return result;
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
    return writeCodexAppServerAgentRun(sessionId, {
      error: normalizeText(input.error),
      publishReason: "codex-app-server-turn-idle",
      runState: terminalCodexAppServerAgentRunState(status),
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
  }

  async function currentCodexAppServerTurnId(sessionId = "", threadId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId) {
      return "";
    }
    const runtime = await projectService.createRuntime();
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

  function finalizeCodexAppServerRecordedAssistant(sessionId = "", threadId = "", notification = {}, {
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return;
    }
    void (async () => {
      const turnId = await resolveCodexAppServerTurnId(
        normalizedSessionId,
        normalizedThreadId,
        codexAppServerNotificationTurnId(notification)
      );
      if (!turnId || !codexAppServerCompletedTurns.has(codexAppServerTurnKey(normalizedThreadId, turnId))) {
        return;
      }
      await finalizeCodexAppServerAssistantResult(normalizedSessionId, normalizedThreadId, turnId, {
        status
      });
    })();
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
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(normalizedSessionId);
      const turn = codexAppServerTurnState(session);
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
    const runtime = await projectService.createRuntime();
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
      const runtime = await projectService.createRuntime();
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
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedStatus = normalizeText(status) || "completed";
    const normalizedTurnId = await resolveCodexAppServerTurnId(normalizedSessionId, normalizedThreadId, turnId);
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const existingTurn = codexAppServerTurnState(session);
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

  async function stopCodexAppServerTurnWithProviderFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    ok = false,
    status = "failed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedStatus = normalizeText(status) || "failed";
    const normalizedTurnId = await resolveCodexAppServerTurnId(normalizedSessionId, normalizedThreadId, turnId);
    const message = codexAppServerStoppedTurnMessage(normalizedStatus, error);
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    if (codexAppServerSessionIsWaitingForAgent(session)) {
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
    reason = "",
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedStatus = normalizeText(status) || "completed";
    const normalizedTurnId = await resolveCodexAppServerTurnId(normalizedSessionId, normalizedThreadId, turnId);
    const runtime = await projectService.createRuntime();
    const currentSession = await runtime.getSession(normalizedSessionId);
    const currentTurn = codexAppServerTurnState(currentSession);
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
    const message = `${CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE} Retry the step.`;
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
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

  function subscribeCodexAppServerEvents(sessionId = "", provider = null, threadId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId || !normalizedThreadId || typeof provider?.subscribe !== "function") {
      return;
    }
    const providerKey = codexAppServerProviderKey(normalizedSessionId, options);
    const key = codexAppServerEventSubscriptionKey(providerKey, normalizedThreadId);
    if (codexAppServerEventSubscriptions.has(key)) {
      return;
    }
    const unsubscribe = provider.subscribe((notification = {}) => {
      const method = normalizeText(notification.method);
      const notificationThreadId = codexAppServerNotificationThreadId(notification);
      if (notificationThreadId && notificationThreadId !== normalizedThreadId) {
        return;
      }
      if (recordCodexAppServerReasoningNotification(normalizedThreadId, notification)) {
        void queueCodexAppServerReasoningPersist(
          normalizedSessionId,
          normalizedThreadId,
          codexAppServerNotificationTurnId(notification)
        );
      }
      const assistantRecord = recordCodexAppServerAssistantNotification(normalizedThreadId, notification);
      if (assistantRecord?.progressText) {
        void publishCodexAppServerLiveProgress(
          normalizedSessionId,
          normalizedThreadId,
          notification,
          assistantRecord.progressText
        );
      }
      if (assistantRecord?.recorded) {
        finalizeCodexAppServerRecordedAssistant(normalizedSessionId, normalizedThreadId, notification);
      }
      if (method === "item/started" || method === "item/completed") {
        const item = codexAppServerNotificationItem(notification);
        if (normalizeText(item?.type) === "userMessage") {
          void mirrorCodexAppServerTerminalUserMessage(normalizedSessionId, normalizedThreadId, notification);
          return;
        }
      }
      if (method === "turn/started") {
        void markCodexAppServerTurnActive(normalizedSessionId, {
          requireTrackedTurn: true,
          status: codexAppServerNotificationTurnStatus(notification) || "inProgress",
          threadId: normalizedThreadId,
          turnId: codexAppServerNotificationTurnId(notification)
        });
        return;
      }
      if (method === "turn/completed") {
        const turnId = codexAppServerNotificationTurnId(notification);
        const status = codexAppServerNotificationTurnStatus(notification) || "completed";
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          void stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
            error: codexAppServerNotificationError(notification),
            status
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          void completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, turnId, {
            status
          });
        }
        return;
      }
      if (method === "thread/status/changed") {
        const status = codexAppServerNotificationTurnStatus(notification);
        if (codexAppServerTurnStatusIsActive(status)) {
          void (async () => {
            const turnId = await resolveCodexAppServerTurnId(
              normalizedSessionId,
              normalizedThreadId,
              codexAppServerNotificationTurnId(notification)
            );
            await markCodexAppServerTurnActive(normalizedSessionId, {
              requireTrackedTurn: true,
              status,
              threadId: normalizedThreadId,
              turnId
            });
          })();
          return;
        }
        const turnId = codexAppServerNotificationTurnId(notification);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          void stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
            error: codexAppServerNotificationError(notification),
            status,
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          void completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, turnId, {
            status
          });
        }
      }
    });
    codexAppServerEventSubscriptions.set(key, unsubscribe);
  }

  async function startCodexTerminalSession(sessionId) {
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const targetRoot = terminalTargetRoot(session, projectService);
    if (!targetRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Vibe64 Codex target root is not available."
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
      targetRoot,
      workdir
    })) {
      return retryableTerminalFailure({
        ok: false,
        error: workdir
          ? "Vibe64 Codex workdir is outside the target root."
          : "Create the session worktree before starting Codex."
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
    const imageResult = await resolveTerminalToolchainImage({
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    if (imageResult.ok === false) {
      return imageResult;
    }

    await prepareCodexAttachmentRoot();
    await ensureTargetRuntimeNetwork(targetRoot);
    await ensureAdapterRuntimeContainers({
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    const baseTerminalEnv = await projectTerminalEnvironment({
      projectService,
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    const codexThreadId = codexConversationIdForWorkdir(session, workdir);
    let appServerRuntime = null;
    if (codexThreadId) {
      try {
        appServerRuntime = await codexAppServerRuntimeForVisibleTerminal(sessionId, codexThreadId, {
          runtime,
          session,
          terminalEnv: baseTerminalEnv,
          targetRoot,
          toolHomeSource: toolHome.toolHomeSource,
          workdir
        });
      } catch (error) {
        return retryableTerminalFailure({
          ok: false,
          error: `Codex app-server is not available: ${errorMessage(error)}`
        });
      }
    }
    const appServerRuntimeMount = appServerRuntime?.runtimeDir && appServerRuntime?.containerRuntimeDir
      ? {
          source: appServerRuntime.runtimeDir,
          target: appServerRuntime.containerRuntimeDir
        }
      : null;
    const terminalEnv = baseTerminalEnv;
    const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
    const namespace = codexTerminalNamespace(sessionId);
    const terminalResponse = startTerminalSession({
      args: ({ id }) => codexTerminalArgs({
        agentSettings: codexAgentSettingsFromSession(session),
        codexRemoteEndpoint: appServerRuntime?.containerEndpoint || codexRemoteEndpointForWorkdir(session, workdir),
        codexThreadId,
        containerName: codexContainerName({
          sessionId,
          targetRoot,
          terminalId: id
        }),
        env: terminalEnv,
        image: imageResult.image,
        mounts: [
          appServerRuntimeMount
        ].filter(Boolean),
        session,
        sessionId,
        targetRoot,
        terminalId: id,
        toolHomeSource: toolHome.toolHomeSource,
        worktree: workdir
      }),
      command: "docker",
      commandPreview: ({ args }) => dockerCommand(maskedCodexTerminalDockerArgs(args)),
      cwd: targetRoot,
      maxRunning: MAX_OPEN_CODEX_TERMINALS,
      metadata: {
        envHash: terminalEnvHash,
        image: imageResult.image,
        imageLabel: imageResult.label,
        sessionId,
        targetRoot,
        workdir
      },
      namespace,
      onClose: async () => {
        await cleanupCodexAttachments(targetRoot, sessionId);
      },
      reuseRunning: (terminalSession) => {
        return terminalSession.metadata?.targetRoot === targetRoot &&
          terminalSession.metadata?.envHash === terminalEnvHash &&
          terminalSession.metadata?.image === imageResult.image &&
          terminalSession.metadata?.workdir === workdir;
      }
    });
    return withCodexState(terminalResponse, session);
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

    const session = {
      targetRoot
    };
    const imageResult = await resolveTerminalToolchainImage({
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    if (imageResult.ok === false) {
      return imageResult;
    }
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }

    await prepareCodexAttachmentRoot();
    await ensureTargetRuntimeNetwork(targetRoot);
    await ensureAdapterRuntimeContainers({
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    const terminalEnv = await projectTerminalEnvironment({
      projectService,
      runtime,
      session,
      target: "codex",
      targetRoot
    });
    const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
    const namespace = globalCodexTerminalNamespace();
    const terminalResponse = startTerminalSession({
      args: ({ id }) => codexTerminalArgs({
        codexThreadId: "",
        containerName: codexContainerName({
          scope: GLOBAL_CODEX_TERMINAL_SCOPE,
          targetRoot,
          terminalId: id
        }),
        env: terminalEnv,
        image: imageResult.image,
        sessionId: "",
        targetRoot,
        terminalId: id,
        toolHomeSource: toolHome.toolHomeSource,
        worktree: targetRoot
      }),
      command: "docker",
      commandPreview: ({ args }) => dockerCommand(maskedCodexTerminalDockerArgs(args)),
      cwd: targetRoot,
      maxRunning: MAX_OPEN_CODEX_TERMINALS,
      metadata: {
        envHash: terminalEnvHash,
        image: imageResult.image,
        imageLabel: imageResult.label,
        scope: GLOBAL_CODEX_TERMINAL_SCOPE,
        targetRoot,
        workdir: targetRoot
      },
      namespace,
      onClose: async () => {
        await cleanupCodexAttachments(targetRoot, GLOBAL_CODEX_TERMINAL_SCOPE);
      },
      reuseRunning: (terminalSession) => {
        return terminalSession.metadata?.scope === GLOBAL_CODEX_TERMINAL_SCOPE &&
          terminalSession.metadata?.targetRoot === targetRoot &&
          terminalSession.metadata?.envHash === terminalEnvHash &&
          terminalSession.metadata?.image === imageResult.image &&
          terminalSession.metadata?.workdir === targetRoot;
      }
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
    const terminalInput = codexPromptHandoffTerminalInput(handoff);
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

    const snapshot = globalCodexTerminalSnapshot(terminalSessionId);
    const outputStart = String(snapshot.output || "").length;
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
      codexPromptInjected: true,
      codexPromptHandoffOutputStart: outputStart,
      codexTerminal,
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
        worktree_path: workdir
      },
      sessionRoot: normalizeText(input.sessionRoot),
      targetRoot
    };
    if (!containerWorkspacePath(targetRoot, workdir) && (scope !== "session" || !codexSessionWorkdirAllowed({
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
    const imageResult = await resolveTerminalToolchainImage({
      runtime,
      session,
      target: "fix-codex",
      targetRoot
    });
    if (imageResult.ok === false) {
      return imageResult;
    }
    const toolHome = await codexToolHomeResult();
    if (toolHome.ok === false) {
      return toolHome;
    }

    await prepareCodexAttachmentRoot();
    const reportHelper = await prepareFixCodexReportHelper({
      fixJobStore,
      jobId,
      stateRoot: runtime.stateRoot,
      token: jobSeed.token
    });
    await ensureTargetRuntimeNetwork(targetRoot);
    await ensureAdapterRuntimeContainers({
      runtime,
      session,
      target: "fix-codex",
      targetRoot
    });
    const terminalEnv = await projectTerminalEnvironment({
      projectService,
      runtime,
      session,
      target: "fix-codex",
      targetRoot
    });
    const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
    const terminalResponse = startTerminalSession({
      args: ({ id }) => codexTerminalArgs({
        codexThreadId: "",
        containerName: codexContainerName({
          scope: `fix:${jobId}`,
          targetRoot,
          terminalId: id
        }),
        env: {
          ...terminalEnv,
          ...reportHelper.env
        },
        helperMount: reportHelper.mount,
        image: imageResult.image,
        session,
        sessionId: "",
        targetRoot,
        terminalId: id,
        toolHomeSource: toolHome.toolHomeSource,
        worktree: workdir
      }),
      command: "docker",
      commandPreview: ({ args }) => dockerCommand(maskedCodexTerminalDockerArgs(args)),
      cwd: targetRoot,
      maxRunning: 1,
      metadata: {
        envHash: terminalEnvHash,
        fixJobId: jobId,
        image: imageResult.image,
        imageLabel: imageResult.label,
        scope: "fix-codex",
        targetRoot,
        workdir
      },
      namespace,
      onClose: async () => {
        await cleanupCodexAttachments(targetRoot, `fix:${jobId}`);
      },
      reuseRunning: false
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
    kind = "",
    message = "",
    publishReason = "",
    retryable = true,
    status = "running",
    terminalSessionId = ""
  } = {}) {
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_APP_SERVER_TASK_ID, {
      event: {
        error: normalizeText(error),
        kind: normalizeText(kind || status),
        message: normalizeText(message),
        status
      },
      patch: {
        error: normalizeText(error),
        kind: "codex_app_server",
        label: "Codex app-server",
        message: normalizeText(message),
        retry: status === "failed" && retryable !== false
          ? {
              control: {
                action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_CODEX_THREADS
              },
              label: "Reconnect Codex"
            }
          : null,
        status,
        terminalSessionId: normalizeText(terminalSessionId)
      }
    });
    await publishSessionChanged(sessionId, {
      reason: normalizeText(publishReason) || `codex-app-server-${status}`
    });
    return task;
  }

  async function writeCodexAppServerRunning(runtime, sessionId, {
    kind = "running",
    message,
    terminalSessionId = ""
  } = {}) {
    return writeCodexAppServerTaskEvent(runtime, sessionId, {
      kind,
      message,
      status: "running",
      terminalSessionId
    });
  }

  async function writeCodexAppServerReady(runtime, sessionId, terminalSessionId) {
    return writeCodexAppServerTaskEvent(runtime, sessionId, {
      kind: "ready",
      message: "Codex is ready.",
      status: "ready",
      terminalSessionId
    });
  }

  async function writeCodexAppServerFailure(runtime, sessionId, result, {
    terminalSessionId = ""
  } = {}) {
    await writeCodexAppServerTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
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

  async function writeCodexAppServerBlocked(runtime, sessionId, result, {
    terminalSessionId = ""
  } = {}) {
    await writeCodexAppServerTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
      kind: "blocked",
      message: "Recover this session worktree before continuing with Codex.",
      publishReason: "codex-app-server-blocked",
      retryable: false,
      status: "ready",
      terminalSessionId
    });
    return result;
  }

  async function blockCodexAppServerForUnavailableWorktree(runtime, sessionId, result) {
    // The app-server is target-scoped; only detach this removed Vibe64 session's client/subscription.
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

  async function codexAppServerSessionContext(sessionId) {
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const targetRoot = terminalTargetRoot(session, projectService);
    if (!targetRoot) {
      return retryableTerminalFailure({
        ok: false,
        error: "Vibe64 Codex target root is not available."
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
      targetRoot,
      workdir
    })) {
      return retryableTerminalFailure({
        ok: false,
        error: workdir
          ? "Vibe64 Codex workdir is outside the target root."
          : "Create the session worktree before starting Codex."
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
      const subscriptionKey = codexAppServerEventSubscriptionKey(providerKey, threadId);
      const provider = await ensureCodexAppServerDaemonForSession(normalizedSessionId, providerOptions);
      if (threadId) {
        try {
          const loadedThreadIds = await codexAppServerLoadedThreadIds(provider);
          if (loadedThreadIds?.has(threadId)) {
            if (codexAppServerEventSubscriptions.has(subscriptionKey)) {
              rememberCodexAppServerManagedSession(providerKey, {
                agentSettings,
                sessionId: normalizedSessionId,
                targetRoot,
                workdir
              });
              return {
                ok: true,
                providerKey,
                sessionId: normalizedSessionId,
                status: "alreadySubscribed",
                threadId
              };
            }
            subscribeCodexAppServerEvents(normalizedSessionId, provider, threadId, providerOptions);
            rememberCodexAppServerManagedSession(providerKey, {
              agentSettings,
              sessionId: normalizedSessionId,
              targetRoot,
              workdir
            });
            await writeCodexAppServerReady(runtime, normalizedSessionId, "");
            return {
              ok: true,
              providerKey,
              sessionId: normalizedSessionId,
              status: "loaded",
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

    await writeCodexAppServerRunning(runtime, sessionId, {
      kind: "app_server_started",
      message: "Preparing Codex app-server for this session."
    });
    try {
      const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
        runtime,
        targetRoot,
        toolHomeSource,
        workdir
      });
      const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
      const promptSession = await runtime.promptSessionForAction(session);
      const developerInstructions = codexAppServerDeveloperInstructions(promptSession);
      const thread = await ensureCodexAppServerThreadForSession({
        agentSettings,
        developerInstructions,
        provider,
        runtime,
        session,
        workdir
      });
      await writeCodexContextReplacementWarning(runtime, sessionId, thread);
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        agentSettings,
        sessionId,
        targetRoot,
        workdir
      });
      const briefingWasDelivered = !sessionBriefingIsDelivered(session);
      const deliveredAt = new Date().toISOString();
      if (briefingWasDelivered) {
        await runtime.store.mutateSession(sessionId, async () => {
          await Promise.all([
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_echo_input", developerInstructions),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_output_start", ""),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered", "yes"),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered_at", deliveredAt),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivery", "app_server_developer_instructions")
          ]);
        });
      }
      await writeCodexAppServerReady(runtime, sessionId, "");
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
      await writeCodexAppServerFailure(runtime, sessionId, error);
      throw error;
    }
  }

  async function injectPromptIntoCodexAppServer(sessionId, handoff = {}, {
    agentSettings = {}
  } = {}) {
    const terminalInput = codexPromptHandoffTerminalInput(handoff);
    if (!terminalInput) {
      return {
        ok: false,
        error: "Codex prompt handoff is empty."
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

    const claim = await claimCodexAppServerTurnStart(runtime, sessionId);
    if (!claim?.claimed) {
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.claimObserved", {
        code: String(claim?.response?.code || ""),
        operationOutcome: String(claim?.response?.operationOutcome || ""),
        sessionId
      });
      return claim?.response || {
        ok: false,
        error: "Codex is already working on this Vibe64 session."
      };
    }

    let activeThreadId = "";
    let turnFailureHandled = false;
    try {
      await writeCodexAppServerRunning(runtime, sessionId, {
        kind: "app_server_started",
        message: "Preparing Codex app-server for this session."
      });
      const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
        runtime,
        targetRoot,
        toolHomeSource,
        workdir
      });
      const provider = await ensureCodexAppServerDaemonForSession(sessionId, providerOptions);
      const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
      const promptSession = await runtime.promptSessionForAction(session);
      const developerInstructions = codexAppServerDeveloperInstructions(promptSession);
      const thread = await ensureCodexAppServerThreadForSession({
        agentSettings,
        developerInstructions,
        provider,
        runtime,
        session,
        workdir
      });
      await writeCodexContextReplacementWarning(runtime, sessionId, thread);
      activeThreadId = thread.threadId;
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, providerOptions);
      rememberCodexAppServerManagedSession(codexAppServerProviderKey(sessionId, providerOptions), {
        agentSettings,
        sessionId,
        targetRoot,
        workdir
      });
      const handoffId = normalizeCodexPromptHandoffId(handoff.handoffId);
      const signature = codexPromptHandoffSignature(sessionId);
      await markCodexAppServerTurnActive(sessionId, {
        status: "starting",
        threadId: thread.threadId
      });
      let delivery = null;
      try {
        delivery = await sendCodexAppServerPromptForSession({
          agentSettings,
          prompt: terminalInput,
          provider,
          threadId: thread.threadId,
          workdir
        });
      } catch (error) {
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
      if (
        deliveredTurnId &&
        !codexAppServerCompletedTurns.has(codexAppServerTurnKey(thread.threadId, deliveredTurnId)) &&
        !codexAppServerTurnStatusIsComplete(deliveredTurnStatus)
      ) {
        await markCodexAppServerTurnActive(sessionId, {
          status: codexAppServerTurnStatusIsActive(deliveredTurnStatus) ? deliveredTurnStatus : "inProgress",
          threadId: thread.threadId,
          turnId: deliveredTurnId
        });
      } else if (deliveredTurnId && codexAppServerTurnStatusIsProviderFailure(deliveredTurnStatus)) {
        await stopCodexAppServerTurnWithProviderFailure(sessionId, thread.threadId, deliveredTurnId, {
          status: deliveredTurnStatus
        });
      } else if (deliveredTurnId && codexAppServerTurnStatusIsSuccessfulComplete(deliveredTurnStatus)) {
        await completeCodexAppServerTurn(sessionId, thread.threadId, deliveredTurnId, {
          status: deliveredTurnStatus
        });
      }
      const briefingWasDelivered = !sessionBriefingIsDelivered(session);
      const deliveredAt = new Date().toISOString();
      await runtime.store.mutateSession(sessionId, async () => {
        await Promise.all([
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_signature", signature),
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_echo_input", delivery.input),
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_output_start", ""),
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_terminal_id", ""),
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_delivery", "app_server"),
          runtime.store.writeMetadataValue(sessionId, "codex_agent_settings_model", effectiveSettings.model),
          runtime.store.writeMetadataValue(sessionId, "codex_agent_settings_provider", effectiveSettings.providerId),
          runtime.store.writeMetadataValue(sessionId, "codex_agent_settings_thinking", effectiveSettings.thinking),
          ...(handoffId ? [
            runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_id", handoffId)
          ] : []),
          ...(briefingWasDelivered ? [
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_echo_input", developerInstructions),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_output_start", ""),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered", "yes"),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered_at", deliveredAt),
            runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivery", "app_server_developer_instructions")
          ] : [])
        ]);
      });
      await writeCodexAppServerReady(runtime, sessionId, "");
      await publishPromptInjected(sessionId, {
        reason: "codex-app-server-prompt-injected"
      });
      const currentSession = await runtime.getSession(sessionId);
      return {
        ...withCodexState({
          ok: true
        }, currentSession),
        appServerEndpoint: thread.appServerRuntime?.endpoint || "",
        codexAppServerPromptInjected: true,
        codexPromptHandoffOutputStart: 0,
        codexPromptHandoffSignature: signature,
        codexPromptInjected: true,
        codexSessionBriefingDelivered: briefingWasDelivered,
        terminalSessionId: "",
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
      await writeCodexAppServerFailure(runtime, sessionId, error);
      throw error;
    }
  }

  async function startCodexAppServerTerminal(sessionId) {
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

  async function interruptCodexAppServerTurn(sessionId) {
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
    const threadId = codexThreadIdForWorkdir(session, workdir);
    const turn = codexAppServerTurnState(session);
    const turnId = normalizeText(turn.turnId);
    if (!threadId || !turnId) {
      return codexAppServerInterruptUnavailableResponse({
        active: turn.active,
        threadId,
        turnId
      });
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
    const stopped = await stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, turnId, {
      error: "Stopped by user.",
      ok: true,
      status: "interrupted",
    });
    return {
      ...stopped,
      result,
      threadId,
      turnId
    };
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
      let providerOptions = null;
      let unsubscribeResult = null;
      try {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        });
      } catch {
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
        if (providerOptions) {
          closeCodexAppServerProviderForSession(sessionId, providerOptions);
        }
      }
      await closeTerminalSessionsForNamespace(codexTerminalNamespace(sessionId));
      const targetRoot = await terminalTargetRootForSession(projectService, sessionId);
      if (targetRoot) {
        await cleanupCodexAttachments(targetRoot, sessionId);
      }
    },

    closeTerminal(sessionId, terminalSessionId) {
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
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return withCodexState(readTerminalSession(terminalSessionId, {
          namespace: codexTerminalNamespace(sessionId)
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

    async reconcileThreads(sessions = [], options = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexAppServerControlDisabledResult();
        }
        return reconcileCodexAppServerThreads(sessions, options);
      });
    },

    async interruptTurn(sessionId) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return interruptCodexAppServerTurn(sessionId);
      });
    },

    async terminalState(sessionId) {
      return vibe64Result(async () => {
        const runtime = await projectService.createRuntime();
        const session = await reconcileCodexAppServerActiveTurn(
          await runtime.getSession(sessionId)
        );
        return {
          ok: true,
          sessionId,
          ...codexState(session)
        };
      });
    },

    async startTerminal(sessionId) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return writeCodexAppServerControlDisabledFailure(sessionId);
        }
        return startCodexAppServerTerminal(sessionId);
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
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return withCodexState(subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: codexTerminalNamespace(sessionId)
        }), session);
      });
    },

    async uploadAttachment(sessionId, input = {}) {
      return vibe64Result(async () => {
        const runtime = await projectService.createRuntime();
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

    writeTerminal(sessionId, terminalSessionId, data) {
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
  codexRemoteEndpointForWorkdir,
  codexTerminalArgs,
  createCodexTerminalController
};
