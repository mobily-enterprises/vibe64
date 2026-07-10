import { computed, ref, watch } from "vue";
import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForMessageInput
} from "@/lib/vibe64NumberedQuestionSugar.js";
import {
  UI_ANSWER_CHOICE_FIELD,
  answerChoiceInputFields,
  answerChoiceSubmissionFields,
  answerChoiceSugarForMessageInput
} from "@/lib/vibe64AnswerChoiceSugar.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  controlHasClientAction
} from "@/lib/vibe64PresentationControls.js";
import {
  actionInputFieldsContainPrivateValues,
  publicActionInputValuesForFields
} from "@/lib/vibe64ActionInputModel.js";
import {
  attachmentFieldsFromOptions,
  controlHasInputFields,
  initialControlValues,
  numberedQuestionInputValuesForLogicalField,
  plainObject,
  selectedControlDraftText,
  selectedControlValuesForFields,
  selectedControlValuesMatchFields,
  withAttachmentDisplayNames,
  withAttachmentReferences
} from "@/composables/vibe64-session/composer/composerControlFields.js";
import {
  latestAssistantMessageAwaitingUserReply,
  latestSubmittedConversationText
} from "@/composables/vibe64-session/composer/composerConversation.js";

function controlCanOpenByDefault(control = {}) {
  return controlHasInputFields(control) &&
    control.autoOpen !== false &&
    String(control.style || "").trim() !== "secondary";
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

function selectedControlAnswerChoiceSugar(control = {}) {
  const input = control?.input;
  const answerChoiceSugar = input && typeof input === "object" && !Array.isArray(input)
    ? input.answerChoiceSugar
    : null;
  return answerChoiceSugar && typeof answerChoiceSugar === "object" && !Array.isArray(answerChoiceSugar)
    ? answerChoiceSugar
    : null;
}

function requiredFieldIsMissing(field = {}, values = {}) {
  return field.required !== false && !String(values[field.name] || "").trim();
}

function useVibe64AutopilotComposer({
  conversationLog,
  controls,
  controlsRefreshing = false,
  isControlDisabled = () => false,
  canSubmitWhileRunning = () => false,
  onDraftSubmissionRejected = () => null,
  onDraftSubmissionStart = () => null,
  onRunClientControl = () => false,
  onRunControl = async () => false,
  primaryIntentId,
  running
} = {}) {
  const selectedControl = ref(null);
  const selectedControlValues = ref({});
  const answerChoiceFreeTyping = ref(false);

  const currentControls = computed(() => {
    const value = readRefOrGetterValue(controls);
    return Array.isArray(value) ? value : [];
  });
  const currentConversationLog = computed(() => readRefOrGetterValue(conversationLog) || {});
  const currentPrimaryIntentId = computed(() => String(readRefOrGetterValue(primaryIntentId) || ""));
  const isRunning = computed(() => Boolean(readRefOrGetterValue(running)));
  const currentControlsRefreshing = computed(() => Boolean(readRefOrGetterValue(controlsRefreshing)));

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
    if (controlCanOpenByDefault(primaryScreenControl.value)) {
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
  const selectedControlUsesLatestAssistantAnswerChoices = computed(() => {
    const answerChoiceSugar = selectedControlAnswerChoiceSugar(selectedControl.value);
    return Boolean(
      answerChoiceSugar?.kind === "answer_choices" &&
      answerChoiceSugar.source === "latest_assistant_message"
    );
  });
  const latestAssistantReplyText = computed(() => latestAssistantMessageAwaitingUserReply(currentConversationLog.value));
  const selectedControlQuestionInput = computed(() => {
    const questionSugar = selectedControlQuestionSugar(selectedControl.value);
    if (!selectedControlUsesLatestAssistantQuestions.value) {
      return inactiveQuestionInput();
    }
    return numberedQuestionSugarForMessageInput({
      fields: selectedControlOriginalFields.value,
      fieldName: questionSugar.fieldName,
      intentId: selectedControl.value?.id,
      message: latestAssistantReplyText.value
    });
  });
  const selectedControlAnswerChoiceInput = computed(() => {
    const answerChoiceSugar = selectedControlAnswerChoiceSugar(selectedControl.value);
    if (
      answerChoiceFreeTyping.value ||
      selectedControlQuestionInput.value.questions.length ||
      !selectedControlUsesLatestAssistantAnswerChoices.value
    ) {
      return {
        choices: []
      };
    }
    return answerChoiceSugarForMessageInput({
      fields: selectedControlOriginalFields.value,
      fieldName: answerChoiceSugar.fieldName,
      intentId: selectedControl.value?.id,
      message: latestAssistantReplyText.value
    });
  });
  const selectedControlFields = computed(() => {
    if (selectedControlQuestionInput.value.questions.length) {
      return numberedQuestionInputFields(selectedControlQuestionInput.value.questions, {
        autocomplete: "off",
        density: "compact"
      });
    }
    if (selectedControlAnswerChoiceInput.value.choices.length) {
      return answerChoiceInputFields(selectedControlAnswerChoiceInput.value.choices);
    }
    return selectedControlOriginalFields.value;
  });
  const selectedControlDisplayValues = computed(() => {
    return publicActionInputValuesForFields(selectedControlFields.value, selectedControlValues.value);
  });
  const selectedControlIsPrimary = computed(() => Boolean(
    selectedControl.value?.id &&
    selectedControl.value.id === currentPrimaryIntentId.value &&
    controlCanOpenByDefault(selectedControl.value)
  ));
  const canSubmitSelectedControl = computed(() => Boolean(
    selectedControl.value &&
    (!isRunning.value || canSubmitWhileRunning(selectedControl.value)) &&
    !isControlDisabled(selectedControl.value) &&
    !selectedControlFields.value.some((field) => requiredFieldIsMissing(field, selectedControlValues.value))
  ));

  function clearSelectedControl() {
    selectedControl.value = null;
    selectedControlValues.value = {};
    answerChoiceFreeTyping.value = false;
    selectDefaultInputControl();
  }

  function selectControl(control = {}) {
    selectedControl.value = control;
    const questionInput = selectedControlQuestionSugar(control);
    const initialValues = initialControlValues(control);
    const fieldName = questionInput?.fieldName || "conversationRequest";
    selectedControlValues.value = questionInput?.kind === "numbered_questions" &&
      selectedControlQuestionInput.value.questions.length
      ? numberedQuestionInputValuesForLogicalField(initialValues[fieldName], selectedControlQuestionInput.value.questions)
      : initialValues;
    answerChoiceFreeTyping.value = false;
  }

  function selectDefaultInputControl() {
    if (selectedControl.value || !defaultInputControl.value) {
      return false;
    }
    selectControl(defaultInputControl.value);
    return true;
  }

  function selectControlForNextDraft(control = {}) {
    if (!controlCanOpenByDefault(control)) {
      clearSelectedControl();
      return;
    }
    selectControl(
      control?.id && control.id === currentPrimaryIntentId.value
        ? primaryScreenControl.value || control
        : control
    );
  }

  function restoreControlDraft(control = {}, values = {}) {
    selectedControl.value = control;
    selectedControlValues.value = selectedControlValuesForRenderedFields(plainObject(values));
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
    const normalizedName = String(name || "");
    const normalizedValue = String(value || "");
    const questionFieldName = selectedControlQuestionSugar(selectedControl.value)?.fieldName || "conversationRequest";
    if (selectedControlQuestionInput.value.questions.length && normalizedName === questionFieldName) {
      selectedControlValues.value = {
        ...selectedControlValues.value,
        ...numberedQuestionInputValuesForLogicalField(normalizedValue, selectedControlQuestionInput.value.questions)
      };
      return;
    }
    selectedControlValues.value = {
      ...selectedControlValues.value,
      [normalizedName]: normalizedValue
    };
  }

  function selectedControlValuesForRenderedFields(values = {}) {
    const sourceValues = plainObject(values);
    const questions = selectedControlQuestionInput.value.questions;
    const fieldName = selectedControlQuestionSugar(selectedControl.value)?.fieldName || "conversationRequest";
    if (
      questions.length &&
      Object.hasOwn(sourceValues, fieldName) &&
      !questions.some((question) => Object.hasOwn(sourceValues, question.name))
    ) {
      return numberedQuestionInputValuesForLogicalField(sourceValues[fieldName], questions);
    }
    return {
      ...sourceValues
    };
  }

  function selectedControlSubmissionFields() {
    const questions = selectedControlQuestionInput.value.questions;
    if (questions.length) {
      const fieldName = selectedControlQuestionSugar(selectedControl.value)?.fieldName || "conversationRequest";
      return numberedQuestionSubmissionFields(questions, selectedControlValues.value, fieldName);
    }
    const choices = selectedControlAnswerChoiceInput.value.choices;
    if (choices.length) {
      const fieldName = selectedControlAnswerChoiceSugar(selectedControl.value)?.fieldName || "conversationRequest";
      return answerChoiceSubmissionFields(selectedControlValues.value[UI_ANSWER_CHOICE_FIELD], fieldName);
    }
    return selectedControlValues.value;
  }

  function selectedControlSubmissionDisplayFields(submissionFields = selectedControlSubmissionFields()) {
    if (selectedControlQuestionInput.value.questions.length) {
      return submissionFields;
    }
    if (selectedControlAnswerChoiceInput.value.choices.length) {
      const fieldName = selectedControlAnswerChoiceSugar(selectedControl.value)?.fieldName || "conversationRequest";
      return answerChoiceSubmissionFields(submissionFields[fieldName], fieldName);
    }
    return publicActionInputValuesForFields(selectedControlFields.value, submissionFields);
  }

  async function submitSelectedAnswerChoice(choice = {}) {
    const value = String(choice?.value || "").trim();
    if (!value || !selectedControlAnswerChoiceInput.value.choices.some((candidate) => candidate.value === value)) {
      return false;
    }
    selectedControlValues.value = {
      ...selectedControlValues.value,
      [UI_ANSWER_CHOICE_FIELD]: value
    };
    return submitSelectedControl();
  }

  function useFreeTextForAnswerChoice() {
    if (!selectedControlAnswerChoiceInput.value.choices.length) {
      return false;
    }
    answerChoiceFreeTyping.value = true;
    selectedControlValues.value = selectedControlValuesForFields(
      selectedControl.value,
      selectedControlOriginalFields.value,
      {}
    );
    return true;
  }

  function syncSelectedControlWithCurrentControls() {
    if (!selectedControl.value) {
      selectDefaultInputControl();
      return;
    }
    if (currentControlsRefreshing.value && controlHasInputFields(selectedControl.value)) {
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
    const control = selectedControl.value;
    if (!control || !controlHasInputFields(control)) {
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
    if (controlCanOpenByDefault(control)) {
      selectControlForNextDraft(control);
    } else {
      clearSelectedControl();
    }
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
    const displaySubmissionFields = selectedControlSubmissionDisplayFields(submissionFields);
    const attachmentFields = attachmentFieldsFromOptions(normalizedOptions);
    const attachmentFieldCount = Object.values(attachmentFields)
      .filter((attachments) => Array.isArray(attachments) && attachments.length > 0)
      .length;
    const hasPrivateValues = actionInputFieldsContainPrivateValues(selectedControlFields.value, submissionFields);
    const fieldsWithAttachments = withAttachmentReferences(submissionFields, attachmentFields);
    const displayFieldsWithAttachments = withAttachmentDisplayNames(displaySubmissionFields, attachmentFields);
    const submissionOptions = {
      ...runOptions,
      fields: fieldsWithAttachments
    };
    if (attachmentFieldCount > 0 || hasPrivateValues) {
      submissionOptions.displayFields = displayFieldsWithAttachments;
    }
    const draftSubmissionOptions = {
      ...runOptions,
      ...(Object.keys(displayFieldsWithAttachments).length > 0 ? { displayFields: displayFieldsWithAttachments } : {}),
      fields: displayFieldsWithAttachments
    };
    const draftSubmission = typeof onDraftSubmissionStart === "function"
      ? onDraftSubmissionStart({
          control,
          fields: displayFieldsWithAttachments,
          options: draftSubmissionOptions,
          values: publicActionInputValuesForFields(selectedControlFields.value, previousValues)
        })
      : null;
    if (controlHasInputFields(control)) {
      selectControlForNextDraft(control);
    }
    let accepted = false;
    try {
      accepted = await onRunControl(control, {
        ...submissionOptions,
        composerSubmissionId: draftSubmission
      });
    } catch (error) {
      if (typeof onDraftSubmissionRejected === "function") {
        onDraftSubmissionRejected(draftSubmission, {
          control,
          error,
          fields: displayFieldsWithAttachments,
          options: draftSubmissionOptions,
          values: publicActionInputValuesForFields(selectedControlFields.value, previousValues)
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
          fields: displayFieldsWithAttachments,
          options: draftSubmissionOptions,
          values: publicActionInputValuesForFields(selectedControlFields.value, previousValues)
        });
      }
      if (!draftSubmission && controlHasInputFields(control)) {
        restoreControlDraft(control, previousValues);
      }
      return false;
    }
    if (controlHasInputFields(control)) {
      if (!controlCanOpenByDefault(control)) {
        clearSelectedControl();
      }
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
      selectDefaultInputControl();
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

  watch(currentControlsRefreshing, (refreshing) => {
    if (!refreshing) {
      syncSelectedControlWithCurrentControls();
    }
  }, {
    flush: "sync"
  });

  watch(selectedControlFields, () => {
    syncSelectedControlValuesWithCurrentFields();
  }, {
    flush: "sync"
  });

  watch(latestAssistantReplyText, () => {
    answerChoiceFreeTyping.value = false;
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
    selectedControlAnswerChoiceInput,
    selectedControlDisplayValues,
    selectedControlIsPrimary,
    selectedControlOriginalFields,
    selectedControlQuestionInput,
    selectedControlSubmissionFields,
    selectedControlUsesLatestAssistantQuestions,
    selectedControlUsesLatestAssistantAnswerChoices,
    selectedControlValues,
    restoreControlDraft,
    submitSelectedAnswerChoice,
    submitSelectedControl,
    useFreeTextForAnswerChoice,
    updateSelectedControlValue
  };
}

export {
  useVibe64AutopilotComposer
};
