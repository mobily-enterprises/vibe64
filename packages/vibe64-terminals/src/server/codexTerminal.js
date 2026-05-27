import crypto from "node:crypto";
import path from "node:path";

import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  updateTerminalSessionMetadata,
  writeTerminalSession
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
  STEP_STATUS
} from "@local/vibe64-runtime/server/workflowStepMachines";
import {
  promptSessionBriefing
} from "@local/vibe64-adapters/server/promptRenderer";
import {
  wrapPromptWithStudioContext
} from "@local/vibe64-adapters/server/promptMarkers";
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
  prepareFixCodexReportHelper
} from "./fixCodexJobs.js";

const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_ID_TOKEN_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const CODEX_THREAD_COMMAND = "echo $CODEX_THREAD_ID";
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const CODEX_KEY_PAUSE_MS = 180;
const CODEX_THREAD_CAPTURE_TIMEOUT_MS = 12000;
const PROMPT_INJECTION_PREFIX = "\u001b[200~";
const PROMPT_INJECTION_SUFFIX = "\u001b[201~\r";
const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const STANDALONE_TERMINAL_CONTROL_CHARACTERS = [
  `${String.fromCharCode(0)}-${String.fromCharCode(8)}`,
  String.fromCharCode(11),
  String.fromCharCode(12),
  `${String.fromCharCode(14)}-${String.fromCharCode(31)}`,
  `${String.fromCharCode(127)}-${String.fromCharCode(159)}`
].join("");
const OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const TERMINAL_STRING_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[PX^_][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "gu");
const ESCAPE_SEQUENCE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[ -/]*[@-~]`, "gu");
const STANDALONE_TERMINAL_CONTROL_PATTERN = new RegExp(`[${STANDALONE_TERMINAL_CONTROL_CHARACTERS}]`, "gu");
const CODEX_SESSION_MODEL = "gpt-5.5";
const CODEX_SESSION_REASONING_EFFORT = "xhigh";
const CODEX_BOOTSTRAP_TASK_ID = "codex_bootstrap";
const START_CODEX_TERMINAL_CONTROL_ACTION = "start_codex_terminal";
const CONTINUE_CODEX_TURN_PROMPT = "Continue work";
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();
const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_TURN_STATE = Object.freeze({
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

function codexContinueTurnRejected(session = {}) {
  const status = normalizeText(session.stepMachine?.status);
  if (status === STEP_STATUS.AWAITING_AGENT_RESULT) {
    return null;
  }
  return {
    ok: false,
    retryable: false,
    stepMachineStatus: status,
    error: "Codex can only be continued while the current step is waiting for Codex."
  };
}

async function readCodexContinueTurnSession(runtime, sessionId) {
  const session = await runtime.getSession(sessionId);
  const rejection = codexContinueTurnRejected(session);
  if (rejection) {
    return rejection;
  }
  return {
    ok: true,
    session
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stripTerminalControlSequences(value = "") {
  const source = String(value || "")
    .replace(OSC_PATTERN, "")
    .replace(TERMINAL_STRING_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_SEQUENCE_PATTERN, "");
  return stripAnsi(source)
    .replace(STANDALONE_TERMINAL_CONTROL_PATTERN, "");
}

function codexTrustPromptLooksActive(output = "") {
  const text = stripTerminalControlSequences(output);
  const promptIndex = text.search(/Do you trust the contents of this directory\?/u);
  if (promptIndex < 0) {
    return false;
  }
  const promptTail = text.slice(promptIndex);
  return promptTail.includes("Yes, continue") &&
    promptTail.includes("No, quit") &&
    promptTail.includes("Press enter to continue");
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

function extractCodexThreadId(output = "") {
  const lines = stripTerminalControlSequences(output)
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
  const terminalInput = normalizeText(handoff.terminalInput);
  if (terminalInput) {
    return terminalInput;
  }
  const prompt = normalizeText(handoff.prompt);
  return prompt ? wrapPromptWithStudioContext(prompt) : "";
}

function codexPromptHandoffSignature(sessionId = "") {
  return `${sessionId}:${Date.now()}`;
}

function codexBootstrapSignature(sessionId = "") {
  return `${sessionId}:codex-bootstrap:${Date.now()}`;
}

function codexTerminalSnapshot(sessionId = "", terminalSessionId = "") {
  return readTerminalSession(terminalSessionId, {
    namespace: codexTerminalNamespace(sessionId)
  });
}

function globalCodexTerminalSnapshot(terminalSessionId = "") {
  return readTerminalSession(terminalSessionId, {
    namespace: globalCodexTerminalNamespace()
  });
}

function codexTerminalStatus(terminal = null) {
  if (!terminal) {
    return null;
  }
  return {
    activityLabel: terminal.metadata?.codexTurnLabel || "",
    activityStartedAt: terminal.metadata?.codexTurnStartedAt || "",
    activityFinishedAt: terminal.metadata?.codexTurnFinishedAt || "",
    activityReason: terminal.metadata?.codexTurnReason || "",
    commandPreview: terminal.commandPreview || "",
    id: terminal.id || "",
    inputVersion: terminal.inputVersion || 0,
    lastInputAt: terminal.lastInputAt || "",
    lastInputBytes: terminal.lastInputBytes || 0,
    lastOutputAt: terminal.lastOutputAt || "",
    lastOutputBytes: terminal.lastOutputBytes || 0,
    outputVersion: terminal.outputVersion || 0,
    status: terminal.status || "",
    transmitting: terminal.metadata?.codexTurnState === CODEX_TURN_STATE.TRANSMITTING
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
  return writeTerminalSession(terminalSessionId, data, {
    namespace: codexTerminalNamespace(sessionId)
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
      return "Terminal is transmitting...";
  }
}

function transmittingCodexTurnMetadata(signature = "", reason = "") {
  return {
    codexTurnFinishedAt: "",
    codexTurnLabel: codexTurnLabel(reason),
    codexTurnReason: normalizeText(reason),
    codexTurnSignature: signature,
    codexTurnStartedAt: new Date().toISOString(),
    codexTurnState: CODEX_TURN_STATE.TRANSMITTING
  };
}

function idleCodexTurnMetadata() {
  return {
    codexTurnLabel: "",
    codexTurnReason: "",
    codexTurnFinishedAt: new Date().toISOString(),
    codexTurnState: CODEX_TURN_STATE.IDLE
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
  const codexThreadId = codexThreadIdForWorkdir(session, workdir);
  return {
    codexWorkdir: workdir,
    codexPromptHandoffOutputStart: normalizeCodexPromptHandoffOutputStart(metadata.codex_prompt_handoff_output_start),
    codexPromptHandoffSignature: normalizeCodexPromptHandoffSignature(
      session.sessionId,
      metadata.codex_prompt_handoff_signature
    ),
    codexTerminal: activeCodexTerminal(session),
    codexThreadId
  };
}

function codexThreadIdForWorkdir(session = {}, workdir = "") {
  const codexThreadId = normalizeCodexThreadId(session.metadata?.codex_thread_id);
  if (!codexThreadId) {
    return "";
  }

  const normalizedWorkdir = workdir ? path.resolve(workdir) : terminalWorktreePath(session);
  const recordedWorkdir = savedCodexWorkdir(session);
  if (!normalizedWorkdir || !recordedWorkdir || recordedWorkdir !== normalizedWorkdir) {
    return "";
  }

  return codexThreadId;
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
  return wrapPromptWithStudioContext(prompt, "Load Vibe64 session briefing.");
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
        codexThreadId: codexThreadIdForWorkdir(session, workdir),
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
        await removeDockerContainer(codexContainerName({
          sessionId,
          terminalId: id
        }));
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
    const startedAt = Date.now();
    let lastOutput = "";
    let lastChangedAt = Date.now();
    while (Date.now() - startedAt <= CODEX_BOOT_TIMEOUT_MS) {
      const snapshot = codexTerminalSnapshot(sessionId, terminalSessionId);
      if (snapshot.ok === false || snapshot.status === "exited") {
        return {
          ok: false,
          error: snapshot.error || "Codex terminal is not running."
        };
      }
      const output = String(snapshot.output || "");
      if (codexTrustPromptLooksActive(output)) {
        return {
          ok: false,
          error: "Answer the Codex trust prompt in Inspect before sending this prompt."
        };
      }
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

  async function sendCodexShellCommand(sessionId, terminalSessionId, command) {
    const keySequence = [
      "\u001b",
      "\u0015",
      "! ",
      command,
      " ",
      "\u001b",
      "\r"
    ];
    for (const input of keySequence) {
      const result = writeCodexTerminalInput(sessionId, terminalSessionId, input);
      if (result.ok === false) {
        return result;
      }
      await delay(CODEX_KEY_PAUSE_MS);
    }
    return {
      ok: true
    };
  }

  async function captureCodexThreadId({ runtime, session, terminalSessionId }) {
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
      const threadId = extractCodexThreadId(snapshot.output || "");
      if (threadId) {
        await runtime.store.mutateSession(session.sessionId, async () => {
          await Promise.all([
            runtime.store.writeMetadataValue(session.sessionId, "codex_thread_id", threadId),
            runtime.store.writeMetadataValue(session.sessionId, "codex_workdir", workdir)
          ]);
        });
        return threadId;
      }
      await delay(250);
    }
    return "";
  }

  async function writePromptIntoCodexTerminal(sessionId, terminalSessionId, prompt) {
    return writeCodexTerminalInput(
      sessionId,
      terminalSessionId,
      `${PROMPT_INJECTION_PREFIX}${prompt}${PROMPT_INJECTION_SUFFIX}`
    );
  }

  async function writePromptIntoGlobalCodexTerminal(terminalSessionId, prompt) {
    return writeTerminalSession(
      terminalSessionId,
      `${PROMPT_INJECTION_PREFIX}${prompt}${PROMPT_INJECTION_SUFFIX}`,
      {
        namespace: globalCodexTerminalNamespace()
      }
    );
  }

  async function markCodexTerminalTransmitting(sessionId, terminalSessionId, signature, reason) {
    const result = updateCodexTerminalMetadata(
      sessionId,
      terminalSessionId,
      transmittingCodexTurnMetadata(signature, reason)
    );
    if (result.ok === false) {
      return result;
    }
    await publishSessionChanged(sessionId, {
      reason
    });
    return result;
  }

  async function markCodexTerminalIdle(sessionId, terminalSessionId, reason) {
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
      if (codexTrustPromptLooksActive(output)) {
        return {
          ok: false,
          error: "Answer the Codex trust prompt before sending this project tool prompt."
        };
      }
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
      if (codexTrustPromptLooksActive(output)) {
        return {
          ok: false,
          error: "Answer the Codex trust prompt before sending this fix prompt."
        };
      }
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
      targetRoot: input.targetRoot || projectService.targetRoot || runtime?.targetRoot
    });
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
      await writeTerminalSession(
        terminalResponse.id,
        `${PROMPT_INJECTION_PREFIX}${wrapPromptWithStudioContext(fullPrompt)}${PROMPT_INJECTION_SUFFIX}`,
        {
          namespace
        }
      );
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
    if (sessionBriefingIsDelivered(session)) {
      return {
        ok: true,
        delivered: false
      };
    }

    const promptSession = await runtime.promptSessionForAction(session);
    const briefingPrompt = codexSessionBriefingPrompt(promptSession);
    if (!briefingPrompt) {
      return {
        ok: true,
        delivered: false
      };
    }

    const injected = await writePromptIntoCodexTerminal(
      session.sessionId,
      terminalSessionId,
      briefingPrompt
    );
    if (injected.ok === false) {
      return injected;
    }

    const ready = await waitForCodexReady(session.sessionId, terminalSessionId);
    if (ready.ok === false) {
      return ready;
    }

    const deliveredAt = new Date().toISOString();
    await runtime.store.mutateSession(session.sessionId, async () => {
      await Promise.all([
        runtime.store.writeMetadataValue(session.sessionId, "codex_session_briefing_delivered", "yes"),
        runtime.store.writeMetadataValue(session.sessionId, "codex_session_briefing_delivered_at", deliveredAt),
        runtime.store.writeMetadataValue(session.sessionId, "codex_session_briefing_delivery", "terminal_bootstrap")
      ]);
    });
    return {
      ok: true,
      delivered: true
    };
  }

  async function ensureCodexThreadReadyNow(sessionId) {
    const runtime = await projectService.createRuntime();
    try {
      await writeCodexBootstrapRunning(runtime, sessionId, {
        kind: "started",
        message: "Preparing Codex for this session."
      });
      let session = await runtime.getSession(sessionId);
      const workdir = terminalWorktreePath(session);
      const existingTerminal = activeCodexTerminal(session);
      const terminalResponse = await startCodexTerminalSession(sessionId);
      if (terminalResponse.ok === false) {
        return writeCodexBootstrapFailure(runtime, sessionId, terminalResponse);
      }

      const needsThreadCapture = !codexThreadIdForWorkdir(session, workdir);
      const needsBriefing = !sessionBriefingIsDelivered(session);
      if (!needsThreadCapture && !needsBriefing) {
        if (!existingTerminal) {
          const ready = await waitForCodexReady(sessionId, terminalResponse.id);
          if (ready.ok === false) {
            return writeCodexBootstrapFailure(runtime, sessionId, ready, {
              terminalSessionId: terminalResponse.id
            });
          }
        }
        await writeCodexBootstrapReady(runtime, sessionId, terminalResponse.id);
        await publishSessionChanged(sessionId, {
          reason: "codex-terminal-ready"
        });
        return withCodexState(terminalResponse, session);
      }

      const terminalSessionId = terminalResponse.id;
      await writeCodexBootstrapRunning(runtime, sessionId, {
        kind: "terminal_started",
        message: "Preparing Codex thread.",
        terminalSessionId
      });
      const signature = codexBootstrapSignature(sessionId);
      const turnMetadata = await markCodexTerminalTransmitting(
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
      try {
        const ready = await waitForCodexReady(sessionId, terminalSessionId);
        if (ready.ok === false) {
          bootstrapResult = ready;
        }

        if (bootstrapResult.ok !== false && needsThreadCapture) {
          const threadId = await captureCodexThreadId({
            runtime,
            session,
            terminalSessionId
          });
          if (!threadId) {
            bootstrapResult = {
              ok: false,
              error: "Codex thread ID could not be captured."
            };
          }
        }

        if (bootstrapResult.ok !== false && needsThreadCapture) {
          const threadReady = await waitForCodexReady(sessionId, terminalSessionId);
          if (threadReady.ok === false) {
            bootstrapResult = threadReady;
          }
          session = await runtime.getSession(sessionId);
        }

        if (bootstrapResult.ok !== false) {
          const briefing = await deliverSessionBriefing({
            runtime,
            session,
            terminalSessionId
          });
          if (briefing.ok === false) {
            bootstrapResult = briefing;
          }
        }
      } finally {
        await markCodexTerminalIdle(
          sessionId,
          terminalSessionId,
          "codex-thread-bootstrap-finished"
        );
      }

      if (bootstrapResult.ok === false) {
        return writeCodexBootstrapFailure(runtime, sessionId, bootstrapResult, {
          terminalSessionId
        });
      }

      session = await runtime.getSession(sessionId);
      await writeCodexBootstrapReady(runtime, sessionId, terminalSessionId);
      return {
        ...withCodexState(codexTerminalSnapshot(sessionId, terminalSessionId), session),
        codexThreadReady: Boolean(codexThreadIdForWorkdir(session, terminalWorktreePath(session))),
        terminalSessionId
      };
    } catch (error) {
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
      return bootstrap;
    }

    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const terminalSessionId = bootstrap.terminalSessionId || bootstrap.id;
    const signature = codexPromptHandoffSignature(sessionId);
    const turnMetadataResult = await markCodexTerminalTransmitting(
      sessionId,
      terminalSessionId,
      signature,
      "codex-prompt-injection-started"
    );
    if (turnMetadataResult.ok === false) {
      return turnMetadataResult;
    }

    const ready = await waitForCodexReady(sessionId, terminalSessionId);
    if (ready.ok === false) {
      await markCodexTerminalIdle(sessionId, terminalSessionId, "codex-prompt-injection-failed");
      return ready;
    }

    const snapshot = codexTerminalSnapshot(sessionId, terminalSessionId);
    const outputStart = String(snapshot.output || "").length;
    const injected = await writePromptIntoCodexTerminal(
      sessionId,
      terminalSessionId,
      terminalInput
    );
    if (injected.ok === false) {
      await markCodexTerminalIdle(sessionId, terminalSessionId, "codex-prompt-injection-failed");
      return injected;
    }

    await runtime.store.mutateSession(sessionId, async () => {
      await Promise.all([
        runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_signature", signature),
        runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_output_start", String(outputStart))
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
          codex_prompt_handoff_output_start: String(outputStart),
          codex_prompt_handoff_signature: signature
        }
      }),
      codexPromptInjected: true,
      codexPromptHandoffOutputStart: outputStart,
      codexPromptHandoffSignature: signature,
      terminalSessionId
    };
  }

  async function continueCodexTurn(sessionId) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: "Vibe64 session ID is required."
      };
    }

    const runtime = await projectService.createRuntime();
    let sessionResult = await readCodexContinueTurnSession(runtime, normalizedSessionId);
    if (sessionResult.ok === false) {
      return sessionResult;
    }

    const bootstrap = await ensureCodexThreadReady(normalizedSessionId);
    if (bootstrap.ok === false) {
      return bootstrap;
    }

    sessionResult = await readCodexContinueTurnSession(runtime, normalizedSessionId);
    if (sessionResult.ok === false) {
      return sessionResult;
    }

    const session = sessionResult.session;
    const terminalSessionId = bootstrap.terminalSessionId || bootstrap.id || activeCodexTerminal(session)?.id || "";
    if (!terminalSessionId) {
      return {
        ok: false,
        error: "Codex terminal is not running."
      };
    }

    const signature = codexPromptHandoffSignature(normalizedSessionId);
    const turnMetadataResult = await markCodexTerminalTransmitting(
      normalizedSessionId,
      terminalSessionId,
      signature,
      "codex-turn-continue-started"
    );
    if (turnMetadataResult.ok === false) {
      return turnMetadataResult;
    }

    const ready = await waitForCodexReady(normalizedSessionId, terminalSessionId);
    if (ready.ok === false) {
      await markCodexTerminalIdle(normalizedSessionId, terminalSessionId, "codex-turn-continue-failed");
      return ready;
    }

    sessionResult = await readCodexContinueTurnSession(runtime, normalizedSessionId);
    if (sessionResult.ok === false) {
      await markCodexTerminalIdle(normalizedSessionId, terminalSessionId, "codex-turn-continue-rejected");
      return sessionResult;
    }

    const injected = await writePromptIntoCodexTerminal(
      normalizedSessionId,
      terminalSessionId,
      CONTINUE_CODEX_TURN_PROMPT
    );
    if (injected.ok === false) {
      await markCodexTerminalIdle(normalizedSessionId, terminalSessionId, "codex-turn-continue-failed");
      return injected;
    }

    await publishPromptInjected(normalizedSessionId, {
      reason: "codex-turn-continue-injected"
    });
    return {
      ...withCodexState(injected, sessionResult.session),
      codexContinueInjected: true,
      terminalSessionId
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
        return {
          fixJob: fixJobStore.reportJob(jobId, input),
          ok: true
        };
      });
    },

    async continueTurn(sessionId) {
      return vibe64Result(async () => {
        return continueCodexTurn(sessionId);
      });
    },

    async ensureThread(sessionId) {
      return vibe64Result(async () => {
        return ensureCodexThreadReady(sessionId);
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
        return ensureCodexThreadReady(sessionId);
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
      return writeTerminalSession(terminalSessionId, data, {
        namespace: codexTerminalNamespace(sessionId)
      });
    },

    writeGlobalTerminal(terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: globalCodexTerminalNamespace()
      });
    },

    writeFixTerminal(jobId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
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
