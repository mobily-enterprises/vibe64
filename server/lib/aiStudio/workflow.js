import { deepFreeze } from "./deepFreeze.js";

const CREATE_ISSUE_FILE_ACTION_ID = "create_issue_file";
const APPLY_REVIEW_FEEDBACK_ACTION_ID = "apply_review_feedback";
const HUMAN_INPUT_RESPONSE_ARTIFACT = "human_input_response.md";
const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const ISSUE_WORD_ARTIFACT = "issue_word";
const PULL_REQUEST_ARTIFACT = "pull_request.md";
const REPORT_ARTIFACT = "report.md";
const SEND_ISSUE_PROMPT_ACTION_ID = "send_issue_prompt";
const ISSUE_FILES_READY_CONDITION = `artifacts:${ISSUE_TITLE_ARTIFACT},${ISSUE_BODY_ARTIFACT},${ISSUE_WORD_ARTIFACT}`;
const ISSUE_PROMPT_HAS_REQUEST_CONDITION = `action-input:${SEND_ISSUE_PROMPT_ACTION_ID}.issueRequest`;
const ISSUE_TITLE_READY_CONDITION = `artifact:${ISSUE_TITLE_ARTIFACT}`;
const ISSUE_BODY_READY_CONDITION = `artifact:${ISSUE_BODY_ARTIFACT}`;
const ISSUE_WORD_READY_CONDITION = `artifact:${ISSUE_WORD_ARTIFACT}`;
const ISSUE_READY_CONDITION = `any:metadata:issue_url;${ISSUE_FILES_READY_CONDITION}`;
const PR_READY_CONDITION = `any:metadata:pr_url;artifact:${PULL_REQUEST_ARTIFACT}`;
const REPORT_READY_CONDITION = `artifact:${REPORT_ARTIFACT}`;
const HUMAN_INPUT_RESPONSE_READY_CONDITION = `artifact:${HUMAN_INPUT_RESPONSE_ARTIFACT}`;

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

const DEFAULT_AI_STUDIO_WORKFLOW = deepFreeze({
  id: "default",
  steps: [
    {
      description: "Create the AI Studio session.",
      id: "session_created",
      label: "Create session",
      rewindable: false
    },
    {
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
      description: "Choose whether this session starts from a new branch or an existing pull request.",
      id: "work_source_selected",
      label: "Choose work source",
      next: {
        disabledReason: "Choose a work source before continuing.",
        enabledWhen: ["metadata:work_source"]
      },
      rewindable: false
    },
    {
      actions: [
        {
          adapterCapability: "create_worktree",
          enabledWhen: ["metadata:work_source"],
          enabledWhenReason: "Choose a work source before creating the worktree.",
          disabledReason: "Worktree already exists.",
          disabledWhen: ["metadata:worktree_path"],
          id: "create_worktree",
          label: "Create worktree",
          type: "command"
        }
      ],
      description: "Create the isolated worktree or target-specific working area.",
      id: "worktree_created",
      label: "Create worktree",
      next: {
        disabledReason: "Create the worktree before continuing.",
        enabledWhen: ["metadata:worktree_path"]
      },
      rewindable: false
    },
    {
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
    {
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
    {
      actions: [
        {
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
        },
        {
          adapterCapability: "create_issue_on_gh",
          disabledReason: "Create the issue file before submitting it to GitHub.",
          disabledWhen: ["metadata:issue_url"],
          disabledWhenReason: "The GitHub issue already exists.",
          enabledWhen: [ISSUE_TITLE_READY_CONDITION, ISSUE_WORD_READY_CONDITION, ISSUE_BODY_READY_CONDITION],
          enabledWhenReason: "Create the issue file before submitting it to GitHub.",
          id: "create_issue_on_gh",
          label: "Create issue on GH",
          type: "command"
        }
      ],
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
    {
      actions: [
        {
          id: "make_plan",
          label: "Make plan",
          promptId: "make_plan",
          type: "prompt"
        }
      ],
      description: "Ask Codex to create the implementation plan.",
      id: "plan_made",
      label: "Make plan",
      rewindCleanup: {
        actionResults: ["make_plan"]
      }
    },
    {
      actions: [
        {
          id: "execute_plan",
          label: "Execute plan",
          promptId: "execute_plan",
          type: "prompt"
        }
      ],
      description: "Ask Codex to execute the plan.",
      id: "plan_executed",
      label: "Execute plan",
      rewindCleanup: {
        actionResults: ["execute_plan"]
      }
    },
    {
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
      description: "Try the implemented work and request small tweaks before slower review steps.",
      id: "implementation_reviewed",
      label: "Human review",
      rewindCleanup: {
        actionResults: [APPLY_REVIEW_FEEDBACK_ACTION_ID],
        artifacts: [HUMAN_INPUT_RESPONSE_ARTIFACT]
      }
    },
    {
      actions: [
        {
          id: "run_deep_ui_check",
          label: "Run deep UI check",
          promptId: "run_deep_ui_check",
          type: "prompt"
        }
      ],
      description: "Run the deeper UI review when the target supports it.",
      id: "deep_ui_check_run",
      label: "Run deep UI check",
      rewindCleanup: {
        actionResults: ["run_deep_ui_check"]
      }
    },
    {
      actions: [
        {
          id: "run_deslop",
          label: "Run deslop",
          promptId: "run_deslop",
          type: "prompt"
        }
      ],
      description: "Run the review/deslop prompt.",
      id: "review_run",
      label: "Run review/deslop",
      rewindCleanup: {
        actionResults: ["run_deslop"]
      }
    },
    {
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
    {
      actions: [
        reportEditorAction()
      ],
      description: "Review the validated work before the report, commit, and pull request.",
      id: "changes_accepted",
      label: "Final review"
    },
    {
      actions: [
        {
          id: "write_report",
          label: "Write report",
          promptId: "write_report",
          type: "prompt"
        },
        reportEditorAction()
      ],
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
    {
      actions: [
        {
          id: "update_project_knowledge",
          label: "Update project knowledge",
          promptId: "update_project_knowledge",
          type: "prompt"
        }
      ],
      description: "Update adapter-supported project knowledge.",
      id: "project_knowledge_updated",
      label: "Update project knowledge",
      rewindCleanup: {
        actionResults: ["update_project_knowledge"]
      }
    },
    {
      actions: [
        {
          adapterCapability: "commit_changes",
          id: "commit_changes",
          label: "Commit and push changes",
          type: "command"
        }
      ],
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
    {
      actions: [
        {
          id: "create_pr_file",
          label: "Create PR file",
          promptId: "create_pr_file",
          type: "prompt",
          disabledWhen: ["metadata:pr_url"],
          disabledReason: "The GitHub pull request already exists."
        }
      ],
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
    {
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
    {
      actions: [
        reportEditorAction(),
        {
          disabledReason: "Create the pull request before preparing for merge.",
          enabledWhen: ["metadata:pr_url"],
          id: "prepare_for_merge",
          label: "Prepare for merge",
          promptId: "prepare_for_merge",
          type: "prompt"
        },
        {
          adapterCapability: "merge_pr",
          disabledReason: "Create the pull request before merging.",
          enabledWhen: ["metadata:pr_url"],
          id: "merge_pr",
          label: "Merge",
          type: "command"
        }
      ],
      description: "Prepare and merge the pull request.",
      id: "pr_merged",
      label: "Merge PR",
      rewindCleanup: {
        actionResults: ["prepare_for_merge", "merge_pr"],
        metadata: ["pr_merged"]
      }
    },
    {
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
      description: "Sync the main checkout after a successful merge.",
      id: "main_checkout_synced",
      label: "Sync main checkout",
      rewindCleanup: {
        actionResults: ["sync_main_checkout"],
        metadata: ["main_checkout_synced"]
      }
    },
    {
      actions: [
        reportEditorAction(),
        {
          adapterCapability: "finish_session",
          disabledReason: "Create the pull request before finishing the session.",
          enabledWhen: ["metadata:pr_url"],
          id: "finish_session",
          label: "Archive",
          type: "finish"
        }
      ],
      description: "Congratulations. Archive the session.",
      id: "session_finished",
      label: "Congratulations!",
      next: {
        visible: false
      },
      rewindCleanup: {
        actionResults: ["finish_session"]
      }
    }
  ]
});

export {
  DEFAULT_AI_STUDIO_WORKFLOW
};
