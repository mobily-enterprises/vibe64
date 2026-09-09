import { answerChoiceFromLine } from "./vibe64AnswerChoiceSugar.js";

const UI_QUESTION_FIELD_PREFIX = "__ui_question_";

function inactiveNumberedQuestionSugar() {
  return {
    intro: "",
    outro: "",
    questions: []
  };
}

function isSingleTextareaMessageField(fields = [], fieldName = "response") {
  return fields.length === 1 &&
    fields[0]?.name === fieldName &&
    fields[0]?.kind === "textarea";
}

function optionalValueMatches(actual = "", expected = "") {
  return !expected || String(actual || "") === String(expected || "");
}

function canRenderNumberedQuestionSugar({
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

function numberedQuestionMarkerMatch(line = "") {
  return String(line || "").match(/^\[(?:Q)?(\d+)\]\s+(.+)$/iu);
}

function trailingAnswerChoiceHeadingLine(line = "") {
  return /^(possible answers|choices):$/iu.test(String(line || "").trim());
}

function trailingAnswerChoiceLine(line = "") {
  return /^[-*]\s+.+/u.test(String(line || "").trim());
}

function numberedQuestionLabelLooksLikeQuestion(label = "") {
  return /\?(?:[*_`”"'’)\]]*)(?:\s|$)/u.test(String(label || "").trim());
}

function validNumberedQuestions(questions = []) {
  return questions.every((question) => (
    question.choices.length > 0 || numberedQuestionLabelLooksLikeQuestion(question.label)
  ));
}

function numberedQuestionChoice(line = "") {
  const choice = answerChoiceFromLine(line);
  if (!choice) {
    return null;
  }
  const label = String(choice.label || "").trim();
  const selectLabel = label.split(/(?:\s*[—–]\s*|\s+-\s+)/u, 1)[0].trim() || label;
  return {
    ...choice,
    recommended: choice.recommended === true,
    selectLabel
  };
}

function trailingAnswerChoiceBlock(lines = [], startIndex = 0) {
  if (!trailingAnswerChoiceHeadingLine(lines[startIndex])) {
    return null;
  }
  const choices = [];
  let nextIndex = startIndex + 1;
  while (nextIndex < lines.length && trailingAnswerChoiceLine(lines[nextIndex])) {
    const choice = numberedQuestionChoice(lines[nextIndex]);
    if (!choice) {
      return null;
    }
    choices.push(choice);
    nextIndex += 1;
  }
  const uniqueValues = new Set(choices.map((choice) => choice.value));
  if (choices.length < 2 || choices.length > 6 || uniqueValues.size !== choices.length) {
    return null;
  }
  return {
    choices,
    nextIndex
  };
}

function questionForMarkerMatch(match = [], index = 0) {
  const numberText = String(match[1] || "");
  const number = Number(numberText);
  const label = String(match[2] || "").trim();
  if (
    !Number.isSafeInteger(number) ||
    number !== index + 1 ||
    String(number) !== numberText ||
    !label
  ) {
    return null;
  }
  return {
    choices: [],
    label,
    name: `${UI_QUESTION_FIELD_PREFIX}${number}`,
    number
  };
}

function parseLineNumberedQuestionPrompt(value = "") {
  const lines = String(value || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return inactiveNumberedQuestionSugar();
  }

  const intro = [];
  const outro = [];
  const questions = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const match = numberedQuestionMarkerMatch(line);
    if (!match) {
      if (!questions.length) {
        intro.push(line);
        index += 1;
        continue;
      }
      const choiceBlock = trailingAnswerChoiceBlock(lines, index);
      if (choiceBlock) {
        const question = questions.at(-1);
        if (question.choices.length) {
          return inactiveNumberedQuestionSugar();
        }
        question.choices = choiceBlock.choices;
        index = choiceBlock.nextIndex;
        continue;
      }
      const trailingLines = lines.slice(index);
      if (
        trailingLines.some((trailingLine) => trailingAnswerChoiceHeadingLine(trailingLine)) ||
        trailingLines.some((trailingLine) => numberedQuestionMarkerMatch(trailingLine))
      ) {
        return inactiveNumberedQuestionSugar();
      }
      outro.push(...trailingLines);
      break;
    }

    const question = questionForMarkerMatch(match, questions.length);
    if (!question) {
      return inactiveNumberedQuestionSugar();
    }
    questions.push(question);
    index += 1;
  }

  if (!questions.length || !validNumberedQuestions(questions)) {
    return inactiveNumberedQuestionSugar();
  }
  return {
    intro: intro.join("\n"),
    outro: outro.join("\n"),
    questions
  };
}

function parseInlineNumberedQuestionPrompt(value = "") {
  const source = String(value || "").replace(/\r\n/gu, "\n").trim();
  const firstMarker = source.search(/\[(?:Q)?\d+\]\s+/iu);
  if (firstMarker < 0) {
    return inactiveNumberedQuestionSugar();
  }

  const intro = source.slice(0, firstMarker).trim();
  const questionText = source.slice(firstMarker).trim();
  if (!questionText || questionText.includes("\n")) {
    return inactiveNumberedQuestionSugar();
  }

  const markerPattern = /\[(?:Q)?(\d+)\]\s+/giu;
  const markers = [...questionText.matchAll(markerPattern)];
  if (markers.length < 2 || markers[0].index !== 0) {
    return inactiveNumberedQuestionSugar();
  }

  const questions = [];
  for (const [index, match] of markers.entries()) {
    const labelStart = match.index + match[0].length;
    const nextMarker = markers[index + 1];
    const labelEnd = nextMarker ? nextMarker.index : questionText.length;
    const question = questionForMarkerMatch([
      match[0],
      match[1],
      questionText.slice(labelStart, labelEnd)
    ], questions.length);
    if (!question) {
      return inactiveNumberedQuestionSugar();
    }
    questions.push(question);
  }

  if (!validNumberedQuestions(questions)) {
    return inactiveNumberedQuestionSugar();
  }
  return {
    intro,
    outro: "",
    questions
  };
}

function parseNumberedQuestionPrompt(value = "") {
  const inlineQuestions = parseInlineNumberedQuestionPrompt(value);
  return inlineQuestions.questions.length
    ? inlineQuestions
    : parseLineNumberedQuestionPrompt(value);
}

function numberedQuestionSugarForInput(interaction = {}, fields = []) {
  return numberedQuestionSugarForMessageInput({
    fields,
    fieldName: "response",
    message: interaction?.prompt
  });
}

function numberedQuestionSugarForMessageInput({
  fields = [],
  fieldName = "response",
  intentId = "",
  message = "",
  requiredIntentId = "",
  requiredStepStatus = "",
  stepStatus = ""
} = {}) {
  if (!canRenderNumberedQuestionSugar({
    fields,
    fieldName,
    intentId,
    requiredIntentId,
    requiredStepStatus,
    stepStatus
  })) {
    return inactiveNumberedQuestionSugar();
  }
  return parseNumberedQuestionPrompt(message);
}

function numberedQuestionInputFields(questions = [], options = {}) {
  const autocomplete = String(options?.autocomplete || "").trim();
  const density = String(options?.density || "").trim();
  return questions.map((question) => ({
    ...(autocomplete ? { autocomplete } : {}),
    ...(density ? { density } : {}),
    kind: "text",
    label: question.label,
    name: question.name,
    required: true,
    requiredMessage: `Answer question ${question.number}.`
  }));
}

function numberedQuestionSubmissionText(questions = [], values = {}) {
  return questions
    .map((question) => `[${question.number}] ${String(values[question.name] || "").trim()}`)
    .join("\n");
}

function numberedQuestionSubmissionFields(questions = [], values = {}, fieldName = "response") {
  return {
    [fieldName]: numberedQuestionSubmissionText(questions, values)
  };
}

export {
  canRenderNumberedQuestionSugar,
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSubmissionText,
  numberedQuestionSugarForMessageInput,
  numberedQuestionSugarForInput,
  parseNumberedQuestionPrompt,
  UI_QUESTION_FIELD_PREFIX
};
