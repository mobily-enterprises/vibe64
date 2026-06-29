import { describe, expect, it } from "vitest";
import {
  mdiCodeBraces,
  mdiGithub,
  mdiMessagePlusOutline,
  mdiPackageVariantClosed,
  mdiRobotOutline,
  mdiSync,
  mdiUndoVariant
} from "@mdi/js";

import {
  activeVibe64SeedSession,
  activeVibe64SeedSessionMessage,
  blockingVibe64SessionPageError,
  vibe64ActionIcon,
  vibe64PromptHandoffFromSession,
  vibe64SessionLimits,
  vibe64SessionUsesSeedWorkflow,
  buildVibe64AutopilotNavigationSteps,
  buildVibe64TimelineSteps,
  currentStepDisabledReason,
  enrichVibe64SessionForDisplay,
  visibleVibe64Sessions
} from "../../src/lib/vibe64SessionPanelModel.js";

describe("Vibe64 session panel model", () => {
  it("sorts visible sessions and hides closed sessions", () => {
    expect(visibleVibe64Sessions([
      { sessionId: "2026-05-16_02", status: "active" },
      { sessionId: "2026-05-16_01", status: "abandoned" },
      { sessionId: "2026-05-16_03", status: "finished" },
      { sessionId: "2026-05-16_00", status: "active" }
    ]).map((session) => session.sessionId)).toEqual([
      "2026-05-16_00",
      "2026-05-16_02"
    ]);
  });

  it("detects active seed sessions for project-level creation locking", () => {
    const seedSession = {
      metadata: {
        workflow_definition: "seed_application"
      },
      sessionId: "seed-session",
      status: "active"
    };

    expect(vibe64SessionUsesSeedWorkflow(seedSession)).toBe(true);
    expect(vibe64SessionUsesSeedWorkflow({
      metadata: {
        work_source: "seed"
      }
    })).toBe(true);
    expect(vibe64SessionUsesSeedWorkflow({
      workflowDefinition: {
        id: "big_feature"
      }
    })).toBe(false);
    expect(activeVibe64SeedSession([
      { sessionId: "old-seed", metadata: { workflow_definition: "seed_application" }, status: "finished" },
      { sessionId: "feature-session", metadata: { workflow_definition: "big_feature" }, status: "active" },
      seedSession
    ])).toEqual(seedSession);
    expect(activeVibe64SeedSessionMessage(seedSession)).toContain("seed-session");
  });

  it("shows only blocking session page load errors", () => {
    expect(blockingVibe64SessionPageError({
      runtimePageError: "Terminal failed.",
      selectedSession: {
        sessionId: "session-1"
      },
      selectedSessionLoadError: "Request failed.",
      sessionListLoadError: "List failed.",
      sessions: [{ sessionId: "session-1" }]
    })).toBe("Terminal failed.");

    expect(blockingVibe64SessionPageError({
      selectedSession: {
        sessionId: "session-1"
      },
      selectedSessionLoadError: "Request failed.",
      sessionListLoadError: "List failed.",
      sessions: [{ sessionId: "session-1" }]
    })).toBe("");

    expect(blockingVibe64SessionPageError({
      sessionListLoadError: "List failed.",
      sessions: []
    })).toBe("List failed.");

    expect(blockingVibe64SessionPageError({
      selectedSessionLoadError: "Selected session failed.",
      sessions: [{ sessionId: "session-1" }]
    })).toBe("Selected session failed.");

    expect(blockingVibe64SessionPageError({
      hasMountedRuntime: true,
      selectedSessionLoadError: "Request failed.",
      sessionListLoadError: "Request failed.",
      sessions: []
    })).toBe("");
  });

  it("builds timeline rows with current, pending, done, and rewind state", () => {
    const rows = buildVibe64TimelineSteps({
      currentStep: "plan_and_execute",
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
          id: "source_created",
          index: 1,
          label: "Create session clone",
          status: "done"
        },
        {
          id: "plan_and_execute",
          index: 2,
          label: "Plan and execute",
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
      { canRewind: true, id: "source_created", state: "done" },
      { canRewind: false, id: "plan_and_execute", state: "current" }
    ]);
  });

  it("uses a package icon for dependency workflow steps", () => {
    const rows = buildVibe64TimelineSteps({
      currentStep: "dependencies_installed",
      status: "active",
      stepDefinitions: [
        {
          id: "dependencies_installed",
          index: 0,
          label: "Install dependencies",
          status: "current"
        }
      ]
    });

    expect(rows[0].icon).toBe(mdiPackageVariantClosed);
  });

  it("builds Autopilot navigation from the full workflow", () => {
    const rows = buildVibe64AutopilotNavigationSteps({
      currentStep: "plan_and_execute",
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
          label: "Define work",
          status: "done"
        },
        {
          id: "plan_and_execute",
          index: 5,
          label: "Plan and execute",
          status: "current"
        },
        {
          id: "implementation_reviewed",
          index: 8,
          label: "Initial human review"
        },
        {
          id: "deep_ui_check_run",
          index: 9,
          label: "Check user interface"
        },
        {
          id: "changes_accepted",
          index: 12,
          label: "Final human review"
        },
        {
          id: "create_and_merge_pull_request",
          index: 16,
          label: "Create pull request, possibly merge"
        },
        {
          id: "session_finished",
          index: 17,
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
      { canRewind: true, id: "issue_file_created", label: "Define work", state: "done" },
      { canRewind: false, id: "plan_and_execute", label: "Plan and execute", state: "current" },
      { canRewind: false, id: "implementation_reviewed", label: "Initial human review", state: "pending" },
      { canRewind: false, id: "deep_ui_check_run", label: "Check user interface", state: "pending" },
      { canRewind: false, id: "changes_accepted", label: "Final human review", state: "pending" },
      { canRewind: false, id: "create_and_merge_pull_request", label: "Create pull request, possibly merge", state: "pending" },
      { canRewind: false, id: "session_finished", label: "Congratulations!", state: "pending" }
    ]);
  });

  it("maps runtime actions and disabled reasons for UI controls", () => {
    expect(vibe64ActionIcon({ icon: "codex" })).toBe(mdiRobotOutline);
    expect(vibe64ActionIcon({ icon: "github" })).toBe(mdiGithub);
    expect(vibe64ActionIcon({ icon: "message-square-plus" })).toBe(mdiMessagePlusOutline);
    expect(vibe64ActionIcon({ icon: "rotate-ccw" })).toBe(mdiUndoVariant);
    expect(vibe64ActionIcon({ icon: "sync" })).toBe(mdiSync);
    expect(vibe64ActionIcon({ id: "server_owned_action" })).toBe(mdiCodeBraces);
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
    expect(enrichVibe64SessionForDisplay({
      metadata: {
        branch: "vibe64/example",
        issue_title: "Add reports",
        issue_word: "Reports",
        issue_url: "https://github.com/example/app/issues/12",
        pr_url: "https://github.com/example/app/pull/34",
        source_path: "/workspace/.vibe64/session/source"
      },
      sessionId: "session-1"
    })).toMatchObject({
      branch: "vibe64/example",
      issueTitle: "Add reports",
      issueUrl: "https://github.com/example/app/issues/12",
      prUrl: "https://github.com/example/app/pull/34",
      sessionName: "Reports",
      source: "/workspace/.vibe64/session/source",
      sourceReady: true
    });

    expect(enrichVibe64SessionForDisplay({
      completedSteps: ["session_created", "source_created"],
      metadata: {},
      sessionId: "session-2",
      sessionRoot: "/workspace/.vibe64/session-2"
    })).toMatchObject({
      source: "/workspace/.vibe64/session-2/source",
      sourceReady: true
    });

    expect(vibe64PromptHandoffFromSession({
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

    expect(vibe64SessionLimits({
      sessions: [
        { status: "active" },
        { status: "finished" },
        { status: "active" }
      ]
    })).toEqual({
      maxOpenSessions: 3,
      openSessionCount: 2
    });
  });
});
