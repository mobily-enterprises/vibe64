// What the Preview says while it has no page to show: its status, the work in
// flight, and the issue or notice that stopped it.

function launchPreviewEmptyText({
  launchStatusText = "",
  launchStarting = false,
  loadError = "",
  loading = false,
  outputTargetsUnavailable = false,
  nonWebOutputsAvailable = false,
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
    return "Preview is not running. Start it to see the app.";
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
    return "No runnable output is declared. You can continue working in the conversation.";
  }
  if (nonWebOutputsAvailable) {
    return "This project has no web preview. Use Run to choose an output; terminal output and downloads appear here.";
  }
  return "Preview will appear here when it is ready.";
}

function outputTargetLabel(outputTarget = null) {
  const label = String(outputTarget?.label || outputTarget?.id || "").trim();
  return label || "selected output target";
}

function launchPreviewInFlightText({
  workspacePreparing = false,
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
  if (workspacePreparing) {
    return "Preparing workspace before Preview can start. Expand Preparing workspace to see progress. Preview will retry automatically when setup finishes.";
  }
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
    return "Waiting for the current workspace operation to finish. Preview will retry automatically.";
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

export {
  launchPreviewEmptyText,
  launchPreviewInFlightText,
  launchPreviewIssue,
  launchPreviewNotice,
  launchPreviewStatusText
};
