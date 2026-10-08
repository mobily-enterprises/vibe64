import { codexAppServerAgentRun,
  codexAppServerInterruptUnavailableResponse as nativeCodexAppServerInterruptUnavailableResponse,
  codexAppServerFrozenTurnInterruptResponse as nativeCodexAppServerFrozenTurnInterruptResponse,
} from "@jskit-ai/assistant-core/server/codex-turn";
import { curatedCodexProvider, curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { captureProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { terminalNamespaceAdmissionFailure } from "@local/vibe64-execution/server/terminalSessions";
import { vibe64HostContextEnvironment, vibe64HostContextRegistry, vibe64ConversationInstructions } from "@local/vibe64-genesis/server";
import {
  CODEX_APP_SERVER_EXECUTION_MODES, codexAppServerRuntimeBaseDir, codexAppServerRuntimeHost
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import { codexAppServerThreadSettings } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { agentSessionCommandEnvironmentIsHealthy } from "./agentCommandEnvironment.js";
import { codexThreadIdForWorkdir } from "./codexConversationStorage.js";
import { codexAgentSettingsFromSession } from "./codexRuntimeHost.js";
import { codexTerminalNamespace, terminalWorktreePath } from "./terminalShared.js";
import { subscribeUnixCommandControlChanges } from "./unixJsonCommand.js";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";

function normalizeText(value) {
  return String(value || "").trim();
}

const CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE = "vibe64_codex_turn_interrupt_failed";

function codexAppServerInterruptUnavailableResponse(input = {}) {
  return nativeCodexAppServerInterruptUnavailableResponse(input, CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE);
}

function codexAppServerFrozenThreadDeleteResponse(threadId = "") {
  return {
    deleted: false,
    ok: true,
    status: "notFound",
    threadId: normalizeText(threadId)
  };
}

function codexAppServerFrozenTurnInterruptResponse(input = {}) {
  return nativeCodexAppServerFrozenTurnInterruptResponse(input);
}

function codexAppServerAdmissionError(sessionId = "") {
  const failure = terminalNamespaceAdmissionFailure(
    codexTerminalNamespace(sessionId)
  );
  if (!failure) {
    return null;
  }
  const error = new Error(failure.error || "Codex admission is unavailable.");
  error.code = failure.code || "vibe64_session_renewal_quiesced";
  error.retryable = false;
  return error;
}

function runWithCodexAppServerProjectContext(projectContext = null, operation = async () => null) {
  if (projectContext?.targetRoot || projectContext?.learningScope) {
    return runWithProjectRequestContext(projectContext, operation);
  }
  return operation();
}

// Application account, session and guidance preparation. Native acquisition and
// recovery remain in the supplied existing run/provider owner.
function createCodexSessionProviderHost(host) {
  const { runtimeHost, sessionRuntimeHost, sessionEnvironment, providerConnections, env, logger } = host;
  const { codexAppServerProviderKey, codexAppServerProviderKeyFields } = runtimeHost;
  const { createRuntimeForSession, createStoreForSession } = sessionRuntimeHost;
  const { codexManagedCommandEnv, vibe64SessionContextInput } = sessionEnvironment;
  // host.runOwner is intentionally lazy: this inert facility is constructed
  // before the native owner that will later invoke its preparations.

  async function prepareCodexAppServerSessionProvider(sessionId, options, providerKey, identity) {
    const { learningRuntime, ...nativeOptions } = options;
    const projectContext = captureProjectRequestContext();
    const runtimeRoot = codexAppServerRuntimeBaseDir({ env });
    async function readProviderSession(runtime) {
      if (options.renewalId) {
        const session = await runtime.getSessionForRenewal(sessionId, { inspectSource: false });
        if ([VIBE64_SESSION_STATUS.RENEWAL_PENDING, VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING].includes(session.status)) {
          if (normalizeText(session.metadata?.renewal_id) !== options.renewalId) {
            throw Object.assign(new Error("The assistant belongs to a different renewal reservation."), {
              code: "vibe64_session_renewal_private"
            });
          }
          return session;
        }
      }
      return runtime.getSession(sessionId, { inspectSource: false });
    }
    const hostEnvironment = await vibe64HostContextEnvironment(runtimeRoot);
    return {
      preserveProcessExitProof: options.executionMode !== CODEX_APP_SERVER_EXECUTION_MODES.HELPER,
      owner: {
        sessionKey: codexTerminalNamespace(sessionId), sessionId, projectContext,
        workdir: identity.workdir
      },
      observation: codexAppServerObservation({ sessionId, providerKey, projectContext }),
      resources: host.runOwner.runtimeLifecycle.resources(providerKey),
      get parameters() {
        return {
          ...nativeOptions,
          terminalEnv: { ...options.terminalEnv, ...hostEnvironment },
          logger,
          readInstructions: async (params, threadId) => {
            // Scoped consumers supply the current prompt on start/resume. Reading
            // the provider's construction options here would restore an old prompt
            // during an unrelated control check after their catalogue changes.
            if (options.assistantScope) return undefined;
            if (await learningSessionExecutionRoot(learningRuntime, sessionId)) {
              return learningRuntime.getLearningInstructions(sessionId);
            }
            const registry = await vibe64HostContextRegistry(runtimeRoot);
            const binding = params.hostContext
              ? { promptContext: params.hostContext, workdir: params.cwd }
              : registry.get(threadId);
            return binding ? vibe64ConversationInstructions(binding) : undefined;
          },
          bindThreadContext: async (threadId, hostContext, params) => {
            if (await learningSessionExecutionRoot(learningRuntime, sessionId)) return;
            const registry = await vibe64HostContextRegistry(runtimeRoot);
            await registry.register(threadId, hostContext, params.cwd);
          },
          prepareAuth: (requestedProvider) => runWithCodexAppServerProjectContext(projectContext, async () => {
            if (curatedCodexProvider(requestedProvider)) {
              await providerConnections.threadConfig(requestedProvider);
              return "external";
            }
            if (options.assistantScope) return "native";
            const runtime = await createRuntimeForSession();
            const session = await readProviderSession(runtime);
            const selection = vibe64AssistantSelectionFromMetadata(session.metadata, { required: false });
            if (session.metadata?.codex_routing_home_provider && curatedCodexProvider(selection?.modelProviderId)) {
              await providerConnections.runtimeOptions(selection.modelProviderId);
              return "external";
            }
            return "native";
          }),
          prepareThreadParams: async (params) => {
            const modelProvider = params.modelProvider || curatedCodexModel(params.model)?.modelProviderId || "openai";
            return { ...params, modelProvider, config: { ...params.config, ...await providerConnections.threadConfig(modelProvider) } };
          },
          prepareThreadEnvironment: (threadEnv) => runWithCodexAppServerProjectContext(projectContext, async () => {
            host.runOwner.runtimeLifecycle.assertOpen();
            if (host.runOwner.runtimeLifecycle.sessionClosures.has(codexTerminalNamespace(sessionId))) {
              throw new Error("The assistant session is closing.");
            }
            const admissionError = codexAppServerAdmissionError(sessionId);
            if (admissionError) throw admissionError;
            if (options.assistantScope) return threadEnv;
            if (await agentSessionCommandEnvironmentIsHealthy(threadEnv)) return threadEnv;
            const runtime = await createRuntimeForSession();
            const session = await readProviderSession(runtime);
            if (sessionIsClosing(session) || session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
              throw new Error("The assistant session is closing.");
            }
            const current = { ...threadEnv, ...await codexManagedCommandEnv({ runtime, session, sessionId }) };
            if (!await agentSessionCommandEnvironmentIsHealthy(current)) {
              throw new Error("The assistant's current tool connections did not pass their health checks.");
            }
            return current;
          }),
        };
      },
      async prepareResumeGuard() {
        if (host.runOwner.runtimeLifecycle.sessionClosures.has(codexTerminalNamespace(sessionId))) {
          throw new Error("The assistant session is closing.");
        }
        if (options.assistantScope) return null;
        // Renewal owns a hidden successor before its first handover turn.
        // Keep the normal high-frequency read bounded; only that exact
        // reservation uses its internal snapshot for the observation guard.
        const session = options.renewalId ? await readProviderSession(await createRuntimeForSession()) : null;
        const run = session
          ? codexAppServerAgentRun(session)
          : await host.runOwner.readAgentRunForSession(await createStoreForSession(sessionId), sessionId);
        return { run };
      },
      async prepareResume(threadId, params) {
        host.runOwner.runtimeLifecycle.assertOpen();
        if (options.assistantScope) return null;
        const runtime = await createRuntimeForSession();
        const session = await readProviderSession(runtime);
        if (sessionIsClosing(session) || session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
          throw new Error("The assistant session is closing.");
        }
        const learningRoot = await learningSessionExecutionRoot(runtime, sessionId);
        if (learningRoot && normalizeText(params.cwd) && normalizeText(params.cwd) !== learningRoot) {
          throw new Error("The learning thread belongs to a different native execution root.");
        }
        const workdir = learningRoot || normalizeText(params.cwd || options.workdir) || terminalWorktreePath(session);
        if (!learningRoot) {
          const registry = await vibe64HostContextRegistry(runtimeRoot);
          await registry.register(
          threadId,
          vibe64SessionContextInput(threadId === codexThreadIdForWorkdir(session, workdir) ? "main" : "temporary"),
          workdir
          );
        }
        const agentSettings = codexAgentSettingsFromSession(session);
        return {
          workdir,
          get settings() {
            return codexAppServerThreadSettings({ agentSettings, cwd: workdir });
          }
        };
      },
      runInContext: operation => runWithCodexAppServerProjectContext(projectContext, operation),
      controls: {
        subscribe: subscribeUnixCommandControlChanges,
        get available() {
          return !host.runOwner.runtimeLifecycle.closing &&
            !host.runOwner.runtimeLifecycle.sessionClosures.has(codexTerminalNamespace(sessionId));
        }
      }
    };
  }

  function codexAppServerSessionProviderContext(sessionId, options) {
    return {
      sessionId,
      providerOptions: options,
      get providerKey() { return codexAppServerProviderKey(sessionId, options); },
      keyFields: codexAppServerProviderKeyFields,
      assertAdmission() {
        const error = codexAppServerAdmissionError(sessionId);
        if (error) throw error;
      },
      prepare: (providerKey, identity) =>
        prepareCodexAppServerSessionProvider(sessionId, options, providerKey, identity),
      get closing() { return host.runOwner.runtimeLifecycle.closing; },
      runOwner: host.runOwner,
      get runtimeHost() {
        return codexAppServerRuntimeHost({ ...options, preserveProcessExitProof: false });
      }
    };
  }

  function codexAppServerRecoveryEvent(owner, event, error) {
    const sessionId = owner.sessionId;
    if (event === "lost") {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.codex_observation", event: "vibe64.codex_observation.lost",
        sessionId, code: error.code, error: error.message, cause: error.cause?.message || ""
      }, "Codex observation was lost; verifying that work stops.");
    } else if (event === "stopFailed") {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.codex_observation", event: "vibe64.codex_observation.stop_failed",
        sessionId, code: error.code, error: error.message, cause: error.cause?.message || ""
      }, "Codex stop remains unconfirmed; connection checks will retry.");
    }
    if (event !== "lost") {
      vibe64SessionDebugLog(`server.codexTerminal.observation.${event}`, {
        sessionId, error: vibe64SessionDebugError(error)
      });
    }
  }

  function codexAppServerObservation({ sessionId, providerKey, projectContext }) {
    let recovery;
    function target(error) {
      if (recovery?.error !== error) {
        const controlFailure = error.cause?.code === "vibe64_agent_control_recovery_failed";
        recovery = {
          error,
          ...host.runOwner.runtimeLifecycle.managedSession(providerKey),
          message: controlFailure ? error.message
            : "Codex observation was lost. Work is stopped; use Resume or Send to continue.",
          pendingMessage: controlFailure ? "Assistant tool recovery is waiting for a verified stop."
            : "Codex observation was lost. A stop is not yet confirmed."
        };
      }
      return recovery;
    }
    return host.runOwner.createObservation(sessionId, {
      projectContext,
      providerKey,
      target
    });
  }

  function codexAppServerConnectionPolicy(sessionId, connection) {
    const sessionKey = codexTerminalNamespace(sessionId);
    return {
      assertCurrent(session = null) {
        host.runOwner.runtimeLifecycle.assertOpen();
        if (
          host.runOwner.runtimeLifecycle.sessionClosures.has(sessionKey) || !connection.current ||
          (session && (sessionIsClosing(session) || session.status === VIBE64_SESSION_STATUS.ARCHIVED ||
            codexThreadIdForWorkdir(session, connection.workdir) !== connection.threadId))
        ) {
          throw Object.assign(new Error("The assistant session changed while its connection was being checked."), {
            code: "vibe64_agent_session_changed",
            retryable: true
          });
        }
      },
      async readSession() {
        // A status request may outlive closure or renewal. Never attach its late
        // result to a removed/replaced session or reconnect a stopped provider.
        host.runOwner.runtimeLifecycle.assertOpen();
        const admissionError = codexAppServerAdmissionError(sessionId);
        if (admissionError) {
          throw admissionError;
        }
        const runtime = await createRuntimeForSession();
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        return session;
      }
    };
  }

  return {
    codexAppServerSessionProviderContext,
    codexAppServerConnectionPolicy,
    codexAppServerRecoveryEvent,
    codexAppServerObservation
  };
}

export {
  CODEX_AGENT_TURN_INTERRUPT_FAILED_CODE,
  codexAppServerInterruptUnavailableResponse,
  codexAppServerFrozenThreadDeleteResponse,
  codexAppServerFrozenTurnInterruptResponse,
  createCodexSessionProviderHost, codexAppServerAdmissionError, runWithCodexAppServerProjectContext
};
