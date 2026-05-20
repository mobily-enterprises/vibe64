import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";

const AUTOPILOT_COMPLETION_TOKEN_PREFIX = "AI_STUDIO_AUTOPILOT_DONE_";
const AUTOPILOT_COMPLETION_TOKEN_PATTERN = /^AI_STUDIO_AUTOPILOT_DONE_[a-f0-9]{32}$/u;
const AUTOPILOT_QUESTIONS_MARKER_START = "[[AI_STUDIO_AUTOPILOT_QUESTIONS_V1]]";
const AUTOPILOT_QUESTIONS_MARKER_END = "[[/AI_STUDIO_AUTOPILOT_QUESTIONS_V1]]";
const AUTOPILOT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

function randomHexToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
}

function createStepCompletionToken() {
  return `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}${randomHexToken()}`;
}

function normalizeStepCompletionToken(value = "") {
  const token = String(value || "").trim();
  return AUTOPILOT_COMPLETION_TOKEN_PATTERN.test(token) ? token : "";
}

function outputHasStepCompletionToken(output = "", token = "") {
  const expectedToken = normalizeStepCompletionToken(token);
  if (!expectedToken) {
    return false;
  }
  const source = String(output || "");
  if (source.includes(expectedToken)) {
    return true;
  }
  if (!source.includes(AUTOPILOT_COMPLETION_TOKEN_PREFIX)) {
    return false;
  }
  return stripTerminalControlSequences(source).includes(expectedToken);
}

function normalizeQuestion(value = "", index = 0) {
  const text = String(typeof value === "string" ? value : value?.question || value?.text || "").trim();
  if (!text) {
    return null;
  }
  return {
    answer: "",
    id: `q${index + 1}`,
    text
  };
}

function normalizeAutopilotQuestionsPayload(value = {}) {
  const requestId = String(value.requestId || "").trim();
  const questions = (Array.isArray(value.questions) ? value.questions : [])
    .map(normalizeQuestion)
    .filter(Boolean);
  if (!AUTOPILOT_REQUEST_ID_PATTERN.test(requestId) || questions.length <= 0) {
    return null;
  }
  return {
    questions,
    requestId
  };
}

function markerObjectText(blockText = "") {
  const source = String(blockText || "").trim();
  const objectStart = source.indexOf("{");
  const objectEnd = source.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    return source;
  }
  return source.slice(objectStart, objectEnd + 1);
}

function parseAutopilotQuestionsBlock(blockText = "") {
  try {
    return normalizeAutopilotQuestionsPayload(JSON.parse(markerObjectText(blockText)));
  } catch {
    return null;
  }
}

function autopilotQuestionMarkerSource(output = "") {
  const source = String(output || "");
  if (source.includes(AUTOPILOT_QUESTIONS_MARKER_START)) {
    return source;
  }
  if (!source.includes("AI_STUDIO_AUTOPILOT_QUESTIONS_V1")) {
    return "";
  }
  return stripTerminalControlSequences(source);
}

function latestAutopilotQuestionsMarker(output = "", {
  requestId = ""
} = {}) {
  const source = autopilotQuestionMarkerSource(output);
  const expectedRequestId = String(requestId || "").trim();
  let searchEnd = source.length;
  while (searchEnd > 0) {
    const start = source.lastIndexOf(AUTOPILOT_QUESTIONS_MARKER_START, searchEnd);
    if (start < 0) {
      return null;
    }

    const contentStart = start + AUTOPILOT_QUESTIONS_MARKER_START.length;
    const end = source.indexOf(AUTOPILOT_QUESTIONS_MARKER_END, contentStart);
    if (end >= 0) {
      const marker = parseAutopilotQuestionsBlock(source.slice(contentStart, end));
      if (marker && (!expectedRequestId || marker.requestId === expectedRequestId)) {
        return marker;
      }
    }
    searchEnd = start - 1;
  }
  return null;
}

function autopilotQuestionsMarkerExample(requestId = "request-id") {
  return [
    AUTOPILOT_QUESTIONS_MARKER_START,
    JSON.stringify({
      requestId,
      questions: [
        "What should Codex know before continuing this workflow action?"
      ]
    }, null, 2),
    AUTOPILOT_QUESTIONS_MARKER_END
  ].join("\n");
}

function questionInstruction(requestId = "") {
  return [
    "If this workflow action is blocked only because essential user input is missing, ask the user instead of giving up.",
    "Ask concise self-contained questions for a non-technical user.",
    "Ask the minimum useful number of questions, up to three.",
    "First write a short plain-text sentence and the numbered questions so Inspect users can read them naturally.",
    "Then append the same questions as this machine-readable block for Autopilot.",
    "Do not print the completion token when asking questions.",
    `Use this exact requestId in the JSON: ${String(requestId || "").trim()}`,
    autopilotQuestionsMarkerExample("<requestId>")
  ].join("\n");
}

function completionInstruction(token = "") {
  const completionToken = normalizeStepCompletionToken(token);
  if (!completionToken) {
    return "";
  }
  const tokenSuffix = completionToken.slice(AUTOPILOT_COMPLETION_TOKEN_PREFIX.length);
  return [
    "AI Studio Autopilot completion contract:",
    "When this workflow action is fully complete, print one final line containing the completion token.",
    "Do not print the completion token until all work, checks, and final reporting for this action are complete.",
    "Do not write any prose after the completion token.",
    "Build the completion token by joining these two parts with no spaces:",
    `Completion token part 1: ${AUTOPILOT_COMPLETION_TOKEN_PREFIX}`,
    `Completion token part 2: ${tokenSuffix}`
  ].join("\n");
}

function stepCompletionTokenInstruction({
  requestId = "",
  token = ""
} = {}) {
  return [
    completionInstruction(token),
    "",
    questionInstruction(requestId)
  ].filter(Boolean).join("\n");
}

function autopilotQuestionAnswersInstruction({
  actionLabel = "",
  completionToken = "",
  questions = [],
  requestId = ""
} = {}) {
  const answers = (Array.isArray(questions) ? questions : []).map((question, index) => {
    return [
      `Q${index + 1}: ${String(question.text || question.question || question || "").trim()}`,
      `A${index + 1}: ${String(question.answer || "").trim()}`
    ].join("\n");
  }).join("\n\n");

  return [
    "AI Studio Autopilot clarification answers:",
    String(actionLabel || "Current workflow action"),
    "",
    answers,
    "",
    "Continue the same workflow action using these answers.",
    "If these answers are still not enough, ask another question block.",
    "If the action is now fully complete, print the completion token.",
    "",
    stepCompletionTokenInstruction({
      requestId,
      token: completionToken
    })
  ].join("\n");
}

export {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX,
  AUTOPILOT_QUESTIONS_MARKER_END,
  AUTOPILOT_QUESTIONS_MARKER_START,
  createStepCompletionToken,
  latestAutopilotQuestionsMarker,
  normalizeStepCompletionToken,
  outputHasStepCompletionToken,
  autopilotQuestionAnswersInstruction,
  stepCompletionTokenInstruction
};
