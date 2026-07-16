import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "@local/vibe64-core/server/projectRepository";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT
} from "../workflowArtifacts.js";
import {
  AGENT_CONVERSATION_ACTION_ID,
  buildAgentConversationStepDefinition
} from "../workflowDefinitionBuilders.js";
import {
  defineWorkflow
} from "../workflowDefinitionComposers.js";
import { when } from "../workflowConditions.js";
import {
  STEP_STATUS,
  artifactIsReady
} from "../workflowStepMachineHelpers.js";
import {
  coreLifecycleWorkflowIntentHandlers
} from "./coreLifecycle.js";

const moduleId = "core.initialization";
const existingApplicationReviewedStepId = "existing_application_reviewed";
const existingApplicationReviewLabel = "Review existing app";
const existingApplicationReviewDisabledReason = "Wait for Codex's inspection before continuing.";
const VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS = deepFreeze({
  CANONICAL_GIT: "canonical_git_initialize_existing_application",
  GITHUB_PR: "initialize_existing_application",
  LOCAL_SOURCE: "local_source_initialize_existing_application"
});
const initializationWorkflowProfiles = deepFreeze([
  {
    id: VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.GITHUB_PR,
    workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
  },
  {
    id: VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT,
    workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
  },
  {
    id: VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE,
    workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
  }
]);

const existingApplicationReviewBase = buildAgentConversationStepDefinition({
  actionLabel: "Ask Codex",
  description: "Inspect the existing application together before Vibe64 initializes it.",
  id: existingApplicationReviewedStepId,
  inputLabel: "What would you like Codex to inspect or explain?",
  inputPlaceholder: "Ask about the application, then continue when you are ready.",
  label: existingApplicationReviewLabel,
  message: "Codex will inspect the running application first. Open it, look around, and ask follow-up questions. Continue only when you are ready for Vibe64 to save its initialization files.",
  next: {
    disabledReason: existingApplicationReviewDisabledReason,
    enabledWhen: [when.artifactReady(HUMAN_INPUT_RESPONSE_ARTIFACT)]
  },
  responseArtifact: HUMAN_INPUT_RESPONSE_ARTIFACT
});
const existingApplicationReview = {
  ...existingApplicationReviewBase,
  presentation: {
    ...existingApplicationReviewBase.presentation,
    automation: {
      action: {
        actionId: AGENT_CONVERSATION_ACTION_ID,
        input: {
          conversationRequest: [
            "Inspect this existing application without changing its application source.",
            "Run it with the managed Vibe64 tools and use the managed browser to look at what actually renders.",
            "Explain what the application does, what you observed in the live page, and anything important about its structure.",
            "Then invite me to open it, look around, and ask follow-up questions before I continue initialization."
          ].join(" ")
        },
        label: "Inspect existing app",
        statuses: [STEP_STATUS.READY],
        whenStateMissing: ["message"]
      }
    },
    stop: {
      ...existingApplicationReviewBase.presentation.stop,
      intents: existingApplicationReviewBase.presentation.stop.intents.map((intent) => (
        intent.id === "continue_step"
          ? {
              ...intent,
              auditMessage: "Existing application review accepted.",
              label: "Continue initialization",
              style: "secondary"
            }
          : intent
      )),
      screen: {
        ...existingApplicationReviewBase.presentation.stop.screen,
        sections: ["launch_controls", "response_preview"],
        title: existingApplicationReviewLabel
      }
    }
  }
};

function initializationWorkflowDefinition({
  id,
  workflowRepositoryProfile
} = {}) {
  const githubPullRequest = workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;
  return defineWorkflow({
    description: "Inspect an existing application with the user, then save its Vibe64 initialization baseline.",
    id,
    initialMetadata: {
      github_issue_mode: "skip",
      issue_source: "none",
      pr_source: "none",
      work_anchor_type: "description",
      work_source: "initialization",
      work_title: "Initialize existing application"
    },
    ...(githubPullRequest ? { intentHandlers: coreLifecycleWorkflowIntentHandlers } : {}),
    label: "Initialize existing app",
    sessionWord: "initializing",
    parts: [
      "session_created",
      "source_created",
      "dependencies_installed",
      existingApplicationReviewedStepId,
      "changes_committed",
      ...(githubPullRequest ? ["create_and_merge_pull_request"] : []),
      "session_finished"
    ],
    userSelectable: false,
    workflowRepositoryProfiles: [workflowRepositoryProfile]
  });
}

const coreInitializationWorkflowModule = deepFreeze({
  id: moduleId,
  steps: [
    {
      config: {
        completionMessage: "Existing application inspection completed.",
        completionPolicy: {
          decidedBy: "user"
        },
        nextWhenIdle: (context = {}) => ({
          disabledReason: existingApplicationReviewDisabledReason,
          enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
        }),
        promptActionId: AGENT_CONVERSATION_ACTION_ID,
        waitingMessage: "Wait for Codex to finish inspecting the existing application."
      },
      definition: existingApplicationReview,
      factoryId: "chat_with_ai",
      id: existingApplicationReviewedStepId
    }
  ],
  workflowDefinitions: initializationWorkflowProfiles.map(initializationWorkflowDefinition)
});

export {
  VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS,
  coreInitializationWorkflowModule,
  existingApplicationReviewedStepId
};
