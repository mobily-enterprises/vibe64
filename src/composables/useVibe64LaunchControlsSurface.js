import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  launchPreviewLocationStorageKey,
  launchPreviewRecentUsersStorageKey,
  launchPreviewToolbarStorageKey,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition,
  resolveLaunchPreviewDestination,
  useVibe64LaunchControls
} from "@/composables/useVibe64LaunchControls.js";
import {
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_QUERY_MESSAGE_TYPE
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

const RECENT_PREVIEW_IDENTITY_LIMIT = 4;
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
  launchTargetId = "",
  sessionId = "",
  src = "",
  terminalSessionId = ""
} = {}) {
  return previewLifecycleIdentity([
    String(sessionId || "").trim(),
    String(launchTargetId || "").trim(),
    String(terminalSessionId || "").trim()
  ], src);
}

function previewIdentityLifecycleIdentity({
  launchTargetId = "",
  previewBaseUrl = "",
  projectSlug = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  return previewLifecycleIdentity([
    String(projectSlug || "").trim(),
    String(sessionId || "").trim(),
    String(launchTargetId || "").trim(),
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
  if (identity.mode === "viewer") {
    return selectorValue ? `You — ${selectorValue}` : "You";
  }
  const name = String(identity.displayName || identity.username || "").trim();
  return name && name !== selectorValue
    ? `${name} — ${selectorValue}`
    : selectorValue || "Selected user";
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

function normalizeRecentPreviewIdentities(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  const identities = [];
  const seen = new Set();
  for (const entry of value) {
    const legacyEmail = typeof entry === "string" ? entry : "";
    const selector = normalizePreviewIdentitySelector(legacyEmail
      ? {
          type: PREVIEW_IDENTITY_TYPE_EMAIL,
          value: legacyEmail
        }
      : entry?.selector || entry);
    if (!selector) {
      continue;
    }
    const key = `${selector.type}\u0000${selector.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    identities.push(selector);
    if (identities.length >= RECENT_PREVIEW_IDENTITY_LIMIT) {
      break;
    }
  }
  return identities;
}

function nextRecentPreviewIdentities(current = [], selector = {}) {
  return normalizeRecentPreviewIdentities([
    selector,
    ...normalizeRecentPreviewIdentities(current)
  ]);
}

function normalizePreviewIdentityTypes(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .map((type) => String(type || "").trim())
    .filter((type) => PREVIEW_IDENTITY_TYPES.includes(type)))];
}

function previewIdentityTypeLabel(type = "") {
  return {
    [PREVIEW_IDENTITY_TYPE_EMAIL]: "Email",
    [PREVIEW_IDENTITY_TYPE_LOGIN]: "Login name",
    [PREVIEW_IDENTITY_TYPE_USER_ID]: "User ID"
  }[String(type || "").trim()] || "User identifier";
}

function previewIdentityTypePhrase(identityTypes = []) {
  const labels = identityTypes.map((type) => ({
    [PREVIEW_IDENTITY_TYPE_EMAIL]: "email",
    [PREVIEW_IDENTITY_TYPE_LOGIN]: "login name",
    [PREVIEW_IDENTITY_TYPE_USER_ID]: "user ID"
  }[type])).filter(Boolean);
  if (labels.length < 2) {
    return labels[0] || "identifier";
  }
  return labels.length === 2
    ? labels.join(" or ")
    : `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
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
      identity.displayName || username || requestedIdentity.displayName || selector?.value || ""
    ).trim(),
    email,
    login,
    mode: requestedIdentity.mode,
    selector,
    userId,
    username
  };
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

function defaultPreviewIdentityMode({
  capability = null,
  viewer = null
} = {}) {
  return capability?.defaultMode === "viewer" && viewer
    ? "viewer"
    : "guest";
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
    targetWindow = null,
    timeoutMessage = "The application preview did not respond in time.",
    timeoutMs = 3000
  } = {}) {
    if (!targetWindow || typeof targetWindow.postMessage !== "function") {
      return Promise.reject(new Error("The application preview is not ready."));
    }
    const requestId = [frameRequestId, Date.now(), ++sequence].join(":");
    const response = new Promise((resolve, rejectRequest) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        rejectRequest(new Error(timeoutMessage));
      }, timeoutMs);
      pendingRequests.set(requestId, {
        reject: rejectRequest,
        resolve,
        timeout
      });
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

function useVibe64LaunchControlsSurface(props) {
  const {
    activeLaunchTarget,
    expandTerminal,
    launchActions,
    launchButtonsDisabled,
    launchError,
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
    previewIdentity: previewIdentityCapability,
    previewMessage,
    previewState,
    publishPreviewState,
    requestPreviewIdentityGrant,
    refresh: refreshLaunchTargets,
    restartTerminal,
    retryTerminal,
    run,
    savePreviewInput,
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
    previewInputIsRemembered,
    visible
  } = useVibe64LaunchControls({
    autoStartManagedPreview: () => props.autoStartManagedPreview,
    autoStartTargetId: () => props.autoStartTargetId,
    previewDisplayed: () => props.previewDisplayed,
    windowDisplayed: () => props.windowDisplayed,
    busy: () => props.busy,
    session: () => props.session
  });

  const runMenuDisabled = computed(() => Boolean(
    launchButtonsDisabled.value ||
    loading.value ||
    launchTargets.value.length < 1
  ));
  const previewFrame = ref(null);
  const previewBridgeVersion = ref(0);
  const previewBridgeRequests = createPreviewBridgeRequestRegistry();
  const previewDiagnosticsBusy = ref(false);
  const previewIdentityBusy = ref(false);
  const previewIdentityCurrent = ref(null);
  const previewIdentityCustomValue = ref("");
  const previewIdentityDialogError = ref("");
  const previewIdentityDialogVisible = ref(false);
  const previewIdentityError = ref("");
  const previewIdentityStoredRecentUsers = ref([]);
  const previewIdentityRequested = ref(null);
  let previewIdentityAutomaticAttempt = "";
  let previewIdentityLifecycle = "";
  let previewIdentityReloadRequestId = 0;
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
  const previewOptionsDialogVisible = ref(false);
  const previewOptionsFormValues = ref({});
  const previewOptionsRemember = ref(false);
  const previewRouteDialogVisible = ref(false);
  const previewRouteDialogError = ref("");
  const previewRouteFormValues = ref({});
  const previewRouteSelection = ref(null);
  const previewLogVisible = ref(false);
  const previewVisitedUrl = ref("");
  const previewToolbarExpanded = ref(false);
  const previewToolbarPosition = ref("center");
  const projectSlug = useVibe64ProjectSlug();
  const previewIdentityRecentStorageKey = computed(() => (
    launchPreviewRecentUsersStorageKey(projectSlug.value)
  ));
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
      managedPreviewTarget(launchTargets.value) ||
      preferredPreviewTarget(launchTargets.value);
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
    launchTargets.value.length > 0 &&
    !(
      props.embeddedPreview &&
      (requestedAutoStartTargetId.value || props.autoStartManagedPreview)
    )
  ));
  const previewToolbarStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewToolbarStorageKey(props.session, projectSlug.value)
    : "");
  const previewLocationStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewLocationStorageKey(props.session, projectSlug.value)
    : "");
  const previewOptionsTarget = computed(() => (
    embeddedAutoStartTarget.value || activeLaunchTarget.value || embeddedStartTarget.value || null
  ));
  const previewOptions = computed(() => previewOptionsForTarget(previewOptionsTarget.value));
  const previewOptionsAvailable = computed(() => previewOptions.value.length > 0);
  const previewOptionsAttentionVisible = computed(() => Boolean(
    props.embeddedPreview && launchError.value && previewOptionsAvailable.value
  ));
  const previewOptionsPrimaryLabel = computed(() => {
    if (terminalIsRunning.value) {
      return "Save and restart preview";
    }
    return launchError.value ? "Save and start preview" : "Save";
  });
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
  const previewIdentityTypes = computed(() => {
    const configuredTypes = previewIdentityCapability.value?.identityTypes;
    const advertisedTypes = normalizePreviewIdentityTypes(
      configuredTypes
    );
    return Array.isArray(configuredTypes)
      ? advertisedTypes
      : [PREVIEW_IDENTITY_TYPE_EMAIL];
  });
  const previewIdentityRecentUsers = computed(() => {
    const supportedTypes = new Set(previewIdentityTypes.value);
    return previewIdentityStoredRecentUsers.value.filter((selector) => (
      supportedTypes.has(selector.type)
    ));
  });
  const previewIdentityInputLabel = computed(() => {
    const [onlyType] = previewIdentityTypes.value;
    return previewIdentityTypes.value.length === 1
      ? `Application user ${previewIdentityTypeLabel(onlyType).toLowerCase()}`
      : "Application user identifier";
  });
  const previewIdentityInputDescription = computed(() => (
    `Enter an existing application user's ${previewIdentityTypePhrase(previewIdentityTypes.value)}. ` +
    "Vibe64 will not create the user or change their roles, workspace, or application data."
  ));
  const previewIdentityInputType = computed(() => (
    previewIdentityTypes.value.length === 1 &&
    previewIdentityTypes.value[0] === PREVIEW_IDENTITY_TYPE_EMAIL
      ? "email"
      : "text"
  ));
  const previewIdentityLifecycleKey = computed(() => previewIdentityLifecycleIdentity({
    launchTargetId: activeLaunchTarget.value?.id || terminal.value?.metadata?.launchTargetId,
    previewBaseUrl: previewBaseUrl.value,
    projectSlug: projectSlug.value,
    sessionId: props.session?.sessionId,
    terminalSessionId: terminalSessionId.value
  }));
  const previewIdentityViewer = computed(() => {
    const viewer = previewIdentityCapability.value?.viewer;
    return viewer && typeof viewer === "object" && !Array.isArray(viewer) ? viewer : null;
  });
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
        : `Opening preview as ${requested?.selector?.value || requested?.identityValue || "the selected user"}…`;
    }
    return launchPreviewInFlightText({
      activeLaunchTarget: activeLaunchTarget.value,
      embeddedStartTarget: embeddedStartTarget.value,
      launchStarting: launchStarting.value,
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
  const previewActivityVisible = computed(() => Boolean(
    previewStarting.value ||
    launchStarting.value ||
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
      launchTargetId: activeLaunchTarget.value?.id,
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
    const requestIdBeforeRefresh = previewFrameRequestId.value;
    await refreshLaunchTargets();
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

  async function requestPreviewDiagnostics() {
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

  function loadRecentPreviewIdentities() {
    previewIdentityStoredRecentUsers.value = normalizeRecentPreviewIdentities(
      readLocalStorageJson(previewIdentityRecentStorageKey.value, [])
    );
  }

  function rememberRecentPreviewIdentity(selector = {}) {
    const recentUsers = nextRecentPreviewIdentities(
      previewIdentityStoredRecentUsers.value,
      selector
    );
    previewIdentityStoredRecentUsers.value = recentUsers;
    writeLocalStorageJson(previewIdentityRecentStorageKey.value, recentUsers);
  }

  function resetPreviewIdentityState() {
    completePreviewIdentityTransition();
    previewIdentityCurrent.value = null;
    previewIdentityCustomValue.value = "";
    previewIdentityDialogError.value = "";
    previewIdentityDialogVisible.value = false;
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

  async function selectPreviewIdentity(selection = {}, {
    automatic = false
  } = {}) {
    if (previewIdentityBusy.value || !previewIdentityAvailable.value) {
      return false;
    }
    const mode = String(selection.mode || "viewer").trim();
    const identityType = String(selection.identityType || "").trim();
    const rawIdentityValue = String(selection.identityValue || "").trim();
    const identityValue = identityType === PREVIEW_IDENTITY_TYPE_EMAIL
      ? rawIdentityValue.toLowerCase()
      : rawIdentityValue;
    const requested = mode === "user"
      ? {
          ...(identityType ? { identityType } : {}),
          identityValue,
          mode
        }
      : { mode };
    previewIdentityBusy.value = true;
    previewIdentityError.value = "";
    previewIdentityDialogError.value = "";
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
      if (mode === "user") {
        rememberRecentPreviewIdentity(
          previewIdentityCurrent.value.selector || requestedIdentity.selector
        );
      }
      previewIdentityDialogVisible.value = false;
      reloadPreviewForIdentity("identity-selected");
      return true;
    } catch (error) {
      const message = String(error?.message || error || "Preview identity exchange failed.");
      previewIdentityError.value = message;
      if (!automatic && mode === "user") {
        previewIdentityDialogError.value = message;
      }
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

  function selectPreviewViewer() {
    return selectPreviewIdentity({
      mode: "viewer"
    });
  }

  function selectPreviewGuest() {
    return selectPreviewIdentity({
      mode: "guest"
    });
  }

  async function selectRecentPreviewIdentity(selector = {}) {
    const recentSelector = normalizePreviewIdentitySelector(selector);
    if (!recentSelector) {
      return false;
    }
    previewIdentityCustomValue.value = recentSelector.value;
    const selected = await selectPreviewIdentity({
      identityType: recentSelector.type,
      identityValue: recentSelector.value,
      mode: "user"
    });
    if (!selected) {
      previewIdentityDialogVisible.value = true;
    }
    return selected;
  }

  function openPreviewIdentityDialog() {
    previewIdentityCustomValue.value = "";
    previewIdentityDialogError.value = "";
    previewIdentityDialogVisible.value = true;
  }

  function submitPreviewIdentityDialog() {
    const identityValue = String(previewIdentityCustomValue.value || "").trim();
    if (!identityValue) {
      previewIdentityDialogError.value = `Enter an existing application user's ${previewIdentityTypePhrase(previewIdentityTypes.value)}.`;
      return false;
    }
    return selectPreviewIdentity({
      identityValue,
      mode: "user"
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
    const defaultMode = defaultPreviewIdentityMode({
      capability: previewIdentityCapability.value,
      viewer: previewIdentityViewer.value
    });
    void selectPreviewIdentity({
      mode: defaultMode
    }, {
      automatic: true
    });
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
    resetPreviewBridge("iframe-loaded");
    previewLoadedFrameRequestId.value = requestId;
    previewDebugLog("iframe.loaded", {
      requestId
    });
    requestPreviewState();
    if (requestId === previewIdentityReloadRequestId) {
      completePreviewIdentityTransition();
      return;
    }
    beginDefaultPreviewIdentity();
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
      embeddedStartTarget.value?.available !== false &&
      (previewCanRestart.value || previewCanStart.value)
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
      return restartTerminal();
    }
    if (restart && launchError.value && props.embeddedPreview) {
      return run(target, {
        applyDefaultDisplay: false,
        forceRestart: true
      });
    }
    return true;
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
      PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
      PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
      PREVIEW_LOCATION_MESSAGE_TYPE
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
    previewBridgeVersion.value = Math.max(
      previewBridgeVersion.value,
      Math.max(0, Number(event?.data?.version) || 0)
    );
    const messageType = previewMessageType(event.data);
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
    resetPreviewIdentityState();
    previewBridgeRequests.rejectAll("The active application preview changed.");
    previewDiagnosticsBusy.value = false;
  }, {
    flush: "sync",
    immediate: true
  });

  watch(previewIdentityRecentStorageKey, () => {
    loadRecentPreviewIdentities();
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
  
  onMounted(() => {
    window.addEventListener("message", handlePreviewBridgeMessage);
  });
  
  onBeforeUnmount(() => {
    window.removeEventListener("message", handlePreviewBridgeMessage);
    previewBridgeRequests.rejectAll("The application preview closed.");
  });

  return {
    embeddedAutoStartTarget,
    embeddedManualStartButtonDisabled,
    embeddedManualStartButtonVisible,
    embeddedStartTarget,
    embeddedTerminalFrameVisible,
    embeddedTerminalVisible,
    collapsePreviewToolbar,
    forceStartEmbeddedPreview,
    goPreviewBack,
    handlePreviewFrameLoad,
    expandPreviewToolbar,
    launchActions,
    launchButtonsDisabled,
    launchError,
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
    previewIdentityCurrent,
    previewIdentityCustomValue,
    previewIdentityDialogError,
    previewIdentityDialogVisible,
    previewIdentityError,
    previewIdentityInputDescription,
    previewIdentityInputLabel,
    previewIdentityInputType,
    previewIdentityLabel,
    previewIdentityRecentUsers,
    previewIdentityTitle,
    previewIdentityTypeLabel,
    previewIdentityTypes,
    previewIdentityViewer,
    previewIssue,
    previewIssueVisible,
    previewInFlightText,
    previewLoadingOverlayVisible,
    previewMessage,
    previewOptions,
    previewOptionsAttentionVisible,
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
    previewNoticeVisible,
    previewRecoveryLabel,
    previewRecoveryVisible,
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
    openPreviewIdentityDialog,
    recoverEmbeddedPreview,
    reloadPreview,
    retryLaunchStatus,
    requestPreviewDiagnostics,
    resetPreviewAddressDraft,
    savePreviewOptions,
    selectPreviewGuest,
    selectRecentPreviewIdentity,
    selectPreviewViewer,
    submitPreviewIdentityDialog,
    submitPreviewRouteDialog,
    submitPreviewAddress,
    restartTerminal,
    retryTerminal,
    run,
    runMenuDisabled,
    showLaunchLog,
    terminal,
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
  return "Preview will appear here when it is ready.";
}

function launchTargetLabel(launchTarget = null) {
  const label = String(launchTarget?.label || launchTarget?.id || "").trim();
  return label || "selected launch target";
}

function launchPreviewInFlightText({
  activeLaunchTarget = null,
  embeddedStartTarget = null,
  launchStarting = false,
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
  const target = activeLaunchTarget || embeddedStartTarget;
  const launchStatus = String(launchStatusText || "").trim();
  if (launchStarting) {
    return `Starting preview: ${launchTargetLabel(embeddedStartTarget || activeLaunchTarget)}.`;
  }
  if (operationBusy && terminalCanRestart) {
    return `Restarting preview: ${launchTargetLabel(target)}.`;
  }
  if (operationBusy && terminalCanRetry) {
    return `Retrying preview: ${launchTargetLabel(target)}.`;
  }
  if (operationBusy) {
    return `Trying preview: ${launchTargetLabel(embeddedStartTarget || activeLaunchTarget)}.`;
  }
  if (terminalIsRunning && !previewUrl) {
    return `Waiting for preview URL from ${launchTargetLabel(target)}.`;
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
  defaultPreviewIdentityMode,
  launchPreviewAddressNavigationUrl,
  launchPreviewEmptyText,
  launchPreviewFrameUrl,
  previewFrameLifecycleIdentity,
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
  nextRecentPreviewIdentities,
  normalizeRecentPreviewIdentities,
  previewOpeningOverlayVisible,
  previewAddressDisplayText,
  previewRouteFromUrl,
  previewUrlForRoute,
  redactPreviewDebugDetails,
  useVibe64LaunchControlsSurface
};
