import { describe, expect, it } from "vitest";
import {
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  isCodexThreadId,
  stripStudioContextBlocksForDisplay,
  stripTerminalControlSequences,
  terminalSnapshotOutputForDisplay,
  wrapPromptWithStudioContext
} from "../../src/lib/codexOutput.js";

describe("codexOutput terminal utilities", () => {
  it("strips terminal control sequences without parsing AI responses", () => {
    expect(stripTerminalControlSequences("\u001B[31mhello\u001B[0m")).toBe("hello");
  });

  it("keeps color while making terminal snapshots safe to replay", () => {
    const output = terminalSnapshotOutputForDisplay([
      "\u001B]0;worktree\u0007",
      "\u001B[?2026h\u001B[22;2H\u001B[K",
      "\u001B[31mhello\u001B[0m\r",
      "\u001B[25;1H\u0007\u001B[?25h"
    ].join(""));

    expect(output).toBe("\u001B[31mhello\u001B[0m\n");
  });

  it("detects Codex trust prompts", () => {
    const output = [
      "Do you trust the contents of this directory?",
      "Yes, continue",
      "No, quit",
      "Press enter to continue"
    ].join("\n");

    expect(codexTrustPromptLooksActive(output)).toBe(true);
    expect(codexTrustPromptLooksActive("> ready")).toBe(false);
  });

  it("extracts thread ids from explicit terminal metadata", () => {
    expect(extractCodexThreadId([
      "CODEX_THREAD_ID",
      "123e4567-e89b-12d3-a456-426614174000"
    ].join("\n"))).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(isCodexThreadId("v0.130.0")).toBe(false);
  });

  it("hides marked Studio prompt context from terminal display", () => {
    const terminalInput = wrapPromptWithStudioContext(
      "This is the long prompt body.",
      "Create the issue file."
    );

    expect(terminalInput).toContain("[[AI_STUDIO_CONTEXT_START]]");
    expect(stripStudioContextBlocksForDisplay(terminalInput)).toBe("Create the issue file.\n\n");
  });

  it("keeps a multiline user prompt visible outside the hidden Studio prompt context", () => {
    const terminalInput = wrapPromptWithStudioContext(
      "This is the long hidden prompt body.",
      [
        "What do you want to ask Codex?",
        "",
        "Explain this codebase."
      ].join("\n")
    );

    expect(stripStudioContextBlocksForDisplay(terminalInput)).toBe([
      "What do you want to ask Codex?",
      "",
      "Explain this codebase.",
      "",
      ""
    ].join("\n"));
  });

  it("uses the rendered prompt title as the visible Studio prompt text", () => {
    const terminalInput = wrapPromptWithStudioContext([
      "Make plan",
      "",
      "This is the long hidden prompt body."
    ].join("\n"));

    expect(stripStudioContextBlocksForDisplay(terminalInput)).toBe("Make plan\n\n");
  });
});
