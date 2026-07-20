import { getCurrentInstance, onBeforeUnmount, ref } from "vue";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import {
  vibe64CommandTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  responseOperationOutcome,
  responseRefreshRecommended
} from "@/lib/vibe64StaleOperation.js";

const HEADLESS_COMMAND_RECONNECT_DELAY_MS = 250;
const HEADLESS_COMMAND_RECONNECT_MAX_DELAY_MS = 5_000;
const COMMAND_OBSERVER_DETACHED = Symbol("command-observer-detached");

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

function terminalAttemptedCommand(session = {}) {
  return String(normalizePlainObject(session.metadata).attemptedCommand || "");
}

function terminalSessionIdFromStartResponse(response = {}) {
  return String(response?.id || response?.terminalSessionId || "").trim();
}

function startResponseIsAttachableCommandClaim(response = {}) {
  return String(response.operationOutcome || "") === "command_already_running" &&
    Boolean(terminalSessionIdFromStartResponse(response));
}

function startResponseIsFinishedCommandClaim(response = {}) {
  return response?.ok === true &&
    String(response.operationOutcome || "") === "command_already_finished";
}

function actionFromCommandClaim(response = {}, fallbackAction = {}) {
  return {
    id: String(response.actionId || fallbackAction.id || ""),
    label: String(response.actionLabel || fallbackAction.label || response.actionId || fallbackAction.id || "Command")
  };
}

function terminalSnapshotFromStartResponse(response = {}, terminalSessionId = "") {
  return {
    ...response,
    id: terminalSessionId,
    metadata: normalizePlainObject(response.metadata),
    output: String(response.output || ""),
    status: String(response.terminalStatus || response.status || "running")
  };
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
  status = null,
  terminalSessionId = ""
} = {}) {
  const label = terminalActionLabel(action);
  return {
    actionId: terminalActionId(action),
    actionLabel: label,
    attemptedCommand: String(attemptedCommand || ""),
    code: String(code || ""),
    commandPreview: String(commandPreview || ""),
    error: String(error || `${label} failed.`),
    exitCode,
    ok: false,
    operationOutcome: String(operationOutcome || ""),
    output: String(output || ""),
    refreshRecommended: refreshRecommended === true,
    sessionId: String(sessionId || ""),
    status: normalizedFailureStatus(status),
    terminalSessionId: String(terminalSessionId || "")
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
    commandPreview: String(commandPreview || ""),
    error: "",
    exitCode,
    ok: true,
    output: String(output || ""),
    sessionId: String(sessionId || ""),
    terminalSessionId: String(terminalSessionId || "")
  };
}

function useVibe64HeadlessCommandRunner({
  closeCommandTerminal = null,
  reconnectDelayMs = HEADLESS_COMMAND_RECONNECT_DELAY_MS,
  reconnectMaxDelayMs = HEADLESS_COMMAND_RECONNECT_MAX_DELAY_MS,
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
  const activeActionId = ref("");
  const activeSessionId = ref("");
  const running = ref(false);
  const lastResult = ref(null);
  let activeTerminal = null;
  let activeAction = null;
  let disposed = false;
  let resolveCommandCompletion = null;
  let resolvePendingStartDetach = null;
  let stopRequested = false;
  let terminalStreamFailure = null;

  const terminal = useVibe64Terminal({
    driver: createWebSocketTerminalDriver({
      closeSession(terminalSessionId) {
        return runCloseCommandTerminal(activeSessionId.value, terminalSessionId);
      },
      webSocketUrl(terminalSessionId) {
        return webSocketUrl(activeSessionId.value, terminalSessionId);
      }
    }),
    initiallyVisible: false,
    onEvent(event) {
      if (event.type === "exit") {
        settleCommand("exited");
        return;
      }
      if (event.type === "stream-error") {
        terminalStreamFailure = {
          code: event.code,
          error: event.error
        };
        settleCommand(event.code === "terminal_session_not_found" ? "missing" : "rejected");
        return;
      }
    },
    presentation: "headless",
    reconnectDelayMs,
    reconnectMaxDelayMs
  });

  function settleCommand(reason, session = terminal.terminalSnapshot()) {
    resolveCommandCompletion?.({
      reason,
      session
    });
  }

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
      return commandFailure({
        action,
        error: "Command action cannot start."
      });
    }

    activeActionId.value = actionId;
    activeSessionId.value = normalizedSessionId;
    running.value = true;
    lastResult.value = null;
    activeTerminal = null;
    activeAction = action;
    resolveCommandCompletion = null;
    stopRequested = false;
    terminalStreamFailure = null;
    terminal.resetTerminalSessionState();
    terminal.resetTerminalDisplay();
    vibe64SessionDebugLog("client.headlessCommand.run.start", {
      actionId,
      advanceOnSuccess: advanceOnSuccess === true,
      sessionId: normalizedSessionId
    });

    try {
      const observerDetachSignal = new Promise((resolve) => {
        resolvePendingStartDetach = () => resolve(COMMAND_OBSERVER_DETACHED);
      });
      const response = await Promise.race([
        runStartCommandTerminal(normalizedSessionId, {
          actionId,
          advanceOnSuccess: advanceOnSuccess === true,
          input: normalizePlainObject(input)
        }),
        observerDetachSignal
      ]);
      if (response === COMMAND_OBSERVER_DETACHED) {
        return resultFromCompletion({
          action,
          completion: {
            reason: "detached"
          },
          sessionId: normalizedSessionId,
          terminalSessionId: ""
        });
      }
      if (startResponseIsFinishedCommandClaim(response)) {
        const result = commandSuccess({
          action: actionFromCommandClaim(response, action),
          commandPreview: response.commandPreview,
          sessionId: normalizedSessionId,
          terminalSessionId: terminalSessionIdFromStartResponse(response)
        });
        lastResult.value = result;
        return result;
      }
      if (response?.ok === false) {
        const result = commandFailure({
          action,
          code: response.code || response.errors?.[0]?.code,
          error: response.error || response.errors?.[0]?.message || "Command terminal could not start.",
          operationOutcome: response.operationOutcome,
          refreshRecommended: response.refreshRecommended,
          sessionId: normalizedSessionId,
          status: response.status || response.statusCode,
          terminalSessionId: terminalSessionIdFromStartResponse(response)
        });
        lastResult.value = result;
        return result;
      }

      const attached = startResponseIsAttachableCommandClaim(response);
      const terminalSessionId = terminalSessionIdFromStartResponse(response);
      const claimedAction = attached ? actionFromCommandClaim(response, action) : action;
      activeAction = claimedAction;
      activeActionId.value = terminalActionId(claimedAction);
      const session = attached
        ? terminalSnapshotFromStartResponse(response, terminalSessionId)
        : response;
      activeTerminal = {
        sessionId: normalizedSessionId,
        terminalSessionId
      };
      const completion = new Promise((resolve) => {
        resolveCommandCompletion = resolve;
      });
      if (disposed) {
        settleCommand("detached", session);
      } else if (stopRequested) {
        settleCommand("stopped", session);
      } else if (String(session.status || "") === "exited") {
        settleCommand("exited", session);
      }
      if (!disposed && !stopRequested && String(session.status || "") !== "exited") {
        await Promise.race([
          terminal.attachTerminal(session, {
            ownership: attached ? "attached" : "owned"
          }),
          completion
        ]);
        if (terminal.terminalStatus.value === "exited") {
          settleCommand("exited");
        }
      }
      const completed = await completion;
      const result = resultFromCompletion({
        action: claimedAction,
        completion: completed,
        sessionId: normalizedSessionId,
        terminalSessionId
      });
      lastResult.value = result;
      vibe64SessionDebugLog("client.headlessCommand.run.done", {
        actionId: terminalActionId(claimedAction),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        exitCode: result.exitCode,
        ok: result.ok,
        sessionId: normalizedSessionId,
        terminalSessionId
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
        operationOutcome: responseOperationOutcome(error),
        refreshRecommended: responseRefreshRecommended(error),
        sessionId: normalizedSessionId,
        status: error?.status || error?.statusCode,
        terminalSessionId: error?.terminalSessionId
      });
      lastResult.value = result;
      return result;
    } finally {
      resolvePendingStartDetach = null;
      resolveCommandCompletion = null;
      await closeActiveTerminal({
        deleteSession: terminal.terminalStatus.value === "exited" || stopRequested
      });
      running.value = false;
      activeAction = null;
      activeActionId.value = "";
      stopRequested = false;
    }
  }

  function resultFromCompletion({
    action,
    completion,
    sessionId,
    terminalSessionId
  }) {
    const session = completion.session || {};
    const common = {
      action,
      attemptedCommand: terminalAttemptedCommand(session),
      commandPreview: session.commandPreview,
      exitCode: session.exitCode,
      output: session.output,
      sessionId,
      terminalSessionId
    };
    if (completion.reason === "detached") {
      return commandFailure({
        ...common,
        code: "vibe64_command_observer_detached",
        error: `${terminalActionLabel(action)} continues without this closed view.`,
        exitCode: null
      });
    }
    if (completion.reason === "missing") {
      return commandFailure({
        ...common,
        code: "vibe64_command_terminal_lost",
        error: `${terminalActionLabel(action)} lost its server terminal. Retry the command.`,
        exitCode: null
      });
    }
    if (completion.reason === "rejected") {
      return commandFailure({
        ...common,
        code: terminalStreamFailure?.code,
        error: terminalStreamFailure?.error || "Terminal stream was rejected.",
        exitCode: null
      });
    }
    if (completion.reason === "stopped") {
      return commandFailure({
        ...common,
        error: `${terminalActionLabel(action)} was stopped before it finished.`,
        exitCode: null
      });
    }
    if (session.status === "exited" && Number(session.exitCode) === 0 && !session.closeError) {
      return commandSuccess(common);
    }
    return commandFailure({
      ...common,
      error: session.error || session.closeError || (
        session.status === "exited"
          ? `${terminalActionLabel(action)} failed with exit code ${session.exitCode}.`
          : "Terminal stream failed."
      )
    });
  }

  function stopCommandAction() {
    if (!running.value) {
      return false;
    }
    stopRequested = true;
    terminal.terminalError.value = `${terminalActionLabel(activeAction || {})} was stopped before it finished.`;
    terminal.closeTerminalSocket();
    settleCommand("stopped");
    return true;
  }

  function detachCommandObserver() {
    if (!running.value) {
      return false;
    }
    terminal.closeTerminalSocket();
    resolvePendingStartDetach?.();
    settleCommand("detached");
    return true;
  }

  function clearResult() {
    lastResult.value = null;
    activeSessionId.value = "";
    terminal.resetTerminalSessionState();
    terminal.resetTerminalDisplay();
  }

  async function closeActiveTerminal({
    deleteSession = true
  } = {}) {
    const active = activeTerminal;
    activeTerminal = null;
    terminal.closeTerminalSocket();
    if (deleteSession && active?.sessionId && active.terminalSessionId) {
      await runCloseCommandTerminal(active.sessionId, active.terminalSessionId).catch(() => null);
    }
    terminal.resetTerminalSessionState();
  }

  registerUnmountCleanup(() => {
    disposed = true;
    if (!detachCommandObserver()) {
      terminal.closeTerminalSocket();
    }
  });

  return {
    activeActionId,
    activeSessionId,
    clearResult,
    closeActiveTerminal,
    commandPreview: terminal.terminalCommandPreview,
    detachCommandObserver,
    lastResult,
    output: terminal.terminalOutput,
    runCommandAction,
    running,
    status: terminal.terminalStatus,
    stopCommandAction,
    terminal
  };
}

export {
  useVibe64HeadlessCommandRunner
};
