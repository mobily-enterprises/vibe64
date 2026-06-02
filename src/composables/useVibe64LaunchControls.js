import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  vibe64LaunchTargetsPath,
  vibe64LaunchTargetsQueryKey,
  vibe64LaunchTerminalPath,
  vibe64LaunchTerminalStopPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64LaunchTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64SessionWorktreePath
} from "@/lib/vibe64SessionPaths.js";
import {
  useStudioTerminal
} from "@/composables/useStudioTerminal.js";
import {
  stableLocalStorageKeyPart
} from "@/lib/browserLocalStorage.js";

const LAUNCH_BROWSER_WINDOW_FEATURES = "popup,width=1400,height=900,left=80,top=60";
const LAUNCH_PREVIEW_TOOLBAR_POSITIONS = Object.freeze(["left", "center", "right"]);
const TERMINAL_STOP_POLL_INTERVAL_MS = 100;
const TERMINAL_STOP_POLL_ATTEMPTS = 50;

function browserCanOpenTarget(target = {}) {
  return String(target.kind || "url") === "url" && Boolean(String(target.href || "").trim());
}

function launchBrowserTargetName(session = {}) {
  const source = session?.targetRoot || session?.worktree || session?.sessionRoot || session?.sessionId || "target";
  return `vibe64-launch-${stableLocalStorageKeyPart(source)}`;
}

function launchTerminalStorageKey(session = {}) {
  return `vibe64:floating-terminal:launch:${launchBrowserTargetName(session)}`;
}

function launchPreviewToolbarStorageKey(session = {}) {
  return `vibe64:launch-preview-toolbar:${launchBrowserTargetName(session)}`;
}

function normalizeLaunchPreviewToolbarPosition(value = "") {
  const normalized = String(value || "").trim();
  return LAUNCH_PREVIEW_TOOLBAR_POSITIONS.includes(normalized) ? normalized : "center";
}

function nextLaunchPreviewToolbarPosition(currentPosition = "center", direction = 0) {
  const currentIndex = LAUNCH_PREVIEW_TOOLBAR_POSITIONS.indexOf(
    normalizeLaunchPreviewToolbarPosition(currentPosition)
  );
  const nextIndex = Math.min(
    LAUNCH_PREVIEW_TOOLBAR_POSITIONS.length - 1,
    Math.max(0, currentIndex + Math.sign(Number(direction) || 0))
  );
  return LAUNCH_PREVIEW_TOOLBAR_POSITIONS[nextIndex] || "center";
}

function openLaunchBrowserTarget(target = {}, session = {}, browserWindow = null) {
  if (!browserCanOpenTarget(target)) {
    return null;
  }
  const activeWindow = browserWindow || (typeof window !== "undefined" ? window : null);
  if (!activeWindow?.open) {
    return null;
  }

  const openedWindow = activeWindow.open(
    target.href,
    launchBrowserTargetName(session),
    LAUNCH_BROWSER_WINDOW_FEATURES
  );
  if (!openedWindow) {
    return null;
  }

  try {
    openedWindow.opener = null;
  } catch {
    // Browser window proxies can reject writes after cross-origin navigation.
  }
  if (typeof openedWindow.focus === "function") {
    openedWindow.focus();
  }
  return openedWindow;
}

function openPendingLaunchBrowserWindow(session = {}, browserWindow = null) {
  const activeWindow = browserWindow || (typeof window !== "undefined" ? window : null);
  if (!activeWindow?.open) {
    return null;
  }
  const openedWindow = activeWindow.open(
    "about:blank",
    launchBrowserTargetName(session),
    LAUNCH_BROWSER_WINDOW_FEATURES
  );
  if (!openedWindow) {
    return null;
  }

  try {
    openedWindow.opener = null;
    openedWindow.document?.write?.("<!doctype html><title>Starting app</title><body>Starting app...</body>");
    openedWindow.document?.close?.();
  } catch {
    // A reused named browser window can already be cross-origin.
  }
  if (typeof openedWindow.focus === "function") {
    openedWindow.focus();
  }
  return openedWindow;
}

function openReadyLaunchBrowserTarget(target = {}, session = {}, pendingWindow = null) {
  if (!browserCanOpenTarget(target)) {
    return null;
  }
  if (pendingWindow && pendingWindow.closed !== true) {
    try {
      pendingWindow.location.href = target.href;
      if (typeof pendingWindow.focus === "function") {
        pendingWindow.focus();
      }
      return pendingWindow;
    } catch {
      // Fall back to opening the named target below.
    }
  }
  return openLaunchBrowserTarget(target, session);
}

function launchTargetWorktreePath(session = {}) {
  return vibe64SessionWorktreePath(session);
}

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function launchTerminalIsReady(metadata = {}) {
  return metadata?.launchReady === true || metadata?.launchReady === "true";
}

function launchPreviewBaseUrl(actions = []) {
  const previewAction = Array.isArray(actions) ? actions.find((action) => browserCanOpenTarget(action)) : null;
  return String(previewAction?.previewHref || previewAction?.href || "");
}

function launchPreviewDisplayUrl(actions = []) {
  const previewAction = Array.isArray(actions) ? actions.find((action) => browserCanOpenTarget(action)) : null;
  return String(previewAction?.href || "");
}

function launchPreviewUrl({
  baseUrl = "",
  ready = false,
  reloadKey = 0
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "");
  if (!normalizedBaseUrl || ready !== true) {
    return "";
  }
  const separator = normalizedBaseUrl.includes("?") ? "&" : "?";
  return `${normalizedBaseUrl}${separator}vibe64_reload=${reloadKey}`;
}

function useVibe64LaunchControls({
  autoStartTargetId = () => "",
  busy = () => false,
  session = null,
  windowDisplayed = () => true
} = {}) {
  const paths = usePaths();
  const operationBusy = ref(false);
  const terminalExpanded = ref(false);
  const autoStartKey = ref("");
  let attachedTerminalId = "";

  const selectedSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(selectedSession.value?.sessionId || ""));
  const requestedAutoStartTargetId = computed(() => String(readRefOrGetterValue(autoStartTargetId) || "").trim());
  const canLoadLaunchTargets = computed(() => Boolean(
    sessionId.value &&
    launchTargetWorktreePath(selectedSession.value || {})
  ));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const launchTargetsPath = computed(() => {
    return sessionId.value ? vibe64LaunchTargetsPath(sessionsApiPath.value, sessionId.value) : "";
  });
  const terminalWindowStorageKey = computed(() => launchTerminalStorageKey(selectedSession.value || {}));
  const terminalDisplayed = computed(() => readRefOrGetterValue(windowDisplayed) !== false);
  const terminal = useStudioTerminal({
    webSocketUrl(terminalId) {
      return vibe64LaunchTerminalWebSocketUrl(sessionId.value, terminalId);
    }
  });
  const {
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalDisplay,
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
    terminalMetadata,
    terminalOutput,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminal;

  const launchTargetsResource = useEndpointResource({
    enabled: canLoadLaunchTargets,
    fallbackLoadError: "Launch targets could not be loaded.",
    path: launchTargetsPath,
    queryKey: computed(() => vibe64LaunchTargetsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      sessionId.value
    )),
    refreshOnPull: true
  });

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: vibe64LaunchTerminalPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      launchTargetId: String(context.launchTargetId || "")
    }),
    fallbackRunError: "Launch target could not be started.",
    messages: {
      error: "Launch target could not be started."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.launch-target.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const stopTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: vibe64LaunchTerminalStopPath(sessionsApiPath.value, context.sessionId, context.terminalSessionId)
    }),
    fallbackRunError: "Launch target could not be stopped.",
    messages: {
      error: "Launch target could not be stopped."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.launch-target.stop",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: vibe64LaunchTerminalPath(sessionsApiPath.value, context.sessionId, context.terminalSessionId)
    }),
    fallbackRunError: "Launch target terminal could not close.",
    messages: {
      error: "Launch target terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.launch-target.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const status = computed(() => launchTargetsResource.data.value || {});
  const launchTargets = computed(() => {
    return Array.isArray(status.value.launchTargets) ? status.value.launchTargets : [];
  });
  const autoStartTarget = computed(() => {
    if (!requestedAutoStartTargetId.value) {
      return null;
    }
    return launchTargets.value.find((target) => (
      target.id === requestedAutoStartTargetId.value &&
      target.available !== false
    )) || null;
  });
  const activeTerminal = computed(() => {
    const terminalStatusValue = status.value.activeTerminal;
    return terminalStatusValue && typeof terminalStatusValue === "object" && !Array.isArray(terminalStatusValue)
      ? terminalStatusValue
      : null;
  });
  const activeLaunchTargetId = computed(() => String(
    terminalMetadata.value.launchTargetId ||
    activeTerminal.value?.metadata?.launchTargetId ||
    ""
  ));
  const activeLaunchTarget = computed(() => {
    return launchTargets.value.find((target) => target.id === activeLaunchTargetId.value) || null;
  });
  const launchActions = computed(() => {
    const actions = terminalMetadata.value.actions || activeTerminal.value?.metadata?.actions || [];
    const previewTarget = status.value.previewTarget || null;
    const browserActions = Array.isArray(actions) ? actions.filter((action) => browserCanOpenTarget(action)) : [];
    if (!previewTarget?.href || !previewTarget.targetHref) {
      return browserActions;
    }
    return browserActions.map((action) => {
      if (String(action.href || "") !== String(previewTarget.targetHref || "")) {
        return action;
      }
      return {
        ...action,
        previewHref: previewTarget.href
      };
    });
  });
  const terminalLaunchReady = computed(() => launchTerminalIsReady({
    ...(activeTerminal.value?.metadata || {}),
    ...(terminalMetadata.value || {})
  }));
  const terminalIsRunning = computed(() => {
    const statusValue = terminalStatus.value || activeTerminal.value?.status || "";
    return statusValue === "running" || statusValue === "closing" || terminalStarting.value;
  });
  const terminalIndicatorState = computed(() => {
    if (terminalStatus.value === "exited" || activeTerminal.value?.status === "exited") {
      const exitCode = terminalExitCode.value ?? activeTerminal.value?.exitCode;
      return exitCode && exitCode !== 0 ? "failed" : "stopped";
    }
    if (terminalIsRunning.value) {
      return terminalLaunchReady.value ? "running" : "starting";
    }
    return "stopped";
  });
  const terminalIndicatorLabel = computed(() => {
    if (terminalIndicatorState.value === "running") {
      return "Server is running";
    }
    if (terminalIndicatorState.value === "starting") {
      return "Server is starting";
    }
    if (terminalIndicatorState.value === "failed") {
      return "Server stopped with an error";
    }
    return "Server is stopped";
  });
  const launchButtonsDisabled = computed(() => Boolean(
    readRefOrGetterValue(busy) ||
    operationBusy.value ||
    terminalIsRunning.value
  ));
  const terminalCanStop = computed(() => {
    return Boolean(terminalSessionId.value && (terminalStatus.value || activeTerminal.value?.status) === "running");
  });
  const terminalCanClose = computed(() => Boolean(
    terminalSessionId.value &&
    !terminalIsRunning.value &&
    (terminalExited.value || activeTerminal.value?.status === "exited")
  ));
  const terminalCanRetry = computed(() => Boolean(
    terminalSessionId.value &&
    !terminalIsRunning.value &&
    activeLaunchTargetId.value
  ));
  const terminalCanRestart = computed(() => Boolean(
    terminalCanStop.value &&
    activeLaunchTargetId.value
  ));
  const terminalCanCopyLog = computed(() => Boolean(terminalOutput.value));
  const terminalVisible = computed(() => Boolean(terminalSessionId.value || activeTerminal.value));
  const terminalDockVisible = computed(() => Boolean(
    terminalDisplayed.value &&
    terminalVisible.value &&
    !terminalExpanded.value
  ));
  const terminalWindowVisible = computed(() => Boolean(
    terminalDisplayed.value &&
    terminalVisible.value &&
    terminalExpanded.value
  ));
  const terminalTitle = computed(() => activeLaunchTarget.value?.label || "Run target");
  const terminalSubtitle = computed(() => {
    if (terminalIsRunning.value) {
      return "Running";
    }
    if (terminalStatus.value === "exited" || activeTerminal.value?.status === "exited") {
      const exitCode = terminalExitCode.value ?? activeTerminal.value?.exitCode;
      return exitCode === 0 ? "Exited" : `Exited with code ${exitCode}`;
    }
    return activeLaunchTargetId.value ? "Ready" : "No launch target running.";
  });
  const visible = computed(() => Boolean(
    (
      canLoadLaunchTargets.value ||
      terminalVisible.value
    ) &&
      (launchTargets.value.length > 0 || launchTargetsResource.loadError.value || terminalVisible.value)
  ));

  async function run(launchTarget = {}, {
    applyDefaultDisplay = true
  } = {}) {
    if (!sessionId.value || launchButtonsDisabled.value || launchTarget.available === false || !launchTarget.id) {
      return false;
    }
    if (applyDefaultDisplay) {
      terminalExpanded.value = launchTarget.defaultDisplay !== "minimized";
    }
    operationBusy.value = true;
    try {
      const terminalSession = await startTerminalCommand.run({
        launchTargetId: launchTarget.id,
        sessionId: sessionId.value
      });
      applyLaunchTerminalSession(terminalSession);
      await connectLaunchTerminal();
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      operationBusy.value = false;
    }
  }

  function applyLaunchTerminalSession(terminalSession = {}) {
    if (!terminalSession || terminalSession.ok === false || !terminalSession.id) {
      return false;
    }
    attachedTerminalId = terminalSession.id;
    applyTerminalSession(terminalSession, {
      fallbackStatus: "running"
    });
    return true;
  }

  async function connectLaunchTerminal() {
    if (!terminalSessionId.value || !terminalDisplayed.value) {
      return false;
    }
    return connectTerminalSocket();
  }

  async function expandTerminal() {
    terminalExpanded.value = true;
    await nextTick();
    if (await setupTerminalUi()) {
      await connectLaunchTerminal();
    }
  }

  function minimizeTerminal() {
    terminalExpanded.value = false;
    disposeTerminalDisplay();
    void connectLaunchTerminal();
  }

  async function refresh() {
    if (!sessionId.value) {
      return null;
    }
    return launchTargetsResource.reload();
  }

  async function stopTerminal() {
    if (!sessionId.value || !terminalCanStop.value) {
      return false;
    }
    operationBusy.value = true;
    try {
      const stopped = await stopTerminalCommand.run({
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      applyLaunchTerminalSession(stopped);
      await refresh();
      await waitForStoppedTerminal();
      return true;
    } catch {
      return false;
    } finally {
      operationBusy.value = false;
    }
  }

  async function waitForStoppedTerminal() {
    for (let attempt = 0; attempt < TERMINAL_STOP_POLL_ATTEMPTS; attempt += 1) {
      if (!terminalIsRunning.value) {
        return true;
      }
      await delay(TERMINAL_STOP_POLL_INTERVAL_MS);
      await refresh();
    }
    return false;
  }

  async function restartTerminal() {
    if (!terminalCanRestart.value) {
      return false;
    }
    const target = activeLaunchTarget.value || launchTargets.value.find((item) => item.id === activeLaunchTargetId.value);
    if (!target) {
      return false;
    }
    await stopTerminal();
    await waitForStoppedTerminal();
    return run(target, {
      applyDefaultDisplay: false
    });
  }

  async function retryTerminal() {
    if (!terminalCanRetry.value) {
      return false;
    }
    const target = activeLaunchTarget.value || launchTargets.value.find((item) => item.id === activeLaunchTargetId.value);
    return target ? run(target, {
      applyDefaultDisplay: false
    }) : false;
  }

  async function closeTerminal() {
    if (!sessionId.value || !terminalCanClose.value) {
      return false;
    }
    operationBusy.value = true;
    try {
      await closeTerminalCommand.run({
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      closeTerminalSocket();
      resetTerminalSessionState();
      resetTerminalDisplay();
      attachedTerminalId = "";
      terminalExpanded.value = false;
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      operationBusy.value = false;
    }
  }

  async function copyLog() {
    if (!terminalOutput.value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(terminalOutput.value);
    return true;
  }

  function openAction(action = {}) {
    return openLaunchBrowserTarget(action, selectedSession.value);
  }

  function setTerminalHost(element) {
    terminalHost.value = element;
    if (!element) {
      return;
    }
    if (terminalExpanded.value) {
      void setupTerminalUi();
      void connectLaunchTerminal();
    }
  }

  watch(activeTerminal, (nextTerminal) => {
    if (!nextTerminal?.id) {
      if (!terminalSessionId.value) {
        attachedTerminalId = "";
      }
      return;
    }
    if (nextTerminal.id !== attachedTerminalId) {
      closeTerminalSocket();
      resetTerminalDisplay();
      attachedTerminalId = nextTerminal.id;
    }
    applyTerminalSession(nextTerminal, {
      fallbackStatus: nextTerminal.status || "running"
    });
    void connectLaunchTerminal();
  }, {
    immediate: true
  });

  watch(terminalExpanded, async (expanded) => {
    if (expanded) {
      await nextTick();
      if (await setupTerminalUi()) {
        await connectLaunchTerminal();
      }
    } else {
      disposeTerminalDisplay();
      void connectLaunchTerminal();
    }
  });

  watch(terminalDisplayed, (displayed) => {
    if (displayed) {
      void refresh();
      void connectLaunchTerminal();
      return;
    }
    closeTerminalSocket();
    disposeTerminalDisplay();
  });

  watch(sessionId, () => {
    attachedTerminalId = "";
    autoStartKey.value = "";
    closeTerminalSocket();
    disposeTerminalDisplay();
    resetTerminalSessionState();
    resetTerminalDisplay();
    terminalExpanded.value = false;
  });

  watch(() => [
    sessionId.value,
    terminalLaunchReady.value ? "ready" : "not-ready"
  ].join("|"), () => {
    if (terminalLaunchReady.value) {
      void refresh();
    }
  }, {
    immediate: true
  });

  watch(() => [
    sessionId.value,
    requestedAutoStartTargetId.value,
    launchTargetsResource.isLoading.value ? "loading" : "ready",
    terminalVisible.value ? "terminal-visible" : "terminal-hidden",
    operationBusy.value ? "busy" : "idle",
    autoStartTarget.value?.id || ""
  ].join("|"), () => {
    const target = autoStartTarget.value;
    const key = `${sessionId.value}:${target?.id || ""}`;
    if (
      !sessionId.value ||
      !target ||
      launchTargetsResource.isLoading.value ||
      terminalVisible.value ||
      operationBusy.value ||
      autoStartKey.value === key
    ) {
      return;
    }
    autoStartKey.value = key;
    void run(target, {
      applyDefaultDisplay: false
    });
  }, {
    flush: "post",
    immediate: true
  });

  onBeforeUnmount(() => {
    disposeTerminalUi();
  });

  return {
    activeLaunchTarget,
    activeLaunchTargetId,
    activeTerminal,
    closeTerminal,
    copyLog,
    expandTerminal,
    launchActions,
    launchButtonsDisabled,
    launchTargets,
    loading: launchTargetsResource.isLoading,
    loadError: launchTargetsResource.loadError,
    minimizeTerminal,
    openAction,
    operationBusy,
    refresh,
    restartTerminal,
    retryTerminal,
    run,
    sendCtrlC,
    setTerminalHost,
    stopTerminal,
    terminalCanClose,
    terminalCanCopyLog,
    terminalCanRestart,
    terminalCanRetry,
    terminalCanStop,
    terminalCommandPreview,
    terminalDisplayed,
    terminalDockVisible,
    terminalError,
    terminalExpanded,
    terminalExited,
    terminalExitCode,
    terminalHost,
    terminalIndicatorLabel,
    terminalIndicatorState,
    terminalIsRunning,
    terminalLaunchReady,
    terminalMetadata,
    terminalOutput,
    terminalSessionId,
    terminalStarting,
    terminalStatus,
    terminalSubtitle,
    terminalTitle,
    terminalVisible,
    terminalWindowVisible,
    terminalWindowStorageKey,
    visible
  };
}

export {
  browserCanOpenTarget,
  launchBrowserTargetName,
  launchPreviewBaseUrl,
  launchPreviewDisplayUrl,
  launchPreviewToolbarStorageKey,
  launchPreviewUrl,
  launchTargetWorktreePath,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget,
  useVibe64LaunchControls
};
