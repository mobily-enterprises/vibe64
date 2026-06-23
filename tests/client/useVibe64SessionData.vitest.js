import { describe, expect, it } from "vitest";
import {
  rememberSessionDetailRecord,
  sessionDetailRecordForId,
  sessionListRealtimeShouldRefresh,
  selectedSessionRealtimeShouldRefresh,
  selectedSessionDetailRefreshReason,
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
      presentation: {
        screen: {
          kind: "conversation",
          primaryIntentId: "talk_to_codex"
        }
      },
      revision: 9,
      sessionId: "session-1",
      stepMachine: {
        status: "awaiting_agent_result"
      }
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(listSummary);
  });

  it("keeps selected detail over a newer list summary with only stepMachine projection", () => {
    const detailRecord = {
      actions: [
        {
          id: "talk_to_codex"
        }
      ],
      presentation: {
        composerMenu: {
          items: [
            {
              id: "core.deslop_changes",
              label: "Deslop changes"
            }
          ]
        },
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
      currentStep: "maintenance_conversation",
      revision: 9,
      sessionId: "session-1",
      stepMachine: {
        status: "waiting_for_input"
      }
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
    expect(selectedSessionDetailRefreshReason(detailRecord, listSummary, "session-1"))
      .toBe("newer_summary_without_runtime_projection");
  });

  it("keeps the selected detail composer menu over a newer incomplete list projection", () => {
    const detailRecord = {
      currentStep: "maintenance_conversation",
      presentation: {
        composerMenu: {
          items: [
            {
              id: "core.deslop_changes",
              label: "Deslop changes"
            }
          ]
        },
        screen: {
          kind: "conversation"
        }
      },
      revision: 8,
      sessionId: "session-1"
    };
    const listSummary = {
      currentStep: "maintenance_conversation",
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 9,
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
  });

  it("refreshes selected detail once when the detail projection predates composer menu support", () => {
    const detailRecord = {
      currentStep: "maintenance_conversation",
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 8,
      sessionId: "session-1"
    };
    const listSummary = {
      currentStep: "maintenance_conversation",
      revision: 8,
      sessionId: "session-1"
    };

    expect(selectedSessionDetailRefreshReason(detailRecord, listSummary, "session-1"))
      .toBe("detail_missing_composer_menu");
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

  it("does not refresh the session list for terminal-only session events", () => {
    expect(sessionListRealtimeShouldRefresh({
      payload: {
        reason: "codex-terminal-closed",
        sessionId: "session-1"
      }
    })).toBe(false);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        reason: "launch-target-started",
        sessionId: "session-1"
      }
    })).toBe(false);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        reason: "launch-target-ready",
        sessionId: "session-1"
      }
    })).toBe(false);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        reason: "codex-terminal-started",
        sessionId: "session-1"
      }
    })).toBe(false);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-running",
        sessionId: "session-1"
      }
    })).toBe(false);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-ready",
        sessionId: "session-1"
      }
    })).toBe(false);

    for (const reason of [
      "codex-app-server-agent-result",
      "codex-app-server-agent-result-invalid",
      "codex-app-server-agent-result-missing",
      "codex-app-server-agent-result-provider-failed",
      "codex-app-server-blocked",
      "codex-app-server-failed",
      "codex-app-server-prompt-injected",
      "codex-app-server-turn-finalizing",
      "codex-app-server-turn-idle",
      "codex-app-server-turn-state"
    ]) {
      expect(sessionListRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      })).toBe(false);
    }

    for (const reason of [
      "session-action-run",
      "session-advanced",
      "session-agent-control-returned",
      "session-intent-run",
      "session-rewound",
      "session-step-recovered",
      "session-worktree-recovered"
    ]) {
      expect(sessionListRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      })).toBe(false);
    }

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    })).toBe(true);
  });

  it("refreshes the session list when a realtime event carries the list refresh hint", () => {
    expect(sessionListRealtimeShouldRefresh({
      payload: {
        clientRefresh: {
          includeList: true
        },
        reason: "session-action-run",
        sessionId: "session-1"
      }
    })).toBe(true);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        clientRefresh: {
          includeList: true
        },
        reason: "session-intent-run",
        sessionId: "session-1"
      }
    })).toBe(true);

    expect(sessionListRealtimeShouldRefresh({
      payload: {
        clientRefresh: {
          includeList: false
        },
        reason: "session-action-run",
        sessionId: "session-1"
      }
    })).toBe(false);
  });

  it("does not refresh selected session detail for launch-target-only session events", () => {
    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "launch-target-ready",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "launch-target-stopped",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-running",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-ready",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    for (const reason of [
      "codex-app-server-prompt-injected",
      "codex-app-server-reasoning-summary",
      "codex-app-server-terminal-assistant-message",
      "codex-app-server-terminal-user-message",
      "codex-context-replaced",
      "codex-prompt-injected"
    ]) {
      expect(selectedSessionRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      }, "session-1")).toBe(false);
    }

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-terminal-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "session-action-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "session-intent-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-idle",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    for (const reason of [
      "codex-app-server-turn-active",
      "codex-app-server-turn-claimed",
      "codex-app-server-turn-finalizing",
      "codex-app-server-turn-state"
    ]) {
      expect(selectedSessionRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      }, "session-1")).toBe(true);
    }

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result-provider-failed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(selectedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-terminal-started",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });
});
