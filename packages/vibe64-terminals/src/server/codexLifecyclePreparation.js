import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { closeTerminalSessionsForNamespace } from "@local/vibe64-execution/server/terminalSessions";
import { CODEX_APP_SERVER_RUNTIME_BUSY_CODE } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { codexAppServerThreadSettings } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import { cleanupCodexAttachments, releaseCodexSessionAttachments } from "./codexAttachments.js";
import { codexAppServerControlDisabledResult } from "./codexConversationPreparation.js";
import { codexThreadIdForWorkdir, withCodexState } from "./codexConversationStorage.js";
import { codexAgentSettingsFromSession } from "./codexRuntimeHost.js";
import { renewalCleanupContext, renewalArchivedPredecessorContext } from "./sessionRenewalHandover.js";
import { codexTerminalNamespace, terminalSessionSourceRoot, terminalWorktreePath } from "./terminalShared.js";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";

function normalizeText(value) {
  return String(value || "").trim();
}

async function terminalSessionSourceRootForSession(projectService, sessionId) {
  try {
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    const session = await runtime.getSession(sessionId);
    return terminalSessionSourceRoot(session);
  } catch {
    return "";
  }
}

// Authorized application facts and cleanup effects. Native stop/recovery and
// the session-closing map remain with the same supplied shared runtime owner.
function createCodexLifecyclePreparation({
  projectService, runtimeHost, sessionRuntimeHost, sessionEnvironment, providerHost,
  conversationPreparation, helperPreparation, health, runtimeLifecycle, renewalSessionClosures, enabled
}) {
  const { codexAppServerRuntimeOptionsFromSessionMetadata, codexAppServerPersistedRuntimeHost } = runtimeHost;
  const { createRuntimeForSession, codexAppServerRuntimeOptionsForSession, codexAppServerStorageRuntimeOptionsForSession,
    codexAppServerManagedThreadIdentity, sessionHasCodexAppServerRuntime } = sessionRuntimeHost;
  const { codexAttachmentEnv } = sessionEnvironment;
  const { codexAppServerSessionProviderContext } = providerHost;
  const codexConversationPreparation = conversationPreparation;
  const { restoration: prepareCodexAppServerHelperRestoration,
    inventory: prepareCodexAppServerHelperInventory } = helperPreparation;
  const { ready: writeCodexAppServerReady } = health;
  const { sessionClosures: codexAppServerSessionClosures } = runtimeLifecycle;
  const codexAppServerRenewalSessionClosures = renewalSessionClosures;
  const codexAppServerPromptDeliveryEnabled = enabled;

  async function prepareNativeStorageProvider(sessionId, binding, { runtime, session }) {
    if (binding.modelProviderId !== "openai" && !curatedCodexProvider(binding.modelProviderId)) {
      throw new Error("The saved Codex storage provider is unknown.");
    }
    const selectedSession = { ...session, metadata: { ...session.metadata,
      codex_routing_home_provider: binding.modelProviderId } };
    // Control requests neither resume native work nor require archived source.
    const providerOptions = await codexAppServerStorageRuntimeOptionsForSession(selectedSession, {
      runtime, terminalEnv: {}, ...(!runtime.learningScope ? {
        workdir: runtime.projectContextRoot, executionRoot: runtime.projectContextRoot
      } : {})
    });
    providerOptions.routingModelProviderId = binding.modelProviderId;
    return { providerContext: codexAppServerSessionProviderContext(normalizeText(sessionId), providerOptions),
      get toolHomeSource() { return providerOptions.toolHomeSource; } };
  }

  async function prepareCodexAppServerThreadUnsubscription(normalizedSessionId, {
    providerOptions: providedProviderOptions = undefined,
    runtime: providedRuntime = null,
    session: providedSession = null
  } = {}) {
    const runtime = providedRuntime || await createRuntimeForSession();
    const session = providedSession || await runtime.getSession(normalizedSessionId);
    const providerOptions = providedProviderOptions ?? codexAppServerRuntimeOptionsFromSessionMetadata(session);
    const workdir = runtime.learningScope
      ? (await runtime.store.readSessionNativeDescriptor(normalizedSessionId)).nativeExecutionRoot
      : terminalWorktreePath(session);
    if (runtime.learningScope && !session.archived) {
      await learningSessionExecutionRoot(runtime, normalizedSessionId, { allowClosing: true });
    }
    const threadId = codexThreadIdForWorkdir(session, workdir);
    return { providerOptions, workdir, threadId };
  }

  function codexAppServerReconciliationPreparation() {
    return {
      get enabled() { return codexAppServerPromptDeliveryEnabled; },
      get disabledResult() { return codexAppServerControlDisabledResult(); },
      runtimeBusyCode: CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
      failureMessage: "Vibe64 Codex app-server thread reconciliation failed.",
      helperRestoration: runtime => prepareCodexAppServerHelperRestoration({ runtime }),
      helperInventory: prepareCodexAppServerHelperInventory,
      session: prepareCodexAppServerSessionReconciliation
    };
  }

  async function prepareCodexAppServerSessionReconciliation(normalizedSessionId, {
    agentSettings = {}
  } = {}) {
    const context = await codexConversationPreparation.context(normalizedSessionId);
    if (context.ok === false) {
      return { result: context };
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    return {
      context,
      recover: operation => codexConversationPreparation.observationRecovery(runtime, session, operation),
      stopped: withCodexState,
      get thread() {
        return {
          threadId: currentSession => codexThreadIdForWorkdir(currentSession, workdir),
          managedIdentity: codexAppServerManagedThreadIdentity(session, { executionRoot, workdir }),
          providerOptions: currentSession => codexAppServerRuntimeOptionsForSession(currentSession, {
            runtime,
            executionRoot,
            toolHomeSource,
            workdir
          }),
          get resumeOptions() {
            return codexAppServerThreadSettings({
              agentSettings: { ...codexAgentSettingsFromSession(session), ...agentSettings },
              cwd: workdir
            });
          },
          ready: () => writeCodexAppServerReady(runtime, normalizedSessionId, ""),
          readiness: operation => codexConversationPreparation.threadReadiness(normalizedSessionId, { agentSettings }, operation)
        };
      }
    };
  }

  function prepareCodexSessionCleanup(sessionId, options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionKey = codexTerminalNamespace(normalizedSessionId);
    const renewalCleanup = renewalCleanupContext(normalizedSessionId, options);
    const preserveProcessExitProof = Boolean(
      renewalCleanup || options.changeover || options.preserveProcessExitProof === true
    );
    return {
      sessionKey,
      pending: codexAppServerSessionClosures,
      restrictedPending: codexAppServerRenewalSessionClosures,
      restricted: Boolean(renewalCleanup),
      preserveProcessExitProof,
      get changeover() { return options.changeover; },
      get requireStopped() { return Boolean(renewalCleanup || options.changeover); },
      async assertPublicAccess() {
        const publicRuntime = await createRuntimeForSession();
        await publicRuntime.getSession(normalizedSessionId);
      },
      async read() {
        const runtime = renewalCleanup?.runtime || await createRuntimeForSession();
        const session = renewalCleanup?.session || await runtime.getSession(normalizedSessionId);
        const workdir = runtime.learningScope
          ? (await runtime.store.readSessionNativeDescriptor(normalizedSessionId)).nativeExecutionRoot
          : terminalWorktreePath(session);
        if (runtime.learningScope && !session.archived) {
          await learningSessionExecutionRoot(runtime, normalizedSessionId, { allowClosing: true });
        }
        let providerOptions = null;
        return {
          get helpers() { return prepareCodexAppServerHelperRestoration({ runtime, session }); },
          get projectRuntimeRoot() { return runtime.stateRoot; },
          get session() {
            providerOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session);
            return {
              get exists() { return Boolean(session); },
              get providerOptions() { return providerOptions; },
              set providerOptions(value) { providerOptions = value; },
              get threadId() { return codexThreadIdForWorkdir(session, workdir); },
              get unsubscribeParameters() {
                const resolvedOptions = providerOptions ?? codexAppServerRuntimeOptionsFromSessionMetadata(session);
                const threadId = codexThreadIdForWorkdir(session, workdir);
                return { providerOptions: resolvedOptions, workdir, threadId };
              },
              get hasRuntime() { return sessionHasCodexAppServerRuntime(session); },
              get persistedRuntimeHost() {
                return codexAppServerPersistedRuntimeHost(session, providerOptions || {}, {
                  preserveProcessExitProof,
                  verifyOwnerScope: Boolean(renewalCleanup || options.changeover)
                });
              },
              get requiresExitProof() {
                return renewalCleanup || (options.changeover && sessionHasCodexAppServerRuntime(session));
              }
            };
          },
          async complete(exitFailure) {
            if (exitFailure) {
              const error = new Error(
                options.changeover
                  ? "Assistant changeover could not confirm that the previous Codex execution stopped. Try stopping it again."
                  : "Session renewal could not verify that every Codex process exited."
              );
              error.code = options.changeover
                ? "vibe64_changeover_process_exit_unverified"
                : "vibe64_session_renewal_process_exit_unverified";
              error.retryable = true;
              error.details = exitFailure;
              throw error;
            }
            await closeTerminalSessionsForNamespace(codexTerminalNamespace(normalizedSessionId));
            const executionRoot = renewalCleanup
              ? terminalSessionSourceRoot(session)
              : await terminalSessionSourceRootForSession(
                  projectService,
                  normalizedSessionId
                );
            if (executionRoot && !options.changeover && renewalCleanup?.kind !== "predecessor") {
              await cleanupCodexAttachments(executionRoot, normalizedSessionId, "", {
                env: codexAttachmentEnv()
              });
            }
          }
        };
      }
    };
  }

  async function prepareCodexProjectCleanup() {
    if (!codexAppServerPromptDeliveryEnabled) {
      return { value: codexAppServerControlDisabledResult() };
    }
    const runtime = await createRuntimeForSession();
    return {
      get helpers() { return prepareCodexAppServerHelperRestoration({ runtime }); }
    };
  }

  return {
    prepareNativeStorageProvider,
    prepareCodexAppServerThreadUnsubscription,
    codexAppServerReconciliationPreparation,
    prepareCodexAppServerSessionReconciliation,
    prepareCodexSessionCleanup,
    prepareCodexProjectCleanup,
    async releaseRenewalPredecessorAttachments(sessionId, options = {}) {
      const context = renewalArchivedPredecessorContext(sessionId, options);
      const executionRoot = terminalSessionSourceRoot(context.session);
      if (!executionRoot) {
        throw new TypeError(
          "Renewal attachment release requires the archived predecessor source identity."
        );
      }
      return releaseCodexSessionAttachments(executionRoot, sessionId, {
        env: codexAttachmentEnv()
      });
    },

  };
}

export { createCodexLifecyclePreparation };
