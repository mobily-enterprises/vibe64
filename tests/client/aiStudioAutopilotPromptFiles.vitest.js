import { describe, expect, it } from "vitest";
import {
  createStepCompletionToken,
  stepCompletionTokenInstruction
} from "../../src/lib/aiStudioAutopilotPromptFiles.js";

describe("aiStudioAutopilotPromptFiles", () => {
  it("creates a stable-looking completion token for the done file", () => {
    expect(createStepCompletionToken()).toMatch(/^AI_STUDIO_AUTOPILOT_DONE_[a-f0-9]{32}$/u);
  });

  it("instructs Codex to write Autopilot files instead of terminal markers", () => {
    const token = "AI_STUDIO_AUTOPILOT_DONE_1234567890abcdef1234567890abcdef";
    const instruction = stepCompletionTokenInstruction({
      actionId: "execute_plan",
      artifactsRoot: "/tmp/session/artifacts",
      requestId: "request-123",
      stepId: "plan_executed",
      token
    });

    expect(instruction).toContain("/tmp/session/artifacts/prompt-done.json");
    expect(instruction).toContain("/tmp/session/artifacts/questions.json");
    expect(instruction).toContain('"completionToken": "AI_STUDIO_AUTOPILOT_DONE_1234567890abcdef1234567890abcdef"');
    expect(instruction).toContain('"requestId": "request-123"');
    expect(instruction).toContain('"actionId": "execute_plan"');
    expect(instruction).toContain('"stepId": "plan_executed"');
    expect(instruction).not.toContain("[[AI_STUDIO_AUTOPILOT_QUESTIONS_V1]]");
  });
});
