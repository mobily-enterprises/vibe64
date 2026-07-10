import { describe, expect, it } from "vitest";

import {
  sessionPanelDashboardContext,
  sessionPanelRuntimeHostDiagnostics,
  sessionPanelToolbarSessions
} from "../../src/composables/useVibe64SessionPanel.js";

describe("useVibe64SessionPanel", () => {
  it("passes project setup metadata into empty dashboard context", () => {
    const projectContext = {
      projectConfig: {
        ready: true
      },
      setup: {
        studioSetupEnabled: false
      }
    };

    expect(sessionPanelDashboardContext(projectContext)).toEqual({
      projectContext
    });
    expect(sessionPanelDashboardContext(null)).toEqual({
      projectContext: {}
    });
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
          agentThinking: true
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
    })).toEqual([
      {
        agentThinking: true,
        sessionId: "session-a",
        sessionName: "Alpha"
      },
      {
        agentThinking: true,
        sessionId: "session-b",
        sessionName: "Beta"
      },
      {
        agentThinking: true,
        sessionId: "session-d",
        sessionName: "Delta"
      },
      {
        agentThinking: false,
        sessionId: "session-c",
        sessionName: "Gamma"
      }
    ]);
  });
});
