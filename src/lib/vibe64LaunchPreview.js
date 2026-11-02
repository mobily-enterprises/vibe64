// A session's Preview as its outputs status reports it.
import { isRecord, normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeLaunchPreview(preview = {}) {
  const source = normalizeObject(preview);
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
  const recovery = isRecord(source.recovery) ? source.recovery : null;
  return {
    canRestart: source.canRestart === true,
    canShowLog: source.canShowLog === true,
    canStart: source.canStart === true,
    href: String(source.href || "").trim(),
    message: String(source.message || fallbackMessage).trim() || fallbackMessage,
    reason: String(source.reason || "").trim(),
    recovery,
    state,
    stoppedIntent: source.stoppedIntent === true,
    targetHref: String(source.targetHref || "").trim(),
    terminalId: String(source.terminalId || "").trim()
  };
}

function launchPreviewTestNotice(status = {}, activeTarget = null) {
  const state = status.previewTestRun?.state;
  if (["cleanup_required", "restore_failed"].includes(state)) {
    return { error: true, title: "Preview recovery required", message: "Tests finished, but Preview has not been restored. Ask the coding agent to recover it before using the app." };
  }
  if (state === "restoring") {
    return { title: "Restoring your app", message: "Browser tests have finished. Vibe64 is restoring the previous Preview." };
  }
  if (activeTarget?.dataMode === "test") {
    return { title: "Test Preview", message: "Using this app’s test configuration. Test data may be reset." };
  }
  if (state) return { title: "Browser tests in progress", message: "The coding agent temporarily controls this Preview for automated checks." };
  return null;
}

function launchPreviewFromStatus(status = {}) {
  const source = normalizeObject(status);
  const previewSource = normalizeObject(source.preview);
  const preview = normalizeLaunchPreview(previewSource);
  if (previewSource.state || preview.href || preview.targetHref) {
    return preview;
  }

  const previewTarget = normalizeObject(source.previewTarget);
  const openTarget = normalizeObject(source.openTarget);
  const href = String(previewTarget.href || openTarget.previewHref || "").trim();
  if (!href || previewTarget.available === false || openTarget.available === false) {
    return preview;
  }

  const activeTerminal = normalizeObject(source.activeTerminal);
  return normalizeLaunchPreview({
    canRestart: Boolean(activeTerminal.id || normalizeObject(source.lastOutputTarget).id),
    canShowLog: Boolean(activeTerminal.id),
    href,
    message: "Preview is ready.",
    state: "ready",
    targetHref: String(previewTarget.targetHref || openTarget.href || "").trim(),
    terminalId: String(activeTerminal.id || "").trim()
  });
}

function launchTerminalIsReady(metadata = {}) {
  return metadata?.launchReady === true || metadata?.launchReady === "true";
}

function launchPreviewRequiresProxy(metadata = {}) {
  return Boolean(String(metadata?.previewAuth || "").trim());
}

export {
  launchPreviewFromStatus,
  launchPreviewRequiresProxy,
  launchPreviewTestNotice,
  launchTerminalIsReady,
  normalizeLaunchPreview
};
