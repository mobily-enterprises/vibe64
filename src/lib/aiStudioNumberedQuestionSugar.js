const UI_QUESTION_FIELD_PREFIX = "__ui_question_";

function inactiveNumberedQuestionSugar() {
  return {
    intro: "",
    questions: []
  };
}

function isPlainResponseField(field = {}) {
  return field.name === "response" && field.kind === "textarea";
}

function numberedQuestionMarkerMatch(line = "") {
  return String(line || "").match(/^\[(?:Q)?(\d+)\]\s+(.+)$/iu);
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
  if (lines.length < 2) {
    return inactiveNumberedQuestionSugar();
  }

  const intro = [];
  const questions = [];
  for (const line of lines) {
    const match = numberedQuestionMarkerMatch(line);
    if (!match) {
      if (!questions.length) {
        intro.push(line);
        continue;
      }
      return inactiveNumberedQuestionSugar();
    }

    const question = questionForMarkerMatch(match, questions.length);
    if (!question) {
      return inactiveNumberedQuestionSugar();
    }
    questions.push(question);
  }

  if (questions.length < 2) {
    return inactiveNumberedQuestionSugar();
  }
  return {
    intro: intro.join("\n"),
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

  return {
    intro,
    questions
  };
}

function parseNumberedQuestionPrompt(value = "") {
  const lineQuestions = parseLineNumberedQuestionPrompt(value);
  return lineQuestions.questions.length
    ? lineQuestions
    : parseInlineNumberedQuestionPrompt(value);
}

function numberedQuestionSugarForInput(interaction = {}, fields = []) {
  if (fields.length !== 1 || !isPlainResponseField(fields[0])) {
    return inactiveNumberedQuestionSugar();
  }
  return parseNumberedQuestionPrompt(interaction?.prompt);
}

function numberedQuestionInputFields(questions = []) {
  return questions.map((question) => ({
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
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSubmissionText,
  numberedQuestionSugarForInput,
  parseNumberedQuestionPrompt,
  UI_QUESTION_FIELD_PREFIX
};
