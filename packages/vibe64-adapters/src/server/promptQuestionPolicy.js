const QUESTION_BATCH_LIMIT = 3;

function questionBatchLimitInstruction() {
  return `Ask at most ${QUESTION_BATCH_LIMIT} questions at a time. If more uncertainty remains, ask the ${QUESTION_BATCH_LIMIT} highest-impact questions first.`;
}

function numberedQuestionFormatInstruction() {
  return "When asking more than one question, format each question on its own line as `[1] Question text`, `[2] Question text`, and so on. When the turn uses the Vibe64 workflow-result control, keep its `message` identical to the visible question text.";
}

function questionPromptInstructions() {
  return [
    questionBatchLimitInstruction(),
    numberedQuestionFormatInstruction()
  ];
}

function questionPromptInstructionBullets() {
  return questionPromptInstructions().map((instruction) => `- ${instruction}`);
}

function missingInformationPolicyInstruction() {
  return [
    "If required external service details, credentials, project URLs, API keys, provider choices, production-vs-local decisions, or runtime configuration are missing, ask concise questions before planning or implementing work that depends on them.",
    questionBatchLimitInstruction(),
    "Do not invent placeholder credentials, silently choose unrelated local substitutes, or proceed with fake integrations."
  ].join(" ");
}

export {
  QUESTION_BATCH_LIMIT,
  missingInformationPolicyInstruction,
  numberedQuestionFormatInstruction,
  questionBatchLimitInstruction,
  questionPromptInstructionBullets,
  questionPromptInstructions
};
