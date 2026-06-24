import { describe, expect, it } from "vitest";

import {
  sessionPanelRuntimeHostDiagnostics,
  sessionPanelToolbarSessions
} from "../../src/composables/useVibe64SessionPanel.js";

describe("useVibe64SessionPanel", () => {
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

  it("marks toolbar sessions as Codex thinking from selected detail and runtime state", () => {
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
        codexThinking: true,
        sessionId: "session-c",
        sessionName: "Gamma"
      }
    ];

    expect(sessionPanelToolbarSessions({
      runtimeStateBySessionId: {
        "session-b": {
          codexThinking: true
        }
      },
      selectedSession: {
        codexAgentTurnActive: true,
        sessionId: "session-a"
      },
      selectedSessionId: "session-a",
      sessions
    })).toEqual([
      {
        codexThinking: true,
        sessionId: "session-a",
        sessionName: "Alpha"
      },
      {
        codexThinking: true,
        sessionId: "session-b",
        sessionName: "Beta"
      },
      {
        codexThinking: false,
        sessionId: "session-c",
        sessionName: "Gamma"
      }
    ]);
  });
});
