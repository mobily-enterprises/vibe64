import { describe, expect, it } from "vitest";

import {
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  buildVibe64SessionFacts,
  isClosedVibe64Session,
  isOpenVibe64Session,
  parseGithubSessionLink,
  shortVibe64SessionId
} from "../../src/lib/vibe64SessionViewModel.js";

describe("Vibe64 session view model", () => {
  it("centralizes session status labels and colors", () => {
    expect(isClosedVibe64Session({ status: "abandoned" })).toBe(true);
    expect(isClosedVibe64Session({ status: "finished" })).toBe(true);
    expect(isOpenVibe64Session({ status: "active" })).toBe(true);
    expect(vibe64SessionStatusLabel("waiting_for_user")).toBe("waiting for user");
    expect(vibe64SessionStatusColor("waiting_for_user")).toBe("warning");
    expect(vibe64SessionStatusColor("abandoned")).toBe("error");
    expect(vibe64SessionStatusColor("finished")).toBe("success");
  });

  it("derives stable display titles and GitHub link labels", () => {
    expect(shortVibe64SessionId("2026-05-12_13-07-36")).toBe("05-12_13-07-36");
    expect(vibe64SessionDisplayTitle({
      issueTitle: "Add reports dashboard",
      sessionId: "2026-05-12_13-07-36",
      sessionName: "Reports"
    })).toBe("Reports");
    expect(vibe64SessionDisplayTitle({
      metadata: {
        issue_word: "Billing"
      },
      sessionId: "2026-05-12_13-07-36"
    })).toBe("Billing");
    expect(vibe64SessionDisplayTitle({
      issueTitle: "  Add reports dashboard  ",
      sessionId: "2026-05-12_13-07-36"
    })).toBe("Add reports dashboard");
    expect(vibe64SessionDisplayTitle({
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
    const facts = buildVibe64SessionFacts({
      blueprintExists: true,
      blueprintPath: "/workspace/.jskit/APP_BLUEPRINT.md",
      branch: "vibe64/example",
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
      reportPath: "/workspace/.vibe64/sessions/active/session/artifacts/report.md",
      sessionId: "2026-05-12_13-07-36",
      sessionRoot: "/workspace/.vibe64/sessions/active/2026-05-12_13-07-36",
      worktree: "/workspace/.vibe64/sessions/active/2026-05-12_13-07-36/worktree",
      worktreeReady: true
    }, [
      { id: "session_created", index: 0, label: "Create session" },
      { id: "worktree_created", index: 1, label: "Create worktree" },
      { id: "plan_made", index: 2, label: "Make a plan for the issue" }
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
      "pr-outcome"
    ]);
    expect(facts.find((fact) => fact.key === "step")?.value).toBe("Make a plan for the issue");
    expect(facts.find((fact) => fact.key === "issue")?.value).toBe("Issue #12");
    expect(facts.find((fact) => fact.key === "pr")?.value).toBe("PR #34");
    expect(facts.find((fact) => fact.key === "blueprint")?.href)
      .toBe("file:///workspace/.jskit/APP_BLUEPRINT.md");
    expect(facts.find((fact) => fact.key === "session-report")?.href)
      .toBe("file:///workspace/.vibe64/sessions/active/session/artifacts/report.md");
    expect(facts.find((fact) => fact.key === "pr-outcome")?.value).toBe("merged");
  });
});
