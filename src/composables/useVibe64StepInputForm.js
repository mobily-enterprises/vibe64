import { computed, ref, watch } from "vue";
import {
  submitVibe64CurrentStepInput
} from "@/lib/vibe64SessionApi.js";
import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForInput
} from "@/lib/vibe64NumberedQuestionSugar.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function interactionForSession(session = {}) {
  const screenInput = session?.presentation?.screen?.input;
  if (screenInput && typeof screenInput === "object" && !Array.isArray(screenInput)) {
    return screenInput;
  }
  return null;
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

function useVibe64StepInputForm({
  onSaved = async () => null,
  submitCurrentStepInput = submitVibe64CurrentStepInput,
  session
} = {}) {
  const values = ref({});
  const error = ref("");
  const saving = ref(false);

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || ""));
  const interaction = computed(() => interactionForSession(currentSession.value));
  const originalFields = computed(() => interactionFields(interaction.value));
  const responseQuestionInput = computed(() => numberedQuestionSugarForInput(interaction.value, originalFields.value));
  const responseQuestions = computed(() => responseQuestionInput.value.questions);
  const fields = computed(() => {
    return responseQuestions.value.length
      ? numberedQuestionInputFields(responseQuestions.value)
      : originalFields.value;
  });
  const prompt = computed(() => {
    return responseQuestions.value.length
      ? responseQuestionInput.value.intro
      : String(interaction.value?.prompt || "");
  });
  const directSubmit = computed(() => interaction.value?.submitTarget === "current-step-input");
  const visible = computed(() => directSubmit.value && fields.value.length > 0);
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

  function submissionFields() {
    if (!responseQuestions.value.length) {
      return values.value;
    }
    return numberedQuestionSubmissionFields(responseQuestions.value, values.value);
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
        fields: submissionFields(),
        kind: interaction.value?.submitKind || "ready",
        source: "ui",
        stepId: currentSession.value?.currentStep || "",
        stepStatus: currentSession.value?.stepMachine?.status || ""
      });
      if (response?.ok === false) {
        if (response.errors?.[0]?.code === "vibe64_step_input_state_changed") {
          await onSaved(response);
        }
        throw new Error(response.error || response.errors?.[0]?.message || "Step input could not be saved.");
      }
      await onSaved(response);
      return true;
    } catch (caught) {
      if (caught?.code === "vibe64_step_input_state_changed") {
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
    currentSession.value?.stepMachine?.status || "",
    interaction.value?.prompt || ""
  ].join(":"), resetValues, {
    immediate: true
  });

  return {
    canSubmit,
    error,
    fields,
    interaction,
    prompt,
    saving,
    submit,
    updateValue,
    values,
    visible
  };
}

export {
  useVibe64StepInputForm
};
