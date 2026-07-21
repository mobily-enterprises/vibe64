import { describe, expect, it } from "vitest";
import {
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
  composerMenuProjectionFromRealtimePayload,
  rememberSessionComposerMenu,
  selectedSessionShouldLoadComposerMenu,
  sessionComposerMenuNeedsRefresh,
  sessionRecordHasComposerMenuProjection,
  sessionWithCachedComposerMenu
} from "../../src/lib/vibe64SessionComposerMenuProjection.js";
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

describe("current session alias synchronization", () => {
  it("publishes only a selected session confirmed by the loaded session list", () => {
    const sessions = [
      { sessionId: "session-1" },
      { sessionId: "session-2" }
    ];

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
    expect(selectedSessionIdForCurrentAlias({
      selectedSessionId: "session-2",
      sessionListLoaded: false,
      sessions
    })).toBe(null);
    expect(selectedSessionIdForCurrentAlias({
      selectedSessionId: "session-2",
      sessionListLoadError: "Could not load sessions.",
      sessions: []
    })).toBe(null);
    expect(selectedSessionIdForCurrentAlias({
      createSessionRunning: true,
      sessions: []
    })).toBe(null);
    expect(selectedSessionIdForCurrentAlias({
      sessions: []
    })).toBe("");
  });

  it("coalesces rapid current-session publications to the latest selection", async () => {
    const calls = [];
    let releaseFirst = () => null;
    let markFirstStarted = () => null;
    const firstPublication = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const firstPublicationStarted = new Promise((resolve) => {
      markFirstStarted = resolve;
    });
    const publisher = createVibe64CurrentSessionPublisher({
      async publish({ sessionId }) {
        calls.push(sessionId);
        if (sessionId === "session-1") {
          markFirstStarted();
          await firstPublication;
        }
      }
    });

    publisher.request({
      apiPath: "/project-a/sessions/current",
      sessionId: "session-1"
    });
    await firstPublicationStarted;
    publisher.request({
      apiPath: "/project-a/sessions/current",
      sessionId: "session-2"
    });
    const publishing = publisher.request({
      apiPath: "/project-a/sessions/current",
      sessionId: "session-3"
    });
    releaseFirst();
    await publishing;

    expect(calls).toEqual(["session-1", "session-3"]);
  });

  it("deduplicates successful publications within one project only", async () => {
    const calls = [];
    const publisher = createVibe64CurrentSessionPublisher({
      async publish(publication) {
        calls.push(publication);
      }
    });

    await publisher.request({ apiPath: "/project-a/current", sessionId: "session-1" });
    await publisher.request({ apiPath: "/project-a/current", sessionId: "session-1" });
    await publisher.request({ apiPath: "/project-b/current", sessionId: "session-1" });

    expect(calls).toEqual([
      {
        apiPath: "/project-a/current",
        sessionId: "session-1"
      },
      {
        apiPath: "/project-b/current",
        sessionId: "session-1"
      }
    ]);
  });
});

describe("mounted Vibe64 session state", () => {
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

    expect(mountedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
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

    expect(mountedSessionRecord(detailRecord, listSummary, "session-1")).toBe(listSummary);
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

    expect(mountedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
    expect(mountedSessionDetailRefreshReason(detailRecord, listSummary, "session-1"))
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

    expect(mountedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
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

    expect(mountedSessionDetailRefreshReason(detailRecord, listSummary, "session-1"))
      .toBe("");
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
    expect(mountedSessionDetailLoadState({
      listSession: {
        sessionId: "session-1"
      },
      sessionId: "session-1"
    })).toMatchObject({
      label: "Session controls could not load.",
      loading: false,
      ready: false,
      state: "summaryOnly",
      suppressPassiveComposer: false
    });

    expect(mountedSessionDetailLoadState({
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
      sessionId: "session-1"
    })).toMatchObject({
      label: "",
      loading: false,
      ready: true,
      refreshing: true,
      state: "detailReady",
      suppressPassiveComposer: false
    });

    expect(mountedSessionDetailLoadState({
      fetching: true,
      listSession: {
        sessionId: "session-1"
      },
      sessionId: "session-1"
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

    expect(mountedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
  });

  it("uses provider and durable message truth instead of stale generic agent runs", () => {
    expect(sessionRecordHasActiveAgentWork({
      agentRuns: [
        {
          state: "finalizing"
        }
      ]
    })).toBe(false);
    expect(sessionRecordHasActiveAgentWork({
      agentSession: {
        turn: {
          active: true
        }
      }
    })).toBe(true);
    expect(sessionRecordHasActiveAgentWork({
      composerMessages: [
        {
          state: "accepted"
        }
      ]
    })).toBe(true);
  });

  it("does not mistake a stale workflow wait for active assistant work", () => {
    expect(sessionRecordHasActiveAgentWork({
      presentation: {
        prompt: {
          state: "waiting_for_agent"
        },
        step: {
          status: "awaiting_agent_result"
        }
      },
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);
  });

  it("uses the list summary while the selected detail record is unavailable", () => {
    const listSummary = {
      currentStep: "step_c",
      sessionId: "session-1"
    };

    expect(mountedSessionRecord(null, listSummary, "session-1")).toBe(listSummary);
    expect(mountedSessionRecord({
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
      "codex-app-server-message-delivered"
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
    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "launch-target-ready",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "launch-target-stopped",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-running",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(mountedSessionRealtimeShouldRefresh({
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
      "codex-app-server-message-delivered",
      "codex-context-replaced",
      "codex-prompt-injected"
    ]) {
      expect(mountedSessionRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      }, "session-1")).toBe(false);
    }

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "agent-terminal-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "session-action-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "session-intent-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(mountedSessionRealtimeShouldRefresh({
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
      expect(mountedSessionRealtimeShouldRefresh({
        payload: {
          reason,
          sessionId: "session-1"
        }
      }, "session-1")).toBe(false);
    }

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result-provider-failed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(mountedSessionRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(mountedSessionRealtimeShouldRefresh({
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
      revision: 12,
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
      revision: 12,
      sessionId: "session-1"
    });

    expect(agentTurnRealtimeOverlayFromPayload({
      agentSession: {
        turn: {
          active: true
        }
      },
      revision: 12,
      sessionId: "session-2"
    }, "session-1")).toBe(null);

    expect(agentTurnRealtimeOverlayFromPayload({
      agentSession: {
        turn: {
          active: true
        }
      },
      sessionId: "session-1"
    }, "session-1")).toBe(null);
  });

  it("accepts assistant turn completion events only for the host's fixed session", () => {
    const payload = {
      agentRun: {
        id: "codex_app_server",
        state: "completed"
      },
      agentSession: {
        turn: {
          active: false,
          id: "turn-2",
          state: "idle"
        }
      },
      reason: "codex-app-server-turn-idle",
      revision: 14,
      sessionId: "session-2"
    };

    expect(agentTurnRealtimeOverlayFromPayload(payload, "session-2")).toMatchObject({
      active: false,
      revision: 14,
      sessionId: "session-2"
    });
    expect(agentTurnRealtimeOverlayFromPayload(payload, "session-1")).toBe(null);
  });

  it("repairs a missed completion event from a newer authoritative session refresh", () => {
    const activeSnapshot = {
      agentSession: {
        turn: {
          active: true,
          id: "turn-1",
          state: "active"
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 12,
      sessionId: "session-1"
    };
    const idleSnapshot = {
      agentSession: {
        turn: {
          active: false,
          id: "turn-1",
          state: "idle"
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 13,
      sessionId: "session-1"
    };
    const reconciledSnapshot = latestSessionDetailRecord(
      activeSnapshot,
      idleSnapshot,
      "session-1"
    );

    expect(reconciledSnapshot).toMatchObject({
      agentSession: {
        turn: {
          active: false,
          state: "idle"
        }
      },
      revision: 13
    });
  });

  it("orders assistant turn events and canonical session snapshots by revision", () => {
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
      revision: 11,
      sessionId: "session-1"
    };

    const activeOverlay = {
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
      revision: 12,
      sessionId: "session-1"
    };
    const activeSession = sessionWithAgentTurnRealtimeOverlay(session, activeOverlay);

    expect(activeSession).not.toBe(session);
    expect(activeSession.agentSession.turn.active).toBe(true);
    expect(activeSession.agentSession.turn.state).toBe("active");
    expect(activeSession.agentRuns[0].state).toBe("active");
    expect(activeSession.revision).toBe(12);

    const idleOverlay = {
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
      revision: 13,
      sessionId: "session-1"
    };
    const idleSession = sessionWithAgentTurnRealtimeOverlay(session, idleOverlay);

    expect(idleSession.agentSession.turn.active).toBe(false);
    expect(idleSession.agentSession.turn.state).toBe("idle");
    expect(idleSession.agentRuns[0].state).toBe("completed");
    expect(idleSession.revision).toBe(13);

    expect(latestAgentTurnRealtimeOverlay(idleOverlay, activeOverlay)).toBe(idleOverlay);

    const canonicalIdleSession = {
      ...session,
      revision: 13
    };
    expect(sessionWithAgentTurnRealtimeOverlay(canonicalIdleSession, activeOverlay)).toBe(canonicalIdleSession);
    expect(sessionWithAgentTurnRealtimeOverlay(canonicalIdleSession, idleOverlay)).toBe(canonicalIdleSession);
  });
});
