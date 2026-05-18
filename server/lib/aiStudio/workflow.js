import { deepFreeze } from "./deepFreeze.js";

const CREATE_ISSUE_FILE_ACTION_ID = "create_issue_file";
const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const PULL_REQUEST_ARTIFACT = "pull_request.md";
const SEND_ISSUE_PROMPT_ACTION_ID = "send_issue_prompt";
const ISSUE_FILES_READY_CONDITION = `artifacts:${ISSUE_TITLE_ARTIFACT},${ISSUE_BODY_ARTIFACT}`;
const ISSUE_PROMPT_HAS_REQUEST_CONDITION = `action-input:${SEND_ISSUE_PROMPT_ACTION_ID}.issueRequest`;
const ISSUE_TITLE_READY_CONDITION = `artifact:${ISSUE_TITLE_ARTIFACT}`;
const ISSUE_BODY_READY_CONDITION = `artifact:${ISSUE_BODY_ARTIFACT}`;

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
          adapterCapability: "create_worktree",
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
          id: SEND_ISSUE_PROMPT_ACTION_ID,
          label: "Send prompt",
          promptId: SEND_ISSUE_PROMPT_ACTION_ID,
          type: "prompt"
        },
        {
          disabledReason: "Issue file already exists.",
          disabledWhen: [ISSUE_FILES_READY_CONDITION],
          enabledWhen: [ISSUE_PROMPT_HAS_REQUEST_CONDITION],
          enabledWhenReason: "Send the issue prompt before creating the issue file.",
          id: CREATE_ISSUE_FILE_ACTION_ID,
          label: "Create issue file",
          promptId: CREATE_ISSUE_FILE_ACTION_ID,
          type: "prompt"
        }
      ],
      description: "Define the issue and create the local issue files.",
      id: ISSUE_FILE_STEP_ID,
      label: "Define issue and create file",
      next: {
        disabledReason: "Discuss and finalise issue before continuing.",
        enabledWhen: [ISSUE_TITLE_READY_CONDITION, ISSUE_BODY_READY_CONDITION]
      },
      rewindCleanup: {
        actionResults: [SEND_ISSUE_PROMPT_ACTION_ID, CREATE_ISSUE_FILE_ACTION_ID],
        artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT]
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
          enabledWhen: [ISSUE_TITLE_READY_CONDITION, ISSUE_BODY_READY_CONDITION],
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
        },
        {
          id: "resolve_deslop",
          label: "Resolve deslop",
          promptId: "resolve_deslop",
          type: "prompt"
        }
      ],
      description: "Run the review/deslop prompts.",
      id: "review_run",
      label: "Run review/deslop",
      rewindCleanup: {
        actionResults: ["run_deslop", "resolve_deslop"]
      }
    },
    {
      actions: [
        {
          adapterCapability: "run_automated_checks",
          id: "run_automated_checks",
          label: "Run automated checks",
          type: "command"
        }
      ],
      description: "Run the adapter-provided automated checks.",
      id: "automated_checks_run",
      label: "Run automated checks",
      next: {
        disabledReason: "Run automated checks successfully before continuing.",
        enabledWhen: ["metadata:automated_checks_passed"]
      },
      rewindCleanup: {
        actionResults: ["run_automated_checks"],
        metadata: ["automated_checks_passed"]
      }
    },
    {
      actions: [],
      description: "Review the finished work before commit.",
      id: "changes_accepted",
      label: "Review changes"
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
          type: "prompt"
        }
      ],
      description: "Create the local pull request file.",
      id: "pr_file_created",
      label: "Create PR file",
      next: {
        disabledReason: "Create the pull request file before continuing.",
        enabledWhen: ["artifact:pull_request.md"]
      },
      rewindCleanup: {
        actionResults: ["create_pr_file"],
        artifacts: [PULL_REQUEST_ARTIFACT]
      }
    },
    {
      actions: [
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
        metadata: ["pr_url"]
      }
    },
    {
      actions: [
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
        {
          adapterCapability: "finish_session",
          disabledReason: "Create the pull request before finishing the session.",
          enabledWhen: ["metadata:pr_url"],
          id: "finish_session",
          label: "Finish",
          type: "finish"
        }
      ],
      description: "Congratulations. Finish the session.",
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
