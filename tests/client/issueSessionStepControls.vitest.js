import { describe, expect, it } from "vitest";

import { buildActiveStepControls } from "../../src/lib/issueSessionStepControls.js";

describe("issue session step controls", () => {
  it("shows execute step for a recovered Codex prompt step before prompt injection", () => {
    expect(buildActiveStepControls({
      actionKind: "codex_prompt",
      automationMode: "codex_prompt",
      selectedSessionId: "session-1"
    })).toMatchObject({
      canExecuteStep: true,
      showExecuteStep: true,
      showGoNext: false
    });
  });

  it("shows go next for a non-form Codex prompt step after Codex is idle", () => {
    expect(buildActiveStepControls({
      actionKind: "codex_prompt",
      automationMode: "codex_prompt",
      codexPromptAlreadyRequested: true,
      selectedSessionId: "session-1"
    })).toMatchObject({
      canGoNext: true,
      showExecuteStep: false,
      showGoNext: true
    });
  });

  it("hides go next when a required Codex completion marker is missing", () => {
    expect(buildActiveStepControls({
      actionKind: "codex_prompt",
      automationMode: "codex_prompt",
      codexPromptAlreadyRequested: true,
      requiredCompletionMissing: true,
      selectedSessionId: "session-1"
    })).toMatchObject({
      canGoNext: false,
      showGoNext: false
    });
  });

  it("hides go next while Codex is working", () => {
    expect(buildActiveStepControls({
      actionKind: "codex_prompt",
      automationMode: "codex_prompt",
      codexPromptAlreadyRequested: true,
      codexWorking: true,
      selectedSessionId: "session-1"
    })).toMatchObject({
      canGoNext: false,
      showGoNext: true
    });
  });

  it("shows execute step for JSKIT immediate automation", () => {
    expect(buildActiveStepControls({
      actionKind: "automatic",
      automationMode: "immediate",
      selectedSessionId: "session-1"
    })).toMatchObject({
      canExecuteStep: true,
      showExecuteStep: true,
      showGoNext: false
    });
  });

  it("uses form submit controls instead of go next for form steps", () => {
    expect(buildActiveStepControls({
      actionKind: "codex_output",
      canRunAction: true,
      codexOutputFormVisible: true,
      selectedSessionId: "session-1"
    })).toMatchObject({
      canSubmitForm: true,
      hasForm: true,
      showFormSubmit: true,
      showGoNext: false
    });
  });

  it("shows go next for non-form user checks", () => {
    expect(buildActiveStepControls({
      actionKind: "user_check",
      selectedSessionId: "session-1",
      selectedStepInputType: "none"
    })).toMatchObject({
      canGoNext: true,
      showGoNext: true
    });
  });
});
