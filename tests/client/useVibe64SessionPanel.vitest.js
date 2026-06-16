import { describe, expect, it } from "vitest";

import {
  sessionPanelRuntimeHostDiagnostics
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
});
