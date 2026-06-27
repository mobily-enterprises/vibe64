import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  isVibe64StaleOperation,
  vibe64StaleOperationResult
} from "@/lib/vibe64StaleOperation.js";

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

function editableInteractionFields(fields = []) {
  return fields.filter((field) => field?.displayOnly !== true);
}

function displayOnlyInteractionFields(fields = []) {
  return fields.filter((field) => field?.displayOnly === true);
}

function initialValues(fields = []) {
  return Object.fromEntries(fields.map((field) => [field.name, String(field.value ?? "")]));
}

function requiredFieldIsMissing(field = {}, values = {}) {
  return field.required !== false && !String(values[field.name] || "").trim();
}

function useVibe64StepInputForm({
  onSaved = async () => null,
  sessionsApiPath = () => "",
  submitCurrentStepInput = null,
  session
} = {}) {
  const customSubmitCurrentStepInput = typeof submitCurrentStepInput === "function"
    ? submitCurrentStepInput
    : null;
  const submitCurrentStepInputCommand = customSubmitCurrentStepInput
    ? null
    : useCommand({
        access: "never",
        apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
        buildCommandOptions: (_payload, { context }) => {
          const basePath = String(context?.sessionsApiPath || "").trim();
          if (!basePath) {
            throw new Error("Session API path is unavailable.");
          }
          return {
            method: "POST",
            path: vibe64SessionPath(basePath, context?.sessionId, "/current-step/input")
          };
        },
        buildRawPayload: (_model, { context }) => {
          const payload = context?.input && typeof context.input === "object" && !Array.isArray(context.input)
            ? context.input
            : {};
          return {
            ...payload,
            kind: payload.kind || "ready"
          };
        },
        fallbackRunError: "Step input could not be saved.",
        messages: {
          error: "Step input could not be saved."
        },
        onRunError: async (error) => {
          if (isVibe64StaleOperation(error)) {
            throw vibe64StaleOperationResult(error);
          }
        },
        ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
        placementSource: "vibe64.sessions.current-step-input",
        suppressSuccessMessage: true,
        surfaceId: VIBE64_SURFACE_ID,
        writeMethod: "POST"
      });
  const values = ref({});
  const error = ref("");
  const saving = ref(false);

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || ""));
  const interaction = computed(() => interactionForSession(currentSession.value));
  const originalFields = computed(() => interactionFields(interaction.value));
  const editableFields = computed(() => editableInteractionFields(originalFields.value));
  const displayFields = computed(() => displayOnlyInteractionFields(originalFields.value));
  const fields = computed(() => editableFields.value);
  const prompt = computed(() => String(interaction.value?.prompt || ""));
  const directSubmit = computed(() => interaction.value?.submitTarget === "current-step-input");
  const visible = computed(() => directSubmit.value && (fields.value.length > 0 || displayFields.value.length > 0));
  const canSubmit = computed(() => visible.value &&
    !saving.value &&
    !fields.value.some((field) => requiredFieldIsMissing(field, values.value)));

  function resetValues() {
    values.value = initialValues(originalFields.value);
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
      const input = {
        fields: values.value,
        kind: interaction.value?.submitKind || "ready",
        source: "ui",
        stepId: currentSession.value?.currentStep || "",
        stepStatus: currentSession.value?.stepMachine?.status || ""
      };
      const response = await runSubmitCurrentStepInput(input);
      if (response?.ok === false) {
        if (isVibe64StaleOperation(response)) {
          await onSaved(vibe64StaleOperationResult(response));
          return false;
        }
        throw new Error(response.error || response.errors?.[0]?.message || "Step input could not be saved.");
      }
      await onSaved(response);
      return true;
    } catch (caught) {
      if (isVibe64StaleOperation(caught)) {
        await onSaved(vibe64StaleOperationResult(caught));
        return false;
      }
      error.value = String(caught?.message || caught || "Step input could not be saved.");
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function runSubmitCurrentStepInput(input = {}) {
    if (customSubmitCurrentStepInput) {
      return customSubmitCurrentStepInput(sessionId.value, input);
    }
    return submitCurrentStepInputCommand.run({
      input,
      sessionId: sessionId.value,
      sessionsApiPath: readRefOrGetterValue(sessionsApiPath)
    });
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
    displayFields,
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
