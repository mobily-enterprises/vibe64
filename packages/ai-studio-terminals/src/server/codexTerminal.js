import crypto from "node:crypto";
import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
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
  CODEX_TERMINAL_NAMESPACE_PREFIX,
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
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";

const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_PROBE = "!echo $CODEX_THREAD_ID";
const CODEX_SESSION_MODEL = "gpt-5.5";
const CODEX_SESSION_REASONING_EFFORT = "xhigh";
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();

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
    codexThreadId,
    needsThreadCapture: Boolean(workdir && !codexThreadId),
    threadProbe: CODEX_THREAD_PROBE
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
      }
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

function createCodexTerminalController({ projectService } = {}) {
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

    async savePromptHandoff(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const signature = normalizeCodexPromptHandoffSignature(sessionId, input?.signature);
        if (!signature) {
          return {
            ok: false,
            error: "Invalid Codex prompt handoff."
          };
        }
        const runtime = await projectService.createRuntime();
        await runtime.getSession(sessionId);
        const outputStart = normalizeCodexPromptHandoffOutputStart(input?.outputStart);
        await Promise.all([
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_signature", signature),
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_output_start", String(outputStart))
        ]);
        return {
          ok: true,
          codexPromptHandoffOutputStart: outputStart,
          codexPromptHandoffSignature: signature
        };
      });
    },

    async saveThread(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const codexThreadId = normalizeCodexThreadId(input?.threadId);
        if (!codexThreadId) {
          return {
            ok: false,
            error: "Invalid Codex thread id."
          };
        }
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const targetRoot = terminalTargetRoot(session, projectService);
        const workdir = terminalWorktreePath(session);
        if (!targetRoot) {
          return {
            ok: false,
            error: "AI Studio Codex target root is not available."
          };
        }
        if (!workdir || !containerWorkspacePath(targetRoot, workdir)) {
          return {
            ok: false,
            error: workdir
              ? "AI Studio Codex workdir is outside the target root."
              : "Create the session worktree before saving a Codex thread."
          };
        }
        if (!await directoryExists(workdir)) {
          return {
            ok: false,
            error: `Session worktree directory does not exist: ${workdir}`
          };
        }
        await Promise.all([
          runtime.store.writeMetadataValue(sessionId, "codex_thread_id", codexThreadId),
          runtime.store.writeMetadataValue(sessionId, "codex_workdir", workdir)
        ]);
        return {
          ok: true,
          codexThreadId,
          codexWorkdir: workdir
        };
      });
    },

    async startTerminal(sessionId) {
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
        const terminalEnv = await projectTerminalEnvironment({
          projectService,
          runtime,
          session,
          target: "codex",
          targetRoot
        });
        const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
        const namespace = codexTerminalNamespace(sessionId);
        return withCodexState(startTerminalSession({
          args: ({ id }) => codexTerminalArgs({
            codexThreadId: codexThreadIdForWorkdir(session, workdir),
            containerName: codexContainerName({
              sessionId,
              terminalId: id
            }),
            env: terminalEnv,
            image: imageResult.image,
            sessionId,
            targetRoot,
            terminalId: id,
            worktree: workdir
          }),
          command: "docker",
          commandPreview: ({ args }) => dockerCommand(maskedTerminalDockerArgs(args)),
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
          namespaceLimitPrefix: CODEX_TERMINAL_NAMESPACE_PREFIX,
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
        }), session);
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
    }
  });
}

export { codexTerminalArgs, createCodexTerminalController };
