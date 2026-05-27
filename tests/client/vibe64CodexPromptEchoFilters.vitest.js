import { describe, expect, it } from "vitest";

import { createCodexPromptEchoFilters } from "../../src/lib/codexPromptEchoFilters.js";

describe("Vibe64 Codex prompt echo filters", () => {
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
      "[[VIBE64_CONTEXT_START]]",
      "x".repeat(300),
      "[[VIBE64_CONTEXT_END]]"
    ].join("\n");
    filters.add({
      outputStart: 0,
      prompt: longPrompt
    });

    expect(filters.apply(`${longPrompt}\nshort answer`)).toBe("Prompt sent.\nshort answer");
  });

  it("applies prompt offsets relative to a retained output tail", () => {
    const filters = createCodexPromptEchoFilters();
    const longPrompt = [
      "[[VIBE64_CONTEXT_START]]",
      "x".repeat(300),
      "[[VIBE64_CONTEXT_END]]"
    ].join("\n");
    filters.add({
      outputStart: 300000,
      prompt: longPrompt
    });

    expect(filters.apply(`${longPrompt}\nshort answer`, {
      outputStartOffset: 300000
    })).toBe("Prompt sent.\nshort answer");
  });

  it("tracks whether a prompt echo is still pending", () => {
    const filters = createCodexPromptEchoFilters();
    filters.add({
      outputStart: 0,
      prompt: "Create the issue file"
    });

    expect(filters.hasPending()).toBe(true);
    filters.apply("Create the issue file\nCodex output");
    expect(filters.hasPending()).toBe(false);
  });

  it("stops waiting for a prompt echo after enough unrelated output arrives", () => {
    const filters = createCodexPromptEchoFilters();
    filters.add({
      outputStart: 0,
      prompt: "Create the issue file"
    });

    filters.apply("Codex output\n".repeat(200));

    expect(filters.hasPending()).toBe(false);
  });
});
