import { readCodexSelectedAccountAccess } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { mkdir } from "node:fs/promises";
import { curatedCodexProvider, curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { CODEX_RECONNECT_REQUIRED_CODE, CODEX_RECONNECT_REQUIRED_MESSAGE } from "@local/vibe64-core/shared";
import { markCodexReconnectRequired } from "@local/vibe64-core/server/codexAuthState";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { directoryExists, retryableTerminalFailure } from "./terminalShared.js";
import { errorMessage } from "./codexStartupHealth.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function codexReconnectTerminalFailure(error = null) {
  if (error?.code !== CODEX_RECONNECT_REQUIRED_CODE) {
    return null;
  }
  return retryableTerminalFailure({
    code: CODEX_RECONNECT_REQUIRED_CODE,
    errors: [
      {
        code: CODEX_RECONNECT_REQUIRED_CODE,
        message: CODEX_RECONNECT_REQUIRED_MESSAGE
      }
    ],
    ok: false,
    error: CODEX_RECONNECT_REQUIRED_MESSAGE
  });
}

function createCodexAccountPreparation({
  runtimeHost,
  providerConnections,
  codexToolHomeRequired,
  codexAuthPreflight,
  codexToolHomeSource,
  codexAppServerProviderOptions
}) {
  const { resolvedCodexToolHomeSource, codexRuntimeForTerminalEnv } = runtimeHost;

  async function rememberCodexReconnectRequired({
    reason = "codex-terminal",
    toolHomeSource = ""
  } = {}) {
    const systemRoot = normalizeText(codexRuntimeForTerminalEnv({ toolHomeSource }).providerOptions.systemRoot);
    if (!systemRoot) {
      return;
    }
    try {
      await markCodexReconnectRequired(systemRoot, {
        reason
      });
    } catch (error) {
      vibe64SessionDebugLog("server.terminals.codex.reconnect_marker.error", {
        error: vibe64SessionDebugError(error),
        reason
      });
    }
  }

  async function codexReconnectTerminalFailureForError(error = null, {
    reason = "codex-terminal",
    toolHomeSource = ""
  } = {}) {
    const reconnectFailure = codexReconnectTerminalFailure(error);
    if (!reconnectFailure) {
      return null;
    }
    await rememberCodexReconnectRequired({
      reason,
      toolHomeSource
    });
    return reconnectFailure;
  }

  async function codexToolHomeResult(session = {}) {
    const selection = vibe64AssistantSelectionFromMetadata(session?.metadata || {}, { required: false });
    const providerId = session?.metadata?.codex_routing_home_provider || selection?.modelProviderId || curatedCodexModel(session?.agentSettings?.model)?.modelProviderId;
    if (curatedCodexProvider(providerId)) {
      const options = await providerConnections.runtimeOptions(providerId);
      return { ok: true, toolHomeSource: options.toolHomeSource };
    }
    const toolHomeSource = resolvedCodexToolHomeSource();
    if (!toolHomeSource) {
      return codexToolHomeRequired
        ? retryableTerminalFailure({
            ok: false,
            error: "Codex account storage is not available. Connect Codex before starting a Codex terminal."
          })
        : {
            ok: true,
            toolHomeSource: ""
          };
    }
    if (codexToolHomeRequired && !await directoryExists(toolHomeSource)) {
      if (session.metadata?.codex_routing_home_provider && curatedCodexProvider(selection?.modelProviderId)) {
        await providerConnections.threadConfig(selection.modelProviderId);
        await mkdir(toolHomeSource, { recursive: true, mode: 0o700 });
        return { ok: true, toolHomeSource };
      }
      return retryableTerminalFailure({
        ok: false,
        error: "Codex is not ready for terminals. Connect Codex before continuing."
      });
    }
    return {
      ok: true,
      toolHomeSource
    };
  }

  async function codexAuthPreflightFailure({
    reason = "codex-terminal",
    terminalEnv = {},
    toolHomeSource = ""
  } = {}) {
    if (typeof codexAuthPreflight !== "function") {
      return null;
    }
    try {
      const runtimeContext = codexRuntimeForTerminalEnv({ terminalEnv, toolHomeSource });
      if (runtimeContext.providerOptions.modelProviderId) return null;
      await codexAuthPreflight({
        ...runtimeContext.providerOptions,
        terminalEnv,
        toolHomeSource
      }, {
        reason
      });
      return null;
    } catch (error) {
      const reconnectFailure = await codexReconnectTerminalFailureForError(error, {
        reason,
        toolHomeSource
      });
      if (reconnectFailure) {
        return reconnectFailure;
      }
      return retryableTerminalFailure({
        code: error?.code || "",
        errors: Array.isArray(error?.errors) ? error.errors : undefined,
        ok: false,
        error: `Codex authentication could not be checked: ${errorMessage(error)}`
      });
    }
  }

  async function codexAppServerAssistantAccess() {
    return readCodexSelectedAccountAccess({ toolHomeSource: codexToolHomeSource,
      systemRoot: codexAppServerProviderOptions.systemRoot });
  }

  return {
    assistantAccess: codexAppServerAssistantAccess,
    codexToolHomeResult, codexReconnectTerminalFailureForError, codexAuthPreflightFailure
  };
}

export { createCodexAccountPreparation };
