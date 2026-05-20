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
const REVIEW_CHANGES_STEP_ID = "changes_accepted";
const SESSION_CREATED_STEP_ID = "session_created";
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
  plan_executed: {
    actionId: "execute_plan",
    label: "Execute plan"
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
  return stepId === ISSUE_STEP_ID || stepId === REVIEW_CHANGES_STEP_ID;
}

function currentStepNeedsUserDecision(stepId = "") {
  return stepId === DEEP_UI_CHECK_STEP_ID;
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
    output: ""
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
  const latestMarkerText = latestMarker
    ? ` The last completion Autopilot saw was for ${actionLabelForId(latestMarker.actionId)}, not ${expectedLabel}.`
    : "";
  return `The ${expectedLabel} step did not complete properly, so Autopilot could not safely continue.${latestMarkerText} Retry will run it again, or switch to Inspect to continue manually.`;
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
  const readyForReview = computed(() => currentStep.value === REVIEW_CHANGES_STEP_ID);
  const waitingForCodex = computed(() => Boolean(activePrompt.value));
  const canStart = computed(() => Boolean(
    readSession(session)?.sessionId &&
    !running.value &&
    !currentStepIsStopPoint(currentStep.value)
  ));
  const canResume = computed(() => {
    const currentSession = readSession(session);
    return Boolean(
      currentSession?.sessionId &&
      currentSession.currentStep &&
      currentSession.currentStep !== SESSION_CREATED_STEP_ID &&
      !currentStepIsStopPoint(currentSession.currentStep) &&
      !running.value &&
      !failure.value
    );
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
    return "Let's get started";
  });

  async function start() {
    if (!canStart.value) {
      return;
    }
    stopRequested = false;
    failure.value = null;
    await runUntilStopPoint();
  }

  async function retry() {
    if (running.value) {
      return;
    }
    stopRequested = false;
    failure.value = null;
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
    if (currentSession?.sessionId) {
      clearPendingPrompt(currentSession.sessionId);
    } else {
      activePrompt.value = null;
    }
    activeStage.value = "";
    stopWithFailure(autopilotStoppedFailure());
  }

  async function runDeepUiCheck() {
    if (currentStep.value !== DEEP_UI_CHECK_STEP_ID || running.value) {
      return;
    }
    stopRequested = false;
    failure.value = null;
    deepUiCheckDecision.value = "run";
    await runUntilStopPoint();
  }

  async function skipDeepUiCheck() {
    if (currentStep.value !== DEEP_UI_CHECK_STEP_ID || running.value) {
      return;
    }
    stopRequested = false;
    failure.value = null;
    deepUiCheckDecision.value = "skip";
    await runUntilStopPoint();
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
        output: ""
      });
    }
  }

  async function runPromptAction(currentSession = {}, action = {}, stage = {}) {
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
      await advanceCurrentStepIfReady();
    } catch (error) {
      clearPendingPrompt(pending.sessionId);
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        exitCode: null,
        ok: false,
        output: ""
      });
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
      output: ""
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
      output
    });
  }

  function codexOutputAfterCursor(pending = {}) {
    const output = readCodexOutput(codexTerminal);
    const cursor = Number(pending.outputCursor || 0);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) {
      return output;
    }
    if (cursor >= output.length) {
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
      output: String(result.output || "")
    };
  }

  return {
    canStart,
    canResume,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    failure,
    readyForDeepUiCheck,
    readyForIssue,
    readyForReview,
    retry,
    resume,
    runDeepUiCheck,
    running,
    skipDeepUiCheck,
    start,
    stop,
    statusText,
    waitingForCodex
  };
}

export {
  DEEP_UI_CHECK_STEP_ID,
  ISSUE_STEP_ID,
  REVIEW_CHANGES_STEP_ID,
  useAiStudioAutopilotController
};
