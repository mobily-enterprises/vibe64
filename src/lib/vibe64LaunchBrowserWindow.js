// The one named browser tab a project's launched outputs open in, and the
// editor state remembered under that tab's name. No window features are passed,
// so the browser opens a normal tab with an editable address bar, not a popup.
// A tab opened before the editor can reach the app shows "Starting app…" and
// moves to the app's address once the Preview names it.
import { stableLocalStorageKeyPart } from "@/lib/browserLocalStorage.js";
import {
  currentProjectSlugFromLocation,
  vibe64ProjectScopedStorageKey
} from "@/lib/vibe64ProjectScope.js";
import {
  browserCanOpenTarget,
  localPreviewBrowserHref,
  resolveLaunchPreviewDestination
} from "@/lib/vibe64LaunchPreviewDestination.js";

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
  if (!href) {
    return null;
  }
  const openedWindow = activeWindow.open(href, launchBrowserTargetName(session, projectSlug));
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
  const openedWindow = activeWindow.open("about:blank", launchBrowserTargetName(session, projectSlug));
  if (!openedWindow) {
    return null;
  }

  try {
    openedWindow.opener = null;
    openedWindow.document?.write?.(
      "<!doctype html><title>Starting app…</title>" +
      "<body style=\"font-family: system-ui, sans-serif; margin: 2rem\">Starting app…</body>"
    );
    openedWindow.document?.close?.();
  } catch {
    // A reused named browser window can already be cross-origin.
  }
  if (typeof openedWindow.focus === "function") {
    openedWindow.focus();
  }
  return openedWindow;
}

/**
 * Moves the tab opened while the app was starting to the target's address.
 * A tab the person closed meanwhile stays closed.
 */
function openReadyLaunchBrowserTarget(
  target = {},
  pendingWindow = null,
  browserWindow = null
) {
  if (!browserCanOpenTarget(target) || !pendingWindow || pendingWindow.closed === true) {
    return null;
  }
  const href = launchBrowserTargetHref(target, browserWindow);
  if (!href) {
    return null;
  }
  try {
    pendingWindow.location.href = href;
  } catch {
    return null;
  }
  if (typeof pendingWindow.focus === "function") {
    pendingWindow.focus();
  }
  return pendingWindow;
}

/**
 * Opens launched outputs in the project's named tab from one editor. When the
 * editor can't reach a target's address yet, as a hosted editor while Preview
 * starts, the tab shows "Starting app…" until `showReady` gets the Preview's
 * proxied address. A loopback editor opens the loopback address at once.
 * @param {Window | null} [browserWindow] the editor's window
 */
function createLaunchBrowserOpener(browserWindow = null) {
  let pendingWindow = null;

  function editorWindow() {
    return browserWindow || (typeof window !== "undefined" ? window : null);
  }

  function open(target = {}, session = {}, projectSlug = currentProjectSlugFromLocation()) {
    pendingWindow = null;
    if (!browserCanOpenTarget(target)) {
      return null;
    }
    const activeWindow = editorWindow();
    if (launchBrowserTargetHref(target, activeWindow)) {
      return openLaunchBrowserTarget(target, session, activeWindow, projectSlug);
    }
    pendingWindow = openPendingLaunchBrowserWindow(session, activeWindow, projectSlug);
    return pendingWindow;
  }

  /** Moves a waiting tab to the ready Preview's address; null while there is none. */
  function showReady(previewTarget = null) {
    if (!pendingWindow || !previewTarget || !launchBrowserTargetHref(previewTarget, editorWindow())) {
      return null;
    }
    const waitingWindow = pendingWindow;
    pendingWindow = null;
    return openReadyLaunchBrowserTarget(previewTarget, waitingWindow, editorWindow());
  }

  /** The editor moved to another session: its waiting tab no longer follows this Preview. */
  function abandon() {
    pendingWindow = null;
  }

  return Object.freeze({
    abandon,
    open,
    showReady
  });
}

export {
  createLaunchBrowserOpener,
  launchBrowserTargetHref,
  launchBrowserTargetName,
  launchPreviewLocationStorageKey,
  launchPreviewToolbarStorageKey,
  launchTerminalStorageKey,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget
};
