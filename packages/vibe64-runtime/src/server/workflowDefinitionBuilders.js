import {
  VIBE64_ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";

const AGENT_CONVERSATION_ACTION_ID = "agent_conversation";

function buildAgentConversationActionDefinition({
  id = AGENT_CONVERSATION_ACTION_ID,
  inputLabel = "What do you want to ask Codex?",
  inputPlaceholder = "Talk to Codex",
  label = "Talk to Codex"
} = {}) {
  return {
    dispatchRoute: VIBE64_ACTION_DISPATCH_ROUTES.SESSION_MESSAGE,
    icon: "codex",
    id,
    inputFields: [
      {
        kind: "textarea",
        label: inputLabel,
        name: "conversationRequest",
        placeholder: inputPlaceholder,
        requiredMessage: "Talk to Codex"
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
  inputPlaceholder = "Talk to Codex",
  label = "Talk to Codex",
  message = "Ask Codex for changes. Continue when the work is ready for the next workflow step.",
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
          message,
          primaryIntentId: "talk_to_codex",
          sections: ["response_preview"],
          title: "current_step",
          variant: "guide"
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
