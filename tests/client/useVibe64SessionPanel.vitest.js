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
      visibleRuntimeHostCount: 2,
      visibleRuntimeSessionIds: ["session-a", "session-b"],
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
import { useVibe64SessionPanel, vibe64SessionPanelProps } from "../../src/composables/useVibe64SessionPanel.js";

const purposePanelHarness = vi.hoisted(() => ({ data: null, registryInput: null, dataInput: null }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ref("project") }));
vi.mock("@/composables/useVibe64SessionData.js", () => ({ useVibe64SessionData: input => { purposePanelHarness.dataInput = input; return purposePanelHarness.data; } }));
vi.mock("@/composables/useVibe64SessionRepositoryStatusRegistry.js", () => ({
  useVibe64SessionRepositoryStatusRegistry: input => {
    purposePanelHarness.registryInput = input;
    return { observe: vi.fn(), refresh: vi.fn() };
  }
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => ({ data: ref({}), loadError: ref("") })
}));

function mountPurposePanel(purposeFilter = "") {
  const sessions = ref([
    { sessionId: "work", status: "active", draft: "keep working words" },
    { sessionId: "learn", status: "active", purpose: "learning", draft: "keep learner words" }
  ]);
  const selectedSessionId = ref("work");
  const selectSessionId = vi.fn(id => { selectedSessionId.value = id; });
  purposePanelHarness.data = {
    sessions, selectedSessionId,
    selectedSession: computed(() => sessions.value.find(s => s.sessionId === selectedSessionId.value) || null),
    isSelectedSessionArchived: ref(false), sessionsApiPath: ref("/original/sessions"),
    sessionList: reactive({ loadError: "", isInitialLoading: false }),
    createSessionRunning: ref(false), canCreateSession: ref(false),
    createSessionVisible: ref(false), createSessionTitle: ref("Unavailable"),
    selectSessionId, refreshSessionData: vi.fn()
  };
  const props = reactive({ purposeFilter });
  const scope = effectScope();
  const panel = scope.run(() => useVibe64SessionPanel(props, vi.fn()));
  return { scope, panel, props, data: purposePanelHarness.data };
}

describe("same session panel purpose filtering", () => {
  it("filters navigation while preserving original live enrichment and default behavior", () => {
    const sessions = [ { sessionId: "work" }, { sessionId: "learn", purpose: "learning" } ];
    const args = { sessions, runtimeStateBySessionId: { learn: { busy: true } } };
    expect(vibe64SessionPanelProps.purposeFilter.default).toBe("");
    expect(sessionPanelToolbarSessions(args).map(s => s.sessionId)).toEqual(["work", "learn"]);
    expect(sessionPanelToolbarSessions({ ...args, purposeFilter: "working" }).map(s => s.sessionId)).toEqual(["work"]);
    expect(sessionPanelToolbarSessions({ ...args, purposeFilter: "learning" })).toMatchObject([
      { sessionId: "learn", agentThinking: true }
    ]);
    expect(sessions).toEqual([ { sessionId: "work" }, { sessionId: "learn", purpose: "learning" } ]);
  });

  it("hides the wrong-purpose selection without selecting another session or losing mounted work/drafts", async () => {
    const f = mountPurposePanel("working");
    try {
      f.panel.setRuntimeBusy({ sessionId: "work", busy: true });
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work"]);
      f.props.purposeFilter = "learning";
      await nextTick();
      expect(f.panel.toolbar.sessions.map(s => s.sessionId)).toEqual(["learn"]);
      expect(f.panel.selection.selectedSessionId).toBe("");
      expect(f.panel.selection.selectedSession).toBe(null);
      expect(f.panel.emptyLayoutVisible.value).toBe(true);
      expect(f.data.selectedSessionId.value).toBe("work");
      expect(f.data.selectSessionId).not.toHaveBeenCalled();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work"]);
      expect(purposePanelHarness.registryInput.sessions).toBe(f.data.sessions);
      f.data.selectedSessionId.value = "learn";
      await nextTick();
      expect(f.panel.selection.selectedSessionId).toBe("learn");
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work", "learn"]);
      f.props.purposeFilter = "working";
      await nextTick();
      expect(f.panel.selection.selectedSessionId).toBe("");
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work", "learn"]);
      expect(f.panel.toolbar.sessions[0].agentThinking).toBe(true);
      expect(f.data.sessions.value.map(s => s.draft)).toEqual(["keep working words", "keep learner words"]);
      f.data.sessions.value = f.data.sessions.value.filter(s => s.sessionId !== "work");
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["learn"]);
      expect(f.data.selectSessionId).not.toHaveBeenCalled();
    } finally { f.scope.stop(); }
  });

  it("retains hidden mounted sessions through failed refresh and excludes actual archiving sessions", async () => {
    const f = mountPurposePanel();
    try {
      f.data.selectedSessionId.value = "learn";
      await nextTick();
      expect(f.panel.selection.selectedSessionId).toBe("learn");
      expect(f.panel.toolbar.sessions).toHaveLength(2);
      f.props.purposeFilter = "working";
      f.data.sessionList.loadError = "Updates unavailable";
      f.data.sessions.value = [];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work", "learn"]);
      f.data.sessionList.loadError = "";
      f.data.sessions.value = [{ sessionId: "learn", purpose: "learning", archiving: true }];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual([]);
      expect(f.data.selectedSessionId.value).toBe("learn");
      expect(f.data.selectSessionId).not.toHaveBeenCalled();
    } finally { f.scope.stop(); }
  });
});


describe("single panel Learning resource attachment", () => {
  it("forwards live mode/resource inputs to the one Data owner and skips source inspection for Learning", async () => {
    const f = mountPurposePanel("working");
    try {
      const resource = { data: ref({ learnerId: "own-learner", sessions: [] }) };
      f.props.learningResource = resource;
      expect(vibe64SessionPanelProps.learningResource.default).toBe(null);
      expect(purposePanelHarness.dataInput.learningResource()).toBe(f.props.learningResource);
      expect(purposePanelHarness.dataInput.purposeFilter()).toBe("working");
      f.props.purposeFilter = "learning";
      await nextTick();
      expect(purposePanelHarness.dataInput.purposeFilter()).toBe("learning");
      expect(purposePanelHarness.registryInput.sessions).toBe(f.data.sessions);
      expect(purposePanelHarness.registryInput.sessionSourceOperationsSuspended("learn")).toBe(true);
      expect(purposePanelHarness.registryInput.sessionSourceOperationsSuspended("work")).toBe(false);
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work"]);
    } finally { f.scope.stop(); }
  });

  it("retires removed Learning hosts despite a Working refresh error while keeping hidden Working work", async () => {
    const f = mountPurposePanel();
    try {
      f.props.learningResource = { data: ref({ learnerId: "own-learner", sessions: [] }) };
      f.data.selectedSessionId.value = "learn";
      await nextTick();
      f.data.selectedSessionId.value = "work";
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work", "learn"]);
      f.data.sessionList.loadError = "Working updates unavailable";
      f.data.sessions.value = [];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual(["work"]);
      f.data.sessionList.loadError = "";
      // The real Data owner clears selection after a confirmed empty read.
      f.data.selectedSessionId.value = "";
      await nextTick();
      f.data.sessions.value = [];
      await nextTick();
      expect(f.panel.runtimeHostSessionIds.value).toEqual([]);
    } finally { f.scope.stop(); }
  });
});
