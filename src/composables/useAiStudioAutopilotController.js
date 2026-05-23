import { computed, nextTick, ref, watch } from "vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const ISSUE_STEP_ID = "issue_file_created";
const AGENT_CONVERSATION_ACTION_ID = "agent_conversation";
const DEEP_UI_CHECK_STEP_ID = "deep_ui_check_run";
const FINISHED_STEP_ID = "session_finished";
const FINAL_REVIEW_CONVERSATION_ACTION_ID = "final_review_conversation";
const HUMAN_REVIEW_CONVERSATION_ACTION_ID = "human_review_conversation";
const IMPLEMENTATION_REVIEW_STEP_ID = "implementation_reviewed";
const LOCAL_FINISHED_STEP_ID = "local_session_finished";
const FINISH_SESSION_ACTION_ID = "finish_session";
const MAIN_CHECKOUT_SYNCED_STEP_ID = "main_checkout_synced";
const MERGE_PR_STEP_ID = "pr_merged";
const PROJECT_VALIDATED_STEP_ID = "project_validated";
const REVIEW_CHANGES_STEP_ID = "changes_accepted";
const REVIEW_RUN_STEP_ID = "review_run";
const SESSION_CREATED_STEP_ID = "session_created";
const WORK_SOURCE_SELECTED_STEP_ID = "work_source_selected";
const REPLAN_STEP_ID = "plan_made";
const MAX_AUTOPILOT_OPERATIONS = 40;
const CODEX_TURN_WITHOUT_ARTIFACT_GRACE_MS = 3000;
const CODEX_TURN_RESULT = Object.freeze({
  BLOCKED: "blocked",
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  WAITING_FOR_INPUT: "waiting_for_input"
});
const CONVERSATION_REQUEST_ACTION_IDS = new Set([
  AGENT_CONVERSATION_ACTION_ID,
  FINAL_REVIEW_CONVERSATION_ACTION_ID,
  HUMAN_REVIEW_CONVERSATION_ACTION_ID
]);

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

function readCodexWorking(codexTerminal = {}) {
  return readRefOrGetterValue(codexTerminal.working) === true;
}

function readCodexActive(codexTerminal = {}) {
  return readCodexBusy(codexTerminal) || readCodexWorking(codexTerminal);
}

function actionById(actions = [], actionId = "") {
  return actions.find((action) => action.id === actionId) || null;
}

function stepAutopilot(session = {}) {
  const autopilot = session?.currentStepDefinition?.autopilot;
  return autopilot && typeof autopilot === "object" && !Array.isArray(autopilot)
    ? autopilot
    : {};
}

function stepLabel(session = {}) {
  return String(session?.currentStepDefinition?.label || session?.currentStep || "Current step");
}

function sessionStepLabel(session = {}, stepId = "") {
  return (Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [])
    .find((step) => step.id === stepId)?.label || "";
}

function sessionHasStep(session = {}, stepId = "") {
  return (Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [])
    .some((step) => step.id === stepId);
}

function replanStepIdForSession(session = {}) {
  return sessionHasStep(session, "seed_plan_made") ? "seed_plan_made" : REPLAN_STEP_ID;
}

function finalReviewRecheckStepIdForSession(session = {}) {
  return sessionHasStep(session, REVIEW_RUN_STEP_ID) ? REVIEW_RUN_STEP_ID : PROJECT_VALIDATED_STEP_ID;
}

function nextIsReady(next = {}) {
  return next?.visible === true && next.enabled === true;
}

function currentStepIsStopPoint(session = {}) {
  return stepAutopilot(session).stop === true;
}

function currentStepNeedsUserDecision(session = {}) {
  return stepAutopilot(session).userDecision === true;
}

function currentStepIsStartBoundary(stepId = "") {
  return stepId === SESSION_CREATED_STEP_ID || stepId === WORK_SOURCE_SELECTED_STEP_ID;
}

function currentStepHasPendingPromptWork(session = {}) {
  return String(session?.stepMachine?.status || "") === "awaiting_agent_result";
}

function currentStepCanRunAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  return stepId === SESSION_CREATED_STEP_ID ||
    currentStepNeedsUserDecision(session) ||
    Boolean(stageForSession(session)) ||
    nextIsReady(session.next);
}

function currentStepCanStartAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  if (!currentStepIsStartBoundary(stepId)) {
    const completedSteps = Array.isArray(session?.completedSteps) ? session.completedSteps : [];
    return completedSteps.length <= 1 && currentStepCanRunAutopilot(session);
  }
  return currentStepCanRunAutopilot(session) || nextIsReady(session.next);
}

function stageForSession(session = {}) {
  const machineStatus = String(session?.stepMachine?.status || "");
  if (machineStatus === "done" || machineStatus === "need_input") {
    return null;
  }
  const stage = stepAutopilot(session).stage;
  if (stage && typeof stage === "object" && !Array.isArray(stage) && stage.actionId) {
    return {
      actionId: String(stage.actionId || ""),
      advanceOnSuccess: stage.advanceOnSuccess === true,
      label: String(stage.label || stage.actionId || "")
    };
  }
  return null;
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

function autopilotStoppedFailure() {
  return {
    actionId: "",
    actionLabel: "Autopilot",
    error: "Autopilot stopped. Use Inspect to continue manually.",
    exitCode: null,
    ok: false,
    output: ""
  };
}

function actionUsesConversationRequestInput(action = {}) {
  if (!action || typeof action !== "object") {
    return false;
  }
  return action.promptId === AGENT_CONVERSATION_ACTION_ID || CONVERSATION_REQUEST_ACTION_IDS.has(action.id);
}

function actionUsesStepMachineHelper(action = {}, session = {}) {
  return action?.type === "prompt" && Boolean(session?.stepMachine?.stepId);
}

function currentStepNeedsInput(session = {}) {
  return String(session?.stepMachine?.status || "") === "need_input";
}

function useAiStudioAutopilotController({
  actions = {},
  codexTerminal = {},
  commandRunner = useAiStudioHeadlessCommandRunner(),
  enabled = true,
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const conversationRequest = ref("");
  const deepUiCheckDecision = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);
  const replanFeedback = ref("");

  let autopilotPromise = null;
  let stopRequested = false;

  const autopilotEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const currentStep = computed(() => readSession(session)?.currentStep || "");
  const commandOutput = computed(() => String(readRefOrGetterValue(commandRunner.output) || ""));
  const commandPreview = computed(() => String(readRefOrGetterValue(commandRunner.commandPreview) || ""));
  const commandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const commandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const codexActive = computed(() => readCodexActive(codexTerminal));
  const codexPromptBusy = computed(() => readCodexBusy(codexTerminal));
  const codexBlocksAutopilot = computed(() => Boolean(
    codexPromptBusy.value ||
    (currentStepHasPendingPromptWork(readSession(session)) && codexActive.value)
  ));
  const running = computed(() => active.value || commandRunning.value);
  const currentStepAutopilot = computed(() => stepAutopilot(readSession(session)));
  const readyForIssue = computed(() => {
    const kind = currentStepAutopilot.value.kind;
    return kind === "issue_discussion" || kind === "seed_issue_discussion";
  });
  const readyForDeepUiCheck = computed(() => {
    return currentStepNeedsUserDecision(readSession(session)) && !running.value && !codexBlocksAutopilot.value && !failure.value;
  });
  const readyForFinished = computed(() => currentStepAutopilot.value.kind === "finished");
  const readyForMerge = computed(() => currentStepAutopilot.value.kind === "merge_review");
  const readyForImplementationReview = computed(() => currentStepAutopilot.value.kind === "implementation_review");
  const readyForAgentConversation = computed(() => currentStepAutopilot.value.kind === "agent_conversation");
  const readyForFinalReview = computed(() => currentStepAutopilot.value.kind === "final_review");
  const readyForReview = computed(() => readyForImplementationReview.value || readyForFinalReview.value);
  const reviewKind = computed(() => {
    if (readyForImplementationReview.value) {
      return "implementation";
    }
    if (readyForFinalReview.value) {
      return "final";
    }
    return "";
  });
  const reviewConversationAction = computed(() => {
    const actionId = currentStepAutopilot.value.stage?.actionId || "";
    return actionById(readActions(actions), actionId);
  });
  const waitingForCodex = computed(() => Boolean(
    autopilotEnabled.value &&
    !failure.value &&
    codexActive.value &&
    (codexPromptBusy.value || currentStepHasPendingPromptWork(readSession(session))) &&
    readSession(session)?.sessionId
  ));
  const canStart = computed(() => Boolean(
    autopilotEnabled.value &&
    readSession(session)?.sessionId &&
    !running.value &&
    !codexBlocksAutopilot.value &&
    !currentStepIsStopPoint(readSession(session)) &&
    currentStepCanStartAutopilot(readSession(session))
  ));
  const canResume = computed(() => {
    const currentSession = readSession(session);
    return Boolean(
      autopilotEnabled.value &&
      currentSession?.sessionId &&
      currentSession.currentStep &&
      !currentStepIsStartBoundary(currentSession.currentStep) &&
      (!currentStepIsStopPoint(currentSession) || currentStepHasPendingPromptWork(currentSession)) &&
      currentStepCanRunAutopilot(currentSession) &&
      !running.value &&
      !codexBlocksAutopilot.value &&
      !waitingForCodex.value &&
      !failure.value
    );
  });
  const canAcceptReview = computed(() => {
    const next = readNext(actions);
    return Boolean(readyForReview.value && !running.value && !codexBlocksAutopilot.value && nextIsReady(next));
  });
  const canRequestReviewConversation = computed(() => {
    const action = reviewConversationAction.value;
    return Boolean(readyForReview.value && !running.value && !codexBlocksAutopilot.value && action?.enabled === true);
  });
  const canArchiveSession = computed(() => {
    const archiveAction = actionById(readActions(actions), FINISH_SESSION_ACTION_ID);
    return Boolean(readyForFinished.value && !running.value && !codexBlocksAutopilot.value && archiveAction?.enabled === true);
  });
  const canSubmitAgentConversationRequest = computed(() => {
    const action = actionById(readActions(actions), AGENT_CONVERSATION_ACTION_ID);
    return Boolean(readyForAgentConversation.value && !running.value && !codexBlocksAutopilot.value && action?.enabled === true);
  });
  const canFinishAgentConversation = computed(() => {
    const next = readNext(actions);
    return Boolean(readyForAgentConversation.value && !running.value && !codexBlocksAutopilot.value && nextIsReady(next));
  });
  const agentConversationContinueLabel = computed(() => {
    const currentSession = readSession(session);
    const next = readNext(actions);
    const nextLabel = sessionStepLabel(currentSession, next?.stepId) || String(next?.label || "");
    if (!nextLabel) {
      return "Continue";
    }
    if (next?.stepId === LOCAL_FINISHED_STEP_ID) {
      return "Finish";
    }
    return `Continue to ${nextLabel}`;
  });
  const resumeButtonText = computed(() => "Continue Autopilot");

  const screenState = computed(() => {
    if (commandRunning.value || commandResult.value?.ok === false) {
      return {
        icon: "none",
        kind: "command",
        showProgress: false,
        title: commandRunning.value ? "Command running." : "Command needs attention."
      };
    }
    if (waitingForCodex.value) {
      return {
        icon: "progress",
        kind: "codex_running",
        showProgress: true,
        stopAction: "autopilot",
        title: activeStage.value ? `Executing: ${activeStage.value}` : "Codex is working..."
      };
    }
    if (running.value) {
      return {
        icon: "progress",
        kind: "running",
        showProgress: true,
        title: `Executing: ${activeStage.value || stepLabel(readSession(session))}`
      };
    }
    if (readyForIssue.value) {
      return {
        icon: "cog",
        kind: "issue",
        showProgress: false,
        title: "What would you like to do?"
      };
    }
    if (readyForAgentConversation.value) {
      return {
        icon: failure.value ? "warning" : "cog",
        kind: "agent_conversation",
        message: failure.value?.error || "Ask Codex for changes. Continue when the work is ready for checks.",
        showProgress: false,
        title: stepLabel(readSession(session))
      };
    }
    if (readyForDeepUiCheck.value) {
      return {
        icon: "cog",
        kind: "deep_ui_decision",
        message: "The deep UI check can take a long time. Run it now, or skip it and continue to review/deslop.",
        showProgress: false,
        title: "Run deep UI check?"
      };
    }
    if (readyForReview.value) {
      const implementationReview = reviewKind.value === "implementation";
      return {
        icon: "cog",
        kind: "review",
        message: implementationReview
          ? "Try the work now. Ask Codex for small tweaks, or continue when it looks right."
          : "Review the validated work before Autopilot writes the report and commits.",
        reviewKind: reviewKind.value,
        showProgress: false,
        title: implementationReview ? "Human review" : "Final review"
      };
    }
    if (readyForMerge.value) {
      return {
        icon: failure.value ? "warning" : "cog",
        kind: "merge",
        message: failure.value?.error || "The pull request is ready. Merge it and update the main checkout, or finish without merging.",
        showProgress: false,
        title: "Merge pull request?"
      };
    }
    if (failure.value) {
      return {
        icon: "warning",
        kind: "failure",
        message: String(failure.value.error || ""),
        showProgress: false,
        title: "Attention required"
      };
    }
    if (readyForFinished.value) {
      return {
        icon: "success",
        kind: "finished",
        message: "The session is complete.",
        showProgress: false,
        title: "Congratulations!"
      };
    }
    const currentSession = readSession(session);
    if (
      currentSession?.currentStep &&
      !currentStepIsStartBoundary(currentSession.currentStep) &&
      !currentStepCanRunAutopilot(currentSession)
    ) {
      return {
        icon: "cog",
        kind: "blocked",
        showProgress: false,
        title: stepLabel(currentSession)
      };
    }
    if (canStart.value) {
      return {
        buttonLabel: "Let's start",
        icon: "cog",
        kind: "start",
        showProgress: false,
        title: "Let's get started"
      };
    }
    if (canResume.value) {
      return {
        buttonLabel: "Continue Autopilot",
        icon: "cog",
        kind: "resume",
        showProgress: false,
        title: "Ready to continue"
      };
    }
    return {
      icon: "cog",
      kind: "idle",
      showProgress: false,
      title: "Let's get started"
    };
  });
  const statusText = computed(() => screenState.value.title);

  function clearFailure() {
    failure.value = null;
    lastCommandResult.value = null;
  }

  async function acceptChanges() {
    if (!autopilotEnabled.value || codexBlocksAutopilot.value || !canAcceptReview.value) {
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
        actionLabel: "Accept changes",
        error: String(error?.message || error || "Could not accept the reviewed changes.")
      });
    } finally {
      activeStage.value = "";
    }
  }

  async function rewindFinalReviewForFreshChecks() {
    const currentSession = readSession(session);
    const recheckStepId = finalReviewRecheckStepIdForSession(currentSession);
    if (typeof actions.rewindToStep !== "function") {
      stopWithFailure({
        actionId: FINAL_REVIEW_CONVERSATION_ACTION_ID,
        actionLabel: "Ask AI for tweaks",
        error: "Codex made a final-review change, but Studio could not send the workflow back through review and validation.",
        source: "workflow"
      });
      return false;
    }
    activeStage.value = sessionStepLabel(currentSession, recheckStepId) || "Recheck changes";
    await actions.rewindToStep({
      canRewind: true,
      id: recheckStepId,
      rewindStepId: recheckStepId
    });
    await refreshSessionData();
    await nextTick();
    return true;
  }

  async function requestReviewConversation(message = "") {
    const normalizedMessage = String(message || "").trim();
    const finalReviewRequest = readyForFinalReview.value;
    if (!autopilotEnabled.value || codexBlocksAutopilot.value || !canRequestReviewConversation.value) {
      return false;
    }
    if (!normalizedMessage) {
      stopWithFailure({
        actionId: reviewConversationAction.value?.id || "",
        actionLabel: "Ask AI for tweaks",
        error: "Describe what Codex should change before sending the tweak request.",
        source: "codex"
      });
      return false;
    }

    const action = reviewConversationAction.value;
    stopRequested = false;
    clearFailure();
    conversationRequest.value = normalizedMessage;
    active.value = true;
    activeStage.value = action?.label || "Ask AI for tweaks";
    try {
      const turnResult = await runPromptAction(action, {
        actionId: action?.id || "",
        label: activeStage.value
      }, {
        advanceAfterCompletion: false
      });
      if (turnResult === CODEX_TURN_RESULT.COMPLETE && finalReviewRequest) {
        await rewindFinalReviewForFreshChecks();
        await runUntilStopPoint();
      }
      await refreshSessionData();
      return !failure.value;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function submitAgentConversationRequest(message = "") {
    const normalizedMessage = String(message || "").trim();
    if (!autopilotEnabled.value || codexBlocksAutopilot.value || !canSubmitAgentConversationRequest.value) {
      return false;
    }
    if (!normalizedMessage) {
      stopWithFailure({
        actionId: AGENT_CONVERSATION_ACTION_ID,
        actionLabel: "Talk to Codex",
        error: "Describe what you want Codex to do before sending the request.",
        source: "codex"
      });
      return false;
    }

    const action = actionById(readActions(actions), AGENT_CONVERSATION_ACTION_ID);
    stopRequested = false;
    clearFailure();
    conversationRequest.value = normalizedMessage;
    active.value = true;
    activeStage.value = action?.label || "Talk to Codex";
    try {
      await runPromptAction(action, {
        actionId: AGENT_CONVERSATION_ACTION_ID,
        label: activeStage.value
      }, {
        advanceAfterCompletion: false
      });
      await refreshSessionData();
      return !failure.value;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function finishAgentConversation() {
    if (!autopilotEnabled.value || codexBlocksAutopilot.value || !canFinishAgentConversation.value) {
      return false;
    }
    stopRequested = false;
    clearFailure();
    active.value = true;
    activeStage.value = readNext(actions)?.label || "Continue";
    try {
      await actions.goNext?.();
      await refreshSessionData();
      await nextTick();
      return true;
    } catch (error) {
      stopWithFailure({
        actionLabel: activeStage.value,
        error: String(error?.message || error || "Could not continue from the Codex conversation.")
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function start() {
    if (!autopilotEnabled.value || codexBlocksAutopilot.value || !canStart.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value || codexBlocksAutopilot.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function resume() {
    if (!autopilotEnabled.value || codexBlocksAutopilot.value || !canResume.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  function stop() {
    stopRequested = true;
    if (commandRunning.value && typeof commandRunner.stopCommandAction === "function") {
      commandRunner.stopCommandAction();
      return;
    }
    active.value = false;
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
    if (!autopilotEnabled.value || !currentStepNeedsUserDecision(readSession(session)) || running.value || codexBlocksAutopilot.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "run";
    await runUntilStopPoint();
  }

  async function skipDeepUiCheck() {
    if (!autopilotEnabled.value || !currentStepNeedsUserDecision(readSession(session)) || running.value || codexBlocksAutopilot.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "skip";
    await runUntilStopPoint();
  }

  async function rejectChanges(feedback = "") {
    const normalizedFeedback = String(feedback || "").trim();
    if (!autopilotEnabled.value || !readyForFinalReview.value || running.value || codexBlocksAutopilot.value) {
      return false;
    }
    if (!normalizedFeedback) {
      stopWithFailure({
        actionLabel: "Reject changes",
        error: "Describe what should change before sending the work back to Codex."
      });
      return false;
    }

    stopRequested = false;
    clearFailure();
    replanFeedback.value = normalizedFeedback;
    activeStage.value = "Reopen plan";
    const replanStepId = replanStepIdForSession(readSession(session));
    try {
      await actions.rewindToStep?.({
        canRewind: true,
        id: replanStepId,
        rewindStepId: replanStepId
      });
      await refreshSessionData();
      await nextTick();
      await runUntilStopPoint();
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionLabel: "Reject changes",
        error: String(error?.message || error || "Could not send the changes back to Codex.")
      });
      return false;
    } finally {
      activeStage.value = "";
    }
  }

  function cancelMergeFailure() {
    if (readyForMerge.value) {
      clearFailure();
    }
  }

  async function mergeAndSyncMainCheckout() {
    if (!autopilotEnabled.value || !readyForMerge.value || running.value || codexBlocksAutopilot.value) {
      return false;
    }
    stopRequested = false;
    clearFailure();
    active.value = true;
    try {
      const prepareAction = actionById(readActions(actions), "prepare_for_merge");
      if (!await runRequiredPromptAction(prepareAction, "Prepare for merge")) {
        return false;
      }

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
      await runTerminalAction(readSession(session), mergeAction);
      if (failure.value) {
        return false;
      }
      if (!await advanceCurrentStepIfReady()) {
        stopWithFailure({
          actionId: "merge_pr",
          actionLabel: "Merge",
          error: "The pull request merged, but Autopilot could not continue to main checkout sync."
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

  async function runRequiredPromptAction(action = {}, fallbackLabel = "Codex") {
    if (!action) {
      stopWithFailure(missingActionFailure({
        actionId: "",
        label: fallbackLabel
      }));
      return false;
    }
    if (action.enabled !== true) {
      stopWithFailure(disabledActionFailure(action, {
        actionId: action.id,
        label: fallbackLabel
      }));
      return false;
    }
    const result = await runPromptAction(action, {
      actionId: action.id,
      label: action.label || fallbackLabel
    }, {
      advanceAfterCompletion: false
    });
    return result === CODEX_TURN_RESULT.COMPLETE && !failure.value;
  }

  async function skipMerge() {
    if (!autopilotEnabled.value || !readyForMerge.value || running.value || codexBlocksAutopilot.value) {
      return false;
    }
    stopRequested = false;
    clearFailure();
    active.value = true;
    activeStage.value = "Skip merge";
    try {
      const skipAction = actionById(readActions(actions), "skip_merge");
      if (!skipAction) {
        stopWithFailure(missingActionFailure({
          actionId: "skip_merge",
          label: "Do not merge"
        }));
        return false;
      }
      if (skipAction.enabled !== true) {
        stopWithFailure(disabledActionFailure(skipAction, {
          actionId: "skip_merge",
          label: "Do not merge"
        }));
        return false;
      }
      await actions.runAction?.(skipAction);
      await refreshSessionData();
      await nextTick();

      if (!await advanceCurrentStepIfReady()) {
        stopWithFailure({
          actionLabel: "Skip merge",
          error: "Autopilot could not skip the merge because the workflow cannot continue from Merge PR."
        });
        return false;
      }
      if (currentStep.value === MAIN_CHECKOUT_SYNCED_STEP_ID) {
        if (!await advanceCurrentStepIfReady()) {
          stopWithFailure({
            actionLabel: "Skip merge",
            error: "Autopilot skipped the merge, but could not move to Congratulations."
          });
          return false;
        }
      }
      return readyForFinished.value;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function archiveSession() {
    if (!autopilotEnabled.value || !readyForFinished.value || running.value || codexBlocksAutopilot.value) {
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
      return true;
    } catch (error) {
      stopWithFailure({
        actionId: archiveAction.id,
        actionLabel: archiveAction.label || "Archive",
        error: String(error?.message || error || "Could not archive the session.")
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
        if (!autopilotEnabled.value || stopRequested || !currentSession?.sessionId) {
          return;
        }
        if (currentStepIsStopPoint(currentSession) && !currentStepHasPendingPromptWork(currentSession)) {
          return;
        }
        if (codexBlocksAutopilot.value) {
          return;
        }

        const stage = stageForSession(currentSession);
        if (!stage && await advanceCurrentStepIfReady()) {
          continue;
        }

        if (currentStepNeedsUserDecision(currentSession)) {
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
        }

        if (!stage) {
          stopWithFailure(blockedStepFailure(currentSession));
          return;
        }

        if (await advanceCompletedStepMachine(currentSession)) {
          continue;
        }
        if (failure.value) {
          return;
        }

        const stageResult = await runStageAction(currentSession, stage);
        if (stageResult === CODEX_TURN_RESULT.WAITING_FOR_INPUT) {
          return;
        }
        if (failure.value) {
          return;
        }
        if (currentStepNeedsUserDecision(currentSession)) {
          deepUiCheckDecision.value = "";
        }
      }

      stopWithFailure({
        actionLabel: "Autopilot",
        error: "Autopilot stopped because the session did not make progress."
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

  async function advanceCompletedStepMachine(currentSession = {}) {
    if (currentSession?.stepMachine?.stepId && String(currentSession.stepMachine.status || "") === "done") {
      return advanceCurrentStepIfReady();
    }
    if (currentSession?.stepMachine?.stepId && String(currentSession.stepMachine.status || "") === "need_input") {
      return false;
    }
    return false;
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
      return runTerminalAction(currentSession, action);
    }
    if (action.type === "prompt") {
      return runPromptAction(action, stage);
    }

    try {
      await actions.runAction?.(autopilotActionForStage(action, stage));
      await refreshSessionData();
      await nextTick();
      return CODEX_TURN_RESULT.COMPLETE;
    } catch (error) {
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        source: action.type === "prompt" ? "codex" : ""
      });
      return CODEX_TURN_RESULT.INCOMPLETE;
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
    if (actionUsesStepMachineHelper(action, readSession(session))) {
      const result = await runStepMachinePromptAction(action, stage);
      if (result === CODEX_TURN_RESULT.COMPLETE) {
        clearPromptActionInput(action);
      }
      return result;
    }

    void advanceAfterCompletion;
    stopWithFailure({
      actionId: action.id,
      actionLabel: stage.label || action.label,
      error: `${stage.label || action.label || "Codex"} is not connected to the current step state machine.`,
      source: "codex"
    });
    return CODEX_TURN_RESULT.INCOMPLETE;
  }

  async function runStepMachinePromptAction(action = {}, stage = {}) {
    const startingStep = currentStep.value;
    try {
      await actions.runAction?.(action, {
        input: promptActionInput(action)
      });
      await refreshSessionData();
      await nextTick();
      return waitForStepMachinePrompt({
        action,
        label: stage.label || action.label,
        startedAt: Date.now(),
        startingStep
      });
    } catch (error) {
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        source: "codex"
      });
      return CODEX_TURN_RESULT.INCOMPLETE;
    }
  }

  async function waitForStepMachinePrompt({
    action = {},
    label = "",
    startedAt = Date.now(),
    startingStep = ""
  } = {}) {
    while (autopilotEnabled.value && !stopRequested && readSession(session)?.currentStep === startingStep) {
      const promptError = readPromptInjectionError(codexTerminal);
      if (promptError) {
        stopWithFailure({
          actionId: action.id,
          actionLabel: label || action.label,
          error: promptError,
          source: "codex"
        });
        return CODEX_TURN_RESULT.INCOMPLETE;
      }

      await refreshSessionData();
      await nextTick();
      const currentSession = readSession(session);
      const machineStatus = String(currentSession?.stepMachine?.status || "");
      if (machineStatus === "ready" && currentSession?.stepMachine?.promptComplete === true) {
        return CODEX_TURN_RESULT.COMPLETE;
      }
      if (machineStatus === "confirm_files" || machineStatus === "need_input") {
        return CODEX_TURN_RESULT.WAITING_FOR_INPUT;
      }
      if (machineStatus === "done") {
        return CODEX_TURN_RESULT.COMPLETE;
      }
      if (!readCodexActive(codexTerminal) && Date.now() - startedAt >= CODEX_TURN_WITHOUT_ARTIFACT_GRACE_MS) {
        stopWithFailure({
          actionId: action.id,
          actionLabel: label || action.label,
          error: `${label || "Codex"} finished without updating the current AI Studio step.`,
          source: "codex"
        });
        return CODEX_TURN_RESULT.INCOMPLETE;
      }
      await waitForCodexOrTimer();
    }
    return CODEX_TURN_RESULT.INCOMPLETE;
  }

  function waitForCodexOrTimer() {
    return new Promise((resolve) => {
      const cleanupCallbacks = [];
      let timeoutId = null;
      const finish = () => {
        for (const cleanup of cleanupCallbacks) {
          cleanup();
        }
        resolve();
      };

      cleanupCallbacks.push(watch(codexActive, finish, {
        flush: "post"
      }));
      cleanupCallbacks.push(watch(() => readPromptInjectionError(codexTerminal), finish, {
        flush: "post"
      }));
      cleanupCallbacks.push(() => clearTimeout(timeoutId));
      timeoutId = setTimeout(finish, 500);
    });
  }

  function promptActionInput(action = {}) {
    if ((action.id === "make_plan" || action.id === "make_seed_plan") && replanFeedback.value) {
      return {
        autopilotFeedback: replanFeedback.value,
        autopilotReason: "changes_rejected"
      };
    }
    if (actionUsesConversationRequestInput(action) && conversationRequest.value) {
      return {
        conversationRequest: conversationRequest.value
      };
    }
    return {};
  }

  function clearPromptActionInput(action = {}) {
    if (action.id === "make_plan" || action.id === "make_seed_plan") {
      replanFeedback.value = "";
    }
    if (actionUsesConversationRequestInput(action)) {
      conversationRequest.value = "";
    }
  }

  async function runTerminalAction(currentSession = {}, action = {}) {
    lastCommandResult.value = null;
    const result = await commandRunner.runCommandAction({
      action,
      advanceOnSuccess: true,
      input: {},
      sessionId: currentSession.sessionId
    });
    lastCommandResult.value = result;
    await refreshSessionData();
    await nextTick();
    if (result.ok !== true) {
      if (currentStepNeedsInput(readSession(session))) {
        return;
      }
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

  watch(codexActive, (activeNow) => {
    if (autopilotEnabled.value && activeNow && readSession(session)?.sessionId) {
      clearFailure();
    }
  }, {
    flush: "post"
  });

  return {
    acceptChanges,
    archiveSession,
    cancelMergeFailure,
    agentConversationContinueLabel,
    canAcceptReview,
    canArchiveSession,
    canFinishAgentConversation,
    canRequestReviewConversation,
    canSubmitAgentConversationRequest,
    canStart,
    canResume,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    failure,
    finishAgentConversation,
    mergeAndSyncMainCheckout,
    readyForAgentConversation,
    readyForFinished,
    readyForDeepUiCheck,
    readyForFinalReview,
    readyForImplementationReview,
    readyForIssue,
    readyForMerge,
    readyForReview,
    rejectChanges,
    requestReviewConversation,
    retry,
    resume,
    runDeepUiCheck,
    running,
    screenState,
    skipDeepUiCheck,
    skipMerge,
    start,
    submitAgentConversationRequest,
    stop,
    stopCommandAction,
    resumeButtonText,
    statusText,
    waitingForCodex
  };
}

export {
  DEEP_UI_CHECK_STEP_ID,
  FINISHED_STEP_ID,
  IMPLEMENTATION_REVIEW_STEP_ID,
  ISSUE_STEP_ID,
  MERGE_PR_STEP_ID,
  REVIEW_CHANGES_STEP_ID,
  useAiStudioAutopilotController
};
