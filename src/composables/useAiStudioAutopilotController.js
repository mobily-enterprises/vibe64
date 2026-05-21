import { computed, nextTick, ref, watch } from "vue";
import {
  useAiStudioCodexQuestionExchange
} from "@/composables/useAiStudioCodexQuestionExchange.js";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  autopilotQuestionAnswersInstruction
} from "@/lib/aiStudioAutopilotPromptFiles.js";
import {
  clearAiStudioAutopilotArtifacts
} from "@/lib/aiStudioSessionApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const ISSUE_STEP_ID = "issue_file_created";
const DEEP_UI_CHECK_STEP_ID = "deep_ui_check_run";
const FINISHED_STEP_ID = "session_finished";
const FINISH_SESSION_ACTION_ID = "finish_session";
const MAIN_CHECKOUT_SYNCED_STEP_ID = "main_checkout_synced";
const MERGE_PR_STEP_ID = "pr_merged";
const REVIEW_CHANGES_STEP_ID = "changes_accepted";
const SESSION_CREATED_STEP_ID = "session_created";
const WORK_SOURCE_SELECTED_STEP_ID = "work_source_selected";
const REPLAN_STEP_ID = "plan_made";
const MAX_AUTOPILOT_OPERATIONS = 40;
const PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS = 3000;
const PROMPT_WAIT_RESULT = Object.freeze({
  COMPLETED: "completed",
  INCOMPLETE: "incomplete",
  QUESTIONS: "questions"
});

const AUTOPILOT_STEP_ACTIONS = Object.freeze({
  dependencies_installed: {
    actionId: "install_dependencies",
    complete: (session) => metadataValue(session, "dependencies_installed"),
    label: "Install dependencies"
  },
  deep_ui_check_run: {
    actionId: "run_deep_ui_check",
    label: "Run deep UI check"
  },
  issue_submitted: {
    actionId: "create_issue_on_gh",
    complete: (session) => metadataValue(session, "issue_url"),
    label: "Edit and submit issue"
  },
  changes_committed: {
    actionId: "commit_changes",
    complete: (session) => metadataValue(session, "accepted_commit") && metadataValue(session, "branch_pushed"),
    label: "Commit and push changes"
  },
  main_checkout_synced: {
    actionId: "sync_main_checkout",
    complete: (session) => metadataValue(session, "main_checkout_synced"),
    label: "Sync main checkout"
  },
  plan_executed: {
    actionId: "execute_plan",
    label: "Execute plan"
  },
  pr_created: {
    actionId: "create_pr_on_gh",
    complete: (session) => metadataValue(session, "pr_url"),
    label: "Create PR on GH"
  },
  pr_file_created: {
    actionId: "create_pr_file",
    complete: (session) => metadataValue(session, "pr_url") || artifactReady(session, "pull_request.md"),
    label: "Create PR file"
  },
  project_knowledge_updated: {
    actionId: "update_project_knowledge",
    label: "Update project knowledge"
  },
  plan_made: {
    actionId: "make_plan",
    label: "Make plan"
  },
  review_run: {
    actionId: "run_deslop",
    label: "Run deslop"
  },
  work_source_selected: {
    actionId: "use_new_branch",
    advanceOnSuccess: true,
    complete: (session) => metadataValue(session, "work_source"),
    label: "Choose work source"
  },
  worktree_created: {
    actionId: "create_worktree",
    complete: (session) => metadataValue(session, "worktree_path"),
    label: "Create worktree"
  }
});

function readSession(session) {
  return readRefOrGetterValue(session) || null;
}

function readActions(actions = {}) {
  const currentActions = readRefOrGetterValue(actions.currentActions);
  return Array.isArray(currentActions) ? currentActions : [];
}

function readNext(actions = {}) {
  return readRefOrGetterValue(actions.currentNext) || null;
}

function readPromptInjectionError(codexTerminal = {}) {
  return String(readRefOrGetterValue(codexTerminal.promptInjectionError) || "");
}

function readCodexBusy(codexTerminal = {}) {
  return readRefOrGetterValue(codexTerminal.busy) === true;
}

function actionById(actions = [], actionId = "") {
  return actions.find((action) => action.id === actionId) || null;
}

function metadataValue(session = {}, name = "") {
  return String(session?.metadata?.[name] || "").trim();
}

function artifactReady(session = {}, name = "") {
  return session?.artifactReadiness?.[name]?.nonEmpty === true;
}

function stepLabel(session = {}) {
  return String(session?.currentStepDefinition?.label || session?.currentStep || "Current step");
}

function sessionStepLabel(session = {}, stepId = "") {
  return (Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [])
    .find((step) => step.id === stepId)?.label || "";
}

function nextIsReady(next = {}) {
  return next?.visible === true && next.enabled === true;
}

function currentStepIsStopPoint(stepId = "") {
  return stepId === ISSUE_STEP_ID ||
    stepId === REVIEW_CHANGES_STEP_ID ||
    stepId === MERGE_PR_STEP_ID ||
    stepId === FINISHED_STEP_ID;
}

function currentStepNeedsUserDecision(stepId = "") {
  return stepId === DEEP_UI_CHECK_STEP_ID;
}

function currentStepIsStartBoundary(stepId = "") {
  return stepId === SESSION_CREATED_STEP_ID || stepId === WORK_SOURCE_SELECTED_STEP_ID;
}

function currentStepCanRunAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  return stepId === SESSION_CREATED_STEP_ID ||
    currentStepNeedsUserDecision(stepId) ||
    Boolean(stageForSession(session));
}

function currentStepCanStartAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  if (!currentStepIsStartBoundary(stepId)) {
    return false;
  }
  return currentStepCanRunAutopilot(session) || nextIsReady(session.next);
}

function disabledActionFailure(action = {}, stage = {}) {
  return {
    actionId: String(action.id || stage.actionId || ""),
    actionLabel: String(action.label || stage.label || "Action"),
    error: String(action.disabledReason || `${action.label || stage.label || "Action"} is disabled.`),
    exitCode: null,
    ok: false,
    output: ""
  };
}

function missingActionFailure(stage = {}) {
  return {
    actionId: stage.actionId,
    actionLabel: stage.label,
    error: `${stage.label} is not available on this session step.`,
    exitCode: null,
    ok: false,
    output: ""
  };
}

function blockedStepFailure(session = {}) {
  return {
    actionId: "",
    actionLabel: stepLabel(session),
    error: `Autopilot cannot continue from ${stepLabel(session)}.`,
    exitCode: null,
    ok: false,
    output: ""
  };
}

function skipDeepUiCheckFailure() {
  return {
    actionId: "run_deep_ui_check",
    actionLabel: "Run deep UI check",
    error: "Autopilot cannot skip the deep UI check because the next workflow step is not available.",
    exitCode: null,
    ok: false,
    output: ""
  };
}

function promptNotCompletedFailure(stage = {}) {
  return {
    actionId: stage.actionId,
    actionLabel: stage.label,
    error: `The ${stage.label} step did not complete properly, so Autopilot could not safely continue.`,
    exitCode: null,
    ok: false,
    output: "",
    source: "codex"
  };
}

function autopilotStoppedFailure() {
  return {
    actionId: "",
    actionLabel: "Autopilot",
    error: "Autopilot stopped. Use Inspect to continue manually, or Retry to resume Autopilot.",
    exitCode: null,
    ok: false,
    output: ""
  };
}

function projectValidationStage(session = {}) {
  if (!metadataValue(session, "code_index_updated")) {
    return {
      actionId: "update_code_index",
      label: "Update code index"
    };
  }
  if (!metadataValue(session, "automated_checks_passed")) {
    return {
      actionId: "run_automated_checks",
      label: "Run automated checks"
    };
  }
  return null;
}

function stageForSession(session = {}) {
  if (session.currentStep === "project_validated") {
    return projectValidationStage(session);
  }
  const stage = AUTOPILOT_STEP_ACTIONS[session.currentStep] || null;
  if (!stage || typeof stage.complete !== "function" || !stage.complete(session)) {
    return stage;
  }
  return null;
}

function actionLabelForId(actionId = "") {
  const stage = Object.values(AUTOPILOT_STEP_ACTIONS)
    .find((candidate) => candidate.actionId === actionId);
  return stage?.label || String(actionId || "Codex");
}

function promptRunMatchesSession(promptRun = {}, session = {}) {
  return promptRun?.sessionId === session?.sessionId &&
    promptRun?.stepId === session?.currentStep &&
    Boolean(promptRun.actionId && promptRun.completionToken && promptRun.requestId);
}

function promptRunForSession(session = {}) {
  const promptRun = session?.promptRun;
  if (!promptRun || typeof promptRun !== "object" || Array.isArray(promptRun)) {
    return null;
  }
  if (
    promptRun.stepId !== session?.currentStep ||
    !promptRun.actionId ||
    !promptRun.completionToken ||
    !promptRun.requestId
  ) {
    return null;
  }
  return {
    ...promptRun,
    sessionId: session.sessionId
  };
}

function promptRunQuestionOwnerId(promptRun = {}) {
  return [
    "workflow",
    String(promptRun.sessionId || ""),
    String(promptRun.stepId || ""),
    String(promptRun.requestId || "")
  ].join(":");
}

function promptQuestionsMatchRun(questions = null, promptRun = {}) {
  return questions?.requestId === promptRun.requestId &&
    Array.isArray(questions.questions) &&
    questions.questions.length > 0;
}

function promptDoneMatchesRun(promptDone = null, promptRun = {}) {
  return promptDone?.requestId === promptRun.requestId &&
    promptDone?.completionToken === promptRun.completionToken;
}

function useAiStudioAutopilotController({
  actions = {},
  autopilotArtifacts = null,
  clearAutopilotArtifacts = clearAiStudioAutopilotArtifacts,
  codexTerminal = {},
  commandRunner = useAiStudioHeadlessCommandRunner(),
  enabled = true,
  questionExchange = null,
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const activePromptRun = ref(null);
  const deepUiCheckDecision = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);
  const replanFeedback = ref("");
  const codexQuestions = questionExchange || useAiStudioCodexQuestionExchange({
    codexTerminal
  });

  let autopilotPromise = null;
  let stopRequested = false;

  const autopilotEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const currentStep = computed(() => readSession(session)?.currentStep || "");
  const commandOutput = computed(() => String(readRefOrGetterValue(commandRunner.output) || ""));
  const commandPreview = computed(() => String(readRefOrGetterValue(commandRunner.commandPreview) || ""));
  const commandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const commandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const codexBusy = computed(() => readCodexBusy(codexTerminal));
  const running = computed(() => active.value || commandRunning.value || codexQuestions.submitting.value);
  const currentPromptRun = computed(() => promptRunForSession(readSession(session)));
  const currentAutopilotArtifacts = computed(() => readRefOrGetterValue(autopilotArtifacts) || null);
  const readyForIssue = computed(() => currentStep.value === ISSUE_STEP_ID);
  const readyForDeepUiCheck = computed(() => {
    return currentStep.value === DEEP_UI_CHECK_STEP_ID && !running.value && !failure.value;
  });
  const readyForFinished = computed(() => currentStep.value === FINISHED_STEP_ID);
  const readyForMerge = computed(() => currentStep.value === MERGE_PR_STEP_ID);
  const readyForReview = computed(() => currentStep.value === REVIEW_CHANGES_STEP_ID);
  const workflowQuestionActive = computed(() => {
    const promptRun = activePromptRun.value || currentPromptRun.value;
    return promptRunMatchesSession(promptRun, readSession(session)) &&
      codexQuestions.isOwner(promptRunQuestionOwnerId(promptRun)) &&
      codexQuestions.hasQuestions.value;
  });
  const promptRunNeedsContinuation = computed(() => {
    const promptRun = activePromptRunForSession(readSession(session));
    return Boolean(
      promptRun &&
      !codexBusy.value &&
      !running.value &&
      !workflowQuestionActive.value &&
      !promptQuestionsMatchRun(currentAutopilotArtifacts.value?.questions, promptRun) &&
      !failure.value &&
      !promptDoneMatchesRun(currentAutopilotArtifacts.value?.promptDone, promptRun)
    );
  });
  const waitingForCodex = computed(() => Boolean(
    (
      promptRunMatchesSession(activePromptRun.value || currentPromptRun.value, readSession(session)) &&
      codexBusy.value &&
      !workflowQuestionActive.value
    ) ||
    codexIsActiveForCurrentStep()
  ));
  const canStart = computed(() => Boolean(
    autopilotEnabled.value &&
    readSession(session)?.sessionId &&
    !running.value &&
    !currentStepIsStopPoint(currentStep.value) &&
    currentStepCanStartAutopilot(readSession(session))
  ));
  const canResume = computed(() => {
    const currentSession = readSession(session);
    return Boolean(
      autopilotEnabled.value &&
      currentSession?.sessionId &&
      currentSession.currentStep &&
      !currentStepIsStartBoundary(currentSession.currentStep) &&
      !currentStepIsStopPoint(currentSession.currentStep) &&
      currentStepCanRunAutopilot(currentSession) &&
      !running.value &&
      !promptRunNeedsContinuation.value &&
      (!failure.value || codexIsActiveForCurrentStep())
    );
  });
  const canAcceptReview = computed(() => {
    const next = readNext(actions);
    return Boolean(readyForReview.value && !running.value && nextIsReady(next));
  });
  const canArchiveSession = computed(() => {
    const archiveAction = actionById(readActions(actions), FINISH_SESSION_ACTION_ID);
    return Boolean(readyForFinished.value && !running.value && archiveAction?.enabled === true);
  });
  const statusText = computed(() => {
    if (codexIsActiveForCurrentStep()) {
      return `Executing: ${activeStage.value || stepLabel(readSession(session))}`;
    }
    if (failure.value) {
      return "Attention required";
    }
    if (workflowQuestionActive.value) {
      return "A few questions first";
    }
    if (promptRunNeedsContinuation.value) {
      return "Codex is waiting to continue";
    }
    if (running.value) {
      return `Executing: ${activeStage.value || stepLabel(readSession(session))}`;
    }
    if (readyForIssue.value) {
      return "What would you like to do?";
    }
    if (readyForDeepUiCheck.value) {
      return "Run deep UI check?";
    }
    if (readyForReview.value) {
      return "Review changes";
    }
    if (readyForMerge.value) {
      return "Merge pull request?";
    }
    if (readyForFinished.value) {
      return "Congratulations!";
    }
    const currentSession = readSession(session);
    if (
      currentSession?.currentStep &&
      !currentStepIsStartBoundary(currentSession.currentStep) &&
      !currentStepCanRunAutopilot(currentSession)
    ) {
      return stepLabel(currentSession);
    }
    return "Let's get started";
  });

  function clearFailure() {
    failure.value = null;
    lastCommandResult.value = null;
    codexQuestions.clearFailure();
  }

  async function acceptChanges() {
    if (!autopilotEnabled.value || !canAcceptReview.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    activeStage.value = "Accept changes";
    try {
      await actions.goNext?.();
      await refreshSessionData();
      await nextTick();
      await runUntilStopPoint();
    } catch (error) {
      stopWithFailure({
        actionId: "",
        actionLabel: "Accept changes",
        error: String(error?.message || error || "Could not accept the reviewed changes."),
        exitCode: null,
        ok: false,
        output: ""
      });
    } finally {
      activeStage.value = "";
    }
  }

  async function start() {
    if (!autopilotEnabled.value || !canStart.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function resume() {
    if (!autopilotEnabled.value || !canResume.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function continuePromptRun() {
    const promptRun = activePromptRunForSession(readSession(session));
    if (!autopilotEnabled.value || !promptRunMatchesSession(promptRun, readSession(session)) || running.value || codexBusy.value) {
      return false;
    }

    stopRequested = false;
    clearFailure();
    active.value = true;
    activePromptRun.value = promptRun;
    activeStage.value = actionLabelForId(promptRun.actionId);
    try {
      const injected = await codexTerminal.injectPrompt?.("continue", {
        requestId: `continue:${promptRun.requestId}`,
        sessionId: promptRun.sessionId
      });
      if (injected === false) {
        stopWithFailure({
          actionId: promptRun.actionId,
          actionLabel: actionLabelForId(promptRun.actionId),
          error: "Codex did not accept the continue prompt. Switch to Inspect and continue manually.",
          exitCode: null,
          ok: false,
          output: "",
          source: "codex"
        });
        return false;
      }

      await refreshSessionData();
      await nextTick();
      const waitResult = await waitForPromptCompletion(promptRun);
      if (waitResult === PROMPT_WAIT_RESULT.QUESTIONS) {
        return true;
      }
      if (waitResult !== PROMPT_WAIT_RESULT.COMPLETED) {
        return false;
      }
      clearPromptRunState();
      clearReplanFeedback({
        id: promptRun.actionId
      });
      if (promptRun.advanceAfterCompletion !== false) {
        await advanceCurrentStepIfReady();
      }
      await runUntilStopPoint();
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionId: promptRun.actionId,
        actionLabel: actionLabelForId(promptRun.actionId),
        error: String(error?.message || error || "Codex could not continue."),
        exitCode: null,
        ok: false,
        output: "",
        source: "codex"
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  function stop() {
    stopRequested = true;
    if (commandRunning.value && typeof commandRunner.stopCommandAction === "function") {
      commandRunner.stopCommandAction();
      return;
    }
    clearPromptRunState();
    activeStage.value = "";
    stopWithFailure(autopilotStoppedFailure());
  }

  function stopCommandAction() {
    if (!commandRunning.value || typeof commandRunner.stopCommandAction !== "function") {
      return false;
    }
    stopRequested = true;
    return commandRunner.stopCommandAction();
  }

  async function runDeepUiCheck() {
    if (!autopilotEnabled.value || currentStep.value !== DEEP_UI_CHECK_STEP_ID || running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "run";
    await runUntilStopPoint();
  }

  async function skipDeepUiCheck() {
    if (!autopilotEnabled.value || currentStep.value !== DEEP_UI_CHECK_STEP_ID || running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "skip";
    await runUntilStopPoint();
  }

  async function rejectChanges(feedback = "") {
    const normalizedFeedback = String(feedback || "").trim();
    if (!autopilotEnabled.value || currentStep.value !== REVIEW_CHANGES_STEP_ID || running.value) {
      return false;
    }
    if (!normalizedFeedback) {
      stopWithFailure({
        actionId: "",
        actionLabel: "Reject changes",
        error: "Describe what should change before sending the work back to Codex.",
        exitCode: null,
        ok: false,
        output: ""
      });
      return false;
    }

    stopRequested = false;
    clearFailure();
    replanFeedback.value = normalizedFeedback;
    activeStage.value = "Reopen plan";
    try {
      await actions.rewindToStep?.({
        canRewind: true,
        id: REPLAN_STEP_ID,
        rewindStepId: REPLAN_STEP_ID
      });
      await refreshSessionData();
      await nextTick();
      await runUntilStopPoint();
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionId: "",
        actionLabel: "Reject changes",
        error: String(error?.message || error || "Could not send the changes back to Codex."),
        exitCode: null,
        ok: false,
        output: ""
      });
      return false;
    } finally {
      activeStage.value = "";
    }
  }

  function cancelMergeFailure() {
    if (currentStep.value === MERGE_PR_STEP_ID) {
      clearFailure();
    }
  }

  async function mergeAndSyncMainCheckout() {
    if (!autopilotEnabled.value || currentStep.value !== MERGE_PR_STEP_ID || running.value) {
      return false;
    }
    stopRequested = false;
    clearFailure();
    active.value = true;
    try {
      const prepareAction = actionById(readActions(actions), "prepare_for_merge");
      if (!prepareAction) {
        stopWithFailure(missingActionFailure({
          actionId: "prepare_for_merge",
          label: "Prepare for merge"
        }));
        return false;
      }
      if (prepareAction.enabled !== true) {
        stopWithFailure(disabledActionFailure(prepareAction, {
          actionId: "prepare_for_merge",
          label: "Prepare for merge"
        }));
        return false;
      }
      await runPromptAction(prepareAction, {
        actionId: prepareAction.id,
        label: prepareAction.label || "Prepare for merge"
      }, {
        advanceAfterCompletion: false
      });
      if (failure.value) {
        return false;
      }

      const currentSession = readSession(session);
      const mergeAction = actionById(readActions(actions), "merge_pr");
      if (!mergeAction) {
        stopWithFailure(missingActionFailure({
          actionId: "merge_pr",
          label: "Merge"
        }));
        return false;
      }
      if (mergeAction.enabled !== true) {
        stopWithFailure(disabledActionFailure(mergeAction, {
          actionId: "merge_pr",
          label: "Merge"
        }));
        return false;
      }

      activeStage.value = "Merge";
      await runTerminalAction(currentSession, mergeAction);
      if (failure.value) {
        return false;
      }
      if (!await advanceCurrentStepIfReady()) {
        stopWithFailure({
          actionId: "merge_pr",
          actionLabel: "Merge",
          error: "The pull request merged, but Autopilot could not continue to main checkout sync.",
          exitCode: null,
          ok: false,
          output: ""
        });
        return false;
      }
      await runUntilStopPoint();
      return !failure.value;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function skipMerge() {
    if (!autopilotEnabled.value || currentStep.value !== MERGE_PR_STEP_ID || running.value) {
      return false;
    }
    stopRequested = false;
    clearFailure();
    active.value = true;
    activeStage.value = "Skip merge";
    try {
      if (!await advanceCurrentStepIfReady()) {
        stopWithFailure({
          actionId: "",
          actionLabel: "Skip merge",
          error: "Autopilot could not skip the merge because the workflow cannot continue from Merge PR.",
          exitCode: null,
          ok: false,
          output: ""
        });
        return false;
      }
      if (currentStep.value === MAIN_CHECKOUT_SYNCED_STEP_ID) {
        if (!await advanceCurrentStepIfReady()) {
          stopWithFailure({
            actionId: "",
            actionLabel: "Skip merge",
            error: "Autopilot skipped the merge, but could not move to Congratulations.",
            exitCode: null,
            ok: false,
            output: ""
          });
          return false;
        }
      }
      return currentStep.value === FINISHED_STEP_ID;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function archiveSession() {
    if (!autopilotEnabled.value || currentStep.value !== FINISHED_STEP_ID || running.value) {
      return false;
    }
    const archiveAction = actionById(readActions(actions), FINISH_SESSION_ACTION_ID);
    if (!archiveAction) {
      stopWithFailure(missingActionFailure({
        actionId: FINISH_SESSION_ACTION_ID,
        label: "Archive"
      }));
      return false;
    }
    if (archiveAction.enabled !== true) {
      stopWithFailure(disabledActionFailure(archiveAction, {
        actionId: FINISH_SESSION_ACTION_ID,
        label: "Archive"
      }));
      return false;
    }

    stopRequested = false;
    clearFailure();
    active.value = true;
    activeStage.value = "Archive";
    try {
      await actions.runAction?.(archiveAction);
      await refreshSessionData();
      await nextTick();
      return true;
    } catch (error) {
      stopWithFailure({
        actionId: archiveAction.id,
        actionLabel: archiveAction.label || "Archive",
        error: String(error?.message || error || "Could not archive the session."),
        exitCode: null,
        ok: false,
        output: ""
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function runUntilStopPoint() {
    if (autopilotPromise) {
      return autopilotPromise;
    }

    autopilotPromise = executeAutopilot();
    try {
      return await autopilotPromise;
    } finally {
      autopilotPromise = null;
    }
  }

  async function executeAutopilot() {
    active.value = true;
    try {
      for (let operationCount = 0; operationCount < MAX_AUTOPILOT_OPERATIONS; operationCount += 1) {
        const currentSession = readSession(session);
        if (!autopilotEnabled.value) {
          return;
        }
        if (stopRequested) {
          return;
        }
        if (!currentSession?.sessionId) {
          return;
        }

        if (currentStepIsStopPoint(currentSession.currentStep)) {
          return;
        }

        const promptRunResume = await resumePromptRunIfNeeded(currentSession);
        if (promptRunResume === PROMPT_WAIT_RESULT.QUESTIONS) {
          return;
        }
        if (failure.value) {
          return;
        }
        if (promptRunResume === PROMPT_WAIT_RESULT.COMPLETED) {
          continue;
        }
        if (promptRunForSession(currentSession)) {
          return;
        }
        if (codexIsActiveForCurrentStep()) {
          return;
        }

        if (currentSession.currentStep === DEEP_UI_CHECK_STEP_ID) {
          if (deepUiCheckDecision.value === "skip") {
            deepUiCheckDecision.value = "";
            if (!await skipCurrentDeepUiCheckStep()) {
              return;
            }
            continue;
          }
          if (deepUiCheckDecision.value !== "run") {
            return;
          }
        } else if (currentStepNeedsUserDecision(currentSession.currentStep)) {
          return;
        }

        const stage = stageForSession(currentSession);
        if (!stage && await advanceCurrentStepIfReady()) {
          continue;
        }
        if (!stage) {
          stopWithFailure(blockedStepFailure(currentSession));
          return;
        }

        await runStageAction(currentSession, stage);
        if (workflowQuestionActive.value) {
          return;
        }
        if (currentSession.currentStep === DEEP_UI_CHECK_STEP_ID) {
          deepUiCheckDecision.value = "";
        }
        if (failure.value) {
          return;
        }
      }

      stopWithFailure({
        actionId: "",
        actionLabel: "Autopilot",
        error: "Autopilot stopped because the session did not make progress.",
        exitCode: null,
        ok: false,
        output: ""
      });
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function skipCurrentDeepUiCheckStep() {
    activeStage.value = "Skip deep UI check";
    if (!await advanceCurrentStepIfReady()) {
      stopWithFailure(skipDeepUiCheckFailure());
      return false;
    }
    return true;
  }

  async function resumePromptRunIfNeeded(currentSession = {}) {
    const promptRun = activePromptRunForSession(currentSession);
    if (!promptRunMatchesSession(promptRun, currentSession)) {
      return PROMPT_WAIT_RESULT.INCOMPLETE;
    }

    activePromptRun.value = promptRun;
    activeStage.value = String(actionById(readActions(actions), promptRun.actionId)?.label || stepLabel(currentSession));
    const autopilotFiles = readPromptAutopilotFiles(promptRun);
    if (promptQuestionsMatchRun(autopilotFiles.questions, promptRun)) {
      startWorkflowQuestionExchange(promptRun, autopilotFiles.questions);
      return PROMPT_WAIT_RESULT.QUESTIONS;
    }
    const waitResult = await waitForPromptCompletion(promptRun);
    if (waitResult === PROMPT_WAIT_RESULT.QUESTIONS) {
      return PROMPT_WAIT_RESULT.QUESTIONS;
    }
    if (waitResult !== PROMPT_WAIT_RESULT.COMPLETED) {
      return PROMPT_WAIT_RESULT.INCOMPLETE;
    }

    clearPromptRunState();
    clearReplanFeedback({
      id: promptRun.actionId
    });
    await advanceCurrentStepIfReady();
    return PROMPT_WAIT_RESULT.COMPLETED;
  }

  async function advanceCurrentStepIfReady() {
    const next = readNext(actions);
    if (!nextIsReady(next)) {
      return false;
    }

    activeStage.value = String(sessionStepLabel(readSession(session), next.stepId) || next.label || "Next");
    await actions.goNext?.();
    await refreshSessionData();
    await nextTick();
    return true;
  }

  async function runStageAction(currentSession = {}, stage = {}) {
    const action = actionById(readActions(actions), stage.actionId);
    if (!action) {
      stopWithFailure(missingActionFailure(stage));
      return;
    }
    if (action.enabled !== true) {
      stopWithFailure(disabledActionFailure(action, stage));
      return;
    }

    activeStage.value = stage.label;
    if (action.type === "command") {
      await runTerminalAction(currentSession, action);
      return;
    }
    if (action.type === "prompt") {
      await runPromptAction(action, stage);
      return;
    }

    try {
      await actions.runAction?.(autopilotActionForStage(action, stage));
      await refreshSessionData();
      await nextTick();
    } catch (error) {
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        exitCode: null,
        ok: false,
        output: "",
        source: action.type === "prompt" ? "codex" : ""
      });
    }
  }

  function autopilotActionForStage(action = {}, stage = {}) {
    if (stage.advanceOnSuccess !== true || action.advanceOnSuccess === true) {
      return action;
    }
    return {
      ...action,
      advanceOnSuccess: true
    };
  }

  async function runPromptAction(action = {}, stage = {}, {
    advanceAfterCompletion = true
  } = {}) {
    const startingStep = currentStep.value;
    try {
      await actions.runAction?.(action, {
        input: promptActionInput(action)
      });
      await refreshSessionData();
      await nextTick();
      const promptRun = activePromptRunForSession(readSession(session));
      if (!promptRunMatchesSession(promptRun, readSession(session))) {
        if (currentStep.value !== startingStep) {
          return;
        }
        stopWithFailure(promptNotCompletedFailure(stage));
        return;
      }
      activePromptRun.value = {
        ...promptRun,
        advanceAfterCompletion
      };
      const waitResult = await waitForPromptCompletion(activePromptRun.value);
      if (waitResult === PROMPT_WAIT_RESULT.QUESTIONS) {
        return;
      }
      if (waitResult !== PROMPT_WAIT_RESULT.COMPLETED) {
        return;
      }
      clearPromptRunState();
      clearReplanFeedback(action);
      if (advanceAfterCompletion) {
        await advanceCurrentStepIfReady();
      }
    } catch (error) {
      clearPromptRunState();
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        exitCode: null,
        ok: false,
        output: "",
        source: "codex"
      });
    }
  }

  async function continueAfterWorkflowQuestionAnswers(promptRun = {}) {
    try {
      const waitResult = await waitForPromptCompletion(promptRun);
      if (waitResult === PROMPT_WAIT_RESULT.QUESTIONS) {
        return false;
      }
      if (waitResult !== PROMPT_WAIT_RESULT.COMPLETED) {
        return false;
      }

      clearPromptRunState();
      clearReplanFeedback({
        id: promptRun.actionId
      });
      if (promptRun.advanceAfterCompletion !== false) {
        await advanceCurrentStepIfReady();
      }
      active.value = false;
      activeStage.value = "";
      await runUntilStopPoint();
      return !failure.value;
    } finally {
      if (!autopilotPromise) {
        active.value = false;
        activeStage.value = "";
      }
    }
  }

  function promptActionInput(action = {}) {
    if (action.id !== "make_plan" || !replanFeedback.value) {
      return {};
    }
    return {
      autopilotFeedback: replanFeedback.value,
      autopilotReason: "changes_rejected"
    };
  }

  function clearReplanFeedback(action = {}) {
    if (action.id === "make_plan") {
      replanFeedback.value = "";
    }
  }

  async function waitForPromptCompletion(promptRun = {}) {
    while (promptRunMatchesSession(activePromptRunForSession(readSession(session)), readSession(session))) {
      if (!autopilotEnabled.value) {
        return PROMPT_WAIT_RESULT.INCOMPLETE;
      }
      if (stopRequested) {
        return PROMPT_WAIT_RESULT.INCOMPLETE;
      }
      const promptError = readPromptInjectionError(codexTerminal);
      if (promptError) {
        stopWithPromptError(promptRun, promptError);
        return PROMPT_WAIT_RESULT.INCOMPLETE;
      }

      const currentPromptRun = activePromptRunForSession(readSession(session)) || promptRun;
      const autopilotFiles = readPromptAutopilotFiles(currentPromptRun);
      if (promptDoneMatchesRun(autopilotFiles.promptDone, currentPromptRun)) {
        return PROMPT_WAIT_RESULT.COMPLETED;
      }
      if (promptQuestionsMatchRun(autopilotFiles.questions, currentPromptRun)) {
        startWorkflowQuestionExchange(currentPromptRun, autopilotFiles.questions);
        return PROMPT_WAIT_RESULT.QUESTIONS;
      }
      if (!readCodexBusy(codexTerminal) && codexFinishedWithoutFile(currentPromptRun)) {
        return PROMPT_WAIT_RESULT.INCOMPLETE;
      }
      await waitForPromptSignal(currentPromptRun);
    }
    return PROMPT_WAIT_RESULT.INCOMPLETE;
  }

  function stopWithPromptError(promptRun = {}, promptError = "") {
    stopWithFailure({
      actionId: promptRun.actionId,
      actionLabel: activeStage.value,
      error: promptError,
      exitCode: null,
      ok: false,
      output: "",
      source: "codex"
    });
  }

  function startWorkflowQuestionExchange(promptRun = {}, questionFile = {}) {
    const questions = Array.isArray(questionFile.questions) ? questionFile.questions : [];
    if (questions.length <= 0) {
      return false;
    }

    return codexQuestions.start({
      contextLabel: actionLabelForId(promptRun.actionId),
      onCancel: () => {
        void clearAutopilotArtifacts(promptRun.sessionId).catch(() => null);
        clearPromptRunState();
        stopWithFailure({
          actionId: promptRun.actionId,
          actionLabel: actionLabelForId(promptRun.actionId),
          error: "Autopilot needs answers before it can continue this Codex step. Use Continue after answering in Inspect, or Retry to run the step again.",
          exitCode: null,
          ok: false,
          output: "",
          source: "codex"
        });
      },
      onSubmitted: async ({ prepared = {} } = {}) => {
        if (prepared.promptRun) {
          await continueAfterWorkflowQuestionAnswers(prepared.promptRun);
        }
      },
      ownerId: promptRunQuestionOwnerId(promptRun),
      prepareSubmit: async ({ questions: answeredQuestions = [] } = {}) => {
        const nextPromptRun = {
          ...promptRun
        };
        await clearAutopilotArtifacts(promptRun.sessionId);
        activePromptRun.value = nextPromptRun;
        active.value = true;
        activeStage.value = actionLabelForId(nextPromptRun.actionId);
        return {
          injectionContext: {
            requestId: nextPromptRun.requestId,
            sessionId: nextPromptRun.sessionId
          },
          promptRun: nextPromptRun,
          prompt: autopilotQuestionAnswersInstruction({
            actionId: nextPromptRun.actionId,
            actionLabel: activeStage.value,
            artifactsRoot: readSession(session)?.artifactsRoot || "",
            completionToken: nextPromptRun.completionToken,
            questions: answeredQuestions,
            requestId: nextPromptRun.requestId,
            stepId: nextPromptRun.stepId
          })
        };
      },
      questions
    });
  }

  function readPromptAutopilotFiles(promptRun = {}) {
    const streamedArtifacts = currentAutopilotArtifacts.value;
    if (streamedArtifacts?.sessionId === promptRun.sessionId) {
      if (streamedArtifacts.ok === false) {
        stopWithPromptError(promptRun, streamedArtifacts.error || "Autopilot files could not be read.");
        return {};
      }
      return streamedArtifacts;
    }
    return {};
  }

  function waitForPromptSignal(promptRun = {}) {
    return new Promise((resolve) => {
      const cleanupCallbacks = [];
      let timeoutId = null;
      const finish = () => {
        for (const cleanup of cleanupCallbacks) {
          cleanup();
        }
        resolve();
      };

      cleanupCallbacks.push(watch(currentAutopilotArtifacts, finish, {
        flush: "post"
      }));
      cleanupCallbacks.push(watch(codexBusy, finish, {
        flush: "post"
      }));
      cleanupCallbacks.push(watch(() => readPromptInjectionError(codexTerminal), finish, {
        flush: "post"
      }));
      cleanupCallbacks.push(() => clearTimeout(timeoutId));
      timeoutId = setTimeout(finish, promptIdleWaitMs(promptRun));
    });
  }

  function promptIdleWaitMs(promptRun = {}) {
    if (readCodexBusy(codexTerminal)) {
      return PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS;
    }
    const createdAt = Date.parse(promptRun.createdAt || "");
    if (!Number.isFinite(createdAt)) {
      return PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS;
    }
    return Math.max(0, PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS - (Date.now() - createdAt));
  }

  function codexFinishedWithoutFile(promptRun = {}) {
    if (readCodexBusy(codexTerminal)) {
      return false;
    }
    const createdAt = Date.parse(promptRun.createdAt || "");
    return Number.isFinite(createdAt) &&
      Date.now() - createdAt >= PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS;
  }

  function clearPromptRunState() {
    codexQuestions.clearForOwner(promptRunQuestionOwnerId(activePromptRun.value || currentPromptRun.value || {}));
    activePromptRun.value = null;
  }

  function activePromptRunForSession(currentSession = {}) {
    const serverPromptRun = promptRunForSession(currentSession);
    if (!serverPromptRun) {
      return null;
    }
    if (!promptRunsAreSame(activePromptRun.value, serverPromptRun)) {
      return serverPromptRun;
    }
    return {
      ...serverPromptRun,
      advanceAfterCompletion: activePromptRun.value.advanceAfterCompletion
    };
  }

  function promptRunsAreSame(left = {}, right = {}) {
    return Boolean(left && right) &&
      left.sessionId === right.sessionId &&
      left.stepId === right.stepId &&
      left.actionId === right.actionId &&
      left.requestId === right.requestId &&
      left.completionToken === right.completionToken;
  }

  function currentPromptStage(currentSession = {}) {
    if (!currentSession?.sessionId || currentStepIsStopPoint(currentSession.currentStep)) {
      return null;
    }
    const stage = stageForSession(currentSession);
    if (!stage?.actionId) {
      return null;
    }
    const action = actionById(readActions(actions), stage.actionId);
    if (action?.type !== "prompt") {
      return null;
    }
    return {
      actionId: stage.actionId,
      label: stage.label || action.label || stepLabel(currentSession),
      stepId: currentSession.currentStep
    };
  }

  function codexIsActiveForCurrentStep() {
    const currentSession = readSession(session);
    if (!autopilotEnabled.value || !codexBusy.value || !currentSession?.sessionId) {
      return false;
    }
    return promptRunMatchesSession(activePromptRunForSession(currentSession), currentSession) ||
      Boolean(currentPromptStage(currentSession));
  }

  async function captureQuestionsFromAutopilotFiles() {
    const currentSession = readSession(session);
    const promptRun = activePromptRunForSession(currentSession);
    if (workflowQuestionActive.value || !promptRun) {
      return false;
    }

    const autopilotFiles = readPromptAutopilotFiles(promptRun);
    if (!promptQuestionsMatchRun(autopilotFiles.questions, promptRun)) {
      return false;
    }

    startWorkflowQuestionExchange(promptRun, autopilotFiles.questions);
    stopRequested = false;
    clearFailure();
    return true;
  }

  async function clearActiveWorkflowQuestionsWhenCodexStarts() {
    const currentSession = readSession(session);
    const promptRun = activePromptRunForSession(currentSession);
    if (!promptRunMatchesSession(promptRun, currentSession)) {
      return false;
    }
    const autopilotFiles = readPromptAutopilotFiles(promptRun);
    if (!promptQuestionsMatchRun(autopilotFiles.questions, promptRun)) {
      return false;
    }

    codexQuestions.clearForOwner(promptRunQuestionOwnerId(promptRun));
    await clearAutopilotArtifacts(promptRun.sessionId);
    return true;
  }

  async function reattachToActiveCodexStep() {
    const currentSession = readSession(session);
    if (!autopilotEnabled.value || active.value || !codexIsActiveForCurrentStep()) {
      return;
    }
    stopRequested = false;
    clearFailure();
    if (await captureQuestionsFromAutopilotFiles()) {
      return;
    }
    if (!promptRunMatchesSession(activePromptRunForSession(currentSession), currentSession)) {
      return;
    }
    await runUntilStopPoint();
  }

  async function runTerminalAction(currentSession = {}, action = {}) {
    lastCommandResult.value = null;
    const result = await commandRunner.runCommandAction({
      action,
      input: {},
      sessionId: currentSession.sessionId
    });
    lastCommandResult.value = result;
    await refreshSessionData();
    await nextTick();
    if (result.ok !== true) {
      stopWithFailure(result);
    }
  }

  function stopWithFailure(result = {}) {
    failure.value = {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      commandPreview: String(result.commandPreview || ""),
      error: String(result.error || "Autopilot action failed."),
      exitCode: result.exitCode ?? null,
      output: String(result.output || ""),
      source: String(result.source || "")
    };
  }

  async function syncFromAutopilotArtifacts() {
    if (!autopilotEnabled.value) {
      return false;
    }
    return captureQuestionsFromAutopilotFiles();
  }

  watch(codexBusy, (busy, wasBusy) => {
    if (autopilotEnabled.value && busy) {
      if (!wasBusy) {
        void clearActiveWorkflowQuestionsWhenCodexStarts();
      }
      void reattachToActiveCodexStep();
    }
  }, {
    flush: "post"
  });

  watch(autopilotEnabled, (isEnabled) => {
    if (isEnabled) {
      void captureQuestionsFromAutopilotFiles();
    }
  }, {
    flush: "post"
  });

  watch(() => `${readSession(session)?.sessionId || ""}:${readSession(session)?.currentStep || ""}`, () => {
    if (autopilotEnabled.value) {
      void captureQuestionsFromAutopilotFiles();
    }
  }, {
    flush: "post"
  });

  watch(currentAutopilotArtifacts, () => {
    if (autopilotEnabled.value) {
      void captureQuestionsFromAutopilotFiles();
    }
  }, {
    flush: "post"
  });

  return {
    acceptChanges,
    archiveSession,
    cancelMergeFailure,
    canAcceptReview,
    canArchiveSession,
    canStart,
    canResume,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    continuePromptRun,
    failure,
    mergeAndSyncMainCheckout,
    promptRunNeedsContinuation,
    readyForFinished,
    readyForDeepUiCheck,
    readyForIssue,
    readyForMerge,
    readyForReview,
    rejectChanges,
    retry,
    resume,
    runDeepUiCheck,
    running,
    skipDeepUiCheck,
    skipMerge,
    start,
    syncFromAutopilotArtifacts,
    stop,
    stopCommandAction,
    statusText,
    waitingForCodex
  };
}

export {
  DEEP_UI_CHECK_STEP_ID,
  FINISHED_STEP_ID,
  ISSUE_STEP_ID,
  MERGE_PR_STEP_ID,
  REVIEW_CHANGES_STEP_ID,
  useAiStudioAutopilotController
};
