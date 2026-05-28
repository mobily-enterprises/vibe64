import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT
} from "../workflowArtifacts.js";
import {
  buildAgentConversationStepDefinition
} from "../workflowDefinitionBuilders.js";
import {
  defineWorkflow
} from "../workflowDefinitionComposers.js";
import {
  finishOffWorkflowGroup
} from "./coreCoding.js";
import { when } from "../workflowConditions.js";
import {
  STEP_STATUS,
  actionCreatedMetadata,
  artifactIsReady,
  commandStepView,
  machineState,
  markCommandActionStarted,
  metadataExists,
  readState,
  submitCommandFailureInput,
  writeCommandActionFinishedState
} from "../workflowStepMachineHelpers.js";

const moduleId = "core.maintenance";
const localSessionFinishedStepId = "local_session_finished";
const workflowDefinitionIds = deepFreeze({
  NON_CODE_MAINTENANCE: "non_code_maintenance",
  NON_COMMIT_MAINTENANCE: "non_commit_maintenance"
});

const coreMaintenanceStepDefinitionsById = deepFreeze({
  maintenance_conversation: buildAgentConversationStepDefinition({
    actionLabel: "Ask Codex",
    description: "Ask Codex for local maintenance help and save the answer as an editable AI response artifact.",
    id: "maintenance_conversation",
    label: "Talk to Codex",
    next: {
      disabledReason: "Ask Codex and save an AI response before finishing.",
      enabledWhen: [when.artifactReady(HUMAN_INPUT_RESPONSE_ARTIFACT)]
    },
    responseArtifact: HUMAN_INPUT_RESPONSE_ARTIFACT
  }),
  [localSessionFinishedStepId]: {
    actions: [
      {
        adapterCapability: "finish_session",
        id: "finish_session",
        label: "Archive",
        type: "finish"
      }
    ],
    autopilot: {
      kind: "finished",
      stop: true
    },
    description: "Archive this local maintenance session without creating a pull request.",
    id: localSessionFinishedStepId,
    label: "Finish local session",
    next: {
      visible: false
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: "finish_session",
            id: "archive_session",
            label: "Archive",
            style: "primary",
            type: "action"
          }
        ],
        screen: {
          icon: "success",
          kind: "finished",
          message: "The session is complete.",
          sections: ["report_preview"],
          title: "Congratulations!"
        }
      }
    },
    rewindCleanup: {
      actionResults: ["finish_session"]
    }
  }
});

const coreMaintenanceWorkflowDefinitions = [
  defineWorkflow({
    description: "Update documentation or other non-code project files, review, report, commit, create a PR, and optionally merge.",
    id: workflowDefinitionIds.NON_CODE_MAINTENANCE,
    label: "Documentation/non code maintenance",
    parts: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      "maintenance_conversation",
      finishOffWorkflowGroup({
        rejectTo: "maintenance_conversation",
        recheckTo: "maintenance_conversation"
      })
    ],
    sessionWord: "documentation",
    userSelectable: true
  }),
  {
    description: "Run a local maintenance task without commit, pull request, or merge steps.",
    id: workflowDefinitionIds.NON_COMMIT_MAINTENANCE,
    label: "Non-commit maintenance",
    initialMetadata: {
      work_source: "new_branch"
    },
    sessionWord: "maintenance",
    steps: [
      "session_created",
      "worktree_created",
      "dependencies_installed",
      "maintenance_conversation",
      localSessionFinishedStepId
    ],
    userSelectable: true
  }
];

const localSessionFinishedMachine = {
  stepId: localSessionFinishedStepId,

  initialState(context = {}) {
    return metadataExists(context.session, "session_finished")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "session_finished")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Archive the local session when you are finished.",
      failurePrompt: "The archive action failed. Explain what should happen, then retry archive.",
      failureTitle: "Archive needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["finish_session"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["finish_session"],
      done: await actionCreatedMetadata(context, "session_finished"),
      failureTitle: "Archive needs attention"
    });
  }
};

const coreMaintenanceSteps = Object.freeze([
  {
    config: {
      completionMessage: "Maintenance conversation turn completed.",
      completionPolicy: {
        decidedBy: "user"
      },
      nextWhenIdle: (context = {}) => ({
        disabledReason: "Ask Codex for changes before continuing.",
        enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
      }),
      promptActionId: "agent_conversation"
    },
    definition: coreMaintenanceStepDefinitionsById.maintenance_conversation,
    factoryId: "chat_with_ai",
    id: "maintenance_conversation"
  },
  {
    definition: coreMaintenanceStepDefinitionsById[localSessionFinishedStepId],
    id: localSessionFinishedStepId,
    machine: localSessionFinishedMachine
  }
]);

const coreMaintenanceWorkflowModule = Object.freeze({
  id: moduleId,
  steps: coreMaintenanceSteps,
  workflowDefinitions: coreMaintenanceWorkflowDefinitions
});

const _testing = deepFreeze({
  moduleId,
  ownedStepIds: [
    "maintenance_conversation",
    localSessionFinishedStepId
  ],
  workflowDefinitionIds
});

export {
  _testing,
  coreMaintenanceWorkflowModule
};
