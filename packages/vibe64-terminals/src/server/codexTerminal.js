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
  updateTerminalSessionMetadata,
  writeTerminalSessionText
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_CODEX_CONTAINER_PREFIX,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  containerWorkspacePath,
  removeDockerContainer
} from "@local/studio-terminal-core/server/containerRuntime";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  prepareCurrentStepInputHelper
} from "@local/vibe64-runtime/server/currentStepInputHelperServer";
import {
  vibe64SessionDebugDurationMs,
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
  stableHash,
  terminalTargetRoot,
  terminalWorktreePath
} from "./terminalShared.js";
import {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  CODEX_ATTACHMENT_HOST_ROOT,
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
  AGENT_TERMINAL_IDENTITY_STATUS,
  AGENT_TERMINAL_RESUME_STRATEGY,
  agentTerminalIdentityForWorkdir,
  agentTerminalIdentityState,
  ensureAgentTerminalIdentity
} from "./agentTerminalIdentity.js";
import {
  CODEX_BOOT_POLL_MS,
  CODEX_BOOT_MAX_RESTARTS,
  CODEX_BOOT_READY_QUIET_MS,
  CODEX_BOOT_RESULT_STATE,
  CODEX_BOOT_SCREEN_STATE,
  CODEX_BOOT_TOTAL_TIMEOUT_MS,
  CODEX_BOOT_UNKNOWN_QUIET_MS,
  classifyCodexBootScreen,
  codexBootAttentionMessage,
  codexBootShouldRestartAfterExit,
  normalizeCodexBootText
} from "./codexBootAdapter.js";

const CODEX_AGENT_PROVIDER = "codex";
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_ID_TOKEN_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const CODEX_THREAD_COMMAND = "!echo $CODEX_THREAD_ID -- ";
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const CODEX_TURN_SETTLE_MS = CODEX_BOOT_QUIET_MS;
const CODEX_TURN_UNKNOWN_QUIET_MS = 3000;
const DEBUG_PROMPTS_ENABLED = String(process.env.DEBUG_PROMPTS || "").trim() === "1";
const CODEX_KEY_PAUSE_MS = 180;
const CODEX_PROMPT_SUBMIT_PAUSE_MS = 20;
const CODEX_THREAD_CAPTURE_TIMEOUT_MS = DEBUG_PROMPTS_ENABLED ? 10 * 60_000 : 30_000;
const CODEX_SESSION_MODEL = "gpt-5.5";
const CODEX_SESSION_REASONING_EFFORT = "xhigh";
const CODEX_BOOTSTRAP_TASK_ID = "codex_bootstrap";
const CODEX_SESSION_TERMINAL_BOOTSTRAP_DISABLED = false;
const START_CODEX_TERMINAL_CONTROL_ACTION = "start_codex_terminal";
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();
const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_TURN_STATE = Object.freeze({
  ACTIVE: "active",
  ATTENTION_REQUIRED: "attention_required",
  IDLE: "idle",
  TRANSMITTING: "transmitting"
});

function normalizeText(value) {
  return String(value || "").trim();
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

function codexTerminalDebugSummary(snapshot = {}) {
  return {
    exitCode: Number.isInteger(snapshot.exitCode) ? snapshot.exitCode : null,
    inputVersion: Number(snapshot.inputVersion || 0),
    lastInputAt: String(snapshot.lastInputAt || ""),
    lastInputBytes: Number(snapshot.lastInputBytes || 0),
    lastOutputAt: String(snapshot.lastOutputAt || ""),
    lastOutputBytes: Number(snapshot.lastOutputBytes || 0),
    outputLength: String(snapshot.output || "").length,
    outputVersion: Number(snapshot.outputVersion || 0),
    status: String(snapshot.status || "")
  };
}

function normalizeCodexTurnState(value = "") {
  const state = normalizeText(value);
  switch (state) {
    case CODEX_TURN_STATE.ACTIVE:
    case CODEX_TURN_STATE.TRANSMITTING:
      return CODEX_TURN_STATE.ACTIVE;
    case CODEX_TURN_STATE.ATTENTION_REQUIRED:
      return CODEX_TURN_STATE.ATTENTION_REQUIRED;
    default:
      return CODEX_TURN_STATE.IDLE;
  }
}

function savedCodexWorkdir(session = {}) {
  const workdir = String(session.metadata?.codex_workdir || "").trim();
  return workdir ? path.resolve(workdir) : "";
}

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

function codexPromptHandoffLooksValid(handoff = null) {
  return Boolean(
    handoff &&
    typeof handoff === "object" &&
    !Array.isArray(handoff) &&
    handoff.kind === "codex_prompt_handoff" &&
    (String(handoff.terminalInput || "").trim() || String(handoff.prompt || "").trim())
  );
}

function pendingCodexPromptHandoffId(attempt = {}) {
  const handoffId = normalizeCodexPromptHandoffId(attempt.codexPromptHandoff?.handoffId);
  if (handoffId) {
    return handoffId;
  }
  const attemptFile = normalizeText(attempt.attemptFile);
  const promptId = normalizeText(attempt.codexPromptHandoff?.promptId || attempt.promptId || attempt.actionId);
  return attemptFile && promptId ? `${attemptFile}:${promptId}` : "";
}

function deliveredCodexPromptHandoffId(session = {}) {
  const deliveredHandoffId = normalizeCodexPromptHandoffId(session.metadata?.codex_prompt_handoff_id);
  if (!deliveredHandoffId) {
    return "";
  }
  const deliveredTerminalSessionId = normalizeText(session.metadata?.codex_prompt_handoff_terminal_id);
  const activeTerminal = activeCodexTerminal(session);
  if (
    codexConversationIdForWorkdir(session, terminalWorktreePath(session)) ||
    (deliveredTerminalSessionId && deliveredTerminalSessionId === normalizeText(activeTerminal?.id))
  ) {
    return deliveredHandoffId;
  }
  return "";
}

function latestPendingCodexPromptHandoff(session = {}) {
  if (normalizeText(session.stepMachine?.status) !== "awaiting_agent_result") {
    return null;
  }
  const deliveredHandoffId = deliveredCodexPromptHandoffId(session);
  const latestAttempt = (Array.isArray(session.actionAttempts) ? session.actionAttempts : [])
    .filter((attempt) => (
      normalizeText(attempt.status) === "prompt_ready" &&
      normalizeText(attempt.stepId) === normalizeText(session.currentStep) &&
      codexPromptHandoffLooksValid(attempt.codexPromptHandoff)
    ))
    .sort((left, right) => Number(left.attemptNumber || 0) - Number(right.attemptNumber || 0))
    .at(-1);
  if (!latestAttempt) {
    return null;
  }
  const handoffId = pendingCodexPromptHandoffId(latestAttempt);
  if (!handoffId || handoffId === deliveredHandoffId) {
    return null;
  }
  return {
    ...latestAttempt.codexPromptHandoff,
    actionId: normalizeText(latestAttempt.actionId),
    attemptFile: normalizeText(latestAttempt.attemptFile),
    attemptNumber: Number(latestAttempt.attemptNumber || 0),
    handoffId
  };
}

function extractCodexThreadId(output = "") {
  const lines = normalizeCodexBootText(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    if (!lines[lineIndex].includes("CODEX_THREAD_ID")) {
      continue;
    }
    for (const nextLine of lines.slice(lineIndex + 1, lineIndex + 8)) {
      CODEX_THREAD_ID_TOKEN_PATTERN.lastIndex = 0;
      const token = [...nextLine.matchAll(CODEX_THREAD_ID_TOKEN_PATTERN)]
        .map((match) => match[0])
        .find((value) => normalizeCodexThreadId(value));
      if (token) {
        return token.toLowerCase();
      }
    }
  }

  return "";
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

function codexPromptTerminalInput(prompt = "") {
  return codexPromptInput(prompt);
}

function codexPromptHandoffSignature(sessionId = "") {
  return `${sessionId}:${Date.now()}`;
}

function codexBootstrapSignature(sessionId = "") {
  return `${sessionId}:codex-bootstrap:${Date.now()}`;
}

function codexTerminalSnapshot(sessionId = "", terminalSessionId = "") {
  return readTerminalSessionControlState(terminalSessionId, {
    namespace: codexTerminalNamespace(sessionId)
  });
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
  const agentTurnState = normalizeCodexTurnState(terminal.metadata?.codexTurnState);
  const agentTurnActive = agentTurnState === CODEX_TURN_STATE.ACTIVE;
  const attentionRequired = agentTurnState === CODEX_TURN_STATE.ATTENTION_REQUIRED;
  return {
    activityLabel: terminal.metadata?.codexTurnLabel || "",
    activityStartedAt: terminal.metadata?.codexTurnStartedAt || "",
    activityFinishedAt: terminal.metadata?.codexTurnFinishedAt || "",
    activityReason: terminal.metadata?.codexTurnReason || "",
    agentTurnActive,
    agentTurnState,
    attentionMessage: terminal.metadata?.codexTurnAttentionMessage || "",
    attentionReason: terminal.metadata?.codexTurnAttentionReason || "",
    attentionRequired,
    commandPreview: terminal.commandPreview || "",
    id: terminal.id || "",
    inputVersion: terminal.inputVersion || 0,
    lastInputAt: terminal.lastInputAt || "",
    lastInputBytes: terminal.lastInputBytes || 0,
    lastOutputAt: terminal.lastOutputAt || "",
    lastOutputBytes: terminal.lastOutputBytes || 0,
    outputVersion: terminal.outputVersion || 0,
    status: terminal.status || "",
    transmitting: agentTurnActive
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

function writeCodexTerminalInput(sessionId = "", terminalSessionId = "", data = "") {
  return writeTerminalSessionText(terminalSessionId, data, {
    namespace: codexTerminalNamespace(sessionId)
  });
}

async function writeCodexPromptIntoNamespace(terminalSessionId = "", prompt = "", {
  namespace = "default"
} = {}) {
  const input = codexPromptTerminalInput(prompt);
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

function updateCodexTerminalMetadata(sessionId = "", terminalSessionId = "", metadata = {}) {
  return updateTerminalSessionMetadata(terminalSessionId, metadata, {
    namespace: codexTerminalNamespace(sessionId)
  });
}

function activeCodexTerminalSessions(sessionId = "") {
  return listTerminalSessions({
    namespace: codexTerminalNamespace(sessionId)
  }).filter((terminal) => terminal.status !== "exited");
}

function codexTurnLabel(reason = "") {
  switch (normalizeText(reason)) {
    case "codex-thread-bootstrap-started":
      return "Preparing Codex...";
    case "codex-prompt-injection-started":
      return "Sending prompt to Codex...";
    default:
      return "Codex is thinking...";
  }
}

function activeCodexTurnMetadata(signature = "", reason = "", {
  outputStart = 0
} = {}) {
  const normalizedOutputStart = normalizeCodexPromptHandoffOutputStart(outputStart);
  return {
    codexTurnAttentionMessage: "",
    codexTurnAttentionReason: "",
    codexTurnFinishedAt: "",
    codexTurnLabel: codexTurnLabel(reason),
    codexTurnOutputStart: String(normalizedOutputStart),
    codexTurnReason: normalizeText(reason),
    codexTurnSignature: signature,
    codexTurnStartedAt: new Date().toISOString(),
    codexTurnState: CODEX_TURN_STATE.ACTIVE
  };
}

function idleCodexTurnMetadata() {
  return {
    codexTurnAttentionMessage: "",
    codexTurnAttentionReason: "",
    codexTurnLabel: "",
    codexTurnOutputStart: "",
    codexTurnReason: "",
    codexTurnFinishedAt: new Date().toISOString(),
    codexTurnState: CODEX_TURN_STATE.IDLE
  };
}

function attentionCodexTurnMetadata({
  message = "",
  reason = ""
} = {}) {
  const attentionReason = normalizeText(reason || "attention_required");
  return {
    codexTurnAttentionMessage: normalizeText(message),
    codexTurnAttentionReason: attentionReason,
    codexTurnFinishedAt: new Date().toISOString(),
    codexTurnLabel: "Codex needs attention.",
    codexTurnOutputStart: "",
    codexTurnReason: attentionReason,
    codexTurnState: CODEX_TURN_STATE.ATTENTION_REQUIRED
  };
}

function clearCodexTurnsForSession(sessionId = "") {
  for (const terminal of activeCodexTerminalSessions(sessionId)) {
    updateCodexTerminalMetadata(sessionId, terminal.id, idleCodexTurnMetadata());
  }
}

function codexState(session = {}) {
  const metadata = session.metadata || {};
  const workdir = terminalWorktreePath(session);
  const codexConversationId = codexConversationIdForWorkdir(session, workdir);
  const codexThreadId = normalizeCodexThreadId(codexConversationId);
  const agentIdentity = codexAgentIdentityState(session, workdir);
  return {
    agentConversationId: agentIdentity?.conversationId || "",
    agentIdentity,
    agentIdentityProvider: agentIdentity?.provider || CODEX_AGENT_PROVIDER,
    agentIdentityStatus: agentIdentity?.status || "",
    agentResumeStrategy: agentIdentity?.resumeStrategy || "",
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

  const legacyThreadId = normalizeCodexThreadId(session.metadata?.codex_thread_id);
  const recordedWorkdir = savedCodexWorkdir(session);
  if (legacyThreadId && normalizedWorkdir && recordedWorkdir === normalizedWorkdir) {
    return {
      capturedAt: "",
      conversationId: legacyThreadId,
      provider: CODEX_AGENT_PROVIDER,
      resumeStrategy: AGENT_TERMINAL_RESUME_STRATEGY.PROVIDER_NATIVE,
      source: "codex_legacy_metadata",
      status: AGENT_TERMINAL_IDENTITY_STATUS.READY,
      terminalSessionId: "",
      workdir: recordedWorkdir
    };
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

function codexSessionBriefingPrompt(session = {}) {
  if (sessionBriefingIsDelivered(session)) {
    return "";
  }
  const briefing = promptSessionBriefing({
    config: session.config,
    session
  });
  const prompt = [
    briefing,
    "",
    "Session briefing instruction:",
    "Keep this Vibe64 briefing as the source of truth for this Codex session. Do not start project work from this briefing alone. Reply exactly: Vibe64 session briefing loaded."
  ].join("\n").trim();
  return codexPromptInput(prompt);
}

function codexStartupScript(codexThreadId = "") {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const codexReasoningConfig = `model_reasoning_effort="${CODEX_SESSION_REASONING_EFFORT}"`;
  const codexCommand = [
    "codex",
    "--model",
    CODEX_SESSION_MODEL,
    "-c",
    codexReasoningConfig,
    "--dangerously-bypass-approvals-and-sandbox",
    ...(normalizedThreadId ? ["resume", normalizedThreadId] : [])
  ];
  return studioUserStartupScript(codexCommand);
}

function codexTerminalArgs({
  codexThreadId,
  containerName,
  env = {},
  helperMount = null,
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  sessionId,
  targetRoot,
  terminalId,
  worktree
}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      codexStartupScript(codexThreadId)
    ],
    containerName,
    env,
    extraLabels: [
      studioDockerLabel("daemon", STUDIO_DAEMON_ID)
    ],
    image,
    kind: "codex-terminal",
    mounts: [
      {
        readOnly: true,
        source: CODEX_ATTACHMENT_HOST_ROOT,
        target: CODEX_ATTACHMENT_CONTAINER_ROOT
      },
      ...[helperMount].filter(Boolean)
    ],
    sessionId,
    targetRoot,
    terminalId,
    workdir: worktree
  });
}

function codexContainerName({
  scope = "",
  sessionId = "",
  terminalId = ""
} = {}) {
  const containerScope = normalizeText(scope || sessionId || GLOBAL_CODEX_TERMINAL_SCOPE);
  return `${STUDIO_CODEX_CONTAINER_PREFIX}-${stableHash(containerScope)}-${stableHash(terminalId)}`;
}

function maskedCodexTerminalDockerArgs(args = []) {
  return maskedTerminalDockerArgs(args);
}

function createCodexTerminalController({
  fixJobStore = defaultFixCodexJobStore,
  projectService,
  publishPromptInjected = async () => null,
  publishSessionChanged = async () => null
} = {}) {
  const codexBootstrapPromises = new Map();
  const codexTurnWatchdogTimers = new Map();

  function codexTurnWatchdogKey(sessionId = "", terminalSessionId = "") {
    return `${normalizeText(sessionId)}:${normalizeText(terminalSessionId)}`;
  }

  function clearCodexTurnWatchdog(sessionId = "", terminalSessionId = "") {
    const key = codexTurnWatchdogKey(sessionId, terminalSessionId);
    const timer = codexTurnWatchdogTimers.get(key);
    if (!timer) {
      return;
    }
    globalThis.clearTimeout(timer);
    codexTurnWatchdogTimers.delete(key);
  }

  function clearCodexTurnWatchdogsForSession(sessionId = "") {
    const prefix = `${normalizeText(sessionId)}:`;
    for (const [key, timer] of codexTurnWatchdogTimers.entries()) {
      if (key.startsWith(prefix)) {
        globalThis.clearTimeout(timer);
        codexTurnWatchdogTimers.delete(key);
      }
    }
  }

  function scheduleCodexTurnWatchdog(sessionId = "", terminalSessionId = "", {
    delayMs = CODEX_TURN_SETTLE_MS
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedTerminalSessionId = normalizeText(terminalSessionId);
    if (!normalizedSessionId || !normalizedTerminalSessionId) {
      return;
    }
    const key = codexTurnWatchdogKey(normalizedSessionId, normalizedTerminalSessionId);
    const existingTimer = codexTurnWatchdogTimers.get(key);
    if (existingTimer) {
      globalThis.clearTimeout(existingTimer);
    }
    const timer = globalThis.setTimeout(() => {
      codexTurnWatchdogTimers.delete(key);
      void checkCodexTurnWatchdog(normalizedSessionId, normalizedTerminalSessionId);
    }, Math.max(0, Number(delayMs || 0)));
    codexTurnWatchdogTimers.set(key, timer);
  }

  async function checkCodexTurnWatchdog(sessionId = "", terminalSessionId = "") {
    const snapshot = codexTerminalSnapshot(sessionId, terminalSessionId);
    const turnState = normalizeCodexTurnState(snapshot.metadata?.codexTurnState);
    if (snapshot.ok === false || turnState !== CODEX_TURN_STATE.ACTIVE) {
      return;
    }
    if (snapshot.status === "exited") {
      await markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
        message: "Codex exited before finishing the current Vibe64 step.",
        reason: "terminal_exited"
      });
      return;
    }

    const turnStartedAt = Date.parse(snapshot.metadata?.codexTurnStartedAt || "");
    const quietMs = Number.isFinite(Number(snapshot.idleForMs))
      ? Number(snapshot.idleForMs)
      : Date.now() - (Number.isFinite(turnStartedAt) ? turnStartedAt : Date.now());
    if (quietMs < CODEX_TURN_SETTLE_MS) {
      scheduleCodexTurnWatchdog(sessionId, terminalSessionId, {
        delayMs: CODEX_TURN_SETTLE_MS - quietMs
      });
      return;
    }
    if (quietMs >= CODEX_TURN_UNKNOWN_QUIET_MS) {
      vibe64SessionDebugLog("server.codex.turn.quietTimeout", {
        quietMs,
        sessionId,
        terminalSessionId,
        turnReason: normalizeText(snapshot.metadata?.codexTurnReason)
      });
      await markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
        message: "Codex has been quiet while Vibe64 is waiting for a response.",
        reason: "quiet_timeout"
      });
      return;
    }
    scheduleCodexTurnWatchdog(sessionId, terminalSessionId, {
      delayMs: CODEX_TURN_UNKNOWN_QUIET_MS - quietMs
    });
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
    if (!workdir || !containerWorkspacePath(targetRoot, workdir)) {
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
    const currentStepInputHelper = await prepareCurrentStepInputHelper({
      onSessionChanged: async (changedSessionId) => {
        clearCodexTurnWatchdogsForSession(changedSessionId);
        clearCodexTurnsForSession(changedSessionId);
        await publishSessionChanged(changedSessionId, {
          reason: "current-step-input-helper"
        });
      },
      projectService,
      session,
      targetRoot
    });
    const terminalEnv = {
      ...baseTerminalEnv,
      ...currentStepInputHelper.env
    };
    const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
    const namespace = codexTerminalNamespace(sessionId);
    const terminalResponse = startTerminalSession({
      args: ({ id }) => codexTerminalArgs({
        codexThreadId: codexConversationIdForWorkdir(session, workdir),
        containerName: codexContainerName({
          sessionId,
          terminalId: id
        }),
        env: terminalEnv,
        helperMount: currentStepInputHelper.mount,
        image: imageResult.image,
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
      onClose: async ({ id }) => {
        clearCodexTurnWatchdog(sessionId, id);
        await removeDockerContainer(codexContainerName({
          sessionId,
          terminalId: id
        }));
        await cleanupCodexAttachments(targetRoot, sessionId);
      },
      onOutput: ({ session: terminalSession }) => {
        if (normalizeCodexTurnState(terminalSession.metadata?.codexTurnState) === CODEX_TURN_STATE.ACTIVE) {
          scheduleCodexTurnWatchdog(sessionId, terminalSession.id);
        }
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
      onClose: async ({ id }) => {
        await removeDockerContainer(codexContainerName({
          scope: GLOBAL_CODEX_TERMINAL_SCOPE,
          terminalId: id
        }));
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

  async function waitForCodexReady(sessionId, terminalSessionId) {
    const waitStartedAt = Date.now();
    let lastOutput = "";
    let lastChangedAt = Date.now();
    let lastLoggedStatus = "";
    while (true) {
      const snapshot = codexTerminalSnapshot(sessionId, terminalSessionId);
      const snapshotStatus = String(snapshot.status || "");
      if (snapshotStatus !== lastLoggedStatus) {
        lastLoggedStatus = snapshotStatus;
        vibe64SessionDebugLog("server.codex.waitForReady.status", {
          ...codexTerminalDebugSummary(snapshot),
          sessionId,
          terminalSessionId
        });
      }
      if (snapshot.ok === false || snapshot.status === "exited") {
        vibe64SessionDebugLog("server.codex.waitForReady.exited", {
          ...codexTerminalDebugSummary(snapshot),
          durationMs: vibe64SessionDebugDurationMs(waitStartedAt),
          error: snapshot.error || "Codex terminal is not running.",
          sessionId,
          terminalSessionId
        });
        return {
          ok: false,
          error: snapshot.error || "Codex terminal is not running."
        };
      }
      const output = String(snapshot.output || "");
      if (output !== lastOutput) {
        lastOutput = output;
        lastChangedAt = Date.now();
      }
      if (Date.now() - waitStartedAt > CODEX_BOOT_TIMEOUT_MS) {
        vibe64SessionDebugLog("server.codex.waitForReady.timeoutAccepted", {
          ...codexTerminalDebugSummary(snapshot),
          durationMs: vibe64SessionDebugDurationMs(waitStartedAt),
          sessionId,
          terminalSessionId
        });
        return {
          ok: true,
          output: lastOutput
        };
      }
      if (
        output &&
        Date.now() - waitStartedAt >= CODEX_BOOT_MIN_AGE_MS &&
        Date.now() - lastChangedAt >= CODEX_BOOT_QUIET_MS
      ) {
        vibe64SessionDebugLog("server.codex.waitForReady.quiet", {
          ...codexTerminalDebugSummary(snapshot),
          durationMs: vibe64SessionDebugDurationMs(waitStartedAt),
          quietMs: Date.now() - lastChangedAt,
          sessionId,
          terminalSessionId
        });
        return {
          ok: true,
          output
        };
      }
      await delay(250);
    }
  }

  function codexBootAttentionResult(classification = {}, {
    error = "",
    reason = ""
  } = {}) {
    const bootClassification = {
      confidence: classification.confidence || "low",
      reason: classification.reason || reason || "attention_required",
      state: classification.state || CODEX_BOOT_SCREEN_STATE.UNKNOWN
    };
    return {
      attentionRequired: true,
      bootClassification,
      bootState: CODEX_BOOT_RESULT_STATE.ATTENTION_REQUIRED,
      error: normalizeText(error) || codexBootAttentionMessage(bootClassification),
      ok: false,
      retryable: true
    };
  }

  function codexBootExitedResult(snapshot = {}) {
    return {
      bootState: CODEX_BOOT_RESULT_STATE.EXITED_BEFORE_READY,
      error: snapshot.error || "Codex exited before it was ready.",
      ok: false,
      restartable: true,
      retryable: true
    };
  }

  async function waitForCodexBootReadyForInput(sessionId, terminalSessionId) {
    const startedAt = Date.now();
    let lastOutput = "";
    let lastChangedAt = Date.now();
    let lastClassificationKey = "";
    while (Date.now() - startedAt <= CODEX_BOOT_TOTAL_TIMEOUT_MS) {
      const snapshot = codexTerminalSnapshot(sessionId, terminalSessionId);
      if (snapshot.ok === false || snapshot.status === "exited") {
        vibe64SessionDebugLog("server.codex.boot.exitedBeforeReady", {
          ...codexTerminalDebugSummary(snapshot),
          durationMs: vibe64SessionDebugDurationMs(startedAt),
          sessionId,
          terminalSessionId
        });
        return codexBootExitedResult(snapshot);
      }

      const output = String(snapshot.output || "");
      if (output !== lastOutput) {
        lastOutput = output;
        lastChangedAt = Date.now();
      }

      const quietMs = Date.now() - lastChangedAt;
      const classification = classifyCodexBootScreen(output);
      const classificationKey = [
        classification.state,
        classification.reason,
        classification.confidence
      ].join(":");
      if (classificationKey !== lastClassificationKey) {
        lastClassificationKey = classificationKey;
        vibe64SessionDebugLog("server.codex.boot.classified", {
          classification,
          ...codexTerminalDebugSummary(snapshot),
          quietMs,
          sessionId,
          terminalSessionId
        });
      }

      if (classification.state === CODEX_BOOT_SCREEN_STATE.BLOCKED) {
        return codexBootAttentionResult(classification);
      }

      if (
        classification.state === CODEX_BOOT_SCREEN_STATE.READY &&
        quietMs >= CODEX_BOOT_READY_QUIET_MS
      ) {
        return {
          bootClassification: classification,
          bootState: CODEX_BOOT_RESULT_STATE.READY,
          ok: true,
          output
        };
      }

      if (
        output &&
        quietMs >= CODEX_BOOT_UNKNOWN_QUIET_MS &&
        classification.state !== CODEX_BOOT_SCREEN_STATE.READY
      ) {
        return codexBootAttentionResult({
          confidence: classification.confidence || "low",
          reason: classification.reason === "unknown" ? "unknown_quiet" : classification.reason,
          state: classification.state
        });
      }

      await delay(CODEX_BOOT_POLL_MS);
    }

    return codexBootAttentionResult({
      confidence: "low",
      reason: "unknown_quiet",
      state: CODEX_BOOT_SCREEN_STATE.UNKNOWN
    }, {
      error: "Codex did not reach a ready prompt during startup."
    });
  }

  async function sendCodexShellCommand(sessionId, terminalSessionId, command) {
    const commandResult = await writeCodexTerminalInput(sessionId, terminalSessionId, String(command || ""));
    if (commandResult.ok === false) {
      return commandResult;
    }
    await delay(CODEX_KEY_PAUSE_MS);
    const enterResult = await writeTerminalSessionText(terminalSessionId, "\r", {
      namespace: codexTerminalNamespace(sessionId)
    });
    if (enterResult.ok === false) {
      return enterResult;
    }
    await delay(CODEX_KEY_PAUSE_MS);
    return {
      ok: true
    };
  }

  async function captureCodexThreadId({ session, terminalSessionId }) {
    const workdir = terminalWorktreePath(session);
    const existingThreadId = codexThreadIdForWorkdir(session, workdir);
    if (existingThreadId) {
      return existingThreadId;
    }

    const sendResult = await sendCodexShellCommand(session.sessionId, terminalSessionId, CODEX_THREAD_COMMAND);
    if (sendResult.ok === false) {
      return "";
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt <= CODEX_THREAD_CAPTURE_TIMEOUT_MS) {
      const snapshot = codexTerminalSnapshot(session.sessionId, terminalSessionId);
      if (snapshot.ok === false || snapshot.status === "exited") {
        return "";
      }
      const threadId = extractCodexThreadId(snapshot.output || "");
      if (threadId) {
        return threadId;
      }
      await delay(CODEX_BOOT_POLL_MS);
    }
    return "";
  }

  async function ensureCapturedCodexIdentity({ runtime, session, terminalSessionId }) {
    const result = await ensureAgentTerminalIdentity({
      adapter: {
        captureIdentity: async (input) => {
          const threadId = await captureCodexThreadId(input);
          return threadId ? {
            conversationId: threadId,
            resumeStrategy: AGENT_TERMINAL_RESUME_STRATEGY.PROVIDER_NATIVE
          } : null;
        },
        displayName: "Codex",
        legacyMetadataForIdentity: (identity) => ({
          codex_thread_id: identity.conversationId,
          codex_workdir: identity.workdir
        }),
        provider: CODEX_AGENT_PROVIDER,
        readIdentity: (currentSession, currentWorkdir) => codexReadyIdentityForWorkdir(currentSession, currentWorkdir),
        resumeStrategy: AGENT_TERMINAL_RESUME_STRATEGY.PROVIDER_NATIVE,
        validateConversationId: normalizeCodexConversationId,
        waitUntilReady: () => waitForCodexBootReadyForInput(session.sessionId, terminalSessionId),
        workdir: terminalWorktreePath
      },
      runtime,
      session,
      terminalSessionId
    });
    const conversationId = normalizeCodexConversationId(result.identity?.conversationId);
    if (result.ok === false) {
      return result;
    }
    if (!conversationId) {
      vibe64SessionDebugLog("server.codex.threadCapture.failed", {
        sessionId: normalizeText(session?.sessionId),
        terminalSessionId
      });
      return {
        ok: false,
        error: "Codex session id could not be saved. Restart Codex from Vibe64 before continuing this agent.",
        retryable: true
      };
    }
    return {
      ...result,
      conversationId,
      threadId: normalizeCodexThreadId(conversationId)
    };
  }

  async function writePromptIntoCodexTerminal(sessionId, terminalSessionId, prompt) {
    return writeCodexPromptIntoNamespace(terminalSessionId, prompt, {
      namespace: codexTerminalNamespace(sessionId)
    });
  }

  async function writePromptIntoGlobalCodexTerminal(terminalSessionId, prompt) {
    return writeCodexPromptIntoNamespace(terminalSessionId, prompt, {
      namespace: globalCodexTerminalNamespace()
    });
  }

  async function markCodexTerminalTurnActive(sessionId, terminalSessionId, signature, reason, {
    outputStart = 0
  } = {}) {
    vibe64SessionDebugLog("server.codex.turn.active", {
      outputStart,
      reason,
      sessionId,
      signature,
      terminalSessionId
    });
    const result = updateCodexTerminalMetadata(
      sessionId,
      terminalSessionId,
      activeCodexTurnMetadata(signature, reason, {
        outputStart
      })
    );
    if (result.ok === false) {
      return result;
    }
    scheduleCodexTurnWatchdog(sessionId, terminalSessionId);
    await publishSessionChanged(sessionId, {
      reason
    });
    return result;
  }

  async function markCodexTerminalIdle(sessionId, terminalSessionId, reason) {
    clearCodexTurnWatchdog(sessionId, terminalSessionId);
    vibe64SessionDebugLog("server.codex.turn.idle", {
      reason,
      sessionId,
      terminalSessionId
    });
    const result = updateCodexTerminalMetadata(
      sessionId,
      terminalSessionId,
      idleCodexTurnMetadata()
    );
    await publishSessionChanged(sessionId, {
      reason
    });
    return result;
  }

  async function markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
    message = "",
    reason = ""
  } = {}) {
    clearCodexTurnWatchdog(sessionId, terminalSessionId);
    const attentionReason = normalizeText(reason || "attention_required");
    vibe64SessionDebugLog("server.codex.turn.attentionRequired", {
      attentionReason,
      message,
      sessionId,
      terminalSessionId
    });
    const result = updateCodexTerminalMetadata(
      sessionId,
      terminalSessionId,
      attentionCodexTurnMetadata({
        message,
        reason: attentionReason
      })
    );
    if (result.ok === false) {
      return result;
    }
    await publishSessionChanged(sessionId, {
      reason: `codex-turn-${attentionReason}`
    });
    return result;
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
    if (!containerWorkspacePath(targetRoot, workdir)) {
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
    const jobSeed = fixJobStore.createJob({
      prompt: input.prompt,
      scope: input.scope || "project",
      subject: input.subject,
      targetRoot
    });
    const fullPrompt = [
      input.prompt,
      "",
      fixCodexReportInstructions(jobSeed)
    ].join("\n").trim();
    const jobId = jobSeed.job.id;
    const namespace = fixCodexTerminalNamespace(jobId);
    const session = {
      metadata: {
        worktree_path: workdir
      },
      targetRoot
    };
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
      targetRoot,
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
          terminalId: id
        }),
        env: {
          ...terminalEnv,
          ...reportHelper.env
        },
        helperMount: reportHelper.mount,
        image: imageResult.image,
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
      onClose: async ({ id }) => {
        await removeDockerContainer(codexContainerName({
          scope: `fix:${jobId}`,
          terminalId: id
        }));
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

  async function writeCodexBootstrapTaskEvent(runtime, sessionId, {
    error = "",
    kind = "",
    message = "",
    retryable = true,
    status = "running",
    terminalSessionId = ""
  } = {}) {
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_BOOTSTRAP_TASK_ID, {
      event: {
        error: normalizeText(error),
        kind: normalizeText(kind || status),
        message: normalizeText(message),
        status
      },
      patch: {
        error: normalizeText(error),
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
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
      reason: `codex-bootstrap-${status}`
    });
    return task;
  }

  async function writeCodexBootstrapRunning(runtime, sessionId, {
    kind = "running",
    message,
    terminalSessionId = ""
  } = {}) {
    return writeCodexBootstrapTaskEvent(runtime, sessionId, {
      kind,
      message,
      status: "running",
      terminalSessionId
    });
  }

  async function writeCodexBootstrapReady(runtime, sessionId, terminalSessionId) {
    return writeCodexBootstrapTaskEvent(runtime, sessionId, {
      kind: "ready",
      message: "Codex is ready.",
      status: "ready",
      terminalSessionId
    });
  }

  async function writeCodexBootstrapFailure(runtime, sessionId, result, {
    terminalSessionId = ""
  } = {}) {
    await writeCodexBootstrapTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
      kind: "failed",
      message: "Codex bootstrap failed.",
      retryable: result?.retryable !== false,
      status: "failed",
      terminalSessionId
    });
    return result;
  }

  async function deliverSessionBriefing({
    runtime,
    session,
    terminalSessionId
  } = {}) {
    const currentSession = await runtime.getSession(session.sessionId);
    if (sessionBriefingIsDelivered(currentSession)) {
      return {
        ok: true,
        delivered: false
      };
    }
    if (deliveredCodexPromptHandoffId(currentSession)) {
      vibe64SessionDebugLog("server.codex.bootstrap.briefing.skip", {
        reason: "prompt-already-delivered",
        sessionId: currentSession.sessionId,
        terminalSessionId
      });
      return {
        ok: true,
        delivered: false
      };
    }

    const promptSession = await runtime.promptSessionForAction(currentSession);
    const briefingPrompt = codexSessionBriefingPrompt(promptSession);
    if (!briefingPrompt) {
      return {
        ok: true,
        delivered: false
      };
    }

    const snapshot = codexTerminalSnapshot(currentSession.sessionId, terminalSessionId);
    const outputStart = String(snapshot.output || "").length;
    const injected = await writePromptIntoCodexTerminal(
      currentSession.sessionId,
      terminalSessionId,
      briefingPrompt
    );
    if (injected.ok === false) {
      return injected;
    }

    await runtime.store.mutateSession(currentSession.sessionId, async () => {
      await Promise.all([
        runtime.store.writeMetadataValue(currentSession.sessionId, "codex_session_briefing_echo_input", briefingPrompt),
        runtime.store.writeMetadataValue(currentSession.sessionId, "codex_session_briefing_output_start", String(outputStart))
      ]);
    });

    const ready = await waitForCodexReady(currentSession.sessionId, terminalSessionId);
    if (ready.ok === false) {
      return ready;
    }

    const deliveredAt = new Date().toISOString();
    await runtime.store.mutateSession(currentSession.sessionId, async () => {
      await Promise.all([
        runtime.store.writeMetadataValue(currentSession.sessionId, "codex_session_briefing_delivered", "yes"),
        runtime.store.writeMetadataValue(currentSession.sessionId, "codex_session_briefing_delivered_at", deliveredAt),
        runtime.store.writeMetadataValue(currentSession.sessionId, "codex_session_briefing_delivery", "terminal_bootstrap")
      ]);
    });
    return {
      ok: true,
      delivered: true
    };
  }

  async function pendingSessionBriefingInput({
    runtime,
    session,
    terminalSessionId
  } = {}) {
    const currentSession = await runtime.getSession(session.sessionId);
    if (sessionBriefingIsDelivered(currentSession)) {
      return {
        input: "",
        session: currentSession
      };
    }
    const promptSession = await runtime.promptSessionForAction(currentSession);
    const input = codexSessionBriefingPrompt(promptSession);
    if (!input) {
      return {
        input: "",
        session: currentSession
      };
    }
    vibe64SessionDebugLog("server.codex.briefing.pending", {
      sessionId: currentSession.sessionId,
      terminalSessionId
    });
    return {
      input,
      session: currentSession
    };
  }

  async function ensureCodexThreadReadyNow(sessionId) {
    const runtime = await projectService.createRuntime();
    try {
      let restartCount = 0;
      while (true) {
        let session = await runtime.getSession(sessionId);
        const workdir = terminalWorktreePath(session);
        const existingTerminal = activeCodexTerminal(session);
        const needsIdentityCapture = !codexConversationIdForWorkdir(session, workdir);
        const needsBriefing = !sessionBriefingIsDelivered(session);
        if (!existingTerminal || needsIdentityCapture || needsBriefing) {
          await writeCodexBootstrapRunning(runtime, sessionId, {
            kind: restartCount > 0 ? "terminal_restarting" : "started",
            message: restartCount > 0
              ? "Restarting Codex after it exited during startup."
              : "Preparing Codex for this session."
          });
        }
        const terminalResponse = await startCodexTerminalSession(sessionId);
        vibe64SessionDebugLog("server.codex.bootstrap.terminalResponse", {
          ...codexTerminalDebugSummary(terminalResponse),
          ok: terminalResponse?.ok !== false,
          restartCount,
          sessionId,
          terminalSessionId: String(terminalResponse?.id || "")
        });
        if (terminalResponse.ok === false) {
          return writeCodexBootstrapFailure(runtime, sessionId, terminalResponse);
        }

        const terminalSessionId = terminalResponse.id;
        if (!needsIdentityCapture && !needsBriefing) {
          if (!existingTerminal) {
            const ready = await waitForCodexBootReadyForInput(sessionId, terminalSessionId);
            if (
              ready.ok === false &&
              ready.bootState === CODEX_BOOT_RESULT_STATE.EXITED_BEFORE_READY &&
              codexBootShouldRestartAfterExit({
                handoffStarted: false,
                restartCount
              })
            ) {
              restartCount += 1;
              continue;
            }
            if (ready.ok === false) {
              if (ready.attentionRequired === true) {
                await markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
                  message: errorMessage(ready),
                  reason: "codex-bootstrap-attention"
                });
              }
              return writeCodexBootstrapFailure(runtime, sessionId, ready, {
                terminalSessionId
              });
            }
          }
          await writeCodexBootstrapReady(runtime, sessionId, terminalSessionId);
          await publishSessionChanged(sessionId, {
            reason: "codex-terminal-ready"
          });
          return withCodexState(terminalResponse, session);
        }

        vibe64SessionDebugLog("server.codex.bootstrap.started", {
          needsBriefing,
          needsIdentityCapture,
          restartCount,
          sessionId,
          terminalSessionId
        });
        await writeCodexBootstrapRunning(runtime, sessionId, {
          kind: "terminal_started",
          message: needsIdentityCapture ? "Preparing Codex session." : "Preparing Codex prompt.",
          terminalSessionId
        });
        const signature = codexBootstrapSignature(sessionId);
        const turnMetadata = await markCodexTerminalTurnActive(
          sessionId,
          terminalSessionId,
          signature,
          "codex-thread-bootstrap-started"
        );
        if (turnMetadata.ok === false) {
          return writeCodexBootstrapFailure(runtime, sessionId, turnMetadata, {
            terminalSessionId
          });
        }

        let bootstrapResult = {
          ok: true
        };
        let restartBoot = false;
        try {
          if (needsIdentityCapture) {
            const identityCapture = await ensureCapturedCodexIdentity({
              runtime,
              session,
              terminalSessionId
            });
            if (identityCapture.ok === false) {
              bootstrapResult = identityCapture;
            }
            vibe64SessionDebugLog("server.codex.bootstrap.identityCapture", {
              captured: Boolean(identityCapture.conversationId),
              conversationId: String(identityCapture.conversationId || ""),
              ok: identityCapture.ok !== false,
              restartCount,
              sessionId,
              terminalSessionId
            });
            if (identityCapture.ok !== false) {
              session = identityCapture.session;
            }
          } else {
            const ready = await waitForCodexBootReadyForInput(sessionId, terminalSessionId);
            if (ready.ok === false) {
              bootstrapResult = ready;
            }
          }

          if (
            bootstrapResult.ok === false &&
            bootstrapResult.bootState === CODEX_BOOT_RESULT_STATE.EXITED_BEFORE_READY &&
            codexBootShouldRestartAfterExit({
              handoffStarted: false,
              restartCount
            })
          ) {
            restartBoot = true;
          }

          if (bootstrapResult.ok !== false && needsBriefing) {
            const briefing = await deliverSessionBriefing({
              runtime,
              session,
              terminalSessionId
            });
            vibe64SessionDebugLog("server.codex.bootstrap.briefing", {
              delivered: briefing.delivered === true,
              ok: briefing.ok !== false,
              sessionId,
              terminalSessionId
            });
            if (briefing.ok === false) {
              bootstrapResult = briefing;
            }
          }
        } finally {
          if (restartBoot) {
            await markCodexTerminalIdle(
              sessionId,
              terminalSessionId,
              "codex-boot-restarting"
            );
          } else if (bootstrapResult.ok === false && bootstrapResult.attentionRequired === true) {
            await markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
              message: errorMessage(bootstrapResult),
              reason: "codex-bootstrap-attention"
            });
          } else {
            await markCodexTerminalIdle(
              sessionId,
              terminalSessionId,
              "codex-thread-bootstrap-finished"
            );
          }
        }

        if (restartBoot) {
          restartCount += 1;
          vibe64SessionDebugLog("server.codex.bootstrap.restart", {
            maxRestarts: CODEX_BOOT_MAX_RESTARTS,
            restartCount,
            sessionId,
            terminalSessionId
          });
          continue;
        }

        if (bootstrapResult.ok === false) {
          vibe64SessionDebugLog("server.codex.bootstrap.failed", {
            error: errorMessage(bootstrapResult),
            sessionId,
            terminalSessionId
          });
          return writeCodexBootstrapFailure(runtime, sessionId, bootstrapResult, {
            terminalSessionId
          });
        }

        session = await runtime.getSession(sessionId);
        await writeCodexBootstrapReady(runtime, sessionId, terminalSessionId);
        vibe64SessionDebugLog("server.codex.bootstrap.ready", {
          codexIdentityReady: Boolean(codexConversationIdForWorkdir(session, terminalWorktreePath(session))),
          codexThreadReady: Boolean(codexThreadIdForWorkdir(session, terminalWorktreePath(session))),
          sessionId,
          terminalSessionId
        });
        return {
          ...withCodexState(codexTerminalSnapshot(sessionId, terminalSessionId), session),
          codexIdentityReady: Boolean(codexConversationIdForWorkdir(session, terminalWorktreePath(session))),
          codexThreadReady: Boolean(codexThreadIdForWorkdir(session, terminalWorktreePath(session))),
          terminalSessionId
        };
      }
    } catch (error) {
      vibe64SessionDebugLog("server.codex.bootstrap.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
      await writeCodexBootstrapFailure(runtime, sessionId, error);
      throw error;
    }
  }

  async function ensureCodexThreadReady(sessionId) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: "Vibe64 session ID is required."
      };
    }
    if (codexBootstrapPromises.has(normalizedSessionId)) {
      return codexBootstrapPromises.get(normalizedSessionId);
    }

    const promise = ensureCodexThreadReadyNow(normalizedSessionId)
      .finally(() => {
        codexBootstrapPromises.delete(normalizedSessionId);
      });
    codexBootstrapPromises.set(normalizedSessionId, promise);
    return promise;
  }

  async function injectPromptIntoReadyCodex({
    handoff = {},
    runtime,
    session,
    sessionBriefingInput = "",
    terminalSessionId
  } = {}) {
    const handoffInput = codexPromptHandoffTerminalInput(handoff);
    if (!handoffInput) {
      return {
        ok: false,
        error: "Codex prompt handoff is empty."
      };
    }
    const terminalInput = [
      normalizeText(sessionBriefingInput),
      handoffInput
    ].filter(Boolean).join("\n\n");
    const sessionId = normalizeText(session?.sessionId);
    if (!sessionId || !terminalSessionId) {
      return {
        ok: false,
        error: "Codex prompt delivery is missing a session or terminal."
      };
    }
    const ready = await waitForCodexBootReadyForInput(sessionId, terminalSessionId);
    if (ready.ok === false) {
      if (ready.attentionRequired === true) {
        await markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
          message: errorMessage(ready),
          reason: "codex-ready-attention"
        });
      }
      return ready;
    }

    const signature = codexPromptHandoffSignature(sessionId);
    const snapshot = codexTerminalSnapshot(sessionId, terminalSessionId);
    const outputStart = String(snapshot.output || "").length;
    const injected = await writePromptIntoCodexTerminal(
      sessionId,
      terminalSessionId,
      terminalInput
    );
    if (injected.ok === false) {
      return injected;
    }
    const turnMetadataResult = await markCodexTerminalTurnActive(
      sessionId,
      terminalSessionId,
      signature,
      "codex-prompt-injection-started",
      {
        outputStart
      }
    );
    if (turnMetadataResult.ok === false) {
      return turnMetadataResult;
    }

    await runtime.store.mutateSession(sessionId, async () => {
      const handoffId = normalizeCodexPromptHandoffId(handoff.handoffId);
      const sessionBriefingDeliveredAt = sessionBriefingInput ? new Date().toISOString() : "";
      await Promise.all([
        runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_signature", signature),
        runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_echo_input", terminalInput),
        runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_output_start", String(outputStart)),
        runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_terminal_id", terminalSessionId),
        ...(handoffId ? [
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_id", handoffId)
        ] : []),
        ...(sessionBriefingDeliveredAt ? [
          runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_echo_input", sessionBriefingInput),
          runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_output_start", String(outputStart)),
          runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered", "yes"),
          runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered_at", sessionBriefingDeliveredAt),
          runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivery", "terminal_prompt_handoff")
        ] : [])
      ]);
    });
    await publishPromptInjected(sessionId, {
      reason: "codex-prompt-injected"
    });
    return {
      ...withCodexState(injected, {
        ...session,
        metadata: {
          ...(session.metadata || {}),
          codex_prompt_handoff_echo_input: terminalInput,
          codex_prompt_handoff_output_start: String(outputStart),
          codex_prompt_handoff_signature: signature
        }
      }),
      codexPromptInjected: true,
      codexSessionBriefingDelivered: Boolean(sessionBriefingInput),
      codexPromptHandoffOutputStart: outputStart,
      codexPromptHandoffSignature: signature,
      terminalSessionId
    };
  }

  async function injectPromptIntoCodex(sessionId, handoff = {}) {
    const terminalInput = codexPromptHandoffTerminalInput(handoff);
    if (!terminalInput) {
      return {
        ok: false,
        error: "Codex prompt handoff is empty."
      };
    }

    const bootstrap = await ensureCodexThreadReady(sessionId);
    if (bootstrap.ok === false) {
      vibe64SessionDebugLog("server.codex.inject.bootstrapFailed", {
        error: errorMessage(bootstrap),
        sessionId,
        terminalSessionId: String(bootstrap.terminalSessionId || bootstrap.id || "")
      });
      return bootstrap;
    }
    vibe64SessionDebugLog("server.codex.inject.bootstrapReady", {
      sessionId,
      terminalSessionId: String(bootstrap.terminalSessionId || bootstrap.id || "")
    });

    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    return injectPromptIntoReadyCodex({
      handoff,
      runtime,
      session,
      terminalSessionId: bootstrap.terminalSessionId || bootstrap.id
    });
  }

  async function injectLatestPendingCodexPrompt(sessionId, terminalResponse = {}) {
    if (terminalResponse?.ok === false) {
      return terminalResponse;
    }
    const terminalSessionId = terminalResponse.terminalSessionId || terminalResponse.id;
    if (!terminalSessionId) {
      return terminalResponse;
    }
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const handoff = latestPendingCodexPromptHandoff(session);
    if (!handoff) {
      return terminalResponse;
    }
    const delivery = await injectPromptIntoReadyCodex({
      handoff,
      runtime,
      session,
      terminalSessionId
    });
    if (delivery?.ok === false) {
      return delivery;
    }
    return {
      ...terminalResponse,
      ...delivery,
      pendingCodexPromptInjected: true
    };
  }

  async function resumePendingCodexPromptFromActiveTerminal(sessionId) {
    const runtime = await projectService.createRuntime();
    let session = await runtime.getSession(sessionId);
    const handoff = latestPendingCodexPromptHandoff(session);
    if (!handoff) {
      return null;
    }
    const existingTerminal = activeCodexTerminal(session);
    const terminalSessionId = normalizeText(existingTerminal?.id);
    if (!terminalSessionId) {
      vibe64SessionDebugLog("server.codex.resumePendingPrompt.noActiveTerminal", {
        handoffId: handoff.handoffId,
        sessionId
      });
      return null;
    }

    vibe64SessionDebugLog("server.codex.resumePendingPrompt.activeTerminal", {
      handoffId: handoff.handoffId,
      sessionId,
      terminalSessionId
    });
    await writeCodexBootstrapRunning(runtime, sessionId, {
      kind: "resume_pending_prompt",
      message: "Continuing Codex after terminal attention.",
      terminalSessionId
    });
    const identityCapture = await ensureCapturedCodexIdentity({
      runtime,
      session,
      terminalSessionId
    });
    if (identityCapture.ok === false) {
      if (identityCapture.bootState === CODEX_BOOT_RESULT_STATE.EXITED_BEFORE_READY) {
        return null;
      }
      if (identityCapture.attentionRequired === true) {
        await markCodexTerminalAttentionRequired(sessionId, terminalSessionId, {
          message: errorMessage(identityCapture),
          reason: "codex-bootstrap-attention"
        });
      }
      return writeCodexBootstrapFailure(runtime, sessionId, identityCapture, {
        terminalSessionId
      });
    }
    session = identityCapture.session;

    const briefing = await pendingSessionBriefingInput({
      runtime,
      session,
      terminalSessionId
    });
    session = briefing.session;

    const delivery = await injectPromptIntoReadyCodex({
      handoff,
      runtime,
      session,
      sessionBriefingInput: briefing.input,
      terminalSessionId
    });
    if (delivery?.ok === false) {
      return writeCodexBootstrapFailure(runtime, sessionId, delivery, {
        terminalSessionId
      });
    }

    session = await runtime.getSession(sessionId);
    await writeCodexBootstrapReady(runtime, sessionId, terminalSessionId);
    return {
      ...withCodexState(codexTerminalSnapshot(sessionId, terminalSessionId), session),
      ...delivery,
      pendingCodexPromptInjected: true,
      resumedPendingCodexPrompt: true,
      terminalSessionId
    };
  }

  async function codexBootstrapDisabledResult(sessionId) {
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    return {
      ok: true,
      sessionId,
      ...codexState(session),
      codexBootstrapDisabled: true,
      codexPromptInjected: false,
      codexSessionBriefingDelivered: false,
      pendingCodexPromptInjected: false,
      terminalSessionId: ""
    };
  }

  async function startCodexTerminalWithoutBootstrap(sessionId) {
    const terminalResponse = await startCodexTerminalSession(sessionId);
    if (terminalResponse?.ok === false) {
      return terminalResponse;
    }
    await publishSessionChanged(sessionId, {
      reason: "codex-terminal-started-bootstrap-disabled"
    });
    return {
      ...terminalResponse,
      codexBootstrapDisabled: true,
      codexPromptInjected: false,
      codexSessionBriefingDelivered: false,
      pendingCodexPromptInjected: false,
      terminalSessionId: terminalResponse.terminalSessionId || terminalResponse.id || ""
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

    async injectCodexPrompt(sessionId, handoff = {}) {
      return vibe64Result(async () => {
        void handoff;
        if (CODEX_SESSION_TERMINAL_BOOTSTRAP_DISABLED) {
          return codexBootstrapDisabledResult(sessionId);
        }
        return injectPromptIntoCodex(sessionId, handoff);
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
        if (CODEX_SESSION_TERMINAL_BOOTSTRAP_DISABLED) {
          return codexBootstrapDisabledResult(sessionId);
        }
        return injectLatestPendingCodexPrompt(
          sessionId,
          await ensureCodexThreadReady(sessionId)
        );
      });
    },

    async terminalState(sessionId) {
      return vibe64Result(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return {
          ok: true,
          sessionId,
          ...codexState(session)
        };
      });
    },

    async startTerminal(sessionId) {
      return vibe64Result(async () => {
        if (CODEX_SESSION_TERMINAL_BOOTSTRAP_DISABLED) {
          return startCodexTerminalWithoutBootstrap(sessionId);
        }
        const resumed = await resumePendingCodexPromptFromActiveTerminal(sessionId);
        if (resumed) {
          return resumed;
        }
        return injectLatestPendingCodexPrompt(
          sessionId,
          await ensureCodexThreadReady(sessionId)
        );
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
  codexSessionBriefingPrompt,
  codexTerminalArgs,
  createCodexTerminalController
};
