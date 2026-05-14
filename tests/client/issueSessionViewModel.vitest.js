import { describe, expect, it } from "vitest";

import {
  canUseIssueSessionTerminal,
  isClosedIssueSession,
  issueSessionCodexExpectedOutputs,
  issueSessionFacts,
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

  it("uses JSKIT response contract fields before legacy expected outputs", () => {
    expect(issueSessionCodexExpectedOutputs({
      codex: {
        expectedOutputs: [{ field: "legacy", extract: "legacy" }],
        responseContract: {
          fields: [
            { field: "issueTitle", extract: "issue_title", options: [{ label: "Bug", value: "bug" }] },
            { field: "", extract: "ignored" }
          ]
        }
      }
    })).toEqual([
      { field: "issueTitle", extract: "issue_title", options: [{ label: "Bug", value: "bug" }] }
    ]);
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

  it("builds compact live session facts without noisy rollup cards", () => {
    const facts = issueSessionFacts({
      agentDecisionsLatest: "Decision text",
      bluePrintNoise: "ignored",
      blueprintExists: true,
      blueprintPath: "/workspace/.jskit/APP_BLUEPRINT.md",
      branch: "jskit-studio/example",
      checks: [{ ok: true, stepId: "automated_checks_run" }],
      codexThreadId: "019e1575-2458-7b93-bf9d-e7d7ffd49ad2",
      completedSteps: ["session_created", "worktree_created"],
      currentStep: "plan_made",
      githubComments: { issue_details: "commented" },
      issueText: "# Add reports\n\nBody",
      issueTitle: "Add reports",
      issueUrl: "https://github.com/example/app/issues/12",
      reviewPasses: [{ pass: "001", status: "accepted" }],
      sessionId: "2026-05-12_13-07-36",
      sessionRoot: "/workspace/.jskit/sessions/active/2026-05-12_13-07-36",
      uiChecks: [{ status: "skipped", stepId: "deep_ui_check_run" }],
      worktree: "/workspace/.jskit/sessions/active/2026-05-12_13-07-36/worktree",
      worktreeReady: true
    }, [
      { id: "session_created", index: 0, label: "Session created" },
      { id: "worktree_created", index: 1, label: "Worktree created" },
      { id: "plan_made", index: 2, label: "Plan made" }
    ]);

    expect(facts.map((fact) => fact.key)).toEqual([
      "step",
      "session",
      "worktree",
      "codex",
      "branch",
      "issue",
      "blueprint"
    ]);
    expect(facts.find((fact) => fact.key === "step")?.value).toBe("Plan made");
    expect(facts.find((fact) => fact.key === "issue")?.value).toBe("Issue #12");
    expect(facts.find((fact) => fact.key === "blueprint")?.href)
      .toBe("file:///workspace/.jskit/APP_BLUEPRINT.md");
    expect(facts.some((fact) => fact.label === "Rework Cycle")).toBe(false);
    expect(facts.some((fact) => fact.label === "Checks")).toBe(false);
    expect(facts.some((fact) => fact.label === "UI Checks")).toBe(false);
    expect(facts.some((fact) => fact.label === "Review Passes")).toBe(false);
    expect(facts.some((fact) => fact.label === "GitHub Comments")).toBe(false);
    expect(facts.some((fact) => fact.label === "Agent Decisions")).toBe(false);
  });

  it("uses step definition labels instead of action button labels for the current step card", () => {
    const facts = issueSessionFacts({
      completedSteps: [],
      currentStep: "user_check_completed",
      currentStepAction: {
        buttonLabel: "I am done"
      },
      sessionId: "2026-05-12_13-07-36"
    }, [
      {
        id: "group:user_check",
        index: 10,
        label: "User check",
        sourceStepIds: ["user_check_completed"]
      }
    ]);

    expect(facts.find((fact) => fact.key === "step")?.value).toBe("User check");
  });
});
