const AUTOPILOT_QUESTIONS_ARTIFACT = "questions.json";
const AUTOPILOT_ISSUE_DRAFT_ARTIFACT = "issue-draft.json";
const AUTOPILOT_PROMPT_DONE_ARTIFACT = "prompt-done.json";
const AUTOPILOT_FILE_ARTIFACTS = Object.freeze([
  AUTOPILOT_QUESTIONS_ARTIFACT,
  AUTOPILOT_ISSUE_DRAFT_ARTIFACT,
  AUTOPILOT_PROMPT_DONE_ARTIFACT
]);
const AUTOPILOT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

function normalizeAutopilotText(value = "") {
  return String(value ?? "").trim();
}

function normalizeAutopilotRequestId(value = "") {
  const requestId = normalizeAutopilotText(value);
  return AUTOPILOT_REQUEST_ID_PATTERN.test(requestId) ? requestId : "";
}

function normalizeAutopilotQuestion(value = {}, index = 0) {
  const text = normalizeAutopilotText(typeof value === "string" ? value : value.text || value.question || "");
  if (!text) {
    return null;
  }
  return {
    answer: normalizeAutopilotText(typeof value === "string" ? "" : value.answer || ""),
    id: normalizeAutopilotText(typeof value === "string" ? "" : value.id) || `q${index + 1}`,
    text
  };
}

function normalizeAutopilotQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : [])
    .slice(0, 10)
    .map(normalizeAutopilotQuestion)
    .filter(Boolean);
}

function normalizeAutopilotQuestionsFile(value = {}) {
  const requestId = normalizeAutopilotRequestId(value?.requestId);
  const questions = normalizeAutopilotQuestions(value?.questions);
  if (!requestId || questions.length <= 0) {
    return null;
  }
  return {
    questions,
    requestId
  };
}

function normalizeAutopilotIssueDraftFile(value = {}) {
  const requestId = normalizeAutopilotRequestId(value?.requestId);
  const title = normalizeAutopilotText(value?.title);
  const body = normalizeAutopilotText(value?.body);
  if (!requestId || !title || !body) {
    return null;
  }
  return {
    body,
    requestId,
    title
  };
}

function normalizeAutopilotPromptDoneFile(value = {}) {
  const requestId = normalizeAutopilotRequestId(value?.requestId);
  const completionToken = normalizeAutopilotText(value?.completionToken);
  if (!requestId || !completionToken) {
    return null;
  }
  return {
    actionId: normalizeAutopilotText(value?.actionId),
    completionToken,
    requestId,
    stepId: normalizeAutopilotText(value?.stepId)
  };
}

function autopilotFilePath(artifactsRoot = "", artifactName = "") {
  const root = normalizeAutopilotText(artifactsRoot);
  const name = normalizeAutopilotText(artifactName);
  return root && name ? `${root}/${name}` : name;
}

function autopilotQuestionFileExample(requestId = "request-id") {
  return JSON.stringify({
    requestId,
    questions: [
      "What should Codex know before continuing this workflow action?"
    ]
  }, null, 2);
}

function autopilotIssueDraftFileExample(requestId = "request-id") {
  return JSON.stringify({
    requestId,
    title: "Concise issue title",
    body: "Markdown issue body"
  }, null, 2);
}

function autopilotPromptDoneFileExample({
  actionId = "action_id",
  completionToken = "completion-token",
  requestId = "request-id",
  stepId = "step_id"
} = {}) {
  return JSON.stringify({
    actionId,
    completionToken,
    requestId,
    stepId
  }, null, 2);
}

export {
  AUTOPILOT_FILE_ARTIFACTS,
  AUTOPILOT_ISSUE_DRAFT_ARTIFACT,
  AUTOPILOT_PROMPT_DONE_ARTIFACT,
  AUTOPILOT_QUESTIONS_ARTIFACT,
  autopilotFilePath,
  autopilotIssueDraftFileExample,
  autopilotPromptDoneFileExample,
  autopilotQuestionFileExample,
  normalizeAutopilotIssueDraftFile,
  normalizeAutopilotPromptDoneFile,
  normalizeAutopilotQuestions,
  normalizeAutopilotQuestionsFile,
  normalizeAutopilotRequestId
};
