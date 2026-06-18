import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS
} from "@local/vibe64-core/shared";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT,
  ISSUE_BODY_ARTIFACT,
  ISSUE_TITLE_ARTIFACT,
  ISSUE_WORD_ARTIFACT,
  PLAN_SUMMARY_ARTIFACT,
  PLAN_TECHNICAL_ARTIFACT,
  REPORT_ARTIFACT,
  WORK_BODY_ARTIFACT,
  WORK_TITLE_ARTIFACT,
  WORK_WORD_ARTIFACT
} from "../workflowArtifacts.js";
import {
  buildAgentConversationActionDefinition
} from "../workflowDefinitionBuilders.js";
import {
  defineWorkflow,
  workflowGroup,
  workflowWhen
} from "../workflowDefinitionComposers.js";
import {
  coreLifecycleWorkflowIntentHandlers
} from "./coreLifecycle.js";
import { when } from "../workflowConditions.js";
import {
  LET_CODEX_DECIDE_INPUT,
  STEP_INPUT_KIND,
  STEP_STATUS,
  actionCompleted,
  assertAgentResultSource,
  artifactIsReady,
  artifactText,
  commandFailureInteraction,
  commandSucceeded,
  currentStepAgentResultInstruction,
  disableAction,
  handleStandardPromptInput,
  machineState,
  markPromptActionStarted,
  metadataExists,
  nextForSession,
  normalizeMachineInput,
  promptWaitingForInputInteraction,
  promptStepDoneView,
  promptStepWaitingForInputView,
  promptStepWaitingView,
  publicState,
  readState,
  requireInputValue,
  unsupportedInputKind,
  writePromptResponseArtifact,
  writeState
} from "../workflowStepMachineHelpers.js";

const moduleId = "core.coding";

const VIBE64_WORKFLOW_DEFINITION_IDS = deepFreeze({
  BIG_FEATURE: "big_feature",
  SEED_APPLICATION: "seed_application"
});
const DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID = VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE;
const CORE_CODING_WORKFLOW_GROUP_IDS = deepFreeze({
  FINISH_OFF: "finish_off",
  QA: "qa"
});

const changesAcceptedStepId = "changes_accepted";
const deepUiCheckRunStepId = "deep_ui_check_run";
const implementationReviewedStepId = "implementation_reviewed";
const planAndExecuteStepId = "plan_and_execute";
const reportAndKnowledgeUpdatedStepId = "report_and_update_knowledge";
const reviewAndValidateStepId = "review_and_validate";
const seedPlanExecutedStepId = "seed_plan_executed";
const seedPlanMadeStepId = "seed_plan_made";
const finalReviewConversationActionId = "final_review_conversation";
const humanReviewConversationActionId = "human_review_conversation";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const draftIssueActionId = "draft_issue";
const rejectIssueDraftActionId = "reject_issue_draft";
const SEED_APPLICATION_STEP_ID = "seed_application_defined";
const draftSeedApplicationActionId = "define_seed_application";
const GITHUB_ISSUE_MODE_METADATA = "github_issue_mode";
const PLAN_READY_METADATA = "plan_ready";
const IMPLEMENTATION_DONE_METADATA = "implementation_done";
const PROJECT_KNOWLEDGE_UPDATED_METADATA = "project_knowledge_updated";
const REVIEW_DESLOP_COMPLETED_METADATA = "review_deslop_completed";
const GITHUB_ISSUE_MODES = deepFreeze({
  CREATE: "create",
  REUSE: "reuse",
  SKIP: "skip"
});
const WORK_DEFINITION_ARTIFACTS = deepFreeze([
  WORK_TITLE_ARTIFACT,
  WORK_BODY_ARTIFACT,
  WORK_WORD_ARTIFACT
]);

async function skipOptionalCheck(ctx = {}) {
  return ctx.forceAdvance("Skipped optional check.");
}

async function requestFinalReviewTweak(ctx = {}) {
  await ctx.writeMetadata("autopilot_final_review_followup", "recheck");
  return ctx.runAction(finalReviewConversationActionId, ctx.conversationInput());
}

async function recheckAfterFinalTweak(ctx = {}) {
  await ctx.deleteMetadata("autopilot_final_review_followup");
  return ctx.rewind(ctx.recheckTargetStepId());
}

const finalReviewIntentHandlers = deepFreeze({
  request_review_tweak: requestFinalReviewTweak,
  recheck_after_final_tweak: recheckAfterFinalTweak
});
const optionalCheckIntentHandlers = deepFreeze({
  skip_optional_check: skipOptionalCheck
});

function finishOffWorkflowGroup({
  recheckTo = "",
  rejectTo = ""
} = {}) {
  return workflowGroup({
    id: CORE_CODING_WORKFLOW_GROUP_IDS.FINISH_OFF,
    intentHandlers: {
      ...coreLifecycleWorkflowIntentHandlers,
      [changesAcceptedStepId]: finalReviewIntentHandlers
    },
    steps: [
      {
        recheckTo,
        rejectTo,
        stepId: changesAcceptedStepId
      },
      reportAndKnowledgeUpdatedStepId,
      "changes_committed",
      "create_and_merge_pull_request",
      "session_finished"
    ]
  });
}

function qaWorkflowGroup({
  humanReview = true
} = {}) {
  return workflowGroup({
    id: CORE_CODING_WORKFLOW_GROUP_IDS.QA,
    intentHandlers: {
      [deepUiCheckRunStepId]: optionalCheckIntentHandlers
    },
    steps: [
      workflowWhen(humanReview, implementationReviewedStepId),
      deepUiCheckRunStepId,
      reviewAndValidateStepId
    ]
  });
}

function createIssueOnGithubAction() {
  return {
    adapterCapability: "create_issue_on_gh",
    auditMessage: "Issue draft accepted; creating GitHub issue.",
    disabledReason: "Create the issue file before submitting it to GitHub.",
    disabledWhen: [when.metadataExists("issue_url")],
    disabledWhenReason: "The GitHub issue already exists.",
    enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_WORD_ARTIFACT, ISSUE_BODY_ARTIFACT)],
    enabledWhenReason: "Create the issue file before submitting it to GitHub.",
    icon: "github",
    id: "create_issue_on_gh",
    label: "Create issue on GH",
    saveCurrentStepInputBeforeRun: true,
    type: "command"
  };
}

const coreCodingStepDefinitionsById = deepFreeze({
  [SEED_APPLICATION_STEP_ID]: {
    actions: [
      {
        disabledReason: "Seed details are already saved.",
        disabledWhen: [
          when.allArtifactsReady(WORK_TITLE_ARTIFACT, WORK_BODY_ARTIFACT, WORK_WORD_ARTIFACT)
        ],
        disabledWhenReason: "Seed details are already saved.",
        icon: "message-square-plus",
        id: draftSeedApplicationActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "What kind of app should Vibe64 seed?",
            name: "conversationRequest",
            placeholder: "Describe what the app should do for people, or let Codex ask simple setup questions.",
            requiredMessage: "Describe what Vibe64 should seed, or ask Codex to ask simple setup questions."
          }
        ],
        label: "Discuss seed choices",
        promptId: draftSeedApplicationActionId,
        recordsConversationTurn: true,
        type: "prompt"
      }
    ],
    autopilot: {
      kind: "issue_discussion",
      stop: true
    },
    description: "Define the initial application foundation as an issue.",
    id: SEED_APPLICATION_STEP_ID,
    label: "Seed application",
    next: {
      disabledReason: "Define and save the seed issue before continuing.",
      enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)]
    },
    presentation: {
      automation: {
        action: {
          actionId: draftSeedApplicationActionId,
          input: {
            conversationRequest: "Let's talk about my new project."
          },
          label: "Discuss seed choices",
          statuses: [STEP_STATUS.WAITING_FOR_INPUT],
          whenStateMissing: ["message"]
        }
      }
    },
    rewindCleanup: {
      actionResults: [],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: ["issue_title", ISSUE_WORD_ARTIFACT]
    }
  },
  [ISSUE_FILE_STEP_ID]: {
    actions: [
      {
        disabledReason: "Work details are already saved.",
        disabledWhen: [
          when.allArtifactsReady(WORK_TITLE_ARTIFACT, WORK_BODY_ARTIFACT, WORK_WORD_ARTIFACT)
        ],
        icon: "message-square-plus",
        id: draftIssueActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "What do you want Vibe64 to work on?",
            name: "conversationRequest",
            placeholder: "Describe the feature, bug, or change you want.",
            requiredMessage: "Talk to Codex"
          }
        ],
        label: "Describe work",
        promptId: draftIssueActionId,
        recordsConversationTurn: true,
        type: "prompt"
      },
      {
        disabledReason: "Draft an issue before requesting improvements.",
        disabledWhen: [when.metadataExists("issue_url")],
        disabledWhenReason: "An existing issue is already selected.",
        enabledWhen: [when.allArtifactsReady(WORK_TITLE_ARTIFACT, WORK_BODY_ARTIFACT, WORK_WORD_ARTIFACT)],
        enabledWhenReason: "Draft an issue before requesting improvements.",
        icon: "rotate-ccw",
        id: rejectIssueDraftActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "Talk with the AI agent",
            name: "feedback",
            placeholder: "Tell Codex how to improve the saved issue draft.",
            requiredMessage: "Explain what should change before sending the improvement request."
          }
        ],
        label: "Send improvement request",
        promptId: draftIssueActionId,
        recordsConversationTurn: true,
        type: "prompt"
      },
      createIssueOnGithubAction()
    ],
    autopilot: {
      kind: "issue_discussion",
      stop: true
    },
    description: "Define the work and create a GitHub issue only when the starting point requires one.",
    id: ISSUE_FILE_STEP_ID,
    label: "Define work",
    next: {
      disabledReason: "Define the work before continuing.",
      enabledWhen: [when.allArtifactsReady(WORK_TITLE_ARTIFACT, WORK_BODY_ARTIFACT, WORK_WORD_ARTIFACT)]
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: draftIssueActionId,
            id: draftIssueActionId,
            label: "Describe work",
            style: "primary",
            type: "action"
          },
          {
            actionId: "create_issue_on_gh",
            id: "create_issue_on_gh",
            label: "Create issue on GH",
            style: "secondary",
            type: "action"
          }
        ],
        screen: {
          kind: "issue_source",
          message: "Tell me what you want built or fixed. Vibe64 can turn it into a GitHub issue if this session needs one.",
          primaryIntentId: draftIssueActionId,
          title: "Define work",
          variant: "guide"
        }
      }
    },
    rewindCleanup: {
      actionResults: [draftIssueActionId, rejectIssueDraftActionId, "create_issue_on_gh"],
      artifacts: [
        WORK_TITLE_ARTIFACT,
        WORK_BODY_ARTIFACT,
        WORK_WORD_ARTIFACT,
        ISSUE_TITLE_ARTIFACT,
        ISSUE_BODY_ARTIFACT,
        ISSUE_WORD_ARTIFACT
      ],
      metadata: [
        "issue_url",
        "issue_number",
        "issue_title",
        "issue_source",
        "work_title",
        "work_word",
        "work_anchor_number",
        "work_anchor_title",
        "work_anchor_type",
        "work_anchor_url",
        ISSUE_WORD_ARTIFACT,
        PLAN_READY_METADATA,
        IMPLEMENTATION_DONE_METADATA
      ]
    }
  },
  [seedPlanMadeStepId]: {
    actions: [
      {
        id: "make_seed_plan",
        label: "Make seed plan",
        promptId: "make_seed_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "make_seed_plan",
      label: "Make seed plan"
    },
    description: "Ask Codex to plan the initial framework seed work.",
    id: seedPlanMadeStepId,
    label: "Make seed plan",
    rewindCleanup: {
      actionResults: ["make_seed_plan"],
      artifacts: [PLAN_SUMMARY_ARTIFACT, PLAN_TECHNICAL_ARTIFACT]
    }
  },
  [seedPlanExecutedStepId]: {
    actions: [
      {
        id: "execute_seed_plan",
        label: "Execute seed plan",
        promptId: "execute_seed_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "execute_seed_plan",
      label: "Execute seed plan"
    },
    description: "Ask Codex to seed the framework app and local development foundation.",
    id: seedPlanExecutedStepId,
    label: "Execute seed plan",
    rewindCleanup: {
      actionResults: ["execute_seed_plan"]
    }
  },
  [planAndExecuteStepId]: {
    actions: [
      {
        disabledWhen: [when.metadataExists(PLAN_READY_METADATA)],
        disabledWhenReason: "The plan is already ready.",
        id: "make_plan",
        label: "Make a plan",
        promptId: "make_plan",
        type: "prompt"
      },
      {
        disabledReason: "Implementation is already complete.",
        disabledWhen: [when.metadataExists(IMPLEMENTATION_DONE_METADATA)],
        disabledWhenReason: "Implementation is already complete.",
        enabledWhen: [when.metadataExists(PLAN_READY_METADATA)],
        enabledWhenReason: "Make the plan before executing it.",
        id: "execute_plan",
        label: "Execute plan",
        promptId: "execute_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionSequence: [
        {
          actionId: "make_plan",
          completeWhen: [when.metadataExists(PLAN_READY_METADATA)],
          label: "Make a plan"
        },
        {
          actionId: "execute_plan",
          completeWhen: [when.metadataExists(IMPLEMENTATION_DONE_METADATA)],
          label: "Execute plan"
        }
      ],
      label: "Plan and execute"
    },
    description: "Ask Codex to create the implementation plan, then execute it.",
    id: planAndExecuteStepId,
    label: "Plan and execute",
    next: {
      disabledReason: "Execute the plan before continuing.",
      enabledWhen: [when.metadataExists(IMPLEMENTATION_DONE_METADATA)]
    },
    rewindCleanup: {
      actionResults: ["make_plan", "execute_plan"],
      artifacts: [PLAN_SUMMARY_ARTIFACT, PLAN_TECHNICAL_ARTIFACT],
      metadata: [PLAN_READY_METADATA, IMPLEMENTATION_DONE_METADATA]
    }
  },
  [implementationReviewedStepId]: {
    actions: [
      buildAgentConversationActionDefinition({
        id: humanReviewConversationActionId,
        label: "Ask AI for tweaks",
        inputLabel: "What would you like changed?",
        inputPlaceholder: "Describe the tweak in plain language."
      })
    ],
    autopilot: {
      actionId: humanReviewConversationActionId,
      kind: "implementation_review",
      stop: true
    },
    description: "Try the implemented work and request small tweaks before slower review steps.",
    id: implementationReviewedStepId,
    label: "Initial human review",
    presentation: {
      stop: {
        intents: [
          {
            control: {
              action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF,
              disabledWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_DISABLED],
              icon: VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF,
              loadingWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_LOADING]
            },
            enabled: true,
            id: "open_diff",
            label: "Review diff"
          },
          {
            auditMessage: "Initial human review accepted.",
            id: "accept_review",
            label: "Looks good, continue",
            style: "primary",
            type: "continue"
          },
          {
            actionId: humanReviewConversationActionId,
            id: "request_review_tweak",
            style: "secondary",
            type: "action"
          }
        ],
        persistWhenComplete: true,
        screen: {
          kind: "review",
          message: "Try the work now. Ask Codex for small tweaks, or continue when it looks right.",
          sections: ["launch_controls", "report_preview", "response_preview"],
          title: "Initial human review",
          primaryIntentId: "request_review_tweak",
          variant: "implementation"
        }
      }
    },
    rewindCleanup: {
      actionResults: [humanReviewConversationActionId],
      artifacts: [HUMAN_INPUT_RESPONSE_ARTIFACT]
    }
  },
  [deepUiCheckRunStepId]: {
    actions: [
      {
        id: "run_deep_ui_check",
        label: "Check user interface",
        promptId: "run_deep_ui_check",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "run_deep_ui_check",
      label: "Check user interface",
      userDecision: true
    },
    description: "Run the deeper UI review when the target supports it.",
    id: deepUiCheckRunStepId,
    label: "Check user interface",
    presentation: {
      decision: {
        intents: [
          {
            actionId: "run_deep_ui_check",
            auditMessage: "Run user interface check.",
            id: "run_optional_check",
            style: "primary",
            type: "action"
          },
          {
            auditMessage: "User interface check skipped.",
            enabledWhen: "has_next_step",
            id: "skip_optional_check",
            label: "Skip"
          }
        ],
        screen: {
          kind: "decision",
          message: "This optional check can take a long time. Run it now, or skip it and continue.",
          titleActionId: "run_deep_ui_check",
          titleSuffix: "?"
        }
      }
    },
    rewindCleanup: {
      actionResults: ["run_deep_ui_check"]
    }
  },
  [reviewAndValidateStepId]: {
    actions: [
      {
        id: "run_deslop",
        label: "Run deslop",
        promptId: "run_deslop",
        type: "prompt"
      },
      {
        adapterCapability: "update_code_index",
        enabledWhen: [when.metadataExists(REVIEW_DESLOP_COMPLETED_METADATA)],
        enabledWhenReason: "Run review/deslop before updating the code index.",
        icon: "sync",
        id: "update_code_index",
        label: "Update code index",
        type: "command"
      },
      {
        adapterCapability: "run_automated_checks",
        enabledWhen: [
          when.metadataExists(REVIEW_DESLOP_COMPLETED_METADATA),
          when.metadataExists("code_index_updated")
        ],
        enabledWhenReason: "Update the code index before running automated checks.",
        icon: "run",
        id: "run_automated_checks",
        label: "Run automated checks",
        type: "command"
      }
    ],
    autopilot: {
      actionSequence: [
        {
          actionId: "run_deslop",
          completeWhen: [when.metadataExists(REVIEW_DESLOP_COMPLETED_METADATA)],
          label: "Run review/deslop"
        },
        {
          actionId: "update_code_index",
          completeWhen: [when.metadataExists("code_index_updated")],
          label: "Update code index"
        },
        {
          actionId: "run_automated_checks",
          completeWhen: [when.metadataExists("automated_checks_passed")],
          label: "Run automated checks"
        }
      ],
      label: "Review and validate"
    },
    description: "Run review/deslop, update the code index, and run automated checks.",
    id: reviewAndValidateStepId,
    label: "Review and validate",
    next: {
      disabledReason: "Run review/deslop, update the code index, and run automated checks successfully before continuing.",
      enabledWhen: [
        when.metadataExists(REVIEW_DESLOP_COMPLETED_METADATA),
        when.metadataExists("code_index_updated"),
        when.metadataExists("automated_checks_passed")
      ]
    },
    rewindCleanup: {
      actionResults: ["run_deslop", "update_code_index", "run_automated_checks"],
      metadata: [
        REVIEW_DESLOP_COMPLETED_METADATA,
        "code_index_command_source",
        "code_index_package_manager",
        "code_index_path",
        "code_index_updated",
        "automated_checks_package_manager",
        "automated_checks_passed"
      ]
    }
  },
  [changesAcceptedStepId]: {
    actions: [
      buildAgentConversationActionDefinition({
        id: finalReviewConversationActionId,
        label: "Ask AI for tweaks",
        inputLabel: "What should Codex adjust before finalizing?",
        inputPlaceholder: "Describe the final tweak. Studio will rerun review and validation afterwards."
      })
    ],
    autopilot: {
      actionId: finalReviewConversationActionId,
      kind: "final_review",
      stop: true
    },
    description: "Review the validated work before the report, commit, and pull request.",
    id: changesAcceptedStepId,
    label: "Final human review",
    presentation: {
      automation: {
        recheckAfterPrompt: {
          intentId: "recheck_after_final_tweak",
          label: "Recheck changes",
          metadataName: "autopilot_final_review_followup",
          metadataValue: "recheck",
          promptComplete: true,
          statuses: ["ready", "done"]
        }
      },
      stop: {
        intents: [
          {
            control: {
              action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF,
              disabledWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_DISABLED],
              icon: VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF,
              loadingWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_LOADING]
            },
            enabled: true,
            id: "open_diff",
            label: "Diff"
          },
          {
            auditMessage: "Final human review accepted.",
            id: "accept_review",
            label: "Accept",
            style: "primary",
            type: "continue"
          },
          {
            actionId: finalReviewConversationActionId,
            id: "request_review_tweak",
            style: "secondary"
          },
          {
            enabled: true,
            id: "reject",
            inputFields: [
              {
                kind: "textarea",
                label: "What should change in the plan?",
                name: "feedback",
                requiredMessage: "Describe what should change before sending the work back to Codex."
              }
            ],
            label: "Reject, revise",
            type: "reject"
          }
        ],
        persistWhenComplete: true,
        screen: {
          kind: "review",
          message: "Review the validated work before Autopilot writes the report and commits.",
          sections: ["launch_controls", "report_preview", "response_preview"],
          title: "Final human review",
          primaryIntentId: "request_review_tweak",
          variant: "final"
        }
      }
    },
    rewindCleanup: {
      actionResults: [finalReviewConversationActionId],
      metadata: ["autopilot_final_review_followup"]
    }
  },
  [reportAndKnowledgeUpdatedStepId]: {
    actions: [
      {
        id: "write_report",
        label: "Write report",
        promptId: "write_report",
        type: "prompt"
      },
      {
        enabledWhen: [when.artifactReady(REPORT_ARTIFACT)],
        enabledWhenReason: "Write the session report before updating project knowledge.",
        id: "update_project_knowledge",
        label: "Update project knowledge",
        promptId: "update_project_knowledge",
        type: "prompt"
      }
    ],
    autopilot: {
      actionSequence: [
        {
          actionId: "write_report",
          completeWhen: [when.artifactReady(REPORT_ARTIFACT)],
          label: "Write report"
        },
        {
          actionId: "update_project_knowledge",
          completeWhen: [when.metadataExists(PROJECT_KNOWLEDGE_UPDATED_METADATA)],
          label: "Update project knowledge"
        }
      ],
      label: "Write report and update project knowledge"
    },
    description: "Write the local report and update adapter-supported project knowledge.",
    id: reportAndKnowledgeUpdatedStepId,
    label: "Write report and update project knowledge",
    next: {
      disabledReason: "Write the report and update project knowledge before continuing.",
      enabledWhen: [
        when.artifactReady(REPORT_ARTIFACT),
        when.metadataExists(PROJECT_KNOWLEDGE_UPDATED_METADATA)
      ]
    },
    rewindCleanup: {
      actionResults: ["write_report", "update_project_knowledge"],
      artifacts: [REPORT_ARTIFACT],
      metadata: [PROJECT_KNOWLEDGE_UPDATED_METADATA]
    }
  }
});

const coreCodingWorkflowDefinitions = deepFreeze([
  defineWorkflow({
    description: "Create the initial application scaffold and local development foundation.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
    initialMetadata: {
      work_source: "seed"
    },
    label: "Seed application",
    parts: [
      "session_created",
      "worktree_created",
      SEED_APPLICATION_STEP_ID,
      seedPlanMadeStepId,
      seedPlanExecutedStepId,
      "dependencies_installed",
      reviewAndValidateStepId,
      finishOffWorkflowGroup({
        rejectTo: seedPlanMadeStepId,
        recheckTo: reviewAndValidateStepId
      })
    ],
    sessionWord: "seeding",
    userSelectable: false
  }),
  defineWorkflow({
    description: "Define, plan, implement, review, validate, commit, create a PR, and optionally merge.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE,
    label: "Make improvements",
    parts: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      ISSUE_FILE_STEP_ID,
      planAndExecuteStepId,
      qaWorkflowGroup({
        humanReview: true
      }),
      finishOffWorkflowGroup({
        rejectTo: planAndExecuteStepId,
        recheckTo: reviewAndValidateStepId
      })
    ],
    userSelectable: true
  })
]);

function workDefinitionArtifactsAreReady(session = {}) {
  const workArtifactsReady = WORK_DEFINITION_ARTIFACTS.every((artifactName) => artifactIsReady(session, artifactName));
  if (workArtifactsReady) {
    return true;
  }
  return [
    ISSUE_TITLE_ARTIFACT,
    ISSUE_WORD_ARTIFACT,
    ISSUE_BODY_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

function githubIssueMode(session = {}) {
  return normalizeText(session.metadata?.[GITHUB_ISSUE_MODE_METADATA]);
}

function githubIssueShouldBeCreated(session = {}) {
  return githubIssueMode(session) === GITHUB_ISSUE_MODES.CREATE;
}

function githubIssueShouldBeSkipped(session = {}) {
  return githubIssueMode(session) === GITHUB_ISSUE_MODES.SKIP;
}

function githubIssueIsReused(session = {}) {
  return githubIssueMode(session) === GITHUB_ISSUE_MODES.REUSE;
}

function disableActions(session = {}, reasonsById = {}) {
  const reasons = Object.entries(reasonsById)
    .filter(([, reason]) => normalizeText(reason));
  if (reasons.length === 0) {
    return Array.isArray(session.actions) ? session.actions : [];
  }
  return (Array.isArray(session.actions) ? session.actions : []).map((action) => {
    const reasonEntry = reasons.find(([id]) => action.id === id);
    if (!reasonEntry) {
      return action;
    }
    return {
      ...action,
      disabledReason: reasonEntry[1],
      enabled: false
    };
  });
}

function inputResponseText(input = {}) {
  return normalizeText(input.text || input.fields?.response || input.fields?.conversationRequest);
}

function planFieldText(input = {}, ...fieldNames) {
  const fields = input.fields || {};
  return fieldNames
    .map((name) => normalizeText(fields[name]))
    .find(Boolean) || "";
}

function acceptedPlanSummary(input = {}) {
  return planFieldText(input, "proposedPlan", "planSummary") || inputResponseText(input);
}

function acceptedTechnicalPlan(input = {}) {
  return planFieldText(input, "technicalPlan", "executionPlan") || inputResponseText(input);
}

async function writeAcceptedPlanArtifacts(context = {}, input = {}) {
  const summary = acceptedPlanSummary(input);
  const technicalPlan = acceptedTechnicalPlan(input);
  await Promise.all([
    ...(summary ? [
      context.runtime.store.writeArtifact(context.session.sessionId, PLAN_SUMMARY_ARTIFACT, artifactText(summary))
    ] : []),
    ...(technicalPlan ? [
      context.runtime.store.writeArtifact(context.session.sessionId, PLAN_TECHNICAL_ARTIFACT, artifactText(technicalPlan))
    ] : [])
  ]);
}

function planReadyInput(input = {}) {
  return input.kind === STEP_INPUT_KIND.READY || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED;
}

async function handlePlanPromptInput(context = {}, machine = {}) {
  const input = normalizeMachineInput(context.input);
  if (planReadyInput(input)) {
    await writeAcceptedPlanArtifacts(context, input);
  }
  return handleStandardPromptInput(context, machine);
}

function planPresentationInstruction({
  doneMeaning = "",
  planKind = "implementation",
  waitingForInputMeaning = ""
} = {}) {
  return [
    currentStepAgentResultInstruction({
      doneFields: {
        proposedPlan: `Short user-facing Markdown summary of the proposed ${planKind} plan.`,
        response: "Full Markdown chat response: Proposed plan plus a collapsed Technical plan section.",
        technicalPlan: `Detailed ordered technical ${planKind} plan that Codex should execute after the user accepts.`
      },
      doneMeaning,
      waitingForInputMeaning
    }),
    "",
    "Plan response format:",
    "- The visible response must start with `## Proposed plan` and contain a short plain-language summary or 3-6 bullets.",
    "- Then include the detailed plan in one collapsed section exactly shaped as:",
    "  `<details>`",
    "  `<summary>Technical plan</summary>`",
    "  detailed ordered technical plan",
    "  `</details>`",
    "- Do not ask the user to edit the plan directly. The user can accept it or ask for changes.",
    "- `fields.response` must match the full visible Markdown response.",
    "- `fields.proposedPlan` must contain only the simple user-facing plan.",
    "- `fields.technicalPlan` must contain only the detailed technical plan used for execution."
  ].join("\n");
}

function conversationSection(label = "", value = "") {
  const normalizedValue = normalizeText(value);
  return [
    `${label}:`,
    normalizedValue || "(empty)"
  ].join("\n");
}

function workDefinitionConversationMessage(context = {}, input = {}, {
  proposed = false
} = {}) {
  const fields = input?.fields || {};
  const createGithubIssue = githubIssueShouldBeCreated(context.session);
  const subject = createGithubIssue ? "issue draft" : "work description";
  return [
    `${proposed ? "Proposed" : "Saved"} ${subject}.`,
    "",
    conversationSection(createGithubIssue ? "Issue title" : "Work title", fields.title),
    "",
    conversationSection("Session label", fields.word),
    "",
    conversationSection(createGithubIssue ? "Issue body" : "Work description", fields.body)
  ].join("\n");
}

async function readWorkDefinitionFieldValues(context = {}) {
  const [workTitle, workBody, workWord, issueTitle, issueBody, issueWord] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, WORK_TITLE_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, WORK_BODY_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, WORK_WORD_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT)
  ]);
  return {
    body: normalizeText(workBody) || normalizeText(issueBody),
    title: normalizeText(workTitle) || normalizeText(issueTitle),
    word: normalizeText(workWord) || normalizeText(issueWord)
  };
}

async function writeWorkDefinitionFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Work title is required.");
  const body = requireInputValue(fields.body, "Work description is required.");
  const word = requireInputValue(fields.word, "Session label is required.");
  const mode = githubIssueMode(context.session);
  const preservesExistingPrAnchor = mode === GITHUB_ISSUE_MODES.SKIP &&
    normalizeText(context.session.metadata?.work_source) === "existing_pr";
  const staleMetadata = preservesExistingPrAnchor
    ? ["issue_number", "issue_url"]
    : ["issue_number", "issue_url", "work_anchor_number", "work_anchor_url"];
  const metadata = {
    issue_title: title,
    work_title: title,
    work_word: word,
    ...(preservesExistingPrAnchor ? {} : { work_anchor_title: title }),
    ...(mode === GITHUB_ISSUE_MODES.SKIP
      ? {
          issue_source: "none",
          ...(preservesExistingPrAnchor ? {} : { work_anchor_type: "description" })
        }
      : {
          issue_source: "draft",
          work_anchor_type: "issue"
        })
  };

  await Promise.all([
    context.runtime.store.writeArtifact(context.session.sessionId, WORK_TITLE_ARTIFACT, artifactText(title)),
    context.runtime.store.writeArtifact(context.session.sessionId, WORK_BODY_ARTIFACT, artifactText(body)),
    context.runtime.store.writeArtifact(context.session.sessionId, WORK_WORD_ARTIFACT, artifactText(word)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT, artifactText(title)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT, artifactText(body)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT, artifactText(word)),
    ...Object.entries(metadata).map(([name, value]) => context.runtime.store.writeMetadataValue(
      context.session.sessionId,
      name,
      value
    )),
    context.runtime.store.writeIssueWordMetadata(context.session.sessionId, word),
    context.runtime.store.deleteMetadataValues(context.session.sessionId, staleMetadata)
  ]);
}

function workDefinitionInputInteraction(status = STEP_STATUS.WAITING_FOR_INPUT, values = {}, {
  createGithubIssue = false,
  fieldLabels = {},
  prompt = "",
  submitLabel = "",
  title = ""
} = {}) {
  const reviewFieldsAreDisplayOnly = status === STEP_STATUS.CONFIRM_FILES && !createGithubIssue;
  const reviewIntents = status === STEP_STATUS.CONFIRM_FILES
    ? [
        {
          id: "continue_step",
          label: createGithubIssue ? "Create GitHub issue" : "Use this description",
          auditMessage: createGithubIssue
            ? "Issue draft accepted; creating GitHub issue."
            : "Work description accepted.",
          saveCurrentStepInputBeforeRun: true,
          style: "primary",
          type: createGithubIssue ? "action" : "continue",
          ...(createGithubIssue ? { actionId: "create_issue_on_gh" } : {})
        },
        {
          actionId: rejectIssueDraftActionId,
          id: rejectIssueDraftActionId,
          inputFields: [
            {
              kind: "textarea",
              label: "What should change?",
              name: "feedback",
              placeholder: createGithubIssue
                ? "Tell Codex how to improve the saved issue draft."
                : "Tell Codex how to improve the saved description.",
              requiredMessage: "Explain what should change before sending the improvement request.",
              rows: 4
            }
          ],
          label: "Send improvement request",
          style: "secondary",
          type: "action"
        }
      ]
    : [];
  return {
    fields: [
      {
        displayOnly: reviewFieldsAreDisplayOnly,
        kind: "text",
        label: fieldLabels.title || (createGithubIssue ? "Issue title" : "Work title"),
        name: "title",
        required: true,
        requiredMessage: fieldLabels.titleRequired || (createGithubIssue ? "Issue title is required." : "Work title is required."),
        value: values.title || ""
      },
      {
        displayOnly: reviewFieldsAreDisplayOnly,
        kind: "text",
        label: "Session label",
        name: "word",
        required: true,
        requiredMessage: "Session label is required.",
        value: values.word || ""
      },
      {
        displayOnly: reviewFieldsAreDisplayOnly,
        kind: "textarea",
        label: fieldLabels.body || (createGithubIssue ? "Issue body" : "Work description"),
        name: "body",
        required: true,
        requiredMessage: fieldLabels.bodyRequired || (createGithubIssue ? "Issue body is required." : "Work description is required."),
        value: values.body || ""
      }
    ],
    kind: "confirm_files_run_command",
    intents: reviewIntents,
    prompt: prompt || (status === STEP_STATUS.CONFIRM_FILES
      ? (createGithubIssue
          ? "Review the issue details, then create the GitHub issue."
          : "Review the work details, then continue without creating a GitHub issue.")
      : (createGithubIssue
          ? "Discuss the requested change, then submit the work title, session label, and description."
          : "Discuss the requested change, then submit the work title, session label, and description.")),
    submitKind: status === STEP_STATUS.CONFIRM_FILES
      ? STEP_INPUT_KIND.CONFIRM_FILES
      : STEP_INPUT_KIND.READY,
    submitLabel: submitLabel || (status === STEP_STATUS.CONFIRM_FILES ? "Save changes" : "Save details"),
    title: title || (createGithubIssue ? "Define issue" : "Define work")
  };
}

function seedDefinitionInputInteraction(status = STEP_STATUS.WAITING_FOR_INPUT, values = {}) {
  return workDefinitionInputInteraction(status, values, {
    fieldLabels: {
      body: "Seed description",
      bodyRequired: "Seed description is required.",
      title: "Seed title",
      titleRequired: "Seed title is required."
    },
    prompt: status === STEP_STATUS.CONFIRM_FILES
      ? "Review the seed details, then continue."
      : "Discuss the application foundation with Codex, then review the proposed seed details.",
    title: "Seed application"
  });
}

function seedDefinitionConversationInteraction(state = {}) {
  return promptWaitingForInputInteraction({
    actionId: draftSeedApplicationActionId,
    prompt: state.message || "Tell Codex what kind of application to seed, or ask it to ask simple setup questions.",
    submitLabel: "Send to Codex",
    title: "Seed application"
  });
}

function seedDefinitionPromptInstruction() {
  return [
    currentStepAgentResultInstruction({
      doneFields: {
        body: "Markdown seed proposal for read-only user review. Start with a short plain-language proposal. If technical details are useful, put them in a collapsed `<details><summary>Technical details</summary>...</details>` section after the simple proposal.",
        title: "Concise seed title.",
        word: "Short Vibe64 session label/word derived from the seed title."
      },
      doneMeaning: "You have enough information to propose the seed title, seed description, and Vibe64 session label for user review.",
      waitingForInputMeaning: "You need more information from the user before drafting the seed description."
    }),
    "",
    "Seed review format:",
    "- The seed review is display-only. Do not tell the user to edit it directly.",
    "- Keep the first part simple and user-facing.",
    "- Include advanced or implementation detail only when useful, inside one collapsed `<details>` block."
  ].join("\n");
}

const workDefinitionPhase = Object.freeze({
  CHOOSE_SOURCE: "choose_source",
  CREATING_ISSUE: "creating_issue",
  DRAFTING: "drafting",
  EXISTING_SELECTED: "existing_selected",
  REVIEW_DRAFT: "review_draft",
  SKIPPED: "skipped"
});

function workDefinitionSkipMessage(session = {}) {
  return normalizeText(session.metadata?.work_source) === "existing_pr"
    ? "Skipped: existing PR selected as the work anchor; no GitHub issue is required."
    : "No GitHub issue is required for this session.";
}

function workDefinitionSkipState(session = {}) {
  return machineState(STEP_STATUS.DONE, {
    message: workDefinitionSkipMessage(session),
    phase: workDefinitionPhase.SKIPPED,
    skipReason: workDefinitionSkipMessage(session)
  });
}

function workDefinitionSourceSelectionState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: workDefinitionPhase.CHOOSE_SOURCE,
    ...details
  });
}

function workDefinitionReviewState(details = {}) {
  return machineState(STEP_STATUS.CONFIRM_FILES, {
    phase: workDefinitionPhase.REVIEW_DRAFT,
    ...details
  });
}

function workDefinitionPromptIsActive(state = {}) {
  return [
    STEP_STATUS.ATTEMPTING_EXECUTION,
    STEP_STATUS.AWAITING_AGENT_RESULT,
    STEP_STATUS.WAITING_FOR_INPUT
  ].includes(state.status);
}

function workflowActionEnabled(session = {}, actionId = "") {
  const normalizedActionId = normalizeText(actionId);
  return Boolean((Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === normalizedActionId)?.enabled);
}

function workDefinitionResponseActionId(context = {}, state = {}) {
  const stateActionId = normalizeText(state.promptActionId);
  if (stateActionId) {
    return stateActionId;
  }
  return workflowActionEnabled(context.session, rejectIssueDraftActionId)
    ? rejectIssueDraftActionId
    : draftIssueActionId;
}

async function submitWorkDefinitionAgentResult(context = {}, machine = {}, input = {}) {
  assertAgentResultSource(context.session, input);
  const state = await readState(context, machine);
  const promptActionId = workDefinitionResponseActionId(context, state);
  switch (input.kind) {
    case STEP_INPUT_KIND.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: input.message,
        phase: workDefinitionPhase.DRAFTING,
        promptActionId,
        response: inputResponseText(input),
        source: input.source
      }));
      return;

    case STEP_INPUT_KIND.CONFIRM_FILES:
    case STEP_INPUT_KIND.READY:
      await writeWorkDefinitionFieldValues(context, input.fields);
      await writeState(context, machine, workDefinitionReviewState({
        response: inputResponseText(input),
        source: input.source
      }));
      return;

    default:
      throw unsupportedInputKind(input.kind, machine.stepId);
  }
}

const workDefinitionMachine = {
  promptActionId: draftIssueActionId,
  stepId: ISSUE_FILE_STEP_ID,

  initialState(context = {}) {
    const filesReady = workDefinitionArtifactsAreReady(context.session);
    if (githubIssueShouldBeSkipped(context.session) && filesReady) {
      return workDefinitionSkipState(context.session);
    }
    if ((githubIssueIsReused(context.session) || githubIssueShouldBeCreated(context.session)) && filesReady && metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE, {
        phase: workDefinitionPhase.EXISTING_SELECTED
      });
    }
    return filesReady
      ? workDefinitionReviewState()
      : workDefinitionSourceSelectionState();
  },

  async view(context = {}) {
    let state = await readState(context, this);
    const filesReady = workDefinitionArtifactsAreReady(context.session);
    const createGithubIssue = githubIssueShouldBeCreated(context.session);
    const skipGithubIssue = githubIssueShouldBeSkipped(context.session);
    if (skipGithubIssue && filesReady && state.status !== STEP_STATUS.CONFIRM_FILES && !workDefinitionPromptIsActive(state)) {
      state = workDefinitionSkipState(context.session);
    } else if ((githubIssueIsReused(context.session) || createGithubIssue) && filesReady && metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE, {
        phase: workDefinitionPhase.EXISTING_SELECTED
      });
    } else if (filesReady && state.status !== STEP_STATUS.CONFIRM_FILES && !workDefinitionPromptIsActive(state)) {
      state = workDefinitionReviewState({
        from: state.status
      });
    } else if (state.status === STEP_STATUS.DONE) {
      state = workDefinitionSourceSelectionState({
        from: STEP_STATUS.DONE,
        message: "Issue details are incomplete. Select the issue again or draft a new one."
      });
    }

    switch (state.status) {
      case STEP_STATUS.READY:
        return {
          actions: disableActions(context.session, {
            create_issue_on_gh: createGithubIssue
              ? "Save the issue details before creating the GitHub issue."
              : "This session continues without creating a GitHub issue.",
            [rejectIssueDraftActionId]: "Describe the work before requesting improvements."
          }),
          next: nextForSession(context.session, {
            disabledReason: "Describe the work before continuing."
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Describe the work before continuing."
          })
        };

      case STEP_STATUS.ATTEMPTING_EXECUTION:
        return promptStepWaitingView(context, this, state, "Wait for Vibe64 to create the GitHub issue.");

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        return promptStepWaitingView(context, this, state, "Wait for Codex to draft the work details.");

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.phase === workDefinitionPhase.CREATING_ISSUE) {
          return {
            actions: disableAction(context.session, "create_issue_on_gh", "Resolve the issue command before retrying."),
            interaction: commandFailureInteraction({
              prompt: state.message || "Could not create the GitHub issue. Explain what should happen, then retry.",
              title: "Issue command needs attention"
            }),
            next: nextForSession(context.session, {
              disabledReason: "Resolve the issue command before continuing."
            }),
            stepMachine: publicState(this, state)
          };
        }
        return promptStepWaitingForInputView(context, this, state, {
          actionId: workDefinitionResponseActionId(context, state),
          prompt: state.message || "Codex needs more information before it can draft the work description.",
          skipInput: LET_CODEX_DECIDE_INPUT,
          title: "Define work"
        });

      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readWorkDefinitionFieldValues(context);
        return {
          actions: skipGithubIssue
            ? disableAction(context.session, "create_issue_on_gh", "This session continues without creating a GitHub issue.")
            : context.session.actions,
          interaction: workDefinitionInputInteraction(STEP_STATUS.CONFIRM_FILES, values, {
            createGithubIssue
          }),
          next: nextForSession(context.session, {
            disabledReason: createGithubIssue ? "Create the GitHub issue before continuing." : "",
            enabled: !createGithubIssue
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || (createGithubIssue ? "Review the saved issue draft." : "Review the saved work description.")
          })
        };
      }

      case STEP_STATUS.DONE:
        return {
          actions: disableActions(context.session, {
            create_issue_on_gh: state.skipReason || "The GitHub issue state is already resolved.",
            [draftIssueActionId]: state.skipReason || "Work details are already saved.",
            [rejectIssueDraftActionId]: state.skipReason || "Work details are already saved."
          }),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Work details are ready."
          })
        };

      case STEP_STATUS.FAILED:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Resolve the work definition failure before continuing."
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Work definition failed."
          })
        };

      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Describe the work before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId === draftIssueActionId) {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: workDefinitionPhase.DRAFTING,
        promptActionId: context.actionId
      }));
      return;
    }

    if (context.actionId === "create_issue_on_gh") {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        phase: workDefinitionPhase.CREATING_ISSUE
      }));
      return;
    }

    if (context.actionId === rejectIssueDraftActionId) {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: workDefinitionPhase.DRAFTING,
        promptActionId: context.actionId
      }));
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId === "create_issue_on_gh") {
      if (await commandSucceeded(context, "issue_url")) {
        await writeState(context, this, machineState(STEP_STATUS.DONE, {
          phase: workDefinitionPhase.EXISTING_SELECTED
        }));
        return;
      }
      await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        from: STEP_STATUS.ATTEMPTING_EXECUTION,
        message: normalizeText(context.actionResult?.message) || "Could not create the GitHub issue.",
        output: normalizeText(context.actionResult?.output),
        phase: workDefinitionPhase.CREATING_ISSUE
      }));
      return;
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);

    switch (state.status) {
      case STEP_STATUS.READY:
        if (input.kind === STEP_INPUT_KIND.CONFIRM_FILES || input.kind === STEP_INPUT_KIND.READY) {
          await writeWorkDefinitionFieldValues(context, input.fields);
          await writeState(context, this, workDefinitionReviewState({
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        await submitWorkDefinitionAgentResult(context, this, input);
        return;

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.phase === workDefinitionPhase.CREATING_ISSUE && (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE)) {
          await writeState(context, this, workDefinitionReviewState({
            message: input.message,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        if (input.source === "codex") {
          await submitWorkDefinitionAgentResult(context, this, input);
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.CONFIRM_FILES:
        if (input.kind === STEP_INPUT_KIND.CONFIRM_FILES || input.kind === STEP_INPUT_KIND.READY) {
          await writeWorkDefinitionFieldValues(context, input.fields);
          await writeState(context, this, githubIssueShouldBeSkipped(context.session)
            ? workDefinitionSkipState(context.session)
            : workDefinitionReviewState({
                response: inputResponseText(input),
                source: input.source
              }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, workDefinitionSourceSelectionState({
            message: input.message,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("The issue step is already complete.", "vibe64_step_input_not_available");
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    if (![STEP_INPUT_KIND.READY, STEP_INPUT_KIND.CONFIRM_FILES].includes(input.kind)) {
      return "";
    }
    if (input.source === "codex") {
      return workDefinitionConversationMessage(context, input, { proposed: true });
    }
    if (input.source === "ui") {
      return workDefinitionConversationMessage(context, input);
    }
    return githubIssueShouldBeSkipped(context.session)
      ? "Work description saved."
      : "Issue draft submitted for review.";
  },

  promptInstruction() {
    return currentStepAgentResultInstruction({
      doneFields: {
        body: "Markdown work description with the requested change, context, and acceptance criteria.",
        title: "Concise work title.",
        word: "Short Vibe64 session label/word derived from the work title."
      },
      doneMeaning: "You have enough information to propose a work title, work description, and Vibe64 session label for user review.",
      waitingForInputMeaning: "You need more information from the user before drafting the work description."
    });
  }
};

const makePlanMachine = {
  promptActionId: "make_plan",
  stepId: planAndExecuteStepId,

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Ask Codex to make the plan before continuing.");
    }
  },

  async submitInput(context = {}) {
    return handlePlanPromptInput(context, this);
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Plan submitted for review."
      : "";
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_plan");
  },

  promptInstruction() {
    return planPresentationInstruction({
      doneMeaning: "The implementation plan has been written in the Codex response and is ready for execution.",
      planKind: "implementation",
      waitingForInputMeaning: "You cannot make a useful plan without a user decision or clarification."
    });
  }
};

const seedPlanMadeMachine = {
  ...makePlanMachine,
  promptActionId: "make_seed_plan",
  stepId: seedPlanMadeStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_seed_plan");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Seed plan submitted for review."
      : "";
  },

  promptInstruction() {
    return planPresentationInstruction({
      doneMeaning: "The seed implementation plan has been written in the Codex response and is ready for execution.",
      planKind: "seed implementation",
      waitingForInputMeaning: "You cannot make a useful seed plan without a user decision or clarification."
    });
  }
};

const executePlanMachine = {
  promptActionId: "execute_plan",
  stepId: planAndExecuteStepId,

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Ask Codex to execute the plan before continuing.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this);
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Implementation submitted for review."
      : "";
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_plan");
  },

  promptInstruction() {
    return currentStepAgentResultInstruction({
      doneMeaning: "The implementation work is complete enough to continue to review.",
      waitingForInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
    });
  }
};

const planAndExecutePhase = Object.freeze({
  EXECUTING: "executing",
  PLANNING: "planning",
  PLAN_READY: "plan_ready"
});

function planAndExecuteReadyState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: planAndExecutePhase.PLANNING,
    ...details
  });
}

function planAndExecutePlanReadyState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: planAndExecutePhase.PLAN_READY,
    ...details
  });
}

function planAndExecuteEffectivePhase(context = {}, state = {}) {
  const phase = normalizeText(state.phase);
  if (phase) {
    return phase;
  }
  if (metadataExists(context.session, IMPLEMENTATION_DONE_METADATA)) {
    return planAndExecutePhase.EXECUTING;
  }
  if (metadataExists(context.session, PLAN_READY_METADATA)) {
    return normalizeText(state.status) === STEP_STATUS.READY
      ? planAndExecutePhase.PLAN_READY
      : planAndExecutePhase.EXECUTING;
  }
  return planAndExecutePhase.PLANNING;
}

async function markPlanAndExecuteActionStarted(context = {}, machine = {}, {
  actionId = "",
  phase = ""
} = {}) {
  if (context.actionId !== actionId) {
    return;
  }
  const state = await readState(context, machine);
  switch (state.status) {
    case STEP_STATUS.READY:
    case STEP_STATUS.FAILED:
    case STEP_STATUS.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase,
        response: state.response,
        source: state.source
      }));
      return;
    case STEP_STATUS.AWAITING_AGENT_RESULT:
    case STEP_STATUS.DONE:
    default:
      return;
  }
}

const planAndExecuteMachine = {
  promptActionId: "make_plan",
  stepId: planAndExecuteStepId,

  initialState(context = {}) {
    if (metadataExists(context.session, IMPLEMENTATION_DONE_METADATA)) {
      return machineState(STEP_STATUS.DONE, {
        phase: planAndExecutePhase.EXECUTING
      });
    }
    if (metadataExists(context.session, PLAN_READY_METADATA)) {
      return planAndExecutePlanReadyState();
    }
    return planAndExecuteReadyState();
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, IMPLEMENTATION_DONE_METADATA)) {
      state = machineState(STEP_STATUS.DONE, {
        phase: planAndExecutePhase.EXECUTING
      });
    } else if (
      metadataExists(context.session, PLAN_READY_METADATA) &&
      ![STEP_STATUS.AWAITING_AGENT_RESULT, STEP_STATUS.WAITING_FOR_INPUT].includes(state.status)
    ) {
      state = planAndExecutePlanReadyState({
        from: state.status
      });
    }
    const phase = planAndExecuteEffectivePhase(context, state);
    if (!state.phase && phase) {
      state = {
        ...state,
        phase
      };
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state, {
          actionId: phase === planAndExecutePhase.EXECUTING ? "execute_plan" : "make_plan",
          prompt: state.message || "Codex needs more information before this step can continue.",
          skipInput: LET_CODEX_DECIDE_INPUT
        });
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(
          context,
          this,
          state,
          phase === planAndExecutePhase.PLAN_READY
            ? "Ask Codex to execute the plan before continuing."
            : "Ask Codex to make the plan before continuing."
        );
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const phase = planAndExecuteEffectivePhase(context, state);
    const input = normalizeMachineInput(context.input);
    if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
      assertAgentResultSource(context.session, input);
    }

    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            phase,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            phase,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          if (phase === planAndExecutePhase.EXECUTING) {
            await context.runtime.store.writeMetadataValue(context.session.sessionId, IMPLEMENTATION_DONE_METADATA, "yes");
            await writeState(context, this, machineState(STEP_STATUS.DONE, {
              message: input.message,
              phase: planAndExecutePhase.EXECUTING,
              source: input.source
            }));
            return;
          }
          await writeAcceptedPlanArtifacts(context, input);
          await context.runtime.store.writeMetadataValue(context.session.sessionId, PLAN_READY_METADATA, "yes");
          await writeState(context, this, planAndExecutePlanReadyState({
            message: input.message,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("This step is already complete.", "vibe64_step_input_not_available");
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    if (input.kind !== STEP_INPUT_KIND.READY) {
      return "";
    }
    return planAndExecuteEffectivePhase(context, context.session.stepMachine) === planAndExecutePhase.EXECUTING
      ? "Implementation submitted for review."
      : "Plan submitted for review.";
  },

  async actionStarted(context = {}) {
    await markPlanAndExecuteActionStarted(context, this, {
      actionId: "make_plan",
      phase: planAndExecutePhase.PLANNING
    });
    await markPlanAndExecuteActionStarted(context, this, {
      actionId: "execute_plan",
      phase: planAndExecutePhase.EXECUTING
    });
  },

  promptInstruction({ action = {} } = {}) {
    return normalizeText(action.id) === "execute_plan"
      ? currentStepAgentResultInstruction({
          doneMeaning: "The implementation work is complete enough to continue to review.",
          waitingForInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
        })
      : planPresentationInstruction({
          doneMeaning: "The implementation plan has been written in the Codex response and is ready for execution.",
          planKind: "implementation",
          waitingForInputMeaning: "You cannot make a useful plan without a user decision or clarification."
        });
  }
};

const seedPlanExecutedMachine = {
  ...executePlanMachine,
  promptActionId: "execute_seed_plan",
  stepId: seedPlanExecutedStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_seed_plan");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Seed implementation submitted for review."
      : "";
  },

  promptInstruction() {
    return currentStepAgentResultInstruction({
      doneMeaning: "The seed implementation work is complete enough to continue.",
      waitingForInputMeaning: "You cannot continue seeding without a user decision or missing project detail."
    });
  }
};

const deepUiCheckMachine = {
  ...executePlanMachine,
  promptActionId: "run_deep_ui_check",
  stepId: deepUiCheckRunStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deep_ui_check");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "The user interface check is done."
      : "";
  },

  promptInstruction() {
    return currentStepAgentResultInstruction({
      doneMeaning: "The deep UI check has been completed or intentionally found no required fix.",
      waitingForInputMeaning: "You cannot complete the UI check without a user decision."
    });
  }
};

const reviewAndValidatePhase = Object.freeze({
  REVIEW: "review",
  VALIDATION: "validation"
});

const reviewAndValidateCommandActionIds = Object.freeze(["update_code_index", "run_automated_checks"]);

function reviewAndValidateComplete(session = {}) {
  return metadataExists(session, REVIEW_DESLOP_COMPLETED_METADATA) &&
    metadataExists(session, "code_index_updated") &&
    metadataExists(session, "automated_checks_passed");
}

const reviewAndValidateMachine = {
  promptActionId: "run_deslop",
  stepId: reviewAndValidateStepId,

  initialState(context = {}) {
    if (reviewAndValidateComplete(context.session)) {
      return machineState(STEP_STATUS.DONE);
    }
    return machineState(STEP_STATUS.READY, {
      phase: metadataExists(context.session, REVIEW_DESLOP_COMPLETED_METADATA)
        ? reviewAndValidatePhase.VALIDATION
        : reviewAndValidatePhase.REVIEW
    });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (reviewAndValidateComplete(context.session)) {
      state = machineState(STEP_STATUS.DONE);
    } else if (
      metadataExists(context.session, REVIEW_DESLOP_COMPLETED_METADATA) &&
      ![STEP_STATUS.AWAITING_AGENT_RESULT, STEP_STATUS.ATTEMPTING_EXECUTION, STEP_STATUS.WAITING_FOR_INPUT].includes(state.status)
    ) {
      state = machineState(STEP_STATUS.READY, {
        phase: reviewAndValidatePhase.VALIDATION
      });
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return state.phase === reviewAndValidatePhase.VALIDATION
          ? {
              interaction: commandFailureInteraction({
                prompt: state.message || "The validation command failed. Explain what should happen, then retry validation.",
                title: state.title || "Validation needs attention"
              }),
              next: nextForSession(context.session, {
                disabledReason: "Run review/deslop, update the code index, and run automated checks successfully before continuing."
              }),
              stepMachine: publicState(this, state)
            }
          : promptStepWaitingForInputView(context, this, state, {
              actionId: "run_deslop",
              prompt: state.message || "Codex needs more information before review/deslop can continue.",
              skipInput: LET_CODEX_DECIDE_INPUT,
              title: "Review needs input"
            });
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(
          context,
          this,
          state,
          "Run review/deslop, update the code index, and run automated checks successfully before continuing."
        );
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
      assertAgentResultSource(context.session, input);
    }

    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            phase: state.phase || reviewAndValidatePhase.REVIEW,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            phase: state.phase || reviewAndValidatePhase.REVIEW,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY) {
          await context.runtime.store.writeMetadataValue(
            context.session.sessionId,
            REVIEW_DESLOP_COMPLETED_METADATA,
            "yes"
          );
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            phase: reviewAndValidatePhase.VALIDATION,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.DONE:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      default:
        throw vibe64Error("This step cannot accept input right now.", "vibe64_step_input_not_available");
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Review/deslop completed."
      : "";
  },

  async actionStarted(context = {}) {
    if (context.actionId === "run_deslop") {
      return markPromptActionStarted(context, this, "run_deslop");
    }
    if (!reviewAndValidateCommandActionIds.includes(context.actionId)) {
      return;
    }
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
          actionId: context.actionId,
          phase: reviewAndValidatePhase.VALIDATION
        }));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (!reviewAndValidateCommandActionIds.includes(context.actionId)) {
      return;
    }
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (reviewAndValidateComplete(await context.runtime.getSession(context.session.sessionId))) {
          await writeState(context, this, machineState(STEP_STATUS.DONE));
          return;
        }
        if (actionCompleted(context.actionResult)) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            phase: reviewAndValidatePhase.VALIDATION
          }));
          return;
        }
        await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
          from: STEP_STATUS.ATTEMPTING_EXECUTION,
          message: normalizeText(context.actionResult?.message),
          output: normalizeText(context.actionResult?.output),
          phase: reviewAndValidatePhase.VALIDATION,
          title: "Validation needs attention"
        }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  promptInstruction() {
    return currentStepAgentResultInstruction({
      doneMeaning: "The review/deslop loop has completed and only acceptable low-risk findings remain.",
      waitingForInputMeaning: "You cannot complete review/deslop without a user decision."
    });
  }
};

const reportAndKnowledgePhase = Object.freeze({
  KNOWLEDGE: "knowledge",
  REPORT: "report"
});

function reportAndKnowledgeComplete(session = {}) {
  return artifactIsReady(session, REPORT_ARTIFACT) &&
    metadataExists(session, PROJECT_KNOWLEDGE_UPDATED_METADATA);
}

const reportAndKnowledgeUpdatedMachine = {
  promptActionId: "write_report",
  stepId: reportAndKnowledgeUpdatedStepId,

  initialState(context = {}) {
    if (reportAndKnowledgeComplete(context.session)) {
      return machineState(STEP_STATUS.DONE);
    }
    return machineState(STEP_STATUS.READY, {
      phase: artifactIsReady(context.session, REPORT_ARTIFACT)
        ? reportAndKnowledgePhase.KNOWLEDGE
        : reportAndKnowledgePhase.REPORT
    });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (reportAndKnowledgeComplete(context.session)) {
      state = machineState(STEP_STATUS.DONE);
    } else if (
      artifactIsReady(context.session, REPORT_ARTIFACT) &&
      ![STEP_STATUS.AWAITING_AGENT_RESULT, STEP_STATUS.WAITING_FOR_INPUT].includes(state.status)
    ) {
      state = machineState(STEP_STATUS.READY, {
        phase: reportAndKnowledgePhase.KNOWLEDGE
      });
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state, {
          actionId: state.phase === reportAndKnowledgePhase.KNOWLEDGE ? "update_project_knowledge" : "write_report",
          prompt: state.message || "Codex needs more information before this step can continue.",
          skipInput: LET_CODEX_DECIDE_INPUT
        });
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Write the report and update project knowledge before continuing.");
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
      assertAgentResultSource(context.session, input);
    }

    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            phase: state.phase || reportAndKnowledgePhase.REPORT,
            source: input.source
          }));
          return;
        }
        if (input.kind !== STEP_INPUT_KIND.READY && input.kind !== STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          throw unsupportedInputKind(input.kind, this.stepId);
        }
        if (state.phase === reportAndKnowledgePhase.KNOWLEDGE) {
          await context.runtime.store.writeMetadataValue(
            context.session.sessionId,
            PROJECT_KNOWLEDGE_UPDATED_METADATA,
            "yes"
          );
          await writeState(context, this, machineState(STEP_STATUS.DONE, {
            message: input.message,
            phase: reportAndKnowledgePhase.KNOWLEDGE,
            source: input.source
          }));
          return;
        }
        await writePromptResponseArtifact(context, REPORT_ARTIFACT, input.fields.response || input.text);
        await writeState(context, this, machineState(STEP_STATUS.READY, {
          message: input.message,
          phase: reportAndKnowledgePhase.KNOWLEDGE,
          source: input.source
        }));
        return;

      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("This step is already complete.", "vibe64_step_input_not_available");
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    if (input.kind !== STEP_INPUT_KIND.READY) {
      return "";
    }
    return context.session.stepMachine?.phase === reportAndKnowledgePhase.KNOWLEDGE
      ? "Project knowledge update completed."
      : "Report submitted for review.";
  },

  async actionStarted(context = {}) {
    const phaseByActionId = {
      update_project_knowledge: reportAndKnowledgePhase.KNOWLEDGE,
      write_report: reportAndKnowledgePhase.REPORT
    };
    const phase = phaseByActionId[context.actionId];
    if (!phase) {
      return;
    }
    const state = await readState(context, this);
    if (![STEP_STATUS.READY, STEP_STATUS.FAILED, STEP_STATUS.WAITING_FOR_INPUT].includes(state.status)) {
      return;
    }
    await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
      phase,
      response: state.response,
      source: state.source
    }));
  },

  promptInstruction({ action = {} } = {}) {
    return normalizeText(action.id) === "update_project_knowledge"
      ? currentStepAgentResultInstruction({
          doneMeaning: "Project knowledge has been updated or there is no adapter-supported project knowledge to update.",
          waitingForInputMeaning: "You cannot update project knowledge without a user decision."
        })
      : currentStepAgentResultInstruction({
          doneFields: {
            response: "Markdown session report"
          },
          doneMeaning: "The report text is complete and should be saved by Studio as the session report.",
          waitingForInputMeaning: "You cannot write the report without a user decision or missing context."
        });
  }
};

const coreCodingSteps = Object.freeze(Object.values(Object.freeze({
  [SEED_APPLICATION_STEP_ID]: {
    config: {
      draftReady: workDefinitionArtifactsAreReady,
      completionMessage: "Seed issue draft submitted for review.",
      initialDetails: {
        doing: "discussion"
      },
      interaction: seedDefinitionInputInteraction,
      nextWhenDrafting: {
        disabledReason: "Define and save the seed issue before continuing."
      },
      nextWhenWorking: {
        disabledReason: "Define and save the seed issue before continuing."
      },
      promptActionId: draftSeedApplicationActionId,
      promptInstruction: seedDefinitionPromptInstruction,
      readValues: readWorkDefinitionFieldValues,
      saveValues: writeWorkDefinitionFieldValues,
      unsupportedDoneMessage: "The seed definition step cannot accept input right now.",
      waitingForInputState: (input = {}) => ({
        doing: "discussion",
        message: input.message
      }),
      waitingInteraction: seedDefinitionConversationInteraction
    },
    definition: coreCodingStepDefinitionsById[SEED_APPLICATION_STEP_ID],
    factoryId: "editable_artifact_review",
    id: SEED_APPLICATION_STEP_ID
  },
  [ISSUE_FILE_STEP_ID]: {
    definition: coreCodingStepDefinitionsById[ISSUE_FILE_STEP_ID],
    id: ISSUE_FILE_STEP_ID,
    machine: workDefinitionMachine
  },
  [seedPlanMadeStepId]: {
    definition: coreCodingStepDefinitionsById[seedPlanMadeStepId],
    id: seedPlanMadeStepId,
    machine: seedPlanMadeMachine
  },
  [seedPlanExecutedStepId]: {
    definition: coreCodingStepDefinitionsById[seedPlanExecutedStepId],
    id: seedPlanExecutedStepId,
    machine: seedPlanExecutedMachine
  },
  [planAndExecuteStepId]: {
    definition: coreCodingStepDefinitionsById[planAndExecuteStepId],
    id: planAndExecuteStepId,
    machine: planAndExecuteMachine
  },
  [implementationReviewedStepId]: {
    config: {
      completionMessage: "Initial human review turn completed.",
      completionPolicy: {
        decidedBy: "ai",
        enoughWhen: "the requested focused tweak has either been made and focused checks run when practical, or you can clearly report that no code change is needed.",
        waitingForInputMeaning: "You cannot complete the focused review tweak without a user decision or missing project detail."
      },
      promptActionId: humanReviewConversationActionId,
      waitingMessage: "Wait for Codex to finish this review turn."
    },
    definition: coreCodingStepDefinitionsById[implementationReviewedStepId],
    factoryId: "chat_with_ai",
    id: implementationReviewedStepId
  },
  [deepUiCheckRunStepId]: {
    definition: coreCodingStepDefinitionsById[deepUiCheckRunStepId],
    id: deepUiCheckRunStepId,
    machine: deepUiCheckMachine
  },
  [reviewAndValidateStepId]: {
    definition: coreCodingStepDefinitionsById[reviewAndValidateStepId],
    id: reviewAndValidateStepId,
    machine: reviewAndValidateMachine
  },
  [changesAcceptedStepId]: {
    config: {
      completionMessage: "Final human review turn completed.",
      completionPolicy: {
        decidedBy: "ai",
        enoughWhen: "the requested final tweak has either been made or you can clearly report the blocker; Vibe64 can then rerun review and validation.",
        waitingForInputMeaning: "You cannot complete the final review tweak without a user decision or missing project detail."
      },
      promptActionId: finalReviewConversationActionId,
      waitingMessage: "Wait for Codex to finish this review turn."
    },
    definition: coreCodingStepDefinitionsById[changesAcceptedStepId],
    factoryId: "chat_with_ai",
    id: changesAcceptedStepId
  },
  [reportAndKnowledgeUpdatedStepId]: {
    definition: coreCodingStepDefinitionsById[reportAndKnowledgeUpdatedStepId],
    id: reportAndKnowledgeUpdatedStepId,
    machine: reportAndKnowledgeUpdatedMachine
  }
})));

const coreCodingWorkflowModule = Object.freeze({
  id: moduleId,
  steps: coreCodingSteps,
  workflowDefinitions: coreCodingWorkflowDefinitions
});

const _testing = deepFreeze({
  groupIds: CORE_CODING_WORKFLOW_GROUP_IDS,
  moduleId,
  ownedStepIds: [
    SEED_APPLICATION_STEP_ID,
    ISSUE_FILE_STEP_ID,
    seedPlanMadeStepId,
    seedPlanExecutedStepId,
    planAndExecuteStepId,
    implementationReviewedStepId,
    deepUiCheckRunStepId,
    reviewAndValidateStepId,
    changesAcceptedStepId,
    reportAndKnowledgeUpdatedStepId
  ],
  workflowDefinitionIds: VIBE64_WORKFLOW_DEFINITION_IDS
});

export {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  _testing,
  coreCodingWorkflowModule,
  finishOffWorkflowGroup,
  qaWorkflowGroup
};
