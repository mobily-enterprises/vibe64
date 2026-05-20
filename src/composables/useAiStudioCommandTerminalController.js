import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  aiStudioCommandTerminalWebSocketUrl,
  aiStudioLaunchTerminalWebSocketUrl,
  aiStudioShellTerminalWebSocketUrl
} from "@/lib/aiStudioSessionApi.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioCommandTerminalPath,
  aiStudioLaunchTerminalPath,
  aiStudioShellTerminalPath
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  terminalFailureFixRequest
} from "@/lib/aiStudioTerminalFailurePrompt.js";

const FINISHED_TERMINAL_HOLD_MS = 500;

function useAiStudioCommandTerminalController(props, emit) {
  const terminalClosedByUser = ref(false);
  const expanded = ref(true);
  const paths = usePaths();

  let terminalStartPromise = null;
  let finishedEmittedForTerminalId = "";
  let handledStartRequestKey = "";
  let pendingStartRequestKey = "";

  const sessionId = computed(() => props.session?.sessionId || "");
  const actionId = computed(() => props.action?.id || "");
  const activeActionLabel = computed(() => props.action?.label || "");
  const launchTargetId = computed(() => props.launchTarget?.id || "");
  const launchTargetLabel = computed(() => props.launchTarget?.label || "");
  const shellTarget = computed(() => props.shellTarget || "");
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));
  const launchTerminal = computed(() => props.terminalKind === "launch");
  const shellTerminal = computed(() => props.terminalKind === "shell");
  const terminalTitle = computed(() => {
    if (props.title) {
      return props.title;
    }
    if (launchTerminal.value) {
      return "Launch terminal";
    }
    return shellTerminal.value ? "Shell terminal" : "Command terminal";
  });
  const terminalSubtitle = computed(() => {
    if (launchTerminal.value) {
      return launchTargetLabel.value || "Run a launch target.";
    }
    if (shellTerminal.value) {
      return shellTarget.value === "main" ? "Main repo" : "Session worktree";
    }
    return activeActionLabel.value || "Run adapter commands here.";
  });
  const startFailureMessage = computed(() => {
    if (launchTerminal.value) {
      return "Launch terminal failed to start.";
    }
    return shellTerminal.value
      ? "Shell terminal failed to start."
      : "Command terminal failed to start.";
  });
  const canStartTerminal = computed(() => {
    return Boolean(
      sessionId.value &&
      (
        (launchTerminal.value && launchTargetId.value) ||
        (shellTerminal.value && shellTarget.value) ||
        actionId.value
      )
    );
  });

  function terminalPath({
    sessionId: selectedSessionId = "",
    terminalKind = "command",
    terminalSessionId: selectedTerminalSessionId = ""
  } = {}) {
    if (terminalKind === "launch") {
      return aiStudioLaunchTerminalPath(sessionsApiPath.value, selectedSessionId, selectedTerminalSessionId);
    }
    if (terminalKind === "shell") {
      return aiStudioShellTerminalPath(sessionsApiPath.value, selectedSessionId, selectedTerminalSessionId);
    }
    return aiStudioCommandTerminalPath(sessionsApiPath.value, selectedSessionId, selectedTerminalSessionId);
  }

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: terminalPath(context)
    }),
    buildRawPayload: (_model, { context }) => {
      if (context.terminalKind === "launch") {
        return {
          launchTargetId: String(context.launchTargetId || "")
        };
      }
      if (context.terminalKind === "command") {
        return {
          actionId: String(context.actionId || ""),
          input: context.actionInput || {}
        };
      }
      if (context.terminalKind === "shell") {
        return {
          target: String(context.shellTarget || "")
        };
      }
      return {};
    },
    fallbackRunError: "Terminal failed to start.",
    messages: {
      error: "Terminal failed to start."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.terminal.start",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: terminalPath(context)
    }),
    fallbackRunError: "Terminal could not close.",
    messages: {
      error: "Terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.terminal.close",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const terminal = useStudioTerminal({
    onStatusUpdate: handleTerminalStatusUpdate,
    webSocketUrl(terminalId) {
      if (launchTerminal.value) {
        return aiStudioLaunchTerminalWebSocketUrl(sessionId.value, terminalId);
      }
      if (shellTerminal.value) {
        return aiStudioShellTerminalWebSocketUrl(sessionId.value, terminalId);
      }
      return aiStudioCommandTerminalWebSocketUrl(sessionId.value, terminalId);
    }
  });

  const {
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalUi,
    resetTerminalDisplay,
    resetTerminalSessionState,
    sendCtrlC,
    setupTerminalUi,
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalExitCode,
    terminalHost,
    terminalOutput,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminal;

  const canRetry = computed(() => Boolean(
    canStartTerminal.value &&
    (
      terminalError.value ||
      terminalClosedByUser.value ||
      (terminalExited.value && terminalExitCode.value !== 0)
    )
  ));
  const canRequestAiFix = computed(() => Boolean(
    props.aiFixAvailable &&
    sessionId.value &&
    (
      terminalError.value ||
      (terminalExited.value && terminalExitCode.value !== 0)
    ) &&
    (
      terminalOutput.value ||
      terminalCommandPreview.value ||
      terminalError.value
    )
  ));

  function terminalIsRunning(status = terminalStatus.value) {
    return status === "running" || status === "closing" || terminalStarting.value;
  }

  function emitRunningState() {
    emit("running-changed", terminalIsRunning());
  }

  function scheduleFinished(exitCode, closeError = "") {
    if (!terminalSessionId.value || finishedEmittedForTerminalId === terminalSessionId.value) {
      return;
    }
    finishedEmittedForTerminalId = terminalSessionId.value;
    window.setTimeout(() => {
      emit("finished", {
        actionId: actionId.value,
        closeError: String(closeError || terminalError.value || ""),
        exitCode,
        sessionId: sessionId.value
      });
    }, FINISHED_TERMINAL_HOLD_MS);
  }

  function handleTerminalStatusUpdate({
    closeError = "",
    exitCode = null,
    status = ""
  } = {}) {
    terminalError.value = String(closeError || terminalError.value || "");
    emitRunningState();
    if (status === "exited") {
      scheduleFinished(exitCode, closeError);
    }
  }

  async function startTerminal() {
    if (!canStartTerminal.value) {
      return false;
    }
    if (terminalStartPromise) {
      return terminalStartPromise;
    }
    terminalStartPromise = runTerminalStart();

    try {
      return await terminalStartPromise;
    } finally {
      terminalStartPromise = null;
    }
  }

  async function runTerminalStart() {
    terminalStarting.value = true;
    emitRunningState();
    terminalError.value = "";
    expanded.value = true;

    try {
      if (!terminalHost.value) {
        return false;
      }
      if (!(await setupTerminalUi())) {
        terminalError.value = "Terminal view is not ready yet.";
        return false;
      }

      terminalClosedByUser.value = false;
      const session = await startTerminalCommand.run({
        actionId: actionId.value,
        actionInput: props.actionInput || {},
        launchTargetId: launchTargetId.value,
        sessionId: sessionId.value,
        shellTarget: shellTarget.value,
        terminalKind: props.terminalKind
      });
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || startFailureMessage.value);
      }
      if (!session) {
        throw new Error(startFailureMessage.value);
      }

      const nextTerminalSessionId = session.id || "";
      if (nextTerminalSessionId && nextTerminalSessionId !== terminalSessionId.value) {
        closeTerminalSocket();
        resetTerminalDisplay();
        finishedEmittedForTerminalId = "";
      }
      applyTerminalSession(session, {
        fallbackStatus: "running"
      });
      emit("started", {
        metadata: session.metadata || {},
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      emitRunningState();
      return connectTerminalSocket();
    } catch (error) {
      terminalError.value = String(error?.message || error || startFailureMessage.value);
      return false;
    } finally {
      terminalStarting.value = false;
      emitRunningState();
    }
  }

  async function startPendingRequest() {
    if (
      !pendingStartRequestKey ||
      pendingStartRequestKey === handledStartRequestKey ||
      !terminalHost.value ||
      !canStartTerminal.value
    ) {
      return;
    }

    const startRequestKey = pendingStartRequestKey;
    handledStartRequestKey = startRequestKey;
    await startTerminal();
  }

  async function closeTerminal({
    emitClosed = true
  } = {}) {
    terminalClosedByUser.value = true;
    emitRunningState();
    await closeCurrentServerTerminalSession(sessionId.value);
    if (emitClosed) {
      emit("closed");
    }
  }

  async function restartTerminal() {
    await closeTerminal({
      emitClosed: false
    });
    resetTerminalDisplay();
    finishedEmittedForTerminalId = "";
    terminalClosedByUser.value = false;
    await startTerminal();
  }

  function requestAiFix() {
    if (!canRequestAiFix.value) {
      return;
    }
    emit("fix-requested", terminalFailureFixRequest({
      actionId: actionId.value,
      actionLabel: activeActionLabel.value,
      closeError: terminalError.value,
      commandPreview: terminalCommandPreview.value,
      exitCode: terminalExitCode.value,
      launchTargetId: launchTargetId.value,
      launchTargetLabel: launchTargetLabel.value,
      output: terminalOutput.value,
      sessionId: sessionId.value,
      shellTarget: shellTarget.value,
      terminalKind: props.terminalKind,
      terminalSessionId: terminalSessionId.value,
      terminalStatus: terminalStatus.value
    }));
  }

  function closeCurrentServerTerminalSession(selectedSessionId = sessionId.value) {
    const existingTerminalId = terminalSessionId.value;
    resetTerminalSessionState();
    closeTerminalSocket();
    if (!existingTerminalId || !selectedSessionId) {
      return Promise.resolve(null);
    }
    return closeTerminalCommand.run({
      sessionId: selectedSessionId,
      terminalKind: props.terminalKind,
      terminalSessionId: existingTerminalId
    }).catch(() => null);
  }

  function toggleExpanded() {
    expanded.value = !expanded.value;
    if (expanded.value) {
      void setupTerminalUi();
    }
  }

  watch(() => props.startRequestKey, async (nextKey) => {
    const normalizedKey = String(nextKey || "");
    if (!normalizedKey) {
      pendingStartRequestKey = "";
      return;
    }
    pendingStartRequestKey = normalizedKey;
    await startPendingRequest();
  }, {
    immediate: true
  });

  watch(sessionId, (_nextSessionId, previousSessionId) => {
    void closeCurrentServerTerminalSession(previousSessionId);
    resetTerminalDisplay();
    handledStartRequestKey = "";
    pendingStartRequestKey = "";
    finishedEmittedForTerminalId = "";
    terminalClosedByUser.value = false;
    emitRunningState();
  });

  watch(terminalHost, (host) => {
    if (host) {
      void setupTerminalUi();
      void startPendingRequest();
    }
  }, {
    flush: "post"
  });

  onBeforeUnmount(() => {
    void closeCurrentServerTerminalSession(sessionId.value);
    disposeTerminalUi();
    emit("running-changed", false);
  });

  return {
    canRequestAiFix,
    canRetry,
    closeTerminal,
    expanded,
    restartTerminal,
    requestAiFix,
    sendCtrlC,
    startTerminal,
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalHost,
    terminalSessionId,
    terminalStarting,
    terminalStatus,
    terminalSubtitle,
    terminalTitle,
    toggleExpanded
  };
}

export {
  useAiStudioCommandTerminalController
};
