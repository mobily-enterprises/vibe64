import { computed, onBeforeUnmount, ref } from "vue";
import {
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_PICK_STOP_MESSAGE_TYPE,
  PREVIEW_QUERY_MESSAGE_TYPE
} from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import { useVibe64LearningOrientation } from "@/composables/useVibe64LearningOrientation.js";
import { previewVisibleViewportRect } from "@/composables/useVibe64PreviewCapture.js";
import { vibe64SessionDebugLog } from "@/lib/vibe64SessionDebugLog.js";
import { resolveLaunchPreviewDestination } from "@/lib/vibe64LaunchPreviewDestination.js";
import {
  launchPreviewFrameUrl,
  redactPreviewDebugDetails
} from "@/lib/vibe64PreviewAddress.js";
import {
  createPreviewBridgeRequestRegistry,
  isPreviewBridgeReadyMessage,
  previewFrameLeftForEditor,
  previewFrameLifecycleIdentity,
  previewIdentityLifecycleIdentity,
  previewLoadingOverlayShouldShow
} from "@/lib/vibe64PreviewFrame.js";

const PREVIEW_DIAGNOSTICS_TIMEOUT_MS = 3000;
const PREVIEW_IDENTITY_TIMEOUT_MS = 10000;
// A frame that lands on the editor's own site again within this time stays empty instead of reloading in a loop.
const PREVIEW_LEFT_RECOVERY_INTERVAL_MS = 60_000;
const PREVIEW_LEFT_RELOADED_NOTICE = "Vibe64's own page had replaced your app here, so your app was loaded again.";
const PREVIEW_LEFT_EMPTIED_NOTICE = "Vibe64's own page replaced your app here again, so the Preview was emptied. Use Reload preview to load your app.";

/**
 * The embedded Preview's frame: the address it embeds, the page it loads (a
 * new request whenever that page's identity changes), the bridge in that page
 * and the requests sent to it, Click in Preview's picking mode, and Learning's
 * orientation channel bound to the frame. The callbacks are late-bound: the
 * identity and reload concerns are composed after the frame they build on, and
 * the frame calls them only once its page changes.
 * `identityBusy()` says whether an identity switch is in flight;
 * `followIdentityReload(frameRequestId)` moves an identity reload in flight to
 * a newer frame request; `identityFrameReady(frameRequestId)` reports a ready
 * page, again when a bridge announces itself in a page already ready;
 * `resourceRetryCount()` is the current page's resource retries.
 * @param {{
 *   identityBusy: () => boolean,
 *   followIdentityReload: (frameRequestId: number) => void,
 *   identityFrameReady: (frameRequestId: number) => void,
 *   outputs: import("@/types.js").Vibe64OutputControls,
 *   projectSlug: import("vue").Ref<string>,
 *   props: { embeddedPreview?: boolean, previewDisplayed?: boolean, session?: object | null, windowDisplayed?: boolean },
 *   resourceRetryCount: () => number
 * }} options
 */
function useVibe64PreviewFrame({
  followIdentityReload,
  identityBusy,
  identityFrameReady,
  outputs,
  projectSlug,
  props,
  resourceRetryCount
}) {
  const {
    activeOutputTargetId,
    launchActions,
    previewState,
    publishPreviewDiagnostic,
    terminalPreviewRequiresProxy,
    terminalSessionId
  } = outputs;
  const previewFrame = ref(null);
  const previewLeftNotice = ref("");
  let previewLeftNoticeTimer = null;
  const previewSuspended = ref(false);
  const previewBridgeVersion = ref(0);
  // The origin whose bridge announced itself in the frame. Requests go only to
  // it, so a frame that navigated elsewhere never receives a grant or query.
  let previewBridgeOrigin = "";
  const previewBridgeRequests = createPreviewBridgeRequestRegistry();
  const previewDiagnosticsBusy = ref(false);
  const previewPicking = ref(false);
  const previewFrameRequest = ref({
    id: 0,
    identity: "",
    src: ""
  });
  const previewLoadedFrameRequestId = ref(0);
  const previewVisitedUrl = ref("");
  const previewDestination = computed(() => resolveLaunchPreviewDestination(launchActions.value, {
    requirePreviewProxy: terminalPreviewRequiresProxy.value
  }));
  const previewBaseUrl = computed(() => previewDestination.value.embedHref);
  const previewEmbedUnavailableReason = computed(() => previewDestination.value.unavailableReason);
  const previewDisplayBaseUrl = computed(() => previewDestination.value.displayHref);
  const previewPaneDisplayed = computed(() => props.previewDisplayed !== false);
  const previewReadyForIframe = computed(() => Boolean(
    ["ready", "stale"].includes(previewState.value) &&
    previewBaseUrl.value
  ));
  const previewIdentityLifecycleKey = computed(() => previewIdentityLifecycleIdentity({
    outputTargetId: activeOutputTargetId.value,
    previewBaseUrl: previewBaseUrl.value,
    projectSlug: projectSlug.value,
    sessionId: props.session?.sessionId,
    terminalSessionId: terminalSessionId.value
  }));
  const previewFrameRequestId = computed(() => previewFrameRequest.value.id);
  const previewUrl = computed(() => previewFrameRequest.value.src);
  const previewFrameLoaded = computed(() => Boolean(
    previewUrl.value &&
    previewFrameRequestId.value > 0 &&
    previewLoadedFrameRequestId.value === previewFrameRequestId.value
  ));
  const previewDiagnosticsAvailable = computed(() => Boolean(
    previewFrameLoaded.value &&
    previewFrame.value?.contentWindow &&
    previewBridgeVersion.value >= PREVIEW_BRIDGE_VERSION
  ));
  const previewLoadingOverlayVisible = computed(() => previewLoadingOverlayShouldShow({
    identityBusy: identityBusy(),
    loadedFrameRequestId: previewLoadedFrameRequestId.value,
    previewFrameRequestId: previewFrameRequestId.value,
    previewUrl: previewUrl.value
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
    if (["resource.failed", "resource.retry", "resource.retry.skipped", "resource.retry.unavailable",
      "frame.requested", "iframe.loaded", "iframe.ready"].includes(event)) {
      // Only fixed diagnostic fields cross the authenticated action boundary.
      void publishPreviewDiagnostic({ event, timestamp: new Date().toISOString(),
        frameUrl: previewUrl.value, frameRequestId: previewFrameRequestId.value,
        resourceUrl: details.resourceUrl || "", resourceKind: details.resourceKind || "resource",
        retryCount: details.retryCount ?? resourceRetryCount(), willRetry: details.willRetry === true });
    }
    vibe64SessionDebugLog(`client.launchPreview.${event}`, redactPreviewDebugDetails({
      frameRequestId: previewFrameRequestId.value,
      frameSrc: String(previewFrame.value?.getAttribute("src") || ""),
      loadedFrameRequestId: previewLoadedFrameRequestId.value,
      overlayVisible: previewLoadingOverlayVisible.value,
      previewBaseUrl: previewBaseUrl.value,
      previewDisplayBaseUrl: previewDisplayBaseUrl.value,
      previewState: previewState.value,
      previewUrl: previewUrl.value,
      projectSlug: projectSlug.value,
      sessionId: String(props.session?.sessionId || ""),
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
    }));
  }

  function resetPreviewBridge(reason = "") {
    switchPreviewPicking(false);
    previewBridgeVersion.value = 0;
    previewBridgeOrigin = "";
    previewBridgeRequests.rejectAll("The application preview changed.");
    previewDiagnosticsBusy.value = false;
    previewDebugLog("bridge.reset", {
      reason
    });
  }

  /** Whether the page in the frame has a bridge: the Preview's starting page has none. */
  function previewBridgeAnnounced() {
    return Boolean(previewBridgeOrigin);
  }

  function postToPreviewBridge(message = {}) {
    const target = previewFrame.value?.contentWindow;
    if (!target || !previewBridgeOrigin) {
      return false;
    }
    target.postMessage({ ...message, version: PREVIEW_BRIDGE_VERSION }, previewBridgeOrigin);
    return true;
  }

  function previewPickKeydown(event) {
    if (event?.key === "Escape") {
      stopPreviewPick();
    }
  }

  function switchPreviewPicking(picking) {
    if (previewPicking.value === picking) {
      return;
    }
    previewPicking.value = picking;
    if (picking) {
      window.addEventListener("keydown", previewPickKeydown);
    } else {
      window.removeEventListener("keydown", previewPickKeydown);
    }
  }

  function stopPreviewPick() {
    if (previewPicking.value) {
      switchPreviewPicking(false);
      postToPreviewBridge({ type: PREVIEW_PICK_STOP_MESSAGE_TYPE });
    }
  }

  function previewFrameVisible(frame) {
    return Boolean(frame) && previewFrameLoaded.value && previewPaneDisplayed.value &&
      props.windowDisplayed !== false && document.visibilityState === "visible" &&
      Boolean(previewVisibleViewportRect(frame.getBoundingClientRect(), {
        width: window.innerWidth, height: window.innerHeight
      }));
  }

  // Learning's practice App orientation channel, bound to the displayed frame.
  const orientation = useVibe64LearningOrientation({
    preview: () => props.embeddedPreview && previewUrl.value ? {
      frame: previewFrame.value,
      frameRequestId: previewFrameRequestId.value,
      loaded: previewFrameLoaded.value,
      displayed: previewPaneDisplayed.value && props.windowDisplayed !== false,
      projectSlug: projectSlug.value,
      sessionId: props.session?.sessionId,
      terminalSessionId: terminalSessionId.value
    } : null,
    frameVisible: previewFrameVisible
  });

  function clearPreviewFrame(reason = "") {
    orientation.close();
    resetPreviewBridge(reason || "frame-cleared");
    if (!previewFrameRequest.value.src) {
      return false;
    }
    previewFrameRequest.value = {
      id: previewFrameRequest.value.id + 1,
      identity: "",
      src: ""
    };
    previewLoadedFrameRequestId.value = 0;
    previewDebugLog("frame.cleared", {
      reason
    });
    return true;
  }

  function requestPreviewFrame({
    force = false,
    reason = "",
    src = "",
    visitedUrl = previewVisitedUrl.value
  } = {}) {
    if (previewSuspended.value || !previewReadyForIframe.value) {
      return false;
    }
    const nextSrc = String(src || "").trim() || launchPreviewFrameUrl({
      baseUrl: previewBaseUrl.value,
      displayBaseUrl: previewDisplayBaseUrl.value,
      visitedUrl: visitedUrl || previewDisplayBaseUrl.value || previewBaseUrl.value
    });
    const nextIdentity = previewFrameLifecycleIdentity({
      outputTargetId: activeOutputTargetId.value,
      sessionId: props.session?.sessionId,
      src: nextSrc,
      terminalSessionId: terminalSessionId.value
    });
    if (!nextIdentity || (!force && nextIdentity === previewFrameRequest.value.identity)) {
      return false;
    }
    orientation.close();
    resetPreviewBridge(reason || "frame-requested");
    previewFrameRequest.value = {
      id: previewFrameRequest.value.id + 1,
      identity: nextIdentity,
      src: nextSrc
    };
    followIdentityReload(previewFrameRequest.value.id);
    if (previewLeftNotice.value === PREVIEW_LEFT_EMPTIED_NOTICE) {
      previewLeftNotice.value = "";
    }
    previewDebugLog("frame.requested", {
      force,
      reason,
      src: nextSrc
    });
    return true;
  }

  function requestPreviewState() {
    if (!previewPaneDisplayed.value || !previewFrame.value?.contentWindow || !previewUrl.value || !previewBridgeOrigin) {
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
    }, previewBridgeOrigin);
  }

  async function requestPreviewDiagnostics({ signal = null } = {}) {
    if (previewDiagnosticsBusy.value) {
      throw new Error("Preview diagnostics are already being collected.");
    }
    if (!previewDiagnosticsAvailable.value) {
      throw new Error("Preview diagnostics are not available for the current app page.");
    }
    previewDiagnosticsBusy.value = true;
    try {
      return await previewBridgeRequests.request({
        frameRequestId: previewFrameRequestId.value,
        message: {
          type: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE
        },
        signal,
        targetOrigin: previewBridgeOrigin,
        targetWindow: previewFrame.value?.contentWindow,
        timeoutMessage: "The proxied app did not return its diagnostics in time.",
        timeoutMs: PREVIEW_DIAGNOSTICS_TIMEOUT_MS
      });
    } finally {
      previewDiagnosticsBusy.value = false;
    }
  }

  function requestPreviewIdentityExchange(grant = "") {
    if (!previewFrameLoaded.value) {
      return Promise.reject(new Error("The application preview is not ready to switch identity."));
    }
    return previewBridgeRequests.request({
      frameRequestId: previewFrameRequestId.value,
      message: {
        grant: String(grant || ""),
        type: PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE
      },
      targetOrigin: previewBridgeOrigin,
      targetWindow: previewFrame.value?.contentWindow,
      timeoutMessage: "The application preview did not complete the identity exchange in time.",
      timeoutMs: PREVIEW_IDENTITY_TIMEOUT_MS
    });
  }

  function markPreviewFrameReady(requestId, reason = "") {
    const normalizedRequestId = Math.max(0, Number(requestId) || 0);
    if (
      !normalizedRequestId ||
      normalizedRequestId !== previewFrameRequestId.value ||
      !previewFrame.value?.contentWindow
    ) {
      return false;
    }
    if (previewLoadedFrameRequestId.value === normalizedRequestId) {
      return false;
    }
    previewLoadedFrameRequestId.value = normalizedRequestId;
    previewDebugLog("iframe.ready", {
      reason,
      requestId: normalizedRequestId
    });
    identityFrameReady(normalizedRequestId);
    return true;
  }

  function handlePreviewFrameLoad(event) {
    const frame = event?.currentTarget || null;
    const requestId = Number(frame?.dataset?.previewFrameRequestId || 0);
    if (
      !requestId ||
      frame !== previewFrame.value ||
      requestId !== previewFrameRequestId.value
    ) {
      previewDebugLog("iframe.loadIgnored", {
        requestId
      });
      return;
    }
    const leftPreview = previewFrameLeftForEditor(frame, {
      editorOrigin: window.location.origin,
      previewBaseUrl: previewBaseUrl.value
    });
    if (leftPreview) {
      recoverPreviewFrameFromEditorPage(leftPreview);
      return;
    }
    if (!previewFrameLoaded.value) {
      resetPreviewBridge("iframe-loaded-without-bridge-ready");
      markPreviewFrameReady(requestId, "iframe-load");
    }
    previewDebugLog("iframe.loaded", {
      requestId
    });
    requestPreviewState();
  }

  // The frame shows the editor's own site, Vibe64 itself, inside the app's Preview. What took it there is recorded,
  // and the app's page is loaded again; a second time within a minute empties the frame instead.
  let previewLeftRecoveredAt = 0;
  function recoverPreviewFrameFromEditorPage(leftPreview) {
    void publishPreviewDiagnostic({
      event: "frame.left-preview",
      frameRequestId: previewFrameRequestId.value,
      frameUrl: leftPreview.frameUrl,
      navigationType: leftPreview.navigationType,
      referrer: leftPreview.referrer,
      timestamp: new Date().toISOString()
    });
    console.error("[Vibe64 preview] The Preview frame left the app for Vibe64's own page; loading the app again.");
    const now = Date.now();
    if (now - previewLeftRecoveredAt < PREVIEW_LEFT_RECOVERY_INTERVAL_MS ||
      !requestPreviewFrame({ force: true, reason: "frame-left-preview" })) {
      clearPreviewFrame("frame-left-preview");
      showPreviewLeftNotice(PREVIEW_LEFT_EMPTIED_NOTICE);
      return;
    }
    previewLeftRecoveredAt = now;
    showPreviewLeftNotice(PREVIEW_LEFT_RELOADED_NOTICE);
  }

  // Said where the person sees it, so they can tell someone: the reload notice for a minute, the emptied one until the
  // next frame request loads the app again.
  function showPreviewLeftNotice(text) {
    clearTimeout(previewLeftNoticeTimer);
    previewLeftNotice.value = text;
    previewLeftNoticeTimer = text === PREVIEW_LEFT_RELOADED_NOTICE
      ? setTimeout(() => { previewLeftNotice.value = ""; }, PREVIEW_LEFT_RECOVERY_INTERVAL_MS)
      : null;
  }

  // Every bridge message raises the bridge version the page speaks. A ready
  // announcement names the origin requests go to and marks the page ready; one
  // from a page already loaded means it reloaded inside the same frame.
  function receivePreviewBridgeMessage(event) {
    const bridgeReady = isPreviewBridgeReadyMessage(event.data);
    const frameAlreadyReady = bridgeReady && previewFrameLoaded.value;
    if (frameAlreadyReady) {
      orientation.close();
      resetPreviewBridge("bridge-document-ready");
    }
    previewBridgeVersion.value = Math.max(
      previewBridgeVersion.value,
      Math.max(0, Number(event?.data?.version) || 0)
    );
    if (bridgeReady) {
      previewBridgeOrigin = String(event.origin || "");
      // The bridge announces readiness as soon as its listeners are installed.
      // Application modules and rendering may still be pending.
      markPreviewFrameReady(previewFrameRequestId.value, "bridge-ready");
      // The page before this one may have had no bridge, so what waits for one starts now.
      if (frameAlreadyReady) identityFrameReady(previewFrameRequestId.value);
    }
    return bridgeReady;
  }

  /** The page's pending bridge requests no longer apply: reject them. */
  function cancelPreviewBridgeRequests(message) {
    previewBridgeRequests.rejectAll(message);
    previewDiagnosticsBusy.value = false;
  }

  onBeforeUnmount(() => {
    clearTimeout(previewLeftNoticeTimer);
    stopPreviewPick();
    previewBridgeRequests.rejectAll("The application preview closed.");
  });

  return {
    cancelPreviewBridgeRequests,
    clearPreviewFrame,
    handlePreviewFrameLoad,
    orientation,
    postToPreviewBridge,
    previewBaseUrl,
    previewBridgeAnnounced,
    previewBridgeRequests,
    previewBridgeVersion,
    previewDebugLog,
    previewDiagnosticsAvailable,
    previewDiagnosticsBusy,
    previewDisplayBaseUrl,
    previewEmbedUnavailableReason,
    previewFrame,
    previewFrameLoaded,
    previewFrameRequestId,
    previewIdentityLifecycleKey,
    previewLeftNotice,
    previewLoadingOverlayVisible,
    previewPaneDisplayed,
    previewPicking,
    previewReadyForIframe,
    previewSuspended,
    previewUrl,
    previewVisitedUrl,
    receivePreviewBridgeMessage,
    requestPreviewDiagnostics,
    requestPreviewFrame,
    requestPreviewIdentityExchange,
    requestPreviewState,
    switchPreviewPicking,
    stopPreviewPick
  };
}

export {
  useVibe64PreviewFrame
};
