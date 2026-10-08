import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { prepareAgentSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { VIBE64_CODEX_ATTACHMENTS_ROOT_ENV } from "./codexAttachments.js";
import { errorMessage } from "./codexStartupHealth.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";
import {
  CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE,
  codexSessionWorktreeUnavailableFailure,
  codexSessionWorktreeWasRemoved,
  terminalWorktreePath
} from "./terminalShared.js";

function normalizeText(value) {
  return String(value || "").trim();
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

function codexSessionWorktreeIsClosing(session = {}) {
  return sessionIsClosing(session);
}

function codexSessionWorktreeIsUnavailable(session = {}) {
  return codexSessionWorktreeWasRemoved(session) || codexSessionWorktreeIsClosing(session);
}

function createCodexSessionEnvironment({
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codexGitCommand,
  env,
  projectService,
  runCommand
}) {

  function vibe64SessionContextInput(conversationKind = "main") {
    return {
      scope: "session",
      conversationKind,
      session: {
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedGit: Boolean(codexGitCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  function codexAttachmentEnv() {
    return codexAttachmentEnvForController(env);
  }

  async function codexManagedCommandEnv({
    runtime = null,
    session = {},
    sessionId = ""
  } = {}) {
    if (await learningSessionExecutionRoot(runtime, sessionId)) return {};
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
      await learningSessionExecutionRoot(runtime, normalizedSessionId);
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
      if (await learningSessionExecutionRoot(runtime, sessionId)) return {};
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

  return {
    vibe64SessionContextInput,
    codexAttachmentEnv,
    codexManagedCommandEnv,
    withCodexSessionStartupGate,
    codexProjectTerminalEnv,
    codexProjectTerminalEnvFailureResult
  };
}

export { createCodexSessionEnvironment, codexSessionWorktreeIsUnavailable };
