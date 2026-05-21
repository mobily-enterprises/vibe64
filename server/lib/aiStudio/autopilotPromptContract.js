import {
  AUTOPILOT_PROMPT_DONE_ARTIFACT,
  AUTOPILOT_QUESTIONS_ARTIFACT,
  autopilotFilePath,
  autopilotPromptDoneFileExample,
  autopilotQuestionFileExample,
  normalizeAutopilotQuestions,
  normalizeAutopilotRequestId
} from "./autopilotFiles.js";

const AUTOPILOT_COMPLETION_TOKEN_PREFIX = "AI_STUDIO_AUTOPILOT_DONE_";
const AUTOPILOT_COMPLETION_TOKEN_PATTERN = /^AI_STUDIO_AUTOPILOT_DONE_[a-f0-9]{32}$/u;

function randomHexToken() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
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

function questionInstruction({
  artifactsRoot = "",
  requestId = ""
} = {}) {
  const questionsFile = autopilotFilePath(artifactsRoot, AUTOPILOT_QUESTIONS_ARTIFACT);
  return [
    "AI Studio question contract:",
    "Every time you ask the user any question, you must do both of these things in the same response:",
    "1. Ask the question in normal plain text so Inspect users can answer naturally.",
    `2. Write the same question set as JSON to: ${questionsFile}`,
    "This applies to every user question, not only Autopilot and not only blockers.",
    "Ask concise self-contained questions for a non-technical user.",
    "Ask the minimum useful number of questions, up to three, unless the user explicitly requested a different number.",
    "Do not write the done file when asking questions.",
    `Use this exact requestId in questions.json: ${String(requestId || "").trim()}`,
    autopilotQuestionFileExample("<requestId>")
  ].join("\n");
}

function completionInstruction({
  actionId = "",
  artifactsRoot = "",
  requestId = "",
  stepId = "",
  token = ""
} = {}) {
  const completionToken = normalizeStepCompletionToken(token);
  if (!completionToken) {
    return "";
  }
  const doneFile = autopilotFilePath(artifactsRoot, AUTOPILOT_PROMPT_DONE_ARTIFACT);
  return [
    "AI Studio prompt completion file contract:",
    "When this workflow action is fully complete, write this JSON to the done file.",
    "Write the done file only after all work, checks, and final reporting for this action are complete.",
    `Done file path: ${doneFile}`,
    autopilotPromptDoneFileExample({
      actionId,
      completionToken,
      requestId,
      stepId
    })
  ].join("\n");
}

function stepCompletionTokenInstruction({
  actionId = "",
  artifactsRoot = "",
  requestId = "",
  stepId = "",
  token = ""
} = {}) {
  return [
    completionInstruction({
      actionId,
      artifactsRoot,
      requestId,
      stepId,
      token
    }),
    "",
    questionInstruction({
      artifactsRoot,
      requestId
    })
  ].filter(Boolean).join("\n");
}

export {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX,
  createStepCompletionToken,
  normalizeAutopilotQuestions,
  normalizeAutopilotRequestId,
  normalizeStepCompletionToken,
  stepCompletionTokenInstruction
};
