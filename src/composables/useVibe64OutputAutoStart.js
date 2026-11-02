import { computed, onBeforeUnmount, ref, watch } from "vue";
import { managedPreviewTarget } from "@local/studio-terminal-core/shared";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  AUTO_START_STABILITY_DELAY_MS,
  autoStartOutputsLoading,
  clearLaunchAutoStartAttempt,
  readLaunchAutoStartAttemptCooldown,
  shouldScheduleLaunchAutoStart
} from "@/lib/vibe64LaunchAutoStart.js";

const LAUNCH_STATUS_IDLE_RECOVERY_INITIAL_DELAY_MS = 1200;
const LAUNCH_STATUS_IDLE_RECOVERY_INTERVAL_MS = 3000;
const LAUNCH_STATUS_IDLE_RECOVERY_LIMIT = 6;

/**
 * Starting the requested output by itself once the session's outputs have
 * settled: the requested target, or the managed Preview. A recent attempt in
 * this tab waits out its cooldown first. While an idle status shows no target
 * yet, the status is refetched a few times, and again when a newer session
 * revision may declare one.
 * @param {{
 *   autoStartManagedPreview: unknown,
 *   autoStartTargetId: unknown,
 *   busy: unknown,
 *   launch: ReturnType<typeof import("./useVibe64OutputLaunch.js").useVibe64OutputLaunch>,
 *   outputs: ReturnType<typeof import("./useVibe64OutputStatus.js").useVibe64OutputStatus>,
 *   outputTerminal: ReturnType<typeof import("./useVibe64OutputTerminal.js").useVibe64OutputTerminal>,
 *   previewDisplayed: unknown,
 *   projectSlug: import("vue").Ref<string>
 * }} options
 */
function useVibe64OutputAutoStart({
  autoStartManagedPreview,
  autoStartTargetId,
  busy,
  launch,
  outputs,
  outputTerminal,
  previewDisplayed,
  projectSlug
}) {
  const {
    canLoadOutputs,
    launchScopeKey,
    launchStatusLoadError,
    outputTargets,
    outputTargetsResource,
    previewState,
    previewStoppedIntent,
    refresh,
    sessionId,
    sessionRevision,
    terminalDisplayed
  } = outputs;
  const { terminalVisible } = outputTerminal;
  const { autoStartKey, operationBusy, resourceAdmissionId, run } = launch;
  const autoStartCooldownVersion = ref(0);
  const launchStatusIdleRecoveryCount = ref(0);
  const launchStatusIdleRecoveryExhausted = computed(() => (
    launchStatusIdleRecoveryCount.value >= LAUNCH_STATUS_IDLE_RECOVERY_LIMIT
  ));
  const outputTargetsSettledForAutoStart = ref(false);
  let autoStartTimer = 0;
  let autoStartCooldownTimer = 0;
  let scheduledAutoStartKey = "";
  let launchStatusIdleRecoveryTimer = 0;
  let launchStatusIdleRecoveryScopeKey = "";
  let outputTargetsRefreshSessionId = sessionId.value;
  let outputTargetsRefreshRevision = sessionRevision.value;

  const requestedAutoStartTargetId = computed(() => String(readRefOrGetterValue(autoStartTargetId) || "").trim());
  const autoStartRequestKey = computed(() => requestedAutoStartTargetId.value || (
    readRefOrGetterValue(autoStartManagedPreview) === true ? "managed-preview" : ""
  ));
  const previewPaneDisplayed = computed(() => readRefOrGetterValue(previewDisplayed) !== false);
  const autoStartTarget = computed(() => {
    if (requestedAutoStartTargetId.value) {
      return outputTargets.value.find((target) => (
        target.id === requestedAutoStartTargetId.value &&
        target.presentation?.kind === "web" &&
        target.available !== false
      )) || null;
    }
    return autoStartRequestKey.value
      ? managedPreviewTarget(outputTargets.value)
      : null;
  });
  const outputTargetsLoadingForAutoStart = computed(() => autoStartOutputsLoading({
    outputTargetsLoading: outputTargetsResource.isLoading.value,
    outputTargetsSettled: outputTargetsSettledForAutoStart.value
  }));
  const launchStatusIdleRecoveryNeeded = computed(() => Boolean(
    previewPaneDisplayed.value &&
    canLoadOutputs.value &&
    autoStartRequestKey.value &&
    !outputTargetsResource.isLoading.value &&
    !launchStatusLoadError.value &&
    !operationBusy.value &&
    !terminalVisible.value &&
    !autoStartTarget.value &&
    outputTargets.value.length < 1 &&
    previewState.value === "idle"
  ));

  watch([
    sessionId,
    sessionRevision,
    canLoadOutputs,
    autoStartRequestKey,
    () => outputTargetsResource.isLoading.value,
    launchStatusLoadError,
    terminalVisible,
    autoStartTarget,
    previewState
  ], () => {
    const currentSessionId = sessionId.value;
    const currentRevision = sessionRevision.value;
    if (
      currentSessionId !== outputTargetsRefreshSessionId ||
      outputTargetsRefreshRevision === null
    ) {
      outputTargetsRefreshSessionId = currentSessionId;
      outputTargetsRefreshRevision = currentRevision;
      return;
    }
    if (currentRevision === null || currentRevision <= outputTargetsRefreshRevision) {
      return;
    }
    if (terminalVisible.value || autoStartTarget.value || previewState.value !== "idle") {
      outputTargetsRefreshRevision = currentRevision;
      return;
    }
    if (
      !canLoadOutputs.value ||
      !autoStartRequestKey.value ||
      outputTargetsResource.isLoading.value ||
      launchStatusLoadError.value
    ) {
      return;
    }
    outputTargetsRefreshRevision = currentRevision;
    void refresh();
  }, {
    flush: "post"
  });

  function clearAutoStartTimer() {
    if (autoStartTimer && typeof window !== "undefined") {
      window.clearTimeout(autoStartTimer);
    }
    autoStartTimer = 0;
    scheduledAutoStartKey = "";
  }

  function clearAutoStartCooldownTimer() {
    if (autoStartCooldownTimer && typeof window !== "undefined") {
      window.clearTimeout(autoStartCooldownTimer);
    }
    autoStartCooldownTimer = 0;
  }

  function clearLaunchStatusIdleRecoveryTimer() {
    if (launchStatusIdleRecoveryTimer && typeof window !== "undefined") {
      window.clearTimeout(launchStatusIdleRecoveryTimer);
    }
    launchStatusIdleRecoveryTimer = 0;
  }

  function resetLaunchStatusIdleRecovery() {
    clearLaunchStatusIdleRecoveryTimer();
    launchStatusIdleRecoveryCount.value = 0;
    launchStatusIdleRecoveryScopeKey = launchScopeKey.value;
  }

  function resetOutputsAutoStartSettlement() {
    outputTargetsSettledForAutoStart.value = false;
  }

  /** Outputs cannot load, are hidden or changed scope: nothing starts by itself. */
  function resetAutoStart() {
    clearAutoStartTimer();
    resetOutputsAutoStartSettlement();
    resetLaunchStatusIdleRecovery();
  }

  function scheduleLaunchStatusIdleRecovery() {
    if (!launchStatusIdleRecoveryNeeded.value || typeof window === "undefined") {
      return;
    }
    const scopeKey = launchScopeKey.value;
    if (!scopeKey) {
      return;
    }
    if (launchStatusIdleRecoveryScopeKey !== scopeKey) {
      launchStatusIdleRecoveryScopeKey = scopeKey;
      launchStatusIdleRecoveryCount.value = 0;
    }
    if (launchStatusIdleRecoveryTimer) {
      return;
    }
    if (launchStatusIdleRecoveryExhausted.value) {
      return;
    }
    const delayMs = launchStatusIdleRecoveryCount.value === 0
      ? LAUNCH_STATUS_IDLE_RECOVERY_INITIAL_DELAY_MS
      : LAUNCH_STATUS_IDLE_RECOVERY_INTERVAL_MS;
    launchStatusIdleRecoveryTimer = window.setTimeout(() => {
      launchStatusIdleRecoveryTimer = 0;
      if (!launchStatusIdleRecoveryNeeded.value || scopeKey !== launchScopeKey.value) {
        return;
      }
      launchStatusIdleRecoveryCount.value += 1;
      void refresh({
        scopeKey
      }).catch(() => null);
    }, delayMs);
  }

  function scheduleAutoStartCooldownCheck(remainingMs = 0) {
    clearAutoStartCooldownTimer();
    if (typeof window === "undefined") {
      return;
    }
    autoStartCooldownTimer = window.setTimeout(() => {
      autoStartCooldownTimer = 0;
      autoStartCooldownVersion.value += 1;
    }, Math.max(0, Number(remainingMs) || 0) + 50);
  }

  function autoStartReady(key, target) {
    return shouldScheduleLaunchAutoStart({
      autoStartKey: autoStartKey.value,
      externalBusy: readRefOrGetterValue(busy),
      key,
      loading: outputTargetsLoadingForAutoStart.value,
      operationBusy: operationBusy.value,
      sessionLaunchable: canLoadOutputs.value,
      sessionId: sessionId.value,
      stoppedIntent: previewStoppedIntent.value,
      target,
      terminalDisplayed: terminalDisplayed.value,
      terminalVisible: terminalVisible.value
    });
  }

  watch(canLoadOutputs, (canLoad) => {
    if (canLoad) {
      return;
    }
    resetAutoStart();
  }, {
    flush: "sync",
    immediate: true
  });

  watch(launchStatusIdleRecoveryNeeded, (needed) => {
    if (needed) {
      scheduleLaunchStatusIdleRecovery();
      return;
    }
    clearLaunchStatusIdleRecoveryTimer();
    if (!outputTargetsResource.isLoading.value) {
      launchStatusIdleRecoveryCount.value = 0;
      launchStatusIdleRecoveryScopeKey = launchScopeKey.value;
    }
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    projectSlug.value,
    sessionId.value,
    autoStartRequestKey.value,
    previewStoppedIntent.value ? "stopped" : "startable",
    canLoadOutputs.value ? "loadable" : "blocked",
    outputTargetsResource.isLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    const scopeKey = launchScopeKey.value;
    if (!scopeKey || !autoStartRequestKey.value || !canLoadOutputs.value || previewStoppedIntent.value) {
      resetOutputsAutoStartSettlement();
      return;
    }
    if (outputTargetsResource.isLoading.value) {
      outputTargetsSettledForAutoStart.value = false;
      return;
    }
    outputTargetsSettledForAutoStart.value = true;
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    projectSlug.value,
    sessionId.value,
    autoStartRequestKey.value,
    previewStoppedIntent.value ? "stopped" : "startable",
    outputTargetsLoadingForAutoStart.value ? "loading" : "ready",
    terminalVisible.value ? "terminal-visible" : "terminal-hidden",
    terminalDisplayed.value ? "displayed" : "hidden",
    canLoadOutputs.value ? "loadable" : "blocked",
    readRefOrGetterValue(busy) ? "external-busy" : "external-idle",
    operationBusy.value ? "busy" : "idle",
    resourceAdmissionId.value,
    autoStartTarget.value?.id || "",
    autoStartCooldownVersion.value
  ].join("|"), () => {
    const target = autoStartTarget.value;
    const key = `${launchScopeKey.value}:${target?.id || ""}`;
    if (resourceAdmissionId.value) {
      clearAutoStartTimer();
      return;
    }
    if (previewStoppedIntent.value) {
      clearAutoStartTimer();
      return;
    }
    const ready = autoStartReady(key, target);
    if (scheduledAutoStartKey === key && ready) {
      return;
    }
    clearAutoStartTimer();
    if (!ready) {
      return;
    }
    const cooldownMs = readLaunchAutoStartAttemptCooldown(key);
    if (cooldownMs > 0) {
      scheduleAutoStartCooldownCheck(cooldownMs);
      return;
    }

    const start = () => {
      autoStartTimer = 0;
      scheduledAutoStartKey = "";
      const currentTarget = autoStartTarget.value;
      if (previewStoppedIntent.value) return;
      const currentKey = `${launchScopeKey.value}:${currentTarget?.id || ""}`;
      if (!autoStartReady(currentKey, currentTarget)) {
        return;
      }
      const currentCooldownMs = readLaunchAutoStartAttemptCooldown(currentKey);
      if (currentCooldownMs > 0) {
        scheduleAutoStartCooldownCheck(currentCooldownMs);
        return;
      }
      void Promise.resolve(run(currentTarget, {
        applyDefaultDisplay: false,
        autoStartAttemptKey: currentKey
      })).then((started) => {
        if (started) {
          autoStartKey.value = currentKey;
          clearLaunchAutoStartAttempt(currentKey);
        }
      }).catch(() => null);
    };

    scheduledAutoStartKey = key;
    if (typeof window === "undefined" || AUTO_START_STABILITY_DELAY_MS <= 0) {
      start();
      return;
    }
    autoStartTimer = window.setTimeout(start, AUTO_START_STABILITY_DELAY_MS);
  }, {
    flush: "post",
    immediate: true
  });

  onBeforeUnmount(() => {
    clearAutoStartTimer();
    clearAutoStartCooldownTimer();
    clearLaunchStatusIdleRecoveryTimer();
  });

  return {
    launchStatusIdleRecoveryExhausted,
    resetAutoStart
  };
}

export {
  useVibe64OutputAutoStart
};
