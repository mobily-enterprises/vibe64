import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
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
  readLocalStorageJson,
  stableLocalStorageKeyPart,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  vibe64RealtimeOriginPayload,
  vibe64RealtimePayloadFromCurrentTab
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  currentProjectSlugFromLocation,
  vibe64ProjectScopedStorageKey
} from "@/lib/vibe64ProjectScope.js";
import {
  normalizePreviewInput,
  previewInputHasValues
} from "@/lib/vibe64PreviewOptions.js";

const LAUNCH_BROWSER_WINDOW_FEATURES = "popup,width=1400,height=900,left=80,top=60";
const LAUNCH_PREVIEW_TOOLBAR_POSITIONS = Object.freeze(["left", "center", "right"]);
const AUTO_START_ATTEMPT_COOLDOWN_MS = 7000;
const AUTO_START_STABILITY_DELAY_MS = 750;
const TERMINAL_STOP_POLL_INTERVAL_MS = 100;
const TERMINAL_STOP_POLL_ATTEMPTS = 50;
const LAUNCH_TARGETS_REALTIME_REASONS = new Set([
  "launch-target-started",
  "launch-target-ready",
  "launch-target-closed",
  "launch-target-stopped",
  "launch-target-stale-cleared"
]);

function browserCanOpenTarget(target = {}) {
  return String(target.kind || "url") === "url" && Boolean(String(target.href || "").trim());
}

function launchBrowserTargetName(session = {}, projectSlug = currentProjectSlugFromLocation()) {
  const source = session?.targetRoot || session?.worktree || session?.sessionRoot || session?.sessionId || "target";
  return `vibe64-launch-${stableLocalStorageKeyPart(`${projectSlug || ""}:${source}`)}`;
}

function launchTerminalStorageKey(session = {}, projectSlug = currentProjectSlugFromLocation()) {
  return vibe64ProjectScopedStorageKey(
    `vibe64:floating-terminal:launch:${launchBrowserTargetName(session, projectSlug)}`,
    projectSlug
  );
}

function launchPreviewToolbarStorageKey(session = {}, projectSlug = currentProjectSlugFromLocation()) {
  return vibe64ProjectScopedStorageKey(
    `vibe64:launch-preview-toolbar:${launchBrowserTargetName(session, projectSlug)}`,
    projectSlug
  );
}

function launchPreviewLocationStorageKey(session = {}, projectSlug = currentProjectSlugFromLocation()) {
  return vibe64ProjectScopedStorageKey(
    `vibe64:launch-preview-location:${launchBrowserTargetName(session, projectSlug)}`,
    projectSlug
  );
}

function launchPreviewOptionsStorageKey(
  session = {},
  projectSlug = currentProjectSlugFromLocation(),
  launchTargetId = ""
) {
  const targetId = stableLocalStorageKeyPart(String(launchTargetId || ""));
  return vibe64ProjectScopedStorageKey(
    `vibe64:launch-preview-options:${launchBrowserTargetName(session, projectSlug)}:${targetId}`,
    projectSlug
  );
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

function openLaunchBrowserTarget(
  target = {},
  session = {},
  browserWindow = null,
  projectSlug = currentProjectSlugFromLocation()
) {
  if (!browserCanOpenTarget(target)) {
    return null;
  }
  const activeWindow = browserWindow || (typeof window !== "undefined" ? window : null);
  if (!activeWindow?.open) {
    return null;
  }

  const href = launchBrowserTargetHref(target, activeWindow);
  const openedWindow = activeWindow.open(
    href,
    launchBrowserTargetName(session, projectSlug),
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

function launchBrowserTargetHref(target = {}, browserWindow = null) {
  const targetHref = String(target.href || "").trim();
  const previewHref = String(target.previewHref || "").trim();
  const studioHref = String(browserWindow?.location?.href || localPreviewBrowserHref()).trim();

  if (previewHref && remoteStudioCannotEmbedLoopbackTarget(targetHref, studioHref)) {
    return sameSiteLoopbackPreviewUrl(previewHref, studioHref);
  }

  return sameSiteLoopbackPreviewUrl(targetHref, studioHref);
}

function openPendingLaunchBrowserWindow(
  session = {},
  browserWindow = null,
  projectSlug = currentProjectSlugFromLocation()
) {
  const activeWindow = browserWindow || (typeof window !== "undefined" ? window : null);
  if (!activeWindow?.open) {
    return null;
  }
  const openedWindow = activeWindow.open(
    "about:blank",
    launchBrowserTargetName(session, projectSlug),
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

function openReadyLaunchBrowserTarget(
  target = {},
  session = {},
  pendingWindow = null,
  projectSlug = currentProjectSlugFromLocation()
) {
  if (!browserCanOpenTarget(target)) {
    return null;
  }
  if (pendingWindow && pendingWindow.closed !== true) {
    try {
      pendingWindow.location.href = launchBrowserTargetHref(target);
      if (typeof pendingWindow.focus === "function") {
        pendingWindow.focus();
      }
      return pendingWindow;
    } catch {
      // Fall back to opening the named target below.
    }
  }
  return openLaunchBrowserTarget(target, session, null, projectSlug);
}

function launchTargetWorktreePath(session = {}) {
  return vibe64SessionWorktreePath(session);
}

function launchControlsCanLoadTargets({
  displayed = true,
  session = {}
} = {}) {
  return Boolean(
    displayed &&
    String(session?.sessionId || "").trim() &&
    launchTargetWorktreePath(session)
  );
}

function launchControlScopeKey(projectSlug = "", sessionId = "") {
  return `${String(projectSlug || "").trim()}::${String(sessionId || "").trim()}`;
}

function launchTargetsRealtimeShouldRefresh({
  localLaunchStarting = false,
  payload = {}
} = {}, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!normalizedSessionId || changedSessionId !== normalizedSessionId) {
    return false;
  }
  const reason = String(payload.reason || "").trim();
  if (
    reason === "launch-target-started" &&
    (localLaunchStarting || vibe64RealtimePayloadFromCurrentTab(payload))
  ) {
    return false;
  }
  return !reason || LAUNCH_TARGETS_REALTIME_REASONS.has(reason);
}

function shouldScheduleLaunchAutoStart({
  autoStartKey = "",
  key = "",
  launchButtonsDisabled = false,
  loading = false,
  operationBusy = false,
  sessionId = "",
  target = null,
  terminalDisplayed = true,
  terminalVisible = false
} = {}) {
  return Boolean(
    sessionId &&
    target &&
    key &&
    !loading &&
    !terminalVisible &&
    !operationBusy &&
    terminalDisplayed &&
    !launchButtonsDisabled &&
    autoStartKey !== key
  );
}

function autoStartLaunchTargetsLoading({
  launchTargetsLoading = false,
  launchTargetsSettled = false
} = {}) {
  return Boolean(launchTargetsLoading || !launchTargetsSettled);
}

function browserSessionStorage() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  return window.sessionStorage;
}

function launchAutoStartAttemptStorageKey(key = "") {
  const normalized = String(key || "").trim();
  return normalized ? `vibe64:launch-auto-start:${stableLocalStorageKeyPart(normalized)}` : "";
}

function readLaunchAutoStartAttemptCooldown(key = "", {
  now = Date.now(),
  storage = browserSessionStorage()
} = {}) {
  const storageKey = launchAutoStartAttemptStorageKey(key);
  if (!storageKey || !storage) {
    return 0;
  }
  try {
    const record = JSON.parse(storage.getItem(storageKey) || "null");
    const startedAt = Number(record?.startedAt || 0);
    if (String(record?.key || "") !== String(key || "") || !Number.isFinite(startedAt) || startedAt <= 0) {
      clearLaunchAutoStartAttempt(key, { storage });
      return 0;
    }
    const remainingMs = AUTO_START_ATTEMPT_COOLDOWN_MS - (Number(now) - startedAt);
    if (remainingMs <= 0) {
      clearLaunchAutoStartAttempt(key, { storage });
      return 0;
    }
    return remainingMs;
  } catch {
    clearLaunchAutoStartAttempt(key, { storage });
    return 0;
  }
}

function writeLaunchAutoStartAttempt(key = "", {
  now = Date.now(),
  storage = browserSessionStorage()
} = {}) {
  const storageKey = launchAutoStartAttemptStorageKey(key);
  if (!storageKey || !storage) {
    return false;
  }
  try {
    storage.setItem(storageKey, JSON.stringify({
      key: String(key || ""),
      startedAt: Number(now)
    }));
    return true;
  } catch {
    return false;
  }
}

function clearLaunchAutoStartAttempt(key = "", {
  storage = browserSessionStorage()
} = {}) {
  const storageKey = launchAutoStartAttemptStorageKey(key);
  if (!storageKey || !storage) {
    return;
  }
  try {
    storage.removeItem(storageKey);
  } catch {
    // Browser storage can be unavailable in private or constrained contexts.
  }
}

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function launchTerminalIsReady(metadata = {}) {
  return metadata?.launchReady === true || metadata?.launchReady === "true";
}

function launchPreviewRequiresProxy(metadata = {}) {
  return Boolean(String(metadata?.previewAuth || "").trim());
}

function terminalSessionMissingError(message = "") {
  return /terminal session not found/iu.test(String(message || ""));
}

function localPreviewBrowserHref() {
  if (typeof window === "undefined") {
    return "";
  }
  return String(window.location?.href || "");
}

function launchPreviewBaseUrl(actions = [], {
  requirePreviewProxy = false,
  studioHref = localPreviewBrowserHref()
} = {}) {
  const previewAction = Array.isArray(actions) ? actions.find((action) => browserCanOpenTarget(action)) : null;
  const previewHref = String(previewAction?.previewHref || "").trim();
  if (previewHref) {
    if (remoteStudioCannotEmbedLoopbackTarget(previewHref, studioHref)) {
      return "";
    }
    return sameSiteLoopbackPreviewUrl(previewHref, studioHref);
  }
  if (requirePreviewProxy) {
    return "";
  }
  const targetHref = String(previewAction?.href || "").trim();
  if (remoteStudioCannotEmbedLoopbackTarget(targetHref, studioHref)) {
    return "";
  }
  return sameSiteLoopbackPreviewUrl(
    targetHref,
    studioHref
  );
}

function launchPreviewDisplayUrl(actions = [], {
  studioHref = localPreviewBrowserHref()
} = {}) {
  const previewAction = Array.isArray(actions) ? actions.find((action) => browserCanOpenTarget(action)) : null;
  const targetHref = String(previewAction?.href || "").trim();
  const previewHref = String(previewAction?.previewHref || "").trim();
  if (previewHref && remoteStudioCannotEmbedLoopbackTarget(targetHref, studioHref)) {
    return sameSiteLoopbackPreviewUrl(previewHref, studioHref);
  }
  return targetHref;
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
  try {
    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("vibe64_reload", String(reloadKey));
    return url.toString();
  } catch {
    // Fall through to the string-only path for relative or otherwise non-URL input.
  }
  const separator = normalizedBaseUrl.includes("?") ? "&" : "?";
  return `${normalizedBaseUrl}${separator}vibe64_reload=${reloadKey}`;
}

function normalizeLaunchPreview(preview = {}) {
  const source = preview && typeof preview === "object" && !Array.isArray(preview) ? preview : {};
  const state = [
    "idle",
    "starting",
    "ready",
    "stale",
    "stopped",
    "failed",
    "project_closed"
  ].includes(source.state) ? source.state : "idle";
  const fallbackMessage = state === "idle"
    ? "Run a launch target first."
    : state === "starting"
      ? "Preparing preview."
      : state === "ready"
        ? "Preview is ready."
        : state === "stale"
          ? "Server-side app files changed after this preview started."
          : state === "project_closed"
            ? "Project is closed."
            : "Preview could not be opened.";
  const recovery = source.recovery && typeof source.recovery === "object" && !Array.isArray(source.recovery)
    ? source.recovery
    : null;
  return {
    canRestart: source.canRestart === true,
    canShowLog: source.canShowLog === true,
    canStart: source.canStart === true,
    href: String(source.href || "").trim(),
    message: String(source.message || fallbackMessage).trim() || fallbackMessage,
    reason: String(source.reason || "").trim(),
    recovery,
    state,
    targetHref: String(source.targetHref || "").trim(),
    terminalId: String(source.terminalId || "").trim()
  };
}

function sameSiteLoopbackPreviewUrl(previewHref = "", studioHref = "") {
  const previewText = String(previewHref || "").trim();
  const studioText = String(studioHref || "").trim();
  if (!previewText || !studioText) {
    return previewText;
  }
  try {
    const previewUrl = new URL(previewText);
    const studioUrl = new URL(studioText);
    if (
      previewUrl.protocol !== studioUrl.protocol ||
      !isLoopbackBrowserHost(previewUrl.hostname) ||
      !isLoopbackBrowserHost(studioUrl.hostname) ||
      previewUrl.hostname === studioUrl.hostname
    ) {
      return previewText;
    }
    previewUrl.hostname = studioUrl.hostname;
    return previewUrl.toString();
  } catch {
    return previewText;
  }
}

function remoteStudioCannotEmbedLoopbackTarget(previewHref = "", studioHref = "") {
  const previewText = String(previewHref || "").trim();
  const studioText = String(studioHref || "").trim();
  if (!previewText || !studioText) {
    return false;
  }
  try {
    const previewUrl = new URL(previewText);
    const studioUrl = new URL(studioText);
    return isLoopbackBrowserHost(previewUrl.hostname) && !isLoopbackBrowserHost(studioUrl.hostname);
  } catch {
    return false;
  }
}

function isLoopbackBrowserHost(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

function useVibe64LaunchControls({
  autoStartTargetId = () => "",
  busy = () => false,
  session = null,
  windowDisplayed = () => true
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const operationBusy = ref(false);
  const launchStarting = ref(false);
  const terminalExpanded = ref(false);
  const autoStartKey = ref("");
  const previewInputOverrides = ref({});
  const autoStartCooldownVersion = ref(0);
  const launchStatusAttempt = ref(0);
  const launchTargetsSettledForAutoStart = ref(false);
  let attachedTerminalId = "";
  let autoStartTimer = 0;
  let autoStartCooldownTimer = 0;
  let scheduledAutoStartKey = "";
  let launchStatusAttemptLoading = false;
  let launchStatusAttemptScopeKey = "";
  let launchTargetsRefreshInFlight = null;

  const selectedSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(selectedSession.value?.sessionId || ""));
  const launchScopeKey = computed(() => launchControlScopeKey(projectSlug.value, sessionId.value));
  const requestedAutoStartTargetId = computed(() => String(readRefOrGetterValue(autoStartTargetId) || "").trim());
  const terminalDisplayed = computed(() => readRefOrGetterValue(windowDisplayed) !== false);
  const canLoadLaunchTargets = computed(() => launchControlsCanLoadTargets({
    displayed: terminalDisplayed.value,
    session: selectedSession.value || {}
  }));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const launchTargetsPath = computed(() => {
    return sessionId.value ? vibe64LaunchTargetsPath(sessionsApiPath.value, sessionId.value) : "";
  });
  const terminalWindowStorageKey = computed(() => launchTerminalStorageKey(
    selectedSession.value || {},
    projectSlug.value
  ));
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
  let disposed = false;

  const launchTargetsResource = useEndpointResource({
    enabled: canLoadLaunchTargets,
    fallbackLoadError: "Launch targets could not be loaded.",
    path: launchTargetsPath,
    queryKey: computed(() => vibe64LaunchTargetsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      sessionId.value,
      projectSlug.value
    )),
    refreshOnPull: true,
    requestRecovery: false,
    realtime: null
  });

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64LaunchTerminalPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      ...vibe64RealtimeOriginPayload(),
      ...(context.forceRestart === true ? { forceRestart: true } : {}),
      launchInput: context.launchInput || {},
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
  const preview = computed(() => normalizeLaunchPreview(status.value.preview || {}));
  const previewState = computed(() => preview.value.state);
  const previewMessage = computed(() => preview.value.message);
  const previewHref = computed(() => preview.value.href);
  const previewTargetHref = computed(() => preview.value.targetHref);
  const previewCanRestart = computed(() => preview.value.canRestart);
  const previewCanShowLog = computed(() => preview.value.canShowLog);
  const previewCanStart = computed(() => preview.value.canStart);
  const previewRecovery = computed(() => preview.value.recovery);
  const previewTarget = computed(() => (
    status.value.previewTarget && typeof status.value.previewTarget === "object" && !Array.isArray(status.value.previewTarget)
      ? status.value.previewTarget
      : null
  ));
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
    status.value.lastLaunchTarget?.id ||
    ""
  ));
  const activeLaunchTarget = computed(() => {
    return launchTargets.value.find((target) => target.id === activeLaunchTargetId.value) || null;
  });
  const launchActions = computed(() => {
    const actions = terminalMetadata.value.actions || activeTerminal.value?.metadata?.actions || [];
    const targetHref = previewTargetHref.value || String(previewTarget.value?.targetHref || "").trim();
    const iframeHref = previewHref.value || String(previewTarget.value?.href || "").trim();
    const browserActions = Array.isArray(actions) ? actions.filter((action) => browserCanOpenTarget(action)) : [];
    if (browserActions.length < 1 && iframeHref && targetHref) {
      return [
        {
          href: targetHref,
          kind: previewTarget.value?.kind || "url",
          label: previewTarget.value?.label || "Preview",
          previewHref: iframeHref
        }
      ];
    }
    if (!iframeHref || !targetHref) {
      return browserActions;
    }
    return browserActions.map((action) => {
      if (String(action.href || "") !== targetHref) {
        return action;
      }
      return {
        ...action,
        previewHref: iframeHref
      };
    });
  });
  const terminalLaunchReady = computed(() => launchTerminalIsReady({
    ...(activeTerminal.value?.metadata || {}),
    ...(terminalMetadata.value || {})
  }));
  const terminalPreviewRequiresProxy = computed(() => launchPreviewRequiresProxy({
    ...(activeTerminal.value?.metadata || {}),
    ...(terminalMetadata.value || {})
  }));
  const previewTargetDisabledReason = computed(() => (
    !["ready", "stale"].includes(previewState.value)
      ? previewMessage.value
      : ""
  ));
  const previewTargetRecovery = computed(() => previewRecovery.value);
  const terminalIsRunning = computed(() => {
    const statusValue = terminalStatus.value || activeTerminal.value?.status || "";
    return statusValue === "running" || statusValue === "closing" || terminalStarting.value;
  });
  const terminalPreviewProxyPending = computed(() => Boolean(
    terminalPreviewRequiresProxy.value &&
    terminalLaunchReady.value &&
    terminalIsRunning.value &&
    !previewHref.value
  ));
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
  const launchTargetsLoadingForAutoStart = computed(() => autoStartLaunchTargetsLoading({
    launchTargetsLoading: launchTargetsResource.isLoading.value,
    launchTargetsSettled: launchTargetsSettledForAutoStart.value
  }));
  const terminalCanStop = computed(() => {
    return Boolean(terminalSessionId.value && (terminalStatus.value || activeTerminal.value?.status) === "running");
  });
  const terminalCanClose = computed(() => Boolean(
    terminalSessionId.value &&
    !terminalIsRunning.value &&
    (terminalExited.value || activeTerminal.value?.status === "exited")
  ));
  const terminalCanRetry = computed(() => Boolean(
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

  function previewOptionsStorageKeyForTarget(launchTarget = {}) {
    return launchPreviewOptionsStorageKey(
      selectedSession.value || {},
      projectSlug.value,
      launchTarget.id
    );
  }

  function storedLaunchInputForTarget(launchTarget = {}) {
    return readLocalStorageJson(previewOptionsStorageKeyForTarget(launchTarget), null);
  }

  function previewInputIsRemembered(launchTarget = {}) {
    return storedLaunchInputForTarget(launchTarget) !== null;
  }

  function launchInputForTarget(launchTarget = {}) {
    const targetId = String(launchTarget?.id || "");
    const override = targetId ? previewInputOverrides.value[targetId] : null;
    return normalizePreviewInput(
      launchTarget,
      override || storedLaunchInputForTarget(launchTarget) || {}
    );
  }

  function savePreviewInput(launchTarget = {}, launchInput = {}, {
    remember = false
  } = {}) {
    const targetId = String(launchTarget?.id || "");
    if (!targetId) {
      return normalizePreviewInput(launchTarget, launchInput);
    }
    const normalizedInput = normalizePreviewInput(launchTarget, launchInput);
    previewInputOverrides.value = {
      ...previewInputOverrides.value,
      [targetId]: normalizedInput
    };
    writeLocalStorageJson(
      previewOptionsStorageKeyForTarget(launchTarget),
      remember && previewInputHasValues(normalizedInput) ? normalizedInput : null
    );
    return normalizedInput;
  }

  async function run(launchTarget = {}, {
    applyDefaultDisplay = true,
    forceRestart = false,
    launchInput = null
  } = {}) {
    if (
      !sessionId.value ||
      !terminalDisplayed.value ||
      (!forceRestart && launchButtonsDisabled.value) ||
      launchTarget.available === false ||
      !launchTarget.id
    ) {
      return false;
    }
    const startedScopeKey = launchScopeKey.value;
    if (applyDefaultDisplay) {
      terminalExpanded.value = launchTarget.defaultDisplay !== "minimized";
    }
    launchStarting.value = true;
    operationBusy.value = true;
    try {
      const terminalSession = await startTerminalCommand.run({
        forceRestart,
        launchInput: normalizePreviewInput(launchTarget, launchInput || launchInputForTarget(launchTarget)),
        launchTargetId: launchTarget.id,
        sessionId: sessionId.value
      });
      if (disposed || startedScopeKey !== launchScopeKey.value) {
        return false;
      }
      applyLaunchTerminalSession(terminalSession);
      void connectLaunchTerminal();
      return true;
    } catch {
      return false;
    } finally {
      launchStarting.value = false;
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

  async function refresh({
    scopeKey = launchScopeKey.value
  } = {}) {
    if (!canLoadLaunchTargets.value) {
      return null;
    }
    const refreshScopeKey = String(scopeKey || "").trim();
    if (!refreshScopeKey) {
      return null;
    }
    if (launchTargetsRefreshInFlight?.scopeKey === refreshScopeKey) {
      return launchTargetsRefreshInFlight.promise;
    }
    const refreshPromise = typeof launchTargetsResource.query?.refetch === "function"
      ? launchTargetsResource.query.refetch({
          cancelRefetch: false
        })
      : launchTargetsResource.reload();
    launchTargetsRefreshInFlight = {
      promise: refreshPromise,
      scopeKey: refreshScopeKey
    };
    try {
      return await refreshPromise;
    } finally {
      if (launchTargetsRefreshInFlight?.promise === refreshPromise) {
        launchTargetsRefreshInFlight = null;
      }
    }
  }

  useRealtimeEvent({
    enabled: canLoadLaunchTargets,
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: (context) => launchTargetsRealtimeShouldRefresh({
      localLaunchStarting: launchStarting.value,
      payload: context?.payload || {}
    }, sessionId.value),
    onEvent: () => refresh({
      scopeKey: launchScopeKey.value
    })
  });

  function clearAutoStartTimer() {
    if (autoStartTimer && typeof window !== "undefined") {
      window.clearTimeout(autoStartTimer);
    }
    autoStartTimer = 0;
    scheduledAutoStartKey = "";
  }

  function clearAutoStartCooldownTimer() {
    if (autoStartCooldownTimer && typeof window !== "undefined") {
      window.clearTimeout(autoStartCooldownTimer);
    }
    autoStartCooldownTimer = 0;
  }

  function resetLaunchTargetsAutoStartSettlement() {
    launchTargetsSettledForAutoStart.value = false;
  }

  function scheduleAutoStartCooldownCheck(remainingMs = 0) {
    clearAutoStartCooldownTimer();
    if (typeof window === "undefined") {
      return;
    }
    autoStartCooldownTimer = window.setTimeout(() => {
      autoStartCooldownTimer = 0;
      autoStartCooldownVersion.value += 1;
    }, Math.max(0, Number(remainingMs) || 0) + 50);
  }

  function clearStaleLaunchTerminal() {
    attachedTerminalId = "";
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
  }

  async function stopTerminal() {
    if (!sessionId.value || (!terminalCanStop.value && !terminalSessionId.value)) {
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
    return run(target, {
      applyDefaultDisplay: false,
      forceRestart: true
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
    return openLaunchBrowserTarget(action, selectedSession.value, null, projectSlug.value);
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
      clearStaleLaunchTerminal();
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

  watch(terminalError, (message) => {
    if (!terminalSessionMissingError(message)) {
      return;
    }
    clearStaleLaunchTerminal();
    void refresh();
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
      void connectLaunchTerminal();
      return;
    }
    clearAutoStartTimer();
    resetLaunchTargetsAutoStartSettlement();
    closeTerminalSocket();
    disposeTerminalDisplay();
  });

  watch(launchScopeKey, () => {
    attachedTerminalId = "";
    autoStartKey.value = "";
    previewInputOverrides.value = {};
    launchStatusAttempt.value = 0;
    launchStatusAttemptLoading = false;
    launchStatusAttemptScopeKey = launchScopeKey.value;
    resetLaunchTargetsAutoStartSettlement();
    clearAutoStartTimer();
    closeTerminalSocket();
    disposeTerminalDisplay();
    resetTerminalSessionState();
    resetTerminalDisplay();
    terminalExpanded.value = false;
  });

  watch(() => [
    launchScopeKey.value,
    canLoadLaunchTargets.value ? "loadable" : "blocked",
    launchTargetsResource.isLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    const scopeKey = launchScopeKey.value;
    if (!scopeKey || !canLoadLaunchTargets.value) {
      launchStatusAttempt.value = 0;
      launchStatusAttemptScopeKey = scopeKey;
      launchStatusAttemptLoading = false;
      return;
    }
    if (launchStatusAttemptScopeKey !== scopeKey) {
      launchStatusAttempt.value = 0;
      launchStatusAttemptScopeKey = scopeKey;
      launchStatusAttemptLoading = false;
    }
    if (launchTargetsResource.isLoading.value && !launchStatusAttemptLoading) {
      launchStatusAttempt.value += 1;
      launchStatusAttemptLoading = true;
      return;
    }
    if (!launchTargetsResource.isLoading.value) {
      launchStatusAttemptLoading = false;
    }
  }, {
    flush: "sync",
    immediate: true
  });

  watch(() => [
    projectSlug.value,
    sessionId.value,
    requestedAutoStartTargetId.value,
    canLoadLaunchTargets.value ? "loadable" : "blocked",
    readRefOrGetterValue(busy) ? "busy" : "idle",
    launchTargetsResource.isLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    const scopeKey = launchScopeKey.value;
    if (!scopeKey || !requestedAutoStartTargetId.value || !canLoadLaunchTargets.value || readRefOrGetterValue(busy)) {
      resetLaunchTargetsAutoStartSettlement();
      return;
    }
    if (launchTargetsResource.isLoading.value) {
      launchTargetsSettledForAutoStart.value = false;
      return;
    }
    launchTargetsSettledForAutoStart.value = true;
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    projectSlug.value,
    sessionId.value,
    requestedAutoStartTargetId.value,
    launchTargetsLoadingForAutoStart.value ? "loading" : "ready",
    terminalVisible.value ? "terminal-visible" : "terminal-hidden",
    terminalDisplayed.value ? "displayed" : "hidden",
    operationBusy.value ? "busy" : "idle",
    launchButtonsDisabled.value ? "disabled" : "enabled",
    autoStartTarget.value?.id || "",
    autoStartCooldownVersion.value
  ].join("|"), () => {
    const target = autoStartTarget.value;
    const key = `${launchScopeKey.value}:${target?.id || ""}`;
    const ready = shouldScheduleLaunchAutoStart({
      autoStartKey: autoStartKey.value,
      key,
      launchButtonsDisabled: launchButtonsDisabled.value,
      loading: launchTargetsLoadingForAutoStart.value,
      operationBusy: operationBusy.value,
      sessionId: sessionId.value,
      target,
      terminalDisplayed: terminalDisplayed.value,
      terminalVisible: terminalVisible.value
    });
    if (scheduledAutoStartKey === key && ready) {
      return;
    }
    clearAutoStartTimer();
    if (!ready) {
      return;
    }
    const cooldownMs = readLaunchAutoStartAttemptCooldown(key);
    if (cooldownMs > 0) {
      scheduleAutoStartCooldownCheck(cooldownMs);
      return;
    }

    const start = () => {
      autoStartTimer = 0;
      scheduledAutoStartKey = "";
      const currentTarget = autoStartTarget.value;
      const currentKey = `${launchScopeKey.value}:${currentTarget?.id || ""}`;
      if (!shouldScheduleLaunchAutoStart({
        autoStartKey: autoStartKey.value,
        key: currentKey,
        launchButtonsDisabled: launchButtonsDisabled.value,
        loading: launchTargetsLoadingForAutoStart.value,
        operationBusy: operationBusy.value,
        sessionId: sessionId.value,
        target: currentTarget,
        terminalDisplayed: terminalDisplayed.value,
        terminalVisible: terminalVisible.value
      })) {
        return;
      }
      const currentCooldownMs = readLaunchAutoStartAttemptCooldown(currentKey);
      if (currentCooldownMs > 0) {
        scheduleAutoStartCooldownCheck(currentCooldownMs);
        return;
      }
      writeLaunchAutoStartAttempt(currentKey);
      autoStartKey.value = currentKey;
      void Promise.resolve(run(currentTarget, {
        applyDefaultDisplay: false
      })).then((started) => {
        if (started) {
          clearLaunchAutoStartAttempt(currentKey);
        }
      }).catch(() => null);
    };

    scheduledAutoStartKey = key;
    if (typeof window === "undefined" || AUTO_START_STABILITY_DELAY_MS <= 0) {
      start();
      return;
    }
    autoStartTimer = window.setTimeout(start, AUTO_START_STABILITY_DELAY_MS);
  }, {
    flush: "post",
    immediate: true
  });

  onBeforeUnmount(() => {
    disposed = true;
    clearAutoStartTimer();
    clearAutoStartCooldownTimer();
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
    launchInputForTarget,
    launchStatusAttempt,
    launchStarting,
    launchTargets,
    loading: launchTargetsResource.isLoading,
    loadError: launchTargetsResource.loadError,
    minimizeTerminal,
    openAction,
    operationBusy,
    previewCanRestart,
    previewCanShowLog,
    previewCanStart,
    previewHref,
    previewMessage,
    previewState,
    previewTargetDisabledReason,
    previewTargetHref,
    previewTargetRecovery,
    terminalPreviewRequiresProxy,
    terminalPreviewProxyPending,
    previewInputIsRemembered,
    refresh,
    restartTerminal,
    retryTerminal,
    run,
    savePreviewInput,
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
    terminalWindowStorageKey,
    terminalWindowVisible,
    visible
  };
}

export {
  AUTO_START_ATTEMPT_COOLDOWN_MS,
  AUTO_START_STABILITY_DELAY_MS,
  autoStartLaunchTargetsLoading,
  browserCanOpenTarget,
  clearLaunchAutoStartAttempt,
  launchControlsCanLoadTargets,
  launchBrowserTargetHref,
  launchBrowserTargetName,
  launchAutoStartAttemptStorageKey,
  launchPreviewBaseUrl,
  launchPreviewDisplayUrl,
  launchPreviewLocationStorageKey,
  launchTargetsRealtimeShouldRefresh,
  launchPreviewRequiresProxy,
  launchPreviewOptionsStorageKey,
  launchPreviewToolbarStorageKey,
  launchPreviewUrl,
  launchControlScopeKey,
  launchTargetWorktreePath,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreview,
  normalizeLaunchPreviewToolbarPosition,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget,
  readLaunchAutoStartAttemptCooldown,
  sameSiteLoopbackPreviewUrl,
  shouldScheduleLaunchAutoStart,
  useVibe64LaunchControls
};
