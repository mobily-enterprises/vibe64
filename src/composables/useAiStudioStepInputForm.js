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

function isPlainResponseField(field = {}) {
  return field.name === "response" && field.kind === "textarea";
}

function numberedQuestionPrompt(value = "") {
  const lines = String(value || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      intro: "",
      questions: []
    };
  }

  const intro = [];
  const questions = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s+(.+)$/u);
    if (!match) {
      if (!questions.length) {
        intro.push(line);
        continue;
      }
      return {
        intro: "",
        questions: []
      };
    }
    const number = Number(match[1]);
    if (number !== questions.length + 1) {
      return {
        intro: "",
        questions: []
      };
    }
    questions.push({
      label: match[2].trim(),
      name: `question_${number}`,
      number
    });
  }

  if (!questions.every((question) => question.label) || questions.length < 2) {
    return {
      intro: "",
      questions: []
    };
  }
  return {
    intro: intro.join("\n"),
    questions
  };
}

function responseQuestionPrompt(interaction = {}, fields = []) {
  if (fields.length !== 1 || !isPlainResponseField(fields[0])) {
    return {
      intro: "",
      questions: []
    };
  }
  return numberedQuestionPrompt(interaction?.prompt);
}

function questionInputFields(questions = []) {
  return questions.map((question) => ({
    kind: "textarea",
    label: question.label,
    name: question.name,
    required: true,
    requiredMessage: `Answer question ${question.number}.`,
    rows: 3
  }));
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
  const originalFields = computed(() => interactionFields(interaction.value));
  const responseQuestionInput = computed(() => responseQuestionPrompt(interaction.value, originalFields.value));
  const responseQuestions = computed(() => responseQuestionInput.value.questions);
  const fields = computed(() => {
    return responseQuestions.value.length
      ? questionInputFields(responseQuestions.value)
      : originalFields.value;
  });
  const prompt = computed(() => {
    return responseQuestions.value.length
      ? responseQuestionInput.value.intro
      : String(interaction.value?.prompt || "");
  });
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

  function submissionFields() {
    if (!responseQuestions.value.length) {
      return values.value;
    }
    return {
      response: responseQuestions.value
        .map((question) => `[${question.number}] ${String(values.value[question.name] || "").trim()}`)
        .join("\n")
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
        fields: submissionFields(),
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
  useAiStudioStepInputForm
};
