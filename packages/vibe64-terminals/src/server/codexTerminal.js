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
  vibe64AgentRunStateIsActive
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
  stableHash,
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
const CODEX_APP_SERVER_AGENT_RUN_ID = CODEX_APP_SERVER_TASK_ID;
const START_CODEX_TERMINAL_CONTROL_ACTION = "start_codex_terminal";
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();
const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_APP_SERVER_ACTIVE_RECONCILE_MS = 2000;
const CODEX_APP_SERVER_FINALIZING_GRACE_MS = 10000;
const CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE =
  "Codex app-server finished this turn, but Vibe64 did not receive the assistant result text.";

function normalizeText(value) {
  return String(value || "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
    "Keep this Vibe64 briefing as the source of truth for this Codex session. Do not start project work from this briefing alone."
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
  fixJobStore = defaultFixCodexJobStore,
  projectService,
  publishPromptInjected = async () => null,
  publishSessionChanged = async () => null
} = {}) {
  const codexAppServerProviders = new Map();
  const codexAppServerEventSubscriptions = new Map();
  const codexAppServerCompletedTurns = new Set();
  const codexAppServerFinalizedTurns = new Set();
  const codexAppServerActiveTimers = new Map();
  const codexAppServerFinalizingTimers = new Map();
  const codexAppServerResultFinalizations = new Map();
  const codexAppServerMirroredUserItems = new Set();
  const codexAppServerAssistantTurns = new Map();
  const codexAppServerReasoningTurns = new Map();
  const codexAppServerReasoningPersistQueues = new Map();

  function codexAppServerProviderForSession(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw new Error("Vibe64 session ID is required.");
    }
    const existing = codexAppServerProviders.get(normalizedSessionId);
    if (existing) {
      return existing;
    }
    const provider = codexAppServerProviderFactory(options);
    codexAppServerProviders.set(normalizedSessionId, provider);
    return provider;
  }

  function codexAppServerRuntimeOptionsFromSession(session = {}) {
    const metadata = session.metadata || {};
    return {
      ...codexAppServerProviderOptions,
      runtimeDir: normalizeText(metadata.codex_app_server_runtime_dir),
      targetRoot: terminalTargetRoot(session, projectService),
      workdir: terminalWorktreePath(session)
    };
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
      const result = await finalizeCodexAppServerAssistantResult(sessionId, turn.threadId, turn.turnId, {
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
    const provider = codexAppServerProviderForSession(
      sessionId,
      codexAppServerRuntimeOptionsFromSession(session)
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
    const provider = codexAppServerProviderForSession(sessionId, options);
    return provider.ensureRuntime();
  }

  function closeCodexAppServerProviderForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const provider = codexAppServerProviders.get(normalizedSessionId);
    if (!provider) {
      return;
    }
    const subscriptionPrefix = `${normalizedSessionId}:`;
    for (const [key, unsubscribe] of codexAppServerEventSubscriptions.entries()) {
      if (key.startsWith(subscriptionPrefix)) {
        unsubscribe?.();
        codexAppServerEventSubscriptions.delete(key);
      }
    }
    provider.close?.();
    codexAppServerProviders.delete(normalizedSessionId);
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

  function codexAppServerNotificationThreadId(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    return normalizeText(params.threadId || params.thread?.id);
  }

  function codexAppServerNotificationTurnId(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    return normalizeText(params.turnId || params.turn?.id);
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

  function codexAppServerNotificationAssistantText(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const itemText = codexAppServerAssistantItemText(codexAppServerNotificationItem(notification));
    if (itemText) {
      return itemText;
    }
    return normalizeText(
      codexAppServerContentText(params.delta) ||
      codexAppServerContentText(params.text) ||
      codexAppServerContentText(params.output) ||
      codexAppServerContentText(params.response)
    );
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
      return;
    }
    const normalizedThreadId = normalizeText(threadId);
    const turnId = codexAppServerNotificationTurnId(notification);
    const text = codexAppServerNotificationAssistantText(notification);
    if (!normalizedThreadId || !text) {
      return;
    }
    const state = codexAppServerAssistantTurnState(normalizedThreadId, turnId);
    const item = codexAppServerNotificationItem(notification);
    const itemId = normalizeText(item?.id);
    if (itemId) {
      state.items.set(itemId, text);
      return;
    }
    state.chunks.push(text);
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
    const written = await runtime.store.writeConversationThinkingMessage(normalizedSessionId, {
      at: state.createdAt,
      requireOpenTurn: true,
      text: reasoningText
    });
    if (!written) {
      return;
    }
    state.persistedText = reasoningText;
    await publishSessionChanged(normalizedSessionId, {
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

  function codexAppServerUserMessageIsVibe64Routed(text = "") {
    const message = normalizeText(text);
    return message.includes("VIBE64_ROUTED_TURN: yes") ||
      message.startsWith("VIBE64_SESSION_BOOTSTRAP:") ||
      message.startsWith("Vibe64 interactive conversation turn:") ||
      message.startsWith("Vibe64 session briefing") ||
      message.startsWith("Vibe64 workflow context:");
  }

  function codexAppServerUserMessageKey({
    item = {},
    text = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const itemId = normalizeText(item.id);
    return [
      normalizeText(threadId),
      normalizeText(turnId),
      itemId || stableHash(text)
    ].filter(Boolean).join(":");
  }

  async function mirrorCodexAppServerTerminalUserMessage(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const item = codexAppServerNotificationItem(notification);
    const text = codexAppServerUserMessageText(item);
    if (!normalizedSessionId || !text || codexAppServerUserMessageIsVibe64Routed(text)) {
      return;
    }
    const key = codexAppServerUserMessageKey({
      item,
      text,
      threadId: normalizedThreadId,
      turnId: codexAppServerNotificationTurnId(notification)
    });
    if (!key || codexAppServerMirroredUserItems.has(key)) {
      return;
    }
    codexAppServerMirroredUserItems.add(key);
    try {
      const runtime = await projectService.createRuntime();
      await runtime.store.writeConversationUserMessage(normalizedSessionId, {
        text
      });
      vibe64SessionDebugLog("server.codexTerminal.appServerTerminalUserMessage.mirrored", {
        itemId: normalizeText(item?.id),
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: codexAppServerNotificationTurnId(notification)
      });
      await publishSessionChanged(normalizedSessionId, {
        reason: "codex-app-server-terminal-user-message"
      });
    } catch (error) {
      codexAppServerMirroredUserItems.delete(key);
      vibe64SessionDebugLog("server.codexTerminal.appServerTerminalUserMessage.error", {
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId
      });
    }
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

  async function submitCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const assistantText = readCodexAppServerAssistantText(threadId, turnId);
    const reasoningText = readCodexAppServerReasoningText(threadId, turnId);
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
          await runtime.store.writeConversationAssistantMessage(normalizedSessionId, {
            text: visibleText
          });
          await publishSessionChanged(normalizedSessionId, {
            reason: "codex-app-server-terminal-assistant-message"
          });
        }
        return {
          ok: true,
          processed: true,
          reason: "assistant_message"
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
    const runPatch = codexAppServerAgentRunPatch({
      error,
      runState,
      session: session || {},
      status,
      threadId,
      turnId,
      updatedAt
    });
    await runtime.store.mutateSession(normalizedSessionId, async () => {
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: publishReason || "codex-app-server-turn-state",
          message: normalizeText(error),
          state: runPatch.state
        },
        patch: runPatch
      });
    });
    await publishSessionChanged(normalizedSessionId, {
      reason: publishReason || "codex-app-server-turn-state"
    });
    return {
      ok: true
    };
  }

  async function markCodexAppServerTurnActive(sessionId = "", input = {}) {
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

  async function finalizeCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
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
      const result = await submitCodexAppServerAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      );
      if (result?.processed) {
        codexAppServerFinalizedTurns.add(key);
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
    if (!normalizedTurnId) {
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
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const existingTurn = codexAppServerTurnState(session);
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
        return stopCodexAppServerTurnWithResultDeliveryFailure(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            reason: result?.reason || "missing_assistant_text",
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
    const message = `${CODEX_APP_SERVER_RESULT_DELIVERY_FAILURE_MESSAGE} Retry the step.`;
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

  function subscribeCodexAppServerEvents(sessionId = "", provider = null, threadId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedSessionId || !normalizedThreadId || typeof provider?.subscribe !== "function") {
      return;
    }
    const key = `${normalizedSessionId}:${normalizedThreadId}`;
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
      recordCodexAppServerAssistantNotification(normalizedThreadId, notification);
      if (method === "item/started" || method === "item/completed") {
        const item = codexAppServerNotificationItem(notification);
        if (normalizeText(item?.type) === "userMessage") {
          void mirrorCodexAppServerTerminalUserMessage(normalizedSessionId, normalizedThreadId, notification);
          return;
        }
        if (method === "item/completed") {
          const turnId = codexAppServerNotificationTurnId(notification);
          if (turnId && codexAppServerCompletedTurns.has(codexAppServerTurnKey(normalizedThreadId, turnId))) {
            void finalizeCodexAppServerAssistantResult(normalizedSessionId, normalizedThreadId, turnId, {
              status: "completed"
            });
          }
        }
      }
      if (method === "turn/started") {
        void markCodexAppServerTurnActive(normalizedSessionId, {
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
      return retryableTerminalFailure({
        ok: false,
        error: `Session worktree directory does not exist: ${workdir}`
      });
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
          targetRoot,
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
                action: START_CODEX_TERMINAL_CONTROL_ACTION
              },
              label: "Retry Codex"
            }
          : null,
        status,
        terminalSessionId: normalizeText(terminalSessionId)
      }
    });
    await publishSessionChanged(sessionId, {
      reason: `codex-app-server-${status}`
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
      return retryableTerminalFailure({
        ok: false,
        error: `Session worktree directory does not exist: ${workdir}`
      });
    }
    return {
      ok: true,
      runtime,
      session,
      targetRoot,
      workdir
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
      workdir
    } = context;

    await writeCodexAppServerRunning(runtime, sessionId, {
      kind: "app_server_started",
      message: "Preparing Codex app-server for this session."
    });
    try {
      if (codexAppServerProviderUsesDocker()) {
        await ensureTargetRuntimeNetwork(targetRoot);
      }
      const provider = codexAppServerProviderForSession(sessionId, {
        ...codexAppServerProviderOptions,
        targetRoot,
        workdir
      });
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
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId);
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
      workdir
    } = context;

    await writeCodexAppServerRunning(runtime, sessionId, {
      kind: "app_server_started",
      message: "Preparing Codex app-server for this session."
    });
    try {
      if (codexAppServerProviderUsesDocker()) {
        await ensureTargetRuntimeNetwork(targetRoot);
      }
      const provider = codexAppServerProviderForSession(sessionId, {
        ...codexAppServerProviderOptions,
        targetRoot,
        workdir
      });
      const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
      const promptSession = await runtime.promptSessionForAction(session);
      const developerInstructions = codexAppServerDeveloperInstructions(promptSession);
      const thread = await ensureCodexAppServerThreadForSession({
        agentSettings,
        bootstrapResumableThread: false,
        developerInstructions,
        provider,
        runtime,
        session,
        workdir
      });
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId);
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
      session,
      workdir
    } = context;
    const threadId = codexThreadIdForWorkdir(session, workdir);
    const turn = codexAppServerTurnState(session);
    const turnId = normalizeText(turn.turnId);
    if (!threadId || !turnId) {
      return stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, turnId, {
        error: "No active Codex app-server turn is available to interrupt.",
        status: "interrupted",
      });
    }
    const provider = codexAppServerProviderForSession(
      sessionId,
      codexAppServerRuntimeOptionsFromSession(session)
    );
    const result = await provider.interruptTurn(threadId, turnId);
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
      closeCodexAppServerProviderForSession(sessionId);
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
