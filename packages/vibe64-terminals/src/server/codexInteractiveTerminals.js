import {
  activeGlobalCodexTerminal, codexAppTerminalOwnerMetadata, codexTerminalArgs,
  createCodexGatewayTerminal, MAX_OPEN_CODEX_TERMINALS
} from "./codexTerminalAccess.js";
import {
  closeTerminalSession, readTerminalSession, resizeTerminalSession,
  subscribeTerminalSession, terminalNamespaceAdmissionFailure, writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";
import {
  codexSessionWorktreeUnavailableFailure, codexSessionWorkdirAllowed,
  codexTerminalNamespace, directoryExists, ensureTerminalSessionSourceGitSelfContained,
  globalCodexTerminalNamespace, retryableTerminalFailure, terminalSessionSourceRoot,
  terminalWorktreePath, vibe64Result
} from "./terminalShared.js";
import { codexAppServerEndpointForTarget } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { codexAgentSettingsFromSession } from "./codexRuntimeHost.js";
import { codexSessionWorktreeIsUnavailable } from "./codexSessionEnvironment.js";
import { codexConversationIdForWorkdir, codexThreadIdForWorkdir, withCodexState } from "./codexConversationStorage.js";
import { cleanupCodexAttachments, prepareCodexAttachmentRoot } from "./codexAttachments.js";
import { executionEnvFingerprint, loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { recordSessionGitCommandActor } from "./sessionGitCommandActor.js";
import { errorMessage } from "./codexStartupHealth.js";

const GLOBAL_CODEX_TERMINAL_SCOPE = "global";
const CODEX_VISIBLE_TERMINAL_DETACHED_IDLE_TIMEOUT_MS = 5_000;
const CODEX_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH = 4 * 1024 * 1024;

function normalizeText(value) {
  return String(value || "").trim();
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

function codexRemoteEndpointForWorkdir(session = {}, workdir = "") {
  if (!codexThreadIdForWorkdir(session, workdir)) {
    return "";
  }
  const metadata = session.metadata || {};
  const endpoint = normalizeText(metadata.agent_transport_endpoint);
  return endpoint ? codexAppServerEndpointForTarget(endpoint) : "";
}

function createCodexInteractiveTerminals({
  env,
  projectService,
  runCommand,
  runtimeHost,
  sessionRuntimeHost,
  accountPreparation,
  sessionEnvironment,
  runOwner: codexAppServerRunOwner,
  withThreadReadiness: withCodexAppServerThreadReadiness,
  unavailableWorktree: blockCodexAppServerForUnavailableWorktree
}) {
  const { codexRuntimeForTerminalEnv } = runtimeHost;
  const {
    createRuntimeForSession,
    codexAppServerManagedThreadIdentity,
    codexAppServerRuntimeOptionsForSession
  } = sessionRuntimeHost;
  const {
    codexToolHomeResult,
    codexReconnectTerminalFailureForError,
    codexAuthPreflightFailure
  } = accountPreparation;
  const {
    codexAttachmentEnv,
    withCodexSessionStartupGate,
    codexProjectTerminalEnv,
    codexProjectTerminalEnvFailureResult
  } = sessionEnvironment;
  const startCodexGatewayTerminal = createCodexGatewayTerminal(runCommand);

  async function codexAppServerRuntimeForVisibleTerminal(sessionId = "", threadId = "", options = {}) {
    if (!normalizeText(threadId)) {
      return null;
    }
    const runtime = options.runtime || await createRuntimeForSession();
    const session = options.session || await runtime.getSession(sessionId);
    return codexAppServerRunOwner.runtimeForVisibleTerminal(sessionId, session, options,
      codexAppServerManagedThreadIdentity(session, options),
      () => codexAppServerRuntimeOptionsForSession(session, { ...options, runtime }));
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
    const toolHome = await codexToolHomeResult(session);
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
    const toolHome = await codexToolHomeResult(session);
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

  async function ensureCodexAppServerThreadReady(sessionId, options = {}) {
    return withCodexAppServerThreadReadiness(sessionId, options, codexAppServerRunOwner.ensureThreadReady);
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

  return Object.freeze({
    startTerminal: startCodexAppServerTerminal,
    closeGlobalTerminal(terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: globalCodexTerminalNamespace()
      });
    },
    async closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: codexTerminalNamespace(sessionId)
      });
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
    },
  });
}

export { codexRemoteEndpointForWorkdir, createCodexInteractiveTerminals };
