import { describe, expect, it } from "vitest";
import {
  selectedSessionRecord,
  sessionDataRealtimeShouldRefresh,
  shouldPreserveSelectedSessionDuringRefresh
} from "../../src/composables/useVibe64SessionData.js";

describe("useVibe64SessionData selected session record", () => {
  it("prefers the selected detail record over the shallow list summary", () => {
    const detailRecord = {
      actions: [
        {
          id: "inspect"
        }
      ],
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 4,
      sessionId: "session-1"
    };
    const listSummary = {
      currentStep: "step_c",
      revision: 5,
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
  });

  it("uses the list summary while the selected detail record is unavailable", () => {
    const listSummary = {
      currentStep: "step_c",
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(null, listSummary, "session-1")).toBe(listSummary);
    expect(selectedSessionRecord({
      ok: false,
      sessionId: "session-1"
    }, listSummary, "session-1")).toBe(listSummary);
  });

  it("preserves a missing selected id only while refresh work is active", () => {
    const nextSessions = [
      { sessionId: "session-2" }
    ];

    expect(shouldPreserveSelectedSessionDuringRefresh({
      currentSessionId: "session-1",
      nextSessions,
      sessionListLoading: true
    })).toBe(true);

    expect(shouldPreserveSelectedSessionDuringRefresh({
      currentSessionId: "session-1",
      nextSessions,
      selectedSessionLoading: true
    })).toBe(true);

    expect(shouldPreserveSelectedSessionDuringRefresh({
      currentSessionId: "session-1",
      nextSessions
    })).toBe(false);
  });

  it("does not preserve when the selected id is still visible", () => {
    expect(shouldPreserveSelectedSessionDuringRefresh({
      currentSessionId: "session-1",
      nextSessions: [
        { sessionId: "session-1" },
        { sessionId: "session-2" }
      ],
      sessionListLoading: true
    })).toBe(false);
  });

  it("refreshes session data only for selected-session state changes that affect the UI", () => {
    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1",
        stepStatus: "awaiting_agent_result"
      }
    }, "session-1")).toBe(false);

    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1", {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);

    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-claimed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-active",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(sessionDataRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });
});
