import { CODEX_APP_SERVER_PROVIDER_ID } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { codexTerminalNamespace } from "./terminalShared.js";

function normalizeText(value) {
  return String(value || "").trim();
}

const CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS = 180_000;
const CODEX_APP_SERVER_MODEL_CATALOG_CACHE_MS = 30_000;
const CODEX_APP_SERVER_MODEL_CATALOG_TIMEOUT_MS = 30_000;

function codexAppServerModelCatalogDeadlineError(timeoutMs = 0) {
  const error = new Error("Codex model discovery exceeded the low-cost workload deadline.");
  error.code = "vibe64_codex_model_catalog_timeout";
  error.retryable = true;
  error.details = {
    retryable: true,
    timeoutMs
  };
  return error;
}

async function withCodexAppServerModelCatalogDeadline(operation, {
  signal = null,
  timeoutMs = CODEX_APP_SERVER_MODEL_CATALOG_TIMEOUT_MS
} = {}) {
  const boundedTimeoutMs = Number.isSafeInteger(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS)
    : CODEX_APP_SERVER_MODEL_CATALOG_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted === true) {
    abortFromCaller();
  } else {
    signal?.addEventListener?.("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(codexAppServerModelCatalogDeadlineError(boundedTimeoutMs));
  }, boundedTimeoutMs);
  const aborted = new Promise((resolve, reject) => {
    void resolve;
    const rejectAborted = () => {
      reject(timedOut
        ? codexAppServerModelCatalogDeadlineError(boundedTimeoutMs)
        : controller.signal.reason || new Error("Codex model discovery was cancelled."));
    };
    if (controller.signal.aborted) {
      rejectAborted();
      return;
    }
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      aborted
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortFromCaller);
  }
}

// Application discovery budgets and authorized account/runtime preparation.
// Native catalogue caching, provider reuse and cleanup stay in the existing owner.
function createCodexAssistantCatalog({
  accountPreparation, runtimeHost, sessionRuntimeHost, conversationPreparation, helperPreparation,
  providerOwner, runOwner, providerFactory, enabled
}) {
  const { codexToolHomeResult } = accountPreparation;
  const { codexAppServerRuntimeOptions } = runtimeHost;
  const codexAppServerProviderOwner = providerOwner;
  const { resources: codexAppServerProviderResources } = runOwner.runtimeLifecycle;
  const codexAppServerProviderFactory = providerFactory;

  const { codexAppServerHelperRuntimeOptionsForSession } = sessionRuntimeHost;
  const codexConversationPreparation = conversationPreparation;
  const { restoration: prepareCodexAppServerHelperRestoration } = helperPreparation;
  const codexAppServerRunOwner = runOwner;
  const codexAppServerPromptDeliveryEnabled = enabled;

  async function codexAppServerExecutionProfileModelCatalog(sessionId = "", {
    assistantScope = null,
    agentSettings = {},
    runtime: resolvedRuntime = null,
    session: resolvedSession = null,
    signal = null
  } = {}) {
    if (!codexAppServerPromptDeliveryEnabled) {
      const error = new Error("Codex background work is disabled.");
      error.code = "vibe64_codex_control_disabled";
      throw error;
    }
    const context = assistantScope
      ? await codexAppServerRunOwner.readExecutionProfileModelCatalog(sessionId, { assistantScope, agentSettings, signal })
      : await codexConversationPreparation.context(sessionId, { runtime: resolvedRuntime, session: resolvedSession });
    if (context.ok === false) {
      const error = new Error(normalizeText(context.error) || "Codex session is unavailable.");
      Object.assign(error, context);
      throw error;
    }
    if (assistantScope) return context;
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    return codexAppServerRunOwner.readExecutionProfileModelCatalog(sessionId, {
      assistantScope,
      get provider() { return context.provider; },
      get helperRestoration() {
        return prepareCodexAppServerHelperRestoration({ runtime, session });
      },
      get providerOptions() {
        return codexAppServerHelperRuntimeOptionsForSession(session, {
          runtime,
          executionRoot,
          toolHomeSource,
          workdir
        });
      },
      signal
    });
  }

  async function describeCodexAppServerProvider(sessionId = "", {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    const context = await codexConversationPreparation.context(sessionId, {
      runtime: resolvedRuntime,
      session: resolvedSession
    });
    if (context.ok === false) {
      const error = new Error(normalizeText(context.error) || "Codex session is unavailable.");
      Object.assign(error, context);
      throw error;
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    const accountIdentitySignature = await codexAppServerRunOwner.readProviderAccountIdentity(sessionId, {
      get helperRestoration() {
        return prepareCodexAppServerHelperRestoration({ runtime, session });
      },
      get providerOptions() {
        return codexAppServerHelperRuntimeOptionsForSession(session, {
          executionRoot,
          runtime,
          toolHomeSource,
          workdir
        });
      }
    });
    return Object.freeze({
      accountIdentitySignature,
      providerId: "codex",
      transportId: CODEX_APP_SERVER_PROVIDER_ID
    });
  }

  return {
    describeProvider: describeCodexAppServerProvider,

    executionProfileModelCatalog(sessionId, options = {}) {
      return withCodexAppServerModelCatalogDeadline(
        (signal) => codexAppServerExecutionProfileModelCatalog(sessionId, {
          assistantScope: options.assistantScope,
          agentSettings: options.agentSettings,
          runtime: options.runtime,
          session: options.session,
          signal
        }),
        options
      );
    },

    async readPlanUsage(sessionId) {
      return codexAppServerProviderOwner.readPlanUsage(codexTerminalNamespace(sessionId));
    },

    modelCatalog(options = {}) {
      return withCodexAppServerModelCatalogDeadline((signal) => (
        codexAppServerProviderOwner.readModelCatalog({
          cacheMs: CODEX_APP_SERVER_MODEL_CATALOG_CACHE_MS,
          async prepareProviderOptions() {
            const toolHome = await codexToolHomeResult();
            if (toolHome.ok === false) throw new Error(toolHome.error);
            return codexAppServerRuntimeOptions({
              toolHomeSource: toolHome.toolHomeSource
            });
          },
          providerFactory: codexAppServerProviderFactory,
          resources: codexAppServerProviderResources(),
          signal
        })
      ), options);
    }
  };
}

export { createCodexAssistantCatalog, withCodexAppServerModelCatalogDeadline };
