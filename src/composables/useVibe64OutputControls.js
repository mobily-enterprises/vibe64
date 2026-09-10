import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64OutputsPath,
  vibe64OutputsQueryKey,
  vibe64PreviewIdentityPath,
  vibe64OutputRunPath,
  vibe64OutputRunStopPath,
  vibe64OutputResultPath,
  vibe64SessionPath,
  vibe64SessionPreviewStatePath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64OutputTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";
import {
  isArchivedVibe64Session,
  vibe64SessionRevision
} from "@/lib/vibe64SessionViewModel.js";
import {
  useVibe64Terminal
} from "@/composables/useVibe64Terminal.js";
import {
  stableLocalStorageKeyPart
} from "@/lib/browserLocalStorage.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
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
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  managedPreviewTarget
} from "@local/studio-terminal-core/shared";

const LAUNCH_BROWSER_WINDOW_FEATURES = "popup,width=1400,height=900,left=80,top=60";
const LAUNCH_PREVIEW_TOOLBAR_POSITIONS = Object.freeze(["left", "center", "right"]);
const AUTO_START_ATTEMPT_COOLDOWN_MS = 7000;
const AUTO_START_STABILITY_DELAY_MS = 750;
const LAUNCH_STATUS_RETRY_LIMIT = 2;
const LAUNCH_STATUS_RETRY_BASE_DELAY_MS = 1000;
const LAUNCH_STATUS_RETRY_MAX_DELAY_MS = 5000;
const LAUNCH_STATUS_IDLE_RECOVERY_INITIAL_DELAY_MS = 1200;
const LAUNCH_STATUS_IDLE_RECOVERY_INTERVAL_MS = 3000;
const LAUNCH_STATUS_IDLE_RECOVERY_LIMIT = 6;
const TERMINAL_STOP_POLL_INTERVAL_MS = 100;
const TERMINAL_STOP_POLL_ATTEMPTS = 50;
const OUTPUTS_REALTIME_REASONS = new Set([
  "output-target-started",
  "output-target-ready",
  "output-target-closed",
  "output-target-stopped",
  "output-target-stale-cleared",
  "output-results-ready",
  "output-results-failed"
]);

function browserCanOpenTarget(target = {}) {
  return String(target.kind || "url") === "url" && Boolean(String(target.href || "").trim());
}

function launchBrowserTargetName(session = {}, projectSlug = currentProjectSlugFromLocation()) {
  const projectScope = String(projectSlug || "").trim() ||
    String(session?.sessionId || session?.id || "project").trim();
  return `vibe64-launch-${stableLocalStorageKeyPart(projectScope)}`;
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
  const studioHref = String(browserWindow?.location?.href || localPreviewBrowserHref()).trim();
  return resolveLaunchPreviewDestination([target], {
    studioHref
  }).displayHref;
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

function outputTargetWorktreePath(session = {}) {
  return vibe64SessionSourcePath(session);
}

function launchControlsSessionCanRun(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  return Boolean(
    String(session?.sessionId || "").trim() &&
    !isArchivedVibe64Session(session) &&
    !String(metadata.session_closing_reason || "").trim() &&
    outputTargetWorktreePath(session)
  );
}

function launchControlsCanLoadTargets({
  displayed = true,
  session = {},
  sourceOperationsSuspended = false
} = {}) {
  return Boolean(
    displayed &&
    sourceOperationsSuspended !== true &&
    launchControlsSessionCanRun(session)
  );
}

function launchControlScopeKey(projectSlug = "", sessionId = "") {
  return `${String(projectSlug || "").trim()}::${String(sessionId || "").trim()}`;
}

function outputTargetsRealtimeShouldRefresh({
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
    reason === "output-target-started" &&
    (localLaunchStarting || vibe64RealtimePayloadFromCurrentTab(payload))
  ) {
    return false;
  }
  return payload.clientRefresh?.includeOutputs === true ||
    !reason ||
    OUTPUTS_REALTIME_REASONS.has(reason);
}

function shouldScheduleLaunchAutoStart({
  autoStartKey = "",
  externalBusy = false,
  key = "",
  loading = false,
  operationBusy = false,
  sessionLaunchable = true,
  sessionId = "",
  target = null,
  terminalDisplayed = true,
  terminalVisible = false
} = {}) {
  return Boolean(
    sessionId &&
    sessionLaunchable &&
    target &&
    target.available !== false &&
    key &&
    !externalBusy &&
    !loading &&
    !terminalVisible &&
    !operationBusy &&
    terminalDisplayed &&
    autoStartKey !== key
  );
}

function autoStartOutputsLoading({
  outputTargetsLoading = false,
  outputTargetsSettled = false
} = {}) {
  return Boolean(outputTargetsLoading || !outputTargetsSettled);
}

function launchStatusRetryDelay(attempt = 0) {
  const attemptNumber = Math.max(0, Number(attempt) || 0);
  return Math.min(
    LAUNCH_STATUS_RETRY_MAX_DELAY_MS,
    LAUNCH_STATUS_RETRY_BASE_DELAY_MS * (attemptNumber + 1)
  );
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) ? status : null;
}

function launchStatusShouldRetry(failureCount = 0, error = null) {
  if (Math.max(0, Number(failureCount) || 0) >= LAUNCH_STATUS_RETRY_LIMIT) {
    return false;
  }
  if (launchStatusAgentWriteBusy(error)) {
    return true;
  }
  const status = normalizeHttpStatus(error?.status ?? error?.statusCode);
  return status == null ||
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500;
}

function launchStatusErrorText({
  error = null,
  fallback = "",
  path = ""
} = {}) {
  const fallbackText = String(fallback || "").trim();
  if (!error) {
    return fallbackText;
  }
  if (launchStatusAgentWriteBusy(error)) {
    return "";
  }
  const message = String(error?.message || fallbackText || "Request failed.").trim();
  const status = normalizeHttpStatus(error?.status ?? error?.statusCode);
  const code = String(error?.code || "").trim();
  const requestPath = String(path || error?.path || error?.url || "").trim();
  const details = [
    status === 0 ? "network" : status == null ? "" : `HTTP ${status}`,
    code,
    requestPath
  ].filter(Boolean).join(", ");
  return details ? `${message} (${details})` : message;
}

function launchStatusAgentWriteBusy(error = null) {
  return String(
    error?.code ||
    error?.response?.code ||
    error?.response?.errors?.[0]?.code ||
    ""
  ).trim() === "vibe64_agent_write_mode_busy";
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

function resolveLaunchPreviewDestination(actions = [], {
  requirePreviewProxy = false,
  studioHref = localPreviewBrowserHref()
} = {}) {
  const action = Array.isArray(actions)
    ? actions.find((candidate) => browserCanOpenTarget(candidate)) || null
    : null;
  const targetHref = String(action?.href || "").trim();
  const previewHref = String(action?.previewHref || "").trim();
  const displayHref = previewHref && remoteStudioCannotEmbedLoopbackTarget(targetHref, studioHref)
    ? sameSiteLoopbackPreviewUrl(previewHref, studioHref)
    : sameSiteLoopbackPreviewUrl(targetHref, studioHref);
  const embedCandidate = previewHref || (requirePreviewProxy ? "" : targetHref);

  if (!embedCandidate) {
    return {
      action,
      displayHref,
      embedHref: "",
      unavailableReason: requirePreviewProxy && action
        ? "Waiting for the hosted preview URL."
        : ""
    };
  }
  if (remoteStudioCannotEmbedLoopbackTarget(embedCandidate, studioHref)) {
    return {
      action,
      displayHref,
      embedHref: "",
      unavailableReason: "This preview URL is only reachable from the server. Restart the preview to create a hosted preview URL."
    };
  }
  if (browserWouldBlockEmbeddedPreview(embedCandidate, studioHref)) {
    return {
      action,
      displayHref,
      embedHref: "",
      unavailableReason: "HTTP previews cannot be embedded from HTTPS Studio. Open the preview in a browser tab, or open Studio over HTTP for embedded preview."
    };
  }
  return {
    action,
    displayHref,
    embedHref: sameSiteLoopbackPreviewUrl(embedCandidate, studioHref),
    unavailableReason: ""
  };
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
    ? "Run an output target first."
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

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function launchPreviewFromStatus(status = {}) {
  const source = plainObject(status);
  const previewSource = plainObject(source.preview);
  const preview = normalizeLaunchPreview(previewSource);
  if (previewSource.state || preview.href || preview.targetHref) {
    return preview;
  }

  const previewTarget = plainObject(source.previewTarget);
  const openTarget = plainObject(source.openTarget);
  const href = String(previewTarget.href || openTarget.previewHref || "").trim();
  if (!href || previewTarget.available === false || openTarget.available === false) {
    return preview;
  }

  const activeTerminal = plainObject(source.activeTerminal);
  return normalizeLaunchPreview({
    canRestart: Boolean(activeTerminal.id || plainObject(source.lastOutputTarget).id),
    canShowLog: Boolean(activeTerminal.id),
    href,
    message: "Preview is ready.",
    state: "ready",
    targetHref: String(previewTarget.targetHref || openTarget.href || "").trim(),
    terminalId: String(activeTerminal.id || "").trim()
  });
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

function browserWouldBlockEmbeddedPreview(previewHref = "", studioHref = "") {
  const previewText = String(previewHref || "").trim();
  const studioText = String(studioHref || "").trim();
  if (!previewText || !studioText) {
    return false;
  }
  try {
    const previewUrl = new URL(previewText);
    const studioUrl = new URL(studioText);
    return studioUrl.protocol === "https:" &&
      previewUrl.protocol === "http:" &&
      !isLoopbackBrowserHost(previewUrl.hostname);
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

function useVibe64OutputControls({
  autoStartManagedPreview = () => false,
  autoStartTargetId = () => "",
  busy = () => false,
  embeddedPreview = () => false,
  previewDisplayed = () => true,
  session = null,
  sourceOperationsSuspended = () => false,
  windowDisplayed = () => true
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const operationBusy = ref(false);
  const launchError = ref("");
  const refusedAdmissionId = ref("");
  const launchStarting = ref(false);
  const launchWaiting = ref(false);
  const terminalExpanded = ref(false);
  const autoStartKey = ref("");
  const autoStartCooldownVersion = ref(0);
  const launchStatusAttempt = ref(0);
  const launchStatusIdleRecoveryCount = ref(0);
  const launchStatusIdleRecoveryExhausted = computed(() => (
    launchStatusIdleRecoveryCount.value >= LAUNCH_STATUS_IDLE_RECOVERY_LIMIT
  ));
  const outputTargetsSettledForAutoStart = ref(false);
  const sourceOperationsResumePending = ref(false);
  let attachedTerminalId = "";
  let autoStartTimer = 0;
  let autoStartCooldownTimer = 0;
  let scheduledAutoStartKey = "";
  let launchStatusAttemptLoading = false;
  let launchStatusAttemptScopeKey = "";
  let launchStatusIdleRecoveryTimer = 0;
  let launchStatusIdleRecoveryScopeKey = "";

  const selectedSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(selectedSession.value?.sessionId || ""));
  const sessionRevision = computed(() => vibe64SessionRevision(selectedSession.value));
  let outputTargetsRefreshSessionId = sessionId.value;
  let outputTargetsRefreshRevision = sessionRevision.value;
  const launchScopeKey = computed(() => launchControlScopeKey(projectSlug.value, sessionId.value));
  const requestedAutoStartTargetId = computed(() => String(readRefOrGetterValue(autoStartTargetId) || "").trim());
  const autoStartRequestKey = computed(() => requestedAutoStartTargetId.value || (
    readRefOrGetterValue(autoStartManagedPreview) === true ? "managed-preview" : ""
  ));
  const terminalDisplayed = computed(() => readRefOrGetterValue(windowDisplayed) !== false);
  const previewPaneDisplayed = computed(() => readRefOrGetterValue(previewDisplayed) !== false);
  const launchSourceOperationsSuspended = computed(() => (
    readRefOrGetterValue(sourceOperationsSuspended) === true
  ));
  const canLoadOutputs = computed(() => launchControlsCanLoadTargets({
    displayed: terminalDisplayed.value,
    session: selectedSession.value || {},
    sourceOperationsSuspended: launchSourceOperationsSuspended.value
  }));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const outputTargetsPath = computed(() => {
    return sessionId.value ? vibe64OutputsPath(sessionsApiPath.value, sessionId.value) : "";
  });
  const terminalWindowStorageKey = computed(() => launchTerminalStorageKey(
    selectedSession.value || {},
    projectSlug.value
  ));
  const terminal = useVibe64Terminal({
    driver: createWebSocketTerminalDriver({
      webSocketUrl(terminalId) {
        return vibe64OutputTerminalWebSocketUrl(sessionId.value, terminalId);
      }
    })
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
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalExitCode,
    terminalMetadata,
    terminalOutput,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminal;
  let disposed = false;

  const outputTargetsResource = useEndpointResource({
    enabled: canLoadOutputs,
    fallbackLoadError: "Outputs could not be loaded.",
    path: outputTargetsPath,
    queryOptions: {
      retry: launchStatusShouldRetry,
      retryDelay: launchStatusRetryDelay
    },
    queryKey: computed(() => vibe64OutputsQueryKey(
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
      path: vibe64OutputRunPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      ...vibe64RealtimeOriginPayload(),
      ...(context.forceRestart === true ? { forceRestart: true } : {}),
      outputTargetId: String(context.outputTargetId || "")
    }),
    fallbackRunError: "Output target could not be started.",
    messages: {
      error: "Output target could not be started."
    },
    onRunError(error) {
      // Startup failures belong to the preview, including automatic attempts.
      // Rethrow before useCommand also presents them as action-feedback toasts.
      if (readRefOrGetterValue(embeddedPreview)) {
        throw error;
      }
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.output-target.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const stopTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64OutputRunStopPath(sessionsApiPath.value, context.sessionId, context.terminalSessionId)
    }),
    fallbackRunError: "Output target could not be stopped.",
    messages: {
      error: "Output target could not be stopped."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.output-target.stop",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: vibe64OutputRunPath(sessionsApiPath.value, context.sessionId, context.terminalSessionId)
    }),
    fallbackRunError: "Output target terminal could not close.",
    messages: {
      error: "Output target terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.output-target.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const selectPreviewIdentityCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64PreviewIdentityPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      ...(context.identityName ? { identityName: context.identityName } : {}),
      mode: context.mode
    }),
    fallbackRunError: "Preview identity could not be selected.",
    messages: {
      error: "Preview identity could not be selected."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.preview-identity.select",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const status = computed(() => outputTargetsResource.data.value || {});
  const launchStatusLoadError = computed(() => {
    const error = outputTargetsResource.query?.error?.value || null;
    return launchStatusErrorText({
      error,
      fallback: outputTargetsResource.loadError.value,
      path: outputTargetsPath.value
    });
  });
  const preview = computed(() => launchPreviewFromStatus(status.value));
  const previewIdentity = computed(() => {
    const value = status.value.previewIdentity;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {
          available: false,
          defaultMode: "guest",
          disabledReason: "",
          identities: []
        };
  });
  const previewState = computed(() => preview.value.state);
  const testApproval = computed(() => ["waiting", "resuming"].includes(status.value.testApproval?.state)
    ? status.value.testApproval : null);
  const resourceAdmissionId = computed(() => ["ready", "starting"].includes(previewState.value) ? ""
    : refusedAdmissionId.value || String(status.value.resourceAdmissionId || ""));
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
  const outputTargets = computed(() => {
    return Array.isArray(status.value.outputTargets) ? status.value.outputTargets : [];
  });
  const outputRuns = computed(() => {
    return Array.isArray(status.value.outputRuns) ? status.value.outputRuns : [];
  });
  const outputResults = computed(() => outputRuns.value.flatMap((run) => (
    (Array.isArray(run?.results) ? run.results : []).map((result) => ({
      ...result,
      href: vibe64OutputResultPath(sessionsApiPath.value, sessionId.value, result.id),
      outputTargetId: String(run.outputTargetId || ""),
      runId: String(run.id || "")
    }))
  )));
  const outputExecution = computed(() => {
    const value = status.value.output;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {
          error: null,
          mode: "",
          presentationKind: "",
          state: "idle",
          targetId: ""
        };
  });
  const autoStartTarget = computed(() => {
    if (requestedAutoStartTargetId.value) {
      return outputTargets.value.find((target) => (
        target.id === requestedAutoStartTargetId.value &&
        target.presentation?.kind === "web" &&
        target.available !== false
      )) || null;
    }
    return autoStartRequestKey.value
      ? managedPreviewTarget(outputTargets.value)
      : null;
  });
  const activeTerminal = computed(() => {
    const terminalStatusValue = status.value.activeTerminal;
    return terminalStatusValue && typeof terminalStatusValue === "object" && !Array.isArray(terminalStatusValue)
      ? terminalStatusValue
      : null;
  });
  const activeOutputTargetId = computed(() => String(
    terminalMetadata.value.outputTargetId ||
    activeTerminal.value?.metadata?.outputTargetId ||
    status.value.lastOutputTarget?.id ||
    ""
  ));
  const activeOutputTarget = computed(() => {
    return outputTargets.value.find((target) => target.id === activeOutputTargetId.value) || null;
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
    const presentationKind = activeOutputTarget.value?.presentation?.kind ||
      outputExecution.value.presentationKind;
    const finite = activeOutputTarget.value?.mode === "finite" || outputExecution.value.mode === "finite";
    if (terminalIndicatorState.value === "running") {
      return presentationKind === "web" ? "Server is running" : "Program is running";
    }
    if (terminalIndicatorState.value === "starting") {
      return finite ? "Build is running" : "Preparing output";
    }
    if (terminalIndicatorState.value === "failed") {
      return finite ? "Build failed" : "Program stopped with an error";
    }
    if (finite && outputExecution.value.state === "succeeded") {
      return "Build completed";
    }
    return presentationKind === "web" ? "Server is stopped" : "Program is stopped";
  });
  const launchButtonsDisabled = computed(() => Boolean(
    readRefOrGetterValue(busy) ||
    operationBusy.value ||
    terminalIsRunning.value
  ));
  const outputTargetsLoadingForAutoStart = computed(() => autoStartOutputsLoading({
    outputTargetsLoading: outputTargetsResource.isLoading.value,
    outputTargetsSettled: outputTargetsSettledForAutoStart.value
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
    activeOutputTargetId.value
  ));
  const terminalCanRestart = computed(() => Boolean(
    terminalCanStop.value &&
    activeOutputTargetId.value
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
  const terminalTitle = computed(() => activeOutputTarget.value?.label || "Run target");
  const terminalSubtitle = computed(() => {
    if (terminalIsRunning.value) {
      return "";
    }
    if (terminalStatus.value === "exited" || activeTerminal.value?.status === "exited") {
      const exitCode = terminalExitCode.value ?? activeTerminal.value?.exitCode;
      return exitCode === 0 ? "Exited" : `Exited with code ${exitCode}`;
    }
    return activeOutputTargetId.value ? "Ready" : "No output target running.";
  });
  const visible = computed(() => Boolean(
    (
      canLoadOutputs.value ||
      terminalVisible.value
    ) &&
      (outputTargets.value.length > 0 || outputTargetsResource.loadError.value || terminalVisible.value)
  ));
  const launchStatusIdleRecoveryNeeded = computed(() => Boolean(
    previewPaneDisplayed.value &&
    canLoadOutputs.value &&
    autoStartRequestKey.value &&
    !outputTargetsResource.isLoading.value &&
    !launchStatusLoadError.value &&
    !operationBusy.value &&
    !terminalVisible.value &&
    !autoStartTarget.value &&
    outputTargets.value.length < 1 &&
    previewState.value === "idle"
  ));

  async function run(outputTarget = {}, {
    applyDefaultDisplay = true,
    autoStartAttemptKey = "",
    forceRestart = false,
    ignoreExternalBusy = false
  } = {}) {
    const currentSession = selectedSession.value || {};
    const externalBusy = readRefOrGetterValue(busy);
    const currentSessionId = sessionId.value;
    const startedScopeKey = launchScopeKey.value;
    if (
      !currentSessionId ||
      !launchControlsCanLoadTargets({
        displayed: terminalDisplayed.value,
        session: currentSession,
        sourceOperationsSuspended: launchSourceOperationsSuspended.value
      }) ||
      !terminalDisplayed.value ||
      operationBusy.value ||
      (!forceRestart && terminalIsRunning.value) ||
      (!forceRestart && !ignoreExternalBusy && externalBusy) ||
      outputTarget.available === false ||
      !outputTarget.id
    ) {
      return false;
    }
    if (applyDefaultDisplay) {
      terminalExpanded.value = false;
    }
    launchStarting.value = true;
    launchWaiting.value = false;
    launchError.value = "";
    operationBusy.value = true;
    refusedAdmissionId.value = "";
    const normalizedAutoStartAttemptKey = String(autoStartAttemptKey || "").trim();
    if (normalizedAutoStartAttemptKey) {
      writeLaunchAutoStartAttempt(normalizedAutoStartAttemptKey);
    }
    try {
      const terminalSession = await startTerminalCommand.run({
        forceRestart,
        outputTargetId: outputTarget.id,
        sessionId: currentSessionId
      });
      if (
        disposed ||
        startedScopeKey !== launchScopeKey.value ||
        !launchControlsCanLoadTargets({
          displayed: terminalDisplayed.value,
          session: selectedSession.value || {},
          sourceOperationsSuspended: launchSourceOperationsSuspended.value
        })
      ) {
        return false;
      }
      applyLaunchTerminalSession(terminalSession);
      void connectLaunchTerminal();
      void refresh({
        scopeKey: startedScopeKey
      });
      return true;
    } catch (error) {
      if (disposed || startedScopeKey !== launchScopeKey.value) {
        return false;
      }
      if (normalizedAutoStartAttemptKey) {
        if (launchStatusAgentWriteBusy(error)) {
          launchWaiting.value = previewState.value !== "ready";
          void refresh({ scopeKey: startedScopeKey }).catch(() => null);
          return false;
        }
        // Only a confirmed admission conflict is safe to retry automatically.
        autoStartKey.value = normalizedAutoStartAttemptKey;
      }
      launchError.value = String(
        error?.message || startTerminalCommand.message || "Output target could not be started."
      ).trim();
      refusedAdmissionId.value = String(error?.details?.admission?.id || "");
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

  async function acceptResourceRetry(result = {}) {
    if (result.ok === false) return;
    refusedAdmissionId.value = "";
    launchError.value = "";
    if (applyLaunchTerminalSession(result)) void connectLaunchTerminal();
    // A replay has no terminal payload. Read the existing start; never run it again.
    await refresh();
  }

  async function connectLaunchTerminal() {
    if (!terminalSessionId.value || !terminalDisplayed.value) {
      return false;
    }
    return connectTerminalSocket();
  }

  async function expandTerminal() {
    terminalExpanded.value = true;
    await connectLaunchTerminal();
  }

  function minimizeTerminal() {
    terminalExpanded.value = false;
    void connectLaunchTerminal();
  }

  async function refresh({
    scopeKey = launchScopeKey.value
  } = {}) {
    if (!canLoadOutputs.value) {
      return null;
    }
    const refreshScopeKey = String(scopeKey || "").trim();
    if (!refreshScopeKey) {
      return null;
    }
    return typeof outputTargetsResource.query?.refetch === "function"
      ? outputTargetsResource.query.refetch({
          cancelRefetch: true
        })
      : outputTargetsResource.reload();
  }

  async function startNewlyConfiguredWorkspaceSetup() {
    if (
      String(selectedSession.value?.workspaceSetup?.status || "").trim() !== "unconfigured" ||
      !sessionId.value
    ) {
      return false;
    }
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPath(sessionsApiPath.value, sessionId.value, "/workspace-setup/retry"),
        {
          body: vibe64RealtimeOriginPayload(),
          method: "POST"
        }
      );
      return result?.ok !== false;
    } catch (error) {
      vibe64SessionDebugLog("client.launchPreview.workspaceSetup.start.error", {
        error: vibe64SessionDebugError(error),
        sessionId: sessionId.value
      });
      return false;
    }
  }

  async function publishPreviewState(previewState = {}) {
    const currentSessionId = sessionId.value;
    const currentProjectSlug = projectSlug.value;
    if (!currentSessionId || !currentProjectSlug || !String(previewState?.route || "").trim()) {
      return false;
    }
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPreviewStatePath(sessionsApiPath.value, currentSessionId),
        {
          body: vibe64RealtimeOriginPayload({
            projectSlug: currentProjectSlug,
            route: String(previewState?.route || "").trim(),
            title: String(previewState?.title || "").trim()
          }),
          method: "POST"
        }
      );
      return result?.ok !== false;
    } catch (error) {
      vibe64SessionDebugLog("client.launchPreview.state.publish.error", {
        error: vibe64SessionDebugError(error),
        route: String(previewState?.route || "").trim(),
        sessionId: currentSessionId
      });
      return false;
    }
  }

  function requestPreviewIdentityGrant({
    identityName = "",
    mode = "identity"
  } = {}) {
    if (!sessionId.value || previewIdentity.value.available !== true) {
      throw new Error(
        previewIdentity.value.disabledReason || "This preview does not support application identity switching."
      );
    }
    const normalizedIdentityName = String(identityName || "").trim();
    return selectPreviewIdentityCommand.run({
      ...(normalizedIdentityName ? { identityName: normalizedIdentityName } : {}),
      mode: String(mode || "identity").trim(),
      sessionId: sessionId.value
    });
  }

  watch(launchSourceOperationsSuspended, (suspended, wasSuspended) => {
    if (suspended) {
      sourceOperationsResumePending.value = true;
      return;
    }
    if (wasSuspended !== true) {
      return;
    }
    const resumeScopeKey = launchScopeKey.value;
    void Promise.resolve(refresh({ scopeKey: resumeScopeKey })).finally(() => {
      if (
        !launchSourceOperationsSuspended.value &&
        launchScopeKey.value === resumeScopeKey
      ) {
        sourceOperationsResumePending.value = false;
      }
    });
  }, {
    flush: "sync",
    immediate: true
  });

  useRealtimeEvent({
    enabled: canLoadOutputs,
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: (context) => outputTargetsRealtimeShouldRefresh({
      localLaunchStarting: launchStarting.value,
      payload: context?.payload || {}
    }, sessionId.value),
    onEvent: () => refresh({
      scopeKey: launchScopeKey.value
    })
  });

  watch([
    sessionId,
    sessionRevision,
    canLoadOutputs,
    autoStartRequestKey,
    () => outputTargetsResource.isLoading.value,
    launchStatusLoadError,
    terminalVisible,
    autoStartTarget,
    previewState
  ], () => {
    const currentSessionId = sessionId.value;
    const currentRevision = sessionRevision.value;
    if (
      currentSessionId !== outputTargetsRefreshSessionId ||
      outputTargetsRefreshRevision === null
    ) {
      outputTargetsRefreshSessionId = currentSessionId;
      outputTargetsRefreshRevision = currentRevision;
      return;
    }
    if (currentRevision === null || currentRevision <= outputTargetsRefreshRevision) {
      return;
    }
    if (terminalVisible.value || autoStartTarget.value || previewState.value !== "idle") {
      outputTargetsRefreshRevision = currentRevision;
      return;
    }
    if (
      !canLoadOutputs.value ||
      !autoStartRequestKey.value ||
      outputTargetsResource.isLoading.value ||
      launchStatusLoadError.value
    ) {
      return;
    }
    outputTargetsRefreshRevision = currentRevision;
    void refresh({
      scopeKey: launchScopeKey.value
    });
  }, {
    flush: "post"
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

  function clearLaunchStatusIdleRecoveryTimer() {
    if (launchStatusIdleRecoveryTimer && typeof window !== "undefined") {
      window.clearTimeout(launchStatusIdleRecoveryTimer);
    }
    launchStatusIdleRecoveryTimer = 0;
  }

  function resetLaunchStatusIdleRecovery() {
    clearLaunchStatusIdleRecoveryTimer();
    launchStatusIdleRecoveryCount.value = 0;
    launchStatusIdleRecoveryScopeKey = launchScopeKey.value;
  }

  function resetOutputsAutoStartSettlement() {
    outputTargetsSettledForAutoStart.value = false;
  }

  function scheduleLaunchStatusIdleRecovery() {
    if (!launchStatusIdleRecoveryNeeded.value || typeof window === "undefined") {
      return;
    }
    const scopeKey = launchScopeKey.value;
    if (!scopeKey) {
      return;
    }
    if (launchStatusIdleRecoveryScopeKey !== scopeKey) {
      launchStatusIdleRecoveryScopeKey = scopeKey;
      launchStatusIdleRecoveryCount.value = 0;
    }
    if (launchStatusIdleRecoveryTimer) {
      return;
    }
    if (launchStatusIdleRecoveryExhausted.value) {
      return;
    }
    const delayMs = launchStatusIdleRecoveryCount.value === 0
      ? LAUNCH_STATUS_IDLE_RECOVERY_INITIAL_DELAY_MS
      : LAUNCH_STATUS_IDLE_RECOVERY_INTERVAL_MS;
    launchStatusIdleRecoveryTimer = window.setTimeout(() => {
      launchStatusIdleRecoveryTimer = 0;
      if (!launchStatusIdleRecoveryNeeded.value || scopeKey !== launchScopeKey.value) {
        return;
      }
      launchStatusIdleRecoveryCount.value += 1;
      void refresh({
        scopeKey
      }).catch(() => null);
    }, delayMs);
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
    const target = activeOutputTarget.value || outputTargets.value.find((item) => item.id === activeOutputTargetId.value);
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
    const target = activeOutputTarget.value || outputTargets.value.find((item) => item.id === activeOutputTargetId.value);
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

  watch([previewState, terminalIndicatorState, launchError], ([state, indicator]) => {
    if (state === "ready" && indicator === "running") {
      launchError.value = "";
      refusedAdmissionId.value = "";
      launchWaiting.value = false;
    }
  });

  watch(terminalError, (message) => {
    if (!terminalSessionMissingError(message)) {
      return;
    }
    clearStaleLaunchTerminal();
    void refresh();
  });

  watch(terminalDisplayed, (displayed) => {
    if (displayed) {
      void connectLaunchTerminal();
      return;
    }
    clearAutoStartTimer();
    resetOutputsAutoStartSettlement();
    resetLaunchStatusIdleRecovery();
    closeTerminalSocket();
    disposeTerminalDisplay();
  });

  watch(launchScopeKey, () => {
    attachedTerminalId = "";
    autoStartKey.value = "";
    launchError.value = "";
    refusedAdmissionId.value = "";
    launchWaiting.value = false;
    launchStatusAttempt.value = 0;
    launchStatusAttemptLoading = false;
    launchStatusAttemptScopeKey = launchScopeKey.value;
    resetOutputsAutoStartSettlement();
    resetLaunchStatusIdleRecovery();
    clearAutoStartTimer();
    closeTerminalSocket();
    disposeTerminalDisplay();
    resetTerminalSessionState();
    resetTerminalDisplay();
    terminalExpanded.value = false;
  });

  watch(canLoadOutputs, (canLoad) => {
    if (canLoad) {
      return;
    }
    clearAutoStartTimer();
    resetOutputsAutoStartSettlement();
    resetLaunchStatusIdleRecovery();
  }, {
    flush: "sync",
    immediate: true
  });

  watch(launchStatusIdleRecoveryNeeded, (needed) => {
    if (needed) {
      scheduleLaunchStatusIdleRecovery();
      return;
    }
    clearLaunchStatusIdleRecoveryTimer();
    if (!outputTargetsResource.isLoading.value) {
      launchStatusIdleRecoveryCount.value = 0;
      launchStatusIdleRecoveryScopeKey = launchScopeKey.value;
    }
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    launchScopeKey.value,
    canLoadOutputs.value ? "loadable" : "blocked",
    outputTargetsResource.isLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    const scopeKey = launchScopeKey.value;
    if (!scopeKey || !canLoadOutputs.value) {
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
    if (outputTargetsResource.isLoading.value && !launchStatusAttemptLoading) {
      launchStatusAttempt.value += 1;
      launchStatusAttemptLoading = true;
      return;
    }
    if (!outputTargetsResource.isLoading.value) {
      launchStatusAttemptLoading = false;
    }
  }, {
    flush: "sync",
    immediate: true
  });

  watch(() => [
    projectSlug.value,
    sessionId.value,
    autoStartRequestKey.value,
    canLoadOutputs.value ? "loadable" : "blocked",
    outputTargetsResource.isLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    const scopeKey = launchScopeKey.value;
    if (!scopeKey || !autoStartRequestKey.value || !canLoadOutputs.value) {
      resetOutputsAutoStartSettlement();
      return;
    }
    if (outputTargetsResource.isLoading.value) {
      outputTargetsSettledForAutoStart.value = false;
      return;
    }
    outputTargetsSettledForAutoStart.value = true;
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    projectSlug.value,
    sessionId.value,
    autoStartRequestKey.value,
    outputTargetsLoadingForAutoStart.value ? "loading" : "ready",
    terminalVisible.value ? "terminal-visible" : "terminal-hidden",
    terminalDisplayed.value ? "displayed" : "hidden",
    canLoadOutputs.value ? "loadable" : "blocked",
    readRefOrGetterValue(busy) ? "external-busy" : "external-idle",
    operationBusy.value ? "busy" : "idle",
    resourceAdmissionId.value,
    autoStartTarget.value?.id || "",
    autoStartCooldownVersion.value
  ].join("|"), () => {
    const target = autoStartTarget.value;
    const key = `${launchScopeKey.value}:${target?.id || ""}`;
    if (resourceAdmissionId.value) {
      clearAutoStartTimer();
      return;
    }
    const ready = shouldScheduleLaunchAutoStart({
      autoStartKey: autoStartKey.value,
      externalBusy: readRefOrGetterValue(busy),
      key,
      loading: outputTargetsLoadingForAutoStart.value,
      operationBusy: operationBusy.value,
      sessionLaunchable: canLoadOutputs.value,
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
        externalBusy: readRefOrGetterValue(busy),
        key: currentKey,
        loading: outputTargetsLoadingForAutoStart.value,
        operationBusy: operationBusy.value,
        sessionLaunchable: canLoadOutputs.value,
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
      void Promise.resolve(run(currentTarget, {
        applyDefaultDisplay: false,
        autoStartAttemptKey: currentKey
      })).then((started) => {
        if (started) {
          autoStartKey.value = currentKey;
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
    clearLaunchStatusIdleRecoveryTimer();
    disposeTerminalUi();
  });

  return {
    activeOutputTarget,
    activeOutputTargetId,
    activeTerminal,
    closeTerminal,
    copyLog,
    expandTerminal,
    launchActions,
    launchButtonsDisabled,
    launchError,
    resourceAdmissionId,
    acceptResourceRetry,
    testApproval,
    launchStatusAttempt,
    launchStatusIdleRecoveryExhausted,
    launchStarting,
    launchWaiting,
    outputTargets,
    outputExecution,
    outputResults,
    outputRuns,
    loading: outputTargetsResource.isLoading,
    loadError: launchStatusLoadError,
    minimizeTerminal,
    openAction,
    operationBusy,
    previewCanRestart,
    previewCanShowLog,
    previewCanStart,
    previewHref,
    previewIdentity,
    previewMessage,
    previewState,
    previewTargetDisabledReason,
    previewTargetHref,
    previewTargetRecovery,
    terminalPreviewRequiresProxy,
    terminalPreviewProxyPending,
    publishPreviewState,
    requestPreviewIdentityGrant,
    refresh,
    restartTerminal,
    retryTerminal,
    run,
    sendCtrlC,
    stopTerminal,
    startNewlyConfiguredWorkspaceSetup,
    terminal,
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
  LAUNCH_STATUS_RETRY_LIMIT,
  launchPreviewFromStatus,
  autoStartOutputsLoading,
  browserCanOpenTarget,
  clearLaunchAutoStartAttempt,
  launchControlsCanLoadTargets,
  launchControlsSessionCanRun,
  launchBrowserTargetHref,
  launchBrowserTargetName,
  launchAutoStartAttemptStorageKey,
  launchStatusAgentWriteBusy,
  launchStatusErrorText,
  launchStatusRetryDelay,
  launchStatusShouldRetry,
  launchPreviewLocationStorageKey,
  outputTargetsRealtimeShouldRefresh,
  launchPreviewRequiresProxy,
  launchPreviewToolbarStorageKey,
  launchControlScopeKey,
  outputTargetWorktreePath,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreview,
  normalizeLaunchPreviewToolbarPosition,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget,
  readLaunchAutoStartAttemptCooldown,
  resolveLaunchPreviewDestination,
  sameSiteLoopbackPreviewUrl,
  shouldScheduleLaunchAutoStart,
  useVibe64OutputControls
};
