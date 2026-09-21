import { describe, expect, it } from "vitest";
import {
  renewedSuccessorSessionId,
  sessionListRealtimeShouldRefresh,
  selectedSessionIdForCurrentAlias,
  shouldPreserveSelectedSessionDuringRefresh
} from "../../src/composables/useVibe64SessionData.js";
import {
  agentTurnRealtimeOverlayFromPayload,
  latestAgentTurnRealtimeOverlay,
  sessionWithAgentTurnRealtimeOverlay
} from "../../src/lib/vibe64AgentTurnRealtimeOverlay.js";
import {
  latestSessionDetailRecord,
  mountedSessionDetailLoadState,
  mountedSessionDetailRefreshReason,
  mountedSessionRealtimeShouldRefresh,
  mountedSessionRecord,
  sessionRecordHasActiveAgentWork
} from "../../src/lib/vibe64MountedSessionState.js";
import {
  createVibe64CurrentSessionPublisher
} from "../../src/lib/vibe64CurrentSessionPublisher.js";

describe("current session selection", () => {
  it("uses only one exact renewed-from successor for a missing predecessor", () => {
    const sessions = [
      {
        metadata: { renewed_from: "predecessor-b" },
        sessionId: "successor-b"
      },
      {
        metadata: { renewed_from: "predecessor-a" },
        sessionId: "successor-a"
      }
    ];

    expect(renewedSuccessorSessionId({
      predecessorSessionId: "predecessor-a",
      sessions
    })).toBe("successor-a");
    expect(renewedSuccessorSessionId({
      predecessorSessionId: "predecessor-a",
      sessions: [
        ...sessions,
        {
          metadata: { renewed_from: "predecessor-a" },
          sessionId: "ambiguous-successor-a"
        }
      ]
    })).toBe("");
  });

  it("publishes only a selection confirmed by the loaded list", () => {
    const sessions = [{ sessionId: "session-1" }, { sessionId: "session-2" }];

    expect(selectedSessionIdForCurrentAlias({
      selectedSessionId: "session-2",
      sessions
    })).toBe("session-2");
    expect(selectedSessionIdForCurrentAlias({
      selectedSessionId: "missing",
      sessions
    })).toBe(null);
    expect(selectedSessionIdForCurrentAlias({
      selectedSessionId: "session-2",
      sessionListLoading: true,
      sessions
    })).toBe(null);
    expect(selectedSessionIdForCurrentAlias({ sessions: [] })).toBe("");
  });

  it("coalesces rapid publications to the latest selection", async () => {
    const calls = [];
    let releaseFirst;
    let firstStarted;
    const gate = new Promise((resolve) => { releaseFirst = resolve; });
    const started = new Promise((resolve) => { firstStarted = resolve; });
    const publisher = createVibe64CurrentSessionPublisher({
      async publish({ sessionId }) {
        calls.push(sessionId);
        if (sessionId === "session-1") {
          firstStarted();
          await gate;
        }
      }
    });

    publisher.request({ apiPath: "/a/current", sessionId: "session-1" });
    await started;
    publisher.request({ apiPath: "/a/current", sessionId: "session-2" });
    const published = publisher.request({ apiPath: "/a/current", sessionId: "session-3" });
    releaseFirst();
    await published;

    expect(calls).toEqual(["session-1", "session-3"]);
  });

  it("preserves a temporarily missing selection only during refresh", () => {
    const input = {
      currentSessionId: "session-1",
      nextSessions: [{ sessionId: "session-2" }]
    };
    expect(shouldPreserveSelectedSessionDuringRefresh({
      ...input,
      sessionListLoading: true
    })).toBe(true);
    expect(shouldPreserveSelectedSessionDuringRefresh(input)).toBe(false);
  });
});

describe("mounted direct session state", () => {
  const detail = {
    agentSession: {
      turn: {
        active: false,
        id: "turn-1"
      }
    },
    revision: 5,
    sessionId: "session-1",
    sourcePath: "/tmp/source"
  };

  it("accepts plain detail responses without a presentation projection", () => {
    expect(latestSessionDetailRecord(null, detail, "session-1")).toBe(detail);
    expect(latestSessionDetailRecord(detail, {
      ...detail,
      revision: 4
    }, "session-1")).toBe(detail);
  });

  it("retains detail-only agent state until a newer summary is refreshed", () => {
    const summary = {
      revision: 6,
      sessionId: "session-1"
    };

    expect(mountedSessionRecord(detail, summary, "session-1")).toBe(detail);
    expect(mountedSessionDetailRefreshReason(detail, summary, "session-1"))
      .toBe("newer_summary_without_detail");
  });

  it("uses a newer summary when the old record has no detail-only state", () => {
    const oldSummary = { revision: 4, sessionId: "session-1" };
    const summary = { revision: 5, sessionId: "session-1" };

    expect(mountedSessionRecord(oldSummary, summary, "session-1")).toBe(summary);
    expect(mountedSessionRecord(null, summary, "session-1")).toBe(summary);
  });

  it("reports simple loading, ready, and error states", () => {
    expect(mountedSessionDetailLoadState({
      fetching: true,
      sessionId: "session-1"
    })).toMatchObject({
      label: "Loading session...",
      loading: true,
      ready: false,
      state: "detailLoading"
    });
    expect(mountedSessionDetailLoadState({
      detailSession: detail,
      fetching: true,
      sessionId: "session-1"
    })).toMatchObject({
      loading: false,
      ready: true,
      refreshing: true,
      state: "detailReady"
    });
    expect(mountedSessionDetailLoadState({
      listSession: { sessionId: "session-1" },
      loadError: "Network failed.",
      sessionId: "session-1"
    })).toMatchObject({
      error: "Network failed.",
      label: "Session could not load.",
      state: "detailError"
    });
  });

  it("uses only the provider turn as active-work truth", () => {
    expect(sessionRecordHasActiveAgentWork({
      agentSession: { turn: { active: true } }
    })).toBe(true);
    expect(sessionRecordHasActiveAgentWork({})).toBe(false);
  });

  it("refreshes detail for durable changes but not transient turn or preview events", () => {
    for (const reason of [
      "codex-app-server-turn-active",
      "codex-app-server-turn-idle",
      "codex-app-server-commentary",
      "opencode-server-message-delivered",
      "opencode-server-progress",
      "opencode-server-reasoning",
      "opencode-server-turn-active",
      "opencode-server-turn-idle",
      "output-target-ready"
    ]) {
      expect(mountedSessionRealtimeShouldRefresh({
        payload: { reason, sessionId: "session-1" }
      }, "session-1")).toBe(false);
    }
    expect(mountedSessionRealtimeShouldRefresh({
      payload: { reason: "session-agent-message-accepted", sessionId: "session-1" }
    }, "session-1")).toBe(true);
    expect(mountedSessionRealtimeShouldRefresh({
      payload: { reason: "session-agent-message-accepted", sessionId: "session-2" }
    }, "session-1")).toBe(false);
  });
});

describe("direct assistant realtime state", () => {
  it("builds an overlay only for the selected session and a revisioned turn", () => {
    const overlay = agentTurnRealtimeOverlayFromPayload({
      agentSession: {
        thread: { id: "thread-1" },
        turn: { active: true, id: "turn-1" }
      },
      reason: "codex-app-server-turn-active",
      revision: 12,
      sessionId: "session-1"
    }, "session-1");

    expect(overlay).toMatchObject({
      active: true,
      revision: 12,
      sessionId: "session-1"
    });
    expect(agentTurnRealtimeOverlayFromPayload({
      agentSession: { turn: { active: true } },
      revision: 12,
      sessionId: "session-2"
    }, "session-1")).toBe(null);
  });

  it("merges newer turn state and ignores stale overlays", () => {
    const session = {
      agentSession: {
        thread: { id: "thread-1" },
        turn: { active: false, id: "turn-1" }
      },
      revision: 10,
      sessionId: "session-1"
    };
    const active = {
      active: true,
      agentSession: {
        thread: { id: "thread-2" },
        turn: { active: true, id: "turn-2" }
      },
      revision: 11,
      sessionId: "session-1"
    };
    const completed = {
      ...active,
      active: false,
      agentSession: {
        ...active.agentSession,
        turn: { active: false, id: "turn-2" }
      },
      revision: 12
    };

    expect(sessionWithAgentTurnRealtimeOverlay(session, active)).toMatchObject({
      agentSession: {
        thread: { id: "thread-2" },
        turn: { active: true, id: "turn-2" }
      },
      revision: 11
    });
    expect(latestAgentTurnRealtimeOverlay(completed, active)).toBe(completed);
    expect(sessionWithAgentTurnRealtimeOverlay({
      ...session,
      revision: 12
    }, completed).revision).toBe(12);
  });

  it("keeps list refreshes bounded to durable session changes", () => {
    expect(sessionListRealtimeShouldRefresh({
      payload: { projectSlug: "other-project", reason: "session-created", clientRefresh: { includeList: true } }
    }, "current-project")).toBe(false);
    expect(sessionListRealtimeShouldRefresh({
      payload: { projectSlug: "current-project", reason: "session-created" }
    }, "current-project")).toBe(true);
    expect(sessionListRealtimeShouldRefresh({
      payload: { reason: "codex-app-server-commentary", sessionId: "session-1" }
    })).toBe(false);
    expect(sessionListRealtimeShouldRefresh({
      payload: { sessionId: "session-1" }
    })).toBe(true);
  });
});
