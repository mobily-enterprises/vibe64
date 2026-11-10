import { computed, ref, watch } from "vue";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import { launchPreviewLocationStorageKey } from "@/lib/vibe64LaunchBrowserWindow.js";
import {
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
} from "@/lib/vibe64PreviewRoutes.js";
import { previewAppPathError } from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import {
  launchPreviewAddressNavigationUrl,
  normalizePreviewRoute,
  previewAddressDisplayText,
  previewRouteFromUrl,
  previewUrlForRoute,
  previewUrlWithoutDisplayParams
} from "@/lib/vibe64PreviewAddress.js";

/**
 * The embedded Preview's address bar: the address it shows, typing a new one,
 * the declared routes (asking for their parameters), going back, and the page
 * remembered for the project's Preview window. Navigating loads the frame.
 * @param {{
 *   frame: import("@/types.js").Vibe64PreviewFrame,
 *   projectSlug: import("vue").Ref<string>,
 *   props: { embeddedPreview?: boolean, session?: object | null },
 *   targets: import("@/types.js").Vibe64PreviewTargets
 * }} options
 */
function useVibe64PreviewAddress({ frame, projectSlug, props, targets }) {
  const {
    previewBaseUrl,
    previewDebugLog,
    previewDisplayBaseUrl,
    previewReadyForIframe,
    previewSuspended,
    previewVisitedUrl,
    requestPreviewFrame
  } = frame;
  const { previewContextTarget } = targets;
  const previewAddressDraft = ref("");
  const previewAddressError = ref("");
  const previewAddressFocused = ref(false);
  const previewHistory = ref([]);
  const previewRouteDialogVisible = ref(false);
  const previewRouteDialogError = ref("");
  const previewRouteFormValues = ref({});
  const previewRouteSelection = ref(null);
  const previewLocationStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewLocationStorageKey(props.session, projectSlug.value)
    : "");
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

  function recordPreviewVisit(url = "", {
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

  function previewAddressNavigation(address = "") {
    return launchPreviewAddressNavigationUrl({
      address,
      currentUrl: previewDisplayedUrl.value,
      displayBaseUrl: previewDisplayBaseUrl.value,
      previewBaseUrl: previewBaseUrl.value
    });
  }

  /** Loads a resolved address in the frame and remembers it; whether the frame was asked to load it. */
  function followPreviewAddressNavigation(navigation, reason = "") {
    previewAddressError.value = "";
    recordPreviewVisit(navigation.displayUrl, {
      reason
    });
    const requested = requestPreviewFrame({
      force: true,
      reason,
      src: navigation.previewUrl,
      visitedUrl: navigation.displayUrl
    });
    previewDebugLog(`${reason}.navigate`, {
      displayUrl: navigation.displayUrl,
      previewUrl: navigation.previewUrl
    });
    return requested;
  }

  function navigatePreviewToDisplayUrl(displayUrl = "") {
    const navigation = previewAddressNavigation(displayUrl);
    if (!navigation.ok) {
      previewAddressError.value = navigation.error;
      return false;
    }
    previewAddressDraft.value = previewAddressDisplayText(navigation.displayUrl, {
      displayBaseUrl: previewDisplayBaseUrl.value,
      previewBaseUrl: previewBaseUrl.value
    });
    followPreviewAddressNavigation(navigation, "address");
    return true;
  }

  /**
   * Opens a page of the app the AI asked for (`vibe64-helper preview open`)
   * exactly as the address box opens a typed one: the same address, Preview
   * token, history and frame request. Only a path inside the app is opened,
   * never a page on the editor's own site; a refusal leaves the address box,
   * and a draft typed in it, alone.
   * @param {string} path
   * @returns {{ error: string, moved: boolean }}
   */
  function openPreviewPath(path = "") {
    const refused = (error) => ({ error, moved: false });
    const pathError = previewAppPathError(path);
    if (pathError) return refused(pathError);
    if (previewSuspended.value) return refused("The person's Preview is suspended; they can choose Resume preview.");
    if (!previewReadyForIframe.value) return refused("The person's Preview is not showing the app yet.");
    const navigation = previewAddressNavigation(path);
    if (!navigation.ok) return refused(navigation.error);
    if (previewFrameUrlOnEditorSite(navigation.previewUrl)) return refused("That page would show Vibe64 itself in the Preview.");
    return followPreviewAddressNavigation(navigation, "ai-open")
      ? { error: "", moved: true }
      : refused("The person's Preview is not showing the app yet.");
  }

  // The frame never loads the editor's own site, unless the editor previews itself.
  function previewFrameUrlOnEditorSite(url = "") {
    try {
      const editorOrigin = window.location.origin;
      return new URL(url).origin === editorOrigin && new URL(previewBaseUrl.value).origin !== editorOrigin;
    } catch {
      return true;
    }
  }

  function submitPreviewAddress() {
    return navigatePreviewToDisplayUrl(previewAddressDraft.value);
  }

  function openPreviewRoute(route = {}) {
    if (!route.pathTemplate) {
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

  // A new display address restores the page last visited under it, else the
  // address itself, and starts the back history there.
  watch([
    previewReadyForIframe,
    previewBaseUrl,
    previewDisplayBaseUrl
  ], ([, , displayBaseUrl], previous = []) => {
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
  }, {
    flush: "sync",
    immediate: true
  });

  watch(previewDisplayedAddress, (url) => {
    if (!previewAddressFocused.value) {
      previewAddressDraft.value = url || "";
    }
  }, {
    immediate: true
  });

  return {
    copyPreviewUrl,
    goPreviewBack,
    openPreviewRoute,
    previewAddressBlur,
    previewAddressDraft,
    previewAddressError,
    previewAddressFocus,
    previewBackAvailable,
    previewDisplayedAddress,
    previewDisplayedUrl,
    previewRouteDialogError,
    previewRouteDialogParams,
    previewRouteDialogPath,
    previewRouteDialogVisible,
    previewRouteFormValues,
    previewRouteSelection,
    previewRoutes,
    previewRoutesAvailable,
    openPreviewPath,
    resetPreviewAddressDraft,
    recordPreviewVisit,
    submitPreviewAddress,
    submitPreviewRouteDialog
  };
}

export {
  useVibe64PreviewAddress
};
