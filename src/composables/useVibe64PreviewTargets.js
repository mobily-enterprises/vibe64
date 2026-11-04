import { computed } from "vue";
import {
  managedPreviewTarget,
  preferredPreviewTarget
} from "@local/studio-terminal-core/shared";

/**
 * The output targets the output controls offer: the embedded Preview's start
 * target (the requested one, else the managed or preferred web target), the
 * target its options and routes belong to, and whether Run and Start show.
 * @param {{
 *   outputs: import("@/types.js").Vibe64OutputControls,
 *   props: { autoStartManagedPreview?: boolean, autoStartTargetId?: string, embeddedPreview?: boolean }
 * }} options
 */
function useVibe64PreviewTargets({ outputs, props }) {
  const {
    activeOutputTarget,
    launchButtonsDisabled,
    loading,
    operationBusy,
    outputTargets,
    terminalVisible
  } = outputs;
  const runMenuDisabled = computed(() => Boolean(
    launchButtonsDisabled.value ||
    loading.value ||
    outputTargets.value.length < 1
  ));
  const requestedAutoStartTargetId = computed(() => String(props.autoStartTargetId || "").trim());
  const embeddedAutoStartTarget = computed(() => {
    if (!props.embeddedPreview || !requestedAutoStartTargetId.value) {
      return null;
    }
    return outputTargets.value.find((target) => (
      target.id === requestedAutoStartTargetId.value && target.presentation?.kind === "web"
    )) || null;
  });
  const embeddedStartTarget = computed(() => {
    if (!props.embeddedPreview) {
      return null;
    }
    return embeddedAutoStartTarget.value ||
      managedPreviewTarget(outputTargets.value) ||
      preferredPreviewTarget(outputTargets.value);
  });
  const outputSetupTarget = computed(() => (
    embeddedStartTarget.value ||
    outputTargets.value.find((target) => target.default) ||
    outputTargets.value[0] ||
    null
  ));
  const outputSetupUnavailableReason = computed(() => {
    const target = outputSetupTarget.value;
    return target?.available === false
      ? String(target.disabledReason || "Preview cannot start yet.").trim()
      : "";
  });
  const embeddedManualStartButtonVisible = computed(() => Boolean(
    props.embeddedPreview &&
    embeddedStartTarget.value &&
    embeddedStartTarget.value.available !== false &&
    !terminalVisible.value
  ));
  const embeddedManualStartButtonDisabled = computed(() => Boolean(
    operationBusy.value ||
    !embeddedStartTarget.value ||
    embeddedStartTarget.value.available === false
  ));
  const manualLaunchMenuVisible = computed(() => Boolean(
    !terminalVisible.value &&
    outputTargets.value.length > 0 &&
    !(
      props.embeddedPreview &&
      embeddedStartTarget.value &&
      (requestedAutoStartTargetId.value || props.autoStartManagedPreview)
    )
  ));
  const previewContextTarget = computed(() => (
    embeddedAutoStartTarget.value || activeOutputTarget.value || embeddedStartTarget.value || null
  ));
  const outputOptionsTarget = computed(() => activeOutputTarget.value || previewContextTarget.value);
  const outputOptionsAvailable = computed(() => Boolean(outputOptionsTarget.value?.parameters?.length));

  return {
    embeddedAutoStartTarget,
    embeddedManualStartButtonDisabled,
    embeddedManualStartButtonVisible,
    embeddedStartTarget,
    manualLaunchMenuVisible,
    outputOptionsAvailable,
    outputOptionsTarget,
    outputSetupUnavailableReason,
    previewContextTarget,
    runMenuDisabled
  };
}

export {
  useVibe64PreviewTargets
};
