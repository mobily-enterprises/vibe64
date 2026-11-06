import { assistantGoalManagementMessage, assistantGoalObjective, assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { parseIntegrationSetupRequest, vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { learningGuidancePresentation } from "@local/vibe64-training/shared/learning-guidance";
import { conversationAttribution } from "@/lib/vibe64ConversationAttribution.js";
import { thinkingMessagesPresentation } from "@/lib/vibe64ThinkingPresentation.js";

// How the main chat shows one conversation turn: who answered and through which
// mode, project and Learning messages as system rows, goal commands with their
// objective only, and integration requests parsed for their Configure card.

function presentationMessage(message, turn) {
  if (!message || assistantGoalManagementMessage(message, turn)) return null;
  const prefix = message.role === "user" ? "/goal "
    : ["Goal set: ", "Goal cleared: ", "Goal active: "].find(value => message.text?.startsWith(value));
  if (prefix && message.text?.startsWith(prefix)) {
    const objective = message.text.slice(prefix.length);
    const separator = objective.indexOf("\n\n");
    if (separator !== -1) {
      const display = assistantGoalObjective(objective, { objective: objective.slice(separator + 2) });
      if (display !== objective) return { ...message, text: `${prefix}${display}` };
    }
  }
  const integrationRequest = parseIntegrationSetupRequest(message);
  return integrationRequest ? { ...message, text: integrationRequest.text, integrationRequest } : message;
}

function conversationTurnPresentation(turn) {
  const selection = turn.metadata?.assistantSelection;
  return {
    ...turn,
    ...conversationAttribution(selection, turn.metadata?.assistantRouting),
    ...(!turn.system && turn.metadata?.assistantRouting && selection ? { system: { role: "system", text: `${turn.metadata.assistantRouting.requestedMode === "auto" ? "Auto → " : ""}${assistantModeLabel(turn.metadata.assistantRouting.resolvedMode)} · ${vibe64AssistantSelectionLabel(selection)}` } } : {}),
    user: presentationMessage(turn.user, turn),
    ...(turn.metadata?.projectMessage ? {
      user: null,
      system: { ...(turn.system || turn.user), role: "system", projectMessage: turn.metadata.projectMessage }
    } : {}),
    // A Learning watch wake is application-origin: show its short status, not the teacher prompt.
    ...(learningGuidancePresentation(turn.user) ? {
      user: null,
      system: { ...turn.user, role: "system", text: learningGuidancePresentation(turn.user).text }
    } : {}),
    assistant: presentationMessage(turn.assistant, turn),
    thinking: turn.thinking?.flatMap((message) => thinkingMessagesPresentation(message, selection)),
    commentary: turn.commentary?.flatMap((message) => thinkingMessagesPresentation(presentationMessage(message, turn), selection)),
    messages: turn.messages?.flatMap((message) => thinkingMessagesPresentation(presentationMessage(message, turn), selection))
  };
}

export {
  conversationTurnPresentation
};
