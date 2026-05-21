import { describe, expect, it } from "vitest";

import {
  aiStudioSessionDisplayTitle,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  buildAiStudioSessionFacts,
  isClosedAiStudioSession,
  isOpenAiStudioSession,
  parseGithubSessionLink,
  shortAiStudioSessionId
} from "../../src/lib/aiStudioSessionViewModel.js";

describe("AI Studio session view model", () => {
  it("centralizes session status labels and colors", () => {
    expect(isClosedAiStudioSession({ status: "abandoned" })).toBe(true);
    expect(isClosedAiStudioSession({ status: "finished" })).toBe(true);
    expect(isOpenAiStudioSession({ status: "active" })).toBe(true);
    expect(aiStudioSessionStatusLabel("waiting_for_user")).toBe("waiting for user");
    expect(aiStudioSessionStatusColor("waiting_for_user")).toBe("warning");
    expect(aiStudioSessionStatusColor("abandoned")).toBe("error");
    expect(aiStudioSessionStatusColor("finished")).toBe("success");
  });

  it("derives stable display titles and GitHub link labels", () => {
    expect(shortAiStudioSessionId("2026-05-12_13-07-36")).toBe("05-12_13-07-36");
    expect(aiStudioSessionDisplayTitle({
      issueTitle: "Add reports dashboard",
      sessionId: "2026-05-12_13-07-36",
      sessionName: "Reports"
    })).toBe("Reports");
    expect(aiStudioSessionDisplayTitle({
      metadata: {
        issue_word: "Billing"
      },
      sessionId: "2026-05-12_13-07-36"
    })).toBe("Billing");
    expect(aiStudioSessionDisplayTitle({
      issueTitle: "  Add reports dashboard  ",
      sessionId: "2026-05-12_13-07-36"
    })).toBe("Add reports dashboard");
    expect(aiStudioSessionDisplayTitle({
      sessionId: "2026-05-12_13-07-36"
    })).toBe("Session 05-12_13-07-36");
    expect(parseGithubSessionLink("https://github.com/example/app/issues/12", "issue")).toEqual({
      label: "Issue #12",
      repo: "example/app"
    });
    expect(parseGithubSessionLink("https://github.com/example/app/pull/34", "pr")).toEqual({
      label: "PR #34",
      repo: "example/app"
    });
  });

  it("builds compact session facts from current runtime fields only", () => {
    const facts = buildAiStudioSessionFacts({
      blueprintExists: true,
      blueprintPath: "/workspace/.jskit/APP_BLUEPRINT.md",
      branch: "ai-studio/example",
      codexThreadId: "019e1575-2458-7b93-bf9d-e7d7ffd49ad2",
      completedSteps: ["session_created", "worktree_created"],
      currentStep: "plan_made",
      issueTitle: "Add reports",
      issueUrl: "https://github.com/example/app/issues/12",
      prOutcome: {
        mergedAt: "2026-05-16T01:02:03.000Z",
        outcome: "merged"
      },
      prUrl: "https://github.com/example/app/pull/34",
      artifactReadiness: {
        "report.md": {
          nonEmpty: true
        }
      },
      artifactsRoot: "/workspace/.ai-studio/sessions/active/session/artifacts",
      pullRequestPath: "/workspace/.ai-studio/sessions/active/session/artifacts/pull_request.md",
      sessionId: "2026-05-12_13-07-36",
      sessionRoot: "/workspace/.ai-studio/sessions/active/2026-05-12_13-07-36",
      worktree: "/workspace/.ai-studio/sessions/active/2026-05-12_13-07-36/worktree",
      worktreeReady: true
    }, [
      { id: "session_created", index: 0, label: "Create session" },
      { id: "worktree_created", index: 1, label: "Create worktree" },
      { id: "plan_made", index: 2, label: "Make plan" }
    ]);

    expect(facts.map((fact) => fact.key)).toEqual([
      "step",
      "session",
      "worktree",
      "codex",
      "branch",
      "issue",
      "pr",
      "blueprint",
      "session-report",
      "pull-request-draft",
      "pr-outcome"
    ]);
    expect(facts.find((fact) => fact.key === "step")?.value).toBe("Make plan");
    expect(facts.find((fact) => fact.key === "issue")?.value).toBe("Issue #12");
    expect(facts.find((fact) => fact.key === "pr")?.value).toBe("PR #34");
    expect(facts.find((fact) => fact.key === "blueprint")?.href)
      .toBe("file:///workspace/.jskit/APP_BLUEPRINT.md");
    expect(facts.find((fact) => fact.key === "session-report")?.href)
      .toBe("file:///workspace/.ai-studio/sessions/active/session/artifacts/report.md");
    expect(facts.find((fact) => fact.key === "pr-outcome")?.value).toBe("merged");
  });
});
