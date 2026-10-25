import { latestAssistantMessageAwaitingUserReply, parseAnswerChoicePrompt, parseNumberedQuestionPrompt } from "@jskit-ai/assistant-core/shared/conversation";

export { latestAssistantMessageAwaitingUserReply };

// The same replies for which the chat composer offers answer controls.
export function assistantReplyAsksPerson(text) {
  return parseNumberedQuestionPrompt(text).questions.length > 0 || parseAnswerChoicePrompt(text).choices.length > 0;
}
