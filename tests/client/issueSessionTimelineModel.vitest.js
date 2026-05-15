import { describe, expect, it } from "vitest";

import {
  groupedIssueSessionSteps,
  issueSessionDisplayStepId,
  issueSessionTimelineSteps
} from "../../src/lib/issueSessionTimelineModel.js";

const BASIC_STEPS = [
  { id: "session_created", index: 0, label: "Session created" },
  { id: "worktree_created", index: 1, label: "Worktree created" },
  { id: "dependencies_installed", index: 2, label: "Dependencies installed" },
  { id: "issue_prompt_rendered", index: 3, label: "Initial issue prompt" },
  { id: "plan_made", index: 4, label: "Plan made" }
];

describe("issue session timeline model", () => {
  it("groups adjacent display steps into one visible row", () => {
    const groupedSteps = groupedIssueSessionSteps([
      ...BASIC_STEPS,
      {
        displayGroupId: "review",
        displayGroupLabel: "Review",
        id: "review_prompt_rendered",
        index: 5,
        label: "Review prompt",
      },
      {
        displayGroupId: "review",
        id: "review_changes_accepted",
        index: 6,
        label: "Review accepted"
      }
    ]);

    expect(groupedSteps.at(-1)).toMatchObject({
      id: "group:review",
      label: "Review",
      sourceStepIds: ["review_prompt_rendered", "review_changes_accepted"]
    });
    expect(issueSessionDisplayStepId("review_changes_accepted", groupedSteps)).toBe("group:review");
  });

  it("allows rewind from dependencies_installed onward only", () => {
    const rows = issueSessionTimelineSteps({
      currentStepId: "plan_made",
      isOpen: true,
      session: {
        completedSteps: [
          "session_created",
          "worktree_created",
          "dependencies_installed",
          "issue_prompt_rendered"
        ]
      },
      stepDefinitions: BASIC_STEPS
    });

    expect(rows.find((row) => row.id === "worktree_created")).toMatchObject({
      canRewind: false,
      done: true
    });
    expect(rows.find((row) => row.id === "dependencies_installed")).toMatchObject({
      canRewind: true,
      rewindStepId: "dependencies_installed"
    });
    expect(rows.find((row) => row.id === "plan_made")).toMatchObject({
      current: true,
      state: "current"
    });
  });
});
