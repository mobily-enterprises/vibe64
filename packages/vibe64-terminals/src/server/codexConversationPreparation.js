import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { effectiveVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import {
  codexAppServerThreadPreparationForSession, codexAppServerThreadSettings
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  createMainConversationBinding, readSessionConversationContext, sessionBriefingIsDelivered
} from "./mainConversationBinding.js";
import { codexAppServerAdmissionError, codexAppServerFrozenTurnInterruptResponse } from "./codexSessionProviderHost.js";
import { codexAgentSettingsFromSession } from "./codexRuntimeHost.js";
import {
  codexAppServerTurnState, codexConversationIdForWorkdir, codexThreadIdForWorkdir, withCodexState
} from "./codexConversationStorage.js";
import { terminalWorktreePath } from "./terminalShared.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function codexEffectiveAgentSettings(agentSettings = {}) {
  return effectiveVibe64AgentSettings(agentSettings);
}

function codexAppServerControlDisabledResult() {
  return {
    ok: false,
    error: "Codex app-server control is disabled. Session Codex control has no terminal fallback."
  };
}

// Application preparation only. Existing native owners invoke these phases;
// this facility creates no native owner, queue, retained state or session read.
function createCodexConversationPreparation({
  projectService,
  runtimeHost,
  sessionRuntimeHost,
  accountPreparation,
  sessionEnvironment,
  health,
  unavailableWorktree: blockCodexAppServerForUnavailableWorktree,
  enabled: codexAppServerPromptDeliveryEnabled,
  publishSessionChanged,
  checkpoint: checkpointCodexAppServerTurn
}) {
  const { codexAppServerProviderKey } = runtimeHost;
  const {
    createRuntimeForSession, codexAppServerManagedThreadIdentity,
    codexAppServerRuntimeOptionsForSession
  } = sessionRuntimeHost;
  const { codexToolHomeResult, codexReconnectTerminalFailureForError } = accountPreparation;
  const {
    vibe64SessionContextInput, withCodexSessionStartupGate,
    codexProjectTerminalEnv, codexProjectTerminalEnvFailureResult
  } = sessionEnvironment;
  const {
    running: writeCodexAppServerRunning,
    ready: writeCodexAppServerReady,
    failure: writeCodexAppServerFailure
  } = health;

  function codexGoalCommandContext(sessionId, context) {
    if (context.ok === false) return context;
    return {
      runtime: context.runtime,
      session: context.session,
      provider: context.provider,
      threadId: codexAppServerTurnState(context.session).threadId ||
        codexThreadIdForWorkdir(context.session, context.workdir),
      get providerKey() { return codexAppServerProviderKey(normalizeText(sessionId), context.providerOptions); },
      get resumeOptions() {
        return codexAppServerThreadSettings({
          agentSettings: codexAgentSettingsFromSession(context.session),
          cwd: context.workdir
        });
      }
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

  async function withCodexAppServerObservationRecovery(runtime, session, operation) {
    const sessionId = session.sessionId;
    const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, () => {
      return operation(sessionId, {
        store: runtime.store,
        getSession: id => runtime.getSession(id, { inspectSource: false })
      }, session, {
        threadId: current => codexThreadIdForWorkdir(current, terminalWorktreePath(current)),
        providerOptions: current => codexAppServerRuntimeOptionsForSession(current, { runtime })
      });
    }, { operation: "recover-codex-observation", waitMs: 10_000 });
    return exclusive.acquired ? exclusive.value : session;
  }

  async function codexAppServerSessionContext(sessionId, options = {}) {
    return readSessionConversationContext("codex", projectService, sessionId, options, {
      toolHome: codexToolHomeResult,
      unavailableWorktree: blockCodexAppServerForUnavailableWorktree
    });
  }

  async function prepareCodexSessionReadiness(sessionId) {
    if (!codexAppServerPromptDeliveryEnabled) {
      return { value: await writeCodexAppServerControlDisabledFailure(sessionId) };
    }
    const runtime = await createRuntimeForSession();
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    return {
      session,
      get connection() {
        const workdir = terminalWorktreePath(session);
        const threadId = codexThreadIdForWorkdir(session, workdir);
        return {
          workdir, threadId,
          get available() {
            return !sessionIsClosing(session) && session.status !== VIBE64_SESSION_STATUS.ARCHIVED;
          }
        };
      },
      recovery: operation => withCodexAppServerObservationRecovery(runtime, session, operation),
      stopped(currentSession, turn) {
        return withCodexState({
          ok: true,
          codexAppServerThreadReady: !turn.active,
          codexIdentityReady: true,
          codexThreadReady: !turn.active,
          codexThreadId: turn.threadId,
          observationStopped: !turn.active
        }, currentSession);
      },
      async ready(threadId) {
        await writeCodexAppServerReady(runtime, sessionId, "");
        return withCodexState({
          ok: true,
          codexAppServerThreadReady: true,
          codexIdentityReady: true,
          codexThreadReady: true,
          codexThreadId: threadId,
          codexSessionBriefingDelivered: false,
          terminalSessionId: ""
        }, await runtime.getSession(sessionId, { inspectSource: false }));
      },
      async prepare(operation) {
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, () => (
          withCodexAppServerThreadReadiness(sessionId, {}, operation)
        ), { operation: "prepare-agent-session", waitMs: 10_000 });
        return exclusive.value;
      }
    };
  }

  async function withCodexAppServerThreadReadiness(sessionId, {
    agentSettings = {}
  } = {}, operation) {
    const context = await codexAppServerSessionContext(sessionId);
    if (context.ok === false) {
      return context;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    let healthAttempt = null;
    try {
      const health = await writeCodexAppServerRunning(runtime, sessionId, {
        kind: "app_server_started",
        message: "Preparing Codex app-server for this session."
      });
      healthAttempt = health.healthAttempt;
      const { currentSession, thread, briefingWasDelivered } = await operation(sessionId, context, {
        managedIdentity: codexAppServerManagedThreadIdentity(session, { executionRoot, workdir }),
        threadId: currentSession => codexThreadIdForWorkdir(currentSession, workdir),
        async providerOptions(currentSession) {
          const terminalEnv = await codexProjectTerminalEnv({ runtime, session: currentSession, sessionId });
          return codexAppServerRuntimeOptionsForSession(currentSession, {
            terminalEnv,
            runtime,
            executionRoot,
            toolHomeSource,
            workdir
          });
        },
        gate: operation => withCodexSessionStartupGate({ operation, runtime, session, sessionId }),
        preparation(currentSession) {
          return codexAppServerThreadPreparationForSession({
            agentSettings: { ...codexAgentSettingsFromSession(currentSession), ...agentSettings },
            hostContext: vibe64SessionContextInput(),
            runtime,
            session: currentSession,
            workdir
          });
        },
        async ready(preparedSession) {
          const briefingWasDelivered = !sessionBriefingIsDelivered(preparedSession);
          const deliveredAt = new Date().toISOString();
          if (briefingWasDelivered) {
            await runtime.store.mutateSession(sessionId, async () => {
              await Promise.all([
                runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
                runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered_at", deliveredAt),
                runtime.store.writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server")
              ]);
            });
          }
          await writeCodexAppServerReady(runtime, sessionId, "", {
            healthAttempt
          });
          return { briefingWasDelivered };
        }
      });
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
      const unavailableFailure = await codexProjectTerminalEnvFailureResult(error, {
        runtime,
        sessionId
      });
      if (unavailableFailure) {
        return blockCodexAppServerForUnavailableWorktree(runtime, sessionId, unavailableFailure);
      }
      await writeCodexAppServerFailure(runtime, sessionId, error, {
        healthAttempt
      });
      const reconnectFailure = await codexReconnectTerminalFailureForError(error, {
        reason: "codex-app-server-thread-ready",
        toolHomeSource
      });
      if (reconnectFailure) {
        return reconnectFailure;
      }
      throw error;
    }
  }

  function codexAppServerMessagePreparation(sessionId) {
    return {
      async readContext(options) {
        const context = await codexAppServerSessionContext(sessionId, options);
        if (context.ok === false) return context;
        return { ...context, selection: codexAppServerMessageSelection(context) };
      },
      threadPreparation(input, prepared) {
        const { runtime, session, executionRoot, toolHomeSource, workdir, agentSettings, messageId } = prepared;
        prepared.healthAttempt = null;
        prepared.effectiveSettings = codexEffectiveAgentSettings(agentSettings);
        return {
          gate: operation => withCodexSessionStartupGate({ operation, runtime, session, sessionId }),
          async provider(currentSession) {
            let stageStartedAt = Date.now();
            const terminalEnv = await codexProjectTerminalEnv({
              runtime,
              session: currentSession,
              sessionId
            });
            vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
              durationMs: Date.now() - stageStartedAt,
              messageId,
              sessionId,
              stage: "terminal-env"
            });
            stageStartedAt = Date.now();
            const providerOptions = await codexAppServerRuntimeOptionsForSession(currentSession, {
              terminalEnv,
              runtime,
              executionRoot,
              toolHomeSource,
              workdir
            });
            vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
              durationMs: Date.now() - stageStartedAt,
              messageId,
              sessionId,
              stage: "provider-options"
            });
            return {
              providerOptions,
              get mainThreadId() { return codexThreadIdForWorkdir(currentSession, workdir); }
            };
          },
          async running() {
            const health = await writeCodexAppServerRunning(runtime, sessionId, {
              kind: "app_server_started",
              message: "Connecting to Codex for this session."
            });
            prepared.healthAttempt = health.healthAttempt;
          },
          preparation(currentSession) {
            const conversation = createMainConversationBinding(runtime.store, currentSession.sessionId, {
              runtime, session: currentSession
            }).conversation({ publish: publishSessionChanged, checkpoint: checkpointCodexAppServerTurn });
            return conversation.preparation({ agentSettings, hostContext: vibe64SessionContextInput(), workdir });
          },
          ready: () => writeCodexAppServerReady(runtime, sessionId, "", { healthAttempt: prepared.healthAttempt })
        };
      },
      async finishMessage(input, prepared, outcome) {
        const { runtime } = prepared;
        if (Object.hasOwn(outcome, "error")) {
          const { error } = outcome;
          const unavailableFailure = await codexProjectTerminalEnvFailureResult(error, {
            runtime,
            sessionId
          });
          if (unavailableFailure) {
            return { value: blockCodexAppServerForUnavailableWorktree(runtime, sessionId, unavailableFailure) };
          }
          await writeCodexAppServerFailure(runtime, sessionId, error, {
            healthAttempt: prepared.healthAttempt
          });
          throw error;
        }
      }
    };
  }

  async function readCodexAppServerGoalContext(sessionId, options = {}) {
    const context = await codexAppServerSessionContext(sessionId, options);
    if (context.ok === false) return context;
    return { threadId: codexAppServerTurnState(context.session).threadId ||
      codexThreadIdForWorkdir(context.session, context.workdir) };
  }

  function codexAppServerControlPreparation(sessionId, context) {
    const { runtime, executionRoot, toolHomeSource, workdir } = context;
    return {
      runtime,
      admissionError: () => codexAppServerAdmissionError(sessionId),
      threadId: session => codexThreadIdForWorkdir(session, workdir),
      managedIdentity: currentSession => codexAppServerManagedThreadIdentity(currentSession, {
        executionRoot,
        workdir
      }),
      providerOptions: currentSession => codexAppServerRuntimeOptionsForSession(currentSession, {
        runtime,
        executionRoot,
        toolHomeSource,
        workdir
      })
    };
  }

  function codexAppServerMessageSelection(context) {
    const { runtime, session, executionRoot, toolHomeSource, workdir } = context;
    return {
      runtime,
      session,
      threadId: current => codexThreadIdForWorkdir(current, workdir),
      managedIdentity: currentSession => codexAppServerManagedThreadIdentity(currentSession, { executionRoot, workdir }),
      providerOptions: currentSession => codexAppServerRuntimeOptionsForSession(currentSession, {
        runtime,
        executionRoot,
        toolHomeSource,
        workdir
      })
    };
  }

  function message(sessionId) {
    const messagePreparation = codexAppServerMessagePreparation(sessionId);
    return {
      ...messagePreparation,
      async readContext({ session: _openingSession, ...options } = {}) {
        if (!codexAppServerPromptDeliveryEnabled) return writeCodexAppServerControlDisabledFailure(sessionId);
        return messagePreparation.readContext(options);
      }
    };
  }

  async function control(sessionId, options, input = {}) {
    if (!codexAppServerPromptDeliveryEnabled) return writeCodexAppServerControlDisabledFailure(sessionId);
    if (codexAppServerAdmissionError(sessionId)) return codexAppServerFrozenTurnInterruptResponse({
      threadId: input.threadId || input.codexSessionId, turnId: input.turnId || input.codexTurnId
    });
    const { session: _openingSession, ...currentOptions } = options || {};
    const current = await codexAppServerSessionContext(sessionId, { ...currentOptions, allowClosing: true });
    return current.ok === false ? current : codexAppServerControlPreparation(sessionId, current);
  }

  async function readGoal(sessionId, options) {
    const target = await readCodexAppServerGoalContext(sessionId, options);
    if (options?.canonicalGoal && options.goalOperation === "read") target.completeResult = options.onGoalResult;
    return target;
  }

  function goalContext(sessionId, context, options) {
    const target = codexGoalCommandContext(sessionId, context);
    if (options?.canonicalGoal && options.goalOperation === "update") target.completeResult = options.onGoalResult;
    return target;
  }

  async function inspection(sessionId, input, options) {
    const { session: _openingSession, ...currentOptions } = options || {};
    const current = await codexAppServerSessionContext(sessionId, currentOptions);
    if (current.ok === false) return current;
    const threadId = normalizeText(codexAppServerTurnState(current.session).threadId) ||
      codexThreadIdForWorkdir(current.session, current.workdir);
    if (!input.messageId || !input.threadId || input.threadId !== threadId) {
      return { ok: false, code: "vibe64_codex_thread_mismatch", error: "Admission inspection requires the original assistant thread." };
    }
    return { runtime: current.runtime, session: current.session };
  }

  return {
    context: codexAppServerSessionContext,
    observationRecovery: withCodexAppServerObservationRecovery,
    readiness: prepareCodexSessionReadiness,
    threadReadiness: withCodexAppServerThreadReadiness,
    message,
    control,
    readGoal,
    goalContext,
    inspection,
    disabledFailure: writeCodexAppServerControlDisabledFailure
  };
}

export { createCodexConversationPreparation, codexAppServerControlDisabledResult };
