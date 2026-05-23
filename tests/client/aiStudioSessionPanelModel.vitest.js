import { describe, expect, it } from "vitest";
import {
  mdiGithub,
  mdiRobotOutline,
  mdiSync
} from "@mdi/js";

import {
  aiStudioActionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionLimits,
  buildAiStudioAutopilotNavigationSteps,
  buildAiStudioTimelineSteps,
  currentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  inspectDiffButtonVisible,
  visibleAiStudioSessions
} from "../../src/lib/aiStudioSessionPanelModel.js";

describe("AI Studio session panel model", () => {
  it("sorts visible sessions and hides closed sessions", () => {
    expect(visibleAiStudioSessions([
      { sessionId: "2026-05-16_02", status: "active" },
      { sessionId: "2026-05-16_01", status: "abandoned" },
      { sessionId: "2026-05-16_03", status: "finished" },
      { sessionId: "2026-05-16_00", status: "active" }
    ]).map((session) => session.sessionId)).toEqual([
      "2026-05-16_00",
      "2026-05-16_02"
    ]);
  });

  it("shows the inspect diff button only for inspect sessions with a ready worktree and diff action", () => {
    const openDialog = () => null;

    expect(inspectDiffButtonVisible({
      diff: {
        openDialog
      },
      selectedSession: {
        worktreeReady: true
      },
      sessionMode: "inspect"
    })).toBe(true);

    expect(inspectDiffButtonVisible({
      diff: {
        openDialog
      },
      selectedSession: {
        worktreeReady: true
      },
      sessionMode: "autopilot"
    })).toBe(false);

    expect(inspectDiffButtonVisible({
      diff: {
        openDialog
      },
      selectedSession: {
        worktreeReady: false
      },
      sessionMode: "inspect"
    })).toBe(false);

    expect(inspectDiffButtonVisible({
      diff: {},
      selectedSession: {
        worktreeReady: true
      },
      sessionMode: "inspect"
    })).toBe(false);
  });

  it("builds timeline rows with current, pending, done, and rewind state", () => {
    const rows = buildAiStudioTimelineSteps({
      currentStep: "plan_made",
      status: "active",
      stepDefinitions: [
        {
          description: "Create the session.",
          done: true,
          id: "session_created",
          index: 0,
          label: "Create session",
          rewindable: false,
          status: "done"
        },
        {
          done: true,
          id: "worktree_created",
          index: 1,
          label: "Create worktree",
          status: "done"
        },
        {
          id: "plan_made",
          index: 2,
          label: "Make plan",
          status: "current"
        }
      ]
    });

    expect(rows.map((row) => ({
      canRewind: row.canRewind,
      id: row.id,
      state: row.state
    }))).toEqual([
      { canRewind: false, id: "session_created", state: "done" },
      { canRewind: true, id: "worktree_created", state: "done" },
      { canRewind: false, id: "plan_made", state: "current" }
    ]);
  });

  it("builds Autopilot navigation from the full workflow", () => {
    const rows = buildAiStudioAutopilotNavigationSteps({
      currentStep: "plan_made",
      status: "active",
      stepDefinitions: [
        {
          done: true,
          id: "session_created",
          index: 0,
          label: "Create session",
          rewindable: false,
          status: "done"
        },
        {
          done: true,
          id: "issue_file_created",
          index: 4,
          label: "Define or select issue",
          status: "done"
        },
        {
          id: "plan_made",
          index: 6,
          label: "Make plan",
          status: "current"
        },
        {
          id: "implementation_reviewed",
          index: 8,
          label: "Human review"
        },
        {
          id: "deep_ui_check_run",
          index: 9,
          label: "Run deep UI check"
        },
        {
          id: "changes_accepted",
          index: 12,
          label: "Final review"
        },
        {
          id: "pr_merged",
          index: 16,
          label: "Merge PR"
        },
        {
          id: "session_finished",
          index: 18,
          label: "Congratulations!"
        }
      ]
    });

    expect(rows.map((row) => ({
      canRewind: row.canRewind,
      id: row.id,
      label: row.label,
      state: row.state
    }))).toEqual([
      { canRewind: false, id: "session_created", label: "Create session", state: "done" },
      { canRewind: true, id: "issue_file_created", label: "Define or select issue", state: "done" },
      { canRewind: false, id: "plan_made", label: "Make plan", state: "current" },
      { canRewind: false, id: "implementation_reviewed", label: "Human review", state: "pending" },
      { canRewind: false, id: "deep_ui_check_run", label: "Run deep UI check", state: "pending" },
      { canRewind: false, id: "changes_accepted", label: "Final review", state: "pending" },
      { canRewind: false, id: "pr_merged", label: "Merge PR", state: "pending" },
      { canRewind: false, id: "session_finished", label: "Congratulations!", state: "pending" }
    ]);
  });

  it("maps runtime actions and disabled reasons for UI controls", () => {
    expect(aiStudioActionIcon({ type: "prompt" })).toBe(mdiRobotOutline);
    expect(aiStudioActionIcon({ id: "create_issue_on_gh", type: "command" })).toBe(mdiGithub);
    expect(aiStudioActionIcon({ id: "create_worktree", type: "command" })).toBe(mdiSync);
    expect(currentStepDisabledReason([
      {
        disabledReason: "Create the issue file first.",
        enabled: false
      }
    ], {
      disabledReason: "Next is blocked.",
      enabled: false,
      visible: true
    })).toBe("Create the issue file first.");
    expect(currentStepDisabledReason([], {
      disabledReason: "Next is blocked.",
      enabled: false,
      visible: true
    })).toBe("Next is blocked.");
  });

  it("normalizes session metadata and prompt handoff state", () => {
    expect(enrichAiStudioSessionForDisplay({
      metadata: {
        branch: "ai-studio/example",
        issue_title: "Add reports",
        issue_word: "Reports",
        issue_url: "https://github.com/example/app/issues/12",
        pr_url: "https://github.com/example/app/pull/34",
        worktree_path: "/workspace/.ai-studio/session/worktree"
      },
      sessionId: "session-1"
    })).toMatchObject({
      branch: "ai-studio/example",
      issueTitle: "Add reports",
      issueUrl: "https://github.com/example/app/issues/12",
      prUrl: "https://github.com/example/app/pull/34",
      sessionName: "Reports",
      worktree: "/workspace/.ai-studio/session/worktree",
      worktreeReady: true
    });

    expect(enrichAiStudioSessionForDisplay({
      completedSteps: ["session_created", "worktree_created"],
      metadata: {},
      sessionId: "session-2",
      sessionRoot: "/workspace/.ai-studio/session-2"
    })).toMatchObject({
      worktree: "/workspace/.ai-studio/session-2/worktree",
      worktreeReady: true
    });

    expect(aiStudioPromptHandoffFromSession({
      actionResult: {
        codexPromptHandoff: {
          prompt: "Action prompt"
        }
      },
      codexPromptHandoff: {
        prompt: "Session prompt"
      }
    })).toEqual({
      prompt: "Action prompt"
    });

    expect(aiStudioSessionLimits({
      sessions: [
        { status: "active" },
        { status: "finished" },
        { status: "active" }
      ]
    })).toEqual({
      maxOpenSessions: 5,
      openSessionCount: 2
    });
  });
});
