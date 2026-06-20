const UI_ANSWER_CHOICE_FIELD = "__ui_answer_choice";
const ANSWER_CHOICE_MIN_COUNT = 2;
const ANSWER_CHOICE_MAX_COUNT = 6;
const ANSWER_CHOICE_LABEL_MAX_LENGTH = 96;
const ANSWER_CHOICE_VALUE_MAX_LENGTH = 320;

function inactiveAnswerChoiceSugar() {
  return {
    choices: []
  };
}

function normalizedChoiceText(value = "") {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function isSingleTextareaMessageField(fields = [], fieldName = "response") {
  return fields.length === 1 &&
    fields[0]?.name === fieldName &&
    fields[0]?.kind === "textarea";
}

function optionalValueMatches(actual = "", expected = "") {
  return !expected || String(actual || "") === String(expected || "");
}

function canRenderAnswerChoiceSugar({
  fields = [],
  fieldName = "response",
  intentId = "",
  requiredIntentId = "",
  requiredStepStatus = "",
  stepStatus = ""
} = {}) {
  return Boolean(
    isSingleTextareaMessageField(fields, fieldName) &&
    optionalValueMatches(intentId, requiredIntentId) &&
    optionalValueMatches(stepStatus, requiredStepStatus)
  );
}

function answerChoiceHeadingLine(line = "") {
  return /^(possible answers|choices):$/iu.test(String(line || "").trim());
}

function answerChoiceLineText(line = "") {
  const match = String(line || "").trim().match(/^[-*]\s+(.+)$/u);
  return match ? normalizedChoiceText(match[1]) : "";
}

function answerChoiceFromLine(line = "") {
  const text = answerChoiceLineText(line);
  if (!text || text.length > ANSWER_CHOICE_VALUE_MAX_LENGTH) {
    return null;
  }

  const colonMatch = text.match(/^([^:]{1,96}):\s+(.+)$/u);
  if (colonMatch) {
    const label = normalizedChoiceText(colonMatch[1]);
    const value = normalizedChoiceText(colonMatch[2]);
    return label && value ? { label, value } : null;
  }

  const parentheticalMatch = text.match(/^(.{1,96}?)\s+\(([^()]+)\)$/u);
  if (parentheticalMatch) {
    const label = normalizedChoiceText(parentheticalMatch[1]);
    const value = normalizedChoiceText(parentheticalMatch[2]);
    return label && value ? { label, value } : null;
  }

  return {
    label: text,
    value: text
  };
}

function validAnswerChoice(choice = {}) {
  return Boolean(
    choice &&
    choice.label &&
    choice.value &&
    choice.label.length <= ANSWER_CHOICE_LABEL_MAX_LENGTH &&
    choice.value.length <= ANSWER_CHOICE_VALUE_MAX_LENGTH
  );
}

function parseAnswerChoicePrompt(value = "") {
  const lines = String(value || "").replace(/\r\n/gu, "\n").split("\n");
  if (lines.some((line) => /^\[(?:Q)?\d+\]\s+.+/iu.test(String(line || "").trim()))) {
    return inactiveAnswerChoiceSugar();
  }
  const headingIndex = lines.findIndex(answerChoiceHeadingLine);
  if (headingIndex < 0) {
    return inactiveAnswerChoiceSugar();
  }

  const choices = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!String(line || "").trim()) {
      continue;
    }
    const choice = answerChoiceFromLine(line);
    if (!choice) {
      return inactiveAnswerChoiceSugar();
    }
    choices.push(choice);
  }

  const uniqueValues = new Set(choices.map((choice) => choice.value));
  if (
    choices.length < ANSWER_CHOICE_MIN_COUNT ||
    choices.length > ANSWER_CHOICE_MAX_COUNT ||
    uniqueValues.size !== choices.length ||
    choices.some((choice) => !validAnswerChoice(choice))
  ) {
    return inactiveAnswerChoiceSugar();
  }

  return {
    choices
  };
}

function answerChoiceSugarForMessageInput({
  fields = [],
  fieldName = "response",
  intentId = "",
  message = "",
  requiredIntentId = "",
  requiredStepStatus = "",
  stepStatus = ""
} = {}) {
  if (!canRenderAnswerChoiceSugar({
    fields,
    fieldName,
    intentId,
    requiredIntentId,
    requiredStepStatus,
    stepStatus
  })) {
    return inactiveAnswerChoiceSugar();
  }
  return parseAnswerChoicePrompt(message);
}

function answerChoiceInputFields(choices = []) {
  return [
    {
      choices,
      kind: "answer_choices",
      name: UI_ANSWER_CHOICE_FIELD,
      required: false
    }
  ];
}

function answerChoiceSubmissionFields(choiceValue = "", fieldName = "response") {
  return {
    [fieldName]: normalizedChoiceText(choiceValue)
  };
}

export {
  UI_ANSWER_CHOICE_FIELD,
  answerChoiceInputFields,
  answerChoiceSubmissionFields,
  answerChoiceSugarForMessageInput,
  canRenderAnswerChoiceSugar,
  parseAnswerChoicePrompt
};
