import { computed, ref, watch } from "vue";
import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForMessageInput
} from "@/lib/vibe64NumberedQuestionSugar.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  controlHasClientAction
} from "@/lib/vibe64PresentationControls.js";
import {
  appendPromptAttachmentFileNames,
  appendPromptAttachmentReferences
} from "@/lib/vibe64PromptAttachments.js";

function controlHasInputFields(control = {}) {
  return Boolean(control && Array.isArray(control.inputFields) && control.inputFields.length > 0);
}

function controlCanOpenByDefault(control = {}) {
  return controlHasInputFields(control) && String(control.style || "").trim() !== "secondary";
}

function initialControlValues(control = {}) {
  return Object.fromEntries((Array.isArray(control.inputFields) ? control.inputFields : [])
    .map((field) => [field.name, String(field.value ?? "")]));
}

function conversationLogTurns(conversationLog = {}) {
  const turns = Array.isArray(conversationLog?.turns) ? conversationLog.turns : [];
  return turns.length
    ? turns
    : Array.isArray(conversationLog)
      ? conversationLog
      : [];
}

function assistantTurnText(turn = {}) {
  return normalizedComposerText(turn?.assistant?.text);
}

function conversationTurnMessages(turn = {}) {
  return Array.isArray(turn?.messages) ? turn.messages : [];
}

function conversationMessageText(message = {}) {
  return normalizedComposerText(message?.text);
}

function latestAssistantMessageAwaitingUserReply(conversationLog = {}) {
  const turns = conversationLogTurns(conversationLog);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const messages = conversationTurnMessages(turns[index]);
    if (messages.length) {
      for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex];
        const role = String(message?.role || "").trim();
        const text = conversationMessageText(message);
        if (!text) {
          continue;
        }
        if (role === "user") {
          return "";
        }
        if (role === "assistant") {
          return text;
        }
      }
      continue;
    }
    if (conversationTurnUserText(turns[index])) {
      return "";
    }
    const text = assistantTurnText(turns[index]);
    if (text) {
      return text;
    }
  }
  return "";
}

function inactiveQuestionInput() {
  return {
    intro: "",
    questions: []
  };
}

function selectedControlQuestionSugar(control = {}) {
  const input = control?.input;
  const questionSugar = input && typeof input === "object" && !Array.isArray(input)
    ? input.questionSugar
    : null;
  return questionSugar && typeof questionSugar === "object" && !Array.isArray(questionSugar)
    ? questionSugar
    : null;
}

function requiredFieldIsMissing(field = {}, values = {}) {
  return field.required !== false && !String(values[field.name] || "").trim();
}

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedComposerText(value = "") {
  return String(value || "").trim();
}

function conversationTurnUserText(turn = {}) {
  return normalizedComposerText(turn?.user?.text);
}

function latestSubmittedConversationText(conversationLog = {}) {
  const turns = conversationLogTurns(conversationLog);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = conversationTurnUserText(turns[index]);
    if (text) {
      return text;
    }
  }
  return "";
}

function selectedControlDraftText({
  fields = [],
  values = {}
} = {}) {
  const sourceValues = plainObject(values);
  const inputFields = Array.isArray(fields) ? fields : [];
  if (Object.hasOwn(sourceValues, "conversationRequest")) {
    return normalizedComposerText(sourceValues.conversationRequest);
  }
  if (inputFields.length === 1) {
    return normalizedComposerText(sourceValues[inputFields[0]?.name]);
  }
  return "";
}

function selectedControlValuesMatchFields(values = {}, fields = []) {
  const sourceValues = plainObject(values);
  const fieldNames = new Set((Array.isArray(fields) ? fields : [])
    .map((field) => String(field?.name || ""))
    .filter(Boolean));
  const valueNames = Object.keys(sourceValues);
  return (
    valueNames.every((name) => fieldNames.has(name)) &&
    [...fieldNames].every((name) => Object.hasOwn(sourceValues, name))
  );
}

function selectedControlValuesForFields(control = {}, fields = [], values = {}) {
  const sourceValues = plainObject(values);
  const initialValues = initialControlValues(control);
  return Object.fromEntries((Array.isArray(fields) ? fields : [])
    .map((field) => {
      const name = String(field?.name || "");
      return [name, String(sourceValues[name] ?? initialValues[name] ?? "")];
    })
    .filter(([name]) => Boolean(name)));
}

function attachmentFieldsFromOptions(options = {}) {
  return plainObject(options?.attachmentFields);
}

function withAttachmentReferences(fields = {}, attachmentFields = {}) {
  const nextFields = {
    ...plainObject(fields)
  };
  for (const [fieldName, attachments] of Object.entries(attachmentFields)) {
    if (!Array.isArray(attachments) || attachments.length < 1) {
      continue;
    }
    nextFields[fieldName] = appendPromptAttachmentReferences(nextFields[fieldName], attachments);
  }
  return nextFields;
}

function withAttachmentDisplayNames(fields = {}, attachmentFields = {}) {
  const nextFields = {
    ...plainObject(fields)
  };
  for (const [fieldName, attachments] of Object.entries(attachmentFields)) {
    if (!Array.isArray(attachments) || attachments.length < 1) {
      continue;
    }
    nextFields[fieldName] = appendPromptAttachmentFileNames(nextFields[fieldName], attachments);
  }
  return nextFields;
}

function useVibe64AutopilotComposer({
  conversationLog,
  controls,
  isControlDisabled = () => false,
  onDraftSubmissionRejected = () => null,
  onDraftSubmissionStart = () => null,
  onRunClientControl = () => false,
  onRunControl = async () => false,
  primaryIntentId,
  running
} = {}) {
  const selectedControl = ref(null);
  const selectedControlValues = ref({});

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
  const enabledInputControls = computed(() => {
    return currentControls.value.filter((control) => (
      control?.enabled === true &&
      controlCanOpenByDefault(control)
    ));
  });
  const defaultInputControl = computed(() => {
    if (controlHasInputFields(primaryScreenControl.value)) {
      return primaryScreenControl.value;
    }
    return enabledInputControls.value.length === 1
      ? enabledInputControls.value[0]
      : null;
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
  const selectedControlUsesLatestAssistantQuestions = computed(() => {
    const questionSugar = selectedControlQuestionSugar(selectedControl.value);
    return Boolean(
      questionSugar?.kind === "numbered_questions" &&
      questionSugar.source === "latest_assistant_message"
    );
  });
  const selectedControlQuestionInput = computed(() => {
    const questionSugar = selectedControlQuestionSugar(selectedControl.value);
    if (!selectedControlUsesLatestAssistantQuestions.value) {
      return inactiveQuestionInput();
    }
    return numberedQuestionSugarForMessageInput({
      fields: selectedControlOriginalFields.value,
      fieldName: questionSugar.fieldName,
      intentId: selectedControl.value?.id,
      message: latestAssistantMessageAwaitingUserReply(currentConversationLog.value)
    });
  });
  const selectedControlFields = computed(() => {
    return selectedControlQuestionInput.value.questions.length
      ? numberedQuestionInputFields(selectedControlQuestionInput.value.questions, {
          autocomplete: "off",
          density: "compact"
        })
      : selectedControlOriginalFields.value;
  });
  const selectedControlIsPrimary = computed(() => Boolean(
    selectedControl.value?.id &&
    selectedControl.value.id === currentPrimaryIntentId.value
  ));
  const canSubmitSelectedControl = computed(() => Boolean(
    selectedControl.value &&
    !isRunning.value &&
    !isControlDisabled(selectedControl.value) &&
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

  function selectControlForNextDraft(control = {}) {
    selectControl(
      control?.id && control.id === currentPrimaryIntentId.value
        ? primaryScreenControl.value || control
        : control
    );
  }

  function restoreControlDraft(control = {}, values = {}) {
    selectedControl.value = control;
    selectedControlValues.value = {
      ...plainObject(values)
    };
  }

  async function activateControl(control = {}) {
    if (isControlDisabled(control)) {
      return false;
    }
    if (controlHasClientAction(control)) {
      return await onRunClientControl(control) !== false;
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

  function syncSelectedControlWithCurrentControls() {
    if (!selectedControl.value) {
      return;
    }
    const updatedControl = currentControls.value.find((control) => control.id === selectedControl.value.id) || null;
    if (updatedControl && controlHasInputFields(updatedControl)) {
      selectedControl.value = updatedControl;
      return;
    }
    if (isRunning.value && controlHasInputFields(selectedControl.value)) {
      return;
    }
    clearSelectedControl();
  }

  function syncSelectedControlValuesWithCurrentFields() {
    if (!selectedControl.value || selectedControlValuesMatchFields(selectedControlValues.value, selectedControlFields.value)) {
      return;
    }
    selectedControlValues.value = selectedControlValuesForFields(
      selectedControl.value,
      selectedControlFields.value,
      selectedControlValues.value
    );
  }

  function clearConsumedConversationDraft() {
    if (!selectedControl.value || !controlHasInputFields(selectedControl.value)) {
      return false;
    }
    const draftText = selectedControlDraftText({
      fields: selectedControlFields.value,
      values: selectedControlSubmissionFields()
    });
    if (!draftText) {
      return false;
    }
    const submittedText = latestSubmittedConversationText(currentConversationLog.value);
    if (!submittedText || submittedText !== draftText) {
      return false;
    }
    selectControlForNextDraft(selectedControl.value);
    return true;
  }

  async function submitSelectedControl(options = {}) {
    if (!canSubmitSelectedControl.value) {
      return false;
    }
    const control = selectedControl.value;
    const previousValues = {
      ...selectedControlValues.value
    };
    const normalizedOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const {
      attachmentFields: _attachmentFields,
      ...runOptions
    } = normalizedOptions;
    const submissionFields = selectedControlSubmissionFields();
    const attachmentFields = attachmentFieldsFromOptions(normalizedOptions);
    const attachmentFieldCount = Object.values(attachmentFields)
      .filter((attachments) => Array.isArray(attachments) && attachments.length > 0)
      .length;
    const submissionOptions = {
      ...runOptions,
      fields: withAttachmentReferences(submissionFields, attachmentFields)
    };
    if (attachmentFieldCount > 0) {
      submissionOptions.displayFields = withAttachmentDisplayNames(submissionFields, attachmentFields);
    }
    const draftSubmission = typeof onDraftSubmissionStart === "function"
      ? onDraftSubmissionStart({
          control,
          fields: submissionOptions.fields,
          options: submissionOptions,
          values: previousValues
        })
      : null;
    if (controlHasInputFields(control)) {
      selectControlForNextDraft(control);
    }
    let accepted = false;
    try {
      accepted = await onRunControl(control, {
        ...submissionOptions
      });
    } catch (error) {
      if (typeof onDraftSubmissionRejected === "function") {
        onDraftSubmissionRejected(draftSubmission, {
          control,
          error,
          fields: submissionOptions.fields,
          options: submissionOptions,
          values: previousValues
        });
      }
      if (!draftSubmission && controlHasInputFields(control)) {
        restoreControlDraft(control, previousValues);
      }
      return false;
    }
    if (!accepted) {
      if (typeof onDraftSubmissionRejected === "function") {
        onDraftSubmissionRejected(draftSubmission, {
          control,
          fields: submissionOptions.fields,
          options: submissionOptions,
          values: previousValues
        });
      }
      if (!draftSubmission && controlHasInputFields(control)) {
        restoreControlDraft(control, previousValues);
      }
      return false;
    }
    if (controlHasInputFields(control)) {
      return true;
    }
    if (control?.id && control.id === currentPrimaryIntentId.value) {
      selectControl(primaryScreenControl.value || control);
    } else {
      clearSelectedControl();
    }
    return true;
  }

  watch(defaultInputControl, (control, previousControl) => {
    if (!control) {
      return;
    }
    const selectedId = String(selectedControl.value?.id || "");
    if (!selectedId) {
      selectControl(control);
      return;
    }
    if (selectedId === control.id) {
      return;
    }
    if (
      selectedId === previousControl?.id ||
      selectedId === currentPrimaryIntentId.value
    ) {
      selectControl(control);
    }
  }, {
    flush: "sync",
    immediate: true
  });

  watch(currentControls, () => {
    syncSelectedControlWithCurrentControls();
  }, {
    flush: "sync"
  });

  watch(selectedControlFields, () => {
    syncSelectedControlValuesWithCurrentFields();
  }, {
    flush: "sync"
  });

  watch(isRunning, () => {
    syncSelectedControlWithCurrentControls();
    if (isRunning.value) {
      clearConsumedConversationDraft();
    }
  }, {
    flush: "sync"
  });

  watch(() => latestSubmittedConversationText(currentConversationLog.value), () => {
    clearConsumedConversationDraft();
  }, {
    flush: "sync"
  });

  return {
    activateControl,
    canSubmitSelectedControl,
    clearConsumedConversationDraft,
    clearSelectedControl,
    screenControls,
    selectedControl,
    selectedControlFields,
    selectedControlIsPrimary,
    selectedControlOriginalFields,
    selectedControlQuestionInput,
    selectedControlSubmissionFields,
    selectedControlUsesLatestAssistantQuestions,
    selectedControlValues,
    restoreControlDraft,
    submitSelectedControl,
    updateSelectedControlValue
  };
}

export {
  controlHasInputFields,
  initialControlValues,
  latestAssistantMessageAwaitingUserReply,
  latestSubmittedConversationText,
  selectedControlDraftText,
  useVibe64AutopilotComposer
};
