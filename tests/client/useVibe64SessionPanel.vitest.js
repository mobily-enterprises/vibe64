import { describe, expect, it } from "vitest";

import {
  sessionPanelDashboardContext,
  sessionPanelEmptyStateActivity,
  sessionPanelRuntimeHostDiagnostics,
  sessionPanelSelectedSessionArchiving,
  sessionPanelToolbarSessions,
  sessionRepositoryWorkState
} from "../../src/composables/useVibe64SessionPanel.js";

describe("useVibe64SessionPanel", () => {
  it("uses the empty-state loader for both initial loading and session creation", () => {
    expect(sessionPanelEmptyStateActivity({
      sessionListInitialLoading: true
    })).toBe("loading");
    expect(sessionPanelEmptyStateActivity({
      createSessionRunning: true,
      sessionListInitialLoading: true
    })).toBe("creating");
    expect(sessionPanelEmptyStateActivity({
      createSessionRunning: true,
      selectedSession: {
        sessionId: "session-a"
      }
    })).toBe("");
    expect(sessionPanelEmptyStateActivity()).toBe("");
  });

  it("passes project setup metadata into empty dashboard context", () => {
    const projectContext = {
      foundation: {
        ready: true
      },
      setup: {
        studioSetupEnabled: false
      }
    };

    expect(sessionPanelDashboardContext(projectContext)).toEqual({
      projectContext,
      sessionsApiPath: ""
    });
    expect(sessionPanelDashboardContext(null)).toEqual({
      projectContext: {},
      sessionsApiPath: ""
    });
  });

  it("blocks only the session whose archive request is in flight", () => {
    expect(sessionPanelSelectedSessionArchiving({
      archive: {
        archiving: true,
        archivingSessionId: "session-a"
      },
      selectedSessionId: "session-a"
    })).toBe(true);
    expect(sessionPanelSelectedSessionArchiving({
      archive: {
        archiving: true,
        archivingSessionId: "session-a"
      },
      selectedSessionId: "session-b"
    })).toBe(false);
    expect(sessionPanelSelectedSessionArchiving({
      archive: {
        archiving: false,
        archivingSessionId: "session-a"
      },
      selectedSessionId: "session-a"
    })).toBe(false);
  });

  it("reports exact runtime host counts for visible, hidden, orphaned, and errored hosts", () => {
    expect(sessionPanelRuntimeHostDiagnostics({
      mountedRuntimeSessionIds: ["session-a", "session-b", "session-orphan"],
      runtimeHostSessionIds: ["session-a", "session-b"],
      runtimeStateBySessionId: {
        "session-a": {
          busy: true,
          pageError: ""
        },
        "session-b": {
          busy: false,
          pageError: "Network request failed."
        },
        "session-orphan": {
          busy: false,
          pageError: ""
        }
      },
      selectedSessionId: "session-b",
      sessionLoadError: true,
      sessions: [
        {
          sessionId: "session-a"
        },
        {
          sessionId: "session-b"
        }
      ]
    })).toEqual({
      activeRuntimeHostCount: 1,
      busyRuntimeHostCount: 1,
      hiddenMountedRuntimeHostCount: 2,
      mountedRuntimeHostCount: 3,
      mountedRuntimeSessionIds: ["session-a", "session-b", "session-orphan"],
      orphanedMountedRuntimeHostCount: 1,
      pageErrorRuntimeHostCount: 1,
      renderedRuntimeHostCount: 2,
      renderedRuntimeSessionIds: ["session-a", "session-b"],
      runtimeStateCount: 3,
      selectedSessionId: "session-b",
      sessionLoadError: true,
      unrenderedMountedRuntimeHostCount: 1,
      visibleRuntimeHostCount: 2,
      visibleRuntimeSessionIds: ["session-a", "session-b"],
      visibleSessionCount: 2
    });
  });

  it("marks toolbar sessions as assistant-thinking from selected detail and runtime state", () => {
    const sessions = [
      {
        sessionId: "session-a",
        sessionName: "Alpha"
      },
      {
        sessionId: "session-b",
        sessionName: "Beta"
      },
      {
        sessionId: "session-d",
        sessionName: "Delta"
      },
      {
        agentThinking: true,
        sessionId: "session-c",
        sessionName: "Gamma"
      }
    ];

    expect(sessionPanelToolbarSessions({
      runtimeStateBySessionId: {
        "session-b": {
          agentThinking: true,
          repositoryWorkState: { checkedAt: "now", state: "unsaved" }
        },
        "session-d": {
          busy: true
        }
      },
      selectedSession: {
        agentSession: {
          turn: {
            active: true
          }
        },
        sessionId: "session-a"
      },
      selectedSessionId: "session-a",
      sessions
    })).toMatchObject([
      { agentThinking: true, repositoryWorkState: { state: "checking" }, sessionId: "session-a" },
      { agentThinking: true, repositoryWorkState: { state: "unsaved" }, sessionId: "session-b" },
      { agentThinking: true, repositoryWorkState: { state: "checking" }, sessionId: "session-d" },
      { agentThinking: false, repositoryWorkState: { state: "checking" }, sessionId: "session-c" }
    ]);
  });

  it("never reports unknown or failed repository inspection as saved", () => {
    expect(sessionRepositoryWorkState(null)).toEqual({ checkedAt: "", state: "checking" });
    expect(sessionRepositoryWorkState({ error: "Git unavailable", unsaved: null })).toEqual({
      checkedAt: "",
      state: "unavailable"
    });
    expect(sessionRepositoryWorkState({ checkedAt: "now", unsaved: false })).toEqual({
      checkedAt: "now",
      state: "saved"
    });
    expect(sessionRepositoryWorkState({
      checkedAt: "now",
      changedPaths: ["one.js", "two.js"],
      unsaved: true,
      updateAvailable: true
    })).toEqual({
      changedCount: 2,
      checkedAt: "now",
      state: "unsaved",
      updateAvailable: true
    });
    expect(sessionRepositoryWorkState({
      checkedAt: "now",
      unsaved: false,
      updateAvailable: true
    })).toEqual({
      checkedAt: "now",
      state: "update_available"
    });
    expect(sessionRepositoryWorkState({
      loading: false, unsaved: null, updateAvailable: true, updateStatusPending: true
    })).toEqual({ checkedAt: "", state: "update_available", updateStatusPending: true });
    expect(sessionRepositoryWorkState({
      operation: { status: "running" },
      unsaved: true
    }).state).toBe("saving");
    expect(sessionRepositoryWorkState({
      updateOperation: { status: "failed" },
      unsaved: false
    }).state).toBe("needs_help");
    expect(sessionRepositoryWorkState({
      changedPaths: ["local.txt"],
      operation: {
        code: "vibe64_session_save_update_required",
        error: "Update before saving.",
        status: "failed"
      },
      unsaved: true,
      updateAvailable: true
    })).toEqual({
      changedCount: 1,
      checkedAt: "",
      state: "unsaved",
      updateAvailable: true
    });
  });

  it("keeps ten uninspected session chips in a bounded honest checking state", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `session-${index + 1}`,
      status: "active"
    }));
    const projected = sessionPanelToolbarSessions({
      runtimeStateBySessionId: {
        "session-1": {
          repositoryWorkState: { checkedAt: "now", state: "unsaved" }
        }
      },
      selectedSession: sessions[0],
      selectedSessionId: "session-1",
      sessions
    });

    expect(projected).toHaveLength(10);
    expect(projected[0].repositoryWorkState.state).toBe("unsaved");
    expect(projected.slice(1).map((session) => session.repositoryWorkState.state))
      .toEqual(Array(9).fill("checking"));
    expect(projected.some((session) => session.repositoryWorkState.state === "saved")).toBe(false);
  });
});
