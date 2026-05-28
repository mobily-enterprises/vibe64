import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  PULL_REQUEST_BODY_DRAFT_ARTIFACT,
  PULL_REQUEST_TITLE_DRAFT_ARTIFACT
} from "../workflowArtifacts.js";
import { when } from "../workflowConditions.js";
import {
  STEP_INPUT_KIND,
  STEP_STATUS,
  actionCreatedMetadata,
  allMetadataExists,
  artifactIsReady,
  artifactText,
  assertAgentResultSource,
  commandFailureInteraction,
  commandStepView,
  commandSucceeded,
  currentStepHelperInstruction,
  disableAction,
  machineState,
  markCommandActionStarted,
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
  submitCommandFailureInput,
  unsupportedInputKind,
  writeCommandActionFinishedState,
  writeState
} from "../workflowStepMachineHelpers.js";

const moduleId = "core.lifecycle";

const sessionCreatedStepId = "session_created";
const workSourceSelectedStepId = "work_source_selected";
const worktreeCreatedStepId = "worktree_created";
const dependenciesInstalledStepId = "dependencies_installed";
const projectValidatedStepId = "project_validated";
const changesCommittedStepId = "changes_committed";
const createPullRequestStepId = "create_pull_request";
const prMergedStepId = "pr_merged";
const mainCheckoutSyncedStepId = "main_checkout_synced";
const sessionFinishedStepId = "session_finished";
const installDependenciesActionId = "install_dependencies";
const dependenciesInstalledMetadataName = "dependencies_installed";

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
  [prMergedStepId]: {
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
        icon: "branch",
        id: "use_new_branch",
        label: "Start fresh with a new issue",
        type: "adapter"
      },
      {
        disabledReason: "Work source is already selected.",
        disabledWhen: [when.metadataExists("work_source")],
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
      completeWhen: [when.metadataExists("work_source")],
      kind: "work_source",
      label: "Choose starting point",
      stop: true
    },
    description: "Choose whether this session starts fresh with a new issue, solves an existing issue, or builds on an existing pull request.",
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
            actionId: "use_new_branch",
            id: "use_new_branch",
            label: "Start fresh with a new issue",
            style: "primary",
            type: "action"
          },
          {
            actionId: "use_existing_issue",
            id: "use_existing_issue",
            label: "Solve existing issue",
            style: "secondary",
            type: "action"
          },
          {
            actionId: "use_existing_pr",
            id: "use_existing_pr",
            label: "Use existing PR",
            style: "secondary",
            type: "action"
          }
        ],
        screen: {
          kind: "work_source",
          message: "Start fresh with a new issue, solve an existing issue, or build on an existing pull request.",
          sections: [],
          title: "Choose starting point"
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
        enabledWhen: [when.metadataExists("work_source")],
        enabledWhenReason: "Choose a work source before creating the worktree.",
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
  [projectValidatedStepId]: {
    actions: [
      {
        adapterCapability: "update_code_index",
        icon: "sync",
        id: "update_code_index",
        label: "Update code index",
        type: "command"
      },
      {
        adapterCapability: "run_automated_checks",
        enabledWhen: [when.metadataExists("code_index_updated")],
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
      label: "Validate project"
    },
    description: "Update the adapter-provided code index and run automated checks.",
    id: projectValidatedStepId,
    label: "Validate project",
    next: {
      disabledReason: "Update the code index and run automated checks successfully before continuing.",
      enabledWhen: [
        when.metadataExists("code_index_updated"),
        when.metadataExists("automated_checks_passed")
      ]
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
  [changesCommittedStepId]: {
    actions: [
      {
        adapterCapability: "commit_changes",
        icon: "commit",
        id: "commit_changes",
        label: "Commit and push changes",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "commit_changes",
      completeWhen: [
        when.metadataExists("accepted_commit"),
        when.metadataExists("branch_pushed")
      ],
      label: "Commit and push changes"
    },
    description: "Commit the accepted changes and push the session branch.",
    id: changesCommittedStepId,
    label: "Commit and push changes",
    next: {
      disabledReason: "Commit and push changes before continuing.",
      enabledWhen: [when.metadataExists("accepted_commit")]
    },
    rewindCleanup: {
      actionResults: ["commit_changes"],
      metadata: ["accepted_commit", "branch_pushed"]
    }
  },
  [createPullRequestStepId]: {
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
        disabledReason: "Pull request details are already ready for review.",
        disabledWhen: [when.allArtifactsReady(PULL_REQUEST_TITLE_DRAFT_ARTIFACT, PULL_REQUEST_BODY_DRAFT_ARTIFACT)],
        id: "resolve_pull_request",
        label: "Draft PR",
        promptId: "resolve_pull_request",
        type: "prompt"
      },
      {
        adapterCapability: "create_pr_on_gh",
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
        type: "command"
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
      label: "Create pull request"
    },
    description: "Submit the pull request body and create the GitHub pull request.",
    id: createPullRequestStepId,
    label: "Create pull request",
    next: {
      disabledReason: "Create the pull request before continuing.",
      enabledWhen: [when.metadataExists("pr_url")]
    },
    rewindCleanup: {
      actionResults: ["create_pr_on_gh"],
      artifacts: [
        PULL_REQUEST_BODY_DRAFT_ARTIFACT,
        PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
        "create_pull_request.url.txt",
        "create_pull_request.number.txt",
        "create_pull_request.source.txt"
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
        }
      ]
    }
  },
  [prMergedStepId]: {
    actions: [
      {
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
      kind: "merge_review",
      stop: true
    },
    description: "Prepare and merge the pull request.",
    id: prMergedStepId,
    label: "Merge PR",
    next: {
      disabledReason: "Merge the pull request or choose not to merge before continuing.",
      enabledWhen: [
        when.any(
          when.metadataExists("pr_merged"),
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
          skippedMetadataName: "merge_skipped"
        }
      },
      stop: {
        intents: [
          {
            enabledWhenAction: "prepare_for_merge",
            id: "merge_and_sync",
            label: "Merge and update main checkout",
            style: "primary"
          },
          {
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
      actionResults: ["prepare_for_merge", "merge_pr", "skip_merge"],
      metadata: ["pr_merged", "merge_skipped", "autopilot_merge_intent"]
    }
  },
  [mainCheckoutSyncedStepId]: {
    actions: [
      {
        adapterCapability: "sync_main_checkout",
        disabledReason: "Merge the pull request before syncing the main checkout.",
        enabledWhen: [
          when.metadataExists("pr_url"),
          when.metadataExists("pr_merged")
        ],
        icon: "sync",
        id: "sync_main_checkout",
        label: "Sync main checkout",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "sync_main_checkout",
      completeWhen: [when.metadataExists("main_checkout_synced")],
      label: "Sync main checkout"
    },
    description: "Sync the main checkout after a successful merge.",
    id: mainCheckoutSyncedStepId,
    label: "Sync main checkout",
    next: {
      disabledReason: "Sync the main checkout after merging before continuing.",
      enabledWhen: [
        when.any(
          when.metadataExists("main_checkout_synced"),
          when.metadataExists("merge_skipped")
        )
      ]
    },
    rewindCleanup: {
      actionResults: ["sync_main_checkout"],
      metadata: ["main_checkout_synced"]
    }
  },
  [sessionFinishedStepId]: {
    actions: [
      {
        adapterCapability: "finish_session",
        disabledReason: "Merge and sync the main checkout, or choose not to merge, before archiving.",
        enabledWhen: [
          when.metadataExists("pr_url"),
          when.any(
            when.metadataExists("main_checkout_synced"),
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
    if (!["use_new_branch", "use_existing_issue", "use_existing_pr"].includes(context.actionId)) {
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

const worktreeCreatedMachine = {
  stepId: worktreeCreatedStepId,

  initialState(context = {}) {
    if (metadataExists(context.session, "worktree_path")) {
      return machineState(STEP_STATUS.DONE);
    }
    if (!metadataExists(context.session, "work_source")) {
      return machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: "Choose a work source before creating the worktree."
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
            actions: disableAction(context.session, "create_worktree", "Resolve the worktree command failure before retrying."),
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

const projectValidatedMachine = {
  stepId: projectValidatedStepId,

  initialState(context = {}) {
    return allMetadataExists(context.session, ["code_index_updated", "automated_checks_passed"])
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (allMetadataExists(context.session, ["code_index_updated", "automated_checks_passed"])) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Update the code index and run automated checks successfully before continuing.",
      failurePrompt: "The project validation command failed. Explain what should happen, then retry validation.",
      failureTitle: "Validation needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["update_code_index", "run_automated_checks"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["update_code_index", "run_automated_checks"],
      done: allMetadataExists(await context.runtime.getSession(context.session.sessionId), [
        "code_index_updated",
        "automated_checks_passed"
      ]),
      failureTitle: "Validation needs attention"
    });
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

const pullRequestMergedMachine = {
  promptActionId: "prepare_for_merge",
  stepId: prMergedStepId,

  initialState(context = {}) {
    return metadataExists(context.session, "pr_merged") || metadataExists(context.session, "merge_skipped")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "pr_merged") || metadataExists(context.session, "merge_skipped")) {
      state = machineState(STEP_STATUS.DONE);
    }
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);

      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, {
          ...state,
          message: state.message || "The merge step needs input before it can continue."
        });

      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Merge the pull request or choose not to merge before continuing.");
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
          assertAgentResultSource(context.session, input);
        }
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: state.status === STEP_STATUS.ATTEMPTING_EXECUTION
              ? STEP_STATUS.ATTEMPTING_EXECUTION
              : STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            promptComplete: true,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("The merge step cannot accept input right now.", "vibe64_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId === "prepare_for_merge") {
      return markPromptActionStarted(context, this, "prepare_for_merge");
    }
    return markCommandActionStarted(context, this, ["merge_pr"]);
  },

  async actionFinished(context = {}) {
    if (context.actionId === "skip_merge") {
      await writeState(context, this, machineState(STEP_STATUS.DONE));
      return;
    }
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["merge_pr"],
      done: await actionCreatedMetadata(context, "pr_merged"),
      failureTitle: "Merge needs attention"
    });
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Merge preparation completed."
      : "";
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The pull request and main checkout are ready for the merge command.",
      waitingForInputMeaning: "The merge preparation found a blocker that needs user input."
    });
  }
};

const mainCheckoutSyncedMachine = {
  stepId: mainCheckoutSyncedStepId,

  initialState(context = {}) {
    return metadataExists(context.session, "main_checkout_synced") || metadataExists(context.session, "merge_skipped")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "main_checkout_synced") || metadataExists(context.session, "merge_skipped")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Sync the main checkout after merging before continuing.",
      failurePrompt: "The main checkout sync command failed. Explain what should happen, then retry it.",
      failureTitle: "Main checkout sync needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["sync_main_checkout"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["sync_main_checkout"],
      done: await actionCreatedMetadata(context, "main_checkout_synced"),
      failureTitle: "Main checkout sync needs attention"
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
  await Promise.all([
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
      artifactText(title)
    ),
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_BODY_DRAFT_ARTIFACT,
      artifactText(body)
    )
  ]);
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
    submitLabel: "Update PR",
    title: "Create pull request"
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
    definition: coreLifecycleStepDefinitionsById[projectValidatedStepId],
    id: projectValidatedStepId,
    machine: projectValidatedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[changesCommittedStepId],
    id: changesCommittedStepId,
    machine: changesCommittedMachine
  },
  {
    config: {
      command: {
        actionId: "create_pr_on_gh",
        doneMetadata: "pr_url",
        failureState: (context = {}) => machineState(STEP_STATUS.WAITING_FOR_INPUT, {
          from: STEP_STATUS.ATTEMPTING_EXECUTION,
          message: normalizeText(context.actionResult?.message),
          output: normalizeText(context.actionResult?.output)
        })
      },
      completionMessage: "Pull request draft submitted for review.",
      done: (session = {}) => metadataExists(session, "pr_url"),
      draftOrigin: "prompt",
      draftReady: pullRequestFilesAreReady,
      interaction: (_status, values = {}) => pullRequestInputInteraction(values),
      nextWhenConfirmed: {
        disabledReason: "Create the pull request before continuing."
      },
      nextWhenDrafting: {
        disabledReason: "Resolve the pull request content before continuing."
      },
      nextWhenWaitingForInput: {
        disabledReason: "Resolve the pull request input request before continuing."
      },
      nextWhenWorking: {
        disabledReason: "Create the pull request before continuing."
      },
      onWaitingActions: (context = {}) => disableAction(context.session, "create_pr_on_gh", "Resolve the pull request input request before retrying."),
      promptInstruction() {
        return currentStepHelperInstruction({
          doneFields: {
            body: "Markdown pull request body",
            title: "Pull request title"
          },
          doneMeaning: "The pull request title and body are ready for user confirmation.",
          waitingForInputMeaning: "You cannot draft the pull request without a user decision or missing repository context."
        });
      },
      readValues: readPullRequestFieldValues,
      saveValues: writePullRequestFieldValues,
      unsupportedDoneMessage: "The pull request step cannot accept input right now.",
      userResponseResumeStatus: (state = {}) => state.from === STEP_STATUS.ATTEMPTING_EXECUTION
        ? STEP_STATUS.CONFIRM_FILES
        : STEP_STATUS.AWAITING_AGENT_RESULT,
      waitingInteraction: (state = {}) => commandFailureInteraction({
        prompt: state.message || "Codex needs more information before the pull request can continue.",
        title: "Pull request needs input"
      })
    },
    definition: coreLifecycleStepDefinitionsById[createPullRequestStepId],
    factoryId: "editable_artifact_review",
    id: createPullRequestStepId
  },
  {
    definition: coreLifecycleStepDefinitionsById[prMergedStepId],
    id: prMergedStepId,
    machine: pullRequestMergedMachine
  },
  {
    definition: coreLifecycleStepDefinitionsById[mainCheckoutSyncedStepId],
    id: mainCheckoutSyncedStepId,
    machine: mainCheckoutSyncedMachine
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
    worktreeCreatedStepId,
    dependenciesInstalledStepId,
    projectValidatedStepId,
    changesCommittedStepId,
    createPullRequestStepId,
    prMergedStepId,
    mainCheckoutSyncedStepId,
    sessionFinishedStepId
  ]
});

export {
  _testing,
  coreLifecycleWorkflowIntentHandlers,
  coreLifecycleWorkflowModule
};
