import { describe, expect, it } from "vitest";
import {
  mdiGithub,
  mdiPencilOutline,
  mdiRobotOutline,
  mdiSync
} from "@mdi/js";

import {
  aiStudioActionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  currentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  visibleAiStudioSessions
} from "../../src/lib/aiStudioSessionPanelModel.js";

describe("AI Studio session panel model", () => {
  it("sorts visible sessions and hides abandoned sessions", () => {
    expect(visibleAiStudioSessions([
      { sessionId: "2026-05-16_02", status: "active" },
      { sessionId: "2026-05-16_01", status: "abandoned" },
      { sessionId: "2026-05-16_00", status: "active" }
    ]).map((session) => session.sessionId)).toEqual([
      "2026-05-16_00",
      "2026-05-16_02"
    ]);
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

  it("maps runtime actions and disabled reasons for UI controls", () => {
    expect(aiStudioActionIcon({ type: "prompt" })).toBe(mdiRobotOutline);
    expect(aiStudioActionIcon({ type: "editor" })).toBe(mdiPencilOutline);
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
      worktree: "/workspace/.ai-studio/session/worktree",
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
