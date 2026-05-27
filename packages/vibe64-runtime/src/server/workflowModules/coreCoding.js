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
  REPORT_ARTIFACT
} from "../workflowArtifacts.js";
import {
  buildAgentConversationActionDefinition,
  buildAgentConversationStepDefinition
} from "../workflowDefinitionBuilders.js";
import {
  coreLifecycleWorkflowIntentHandlers
} from "./coreLifecycle.js";
import { when } from "../workflowConditions.js";
import {
  STEP_INPUT_KIND,
  STEP_STATUS,
  assertAgentResultSource,
  artifactIsReady,
  artifactText,
  commandFailureInteraction,
  commandSucceeded,
  currentStepHelperInstruction,
  disableAction,
  handleStandardPromptInput,
  machineState,
  markPromptActionStarted,
  metadataExists,
  nextForSession,
  normalizeMachineInput,
  promptStepDoneView,
  promptStepWaitingForInputView,
  promptStepWaitingView,
  publicState,
  readState,
  requireInputValue,
  unsupportedInputKind,
  writeState
} from "../workflowStepMachineHelpers.js";

const moduleId = "core.coding";

const VIBE64_WORKFLOW_DEFINITION_IDS = deepFreeze({
  BIG_FEATURE: "big_feature",
  GENERAL_CODING: "general_coding",
  SEED_APPLICATION: "seed_application"
});
const DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID = VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE;

const agentConversationStepId = "agent_conversation";
const changesAcceptedStepId = "changes_accepted";
const deepUiCheckRunStepId = "deep_ui_check_run";
const implementationReviewedStepId = "implementation_reviewed";
const issueSubmittedStepId = "issue_submitted";
const planExecutedStepId = "plan_executed";
const planMadeStepId = "plan_made";
const projectKnowledgeUpdatedStepId = "project_knowledge_updated";
const reportCreatedStepId = "report_created";
const reviewRunStepId = "review_run";
const seedPlanExecutedStepId = "seed_plan_executed";
const seedPlanMadeStepId = "seed_plan_made";
const finalReviewConversationActionId = "final_review_conversation";
const humanReviewConversationActionId = "human_review_conversation";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const draftIssueActionId = "draft_issue";
const rejectIssueDraftActionId = "reject_issue_draft";
const SEED_APPLICATION_STEP_ID = "seed_application_defined";

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
const coreCodingSeedWorkflowIntentHandlers = deepFreeze({
  ...coreLifecycleWorkflowIntentHandlers,
  [changesAcceptedStepId]: finalReviewIntentHandlers
});
const coreCodingStandardWorkflowIntentHandlers = deepFreeze({
  ...coreCodingSeedWorkflowIntentHandlers,
  [deepUiCheckRunStepId]: optionalCheckIntentHandlers
});

function createIssueOnGithubAction() {
  return {
    adapterCapability: "create_issue_on_gh",
    disabledReason: "Create the issue file before submitting it to GitHub.",
    disabledWhen: [when.metadataExists("issue_url")],
    disabledWhenReason: "The GitHub issue already exists.",
    enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_WORD_ARTIFACT, ISSUE_BODY_ARTIFACT)],
    enabledWhenReason: "Create the issue file before submitting it to GitHub.",
    icon: "github",
    id: "create_issue_on_gh",
    label: "Create issue on GH",
    type: "command"
  };
}

const coreCodingStepDefinitionsById = deepFreeze({
  [SEED_APPLICATION_STEP_ID]: {
    actions: [],
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
    rewindCleanup: {
      actionResults: [],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: ["issue_title", ISSUE_WORD_ARTIFACT]
    }
  },
  [ISSUE_FILE_STEP_ID]: {
    actions: [
      {
        adapterCapability: "use_existing_issue",
        disabledReason: "Issue details are already saved.",
        disabledWhen: [
          when.metadataExists("issue_url"),
          when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)
        ],
        icon: "github",
        id: "use_existing_issue",
        inputFields: [
          {
            label: "Issue URL or number",
            name: "issueRef",
            placeholder: "123, #123, or https://github.com/org/repo/issues/123",
            requiredMessage: "Issue URL or number is required."
          }
        ],
        label: "Use existing issue",
        type: "adapter"
      },
      {
        disabledReason: "Issue details are already saved.",
        disabledWhen: [
          when.metadataExists("issue_url"),
          when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)
        ],
        icon: "message-square-plus",
        id: draftIssueActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "What do you want Vibe64 to work on?",
            name: "conversationRequest",
            placeholder: "Describe the feature, bug, or change you want.",
            requiredMessage: "Describe what you want Vibe64 to work on."
          }
        ],
        label: "Make my own issue",
        promptId: draftIssueActionId,
        recordsConversationTurn: true,
        type: "prompt"
      },
      {
        disabledReason: "Draft an issue before rejecting it.",
        disabledWhen: [when.metadataExists("issue_url")],
        disabledWhenReason: "An existing issue is already selected.",
        enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)],
        enabledWhenReason: "Draft an issue before rejecting it.",
        icon: "rotate-ccw",
        id: rejectIssueDraftActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "What should change?",
            name: "feedback",
            placeholder: "Tell Codex what was wrong or missing.",
            requiredMessage: "Explain what should change before drafting again."
          }
        ],
        label: "Reject and revise",
        type: "record"
      }
    ],
    autopilot: {
      kind: "issue_discussion",
      stop: true
    },
    description: "Define a new issue or select an existing GitHub issue.",
    id: ISSUE_FILE_STEP_ID,
    label: "Define or select issue",
    next: {
      disabledReason: "Discuss and finalise issue before continuing.",
      enabledWhen: [
        when.any(
          when.metadataExists("issue_url"),
          when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)
        )
      ]
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: "use_existing_issue",
            id: "use_existing_issue",
            label: "Use existing issue",
            style: "primary",
            type: "action"
          },
          {
            actionId: draftIssueActionId,
            id: draftIssueActionId,
            label: "Make my own issue",
            style: "secondary",
            type: "action"
          }
        ],
        screen: {
          kind: "issue_source",
          message: "Enter a GitHub issue number, or draft a new issue from a description.",
          primaryIntentId: "use_existing_issue",
          title: "Define or select issue"
        }
      }
    },
    rewindCleanup: {
      actionResults: ["use_existing_issue", draftIssueActionId, rejectIssueDraftActionId],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: ["issue_url", "issue_number", "issue_title", "issue_source", ISSUE_WORD_ARTIFACT]
    }
  },
  [issueSubmittedStepId]: {
    actions: [
      createIssueOnGithubAction()
    ],
    autopilot: {
      actionId: "create_issue_on_gh",
      completeWhen: [when.metadataExists("issue_url")],
      label: "Edit and submit issue"
    },
    description: "Review the issue files and submit the GitHub issue.",
    id: issueSubmittedStepId,
    label: "Edit and submit issue",
    next: {
      enabledWhen: [when.metadataExists("issue_url")]
    },
    rewindCleanup: {
      actionResults: ["create_issue_on_gh"],
      metadata: ["issue_url", "issue_number", "issue_title"]
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
      actionResults: ["make_seed_plan"]
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
  [planMadeStepId]: {
    actions: [
      {
        id: "make_plan",
        label: "Make plan",
        promptId: "make_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "make_plan",
      label: "Make plan"
    },
    description: "Ask Codex to create the implementation plan.",
    id: planMadeStepId,
    label: "Make plan",
    rewindCleanup: {
      actionResults: ["make_plan"]
    }
  },
  [planExecutedStepId]: {
    actions: [
      {
        id: "execute_plan",
        label: "Execute plan",
        promptId: "execute_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "execute_plan",
      label: "Execute plan"
    },
    description: "Ask Codex to execute the plan.",
    id: planExecutedStepId,
    label: "Execute plan",
    rewindCleanup: {
      actionResults: ["execute_plan"]
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
    label: "Human review",
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
        screen: {
          kind: "review",
          message: "Try the work now. Ask Codex for small tweaks, or continue when it looks right.",
          sections: ["launch_controls", "report_preview", "response_preview"],
          title: "Human review",
          variant: "implementation"
        }
      }
    },
    rewindCleanup: {
      actionResults: [humanReviewConversationActionId],
      artifacts: [HUMAN_INPUT_RESPONSE_ARTIFACT]
    }
  },
  [agentConversationStepId]: buildAgentConversationStepDefinition({
    actionLabel: "Ask Codex for changes",
    description: "Ask Codex to make focused code changes while you inspect and steer the work.",
    id: agentConversationStepId,
    inputLabel: "What should Codex change?",
    inputPlaceholder: "Describe the code change, cleanup, bug fix, or follow-up request.",
    label: "Make changes",
    responseArtifact: HUMAN_INPUT_RESPONSE_ARTIFACT
  }),
  [deepUiCheckRunStepId]: {
    actions: [
      {
        id: "run_deep_ui_check",
        label: "Run deep UI check",
        promptId: "run_deep_ui_check",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "run_deep_ui_check",
      label: "Run deep UI check",
      userDecision: true
    },
    description: "Run the deeper UI review when the target supports it.",
    id: deepUiCheckRunStepId,
    label: "Run deep UI check",
    presentation: {
      decision: {
        intents: [
          {
            actionId: "run_deep_ui_check",
            id: "run_optional_check",
            style: "primary",
            type: "action"
          },
          {
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
  [reviewRunStepId]: {
    actions: [
      {
        id: "run_deslop",
        label: "Run deslop",
        promptId: "run_deslop",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "run_deslop",
      label: "Run deslop"
    },
    description: "Run the review/deslop prompt.",
    id: reviewRunStepId,
    label: "Run review/deslop",
    rewindCleanup: {
      actionResults: ["run_deslop"]
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
    label: "Final review",
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
            label: "Review diff"
          },
          {
            id: "accept_review",
            label: "Accept and finalize",
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
        screen: {
          kind: "review",
          message: "Review the validated work before Autopilot writes the report and commits.",
          sections: ["launch_controls", "report_preview", "response_preview"],
          title: "Final review",
          variant: "final"
        }
      }
    },
    rewindCleanup: {
      actionResults: [finalReviewConversationActionId],
      metadata: ["autopilot_final_review_followup"]
    }
  },
  [reportCreatedStepId]: {
    actions: [
      {
        id: "write_report",
        label: "Write report",
        promptId: "write_report",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "write_report",
      completeWhen: [when.artifactReady(REPORT_ARTIFACT)],
      label: "Write report"
    },
    description: "Write the local report explaining what changed and why.",
    id: reportCreatedStepId,
    label: "Write report",
    next: {
      disabledReason: "Write the session report before updating project knowledge.",
      enabledWhen: [when.artifactReady(REPORT_ARTIFACT)]
    },
    rewindCleanup: {
      actionResults: ["write_report"],
      artifacts: [REPORT_ARTIFACT]
    }
  },
  [projectKnowledgeUpdatedStepId]: {
    actions: [
      {
        id: "update_project_knowledge",
        label: "Update project knowledge",
        promptId: "update_project_knowledge",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "update_project_knowledge",
      label: "Update project knowledge"
    },
    description: "Update adapter-supported project knowledge.",
    id: projectKnowledgeUpdatedStepId,
    label: "Update project knowledge",
    rewindCleanup: {
      actionResults: ["update_project_knowledge"]
    }
  }
});

const coreCodingWorkflowDefinitions = deepFreeze([
  {
    description: "Create the initial application scaffold and local development foundation.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
    intentHandlers: coreCodingSeedWorkflowIntentHandlers,
    label: "Seed application",
    sessionWord: "seeding",
    steps: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      SEED_APPLICATION_STEP_ID,
      seedPlanMadeStepId,
      seedPlanExecutedStepId,
      "dependencies_installed",
      "project_validated",
      {
        rejectTo: seedPlanMadeStepId,
        recheckTo: "project_validated",
        stepId: changesAcceptedStepId
      },
      reportCreatedStepId,
      projectKnowledgeUpdatedStepId,
      "changes_committed",
      "create_pull_request",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ],
    userSelectable: false
  },
  {
    description: "Plan, implement, review, validate, commit, create a PR, and optionally merge.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE,
    intentHandlers: coreCodingStandardWorkflowIntentHandlers,
    label: "Big feature",
    steps: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      ISSUE_FILE_STEP_ID,
      issueSubmittedStepId,
      planMadeStepId,
      planExecutedStepId,
      implementationReviewedStepId,
      deepUiCheckRunStepId,
      reviewRunStepId,
      "project_validated",
      {
        rejectTo: planMadeStepId,
        recheckTo: reviewRunStepId,
        stepId: changesAcceptedStepId
      },
      reportCreatedStepId,
      projectKnowledgeUpdatedStepId,
      "changes_committed",
      "create_pull_request",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ],
    userSelectable: true
  },
  {
    description: "Make focused code changes with Codex, review, validate, commit, create a PR, and optionally merge.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.GENERAL_CODING,
    intentHandlers: coreCodingStandardWorkflowIntentHandlers,
    label: "General coding",
    sessionWord: "coding",
    steps: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      agentConversationStepId,
      deepUiCheckRunStepId,
      reviewRunStepId,
      "project_validated",
      {
        rejectTo: agentConversationStepId,
        recheckTo: reviewRunStepId,
        stepId: changesAcceptedStepId
      },
      reportCreatedStepId,
      projectKnowledgeUpdatedStepId,
      "changes_committed",
      "create_pull_request",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ],
    userSelectable: true
  }
]);

function issueFilesAreReady(session = {}) {
  return [
    ISSUE_TITLE_ARTIFACT,
    ISSUE_WORD_ARTIFACT,
    ISSUE_BODY_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
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

async function readIssueFieldValues(context = {}) {
  const [title, body, word] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title),
    word: normalizeText(word)
  };
}

async function writeIssueFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Issue title is required.");
  const body = requireInputValue(fields.body, "Issue body is required.");
  const word = requireInputValue(fields.word, "Session label is required.");

  await Promise.all([
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT, artifactText(title)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT, artifactText(body)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT, artifactText(word)),
    context.runtime.store.writeMetadataValue(context.session.sessionId, "issue_title", title),
    context.runtime.store.writeIssueWordMetadata(context.session.sessionId, word)
  ]);
}

function issueInputInteraction(status = STEP_STATUS.WAITING_FOR_INPUT, values = {}) {
  const reviewIntents = status === STEP_STATUS.CONFIRM_FILES
    ? [
        {
          id: "continue_step",
          label: "Accept saved issue",
          style: "primary",
          type: "continue"
        },
        {
          actionId: rejectIssueDraftActionId,
          id: rejectIssueDraftActionId,
          label: "Reject and revise",
          style: "secondary",
          type: "action"
        }
      ]
    : [];
  return {
    fields: [
      {
        kind: "text",
        label: "Issue title",
        name: "title",
        required: true,
        requiredMessage: "Issue title is required.",
        value: values.title || ""
      },
      {
        kind: "text",
        label: "Session label",
        name: "word",
        required: true,
        requiredMessage: "Session label is required.",
        value: values.word || ""
      },
      {
        kind: "textarea",
        label: "Issue body",
        name: "body",
        required: true,
        requiredMessage: "Issue body is required.",
        value: values.body || ""
      }
    ],
    kind: "confirm_files_run_command",
    intents: reviewIntents,
    prompt: status === STEP_STATUS.CONFIRM_FILES
      ? "Review the issue details. Save changes here, or continue to create the GitHub issue."
      : "Discuss the requested change, then submit the issue title, session label, and issue body.",
    submitKind: status === STEP_STATUS.CONFIRM_FILES
      ? STEP_INPUT_KIND.CONFIRM_FILES
      : STEP_INPUT_KIND.READY,
    submitLabel: status === STEP_STATUS.CONFIRM_FILES ? "Update issue" : "Save issue",
    title: "Define issue"
  };
}

const issueFilePhase = Object.freeze({
  CHOOSE_SOURCE: "choose_source",
  DRAFTING: "drafting",
  EXISTING_SELECTED: "existing_selected",
  REVIEW_DRAFT: "review_draft",
  SELECTING_EXISTING: "selecting_existing"
});

async function clearIssueFieldValues(context = {}) {
  await Promise.all([
    context.runtime.store.deleteArtifacts(context.session.sessionId, [
      ISSUE_TITLE_ARTIFACT,
      ISSUE_BODY_ARTIFACT,
      ISSUE_WORD_ARTIFACT
    ]),
    context.runtime.store.deleteMetadataValues(context.session.sessionId, [
      "issue_title",
      "issue_source",
      ISSUE_WORD_ARTIFACT
    ])
  ]);
}

function issueSourceSelectionState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: issueFilePhase.CHOOSE_SOURCE,
    ...details
  });
}

function issueDraftReviewState(details = {}) {
  return machineState(STEP_STATUS.CONFIRM_FILES, {
    phase: issueFilePhase.REVIEW_DRAFT,
    ...details
  });
}

async function submitIssueDraftAgentResult(context = {}, machine = {}, input = {}) {
  assertAgentResultSource(context.session, input);
  switch (input.kind) {
    case STEP_INPUT_KIND.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: input.message,
        phase: issueFilePhase.DRAFTING,
        response: input.response,
        source: input.source
      }));
      return;

    case STEP_INPUT_KIND.CONFIRM_FILES:
    case STEP_INPUT_KIND.READY:
      await writeIssueFieldValues(context, input.fields);
      await writeState(context, machine, issueDraftReviewState({
        response: input.response,
        source: input.source
      }));
      return;

    default:
      throw unsupportedInputKind(input.kind, machine.stepId);
  }
}

const issueFileMachine = {
  promptActionId: draftIssueActionId,
  stepId: ISSUE_FILE_STEP_ID,

  initialState(context = {}) {
    if (metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE, {
        phase: issueFilePhase.EXISTING_SELECTED
      });
    }
    return issueFilesAreReady(context.session)
      ? issueDraftReviewState()
      : issueSourceSelectionState();
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE, {
        phase: issueFilePhase.EXISTING_SELECTED
      });
    } else if (issueFilesAreReady(context.session) && state.status !== STEP_STATUS.CONFIRM_FILES) {
      state = issueDraftReviewState({
        from: state.status
      });
    }

    switch (state.status) {
      case STEP_STATUS.READY:
        return {
          actions: disableAction(context.session, rejectIssueDraftActionId, "Draft an issue before rejecting it."),
          next: {
            disabledReason: "Select an existing issue or draft a new one."
          },
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Select an existing issue or draft a new one."
          })
        };

      case STEP_STATUS.ATTEMPTING_EXECUTION:
        return promptStepWaitingView(context, this, state, {
          prompt: "Wait for Vibe64 to load the existing GitHub issue.",
          title: "Loading issue"
        });

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        return promptStepWaitingView(context, this, state, {
          prompt: "Wait for Codex to draft the issue.",
          title: "Drafting issue"
        });

      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state, {
          prompt: state.message || "Codex needs more information before it can draft the issue.",
          title: "Describe the issue"
        });

      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readIssueFieldValues(context);
        return {
          actions: disableAction(context.session, "use_existing_issue", "Issue details are already saved."),
          interaction: issueInputInteraction(STEP_STATUS.CONFIRM_FILES, values),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Review the saved issue draft."
          })
        };
      }

      case STEP_STATUS.DONE:
        return {
          actions: disableActions(context.session, {
            use_existing_issue: "An existing issue is already selected.",
            [draftIssueActionId]: "An existing issue is already selected.",
            [rejectIssueDraftActionId]: "An existing issue is already selected."
          }),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Existing GitHub issue selected."
          })
        };

      case STEP_STATUS.FAILED:
        return {
          next: {
            disabledReason: "Resolve the issue selection failure before continuing."
          },
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Issue selection failed."
          })
        };

      default:
        return {
          next: {
            disabledReason: "Select an existing issue or draft a new one."
          },
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId === draftIssueActionId) {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: issueFilePhase.DRAFTING
      }));
      return;
    }

    if (context.actionId === "use_existing_issue") {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        phase: issueFilePhase.SELECTING_EXISTING
      }));
      return;
    }

    if (context.actionId === rejectIssueDraftActionId) {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        phase: issueFilePhase.REVIEW_DRAFT
      }));
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId === "use_existing_issue") {
      if (await commandSucceeded(context, "issue_url")) {
        await writeState(context, this, machineState(STEP_STATUS.DONE, {
          phase: issueFilePhase.EXISTING_SELECTED
        }));
        return;
      }
      await writeState(context, this, machineState(STEP_STATUS.FAILED, {
        message: normalizeText(context.actionResult?.message) || "Could not load the existing GitHub issue.",
        phase: issueFilePhase.SELECTING_EXISTING
      }));
      return;
    }

    if (context.actionId === rejectIssueDraftActionId) {
      const feedback = normalizeText(context.actionResult?.input?.feedback);
      await clearIssueFieldValues(context);
      await writeState(context, this, issueSourceSelectionState({
        message: feedback
          ? `Previous draft rejected: ${feedback}`
          : "Previous draft rejected. Describe what you want instead."
      }));
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);

    switch (state.status) {
      case STEP_STATUS.READY:
        if (input.kind === STEP_INPUT_KIND.CONFIRM_FILES || input.kind === STEP_INPUT_KIND.READY) {
          await writeIssueFieldValues(context, input.fields);
          await writeState(context, this, issueDraftReviewState({
            response: input.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        await submitIssueDraftAgentResult(context, this, input);
        return;

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, issueSourceSelectionState({
            message: input.message,
            response: input.response,
            source: input.source
          }));
          return;
        }
        if (input.source === "codex") {
          await submitIssueDraftAgentResult(context, this, input);
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.CONFIRM_FILES:
        if (input.kind === STEP_INPUT_KIND.CONFIRM_FILES || input.kind === STEP_INPUT_KIND.READY) {
          await writeIssueFieldValues(context, input.fields);
          await writeState(context, this, issueDraftReviewState({
            response: input.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, issueSourceSelectionState({
            message: input.message,
            response: input.response,
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

  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        body: "Markdown issue body describing the requested change, context, and acceptance criteria.",
        title: "Concise GitHub issue title.",
        word: "Short Vibe64 session label/word derived from the issue title."
      },
      doneMeaning: "You have enough information to propose a GitHub issue title, body, and Vibe64 session label for user review.",
      waitingForInputMeaning: "You need more information from the user before drafting the issue."
    });
  }
};

const issueSubmittedMachine = {
  stepId: issueSubmittedStepId,

  initialState(context = {}) {
    if (metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE);
    }
    return issueFilesAreReady(context.session)
      ? machineState(STEP_STATUS.READY)
      : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
          message: "Define and save the issue before creating it on GitHub."
        });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE);
    } else if (issueFilesAreReady(context.session) && state.status === STEP_STATUS.WAITING_FOR_INPUT && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
      state = machineState(STEP_STATUS.READY);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "create_issue_on_gh", "The GitHub issue already exists."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        return {
          actions: disableAction(context.session, "create_issue_on_gh", "Resolve the issue command failure before retrying."),
          interaction: commandFailureInteraction({
            prompt: state.message || "The GitHub issue command failed. Explain what should happen, then retry the command.",
            title: "Issue command needs attention"
          }),
          next: nextForSession(context.session, {
            disabledReason: "Resolve the GitHub issue command failure before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Create the GitHub issue before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("The GitHub issue step cannot accept input right now.", "vibe64_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_issue_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "create_issue_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        await writeState(context, this, await commandSucceeded(context, "issue_url")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const makePlanMachine = {
  promptActionId: "make_plan",
  stepId: planMadeStepId,

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
    return handleStandardPromptInput(context, this);
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The implementation plan has been written in the Codex response and is ready for execution.",
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

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation plan has been written in the Codex response and is ready for execution.",
      waitingForInputMeaning: "You cannot make a useful seed plan without a user decision or clarification."
    });
  }
};

const executePlanMachine = {
  promptActionId: "execute_plan",
  stepId: planExecutedStepId,

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

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The implementation work is complete enough to continue to review.",
      waitingForInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
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

  promptInstruction() {
    return currentStepHelperInstruction({
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

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The deep UI check has been completed or intentionally found no required fix.",
      waitingForInputMeaning: "You cannot complete the UI check without a user decision."
    });
  }
};

const reviewRunMachine = {
  ...executePlanMachine,
  promptActionId: "run_deslop",
  stepId: reviewRunStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deslop");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The review/deslop loop has completed and only acceptable low-risk findings remain.",
      waitingForInputMeaning: "You cannot complete review/deslop without a user decision."
    });
  }
};

const projectKnowledgeUpdatedMachine = {
  ...executePlanMachine,
  promptActionId: "update_project_knowledge",
  stepId: projectKnowledgeUpdatedStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "update_project_knowledge");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "Project knowledge has been updated or there is no adapter-supported project knowledge to update.",
      waitingForInputMeaning: "You cannot update project knowledge without a user decision."
    });
  }
};

const reportCreatedMachine = {
  promptActionId: "write_report",
  stepId: reportCreatedStepId,

  initialState(context = {}) {
    return artifactIsReady(context.session, REPORT_ARTIFACT)
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (artifactIsReady(context.session, REPORT_ARTIFACT)) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Write the session report before updating project knowledge.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this, {
      responseArtifact: REPORT_ARTIFACT
    });
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "write_report");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
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
      draftReady: issueFilesAreReady,
      initialDetails: {
        doing: "discussion"
      },
      interaction: issueInputInteraction,
      nextWhenDrafting: {
        disabledReason: "Define and save the seed issue before continuing."
      },
      nextWhenWorking: {
        disabledReason: "Define and save the seed issue before continuing."
      },
      readValues: readIssueFieldValues,
      saveValues: writeIssueFieldValues,
      unsupportedDoneMessage: "The seed definition step cannot accept input right now.",
      waitingForInputState: (input = {}) => ({
        doing: "discussion",
        message: input.message
      }),
      waitingInteraction: () => issueInputInteraction(STEP_STATUS.WAITING_FOR_INPUT, {})
    },
    definition: coreCodingStepDefinitionsById[SEED_APPLICATION_STEP_ID],
    factoryId: "editable_artifact_review",
    id: SEED_APPLICATION_STEP_ID
  },
  [ISSUE_FILE_STEP_ID]: {
    definition: coreCodingStepDefinitionsById[ISSUE_FILE_STEP_ID],
    id: ISSUE_FILE_STEP_ID,
    machine: issueFileMachine
  },
  [issueSubmittedStepId]: {
    definition: coreCodingStepDefinitionsById[issueSubmittedStepId],
    id: issueSubmittedStepId,
    machine: issueSubmittedMachine
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
  [planMadeStepId]: {
    definition: coreCodingStepDefinitionsById[planMadeStepId],
    id: planMadeStepId,
    machine: makePlanMachine
  },
  [planExecutedStepId]: {
    definition: coreCodingStepDefinitionsById[planExecutedStepId],
    id: planExecutedStepId,
    machine: executePlanMachine
  },
  [implementationReviewedStepId]: {
    config: {
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
  [agentConversationStepId]: {
    config: {
      completionPolicy: {
        decidedBy: "user"
      },
      nextWhenIdle: (context = {}) => ({
        disabledReason: "Ask Codex for changes before continuing.",
        enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
      }),
      promptActionId: "agent_conversation"
    },
    definition: coreCodingStepDefinitionsById[agentConversationStepId],
    factoryId: "chat_with_ai",
    id: agentConversationStepId
  },
  [deepUiCheckRunStepId]: {
    definition: coreCodingStepDefinitionsById[deepUiCheckRunStepId],
    id: deepUiCheckRunStepId,
    machine: deepUiCheckMachine
  },
  [reviewRunStepId]: {
    definition: coreCodingStepDefinitionsById[reviewRunStepId],
    id: reviewRunStepId,
    machine: reviewRunMachine
  },
  [changesAcceptedStepId]: {
    config: {
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
  [reportCreatedStepId]: {
    definition: coreCodingStepDefinitionsById[reportCreatedStepId],
    id: reportCreatedStepId,
    machine: reportCreatedMachine
  },
  [projectKnowledgeUpdatedStepId]: {
    definition: coreCodingStepDefinitionsById[projectKnowledgeUpdatedStepId],
    id: projectKnowledgeUpdatedStepId,
    machine: projectKnowledgeUpdatedMachine
  }
})));

const coreCodingWorkflowModule = Object.freeze({
  id: moduleId,
  steps: coreCodingSteps,
  workflowDefinitions: coreCodingWorkflowDefinitions
});

const _testing = deepFreeze({
  moduleId,
  ownedStepIds: [
    SEED_APPLICATION_STEP_ID,
    ISSUE_FILE_STEP_ID,
    issueSubmittedStepId,
    seedPlanMadeStepId,
    seedPlanExecutedStepId,
    planMadeStepId,
    planExecutedStepId,
    implementationReviewedStepId,
    agentConversationStepId,
    deepUiCheckRunStepId,
    reviewRunStepId,
    changesAcceptedStepId,
    reportCreatedStepId,
    projectKnowledgeUpdatedStepId
  ],
  workflowDefinitionIds: VIBE64_WORKFLOW_DEFINITION_IDS
});

export {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  _testing,
  coreCodingWorkflowModule
};
