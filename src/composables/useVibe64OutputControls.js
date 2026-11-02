import { computed, watch } from "vue";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { useVibe64OutputAutoStart } from "@/composables/useVibe64OutputAutoStart.js";
import { useVibe64OutputLaunch } from "@/composables/useVibe64OutputLaunch.js";
import { useVibe64OutputPreview } from "@/composables/useVibe64OutputPreview.js";
import { useVibe64OutputStatus } from "@/composables/useVibe64OutputStatus.js";
import { useVibe64OutputTerminal } from "@/composables/useVibe64OutputTerminal.js";
import { terminalSessionMissingError } from "@/lib/vibe64TerminalErrors.js";

/**
 * A session's output controls: its outputs status, the running output's
 * terminal and Preview, launching outputs and starting one by itself. This
 * composes those concerns and resets them together when the outputs are
 * hidden or the project or session changes.
 * @param {{
 *   autoStartManagedPreview?: unknown,
 *   autoStartTargetId?: unknown,
 *   busy?: unknown,
 *   embeddedPreview?: unknown,
 *   previewDisplayed?: unknown,
 *   session?: unknown,
 *   sourceOperationsSuspended?: unknown,
 *   windowDisplayed?: unknown
 * }} [options]
 */
function useVibe64OutputControls({
  autoStartManagedPreview = () => false,
  autoStartTargetId = () => "",
  busy = () => false,
  embeddedPreview = () => false,
  previewDisplayed = () => true,
  session = null,
  sourceOperationsSuspended = () => false,
  windowDisplayed = () => true
} = {}) {
  const projectSlug = useVibe64ProjectSlug();
  const outputs = useVibe64OutputStatus({
    // Late-bound: the realtime filter reads launch state only once an event arrives.
    localLaunchStarting: () => launch.launchStarting.value,
    projectSlug,
    session,
    sourceOperationsSuspended,
    windowDisplayed
  });
  const outputTerminal = useVibe64OutputTerminal({ outputs, projectSlug });
  const preview = useVibe64OutputPreview({ outputs, outputTerminal, projectSlug });
  const launch = useVibe64OutputLaunch({ busy, embeddedPreview, outputs, outputTerminal, projectSlug });
  const autoStart = useVibe64OutputAutoStart({
    autoStartManagedPreview,
    autoStartTargetId,
    busy,
    launch,
    outputs,
    outputTerminal,
    previewDisplayed,
    projectSlug
  });
  const { terminal } = outputTerminal;
  const visible = computed(() => Boolean(
    (
      outputs.canLoadOutputs.value ||
      outputTerminal.terminalVisible.value
    ) &&
      (
        outputs.outputTargets.value.length > 0 ||
        outputs.outputTargetsResource.loadError.value ||
        outputTerminal.terminalVisible.value
      )
  ));

  watch(terminal.terminalError, (message) => {
    if (!terminalSessionMissingError(message)) {
      return;
    }
    outputTerminal.clearStaleLaunchTerminal();
    void outputs.refresh();
  });

  watch(outputs.terminalDisplayed, (displayed) => {
    if (displayed) {
      void outputTerminal.connectLaunchTerminal();
      return;
    }
    autoStart.resetAutoStart();
    outputTerminal.hideLaunchTerminal();
  });

  watch(outputs.launchScopeKey, () => {
    launch.resetLaunch();
    outputs.resetLaunchStatusAttempt();
    autoStart.resetAutoStart();
    outputTerminal.resetLaunchTerminal();
  });

  return {
    activeOutputTarget: outputTerminal.activeOutputTarget,
    previewTestNotice: preview.previewTestNotice,
    activeOutputTargetId: outputTerminal.activeOutputTargetId,
    activeTerminal: outputTerminal.activeTerminal,
    closeTerminal: launch.closeTerminal,
    copyLog: outputTerminal.copyLog,
    expandTerminal: outputTerminal.expandTerminal,
    launchActions: preview.launchActions,
    launchButtonsDisabled: launch.launchButtonsDisabled,
    launchError: launch.launchError,
    resourceAdmissionId: launch.resourceAdmissionId,
    acceptResourceRetry: launch.acceptResourceRetry,
    testApproval: outputs.testApproval,
    launchStatusAttempt: outputs.launchStatusAttempt,
    launchStatusIdleRecoveryExhausted: autoStart.launchStatusIdleRecoveryExhausted,
    launchStarting: launch.launchStarting,
    launchWaiting: computed(() => outputs.workspacePreparing.value || launch.launchWaiting.value),
    workspacePreparing: outputs.workspacePreparing,
    outputTargets: outputs.outputTargets,
    outputTargetsLoaded: outputs.outputTargetsLoaded,
    outputExecution: outputs.outputExecution,
    outputResults: outputs.outputResults,
    outputRuns: outputs.outputRuns,
    loading: outputs.outputTargetsResource.isLoading,
    loadError: outputs.launchStatusLoadError,
    minimizeTerminal: outputTerminal.minimizeTerminal,
    openAction: preview.openAction,
    operationBusy: launch.operationBusy,
    previewCanRestart: outputs.previewCanRestart,
    previewCanShowLog: outputs.previewCanShowLog,
    previewCanStart: outputs.previewCanStart,
    previewHref: outputs.previewHref,
    previewIdentity: preview.previewIdentity,
    previewMessage: outputs.previewMessage,
    previewState: outputs.previewState,
    previewStoppedIntent: outputs.previewStoppedIntent,
    previewTargetDisabledReason: preview.previewTargetDisabledReason,
    previewTargetHref: outputs.previewTargetHref,
    previewTargetRecovery: preview.previewTargetRecovery,
    terminalPreviewRequiresProxy: preview.terminalPreviewRequiresProxy,
    terminalPreviewProxyPending: preview.terminalPreviewProxyPending,
    publishPreviewState: preview.publishPreviewState,
    publishPreviewDiagnostic: preview.publishPreviewDiagnostic,
    requestPreviewIdentityGrant: preview.requestPreviewIdentityGrant,
    refresh: outputs.refresh,
    restartTerminal: launch.restartTerminal,
    retryTerminal: launch.retryTerminal,
    parametersForTarget: launch.parametersForTarget,
    parametersRemembered: launch.parametersRemembered,
    rememberParameters: launch.rememberParameters,
    run: launch.run,
    sendCtrlC: terminal.sendCtrlC,
    stopTerminal: launch.stopTerminal,
    startNewlyConfiguredWorkspaceSetup: () => outputs.startWorkspaceSetupWhen("unconfigured"),
    retryFailedWorkspaceSetup: () => outputs.startWorkspaceSetupWhen("failed"),
    terminal,
    terminalCanClose: outputTerminal.terminalCanClose,
    terminalCanCopyLog: outputTerminal.terminalCanCopyLog,
    terminalCanRestart: launch.terminalCanRestart,
    terminalCanRetry: launch.terminalCanRetry,
    terminalCanStop: outputTerminal.terminalCanStop,
    terminalCommandPreview: terminal.terminalCommandPreview,
    terminalDisplayed: outputs.terminalDisplayed,
    terminalDockVisible: outputTerminal.terminalDockVisible,
    terminalError: terminal.terminalError,
    terminalExpanded: outputTerminal.terminalExpanded,
    terminalExited: terminal.terminalExited,
    terminalExitCode: terminal.terminalExitCode,
    terminalIndicatorLabel: outputTerminal.terminalIndicatorLabel,
    terminalIndicatorState: outputTerminal.terminalIndicatorState,
    terminalIsRunning: outputTerminal.terminalIsRunning,
    terminalLaunchReady: outputTerminal.terminalLaunchReady,
    terminalMetadata: terminal.terminalMetadata,
    terminalOutput: terminal.terminalOutput,
    terminalSessionId: terminal.terminalSessionId,
    terminalStarting: terminal.terminalStarting,
    terminalStatus: terminal.terminalStatus,
    terminalSubtitle: outputTerminal.terminalSubtitle,
    terminalTitle: outputTerminal.terminalTitle,
    terminalVisible: outputTerminal.terminalVisible,
    terminalWindowStorageKey: outputTerminal.terminalWindowStorageKey,
    terminalWindowVisible: outputTerminal.terminalWindowVisible,
    visible
  };
}

export {
  useVibe64OutputControls
};
