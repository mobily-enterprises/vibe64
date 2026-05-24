import crypto from "node:crypto";
import path from "node:path";

import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_CODEX_CONTAINER_PREFIX,
  studioDockerLabel
} from "../../../../server/lib/studioRuntimeIdentity.js";
import {
  studioUserStartupScript
} from "../../../../server/lib/studioToolHome.js";
import {
  containerWorkspacePath,
  removeDockerContainer
} from "../../../../server/lib/containerRuntime.js";
import {
  ensureTargetRuntimeNetwork
} from "../../../../server/lib/aiStudio/runtimeContainers.js";
import {
  prepareCurrentStepInputHelper
} from "../../../../server/lib/aiStudio/currentStepInputHelperServer.js";
import {
  promptSessionBriefing
} from "../../../../server/lib/aiStudio/promptRenderer.js";
import {
  wrapPromptWithStudioContext
} from "../../../../server/lib/aiStudio/promptMarkers.js";
import {
  aiStudioResult,
  codexTerminalNamespace,
  directoryExists,
  dockerCommand,
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
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();

function normalizeText(value) {
  return String(value || "").trim();
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
    return terminalTargetRoot(session, projectService);
  } catch {
    return terminalTargetRoot({}, projectService);
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

function codexTerminalSnapshot(sessionId = "", terminalSessionId = "") {
  return readTerminalSession(terminalSessionId, {
    namespace: codexTerminalNamespace(sessionId)
  });
}

function writeCodexTerminalInput(sessionId = "", terminalSessionId = "", data = "") {
  return writeTerminalSession(terminalSessionId, data, {
    namespace: codexTerminalNamespace(sessionId)
  });
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

function codexStartupSessionBriefingPrompt(session = {}) {
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
    "Startup instruction:",
    "Keep this AI Studio briefing as the source of truth for this Codex session. Do not start project work from this briefing alone. Reply exactly: AI Studio session briefing loaded."
  ].join("\n").trim();
  return wrapPromptWithStudioContext(prompt, "Load AI Studio session briefing.");
}

function codexStartupScript(codexThreadId = "", startupPrompt = "") {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const normalizedStartupPrompt = normalizeText(startupPrompt);
  const codexReasoningConfig = `model_reasoning_effort="${CODEX_SESSION_REASONING_EFFORT}"`;
  const codexCommand = [
    "codex",
    "--model",
    CODEX_SESSION_MODEL,
    "-c",
    codexReasoningConfig,
    "--dangerously-bypass-approvals-and-sandbox",
    ...(normalizedThreadId ? ["resume", normalizedThreadId] : []),
    ...(normalizedStartupPrompt ? [normalizedStartupPrompt] : [])
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
  startupPrompt = "",
  targetRoot,
  terminalId,
  worktree
}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      codexStartupScript(codexThreadId, startupPrompt)
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

function codexContainerName({ sessionId, terminalId }) {
  return `${STUDIO_CODEX_CONTAINER_PREFIX}-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function maskedCodexTerminalDockerArgs(args = []) {
  const maskedArgs = maskedTerminalDockerArgs(args);
  if (!maskedArgs.length) {
    return maskedArgs;
  }
  if (!String(maskedArgs.at(-1) || "").includes("AI Studio session briefing")) {
    return maskedArgs;
  }
  return maskedArgs.map((arg, index) => index === maskedArgs.length - 1
    ? "<ai-studio-codex-startup-script>"
    : arg);
}

function createCodexTerminalController({
  projectService,
  publishPromptInjected = async () => null,
  publishSessionChanged = async () => null
} = {}) {
  async function startCodexTerminalSession(sessionId) {
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const targetRoot = terminalTargetRoot(session, projectService);
    if (!targetRoot) {
      return {
        ok: false,
        error: "AI Studio Codex target root is not available."
      };
    }
    const workdir = terminalWorktreePath(session);
    if (!workdir || !containerWorkspacePath(targetRoot, workdir)) {
      return {
        ok: false,
        error: workdir
          ? "AI Studio Codex workdir is outside the target root."
          : "Create the session worktree before starting Codex."
      };
    }
    if (!await directoryExists(workdir)) {
      return {
        ok: false,
        error: `Session worktree directory does not exist: ${workdir}`
      };
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
      onSessionChanged: (changedSessionId) => publishSessionChanged(changedSessionId, {
        reason: "current-step-input-helper"
      }),
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
    const promptSession = await runtime.promptSessionForAction(session);
    const startupPrompt = codexStartupSessionBriefingPrompt(promptSession);
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
        startupPrompt,
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
        startupSessionBriefingIncluded: Boolean(startupPrompt),
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
    if (terminalResponse.ok && terminalResponse.metadata?.startupSessionBriefingIncluded === true) {
      const deliveredAt = new Date().toISOString();
      await Promise.all([
        runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered", "yes"),
        runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivered_at", deliveredAt),
        runtime.store.writeMetadataValue(sessionId, "codex_session_briefing_delivery", "startup")
      ]);
      return withCodexState(terminalResponse, {
        ...session,
        metadata: {
          ...(session.metadata || {}),
          codex_session_briefing_delivered: "yes",
          codex_session_briefing_delivered_at: deliveredAt,
          codex_session_briefing_delivery: "startup"
        }
      });
    }
    return withCodexState(terminalResponse, session);
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
        await Promise.all([
          runtime.store.writeMetadataValue(session.sessionId, "codex_thread_id", threadId),
          runtime.store.writeMetadataValue(session.sessionId, "codex_workdir", workdir)
        ]);
        return threadId;
      }
      await delay(250);
    }
    return "";
  }

  async function injectPromptIntoCodex(sessionId, handoff = {}) {
    const terminalInput = codexPromptHandoffTerminalInput(handoff);
    if (!terminalInput) {
      return {
        ok: false,
        error: "Codex prompt handoff is empty."
      };
    }

    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const terminalResponse = await startCodexTerminalSession(sessionId);
    if (terminalResponse.ok === false) {
      return terminalResponse;
    }
    const ready = await waitForCodexReady(sessionId, terminalResponse.id);
    if (ready.ok === false) {
      return ready;
    }
    await captureCodexThreadId({
      runtime,
      session,
      terminalSessionId: terminalResponse.id
    });

    const snapshot = codexTerminalSnapshot(sessionId, terminalResponse.id);
    const outputStart = String(snapshot.output || "").length;
    const injected = writeCodexTerminalInput(
      sessionId,
      terminalResponse.id,
      `${PROMPT_INJECTION_PREFIX}${terminalInput}${PROMPT_INJECTION_SUFFIX}`
    );
    if (injected.ok === false) {
      return injected;
    }

    const signature = codexPromptHandoffSignature(sessionId);
    await Promise.all([
      runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_signature", signature),
      runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_output_start", String(outputStart))
    ]);
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
      terminalSessionId: terminalResponse.id
    };
  }

  return Object.freeze({
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

    readTerminal(sessionId, terminalSessionId) {
      return aiStudioResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return withCodexState(readTerminalSession(terminalSessionId, {
          namespace: codexTerminalNamespace(sessionId)
        }), session);
      });
    },

    async injectCodexPrompt(sessionId, handoff = {}) {
      return aiStudioResult(async () => {
        return injectPromptIntoCodex(sessionId, handoff);
      });
    },

    async startTerminal(sessionId) {
      return aiStudioResult(async () => {
        return startCodexTerminalSession(sessionId);
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return aiStudioResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return withCodexState(subscribeTerminalSession(terminalSessionId, subscriber, {
          namespace: codexTerminalNamespace(sessionId)
        }), session);
      });
    },

    async uploadAttachment(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const targetRoot = terminalTargetRoot(session, projectService);
        if (!targetRoot) {
          return {
            ok: false,
            error: "AI Studio Codex target root is not available."
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

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: codexTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  codexStartupSessionBriefingPrompt,
  codexTerminalArgs,
  createCodexTerminalController
};
