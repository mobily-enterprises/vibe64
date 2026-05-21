import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioLaunchTargetOpenPath,
  aiStudioLaunchTargetsPath,
  aiStudioLaunchTargetsQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  aiStudioSessionWorktreePath
} from "@/lib/aiStudioSessionPaths.js";
import {
  readLocalStorageJson,
  stableLocalStorageKeyPart,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

const LAUNCH_BROWSER_WINDOW_FEATURES = "popup,width=1400,height=900,left=80,top=60";

function browserCanOpenTarget(target = {}) {
  return String(target.kind || "url") === "url" && Boolean(String(target.href || "").trim());
}

function launchBrowserTargetName(session = {}) {
  const source = session?.targetRoot || session?.worktree || session?.sessionRoot || session?.sessionId || "target";
  return `ai-studio-launch-${stableLocalStorageKeyPart(source)}`;
}

function launchTerminalStorageKey(session = {}) {
  return `ai-studio:floating-terminal:launch:${launchBrowserTargetName(session)}`;
}

function launchTerminalMinimizedStorageKey(session = {}) {
  return `${launchTerminalStorageKey(session)}:minimized`;
}

function readStoredLaunchTerminalMinimized(session = {}) {
  const state = readLocalStorageJson(launchTerminalMinimizedStorageKey(session), {});
  return state?.minimized === true;
}

function writeStoredLaunchTerminalMinimized(session = {}, minimized = false) {
  writeLocalStorageJson(launchTerminalMinimizedStorageKey(session), {
    minimized: minimized === true
  });
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
  return aiStudioSessionWorktreePath(session);
}

function useAiStudioLaunchControls({
  busy = () => false,
  session = null
} = {}) {
  const paths = usePaths();
  const activeLaunchTarget = ref(null);
  const startKey = ref("");
  const terminalMinimized = ref(false);
  const terminalRunning = ref(false);
  const terminalVisible = ref(false);
  const openedReadyTerminalIds = new Set();
  let pendingBrowserWindow = null;

  const selectedSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(selectedSession.value?.sessionId || ""));
  const canLoadLaunchTargets = computed(() => Boolean(
    sessionId.value &&
    launchTargetWorktreePath(selectedSession.value || {})
  ));
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));
  const launchTargetsPath = computed(() => {
    return sessionId.value ? aiStudioLaunchTargetsPath(sessionsApiPath.value, sessionId.value) : "";
  });
  const terminalWindowStorageKey = computed(() => launchTerminalStorageKey(selectedSession.value || {}));

  const launchTargetsResource = useEndpointResource({
    enabled: canLoadLaunchTargets,
    fallbackLoadError: "Launch targets could not be loaded.",
    path: launchTargetsPath,
    queryKey: computed(() => aiStudioLaunchTargetsQueryKey(
      AI_STUDIO_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      sessionId.value
    )),
    refreshOnPull: true
  });

  const openTargetCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioLaunchTargetOpenPath(sessionsApiPath.value, context.sessionId)
    }),
    fallbackRunError: "Launch target could not be opened.",
    messages: {
      error: "Launch target could not be opened."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.launch-target.open",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const status = computed(() => launchTargetsResource.data.value || {});
  const launchTargets = computed(() => {
    return Array.isArray(status.value.launchTargets) ? status.value.launchTargets : [];
  });
  const openTarget = computed(() => status.value.openTarget || {
    available: false,
    disabledReason: "Run a launch target first.",
    href: "",
    kind: "url",
    label: "Open browser"
  });
  const showOpenTarget = computed(() => {
    return Boolean(openTarget.value.available && browserCanOpenTarget(openTarget.value));
  });
  const visible = computed(() => Boolean(
    (
      canLoadLaunchTargets.value ||
      terminalVisible.value
    ) &&
      (launchTargets.value.length > 0 || launchTargetsResource.loadError.value || terminalVisible.value)
  ));
  const launchButtonsDisabled = computed(() => Boolean(readRefOrGetterValue(busy) || terminalRunning.value));
  const openDisabled = computed(() => {
    return Boolean(
      readRefOrGetterValue(busy) ||
      openTargetCommand.isRunning ||
      !openTarget.value.available ||
      !browserCanOpenTarget(openTarget.value)
    );
  });
  const openTitle = computed(() => {
    if (readRefOrGetterValue(busy)) {
      return "Wait for the current Studio action to finish.";
    }
    if (!browserCanOpenTarget(openTarget.value)) {
      return openTarget.value.disabledReason || "Run a launch target first.";
    }
    return openTarget.value.href;
  });

  function run(launchTarget = {}) {
    if (!sessionId.value || launchButtonsDisabled.value || launchTarget.available === false || !launchTarget.id) {
      return;
    }
    pendingBrowserWindow = openPendingLaunchBrowserWindow(selectedSession.value);
    activeLaunchTarget.value = launchTarget;
    terminalMinimized.value = readStoredLaunchTerminalMinimized(selectedSession.value || {});
    terminalVisible.value = true;
    startKey.value = `${sessionId.value}:launch:${launchTarget.id}:${Date.now()}`;
  }

  async function open() {
    if (!sessionId.value || openDisabled.value) {
      return;
    }
    try {
      const response = await openTargetCommand.run({
        sessionId: sessionId.value
      });
      const target = response?.target || {};
      openLaunchBrowserTarget(target, selectedSession.value);
    } catch {
      // useCommand owns the user-visible error message.
    }
  }

  function closeTerminal() {
    activeLaunchTarget.value = null;
    startKey.value = "";
    terminalMinimized.value = false;
    terminalRunning.value = false;
    terminalVisible.value = false;
  }

  async function refresh() {
    if (!sessionId.value) {
      return null;
    }
    return launchTargetsResource.reload();
  }

  async function handleStarted() {
    await refresh().catch(() => null);
  }

  async function handleReady(payload = {}) {
    const terminalSessionId = String(payload.terminalSessionId || "");
    if (!terminalSessionId || openedReadyTerminalIds.has(terminalSessionId)) {
      return;
    }
    openedReadyTerminalIds.add(terminalSessionId);
    await refresh().catch(() => null);
    const target = payload.metadata?.openTarget || openTarget.value || {};
    pendingBrowserWindow = openReadyLaunchBrowserTarget(target, selectedSession.value, pendingBrowserWindow);
  }

  function handleRunningChanged(nextRunning) {
    terminalRunning.value = Boolean(nextRunning);
  }

  function handleTerminalExpandedChanged(expanded) {
    terminalMinimized.value = expanded !== true;
    writeStoredLaunchTerminalMinimized(selectedSession.value || {}, terminalMinimized.value);
    if (terminalMinimized.value && typeof document !== "undefined") {
      document.activeElement?.blur?.();
    }
  }

  watch(sessionId, () => {
    openedReadyTerminalIds.clear();
    pendingBrowserWindow = null;
    closeTerminal();
  });

  return {
    activeLaunchTarget,
    closeTerminal,
    handleRunningChanged,
    handleReady,
    handleTerminalExpandedChanged,
    handleStarted,
    launchButtonsDisabled,
    launchTargets,
    loading: launchTargetsResource.isLoading,
    loadError: launchTargetsResource.loadError,
    open,
    openDisabled,
    openTarget,
    openTargetCommand,
    openTitle,
    refresh,
    run,
    showOpenTarget,
    startKey,
    terminalMinimized,
    terminalRunning,
    terminalWindowStorageKey,
    terminalVisible,
    visible
  };
}

export {
  browserCanOpenTarget,
  launchTargetWorktreePath,
  launchBrowserTargetName,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget,
  useAiStudioLaunchControls
};
