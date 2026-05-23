import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";

const STEP_LABELS = Object.freeze({
  agent_conversation: "Make changes",
  checklist_items_installed: "Install checklist items",
  changes_accepted: "Final review",
  changes_committed: "Commit and push changes",
  deep_ui_check_run: "Run deep UI check",
  dependencies_installed: "Install dependencies",
  implementation_reviewed: "Human review",
  issue_file_created: "Define or select issue",
  issue_submitted: "Edit and submit issue",
  local_session_finished: "Finish local session",
  main_checkout_synced: "Sync main checkout",
  maintenance_conversation: "Talk to Codex",
  plan_executed: "Execute plan",
  plan_made: "Make plan",
  create_pull_request: "Create pull request",
  pr_merged: "Merge PR",
  project_knowledge_updated: "Update project knowledge",
  project_validated: "Validate project",
  report_created: "Write report",
  review_run: "Run review/deslop",
  session_created: "Create session",
  session_finished: "Congratulations!",
  work_source_selected: "Choose work source",
  worktree_created: "Create worktree"
});

const NEXT_STEP = Object.freeze({
  agent_conversation: "deep_ui_check_run",
  checklist_items_installed: "maintenance_conversation",
  changes_accepted: "report_created",
  changes_committed: "create_pull_request",
  deep_ui_check_run: "review_run",
  dependencies_installed: "issue_file_created",
  implementation_reviewed: "deep_ui_check_run",
  issue_file_created: "issue_submitted",
  issue_submitted: "plan_made",
  local_session_finished: "",
  main_checkout_synced: "session_finished",
  maintenance_conversation: "local_session_finished",
  plan_executed: "implementation_reviewed",
  plan_made: "plan_executed",
  create_pull_request: "pr_merged",
  pr_merged: "main_checkout_synced",
  project_knowledge_updated: "changes_committed",
  project_validated: "changes_accepted",
  report_created: "project_knowledge_updated",
  review_run: "project_validated",
  session_created: "work_source_selected",
  work_source_selected: "worktree_created",
  worktree_created: "dependencies_installed"
});

const BIG_FEATURE_WORKFLOW_STEPS = Object.freeze([
  "session_created",
  "work_source_selected",
  "worktree_created",
  "dependencies_installed",
  "issue_file_created",
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
  "create_pull_request",
  "pr_merged",
  "main_checkout_synced",
  "session_finished"
]);

const STEP_AUTOPILOT = Object.freeze({
  agent_conversation: {
    actionId: "agent_conversation",
    kind: "agent_conversation",
    stop: true
  },
  checklist_items_installed: {
    stage: {
      actionId: "install_dependencies",
      label: "Install checklist items"
    }
  },
  changes_accepted: {
    actionId: "final_review_conversation",
    kind: "final_review",
    stop: true
  },
  changes_committed: {
    stage: {
      actionId: "commit_changes",
      label: "Commit and push changes"
    }
  },
  deep_ui_check_run: {
    actionId: "run_deep_ui_check",
    label: "Run deep UI check",
    userDecision: true
  },
  dependencies_installed: {
    stage: {
      actionId: "install_dependencies",
      label: "Install dependencies"
    }
  },
  implementation_reviewed: {
    actionId: "human_review_conversation",
    kind: "implementation_review",
    stop: true
  },
  issue_file_created: {
    kind: "issue_discussion",
    stop: true
  },
  issue_submitted: {
    stage: {
      actionId: "create_issue_on_gh",
      label: "Edit and submit issue"
    }
  },
  main_checkout_synced: {
    stage: {
      actionId: "sync_main_checkout",
      label: "Sync main checkout"
    }
  },
  plan_executed: {
    actionId: "execute_plan",
    label: "Execute plan"
  },
  plan_made: {
    actionId: "make_plan",
    label: "Make plan"
  },
  create_pull_request: {
    stages: [
      {
        actionId: "resolve_pull_request",
        complete: (metadata) => Boolean(metadata.pr_draft_ready),
        label: "Draft PR"
      },
      {
        actionId: "create_pr_on_gh",
        complete: (metadata) => Boolean(metadata.pr_url),
        label: "Create PR on GH"
      }
    ],
    label: "Create pull request"
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
    stages: [
      {
        actionId: "update_code_index",
        complete: (metadata) => Boolean(metadata.code_index_updated),
        label: "Update code index"
      },
      {
        actionId: "run_automated_checks",
        complete: (metadata) => Boolean(metadata.automated_checks_passed),
        label: "Run automated checks"
      }
    ],
    label: "Validate project"
  },
  report_created: {
    actionId: "write_report",
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
  local_session_finished: {
    kind: "finished",
    stop: true
  },
  maintenance_conversation: {
    actionId: "agent_conversation",
    kind: "agent_conversation",
    stop: true
  },
  work_source_selected: {
    stage: {
      actionId: "use_new_branch",
      advanceOnSuccess: true,
      label: "Choose work source"
    }
  },
  worktree_created: {
    stage: {
      actionId: "create_worktree",
      label: "Create worktree"
    }
  }
});

const COMMAND_METADATA = Object.freeze({
  commit_changes: {
    accepted_commit: "abc123",
    branch_pushed: "origin/ai-studio/test-session"
  },
  create_issue_on_gh: {
    issue_url: "https://github.com/example/project/issues/123"
  },
  create_pr_on_gh: {
    pr_number: "123",
    pr_url: "https://github.com/example/project/pull/123"
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
  },
  use_new_branch: {
    work_source: "new_branch"
  }
});

const PROMPT_ACTION_IDS = new Set([
  "agent_conversation",
  "execute_plan",
  "final_review_conversation",
  "human_review_conversation",
  "make_plan",
  "prepare_for_merge",
  "resolve_pull_request",
  "run_deep_ui_check",
  "run_deslop",
  "update_project_knowledge",
  "write_report"
]);

describe("useAiStudioAutopilotController", () => {
  it("runs setup automation and stops at issue definition", async () => {
    const context = createControllerContext({
      stepId: "session_created"
    });

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("issue_file_created");
    expect(context.commandRunner.runCommandAction).toHaveBeenCalledTimes(2);
    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "use_new_branch"
    }));
  });

  it("continues non-commit maintenance through server-advanced command steps", async () => {
    const context = createControllerContext({
      stepId: "worktree_created",
      workflowSteps: [
        "session_created",
        "worktree_created",
        "checklist_items_installed",
        "maintenance_conversation",
        "local_session_finished"
      ]
    });

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("maintenance_conversation");
    expect(context.controller.failure.value).toBe(null);
    expect(context.commandRunner.runCommandAction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: expect.objectContaining({ id: "create_worktree" }),
      advanceOnSuccess: true
    }));
    expect(context.commandRunner.runCommandAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: expect.objectContaining({ id: "install_dependencies" }),
      advanceOnSuccess: true
    }));
  });

  it("shows a completed conversation even if Codex terminal activity is stale", () => {
    const context = createControllerContext({
      metadata: {
        response_ready: "1"
      },
      stepId: "maintenance_conversation",
      stepMachineStatuses: {
        maintenance_conversation: {
          status: "done",
          stepId: "maintenance_conversation"
        }
      },
      workflowSteps: [
        "session_created",
        "worktree_created",
        "checklist_items_installed",
        "maintenance_conversation",
        "local_session_finished"
      ]
    });

    context.codexTerminal.working.value = true;

    expect(context.controller.waitingForCodex.value).toBe(false);
    expect(context.controller.screenState.value.kind).toBe("agent_conversation");
    expect(context.controller.canFinishAgentConversation.value).toBe(true);
  });

  it("continues the big-feature workflow to the implementation review stop", async () => {
    const context = createControllerContext({
      metadata: {
        issue_title: "Issue",
        issue_url: "https://github.com/example/project/issues/1"
      },
      stepId: "plan_made"
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("implementation_reviewed");
    expect(context.promptActions()).toEqual([
      "make_plan",
      "execute_plan"
    ]);
  });

  it("continues from an already completed prompt step without resending the prompt", async () => {
    const context = createControllerContext({
      stepMachineStatuses: {
        plan_executed: "done"
      },
      stepId: "plan_executed"
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("implementation_reviewed");
    expect(context.actions.runAction).not.toHaveBeenCalled();
  });

  it("pauses when Codex asks for input through the step machine", async () => {
    const context = createControllerContext({
      stepId: "plan_executed"
    });
    context.promptBehavior.execute_plan = () => {
      context.setStepMachineStatus("plan_executed", "need_input");
    };

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("plan_executed");
    expect(context.session.value.stepMachine.status).toBe("need_input");
    expect(context.controller.failure.value).toBe(null);
  });

  it("reruns a prompt step after user input resolves a Codex question", async () => {
    const context = createControllerContext({
      stepMachineStatuses: {
        plan_executed: "need_input"
      },
      stepId: "plan_executed"
    });

    context.setStepMachineStatus("plan_executed", "awaiting_agent_result");
    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("implementation_reviewed");
  });

  it("reruns a prompt step in awaiting_agent_result even when an older artifact is ready", async () => {
    const context = createControllerContext({
      metadata: {
        response_ready: "1"
      },
      stepMachineStatuses: {
        agent_conversation: "awaiting_agent_result"
      },
      stepId: "agent_conversation"
    });

    await context.controller.resume();

    expect(context.promptActions()).toEqual(["agent_conversation"]);
    expect(context.session.value.stepMachine.status).toBe("done");
  });

  it("keeps interactive agent conversation on the same step until the user continues", async () => {
    const context = createControllerContext({
      metadata: {
        dependencies_installed: "1",
        work_source: "new_branch",
        worktree_path: "/tmp/worktree"
      },
      stepId: "agent_conversation",
      workflowSteps: [
        "session_created",
        "work_source_selected",
        "worktree_created",
        "dependencies_installed",
        "agent_conversation",
        "deep_ui_check_run",
        "review_run"
      ]
    });

    await context.controller.submitAgentConversationRequest("Add a small readme note.");

    expect(context.session.value.currentStep).toBe("agent_conversation");
    expect(context.session.value.stepMachine.status).toBe("done");

    await context.controller.finishAgentConversation();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
  });

  it("does nothing while Autopilot is disabled", async () => {
    const context = createControllerContext({
      enabled: false,
      stepId: "session_created"
    });

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("session_created");
    expect(context.actions.runAction).not.toHaveBeenCalled();
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
  });

  it("stops on command failure and retries from the same step", async () => {
    const context = createControllerContext({
      metadata: {
        code_index_updated: "1"
      },
      stepId: "project_validated"
    });
    context.commandFailures.add("run_automated_checks");

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("project_validated");
    expect(context.controller.screenState.value.kind).toBe("command");
    expect(context.controller.commandResult.value.ok).toBe(false);

    context.commandFailures.clear();
    await context.controller.retry();

    expect(context.session.value.currentStep).toBe("changes_accepted");
  });

  it("drafts pull request content through Codex before running the PR command", async () => {
    const context = createControllerContext({
      metadata: {
        accepted_commit: "abc123",
        branch_pushed: "origin/ai-studio/test-session"
      },
      stepId: "create_pull_request"
    });

    await context.controller.resume();

    expect(context.promptActions()).toEqual(["resolve_pull_request"]);
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.session.value.currentStep).toBe("create_pull_request");
    expect(context.session.value.stepMachine.status).toBe("confirm_files");

    await context.controller.resume();

    expect(context.commandRunner.runCommandAction).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({
        id: "create_pr_on_gh"
      })
    }));
    expect(context.session.value.currentStep).toBe("pr_merged");
  });
});

function createControllerContext({
  enabled = true,
  metadata = {},
  stepMachineStatuses = {},
  stepId = "session_created",
  workflowSteps = BIG_FEATURE_WORKFLOW_STEPS
} = {}) {
  const commandFailures = new Set();
  const enabledRef = ref(enabled);
  const session = ref(null);
  const stepStates = {
    ...stepMachineStatuses
  };
  const codexBusy = ref(false);
  const codexWorking = ref(false);
  const commandRunning = ref(false);
  const commandOutput = ref("");
  const commandPreview = ref("");
  const commandResult = ref(null);
  const runActionCalls = [];
  const promptBehavior = {};

  function syncSession(nextStepId = session.value?.currentStep || stepId) {
    const currentStepDefinition = stepDefinition(nextStepId, metadata, workflowSteps);
    session.value = {
      actions: actionsForStep(nextStepId),
      artifactReadiness: {},
      artifactsRoot: "/tmp/session/artifacts",
      completedSteps: workflowSteps.slice(0, Math.max(0, workflowSteps.indexOf(nextStepId))),
      currentStep: nextStepId,
      currentStepDefinition,
      metadata: {
        ...metadata
      },
      next: nextForStep(nextStepId, metadata, workflowSteps, stepStates),
      sessionId: "session-1",
      stepMachine: stepMachineForTest(nextStepId, metadata, stepStates),
      stepDefinitions: workflowSteps.map((id) => stepDefinition(id, metadata, workflowSteps))
    };
  }

  function setMetadata(values = {}) {
    Object.assign(metadata, values);
    syncSession();
  }

  function setStepMachineStatus(nextStepId = session.value?.currentStep || "", status = "done", details = {}) {
    stepStates[nextStepId] = {
      ...details,
      status,
      stepId: nextStepId
    };
    syncSession();
  }

  function completePromptAction(actionId = "") {
    if (actionId === "resolve_pull_request") {
      setMetadata({
        pr_draft_ready: "1"
      });
      setStepMachineStatus(session.value.currentStep, "confirm_files");
      return;
    }
    if (actionId === "agent_conversation" || actionId === "human_review_conversation" || actionId === "final_review_conversation") {
      setMetadata({
        response_ready: "1"
      });
    }
    if (actionId === "write_report") {
      setMetadata({
        report_ready: "1"
      });
    }
    setStepMachineStatus(session.value.currentStep, "done");
  }

  const actions = {
    currentActions: computed(() => session.value?.actions || []),
    currentNext: computed(() => session.value?.next || null),
    goNext: vi.fn(async () => {
      const nextStepId = session.value?.next?.stepId;
      if (!nextStepId || session.value?.next?.enabled !== true) {
        throw new Error("Next step is not ready.");
      }
      syncSession(nextStepId);
    }),
    rewindToStep: vi.fn(async (step = {}) => {
      syncSession(step.rewindStepId || step.id);
    }),
    runAction: vi.fn(async (action = {}, { input = {} } = {}) => {
      runActionCalls.push({
        actionId: action.id,
        input
      });
      if (action.id === "use_new_branch") {
        setMetadata(COMMAND_METADATA.use_new_branch);
        if (action.advanceOnSuccess === true) {
          await actions.goNext();
        }
        return;
      }
      if (PROMPT_ACTION_IDS.has(action.id)) {
        const behavior = promptBehavior[action.id];
        if (typeof behavior === "function") {
          behavior(action, input);
        } else {
          completePromptAction(action.id);
        }
      }
    })
  };

  const commandRunner = {
    commandPreview,
    lastResult: commandResult,
    output: commandOutput,
    running: commandRunning,
    status: ref(""),
    runCommandAction: vi.fn(async ({ action = {}, advanceOnSuccess = false } = {}) => {
      commandRunning.value = true;
      commandPreview.value = action.label || action.id;
      commandOutput.value = `${action.id} output`;
      commandRunning.value = false;
      if (commandFailures.has(action.id)) {
        commandResult.value = {
          actionId: action.id,
          actionLabel: action.label,
          error: `${action.label} failed.`,
          exitCode: 1,
          ok: false,
          output: commandOutput.value
        };
        return commandResult.value;
      }
      setMetadata(COMMAND_METADATA[action.id] || {});
      if (advanceOnSuccess === true && session.value?.next?.enabled === true) {
        await actions.goNext();
      }
      commandResult.value = {
        actionId: action.id,
        actionLabel: action.label,
        exitCode: 0,
        ok: true,
        output: commandOutput.value
      };
      return commandResult.value;
    }),
    stopCommandAction: vi.fn()
  };

  const codexTerminal = {
    busy: codexBusy,
    injectPrompt: vi.fn(async () => {
      codexBusy.value = true;
      codexBusy.value = false;
      return true;
    }),
    promptInjectionError: ref(""),
    working: codexWorking
  };
  const controller = useAiStudioAutopilotController({
    actions,
    codexTerminal,
    commandRunner,
    enabled: enabledRef,
    refreshSessionData: async () => {
      syncSession();
    },
    session
  });

  syncSession(stepId);

  return {
    actions,
    codexTerminal,
    commandFailures,
    commandRunner,
    controller,
    enabledRef,
    promptActions: () => runActionCalls
      .filter((call) => PROMPT_ACTION_IDS.has(call.actionId))
      .map((call) => call.actionId),
    promptBehavior,
    setStepMachineStatus,
    session,
  };
}

function stepDefinition(stepId = "", metadata = {}, workflowSteps = []) {
  return {
    actions: actionsForStep(stepId),
    autopilot: autopilotForTest(stepId, metadata),
    id: stepId,
    label: STEP_LABELS[stepId] || stepId,
    next: {
      stepId: nextStepIdForWorkflow(stepId, workflowSteps)
    },
    status: workflowSteps.includes(stepId) ? "pending" : ""
  };
}

function actionsForStep(stepId = "") {
  const autopilot = STEP_AUTOPILOT[stepId] || {};
  const actions = [];
  if (autopilot.actionId) {
    actions.push(actionForId(autopilot.actionId, autopilot.label || STEP_LABELS[stepId]));
  }
  if (autopilot.stage) {
    actions.push(actionForId(autopilot.stage.actionId, autopilot.stage.label));
  }
  if (Array.isArray(autopilot.stages)) {
    for (const actionStage of autopilot.stages) {
      actions.push(actionForId(actionStage.actionId, actionStage.label));
    }
  }
  if (stepId === "pr_merged") {
    actions.push(actionForId("prepare_for_merge", "Prepare for merge"));
    actions.push(actionForId("merge_pr", "Merge"));
    actions.push({
      enabled: true,
      id: "skip_merge",
      label: "Do not merge",
      type: "record"
    });
  }
  if (stepId === "session_finished") {
    actions.push({
      enabled: true,
      id: "finish_session",
      label: "Archive",
      type: "finish"
    });
  }
  return actions;
}

function autopilotForTest(stepId = "", metadata = {}) {
  const autopilot = STEP_AUTOPILOT[stepId] || {};
  return {
    kind: autopilot.kind || "",
    label: autopilot.label || "",
    stage: autopilotStageForTest(stepId, autopilot, metadata),
    stop: autopilot.stop === true,
    userDecision: autopilot.userDecision === true
  };
}

function autopilotStageForTest(stepId = "", autopilot = {}, metadata = {}) {
  if (Array.isArray(autopilot.stages) && autopilot.stages.length > 0) {
    return autopilot.stages.find((stage) => {
      return typeof stage.complete === "function" ? !stage.complete(metadata) : true;
    }) || null;
  }
  if (autopilot.stage) {
    if (stepCompletionFacts(stepId, metadata)) {
      return null;
    }
    return {
      actionId: autopilot.stage.actionId,
      advanceOnSuccess: autopilot.stage.advanceOnSuccess === true,
      label: autopilot.stage.label || autopilot.stage.actionId
    };
  }
  if (!autopilot.actionId) {
    return null;
  }
  return {
    actionId: autopilot.actionId,
    advanceOnSuccess: autopilot.advanceOnSuccess === true,
    label: autopilot.label || autopilot.actionId
  };
}

function actionForId(actionId = "", label = "") {
  const promptAction = PROMPT_ACTION_IDS.has(actionId);
  return {
    enabled: true,
    id: actionId,
    label: label || actionId,
    promptId: promptAction ? actionId : "",
    type: promptAction ? "prompt" : actionId === "use_new_branch" ? "adapter" : "command"
  };
}

function nextForStep(stepId = "", metadata = {}, workflowSteps = [], stepStates = {}) {
  const nextStepId = nextStepIdForWorkflow(stepId, workflowSteps);
  if (!nextStepId || !workflowSteps.includes(nextStepId)) {
    return {
      enabled: false,
      stepId: "",
      visible: false
    };
  }
  return {
    enabled: stepIsComplete(stepId, metadata, stepStates),
    stepId: nextStepId,
    visible: true
  };
}

function nextStepIdForWorkflow(stepId = "", workflowSteps = []) {
  const stepIndex = workflowSteps.indexOf(stepId);
  if (stepIndex >= 0) {
    return workflowSteps[stepIndex + 1] || "";
  }
  return NEXT_STEP[stepId] || "";
}

function stepIsComplete(stepId = "", metadata = {}, stepStates = {}) {
  const stepState = stepStates[stepId];
  const stepStateStatus = typeof stepState === "string" ? stepState : stepState?.status;
  if (stepStateStatus === "done") {
    return true;
  }
  return Boolean(stepCompletionFacts(stepId, metadata));
}

function stepCompletionFacts(stepId = "", metadata = {}) {
  switch (stepId) {
    case "agent_conversation":
    case "changes_accepted":
    case "implementation_reviewed":
    case "maintenance_conversation":
      return metadata.response_ready;
    case "changes_committed":
      return metadata.accepted_commit && metadata.branch_pushed;
    case "checklist_items_installed":
    case "dependencies_installed":
      return metadata.dependencies_installed;
    case "issue_file_created":
      return metadata.issue_title;
    case "issue_submitted":
      return metadata.issue_url;
    case "main_checkout_synced":
      return metadata.main_checkout_synced;
    case "create_pull_request":
      return metadata.pr_url;
    case "project_validated":
      return metadata.code_index_updated && metadata.automated_checks_passed;
    case "report_created":
      return metadata.report_ready;
    case "work_source_selected":
      return metadata.work_source;
    case "worktree_created":
      return metadata.worktree_path;
    default:
      return true;
  }
}

function stepMachineForTest(stepId = "", metadata = {}, stepStates = {}) {
  if (stepStates[stepId]) {
    if (typeof stepStates[stepId] === "string") {
      return {
        status: stepStates[stepId],
        stepId
      };
    }
    return stepStates[stepId];
  }
  if (!STEP_AUTOPILOT[stepId]?.actionId && !STEP_AUTOPILOT[stepId]?.stage && !Array.isArray(STEP_AUTOPILOT[stepId]?.stages)) {
    return null;
  }
  if (stepId !== "create_pull_request") {
    return {
      status: "ready",
      stepId
    };
  }
  if (metadata.pr_url) {
    return {
      status: "done",
      stepId
    };
  }
  if (metadata.pr_draft_ready) {
    return {
      status: "confirm_files",
      stepId
    };
  }
  return {
    status: "awaiting_agent_result",
    stepId
  };
}
