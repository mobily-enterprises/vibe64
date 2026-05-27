const AGENT_CONVERSATION_ACTION_ID = "agent_conversation";

function buildAgentConversationActionDefinition({
  id = AGENT_CONVERSATION_ACTION_ID,
  inputLabel = "What do you want to ask Codex?",
  inputPlaceholder = "Describe what you want help with.",
  label = "Talk to Codex"
} = {}) {
  return {
    icon: "codex",
    id,
    inputFields: [
      {
        kind: "textarea",
        label: inputLabel,
        name: "conversationRequest",
        placeholder: inputPlaceholder,
        requiredMessage: "Describe what you want Codex to do."
      }
    ],
    label,
    promptId: AGENT_CONVERSATION_ACTION_ID,
    recordsConversationTurn: true,
    type: "prompt"
  };
}

function buildAgentConversationStepDefinition({
  actionLabel = "Talk to Codex",
  description = "",
  id,
  inputLabel = "What do you want to ask Codex?",
  inputPlaceholder = "Describe what you want help with.",
  label = "Talk to Codex",
  next = null,
  responseArtifact = ""
} = {}) {
  const artifactsToClean = responseArtifact ? [responseArtifact] : [];
  const conversationAction = buildAgentConversationActionDefinition({
    inputLabel,
    inputPlaceholder,
    label: actionLabel
  });
  return {
    actions: [
      conversationAction
    ],
    autopilot: {
      actionId: conversationAction.id,
      kind: "agent_conversation",
      stop: true
    },
    description,
    id,
    label,
    ...(next ? { next } : {}),
    presentation: {
      stop: {
        intents: [
          {
            actionId: conversationAction.id,
            id: "talk_to_codex",
            style: "primary",
            type: "action"
          },
          {
            id: "continue_step",
            type: "continue"
          }
        ],
        persistWhenComplete: true,
        screen: {
          kind: "conversation",
          message: "Ask Codex for changes. Continue when the work is ready for the next workflow step.",
          primaryIntentId: "talk_to_codex",
          sections: ["response_preview"],
          title: "current_step"
        }
      }
    },
    rewindCleanup: {
      actionResults: [AGENT_CONVERSATION_ACTION_ID],
      artifacts: artifactsToClean
    }
  };
}

export {
  AGENT_CONVERSATION_ACTION_ID,
  buildAgentConversationActionDefinition,
  buildAgentConversationStepDefinition
};
