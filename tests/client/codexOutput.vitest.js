import { describe, expect, it } from "vitest";

import {
  cleanSingleLineCodexOutput,
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  extractMarkedOutputBlocks,
  extractMarkedOutputDetails,
  extractMarkedOutput,
  isPlaceholderMarkedOutput,
  isCodexThreadId,
  outputAfterPromptStart,
  suffixPrefixOverlapLength,
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

  it("reports the source block used for a marked output", () => {
    const firstOutput = [
      "[issue_text]",
      "# Same",
      "[/issue_text]"
    ].join("\n");
    const secondOutput = [
      firstOutput,
      "retry",
      "[issue_text]",
      "# Same",
      "[/issue_text]"
    ].join("\n");

    const first = extractMarkedOutputDetails(firstOutput, "issue_text");
    const second = extractMarkedOutputDetails(secondOutput, "issue_text");

    expect(first.value).toBe("# Same");
    expect(second.value).toBe("# Same");
    expect(first.signature).not.toBe(second.signature);
  });

  it("returns all usable marked output blocks in terminal order", () => {
    const output = [
      "[jskit_step_result]",
      "status: complete",
      "step: automated_checks_run",
      "summary: Wrong step marker.",
      "[/jskit_step_result]",
      "terminal repaint",
      "[jskit_step_result]",
      "status: complete",
      "step: plan_executed",
      "summary: Correct step marker.",
      "[/jskit_step_result]"
    ].join("\n");

    const blocks = extractMarkedOutputBlocks(output, "jskit_step_result");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].value).toContain("step: automated_checks_run");
    expect(blocks[1].value).toContain("step: plan_executed");
  });

  it("ignores terminal control sequences around marked output", () => {
    const output = "\u001b[32m[issue_text]\n# Fix\n[/issue_text]\u001b[0m";

    expect(stripTerminalControlSequences(output)).toContain("[issue_text]");
    expect(extractMarkedOutput(output, "issue_text")).toBe("# Fix");
  });

  it("normalizes Codex repaint text glued onto marker lines", () => {
    const output = [
      "• [plan]›Improve documentation in @filenamegpt-5.3-codex-spark default · /home/merc/app/.jskit/sessions/active/20…\u001b[0 q",
      "  Issue category: tooling\u001b[0 q",
      "  UI impact: none\u001b[0 q",
      "  [/plan]\u001b[0 q"
    ].join("\r\n");

    expect(extractMarkedOutput(output, "plan")).toBe([
      "Issue category: tooling",
      "  UI impact: none"
    ].join("\n"));
  });

  it("ignores standalone terminal control bytes after marker lines", () => {
    const output = [
      "[jskit_step_result]",
      "status: complete",
      "step: plan_executed",
      "summary: Created thirteen.md and checked git status.›Use /skills to list available skillsgpt-5.3-codex-spark default · /home/merc/Development/current/exampleapp/.jskit/sessions/active/20…",
      "[/jskit_step_result]\u0007"
    ].join("\n");

    expect(extractMarkedOutput(output, "jskit_step_result")).toBe([
      "status: complete",
      "step: plan_executed",
      "summary: Created thirteen.md and checked git status."
    ].join("\n"));
  });

  it("strips terminal control wrappers without removing response text", () => {
    const escape = "\u001b";
    const output = [
      `${escape}]0;codex title\u0007${escape}[32m[issue_text]${escape}[0m`,
      `${escape}Pignored terminal payload${escape}\\Keep this text${escape}[?25h`,
      `Still keep this text${escape}c`,
      `[/issue_text]\u009b0m`
    ].join("\n");

    expect(extractMarkedOutput(output, "issue_text")).toBe([
      "Keep this text",
      "Still keep this text"
    ].join("\n"));
  });

  it("returns an empty string until the complete marker pair exists", () => {
    expect(extractMarkedOutput("[issue_text]\n# Missing close", "issue_text")).toBe("");
  });

  it("discards an incomplete block when the same marker starts again before the close", () => {
    const output = [
      "[issue_text]",
      "First answer started but never closed.",
      "──────────",
      "› Repeat respond following required format",
      "[issue_title]",
      "Add root file eight.md with exact content eight",
      "[/issue_title]",
      "",
      "[issue_text]",
      "Second answer is complete.",
      "",
      "## Acceptance criteria",
      "",
      "- eight.md exists.",
      "[/issue_text]"
    ].join("\n");

    expect(extractMarkedOutput(output, "issue_text")).toBe([
      "Second answer is complete.",
      "",
      "## Acceptance criteria",
      "",
      "- eight.md exists."
    ].join("\n"));
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

  it("cleans Codex terminal chrome from multiline marked output", () => {
    const output = [
      "[plan]",
      "›Use /skills to list available skillsgpt-5.5 default · /home/merc/Development/current/exampleapp/.jskit/sessions/active/2026-05-13_23-00-00/worktree  Issue category: client",
      "",
      "Implementation lane: custom local code.",
      "",
      "1. Add four.md.",
      "[/plan]"
    ].join("\n");

    expect(extractMarkedOutput(output, "plan")).toBe([
      "Issue category: client",
      "",
      "Implementation lane: custom local code.",
      "",
      "1. Add four.md."
    ].join("\n"));
  });

  it("removes inline Codex status trailers from marked content lines", () => {
    const output = [
      "[plan]",
      "## Implementation lane›Write tests for @filenamegpt-5.3-codex-spark default · /home/merc/Development/current/exampleapp/.jskit/sessions/active/2026-05-14_18-40-39/worktree",
      "",
      "- custom local code",
      "",
      "Exact text: victory›Improve documentation in @filenamegpt-5.3-codex-spark default · /home/merc/Development/current/exampleapp/.jskit/sessions/active/2026-05-14_18-40-39/worktree",
      "[/plan]"
    ].join("\n");

    expect(extractMarkedOutput(output, "plan")).toBe([
      "## Implementation lane",
      "",
      "- custom local code",
      "",
      "Exact text: victory"
    ].join("\n"));
  });

  it("ignores Codex terminal repaint fragments on marker lines", () => {
    const output = [
      "• [issue_text]",
      "Create eight.txt at the repository root.",
      "",
      "- Content: eight",
      "[/issue_text]",
      "",
      "• [issue_text]›Summarize recent commitsgpt-5.3-codex-spark default · /workspace/.jskit/sessions/active/example/worktree  block.W",
      "[/issue_text]"
    ].join("\n");

    expect(extractMarkedOutput(output, "issue_text")).toBe([
      "Create eight.txt at the repository root.",
      "",
      "- Content: eight"
    ].join("\n"));
  });

  it("uses the retained terminal snapshot when prompt offset was trimmed away", () => {
    const snapshot = [
      "[plan]",
      "Old plan that must not be reused.",
      "[/plan]",
      "shared retained tail"
    ].join("\n");
    const retainedOutput = [
      "shared retained tail",
      "• [plan]",
      "Update nine.md to contain nine!!.",
      "[/plan]"
    ].join("\n");

    const parseWindow = outputAfterPromptStart({
      output: retainedOutput,
      prompt: "Create a revised plan.",
      promptOutputSnapshot: snapshot,
      promptStart: retainedOutput.length
    });

    expect(suffixPrefixOverlapLength(snapshot, retainedOutput)).toBe("shared retained tail".length);
    expect(extractMarkedOutput(parseWindow, "plan")).toBe("Update nine.md to contain nine!!.");
  });

  it("does not reuse old marked output while waiting for a new post-prompt answer", () => {
    const snapshot = [
      "[plan]",
      "Old plan.",
      "[/plan]",
      "shared retained tail"
    ].join("\n");

    const parseWindow = outputAfterPromptStart({
      output: snapshot,
      prompt: "Create a revised plan.",
      promptOutputSnapshot: snapshot,
      promptStart: snapshot.length
    });

    expect(parseWindow).toBe("");
    expect(extractMarkedOutput(parseWindow, "plan")).toBe("");
  });

  it("does not parse result markers from the echoed injected prompt", () => {
    const prompt = [
      "Run deslop.",
      "",
      "At the very end, include:",
      "[deslop_result]",
      "priority: high | medium | low",
      "title: Short finding title",
      "[/deslop_result]"
    ].join("\n");
    const beforePrompt = "terminal before prompt\n";

    const parseWindow = outputAfterPromptStart({
      output: `${beforePrompt}${prompt}`,
      prompt,
      promptOutputSnapshot: beforePrompt,
      promptStart: beforePrompt.length
    });

    expect(extractMarkedOutput(parseWindow, "deslop_result")).toBe("");
  });

  it("parses result markers after removing the echoed injected prompt", () => {
    const prompt = [
      "Run automated checks.",
      "",
      "[jskit_step_result]",
      "status: complete",
      "step: automated_checks_run",
      "summary: Placeholder summary.",
      "[/jskit_step_result]"
    ].join("\n");
    const beforePrompt = "terminal before prompt\n";
    const answer = [
      "",
      "Checks passed.",
      "[jskit_step_result]",
      "status: complete",
      "step: automated_checks_run",
      "summary: npm run verify passed.",
      "[/jskit_step_result]"
    ].join("\n");

    const parseWindow = outputAfterPromptStart({
      output: `${beforePrompt}${prompt}${answer}`,
      prompt,
      promptOutputSnapshot: beforePrompt,
      promptStart: beforePrompt.length
    });

    expect(extractMarkedOutput(parseWindow, "jskit_step_result")).toContain("npm run verify passed.");
    expect(extractMarkedOutput(parseWindow, "jskit_step_result")).not.toContain("Placeholder summary.");
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
      "! echo $CODEX_THREAD_ID",
      "019e1575-2458-7b93-bf9d-e7d7ffd49ad2"
    ].join("\n"))).toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
  });

  it("rejects CLI versions and other nearby terminal tokens as Codex thread ids", () => {
    expect(isCodexThreadId("v0.130.0")).toBe(false);
    expect(extractCodexThreadId([
      "Codex ready.",
      "! echo $CODEX_THREAD_ID",
      "codex-cli v0.130.0",
      "ready"
    ].join("\n"))).toBe("");
  });
});
