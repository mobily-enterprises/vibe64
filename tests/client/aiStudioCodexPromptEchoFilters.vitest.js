import { describe, expect, it } from "vitest";

import { createCodexPromptEchoFilters } from "../../src/lib/codexPromptEchoFilters.js";

describe("AI Studio Codex prompt echo filters", () => {
  it("replaces a visible echoed prompt with a short status message", () => {
    const filters = createCodexPromptEchoFilters();
    filters.add({
      outputStart: 8,
      prompt: "Create the issue file"
    });

    expect(filters.apply("prefix: Create the issue file\nCodex output"))
      .toBe("prefix: Create the issue file\nCodex output");
    expect(filters.apply("terminalCreate the issue file\nCodex output"))
      .toBe("terminalCreate the issue file\nCodex output");
  });

  it("hides long marked Studio prompt context without leaking the full prompt", () => {
    const filters = createCodexPromptEchoFilters();
    const longPrompt = [
      "[[AI_STUDIO_CONTEXT_START]]",
      "x".repeat(300),
      "[[AI_STUDIO_CONTEXT_END]]"
    ].join("\n");
    filters.add({
      outputStart: 0,
      prompt: longPrompt
    });

    expect(filters.apply(`${longPrompt}\nshort answer`)).toBe("Prompt sent.\nshort answer");
  });
});
