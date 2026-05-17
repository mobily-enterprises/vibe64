import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  STUDIO_CODEX_CONTAINER_PREFIX,
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_TOOLCHAIN_IMAGE,
  STUDIO_TOOL_HOME_VOLUME,
  studioDockerLabel
} from "../../../../server/lib/studioRuntimeIdentity.js";
import {
  hostUserIdentityEnvArgs
} from "../../../../server/lib/shellCommands.js";
import {
  containerWorkspacePath,
  removeDockerContainer
} from "../../../../server/lib/containerRuntime.js";
import {
  CODEX_TERMINAL_NAMESPACE_PREFIX,
  aiStudioResult,
  codexTerminalNamespace,
  dockerCommand,
  shellQuote,
  stableHash
} from "./terminalShared.js";
import {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  CODEX_ATTACHMENT_HOST_ROOT,
  cleanupCodexAttachments,
  prepareCodexAttachmentRoot,
  storeCodexAttachment
} from "./codexAttachments.js";

const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_PROBE = "!echo $CODEX_THREAD_ID";
const CODEX_SESSION_MODEL = "gpt-5.5";
const CODEX_SESSION_REASONING_EFFORT = "xhigh";
const MAX_OPEN_CODEX_TERMINALS = 3;
const STUDIO_DAEMON_ID = crypto.randomUUID();

function terminalWorkdir(session = {}) {
  return path.resolve(
    String(session.metadata?.worktree_path || session.worktree || session.targetRoot || "").trim()
  );
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
  const codexThreadId = normalizeCodexThreadId(metadata.codex_thread_id);
  return {
    codexPromptHandoffOutputStart: normalizeCodexPromptHandoffOutputStart(metadata.codex_prompt_handoff_output_start),
    codexPromptHandoffSignature: normalizeCodexPromptHandoffSignature(
      session.sessionId,
      metadata.codex_prompt_handoff_signature
    ),
    codexThreadId,
    needsThreadCapture: !codexThreadId,
    threadProbe: CODEX_THREAD_PROBE
  };
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
  const codexOptions = [
    "--model",
    shellQuote(CODEX_SESSION_MODEL),
    "-c",
    shellQuote(codexReasoningConfig),
    "--dangerously-bypass-approvals-and-sandbox"
  ].join(" ");
  const codexCommand = normalizedThreadId
    ? `codex ${codexOptions} resume ${shellQuote(normalizedThreadId)}`
    : `codex ${codexOptions}`;
  return [
    "set -e",
    `if [ -n "\${${STUDIO_HOST_UID_ENV}:-}" ] && [ -n "\${${STUDIO_HOST_GID_ENV}:-}" ] && command -v setpriv >/dev/null 2>&1; then`,
    "  mkdir -p /home/studio/.codex /home/studio/.config",
    `  chown -R "$${STUDIO_HOST_UID_ENV}:$${STUDIO_HOST_GID_ENV}" /home/studio/.codex /home/studio/.config`,
    `  exec setpriv --reuid "$${STUDIO_HOST_UID_ENV}" --regid "$${STUDIO_HOST_GID_ENV}" --clear-groups env HOME=/home/studio ${codexCommand}`,
    "fi",
    `exec env HOME=/home/studio ${codexCommand}`
  ].join("\n");
}

function codexTerminalArgs({
  codexThreadId,
  containerName,
  sessionId,
  targetRoot,
  terminalId,
  worktree
}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    studioDockerLabel("kind", "codex-terminal"),
    "--label",
    studioDockerLabel("daemon", STUDIO_DAEMON_ID),
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    studioDockerLabel("session", sessionId),
    "--label",
    studioDockerLabel("terminal", terminalId),
    "--label",
    studioDockerLabel("target", stableHash(targetRoot)),
    "-v",
    `${STUDIO_TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    ...hostUserIdentityEnvArgs(),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    "-v",
    `${CODEX_ATTACHMENT_HOST_ROOT}:${CODEX_ATTACHMENT_CONTAINER_ROOT}:ro`,
    "-w",
    worktree,
    STUDIO_TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    codexStartupScript(codexThreadId)
  ];
}

function codexContainerName({ sessionId, terminalId }) {
  return `${STUDIO_CODEX_CONTAINER_PREFIX}-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function createCodexTerminalController({ projectService } = {}) {
  return Object.freeze({
    async closeAllForSession(sessionId) {
      await closeTerminalSessionsForNamespace(codexTerminalNamespace(sessionId));
      await cleanupCodexAttachments(projectService.targetRoot, sessionId);
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
        await runtime.getSession(sessionId);
        await runtime.store.writeMetadataValue(sessionId, "codex_thread_id", codexThreadId);
        return {
          ok: true,
          codexThreadId
        };
      });
    },

    async startTerminal(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const workdir = terminalWorkdir(session);
        if (!containerWorkspacePath(projectService.targetRoot, workdir)) {
          return {
            ok: false,
            error: "AI Studio Codex workdir is outside the target root."
          };
        }

        await prepareCodexAttachmentRoot();
        const namespace = codexTerminalNamespace(sessionId);
        return withCodexState(startTerminalSession({
          args: ({ id }) => codexTerminalArgs({
            codexThreadId: normalizeCodexThreadId(session.metadata?.codex_thread_id),
            containerName: codexContainerName({
              sessionId,
              terminalId: id
            }),
            sessionId,
            targetRoot: projectService.targetRoot,
            terminalId: id,
            worktree: workdir
          }),
          command: "docker",
          commandPreview: ({ args }) => dockerCommand(args),
          cwd: projectService.targetRoot,
          maxRunning: MAX_OPEN_CODEX_TERMINALS,
          namespace,
          namespaceLimitPrefix: CODEX_TERMINAL_NAMESPACE_PREFIX,
          onClose: async ({ id }) => {
            await removeDockerContainer(codexContainerName({
              sessionId,
              terminalId: id
            }));
            await cleanupCodexAttachments(projectService.targetRoot, sessionId);
          },
          reuseRunning: true
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
        await runtime.getSession(sessionId);
        return storeCodexAttachment({
          input,
          sessionId,
          targetRoot: projectService.targetRoot
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

export { createCodexTerminalController };
