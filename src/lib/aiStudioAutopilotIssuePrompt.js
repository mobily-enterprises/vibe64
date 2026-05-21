import {
  autopilotQuestionAnswersPrompt
} from "@/lib/aiStudioAutopilotPromptFiles.js";
import {
  wrapPromptWithStudioContext
} from "@/lib/codexOutput.js";
import {
  AUTOPILOT_ISSUE_DRAFT_ARTIFACT,
  AUTOPILOT_QUESTIONS_ARTIFACT,
  autopilotFilePath,
  autopilotIssueDraftFileExample,
  autopilotQuestionFileExample
} from "../../server/lib/aiStudio/autopilotFiles.js";

function visibleIssueDraftPrompt() {
  return "Write questions.json or issue-draft.json.";
}

function issueDraftPromptHeader({
  artifactsRoot = "",
  requestId = ""
} = {}) {
  const questionsFile = autopilotFilePath(artifactsRoot, AUTOPILOT_QUESTIONS_ARTIFACT);
  const issueDraftFile = autopilotFilePath(artifactsRoot, AUTOPILOT_ISSUE_DRAFT_ARTIFACT);
  return [
    "AI Studio is defining the issue scope.",
    "Do not modify files.",
    "Only write the specific AI Studio JSON file requested below.",
    "First decide whether the request is clear enough to create a useful issue.",
    "Every time you ask the user any question, you must do both of these things in the same response:",
    "1. Ask the question in normal plain text so Inspect users can answer naturally.",
    `2. Write the same question set as JSON to: ${questionsFile}`,
    "This applies to every user question, not only Autopilot and not only blockers.",
    "If essential scope details are missing, ask concise self-contained questions for a non-technical user.",
    "Only ask questions whose answers would change the issue scope, acceptance criteria, or implementation direction.",
    "If clarification is needed, ask the minimum useful number of questions, up to three.",
    "If the user explicitly asks to be asked questions, honor that request before producing the issue.",
    "When honoring an explicit question request, ask the requested number of questions, capped at three.",
    "Do not dismiss an explicit question request as test noise or as unrelated to issue scope.",
    "If no essential questions are needed, produce a concise issue title and a useful Markdown issue body.",
    `Use this exact requestId in every JSON file: ${String(requestId || "").trim()}`,
    "",
    "Question file format:",
    autopilotQuestionFileExample("<requestId>"),
    "",
    "If no clarification is needed:",
    "Write the issue draft to this JSON file.",
    `Issue draft file path: ${issueDraftFile}`,
    autopilotIssueDraftFileExample("<requestId>"),
    "",
    "Do not write both questions.json and issue-draft.json for the same response."
  ].join("\n");
}

function buildInitialIssueDraftPrompt({
  artifactsRoot = "",
  requestId = "",
  requestText = ""
} = {}) {
  const hiddenPrompt = [
    issueDraftPromptHeader({
      artifactsRoot,
      requestId
    }),
    "",
    "Initial user request:",
    String(requestText || "").trim()
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

function buildAnsweredIssueDraftPrompt({
  artifactsRoot = "",
  questions = [],
  requestId = "",
  requestText = ""
} = {}) {
  const hiddenPrompt = [
    issueDraftPromptHeader({
      artifactsRoot,
      requestId
    }),
    "",
    "Original user request:",
    String(requestText || "").trim(),
    "",
    autopilotQuestionAnswersPrompt({
      contextLabel: "Issue definition",
      continuationLines: [
        "Use the original request and these answers to continue defining the issue.",
        "If you ask any more questions, ask them in normal text and write questions.json using the format above.",
        "Otherwise write issue-draft.json."
      ],
      questions
    })
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

export {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
};
