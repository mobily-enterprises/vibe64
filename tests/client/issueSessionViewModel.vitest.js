import { describe, expect, it } from "vitest";

import {
  canUseIssueSessionTerminal,
  isClosedIssueSession,
  issueSessionCodexExpectedOutputs,
  issueSessionCodexPromptActionLabel,
  issueSessionStatusColor,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
} from "../../src/lib/issueSessionViewModel.js";

describe("issue session view model", () => {
  it("centralizes session status and terminal availability rules", () => {
    expect(isClosedIssueSession({ status: "abandoned" })).toBe(true);
    expect(isClosedIssueSession({ status: "finished" })).toBe(true);
    expect(canUseIssueSessionTerminal({
      completedSteps: ["dependencies_installed"],
      status: "running",
      worktreeReady: true
    })).toBe(true);
    expect(canUseIssueSessionTerminal({
      completedSteps: [],
      status: "running",
      worktreeReady: true
    })).toBe(false);
    expect(canUseIssueSessionTerminal({
      completedSteps: ["dependencies_installed"],
      status: "running",
      worktreeReady: false
    })).toBe(false);
    expect(canUseIssueSessionTerminal({
      completedSteps: ["dependencies_installed"],
      status: "abandoned",
      worktreeReady: true
    })).toBe(false);
    expect(issueSessionStatusColor("waiting_for_user")).toBe("warning");
  });

  it("only auto-injects Codex prompts explicitly marked for auto injection", () => {
    const structuredHandoff = {
      prompt: "Draft the issue.",
      codex: {
        expectedOutputs: [
          { field: "issue" },
          { field: "" }
        ],
        mode: "inject_prompt",
        promptField: "prompt"
      }
    };
    const sideEffectHandoff = {
      prompt: "Execute the approved plan.",
      codex: {
        autoInject: true,
        mode: "inject_prompt",
        promptActionLabel: "Execute plan",
        promptField: "prompt"
      }
    };

    expect(issueSessionCodexExpectedOutputs(structuredHandoff)).toEqual([{ field: "issue" }]);
    expect(shouldAutoInjectIssueSessionCodexPrompt(structuredHandoff)).toBe(false);
    expect(shouldUseManualIssueSessionCodexPrompt(structuredHandoff)).toBe(true);
    expect(shouldAutoInjectIssueSessionCodexPrompt(sideEffectHandoff)).toBe(true);
    expect(shouldUseManualIssueSessionCodexPrompt(sideEffectHandoff)).toBe(false);
    expect(issueSessionCodexPromptActionLabel(sideEffectHandoff)).toBe("Execute plan");
    expect(issueSessionCodexPromptActionLabel({})).toBe("Submit prompt to Codex");
    expect(shouldUseManualIssueSessionCodexPrompt({
      ...sideEffectHandoff,
      prompt: ""
    })).toBe(false);
  });

  it("derives display labels from session fields", () => {
    expect(shortIssueSessionId("2026-05-12_13-07-36")).toBe("05-12_13-07-36");
    expect(issueSessionTitleFromIssueText("# Add reports\n\nBody")).toBe("Add reports");
    expect(parseGithubSessionLink("https://github.com/example/app/issues/12", "issue")).toEqual({
      label: "Issue #12",
      repo: "example/app"
    });
    expect(parseGithubSessionLink("https://github.com/example/app/pull/34", "pr")).toEqual({
      label: "PR #34",
      repo: "example/app"
    });
  });
});
