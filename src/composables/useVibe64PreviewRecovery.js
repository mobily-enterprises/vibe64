import { computed, nextTick, ref, watch } from "vue";

/**
 * Getting the embedded Preview running again. A stale or failed Preview is
 * restarted once by itself when nothing else is busy; until then the toolbar
 * says a restart is coming. It also starts, restarts or retries the Preview
 * by hand, rechecks a refused resource admission, and retries status loads and
 * workspace setup.
 * @param {{
 *   outputs: ReturnType<typeof import("./useVibe64OutputControls.js").useVibe64OutputControls>,
 *   projectSlug: import("vue").Ref<string>,
 *   props: { busy?: boolean, embeddedPreview?: boolean, session?: object | null, sourceOperationsSuspended?: boolean },
 *   targets: ReturnType<typeof import("./useVibe64PreviewTargets.js").useVibe64PreviewTargets>
 * }} options
 */
function useVibe64PreviewRecovery({ outputs, projectSlug, props, targets }) {
  const {
    loadError,
    operationBusy,
    outputTargets,
    previewCanRestart,
    previewCanStart,
    previewState,
    previewStoppedIntent,
    previewTestNotice,
    refresh: refreshOutputs,
    resourceAdmissionId,
    restartTerminal,
    retryFailedWorkspaceSetup,
    retryTerminal,
    run,
    startNewlyConfiguredWorkspaceSetup,
    terminalCanRestart,
    terminalCanRetry,
    terminalIsRunning,
    testApproval
  } = outputs;
  const { embeddedStartTarget } = targets;
  const previewRestartPending = ref(false);
  let previewRestartAttempted = false;
  const previewWorkNotice = computed(() => previewRestartPending.value
    ? "Server will be restarted soon"
    : props.busy || props.sourceOperationsSuspended ? "Work in progress" : "");
  watch([() => props.session?.sessionId, () => props.busy, () => props.sourceOperationsSuspended,
    previewState, previewStoppedIntent, operationBusy, terminalCanRestart, terminalCanRetry, previewCanRestart, previewTestNotice,
    resourceAdmissionId, testApproval],
  async ([sessionId, busy, suspended, state], previous = []) => {
    if (sessionId !== previous[0] || state === "ready") {
      previewRestartAttempted = false;
      previewRestartPending.value = false;
    }
    if (busy && !previous[1]) previewRestartAttempted = false;
    if (previewStoppedIntent.value || resourceAdmissionId.value || testApproval.value || previewTestNotice.value) {
      previewRestartPending.value = false;
      return;
    }
    if (!props.embeddedPreview || !["stale", "failed"].includes(state) ||
        !(terminalCanRestart.value || terminalCanRetry.value || previewCanRestart.value) || previewRestartAttempted) return;
    previewRestartPending.value = true;
    if (busy || suspended || operationBusy.value) return;
    previewRestartAttempted = true;
    const project = projectSlug.value;
    try {
      await refreshOutputs();
      await nextTick();
      if (project !== projectSlug.value || sessionId !== props.session?.sessionId || loadError.value ||
          props.busy || props.sourceOperationsSuspended || operationBusy.value ||
          previewStoppedIntent.value || resourceAdmissionId.value || testApproval.value || previewTestNotice.value ||
          !["stale", "failed"].includes(previewState.value) ||
          !(terminalCanRestart.value || terminalCanRetry.value || previewCanRestart.value)) return;
      await recoverEmbeddedPreview();
    } finally {
      if (props.session?.sessionId === sessionId) previewRestartPending.value = false;
    }
  });

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

  async function retryLaunchStatus() {
    await startNewlyConfiguredWorkspaceSetup?.();
    await refreshOutputs();
  }

  async function retryPreviewWorkspaceSetup() {
    await retryFailedWorkspaceSetup?.();
    await refreshOutputs();
  }

  return {
    forceStartEmbeddedPreview,
    previewRestartPending,
    previewWorkNotice,
    recheckResourceAdmission,
    recoverEmbeddedPreview,
    retryLaunchStatus,
    retryPreviewWorkspaceSetup
  };
}

export {
  useVibe64PreviewRecovery
};
