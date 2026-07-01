import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  VIBE64_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64CodexTerminalPath,
  vibe64CommandTerminalPath,
  vibe64FixCodexTerminalPath,
  vibe64GlobalCodexTerminalPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64RealtimeOriginPayload
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  isVibe64StaleOperation,
  vibe64StaleOperationResult
} from "@/lib/vibe64StaleOperation.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const TERMINAL_COMMAND_TRACE_OPTIONS = Object.freeze({
  env: {
    VIBE64_SESSION_DEBUG: "1"
  }
});

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedId(value = "") {
  return String(value || "").trim();
}

function commandMissingResponse(message) {
  return {
    error: message,
    ok: false
  };
}

function terminalCommandTraceLog(event = "", details = {}) {
  return vibe64SessionDebugLog(event, details, TERMINAL_COMMAND_TRACE_OPTIONS);
}

function sortedDebugKeys(value = {}) {
  return Object.keys(plainObject(value)).sort((left, right) => left.localeCompare(right));
}

function useProvidedPath(providedPath, fallback) {
  return computed(() => String(readRefOrGetterValue(providedPath) || fallback() || ""));
}

function useVibe64TerminalCommands({
  sessionsApiPath: providedSessionsApiPath = null,
  vibe64ApiPath: providedVibe64ApiPath = null
} = {}) {
  const paths = usePaths();
  const sessionsApiPath = useProvidedPath(providedSessionsApiPath, () => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const vibe64ApiPath = useProvidedPath(providedVibe64ApiPath, () => paths.api(VIBE64_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: String(context.path || "")
    }),
    buildRawPayload: (_model, { context }) => plainObject(context.payload),
    fallbackRunError: "Terminal failed to start.",
    messages: {
      error: "Terminal failed to start."
    },
    onRunError: async (error) => {
      if (isVibe64StaleOperation(error)) {
        throw vibe64StaleOperationResult(error);
      }
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.terminal.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: String(context.path || "")
    }),
    fallbackRunError: "Terminal could not close.",
    messages: {
      error: "Terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.terminal.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  async function runStart(path, payload = {}, trace = {}) {
    terminalCommandTraceLog("client.projectConfigTrace.terminalCommands.runStart.start", {
      path,
      payloadKeys: sortedDebugKeys(payload),
      payloadOrigin: payload?.origin || null,
      ...trace
    });
    try {
      const response = await startTerminalCommand.run({
        path,
        payload
      });
      terminalCommandTraceLog("client.projectConfigTrace.terminalCommands.runStart.done", {
        ok: response?.ok === true,
        operationOutcome: String(response?.operationOutcome || ""),
        path,
        responseCode: String(response?.code || response?.errors?.[0]?.code || ""),
        ...trace
      });
      return response;
    } catch (error) {
      terminalCommandTraceLog("client.projectConfigTrace.terminalCommands.runStart.error", {
        error: vibe64SessionDebugError(error),
        path,
        ...trace
      });
      throw error;
    }
  }

  async function runClose(path) {
    return await closeTerminalCommand.run({
      path
    });
  }

  async function startCodexTerminal(sessionId = "") {
    const normalizedSessionId = normalizedId(sessionId);
    if (!normalizedSessionId) {
      return commandMissingResponse("Vibe64 session id is required.");
    }
    return await runStart(
      vibe64CodexTerminalPath(sessionsApiPath.value, normalizedSessionId),
      vibe64RealtimeOriginPayload(),
      {
        sessionId: normalizedSessionId,
        terminalKind: "codex"
      }
    );
  }

  async function startGlobalCodexTerminal() {
    return await runStart(vibe64GlobalCodexTerminalPath(vibe64ApiPath.value), {}, {
      terminalKind: "global-codex"
    });
  }

  async function closeCodexTerminal(sessionId = "", terminalSessionId = "") {
    const normalizedSessionId = normalizedId(sessionId);
    const normalizedTerminalSessionId = normalizedId(terminalSessionId);
    if (!normalizedSessionId || !normalizedTerminalSessionId) {
      return commandMissingResponse("Codex terminal id is required.");
    }
    return await runClose(vibe64CodexTerminalPath(
      sessionsApiPath.value,
      normalizedSessionId,
      normalizedTerminalSessionId
    ));
  }

  async function closeGlobalCodexTerminal(scopeIdOrTerminalSessionId = "", terminalSessionId = "") {
    const normalizedTerminalSessionId = normalizedId(terminalSessionId || scopeIdOrTerminalSessionId);
    if (!normalizedTerminalSessionId) {
      return commandMissingResponse("Codex terminal id is required.");
    }
    return await runClose(vibe64GlobalCodexTerminalPath(vibe64ApiPath.value, normalizedTerminalSessionId));
  }

  async function startCommandTerminal(sessionId = "", input = {}) {
    const normalizedSessionId = normalizedId(sessionId);
    if (!normalizedSessionId) {
      return commandMissingResponse("Vibe64 session id is required.");
    }
    const payload = vibe64RealtimeOriginPayload(plainObject(input));
    terminalCommandTraceLog("client.projectConfigTrace.terminalCommands.commandTerminal.payload", {
      actionId: String(input?.actionId || ""),
      advanceOnSuccess: input?.advanceOnSuccess === true,
      inputKeys: sortedDebugKeys(input?.input),
      payloadKeys: sortedDebugKeys(payload),
      sessionId: normalizedSessionId
    });
    return await runStart(
      vibe64CommandTerminalPath(sessionsApiPath.value, normalizedSessionId),
      payload,
      {
        actionId: String(input?.actionId || ""),
        sessionId: normalizedSessionId,
        terminalKind: "command"
      }
    );
  }

  async function closeCommandTerminal(sessionId = "", terminalSessionId = "") {
    const normalizedSessionId = normalizedId(sessionId);
    const normalizedTerminalSessionId = normalizedId(terminalSessionId);
    if (!normalizedSessionId || !normalizedTerminalSessionId) {
      return commandMissingResponse("Command terminal id is required.");
    }
    return await runClose(vibe64CommandTerminalPath(
      sessionsApiPath.value,
      normalizedSessionId,
      normalizedTerminalSessionId
    ));
  }

  async function closeFixCodexTerminal(jobId = "", terminalSessionId = "") {
    const normalizedJobId = normalizedId(jobId);
    const normalizedTerminalSessionId = normalizedId(terminalSessionId);
    if (!normalizedJobId || !normalizedTerminalSessionId) {
      return commandMissingResponse("Fix Codex terminal id is required.");
    }
    return await runClose(vibe64FixCodexTerminalPath(
      vibe64ApiPath.value,
      normalizedJobId,
      normalizedTerminalSessionId
    ));
  }

  return {
    closeCodexTerminal,
    closeCommandTerminal,
    closeFixCodexTerminal,
    closeGlobalCodexTerminal,
    closeTerminalCommand,
    startCodexTerminal,
    startCommandTerminal,
    startGlobalCodexTerminal,
    startTerminalCommand
  };
}

export {
  useVibe64TerminalCommands
};
