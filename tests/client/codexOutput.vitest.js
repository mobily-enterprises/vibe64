import { describe, expect, it } from "vitest";

import {
  cleanSingleLineCodexOutput,
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  extractMarkedOutput,
  isPlaceholderMarkedOutput,
  isCodexThreadId,
  stripTerminalControlSequences
} from "../../src/lib/codexOutput.js";

describe("codex output extraction", () => {
  it("extracts the last non-empty marked output block", () => {
    const output = [
      "draft",
      "[issue_text]",
      "# Old",
      "[/issue_text]",
      "final",
      "[issue_text]",
      "# New",
      "",
      "Ship it.",
      "[/issue_text]"
    ].join("\n");

    expect(extractMarkedOutput(output, "issue_text")).toBe("# New\n\nShip it.");
  });

  it("ignores terminal control sequences around marked output", () => {
    const output = "\u001b[32m[issue_text]\n# Fix\n[/issue_text]\u001b[0m";

    expect(stripTerminalControlSequences(output)).toContain("[issue_text]");
    expect(extractMarkedOutput(output, "issue_text")).toBe("# Fix");
  });

  it("returns an empty string until the complete marker pair exists", () => {
    expect(extractMarkedOutput("[issue_text]\n# Missing close", "issue_text")).toBe("");
  });

  it("ignores placeholder-only marked output from injected prompts", () => {
    expect(isPlaceholderMarkedOutput("<short issue title>")).toBe(true);
    expect(extractMarkedOutput("[issue_title]\n<short issue title>\n[/issue_title]", "issue_title", {
      formatHint: "text"
    })).toBe("");
    expect(extractMarkedOutput("[issue_text]\n<issue body in Markdown>\n[/issue_text]", "issue_text")).toBe("");
  });

  it("cleans Codex terminal chrome from single-line marked output", () => {
    const contaminatedTitle = "›Improve documentation in @filenamegpt-5.5 default · /home/merc/Development/current/exampleapp/.jskit/sessions/active/2026-05-12_15-00-00/worktree  Add an About Us page";
    const output = [
      "[issue_title]",
      contaminatedTitle,
      "[/issue_title]",
      "[issue_text]",
      "Keep the body untouched.",
      "[/issue_text]"
    ].join("\n");

    expect(cleanSingleLineCodexOutput(contaminatedTitle)).toBe("Add an About Us page");
    expect(extractMarkedOutput(output, "issue_title", {
      formatHint: "text"
    })).toBe("Add an About Us page");
    expect(extractMarkedOutput(output, "issue_text")).toBe("Keep the body untouched.");
  });

  it("detects the interactive Codex trust prompt", () => {
    const output = [
      "> You are in /workspace/.jskit/sessions/active/example/worktree",
      "",
      "Do you trust the contents of this directory?",
      "",
      "› 1. Yes, continue",
      "  2. No, quit",
      "",
      "Press enter to continue"
    ].join("\n");

    expect(codexTrustPromptLooksActive(output)).toBe(true);
    expect(codexTrustPromptLooksActive("> ready")).toBe(false);
  });

  it("extracts Codex thread ids only when the echoed environment variable produced a UUID-shaped id", () => {
    expect(extractCodexThreadId([
      "Codex ready.",
      "!echo $CODEX_THREAD_ID",
      "019e1575-2458-7b93-bf9d-e7d7ffd49ad2"
    ].join("\n"))).toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
  });

  it("rejects CLI versions and other nearby terminal tokens as Codex thread ids", () => {
    expect(isCodexThreadId("v0.130.0")).toBe(false);
    expect(extractCodexThreadId([
      "Codex ready.",
      "!echo $CODEX_THREAD_ID",
      "codex-cli v0.130.0",
      "ready"
    ].join("\n"))).toBe("");
  });
});
