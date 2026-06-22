import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  useVibe64TerminalFailureFixCommand
} from "@/composables/useVibe64TerminalFailureFixCommand.js";
import {
  scopedDevelopmentApiUrl
} from "@/lib/studioUrls.js";
import {
  vibe64CommandTerminalWebSocketUrl,
  vibe64LaunchTerminalWebSocketUrl,
  vibe64ProjectToolTerminalWebSocketUrl,
  vibe64ShellTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import {
  VIBE64_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  normalizeVibe64ProjectToolFixInput,
  vibe64CommandTerminalPath,
  vibe64LaunchTerminalPath,
  vibe64ProjectToolFixPath,
  vibe64ProjectToolRunPath,
  vibe64ProjectToolTerminalPath,
  vibe64ShellTerminalPath
} from "@/lib/vibe64SessionRequestConfig.js";

const FINISHED_TERMINAL_HOLD_MS = 500;

function commandTerminalCanRequestAiFix({
  aiFixAvailable = false,
  terminalCommandPreview = "",
  terminalError = "",
  terminalExited = false,
  terminalExitCode = null,
  terminalOutput = "",
  terminalRunning = false
} = {}) {
  return Boolean(
    aiFixAvailable &&
    !terminalRunning &&
    (
      terminalError ||
      (terminalExited && terminalExitCode !== 0)
    ) &&
    (
      terminalOutput ||
      terminalCommandPreview ||
      terminalError
    )
  );
}

function projectScopedTerminalApiPaths({
  projectSlug = "",
  sessionsApiPath = "",
  vibe64ApiPath = ""
} = {}) {
  return {
    sessionsApiPath: scopedDevelopmentApiUrl(sessionsApiPath, projectSlug),
    vibe64ApiPath: scopedDevelopmentApiUrl(vibe64ApiPath, projectSlug)
  };
}

function terminalPathForContext({
  actionId = "",
  sessionId = "",
  terminalKind = "command",
  terminalSessionId = "",
  sessionsApiPath = "",
  vibe64ApiPath = ""
} = {}) {
  if (terminalKind === "launch") {
    return vibe64LaunchTerminalPath(sessionsApiPath, sessionId, terminalSessionId);
  }
  if (terminalKind === "shell") {
    return vibe64ShellTerminalPath(sessionsApiPath, sessionId, terminalSessionId);
  }
  if (terminalKind === "tool") {
    return terminalSessionId
      ? vibe64ProjectToolTerminalPath(vibe64ApiPath, actionId, terminalSessionId)
      : vibe64ProjectToolRunPath(vibe64ApiPath, actionId);
  }
  return vibe64CommandTerminalPath(sessionsApiPath, sessionId, terminalSessionId);
}

function useVibe64CommandTerminalController(props, emit) {
  const terminalClosedByUser = ref(false);
  const expanded = ref(props.initialExpanded !== false);
  const activeTerminalApiPaths = ref(null);
  const projectSlug = useVibe64ProjectSlug();
  const paths = usePaths();

  let terminalStartPromise = null;
  let finishedEmittedForTerminalId = "";
  let handledStartRequestKey = "";
  let pendingStartRequestKey = "";
  let readyEmittedForTerminalId = "";

  const sessionId = computed(() => props.session?.sessionId || "");
  const actionId = computed(() => props.action?.id || "");
  const activeActionLabel = computed(() => props.action?.label || "");
  const launchTargetId = computed(() => props.launchTarget?.id || "");
  const launchTargetLabel = computed(() => props.launchTarget?.label || "");
  const shellTarget = computed(() => props.shellTarget || "");
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const vibe64ApiPath = computed(() => paths.api(VIBE64_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const terminalFailureFix = useVibe64TerminalFailureFixCommand({
    sessionsApiPath
  });
  const launchTerminal = computed(() => props.terminalKind === "launch");
  const shellTerminal = computed(() => props.terminalKind === "shell");
  const projectToolTerminal = computed(() => props.terminalKind === "tool");
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
    if (projectToolTerminal.value) {
      return activeActionLabel.value || "Project tool";
    }
    return activeActionLabel.value || "Run adapter commands here.";
  });
  const startFailureMessage = computed(() => {
    if (launchTerminal.value) {
      return "Launch terminal failed to start.";
    }
    if (projectToolTerminal.value) {
      return "Project tool failed to start.";
    }
    return shellTerminal.value
      ? "Shell terminal failed to start."
      : "Command terminal failed to start.";
  });
  const canStartTerminal = computed(() => {
    if (projectToolTerminal.value) {
      return Boolean(actionId.value);
    }
    return Boolean(
      sessionId.value &&
      (
        (launchTerminal.value && launchTargetId.value) ||
        (shellTerminal.value && shellTarget.value) ||
        actionId.value
      )
    );
  });

  function currentTerminalApiPaths() {
    return projectScopedTerminalApiPaths({
      projectSlug: projectSlug.value,
      sessionsApiPath: sessionsApiPath.value,
      vibe64ApiPath: vibe64ApiPath.value
    });
  }

  function rememberTerminalApiPaths() {
    activeTerminalApiPaths.value = currentTerminalApiPaths();
    return activeTerminalApiPaths.value;
  }

  function terminalPath(context = {}) {
    const apiPaths = context.apiPaths || currentTerminalApiPaths();
    return terminalPathForContext({
      actionId: context.actionId || actionId.value,
      sessionId: context.sessionId,
      terminalKind: context.terminalKind,
      terminalSessionId: context.terminalSessionId,
      sessionsApiPath: apiPaths.sessionsApiPath,
      vibe64ApiPath: apiPaths.vibe64ApiPath
    });
  }

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
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
          advanceOnSuccess: context.advanceOnSuccess === true,
          input: context.actionInput || {}
        };
      }
      if (context.terminalKind === "shell") {
        return {
          reuseRunning: context.reuseRunning !== false,
          target: String(context.shellTarget || "")
        };
      }
      if (context.terminalKind === "tool") {
        return {
          parameters: context.actionInput || {}
        };
      }
      return {};
    },
    fallbackRunError: "Terminal failed to start.",
    messages: {
      error: "Terminal failed to start."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.terminal.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: terminalPath(context)
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
  const requestProjectToolFixCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64ProjectToolFixPath(vibe64ApiPath.value, context.toolId || context.actionId)
    }),
    buildRawPayload: (_model, { context }) => normalizeVibe64ProjectToolFixInput({
      ...context,
      toolId: context.toolId || context.actionId
    }),
    fallbackRunError: "Project tool fix could not start.",
    messages: {
      error: "Project tool fix could not start."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-tool.fix",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const terminal = useStudioTerminal({
    onSessionUpdate: handleTerminalSessionUpdate,
    onStatusUpdate: handleTerminalStatusUpdate,
    webSocketUrl(terminalId) {
      if (launchTerminal.value) {
        return vibe64LaunchTerminalWebSocketUrl(sessionId.value, terminalId);
      }
      if (shellTerminal.value) {
        return vibe64ShellTerminalWebSocketUrl(sessionId.value, terminalId);
      }
      if (projectToolTerminal.value) {
        return vibe64ProjectToolTerminalWebSocketUrl(actionId.value, terminalId);
      }
      return vibe64CommandTerminalWebSocketUrl(sessionId.value, terminalId);
    }
  });

  const {
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalUi,
    focusTerminal: focusTerminalUi,
    resetTerminalDisplay,
    resetTerminalSessionState,
    sendCtrlC,
    setupTerminalUi,
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalExitCode,
    terminalHost,
    terminalMetadata,
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
  const canRequestAiFix = computed(() => commandTerminalCanRequestAiFix({
    aiFixAvailable: props.aiFixAvailable,
    sessionId: sessionId.value,
    terminalCommandPreview: terminalCommandPreview.value,
    terminalError: terminalError.value,
    terminalExited: terminalExited.value,
    terminalExitCode: terminalExitCode.value,
    terminalOutput: terminalOutput.value,
    terminalRunning: terminalIsRunning()
  }));

  function terminalIsRunning(status = terminalStatus.value) {
    return status === "running" || status === "closing" || terminalStarting.value;
  }

  function terminalSessionIsLaunchReady(terminalSession = {}) {
    return launchTerminal.value && terminalSession?.metadata?.launchReady === true;
  }

  function emitRunningState() {
    emit("running-changed", terminalIsRunning());
  }

  function setExpanded(nextExpanded) {
    const normalizedExpanded = nextExpanded === true;
    if (expanded.value === normalizedExpanded) {
      return;
    }
    expanded.value = normalizedExpanded;
    emit("expanded-changed", normalizedExpanded);
  }

  function emitLaunchReady(terminalSession = {}) {
    if (!terminalSessionIsLaunchReady(terminalSession) || readyEmittedForTerminalId === terminalSession.id) {
      return;
    }
    readyEmittedForTerminalId = terminalSession.id;
    emit("ready", {
      metadata: terminalSession.metadata || {},
      sessionId: sessionId.value,
      terminalSessionId: terminalSession.id || terminalSessionId.value
    });
  }

  function handleTerminalSessionUpdate(terminalSession = {}) {
    emitLaunchReady(terminalSession);
  }

  function scheduleFinished(exitCode, closeError = "") {
    if (!terminalSessionId.value || finishedEmittedForTerminalId === terminalSessionId.value) {
      return;
    }
    finishedEmittedForTerminalId = terminalSessionId.value;
    const emitFinished = () => {
      emit("finished", {
        actionId: actionId.value,
        closeError: String(closeError || terminalError.value || ""),
        exitCode,
        sessionId: sessionId.value
      });
    };
    const finishedHoldMs = Math.max(0, Number(props.finishedHoldMs ?? FINISHED_TERMINAL_HOLD_MS));
    if (finishedHoldMs > 0) {
      window.setTimeout(emitFinished, finishedHoldMs);
      return;
    }
    emitFinished();
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
    if (props.initialExpanded !== false) {
      setExpanded(true);
    }

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
        advanceOnSuccess: props.action?.advanceOnSuccess === true,
        apiPaths: rememberTerminalApiPaths(),
        launchTargetId: launchTargetId.value,
        reuseRunning: props.reuseRunning !== false,
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
        readyEmittedForTerminalId = "";
      }
      applyTerminalSession(session, {
        fallbackStatus: "running"
      });
      emit("started", {
        metadata: session.metadata || {},
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      emitLaunchReady({
        id: terminalSessionId.value,
        metadata: terminalMetadata.value
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
    const closePromise = closeCurrentServerTerminalSession(sessionId.value);
    if (emitClosed && props.emitClosedBeforeServerAck) {
      emit("closed");
    }
    await closePromise;
    if (emitClosed && !props.emitClosedBeforeServerAck) {
      emit("closed");
    }
  }

  async function restartTerminal() {
    await closeTerminal({
      emitClosed: false
    });
    resetTerminalDisplay();
    finishedEmittedForTerminalId = "";
    readyEmittedForTerminalId = "";
    terminalClosedByUser.value = false;
    await startTerminal();
  }

  async function requestAiFix() {
    if (!canRequestAiFix.value) {
      return;
    }
    setExpanded(false);
    const context = {
      actionId: actionId.value,
      actionLabel: activeActionLabel.value,
      attemptedCommand: String(terminalMetadata.value?.attemptedCommand || ""),
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
      terminalStatus: terminalStatus.value,
      toolId: actionId.value,
      toolLabel: activeActionLabel.value
    };
    if (projectToolTerminal.value) {
      emit("fix-requested", await requestProjectToolFixCommand.run(context));
      return;
    }
    emit("fix-requested", await terminalFailureFix.request(context));
  }

  function closeCurrentServerTerminalSession(selectedSessionId = sessionId.value) {
    const existingTerminalId = terminalSessionId.value;
    const apiPaths = activeTerminalApiPaths.value || currentTerminalApiPaths();
    resetTerminalSessionState();
    closeTerminalSocket();
    if (!existingTerminalId || !selectedSessionId) {
      activeTerminalApiPaths.value = null;
      return Promise.resolve(null);
    }
    return closeTerminalCommand.run({
      actionId: actionId.value,
      apiPaths,
      sessionId: selectedSessionId,
      terminalKind: props.terminalKind,
      terminalSessionId: existingTerminalId
    }).finally(() => {
      activeTerminalApiPaths.value = null;
    }).catch(() => null);
  }

  function toggleExpanded() {
    setExpanded(!expanded.value);
    if (expanded.value) {
      void setupTerminalUi();
    }
  }

  async function focusTerminal() {
    if (!expanded.value) {
      setExpanded(true);
      await nextTick();
    }
    return focusTerminalUi();
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
    readyEmittedForTerminalId = "";
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
    focusTerminal,
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
  commandTerminalCanRequestAiFix,
  projectScopedTerminalApiPaths,
  terminalPathForContext,
  useVibe64CommandTerminalController
};
