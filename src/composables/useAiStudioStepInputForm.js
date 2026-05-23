import { computed, ref, watch } from "vue";
import {
  submitAiStudioCurrentStepInput
} from "@/lib/aiStudioSessionApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function interactionForSession(session = {}) {
  const interaction = session?.currentStepDefinition?.interaction;
  return interaction && typeof interaction === "object" && !Array.isArray(interaction)
    ? interaction
    : null;
}

function interactionFields(interaction = {}) {
  return Array.isArray(interaction?.fields) ? interaction.fields : [];
}

function initialValues(fields = []) {
  return Object.fromEntries(fields.map((field) => [field.name, String(field.value ?? "")]));
}

function requiredFieldIsMissing(field = {}, values = {}) {
  return field.required !== false && !String(values[field.name] || "").trim();
}

function useAiStudioStepInputForm({
  onSaved = async () => null,
  submitCurrentStepInput = submitAiStudioCurrentStepInput,
  session
} = {}) {
  const values = ref({});
  const error = ref("");
  const saving = ref(false);

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || ""));
  const interaction = computed(() => interactionForSession(currentSession.value));
  const fields = computed(() => interactionFields(interaction.value));
  const visible = computed(() => fields.value.length > 0);
  const canSubmit = computed(() => visible.value &&
    !saving.value &&
    !fields.value.some((field) => requiredFieldIsMissing(field, values.value)));

  function resetValues() {
    values.value = initialValues(fields.value);
    error.value = "";
  }

  function updateValue(name = "", value = "") {
    values.value = {
      ...values.value,
      [String(name || "")]: String(value || "")
    };
  }

  async function submit() {
    if (!visible.value || saving.value) {
      return false;
    }
    const missingField = fields.value.find((field) => requiredFieldIsMissing(field, values.value));
    if (missingField) {
      error.value = missingField.requiredMessage || `${missingField.label || missingField.name} is required.`;
      return false;
    }

    saving.value = true;
    error.value = "";
    try {
      const response = await submitCurrentStepInput(sessionId.value, {
        fields: values.value,
        kind: interaction.value?.submitKind || "ready",
        source: "ui",
        stepId: currentSession.value?.currentStep || "",
        stepStatus: currentSession.value?.stepMachine?.status || ""
      });
      if (response?.ok === false) {
        if (response.errors?.[0]?.code === "ai_studio_step_input_state_changed") {
          await onSaved(response);
        }
        throw new Error(response.error || response.errors?.[0]?.message || "Step input could not be saved.");
      }
      await onSaved(response);
      return true;
    } catch (caught) {
      if (caught?.code === "ai_studio_step_input_state_changed") {
        await onSaved({
          ok: false
        });
      }
      error.value = String(caught?.message || caught || "Step input could not be saved.");
      return false;
    } finally {
      saving.value = false;
    }
  }

  watch(() => [
    sessionId.value,
    currentSession.value?.currentStep || "",
    currentSession.value?.stepMachine?.status || ""
  ].join(":"), resetValues, {
    immediate: true
  });

  return {
    canSubmit,
    error,
    fields,
    interaction,
    saving,
    submit,
    updateValue,
    values,
    visible
  };
}

export {
  useAiStudioStepInputForm
};
