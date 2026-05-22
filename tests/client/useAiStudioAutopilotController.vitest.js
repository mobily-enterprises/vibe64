import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINISHED_STEP_ID,
  IMPLEMENTATION_REVIEW_STEP_ID,
  ISSUE_STEP_ID,
  MERGE_PR_STEP_ID,
  REVIEW_CHANGES_STEP_ID,
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";
import {
  useAiStudioCodexQuestionExchange
} from "../../src/composables/useAiStudioCodexQuestionExchange.js";
import {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX
} from "../../src/lib/aiStudioAutopilotPromptFiles.js";

const STEP_LABELS = Object.freeze({
  agent_conversation: "Make changes",
  changes_accepted: "Final review",
  changes_committed: "Commit and push changes",
  deep_ui_check_run: "Run deep UI check",
  dependencies_installed: "Install dependencies",
  issue_file_created: "Define or select issue",
  issue_submitted: "Edit and submit issue",
  implementation_reviewed: "Human review",
  main_checkout_synced: "Sync main checkout",
  plan_executed: "Execute plan",
  plan_made: "Make plan",
  pr_created: "Edit and create PR",
  pr_file_created: "Create PR file",
  pr_merged: "Merge PR",
  project_knowledge_updated: "Update project knowledge",
  project_validated: "Validate project",
  report_created: "Write report",
  review_run: "Run review/deslop",
  session_finished: "Congratulations!",
  session_created: "Create session",
  work_source_selected: "Choose work source",
  worktree_created: "Create worktree"
});

const NEXT_STEP = Object.freeze({
  agent_conversation: "deep_ui_check_run",
  changes_accepted: "report_created",
  changes_committed: "pr_file_created",
  deep_ui_check_run: "review_run",
  dependencies_installed: ISSUE_STEP_ID,
  issue_submitted: "plan_made",
  main_checkout_synced: FINISHED_STEP_ID,
  implementation_reviewed: "deep_ui_check_run",
  plan_executed: IMPLEMENTATION_REVIEW_STEP_ID,
  plan_made: "plan_executed",
  pr_created: MERGE_PR_STEP_ID,
  pr_file_created: "pr_created",
  pr_merged: "main_checkout_synced",
  project_knowledge_updated: "changes_committed",
  project_validated: REVIEW_CHANGES_STEP_ID,
  report_created: "project_knowledge_updated",
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
  "agent_conversation",
  "create_pr_file",
  "apply_review_feedback",
  "execute_plan",
  "make_plan",
  "prepare_for_merge",
  "run_deep_ui_check",
  "run_deslop",
  "update_project_knowledge",
  "write_report"
]);
const FINISH_SESSION_ACTION_ID = "finish_session";
const STEP_AUTOPILOT = Object.freeze({
  agent_conversation: {
    actionId: "agent_conversation",
    kind: "agent_conversation",
    stop: true
  },
  changes_accepted: {
    kind: "final_review",
    stop: true
  },
  changes_committed: {
    actionId: "commit_changes",
    completeWhen: ["metadata:accepted_commit", "metadata:branch_pushed"],
    label: "Commit and push changes"
  },
  deep_ui_check_run: {
    actionId: "run_deep_ui_check",
    label: "Run deep UI check",
    userDecision: true
  },
  dependencies_installed: {
    actionId: "install_dependencies",
    completeWhen: ["metadata:dependencies_installed"],
    label: "Install dependencies"
  },
  issue_file_created: {
    kind: "issue_discussion",
    stop: true
  },
  issue_submitted: {
    actionId: "create_issue_on_gh",
    completeWhen: ["metadata:issue_url"],
    label: "Edit and submit issue"
  },
  implementation_reviewed: {
    kind: "implementation_review",
    stop: true
  },
  main_checkout_synced: {
    actionId: "sync_main_checkout",
    completeWhen: ["metadata:main_checkout_synced"],
    label: "Sync main checkout"
  },
  plan_executed: {
    actionId: "execute_plan",
    label: "Execute plan"
  },
  plan_made: {
    actionId: "make_plan",
    label: "Make plan"
  },
  pr_created: {
    actionId: "create_pr_on_gh",
    completeWhen: ["metadata:pr_url"],
    label: "Create PR on GH"
  },
  pr_file_created: {
    actionId: "create_pr_file",
    completeWhen: ["any:metadata:pr_url;artifact:pull_request.md"],
    label: "Create PR file"
  },
  pr_merged: {
    kind: "merge_review",
    stop: true
  },
  project_knowledge_updated: {
    actionId: "update_project_knowledge",
    label: "Update project knowledge"
  },
  project_validated: {
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
  report_created: {
    actionId: "write_report",
    completeWhen: ["artifact:report.md"],
    label: "Write report"
  },
  review_run: {
    actionId: "run_deslop",
    label: "Run deslop"
  },
  session_finished: {
    kind: "finished",
    stop: true
  },
  work_source_selected: {
    actionId: "use_new_branch",
    advanceOnSuccess: true,
    completeWhen: ["metadata:work_source"],
    label: "Choose work source"
  },
  worktree_created: {
    actionId: "create_worktree",
    completeWhen: ["metadata:worktree_path"],
    label: "Create worktree"
  }
});

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
      advanceOnSuccess: true,
      id: "use_new_branch"
    }));
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.controller.readyForIssue.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("does not auto-resume from the first work source choice", () => {
    context.moveToStep("work_source_selected");

    expect(context.controller.canStart.value).toBe(true);
    expect(context.controller.canResume.value).toBe(false);
  });

  it("continues a started work source step without selecting the source again", async () => {
    context.moveToStep("work_source_selected", {
      work_source: "new_branch"
    });

    expect(context.controller.canStart.value).toBe(true);

    await context.controller.start();

    expect(context.actions.runAction).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "use_new_branch"
    }));
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.session.value.currentStep).toBe(ISSUE_STEP_ID);
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

  it("continues from submitted issue through prompts, then stops at human review", async () => {
    context.moveToStep("issue_submitted", {
      issue_body: "## Request\nMake the change.",
      issue_title: "Make the change"
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe(IMPLEMENTATION_REVIEW_STEP_ID);
    expect(context.controller.readyForImplementationReview.value).toBe(true);
    expect(context.controller.readyForReview.value).toBe(true);
    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "make_plan",
      "execute_plan"
    ]);

    await context.controller.acceptChanges();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
    expect(context.controller.readyForDeepUiCheck.value).toBe(true);

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
      return !Object.hasOwn(options || {}, "promptSuffix") &&
        !Object.hasOwn(options || {}, "completionToken");
    })).toBe(true);
    expect(context.controller.readyForReview.value).toBe(true);
    expect(context.controller.readyForFinalReview.value).toBe(true);
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
      "write_report",
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

  it("runs first-review tweak feedback without leaving human review", async () => {
    context.moveToStep(IMPLEMENTATION_REVIEW_STEP_ID);

    await context.controller.requestReviewTweak("Move the button copy closer to booking language.");

    const tweakCall = context.actions.runAction.mock.calls.find(([action]) => action.id === "apply_review_feedback");
    expect(tweakCall?.[1]?.input).toEqual({
      reviewFeedback: "Move the button copy closer to booking language."
    });
    expect(context.session.value.currentStep).toBe(IMPLEMENTATION_REVIEW_STEP_ID);
    expect(context.session.value.artifactReadiness["human_input_response.md"].nonEmpty).toBe(true);
    expect(context.controller.readyForImplementationReview.value).toBe(true);
    expect(context.controller.promptRunReadyToAdvance.value).toBe(false);
    expect(context.controller.failure.value).toBeNull();
  });

  it("uses a reusable agent conversation step with a workflow-specific visible label", async () => {
    context.moveToStep("agent_conversation");

    expect(context.controller.screenState.value).toMatchObject({
      kind: "agent_conversation",
      title: "Make changes"
    });
    expect(context.controller.agentConversationShowsResponseArtifact.value).toBe(false);

    await context.controller.submitAgentRequest("Tighten the settings form spacing.");

    const conversationCall = context.actions.runAction.mock.calls.find(([action]) => action.id === "agent_conversation");
    expect(conversationCall?.[1]?.input).toEqual({
      agentRequest: "Tighten the settings form spacing."
    });
    expect(context.session.value.currentStep).toBe("agent_conversation");
    expect(context.controller.canFinishAgentConversation.value).toBe(true);
    expect(context.controller.agentConversationContinueLabel.value).toBe("Continue to Run deep UI check");

    await context.controller.finishAgentConversation();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
    expect(context.controller.readyForDeepUiCheck.value).toBe(true);
  });

  it("can finish without merging the pull request", async () => {
    context.moveToStep(MERGE_PR_STEP_ID, {
      pr_url: "https://github.com/example/project/pull/123"
    });

    await context.controller.skipMerge();

    expect(context.session.value.currentStep).toBe(FINISHED_STEP_ID);
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "skip_merge",
      label: "Do not merge"
    }));
    expect(context.controller.readyForFinished.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("archives a finished session through the workflow action", async () => {
    context.moveToStep(FINISHED_STEP_ID, {
      main_checkout_synced: "yes",
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
    expect(context.session.value.currentStep).toBe(IMPLEMENTATION_REVIEW_STEP_ID);
    expect(context.controller.readyForImplementationReview.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("offers Continue when Codex becomes idle without the done file", async () => {
    context.moveToStep("review_run");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "run_deslop") {
        context.agePromptRun(context.createPromptRun(action));
        context.codexOutput.value = `${context.codexOutput.value}\nReview completed without marker.`;
      }
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("review_run");
    expect(context.controller.running.value).toBe(false);
    expect(context.controller.promptRunNeedsContinuation.value).toBe(true);
    expect(context.controller.screenState.value).toMatchObject({
      kind: "prompt_waiting",
      title: "Codex is waiting to continue"
    });
    expect(context.controller.failure.value).toBeNull();
  });

  it("keeps Continue available when a stale failure exists for an unfinished prompt run", async () => {
    context.moveToStep("review_run");
    const promptRun = context.agePromptRun(context.createPromptRun({
      id: "run_deslop",
      label: "Run deslop"
    }));

    context.controller.stop();

    expect(context.session.value.promptRun).toMatchObject({
      requestId: promptRun.requestId
    });
    expect(context.controller.failure.value).toMatchObject({
      actionLabel: "Autopilot"
    });
    expect(context.controller.promptRunNeedsContinuation.value).toBe(true);
    expect(context.controller.statusText.value).toBe("Codex is waiting to continue");
    expect(context.controller.screenState.value.kind).toBe("prompt_waiting");
  });

  it("pauses for Autopilot questions from any Codex prompt action", async () => {
    context.moveToStep("plan_executed");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "execute_plan") {
        const promptRun = context.createPromptRun(action);
        context.askPromptQuestions(promptRun, ["Which database should Codex use?"]);
      }
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("plan_executed");
    expect(context.questionExchange.hasQuestions.value).toBe(true);
    expect(context.controller.waitingForCodex.value).toBe(false);
    expect(context.questionExchange.questions.value.map((question) => question.text)).toEqual([
      "Which database should Codex use?"
    ]);
    expect(context.autopilotArtifacts.value.questions).toMatchObject({
      requestId: context.session.value.promptRun.requestId
    });
    expect(context.controller.failure.value).toBeNull();
  });

  it("sends Autopilot question answers back to Codex and continues the same action", async () => {
    context.moveToStep("plan_executed");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "execute_plan") {
        const promptRun = context.createPromptRun(action);
        context.askPromptQuestions(promptRun, ["Which database should Codex use?"]);
      }
    });

    await context.controller.resume();
    context.questionExchange.setAnswer("q1", "Use the managed MariaDB runtime.");

    expect(context.questionExchange.canSubmit.value).toBe(true);
    context.refreshSessionData.mockClear();

    await context.questionExchange.submitAnswers();

    expect(context.codexTerminal.injectPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Use the managed MariaDB runtime."),
      expect.objectContaining({
        sessionId: "session-1"
      })
    );
    expect(context.refreshSessionData).toHaveBeenCalled();
    expect(context.session.value.currentStep).toBe(IMPLEMENTATION_REVIEW_STEP_ID);
    expect(context.controller.readyForImplementationReview.value).toBe(true);
    expect(context.questionExchange.hasQuestions.value).toBe(false);
    expect(context.controller.failure.value).toBeNull();
  });

  it("resumes questions from questions.json without scanning terminal output", async () => {
    const promptRun = {
      actionId: "execute_plan",
      actionLabel: "Execute plan",
      completionToken: `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`,
      createdAt: new Date().toISOString(),
      outputCursor: 100,
      outputStart: 0,
      promptId: "execute_plan",
      requestId: "stored-request",
      sessionId: "session-1",
      status: "injected",
      stepId: "plan_executed"
    };
    context.moveToStep("plan_executed", {}, promptRun);
    context.askPromptQuestions(promptRun, ["Which database should Codex use?"]);

    await context.controller.resume();

    expect(context.questionExchange.questions.value.map((question) => question.text)).toEqual([
      "Which database should Codex use?"
    ]);
  });

  it("does not resurface old workflow questions after the user answers them", async () => {
    context.moveToStep("plan_executed");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "execute_plan") {
        const promptRun = context.createPromptRun(action);
        context.askPromptQuestions(promptRun, ["Which database should Codex use?"]);
      }
    });

    await context.controller.resume();
    context.questionExchange.setAnswer("q1", "Use the managed MariaDB runtime.");
    context.agePromptRun();
    context.codexTerminal.injectPrompt.mockImplementationOnce(async () => {
      context.codexOutput.value = `${context.codexOutput.value}\nAnswers received; continuing.`;
      return true;
    });

    await context.questionExchange.submitAnswers();

    expect(context.questionExchange.hasQuestions.value).toBe(false);
    expect(context.session.value.currentStep).toBe("plan_executed");
    expect(context.controller.promptRunNeedsContinuation.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("lets the user stop Autopilot while a Codex prompt is pending", async () => {
    context.moveToStep("review_run");
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id === "run_deslop") {
        context.createPromptRun(action);
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
    expect(context.controller.waitingForCodex.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("clears stale workflow questions when Codex becomes active again", async () => {
    const completionToken = `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`;
    context.moveToStep("plan_executed", {}, {
      actionId: "execute_plan",
      actionLabel: "Execute plan",
      completionToken,
      createdAt: new Date().toISOString(),
      outputStart: 0,
      promptId: "execute_plan",
      requestId: "stored-request",
      sessionId: "session-1",
      status: "injected",
      stepId: "plan_executed"
    });

    context.controller.stop();

    expect(context.controller.failure.value).toMatchObject({
      actionLabel: "Autopilot"
    });

    context.askPromptQuestions(context.session.value.promptRun, ["Which auth setup should Codex use?"]);
    context.codexBusy.value = true;

    await vi.waitFor(() => {
      expect(context.autopilotArtifacts.value.questions).toBeNull();
    });
    expect(context.questionExchange.hasQuestions.value).toBe(false);
    expect(context.controller.failure.value).toBeNull();
  });

  it("ignores Codex question markers that do not belong to the active prompt run", async () => {
    const completionToken = `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`;
    context.moveToStep("plan_executed", {}, {
      actionId: "execute_plan",
      actionLabel: "Execute plan",
      completionToken,
      createdAt: new Date().toISOString(),
      outputStart: 0,
      promptId: "execute_plan",
      requestId: "stored-request",
      sessionId: "session-1",
      status: "injected",
      stepId: "plan_executed"
    });

    context.controller.stop();
    context.autopilotArtifacts.value = {
      ...emptyAutopilotArtifacts(),
      questions: {
        questions: [
          {
            id: "q1",
            text: "Which auth setup should Codex use?"
          }
        ],
        requestId: "old-request"
      }
    };
    context.codexBusy.value = true;
    await Promise.resolve();

    expect(context.questionExchange.hasQuestions.value).toBe(false);
  });

  it("treats an active Codex terminal as current step work even without a pending prompt", async () => {
    context.moveToStep("plan_executed");
    context.controller.stop();

    expect(context.controller.failure.value).toMatchObject({
      actionLabel: "Autopilot"
    });

    context.codexBusy.value = true;

    await vi.waitFor(() => {
      expect(context.controller.waitingForCodex.value).toBe(true);
    });
    expect(context.controller.statusText.value).toBe("Executing: Execute plan");
    expect(context.controller.canResume.value).toBe(false);
    expect(context.controller.screenState.value).toMatchObject({
      kind: "codex_running",
      showProgress: true
    });
    expect(context.controller.failure.value).toBeNull();
  });

  it("blocks issue prompt entry while an Inspect Codex prompt is still running", async () => {
    context.moveToStep(ISSUE_STEP_ID);
    context.codexBusy.value = true;

    await vi.waitFor(() => {
      expect(context.controller.waitingForCodex.value).toBe(true);
    });
    expect(context.controller.readyForIssue.value).toBe(true);
    expect(context.controller.screenState.value).toMatchObject({
      kind: "codex_running",
      showProgress: true,
      title: "Codex is working..."
    });
  });

  it("leaves active Codex questions alone when no prompt run exists", async () => {
    context.moveToStep("plan_executed");
    context.controller.stop();

    context.autopilotArtifacts.value = {
      ...emptyAutopilotArtifacts(),
      questions: {
        questions: [
          {
            id: "q1",
            text: "Which auth setup should Codex use?"
          }
        ],
        requestId: "manual-request"
      }
    };
    context.codexBusy.value = true;

    await Promise.resolve();
    expect(context.questionExchange.hasQuestions.value).toBe(false);
    expect(context.controller.failure.value).toBeNull();
  });

  it("clears a pending Codex wait when the workflow has already moved on", async () => {
    context.moveToStep("plan_executed");

    let finishPromptAction = null;
    context.actions.runAction.mockImplementation(async (action) => {
      if (action.id !== "execute_plan") {
        return;
      }
      context.createPromptRun(action);
      context.codexBusy.value = true;
      context.codexOutput.value = `${context.codexOutput.value}\nCodex is still reporting.`;
      await new Promise((resolve) => {
        finishPromptAction = resolve;
      });
    });

    const resumePromise = context.controller.resume();
    await vi.waitFor(() => {
      expect(context.controller.waitingForCodex.value).toBe(true);
    });

    context.moveToStep(REVIEW_CHANGES_STEP_ID);
    context.codexBusy.value = false;
    finishPromptAction();
    await resumePromise;

    expect(context.controller.waitingForCodex.value).toBe(false);
    expect(context.controller.running.value).toBe(false);
    expect(context.controller.readyForReview.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("resumes a pending Codex prompt from the session prompt-run record", async () => {
    const completionToken = `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`;
    context.moveToStep("review_run", {}, {
      actionId: "run_deslop",
      actionLabel: "Run deslop",
      completionToken,
      createdAt: new Date().toISOString(),
      outputStart: 0,
      promptId: "run_deslop",
      requestId: "request-123",
      sessionId: "session-1",
      status: "injected",
      stepId: "review_run"
    });
    context.autopilotArtifacts.value = {
      ...emptyAutopilotArtifacts(),
      promptDone: {
        actionId: "run_deslop",
        completionToken,
        requestId: "request-123",
        stepId: "review_run"
      }
    };

    expect(context.controller.promptRunReadyToAdvance.value).toBe(true);
    expect(context.controller.statusText.value).toBe("Ready to continue");
    expect(context.controller.promptRunAdvanceMessage.value).toBe(
      "Codex finished Run deslop. Continue to move to Validate project."
    );
    expect(context.controller.resumeButtonText.value).toBe("Continue to Validate project");
    expect(context.controller.screenState.value).toMatchObject({
      buttonLabel: "Continue to Validate project",
      kind: "prompt_done",
      message: "Codex finished Run deslop. Continue to move to Validate project.",
      title: "Ready to continue"
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe(REVIEW_CHANGES_STEP_ID);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "update_code_index",
      "run_automated_checks"
    ]);
    expect(context.controller.failure.value).toBeNull();
  });

  it("does not offer prompt advancement while Codex background work is still running", () => {
    const completionToken = `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`;
    context.moveToStep("plan_executed", {}, {
      actionId: "execute_plan",
      actionLabel: "Execute plan",
      completionToken,
      createdAt: new Date().toISOString(),
      outputStart: 0,
      promptId: "execute_plan",
      requestId: "request-123",
      sessionId: "session-1",
      status: "injected",
      stepId: "plan_executed"
    });
    context.autopilotArtifacts.value = {
      ...emptyAutopilotArtifacts(),
      promptDone: {
        actionId: "execute_plan",
        completionToken,
        requestId: "request-123",
        stepId: "plan_executed"
      }
    };
    context.codexWorking.value = true;

    expect(context.controller.promptRunReadyToAdvance.value).toBe(false);
    expect(context.controller.waitingForCodex.value).toBe(true);
    expect(context.controller.screenState.value).toMatchObject({
      kind: "codex_running",
      title: "Executing: Execute plan"
    });
  });

  it("does not send the next prompt while Codex is still active", async () => {
    context.moveToStep("plan_made");

    let firstPrompt = true;
    context.actions.runAction.mockImplementation(async (action) => {
      if (!PROMPT_ACTION_IDS.has(action.id)) {
        return;
      }
      const promptRun = context.createPromptRun(action);
      context.completePromptRun(promptRun);
      if (firstPrompt) {
        firstPrompt = false;
        context.codexBusy.value = true;
        setTimeout(() => {
          context.codexBusy.value = false;
        }, 10);
      }
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("plan_executed");
    expect(context.actions.runAction.mock.calls.map(([action]) => action.id)).toEqual([
      "make_plan"
    ]);
    expect(context.controller.failure.value).toBeNull();
  });

  it("does not run setup automation while Autopilot is disabled", async () => {
    const enabled = ref(false);
    context = createAutopilotContext({
      enabled
    });
    context.moveToStep("worktree_created", {
      work_source: "new_branch"
    });

    expect(context.controller.canResume.value).toBe(false);

    await context.controller.resume();

    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.session.value.currentStep).toBe("worktree_created");

    enabled.value = true;

    expect(context.controller.canResume.value).toBe(true);

    await context.controller.resume();

    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.session.value.currentStep).toBe(ISSUE_STEP_ID);
  });

  it("does not capture Autopilot questions while disabled, then syncs when enabled", async () => {
    const enabled = ref(false);
    context = createAutopilotContext({
      enabled
    });
    context.moveToStep("plan_executed");
    const promptRun = context.createPromptRun({
      id: "execute_plan",
      label: "Execute plan"
    });
    context.askPromptQuestions(promptRun, ["Which database should Codex use?"]);
    context.codexBusy.value = true;

    await Promise.resolve();

    expect(context.questionExchange.hasQuestions.value).toBe(false);

    enabled.value = true;
    await context.controller.syncFromAutopilotArtifacts();

    expect(context.questionExchange.questions.value.map((question) => question.text)).toEqual([
      "Which database should Codex use?"
    ]);
  });
});

function createAutopilotContext({
  enabled = true
} = {}) {
  const session = ref(sessionForStep("session_created"));
  const autopilotArtifacts = ref(emptyAutopilotArtifacts());
  const codexBusy = ref(false);
  const codexOutput = ref("");
  const codexWorking = ref(false);
  let promptRunIndex = 0;
  const codexTerminal = {
    busy: codexBusy,
    injectPrompt: vi.fn(async () => {
      const promptRun = session.value.promptRun;
      if (promptRun) {
        completePromptRun(promptRun);
      }
      return true;
    }),
    output: codexOutput,
    promptInjectionError: ref(""),
    working: codexWorking
  };
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

  function moveToStep(stepId, metadata = {}, promptRun = null) {
    session.value = sessionForStep(stepId, {
      ...session.value.metadata,
      ...metadata
    }, promptRun);
    if (!promptRun) {
      autopilotArtifacts.value = emptyAutopilotArtifacts();
    }
  }

  function createPromptRun(action = {}) {
    promptRunIndex += 1;
    const promptRun = {
      actionId: action.id,
      actionLabel: action.label,
      completionToken: promptCompletionToken(promptRunIndex),
      createdAt: new Date().toISOString(),
      outputStart: codexOutput.value.length,
      promptId: action.id,
      requestId: `request-${promptRunIndex}`,
      sessionId: session.value.sessionId,
      status: "injected",
      stepId: session.value.currentStep
    };
    session.value = {
      ...session.value,
      promptRun
    };
    autopilotArtifacts.value = emptyAutopilotArtifacts();
    return promptRun;
  }

  function agePromptRun(promptRun = session.value.promptRun) {
    if (!promptRun) {
      return null;
    }
    const agedPromptRun = {
      ...promptRun,
      createdAt: new Date(Date.now() - 5000).toISOString()
    };
    session.value = {
      ...session.value,
      promptRun: agedPromptRun
    };
    return agedPromptRun;
  }

  function completePromptRun(promptRun = session.value.promptRun) {
    if (!promptRun) {
      return;
    }
    autopilotArtifacts.value = {
      ...emptyAutopilotArtifacts(),
      promptDone: {
        actionId: promptRun.actionId,
        completionToken: promptRun.completionToken,
        requestId: promptRun.requestId,
        stepId: promptRun.stepId
      }
    };
  }

  function askPromptQuestions(promptRun = session.value.promptRun, questions = []) {
    autopilotArtifacts.value = {
      ...emptyAutopilotArtifacts(),
      questions: {
        questions: questions.map((question, index) => ({
          answer: "",
          id: `q${index + 1}`,
          text: String(question || "")
        })),
        requestId: promptRun.requestId
      }
    };
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
    runAction: vi.fn(async (action) => {
      if (action.id === "use_new_branch") {
        const metadata = {
          ...session.value.metadata,
          work_source: "new_branch"
        };
        const stepId = action.advanceOnSuccess === true
          ? session.value.next.stepId
          : session.value.currentStep;
        session.value = sessionForStep(stepId, metadata);
        return;
      }

      if (action.id === "skip_merge") {
        moveToStep(session.value.currentStep, {
          merge_skipped: "yes"
        });
        return;
      }

      if (PROMPT_ACTION_IDS.has(action.id)) {
        const promptRun = createPromptRun(action);
        completePromptRun(promptRun);
        if (action.id === "apply_review_feedback") {
          moveToStep(session.value.currentStep, {
            human_input_response_ready: "1"
          }, promptRun);
        }
        if (action.id === "write_report") {
          moveToStep(session.value.currentStep, {
            report_ready: "1"
          }, promptRun);
        }
        if (action.id === "create_pr_file") {
          moveToStep(session.value.currentStep, {
            pull_request_ready: "1"
          }, promptRun);
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
  const questionExchange = useAiStudioCodexQuestionExchange({
    codexTerminal
  });
  const refreshSessionData = vi.fn(async () => null);
  const controller = useAiStudioAutopilotController({
    actions,
    autopilotArtifacts,
    clearAutopilotArtifacts: vi.fn(async () => {
      autopilotArtifacts.value = emptyAutopilotArtifacts();
      return {
        ok: true,
        sessionId: "session-1"
      };
    }),
    codexTerminal,
    commandRunner,
    enabled,
    questionExchange,
    refreshSessionData,
    session
  });

  return {
    actions,
    autopilotArtifacts,
    askPromptQuestions,
    agePromptRun,
    codexBusy,
    codexTerminal,
    codexOutput,
    codexWorking,
    commandResults,
    commandRunner,
    controller,
    createPromptRun,
    completePromptRun,
    moveToStep,
    questionExchange,
    refreshSessionData,
    session
  };
}

function sessionForStep(stepId, metadata = {}, promptRun = null) {
  const actions = actionsForStep(stepId, metadata);
  return {
    actions,
    artifactReadiness: artifactReadinessForMetadata(metadata),
    currentStep: stepId,
    currentStepDefinition: {
      actions: actions.map(actionDefinitionForStep),
      autopilot: STEP_AUTOPILOT[stepId] || {},
      label: STEP_LABELS[stepId]
    },
    metadata,
    next: nextForStep(stepId, metadata),
    promptRun,
    sessionId: "session-1",
    stepDefinitions: Object.entries(STEP_LABELS).map(([id, label]) => ({
      id,
      label
    }))
  };
}

function actionDefinitionForStep(action = {}) {
  return {
    id: action.id,
    label: action.label,
    type: action.type
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
  if (stepId === IMPLEMENTATION_REVIEW_STEP_ID) {
    return [
      {
        ...promptAction("apply_review_feedback", "Ask AI for tweaks"),
        allowRepeatedPromptRuns: true
      }
    ];
  }
  if (stepId === "agent_conversation") {
    return [
      {
        ...promptAction("agent_conversation", "Ask Codex for changes"),
        allowRepeatedPromptRuns: true
      }
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
  if (stepId === "report_created") {
    return [
      promptAction("write_report", "Write report")
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
      commandAction("merge_pr", "Merge"),
      {
        enabled: !metadata.pr_merged && !metadata.merge_skipped,
        id: "skip_merge",
        label: "Do not merge",
        type: "adapter"
      }
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
        enabled: Boolean(metadata.pr_url && (metadata.main_checkout_synced || metadata.merge_skipped)),
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
  if (stepId === "report_created") {
    return Boolean(metadata.report_ready);
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
  if (stepId === "pr_merged") {
    return Boolean(metadata.pr_merged || metadata.merge_skipped);
  }
  if (stepId === "main_checkout_synced") {
    return Boolean(metadata.main_checkout_synced || metadata.merge_skipped);
  }
  return Boolean(NEXT_STEP[stepId]);
}

function artifactReadinessForMetadata(metadata = {}) {
  return {
    ...(metadata.human_input_response_ready
      ? {
        "human_input_response.md": {
          nonEmpty: true
        }
      }
      : {}),
    ...(metadata.pull_request_ready
      ? {
        "pull_request.md": {
          nonEmpty: true
        }
      }
      : {}),
    ...(metadata.report_ready
      ? {
        "report.md": {
          nonEmpty: true
        }
      }
      : {})
  };
}

function promptCompletionToken(index = 1) {
  return `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}${String(index).padStart(32, "0")}`;
}

function emptyAutopilotArtifacts() {
  return {
    issueDraft: null,
    ok: true,
    promptDone: null,
    questions: null,
    sessionId: "session-1"
  };
}
