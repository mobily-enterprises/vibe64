import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINISHED_STEP_ID,
  ISSUE_STEP_ID,
  MERGE_PR_STEP_ID,
  REVIEW_CHANGES_STEP_ID,
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";
import {
  AUTOPILOT_STEP_DONE_MARKER_END,
  AUTOPILOT_STEP_DONE_MARKER_START
} from "../../src/lib/aiStudioAutopilotStepMarkers.js";

const STEP_LABELS = Object.freeze({
  changes_accepted: "Review changes",
  changes_committed: "Commit and push changes",
  deep_ui_check_run: "Run deep UI check",
  dependencies_installed: "Install dependencies",
  issue_file_created: "Define or select issue",
  issue_submitted: "Edit and submit issue",
  main_checkout_synced: "Sync main checkout",
  plan_executed: "Execute plan",
  plan_made: "Make plan",
  pr_created: "Edit and create PR",
  pr_file_created: "Create PR file",
  pr_merged: "Merge PR",
  project_knowledge_updated: "Update project knowledge",
  project_validated: "Validate project",
  review_run: "Run review/deslop",
  session_finished: "Congratulations!",
  session_created: "Create session",
  work_source_selected: "Choose work source",
  worktree_created: "Create worktree"
});

const NEXT_STEP = Object.freeze({
  changes_accepted: "project_knowledge_updated",
  changes_committed: "pr_file_created",
  deep_ui_check_run: "review_run",
  dependencies_installed: ISSUE_STEP_ID,
  issue_submitted: "plan_made",
  main_checkout_synced: FINISHED_STEP_ID,
  plan_executed: "deep_ui_check_run",
  plan_made: "plan_executed",
  pr_created: MERGE_PR_STEP_ID,
  pr_file_created: "pr_created",
  pr_merged: "main_checkout_synced",
  project_knowledge_updated: "changes_committed",
  project_validated: REVIEW_CHANGES_STEP_ID,
  review_run: "project_validated",
  session_created: "work_source_selected",
  work_source_selected: "worktree_created",
  worktree_created: "dependencies_installed"
});

const COMMAND_METADATA = Object.freeze({
  commit_changes: {
    accepted_commit: "abc123",
    branch_pushed: "origin/ai-studio/test-session"
  },
  create_pr_on_gh: {
    pr_number: "123",
    pr_url: "https://github.com/example/project/pull/123"
  },
  create_issue_on_gh: {
    issue_url: "https://github.com/example/project/issues/123"
  },
  create_worktree: {
    worktree_path: "/tmp/ai-studio-worktree"
  },
  install_dependencies: {
    dependencies_installed: "1"
  },
  merge_pr: {
    pr_merged: "1"
  },
  run_automated_checks: {
    automated_checks_passed: "1"
  },
  sync_main_checkout: {
    main_checkout_synced: "1"
  },
  update_code_index: {
    code_index_updated: "1"
  }
});

const PROMPT_ACTION_IDS = new Set([
  "create_pr_file",
  "execute_plan",
  "make_plan",
  "prepare_for_merge",
  "run_deep_ui_check",
  "run_deslop",
  "update_project_knowledge"
]);
const FINISH_SESSION_ACTION_ID = "finish_session";

describe("useAiStudioAutopilotController", () => {
  let context;

  beforeEach(() => {
    context = createAutopilotContext();
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  it("runs setup actions and stops at the issue definition step", async () => {
    await context.controller.start();

    expect(context.session.value.currentStep).toBe(ISSUE_STEP_ID);
    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "use_new_branch"
    }));
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.controller.readyForIssue.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("stores command failure details and retries from the same workflow step", async () => {
    context.commandResults.create_worktree = {
      error: "Create worktree failed with exit code 1.",
      exitCode: 1,
      ok: false,
      output: "fatal: branch exists"
    };

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("worktree_created");
    expect(context.controller.failure.value).toMatchObject({
      actionId: "create_worktree",
      error: "Create worktree failed with exit code 1.",
      output: "fatal: branch exists"
    });
    expect(context.controller.commandResult.value).toMatchObject({
      actionId: "create_worktree",
      ok: false,
      output: "fatal: branch exists"
    });

    context.commandResults.create_worktree = {
      exitCode: 0,
      ok: true,
      output: "created"
    };

    await context.controller.retry();

    expect(context.session.value.currentStep).toBe(ISSUE_STEP_ID);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.controller.failure.value).toBeNull();
  });

  it("continues from submitted issue through prompts and validation, then stops at review changes", async () => {
    context.moveToStep("issue_submitted", {
      issue_body: "## Request\nMake the change.",
      issue_title: "Make the change"
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
    expect(context.controller.readyForDeepUiCheck.value).toBe(true);
    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "make_plan",
      "execute_plan"
    ]);

    await context.controller.runDeepUiCheck();

    expect(context.session.value.currentStep).toBe(REVIEW_CHANGES_STEP_ID);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_issue_on_gh",
      "update_code_index",
      "run_automated_checks"
    ]);
    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "make_plan",
      "execute_plan",
      "run_deep_ui_check",
      "run_deslop"
    ]);
    expect(context.actions.runAction.mock.calls.every(([, options]) => {
      return typeof options?.promptSuffix === "string" &&
        options.promptSuffix.includes(AUTOPILOT_STEP_DONE_MARKER_START);
    })).toBe(true);
    expect(context.controller.readyForReview.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("can skip the deep UI check and continue to review changes", async () => {
    context.moveToStep("deep_ui_check_run");

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
    expect(context.controller.readyForDeepUiCheck.value).toBe(true);

    await context.controller.skipDeepUiCheck();

    expect(context.session.value.currentStep).toBe(REVIEW_CHANGES_STEP_ID);
    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "run_deslop"
    ]);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "update_code_index",
      "run_automated_checks"
    ]);
    expect(context.controller.failure.value).toBeNull();
  });

  it("accepts review changes and stops at the merge decision", async () => {
    context.moveToStep(REVIEW_CHANGES_STEP_ID);

    await context.controller.acceptChanges();

    expect(context.session.value.currentStep).toBe(MERGE_PR_STEP_ID);
    expect(context.controller.readyForMerge.value).toBe(true);
    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "update_project_knowledge",
      "create_pr_file"
    ]);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "commit_changes",
      "create_pr_on_gh"
    ]);
    expect(context.controller.canResume.value).toBe(false);
    expect(context.controller.failure.value).toBeNull();
  });

  it("can finish without merging the pull request", async () => {
    context.moveToStep(MERGE_PR_STEP_ID, {
      pr_url: "https://github.com/example/project/pull/123"
    });

    await context.controller.skipMerge();

    expect(context.session.value.currentStep).toBe(FINISHED_STEP_ID);
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.controller.readyForFinished.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("archives a finished session through the workflow action", async () => {
    context.moveToStep(FINISHED_STEP_ID, {
      pr_url: "https://github.com/example/project/pull/123"
    });

    await context.controller.archiveSession();

    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: FINISH_SESSION_ACTION_ID,
      label: "Archive"
    }));
    expect(context.session.value.status).toBe("finished");
    expect(context.controller.failure.value).toBeNull();
  });

  it("merges the pull request and syncs the main checkout before finishing", async () => {
    context.moveToStep(MERGE_PR_STEP_ID, {
      pr_url: "https://github.com/example/project/pull/123"
    });

    await context.controller.mergeAndSyncMainCheckout();

    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "prepare_for_merge"
    ]);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "merge_pr",
      "sync_main_checkout"
    ]);
    expect(context.session.value.currentStep).toBe(FINISHED_STEP_ID);
    expect(context.controller.readyForFinished.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("keeps a failed merge on the merge decision until the user cancels it", async () => {
    context.moveToStep(MERGE_PR_STEP_ID, {
      pr_url: "https://github.com/example/project/pull/123"
    });
    context.commandResults.merge_pr = {
      error: "Merge failed with conflicts.",
      exitCode: 1,
      ok: false,
      output: "conflict"
    };

    await context.controller.mergeAndSyncMainCheckout();

    expect(context.session.value.currentStep).toBe(MERGE_PR_STEP_ID);
    expect(context.controller.readyForMerge.value).toBe(true);
    expect(context.controller.failure.value).toMatchObject({
      actionId: "merge_pr",
      error: "Merge failed with conflicts.",
      output: "conflict"
    });

    context.controller.cancelMergeFailure();

    expect(context.controller.failure.value).toBeNull();
    expect(context.session.value.currentStep).toBe(MERGE_PR_STEP_ID);
  });

  it("rewinds rejected review changes to planning with structured feedback", async () => {
    context.moveToStep(REVIEW_CHANGES_STEP_ID);

    await context.controller.rejectChanges("Keep the public booking page out of scope.");

    expect(context.actions.rewindToStep).toHaveBeenCalledWith(expect.objectContaining({
      rewindStepId: "plan_made"
    }));
    const makePlanCall = context.actions.runAction.mock.calls.find(([action]) => action.id === "make_plan");
    expect(makePlanCall?.[1]?.input).toEqual({
      autopilotFeedback: "Keep the public booking page out of scope.",
      autopilotReason: "changes_rejected"
    });
    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
    expect(context.controller.readyForDeepUiCheck.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("fails cleanly when Codex becomes idle without the completion marker", async () => {
    context.moveToStep("review_run");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "run_deslop") {
        context.codexOutput.value = `${context.codexOutput.value}\nReview completed without marker.`;
      }
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("review_run");
    expect(context.controller.running.value).toBe(false);
    expect(context.controller.failure.value).toMatchObject({
      actionId: "run_deslop",
      error: "The Run deslop step did not complete properly, so Autopilot could not safely continue. Retry will run it again, or switch to Inspect to continue manually.",
      output: expect.stringContaining("Review completed without marker.")
    });
  });

  it("explains when Codex emits a marker for the same step but a different request", async () => {
    context.moveToStep("review_run");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "run_deslop") {
        context.codexOutput.value = `${context.codexOutput.value}\n${stepMarker({
          actionId: "run_deslop",
          requestId: "different-request",
          stepId: "review_run"
        })}`;
      }
    });

    await context.controller.resume();

    expect(context.controller.failure.value).toMatchObject({
      actionId: "run_deslop",
      error: "The Run deslop step did not complete properly, so Autopilot could not safely continue. Codex printed a completion marker for this same step, but it belonged to a different Autopilot request. Retry will run it again, or switch to Inspect to continue manually.",
      source: "codex"
    });
  });

  it("lets the user stop Autopilot while a Codex prompt is pending", async () => {
    context.moveToStep("review_run");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "run_deslop") {
        context.codexBusy.value = true;
        context.codexOutput.value = `${context.codexOutput.value}\nReview still running.`;
      }
    });

    const resumePromise = context.controller.resume();
    await Promise.resolve();

    context.controller.stop();
    await resumePromise;

    expect(context.session.value.currentStep).toBe("review_run");
    expect(context.controller.running.value).toBe(false);
    expect(context.controller.failure.value).toMatchObject({
      actionLabel: "Autopilot",
      error: "Autopilot stopped. Use Inspect to continue manually, or Retry to resume Autopilot."
    });
  });

  it("waits for Codex to become idle before sending the next prompt", async () => {
    context.moveToStep("plan_made");

    let firstPrompt = true;
    context.actions.runAction.mockImplementation(async (action, options = {}) => {
      if (!PROMPT_ACTION_IDS.has(action.id)) {
        return;
      }
      context.codexOutput.value = `${context.codexOutput.value}\n${stepDoneMarkerFromPromptSuffix(options.promptSuffix)}`;
      if (firstPrompt) {
        firstPrompt = false;
        context.codexBusy.value = true;
        setTimeout(() => {
          context.codexBusy.value = false;
        }, 10);
      }
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
    await context.controller.runDeepUiCheck();

    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "make_plan",
      "execute_plan",
      "run_deep_ui_check",
      "run_deslop"
    ]);
    expect(context.session.value.currentStep).toBe(REVIEW_CHANGES_STEP_ID);
  });
});

function createAutopilotContext() {
  const session = ref(sessionForStep("session_created"));
  const codexBusy = ref(false);
  const codexOutput = ref("");
  const promptInjectionError = ref("");
  const commandResults = {
    create_issue_on_gh: {
      exitCode: 0,
      ok: true,
      output: "created issue"
    },
    commit_changes: {
      exitCode: 0,
      ok: true,
      output: "committed"
    },
    create_pr_on_gh: {
      exitCode: 0,
      ok: true,
      output: "created pr"
    },
    create_worktree: {
      exitCode: 0,
      ok: true,
      output: "created"
    },
    install_dependencies: {
      exitCode: 0,
      ok: true,
      output: "installed"
    },
    merge_pr: {
      exitCode: 0,
      ok: true,
      output: "merged"
    },
    run_automated_checks: {
      exitCode: 0,
      ok: true,
      output: "checked"
    },
    sync_main_checkout: {
      exitCode: 0,
      ok: true,
      output: "synced"
    },
    update_code_index: {
      exitCode: 0,
      ok: true,
      output: "indexed"
    }
  };

  function moveToStep(stepId, metadata = {}) {
    session.value = sessionForStep(stepId, {
      ...session.value.metadata,
      ...metadata
    });
  }

  const actions = {
    currentActions: computed(() => session.value.actions),
    currentNext: computed(() => session.value.next),
    goNext: vi.fn(async () => {
      moveToStep(session.value.next.stepId);
    }),
    rewindToStep: vi.fn(async (step = {}) => {
      moveToStep(step.rewindStepId || step.id);
    }),
    runAction: vi.fn(async (action, options = {}) => {
      if (action.id === "use_new_branch") {
        moveToStep(session.value.currentStep, {
          work_source: "new_branch"
        });
        return;
      }

      if (PROMPT_ACTION_IDS.has(action.id)) {
        codexOutput.value = `${codexOutput.value}\n${stepDoneMarkerFromPromptSuffix(options.promptSuffix)}`;
        if (action.id === "create_pr_file") {
          moveToStep(session.value.currentStep, {
            pull_request_ready: "1"
          });
        }
        return;
      }

      if (action.id === FINISH_SESSION_ACTION_ID) {
        session.value = {
          ...session.value,
          status: "finished"
        };
      }
    })
  };
  const commandRunner = {
    running: ref(false),
    runCommandAction: vi.fn(async ({ action }) => {
      const result = commandResults[action.id];
      if (result?.ok === true) {
        moveToStep(session.value.currentStep, COMMAND_METADATA[action.id] || {});
      }
      return {
        actionId: action.id,
        actionLabel: action.label,
        error: result?.error || "",
        exitCode: result?.exitCode ?? null,
        ok: result?.ok === true,
        output: result?.output || ""
      };
    })
  };
  const controller = useAiStudioAutopilotController({
    actions,
    codexTerminal: {
      busy: codexBusy,
      output: codexOutput,
      promptInjectionError
    },
    commandRunner,
    refreshSessionData: async () => null,
    session
  });

  return {
    actions,
    codexBusy,
    codexOutput,
    commandResults,
    commandRunner,
    controller,
    moveToStep,
    session
  };
}

function sessionForStep(stepId, metadata = {}) {
  return {
    actions: actionsForStep(stepId, metadata),
    artifactReadiness: artifactReadinessForMetadata(metadata),
    currentStep: stepId,
    currentStepDefinition: {
      label: STEP_LABELS[stepId]
    },
    metadata,
    next: nextForStep(stepId, metadata),
    sessionId: "session-1",
    stepDefinitions: Object.entries(STEP_LABELS).map(([id, label]) => ({
      id,
      label
    }))
  };
}

function actionsForStep(stepId, metadata = {}) {
  if (stepId === "work_source_selected") {
    return [
      {
        enabled: true,
        id: "use_new_branch",
        label: "Use new branch",
        type: "adapter"
      }
    ];
  }
  if (stepId === "worktree_created") {
    return [
      commandAction("create_worktree", "Create worktree")
    ];
  }
  if (stepId === "dependencies_installed") {
    return [
      commandAction("install_dependencies", "Install dependencies")
    ];
  }
  if (stepId === "issue_submitted") {
    return [
      commandAction("create_issue_on_gh", "Create issue on GH")
    ];
  }
  if (stepId === "plan_made") {
    return [
      promptAction("make_plan", "Make plan")
    ];
  }
  if (stepId === "plan_executed") {
    return [
      promptAction("execute_plan", "Execute plan")
    ];
  }
  if (stepId === "deep_ui_check_run") {
    return [
      promptAction("run_deep_ui_check", "Run deep UI check")
    ];
  }
  if (stepId === "review_run") {
    return [
      promptAction("run_deslop", "Run deslop")
    ];
  }
  if (stepId === "project_validated") {
    return [
      commandAction("update_code_index", "Update code index"),
      commandAction("run_automated_checks", "Run automated checks", Boolean(metadata.code_index_updated))
    ];
  }
  if (stepId === "project_knowledge_updated") {
    return [
      promptAction("update_project_knowledge", "Update project knowledge")
    ];
  }
  if (stepId === "changes_committed") {
    return [
      commandAction("commit_changes", "Commit and push changes")
    ];
  }
  if (stepId === "pr_file_created") {
    return [
      promptAction("create_pr_file", "Create PR file")
    ];
  }
  if (stepId === "pr_created") {
    return [
      commandAction("create_pr_on_gh", "Create PR on GH")
    ];
  }
  if (stepId === "pr_merged") {
    return [
      promptAction("prepare_for_merge", "Prepare for merge"),
      commandAction("merge_pr", "Merge")
    ];
  }
  if (stepId === "main_checkout_synced") {
    return [
      commandAction("sync_main_checkout", "Sync main checkout", Boolean(metadata.pr_merged))
    ];
  }
  if (stepId === FINISHED_STEP_ID) {
    return [
      {
        enabled: Boolean(metadata.pr_url),
        id: FINISH_SESSION_ACTION_ID,
        label: "Archive",
        type: "finish"
      }
    ];
  }
  return [];
}

function commandAction(id, label, enabled = true) {
  return {
    enabled,
    id,
    label,
    type: "command"
  };
}

function promptAction(id, label) {
  return {
    enabled: true,
    id,
    label,
    type: "prompt"
  };
}

function nextForStep(stepId, metadata = {}) {
  if (stepId === ISSUE_STEP_ID) {
    return {
      enabled: false,
      visible: false
    };
  }
  return {
    enabled: nextStepReady(stepId, metadata),
    label: "Next",
    stepId: NEXT_STEP[stepId] || "",
    visible: true
  };
}

function nextStepReady(stepId, metadata = {}) {
  if (stepId === "session_created") {
    return true;
  }
  if (stepId === "work_source_selected") {
    return Boolean(metadata.work_source);
  }
  if (stepId === "worktree_created") {
    return Boolean(metadata.worktree_path);
  }
  if (stepId === "dependencies_installed") {
    return Boolean(metadata.dependencies_installed);
  }
  if (stepId === "issue_submitted") {
    return Boolean(metadata.issue_url);
  }
  if (stepId === "project_validated") {
    return Boolean(metadata.code_index_updated && metadata.automated_checks_passed);
  }
  if (stepId === "changes_committed") {
    return Boolean(metadata.accepted_commit);
  }
  if (stepId === "pr_file_created") {
    return Boolean(metadata.pr_url || metadata.pull_request_ready);
  }
  if (stepId === "pr_created") {
    return Boolean(metadata.pr_url);
  }
  if (stepId === "main_checkout_synced") {
    return true;
  }
  return Boolean(NEXT_STEP[stepId]);
}

function artifactReadinessForMetadata(metadata = {}) {
  if (!metadata.pull_request_ready) {
    return {};
  }
  return {
    "pull_request.md": {
      nonEmpty: true
    }
  };
}

function stepDoneMarkerFromPromptSuffix(promptSuffix = "") {
  const source = String(promptSuffix || "");
  const start = source.indexOf(AUTOPILOT_STEP_DONE_MARKER_START);
  const end = source.indexOf(AUTOPILOT_STEP_DONE_MARKER_END, start);
  if (start < 0 || end < 0) {
    throw new Error("Autopilot prompt suffix did not contain a completion marker.");
  }
  return source.slice(start, end + AUTOPILOT_STEP_DONE_MARKER_END.length);
}

function stepMarker(payload = {}) {
  return [
    AUTOPILOT_STEP_DONE_MARKER_START,
    JSON.stringify(payload),
    AUTOPILOT_STEP_DONE_MARKER_END
  ].join("\n");
}
