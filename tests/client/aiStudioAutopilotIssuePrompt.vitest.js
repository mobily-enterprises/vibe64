import { describe, expect, it } from "vitest";
import {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
} from "../../src/lib/aiStudioAutopilotIssuePrompt.js";
import {
  stripStudioContextBlocksForDisplay
} from "../../src/lib/codexOutput.js";

describe("aiStudioAutopilotIssuePrompt", () => {
  it("shows only the short visible prompt while hiding the long file instructions", () => {
    const prompt = buildInitialIssueDraftPrompt({
      artifactsRoot: "/tmp/session/artifacts",
      requestId: "request-123",
      requestText: "Add booking reports"
    });
    const visiblePrompt = stripStudioContextBlocksForDisplay(prompt);

    expect(visiblePrompt).toBe("Write questions.json or issue-draft.json.\n\n");
    expect(visiblePrompt).not.toContain("Add booking reports");
    expect(visiblePrompt).not.toContain("/tmp/session/artifacts");
    expect(prompt).toContain("/tmp/session/artifacts/questions.json");
    expect(prompt).toContain("/tmp/session/artifacts/issue-draft.json");
    expect(prompt).toContain("If clarification is needed, ask the minimum useful number of questions, up to three.");
    expect(prompt).toContain("a deliberate one-word session label");
    expect(prompt).toContain("\"word\": \"Label\"");
    expect(prompt).toContain("If the user explicitly asks to be asked questions, honor that request before producing the issue.");
    expect(prompt).toContain("When honoring an explicit question request, ask the requested number of questions, capped at three.");
    expect(prompt).toContain("Do not dismiss an explicit question request as test noise or as unrelated to issue scope.");
  });

  it("builds a hidden answer follow-up prompt", () => {
    const prompt = buildAnsweredIssueDraftPrompt({
      artifactsRoot: "/tmp/session/artifacts",
      questions: [
        {
          answer: "Admins only.",
          text: "Who can see the report?"
        }
      ],
      requestId: "request-456",
      requestText: "Add booking reports"
    });
    const visiblePrompt = stripStudioContextBlocksForDisplay(prompt);

    expect(visiblePrompt).toBe("Write questions.json or issue-draft.json.\n\n");
    expect(visiblePrompt).not.toContain("Admins only.");
    expect(visiblePrompt).not.toContain("Who can see the report?");
    expect(prompt).toContain("Q1: Who can see the report?");
    expect(prompt).toContain("A1: Admins only.");
  });
});
