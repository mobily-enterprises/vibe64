import { computed, ref } from "vue";
import { launchToolbarDockShouldShow } from "@/lib/vibe64LaunchPreviewToolbar.js";
import {
  launchPreviewEmptyText,
  launchPreviewInFlightText,
  launchPreviewIssue,
  launchPreviewNotice,
  launchPreviewStatusText
} from "@/lib/vibe64PreviewStatusText.js";

/**
 * What the output controls show around the Preview: the status chip, the
 * text in an empty Preview, the issue and notice that stopped it with their
 * recovery actions, the toolbar dock, and where the run log shows.
 * @param {{
 *   address: ReturnType<typeof import("./useVibe64PreviewAddress.js").useVibe64PreviewAddress>,
 *   frame: ReturnType<typeof import("./useVibe64PreviewFrame.js").useVibe64PreviewFrame>,
 *   identity: ReturnType<typeof import("./useVibe64PreviewIdentity.js").useVibe64PreviewIdentity>,
 *   outputs: ReturnType<typeof import("./useVibe64OutputControls.js").useVibe64OutputControls>,
 *   props: { embeddedPreview?: boolean, session?: object | null },
 *   recovery: ReturnType<typeof import("./useVibe64PreviewRecovery.js").useVibe64PreviewRecovery>,
 *   targets: ReturnType<typeof import("./useVibe64PreviewTargets.js").useVibe64PreviewTargets>
 * }} options
 */
function useVibe64PreviewPresentation({ address, frame, identity, outputs, props, recovery, targets }) {
  const {
    activeOutputTarget,
    launchError,
    launchStarting,
    launchStatusAttempt,
    launchWaiting,
    loadError,
    loading,
    operationBusy,
    outputTargets,
    outputTargetsLoaded,
    previewCanRestart,
    previewCanStart,
    previewMessage,
    previewState,
    terminalCanRestart,
    terminalCanRetry,
    terminalDisplayed,
    terminalDockVisible,
    terminalExpanded,
    terminalIsRunning,
    terminalVisible,
    workspacePreparing
  } = outputs;
  const {
    embeddedManualStartButtonVisible,
    embeddedStartTarget,
    outputSetupUnavailableReason
  } = targets;
  const { previewRestartPending } = recovery;
  const {
    previewEmbedUnavailableReason,
    previewLoadingOverlayVisible,
    previewSuspended,
    previewUrl
  } = frame;
  const { previewIdentityBusy, previewIdentityRequested } = identity;
  const { previewDisplayedAddress } = address;
  const previewLogVisible = ref(false);
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
  const previewCheckAgainVisible = computed(() => Boolean(
    props.embeddedPreview &&
    previewState.value === "idle" &&
    !previewUrl.value &&
    !terminalVisible.value &&
    outputSetupUnavailableReason.value &&
    !loadError.value
  ));
  // A failed Workspace setup blocks Start; its message gets Retry setup here.
  const previewSetupRetryVisible = computed(() => Boolean(
    previewCheckAgainVisible.value &&
    String(props.session?.workspaceSetup?.status || "").trim() === "failed"
  ));
  const previewBrowserControlsVisible = computed(() => Boolean(
    previewSuspended.value || loading.value || loadError.value || previewUrl.value ||
    outputTargets.value.some((target) => target.presentation?.kind === "web")
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
  const previewInFlightText = computed(() => {
    if (previewIdentityBusy.value) {
      const requested = previewIdentityRequested.value;
      return requested?.mode === "guest"
        ? "Signing out of the preview…"
        : `Opening preview as ${requested?.name || requested?.identityName || "the selected app identity"}…`;
    }
    return launchPreviewInFlightText({
      workspacePreparing: workspacePreparing?.value === true,
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
    !previewRestartPending.value &&
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
    previewStartUnavailableReason: outputSetupUnavailableReason.value,
    launchStarting: launchStarting.value,
    outputTargetsUnavailable: outputTargetsLoaded.value && outputTargets.value.length < 1,
    nonWebOutputsAvailable: outputTargets.value.length > 0 && !embeddedStartTarget.value,
    terminalIsRunning: terminalIsRunning.value
  }));

  return {
    embeddedTerminalFrameVisible,
    embeddedTerminalSurfaceVisible,
    embeddedTerminalVisible,
    launchStatusChipText,
    launchStatusChipTitle,
    launchStatusChipVisible,
    launchStatusDetailText,
    launchStatusRetryVisible,
    launchStatusText,
    launchToolbarDockVisible,
    previewActivityVisible,
    previewBrowserControlsVisible,
    previewCheckAgainVisible,
    previewEmptyText,
    previewInFlightText,
    previewIssue,
    previewIssueVisible,
    previewLogVisible,
    previewNotice,
    previewNoticeVisible,
    previewRecoveryLabel,
    previewRecoveryVisible,
    previewSetupRetryVisible,
    previewStarting,
    previewTerminalRecoveryVisible,
    previewToolbarRecoveryVisible
  };
}

export {
  useVibe64PreviewPresentation
};
