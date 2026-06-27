import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  launchPreviewLocationStorageKey,
  launchPreviewToolbarStorageKey,
  launchPreviewBaseUrl,
  launchPreviewDisplayUrl,
  launchPreviewUrl,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition,
  useVibe64LaunchControls
} from "@/composables/useVibe64LaunchControls.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  previewInputFromFormValues,
  previewOptionFormValue,
  previewOptionsForTarget
} from "@/lib/vibe64PreviewOptions.js";
import {
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
} from "@/lib/vibe64PreviewRoutes.js";

const PREVIEW_RELOAD_QUERY_PARAM = "vibe64_reload";
const PREVIEW_PROXY_TOKEN_QUERY_PARAM = "vibe64_preview_token";
const PREVIEW_DISPLAY_QUERY_PARAMS = Object.freeze([
  PREVIEW_RELOAD_QUERY_PARAM,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM
]);

function previewUrlWithoutReload(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    url.searchParams.delete(PREVIEW_RELOAD_QUERY_PARAM);
    return url.toString();
  } catch {
    return text
      .replace(/([?&])vibe64_reload=[^&]*&?/u, (match, prefix) => {
        return prefix === "?" && match.endsWith("&") ? "?" : "";
      })
      .replace(/[?&]$/u, "");
  }
}

function previewUrlWithoutDisplayParams(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    for (const param of PREVIEW_DISPLAY_QUERY_PARAMS) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return stripPreviewDisplayQueryParams(text);
  }
}

function previewProxyToken(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    return new URL(text).searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM) || "";
  } catch {
    return "";
  }
}

function previewProxyBootstrapKey(value = "") {
  const token = previewProxyToken(value);
  if (!token) {
    return "";
  }
  try {
    const url = new URL(value);
    return `${url.origin}:${token}`;
  } catch {
    return token;
  }
}

function stripPreviewDisplayQueryParams(value = "") {
  const text = String(value || "");
  const hashIndex = text.indexOf("#");
  const beforeHash = hashIndex >= 0 ? text.slice(0, hashIndex) : text;
  const hash = hashIndex >= 0 ? text.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex < 0) {
    return text;
  }
  const base = beforeHash.slice(0, queryIndex);
  const parts = beforeHash
    .slice(queryIndex + 1)
    .split("&")
    .filter((part) => !PREVIEW_DISPLAY_QUERY_PARAMS.includes(queryParamName(part)));
  return `${base}${parts.length > 0 ? `?${parts.join("&")}` : ""}${hash}`;
}

function queryParamName(part = "") {
  const separatorIndex = String(part || "").indexOf("=");
  const rawName = separatorIndex < 0 ? String(part || "") : String(part || "").slice(0, separatorIndex);
  try {
    return decodeURIComponent(rawName.replace(/\+/gu, " "));
  } catch {
    return rawName;
  }
}

function normalizePreviewRoute(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("/")) {
    return text;
  }
  if (text.startsWith("?") || text.startsWith("#")) {
    return `/${text}`;
  }
  return "";
}

function previewRouteFromUrl(value = "") {
  const text = previewUrlWithoutDisplayParams(value);
  if (!text) {
    return "";
  }
  const route = normalizePreviewRoute(text);
  if (route) {
    return route;
  }
  try {
    const url = new URL(text);
    return `${url.pathname || "/"}${url.search}${url.hash}` || "/";
  } catch {
    return "";
  }
}

function previewUrlForRoute(route = "", baseUrl = "") {
  const normalizedRoute = normalizePreviewRoute(route);
  const baseText = previewUrlWithoutDisplayParams(baseUrl);
  if (!normalizedRoute || !baseText) {
    return "";
  }
  try {
    return new URL(normalizedRoute, baseText).toString();
  } catch {
    return "";
  }
}

function previewAddressDisplayText(value = "", {
  displayBaseUrl = "",
  previewBaseUrl = ""
} = {}) {
  const displayUrl = previewUrlWithoutDisplayParams(value);
  if (!displayUrl) {
    return "";
  }
  try {
    const url = new URL(displayUrl);
    const sameAppOrigins = [
      displayBaseUrl,
      previewBaseUrl
    ].map((baseUrl) => {
      try {
        return previewUrlWithoutDisplayParams(baseUrl)
          ? new URL(previewUrlWithoutDisplayParams(baseUrl)).origin
          : "";
      } catch {
        return "";
      }
    }).filter(Boolean);
    if (sameAppOrigins.includes(url.origin)) {
      return `${url.pathname || "/"}${url.search}${url.hash}` || "/";
    }
  } catch {
    return displayUrl;
  }
  return displayUrl;
}

function launchPreviewReloadBaseUrl({
  baseUrl = "",
  displayBaseUrl = "",
  visitedUrl = ""
} = {}) {
  const normalizedBaseUrl = previewUrlWithoutReload(baseUrl);
  const normalizedVisitedUrl = previewUrlWithoutReload(visitedUrl);
  if (!normalizedBaseUrl || !normalizedVisitedUrl) {
    return normalizedBaseUrl;
  }
  try {
    const base = new URL(normalizedBaseUrl);
    const visited = new URL(normalizedVisitedUrl, normalizedBaseUrl);
    if (visited.origin === base.origin) {
      return visited.toString();
    }
    const displayText = previewUrlWithoutReload(displayBaseUrl);
    if (displayText && visited.origin === new URL(displayText).origin) {
      const mapped = new URL(normalizedBaseUrl);
      mapped.pathname = visited.pathname;
      mapped.search = visited.search;
      mapped.hash = visited.hash;
      return mapped.toString();
    }
    const mapped = new URL(normalizedBaseUrl);
    mapped.pathname = visited.pathname;
    mapped.search = visited.search;
    mapped.hash = visited.hash;
    return mapped.toString();
  } catch {
    return normalizedBaseUrl;
  }
}

function launchPreviewBootstrapBaseUrl({
  baseUrl = "",
  displayBaseUrl = "",
  visitedUrl = ""
} = {}) {
  const token = previewProxyToken(baseUrl);
  if (!token) {
    return "";
  }
  const reloadBaseUrl = launchPreviewReloadBaseUrl({
    baseUrl,
    displayBaseUrl,
    visitedUrl
  });
  if (!reloadBaseUrl) {
    return baseUrl;
  }
  try {
    const bootstrapUrl = new URL(reloadBaseUrl);
    bootstrapUrl.searchParams.set(PREVIEW_PROXY_TOKEN_QUERY_PARAM, token);
    return bootstrapUrl.toString();
  } catch {
    return baseUrl;
  }
}

function normalizePreviewAddressInput(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (
    /^[a-z][a-z\d+.-]*:/iu.test(text) ||
    /^[/?#]/u.test(text) ||
    text.startsWith("./") ||
    text.startsWith("../")
  ) {
    return text;
  }
  return `/${text}`;
}

function launchPreviewAddressNavigationUrl({
  address = "",
  currentUrl = "",
  displayBaseUrl = "",
  previewBaseUrl = ""
} = {}) {
  const previewBaseText = previewUrlWithoutReload(previewBaseUrl);
  const displayBaseText = previewUrlWithoutDisplayParams(displayBaseUrl || previewBaseText);
  const currentText = previewUrlWithoutDisplayParams(currentUrl || displayBaseText);
  const input = normalizePreviewAddressInput(address);
  if (!input || !previewBaseText || !displayBaseText) {
    return {
      displayUrl: "",
      error: "Preview URL is not available yet.",
      ok: false,
      previewUrl: ""
    };
  }
  try {
    const previewBase = new URL(previewBaseText);
    const displayBase = new URL(displayBaseText);
    const target = new URL(input, currentText || displayBaseText);
    const allowedOrigins = new Set([
      displayBase.origin,
      previewBase.origin
    ]);
    if (!allowedOrigins.has(target.origin)) {
      return {
        displayUrl: "",
        error: "Preview URL must stay inside this app.",
        ok: false,
        previewUrl: ""
      };
    }
    const previewTarget = target.origin === previewBase.origin
      ? new URL(target)
      : new URL(previewBase);
    const displayTarget = target.origin === displayBase.origin
      ? new URL(target)
      : new URL(displayBase);
    if (target.origin !== previewBase.origin) {
      previewTarget.pathname = target.pathname;
      previewTarget.search = target.search;
      previewTarget.hash = target.hash;
    }
    if (target.origin !== displayBase.origin) {
      displayTarget.pathname = target.pathname;
      displayTarget.search = target.search;
      displayTarget.hash = target.hash;
    }
    return {
      displayUrl: previewUrlWithoutDisplayParams(displayTarget.toString()),
      error: "",
      ok: true,
      previewUrl: previewUrlWithoutReload(previewTarget.toString())
    };
  } catch {
    return {
      displayUrl: "",
      error: "Preview URL is invalid.",
      ok: false,
      previewUrl: ""
    };
  }
}

function useVibe64LaunchControlsSurface(props) {
  const {
    activeLaunchTarget,
    expandTerminal,
    launchActions,
    launchButtonsDisabled,
    launchInputForTarget,
    launchStatusAttempt,
    launchStarting,
    launchTargets,
    loading,
    loadError,
    minimizeTerminal,
    openAction,
    operationBusy,
    previewCanRestart,
    previewCanShowLog,
    previewCanStart,
    previewMessage,
    previewState,
    refresh: refreshLaunchTargets,
    restartTerminal,
    retryTerminal,
    run,
    savePreviewInput,
    setTerminalHost,
    terminalCanRestart,
    terminalCanRetry,
    terminalCommandPreview,
    terminalDisplayed,
    terminalDockVisible,
    terminalError,
    terminalExpanded,
    terminalIndicatorLabel,
    terminalIndicatorState,
    terminalIsRunning,
    terminalStatus,
    terminalSubtitle,
    terminalTitle,
    terminalVisible,
    terminalWindowVisible,
    terminalWindowStorageKey,
    previewInputIsRemembered,
    visible
  } = useVibe64LaunchControls({
    autoStartTargetId: () => props.autoStartTargetId,
    windowDisplayed: () => props.windowDisplayed,
    busy: () => props.busy,
    session: () => props.session
  });
  
  const runMenuDisabled = computed(() => Boolean(
    launchButtonsDisabled.value ||
    loading.value ||
    launchTargets.value.length < 1
  ));
  const PREVIEW_LOCATION_MESSAGE_TYPE = "vibe64:preview-location";
  const PREVIEW_QUERY_MESSAGE_TYPE = "vibe64:preview-query";
  const PREVIEW_COMMAND_MESSAGE_TYPE = "vibe64:preview-command";
  const PREVIEW_READY_MESSAGE_TYPE = "vibe64:preview-ready";
  const PREVIEW_READY_RETRY_INTERVAL_MS = 5000;
  const PREVIEW_READY_RETRY_LIMIT = 30;
  const previewFrame = ref(null);
  const previewAddressDraft = ref("");
  const previewAddressError = ref("");
  const previewAddressFocused = ref(false);
  const previewBootstrapPending = ref(false);
  const previewBootstrappedKey = ref("");
  const previewHistory = ref([]);
  const previewOptionsDialogVisible = ref(false);
  const previewOptionsFormValues = ref({});
  const previewOptionsRemember = ref(false);
  const previewRouteDialogVisible = ref(false);
  const previewRouteDialogError = ref("");
  const previewRouteFormValues = ref({});
  const previewRouteSelection = ref(null);
  const previewLogVisible = ref(false);
  const previewReloadBaseUrl = ref("");
  const previewReloadKey = ref(0);
  const previewReadyUrl = ref("");
  const previewReadyRetryCount = ref(0);
  const previewVisitedUrl = ref("");
  const previewToolbarExpanded = ref(false);
  const previewToolbarPosition = ref("center");
  const projectSlug = useVibe64ProjectSlug();
  let previewReadyRetryTimer = 0;
  const toolbarTeleportTarget = computed(() => String(props.toolbarTeleportTarget || "").trim());
  const embeddedTerminalVisible = computed(() => Boolean(
    props.embeddedPreview &&
    terminalDisplayed.value &&
    terminalExpanded.value
  ));
  const requestedAutoStartTargetId = computed(() => String(props.autoStartTargetId || "").trim());
  const embeddedAutoStartTarget = computed(() => {
    if (!props.embeddedPreview || !requestedAutoStartTargetId.value) {
      return null;
    }
    return launchTargets.value.find((target) => target.id === requestedAutoStartTargetId.value) || null;
  });
  const embeddedStartTarget = computed(() => {
    if (!props.embeddedPreview) {
      return null;
    }
    return embeddedAutoStartTarget.value ||
      launchTargets.value.find((target) => target.available !== false) ||
      null;
  });
  const embeddedAutoStartButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    requestedAutoStartTargetId.value &&
    !terminalVisible.value
  ));
  const embeddedManualStartButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    embeddedStartTarget.value &&
    previewCanStart.value &&
    previewState.value === "idle"
  ));
  const embeddedRecoveryButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    embeddedStartTarget.value &&
    previewCanRestart.value &&
    ["failed", "stopped"].includes(previewState.value)
  ));
  const manualLaunchMenuVisible = computed(() => Boolean(
    !terminalVisible.value &&
    launchTargets.value.length > 0 &&
    !(props.embeddedPreview && requestedAutoStartTargetId.value)
  ));
  const previewToolbarStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewToolbarStorageKey(props.session, projectSlug.value)
    : "");
  const previewLocationStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewLocationStorageKey(props.session, projectSlug.value)
    : "");
  const previewOptionsTarget = computed(() => embeddedAutoStartTarget.value || activeLaunchTarget.value || null);
  const previewOptions = computed(() => previewOptionsForTarget(previewOptionsTarget.value));
  const previewOptionsAvailable = computed(() => previewOptions.value.length > 0);
  const previewOptionsPrimaryLabel = computed(() => terminalIsRunning.value ? "Save and restart preview" : "Save");
  const previewRoutes = computed(() => previewRoutesForTarget(previewOptionsTarget.value));
  const previewRoutesAvailable = computed(() => previewRoutes.value.length > 0);
  const previewRouteDialogPath = computed(() => {
    const route = previewRouteSelection.value;
    if (!route) {
      return "";
    }
    return previewRoutePath(route, previewRouteFormValues.value).path;
  });
  const previewRouteDialogParams = computed(() => previewRouteSelection.value
    ? previewRouteParams(previewRouteSelection.value)
    : []);
  const previewBaseUrl = computed(() => launchPreviewBaseUrl(launchActions.value));
  const previewDisplayBaseUrl = computed(() => launchPreviewDisplayUrl(launchActions.value));
  const previewDisplayedUrl = computed(() => (
    previewVisitedUrl.value ||
    previewDisplayBaseUrl.value ||
    previewBaseUrl.value
  ));
  const previewDisplayedAddress = computed(() => previewAddressDisplayText(previewDisplayedUrl.value, {
    displayBaseUrl: previewDisplayBaseUrl.value,
    previewBaseUrl: previewBaseUrl.value
  }));
  const previewBackAvailable = computed(() => previewHistory.value.length > 1);
  const previewPaneDisplayed = computed(() => props.previewDisplayed !== false);
  const previewReadyForIframe = computed(() => Boolean(
    ["ready", "stale"].includes(previewState.value) &&
    previewBaseUrl.value
  ));
  const previewBootstrapUrl = computed(() => previewBootstrapPending.value
    ? launchPreviewBootstrapBaseUrl({
        baseUrl: previewBaseUrl.value,
        displayBaseUrl: previewDisplayBaseUrl.value,
        visitedUrl: previewVisitedUrl.value || storedPreviewUrl(previewDisplayBaseUrl.value) || previewDisplayBaseUrl.value
      })
    : "");
  const previewUrl = computed(() => launchPreviewUrl({
    baseUrl: previewBootstrapUrl.value || previewReloadBaseUrl.value || previewBaseUrl.value,
    ready: previewReadyForIframe.value,
    reloadKey: previewReloadKey.value
  }));
  const previewStarting = computed(() => Boolean(
    previewState.value === "starting"
  ));
  const launchStatusText = computed(() => launchPreviewStatusText({
    attempt: launchStatusAttempt.value,
    loadError: loadError.value,
    loading: loading.value
  }));
  const launchStatusDetailText = computed(() => String(loadError.value || "").trim());
  const launchStatusChipVisible = computed(() => Boolean(
    loadError.value ||
    (loading.value && !previewUrl.value)
  ));
  const launchStatusRetryVisible = computed(() => Boolean(loadError.value));
  const launchStatusChipText = computed(() => {
    const attempt = launchStatusAttempt.value || 1;
    if (loadError.value) {
      return `Preview status failed (attempt ${attempt})`;
    }
    if (loading.value) {
      return `Checking preview (attempt ${attempt})`;
    }
    return "";
  });
  const launchStatusChipTitle = computed(() => launchStatusText.value || launchStatusChipText.value);
  const previewLoadingOverlayVisible = computed(() => previewOpeningOverlayVisible({
    previewReadyUrl: previewReadyUrl.value,
    previewUrl: previewUrl.value
  }));
  const previewIssue = computed(() => launchPreviewIssue({
    message: previewMessage.value,
    state: previewState.value
  }));
  const previewIssueVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewIssue.value
  ));
  const previewNotice = computed(() => launchPreviewNotice({
    message: previewMessage.value,
    state: previewState.value
  }));
  const embeddedTerminalFrameVisible = computed(() => Boolean(
    embeddedTerminalVisible.value &&
    (
      !previewNotice.value ||
      previewLogVisible.value
    )
  ));
  const previewNoticeVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewNotice.value &&
    !embeddedTerminalFrameVisible.value
  ));
  const previewNoticeRecoveryVisible = computed(() => Boolean(
    previewNoticeVisible.value &&
    previewCanRestart.value &&
    embeddedStartTarget.value
  ));
  const previewNoticeStartVisible = computed(() => Boolean(
    previewNoticeVisible.value &&
    previewCanStart.value &&
    embeddedStartTarget.value &&
    previewState.value === "idle"
  ));
  const previewRecoveryButtonLabel = computed(() => "Restart preview");
  const launchToolbarDockVisible = computed(() => launchToolbarDockShouldShow({
    embeddedPreview: props.embeddedPreview,
    embeddedTerminalVisible: embeddedTerminalFrameVisible.value,
    previewIssueVisible: previewIssueVisible.value,
    terminalDockVisible: terminalDockVisible.value,
    terminalVisible: terminalVisible.value
  }));
  const previewToolbarRecoveryVisible = computed(() => Boolean(
    props.embeddedPreview &&
    launchToolbarDockVisible.value &&
    previewCanRestart.value &&
    previewState.value === "stale" &&
    embeddedStartTarget.value
  ));
  const previewTerminalRecoveryVisible = computed(() => Boolean(
    props.embeddedPreview &&
    terminalVisible.value &&
    !terminalIsRunning.value &&
    previewCanRestart.value &&
    embeddedStartTarget.value
  ));
  const previewAutoStartPreparing = computed(() => Boolean(
    props.embeddedPreview &&
    requestedAutoStartTargetId.value &&
    embeddedAutoStartTarget.value &&
    !terminalVisible.value
  ));
  const previewActivityVisible = computed(() => Boolean(
    previewStarting.value ||
    loading.value ||
    previewAutoStartPreparing.value
  ));
  const previewEmptyText = computed(() => launchPreviewEmptyText({
    launchStatusText: launchStatusText.value,
    loading: loading.value,
    loadError: loadError.value,
    previewManualStartAvailable: embeddedManualStartButtonVisible.value,
    previewMessage: previewMessage.value,
    previewState: previewState.value,
    previewAutoStartPreparing: previewAutoStartPreparing.value,
    launchStarting: launchStarting.value,
    terminalIsRunning: terminalIsRunning.value
  }));
  
  function previewClientDebugEnabled() {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage?.getItem("vibe64:preview-debug") === "1" ||
        new URL(window.location.href).searchParams.has("vibe64_preview_debug");
    } catch {
      return false;
    }
  }
  
  function previewDebugLog(event = "", details = {}) {
    if (!previewClientDebugEnabled()) {
      return;
    }
    vibe64SessionDebugLog(`client.launchPreview.${event}`, {
      frameSrc: String(previewFrame.value?.src || ""),
      overlayVisible: previewLoadingOverlayVisible.value,
      previewBaseUrl: previewBaseUrl.value,
      previewDisplayBaseUrl: previewDisplayBaseUrl.value,
      previewReadyUrl: previewUrlWithoutReload(previewReadyUrl.value),
      previewState: previewState.value,
      previewUrl: previewUrlWithoutReload(previewUrl.value),
      projectSlug: projectSlug.value,
      reloadKey: previewReloadKey.value,
      retryCount: previewReadyRetryCount.value,
      sessionId: String(props.session?.sessionId || ""),
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
    });
  }
  
  async function reloadPreview() {
    await refreshLaunchTargets();
    previewBootstrapPending.value = Boolean(previewProxyBootstrapKey(previewBaseUrl.value));
    previewReadyRetryCount.value = 0;
    previewReloadBaseUrl.value = launchPreviewReloadBaseUrl({
      baseUrl: previewBaseUrl.value,
      displayBaseUrl: previewDisplayBaseUrl.value,
      visitedUrl: previewVisitedUrl.value
    });
    previewReloadKey.value += 1;
    previewDebugLog("manualReload", {
      reloadBaseUrl: previewUrlWithoutReload(previewReloadBaseUrl.value),
      nextReloadKey: previewReloadKey.value
    });
  }

  async function retryLaunchStatus() {
    await refreshLaunchTargets();
  }
  
  function movePreviewToolbar(direction = 0) {
    previewToolbarPosition.value = nextLaunchPreviewToolbarPosition(
      previewToolbarPosition.value,
      direction
    );
    if (previewToolbarStorageKey.value) {
      writeLocalStorageJson(previewToolbarStorageKey.value, previewToolbarPosition.value);
    }
  }

  function collapsePreviewToolbar() {
    previewToolbarExpanded.value = false;
  }

  function expandPreviewToolbar() {
    previewToolbarExpanded.value = true;
  }
  
  async function copyPreviewUrl() {
    if (!previewDisplayedAddress.value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(previewDisplayedAddress.value);
    return true;
  }

  function resetPreviewAddressDraft() {
    previewAddressError.value = "";
    previewAddressDraft.value = previewDisplayedAddress.value || "";
  }

  function previewAddressFocus() {
    previewAddressFocused.value = true;
  }

  function previewAddressBlur() {
    previewAddressFocused.value = false;
    if (!previewAddressError.value) {
      previewAddressDraft.value = previewDisplayedAddress.value || "";
    }
  }

  function resetPreviewHistory(url = "") {
    const normalizedUrl = previewUrlWithoutDisplayParams(url);
    previewHistory.value = normalizedUrl ? [normalizedUrl] : [];
  }

  function storedPreviewRoute() {
    const stored = readLocalStorageJson(previewLocationStorageKey.value, null);
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      return normalizePreviewRoute(stored.route || previewRouteFromUrl(stored.url || ""));
    }
    return normalizePreviewRoute(stored || "");
  }

  function storedPreviewUrl(baseUrl = "") {
    return previewUrlForRoute(storedPreviewRoute(), baseUrl);
  }

  function writePreviewLocation(url = "") {
    const route = previewRouteFromUrl(url);
    if (!route || !previewLocationStorageKey.value) {
      return;
    }
    writeLocalStorageJson(previewLocationStorageKey.value, {
      route
    });
  }

  function recordPreviewHistory(url = "", reason = "") {
    const normalizedUrl = previewUrlWithoutDisplayParams(url);
    if (!normalizedUrl) {
      return;
    }
    const history = previewHistory.value.filter(Boolean);
    const currentUrl = history.at(-1) || "";
    if (currentUrl === normalizedUrl) {
      return;
    }
    const previousUrl = history.at(-2) || "";
    if (previousUrl === normalizedUrl) {
      previewHistory.value = history.slice(0, -1);
      return;
    }
    if (String(reason || "") === "replaceState" && history.length > 0) {
      previewHistory.value = [
        ...history.slice(0, -1),
        normalizedUrl
      ];
      return;
    }
    previewHistory.value = [
      ...history,
      normalizedUrl
    ].slice(-50);
  }

  function setPreviewVisitedUrl(url = "", {
    reason = ""
  } = {}) {
    const normalizedUrl = previewUrlWithoutDisplayParams(url);
    if (!normalizedUrl) {
      return;
    }
    previewVisitedUrl.value = normalizedUrl;
    writePreviewLocation(normalizedUrl);
    recordPreviewHistory(normalizedUrl, reason);
  }

  function navigatePreviewToDisplayUrl(displayUrl = "") {
    const navigation = launchPreviewAddressNavigationUrl({
      address: displayUrl,
      currentUrl: previewDisplayedUrl.value,
      displayBaseUrl: previewDisplayBaseUrl.value,
      previewBaseUrl: previewBaseUrl.value
    });
    if (!navigation.ok) {
      previewAddressError.value = navigation.error;
      return false;
    }
    previewAddressError.value = "";
    previewAddressDraft.value = previewAddressDisplayText(navigation.displayUrl, {
      displayBaseUrl: previewDisplayBaseUrl.value,
      previewBaseUrl: previewBaseUrl.value
    });
    previewReadyRetryCount.value = 0;
    previewReloadBaseUrl.value = navigation.previewUrl;
    previewReloadKey.value += 1;
    setPreviewVisitedUrl(navigation.displayUrl, {
      reason: "address"
    });
    previewDebugLog("address.navigate", {
      displayUrl: navigation.displayUrl,
      previewUrl: previewUrlWithoutReload(navigation.previewUrl)
    });
    return true;
  }

  function submitPreviewAddress() {
    return navigatePreviewToDisplayUrl(previewAddressDraft.value);
  }

  function openPreviewRoute(route = {}) {
    if (!route?.pathTemplate) {
      return false;
    }
    if (!previewRouteHasParams(route)) {
      return navigatePreviewToDisplayUrl(route.pathTemplate);
    }
    previewRouteSelection.value = route;
    previewRouteFormValues.value = previewRouteInitialFormValues(route);
    previewRouteDialogError.value = "";
    previewRouteDialogVisible.value = true;
    return true;
  }

  function submitPreviewRouteDialog() {
    const route = previewRouteSelection.value;
    if (!route) {
      previewRouteDialogVisible.value = false;
      return false;
    }
    const result = previewRoutePath(route, previewRouteFormValues.value);
    if (!result.ok) {
      previewRouteDialogError.value = result.missingParam
        ? `Enter ${result.missingParam}.`
        : "Preview route is invalid.";
      return false;
    }
    const navigated = navigatePreviewToDisplayUrl(result.path);
    if (navigated) {
      previewRouteDialogVisible.value = false;
    }
    return navigated;
  }

  function postPreviewCommand(action = "") {
    if (!previewPaneDisplayed.value || !previewFrame.value?.contentWindow || !previewUrl.value) {
      return false;
    }
    previewFrame.value.contentWindow.postMessage({
      action: String(action || ""),
      type: PREVIEW_COMMAND_MESSAGE_TYPE
    }, "*");
    previewDebugLog("command.post", {
      action: String(action || "")
    });
    return true;
  }

  function goPreviewBack() {
    if (!previewBackAvailable.value) {
      return false;
    }
    if (postPreviewCommand("back")) {
      return true;
    }
    const previousUrl = previewHistory.value.at(-2) || "";
    if (previousUrl && navigatePreviewToDisplayUrl(previousUrl)) {
      return true;
    }
    return false;
  }
  
  function requestPreviewState() {
    if (!previewPaneDisplayed.value || !previewFrame.value?.contentWindow || !previewUrl.value) {
      if (previewUrl.value) {
        previewDebugLog("query.skipped", {
          hasContentWindow: Boolean(previewFrame.value?.contentWindow),
          previewPaneDisplayed: previewPaneDisplayed.value
        });
      }
      return;
    }
    previewDebugLog("query.post");
    previewFrame.value.contentWindow.postMessage({
      type: PREVIEW_QUERY_MESSAGE_TYPE
    }, "*");
  }
  
  function handlePreviewFrameLoad() {
    previewDebugLog("iframe.load");
    if (previewUrl.value) {
      previewReadyUrl.value = previewUrl.value;
    }
    if (previewBootstrapPending.value) {
      previewBootstrappedKey.value = previewProxyBootstrapKey(previewBaseUrl.value);
      previewBootstrapPending.value = false;
    }
    stopPreviewReadyRetries();
    requestPreviewState();
  }
  
  async function recoverEmbeddedPreview() {
    if (operationBusy.value) {
      return false;
    }
    if (previewCanRestart.value && embeddedStartTarget.value) {
      preservePreviewVisitedRoute();
      const restarted = await run(embeddedStartTarget.value, {
        applyDefaultDisplay: false,
        forceRestart: true
      });
      preservePreviewVisitedRoute();
      return restarted;
    }
    if (terminalCanRestart.value) {
      preservePreviewVisitedRoute();
      return restartTerminal();
    }
    if (terminalCanRetry.value) {
      return retryTerminal();
    }
    if (embeddedStartTarget.value) {
      preservePreviewVisitedRoute();
      return run(embeddedStartTarget.value, {
        applyDefaultDisplay: false
      });
    }
    return false;
  }

  function preservePreviewVisitedRoute() {
    const reloadBaseUrl = launchPreviewReloadBaseUrl({
      baseUrl: previewBaseUrl.value,
      displayBaseUrl: previewDisplayBaseUrl.value,
      visitedUrl: previewVisitedUrl.value
    });
    if (reloadBaseUrl) {
      previewReloadBaseUrl.value = reloadBaseUrl;
    }
  }

  function openPreviewOptions() {
    const target = previewOptionsTarget.value;
    if (!target || !previewOptionsAvailable.value) {
      return false;
    }
    const input = launchInputForTarget(target);
    previewOptionsFormValues.value = Object.fromEntries(previewOptions.value.map((option) => [
      option.id,
      previewOptionFormValue(option, input)
    ]));
    previewOptionsRemember.value = previewInputIsRemembered(target);
    previewOptionsDialogVisible.value = true;
    return true;
  }

  async function savePreviewOptions({
    restart = false
  } = {}) {
    const target = previewOptionsTarget.value;
    if (!target) {
      previewOptionsDialogVisible.value = false;
      return false;
    }
    savePreviewInput(
      target,
      previewInputFromFormValues(target, previewOptionsFormValues.value),
      {
        remember: previewOptionsRemember.value
      }
    );
    previewOptionsDialogVisible.value = false;
    if (restart && terminalIsRunning.value) {
      await restartTerminal();
      return true;
    }
    return true;
  }
  
  function stopPreviewReadyRetries() {
    if (!previewReadyRetryTimer) {
      return;
    }
    window.clearTimeout(previewReadyRetryTimer);
    previewReadyRetryTimer = 0;
    previewDebugLog("retry.stop");
  }
  
  function previewReadyRetryAllowed() {
    return Boolean(
      previewPaneDisplayed.value &&
      previewLoadingOverlayVisible.value &&
      previewUrl.value &&
      typeof window !== "undefined"
    );
  }
  
  function schedulePreviewReadyRetry() {
    if (!previewReadyRetryAllowed()) {
      stopPreviewReadyRetries();
      return;
    }
    if (previewReadyRetryTimer) {
      return;
    }
    previewDebugLog("retry.schedule", {
      intervalMs: PREVIEW_READY_RETRY_INTERVAL_MS
    });
    previewReadyRetryTimer = window.setTimeout(() => {
      previewReadyRetryTimer = 0;
      if (
        !previewReadyRetryAllowed() ||
        previewReadyRetryCount.value >= PREVIEW_READY_RETRY_LIMIT
      ) {
        previewDebugLog("retry.skip", {
          limit: PREVIEW_READY_RETRY_LIMIT,
          retryAllowed: previewReadyRetryAllowed()
        });
        return;
      }
      previewReadyRetryCount.value += 1;
      previewReloadKey.value += 1;
      previewDebugLog("retry.reload", {
        nextReloadKey: previewReloadKey.value
      });
      schedulePreviewReadyRetry();
    }, PREVIEW_READY_RETRY_INTERVAL_MS);
  }
  
  function toggleTerminal() {
    if (embeddedTerminalFrameVisible.value) {
      previewLogVisible.value = false;
      minimizeTerminal();
      return;
    }
    previewLogVisible.value = true;
    void expandTerminal();
  }

  function showLaunchLog() {
    previewLogVisible.value = true;
    void expandTerminal();
  }
  
  function previewMessageUrl(data = {}) {
    const messageType = String(data?.type || "");
    if (
      !data ||
      typeof data !== "object" ||
      ![PREVIEW_LOCATION_MESSAGE_TYPE, PREVIEW_READY_MESSAGE_TYPE].includes(messageType)
    ) {
      return "";
    }
    const href = String(data.href || data.url || "").trim();
    const baseUrl = String(previewDisplayBaseUrl.value || previewBaseUrl.value || "").trim();
    if (!href || !baseUrl) {
      return "";
    }
    try {
      const url = new URL(href, baseUrl);
      const baseOrigin = new URL(baseUrl).origin;
      if (url.origin === baseOrigin) {
        return previewUrlWithoutReload(url.toString());
      }
      const mappedUrl = previewMessageTargetUrlToPreviewUrl(url);
      return mappedUrl ? previewUrlWithoutReload(mappedUrl) : "";
    } catch {
      return "";
    }
  }
  
  function previewMessageTargetUrlToPreviewUrl(targetUrl) {
    const previewBase = String(previewBaseUrl.value || "").trim();
    if (!previewBase || !targetUrl) {
      return "";
    }
    const matchingAction = launchActions.value.find((action) => {
      try {
        return new URL(String(action?.href || "")).origin === targetUrl.origin &&
          String(action?.previewHref || "").trim();
      } catch {
        return false;
      }
    });
    if (!matchingAction) {
      return "";
    }
    try {
      const previewUrl = new URL(previewBase);
      previewUrl.pathname = targetUrl.pathname;
      previewUrl.search = targetUrl.search;
      previewUrl.hash = targetUrl.hash;
      return previewUrl.toString();
    } catch {
      return "";
    }
  }
  
  function previewMessageOriginAllowed(event) {
    const origins = [
      previewBaseUrl.value,
      previewDisplayBaseUrl.value
    ].map((value) => {
      try {
        return value ? new URL(value).origin : "";
      } catch {
        return "";
      }
    }).filter(Boolean);
    return origins.length < 1 || origins.includes(String(event?.origin || ""));
  }
  
  function previewMessageType(value = {}) {
    return String(value?.type || "");
  }
  
  function isPreviewBridgeMessage(value = {}) {
    return [
      PREVIEW_LOCATION_MESSAGE_TYPE,
      PREVIEW_READY_MESSAGE_TYPE
    ].includes(previewMessageType(value));
  }
  
  function handlePreviewLocationMessage(event) {
    if (!isPreviewBridgeMessage(event?.data)) {
      return;
    }
    if (event?.source !== previewFrame.value?.contentWindow) {
      previewDebugLog("message.ignored", {
        messageType: previewMessageType(event?.data),
        origin: String(event?.origin || ""),
        reason: "source_mismatch"
      });
      return;
    }
    if (!previewMessageOriginAllowed(event)) {
      previewDebugLog("message.ignored", {
        messageType: previewMessageType(event?.data),
        origin: String(event?.origin || ""),
        reason: "origin_not_allowed"
      });
      return;
    }
    const frameUrl = previewMessageUrl(event.data);
    previewDebugLog("message.received", {
      frameUrl,
      href: String(event?.data?.href || event?.data?.url || ""),
      messageType: previewMessageType(event?.data),
      origin: String(event?.origin || ""),
      reason: String(event?.data?.reason || "")
    });
    if (frameUrl && event.data?.type === PREVIEW_READY_MESSAGE_TYPE) {
      previewReadyUrl.value = previewUrl.value;
      previewDebugLog("ready.accepted", {
        frameUrl,
        reason: String(event?.data?.reason || "")
      });
    }
    if (frameUrl) {
      setPreviewVisitedUrl(frameUrl, {
        reason: String(event?.data?.reason || "")
      });
    }
  }
  
  watch(previewUrl, (nextUrl, previousUrl) => {
    previewDebugLog("url.changed", {
      nextUrl: previewUrlWithoutReload(nextUrl),
      previousUrl: previewUrlWithoutReload(previousUrl)
    });
    if (previewUrlWithoutReload(nextUrl) !== previewUrlWithoutReload(previousUrl)) {
      previewReadyRetryCount.value = 0;
    }
    previewReadyUrl.value = "";
    requestPreviewState();
  });

  watch(previewBaseUrl, (nextUrl, previousUrl) => {
    const nextBootstrapKey = previewProxyBootstrapKey(nextUrl);
    if (nextBootstrapKey && nextBootstrapKey !== previewBootstrappedKey.value) {
      previewBootstrapPending.value = true;
    } else if (!nextBootstrapKey) {
      previewBootstrapPending.value = false;
      previewBootstrappedKey.value = "";
    }
    if (previewUrlWithoutReload(nextUrl) !== previewUrlWithoutReload(previousUrl)) {
      const reloadBaseUrl = launchPreviewReloadBaseUrl({
        baseUrl: nextUrl,
        displayBaseUrl: previewDisplayBaseUrl.value,
        visitedUrl: previewVisitedUrl.value || storedPreviewUrl(previewDisplayBaseUrl.value)
      });
      previewReloadBaseUrl.value = previewUrlWithoutReload(reloadBaseUrl) === previewUrlWithoutReload(nextUrl)
        ? ""
        : reloadBaseUrl;
    }
  }, {
    immediate: true
  });
  
  watch(previewLoadingOverlayVisible, (visible) => {
    if (visible && previewPaneDisplayed.value) {
      schedulePreviewReadyRetry();
      return;
    }
    stopPreviewReadyRetries();
  }, {
    immediate: true
  });
  
  watch(previewPaneDisplayed, (displayed) => {
    if (!displayed) {
      stopPreviewReadyRetries();
      return;
    }
    requestPreviewState();
    if (previewLoadingOverlayVisible.value) {
      schedulePreviewReadyRetry();
    }
  }, {
    flush: "sync"
  });
  
  watch(previewDisplayBaseUrl, (baseUrl) => {
    const normalizedBaseUrl = previewUrlWithoutDisplayParams(baseUrl);
    if (!normalizedBaseUrl) {
      previewVisitedUrl.value = "";
      resetPreviewHistory("");
      return;
    }
    const restoredUrl = storedPreviewUrl(normalizedBaseUrl);
    const nextVisitedUrl = previewUrlWithoutDisplayParams(launchPreviewReloadBaseUrl({
      baseUrl: normalizedBaseUrl,
      displayBaseUrl: normalizedBaseUrl,
      visitedUrl: previewVisitedUrl.value || restoredUrl || normalizedBaseUrl
    }));
    previewVisitedUrl.value = nextVisitedUrl || normalizedBaseUrl;
    resetPreviewHistory(previewVisitedUrl.value);
    const previewRouteUrl = launchPreviewReloadBaseUrl({
      baseUrl: previewBaseUrl.value,
      displayBaseUrl: normalizedBaseUrl,
      visitedUrl: previewVisitedUrl.value
    });
    previewReloadBaseUrl.value = previewUrlWithoutReload(previewRouteUrl) === previewUrlWithoutReload(previewBaseUrl.value)
      ? ""
      : previewRouteUrl;
  }, {
    immediate: true
  });

  watch(previewDisplayedAddress, (url) => {
    if (!previewAddressFocused.value) {
      previewAddressDraft.value = url || "";
    }
  }, {
    immediate: true
  });
  
  watch(previewToolbarStorageKey, (storageKey) => {
    previewToolbarExpanded.value = false;
    previewToolbarPosition.value = normalizeLaunchPreviewToolbarPosition(
      readLocalStorageJson(storageKey, "center")
    );
  }, {
    immediate: true
  });
  
  onMounted(() => {
    window.addEventListener("message", handlePreviewLocationMessage);
  });
  
  onBeforeUnmount(() => {
    stopPreviewReadyRetries();
    window.removeEventListener("message", handlePreviewLocationMessage);
  });

  return {
    embeddedAutoStartButtonVisible,
    embeddedAutoStartTarget,
    embeddedRecoveryButtonVisible,
    embeddedManualStartButtonVisible,
    embeddedStartTarget,
    embeddedTerminalFrameVisible,
    embeddedTerminalVisible,
    collapsePreviewToolbar,
    goPreviewBack,
    handlePreviewFrameLoad,
    expandPreviewToolbar,
    launchActions,
    launchButtonsDisabled,
    launchStatusAttempt,
    launchStatusChipText,
    launchStatusChipTitle,
    launchStatusChipVisible,
    launchStatusDetailText,
    launchStatusRetryVisible,
    launchStatusText,
    launchTargets,
    launchToolbarDockVisible,
    loading,
    loadError,
    manualLaunchMenuVisible,
    movePreviewToolbar,
    openAction,
    operationBusy,
    previewBaseUrl,
    previewAddressBlur,
    previewAddressDraft,
    previewAddressError,
    previewAddressFocus,
    previewBackAvailable,
    previewActivityVisible,
    previewCanRestart,
    previewCanShowLog,
    previewCanStart,
    previewDisplayedAddress,
    previewDisplayedUrl,
    previewEmptyText,
    previewFrame,
    previewIssue,
    previewIssueVisible,
    previewLoadingOverlayVisible,
    previewMessage,
    previewOptions,
    previewOptionsAvailable,
    previewOptionsDialogVisible,
    previewOptionsFormValues,
    previewOptionsPrimaryLabel,
    previewOptionsRemember,
    previewRouteDialogError,
    previewRouteDialogParams,
    previewRouteDialogPath,
    previewRouteDialogVisible,
    previewRouteFormValues,
    previewRouteSelection,
    previewRoutes,
    previewRoutesAvailable,
    previewNotice,
    previewNoticeRecoveryVisible,
    previewNoticeStartVisible,
    previewNoticeVisible,
    previewRecoveryButtonLabel,
    previewState,
    previewTerminalRecoveryVisible,
    previewToolbarRecoveryVisible,
    previewStarting,
    previewToolbarExpanded,
    previewToolbarPosition,
    previewUrl,
    copyPreviewUrl,
    openPreviewRoute,
    openPreviewOptions,
    recoverEmbeddedPreview,
    reloadPreview,
    retryLaunchStatus,
    resetPreviewAddressDraft,
    savePreviewOptions,
    submitPreviewRouteDialog,
    submitPreviewAddress,
    restartTerminal,
    retryTerminal,
    run,
    runMenuDisabled,
    setTerminalHost,
    showLaunchLog,
    terminalCanRestart,
    terminalCanRetry,
    terminalCommandPreview,
    terminalDisplayed,
    terminalError,
    terminalIndicatorLabel,
    terminalIndicatorState,
    terminalStatus,
    terminalSubtitle,
    terminalTitle,
    terminalWindowStorageKey,
    terminalWindowVisible,
    toolbarTeleportTarget,
    toggleTerminal,
    visible
  };
}

function launchPreviewEmptyText({
  launchStatusText = "",
  launchStarting = false,
  loadError = "",
  loading = false,
  previewAutoStartPreparing = false,
  previewManualStartAvailable = false,
  previewMessage = "",
  previewState = "idle",
  terminalIsRunning = false
} = {}) {
  const message = String(previewMessage || "").trim();
  if (["failed", "project_closed", "stopped"].includes(previewState)) {
    return message || "Preview could not be opened.";
  }
  if (launchStarting || previewState === "starting" || terminalIsRunning) {
    return "Preparing preview.";
  }
  if (previewAutoStartPreparing) {
    return "Preparing preview.";
  }
  if (previewManualStartAvailable) {
    return "Preview is ready to start.";
  }
  if (launchStatusText) {
    return launchStatusText;
  }
  if (loadError) {
    return `Preview status request failed: ${String(loadError || "").trim()}`;
  }
  if (loading) {
    return "Checking preview status.";
  }
  return "Preview will appear here when it is ready.";
}

function launchPreviewStatusText({
  attempt = 0,
  loadError = "",
  loading = false
} = {}) {
  const count = Math.max(1, Number(attempt) || 1);
  const error = String(loadError || "").trim();
  if (error && loading) {
    return `Retrying preview status (attempt ${count}).`;
  }
  if (error) {
    return `Preview status request failed (attempt ${count}).`;
  }
  if (loading) {
    return `Checking preview status (attempt ${count}).`;
  }
  return "";
}

function previewOpeningOverlayVisible({
  previewReadyUrl = "",
  previewUrl = ""
} = {}) {
  const normalizedPreviewUrl = previewUrlWithoutReload(previewUrl);
  if (!normalizedPreviewUrl) {
    return false;
  }
  return normalizedPreviewUrl !== previewUrlWithoutReload(previewReadyUrl);
}

function launchPreviewIssue({
  message = "",
  state = "idle"
} = {}) {
  const text = String(message || "").trim();
  if (state === "stale") {
    return {
      message: text || "Server-side app files changed after this preview started. Restart preview to run the current code.",
      title: "Preview may be stale"
    };
  }
  if (state === "failed") {
    return {
      message: text || "Preview could not be opened.",
      title: "Preview could not be opened"
    };
  }
  if (state === "stopped") {
    return {
      message: text || "The preview process exited.",
      title: "Preview stopped"
    };
  }
  return null;
}

function launchPreviewNotice({
  message = "",
  state = "idle"
} = {}) {
  const issue = launchPreviewIssue({
    message,
    state
  });
  if (state === "stale") {
    return null;
  }
  if (issue) {
    return issue;
  }
  if (state === "project_closed") {
    return {
      message: String(message || "Project is closed.").trim(),
      title: "Project is closed"
    };
  }
  return null;
}

function launchToolbarDockShouldShow({
  embeddedPreview = false,
  embeddedTerminalVisible = false,
  previewIssueVisible = false,
  terminalDockVisible = false,
  terminalVisible = false
} = {}) {
  if (!embeddedPreview) {
    return Boolean(terminalDockVisible);
  }
  if (previewIssueVisible) {
    return true;
  }
  return Boolean(terminalVisible || embeddedTerminalVisible);
}

export {
  launchPreviewAddressNavigationUrl,
  launchPreviewBootstrapBaseUrl,
  launchPreviewReloadBaseUrl,
  launchPreviewEmptyText,
  launchPreviewIssue,
  launchPreviewNotice,
  launchPreviewStatusText,
  launchToolbarDockShouldShow,
  previewOpeningOverlayVisible,
  previewAddressDisplayText,
  previewRouteFromUrl,
  previewUrlForRoute,
  previewUrlWithoutReload,
  useVibe64LaunchControlsSurface
};
