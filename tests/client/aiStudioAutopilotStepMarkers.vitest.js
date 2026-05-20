import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX,
  AUTOPILOT_QUESTIONS_MARKER_END,
  AUTOPILOT_QUESTIONS_MARKER_START,
  createStepCompletionToken,
  latestAutopilotQuestionsMarker,
  outputHasStepCompletionToken,
  stepCompletionTokenInstruction
} from "../../src/lib/aiStudioAutopilotStepMarkers.js";

describe("aiStudioAutopilotStepMarkers", () => {
  it("creates a stable-looking completion token", () => {
    expect(createStepCompletionToken()).toMatch(/^AI_STUDIO_AUTOPILOT_DONE_[a-f0-9]{32}$/u);
  });

  it("detects the completion token in terminal output", () => {
    const token = `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`;
    const output = `Still working...\n\u001b[32m${token}\u001b[0m\n`;

    expect(outputHasStepCompletionToken(output, token)).toBe(true);
  });

  it("does not put the full token in the prompt instruction", () => {
    const token = `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`;
    const instruction = stepCompletionTokenInstruction({
      requestId: "request-123",
      token
    });

    expect(instruction).not.toContain(token);
    expect(instruction).toContain(AUTOPILOT_COMPLETION_TOKEN_PREFIX);
    expect(instruction).toContain("1234567890abcdef1234567890abcdef");
    expect(outputHasStepCompletionToken(instruction, token)).toBe(false);
  });

  it("extracts Autopilot question markers for the active request", () => {
    const output = [
      "I need one detail before continuing:",
      "1. Which database should Codex use?",
      "",
      AUTOPILOT_QUESTIONS_MARKER_START,
      JSON.stringify({
        requestId: "request-123",
        questions: [
          "Which database should Codex use?"
        ]
      }),
      AUTOPILOT_QUESTIONS_MARKER_END
    ].join("\n");

    expect(latestAutopilotQuestionsMarker(output, {
      requestId: "request-123"
    })).toEqual({
      requestId: "request-123",
      questions: [
        {
          answer: "",
          id: "q1",
          text: "Which database should Codex use?"
        }
      ]
    });
  });

  it("does not parse the prompt question example as an active question", () => {
    const instruction = stepCompletionTokenInstruction({
      requestId: "request-123",
      token: `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}1234567890abcdef1234567890abcdef`
    });

    expect(latestAutopilotQuestionsMarker(instruction, {
      requestId: "request-123"
    })).toBeNull();
  });
});
