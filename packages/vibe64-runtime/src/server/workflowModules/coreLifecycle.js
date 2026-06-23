import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  PULL_REQUEST_BODY_DRAFT_ARTIFACT,
  PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
  REPORT_ARTIFACT
} from "../workflowArtifacts.js";
import { when } from "../workflowConditions.js";
import {
  LET_CODEX_DECIDE_INPUT,
  STEP_INPUT_KIND,
  STEP_STATUS,
  actionCreatedMetadata,
  artifactIsReady,
  artifactText,
  assertAgentResultSource,
  commandFailureInteraction,
  commandStepView,
  commandSucceeded,
  currentStepAgentResultInstruction,
  disableAction,
  machineState,
  markCommandActionStarted,
  metadataExists,
  nextForSession,
  normalizeMachineInput,
  promptStepDoneView,
  promptStepWaitingForInputView,
  promptStepWaitingView,
  publicState,
  readState,
  requireInputValue,
  submitCommandFailureInput,
  unsupportedInputKind,
  waitingInputStateDetails,
  writeCommandActionFinishedState,
  writeState
} from "../workflowStepMachineHelpers.js";

const moduleId = "core.lifecycle";

const sessionCreatedStepId = "session_created";
const workSourceSelectedStepId = "work_source_selected";
const prSourceSelectedStepId = "pr_source_selected";
const worktreeCreatedStepId = "worktree_created";
const dependenciesInstalledStepId = "dependencies_installed";
const changesCommittedStepId = "changes_committed";
const createAndMergePullRequestStepId = "create_and_merge_pull_request";
const sessionFinishedStepId = "session_finished";
const installDependenciesActionId = "install_dependencies";
const dependenciesInstalledMetadataName = "dependencies_installed";
const syncMainCheckoutActionId = "sync_main_checkout";
const mainCheckoutSyncedMetadataName = "main_checkout_synced";
const mergePreparationSummaryMetadataName = "merge_preparation_summary";
const finalReportStartMarker = "<!-- vibe64:final-report:start -->";
const finalReportEndMarker = "<!-- vibe64:final-report:end -->";

async function recordMergeIntent(ctx = {}) {
  await ctx.writeMetadata("autopilot_merge_intent", "merge_and_sync");
  return ctx.getSession();
}

async function skipMergeAndFinish(ctx = {}) {
  await ctx.runAction("skip_merge", {});
  await ctx.writeMetadata("merge_skipped", "yes");
  return ctx.goTo(sessionFinishedStepId);
}

const coreLifecycleWorkflowIntentHandlers = deepFreeze({
  [createAndMergePullRequestStepId]: {
    merge_and_sync: recordMergeIntent,
    skip_merge: skipMergeAndFinish
  }
});

const coreLifecycleStepDefinitionsById = deepFreeze({
  [sessionCreatedStepId]: {
    description: "Create the Vibe64 session.",
    id: sessionCreatedStepId,
    label: "Create session",
    rewindable: false
  },
  [workSourceSelectedStepId]: {
    actions: [
      {
        disabledReason: "Work source is already selected.",
        disabledWhen: [when.metadataExists("work_source")],
        advanceOnSuccess: true,
        icon: "branch",
        id: "use_new_issue",
        label: "Start fresh with a new issue",
        type: "adapter"
      },
      {
        disabledReason: "Work source is already selected.",
        disabledWhen: [when.metadataExists("work_source")],
        advanceOnSuccess: true,
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
        label: "Solve existing issue",
        type: "adapter"
      },
      {
        disabledReason: "Work source is already selected.",
        disabledWhen: [when.metadataExists("work_source")],
        advanceOnSuccess: true,
        auditMessage: "Will work without creating an issue.",
        icon: "message-square-plus",
        id: "use_description",
        label: "Describe work without an issue",
        type: "adapter"
      }
    ],
    autopilot: {
      completeWhen: [when.metadataExists("work_source")],
      kind: "work_source",
      label: "Choose starting point",
      stop: true
    },
    description: "Choose whether this session starts fresh with a new issue, solves an existing issue, or starts from a plain work description.",
    id: workSourceSelectedStepId,
    label: "Choose starting point",
    next: {
      disabledReason: "Choose a starting point before continuing.",
      enabledWhen: [when.metadataExists("work_source")]
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: "use_new_issue",
            id: "use_new_issue",
            label: "New issue",
            style: "primary",
            type: "action"
          },
          {
            actionId: "use_existing_issue",
            id: "use_existing_issue",
            label: "Existing issue",
            style: "secondary",
            type: "action"
          },
          {
            actionId: "use_description",
            id: "use_description",
            label: "No issue",
            style: "secondary",
            type: "action"
          }
        ],
        screen: {
          kind: "work_source",
          message: "What would you like this session to do? Choose New issue to start fresh and let Vibe64 create a GitHub issue for the work. Choose Existing issue if you already have an issue number or URL. Choose No issue when you only want to describe the work in chat and do not need a GitHub issue.",
          sections: [],
          title: "Choose starting point",
          variant: "guide"
        }
      }
    },
    rewindable: false
  },
  [prSourceSelectedStepId]: {
    actions: [
      {
        disabledReason: "Pull request source is already selected.",
        disabledWhen: [when.metadataExists("pr_source")],
        enabledWhen: [when.metadataExists("github_repository")],
        enabledWhenReason: "This project does not have an unambiguous GitHub repository.",
        advanceOnSuccess: true,
        auditMessage: "Will create a new pull request.",
        icon: "github",
        id: "use_new_pr",
        label: "Create a new PR",
        type: "adapter"
      },
      {
        disabledReason: "Pull request source is already selected.",
        disabledWhen: [when.metadataExists("pr_source")],
        enabledWhen: [when.metadataExists("github_repository")],
        enabledWhenReason: "This project does not have an unambiguous GitHub repository.",
        advanceOnSuccess: true,
        icon: "github",
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
      completeWhen: [when.metadataExists("pr_source")],
      kind: "pr_source",
      label: "Choose pull request",
      stop: true
    },
    description: "Choose whether Vibe64 should create a new pull request or continue from an existing pull request.",
    id: prSourceSelectedStepId,
    label: "Choose pull request",
    next: {
      disabledReason: "Choose a pull request option before continuing.",
      enabledWhen: [when.metadataExists("pr_source")]
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: "use_new_pr",
            id: "use_new_pr",
            label: "New PR",
            style: "primary",
            type: "action"
          },
          {
            actionId: "use_existing_pr",
            id: "use_existing_pr",
            label: "Existing PR",
            style: "secondary",
            type: "action"
          }
        ],
        screen: {
          kind: "pr_source",
          message: "How should Vibe64 publish the finished work? Choose New PR to create one later. Choose Existing PR to stack this session on a pull request that already exists.",
          sections: [],
          title: "Choose pull request",
          variant: "guide"
        }
      }
    },
    rewindable: false
  },
  [worktreeCreatedStepId]: {
    actions: [
      {
        adapterCapability: "create_worktree",
        disabledReason: "Worktree already exists.",
        disabledWhen: [when.metadataExists("worktree_path")],
        enabledWhen: [when.metadataExists("work_source"), when.metadataExists("pr_source")],
        enabledWhenReason: "Choose the work and pull request source before creating the worktree.",
        auditMessage: "Worktree created.",
        icon: "sync",
        id: "create_worktree",
        label: "Create worktree",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "create_worktree",
      completeWhen: [when.metadataExists("worktree_path")],
      label: "Create worktree"
    },
    description: "Create the isolated worktree or target-specific working area.",
    id: worktreeCreatedStepId,
    interaction: {
      kind: "run_action",
      primaryActionLabel: "Create worktree",
      title: "Create worktree"
    },
    label: "Create worktree",
    next: {
      disabledReason: "Create the worktree before continuing.",
      enabledWhen: [when.metadataExists("worktree_path")]
    },
    rewindable: false
  },
  [dependenciesInstalledStepId]: {
    actions: [
      {
        adapterCapability: installDependenciesActionId,
        disabledReason: "Dependencies are already installed.",
        disabledWhen: [when.metadataExists(dependenciesInstalledMetadataName)],
        auditMessage: "Dependencies installed.",
        icon: "sync",
        id: installDependenciesActionId,
        label: "Install dependencies",
        type: "command"
      }
    ],
    autopilot: {
      actionId: installDependenciesActionId,
      completeWhen: [when.metadataExists(dependenciesInstalledMetadataName)],
      label: "Install dependencies"
    },
    description: "Install target dependencies when the adapter requires them.",
    id: dependenciesInstalledStepId,
    interaction: {
      kind: "run_action",
      primaryActionLabel: "Install dependencies",
      title: "Install dependencies"
    },
    label: "Install dependencies",
    next: {
      disabledReason: "Install dependencies before continuing.",
      enabledWhen: [when.metadataExists(dependenciesInstalledMetadataName)]
    },
    rewindCleanup: {
      actionResults: [installDependenciesActionId],
      metadata: [dependenciesInstalledMetadataName, "dependencies_path"]
    }
  },
  [changesCommittedStepId]: {
    actions: [
      {
        adapterCapability: "commit_changes",
        composerMenu: {
          icon: "source-commit",
          order: 100
        },
        icon: "commit",
        id: "commit_changes",
        label: "Commit changes",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "commit_changes",
      completeWhen: [
        when.metadataExists("accepted_commit")
      ],
      label: "Commit changes"
    },
    description: "Commit the accepted changes, then publish them when a remote is configured or apply them locally when this editor has no remote.",
    id: changesCommittedStepId,
    label: "Commit changes",
    next: {
      disabledReason: "Commit changes before continuing.",
      enabledWhen: [when.metadataExists("accepted_commit")]
    },
    rewindCleanup: {
      actionResults: ["commit_changes"],
      metadata: ["accepted_commit", "branch_pushed"]
    }
  },
  [createAndMergePullRequestStepId]: {
    actions: [
      {
        enabledWhen: [when.metadataExists("pr_url")],
        hrefMetadata: "pr_url",
        icon: "github",
        id: "open_pr",
        label: "Open PR",
        type: "link"
      },
      {
        auditMessage: "Draft pull request.",
        composerMenu: {
          icon: "pull-request",
          order: 110
        },
        disabledReason: "Pull request details are already ready for review.",
        disabledWhen: [
          when.any(
            when.allArtifactsReady(PULL_REQUEST_TITLE_DRAFT_ARTIFACT, PULL_REQUEST_BODY_DRAFT_ARTIFACT),
            when.metadataExists("pr_url")
          )
        ],
        id: "resolve_pull_request",
        label: "Draft PR",
        promptId: "resolve_pull_request",
        type: "prompt"
      },
      {
        adapterCapability: "create_pr_on_gh",
        auditMessage: "Pull request draft accepted; creating GitHub pull request.",
        composerMenu: {
          icon: "github",
          order: 120
        },
        disabledReason: "Commit and push changes before creating the GitHub pull request.",
        disabledWhen: [when.metadataExists("pr_url")],
        disabledWhenReason: "The GitHub pull request already exists.",
        enabledWhen: [
          when.artifactReady(PULL_REQUEST_TITLE_DRAFT_ARTIFACT),
          when.artifactReady(PULL_REQUEST_BODY_DRAFT_ARTIFACT),
          when.metadataExists("branch_pushed")
        ],
        enabledWhenReason: "Save the pull request title/body and push the branch before creating the GitHub pull request.",
        icon: "github",
        id: "create_pr_on_gh",
        label: "Create PR on GH",
        saveCurrentStepInputBeforeRun: true,
        type: "command"
      },
      {
        auditMessage: "Prepare pull request for merge.",
        composerMenu: {
          icon: "merge",
          label: "Prepare merge",
          order: 130
        },
        disabledReason: "Create the pull request before preparing for merge.",
        disabledWhen: [
          when.metadataExists("pr_merged"),
          when.metadataExists("merge_skipped")
        ],
        disabledWhenReason: "A merge decision has already been recorded.",
        enabledWhen: [when.metadataExists("pr_url")],
        id: "prepare_for_merge",
        label: "Prepare for merge",
        promptId: "prepare_for_merge",
        type: "prompt"
      },
      {
        adapterCapability: "merge_pr",
        auditMessage: "Merge pull request.",
        composerMenu: {
          icon: "merge",
          label: "Merge PR",
          order: 140
        },
        disabledReason: "Create the pull request before merging.",
        disabledWhen: [
          when.metadataExists("pr_merged"),
          when.metadataExists("merge_skipped")
        ],
        disabledWhenReason: "A merge decision has already been recorded.",
        enabledWhen: [when.metadataExists("pr_url")],
        icon: "github",
        id: "merge_pr",
        label: "Merge",
        type: "command"
      },
      {
        adapterCapability: syncMainCheckoutActionId,
        auditMessage: "Update main checkout after merge.",
        composerMenu: {
          icon: "sync",
          label: "Sync main",
          order: 150
        },
        disabledReason: "Merge the pull request before syncing the main checkout.",
        disabledWhen: [
          when.metadataExists(mainCheckoutSyncedMetadataName),
          when.metadataExists("merge_skipped")
        ],
        disabledWhenReason: "The main checkout sync has already been resolved.",
        enabledWhen: [
          when.metadataExists("pr_url"),
          when.metadataExists("pr_merged")
        ],
        enabledWhenReason: "Merge the pull request before syncing the main checkout.",
        icon: "sync",
        id: syncMainCheckoutActionId,
        label: "Sync main checkout",
        type: "command"
      },
      {
        auditMessage: "Pull request will not be merged.",
        disabledReason: "A merge decision has already been recorded.",
        disabledWhen: [
          when.metadataExists("pr_merged"),
          when.metadataExists("merge_skipped")
        ],
        enabledWhen: [when.metadataExists("pr_url")],
        enabledWhenReason: "Create the pull request before choosing not to merge.",
        id: "skip_merge",
        label: "Do not merge",
        type: "adapter"
      }
    ],
    autopilot: {
      actionSequence: [
        {
          actionId: "resolve_pull_request",
          completeWhen: [when.allArtifactsReady(PULL_REQUEST_TITLE_DRAFT_ARTIFACT, PULL_REQUEST_BODY_DRAFT_ARTIFACT)],
          label: "Draft PR"
        },
        {
          actionId: "create_pr_on_gh",
          completeWhen: [when.metadataExists("pr_url")],
          label: "Create PR on GH"
        }
      ],
      label: "Create pull request, possibly merge"
    },
    description: "Submit the pull request body, create the GitHub pull request, then merge and sync the main checkout or skip merging.",
    id: createAndMergePullRequestStepId,
    label: "Create pull request, possibly merge",
    next: {
      disabledReason: "Create the pull request, then merge and sync the main checkout or choose not to merge before continuing.",
      enabledWhen: [
        when.any(
          when.metadataExists(mainCheckoutSyncedMetadataName),
          when.metadataExists("merge_skipped")
        )
      ]
    },
    presentation: {
      automation: {
        mergeIntent: {
          mergeActionId: "merge_pr",
          mergedMetadataName: "pr_merged",
          metadataName: "autopilot_merge_intent",
          metadataValue: "merge_and_sync",
          prepareActionId: "prepare_for_merge",
          syncActionId: syncMainCheckoutActionId,
          syncedMetadataName: mainCheckoutSyncedMetadataName,
          skippedMetadataName: "merge_skipped"
        }
      },
      stop: {
        intents: [
          {
            auditMessage: "Merge pull request and update main checkout.",
            enabledWhenAction: "prepare_for_merge",
            id: "merge_and_sync",
            label: "Merge and update main checkout",
            style: "primary"
          },
          {
            auditMessage: "Pull request will not be merged.",
            enabledWhenAction: "skip_merge",
            id: "skip_merge",
            label: "Do not merge"
          }
        ],
        screen: {
          kind: "merge",
          message: "The pull request is ready. Merge it and update the main checkout, or finish without merging.",
          sections: ["report_preview"],
          title: "Merge pull request?"
        }
      }
    },
    rewindCleanup: {
      actionResults: ["resolve_pull_request", "create_pr_on_gh", "prepare_for_merge", "merge_pr", syncMainCheckoutActionId, "skip_merge"],
      artifacts: [
        PULL_REQUEST_BODY_DRAFT_ARTIFACT,
        PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
        "create_and_merge_pull_request.url.txt",
        "create_and_merge_pull_request.number.txt",
        "create_and_merge_pull_request.source.txt"
      ],
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
        },
        "pr_merged",
        mainCheckoutSyncedMetadataName,
        "merge_skipped",
        "autopilot_merge_intent",
        mergePreparationSummaryMetadataName
      ]
    }
  },
  [sessionFinishedStepId]: {
    actions: [
      {
        adapterCapability: "finish_session",
        composerMenu: {
          icon: "archive",
          label: "Archive session",
          order: 160
        },
        disabledReason: "Finish the local commit or pull request flow before archiving.",
        enabledWhen: [
          when.any(
            when.metadataExists("local_commit_only"),
            when.metadataExists(mainCheckoutSyncedMetadataName),
            when.metadataExists("merge_skipped")
          )
        ],
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
    id: sessionFinishedStepId,
    label: "Congratulations!",
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

const sessionCreatedMachine = {
  stepId: sessionCreatedStepId,

  initialState() {
    return machineState(STEP_STATUS.DONE);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    return {
      next: nextForSession(context.session, {
        enabled: true
      }),
      stepMachine: publicState(this, state)
    };
  }
};

const workSourceSelectedMachine = {
  stepId: workSourceSelectedStepId,

  initialState(context = {}) {
    return metadataExists(context.session, "work_source")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "work_source")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Choose a starting point before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionFinished(context = {}) {
    if (!["use_new_issue", "use_existing_issue", "use_description"].includes(context.actionId)) {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "work_source")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.FAILED, {
              message: normalizeText(context.actionResult?.message)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const prSourceSelectedMachine = {
  stepId: prSourceSelectedStepId,

  initialState(context = {}) {
    return metadataExists(context.session, "pr_source")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "pr_source")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Choose a pull request option before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionFinished(context = {}) {
    if (!["use_new_pr", "use_existing_pr"].includes(context.actionId)) {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "pr_source")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.FAILED, {
              message: normalizeText(context.actionResult?.message)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const worktreeCreatedMachine = {
  stepId: worktreeCreatedStepId,

  initialState(context = {}) {
    if (metadataExists(context.session, "worktree_path")) {
      return machineState(STEP_STATUS.DONE);
    }
    if (!metadataExists(context.session, "work_source") || !metadataExists(context.session, "pr_source")) {
      return machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: "Choose the work and pull request source before creating the worktree."
      });
    }
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "worktree_path")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "create_worktree", "This step is already complete."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.from === STEP_STATUS.ATTEMPTING_EXECUTION) {
          return {
            interaction: commandFailureInteraction({
              prompt: state.message || "The worktree command failed. Explain what should happen, then retry the command.",
              title: "Worktree command needs attention"
            }),
            next: nextForSession(context.session, {
              disabledReason: "Resolve the worktree command failure before continuing."
            }),
            stepMachine: publicState(this, state)
          };
        }
        return {
          next: nextForSession(context.session, {
            disabledReason: state.message || "Create the worktree before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Create the worktree before continuing."
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
        throw vibe64Error("The worktree step cannot accept input right now.", "vibe64_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_worktree") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "create_worktree") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "worktree_path")
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

const dependenciesInstalledMachine = {
  stepId: dependenciesInstalledStepId,

  initialState(context = {}) {
    return metadataExists(context.session, dependenciesInstalledMetadataName)
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, dependenciesInstalledMetadataName)) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, installDependenciesActionId, "This step is already complete."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        return {
          actions: disableAction(context.session, installDependenciesActionId, "Resolve the install command failure before retrying."),
          interaction: commandFailureInteraction({
            prompt: state.message || "The install command failed. Explain what should happen, then retry the command.",
            title: "Install command needs attention"
          }),
          next: nextForSession(context.session, {
            disabledReason: "Resolve the install command failure before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Install dependencies before continuing."
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
        throw vibe64Error("The dependency install step cannot accept input right now.", "vibe64_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== installDependenciesActionId) {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== installDependenciesActionId) {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, dependenciesInstalledMetadataName)
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

const changesCommittedMachine = {
  stepId: changesCommittedStepId,

  initialState(context = {}) {
    return metadataExists(context.session, "accepted_commit")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "accepted_commit")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Commit and push changes before continuing.",
      failurePrompt: "The commit or push command failed. Explain what should happen, then retry it.",
      failureTitle: "Commit needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["commit_changes"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["commit_changes"],
      done: await actionCreatedMetadata(context, "accepted_commit"),
      failureTitle: "Commit needs attention"
    });
  }
};

const pullRequestPhase = Object.freeze({
  CREATING_PR: "creating_pr",
  DRAFTING: "drafting",
  MERGE_READY: "merge_ready",
  MERGING: "merging",
  PREPARING_MERGE: "preparing_merge",
  REVIEW_DRAFT: "review_draft",
  SYNC_READY: "sync_ready",
  SYNCING_MAIN: "syncing_main"
});

function pullRequestStepComplete(session = {}) {
  return metadataExists(session, mainCheckoutSyncedMetadataName) ||
    metadataExists(session, "merge_skipped") ||
    metadataExists(session, "local_commit_only");
}

function mainCheckoutSyncPending(session = {}) {
  return metadataExists(session, "pr_merged") && !metadataExists(session, mainCheckoutSyncedMetadataName);
}

function mergeReviewAutopilot() {
  return {
    kind: "merge_review",
    stage: null,
    stop: true
  };
}

const createAndMergePullRequestMachine = {
  promptActionId: "prepare_for_merge",
  stepId: createAndMergePullRequestStepId,

  initialState(context = {}) {
    if (pullRequestStepComplete(context.session)) {
      return machineState(STEP_STATUS.DONE);
    }
    if (mainCheckoutSyncPending(context.session)) {
      return machineState(STEP_STATUS.READY, {
        phase: pullRequestPhase.SYNC_READY
      });
    }
    if (metadataExists(context.session, "pr_url")) {
      return machineState(STEP_STATUS.READY, {
        phase: pullRequestPhase.MERGE_READY
      });
    }
    return pullRequestFilesAreReady(context.session)
      ? machineState(STEP_STATUS.CONFIRM_FILES, {
          phase: pullRequestPhase.REVIEW_DRAFT
        })
      : machineState(STEP_STATUS.READY, {
          phase: pullRequestPhase.DRAFTING
        });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (pullRequestStepComplete(context.session)) {
      state = machineState(STEP_STATUS.DONE);
    } else if (mainCheckoutSyncPending(context.session) && ![
      STEP_STATUS.ATTEMPTING_EXECUTION,
      STEP_STATUS.WAITING_FOR_INPUT
    ].includes(state.status)) {
      state = machineState(STEP_STATUS.READY, {
        phase: pullRequestPhase.SYNC_READY
      });
    } else if (metadataExists(context.session, "pr_url") && ![
      STEP_STATUS.AWAITING_AGENT_RESULT,
      STEP_STATUS.ATTEMPTING_EXECUTION,
      STEP_STATUS.WAITING_FOR_INPUT
    ].includes(state.status)) {
      state = machineState(STEP_STATUS.READY, {
        phase: pullRequestPhase.MERGE_READY,
        promptComplete: state.promptComplete === true
      });
    } else if (
      pullRequestFilesAreReady(context.session) &&
      state.status !== STEP_STATUS.CONFIRM_FILES &&
      ![
        pullRequestPhase.CREATING_PR,
        pullRequestPhase.PREPARING_MERGE,
        pullRequestPhase.MERGING,
        pullRequestPhase.SYNCING_MAIN
      ].includes(state.phase)
    ) {
      state = machineState(STEP_STATUS.CONFIRM_FILES, {
        phase: pullRequestPhase.REVIEW_DRAFT
      });
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);

      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readPullRequestFieldValues(context);
        return {
          interaction: pullRequestInputInteraction(values),
          next: nextForSession(context.session, {
            disabledReason: "Create the pull request before choosing whether to merge."
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Review the pull request draft."
          })
        };
      }

      case STEP_STATUS.WAITING_FOR_INPUT:
        if ([pullRequestPhase.CREATING_PR, pullRequestPhase.MERGING, pullRequestPhase.SYNCING_MAIN].includes(state.phase)) {
          const waitingActionId = state.phase === pullRequestPhase.MERGING
            ? "merge_pr"
            : (state.phase === pullRequestPhase.SYNCING_MAIN ? syncMainCheckoutActionId : "create_pr_on_gh");
          return {
            actions: disableAction(
              context.session,
              waitingActionId,
              state.phase === pullRequestPhase.MERGING
                ? "Resolve the merge command before retrying."
                : (state.phase === pullRequestPhase.SYNCING_MAIN
                    ? "Resolve the main checkout sync command before retrying."
                    : "Resolve the pull request command before retrying.")
            ),
            interaction: commandFailureInteraction({
              prompt: state.message || (state.phase === pullRequestPhase.SYNCING_MAIN
                ? "The main checkout sync command failed. Explain what should happen, then retry it."
                : "The pull request command failed. Explain what should happen, then retry."),
              title: state.title || (state.phase === pullRequestPhase.SYNCING_MAIN
                ? "Main checkout sync needs attention"
                : "Pull request needs attention")
            }),
            next: nextForSession(context.session, {
              disabledReason: state.phase === pullRequestPhase.SYNCING_MAIN
                ? "Resolve the main checkout sync command before continuing."
                : "Resolve the pull request command before continuing."
            }),
            stepMachine: publicState(this, state)
          };
        }
        return promptStepWaitingForInputView(context, this, {
          ...state,
          message: state.message || "The pull request step needs input before it can continue."
        }, {
          actionId: state.phase === pullRequestPhase.DRAFTING ? "resolve_pull_request" : "prepare_for_merge",
          prompt: state.message || "The pull request step needs input before it can continue.",
          skipInput: LET_CODEX_DECIDE_INPUT,
          title: state.phase === pullRequestPhase.DRAFTING ? "Pull request needs input" : "Merge needs input"
        });

      case STEP_STATUS.READY:
        if (state.phase === pullRequestPhase.MERGE_READY) {
          return {
            next: nextForSession(context.session, {
              disabledReason: "Merge the pull request and sync the main checkout, or choose not to merge before continuing."
            }),
            stepMachine: publicState(this, state),
            workflowAutopilot: mergeReviewAutopilot()
          };
        }
        if (state.phase === pullRequestPhase.SYNC_READY) {
          return {
            next: nextForSession(context.session, {
              disabledReason: "Sync the main checkout after merging before continuing."
            }),
            stepMachine: publicState(this, state),
            workflowAutopilot: mergeReviewAutopilot()
          };
        }
        return promptStepWaitingView(context, this, state, "Create the pull request before choosing whether to merge.");

      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Create the pull request, then merge and sync the main checkout or choose not to merge before continuing.");
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.CONFIRM_FILES:
      case STEP_STATUS.FAILED:
        if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
          assertAgentResultSource(context.session, input);
        }
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, waitingInputStateDetails(input, {
            phase: state.phase || pullRequestPhase.DRAFTING
          })));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          if (state.phase === pullRequestPhase.CREATING_PR) {
            await writeState(context, this, pullRequestFilesAreReady(context.session)
              ? machineState(STEP_STATUS.CONFIRM_FILES, {
                  message: input.message,
                  phase: pullRequestPhase.REVIEW_DRAFT,
                  response: input.text || input.fields.response,
                  source: input.source
                })
              : machineState(STEP_STATUS.READY, {
                  message: input.message,
                  phase: pullRequestPhase.DRAFTING,
                  response: input.text || input.fields.response,
                  source: input.source
                }));
            return;
          }
          if (state.phase === pullRequestPhase.SYNCING_MAIN) {
            await writeState(context, this, machineState(STEP_STATUS.READY, {
              phase: pullRequestPhase.SYNC_READY,
              response: input.text || input.fields.response,
              source: input.source
            }));
            return;
          }
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            phase: state.phase || pullRequestPhase.MERGE_READY,
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY && state.phase === pullRequestPhase.PREPARING_MERGE) {
          await writeMergePreparationSummary(context, input.fields.mergePreparationSummary);
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            phase: pullRequestPhase.MERGE_READY,
            promptComplete: true,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY || input.kind === STEP_INPUT_KIND.CONFIRM_FILES) {
          await writePullRequestFieldValues(context, input.fields);
          await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES, {
            phase: pullRequestPhase.REVIEW_DRAFT,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("The pull request step cannot accept input right now.", "vibe64_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    const state = await readState(context, this);
    if (context.actionId === "resolve_pull_request") {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: pullRequestPhase.DRAFTING,
        response: state.response,
        source: state.source
      }));
      return;
    }
    if (context.actionId === "prepare_for_merge") {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: pullRequestPhase.PREPARING_MERGE,
        response: state.response,
        source: state.source
      }));
      return;
    }
    if (context.actionId === "create_pr_on_gh") {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        actionId: context.actionId,
        phase: pullRequestPhase.CREATING_PR
      }));
      return;
    }
    if (context.actionId === "merge_pr") {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        actionId: context.actionId,
        phase: pullRequestPhase.MERGING
      }));
      return;
    }
    if (context.actionId === syncMainCheckoutActionId) {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        actionId: context.actionId,
        phase: pullRequestPhase.SYNCING_MAIN
      }));
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId === "skip_merge") {
      await writeState(context, this, machineState(STEP_STATUS.DONE));
      return;
    }
    if (context.actionId === "create_pr_on_gh") {
      await writeState(context, this, await actionCreatedMetadata(context, "pr_url")
        ? machineState(STEP_STATUS.READY, {
            phase: pullRequestPhase.MERGE_READY
          })
        : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.ATTEMPTING_EXECUTION,
            message: normalizeText(context.actionResult?.message),
            output: normalizeText(context.actionResult?.output),
            phase: pullRequestPhase.CREATING_PR,
            title: "Pull request needs attention"
          }));
      return;
    }
    if (context.actionId === "merge_pr") {
      await writeState(context, this, await actionCreatedMetadata(context, "pr_merged")
        ? machineState(STEP_STATUS.READY, {
            phase: pullRequestPhase.SYNC_READY
          })
        : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.ATTEMPTING_EXECUTION,
            message: normalizeText(context.actionResult?.message),
            output: normalizeText(context.actionResult?.output),
            phase: pullRequestPhase.MERGING,
            title: "Merge needs attention"
          }));
      return;
    }
    if (context.actionId === syncMainCheckoutActionId) {
      await writeState(context, this, await actionCreatedMetadata(context, mainCheckoutSyncedMetadataName)
        ? machineState(STEP_STATUS.DONE)
        : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.ATTEMPTING_EXECUTION,
            message: normalizeText(context.actionResult?.message),
            output: normalizeText(context.actionResult?.output),
            phase: pullRequestPhase.SYNCING_MAIN,
            title: "Main checkout sync needs attention"
          }));
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    if (input.kind !== STEP_INPUT_KIND.READY && input.kind !== STEP_INPUT_KIND.CONFIRM_FILES) {
      return "";
    }
    if (
      context.session.stepMachine?.phase === pullRequestPhase.PREPARING_MERGE ||
      Object.hasOwn(input.fields || {}, "mergePreparationSummary")
    ) {
      return "Merge preparation completed.";
    }
    if (input.source === "codex") {
      return pullRequestDraftConversationMessage(input, "Proposed");
    }
    if (input.source === "ui") {
      return pullRequestDraftConversationMessage(input, "Saved");
    }
    return "Pull request draft submitted for review.";
  },

  promptInstruction({ action = {} } = {}) {
    return normalizeText(action.id) === "prepare_for_merge"
      ? currentStepAgentResultInstruction({
          doneFields: {
            mergePreparationSummary: "Markdown summary of extra merge-preparation work performed after pull request creation. Leave empty when no extra work was needed."
          },
          doneMeaning: "The pull request and main checkout are ready for the merge command.",
          waitingForInputMeaning: "The merge preparation found a blocker that needs user input."
        })
      : currentStepAgentResultInstruction({
          doneFields: {
            body: "Markdown pull request body",
            title: "Pull request title"
          },
          doneMeaning: "The pull request title and body are ready for user confirmation.",
          waitingForInputMeaning: "You cannot draft the pull request without a user decision or missing repository context."
        });
  }
};

const sessionFinishedMachine = {
  stepId: sessionFinishedStepId,

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
      disabledReason: "Archive the session when you are finished.",
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

function pullRequestFilesAreReady(session = {}) {
  return [
    PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
    PULL_REQUEST_BODY_DRAFT_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

async function readPullRequestFieldValues(context = {}) {
  const [title, body] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_TITLE_DRAFT_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_BODY_DRAFT_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title)
  };
}

async function writePullRequestFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Pull request title is required.");
  const body = requireInputValue(fields.body, "Pull request body is required.");
  const bodyWithReport = await pullRequestBodyWithFinalReport(context, body);
  await Promise.all([
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
      artifactText(title)
    ),
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_BODY_DRAFT_ARTIFACT,
      artifactText(bodyWithReport)
    )
  ]);
}

async function pullRequestBodyWithFinalReport(context = {}, body = "") {
  const normalizedBody = normalizeText(body);
  if (normalizedBody.includes(finalReportStartMarker)) {
    return normalizedBody;
  }
  const report = normalizeText(await context.runtime.store.readArtifact(context.session.sessionId, REPORT_ARTIFACT));
  if (!report) {
    return normalizedBody;
  }
  return [
    normalizedBody,
    "",
    finalReportStartMarker,
    "## Vibe64 final report",
    "",
    "<details>",
    "<summary>Final session report</summary>",
    "",
    report,
    "",
    "</details>",
    finalReportEndMarker
  ].join("\n");
}

async function writeMergePreparationSummary(context = {}, summary = "") {
  const normalizedSummary = normalizeText(summary);
  if (normalizedSummary) {
    await context.runtime.store.writeMetadataValue(
      context.session.sessionId,
      mergePreparationSummaryMetadataName,
      normalizedSummary
    );
    return;
  }
  await context.runtime.store.deleteMetadataValue(
    context.session.sessionId,
    mergePreparationSummaryMetadataName
  );
}

function conversationSection(label = "", value = "") {
  return [
    `${label}:`,
    normalizeText(value) || "(empty)"
  ].join("\n");
}

function pullRequestDraftConversationMessage(input = {}, verb = "Proposed") {
  const fields = input.fields || {};
  return [
    `${verb} pull request draft.`,
    "",
    conversationSection("Title", fields.title),
    "",
    conversationSection("Body", fields.body)
  ].join("\n");
}

function pullRequestInputInteraction(values = {}) {
  return {
    fields: [
      {
        kind: "text",
        label: "Pull request title",
        name: "title",
        required: true,
        requiredMessage: "Pull request title is required.",
        value: values.title || ""
      },
      {
        kind: "textarea",
        label: "Pull request body",
        name: "body",
        required: true,
        requiredMessage: "Pull request body is required.",
        value: values.body || ""
      }
    ],
    kind: "collect_input_run_command",
    prompt: "Review the pull request details. Save changes here, or continue to create the GitHub pull request.",
    submitKind: STEP_INPUT_KIND.CONFIRM_FILES,
    submitLabel: "Save draft",
    title: "Create pull request, possibly merge"
  };
}

const coreLifecycleSteps = Object.freeze([
  {
    definition: coreLifecycleStepDefinitionsById[sessionCreatedStepId],
    id: sessionCreatedStepId,
    machine: sessionCreatedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[workSourceSelectedStepId],
    id: workSourceSelectedStepId,
    machine: workSourceSelectedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[prSourceSelectedStepId],
    id: prSourceSelectedStepId,
    machine: prSourceSelectedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[worktreeCreatedStepId],
    id: worktreeCreatedStepId,
    machine: worktreeCreatedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[dependenciesInstalledStepId],
    id: dependenciesInstalledStepId,
    machine: dependenciesInstalledMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[changesCommittedStepId],
    id: changesCommittedStepId,
    machine: changesCommittedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[createAndMergePullRequestStepId],
    id: createAndMergePullRequestStepId,
    machine: createAndMergePullRequestMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[sessionFinishedStepId],
    id: sessionFinishedStepId,
    machine: sessionFinishedMachine
  }
]);

const coreLifecycleWorkflowModule = Object.freeze({
  id: moduleId,
  steps: coreLifecycleSteps,
  workflowDefinitions: []
});

const _testing = deepFreeze({
  moduleId: moduleId,
  ownedStepIds: [
    sessionCreatedStepId,
    workSourceSelectedStepId,
    prSourceSelectedStepId,
    worktreeCreatedStepId,
    dependenciesInstalledStepId,
    changesCommittedStepId,
    createAndMergePullRequestStepId,
    sessionFinishedStepId
  ]
});

export {
  _testing,
  coreLifecycleWorkflowIntentHandlers,
  coreLifecycleWorkflowModule
};
