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
const APPLY_REVIEW_FEEDBACK_ACTION_ID = "apply_review_feedback";
const TALK_TO_AGENT_ACTION_ID = "talk_to_agent";
const AGENT_CONVERSATION_STEP_ID = "agent_response_created";
const DEEP_UI_CHECK_STEP_ID = "deep_ui_check_run";
const FINISHED_STEP_ID = "session_finished";
const HUMAN_INPUT_RESPONSE_ARTIFACT = "human_input_response.md";
const LOCAL_FINISHED_STEP_ID = "local_session_finished";
const FINISH_SESSION_ACTION_ID = "finish_session";
const IMPLEMENTATION_REVIEW_STEP_ID = "implementation_reviewed";
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

function metadataValue(session = {}, name = "") {
  return String(session?.metadata?.[name] || "").trim();
}

function artifactReady(session = {}, name = "") {
  return session?.artifactReadiness?.[name]?.nonEmpty === true;
}

function conditionValueList(value = "") {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function conditionIsMet(session = {}, condition = "") {
  const name = String(condition || "").trim();
  if (!name || name === "always") {
    return true;
  }
  if (name.startsWith("metadata:")) {
    return Boolean(metadataValue(session, name.slice("metadata:".length)));
  }
  if (name.startsWith("artifact:")) {
    return artifactReady(session, name.slice("artifact:".length));
  }
  if (name.startsWith("artifacts:")) {
    const artifactNames = conditionValueList(name.slice("artifacts:".length));
    return artifactNames.length > 0 && artifactNames.every((artifactName) => artifactReady(session, artifactName));
  }
  if (name.startsWith("any:")) {
    return name
      .slice("any:".length)
      .split(";")
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .some((candidate) => conditionIsMet(session, candidate));
  }
  return false;
}

function conditionsAreMet(session = {}, conditions = []) {
  return (Array.isArray(conditions) ? conditions : [])
    .every((condition) => conditionIsMet(session, condition));
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

function currentStepCanRunAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  return stepId === SESSION_CREATED_STEP_ID ||
    currentStepNeedsUserDecision(session) ||
    Boolean(stageForSession(session));
}

function currentStepCanStartAutopilot(session = {}) {
  const stepId = String(session?.currentStep || "");
  if (!currentStepIsStartBoundary(stepId)) {
    const completedSteps = Array.isArray(session?.completedSteps) ? session.completedSteps : [];
    return completedSteps.length <= 1 && currentStepCanRunAutopilot(session);
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
    error: "Autopilot stopped. Use Inspect to continue manually.",
    exitCode: null,
    ok: false,
    output: ""
  };
}

function stageForSession(session = {}) {
  const autopilot = stepAutopilot(session);
  if (Array.isArray(autopilot.actionSequence) && autopilot.actionSequence.length > 0) {
    return autopilot.actionSequence.find((action) => !conditionsAreMet(session, action.completeWhen)) || null;
  }
  if (autopilot.actionId) {
    if (autopilot.completeWhen?.length && conditionsAreMet(session, autopilot.completeWhen)) {
      return null;
    }
    return {
      actionId: autopilot.actionId,
      advanceOnSuccess: autopilot.advanceOnSuccess === true,
      label: autopilot.label || autopilot.actionId
    };
  }
  return null;
}

function actionLabelForId(actionId = "", session = {}) {
  const normalizedActionId = String(actionId || "");
  const actions = [
    ...(Array.isArray(session?.actions) ? session.actions : []),
    ...(Array.isArray(session?.currentStepDefinition?.actions) ? session.currentStepDefinition.actions : [])
  ];
  const action = actions.find((candidate) => candidate.id === normalizedActionId);
  if (action?.label) {
    return action.label;
  }
  const autopilot = stepAutopilot(session);
  const sequenceAction = (Array.isArray(autopilot.actionSequence) ? autopilot.actionSequence : [])
    .find((candidate) => candidate.actionId === normalizedActionId);
  if (sequenceAction?.label) {
    return sequenceAction.label;
  }
  if (autopilot.actionId === normalizedActionId && autopilot.label) {
    return autopilot.label;
  }
  return normalizedActionId || "Codex";
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

function promptActionAdvancesByDefault(actionId = "") {
  return actionId !== APPLY_REVIEW_FEEDBACK_ACTION_ID &&
    actionId !== TALK_TO_AGENT_ACTION_ID;
}

function promptRunAdvancesWorkflow(promptRun = {}) {
  return promptRun?.advanceAfterCompletion !== false &&
    promptActionAdvancesByDefault(promptRun?.actionId);
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
  const agentRequest = ref("");
  const deepUiCheckDecision = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);
  const replanFeedback = ref("");
  const reviewTweakFeedback = ref("");
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
  const codexActive = computed(() => readCodexActive(codexTerminal));
  const running = computed(() => active.value || commandRunning.value || codexQuestions.submitting.value);
  const currentPromptRun = computed(() => promptRunForSession(readSession(session)));
  const currentAutopilotArtifacts = computed(() => readRefOrGetterValue(autopilotArtifacts) || null);
  const readyForIssue = computed(() => {
    const kind = stepAutopilot(readSession(session)).kind;
    return kind === "issue_discussion" || kind === "seed_issue_discussion" || currentStep.value === ISSUE_STEP_ID;
  });
  const readyForDeepUiCheck = computed(() => {
    return currentStepNeedsUserDecision(readSession(session)) && !running.value && !codexActive.value && !failure.value;
  });
  const readyForFinished = computed(() => {
    const currentSession = readSession(session);
    return stepAutopilot(currentSession).kind === "finished" ||
      currentSession?.currentStep === FINISHED_STEP_ID ||
      currentSession?.currentStep === LOCAL_FINISHED_STEP_ID;
  });
  const readyForMerge = computed(() => stepAutopilot(readSession(session)).kind === "merge_review" || currentStep.value === MERGE_PR_STEP_ID);
  const readyForImplementationReview = computed(() => {
    return stepAutopilot(readSession(session)).kind === "implementation_review" || currentStep.value === IMPLEMENTATION_REVIEW_STEP_ID;
  });
  const readyForAgentConversation = computed(() => {
    return stepAutopilot(readSession(session)).kind === "agent_conversation" || currentStep.value === AGENT_CONVERSATION_STEP_ID;
  });
  const agentResponseReady = computed(() => artifactReady(readSession(session), HUMAN_INPUT_RESPONSE_ARTIFACT));
  const canSubmitAgentRequest = computed(() => {
    const action = actionById(readActions(actions), TALK_TO_AGENT_ACTION_ID);
    return Boolean(readyForAgentConversation.value && !running.value && !codexActive.value && action?.enabled === true);
  });
  const canFinishAgentConversation = computed(() => {
    const next = readNext(actions);
    return Boolean(readyForAgentConversation.value && agentResponseReady.value && !running.value && !codexActive.value && nextIsReady(next));
  });
  const readyForFinalReview = computed(() => {
    return stepAutopilot(readSession(session)).kind === "final_review" || currentStep.value === REVIEW_CHANGES_STEP_ID;
  });
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
      promptRunAdvancesWorkflow(promptRun) &&
      !codexActive.value &&
      !running.value &&
      !workflowQuestionActive.value &&
      !promptQuestionsMatchRun(currentAutopilotArtifacts.value?.questions, promptRun) &&
      !promptDoneMatchesRun(currentAutopilotArtifacts.value?.promptDone, promptRun)
    );
  });
  const promptRunReadyToAdvance = computed(() => {
    const promptRun = activePromptRunForSession(readSession(session));
    return Boolean(
      promptRun &&
      promptRunAdvancesWorkflow(promptRun) &&
      !codexActive.value &&
      !running.value &&
      !workflowQuestionActive.value &&
      promptDoneMatchesRun(currentAutopilotArtifacts.value?.promptDone, promptRun)
    );
  });
  const promptRunAdvanceTargetLabel = computed(() => {
    const currentSession = readSession(session);
    const next = currentSession?.next || readNext(actions);
    return sessionStepLabel(currentSession, next?.stepId) || String(next?.label || "the next step");
  });
  const promptRunAdvanceMessage = computed(() => {
    const promptRun = activePromptRunForSession(readSession(session));
    const actionLabel = promptRun?.actionLabel || actionLabelForId(promptRun?.actionId, readSession(session));
    return `Codex finished ${actionLabel}. Continue to move to ${promptRunAdvanceTargetLabel.value}.`;
  });
  const resumeButtonText = computed(() => (
    promptRunReadyToAdvance.value
      ? `Continue to ${promptRunAdvanceTargetLabel.value}`
      : "Continue Autopilot"
  ));
  const waitingForCodex = computed(() => Boolean(
    currentSessionHasActiveCodex() && !workflowQuestionActive.value
  ));
  const canStart = computed(() => Boolean(
    autopilotEnabled.value &&
    readSession(session)?.sessionId &&
    !running.value &&
    !codexActive.value &&
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
      !currentStepIsStopPoint(currentSession) &&
      currentStepCanRunAutopilot(currentSession) &&
      !running.value &&
      !codexActive.value &&
      !waitingForCodex.value &&
      !promptRunNeedsContinuation.value &&
      (!failure.value || promptRunReadyToAdvance.value)
    );
  });
  const canAcceptReview = computed(() => {
    const next = readNext(actions);
    return Boolean(readyForReview.value && !running.value && !codexActive.value && nextIsReady(next));
  });
  const canRequestReviewTweak = computed(() => {
    const action = actionById(readActions(actions), APPLY_REVIEW_FEEDBACK_ACTION_ID);
    return Boolean(readyForImplementationReview.value && !running.value && !codexActive.value && action?.enabled === true);
  });
  const canArchiveSession = computed(() => {
    const archiveAction = actionById(readActions(actions), FINISH_SESSION_ACTION_ID);
    return Boolean(readyForFinished.value && !running.value && !codexActive.value && archiveAction?.enabled === true);
  });

  const screenState = computed(() => {
    if (commandRunning.value || commandResult.value?.ok === false) {
      return {
        icon: "none",
        kind: "command",
        showProgress: false,
        title: commandRunning.value ? "Command running." : "Command needs attention."
      };
    }
    if (codexQuestions.hasQuestions.value) {
      return {
        icon: "cog",
        kind: "questions",
        showProgress: false,
        title: "A few questions first"
      };
    }
    if (currentSessionHasActiveCodex()) {
      return {
        icon: "progress",
        kind: "codex_running",
        showProgress: true,
        stopAction: "autopilot",
        title: activeCodexTitle()
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
        stopAction: active.value ? "issue" : "",
        title: "What would you like to do?"
      };
    }
    if (readyForAgentConversation.value) {
      return {
        icon: failure.value ? "warning" : "cog",
        kind: "agent_conversation",
        message: failure.value?.error || (agentResponseReady.value
          ? "Codex saved an answer for this maintenance session."
          : "Ask Codex what you need help with."),
        showProgress: false,
        title: agentResponseReady.value ? "AI response" : "Talk to agent"
      };
    }
    if (promptRunNeedsContinuation.value) {
      return {
        buttonLabel: "Continue",
        icon: "cog",
        kind: "prompt_waiting",
        message: "Codex paused before this step was confirmed complete. Continue the existing Codex session instead of starting over.",
        showProgress: false,
        title: "Codex is waiting to continue"
      };
    }
    if (promptRunReadyToAdvance.value) {
      return {
        buttonLabel: resumeButtonText.value,
        icon: "cog",
        kind: "prompt_done",
        message: promptRunAdvanceMessage.value,
        showProgress: false,
        title: "Ready to continue"
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
        buttonLabel: resumeButtonText.value,
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
    codexQuestions.clearFailure();
  }

  async function acceptChanges() {
    if (!autopilotEnabled.value || codexActive.value || !canAcceptReview.value) {
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

  async function requestReviewTweak(feedback = "") {
    const normalizedFeedback = String(feedback || "").trim();
    if (!autopilotEnabled.value || codexActive.value || !canRequestReviewTweak.value) {
      return false;
    }
    if (!normalizedFeedback) {
      stopWithFailure({
        actionId: APPLY_REVIEW_FEEDBACK_ACTION_ID,
        actionLabel: "Ask AI for tweaks",
        error: "Describe what Codex should change before sending the tweak request.",
        exitCode: null,
        ok: false,
        output: "",
        source: "codex"
      });
      return false;
    }

    const action = actionById(readActions(actions), APPLY_REVIEW_FEEDBACK_ACTION_ID);
    stopRequested = false;
    clearFailure();
    reviewTweakFeedback.value = normalizedFeedback;
    active.value = true;
    activeStage.value = action?.label || "Ask AI for tweaks";
    try {
      await runPromptAction(action, {
        actionId: APPLY_REVIEW_FEEDBACK_ACTION_ID,
        label: activeStage.value
      }, {
        advanceAfterCompletion: false
      });
      await refreshSessionData();
      await nextTick();
      return !failure.value;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function submitAgentRequest(message = "") {
    const normalizedMessage = String(message || "").trim();
    if (!autopilotEnabled.value || codexActive.value || !canSubmitAgentRequest.value) {
      return false;
    }
    if (!normalizedMessage) {
      stopWithFailure({
        actionId: TALK_TO_AGENT_ACTION_ID,
        actionLabel: "Talk to agent",
        error: "Describe what you want Codex to help with before sending the request.",
        exitCode: null,
        ok: false,
        output: "",
        source: "codex"
      });
      return false;
    }

    const action = actionById(readActions(actions), TALK_TO_AGENT_ACTION_ID);
    stopRequested = false;
    clearFailure();
    agentRequest.value = normalizedMessage;
    active.value = true;
    activeStage.value = action?.label || "Talk to agent";
    try {
      await runPromptAction(action, {
        actionId: TALK_TO_AGENT_ACTION_ID,
        label: activeStage.value
      }, {
        advanceAfterCompletion: false
      });
      await refreshSessionData();
      await nextTick();
      return !failure.value;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function finishAgentConversation() {
    if (!autopilotEnabled.value || codexActive.value || !canFinishAgentConversation.value) {
      return false;
    }

    stopRequested = false;
    clearFailure();
    active.value = true;
    activeStage.value = "Finish local session";
    try {
      await actions.goNext?.();
      await refreshSessionData();
      await nextTick();
      return true;
    } catch (error) {
      stopWithFailure({
        actionId: "",
        actionLabel: "Finish local session",
        error: String(error?.message || error || "Could not finish the local session."),
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

  async function start() {
    if (!autopilotEnabled.value || codexActive.value || !canStart.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value || codexActive.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function resume() {
    if (!autopilotEnabled.value || codexActive.value || !canResume.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function continuePromptRun() {
    const promptRun = activePromptRunForSession(readSession(session));
    if (!autopilotEnabled.value || !promptRunMatchesSession(promptRun, readSession(session)) || running.value || codexActive.value) {
      return false;
    }

    stopRequested = false;
    clearFailure();
    active.value = true;
    activePromptRun.value = promptRun;
    activeStage.value = actionLabelForId(promptRun.actionId, readSession(session));
    try {
      const injected = await codexTerminal.injectPrompt?.("continue", {
        requestId: `continue:${promptRun.requestId}`,
        sessionId: promptRun.sessionId
      });
      if (injected === false) {
        stopWithFailure({
          actionId: promptRun.actionId,
          actionLabel: actionLabelForId(promptRun.actionId, readSession(session)),
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
      clearPromptActionInput({
        id: promptRun.actionId
      });
      if (promptRunAdvancesWorkflow(promptRun)) {
        await advanceCurrentStepIfReady();
      }
      await runUntilStopPoint();
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionId: promptRun.actionId,
        actionLabel: actionLabelForId(promptRun.actionId, readSession(session)),
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
    if (!autopilotEnabled.value || !currentStepNeedsUserDecision(readSession(session)) || running.value || codexActive.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "run";
    await runUntilStopPoint();
  }

  async function skipDeepUiCheck() {
    if (!autopilotEnabled.value || !currentStepNeedsUserDecision(readSession(session)) || running.value || codexActive.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    deepUiCheckDecision.value = "skip";
    await runUntilStopPoint();
  }

  async function rejectChanges(feedback = "") {
    const normalizedFeedback = String(feedback || "").trim();
    if (!autopilotEnabled.value || !readyForFinalReview.value || running.value || codexActive.value) {
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
    if (!autopilotEnabled.value || currentStep.value !== MERGE_PR_STEP_ID || running.value || codexActive.value) {
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
    if (!autopilotEnabled.value || currentStep.value !== MERGE_PR_STEP_ID || running.value || codexActive.value) {
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
    if (
      !autopilotEnabled.value ||
      ![FINISHED_STEP_ID, LOCAL_FINISHED_STEP_ID].includes(currentStep.value) ||
      running.value ||
      codexActive.value
    ) {
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

        if (currentStepIsStopPoint(currentSession)) {
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
        if (currentSessionHasActiveCodex()) {
          return;
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
        if (currentStepNeedsUserDecision(currentSession)) {
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
    clearPromptActionInput({
      id: promptRun.actionId
    });
    if (promptRunAdvancesWorkflow(promptRun)) {
      await advanceCurrentStepIfReady();
    }
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
      clearPromptActionInput(action);
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
      clearPromptActionInput({
        id: promptRun.actionId
      });
      if (promptRunAdvancesWorkflow(promptRun)) {
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
    if ((action.id === "make_plan" || action.id === "make_seed_plan") && replanFeedback.value) {
      return {
        autopilotFeedback: replanFeedback.value,
        autopilotReason: "changes_rejected"
      };
    }
    if (action.id === APPLY_REVIEW_FEEDBACK_ACTION_ID && reviewTweakFeedback.value) {
      return {
        reviewFeedback: reviewTweakFeedback.value
      };
    }
    if (action.id === TALK_TO_AGENT_ACTION_ID && agentRequest.value) {
      return {
        agentRequest: agentRequest.value
      };
    }
    return {};
  }

  function clearPromptActionInput(action = {}) {
    if (action.id === "make_plan" || action.id === "make_seed_plan") {
      replanFeedback.value = "";
    }
    if (action.id === APPLY_REVIEW_FEEDBACK_ACTION_ID) {
      reviewTweakFeedback.value = "";
    }
    if (action.id === TALK_TO_AGENT_ACTION_ID) {
      agentRequest.value = "";
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
        await refreshSessionData();
        await nextTick();
        return PROMPT_WAIT_RESULT.COMPLETED;
      }
      if (promptQuestionsMatchRun(autopilotFiles.questions, currentPromptRun)) {
        startWorkflowQuestionExchange(currentPromptRun, autopilotFiles.questions);
        return PROMPT_WAIT_RESULT.QUESTIONS;
      }
      if (!readCodexActive(codexTerminal) && codexFinishedWithoutFile(currentPromptRun)) {
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
      contextLabel: actionLabelForId(promptRun.actionId, readSession(session)),
      onCancel: () => {
        void clearAutopilotArtifacts(promptRun.sessionId).catch(() => null);
        clearPromptRunState();
        stopWithFailure({
          actionId: promptRun.actionId,
          actionLabel: actionLabelForId(promptRun.actionId, readSession(session)),
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
        activeStage.value = actionLabelForId(nextPromptRun.actionId, readSession(session));
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
      cleanupCallbacks.push(watch(codexActive, finish, {
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
    if (readCodexActive(codexTerminal)) {
      return PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS;
    }
    const createdAt = Date.parse(promptRun.createdAt || "");
    if (!Number.isFinite(createdAt)) {
      return PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS;
    }
    return Math.max(0, PROMPT_IDLE_WITHOUT_OUTPUT_GRACE_MS - (Date.now() - createdAt));
  }

  function codexFinishedWithoutFile(promptRun = {}) {
    if (readCodexActive(codexTerminal)) {
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
      return {
        ...serverPromptRun,
        advanceAfterCompletion: promptActionAdvancesByDefault(serverPromptRun.actionId) ? undefined : false
      };
    }
    return {
      ...serverPromptRun,
      advanceAfterCompletion: activePromptRun.value.advanceAfterCompletion === false ||
        !promptActionAdvancesByDefault(serverPromptRun.actionId)
        ? false
        : undefined
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
    if (!currentSession?.sessionId || currentStepIsStopPoint(currentSession)) {
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

  function activeCodexStageLabel(currentSession = readSession(session)) {
    const promptRun = activePromptRunForSession(currentSession);
    if (promptRunMatchesSession(promptRun, currentSession)) {
      return actionLabelForId(promptRun.actionId, currentSession);
    }
    return currentPromptStage(currentSession)?.label || "";
  }

  function activeCodexTitle() {
    const label = activeStage.value || activeCodexStageLabel();
    return label ? `Executing: ${label}` : "Codex is working...";
  }

  function currentSessionHasActiveCodex() {
    const currentSession = readSession(session);
    if (!autopilotEnabled.value || !codexActive.value || !currentSession?.sessionId) {
      return false;
    }
    return true;
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
    if (!autopilotEnabled.value || active.value || !currentSessionHasActiveCodex()) {
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

  watch(codexActive, (activeNow, wasActive) => {
    if (autopilotEnabled.value && activeNow) {
      if (currentSessionHasActiveCodex()) {
        clearFailure();
      }
      if (!wasActive) {
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
    canFinishAgentConversation,
    canRequestReviewTweak,
    canSubmitAgentRequest,
    canStart,
    canResume,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    continuePromptRun,
    failure,
    finishAgentConversation,
    mergeAndSyncMainCheckout,
    promptRunAdvanceMessage,
    promptRunNeedsContinuation,
    promptRunReadyToAdvance,
    readyForAgentConversation,
    readyForFinished,
    readyForDeepUiCheck,
    readyForFinalReview,
    readyForImplementationReview,
    readyForIssue,
    readyForMerge,
    readyForReview,
    rejectChanges,
    requestReviewTweak,
    retry,
    resume,
    runDeepUiCheck,
    running,
    screenState,
    skipDeepUiCheck,
    skipMerge,
    start,
    submitAgentRequest,
    syncFromAutopilotArtifacts,
    stop,
    stopCommandAction,
    resumeButtonText,
    statusText,
    waitingForCodex
  };
}

export {
  AGENT_CONVERSATION_STEP_ID,
  DEEP_UI_CHECK_STEP_ID,
  FINISHED_STEP_ID,
  IMPLEMENTATION_REVIEW_STEP_ID,
  ISSUE_STEP_ID,
  MERGE_PR_STEP_ID,
  REVIEW_CHANGES_STEP_ID,
  useAiStudioAutopilotController
};
