import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
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

function useVibe64LaunchControlsSurface(props) {
  const {
    activeLaunchTarget,
    expandTerminal,
    launchActions,
    launchButtonsDisabled,
    launchInputForTarget,
    launchStarting,
    launchTargets,
    loading,
    loadError,
    minimizeTerminal,
    openAction,
    operationBusy,
    previewTargetDisabledReason,
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
    terminalLaunchReady,
    terminalPreviewRequiresProxy,
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
  const PREVIEW_READY_MESSAGE_TYPE = "vibe64:preview-ready";
  const PREVIEW_RELOAD_QUERY_PARAM = "vibe64_reload";
  const PREVIEW_READY_RETRY_INTERVAL_MS = 5000;
  const PREVIEW_READY_RETRY_LIMIT = 30;
  const previewFrame = ref(null);
  const previewOptionsDialogVisible = ref(false);
  const previewOptionsFormValues = ref({});
  const previewOptionsRemember = ref(false);
  const previewReloadKey = ref(0);
  const previewReadyUrl = ref("");
  const previewVisitedUrl = ref("");
  const previewToolbarPosition = ref("center");
  const projectSlug = useVibe64ProjectSlug();
  let previewReadyRetryCount = 0;
  let previewReadyRetryTimer = 0;
  const toolbarTeleportTarget = computed(() => String(props.toolbarTeleportTarget || "").trim());
  const embeddedTerminalVisible = computed(() => Boolean(
    props.embeddedPreview &&
    terminalDisplayed.value &&
    terminalExpanded.value
  ));
  const launchToolbarDockVisible = computed(() => props.embeddedPreview
    ? Boolean(terminalVisible.value || embeddedTerminalVisible.value)
    : terminalDockVisible.value);
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
    !terminalVisible.value &&
    !previewUrl.value
  ));
  const embeddedRecoveryButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    embeddedStartTarget.value &&
    terminalVisible.value &&
    !terminalIsRunning.value
  ));
  const manualLaunchMenuVisible = computed(() => Boolean(
    !terminalVisible.value &&
    launchTargets.value.length > 0 &&
    !(props.embeddedPreview && requestedAutoStartTargetId.value)
  ));
  const previewToolbarStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewToolbarStorageKey(props.session, projectSlug.value)
    : "");
  const previewOptionsTarget = computed(() => embeddedAutoStartTarget.value || activeLaunchTarget.value || null);
  const previewOptions = computed(() => previewOptionsForTarget(previewOptionsTarget.value));
  const previewOptionsAvailable = computed(() => previewOptions.value.length > 0);
  const previewOptionsPrimaryLabel = computed(() => terminalIsRunning.value ? "Save and restart preview" : "Save");
  const previewBaseUrl = computed(() => launchPreviewBaseUrl(launchActions.value, {
    requirePreviewProxy: terminalPreviewRequiresProxy.value
  }));
  const previewDisplayBaseUrl = computed(() => launchPreviewDisplayUrl(launchActions.value));
  const previewDisplayedUrl = computed(() => (
    previewVisitedUrl.value ||
    previewDisplayBaseUrl.value ||
    previewBaseUrl.value
  ));
  const previewPaneDisplayed = computed(() => props.previewDisplayed !== false);
  const previewUrl = computed(() => launchPreviewUrl({
    baseUrl: previewBaseUrl.value,
    ready: terminalLaunchReady.value,
    reloadKey: previewReloadKey.value
  }));
  const previewStarting = computed(() => Boolean(
    previewBaseUrl.value &&
    !terminalLaunchReady.value
  ));
  const previewLoadingOverlayVisible = computed(() => Boolean(
    previewUrl.value &&
    previewReadyUrl.value !== previewUrl.value
  ));
  const previewProxyUnavailable = computed(() => Boolean(
    terminalPreviewRequiresProxy.value &&
    terminalLaunchReady.value &&
    !previewBaseUrl.value
  ));
  const previewRetryButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewProxyUnavailable.value
  ));
  const previewAutoStartPreparing = computed(() => Boolean(
    props.embeddedPreview &&
    requestedAutoStartTargetId.value &&
    embeddedAutoStartTarget.value &&
    !terminalVisible.value
  ));
  const previewEmptyText = computed(() => launchPreviewEmptyText({
    loading: loading.value,
    previewManualStartAvailable: embeddedManualStartButtonVisible.value,
    previewProxyUnavailable: previewProxyUnavailable.value,
    previewStarting: previewStarting.value,
    previewTargetDisabledReason: previewTargetDisabledReason.value,
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
      previewUrl: previewUrlWithoutReload(previewUrl.value),
      projectSlug: projectSlug.value,
      reloadKey: previewReloadKey.value,
      retryCount: previewReadyRetryCount,
      sessionId: String(props.session?.sessionId || ""),
      terminalLaunchReady: terminalLaunchReady.value,
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
    });
  }
  
  async function reloadPreview() {
    await refreshLaunchTargets();
    previewReadyRetryCount = 0;
    previewReloadKey.value += 1;
    previewDebugLog("manualReload", {
      nextReloadKey: previewReloadKey.value
    });
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
  
  async function copyPreviewUrl() {
    if (!previewDisplayedUrl.value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(previewDisplayedUrl.value);
    return true;
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
    requestPreviewState();
  }
  
  async function recoverEmbeddedPreview() {
    if (operationBusy.value) {
      return false;
    }
    if (previewProxyUnavailable.value) {
      await reloadPreview();
      return Boolean(previewBaseUrl.value);
    }
    if (!embeddedStartTarget.value) {
      return false;
    }
    if (terminalCanRetry.value) {
      return retryTerminal();
    }
    return run(embeddedStartTarget.value, {
      applyDefaultDisplay: false
    });
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
        previewReadyRetryCount >= PREVIEW_READY_RETRY_LIMIT
      ) {
        previewDebugLog("retry.skip", {
          limit: PREVIEW_READY_RETRY_LIMIT,
          retryAllowed: previewReadyRetryAllowed()
        });
        return;
      }
      previewReadyRetryCount += 1;
      previewReloadKey.value += 1;
      previewDebugLog("retry.reload", {
        nextReloadKey: previewReloadKey.value
      });
      schedulePreviewReadyRetry();
    }, PREVIEW_READY_RETRY_INTERVAL_MS);
  }
  
  function toggleTerminal() {
    if (embeddedTerminalVisible.value) {
      minimizeTerminal();
      return;
    }
    void expandTerminal();
  }
  
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
      previewVisitedUrl.value = frameUrl;
    }
  }
  
  watch(previewUrl, (nextUrl, previousUrl) => {
    previewDebugLog("url.changed", {
      nextUrl: previewUrlWithoutReload(nextUrl),
      previousUrl: previewUrlWithoutReload(previousUrl)
    });
    if (previewUrlWithoutReload(nextUrl) !== previewUrlWithoutReload(previousUrl)) {
      previewReadyRetryCount = 0;
    }
    previewReadyUrl.value = "";
    requestPreviewState();
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
    previewVisitedUrl.value = previewUrlWithoutReload(baseUrl);
  }, {
    immediate: true
  });
  
  watch(previewToolbarStorageKey, (storageKey) => {
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
    embeddedTerminalVisible,
    handlePreviewFrameLoad,
    launchActions,
    launchButtonsDisabled,
    launchTargets,
    launchToolbarDockVisible,
    loading,
    loadError,
    manualLaunchMenuVisible,
    movePreviewToolbar,
    openAction,
    operationBusy,
    previewBaseUrl,
    previewDisplayedUrl,
    previewEmptyText,
    previewFrame,
    previewLoadingOverlayVisible,
    previewOptions,
    previewOptionsAvailable,
    previewOptionsDialogVisible,
    previewOptionsFormValues,
    previewOptionsPrimaryLabel,
    previewOptionsRemember,
    previewRetryButtonVisible,
    previewStarting,
    previewToolbarPosition,
    previewUrl,
    copyPreviewUrl,
    openPreviewOptions,
    recoverEmbeddedPreview,
    reloadPreview,
    savePreviewOptions,
    restartTerminal,
    retryTerminal,
    run,
    runMenuDisabled,
    setTerminalHost,
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
  launchStarting = false,
  loading = false,
  previewAutoStartPreparing = false,
  previewManualStartAvailable = false,
  previewProxyUnavailable = false,
  previewStarting = false,
  previewTargetDisabledReason = "",
  terminalIsRunning = false
} = {}) {
  if (previewProxyUnavailable) {
    const reason = String(previewTargetDisabledReason || "").trim();
    return reason || "Starting preview.";
  }
  if (launchStarting || previewStarting || terminalIsRunning) {
    return "Starting preview.";
  }
  if (previewAutoStartPreparing) {
    return "Preparing preview.";
  }
  if (previewManualStartAvailable) {
    return "Preview is ready to start.";
  }
  if (loading) {
    return "Loading preview targets.";
  }
  return "Preview will appear here when it is ready.";
}

export {
  launchPreviewEmptyText,
  useVibe64LaunchControlsSurface
};
