// The one named browser window a project's launched outputs open in, and the
// editor state remembered under that window's name.
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

const LAUNCH_BROWSER_WINDOW_FEATURES = "popup,width=1400,height=900,left=80,top=60";

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

export {
  launchBrowserTargetHref,
  launchBrowserTargetName,
  launchPreviewLocationStorageKey,
  launchPreviewToolbarStorageKey,
  launchTerminalStorageKey,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget
};
