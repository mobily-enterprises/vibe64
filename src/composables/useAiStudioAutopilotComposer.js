import { computed, ref, watch } from "vue";
import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForMessageInput
} from "@/lib/aiStudioNumberedQuestionSugar.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function controlHasInputFields(control = {}) {
  return Array.isArray(control.inputFields) && control.inputFields.length > 0;
}

function initialControlValues(control = {}) {
  return Object.fromEntries((Array.isArray(control.inputFields) ? control.inputFields : [])
    .map((field) => [field.name, String(field.value ?? "")]));
}

function latestAssistantMessage(conversationLog = {}) {
  const turns = Array.isArray(conversationLog?.turns) ? conversationLog.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = String(turns[index]?.assistant?.text || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function requiredFieldIsMissing(field = {}, values = {}) {
  return field.required !== false && !String(values[field.name] || "").trim();
}

function useAiStudioAutopilotComposer({
  conversationLog,
  controls,
  isControlDisabled = () => false,
  onOpenDiff = () => null,
  onRunControl = async () => false,
  primaryIntentId,
  running,
  session
} = {}) {
  const selectedControl = ref(null);
  const selectedControlValues = ref({});

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const currentControls = computed(() => {
    const value = readRefOrGetterValue(controls);
    return Array.isArray(value) ? value : [];
  });
  const currentConversationLog = computed(() => readRefOrGetterValue(conversationLog) || {});
  const currentPrimaryIntentId = computed(() => String(readRefOrGetterValue(primaryIntentId) || ""));
  const isRunning = computed(() => Boolean(readRefOrGetterValue(running)));

  const primaryScreenControl = computed(() => {
    if (!currentPrimaryIntentId.value) {
      return null;
    }
    return currentControls.value.find((control) => control.id === currentPrimaryIntentId.value) || null;
  });
  const screenControls = computed(() => {
    const selectedId = String(selectedControl.value?.id || "");
    return currentControls.value.filter((control) => control.id !== selectedId);
  });
  const selectedControlOriginalFields = computed(() => {
    return selectedControl.value && Array.isArray(selectedControl.value.inputFields)
      ? selectedControl.value.inputFields
      : [];
  });
  const selectedControlQuestionInput = computed(() => {
    return numberedQuestionSugarForMessageInput({
      fields: selectedControlOriginalFields.value,
      fieldName: "conversationRequest",
      intentId: selectedControl.value?.id,
      message: latestAssistantMessage(currentConversationLog.value),
      requiredIntentId: "talk_to_codex",
      requiredStepStatus: "waiting_for_input",
      stepStatus: currentSession.value?.stepMachine?.status
    });
  });
  const selectedControlFields = computed(() => {
    return selectedControlQuestionInput.value.questions.length
      ? numberedQuestionInputFields(selectedControlQuestionInput.value.questions)
      : selectedControlOriginalFields.value;
  });
  const selectedControlIsPrimary = computed(() => Boolean(
    selectedControl.value?.id &&
    selectedControl.value.id === currentPrimaryIntentId.value
  ));
  const canSubmitSelectedControl = computed(() => Boolean(
    selectedControl.value &&
    !isRunning.value &&
    !selectedControlFields.value.some((field) => requiredFieldIsMissing(field, selectedControlValues.value))
  ));

  function clearSelectedControl() {
    selectedControl.value = null;
    selectedControlValues.value = {};
  }

  function selectControl(control = {}) {
    selectedControl.value = control;
    selectedControlValues.value = initialControlValues(control);
  }

  async function activateControl(control = {}) {
    if (isControlDisabled(control)) {
      return false;
    }
    if (control.clientAction === "open_diff") {
      onOpenDiff(control);
      return true;
    }
    if (controlHasInputFields(control)) {
      selectControl(control);
      return true;
    }
    return onRunControl(control);
  }

  function updateSelectedControlValue(name = "", value = "") {
    selectedControlValues.value = {
      ...selectedControlValues.value,
      [String(name || "")]: String(value || "")
    };
  }

  function selectedControlSubmissionFields() {
    const questions = selectedControlQuestionInput.value.questions;
    if (!questions.length) {
      return selectedControlValues.value;
    }
    return numberedQuestionSubmissionFields(questions, selectedControlValues.value, "conversationRequest");
  }

  async function submitSelectedControl() {
    if (!canSubmitSelectedControl.value) {
      return false;
    }
    const control = selectedControl.value;
    const accepted = await onRunControl(control, {
      fields: selectedControlSubmissionFields()
    });
    if (!accepted) {
      return false;
    }
    if (control?.id && control.id === currentPrimaryIntentId.value) {
      selectControl(primaryScreenControl.value || control);
    } else {
      clearSelectedControl();
    }
    return true;
  }

  watch(primaryScreenControl, (control) => {
    if (!control || control.enabled !== true || !controlHasInputFields(control)) {
      return;
    }
    if (!selectedControl.value || selectedControl.value.id === currentPrimaryIntentId.value) {
      selectControl(control);
    }
  }, {
    flush: "post",
    immediate: true
  });

  watch(currentControls, (updatedControls) => {
    if (!selectedControl.value) {
      return;
    }
    const updatedControl = updatedControls.find((control) => control.id === selectedControl.value.id) || null;
    if (!updatedControl || !controlHasInputFields(updatedControl)) {
      clearSelectedControl();
      return;
    }
    selectedControl.value = updatedControl;
  }, {
    flush: "post"
  });

  return {
    activateControl,
    canSubmitSelectedControl,
    clearSelectedControl,
    screenControls,
    selectedControl,
    selectedControlFields,
    selectedControlIsPrimary,
    selectedControlOriginalFields,
    selectedControlQuestionInput,
    selectedControlSubmissionFields,
    selectedControlValues,
    submitSelectedControl,
    updateSelectedControlValue
  };
}

export {
  controlHasInputFields,
  initialControlValues,
  useAiStudioAutopilotComposer
};
