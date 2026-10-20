import { describe, expect, it } from "vitest";

import {
  blockingVibe64SessionPageError,
  enrichVibe64SessionForDisplay,
  vibe64SessionLimits,
  visibleVibe64Sessions
} from "../../src/lib/vibe64SessionPanelModel.js";

describe("plain Vibe64 session presentation", () => {
  it("shows only open sessions in creation order", () => {
    expect(visibleVibe64Sessions([
      { createdAt: "2026-01-02", sessionId: "second", status: "active" },
      { createdAt: "2026-01-01", sessionId: "first", status: "active" },
      { createdAt: "2026-01-03", sessionId: "archived", status: "archived" }
    ]).map((session) => session.sessionId)).toEqual(["first", "second"]);
  });

  it("derives the display source and label without workflow metadata", () => {
    expect(enrichVibe64SessionForDisplay({
      metadata: {
        label: "Improve search",
        source_kind: "session_clone",
        source_path: "/tmp/project/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      sessionId: "session-1",
      sessionRoot: "/tmp/project/state/session-1"
    })).toMatchObject({
      sessionName: "Improve search",
      source: "/tmp/project/sessions/active/session-1/source",
      sourceReady: true
    });
  });

  it("reports session limits and only blocking page errors", () => {
    expect(vibe64SessionLimits({
      payloadLimits: { maxOpenSessions: 4 },
      sessions: [{ status: "active" }, { status: "archived" }]
    })).toEqual({ maxOpenSessions: 4, openSessionCount: 1 });
    expect(blockingVibe64SessionPageError({ runtimePageError: "Runtime unavailable" }))
      .toBe("Runtime unavailable");
    expect(blockingVibe64SessionPageError({
      selectedSession: { sessionId: "session-1" },
      selectedSessionLoadError: "Temporary refresh error"
    })).toBe("");
  });

  it("does not invent a creation allowance when server limits are absent", () => {
    expect(vibe64SessionLimits({
      sessions: [{ status: "active" }]
    })).toEqual({
      maxOpenSessions: 0,
      openSessionCount: 1
    });
    expect(vibe64SessionLimits({
      payloadLimits: { maxOpenSessions: 0, openSessionCount: 0 },
      sessions: [{ status: "active" }]
    })).toEqual({
      maxOpenSessions: 0,
      openSessionCount: 0
    });
  });
});
