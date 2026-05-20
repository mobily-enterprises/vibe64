import { computed, nextTick, ref } from "vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  latestStepDoneMarker,
  stepDoneMarkerInstruction
} from "@/lib/aiStudioAutopilotStepMarkers.js";
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
const REPLAN_STEP_ID = "plan_made";
const MAX_AUTOPILOT_OPERATIONS = 40;
const PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS = 3000;
const PROMPT_MARKER_POLL_MS = 250;
const PROMPT_PENDING_STORAGE_KEY_PREFIX = "ai-studio:autopilot:prompt-step:";

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

function readCodexOutput(codexTerminal = {}) {
  return String(readRefOrGetterValue(codexTerminal.output) || "");
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

function currentStepCanRunAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  return stepId === SESSION_CREATED_STEP_ID ||
    currentStepNeedsUserDecision(stepId) ||
    Boolean(stageForSession(session));
}

function browserLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function promptPendingStorageKey(sessionId = "") {
  return `${PROMPT_PENDING_STORAGE_KEY_PREFIX}${String(sessionId || "").trim()}`;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStoredPendingPrompt(sessionId = "") {
  const storage = browserLocalStorage();
  if (!storage || !sessionId) {
    return null;
  }
  try {
    const value = JSON.parse(storage.getItem(promptPendingStorageKey(sessionId)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredPendingPrompt(pending = {}) {
  const sessionId = String(pending.sessionId || "").trim();
  const storage = browserLocalStorage();
  if (!storage || !sessionId) {
    return;
  }
  storage.setItem(promptPendingStorageKey(sessionId), JSON.stringify({
    actionId: String(pending.actionId || ""),
    outputCursor: Number.isSafeInteger(pending.outputCursor) ? pending.outputCursor : 0,
    requestId: String(pending.requestId || ""),
    sessionId,
    startedAt: Number.isSafeInteger(pending.startedAt) ? pending.startedAt : 0,
    stepId: String(pending.stepId || "")
  }));
}

function clearStoredPendingPrompt(sessionId = "") {
  browserLocalStorage()?.removeItem(promptPendingStorageKey(sessionId));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function missingPromptMarkerError(pending = {}, activeLabel = "", output = "") {
  const expectedLabel = activeLabel || actionLabelForId(pending.actionId);
  const latestMarker = latestStepDoneMarker(output);
  const latestMarkerText = promptMarkerMismatchText(pending, latestMarker, expectedLabel);
  return `The ${expectedLabel} step did not complete properly, so Autopilot could not safely continue.${latestMarkerText} Retry will run it again, or switch to Inspect to continue manually.`;
}

function promptMarkerMismatchText(pending = {}, latestMarker = null, expectedLabel = "") {
  if (!latestMarker) {
    return "";
  }
  if (
    latestMarker.actionId === pending.actionId &&
    latestMarker.stepId === pending.stepId &&
    latestMarker.requestId !== pending.requestId
  ) {
    return " Codex printed a completion marker for this same step, but it belonged to a different Autopilot request.";
  }
  if (
    latestMarker.actionId === pending.actionId &&
    latestMarker.stepId !== pending.stepId
  ) {
    return ` The last completion Autopilot saw was for ${expectedLabel}, but on a different workflow step.`;
  }
  return ` The last completion Autopilot saw was for ${actionLabelForId(latestMarker.actionId)}, not ${expectedLabel}.`;
}

function pendingPromptMatchesSession(pending = {}, session = {}) {
  return pending?.sessionId === session?.sessionId &&
    pending?.stepId === session?.currentStep &&
    Boolean(pending.requestId && pending.actionId);
}

function useAiStudioAutopilotController({
  actions = {},
  codexTerminal = {},
  commandRunner = useAiStudioHeadlessCommandRunner(),
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const activePrompt = ref(null);
  const deepUiCheckDecision = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);
  const replanFeedback = ref("");

  let autopilotPromise = null;
  let stopRequested = false;

  const currentStep = computed(() => readSession(session)?.currentStep || "");
  const commandOutput = computed(() => String(readRefOrGetterValue(commandRunner.output) || ""));
  const commandPreview = computed(() => String(readRefOrGetterValue(commandRunner.commandPreview) || ""));
  const commandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const commandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const running = computed(() => active.value || commandRunning.value);
  const readyForIssue = computed(() => currentStep.value === ISSUE_STEP_ID);
  const readyForDeepUiCheck = computed(() => {
    return currentStep.value === DEEP_UI_CHECK_STEP_ID && !running.value && !failure.value;
  });
  const readyForFinished = computed(() => currentStep.value === FINISHED_STEP_ID);
  const readyForMerge = computed(() => currentStep.value === MERGE_PR_STEP_ID);
  const readyForReview = computed(() => currentStep.value === REVIEW_CHANGES_STEP_ID);
  const waitingForCodex = computed(() => Boolean(activePrompt.value));
  const canStart = computed(() => Boolean(
    readSession(session)?.sessionId &&
    !running.value &&
    !currentStepIsStopPoint(currentStep.value) &&
    currentStepCanRunAutopilot(readSession(session))
  ));
  const canResume = computed(() => {
    const currentSession = readSession(session);
    return Boolean(
      currentSession?.sessionId &&
      currentSession.currentStep &&
      currentSession.currentStep !== SESSION_CREATED_STEP_ID &&
      !currentStepIsStopPoint(currentSession.currentStep) &&
      currentStepCanRunAutopilot(currentSession) &&
      !running.value &&
      !failure.value
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
    if (failure.value) {
      return "Attention required";
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
      currentSession.currentStep !== SESSION_CREATED_STEP_ID &&
      !currentStepCanRunAutopilot(currentSession)
    ) {
      return stepLabel(currentSession);
    }
    return "Let's get started";
  });

  function clearFailure() {
    failure.value = null;
    lastCommandResult.value = null;
  }

  async function acceptChanges() {
    if (!canAcceptReview.value) {
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
    if (!canStart.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function retry() {
    if (running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function resume() {
    if (!canResume.value) {
      return;
    }
    stopRequested = false;
    await runUntilStopPoint();
  }

  function stop() {
    const currentSession = readSession(session);
    stopRequested = true;
    if (commandRunning.value && typeof commandRunner.stopCommandAction === "function") {
      commandRunner.stopCommandAction();
      return;
    }
    if (currentSession?.sessionId) {
      clearPendingPrompt(currentSession.sessionId);
    } else {
      activePrompt.value = null;
    }
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
    if (currentStep.value !== DEEP_UI_CHECK_STEP_ID || running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "run";
    await runUntilStopPoint();
  }

  async function skipDeepUiCheck() {
    if (currentStep.value !== DEEP_UI_CHECK_STEP_ID || running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "skip";
    await runUntilStopPoint();
  }

  async function rejectChanges(feedback = "") {
    const normalizedFeedback = String(feedback || "").trim();
    if (currentStep.value !== REVIEW_CHANGES_STEP_ID || running.value) {
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
    if (currentStep.value !== MERGE_PR_STEP_ID || running.value) {
      return false;
    }
    stopRequested = false;
    clearFailure();
    active.value = true;
    try {
      const mergeSession = readSession(session);
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
      await runPromptAction(mergeSession, prepareAction, {
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
    if (currentStep.value !== MERGE_PR_STEP_ID || running.value) {
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
    if (currentStep.value !== FINISHED_STEP_ID || running.value) {
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
        if (stopRequested) {
          return;
        }
        if (!currentSession?.sessionId || currentStepIsStopPoint(currentSession.currentStep)) {
          return;
        }

        if (await resumePendingPromptIfNeeded(currentSession)) {
          continue;
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

  async function resumePendingPromptIfNeeded(currentSession = {}) {
    const pending = activePrompt.value || readStoredPendingPrompt(currentSession.sessionId);
    if (!pendingPromptMatchesSession(pending, currentSession)) {
      return false;
    }

    activePrompt.value = pending;
    activeStage.value = String(actionById(readActions(actions), pending.actionId)?.label || stepLabel(currentSession));
    if (!await waitForPromptCompletion(pending)) {
      clearPendingPrompt(pending.sessionId);
      if (stopRequested) {
        return;
      }
      if (!failure.value) {
        stopWithFailure(promptNotCompletedFailure({
          actionId: pending.actionId,
          label: activeStage.value
        }));
      }
      return true;
    }

    clearPendingPrompt(pending.sessionId);
    await advanceCurrentStepIfReady();
    return true;
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
      await runPromptAction(currentSession, action, stage);
      return;
    }

    try {
      await actions.runAction?.(action);
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

  async function runPromptAction(currentSession = {}, action = {}, stage = {}, {
    advanceAfterCompletion = true
  } = {}) {
    const pending = {
      actionId: action.id,
      outputCursor: readCodexOutput(codexTerminal).length,
      requestId: createRequestId(),
      sessionId: currentSession.sessionId,
      startedAt: Date.now(),
      stepId: currentSession.currentStep
    };
    activePrompt.value = pending;
    writeStoredPendingPrompt(pending);
    try {
      await actions.runAction?.(action, {
        input: promptActionInput(action),
        promptSuffix: stepDoneMarkerInstruction(pending)
      });
      await refreshSessionData();
      await nextTick();
      if (!await waitForPromptCompletion(pending)) {
        clearPendingPrompt(pending.sessionId);
        if (stopRequested) {
          return;
        }
        if (!failure.value) {
          stopWithFailure(promptNotCompletedFailure(stage));
        }
        return;
      }
      clearPendingPrompt(pending.sessionId);
      clearReplanFeedback(action);
      if (advanceAfterCompletion) {
        await advanceCurrentStepIfReady();
      }
    } catch (error) {
      clearPendingPrompt(pending.sessionId);
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

  async function waitForPromptCompletion(pending = {}) {
    while (pendingPromptMatchesSession(pending, readSession(session))) {
      if (stopRequested) {
        return false;
      }
      const promptError = readPromptInjectionError(codexTerminal);
      if (promptError) {
        stopWithPromptError(pending, promptError);
        return false;
      }

      const output = codexOutputAfterCursor(pending);
      if (latestStepDoneMarker(output, pending)) {
        return await waitForCodexIdle(pending);
      }
      if (codexFinishedWithoutMarker(pending, output)) {
        stopWithMissingPromptMarker(pending, output);
        return false;
      }
      await delay(PROMPT_MARKER_POLL_MS);
    }
    return false;
  }

  async function waitForCodexIdle(pending = {}) {
    while (pendingPromptMatchesSession(pending, readSession(session)) && readCodexBusy(codexTerminal)) {
      if (stopRequested) {
        return false;
      }
      const promptError = readPromptInjectionError(codexTerminal);
      if (promptError) {
        stopWithPromptError(pending, promptError);
        return false;
      }
      await delay(PROMPT_MARKER_POLL_MS);
    }
    return pendingPromptMatchesSession(pending, readSession(session));
  }

  function stopWithPromptError(pending = {}, promptError = "") {
    stopWithFailure({
      actionId: pending.actionId,
      actionLabel: activeStage.value,
      error: promptError,
      exitCode: null,
      ok: false,
      output: "",
      source: "codex"
    });
  }

  function codexFinishedWithoutMarker(pending = {}, output = "") {
    if (readCodexBusy(codexTerminal)) {
      return false;
    }
    if (String(output || "").trim()) {
      return true;
    }
    const startedAt = Number(pending.startedAt || 0);
    return Number.isSafeInteger(startedAt) &&
      startedAt > 0 &&
      Date.now() - startedAt >= PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS;
  }

  function stopWithMissingPromptMarker(pending = {}, output = "") {
    stopWithFailure({
      actionId: pending.actionId,
      actionLabel: activeStage.value,
      error: missingPromptMarkerError(pending, activeStage.value, output),
      exitCode: null,
      ok: false,
      output,
      source: "codex"
    });
  }

  function codexOutputAfterCursor(pending = {}) {
    const output = readCodexOutput(codexTerminal);
    const cursor = Number(pending.outputCursor || 0);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) {
      return output;
    }
    if (cursor === output.length) {
      return "";
    }
    if (cursor > output.length) {
      return output;
    }
    return output.slice(cursor);
  }

  function clearPendingPrompt(sessionId = "") {
    activePrompt.value = null;
    clearStoredPendingPrompt(sessionId);
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
    failure,
    mergeAndSyncMainCheckout,
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
