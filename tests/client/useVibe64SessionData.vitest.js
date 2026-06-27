import { describe, expect, it } from "vitest";
import {
  composerMenuProjectionFromRealtimePayload,
  codexTurnRealtimeOverlayFromPayload,
  rememberSessionComposerMenu,
  rememberSessionDetailRecord,
  selectedSessionShouldLoadComposerMenu,
  sessionDetailRecordForId,
  sessionListRealtimeShouldRefresh,
  sessionComposerMenuNeedsRefresh,
  sessionRecordHasComposerMenuProjection,
  sessionRecordHasActiveCodexWork,
  sessionWithCachedComposerMenu,
  sessionWithCodexTurnRealtimeOverlay,
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

  it("treats composer menu signatures as a complete menu projection", () => {
    expect(sessionRecordHasComposerMenuProjection({
      presentation: {
        composerMenu: {
          itemCount: 3,
          signature: "menu-signature"
        }
      }
    })).toBe(true);
  });

  it("hydrates signature-only composer menu projections from the session menu cache", () => {
    const composerMenusById = {};
    const menuItems = [
      {
        id: "core.deslop_changes",
        label: "Deslop changes"
      }
    ];
    const fullSession = {
      presentation: {
        composerMenu: {
          itemCount: 1,
          items: menuItems,
          signature: "menu-signature"
        }
      },
      sessionId: "session-1"
    };
    const leanSession = {
      presentation: {
        composerMenu: {
          itemCount: 1,
          signature: "menu-signature"
        },
        screen: {
          kind: "conversation"
        }
      },
      sessionId: "session-1"
    };

    expect(rememberSessionComposerMenu(composerMenusById, fullSession)).toBe(true);

    const hydratedSession = sessionWithCachedComposerMenu(
      leanSession,
      composerMenusById["session-1"]
    );

    expect(hydratedSession).not.toBe(leanSession);
    expect(hydratedSession.presentation.composerMenu.items).toBe(menuItems);
    expect(sessionComposerMenuNeedsRefresh(leanSession, composerMenusById["session-1"]))
      .toBe(false);
  });

  it("keeps stale composer menu cache entries out of the visible session", () => {
    const leanSession = {
      presentation: {
        composerMenu: {
          itemCount: 2,
          signature: "new-menu-signature"
        }
      },
      sessionId: "session-1"
    };
    const cachedMenu = {
      itemCount: 1,
      items: [
        {
          id: "core.old_action"
        }
      ],
      signature: "old-menu-signature"
    };

    expect(sessionWithCachedComposerMenu(leanSession, cachedMenu)).toBe(leanSession);
    expect(sessionComposerMenuNeedsRefresh(leanSession, cachedMenu)).toBe(true);
  });

  it("requests a full composer menu only while the selected menu cache is cold or requested", () => {
    expect(selectedSessionShouldLoadComposerMenu({
      composerMenusById: {},
      requestedComposerMenusById: {},
      sessionId: "session-1"
    })).toBe(true);

    expect(selectedSessionShouldLoadComposerMenu({
      composerMenusById: {
        "session-1": {
          items: [],
          signature: "menu-signature"
        }
      },
      requestedComposerMenusById: {},
      sessionId: "session-1"
    })).toBe(false);

    expect(selectedSessionShouldLoadComposerMenu({
      composerMenusById: {
        "session-1": {
          items: [],
          signature: "menu-signature"
        }
      },
      requestedComposerMenusById: {
        "session-1": true
      },
      sessionId: "session-1"
    })).toBe(true);
  });

  it("extracts composer menu invalidation from realtime session payloads", () => {
    expect(composerMenuProjectionFromRealtimePayload({
      composerMenu: {
        itemCount: 2,
        signature: "menu-signature"
      },
      sessionId: "session-1"
    }, "session-1")).toEqual({
      itemCount: 2,
      sessionId: "session-1",
      signature: "menu-signature"
    });

    expect(composerMenuProjectionFromRealtimePayload({
      composerMenu: {
        signature: "menu-signature"
      },
      sessionId: "session-2"
    }, "session-1")).toBe(null);
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

  it("treats active agent runs as active Codex work", () => {
    expect(sessionRecordHasActiveCodexWork({
      agentRuns: [
        {
          state: "finalizing"
        }
      ]
    })).toBe(true);
    expect(sessionRecordHasActiveCodexWork({
      agentRuns: [
        {
          active: false,
          state: "failed"
        }
      ]
    })).toBe(false);
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
      "codex-app-server-final-assistant-message",
      "codex-app-server-live-progress",
      "codex-app-server-prompt-injected",
      "codex-app-server-terminal-thinking-message",
      "codex-app-server-turn-finalizing",
      "codex-app-server-turn-state",
      "codex-app-server-turn-steered"
    ]) {
      expect(sessionListRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      })).toBe(false);
    }

    for (const reason of [
      "codex-app-server-turn-active",
      "codex-app-server-turn-idle"
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
      "codex-app-server-final-assistant-message",
      "codex-app-server-live-progress",
      "codex-app-server-reasoning-summary",
      "codex-app-server-terminal-assistant-message",
      "codex-app-server-terminal-thinking-message",
      "codex-app-server-terminal-user-message",
      "codex-app-server-turn-steered",
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
    }, "session-1")).toBe(false);

    for (const reason of [
      "codex-app-server-turn-active",
      "codex-app-server-turn-claimed",
      "codex-app-server-turn-finalizing",
      "codex-app-server-turn-idle",
      "codex-app-server-turn-state"
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

  it("builds a selected-session Codex turn overlay from realtime payloads", () => {
    const overlay = codexTurnRealtimeOverlayFromPayload({
      codexAgentRun: {
        id: "codex_app_server",
        providerStatus: "inProgress",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        state: "active"
      },
      codexAgentTurn: {
        active: true,
        state: "active",
        status: "inProgress",
        threadId: "thread-1",
        turnId: "turn-1"
      },
      codexAgentTurnActive: true,
      reason: "codex-app-server-turn-active",
      sessionId: "session-1"
    }, "session-1");

    expect(overlay).toMatchObject({
      active: true,
      codexAgentTurn: {
        active: true,
        threadId: "thread-1",
        turnId: "turn-1"
      },
      sessionId: "session-1"
    });

    expect(codexTurnRealtimeOverlayFromPayload({
      codexAgentTurnActive: true,
      sessionId: "session-2"
    }, "session-1")).toBe(null);
  });

  it("applies active and idle Codex turn overlays without replacing the session record", () => {
    const session = {
      agentRuns: [
        {
          id: "codex_app_server",
          state: "completed"
        }
      ],
      codexAgentTurn: {
        active: false,
        state: "idle",
        threadId: "thread-1",
        turnId: "turn-1"
      },
      codexAgentTurnActive: false,
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      sessionId: "session-1"
    };

    const activeSession = sessionWithCodexTurnRealtimeOverlay(session, {
      active: true,
      codexAgentRun: {
        id: "codex_app_server",
        providerStatus: "inProgress",
        state: "active"
      },
      codexAgentTurn: {
        active: true,
        state: "active",
        status: "inProgress",
        threadId: "thread-1",
        turnId: "turn-1"
      },
      sessionId: "session-1"
    });

    expect(activeSession).not.toBe(session);
    expect(activeSession.codexAgentTurnActive).toBe(true);
    expect(activeSession.codexAgentTurn.state).toBe("active");
    expect(activeSession.agentRuns[0].state).toBe("active");

    const idleSession = sessionWithCodexTurnRealtimeOverlay(activeSession, {
      active: false,
      codexAgentRun: {
        id: "codex_app_server",
        providerStatus: "completed",
        state: "completed"
      },
      codexAgentTurn: {
        active: false,
        state: "idle",
        status: "completed",
        threadId: "thread-1",
        turnId: "turn-1"
      },
      sessionId: "session-1"
    });

    expect(idleSession.codexAgentTurnActive).toBe(false);
    expect(idleSession.codexAgentTurn.state).toBe("idle");
    expect(idleSession.agentRuns[0].state).toBe("completed");
  });
});
