import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { prepareAgentSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { VIBE64_CODEX_ATTACHMENTS_ROOT_ENV } from "./codexAttachments.js";
import { errorMessage } from "./codexStartupHealth.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { learningSessionExecutionRoot } from "./mainConversationContext.js";
import {
  CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE,
  codexSessionWorktreeUnavailableFailure,
  codexSessionWorktreeWasRemoved
} from "./terminalShared.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {typeof import("@local/vibe64-execution/server").runVibe64Command} RunVibe64Command */

/**
 * The env attachment storage resolves its root from: only the root the controller's env names, if any.
 * @param {RuntimeEnv} env
 */
function codexAttachmentEnvForController(env) {
  const explicitRoot = normalizeText(env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]);
  return explicitRoot
    ? {
        [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: explicitRoot
      }
    : {};
}

function codexSessionWorktreeIsClosing(session = {}) {
  return sessionIsClosing(session);
}

function codexSessionWorktreeIsUnavailable(session = {}) {
  return codexSessionWorktreeWasRemoved(session) || codexSessionWorktreeIsClosing(session);
}

/**
 * @param {object} dependencies
 * @param {AgentDatabaseCommandService} dependencies.agentDatabaseCommand
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {AgentSessionCommandService} dependencies.agentSessionCommand
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {RuntimeEnv} dependencies.env
 * @param {ProjectService} dependencies.project
 * @param {RunVibe64Command} dependencies.runCommand
 */
function createCodexSessionEnvironment({
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codexGitCommand,
  env,
  project,
  runCommand
}) {

  function vibe64SessionContextInput(conversationKind = "main") {
    return {
      scope: "session",
      conversationKind,
      ...(env?.VIBE64_HOST_AGENT_GUIDANCE ? { hostGuidance: env.VIBE64_HOST_AGENT_GUIDANCE } : {}),
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
    const projectRecord = await project.readCurrentProject();
    const prepared = await prepareAgentSessionCommandEnvironment({
      agentDatabaseCommand,
      agentEnvCommand,
      agentPreviewCommand,
      agentSessionCommand,
      env,
      gitCommand: codexGitCommand,
      gitEnvironment: codexAttachmentEnv(),
      project: projectRecord,
      runtime,
      sessionId,
      worktreePath: sessionSourcePath(session)
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
          workdir: sessionSourcePath(currentSession)
        });
        const error = new Error(failure.error);
        error.code = failure.code;
        error.retryable = failure.retryable;
        error.workdir = failure.workdir;
        throw error;
      }
      return operation(currentSession);
    };

    if (!normalizedSessionId) {
      return runOperation(session);
    }

    return runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSessionWithoutSource(normalizedSessionId);
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
        reusePrepared: true,
        project,
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
    const session = await runtime.getSession(sessionId).catch(() => null);
    const failure = codexSessionWorktreeUnavailableFailure({
      session: session || {},
      workdir: normalizeText(error?.workdir)
    });
    return {
      ...failure,
      error: errorMessage(error, failure.error)
    };
  }

  return Object.freeze({
    vibe64SessionContextInput,
    codexAttachmentEnv,
    codexManagedCommandEnv,
    withCodexSessionStartupGate,
    codexProjectTerminalEnv,
    codexProjectTerminalEnvFailureResult
  });
}

export { createCodexSessionEnvironment, codexSessionWorktreeIsUnavailable };
