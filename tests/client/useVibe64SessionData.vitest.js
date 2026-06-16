import { describe, expect, it } from "vitest";
import {
  rememberSessionDetailRecord,
  sessionDetailRecordForId,
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
      revision: 5,
      sessionId: "session-1"
    };
    const listSummary = {
      currentStep: "step_c",
      revision: 4,
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
  });

  it("uses the list summary when it is newer than the selected detail record", () => {
    const detailRecord = {
      actions: [
        {
          id: "talk_to_codex"
        }
      ],
      presentation: {
        screen: {
          kind: "conversation",
          primaryIntentId: "talk_to_codex"
        }
      },
      revision: 8,
      sessionId: "session-1",
      stepMachine: {
        status: "waiting_for_input"
      }
    };
    const listSummary = {
      currentStep: "define_work",
      revision: 9,
      sessionId: "session-1",
      stepMachine: {
        status: "awaiting_agent_result"
      }
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(listSummary);
  });

  it("keeps active Codex detail over a newer shallow list summary", () => {
    const detailRecord = {
      codexAgentTurnActive: true,
      presentation: {
        prompt: {
          state: "waiting_for_agent"
        },
        screen: {
          kind: "conversation",
          primaryIntentId: "talk_to_codex"
        }
      },
      revision: 8,
      sessionId: "session-1",
      stepMachine: {
        status: "awaiting_agent_result"
      }
    };
    const listSummary = {
      currentStep: "define_work",
      revision: 9,
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
  });

  it("restores cached active Codex detail after switching sessions", () => {
    const detailCache = {};
    const activeDetailRecord = {
      codexAgentTurnActive: true,
      presentation: {
        prompt: {
          state: "waiting_for_agent"
        }
      },
      revision: 8,
      sessionId: "session-1",
      stepMachine: {
        status: "awaiting_agent_result"
      }
    };
    const otherLiveDetailRecord = {
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 11,
      sessionId: "session-2"
    };
    const listSummary = {
      currentStep: "plan_and_execute",
      revision: 9,
      sessionId: "session-1"
    };

    expect(rememberSessionDetailRecord(detailCache, activeDetailRecord)).toBe(true);

    const cachedDetailRecord = sessionDetailRecordForId(
      detailCache,
      "session-1",
      otherLiveDetailRecord
    );

    expect(cachedDetailRecord).toBe(activeDetailRecord);
    expect(selectedSessionRecord(cachedDetailRecord, listSummary, "session-1")).toBe(activeDetailRecord);
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
