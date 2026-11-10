import { computed, watch } from "vue";
import { useVibe64OutputControls } from "@/composables/useVibe64OutputControls.js";
import { useVibe64OutputOptions } from "@/composables/useVibe64OutputOptions.js";
import { useVibe64PreviewAddress } from "@/composables/useVibe64PreviewAddress.js";
import { useVibe64PreviewFrame } from "@/composables/useVibe64PreviewFrame.js";
import { useVibe64PreviewIdentity } from "@/composables/useVibe64PreviewIdentity.js";
import { useVibe64PreviewMessages } from "@/composables/useVibe64PreviewMessages.js";
import { useVibe64PreviewOpenRequests } from "@/composables/useVibe64PreviewOpenRequests.js";
import { useVibe64PreviewPick } from "@/composables/useVibe64PreviewPick.js";
import { useVibe64PreviewPresentation } from "@/composables/useVibe64PreviewPresentation.js";
import { useVibe64PreviewRecovery } from "@/composables/useVibe64PreviewRecovery.js";
import { useVibe64PreviewReload } from "@/composables/useVibe64PreviewReload.js";
import { useVibe64PreviewTargets } from "@/composables/useVibe64PreviewTargets.js";
import { useVibe64PreviewToolbar } from "@/composables/useVibe64PreviewToolbar.js";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { previewIdentityTypeLabel } from "@/lib/vibe64PreviewIdentity.js";

/**
 * Everything the output controls show and do, composed from one concern per
 * composable. `usage` connects Click in Preview to the usage map.
 * @param {object} props The output controls' props.
 * @param {import("@/composables/useVibe64PreviewPick.js").PreviewUsage} usage
 */
function useVibe64OutputControlsSurface(props, {
  openUsage,
  readUsageEntries,
  recordInteraction,
  recording
}) {
  const outputs = useVibe64OutputControls({
    autoStartManagedPreview: () => props.autoStartManagedPreview,
    autoStartTargetId: () => props.autoStartTargetId,
    embeddedPreview: () => props.embeddedPreview,
    previewDisplayed: () => props.previewDisplayed,
    sourceOperationsSuspended: () => props.sourceOperationsSuspended,
    windowDisplayed: () => props.windowDisplayed,
    busy: () => props.busy,
    session: () => props.session
  });
  const projectSlug = useVibe64ProjectSlug();
  const targets = useVibe64PreviewTargets({ outputs, props });
  const options = useVibe64OutputOptions({ outputs, projectSlug, props, targets });
  const recovery = useVibe64PreviewRecovery({ outputs, projectSlug, props, targets });
  const toolbar = useVibe64PreviewToolbar({ projectSlug, props });
  const frame = useVibe64PreviewFrame({
    // Late-bound: identity and reload are composed after the frame they build
    // on, and the frame calls them only once its page changes.
    followIdentityReload: (frameRequestId) => identity.followIdentityReload(frameRequestId),
    identityBusy: () => identity.previewIdentityBusy.value,
    identityFrameReady: (frameRequestId) => identity.handlePreviewFrameReady(frameRequestId),
    outputs,
    projectSlug,
    props,
    resourceRetryCount: () => reload.currentPreviewResourceRetryCount()
  });
  const identity = useVibe64PreviewIdentity({ frame, outputs, props });
  const reload = useVibe64PreviewReload({ frame, identity, outputs, projectSlug, props });
  const address = useVibe64PreviewAddress({ frame, projectSlug, props, targets });
  const pick = useVibe64PreviewPick({
    frame,
    props,
    usage: { openUsage, readUsageEntries, recordInteraction, recording }
  });
  useVibe64PreviewMessages({ address, frame, outputs, pick, reload });
  const openRequests = useVibe64PreviewOpenRequests({ address, outputs, projectSlug, props });
  const presentation = useVibe64PreviewPresentation({ address, frame, identity, outputs, props, recovery, targets });
  const { expandTerminal, minimizeTerminal, outputTargetsLoaded, previewState } = outputs;
  const { collapsePreviewToolbar } = toolbar;
  const {
    clearPreviewFrame,
    previewBaseUrl,
    previewDisplayBaseUrl,
    previewPaneDisplayed,
    previewReadyForIframe,
    previewSuspended,
    requestPreviewFrame,
    requestPreviewState
  } = frame;
  const { previewLogVisible } = presentation;
  const { cancelPreviewResourceRetry } = reload;
  const toolbarTeleportTarget = computed(() => String(props.toolbarTeleportTarget || "").trim());

  // Registered once every concern exists: these reach across the frame,
  // identity and reload, in the order their effects depend on.
  watch([
    previewReadyForIframe,
    previewBaseUrl,
    previewDisplayBaseUrl
  ], ([ready, baseUrl]) => {
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

  // A page served by a preview that is no longer running cannot recover, and it
  // looks alive. Replace it with the stopped state and its Start control.
  watch(previewState, (state) => {
    if (outputTargetsLoaded.value && ["failed", "idle", "project_closed", "stopped"].includes(state)) {
      clearPreviewFrame("preview-not-running");
    }
  }, {
    flush: "sync"
  });

  watch([projectSlug, () => String(props.session?.sessionId || "")], () => {
    previewSuspended.value = false;
    cancelPreviewResourceRetry();
    clearPreviewFrame("session-changed");
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

  return {
    outputOptionsAction: options.outputOptionsAction,
    previewWorkNotice: computed(() => (
      frame.previewLeftNotice.value || openRequests.previewOpenNotice.value || recovery.previewWorkNotice.value
    )),
    previewTestNotice: outputs.previewTestNotice,
    outputOptionsAvailable: targets.outputOptionsAvailable,
    outputOptionsError: options.outputOptionsError,
    outputOptionsErrors: options.outputOptionsErrors,
    outputOptionsRemember: options.outputOptionsRemember,
    outputOptionsSelection: options.outputOptionsSelection,
    outputOptionsValues: options.outputOptionsValues,
    outputOptionsVisible: options.outputOptionsVisible,
    openOutputOptions: options.openOutputOptions,
    resetOutputOptions: options.resetOutputOptions,
    runWithOptions: options.runWithOptions,
    submitOutputOptions: options.submitOutputOptions,
    embeddedAutoStartTarget: targets.embeddedAutoStartTarget,
    embeddedManualStartButtonDisabled: targets.embeddedManualStartButtonDisabled,
    embeddedManualStartButtonVisible: targets.embeddedManualStartButtonVisible,
    embeddedStartTarget: targets.embeddedStartTarget,
    embeddedTerminalFrameVisible: presentation.embeddedTerminalFrameVisible,
    embeddedTerminalSurfaceVisible: presentation.embeddedTerminalSurfaceVisible,
    embeddedTerminalVisible: presentation.embeddedTerminalVisible,
    collapsePreviewToolbar: toolbar.collapsePreviewToolbar,
    forceStartEmbeddedPreview: recovery.forceStartEmbeddedPreview,
    goPreviewBack: address.goPreviewBack,
    handlePreviewFrameLoad: frame.handlePreviewFrameLoad,
    expandPreviewToolbar: toolbar.expandPreviewToolbar,
    launchActions: outputs.launchActions,
    launchButtonsDisabled: outputs.launchButtonsDisabled,
    launchError: outputs.launchError,
    resourceAdmissionId: outputs.resourceAdmissionId,
    testApproval: outputs.testApproval,
    acceptResourceRetry: outputs.acceptResourceRetry,
    launchStatusAttempt: outputs.launchStatusAttempt,
    launchStatusChipText: presentation.launchStatusChipText,
    launchStatusChipTitle: presentation.launchStatusChipTitle,
    launchStatusChipVisible: presentation.launchStatusChipVisible,
    launchStatusDetailText: presentation.launchStatusDetailText,
    launchStatusRetryVisible: presentation.launchStatusRetryVisible,
    launchStatusText: presentation.launchStatusText,
    outputExecution: outputs.outputExecution,
    outputResults: outputs.outputResults,
    outputRuns: outputs.outputRuns,
    outputTargets: outputs.outputTargets,
    launchToolbarDockVisible: presentation.launchToolbarDockVisible,
    loading: outputs.loading,
    loadError: outputs.loadError,
    manualLaunchMenuVisible: targets.manualLaunchMenuVisible,
    movePreviewToolbar: toolbar.movePreviewToolbar,
    openAction: outputs.openAction,
    operationBusy: outputs.operationBusy,
    previewBaseUrl: frame.previewBaseUrl,
    previewAddressBlur: address.previewAddressBlur,
    previewAddressDraft: address.previewAddressDraft,
    previewAddressError: address.previewAddressError,
    previewAddressFocus: address.previewAddressFocus,
    previewBackAvailable: address.previewBackAvailable,
    previewActivityVisible: presentation.previewActivityVisible,
    previewCanRestart: outputs.previewCanRestart,
    previewCanShowLog: outputs.previewCanShowLog,
    previewCanStart: outputs.previewCanStart,
    previewCheckAgainVisible: presentation.previewCheckAgainVisible,
    previewSetupRetryVisible: presentation.previewSetupRetryVisible,
    previewBrowserControlsVisible: presentation.previewBrowserControlsVisible,
    previewDisplayedAddress: address.previewDisplayedAddress,
    previewDisplayedUrl: address.previewDisplayedUrl,
    previewDiagnosticsAvailable: frame.previewDiagnosticsAvailable,
    previewDiagnosticsBusy: frame.previewDiagnosticsBusy,
    previewEmbedUnavailableReason: frame.previewEmbedUnavailableReason,
    previewEmptyText: presentation.previewEmptyText,
    previewFrame: frame.previewFrame,
    previewFrameLoaded: frame.previewFrameLoaded,
    previewFrameRequestId: frame.previewFrameRequestId,
    previewIdentityAvailable: identity.previewIdentityAvailable,
    previewIdentityBusy: identity.previewIdentityBusy,
    previewIdentityConfigured: identity.previewIdentityConfigured,
    previewIdentityCurrent: identity.previewIdentityCurrent,
    previewIdentityError: identity.previewIdentityError,
    previewIdentityLabel: identity.previewIdentityLabel,
    previewIdentitySelectionDisabled: identity.previewIdentitySelectionDisabled,
    previewIdentityTitle: identity.previewIdentityTitle,
    previewIdentityTypeLabel,
    previewIssue: presentation.previewIssue,
    previewIssueVisible: presentation.previewIssueVisible,
    previewInFlightText: presentation.previewInFlightText,
    previewLoadingOverlayVisible: frame.previewLoadingOverlayVisible,
    previewMessage: outputs.previewMessage,
    previewRouteDialogError: address.previewRouteDialogError,
    previewRouteDialogParams: address.previewRouteDialogParams,
    previewRouteDialogPath: address.previewRouteDialogPath,
    previewRouteDialogVisible: address.previewRouteDialogVisible,
    previewRouteFormValues: address.previewRouteFormValues,
    previewRouteSelection: address.previewRouteSelection,
    previewRoutes: address.previewRoutes,
    previewRoutesAvailable: address.previewRoutesAvailable,
    previewNotice: presentation.previewNotice,
    previewNoticeVisible: presentation.previewNoticeVisible,
    previewRecoveryLabel: presentation.previewRecoveryLabel,
    previewRecoveryVisible: presentation.previewRecoveryVisible,
    previewResourceNoticeText: reload.previewResourceNoticeText,
    previewResourceNoticeVisible: reload.previewResourceNoticeVisible,
    previewPickAvailable: pick.previewPickAvailable,
    previewPickBusy: pick.previewPickBusy,
    previewPickNoticeOpensUsage: pick.previewPickNoticeOpensUsage,
    previewPickNoticeText: pick.previewPickNoticeText,
    previewPickNoticeVisible: pick.previewPickNoticeVisible,
    previewPicking: frame.previewPicking,
    openUsageFromPickNotice: pick.openUsageFromPickNotice,
    stopPreviewPick: frame.stopPreviewPick,
    togglePreviewPick: pick.togglePreviewPick,
    previewState: outputs.previewState,
    previewTerminalRecoveryVisible: presentation.previewTerminalRecoveryVisible,
    previewToolbarRecoveryVisible: presentation.previewToolbarRecoveryVisible,
    previewStarting: presentation.previewStarting,
    previewToolbarExpanded: toolbar.previewToolbarExpanded,
    previewToolbarPosition: toolbar.previewToolbarPosition,
    previewUrl: frame.previewUrl,
    copyPreviewUrl: address.copyPreviewUrl,
    openPreviewRoute: address.openPreviewRoute,
    recoverEmbeddedPreview: recovery.recoverEmbeddedPreview,
    recheckResourceAdmission: recovery.recheckResourceAdmission,
    reloadPreview: reload.reloadPreview,
    previewSuspended: frame.previewSuspended,
    suspendPreview: reload.suspendPreview,
    resumePreview: reload.resumePreview,
    retryLaunchStatus: recovery.retryLaunchStatus,
    retryPreviewWorkspaceSetup: recovery.retryPreviewWorkspaceSetup,
    requestPreviewDiagnostics: frame.requestPreviewDiagnostics,
    resetPreviewAddressDraft: address.resetPreviewAddressDraft,
    selectPreviewConfiguredIdentity: identity.selectPreviewConfiguredIdentity,
    selectPreviewGuest: identity.selectPreviewGuest,
    submitPreviewRouteDialog: address.submitPreviewRouteDialog,
    submitPreviewAddress: address.submitPreviewAddress,
    restartTerminal: outputs.restartTerminal,
    retryTerminal: outputs.retryTerminal,
    runMenuDisabled: targets.runMenuDisabled,
    showLaunchLog,
    stopTerminal: outputs.stopTerminal,
    setTerminalExpanded,
    terminal: outputs.terminal,
    terminalCanStop: outputs.terminalCanStop,
    terminalCanRestart: outputs.terminalCanRestart,
    terminalCanRetry: outputs.terminalCanRetry,
    terminalCommandPreview: outputs.terminalCommandPreview,
    terminalDisplayed: outputs.terminalDisplayed,
    terminalExpanded: outputs.terminalExpanded,
    terminalError: outputs.terminalError,
    terminalIndicatorLabel: outputs.terminalIndicatorLabel,
    terminalIndicatorState: outputs.terminalIndicatorState,
    terminalIsRunning: outputs.terminalIsRunning,
    terminalStatus: outputs.terminalStatus,
    terminalSubtitle: outputs.terminalSubtitle,
    terminalTitle: outputs.terminalTitle,
    terminalVisible: outputs.terminalVisible,
    terminalWindowStorageKey: outputs.terminalWindowStorageKey,
    terminalWindowVisible: outputs.terminalWindowVisible,
    toolbarTeleportTarget,
    visible: outputs.visible
  };
}

/**
 * What each part of the output controls receives as `surface`.
 * @typedef {ReturnType<typeof useVibe64OutputControlsSurface>} Vibe64OutputControlsSurface
 */

export {
  useVibe64OutputControlsSurface
};
