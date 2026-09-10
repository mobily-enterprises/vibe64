import { computed, nextTick, onBeforeMount, onBeforeUnmount, ref, watch } from "vue";
import {
  launchPreviewLocationStorageKey,
  launchPreviewToolbarStorageKey,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition,
  resolveLaunchPreviewDestination,
  useVibe64OutputControls
} from "@/composables/useVibe64OutputControls.js";
import {
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
} from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import {
  managedPreviewTarget,
  preferredPreviewTarget
} from "@local/studio-terminal-core/shared";
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
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
} from "@/lib/vibe64PreviewRoutes.js";

const PREVIEW_IDENTITY_TYPE_EMAIL = "email";
const PREVIEW_IDENTITY_TYPE_LOGIN = "login";
const PREVIEW_IDENTITY_TYPE_USER_ID = "user-id";
const PREVIEW_IDENTITY_TYPES = Object.freeze([
  PREVIEW_IDENTITY_TYPE_EMAIL,
  PREVIEW_IDENTITY_TYPE_LOGIN,
  PREVIEW_IDENTITY_TYPE_USER_ID
]);
const PREVIEW_DISPLAY_QUERY_PARAMS = Object.freeze([
  PREVIEW_PROXY_TOKEN_QUERY_PARAM
]);
const PREVIEW_DIAGNOSTICS_TIMEOUT_MS = 3000;
const PREVIEW_IDENTITY_TIMEOUT_MS = 10000;
const PREVIEW_RESOURCE_RETRY_DELAY_MS = 250;
const PREVIEW_RESOURCE_RETRY_LIMIT = 1;

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

function launchPreviewFrameUrl({
  baseUrl = "",
  displayBaseUrl = "",
  visitedUrl = ""
} = {}) {
  const baseText = String(baseUrl || "").trim();
  if (!baseText) {
    return "";
  }
  const routeSource = String(visitedUrl || displayBaseUrl || baseText).trim();
  try {
    const base = new URL(baseText);
    const route = new URL(routeSource, String(displayBaseUrl || baseText));
    const token = base.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM) || "";
    base.pathname = route.pathname;
    base.search = route.search;
    base.hash = route.hash;
    if (token) {
      base.searchParams.set(PREVIEW_PROXY_TOKEN_QUERY_PARAM, token);
    }
    return base.toString();
  } catch {
    return baseText;
  }
}

function previewFrameLifecycleIdentity({
  outputTargetId = "",
  sessionId = "",
  src = "",
  terminalSessionId = ""
} = {}) {
  return previewLifecycleIdentity([
    String(sessionId || "").trim(),
    String(outputTargetId || "").trim(),
    String(terminalSessionId || "").trim()
  ], src);
}

function previewIdentityLifecycleIdentity({
  outputTargetId = "",
  previewBaseUrl = "",
  projectSlug = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  return previewLifecycleIdentity([
    String(projectSlug || "").trim(),
    String(sessionId || "").trim(),
    String(outputTargetId || "").trim(),
    String(terminalSessionId || "").trim()
  ], previewBaseUrl);
}

function previewLifecycleIdentity(parts = [], url = "") {
  const canonicalUrl = previewUrlWithoutDisplayParams(url);
  return canonicalUrl
    ? [...parts, canonicalUrl].join("\u0000")
    : "";
}

function previewIdentityLabelText({
  busy = false,
  identity = null
} = {}) {
  if (busy) {
    return "Switching identity";
  }
  if (!identity) {
    return "Identity not confirmed";
  }
  if (identity.mode === "guest") {
    return "Guest";
  }
  const selectorValue = String(
    identity.selector?.value || identity.email || identity.login || identity.userId || ""
  ).trim();
  const name = String(identity.name || identity.displayName || "").trim();
  return name && name !== selectorValue
    ? `${name} — ${selectorValue}`
    : name || selectorValue || "Selected app identity";
}

function previewIdentityTitleText({
  busy = false,
  error = "",
  identity = null
} = {}) {
  if (busy) {
    return "Switching preview identity…";
  }
  const message = String(error || "").trim();
  return message
    ? `Preview identity failed: ${message}`
    : `Previewing as ${previewIdentityLabelText({ identity })}`;
}

function normalizePreviewIdentitySelector(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = String(source.type || "").trim();
  const rawValue = String(source.value || "").trim();
  if (!PREVIEW_IDENTITY_TYPES.includes(type) || !rawValue) {
    return null;
  }
  const normalizedValue = type === PREVIEW_IDENTITY_TYPE_EMAIL
    ? rawValue.toLowerCase()
    : rawValue;
  if (
    (type === PREVIEW_IDENTITY_TYPE_EMAIL && (!normalizedValue.includes("@") || normalizedValue.length > 320)) ||
    (type !== PREVIEW_IDENTITY_TYPE_EMAIL && normalizedValue.length > 256)
  ) {
    return null;
  }
  return {
    type,
    value: normalizedValue
  };
}

function normalizeConfiguredPreviewIdentities(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  const identities = [];
  const names = new Set();
  for (const entry of value) {
    const name = String(entry?.name || "").trim().toLowerCase();
    const selector = normalizePreviewIdentitySelector({
      type: entry?.type,
      value: entry?.value
    });
    if (!name || names.has(name) || !selector) {
      continue;
    }
    names.add(name);
    identities.push({
      name,
      selector,
      type: selector.type,
      value: selector.value
    });
  }
  return identities;
}

function previewIdentityTypeLabel(type = "") {
  return {
    [PREVIEW_IDENTITY_TYPE_EMAIL]: "Email",
    [PREVIEW_IDENTITY_TYPE_LOGIN]: "Login name",
    [PREVIEW_IDENTITY_TYPE_USER_ID]: "User ID"
  }[String(type || "").trim()] || "User identifier";
}

function previewIdentityFromExchange(exchangeResult = {}, requestedIdentity = {}) {
  if (requestedIdentity.mode === "guest") {
    return {
      mode: "guest"
    };
  }
  const identity = exchangeResult?.identity && typeof exchangeResult.identity === "object"
    ? exchangeResult.identity
    : {};
  const selector = normalizePreviewIdentitySelector(
    identity.selector || requestedIdentity.selector
  );
  const email = String(identity.email || (selector?.type === PREVIEW_IDENTITY_TYPE_EMAIL
    ? selector.value
    : "")).trim().toLowerCase();
  const login = String(identity.login || (selector?.type === PREVIEW_IDENTITY_TYPE_LOGIN
    ? selector.value
    : "")).trim();
  const userId = String(identity.userId || (selector?.type === PREVIEW_IDENTITY_TYPE_USER_ID
    ? selector.value
    : "")).trim();
  const username = String(identity.username || "").trim();
  return {
    displayName: String(
      identity.displayName || username || requestedIdentity.displayName || requestedIdentity.name || selector?.value || ""
    ).trim(),
    email,
    login,
    mode: requestedIdentity.mode,
    name: String(requestedIdentity.name || "").trim(),
    selector,
    userId,
    username
  };
}

function isPreviewBridgeReadyMessage(value = {}) {
  return String(value?.type || "") === PREVIEW_BRIDGE_READY_MESSAGE_TYPE;
}

function previewLoadingOverlayShouldShow({
  identityBusy = false,
  loadedFrameRequestId = 0,
  previewFrameRequestId = 0,
  previewUrl = ""
} = {}) {
  return Boolean(identityBusy || previewOpeningOverlayVisible({
    loadedFrameRequestId,
    previewFrameRequestId,
    previewUrl
  }));
}

function defaultPreviewIdentitySelection({
  capability = null
} = {}) {
  const name = String(capability?.defaultIdentityName || "").trim();
  return capability?.defaultMode === "identity" && name
    ? {
        identityName: name,
        mode: "identity"
      }
    : {
        mode: "guest"
      };
}

function createPreviewBridgeRequestRegistry() {
  const pendingRequests = new Map();
  let sequence = 0;

  function take(requestId = "") {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return null;
    }
    clearTimeout(pending.timeout);
    pending.signal?.removeEventListener?.("abort", pending.abortHandler);
    pendingRequests.delete(requestId);
    return pending;
  }

  function reject(requestId, error) {
    const pending = take(requestId);
    pending?.reject(error);
    return Boolean(pending);
  }

  function rejectAll(message = "The application preview changed.") {
    for (const requestId of [...pendingRequests.keys()]) {
      reject(requestId, new Error(message));
    }
  }

  function request({
    frameRequestId = 0,
    message = {},
    signal = null,
    targetWindow = null,
    timeoutMessage = "The application preview did not respond in time.",
    timeoutMs = 3000
  } = {}) {
    if (!targetWindow || typeof targetWindow.postMessage !== "function") {
      return Promise.reject(new Error("The application preview is not ready."));
    }
    if (signal?.aborted) {
      const error = new Error("Preview diagnostics collection was cancelled.");
      error.name = "AbortError";
      return Promise.reject(error);
    }
    const requestId = [frameRequestId, Date.now(), ++sequence].join(":");
    const response = new Promise((resolve, rejectRequest) => {
      const abortHandler = () => {
        const error = new Error("Preview diagnostics collection was cancelled.");
        error.name = "AbortError";
        reject(requestId, error);
      };
      const timeout = setTimeout(() => {
        reject(requestId, new Error(timeoutMessage));
      }, timeoutMs);
      pendingRequests.set(requestId, {
        abortHandler,
        reject: rejectRequest,
        resolve,
        signal,
        timeout
      });
      signal?.addEventListener?.("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
      }
    });
    try {
      targetWindow.postMessage({
        ...message,
        requestId
      }, "*");
    } catch (error) {
      reject(requestId, error);
    }
    return response;
  }

  function resolve(requestId, value) {
    const pending = take(requestId);
    pending?.resolve(value);
    return Boolean(pending);
  }

  return Object.freeze({
    reject,
    rejectAll,
    request,
    resolve
  });
}

function previewUrlForDebug(value = "") {
  return previewUrlWithoutDisplayParams(value);
}

function redactPreviewDebugDetails(value) {
  if (typeof value === "string") {
    return value.includes(PREVIEW_PROXY_TOKEN_QUERY_PARAM)
      ? previewUrlForDebug(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPreviewDebugDetails(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    redactPreviewDebugDetails(entry)
  ]));
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
  const previewBaseText = String(previewBaseUrl || "").trim();
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
      previewUrl: launchPreviewFrameUrl({
        baseUrl: previewBaseText,
        displayBaseUrl: displayBaseText,
        visitedUrl: displayTarget.toString()
      })
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

function useVibe64OutputControlsSurface(props) {
  const {
    activeOutputTarget,
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
    outputExecution,
    outputResults,
    outputRuns,
    outputTargets,
    loading,
    loadError,
    minimizeTerminal,
    openAction,
    operationBusy,
    previewCanRestart,
    previewCanShowLog,
    previewCanStart,
    previewIdentity: previewIdentityCapability,
    previewMessage,
    previewState,
    publishPreviewState,
    requestPreviewIdentityGrant,
    refresh: refreshOutputs,
    restartTerminal,
    retryTerminal,
    run,
    startNewlyConfiguredWorkspaceSetup,
    terminal,
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
    terminalPreviewRequiresProxy,
    terminalStatus,
    terminalSessionId,
    terminalSubtitle,
    terminalTitle,
    terminalVisible,
    terminalWindowVisible,
    terminalWindowStorageKey,
    visible
  } = useVibe64OutputControls({
    autoStartManagedPreview: () => props.autoStartManagedPreview,
    autoStartTargetId: () => props.autoStartTargetId,
    embeddedPreview: () => props.embeddedPreview,
    previewDisplayed: () => props.previewDisplayed,
    sourceOperationsSuspended: () => props.sourceOperationsSuspended,
    windowDisplayed: () => props.windowDisplayed,
    busy: () => props.busy,
    session: () => props.session
  });

  const runMenuDisabled = computed(() => Boolean(
    launchButtonsDisabled.value ||
    loading.value ||
    outputTargets.value.length < 1
  ));
  const previewFrame = ref(null);
  const previewBridgeVersion = ref(0);
  const previewBridgeRequests = createPreviewBridgeRequestRegistry();
  const previewDiagnosticsBusy = ref(false);
  const previewIdentityBusy = ref(false);
  const previewIdentityCurrent = ref(null);
  const previewIdentityError = ref("");
  const previewIdentityRequested = ref(null);
  const previewResourceNoticeText = ref("");
  const previewResourceNoticeVisible = ref(false);
  let previewIdentityAutomaticAttempt = "";
  let previewIdentityLifecycle = "";
  let previewIdentityReloadRequestId = 0;
  let previewResourceRetryCount = 0;
  let previewResourceRetryLifecycle = "";
  let previewResourceRetryTimer = null;
  const previewFrameRequest = ref({
    id: 0,
    identity: "",
    src: ""
  });
  const previewLoadedFrameRequestId = ref(0);
  const previewAddressDraft = ref("");
  const previewAddressError = ref("");
  const previewAddressFocused = ref(false);
  const previewHistory = ref([]);
  const previewRouteDialogVisible = ref(false);
  const previewRouteDialogError = ref("");
  const previewRouteFormValues = ref({});
  const previewRouteSelection = ref(null);
  const previewLogVisible = ref(false);
  const previewVisitedUrl = ref("");
  const previewToolbarExpanded = ref(false);
  const previewToolbarPosition = ref("center");
  const projectSlug = useVibe64ProjectSlug();
  const toolbarTeleportTarget = computed(() => String(props.toolbarTeleportTarget || "").trim());
  const embeddedTerminalVisible = computed(() => Boolean(
    props.embeddedPreview &&
    terminalDisplayed.value &&
    terminalExpanded.value
  ));
  const terminalSurfaceVisible = computed(() => Boolean(
    terminalDisplayed.value && terminalVisible.value
  ));
  const embeddedTerminalSurfaceVisible = computed(() => Boolean(
    props.embeddedPreview && terminalSurfaceVisible.value && terminalExpanded.value
  ));
  const requestedAutoStartTargetId = computed(() => String(props.autoStartTargetId || "").trim());
  const embeddedAutoStartTarget = computed(() => {
    if (!props.embeddedPreview || !requestedAutoStartTargetId.value) {
      return null;
    }
    return outputTargets.value.find((target) => (
      target.id === requestedAutoStartTargetId.value && target.presentation?.kind === "web"
    )) || null;
  });
  const embeddedStartTarget = computed(() => {
    if (!props.embeddedPreview) {
      return null;
    }
    return embeddedAutoStartTarget.value ||
      managedPreviewTarget(outputTargets.value) ||
      preferredPreviewTarget(outputTargets.value);
  });
  const embeddedStartTargetUnavailableReason = computed(() => {
    const target = embeddedStartTarget.value;
    return target?.available === false
      ? String(target.disabledReason || "Preview cannot start yet.").trim()
      : "";
  });
  const embeddedManualStartButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    embeddedStartTarget.value &&
    embeddedStartTarget.value.available !== false &&
    !terminalVisible.value
  ));
  const embeddedManualStartButtonDisabled = computed(() => Boolean(
    operationBusy.value ||
    !embeddedStartTarget.value ||
    embeddedStartTarget.value.available === false
  ));
  const manualLaunchMenuVisible = computed(() => Boolean(
    !terminalVisible.value &&
    outputTargets.value.length > 0 &&
    !(
      props.embeddedPreview &&
      embeddedStartTarget.value &&
      (requestedAutoStartTargetId.value || props.autoStartManagedPreview)
    )
  ));
  const previewToolbarStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewToolbarStorageKey(props.session, projectSlug.value)
    : "");
  const previewLocationStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewLocationStorageKey(props.session, projectSlug.value)
    : "");
  const previewContextTarget = computed(() => (
    embeddedAutoStartTarget.value || activeOutputTarget.value || embeddedStartTarget.value || null
  ));
  const previewRoutes = computed(() => previewRoutesForTarget(previewContextTarget.value));
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
  const previewDestination = computed(() => resolveLaunchPreviewDestination(launchActions.value, {
    requirePreviewProxy: terminalPreviewRequiresProxy.value
  }));
  const previewBaseUrl = computed(() => previewDestination.value.embedHref);
  const previewEmbedUnavailableReason = computed(() => previewDestination.value.unavailableReason);
  const previewDisplayBaseUrl = computed(() => previewDestination.value.displayHref);
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
  const previewIdentityAvailable = computed(() => Boolean(
    props.embeddedPreview &&
    previewIdentityCapability.value?.available === true
  ));
  const previewIdentityConfigured = computed(() => normalizeConfiguredPreviewIdentities(
    previewIdentityCapability.value?.identities
  ));
  const previewIdentityLifecycleKey = computed(() => previewIdentityLifecycleIdentity({
    outputTargetId: activeOutputTarget.value?.id || terminal.value?.metadata?.outputTargetId,
    previewBaseUrl: previewBaseUrl.value,
    projectSlug: projectSlug.value,
    sessionId: props.session?.sessionId,
    terminalSessionId: terminalSessionId.value
  }));
  const previewIdentityLabel = computed(() => previewIdentityLabelText({
    busy: previewIdentityBusy.value,
    identity: previewIdentityCurrent.value
  }));
  const previewIdentityTitle = computed(() => previewIdentityTitleText({
    busy: previewIdentityBusy.value,
    error: previewIdentityError.value,
    identity: previewIdentityCurrent.value
  }));
  const previewFrameRequestId = computed(() => previewFrameRequest.value.id);
  const previewUrl = computed(() => previewFrameRequest.value.src);
  const previewFrameLoaded = computed(() => Boolean(
    previewUrl.value &&
    previewFrameRequestId.value > 0 &&
    previewLoadedFrameRequestId.value === previewFrameRequestId.value
  ));
  const previewIdentitySelectionDisabled = computed(() => Boolean(
    previewIdentityBusy.value || !previewFrameLoaded.value
  ));
  const previewDiagnosticsAvailable = computed(() => Boolean(
    previewFrameLoaded.value &&
    previewFrame.value?.contentWindow &&
    previewBridgeVersion.value >= PREVIEW_BRIDGE_VERSION
  ));
  const previewCheckAgainVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewState.value === "idle" &&
    !previewUrl.value &&
    !terminalVisible.value &&
    embeddedStartTargetUnavailableReason.value &&
    !loadError.value
  ));
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
  const previewLoadingOverlayVisible = computed(() => previewLoadingOverlayShouldShow({
    identityBusy: previewIdentityBusy.value,
    loadedFrameRequestId: previewLoadedFrameRequestId.value,
    previewFrameRequestId: previewFrameRequestId.value,
    previewUrl: previewUrl.value
  }));
  const previewInFlightText = computed(() => {
    if (previewIdentityBusy.value) {
      const requested = previewIdentityRequested.value;
      return requested?.mode === "guest"
        ? "Signing out of the preview…"
        : `Opening preview as ${requested?.name || requested?.identityName || "the selected app identity"}…`;
    }
    return launchPreviewInFlightText({
      activeOutputTarget: activeOutputTarget.value,
      embeddedStartTarget: embeddedStartTarget.value,
      launchStarting: launchStarting.value,
      launchWaiting: launchWaiting.value,
      launchStatusText: launchStatusText.value,
      loading: loading.value,
      operationBusy: operationBusy.value,
      previewDisplayedAddress: previewDisplayedAddress.value,
      previewEmbedUnavailableReason: previewEmbedUnavailableReason.value,
      previewLoadingOverlayVisible: previewLoadingOverlayVisible.value,
      previewUrl: previewUrl.value,
      terminalCanRestart: terminalCanRestart.value,
      terminalCanRetry: terminalCanRetry.value,
      terminalIsRunning: terminalIsRunning.value
    });
  });
  const previewIssue = computed(() => launchPreviewIssue({
    launchError: launchError.value,
    message: previewMessage.value,
    state: previewState.value
  }));
  const previewIssueVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewIssue.value
  ));
  const previewNotice = computed(() => launchPreviewNotice({
    launchError: launchError.value,
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
  const previewRecoveryVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewNoticeVisible.value &&
    (
      (
        embeddedStartTarget.value?.available !== false &&
        (previewCanRestart.value || previewCanStart.value)
      ) ||
      terminalCanRestart.value ||
      terminalCanRetry.value
    )
  ));
  const previewRecoveryLabel = computed(() => (
    terminalCanRetry.value &&
    !previewCanRestart.value &&
    !previewCanStart.value &&
    !terminalCanRestart.value
      ? "Retry preview"
      : "Restart preview"
  ));
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
    (previewCanRestart.value || terminalCanRestart.value || terminalCanRetry.value) &&
    embeddedStartTarget.value
  ));
  const previewTerminalRecoveryVisible = computed(() => Boolean(
    props.embeddedPreview &&
    terminalVisible.value &&
    (previewCanRestart.value || terminalCanRestart.value || terminalCanRetry.value) &&
    embeddedStartTarget.value
  ));
  const previewActivityVisible = computed(() => Boolean(
    previewStarting.value ||
    launchStarting.value ||
    launchWaiting.value ||
    terminalIsRunning.value ||
    loading.value
  ));
  const previewEmptyText = computed(() => launchPreviewEmptyText({
    launchStatusText: launchStatusText.value,
    loading: loading.value,
    loadError: loadError.value,
    previewInFlightText: previewInFlightText.value,
    previewManualStartAvailable: embeddedManualStartButtonVisible.value,
    previewMessage: previewMessage.value,
    previewState: previewState.value,
    previewStartUnavailableReason: embeddedStartTargetUnavailableReason.value,
    launchStarting: launchStarting.value,
    outputTargetsUnavailable: launchStatusIdleRecoveryExhausted.value && outputTargets.value.length < 1,
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
    vibe64SessionDebugLog(`client.launchPreview.${event}`, redactPreviewDebugDetails({
      frameRequestId: previewFrameRequestId.value,
      frameSrc: String(previewFrame.value?.getAttribute?.("src") || ""),
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
    previewBridgeVersion.value = 0;
    previewBridgeRequests.rejectAll("The application preview changed.");
    previewDiagnosticsBusy.value = false;
    previewDebugLog("bridge.reset", {
      reason
    });
  }

  function cancelPreviewResourceRetry() {
    if (previewResourceRetryTimer !== null) {
      clearTimeout(previewResourceRetryTimer);
      previewResourceRetryTimer = null;
    }
  }

  function resetPreviewResourceRecovery(lifecycle = "") {
    cancelPreviewResourceRetry();
    previewResourceRetryCount = 0;
    previewResourceRetryLifecycle = String(lifecycle || "");
    previewResourceNoticeText.value = "";
    previewResourceNoticeVisible.value = false;
  }

  function showPreviewResourceNotice(message = "") {
    previewResourceNoticeText.value = String(message || "");
    previewResourceNoticeVisible.value = Boolean(previewResourceNoticeText.value);
  }

  function handlePreviewResourceFailure(message = {}) {
    const lifecycle = previewIdentityLifecycleKey.value;
    if (!lifecycle || !previewUrl.value) {
      return false;
    }
    if (previewResourceRetryLifecycle !== lifecycle) {
      resetPreviewResourceRecovery(lifecycle);
    }
    if (previewResourceRetryTimer !== null) {
      return false;
    }

    const resourceKind = String(message?.kind || "resource").trim() || "resource";
    const resourceUrl = String(message?.href || "").trim();
    const willRetry = previewResourceRetryCount < PREVIEW_RESOURCE_RETRY_LIMIT;
    const notice = willRetry
      ? "Preview could not load an application resource. Retrying automatically…"
      : "Preview could not load an application resource after retrying. Use Reload preview to try again.";
    showPreviewResourceNotice(notice);
    console.error(`[Vibe64 preview] ${notice}`, {
      resourceKind,
      resourceUrl
    });
    previewDebugLog("resource.failed", {
      resourceKind,
      resourceUrl,
      retryCount: previewResourceRetryCount,
      willRetry
    });
    if (!willRetry) {
      return false;
    }

    previewResourceRetryCount += 1;
    const failedFrameRequestId = previewFrameRequestId.value;
    previewResourceRetryTimer = setTimeout(() => {
      previewResourceRetryTimer = null;
      if (
        previewResourceRetryLifecycle !== previewIdentityLifecycleKey.value ||
        failedFrameRequestId !== previewFrameRequestId.value
      ) {
        return;
      }
      const reloaded = requestPreviewFrame({
        force: true,
        reason: "resource-load-retry"
      });
      if (!reloaded) {
        const failureNotice = "Preview could not be reloaded automatically. Use Reload preview to try again.";
        showPreviewResourceNotice(failureNotice);
        console.error(`[Vibe64 preview] ${failureNotice}`);
      }
    }, PREVIEW_RESOURCE_RETRY_DELAY_MS);
    return true;
  }

  function clearPreviewFrame(reason = "") {
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
    if (!previewReadyForIframe.value) {
      return false;
    }
    const nextSrc = String(src || "").trim() || launchPreviewFrameUrl({
      baseUrl: previewBaseUrl.value,
      displayBaseUrl: previewDisplayBaseUrl.value,
      visitedUrl: visitedUrl || previewDisplayBaseUrl.value || previewBaseUrl.value
    });
    const nextIdentity = previewFrameLifecycleIdentity({
      outputTargetId: activeOutputTarget.value?.id,
      sessionId: props.session?.sessionId,
      src: nextSrc,
      terminalSessionId: terminalSessionId.value
    });
    if (!nextIdentity || (!force && nextIdentity === previewFrameRequest.value.identity)) {
      return false;
    }
    resetPreviewBridge(reason || "frame-requested");
    previewFrameRequest.value = {
      id: previewFrameRequest.value.id + 1,
      identity: nextIdentity,
      src: nextSrc
    };
    if (previewIdentityReloadRequestId > 0) {
      previewIdentityReloadRequestId = previewFrameRequest.value.id;
    }
    previewDebugLog("frame.requested", {
      force,
      reason,
      src: nextSrc
    });
    return true;
  }

  async function reloadPreview() {
    resetPreviewResourceRecovery(previewIdentityLifecycleKey.value);
    const requestIdBeforeRefresh = previewFrameRequestId.value;
    await refreshOutputs();
    await nextTick();
    if (previewFrameRequestId.value !== requestIdBeforeRefresh) {
      return true;
    }
    return requestPreviewFrame({
      force: true,
      reason: "manual-reload"
    });
  }

  async function retryLaunchStatus() {
    await startNewlyConfiguredWorkspaceSetup?.();
    await refreshOutputs();
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
    setPreviewVisitedUrl(navigation.displayUrl, {
      reason: "address"
    });
    requestPreviewFrame({
      force: true,
      reason: "address",
      src: navigation.previewUrl,
      visitedUrl: navigation.displayUrl
    });
    previewDebugLog("address.navigate", {
      displayUrl: navigation.displayUrl,
      previewUrl: navigation.previewUrl
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

  function goPreviewBack() {
    if (!previewBackAvailable.value) {
      return false;
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
      targetWindow: previewFrame.value?.contentWindow,
      timeoutMessage: "The application preview did not complete the identity exchange in time.",
      timeoutMs: PREVIEW_IDENTITY_TIMEOUT_MS
    });
  }

  function completePreviewIdentityTransition() {
    previewIdentityBusy.value = false;
    previewIdentityRequested.value = null;
    previewIdentityReloadRequestId = 0;
  }

  function resetPreviewIdentityState() {
    completePreviewIdentityTransition();
    previewIdentityCurrent.value = null;
    previewIdentityError.value = "";
  }

  function reloadPreviewForIdentity(reason = "identity-changed") {
    const requested = requestPreviewFrame({
      force: true,
      reason
    });
    if (!requested) {
      completePreviewIdentityTransition();
      return false;
    }
    previewIdentityReloadRequestId = previewFrameRequestId.value;
    return true;
  }

  async function selectPreviewIdentity(selection = {}) {
    if (
      previewIdentitySelectionDisabled.value ||
      !previewIdentityAvailable.value
    ) {
      return false;
    }
    const mode = String(selection.mode || "identity").trim();
    const identityName = String(selection.identityName || "").trim().toLowerCase();
    const requested = mode === "identity"
      ? {
          identityName,
          mode
        }
      : {
          mode: "guest"
        };
    previewIdentityBusy.value = true;
    previewIdentityError.value = "";
    previewIdentityRequested.value = requested;
    try {
      const grantResult = await requestPreviewIdentityGrant(requested);
      const grant = String(grantResult?.grant || "").trim();
      if (!grant || grantResult?.ok === false) {
        throw new Error(
          String(grantResult?.error || "Vibe64 could not authorize the preview identity exchange.")
        );
      }
      const requestedIdentity = grantResult.requestedIdentity || requested;
      previewIdentityRequested.value = requestedIdentity;
      const exchangeResult = await requestPreviewIdentityExchange(grant);
      previewIdentityCurrent.value = previewIdentityFromExchange(exchangeResult, requestedIdentity);
      reloadPreviewForIdentity("identity-selected");
      return true;
    } catch (error) {
      const message = String(error?.message || error || "Preview identity exchange failed.");
      previewIdentityError.value = message;
      if (error?.signedOut === true) {
        previewIdentityCurrent.value = {
          mode: "guest"
        };
        previewIdentityRequested.value = {
          mode: "guest"
        };
        reloadPreviewForIdentity("identity-exchange-signed-out");
      } else {
        completePreviewIdentityTransition();
      }
      return false;
    }
  }

  function selectPreviewConfiguredIdentity(identity = {}) {
    const identityName = String(identity?.name || "").trim();
    if (!identityName) {
      return false;
    }
    return selectPreviewIdentity({
      identityName,
      mode: "identity"
    });
  }

  function selectPreviewGuest() {
    return selectPreviewIdentity({
      mode: "guest"
    });
  }

  function beginDefaultPreviewIdentity() {
    const lifecycle = previewIdentityLifecycleKey.value;
    if (
      !lifecycle ||
      !previewIdentityAvailable.value ||
      previewIdentityAutomaticAttempt === lifecycle
    ) {
      return false;
    }
    previewIdentityAutomaticAttempt = lifecycle;
    void selectPreviewIdentity(defaultPreviewIdentitySelection({
      capability: previewIdentityCapability.value
    }));
    return true;
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
    if (normalizedRequestId === previewIdentityReloadRequestId) {
      completePreviewIdentityTransition();
      return true;
    }
    beginDefaultPreviewIdentity();
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
    if (!previewFrameLoaded.value) {
      resetPreviewBridge("iframe-loaded-without-bridge-ready");
      markPreviewFrameReady(requestId, "iframe-load");
    }
    previewDebugLog("iframe.loaded", {
      requestId
    });
    requestPreviewState();
  }
  
  async function forceStartEmbeddedPreview() {
    if (operationBusy.value) {
      return false;
    }
    if (!embeddedStartTarget.value || embeddedStartTarget.value.available === false) {
      return false;
    }
    return run(embeddedStartTarget.value, {
      applyDefaultDisplay: false,
      forceRestart: true
    });
  }

  async function recoverEmbeddedPreview() {
    if (operationBusy.value) {
      return false;
    }
    if (
      embeddedStartTarget.value &&
      embeddedStartTarget.value.available !== false &&
      (previewCanRestart.value || previewCanStart.value || terminalCanRestart.value || terminalCanRetry.value)
    ) {
      return forceStartEmbeddedPreview();
    }
    if (terminalCanRestart.value) {
      return restartTerminal();
    }
    if (terminalCanRetry.value) {
      return retryTerminal();
    }
    return false;
  }

  async function recheckResourceAdmission({ outputTargetId = "", startIfStopped = false } = {}) {
    if (operationBusy.value) return false;
    const project = projectSlug.value;
    const session = props.session?.sessionId;
    operationBusy.value = true;
    try {
      await refreshOutputs();
      await nextTick();
    } finally {
      operationBusy.value = false;
    }
    if (project !== projectSlug.value || session !== props.session?.sessionId || loadError.value) return false;
    // A lost start response must reconnect to existing work, not force-restart it.
    if (terminalIsRunning.value || ["ready", "starting"].includes(previewState.value)) return true;
    const target = outputTargets.value.find((item) => item.id === outputTargetId);
    return startIfStopped && target ? run(target, { applyDefaultDisplay: false }) : false;
  }

  function setTerminalExpanded(expanded) {
    previewLogVisible.value = Boolean(expanded);
    if (expanded) {
      void expandTerminal();
      return;
    }
    minimizeTerminal();
  }

  function showLaunchLog() {
    collapsePreviewToolbar();
    previewLogVisible.value = true;
    void expandTerminal();
  }
  
  function previewMessageUrl(data = {}) {
    if (
      !data ||
      typeof data !== "object" ||
      data.type !== PREVIEW_LOCATION_MESSAGE_TYPE
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
        return previewUrlWithoutDisplayParams(url.toString());
      }
      const mappedUrl = previewMessageTargetUrlToPreviewUrl(url);
      return mappedUrl ? previewUrlWithoutDisplayParams(mappedUrl) : "";
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
      PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
      PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
      PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
      PREVIEW_LOCATION_MESSAGE_TYPE,
      PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
    ].includes(previewMessageType(value));
  }

  function handlePreviewBridgeMessage(event) {
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
    const messageType = previewMessageType(event.data);
    const bridgeReady = isPreviewBridgeReadyMessage(event.data);
    if (bridgeReady && previewFrameLoaded.value) {
      resetPreviewBridge("bridge-document-ready");
    }
    previewBridgeVersion.value = Math.max(
      previewBridgeVersion.value,
      Math.max(0, Number(event?.data?.version) || 0)
    );
    if (bridgeReady) {
      // The bridge announces readiness as soon as its listeners are installed.
      // Application modules and rendering may still be pending.
      markPreviewFrameReady(previewFrameRequestId.value, "bridge-ready");
      return;
    }
    if (messageType === PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE) {
      handlePreviewResourceFailure(event.data);
      return;
    }
    if (messageType === PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE) {
      const requestId = String(event.data?.requestId || "");
      previewBridgeRequests.resolve(requestId, event.data?.diagnostics || {});
      return;
    }
    if (messageType === PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE) {
      const requestId = String(event.data?.requestId || "");
      if (event.data?.ok === true) {
        previewBridgeRequests.resolve(requestId, {
          identity: event.data?.identity || null
        });
      } else {
        previewBridgeRequests.reject(requestId, Object.assign(new Error(String(
          event.data?.error || "Preview identity exchange failed."
        )), {
          code: String(event.data?.code || "vibe64_preview_identity_exchange_failed"),
          signedOut: event.data?.signedOut === true
        }));
      }
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
    if (frameUrl) {
      setPreviewVisitedUrl(frameUrl, {
        reason: String(event?.data?.reason || "")
      });
      void publishPreviewState({
        route: previewRouteFromUrl(frameUrl),
        title: String(event?.data?.title || "")
      });
    }
  }

  watch(previewIdentityLifecycleKey, (lifecycle) => {
    if (lifecycle === previewIdentityLifecycle) {
      return;
    }
    previewIdentityLifecycle = lifecycle;
    previewIdentityAutomaticAttempt = "";
    resetPreviewResourceRecovery(lifecycle);
    resetPreviewIdentityState();
    previewBridgeRequests.rejectAll("The active application preview changed.");
    previewDiagnosticsBusy.value = false;
  }, {
    flush: "sync",
    immediate: true
  });

  watch(previewIdentityAvailable, (available) => {
    if (available && previewFrameLoaded.value) {
      beginDefaultPreviewIdentity();
    }
  });
  
  watch(previewLocationStorageKey, (storageKey, previousStorageKey) => {
    if (storageKey === previousStorageKey) {
      return;
    }
    previewVisitedUrl.value = "";
    resetPreviewHistory("");
  }, {
    flush: "sync",
    immediate: true
  });

  watch([
    previewReadyForIframe,
    previewBaseUrl,
    previewDisplayBaseUrl
  ], ([ready, baseUrl, displayBaseUrl], previous = []) => {
    const previousDisplayBaseUrl = previous[2] || "";
    const normalizedDisplayBaseUrl = previewUrlWithoutDisplayParams(displayBaseUrl);
    if (normalizedDisplayBaseUrl && (
      !previewVisitedUrl.value ||
      normalizedDisplayBaseUrl !== previewUrlWithoutDisplayParams(previousDisplayBaseUrl)
    )) {
      const restoredUrl = storedPreviewUrl(normalizedDisplayBaseUrl);
      const route = previewRouteFromUrl(
        previewVisitedUrl.value || restoredUrl || normalizedDisplayBaseUrl
      );
      previewVisitedUrl.value = previewUrlForRoute(route, normalizedDisplayBaseUrl) || normalizedDisplayBaseUrl;
      resetPreviewHistory(previewVisitedUrl.value);
    }
    if (!ready || !baseUrl) {
      return;
    }
    requestPreviewFrame({
      reason: "preview-ready"
    });
  }, {
    flush: "sync",
    immediate: true
  });

  watch(() => String(props.session?.sessionId || ""), (sessionId, previousSessionId) => {
    if (previousSessionId && sessionId !== previousSessionId) {
      clearPreviewFrame("session-changed");
    }
  }, {
    flush: "sync"
  });
  
  watch(previewPaneDisplayed, (displayed) => {
    if (!displayed) {
      return;
    }
    requestPreviewState();
  }, {
    flush: "sync"
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
  
  onBeforeMount(() => {
    window.addEventListener("message", handlePreviewBridgeMessage);
  });
  
  onBeforeUnmount(() => {
    window.removeEventListener("message", handlePreviewBridgeMessage);
    cancelPreviewResourceRetry();
    previewBridgeRequests.rejectAll("The application preview closed.");
  });

  return {
    embeddedAutoStartTarget,
    embeddedManualStartButtonDisabled,
    embeddedManualStartButtonVisible,
    embeddedStartTarget,
    embeddedTerminalFrameVisible,
    embeddedTerminalSurfaceVisible,
    embeddedTerminalVisible,
    collapsePreviewToolbar,
    forceStartEmbeddedPreview,
    goPreviewBack,
    handlePreviewFrameLoad,
    expandPreviewToolbar,
    launchActions,
    launchButtonsDisabled,
    launchError,
    resourceAdmissionId,
    testApproval,
    acceptResourceRetry,
    launchStatusAttempt,
    launchStatusChipText,
    launchStatusChipTitle,
    launchStatusChipVisible,
    launchStatusDetailText,
    launchStatusRetryVisible,
    launchStatusText,
    outputExecution,
    outputResults,
    outputRuns,
    outputTargets,
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
    previewCheckAgainVisible,
    previewDisplayedAddress,
    previewDisplayedUrl,
    previewDiagnosticsAvailable,
    previewDiagnosticsBusy,
    previewEmbedUnavailableReason,
    previewEmptyText,
    previewFrame,
    previewFrameLoaded,
    previewFrameRequestId,
    previewIdentityAvailable,
    previewIdentityBusy,
    previewIdentityConfigured,
    previewIdentityCurrent,
    previewIdentityError,
    previewIdentityLabel,
    previewIdentitySelectionDisabled,
    previewIdentityTitle,
    previewIdentityTypeLabel,
    previewIssue,
    previewIssueVisible,
    previewInFlightText,
    previewLoadingOverlayVisible,
    previewMessage,
    previewRouteDialogError,
    previewRouteDialogParams,
    previewRouteDialogPath,
    previewRouteDialogVisible,
    previewRouteFormValues,
    previewRouteSelection,
    previewRoutes,
    previewRoutesAvailable,
    previewNotice,
    previewNoticeVisible,
    previewRecoveryLabel,
    previewRecoveryVisible,
    previewResourceNoticeText,
    previewResourceNoticeVisible,
    previewState,
    previewTerminalRecoveryVisible,
    previewToolbarRecoveryVisible,
    previewStarting,
    previewToolbarExpanded,
    previewToolbarPosition,
    previewUrl,
    copyPreviewUrl,
    openPreviewRoute,
    recoverEmbeddedPreview,
    recheckResourceAdmission,
    reloadPreview,
    retryLaunchStatus,
    requestPreviewDiagnostics,
    resetPreviewAddressDraft,
    selectPreviewConfiguredIdentity,
    selectPreviewGuest,
    submitPreviewRouteDialog,
    submitPreviewAddress,
    restartTerminal,
    retryTerminal,
    run,
    runMenuDisabled,
    showLaunchLog,
    setTerminalExpanded,
    terminal,
    terminalCanRestart,
    terminalCanRetry,
    terminalCommandPreview,
    terminalDisplayed,
    terminalExpanded,
    terminalError,
    terminalIndicatorLabel,
    terminalIndicatorState,
    terminalStatus,
    terminalSubtitle,
    terminalTitle,
    terminalVisible,
    terminalWindowStorageKey,
    terminalWindowVisible,
    toolbarTeleportTarget,
    visible
  };
}

function launchPreviewEmptyText({
  launchStatusText = "",
  launchStarting = false,
  loadError = "",
  loading = false,
  outputTargetsUnavailable = false,
  previewInFlightText = "",
  previewManualStartAvailable = false,
  previewMessage = "",
  previewStartUnavailableReason = "",
  previewState = "idle",
  terminalIsRunning = false
} = {}) {
  const message = String(previewMessage || "").trim();
  const inFlightText = String(previewInFlightText || "").trim();
  const startUnavailableReason = String(previewStartUnavailableReason || "").trim();
  if (["failed", "project_closed", "stopped"].includes(previewState)) {
    return message || "Preview could not be opened.";
  }
  if (inFlightText) {
    return inFlightText;
  }
  if (launchStarting || previewState === "starting" || terminalIsRunning) {
    return "Preparing preview.";
  }
  if (startUnavailableReason) {
    return startUnavailableReason;
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
  if (outputTargetsUnavailable) {
    return "This project does not declare an application output.";
  }
  return "Preview will appear here when it is ready.";
}

function outputTargetLabel(outputTarget = null) {
  const label = String(outputTarget?.label || outputTarget?.id || "").trim();
  return label || "selected output target";
}

function launchPreviewInFlightText({
  activeOutputTarget = null,
  embeddedStartTarget = null,
  launchStarting = false,
  launchWaiting = false,
  launchStatusText = "",
  loading = false,
  operationBusy = false,
  previewDisplayedAddress = "",
  previewEmbedUnavailableReason = "",
  previewLoadingOverlayVisible = false,
  previewUrl = "",
  terminalCanRestart = false,
  terminalCanRetry = false,
  terminalIsRunning = false
} = {}) {
  const embedUnavailableReason = String(previewEmbedUnavailableReason || "").trim();
  if (embedUnavailableReason) {
    return embedUnavailableReason;
  }
  const target = activeOutputTarget || embeddedStartTarget;
  const launchStatus = String(launchStatusText || "").trim();
  if (launchStarting) {
    return `Starting preview: ${outputTargetLabel(embeddedStartTarget || activeOutputTarget)}.`;
  }
  if (launchWaiting) {
    return "Waiting for the assistant operation to finish. Preview will retry automatically.";
  }
  if (operationBusy && terminalCanRestart) {
    return `Restarting preview: ${outputTargetLabel(target)}.`;
  }
  if (operationBusy && terminalCanRetry) {
    return `Retrying preview: ${outputTargetLabel(target)}.`;
  }
  if (operationBusy) {
    return `Trying preview: ${outputTargetLabel(embeddedStartTarget || activeOutputTarget)}.`;
  }
  if (terminalIsRunning && !previewUrl) {
    return `Waiting for preview URL from ${outputTargetLabel(target)}.`;
  }
  if (previewLoadingOverlayVisible && previewUrl) {
    const address = String(previewDisplayedAddress || "").trim();
    const page = address ? `: ${address}` : "";
    return `Loading preview page${page}. The server is ready; the browser is still loading the app.`;
  }
  if (loading) {
    return launchStatus || "Checking preview status.";
  }
  return "";
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
  loadedFrameRequestId = 0,
  previewFrameRequestId = 0,
  previewUrl = ""
} = {}) {
  const requestId = Math.max(0, Number(previewFrameRequestId) || 0);
  return Boolean(
    String(previewUrl || "").trim() &&
    requestId > 0 &&
    requestId !== Math.max(0, Number(loadedFrameRequestId) || 0)
  );
}

function launchPreviewIssue({
  launchError = "",
  message = "",
  state = "idle"
} = {}) {
  // Current readiness supersedes a failed, overlapping start request.
  if (state === "ready") {
    return null;
  }
  const operationError = String(launchError || "").trim();
  const text = String(message || "").trim();
  if (operationError) {
    return {
      message: operationError,
      title: "Preview could not be started"
    };
  }
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
  launchError = "",
  message = "",
  state = "idle"
} = {}) {
  const issue = launchPreviewIssue({
    launchError,
    message,
    state
  });
  if (state === "stale" && !String(launchError || "").trim()) {
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
  defaultPreviewIdentitySelection,
  launchPreviewAddressNavigationUrl,
  launchPreviewEmptyText,
  launchPreviewFrameUrl,
  previewFrameLifecycleIdentity,
  isPreviewBridgeReadyMessage,
  previewIdentityFromExchange,
  previewIdentityLabelText,
  previewIdentityLifecycleIdentity,
  previewIdentityTitleText,
  previewLoadingOverlayShouldShow,
  launchPreviewIssue,
  launchPreviewInFlightText,
  launchPreviewNotice,
  launchPreviewStatusText,
  launchToolbarDockShouldShow,
  normalizeConfiguredPreviewIdentities,
  previewOpeningOverlayVisible,
  previewAddressDisplayText,
  previewRouteFromUrl,
  previewUrlForRoute,
  redactPreviewDebugDetails,
  useVibe64OutputControlsSurface
};
