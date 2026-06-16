import { describe, expect, it } from "vitest";
import {
  selectedSessionRecord,
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
});
