import {
  createStepCompletionToken,
  normalizeStepCompletionToken,
  stepCompletionTokenInstruction
} from "../../server/lib/aiStudio/autopilotPromptContract.js";

function autopilotQuestionAnswersPrompt({
  contextLabel = "",
  continuationLines = [],
  questions = []
} = {}) {
  const answers = (Array.isArray(questions) ? questions : []).map((question, index) => {
    return [
      `Q${index + 1}: ${String(question.text || question.question || question || "").trim()}`,
      `A${index + 1}: ${String(question.answer || "").trim()}`
    ].join("\n");
  }).join("\n\n");

  return [
    "AI Studio Autopilot clarification answers:",
    String(contextLabel || "Current Codex task"),
    "",
    answers,
    "",
    ...(Array.isArray(continuationLines) ? continuationLines : [continuationLines])
  ].join("\n");
}

function autopilotQuestionAnswersInstruction({
  actionId = "",
  actionLabel = "",
  artifactsRoot = "",
  completionToken = "",
  questions = [],
  requestId = "",
  stepId = ""
} = {}) {
  return autopilotQuestionAnswersPrompt({
    contextLabel: actionLabel || "Current workflow action",
    continuationLines: [
      "Continue the same workflow action using these answers.",
      "If you ask the user any more questions, ask them in normal text and write questions.json.",
      "If the action is now fully complete, write prompt-done.json.",
      "",
      stepCompletionTokenInstruction({
        actionId,
        artifactsRoot,
        requestId,
        stepId,
        token: completionToken
      })
    ],
    questions
  });
}

export {
  autopilotQuestionAnswersPrompt,
  autopilotQuestionAnswersInstruction,
  createStepCompletionToken,
  normalizeStepCompletionToken,
  stepCompletionTokenInstruction
};
