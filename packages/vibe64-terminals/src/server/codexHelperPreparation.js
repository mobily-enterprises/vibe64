import { CODEX_APP_SERVER_EXECUTION_MODES } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { captureProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { codexTerminalNamespace, terminalSessionSourceRoot, terminalWorktreePath } from "./terminalShared.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function createCodexHelperPreparation({ runtimeHost, sessionRuntimeHost, accountPreparation, providerHost, runOwner }) {
  const { codexAppServerProviderKey, codexAppServerProviderKeyFields } = runtimeHost;
  const { createRuntimeForSession, codexAppServerHelperRuntimeOptionsForSession } = sessionRuntimeHost;
  const { codexToolHomeResult } = accountPreparation;
  const { codexAppServerSessionProviderContext, codexAppServerObservation } = providerHost;
  const {
    assertOpen: assertCodexAppServerControllerOpen,
    resources: codexAppServerProviderResources
  } = runOwner.runtimeLifecycle;
  const { ownershipError: codexAppServerHelperOwnershipError } = runOwner.helperThreads;

  function prepareCodexAppServerHelperThreadRestore(record = {}, {
    ledger = null,
    runtime = null,
    session = null
  } = {}) {
    const projectRuntimeRoot = normalizeText(runtime?.stateRoot);
    if (
      !projectRuntimeRoot ||
      record.projectRuntimeRoot !== projectRuntimeRoot ||
      normalizeText(session?.sessionId || session?.id) !== record.sessionId ||
      normalizeText(runtime?.projectContextRoot) !== record.projectContextRoot ||
      terminalWorktreePath(session) !== record.workdir
    ) {
      throw codexAppServerHelperOwnershipError(
        "Persisted Codex helper ownership does not match the current project session.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    return {
      ledger,
      get retiring() {
        return session.status === VIBE64_SESSION_STATUS.ARCHIVED || sessionIsClosing(session);
      },
      async prepareProvider() {
        const toolHome = await codexToolHomeResult(session);
        if (toolHome.ok === false) {
          throw codexAppServerHelperOwnershipError(toolHome.error, {
            sessionId: record.sessionId,
            threadId: record.threadId
          });
        }
        const providerOptions = await codexAppServerHelperRuntimeOptionsForSession(session, {
          runtime,
          executionRoot: terminalSessionSourceRoot(session),
          toolHomeSource: toolHome.toolHomeSource,
          workdir: record.workdir
        });
        const providerKey = codexAppServerProviderKey(record.sessionId, providerOptions);
        return {
          providerOptions,
          providerKey,
          get restoreProvider() {
            assertCodexAppServerControllerOpen();
            const projectContext = captureProjectRequestContext();
            return {
              preserveProcessExitProof: providerOptions.executionMode !== CODEX_APP_SERVER_EXECUTION_MODES.HELPER,
              owner: {
                sessionKey: codexTerminalNamespace(record.sessionId), sessionId: record.sessionId, projectContext,
                workdir: codexAppServerProviderKeyFields(providerKey).workdir
              },
              observation: codexAppServerObservation({ sessionId: record.sessionId, providerKey, projectContext }),
              resources: codexAppServerProviderResources(providerKey)
            };
          }
        };
      }
    };
  }

  async function prepareCodexAppServerHelperRestoration({
    runtime = null,
    session = null,
    sessionId = ""
  } = {}) {
    const effectiveRuntime = runtime || await createRuntimeForSession();
    const projectRuntimeRoot = normalizeText(effectiveRuntime?.stateRoot);
    if (!projectRuntimeRoot) {
      throw codexAppServerHelperOwnershipError(
        "Vibe64 project runtime state is unavailable for Codex helper ownership."
      );
    }
    return { projectRuntimeRoot, context: {
      get sessionId() { return sessionId || session?.sessionId || session?.id; },
      async prepareRecord(record, ledger) {
        const currentSession = normalizeText(session?.sessionId || session?.id) === record.sessionId
          ? session
          : await effectiveRuntime.getSession(record.sessionId, { inspectSource: false });
        return prepareCodexAppServerHelperThreadRestore(record, {
          ledger,
          runtime: effectiveRuntime,
          session: currentSession
        });
      },
      async publish({ records, failed, retiredBySession, normalizedSessionId }) {
        const sessionIds = new Set(records.map((record) => record.sessionId));
        if (normalizedSessionId) {
          sessionIds.add(normalizedSessionId);
        }
        for (const id of sessionIds) {
          const failures = failed.filter((failure) => !failure.sessionId || failure.sessionId === id);
          const retired = retiredBySession.get(id) || [];
          if (!failures.length && !retired.length) {
            continue;
          }
          const status = failures.length ? "failed" : "ready";
          const message = failures.length
            ? `${failures.length} helper cleanup record(s) still need attention: ${failures[0].error}`
            : `Cleaned up ${retired.length} stale helper ownership record(s).`;
          await effectiveRuntime.store.writeBackgroundTaskEvent(id, "codex-helper-cleanup", {
            event: {
              kind: "cleanup-reconciled",
              message,
              status,
              failed: failures,
              retiredThreadIds: retired
            },
            patch: {
              label: "Low-cost assistant cleanup",
              message,
              error: failures[0]?.error || "",
              code: failures[0]?.code || "",
              details: { failed: failures },
              status,
              retryable: failures.some((failure) => failure.retryable !== false)
            }
          });
        }
      }
    } };
  }

  function prepareCodexAppServerHelperInventory({
    runtime = null,
    session = null
  } = {}) {
    const sessionId = normalizeText(session?.sessionId || session?.id);
    const projectRuntimeRoot = normalizeText(runtime?.stateRoot);
    if (!sessionId || !projectRuntimeRoot) {
      throw codexAppServerHelperOwnershipError(
        "Vibe64 cannot inventory helper threads without project/session ownership."
      );
    }
    return {
      sessionId,
      projectRuntimeRoot,
      async prepareProvider() {
        const executionRoot = terminalSessionSourceRoot(session);
        const workdir = terminalWorktreePath(session);
        const toolHome = await codexToolHomeResult(session);
        if (toolHome.ok === false) {
          throw codexAppServerHelperOwnershipError(toolHome.error, { sessionId });
        }
        const providerOptions = await codexAppServerHelperRuntimeOptionsForSession(session, {
          executionRoot,
          runtime,
          toolHomeSource: toolHome.toolHomeSource,
          workdir
        });
        const providerKey = codexAppServerProviderKey(sessionId, providerOptions);
        return {
          providerOptions,
          providerKey,
          get sessionContext() { return codexAppServerSessionProviderContext(sessionId, providerOptions); }
        };
      }
    };
  }

  return {
    restoration: prepareCodexAppServerHelperRestoration,
    inventory: prepareCodexAppServerHelperInventory,
    ownershipError: codexAppServerHelperOwnershipError
  };
}

export { createCodexHelperPreparation };
