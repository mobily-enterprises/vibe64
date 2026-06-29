import { describe, expect, it } from "vitest";

import {
  COMPOSER_CONTROL_SURFACE_MODES,
  COMPOSER_CONTROL_TARGETS,
  composerControlCandidateSurfaceMode,
  composerControlProjection,
  composerControlSurfaceMode,
  composerInlineInputDisabledReason,
  composerInputDisabledReason,
  composerStatusLaneReason,
  composerStatusLaneState,
  inputFieldsHavePublicTextarea
} from "../../src/lib/vibe64AutopilotComposerControlModel.js";

describe("vibe64 autopilot composer control model", () => {
  it("resolves composer surface modes by the screen priority order", () => {
    expect(composerControlCandidateSurfaceMode({
      composerVisible: true,
      selectedScreenAnswerChoicesVisible: true,
      selectedScreenControlVisible: true,
      stepInputFormVisible: true
    })).toBe(COMPOSER_CONTROL_SURFACE_MODES.ANSWER_CHOICES);
    expect(composerControlCandidateSurfaceMode({
      composerVisible: true,
      selectedScreenControlVisible: true,
      stepInputFormVisible: true
    })).toBe(COMPOSER_CONTROL_SURFACE_MODES.SELECTED_CONTROL);
    expect(composerControlCandidateSurfaceMode({
      composerVisible: true,
      stepInputFormVisible: true
    })).toBe(COMPOSER_CONTROL_SURFACE_MODES.STEP_INPUT);
    expect(composerControlCandidateSurfaceMode({
      composerVisible: true
    })).toBe(COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER);
    expect(composerControlCandidateSurfaceMode()).toBe(COMPOSER_CONTROL_SURFACE_MODES.HIDDEN);

    expect(composerControlSurfaceMode({
      candidateMode: COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER,
      passiveComposerVisible: false
    })).toBe(COMPOSER_CONTROL_SURFACE_MODES.HIDDEN);
    expect(composerControlSurfaceMode({
      candidateMode: COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER,
      passiveComposerVisible: true
    })).toBe(COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER);
  });

  it("projects passive composer mode from one target model", () => {
    const passiveControl = {
      id: "passive"
    };
    const passiveFields = [{
      kind: "textarea",
      name: "conversationRequest"
    }];
    const passiveValues = {
      conversationRequest: "Keep going."
    };
    const passiveWorkflowControls = [{
      id: "continue"
    }];
    const projection = composerControlProjection({
      codexInterruptVisible: true,
      mode: COMPOSER_CONTROL_SURFACE_MODES.PASSIVE_COMPOSER,
      passiveComposerCanSubmit: true,
      passiveComposerControl: passiveControl,
      passiveComposerFields: passiveFields,
      passiveComposerInputDisabled: true,
      passiveComposerSteeringModeActive: true,
      passiveComposerSteerRunning: true,
      passiveComposerValues: passiveValues,
      passiveComposerWorkflowControls: passiveWorkflowControls
    });

    expect(projection.target).toBe(COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER);
    expect(projection.agentControlsVisible).toBe(false);
    expect(projection.attachmentsEnabled).toBe(true);
    expect(projection.canSubmit).toBe(true);
    expect(projection.fields).toBe(passiveFields);
    expect(projection.formVisible).toBe(true);
    expect(projection.inlineSubmit).toBe(true);
    expect(projection.inlineSubmitLabelVisible).toBe(true);
    expect(projection.inputDisabled).toBe(true);
    expect(projection.interruptVisible).toBe(true);
    expect(projection.running).toBe(true);
    expect(projection.selectedControl).toBe(passiveControl);
    expect(projection.values).toBe(passiveValues);
    expect(projection.workflowControls).toBe(passiveWorkflowControls);
  });

  it("projects step input mode without attachments and only inlines public textareas", () => {
    const stepInputControl = {
      id: "current_step_input"
    };
    const stepInputFields = [{
      kind: "textarea",
      name: "response"
    }];
    const stepInputValues = {
      response: "Retry"
    };
    const workflowButtonControls = [{
      id: "skip"
    }];
    const projection = composerControlProjection({
      mode: COMPOSER_CONTROL_SURFACE_MODES.STEP_INPUT,
      stepInputCanSubmit: true,
      stepInputControl,
      stepInputFields,
      stepInputSaving: true,
      stepInputValues,
      workflowButtonControls
    });

    expect(projection.target).toBe(COMPOSER_CONTROL_TARGETS.STEP_INPUT);
    expect(projection.attachmentsEnabled).toBe(false);
    expect(projection.canSubmit).toBe(true);
    expect(projection.inlineSubmit).toBe(true);
    expect(projection.inputDisabled).toBe(true);
    expect(projection.running).toBe(true);
    expect(projection.selectedControl).toBe(stepInputControl);
    expect(projection.values).toBe(stepInputValues);
    expect(projection.workflowControls).toBe(workflowButtonControls);
    expect(inputFieldsHavePublicTextarea([{
      kind: "textarea",
      name: "secret",
      privacy: "private"
    }])).toBe(false);
  });

  it("keeps workflow decision controls as the only submit surface for current-step input", () => {
    const stepInputControl = {
      id: "current_step_input"
    };
    const stepInputFields = [
      {
        kind: "text",
        name: "title"
      },
      {
        kind: "textarea",
        name: "body"
      }
    ];
    const workflowButtonControls = [{
      id: "continue"
    }];
    const projection = composerControlProjection({
      mode: COMPOSER_CONTROL_SURFACE_MODES.STEP_INPUT,
      stepInputCanSubmit: true,
      stepInputControl,
      stepInputDecisionControlsVisible: true,
      stepInputFields,
      workflowButtonControls
    });

    expect(projection.canSubmit).toBe(false);
    expect(projection.fields).toBe(stepInputFields);
    expect(projection.inlineSubmit).toBe(false);
    expect(projection.inlineSubmitLabelVisible).toBe(false);
    expect(projection.workflowControls).toBe(workflowButtonControls);
  });

  it("projects selected control mode while sharing the conversation composer draft value", () => {
    const selectedComposerControl = {
      id: "talk_to_codex"
    };
    const selectedControlFields = [{
      kind: "textarea",
      name: "conversationRequest"
    }];
    const selectedControlValues = {
      conversationRequest: "Selected draft"
    };
    const passiveComposerValues = {
      conversationRequest: "Shared draft"
    };
    const selectedWorkflowButtonControls = [{
      id: "continue"
    }];
    const projection = composerControlProjection({
      canSubmitSelectedControl: true,
      codexStopEnabled: true,
      codexStopVisible: true,
      composerDraftUsesConversationComposer: true,
      mode: COMPOSER_CONTROL_SURFACE_MODES.SELECTED_CONTROL,
      passiveComposerValues,
      selectedComposerControl,
      selectedControlFields,
      selectedControlUsesConversationComposer: true,
      selectedControlValues,
      selectedWorkflowButtonControls
    });

    expect(projection.target).toBe(COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL);
    expect(projection.agentControlsVisible).toBe(true);
    expect(projection.attachmentsEnabled).toBe(true);
    expect(projection.canSubmit).toBe(true);
    expect(projection.fields).toBe(selectedControlFields);
    expect(projection.inlineSubmit).toBe(true);
    expect(projection.interruptDisabled).toBe(false);
    expect(projection.interruptVisible).toBe(true);
    expect(projection.selectedControl).toBe(selectedComposerControl);
    expect(projection.values).toBe(passiveComposerValues);
    expect(projection.values).not.toBe(selectedControlValues);
    expect(projection.workflowControls).toBe(selectedWorkflowButtonControls);
  });

  it("keeps waiting-for-controls in the status lane instead of the inline input", () => {
    const reason = composerInputDisabledReason({
      disabled: true
    });

    expect(reason).toBe("Waiting for session controls.");
    expect(composerStatusLaneReason(reason)).toBe("Waiting for session controls.");
    expect(composerInlineInputDisabledReason(reason)).toBe("");
    expect(composerStatusLaneState({
      composerStatusReason: composerStatusLaneReason(reason),
      thinkingLabel: "Thinking...",
      thinkingVisible: false
    })).toEqual({
      label: "Waiting for session controls.",
      visible: true
    });
    expect(composerInlineInputDisabledReason("Sending to Codex...")).toBe("");
    expect(composerInlineInputDisabledReason("Thinking...")).toBe("");
  });
});
