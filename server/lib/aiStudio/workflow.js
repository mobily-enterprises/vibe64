import {
  aiStudioError,
  normalizeText
} from "./core.js";
import { deepFreeze } from "./deepFreeze.js";

const CREATE_ISSUE_FILE_ACTION_ID = "create_issue_file";
const APPLY_REVIEW_FEEDBACK_ACTION_ID = "apply_review_feedback";
const TALK_TO_AGENT_ACTION_ID = "talk_to_agent";
const HUMAN_INPUT_RESPONSE_ARTIFACT = "human_input_response.md";
const AGENT_RESPONSE_STEP_ID = "agent_response_created";
const CHECKLIST_ITEMS_STEP_ID = "checklist_items_installed";
const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const ISSUE_WORD_ARTIFACT = "issue_word";
const PULL_REQUEST_ARTIFACT = "pull_request.md";
const REPORT_ARTIFACT = "report.md";
const SEED_APPLICATION_STEP_ID = "seed_application_defined";
const SEND_ISSUE_PROMPT_ACTION_ID = "send_issue_prompt";
const SEND_SEED_PROMPT_ACTION_ID = "send_seed_prompt";
const CREATE_SEED_ISSUE_FILE_ACTION_ID = "create_seed_issue_file";
const ISSUE_FILES_READY_CONDITION = `artifacts:${ISSUE_TITLE_ARTIFACT},${ISSUE_BODY_ARTIFACT},${ISSUE_WORD_ARTIFACT}`;
const ISSUE_PROMPT_HAS_REQUEST_CONDITION = `action-input:${SEND_ISSUE_PROMPT_ACTION_ID}.issueRequest`;
const SEED_PROMPT_HAS_REQUEST_CONDITION = `action-input:${SEND_SEED_PROMPT_ACTION_ID}.seedRequest`;
const ISSUE_TITLE_READY_CONDITION = `artifact:${ISSUE_TITLE_ARTIFACT}`;
const ISSUE_BODY_READY_CONDITION = `artifact:${ISSUE_BODY_ARTIFACT}`;
const ISSUE_WORD_READY_CONDITION = `artifact:${ISSUE_WORD_ARTIFACT}`;
const ISSUE_READY_CONDITION = `any:metadata:issue_url;${ISSUE_FILES_READY_CONDITION}`;
const PR_READY_CONDITION = `any:metadata:pr_url;artifact:${PULL_REQUEST_ARTIFACT}`;
const REPORT_READY_CONDITION = `artifact:${REPORT_ARTIFACT}`;
const HUMAN_INPUT_RESPONSE_READY_CONDITION = `artifact:${HUMAN_INPUT_RESPONSE_ARTIFACT}`;
const MERGE_DECISION_READY_CONDITION = "any:metadata:pr_merged;metadata:merge_skipped";
const SESSION_CAN_FINISH_CONDITION = "any:metadata:main_checkout_synced;metadata:merge_skipped";

const AI_STUDIO_WORKFLOW_PROFILE_IDS = deepFreeze({
  BIG_FEATURE: "big_feature",
  NON_CODE_MAINTENANCE: "non_code_maintenance",
  NON_COMMIT_MAINTENANCE: "non_commit_maintenance",
  SEED_APPLICATION: "seed_application"
});

const DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID = AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE;
const USER_SELECTABLE_WORKFLOW_PROFILE_IDS = deepFreeze([
  AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE,
  AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE,
  AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
]);

function reportEditorAction() {
  return {
    artifactFields: [
      {
        kind: "textarea",
        label: "Session report",
        name: REPORT_ARTIFACT,
        required: true,
        requiredMessage: "Session report is required."
      }
    ],
    enabledWhen: [REPORT_READY_CONDITION],
    enabledWhenReason: "Write the report before editing it.",
    id: "edit_report",
    label: "Edit report",
    type: "editor"
  };
}

function humanInputResponseEditorAction() {
  return {
    artifactFields: [
      {
        kind: "textarea",
        label: "AI response",
        name: HUMAN_INPUT_RESPONSE_ARTIFACT,
        required: false
      }
    ],
    enabledWhen: [HUMAN_INPUT_RESPONSE_READY_CONDITION],
    enabledWhenReason: "Ask Codex for a response before editing it.",
    id: "edit_human_input_response",
    label: "Edit AI response",
    type: "editor"
  };
}

function talkToAgentAction() {
  return {
    allowRepeatedPromptRuns: true,
    id: TALK_TO_AGENT_ACTION_ID,
    inputFields: [
      {
        kind: "textarea",
        label: "What do you want to ask Codex?",
        name: "agentRequest",
        placeholder: "Describe what you want help with.",
        requiredMessage: "Describe what you want Codex to help with."
      }
    ],
    label: "Talk to agent",
    promptId: TALK_TO_AGENT_ACTION_ID,
    type: "prompt"
  };
}

function issueEditorAction() {
  return {
    artifactFields: [
      {
        kind: "text",
        label: "Issue title",
        metadataName: ISSUE_TITLE_ARTIFACT,
        name: ISSUE_TITLE_ARTIFACT,
        required: true,
        requiredMessage: "Issue title is required."
      },
      {
        kind: "text",
        label: "Session label",
        metadataName: ISSUE_WORD_ARTIFACT,
        name: ISSUE_WORD_ARTIFACT,
        required: true,
        requiredMessage: "Session label is required."
      },
      {
        kind: "textarea",
        label: "Issue body",
        name: ISSUE_BODY_ARTIFACT,
        required: true,
        requiredMessage: "Issue body is required."
      }
    ],
    disabledReason: "The GitHub issue already exists; edit it on GitHub instead.",
    disabledWhen: ["metadata:issue_url"],
    enabledWhen: [ISSUE_TITLE_READY_CONDITION, ISSUE_BODY_READY_CONDITION],
    enabledWhenReason: "Create the issue file before editing.",
    id: "edit_issue",
    label: "Edit issue",
    type: "editor"
  };
}

function createIssueOnGithubAction() {
  return {
    adapterCapability: "create_issue_on_gh",
    disabledReason: "Create the issue file before submitting it to GitHub.",
    disabledWhen: ["metadata:issue_url"],
    disabledWhenReason: "The GitHub issue already exists.",
    enabledWhen: [ISSUE_TITLE_READY_CONDITION, ISSUE_WORD_READY_CONDITION, ISSUE_BODY_READY_CONDITION],
    enabledWhenReason: "Create the issue file before submitting it to GitHub.",
    id: "create_issue_on_gh",
    label: "Create issue on GH",
    type: "command"
  };
}

const AI_STUDIO_WORKFLOW_STEP_CATALOG = deepFreeze({
  session_created: {
    description: "Create the AI Studio session.",
    id: "session_created",
    label: "Create session",
    rewindable: false
  },
  work_source_selected: {
    actions: [
      {
        disabledReason: "Work source is already selected.",
        disabledWhen: ["metadata:work_source"],
        id: "use_new_branch",
        label: "Use new branch",
        type: "adapter"
      },
      {
        adapterCapability: "use_existing_pr",
        disabledReason: "Work source is already selected.",
        disabledWhen: ["metadata:work_source"],
        id: "use_existing_pr",
        inputFields: [
          {
            label: "PR URL or number",
            name: "prRef",
            placeholder: "123, #123, or https://github.com/org/repo/pull/123",
            requiredMessage: "PR URL or number is required."
          }
        ],
        label: "Use existing PR",
        type: "adapter"
      }
    ],
    autopilot: {
      actionId: "use_new_branch",
      advanceOnSuccess: true,
      completeWhen: ["metadata:work_source"],
      label: "Choose work source"
    },
    description: "Choose whether this session starts from a new branch or an existing pull request.",
    id: "work_source_selected",
    label: "Choose work source",
    next: {
      disabledReason: "Choose a work source before continuing.",
      enabledWhen: ["metadata:work_source"]
    },
    rewindable: false
  },
  worktree_created: {
    actions: [
      {
        adapterCapability: "create_worktree",
        disabledReason: "Worktree already exists.",
        disabledWhen: ["metadata:worktree_path"],
        enabledWhen: ["metadata:work_source"],
        enabledWhenReason: "Choose a work source before creating the worktree.",
        id: "create_worktree",
        label: "Create worktree",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "create_worktree",
      completeWhen: ["metadata:worktree_path"],
      label: "Create worktree"
    },
    description: "Create the isolated worktree or target-specific working area.",
    id: "worktree_created",
    label: "Create worktree",
    next: {
      disabledReason: "Create the worktree before continuing.",
      enabledWhen: ["metadata:worktree_path"]
    },
    rewindable: false
  },
  dependencies_installed: {
    actions: [
      {
        adapterCapability: "install_dependencies",
        disabledReason: "Dependencies are already installed.",
        disabledWhen: ["metadata:dependencies_installed"],
        id: "install_dependencies",
        label: "Install dependencies",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "install_dependencies",
      completeWhen: ["metadata:dependencies_installed"],
      label: "Install dependencies"
    },
    description: "Install target dependencies when the adapter requires them.",
    id: "dependencies_installed",
    label: "Install dependencies",
    next: {
      disabledReason: "Install dependencies before continuing.",
      enabledWhen: ["metadata:dependencies_installed"]
    },
    rewindCleanup: {
      actionResults: ["install_dependencies"],
      metadata: ["dependencies_installed", "dependencies_path"]
    }
  },
  [CHECKLIST_ITEMS_STEP_ID]: {
    actions: [
      {
        adapterCapability: "install_dependencies",
        disabledReason: "Checklist items are already installed.",
        disabledWhen: ["metadata:dependencies_installed"],
        id: "install_dependencies",
        label: "Install checklist items",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "install_dependencies",
      completeWhen: ["metadata:dependencies_installed"],
      label: "Install checklist items"
    },
    description: "Install the adapter-provided local checklist items needed before talking to Codex.",
    id: CHECKLIST_ITEMS_STEP_ID,
    label: "Install checklist items",
    next: {
      disabledReason: "Install checklist items before continuing.",
      enabledWhen: ["metadata:dependencies_installed"]
    },
    rewindCleanup: {
      actionResults: ["install_dependencies"],
      metadata: ["dependencies_installed", "dependencies_path"]
    }
  },
  [SEED_APPLICATION_STEP_ID]: {
    actions: [
      {
        disabledReason: "The seed issue file already exists.",
        disabledWhen: [ISSUE_FILES_READY_CONDITION],
        id: SEND_SEED_PROMPT_ACTION_ID,
        inputFields: [
          {
            label: "What kind of app foundation should Studio seed?",
            name: "seedRequest",
            placeholder: "Describe the app foundation, modules, integrations, and local dev services you want.",
            requiredMessage: "Describe the application foundation before discussing the seed issue."
          }
        ],
        label: "Discuss seed app",
        promptId: SEND_SEED_PROMPT_ACTION_ID,
        type: "prompt"
      },
      {
        disabledReason: "The seed issue files already exist.",
        disabledWhen: [ISSUE_FILES_READY_CONDITION],
        enabledWhen: [SEED_PROMPT_HAS_REQUEST_CONDITION],
        enabledWhenReason: "Discuss the seed app before creating the seed issue file.",
        id: CREATE_SEED_ISSUE_FILE_ACTION_ID,
        label: "Create seed issue file",
        promptId: CREATE_SEED_ISSUE_FILE_ACTION_ID,
        type: "prompt"
      }
    ],
    autopilot: {
      kind: "seed_issue_discussion",
      stop: true
    },
    description: "Define the initial application foundation and create the seed issue files.",
    id: SEED_APPLICATION_STEP_ID,
    label: "Seed application",
    next: {
      disabledReason: "Define and save the seed issue before continuing.",
      enabledWhen: [ISSUE_FILES_READY_CONDITION]
    },
    rewindCleanup: {
      actionResults: [SEND_SEED_PROMPT_ACTION_ID, CREATE_SEED_ISSUE_FILE_ACTION_ID],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: ["issue_title", ISSUE_WORD_ARTIFACT]
    }
  },
  [ISSUE_FILE_STEP_ID]: {
    actions: [
      {
        disabledReason: "An existing issue is already selected.",
        disabledWhen: ["metadata:issue_url"],
        id: SEND_ISSUE_PROMPT_ACTION_ID,
        label: "Discuss issue",
        promptId: SEND_ISSUE_PROMPT_ACTION_ID,
        type: "prompt"
      },
      {
        disabledReason: "Issue is already selected or issue files already exist.",
        disabledWhen: ["metadata:issue_url", ISSUE_FILES_READY_CONDITION],
        enabledWhen: [ISSUE_PROMPT_HAS_REQUEST_CONDITION],
        enabledWhenReason: "Discuss the issue before creating the issue file.",
        id: CREATE_ISSUE_FILE_ACTION_ID,
        label: "Create issue file",
        promptId: CREATE_ISSUE_FILE_ACTION_ID,
        type: "prompt"
      },
      {
        adapterCapability: "use_existing_issue",
        disabledReason: "An existing issue is already selected.",
        disabledWhen: ["metadata:issue_url"],
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
      enabledWhen: [ISSUE_READY_CONDITION]
    },
    rewindCleanup: {
      actionResults: [SEND_ISSUE_PROMPT_ACTION_ID, CREATE_ISSUE_FILE_ACTION_ID, "use_existing_issue"],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: ["issue_url", "issue_number", "issue_title", "issue_source", ISSUE_WORD_ARTIFACT]
    }
  },
  issue_submitted: {
    actions: [
      issueEditorAction(),
      createIssueOnGithubAction()
    ],
    autopilot: {
      actionId: "create_issue_on_gh",
      completeWhen: ["metadata:issue_url"],
      label: "Edit and submit issue"
    },
    description: "Review the issue files and submit the GitHub issue.",
    id: "issue_submitted",
    label: "Edit and submit issue",
    next: {
      enabledWhen: ["metadata:issue_url"]
    },
    rewindCleanup: {
      actionResults: ["create_issue_on_gh"],
      metadata: ["issue_url", "issue_number", "issue_title"]
    }
  },
  seed_plan_made: {
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
    id: "seed_plan_made",
    label: "Make seed plan",
    rewindCleanup: {
      actionResults: ["make_seed_plan"]
    }
  },
  seed_plan_executed: {
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
    id: "seed_plan_executed",
    label: "Execute seed plan",
    rewindCleanup: {
      actionResults: ["execute_seed_plan"]
    }
  },
  plan_made: {
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
    id: "plan_made",
    label: "Make plan",
    rewindCleanup: {
      actionResults: ["make_plan"]
    }
  },
  plan_executed: {
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
    id: "plan_executed",
    label: "Execute plan",
    rewindCleanup: {
      actionResults: ["execute_plan"]
    }
  },
  implementation_reviewed: {
    actions: [
      {
        allowRepeatedPromptRuns: true,
        id: APPLY_REVIEW_FEEDBACK_ACTION_ID,
        inputFields: [
          {
            label: "What should Codex change?",
            name: "reviewFeedback",
            placeholder: "Describe the tweak in plain language.",
            requiredMessage: "Describe what should change before sending this to Codex."
          }
        ],
        label: "Ask AI for tweaks",
        promptId: APPLY_REVIEW_FEEDBACK_ACTION_ID,
        type: "prompt"
      },
      humanInputResponseEditorAction()
    ],
    autopilot: {
      kind: "implementation_review",
      stop: true
    },
    description: "Try the implemented work and request small tweaks before slower review steps.",
    id: "implementation_reviewed",
    label: "Human review",
    rewindCleanup: {
      actionResults: [APPLY_REVIEW_FEEDBACK_ACTION_ID],
      artifacts: [HUMAN_INPUT_RESPONSE_ARTIFACT]
    }
  },
  [AGENT_RESPONSE_STEP_ID]: {
    actions: [
      talkToAgentAction(),
      humanInputResponseEditorAction()
    ],
    autopilot: {
      kind: "agent_conversation",
      stop: true
    },
    description: "Ask Codex for local maintenance help and save the answer as an editable AI response artifact.",
    id: AGENT_RESPONSE_STEP_ID,
    label: "Talk to agent",
    next: {
      disabledReason: "Ask Codex and save an AI response before finishing.",
      enabledWhen: [HUMAN_INPUT_RESPONSE_READY_CONDITION]
    },
    rewindCleanup: {
      actionResults: [TALK_TO_AGENT_ACTION_ID],
      artifacts: [HUMAN_INPUT_RESPONSE_ARTIFACT]
    }
  },
  deep_ui_check_run: {
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
    id: "deep_ui_check_run",
    label: "Run deep UI check",
    rewindCleanup: {
      actionResults: ["run_deep_ui_check"]
    }
  },
  review_run: {
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
    id: "review_run",
    label: "Run review/deslop",
    rewindCleanup: {
      actionResults: ["run_deslop"]
    }
  },
  project_validated: {
    actions: [
      {
        adapterCapability: "update_code_index",
        id: "update_code_index",
        label: "Update code index",
        type: "command"
      },
      {
        adapterCapability: "run_automated_checks",
        enabledWhen: ["metadata:code_index_updated"],
        enabledWhenReason: "Update the code index before running automated checks.",
        id: "run_automated_checks",
        label: "Run automated checks",
        type: "command"
      }
    ],
    autopilot: {
      actionSequence: [
        {
          actionId: "update_code_index",
          completeWhen: ["metadata:code_index_updated"],
          label: "Update code index"
        },
        {
          actionId: "run_automated_checks",
          completeWhen: ["metadata:automated_checks_passed"],
          label: "Run automated checks"
        }
      ],
      label: "Validate project"
    },
    description: "Update the adapter-provided code index and run automated checks.",
    id: "project_validated",
    label: "Validate project",
    next: {
      disabledReason: "Update the code index and run automated checks successfully before continuing.",
      enabledWhen: ["metadata:code_index_updated", "metadata:automated_checks_passed"]
    },
    rewindCleanup: {
      actionResults: ["update_code_index", "run_automated_checks"],
      metadata: [
        "code_index_command_source",
        "code_index_package_manager",
        "code_index_path",
        "code_index_updated",
        "automated_checks_package_manager",
        "automated_checks_passed"
      ]
    }
  },
  changes_accepted: {
    actions: [
      reportEditorAction()
    ],
    autopilot: {
      kind: "final_review",
      stop: true
    },
    description: "Review the validated work before the report, commit, and pull request.",
    id: "changes_accepted",
    label: "Final review"
  },
  report_created: {
    actions: [
      {
        id: "write_report",
        label: "Write report",
        promptId: "write_report",
        type: "prompt"
      },
      reportEditorAction()
    ],
    autopilot: {
      actionId: "write_report",
      completeWhen: [`artifact:${REPORT_ARTIFACT}`],
      label: "Write report"
    },
    description: "Write the local report explaining what changed and why.",
    id: "report_created",
    label: "Write report",
    next: {
      disabledReason: "Write the session report before updating project knowledge.",
      enabledWhen: [REPORT_READY_CONDITION]
    },
    rewindCleanup: {
      actionResults: ["write_report"],
      artifacts: [REPORT_ARTIFACT]
    }
  },
  project_knowledge_updated: {
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
    id: "project_knowledge_updated",
    label: "Update project knowledge",
    rewindCleanup: {
      actionResults: ["update_project_knowledge"]
    }
  },
  changes_committed: {
    actions: [
      {
        adapterCapability: "commit_changes",
        id: "commit_changes",
        label: "Commit and push changes",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "commit_changes",
      completeWhen: ["metadata:accepted_commit", "metadata:branch_pushed"],
      label: "Commit and push changes"
    },
    description: "Commit the accepted changes and push the session branch.",
    id: "changes_committed",
    label: "Commit and push changes",
    next: {
      disabledReason: "Commit and push changes before continuing.",
      enabledWhen: ["metadata:accepted_commit"]
    },
    rewindCleanup: {
      actionResults: ["commit_changes"],
      metadata: ["accepted_commit", "branch_pushed"]
    }
  },
  pr_file_created: {
    actions: [
      {
        disabledReason: "The GitHub pull request already exists.",
        disabledWhen: ["metadata:pr_url"],
        id: "create_pr_file",
        label: "Create PR file",
        promptId: "create_pr_file",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "create_pr_file",
      completeWhen: [PR_READY_CONDITION],
      label: "Create PR file"
    },
    description: "Create the local pull request file.",
    id: "pr_file_created",
    label: "Create PR file",
    next: {
      disabledReason: "Create the pull request file before continuing.",
      enabledWhen: [PR_READY_CONDITION]
    },
    rewindCleanup: {
      actionResults: ["create_pr_file"],
      artifacts: [PULL_REQUEST_ARTIFACT]
    }
  },
  pr_created: {
    actions: [
      {
        enabledWhen: ["metadata:pr_url"],
        hrefMetadata: "pr_url",
        id: "open_pr",
        label: "Open PR",
        type: "link"
      },
      {
        artifactFields: [
          {
            kind: "textarea",
            label: "Pull request body",
            name: PULL_REQUEST_ARTIFACT,
            required: true,
            requiredMessage: "Pull request body is required."
          }
        ],
        disabledReason: "The GitHub pull request already exists; edit it on GitHub instead.",
        disabledWhen: ["metadata:pr_url"],
        enabledWhen: ["artifact:pull_request.md"],
        enabledWhenReason: "Create the pull request file before editing.",
        id: "edit_pr",
        label: "Edit PR",
        type: "editor"
      },
      {
        adapterCapability: "create_pr_on_gh",
        disabledReason: "Commit and push changes before creating the GitHub pull request.",
        disabledWhen: ["metadata:pr_url"],
        disabledWhenReason: "The GitHub pull request already exists.",
        enabledWhen: ["artifact:pull_request.md", "metadata:branch_pushed"],
        enabledWhenReason: "Commit and push changes before creating the GitHub pull request.",
        id: "create_pr_on_gh",
        label: "Create PR on GH",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "create_pr_on_gh",
      completeWhen: ["metadata:pr_url"],
      label: "Create PR on GH"
    },
    description: "Review and create the GitHub pull request.",
    id: "pr_created",
    label: "Edit and create PR",
    next: {
      disabledReason: "Create the pull request before continuing.",
      enabledWhen: ["metadata:pr_url"]
    },
    rewindCleanup: {
      actionResults: ["create_pr_on_gh"],
      metadata: [
        {
          name: "pr_url",
          unlessMetadata: {
            name: "pr_source",
            value: "existing"
          }
        },
        "pr_number",
        "pr_title",
        {
          name: "pr_source",
          unlessMetadata: {
            name: "pr_source",
            value: "existing"
          }
        }
      ]
    }
  },
  pr_merged: {
    actions: [
      reportEditorAction(),
      {
        disabledReason: "Create the pull request before preparing for merge.",
        disabledWhen: ["metadata:pr_merged", "metadata:merge_skipped"],
        disabledWhenReason: "A merge decision has already been recorded.",
        enabledWhen: ["metadata:pr_url"],
        id: "prepare_for_merge",
        label: "Prepare for merge",
        promptId: "prepare_for_merge",
        type: "prompt"
      },
      {
        adapterCapability: "merge_pr",
        disabledReason: "Create the pull request before merging.",
        disabledWhen: ["metadata:pr_merged", "metadata:merge_skipped"],
        disabledWhenReason: "A merge decision has already been recorded.",
        enabledWhen: ["metadata:pr_url"],
        id: "merge_pr",
        label: "Merge",
        type: "command"
      },
      {
        disabledReason: "A merge decision has already been recorded.",
        disabledWhen: ["metadata:pr_merged", "metadata:merge_skipped"],
        enabledWhen: ["metadata:pr_url"],
        enabledWhenReason: "Create the pull request before choosing not to merge.",
        id: "skip_merge",
        label: "Do not merge",
        type: "adapter"
      }
    ],
    autopilot: {
      kind: "merge_review",
      stop: true
    },
    description: "Prepare and merge the pull request.",
    id: "pr_merged",
    label: "Merge PR",
    next: {
      disabledReason: "Merge the pull request or choose not to merge before continuing.",
      enabledWhen: [MERGE_DECISION_READY_CONDITION]
    },
    rewindCleanup: {
      actionResults: ["prepare_for_merge", "merge_pr", "skip_merge"],
      metadata: ["pr_merged", "merge_skipped"]
    }
  },
  main_checkout_synced: {
    actions: [
      {
        adapterCapability: "sync_main_checkout",
        disabledReason: "Merge the pull request before syncing the main checkout.",
        enabledWhen: ["metadata:pr_url", "metadata:pr_merged"],
        id: "sync_main_checkout",
        label: "Sync main checkout",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "sync_main_checkout",
      completeWhen: ["metadata:main_checkout_synced"],
      label: "Sync main checkout"
    },
    description: "Sync the main checkout after a successful merge.",
    id: "main_checkout_synced",
    label: "Sync main checkout",
    next: {
      disabledReason: "Sync the main checkout after merging before continuing.",
      enabledWhen: [SESSION_CAN_FINISH_CONDITION]
    },
    rewindCleanup: {
      actionResults: ["sync_main_checkout"],
      metadata: ["main_checkout_synced"]
    }
  },
  session_finished: {
    actions: [
      reportEditorAction(),
      {
        adapterCapability: "finish_session",
        disabledReason: "Merge and sync the main checkout, or choose not to merge, before archiving.",
        enabledWhen: ["metadata:pr_url", SESSION_CAN_FINISH_CONDITION],
        id: "finish_session",
        label: "Archive",
        type: "finish"
      }
    ],
    autopilot: {
      kind: "finished",
      stop: true
    },
    description: "Congratulations. Archive the session.",
    id: "session_finished",
    label: "Congratulations!",
    next: {
      visible: false
    },
    rewindCleanup: {
      actionResults: ["finish_session"]
    }
  },
  local_session_finished: {
    actions: [
      reportEditorAction(),
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
    id: "local_session_finished",
    label: "Finish local session",
    next: {
      visible: false
    },
    rewindCleanup: {
      actionResults: ["finish_session"]
    }
  }
});

const AI_STUDIO_WORKFLOW_PROFILES = deepFreeze({
  [AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION]: {
    description: "Create the initial application scaffold and local development foundation.",
    id: AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION,
    label: "Seed application",
    sessionWord: "seeding",
    stepIds: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      SEED_APPLICATION_STEP_ID,
      "seed_plan_made",
      "seed_plan_executed",
      "dependencies_installed",
      "project_validated",
      "changes_accepted",
      "report_created",
      "project_knowledge_updated",
      "changes_committed",
      "pr_file_created",
      "pr_created",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ]
  },
  [AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE]: {
    description: "Plan, implement, review, validate, commit, create a PR, and optionally merge.",
    id: AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE,
    label: "Big feature",
    stepIds: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      ISSUE_FILE_STEP_ID,
      "issue_submitted",
      "plan_made",
      "plan_executed",
      "implementation_reviewed",
      "deep_ui_check_run",
      "review_run",
      "project_validated",
      "changes_accepted",
      "report_created",
      "project_knowledge_updated",
      "changes_committed",
      "pr_file_created",
      "pr_created",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ]
  },
  [AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE]: {
    description: "Run a non-code maintenance task with planning, validation, commit, and PR handling.",
    id: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE,
    label: "Non-code maintenance",
    stepIds: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      ISSUE_FILE_STEP_ID,
      "issue_submitted",
      "plan_made",
      "plan_executed",
      "review_run",
      "project_validated",
      "changes_accepted",
      "report_created",
      "project_knowledge_updated",
      "changes_committed",
      "pr_file_created",
      "pr_created",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ]
  },
  [AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE]: {
    description: "Run a local maintenance task without commit, pull request, or merge steps.",
    id: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE,
    label: "Non-commit maintenance",
    initialMetadata: {
      work_source: "new_branch"
    },
    sessionWord: "maintenance",
    stepIds: [
      "session_created",
      "worktree_created",
      CHECKLIST_ITEMS_STEP_ID,
      AGENT_RESPONSE_STEP_ID,
      "local_session_finished"
    ]
  }
});

function plainClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeWorkflowProfileId(profileId = "") {
  const normalizedProfileId = normalizeText(profileId) || DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID;
  if (!AI_STUDIO_WORKFLOW_PROFILES[normalizedProfileId]) {
    throw aiStudioError(
      `Unknown AI Studio workflow profile: ${normalizedProfileId}`,
      "ai_studio_unknown_workflow_profile"
    );
  }
  return normalizedProfileId;
}

function workflowProfileDefinition(profileId = DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID) {
  return AI_STUDIO_WORKFLOW_PROFILES[normalizeWorkflowProfileId(profileId)];
}

function workflowStepDefinition(stepId = "") {
  const step = AI_STUDIO_WORKFLOW_STEP_CATALOG[normalizeText(stepId)];
  if (!step) {
    throw aiStudioError(
      `Unknown AI Studio workflow step in profile: ${normalizeText(stepId) || "(empty)"}`,
      "ai_studio_unknown_workflow_profile_step"
    );
  }
  return plainClone(step);
}

function workflowForProfile(profileId = DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID) {
  const profile = workflowProfileDefinition(profileId);
  return deepFreeze({
    id: profile.id,
    profile: plainClone(profile),
    steps: profile.stepIds.map(workflowStepDefinition)
  });
}

function publicWorkflowProfile(profileId = DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID) {
  const profile = workflowProfileDefinition(profileId);
  return {
    description: profile.description,
    id: profile.id,
    label: profile.label
  };
}

function workflowProfileCreationOptions({
  seedRequired = false
} = {}) {
  if (seedRequired) {
    return {
      defaultWorkflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION,
      mode: "seed_required",
      requiredWorkflowProfile: publicWorkflowProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION),
      seedRequired: true,
      workflowProfiles: []
    };
  }
  return {
    defaultWorkflowProfile: DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID,
    mode: "select",
    requiredWorkflowProfile: null,
    seedRequired: false,
    workflowProfiles: USER_SELECTABLE_WORKFLOW_PROFILE_IDS.map(publicWorkflowProfile)
  };
}

const DEFAULT_AI_STUDIO_WORKFLOW = workflowForProfile(DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID);

export {
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  AI_STUDIO_WORKFLOW_PROFILES,
  AI_STUDIO_WORKFLOW_STEP_CATALOG,
  DEFAULT_AI_STUDIO_WORKFLOW,
  DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  normalizeWorkflowProfileId,
  workflowForProfile,
  workflowProfileCreationOptions,
  workflowProfileDefinition
};
