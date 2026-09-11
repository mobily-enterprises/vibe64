import { computed, effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const creationHarness = vi.hoisted(() => ({
  createRun: null,
  archiveRun: null,
  realtime: null,
  feedback: null,
  endpointResource: null,
  projectSlug: null,
  queryData: null,
  querySetData: null,
  refetch: null,
  renewalEndpointResource: null,
  selectedId: null,
  select: null,
  selectAvailableId: null,
  updateRun: null
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: (options) => { creationHarness.realtime = options; }
}));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({ error: (...args) => creationHarness.feedback(...args) })
}));

vi.mock("@tanstack/vue-query", () => ({
  useQueryClient: () => ({
    getQueryData: () => creationHarness.queryData.value,
    setQueryData: creationHarness.querySetData
  })
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options = {}) {
    if (options.placementSource === "vibe64.sessions.archive") {
      return { isRunning: false, run: async (context) => {
        const result = await creationHarness.archiveRun(context);
        await options.onRunSuccess?.(result, { context });
        return result;
      } };
    }
    const run = options.apiSuffix === "/vibe64/sessions"
      ? creationHarness.createRun
      : creationHarness.updateRun;
    return {
      isRunning: false,
      run: (...args) => run(...args)
    };
  }
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: (options = {}) => {
    const queryKey = options.queryKey?.value || options.queryKey || [];
    return (
      String(options.path?.value || options.path || "").endsWith("/renewal") ||
      (Array.isArray(queryKey) && queryKey.at(-1) === "renewal")
      ? creationHarness.renewalEndpointResource
      : creationHarness.endpointResource
    );
  }
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api/${creationHarness.projectSlug.value}${suffix}`
  })
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => creationHarness.projectSlug
}));

vi.mock("@/composables/useVibe64SessionSelection.js", () => ({
  useVibe64SessionSelection: () => ({
    clear() {
      creationHarness.selectedId.value = "";
    },
    select: creationHarness.select,
    selectAvailableId: creationHarness.selectAvailableId,
    selectedId: creationHarness.selectedId
  })
}));

import {
  useVibe64SessionData
} from "../../src/composables/useVibe64SessionData.js";
import {
  SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS,
  useVibe64SessionRenewal
} from "../../src/composables/useVibe64SessionRenewal.js";

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((settle, fail) => {
    reject = fail;
    resolve = settle;
  });
  return { promise, reject, resolve };
}

function mountSessionData() {
  const scope = effectScope();
  const sessionData = scope.run(() => useVibe64SessionData());
  return { scope, sessionData };
}

beforeEach(() => {
  creationHarness.projectSlug = ref("project-a");
  creationHarness.selectedId = ref("");
  creationHarness.createRun = vi.fn();
  creationHarness.archiveRun = vi.fn(async () => ({ ok: true }));
  creationHarness.feedback = vi.fn();
  creationHarness.updateRun = vi.fn(async () => ({ ok: true }));
  creationHarness.refetch = vi.fn(async () => ({ data: { sessions: [] } }));
  creationHarness.queryData = ref({
    creation: { canCreate: true, showCreateAction: true },
    limits: { maxOpenSessions: 3, openSessionCount: 0 },
    sessions: []
  });
  creationHarness.querySetData = vi.fn((_key, update) => {
    creationHarness.queryData.value = typeof update === "function"
      ? update(creationHarness.queryData.value)
      : update;
  });
  creationHarness.select = vi.fn((sessionId = "") => {
    creationHarness.selectedId.value = sessionId;
  });
  creationHarness.selectAvailableId = vi.fn((items, {
    fallbackId = "",
    getId = (item) => item?.id
  } = {}) => {
    const ids = items.map(getId);
    if (!ids.includes(creationHarness.selectedId.value)) {
      creationHarness.selectedId.value = fallbackId;
    }
    return creationHarness.selectedId.value;
  });
  creationHarness.endpointResource = {
    data: computed(() => creationHarness.queryData.value),
    isInitialLoading: ref(false),
    isLoading: ref(false),
    loadError: ref(""),
    query: {
      refetch: creationHarness.refetch
    },
    reload: creationHarness.refetch
  };
  creationHarness.renewalEndpointResource = {
    data: ref({
      ok: true,
      renewal: null,
      viewerScope: `viewer-v1-${"1".repeat(32)}`
    }),
    isInitialLoading: ref(false),
    isLoading: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => creationHarness.renewalEndpointResource.data.value)
  };
});

describe("Vibe64 session creation", () => {
  it("does not auto-select a session created remotely after a settled empty list", async () => {
    const { scope } = mountSessionData();
    await nextTick();
    expect(creationHarness.selectedId.value).toBe("");

    creationHarness.selectAvailableId.mockClear();
    creationHarness.queryData.value = {
      creation: { canCreate: false, showCreateAction: false },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      sessions: [{
        createdAt: "2026-08-25T02:00:00.000Z",
        sessionId: "remote-session",
        status: "active"
      }]
    };
    await nextTick();

    expect(creationHarness.selectedId.value).toBe("");
    expect(creationHarness.selectAvailableId).not.toHaveBeenCalled();
    scope.stop();
  });

  it("holds a missing predecessor until its renewal is durably completed", async () => {
    const predecessorId = "predecessor-a";
    const unrelatedSessionId = "session-b";
    const successorId = "successor-a";
    creationHarness.selectedId.value = predecessorId;
    creationHarness.queryData.value = {
      creation: { canCreate: true, showCreateAction: true },
      limits: { maxOpenSessions: 4, openSessionCount: 2 },
      sessions: [
        {
          createdAt: "2026-08-25T00:00:00.000Z",
          sessionId: predecessorId,
          status: "active"
        },
        {
          createdAt: "2026-08-25T00:00:30.000Z",
          sessionId: unrelatedSessionId,
          status: "active"
        }
      ]
    };
    creationHarness.renewalEndpointResource.data.value = {
      ok: true,
      viewerScope: `viewer-v1-${"1".repeat(32)}`,
      renewal: {
        operationKey: "renewal:predecessor-a:one",
        renewalId: "renewal-a",
        revision: 2,
        sessionId: predecessorId,
        stage: "successor_setup",
        status: "running"
      }
    };
    const { scope } = mountSessionData();
    creationHarness.selectAvailableId.mockClear();

    creationHarness.queryData.value = {
      creation: { canCreate: true, showCreateAction: true },
      limits: { maxOpenSessions: 4, openSessionCount: 1 },
      sessions: [{
        createdAt: "2026-08-25T00:00:30.000Z",
        sessionId: unrelatedSessionId,
        status: "active"
      }]
    };
    await nextTick();
    expect(creationHarness.selectedId.value).toBe(predecessorId);
    expect(creationHarness.selectAvailableId).not.toHaveBeenCalled();

    creationHarness.renewalEndpointResource.data.value = {
      ok: true,
      viewerScope: `viewer-v1-${"1".repeat(32)}`,
      renewal: {
        operationKey: "renewal:predecessor-a:one",
        renewalId: "renewal-a",
        revision: 3,
        sessionId: predecessorId,
        stage: "successor_activating",
        status: "running",
        successor: {
          availableAt: "2026-08-25T00:02:01.000Z",
          sessionId: successorId
        }
      }
    };
    creationHarness.queryData.value = {
      creation: { canCreate: true, showCreateAction: true },
      limits: { maxOpenSessions: 4, openSessionCount: 2 },
      sessions: [
        {
          createdAt: "2026-08-25T00:00:30.000Z",
          sessionId: unrelatedSessionId,
          status: "active"
        },
        {
          createdAt: "2026-08-25T00:02:00.000Z",
          metadata: { renewed_from: predecessorId },
          sessionId: successorId,
          status: "active"
        }
      ]
    };
    await nextTick();
    expect(creationHarness.selectAvailableId).not.toHaveBeenCalled();
    expect(creationHarness.selectedId.value).toBe(predecessorId);

    creationHarness.renewalEndpointResource.data.value = {
      ok: true,
      viewerScope: `viewer-v1-${"1".repeat(32)}`,
      renewal: {
        operationKey: "renewal:predecessor-a:one",
        renewalId: "renewal-a",
        revision: 4,
        sessionId: predecessorId,
        stage: "completed",
        status: "completed",
        successor: { sessionId: successorId }
      }
    };
    await nextTick();

    expect(creationHarness.selectAvailableId).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: successorId }),
        expect.objectContaining({ sessionId: unrelatedSessionId })
      ]),
      expect.objectContaining({ fallbackId: successorId })
    );
    expect(creationHarness.selectedId.value).toBe(successorId);
    scope.stop();
  });

  it("keeps a completed successor selected without overriding a later explicit selection", async () => {
    const predecessorId = "predecessor-a";
    const unrelatedSessionId = "session-b";
    const successorId = "successor-a";
    creationHarness.selectedId.value = successorId;
    creationHarness.queryData.value = {
      creation: { canCreate: true, showCreateAction: true },
      limits: { maxOpenSessions: 4, openSessionCount: 2 },
      sessions: [
        {
          createdAt: "2026-08-25T00:00:30.000Z",
          sessionId: unrelatedSessionId,
          status: "active"
        },
        {
          createdAt: "2026-08-25T00:02:00.000Z",
          metadata: { renewed_from: predecessorId },
          sessionId: successorId,
          status: "active"
        }
      ]
    };
    creationHarness.renewalEndpointResource.data.value = {
      ok: true,
      viewerScope: `viewer-v1-${"1".repeat(32)}`,
      renewal: {
        operationKey: "renewal:predecessor-a:one",
        renewalId: "renewal-a",
        revision: 3,
        sessionId: predecessorId,
        stage: "completed",
        status: "completed",
        successor: { sessionId: successorId }
      }
    };

    const { scope, sessionData } = mountSessionData();
    await nextTick();
    expect(creationHarness.select).not.toHaveBeenCalledWith(predecessorId);
    expect(creationHarness.selectedId.value).toBe(successorId);

    creationHarness.select.mockClear();
    sessionData.selectSessionId(unrelatedSessionId);
    await nextTick();
    expect(creationHarness.selectedId.value).toBe(unrelatedSessionId);

    creationHarness.renewalEndpointResource.data.value = {
      ok: true,
      viewerScope: `viewer-v1-${"1".repeat(32)}`,
      renewal: {
        operationKey: "renewal:predecessor-a:one",
        renewalId: "renewal-a",
        revision: 4,
        sessionId: predecessorId,
        stage: "completed",
        status: "completed",
        successor: { sessionId: successorId }
      }
    };
    await nextTick();

    expect(creationHarness.selectedId.value).toBe(unrelatedSessionId);
    expect(creationHarness.select).toHaveBeenCalledOnce();
    expect(creationHarness.select).toHaveBeenCalledWith(unrelatedSessionId);
    scope.stop();
  });

  it("recovers a closed-dialog renewal after missed realtime by polling, reloading the list, and selecting its exact successor", async () => {
    vi.useFakeTimers();
    const predecessorId = "predecessor-a";
    const successorId = "successor-a";
    creationHarness.selectedId.value = predecessorId;
    creationHarness.queryData.value = {
      creation: { canCreate: true, showCreateAction: true },
      limits: { maxOpenSessions: 4, openSessionCount: 2 },
      sessions: [{
        createdAt: "2026-08-25T00:00:00.000Z",
        sessionId: predecessorId,
        status: "active"
      }]
    };
    creationHarness.renewalEndpointResource.data.value = {
      ok: true,
      viewerScope: `viewer-v1-${"1".repeat(32)}`,
      renewal: {
        operationKey: "renewal:predecessor-a:one",
        renewalId: "renewal-a",
        revision: 2,
        sessionId: predecessorId,
        stage: "successor_setup",
        status: "running"
      }
    };
    creationHarness.refetch.mockImplementation(async () => {
      creationHarness.queryData.value = {
        creation: { canCreate: true, showCreateAction: true },
        limits: { maxOpenSessions: 4, openSessionCount: 2 },
        sessions: [{
          createdAt: "2026-08-25T00:02:00.000Z",
          metadata: { renewed_from: predecessorId },
          sessionId: successorId,
          status: "active"
        }, {
          createdAt: "2026-08-25T00:03:00.000Z",
          metadata: { renewed_from: "predecessor-b" },
          sessionId: "successor-b",
          status: "active"
        }]
      };
      return { data: creationHarness.queryData.value };
    });
    creationHarness.renewalEndpointResource.reload.mockImplementation(async () => {
      creationHarness.renewalEndpointResource.data.value = {
        ok: true,
        viewerScope: `viewer-v1-${"1".repeat(32)}`,
        renewal: {
          operationKey: "renewal:predecessor-a:one",
          renewalId: "renewal-a",
          revision: 3,
          sessionId: predecessorId,
          stage: "completed",
          status: "completed",
          successor: { sessionId: successorId }
        }
      };
      return creationHarness.renewalEndpointResource.data.value;
    });
    const { scope, sessionData } = mountSessionData();
    const renewal = scope.run(() => useVibe64SessionRenewal({
      focusSession: vi.fn(async () => true),
      refreshSessionData: sessionData.refreshSessionData,
      selectSession: sessionData.selectSessionId,
      selectedSession: sessionData.selectedSession,
      selectedSessionId: sessionData.selectedSessionId,
      sessionsApiPath: sessionData.sessionsApiPath
    }));

    try {
      expect(renewal.open.value).toBe(false);
      await vi.advanceTimersByTimeAsync(SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS);
      await nextTick();
      await nextTick();

      expect(creationHarness.renewalEndpointResource.reload).toHaveBeenCalledOnce();
      expect(creationHarness.refetch).toHaveBeenCalledOnce();
      expect(creationHarness.selectAvailableId).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ sessionId: successorId }),
          expect.objectContaining({ sessionId: "successor-b" })
        ]),
        expect.objectContaining({ fallbackId: successorId })
      );
      expect(creationHarness.selectedId.value).toBe(successorId);
      expect(creationHarness.select).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("fails closed until the server projects both creation permissions", () => {
    creationHarness.queryData.value = {
      limits: { maxOpenSessions: 3, openSessionCount: 0 },
      sessions: []
    };
    const { scope, sessionData } = mountSessionData();

    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(false);
    expect(sessionData.createSessionTitle.value).toBe("Session creation is unavailable.");

    scope.stop();
  });

  it("keeps a regular cap visible but hides creation for an occupied shared database", async () => {
    creationHarness.queryData.value = {
      creation: {
        canCreate: false,
        disabledReason: "Studio allows up to 3 open sessions. Archive one before creating another.",
        showCreateAction: true
      },
      limits: { maxOpenSessions: 3, openSessionCount: 3 },
      sessions: []
    };
    const { scope, sessionData } = mountSessionData();

    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(true);
    expect(sessionData.createSessionTitle.value).toContain("up to 3 open sessions");

    creationHarness.queryData.value = {
      creation: {
        canCreate: false,
        disabledReason: "This project shares one development database.",
        showCreateAction: false
      },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      sessions: []
    };
    await nextTick();

    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(false);
    expect(sessionData.createSessionTitle.value).toContain("shares one development database");

    scope.stop();
  });

  it("applies the successful creation projection before its background refresh completes", async () => {
    const refreshPending = deferred();
    const backgroundRefetch = vi.fn(() => refreshPending.promise);
    creationHarness.endpointResource.query.refetch = backgroundRefetch;
    creationHarness.endpointResource.reload = backgroundRefetch;
    creationHarness.createRun.mockResolvedValue({
      creation: {
        canCreate: false,
        disabledReason: "This project shares one development database.",
        showCreateAction: false
      },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      ok: true,
      sessionId: "session-created"
    });
    const { scope, sessionData } = mountSessionData();

    await expect(sessionData.createSession()).resolves.toMatchObject({
      sessionId: "session-created"
    });
    await nextTick();

    expect(backgroundRefetch).toHaveBeenCalledOnce();
    expect(creationHarness.querySetData).toHaveBeenCalledOnce();
    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(false);
    expect(creationHarness.endpointResource.data.value).toMatchObject({
      creation: { canCreate: false, showCreateAction: false },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      sessions: [
        { sessionId: "session-created" }
      ]
    });

    refreshPending.resolve({ data: creationHarness.endpointResource.data.value });
    await nextTick();
    scope.stop();
  });

  it("sets pending synchronously and coalesces rapid requests into one command", async () => {
    const pending = deferred();
    creationHarness.createRun.mockImplementation(() => pending.promise);
    const { scope, sessionData } = mountSessionData();

    const first = sessionData.createSession();
    expect(sessionData.createSessionRunning.value).toBe(true);
    const second = sessionData.createSession();

    expect(creationHarness.createRun).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, sessionId: "session-created" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, sessionId: "session-created" },
      { ok: true, sessionId: "session-created" }
    ]);
    await nextTick();

    expect(sessionData.createSessionRunning.value).toBe(false);
    expect(creationHarness.select).toHaveBeenCalledTimes(1);
    expect(creationHarness.select).toHaveBeenCalledWith("session-created");
    expect(creationHarness.refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("clears pending after rejection and permits a later retry", async () => {
    const pending = deferred();
    creationHarness.createRun.mockImplementationOnce(() => pending.promise);
    const { scope, sessionData } = mountSessionData();

    const first = sessionData.createSession();
    const second = sessionData.createSession();
    pending.reject(new Error("Creation failed."));
    const settled = await Promise.allSettled([first, second]);

    expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(creationHarness.createRun).toHaveBeenCalledTimes(1);
    expect(sessionData.createSessionRunning.value).toBe(false);

    creationHarness.createRun.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-retry"
    });
    await expect(sessionData.createSession()).resolves.toMatchObject({
      sessionId: "session-retry"
    });
    expect(creationHarness.createRun).toHaveBeenCalledTimes(2);
    expect(sessionData.createSessionRunning.value).toBe(false);
    scope.stop();
  });

  it("does not apply a completed request to a different project or disposed panel", async () => {
    const routePending = deferred();
    creationHarness.createRun.mockImplementationOnce(() => routePending.promise);
    const routeMount = mountSessionData();
    const routeRequest = routeMount.sessionData.createSession();

    creationHarness.projectSlug.value = "project-b";
    routePending.resolve({ ok: true, sessionId: "session-project-a" });
    await routeRequest;
    await nextTick();

    expect(creationHarness.select).not.toHaveBeenCalled();
    expect(creationHarness.refetch).not.toHaveBeenCalled();
    routeMount.scope.stop();

    creationHarness.projectSlug.value = "project-a";
    const disposedPending = deferred();
    creationHarness.createRun.mockImplementationOnce(() => disposedPending.promise);
    const disposedMount = mountSessionData();
    const disposedRequest = disposedMount.sessionData.createSession();
    disposedMount.scope.stop();
    disposedPending.resolve({ ok: true, sessionId: "session-after-unmount" });
    await disposedRequest;
    await nextTick();

    expect(creationHarness.select).not.toHaveBeenCalled();
    expect(creationHarness.refetch).not.toHaveBeenCalled();
  });
});


describe("background session archive selection", () => {
  function twoSessions() {
    creationHarness.queryData.value.sessions = [
      { sessionId: "session-a", status: "active" },
      { sessionId: "session-b", status: "active" }
    ];
    creationHarness.selectedId.value = "session-b";
  }

  it("selects the previous session immediately and keeps its selection after success", async () => {
    twoSessions();
    const pending = deferred();
    creationHarness.archiveRun.mockReturnValue(pending.promise);
    const { scope, sessionData } = mountSessionData();
    sessionData.archive.request();
    const result = sessionData.archive.confirm();
    expect(sessionData.selectedSessionId.value).toBe("session-a");
    expect(sessionData.sessions.value.find(s => s.sessionId === "session-b").archiving).toBe(true);
    sessionData.selectSessionId("session-b");
    expect(sessionData.selectedSessionId.value).toBe("session-a");
    pending.resolve({ ok: true });
    await result;
    await nextTick();
    expect(sessionData.sessions.value.map(s => s.sessionId)).toEqual(["session-a"]);
    expect(sessionData.selectedSessionId.value).toBe("session-a");
    scope.stop();
  });

  it("restores the gray tab after failure without stealing the current selection", async () => {
    twoSessions();
    creationHarness.archiveRun.mockRejectedValue(new Error("Cleanup failed"));
    const { scope, sessionData } = mountSessionData();
    sessionData.archive.request();
    expect(await sessionData.archive.confirm()).toBe(false);
    await nextTick();
    expect(sessionData.sessions.value.every(s => !s.archiving)).toBe(true);
    expect(sessionData.selectedSessionId.value).toBe("session-a");
    scope.stop();
  });

  it("reacts to another tab's start and completion announcements", async () => {
    twoSessions();
    const { scope, sessionData } = mountSessionData();
    const receive = (reason) => creationHarness.realtime.onEvent({ payload: {
      projectSlug: "project-a", sessionId: "session-b", reason
    } });
    expect(creationHarness.realtime.matches({ payload: { projectSlug: "other" } })).toBe(false);
    receive("session-archiving");
    await nextTick();
    expect(sessionData.selectedSessionId.value).toBe("session-a");
    expect(sessionData.sessions.value.at(-1).archiving).toBe(true);
    receive("session-archived");
    await nextTick();
    expect(sessionData.sessions.value.map(s => s.sessionId)).toEqual(["session-a"]);
    scope.stop();
  });

  it("hydrates a running archive after reload and warns when restart recovery fails", async () => {
    twoSessions();
    creationHarness.queryData.value.sessions[1].metadata = {
      session_closing_reason: "archived",
      session_archive_operation: JSON.stringify({ status: "running", phase: "source" })
    };
    const { scope, sessionData } = mountSessionData();
    await nextTick();
    expect(sessionData.selectedSessionId.value).toBe("session-a");
    creationHarness.queryData.value.sessions[1].metadata.session_archive_operation = JSON.stringify({
      status: "failed", phase: "source", error: "Recovery failed"
    });
    await nextTick();
    expect(sessionData.sessions.value.at(-1).archiving).toBe(false);
    expect(creationHarness.feedback).toHaveBeenCalledOnce();
    scope.stop();
  });
});
