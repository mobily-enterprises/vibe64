import { describe, expect, it } from "vitest";

import {
  sessionPanelDashboardContext,
  sessionPanelEmptyStateActivity,
  sessionPanelRuntimeHostDiagnostics,
  sessionPanelSelectedSessionArchiving,
  sessionPanelToolbarSessions,
  sessionRepositoryWorkState
} from "../../src/composables/useVibe64SessionPanel.js";

describe("useVibe64SessionPanel", () => {
  it("uses the empty-state loader for both initial loading and session creation", () => {
    expect(sessionPanelEmptyStateActivity({
      sessionListInitialLoading: true
    })).toBe("loading");
    expect(sessionPanelEmptyStateActivity({
      createSessionRunning: true,
      sessionListInitialLoading: true
    })).toBe("creating");
    expect(sessionPanelEmptyStateActivity({
      createSessionRunning: true,
      selectedSession: {
        sessionId: "session-a"
      }
    })).toBe("");
    expect(sessionPanelEmptyStateActivity()).toBe("");
  });

  it("passes project setup metadata into empty dashboard context", () => {
    const projectContext = {
      foundation: {
        ready: true
      },
      setup: {
        studioSetupEnabled: false
      }
    };

    expect(sessionPanelDashboardContext(projectContext)).toEqual({
      projectContext,
      sessionsApiPath: ""
    });
    expect(sessionPanelDashboardContext(null)).toEqual({
      projectContext: {},
      sessionsApiPath: ""
    });
  });

  it("blocks only the session whose archive request is in flight", () => {
    expect(sessionPanelSelectedSessionArchiving({
      archive: {
        archiving: true,
        archivingSessionId: "session-a"
      },
      selectedSessionId: "session-a"
    })).toBe(true);
    expect(sessionPanelSelectedSessionArchiving({
      archive: {
        archiving: true,
        archivingSessionId: "session-a"
      },
      selectedSessionId: "session-b"
    })).toBe(false);
    expect(sessionPanelSelectedSessionArchiving({
      archive: {
        archiving: false,
        archivingSessionId: "session-a"
      },
      selectedSessionId: "session-a"
    })).toBe(false);
  });

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
      visibleSessionCount: 2
    });
  });

  it("marks toolbar sessions as assistant-thinking from selected detail and runtime state", () => {
    const sessions = [
      {
        sessionId: "session-a",
        sessionName: "Alpha"
      },
      {
        sessionId: "session-b",
        sessionName: "Beta"
      },
      {
        sessionId: "session-d",
        sessionName: "Delta"
      },
      {
        agentThinking: true,
        sessionId: "session-c",
        sessionName: "Gamma"
      }
    ];

    expect(sessionPanelToolbarSessions({
      runtimeStateBySessionId: {
        "session-b": {
          agentThinking: true,
          repositoryWorkState: { checkedAt: "now", state: "unsaved" }
        },
        "session-d": {
          busy: true
        }
      },
      selectedSession: {
        agentSession: {
          turn: {
            active: true
          }
        },
        sessionId: "session-a"
      },
      selectedSessionId: "session-a",
      sessions
    })).toMatchObject([
      { agentThinking: true, repositoryWorkState: { state: "checking" }, sessionId: "session-a" },
      { agentThinking: true, repositoryWorkState: { state: "unsaved" }, sessionId: "session-b" },
      { agentThinking: true, repositoryWorkState: { state: "checking" }, sessionId: "session-d" },
      { agentThinking: false, repositoryWorkState: { state: "checking" }, sessionId: "session-c" }
    ]);
  });

  it("never reports unknown or failed repository inspection as saved", () => {
    expect(sessionRepositoryWorkState(null)).toEqual({ checkedAt: "", state: "checking" });
    expect(sessionRepositoryWorkState({ error: "Git unavailable", unsaved: null })).toEqual({
      checkedAt: "",
      state: "unavailable"
    });
    expect(sessionRepositoryWorkState({ checkedAt: "now", unsaved: false })).toEqual({
      checkedAt: "now",
      state: "saved"
    });
    expect(sessionRepositoryWorkState({
      checkedAt: "now",
      changedPaths: ["one.js", "two.js"],
      unsaved: true,
      updateAvailable: true
    })).toEqual({
      changedCount: 2,
      checkedAt: "now",
      state: "unsaved",
      updateAvailable: true
    });
    expect(sessionRepositoryWorkState({
      checkedAt: "now",
      unsaved: false,
      updateAvailable: true
    })).toEqual({
      checkedAt: "now",
      state: "update_available"
    });
    expect(sessionRepositoryWorkState({
      loading: false, unsaved: null, updateAvailable: true, updateStatusPending: true
    })).toEqual({ checkedAt: "", state: "update_available", updateStatusPending: true });
    expect(sessionRepositoryWorkState({
      operation: { status: "running" },
      unsaved: true
    }).state).toBe("saving");
    expect(sessionRepositoryWorkState({
      updateOperation: { status: "failed" },
      unsaved: false
    }).state).toBe("needs_help");
    expect(sessionRepositoryWorkState({
      changedPaths: ["local.txt"],
      operation: {
        code: "vibe64_session_save_update_required",
        error: "Update before saving.",
        status: "failed"
      },
      unsaved: true,
      updateAvailable: true
    })).toEqual({
      changedCount: 1,
      checkedAt: "",
      state: "unsaved",
      updateAvailable: true
    });
  });

  it("shows connected work as unsaved even when the main repository is clean", () => {
    const work = {
      checkedAt: "now",
      unsaved: false,
      changedPaths: [],
      connectedSaveRequired: true,
      updateStatusPending: true
    };
    expect(sessionRepositoryWorkState(work)).toEqual({
      checkedAt: "now", changedCount: 0, state: "unsaved",
      updateAvailable: false, updateStatusPending: true
    });
    expect(sessionRepositoryWorkState({ ...work, connectedSaveRequired: false }).state).toBe("saved");
    expect(sessionRepositoryWorkState({ ...work, operation: { status: "running" } }).state).toBe("saving");
  });

  it("keeps ten uninspected session chips in a bounded honest checking state", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `session-${index + 1}`,
      status: "active"
    }));
    const projected = sessionPanelToolbarSessions({
      runtimeStateBySessionId: {
        "session-1": {
          repositoryWorkState: { checkedAt: "now", state: "unsaved" }
        }
      },
      selectedSession: sessions[0],
      selectedSessionId: "session-1",
      sessions
    });

    expect(projected).toHaveLength(10);
    expect(projected[0].repositoryWorkState.state).toBe("unsaved");
    expect(projected.slice(1).map((session) => session.repositoryWorkState.state))
      .toEqual(Array(9).fill("checking"));
    expect(projected.some((session) => session.repositoryWorkState.state === "saved")).toBe(false);
  });
});


import { computed, effectScope, nextTick, reactive, ref } from "vue";
import { vi } from "vitest";
import { useVibe64SessionPanel } from "../../src/composables/useVibe64SessionPanel.js";

const panelHarness = vi.hoisted(() => ({ data: null, registryInput: null, route: { query: {} } }));
vi.mock("vue-router", () => ({ useRoute: () => panelHarness.route }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ref("project") }));
vi.mock("@/composables/useVibe64SessionData.js", () => ({ useVibe64SessionData: () => panelHarness.data }));
vi.mock("@/composables/useVibe64SessionRepositoryStatusRegistry.js", () => ({
  useVibe64SessionRepositoryStatusRegistry: input => {
    panelHarness.registryInput = input;
    return { observe: vi.fn(), refresh: vi.fn() };
  }
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => ({ data: ref({}), loadError: ref("") })
}));

function mountPanel() {
  const sessions = ref([
    { sessionId: "work", status: "active", draft: "keep working words" },
    { sessionId: "other", status: "active", draft: "keep other words" }
  ]);
  const selectedSessionId = ref("work");
  const selectSessionId = vi.fn(id => { selectedSessionId.value = id; });
  panelHarness.data = {
    sessions, selectedSessionId,
    selectedSession: computed(() => sessions.value.find(s => s.sessionId === selectedSessionId.value) || null),
    isSelectedSessionArchived: ref(false), sessionsApiPath: ref("/original/sessions"),
    sessionList: reactive({ loadError: "", isInitialLoading: false }),
    createSessionRunning: ref(false), canCreateSession: ref(false),
    createSessionVisible: ref(false), createSessionTitle: ref("Unavailable"),
    selectSessionId, refreshSessionData: vi.fn()
  };
  const props = reactive({});
  const scope = effectScope();
  const panel = scope.run(() => useVibe64SessionPanel(props, vi.fn()));
  return { scope, panel, props, data: panelHarness.data };
}

describe("mounted session hosts", () => {
  it("retains mounted sessions through failed refresh and excludes actual archiving sessions", async () => {
    const f = mountPanel();
    try {
      f.data.selectedSessionId.value = "other";
      await nextTick();
      expect(f.panel.selection.selectedSessionId).toBe("other");
      expect(f.panel.toolbar.sessions).toHaveLength(2);
      expect(panelHarness.registryInput.sessions).toBe(f.data.sessions);
      f.data.sessionList.loadError = "Updates unavailable";
      f.data.sessions.value = [];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work", "other"]);
      f.data.sessionList.loadError = "";
      f.data.sessions.value = [{ sessionId: "other", archiving: true }];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual([]);
      expect(f.data.selectedSessionId.value).toBe("other");
      expect(f.data.selectSessionId).not.toHaveBeenCalled();
    } finally { f.scope.stop(); }
  });

  it("never mounts a runtime for a selected session this project does not list", async () => {
    const f = mountPanel();
    try {
      f.data.selectedSessionId.value = "another-projects-session";
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work"]);
      expect(panelHarness.registryInput.selectedSessionId()).toBe("");
      f.data.sessionList.loadError = "Updates unavailable";
      f.data.sessions.value = [];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work"]);
    } finally { f.scope.stop(); }
  });

  it("before the first list mounts only this project's remembered selection, never the link's", async () => {
    const f = mountPanel();
    try {
      f.data.sessionList.isInitialLoading = true;
      f.data.sessions.value = [];
      f.data.selectedSessionId.value = "remembered";
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["remembered"]);
      panelHarness.route = { query: { session: "linked" } };
      const g = mountPanel();
      try {
        g.data.sessionList.isInitialLoading = true;
        g.data.sessions.value = [];
        g.data.selectedSessionId.value = "linked";
        await nextTick();
        expect(g.panel.runtimeHostSessionIds.value).toEqual([]);
      } finally { g.scope.stop(); }
    } finally { f.scope.stop(); panelHarness.route = { query: {} }; }
  });
});
