import {
  actionInputFieldIsPrivate
} from "@/lib/vibe64ActionInputModel.js";

const COMPOSER_CONTROL_SURFACE_MODES = Object.freeze({
  ANSWER_CHOICES: "answer_choices",
  HIDDEN: "hidden",
  PASSIVE_COMPOSER: "passive_composer",
  SELECTED_CONTROL: "selected_control",
  STEP_INPUT: "step_input"
});
const COMPOSER_CONTROL_TARGETS = Object.freeze({
  PASSIVE_COMPOSER: "passive_composer",
  SELECTED_CONTROL: "selected_control",
  STEP_INPUT: "step_input"
});
const CONVERSATION_COMPOSER_DRAFT_CONTROL_ID = "conversation_composer";
const CONVERSATION_COMPOSER_DRAFT_FIELD = "conversationRequest";
const CURRENT_STEP_INPUT_CONTROL_ID = "current_step_input";
const WAITING_FOR_SESSION_CONTROLS_REASON = "Waiting for session controls.";

function composerControlCandidateSurfaceMode({
  composerVisible = false,
  selectedScreenAnswerChoicesVisible = false,
  selectedScreenControlVisible = false,
  stepInputFormVisible = false
} = {}) {
  if (selectedScreenAnswerChoicesVisible) {
    return COMPOSER_CONTROL_SURFACE_MODES.ANSWER_CHOICES;
  }
  if (selectedScreenControlVisible) {
    return COMPOSER_CONTROL_SURFACE_MODES.SELECTED_CONTROL;
  }
  if (stepInputFormVisible) {
    return COMPOSER_CONTROL_SURFACE_MODES.STEP_INPUT;
  }
  if (composerVisible) {
    return COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER;
  }
  return COMPOSER_CONTROL_SURFACE_MODES.HIDDEN;
}

function composerControlSurfaceMode({
  candidateMode = "",
  composerVisible = false,
  passiveComposerVisible = false,
  selectedScreenAnswerChoicesVisible = false,
  selectedScreenControlVisible = false,
  stepInputFormVisible = false
} = {}) {
  const mode = String(candidateMode || composerControlCandidateSurfaceMode({
    composerVisible,
    selectedScreenAnswerChoicesVisible,
    selectedScreenControlVisible,
    stepInputFormVisible
  }));
  if (mode !== COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER) {
    return mode;
  }
  return passiveComposerVisible
    ? COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER
    : COMPOSER_CONTROL_SURFACE_MODES.HIDDEN;
}

function composerControlModeState(mode = "") {
  const surfaceMode = String(mode || COMPOSER_CONTROL_SURFACE_MODES.HIDDEN);
  const passive = surfaceMode === COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER;
  const stepInput = surfaceMode === COMPOSER_CONTROL_SURFACE_MODES.STEP_INPUT;
  return {
    formVisible: [
      COMPOSER_CONTROL_SURFACE_MODES.ANSWER_CHOICES,
      COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER,
      COMPOSER_CONTROL_SURFACE_MODES.STEP_INPUT,
      COMPOSER_CONTROL_SURFACE_MODES.SELECTED_CONTROL
    ].includes(surfaceMode),
    passive,
    stepInput,
    surfaceMode,
    target: stepInput
      ? COMPOSER_CONTROL_TARGETS.STEP_INPUT
      : passive
      ? COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER
      : COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL
  };
}

function composerControlProjection({
  canSubmitSelectedControl = false,
  codexInterruptVisible = false,
  codexStopEnabled = false,
  codexStopVisible = false,
  composerDraftUsesConversationComposer = false,
  mode = "",
  pageBusy = false,
  passiveComposerCanSubmit = false,
  passiveComposerControl = null,
  passiveComposerFields = [],
  passiveComposerInputDisabled = false,
  passiveComposerSteeringModeActive = false,
  passiveComposerSteerRunning = false,
  passiveComposerValues = {},
  passiveComposerWorkflowControls = [],
  selectedComposerControl = null,
  selectedComposerInputDisabled = false,
  selectedComposerRunning = false,
  selectedControlFields = [],
  selectedControlIsPrimary = false,
  selectedControlSteeringActive = false,
  selectedControlUsesConversationComposer = false,
  selectedControlValues = {},
  selectedWorkflowButtonControls = [],
  stepInputCanSubmit = false,
  stepInputControl = null,
  stepInputFields = [],
  stepInputSaving = false,
  stepInputValues = {},
  workflowButtonControls = []
} = {}) {
  const state = composerControlModeState(mode);
  return {
    agentControlsVisible: !state.passive && !state.stepInput,
    attachmentsEnabled: !state.stepInput,
    cancelVisible: Boolean(
      !state.passive &&
      !state.stepInput &&
      !selectedComposerInputDisabled &&
      !selectedControlIsPrimary
    ),
    canSubmit: state.stepInput
      ? stepInputCanSubmit
      : state.passive
      ? passiveComposerCanSubmit
      : canSubmitSelectedControl,
    fields: state.stepInput
      ? stepInputFields
      : state.passive
      ? passiveComposerFields
      : selectedControlFields,
    formVisible: state.formVisible,
    inlineSubmit: state.stepInput
      ? inputFieldsHavePublicTextarea(stepInputFields)
      : state.passive ||
        selectedControlIsPrimary ||
        selectedControlUsesConversationComposer,
    inlineSubmitLabelVisible: state.stepInput
      ? true
      : state.passive
      ? passiveComposerSteeringModeActive
      : selectedControlSteeringActive,
    inputDisabled: state.stepInput
      ? Boolean(pageBusy || stepInputSaving)
      : state.passive
      ? passiveComposerInputDisabled
      : selectedComposerInputDisabled,
    interruptDisabled: !codexStopEnabled,
    interruptVisible: state.passive ? codexInterruptVisible : codexStopVisible,
    passive: state.passive,
    running: state.stepInput
      ? stepInputSaving
      : state.passive
      ? passiveComposerSteerRunning
      : selectedComposerRunning,
    selectedControl: state.stepInput
      ? stepInputControl
      : state.passive
      ? passiveComposerControl
      : selectedComposerControl,
    stepInput: state.stepInput,
    surfaceMode: state.surfaceMode,
    target: state.target,
    values: state.stepInput
      ? stepInputValues
      : state.passive || composerDraftUsesConversationComposer
      ? passiveComposerValues
      : selectedControlValues,
    workflowControls: state.stepInput
      ? workflowButtonControls
      : state.passive
      ? passiveComposerWorkflowControls
      : selectedWorkflowButtonControls
  };
}

function inputFieldsHavePublicTextarea(fields = []) {
  return (Array.isArray(fields) ? fields : []).some((field) => (
    field?.kind === "textarea" &&
    !actionInputFieldIsPrivate(field)
  ));
}

function composerInputDisabledReason({
  codexInteractionLocked = false,
  commandRunning = false,
  disabled = false,
  displayRunning = false,
  localComposerSubmissionPending = false,
  pageBusy = false,
  passiveComposerSteerRunning = false,
  remoteComposerSubmissionPending = false,
  running = false,
  stepInputSaving = false
} = {}) {
  if (!disabled) {
    return "";
  }
  if (
    localComposerSubmissionPending ||
    remoteComposerSubmissionPending ||
    passiveComposerSteerRunning
  ) {
    return "";
  }
  if (stepInputSaving) {
    return "Saving response...";
  }
  if (commandRunning) {
    return "Command is running.";
  }
  if (codexInteractionLocked || running || displayRunning) {
    return "Waiting for Codex.";
  }
  if (pageBusy) {
    return "Loading session...";
  }
  return WAITING_FOR_SESSION_CONTROLS_REASON;
}

function composerStatusLaneReason(reason = "") {
  return reason === WAITING_FOR_SESSION_CONTROLS_REASON ? reason : "";
}

function composerInlineInputDisabledReason(reason = "") {
  return composerStatusLaneReason(reason) ? "" : String(reason || "");
}

function composerStatusLaneState({
  composerStatusReason = "",
  thinkingLabel = "",
  thinkingVisible = false
} = {}) {
  return {
    label: composerStatusReason || thinkingLabel,
    visible: Boolean(thinkingVisible || composerStatusReason)
  };
}

export {
  COMPOSER_CONTROL_SURFACE_MODES,
  COMPOSER_CONTROL_TARGETS,
  CONVERSATION_COMPOSER_DRAFT_CONTROL_ID,
  CONVERSATION_COMPOSER_DRAFT_FIELD,
  CURRENT_STEP_INPUT_CONTROL_ID,
  WAITING_FOR_SESSION_CONTROLS_REASON,
  composerControlCandidateSurfaceMode,
  composerControlModeState,
  composerControlProjection,
  composerControlSurfaceMode,
  composerInlineInputDisabledReason,
  composerInputDisabledReason,
  composerStatusLaneReason,
  composerStatusLaneState,
  inputFieldsHavePublicTextarea
};
