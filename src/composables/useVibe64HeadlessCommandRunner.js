import { getCurrentInstance, onBeforeUnmount, ref } from "vue";
import {
  vibe64CommandTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const WEBSOCKET_CLOSING = 2;
const WEBSOCKET_CLOSED = 3;

function normalizePlainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function terminalActionLabel(action = {}) {
  return String(action.label || action.id || "Command action");
}

function terminalActionId(action = {}) {
  return String(action.id || "").trim();
}

function normalizedFailureStatus(value = null) {
  if (value == null || value === "") {
    return null;
  }
  const status = Number(value);
  return Number.isFinite(status) ? status : null;
}

function parseTerminalMessage(rawMessage = "") {
  try {
    return JSON.parse(String(rawMessage || ""));
  } catch {
    return {
      error: "Terminal stream returned an invalid message.",
      type: "error"
    };
  }
}

function terminalHasExited(message = {}) {
  return String(message.status || "") === "exited";
}

function terminalAttemptedCommand(session = {}) {
  return String(normalizePlainObject(session.metadata).attemptedCommand || "");
}

function closeSocket(socket) {
  if (!socket || socket.readyState === WEBSOCKET_CLOSING || socket.readyState === WEBSOCKET_CLOSED) {
    return;
  }
  socket.close();
}

function registerUnmountCleanup(callback) {
  if (getCurrentInstance()) {
    onBeforeUnmount(callback);
  }
}

function commandFailure({
  action = {},
  attemptedCommand = "",
  code = "",
  commandPreview = "",
  error = "",
  exitCode = null,
  operationOutcome = "",
  output = "",
  refreshRecommended = false,
  sessionId = "",
  status: failureStatus = null,
  terminalSessionId = ""
} = {}) {
  const label = terminalActionLabel(action);
  return {
    actionId: terminalActionId(action),
    actionLabel: label,
    attemptedCommand: String(attemptedCommand || ""),
    code: String(code || ""),
    commandPreview,
    error: String(error || `${label} failed.`),
    exitCode,
    ok: false,
    operationOutcome: String(operationOutcome || ""),
    output: String(output || ""),
    refreshRecommended: refreshRecommended === true,
    sessionId: String(sessionId || ""),
    status: normalizedFailureStatus(failureStatus),
    terminalSessionId
  };
}

function commandSuccess({
  action = {},
  attemptedCommand = "",
  commandPreview = "",
  exitCode = 0,
  output = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  return {
    actionId: terminalActionId(action),
    actionLabel: terminalActionLabel(action),
    attemptedCommand: String(attemptedCommand || ""),
    commandPreview,
    error: "",
    exitCode,
    ok: true,
    output: String(output || ""),
    sessionId: String(sessionId || ""),
    terminalSessionId
  };
}

function commandStopped({
  action = {},
  attemptedCommand = "",
  commandPreview = "",
  output = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  const label = terminalActionLabel(action);
  return commandFailure({
    action,
    attemptedCommand,
    commandPreview,
    error: `${label} was stopped before it finished.`,
    exitCode: null,
    output,
    sessionId,
    terminalSessionId
  });
}

function useVibe64HeadlessCommandRunner({
  closeCommandTerminal = null,
  startCommandTerminal = null,
  webSocketUrl = vibe64CommandTerminalWebSocketUrl
} = {}) {
  const needsTerminalCommands = typeof closeCommandTerminal !== "function" ||
    typeof startCommandTerminal !== "function";
  const terminalCommands = needsTerminalCommands ? useVibe64TerminalCommands() : null;
  const runCloseCommandTerminal = typeof closeCommandTerminal === "function"
    ? closeCommandTerminal
    : terminalCommands.closeCommandTerminal;
  const runStartCommandTerminal = typeof startCommandTerminal === "function"
    ? startCommandTerminal
    : terminalCommands.startCommandTerminal;
  const commandPreview = ref("");
  const activeSessionId = ref("");
  const output = ref("");
  const running = ref(false);
  const status = ref("");
  const lastResult = ref(null);

  let activeSocket = null;
  let activeTerminal = null;
  let stopActiveCommand = null;

  async function runCommandAction({
    advanceOnSuccess = false,
    action = {},
    input = {},
    sessionId = ""
  } = {}) {
    const startedAtMs = Date.now();
    const normalizedSessionId = String(sessionId || "").trim();
    const actionId = terminalActionId(action);
    if (!normalizedSessionId || !actionId || running.value) {
      vibe64SessionDebugLog("client.headlessCommand.run.skipped", {
        actionId,
        running: running.value,
        reason: !normalizedSessionId ? "missing_session" : !actionId ? "missing_action" : "running",
        sessionId: normalizedSessionId
      });
      return commandFailure({
        action,
        error: "Command action cannot start."
      });
    }

    vibe64SessionDebugLog("client.headlessCommand.run.start", {
      actionId,
      advanceOnSuccess: advanceOnSuccess === true,
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId: normalizedSessionId
    });
    running.value = true;
    activeSessionId.value = normalizedSessionId;
    lastResult.value = null;
    commandPreview.value = "";
    output.value = "";
    status.value = "";
    try {
      const terminalSession = await runStartCommandTerminal(normalizedSessionId, {
        advanceOnSuccess: advanceOnSuccess === true,
        actionId,
        input: normalizePlainObject(input)
      });
      if (terminalSession?.ok === false) {
        vibe64SessionDebugLog("client.headlessCommand.startTerminal.rejected", {
          actionId,
          code: String(terminalSession.code || terminalSession.errors?.[0]?.code || ""),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          sessionId: normalizedSessionId,
          status: terminalSession.status || terminalSession.statusCode || null
        });
        const result = commandFailure({
          action,
          code: terminalSession.code || terminalSession.errors?.[0]?.code || "",
          error: terminalSession.error || terminalSession.errors?.[0]?.message || "Command terminal could not start.",
          operationOutcome: terminalSession.operationOutcome,
          refreshRecommended: terminalSession.refreshRecommended === true,
          sessionId: normalizedSessionId,
          status: terminalSession.status || terminalSession.statusCode
        });
        lastResult.value = result;
        return result;
      }

      activeTerminal = {
        sessionId: normalizedSessionId,
        terminalSessionId: String(terminalSession.id || "")
      };
      vibe64SessionDebugLog("client.headlessCommand.startTerminal.done", {
        actionId,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        sessionId: normalizedSessionId,
        terminalSessionId: activeTerminal.terminalSessionId,
        terminalStatus: String(terminalSession.status || "")
      });
      applyLiveTerminalSnapshot(terminalSession);
      const result = await waitForCommandExit({
        action,
        commandStartedAtMs: startedAtMs,
        initialSession: terminalSession,
        sessionId: normalizedSessionId,
        terminalSessionId: activeTerminal.terminalSessionId,
        webSocketUrl
      });
      lastResult.value = result;
      vibe64SessionDebugLog("client.headlessCommand.run.done", {
        actionId,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        exitCode: result.exitCode ?? null,
        ok: result.ok === true,
        sessionId: normalizedSessionId,
        terminalSessionId: result.terminalSessionId || ""
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.headlessCommand.run.error", {
        actionId,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId
      });
      const result = commandFailure({
        action,
        code: error?.code,
        error: String(error?.message || error || "Command terminal failed."),
        operationOutcome: error?.operationOutcome,
        refreshRecommended: error?.refreshRecommended === true,
        sessionId: normalizedSessionId,
        status: error?.status || error?.statusCode
      });
      lastResult.value = result;
      return result;
    } finally {
      await closeActiveTerminal();
      running.value = false;
      status.value = "";
      stopActiveCommand = null;
    }
  }

  function applyLiveTerminalSnapshot(session = {}) {
    commandPreview.value = String(session.commandPreview || commandPreview.value);
    output.value = String(session.output || output.value);
    status.value = String(session.status || status.value);
  }

  function appendLiveTerminalOutput(chunk = "") {
    output.value = `${output.value}${String(chunk || "")}`;
  }

  function waitForCommandExit({
    action = {},
    commandStartedAtMs = Date.now(),
    initialSession = {},
    sessionId = "",
    terminalSessionId = "",
    webSocketUrl: resolveWebSocketUrl
  } = {}) {
    return new Promise((resolve) => {
      let attemptedCommand = terminalAttemptedCommand(initialSession);
      let commandPreview = String(initialSession.commandPreview || "");
      let output = String(initialSession.output || "");
      let settled = false;

      function settle(result) {
        if (settled) {
          return;
        }
        vibe64SessionDebugLog("client.headlessCommand.stream.settle", {
          actionId: terminalActionId(action),
          durationMs: vibe64SessionDebugDurationMs(commandStartedAtMs),
          error: String(result?.error || ""),
          exitCode: result?.exitCode ?? null,
          ok: result?.ok === true,
          sessionId,
          terminalSessionId
        });
        settled = true;
        stopActiveCommand = null;
        closeSocket(activeSocket);
        activeSocket = null;
        resolve(result);
      }

      function resultForExit(exitCode, closeError = "") {
        const commonResult = {
          action,
          attemptedCommand,
          commandPreview,
          exitCode,
          output,
          sessionId,
          terminalSessionId
        };
        return Number(exitCode) === 0 && !closeError
          ? commandSuccess(commonResult)
          : commandFailure({
              ...commonResult,
              error: closeError || `${terminalActionLabel(action)} failed with exit code ${exitCode}.`
            });
      }

      function applySnapshot(session = {}) {
        attemptedCommand = terminalAttemptedCommand(session) || attemptedCommand;
        commandPreview = String(session.commandPreview || commandPreview);
        output = String(session.output || output);
        applyLiveTerminalSnapshot({
          commandPreview,
          output,
          status: session.status || ""
        });
        if (terminalHasExited(session)) {
          settle(resultForExit(session.exitCode ?? null, String(session.closeError || "")));
        }
      }

      function handleMessage(rawMessage = "") {
        const message = parseTerminalMessage(rawMessage);
        if (message.type === "snapshot") {
          applySnapshot(message.session || {});
          return;
        }
        if (message.type === "output") {
          const chunk = String(message.chunk || "");
          output += chunk;
          appendLiveTerminalOutput(chunk);
          return;
        }
        if (message.type === "metadata") {
          attemptedCommand = String(normalizePlainObject(message.metadata).attemptedCommand || attemptedCommand);
          return;
        }
        if (message.type === "status" && terminalHasExited(message)) {
          status.value = String(message.status || "");
          settle(resultForExit(message.exitCode ?? null, String(message.closeError || "")));
          return;
        }
        if (message.type === "error") {
          settle(commandFailure({
            action,
            attemptedCommand,
            commandPreview,
            error: String(message.error || "Terminal stream failed."),
            output,
            sessionId,
            terminalSessionId
          }));
        }
      }

      stopActiveCommand = () => {
        status.value = "stopping";
        settle(commandStopped({
          action,
          attemptedCommand,
          commandPreview,
          output,
          sessionId,
          terminalSessionId
        }));
        return true;
      };

      if (terminalHasExited(initialSession)) {
        vibe64SessionDebugLog("client.headlessCommand.stream.initialExited", {
          actionId: terminalActionId(action),
          sessionId,
          terminalSessionId
        });
        settle(resultForExit(initialSession.exitCode ?? null, String(initialSession.closeError || "")));
        return;
      }
      if (!terminalSessionId || typeof WebSocket !== "function") {
        vibe64SessionDebugLog("client.headlessCommand.stream.unavailable", {
          actionId: terminalActionId(action),
          hasTerminalSessionId: Boolean(terminalSessionId),
          hasWebSocket: typeof WebSocket === "function",
          sessionId,
          terminalSessionId
        });
        settle(commandFailure({
          action,
          attemptedCommand,
          commandPreview,
          error: "Terminal stream is not available.",
          output,
          sessionId,
          terminalSessionId
        }));
        return;
      }

      vibe64SessionDebugLog("client.headlessCommand.stream.open", {
        actionId: terminalActionId(action),
        sessionId,
        terminalSessionId
      });
      activeSocket = new WebSocket(resolveWebSocketUrl(sessionId, terminalSessionId));
      activeSocket.addEventListener("message", (event) => {
        handleMessage(event.data);
      });
      activeSocket.addEventListener("error", () => {
        settle(commandFailure({
          action,
          commandPreview,
          error: "Terminal stream failed.",
          output,
          sessionId,
          terminalSessionId
        }));
      });
      activeSocket.addEventListener("close", () => {
        settle(commandFailure({
          action,
          commandPreview,
          error: "Terminal stream closed before the command finished.",
          output,
          sessionId,
          terminalSessionId
        }));
      });
    });
  }

  function stopCommandAction() {
    return typeof stopActiveCommand === "function" ? stopActiveCommand() : false;
  }

  function clearResult() {
    lastResult.value = null;
    activeSessionId.value = "";
    commandPreview.value = "";
    output.value = "";
    status.value = "";
  }

  async function closeActiveTerminal() {
    closeSocket(activeSocket);
    activeSocket = null;
    const terminal = activeTerminal;
    activeTerminal = null;
    if (!terminal?.sessionId || !terminal?.terminalSessionId) {
      return;
    }
    await runCloseCommandTerminal(terminal.sessionId, terminal.terminalSessionId).catch(() => null);
  }

  registerUnmountCleanup(() => {
    void closeActiveTerminal();
  });

  return {
    clearResult,
    closeActiveTerminal,
    commandPreview,
    activeSessionId,
    lastResult,
    output,
    runCommandAction,
    running,
    status,
    stopCommandAction
  };
}

export {
  useVibe64HeadlessCommandRunner
};
