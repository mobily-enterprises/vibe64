import { describe, expect, it } from "vitest";
import {
  composerMenuProjectionFromRealtimePayload,
  agentTurnRealtimeOverlayFromPayload,
  rememberSessionComposerMenu,
  rememberSessionDetailRecord,
  selectedSessionShouldLoadComposerMenu,
  sessionDetailRecordForId,
  sessionListRealtimeShouldRefresh,
  sessionComposerMenuNeedsRefresh,
  sessionRecordHasComposerMenuProjection,
  sessionRecordHasActiveAgentWork,
  sessionWithCachedComposerMenu,
  sessionWithAgentTurnRealtimeOverlay,
  selectedSessionRealtimeShouldRefresh,
  selectedSessionDetailLoadState,
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

  it("does not refresh selected detail when the workflow has no composer menu", () => {
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
      .toBe("");
  });

  it("refreshes selected detail when list projection advertises a missing composer menu", () => {
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
      presentation: {
        composerMenu: {
          itemCount: 1,
          signature: "menu-signature"
        }
      },
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

  it("does not suppress the passive composer after selected detail loading has stopped", () => {
    expect(selectedSessionDetailLoadState({
      listSession: {
        sessionId: "session-1"
      },
      selectedSessionId: "session-1"
    })).toMatchObject({
      label: "Session controls could not load.",
      loading: false,
      ready: false,
      state: "summaryOnly",
      suppressPassiveComposer: false
    });

    expect(selectedSessionDetailLoadState({
      detailSession: {
        presentation: {
          screen: {
            kind: "conversation"
          }
        },
        sessionId: "session-1"
      },
      fetching: true,
      listSession: {
        sessionId: "session-1"
      },
      selectedSessionId: "session-1"
    })).toMatchObject({
      label: "",
      loading: false,
      ready: true,
      refreshing: true,
      state: "detailReady",
      suppressPassiveComposer: false
    });

    expect(selectedSessionDetailLoadState({
      fetching: true,
      listSession: {
        sessionId: "session-1"
      },
      selectedSessionId: "session-1"
    })).toMatchObject({
      label: "Loading session controls...",
      loading: true,
      state: "detailLoading",
      suppressPassiveComposer: true
    });
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

  it("requests a full composer menu only after a menu projection or explicit request exists", () => {
    expect(selectedSessionShouldLoadComposerMenu({
      composerMenusById: {},
      requestedComposerMenusById: {},
      sessionId: "session-1"
    })).toBe(false);

    expect(selectedSessionShouldLoadComposerMenu({
      composerMenusById: {},
      requestedComposerMenusById: {},
      session: {
        presentation: {
          composerMenu: {
            itemCount: 1,
            signature: "menu-signature"
          }
        },
        sessionId: "session-1"
      },
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
      session: {
        presentation: {
          composerMenu: {
            itemCount: 0,
            signature: "menu-signature"
          }
        },
        sessionId: "session-1"
      },
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

  it("keeps active assistant detail over a newer shallow list summary", () => {
    const detailRecord = {
      agentSession: {
        turn: {
          active: true
        }
      },
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

  it("treats active agent runs as active assistant work", () => {
    expect(sessionRecordHasActiveAgentWork({
      agentRuns: [
        {
          state: "finalizing"
        }
      ]
    })).toBe(true);
    expect(sessionRecordHasActiveAgentWork({
      agentRuns: [
        {
          active: false,
          state: "failed"
        }
      ]
    })).toBe(false);
  });

  it("restores cached active assistant detail after switching sessions", () => {
    const detailCache = {};
    const activeDetailRecord = {
      agentSession: {
        turn: {
          active: true
        }
      },
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
        reason: "agent-terminal-closed",
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
        reason: "agent-terminal-started",
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
      "session-source-recovered"
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
        reason: "agent-terminal-started",
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
        reason: "agent-terminal-started",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });

  it("builds a selected-session assistant turn overlay from realtime payloads", () => {
    const overlay = agentTurnRealtimeOverlayFromPayload({
      agentRun: {
        id: "codex_app_server",
        providerStatus: "inProgress",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        state: "active"
      },
      agentSession: {
        providerId: "codex",
        thread: {
          id: "thread-1"
        },
        transportId: "codex_app_server",
        turn: {
          active: true,
          id: "turn-1",
          state: "active",
          status: "inProgress",
          threadId: "thread-1"
        }
      },
      reason: "codex-app-server-turn-active",
      sessionId: "session-1"
    }, "session-1");

    expect(overlay).toMatchObject({
      active: true,
      agentSession: {
        thread: {
          id: "thread-1"
        },
        turn: {
          active: true,
          id: "turn-1"
        }
      },
      sessionId: "session-1"
    });

    expect(agentTurnRealtimeOverlayFromPayload({
      agentSession: {
        turn: {
          active: true
        }
      },
      sessionId: "session-2"
    }, "session-1")).toBe(null);
  });

  it("applies active and idle assistant turn overlays without replacing the session record", () => {
    const session = {
      agentRuns: [
        {
          id: "codex_app_server",
          state: "completed"
        }
      ],
      agentSession: {
        thread: {
          id: "thread-1"
        },
        turn: {
          active: false,
          id: "turn-1",
          state: "idle",
          threadId: "thread-1"
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      sessionId: "session-1"
    };

    const activeSession = sessionWithAgentTurnRealtimeOverlay(session, {
      active: true,
      agentRun: {
        id: "codex_app_server",
        providerStatus: "inProgress",
        state: "active"
      },
      agentSession: {
        thread: {
          id: "thread-1"
        },
        turn: {
          active: true,
          id: "turn-1",
          state: "active",
          status: "inProgress",
          threadId: "thread-1"
        }
      },
      sessionId: "session-1"
    });

    expect(activeSession).not.toBe(session);
    expect(activeSession.agentSession.turn.active).toBe(true);
    expect(activeSession.agentSession.turn.state).toBe("active");
    expect(activeSession.agentRuns[0].state).toBe("active");

    const idleSession = sessionWithAgentTurnRealtimeOverlay(activeSession, {
      active: false,
      agentRun: {
        id: "codex_app_server",
        providerStatus: "completed",
        state: "completed"
      },
      agentSession: {
        thread: {
          id: "thread-1"
        },
        turn: {
          active: false,
          id: "turn-1",
          state: "idle",
          status: "completed",
          threadId: "thread-1"
        }
      },
      sessionId: "session-1"
    });

    expect(idleSession.agentSession.turn.active).toBe(false);
    expect(idleSession.agentSession.turn.state).toBe("idle");
    expect(idleSession.agentRuns[0].state).toBe("completed");
  });
});
