import { computed, ref, watch } from "vue";

/**
 * Preview options: the dialog that sets an output target's parameters before
 * it runs, or restarts it with them. Values are checked on submit, and can be
 * remembered for the target. The dialog closes when the project, session or
 * declared targets change.
 * @param {{
 *   outputs: import("@/types.js").Vibe64OutputControls,
 *   projectSlug: import("vue").Ref<string>,
 *   props: { session?: object | null },
 *   targets: import("@/types.js").Vibe64PreviewTargets
 * }} options
 */
function useVibe64OutputOptions({ outputs, projectSlug, props, targets }) {
  const {
    launchError,
    operationBusy,
    outputTargets,
    parametersForTarget,
    parametersRemembered,
    rememberParameters,
    run,
    terminalIsRunning
  } = outputs;
  const { outputOptionsTarget } = targets;
  const outputOptionsVisible = ref(false);
  const outputOptionsSelection = ref(null);
  const outputOptionsValues = ref({});
  const outputOptionsRemember = ref(false);
  const outputOptionsSubmitted = ref(false);
  const outputOptionsError = ref("");
  const outputOptionsErrors = computed(() => Object.fromEntries(
    (outputOptionsSelection.value?.parameters || []).map((parameter) => {
      const value = outputOptionsValues.value[parameter.id] || "";
      const error = parameter.required && !value.trim()
        ? `${parameter.label} is required.`
        : value.length > 4096 || /[\0\r\n]/u.test(value)
          ? "Enter one line of text, at most 4096 characters."
          : "";
      return [parameter.id, outputOptionsSubmitted.value ? error : ""];
    })
  ));
  const outputOptionsAction = ref("Run");

  function openOutputOptions(target = outputOptionsTarget.value) {
    if (!target?.parameters?.length || operationBusy.value) return;
    outputOptionsAction.value = terminalIsRunning.value ? "Save and restart" : "Run";
    outputOptionsSelection.value = target;
    outputOptionsValues.value = parametersForTarget(target);
    outputOptionsRemember.value = parametersRemembered(target);
    outputOptionsSubmitted.value = false;
    outputOptionsError.value = "";
    outputOptionsVisible.value = true;
  }

  function resetOutputOptions() {
    outputOptionsValues.value = Object.fromEntries(outputOptionsSelection.value.parameters.map(
      (parameter) => [parameter.id, parameter.default]
    ));
  }

  async function submitOutputOptions() {
    if (operationBusy.value) return;
    outputOptionsSubmitted.value = true;
    if (Object.values(outputOptionsErrors.value).some(Boolean)) return;
    const target = outputOptionsSelection.value;
    const values = { ...outputOptionsValues.value };
    const remember = outputOptionsRemember.value;
    outputOptionsError.value = "";
    const started = await run(target, { forceRestart: terminalIsRunning.value, outputParameters: values });
    if (outputOptionsSelection.value !== target || !outputOptionsVisible.value) return;
    if (started) {
      rememberParameters(target, values, remember);
      outputOptionsVisible.value = false;
    } else {
      outputOptionsError.value = launchError.value || "The target could not be started. Try again.";
    }
  }

  function runWithOptions(target) {
    return target.parameters?.length ? openOutputOptions(target) : run(target);
  }

  watch(() => JSON.stringify([
    projectSlug.value, props.session?.sessionId,
    outputTargets.value.map(({ id, parameters }) => [id, parameters])
  ]), () => {
    outputOptionsVisible.value = false;
    outputOptionsSelection.value = null;
  });

  return {
    openOutputOptions,
    outputOptionsAction,
    outputOptionsError,
    outputOptionsErrors,
    outputOptionsRemember,
    outputOptionsSelection,
    outputOptionsValues,
    outputOptionsVisible,
    resetOutputOptions,
    runWithOptions,
    submitOutputOptions
  };
}

export {
  useVibe64OutputOptions
};
