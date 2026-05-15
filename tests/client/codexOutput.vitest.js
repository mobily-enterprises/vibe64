import { describe, expect, it } from "vitest";
import {
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  isCodexThreadId,
  stripTerminalControlSequences
} from "../../src/lib/codexOutput.js";

describe("codexOutput terminal utilities", () => {
  it("strips terminal control sequences without parsing AI responses", () => {
    expect(stripTerminalControlSequences("\u001B[31mhello\u001B[0m")).toBe("hello");
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
});
