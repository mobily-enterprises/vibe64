import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT
} from "../../src/lib/vibe64SessionRequestConfig.js";

const mocks = vi.hoisted(() => ({
  changes: null,
  changesHandler: null,
  diff: null,
  historyHandler: null,
  historyUpdateCheck: null,
  updateCheckHandler: null,
  updateCheck: null,
  versionFilesHandler: null,
  versionDiffHandler: null,
  realtimeEvents: [],
  requestCalls: []
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options = {}) {
    mocks.realtimeEvents.push(options);
  }
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(path, options = {}) {
        mocks.requestCalls.push({ options, path });
        if (typeof mocks.versionFilesHandler === "function" && /\/history\/[^/]+\/files(?:\?|$)/u.test(String(path))) {
          return mocks.versionFilesHandler(path, options);
        }
        if (typeof mocks.versionDiffHandler === "function" && /\/history\/[^/]+\/diff(?:\?|$)/u.test(String(path))) {
          return mocks.versionDiffHandler(path, options);
        }
        if (String(path).includes("/history")) {
          if (typeof mocks.historyHandler === "function") return mocks.historyHandler(path, options);
          return {
            historySnapshotCommit: mocks.historyUpdateCheck?.canonicalCommit || "a".repeat(40),
            nextCursor: "",
            ok: true,
            ...(mocks.historyUpdateCheck ? { updateCheck: mocks.historyUpdateCheck } : {}),
            versions: []
          };
        }
        if (String(path).includes("/updates/check")) {
          if (typeof mocks.updateCheckHandler === "function") {
            return mocks.updateCheckHandler(path, options);
          }
          return {
            ahead: 0,
            behind: 0,
            canonicalCommit: "a".repeat(40),
            checkedAt: "2026-08-19T07:15:00.000Z",
            ok: true,
            relationship: "current",
            sessionHead: "a".repeat(40),
            updateAvailable: false,
            updateStrategy: "none",
            ...(mocks.updateCheck || mocks.historyUpdateCheck || {})
          };
        }
        if (String(path).includes("/changes/diff")) {
          return {
            diff: "",
            ok: true,
            path: "",
            ...(mocks.diff || {})
          };
        }
        if (typeof mocks.changesHandler === "function" && String(path).includes("/changes")) {
          return mocks.changesHandler(path, options);
        }
        return {
          canonicalCommit: "a".repeat(40),
          files: [],
          ok: true,
          totalCount: 0,
          unsaved: false,
          ...(mocks.changes || {})
        };
      }
    };
  }
}));

async function flushPromises() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("useVibe64RepositoryWorkspace", () => {
  beforeEach(() => {
    mocks.changes = null;
    mocks.changesHandler = null;
    mocks.diff = null;
    mocks.historyHandler = null;
    mocks.historyUpdateCheck = null;
    mocks.updateCheckHandler = null;
    mocks.updateCheck = null;
    mocks.versionFilesHandler = null;
    mocks.versionDiffHandler = null;
    mocks.realtimeEvents.length = 0;
    mocks.requestCalls.length = 0;
  });

  it("opens publication review without requiring direct assistant access", async () => {
    mocks.changes = { unsaved: true };
    const requestSaveWork = vi.fn(async () => ({ ok: true }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      assistantDirectAllowed: false,
      assistantCodeAllowed: false,
      requestSaveWork,
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();

    await expect(workspace.saveWork()).resolves.toEqual({ ok: true });
    expect(requestSaveWork).toHaveBeenCalledOnce();
  });

  it("unwraps the runtime's ref-backed session API path without cross-loading destinations", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const sessionsApiPath = ref("/api/app/sample/vibe64/sessions");
    const dashboard = ref({
      sessionId: "session-1",
      sessionsApiPath
    });
    useVibe64RepositoryWorkspace(dashboard, { view: ref("changes") });

    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(mocks.requestCalls[1].options).toMatchObject({
      body: { force: false },
      method: "POST"
    });

    mocks.requestCalls.length = 0;
    useVibe64RepositoryWorkspace(dashboard, { view: ref("history") });
    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/repository/history?sessionId=session-1",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(mocks.requestCalls.some(({ path }) => String(path).includes("[object Object]"))).toBe(false);
  });

  it.each([
    { label: "surrounding-space", path: " report.txt " },
    { label: "surrounding-tab", path: "\treport.txt\t" },
    { label: "literal-backslash", path: "folder\\report.txt" }
  ].flatMap((filename) => ["changes", "history"].map((view) => ({ ...filename, view }))))(
    "preserves $label filenames in $view selection and decoded query paths",
    async ({ path: filePath, view }) => {
      const commit = "a".repeat(40);
      const diff = { diff: "+exact selected file", ok: true, path: filePath };
      mocks.diff = diff;
      mocks.versionFilesHandler = vi.fn(async () => ({ files: [], ok: true }));
      mocks.versionDiffHandler = vi.fn(async () => diff);
      const { useVibe64RepositoryWorkspace } = await import(
        "../../src/composables/useVibe64RepositoryWorkspace.js"
      );
      const scope = effectScope();
      const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
        sessionId: "session-1",
        sessionsApiPath: "/api/app/sample/vibe64/sessions"
      }), { view: ref(view) }));
      try {
        await nextTick();
        await flushPromises();
        if (view === "history") await workspace.selectVersion({ commit });
        const beforeSelection = mocks.requestCalls.length;
        if (view === "history") await workspace.selectVersionFile({ path: filePath });
        else await workspace.selectCurrentFile({ path: filePath });

        const requests = mocks.requestCalls.slice(beforeSelection);
        expect(requests).toHaveLength(1);
        const url = new URL(requests[0].path, "http://vibe64.test");
        expect(url.pathname).toBe(view === "history"
          ? `/api/app/sample/vibe64/repository/history/${commit}/diff`
          : "/api/app/sample/vibe64/sessions/session-1/changes/diff");
        expect({
          queryPath: url.searchParams.get("path"),
          selectedPath: view === "history" ? workspace.selectedVersionPath.value : workspace.selectedCurrentPath.value
        }).toEqual({ queryPath: filePath, selectedPath: filePath });
        if (view === "history") {
          expect(url.searchParams.get("historySnapshotCommit")).toBe(commit);
          expect(url.searchParams.get("sessionId")).toBe("session-1");
        }
        expect(view === "history" ? workspace.versionDiff : workspace.currentDiff).toMatchObject({
          error: "", loading: false, payload: diff
        });
      } finally {
        scope.stop();
      }
    }
  );

  it.each([true, false])("reuses an initial diff only for exact filename identity (matching: %s)", async (matching) => {
    const filePath = " report.txt ";
    const initialDiff = {
      diff: matching ? "+exact snapshot file" : "+different filename snapshot",
      ok: true,
      path: matching ? filePath : "report.txt"
    };
    mocks.changes = {
      files: [{ path: filePath }], initialDiff, totalCount: 1, unsaved: true
    };
    mocks.diff = { diff: "+requested exact filename", ok: true, path: filePath };
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") }));
    try {
      await nextTick();
      await flushPromises();
      const diffRequests = mocks.requestCalls.filter(({ path }) => path.includes("/changes/diff"));
      expect(diffRequests).toHaveLength(matching ? 0 : 1);
      if (!matching) {
        expect(new URL(diffRequests[0].path, "http://vibe64.test").searchParams.get("path")).toBe(filePath);
      }
      expect(workspace.selectedCurrentPath.value).toBe(filePath);
      expect(workspace.currentDiff).toMatchObject({
        error: "", loading: false, payload: matching ? initialDiff : mocks.diff
      });
    } finally {
      scope.stop();
    }
  });

  it("reuses the Current Changes snapshot as the selected session work state", async () => {
    mocks.changes = {
      changedPaths: ["src/app.js"],
      initialDiff: { diff: "+change", path: "src/app.js" },
      sessionId: "session-1",
      unsaved: true
    };
    const refreshSessionWork = vi.fn(async (work) => work);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    useVibe64RepositoryWorkspace(ref({
      refreshSessionWork,
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();

    expect(refreshSessionWork).toHaveBeenCalledTimes(1);
    expect(refreshSessionWork).toHaveBeenCalledWith(expect.objectContaining({
      changedPaths: ["src/app.js"],
      sessionId: "session-1",
      unsaved: true
    }));
    expect(refreshSessionWork.mock.calls[0][0]).not.toHaveProperty("initialDiff");
  });

  it.each([
    { label: "the saved History response arrives first", order: "history-first", newer: false, failed: false, reads: 1 },
    { label: "the update-check result is available first", order: "check-first", newer: false, failed: false, reads: 1 },
    { label: "a pre-existing check reports the already displayed tip", order: "pre-existing", newer: false, failed: false, reads: 1 },
    { label: "a pre-existing check reports the saved tip before its History response", order: "pre-existing-check-first", newer: false, failed: false, reads: 1 },
    { label: "a pre-existing check reports a newer tip before the saved History response", order: "pre-existing-check-first", newer: true, failed: false, reads: 2 },
    { label: "a pre-existing check fails before the saved History response", order: "pre-existing-check-first", newer: false, failed: true, reads: 1 },
    { label: "the check discovers a genuinely newer tip", order: "history-first", newer: true, failed: false, reads: 2 },
    { label: "the separate authority check fails", order: "history-first", newer: false, failed: true, reads: 1 }
  ])("owns History refreshes after Save when $label", async ({ order, newer, failed, reads }) => {
    const savedCommit = "b".repeat(40);
    const savedHistory = { historySnapshotCommit: savedCommit, ok: true, versions: [{ commit: savedCommit }] };
    const finalCommit = newer ? "c".repeat(40) : savedCommit;
    const finalHistory = { historySnapshotCommit: finalCommit, ok: true, versions: [{ commit: finalCommit }] };
    const historyResponse = Promise.withResolvers();
    const checkResponse = Promise.withResolvers();
    const checkResult = failed
      ? { error: "Authority check failed after Save.", ok: false }
      : { canonicalCommit: finalCommit, ok: true };
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let eventTask;
    let previousCheck;
    try {
      await nextTick();
      await flushPromises();
      mocks.historyHandler = vi.fn()
        .mockImplementationOnce(() => historyResponse.promise)
        .mockResolvedValue(finalHistory);
      mocks.updateCheckHandler = vi.fn(() => checkResponse.promise);
      if (order.startsWith("pre-existing")) previousCheck = workspace.checkForUpdates({ force: false });
      const sessionChanged = mocks.realtimeEvents.find(({ event }) => event === VIBE64_SESSION_CHANGED_EVENT);
      const event = { payload: { reason: "session-save-completed", sessionId: "session-1" } };
      expect(sessionChanged.matches(event)).toBe(true);
      eventTask = sessionChanged.onEvent(event);
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(1);
      if (order === "check-first" || order === "pre-existing-check-first") {
        // Do not wait for consumption: corrected ordering may start this check only after History.
        if (order === "pre-existing-check-first") {
          expect(mocks.updateCheckHandler).toHaveBeenCalledTimes(1);
          expect(workspace.history.payload.historySnapshotCommit).toBe("a".repeat(40));
          expect(workspace.history.loading).toBe(true);
        }
        checkResponse.resolve(checkResult);
        await flushPromises();
      }
      historyResponse.resolve(savedHistory);
      await flushPromises();
      if (order !== "pre-existing-check-first" || !newer) {
        expect(workspace.history.payload.historySnapshotCommit).toBe(savedCommit);
      }
      checkResponse.resolve(checkResult);
      await Promise.all([eventTask, previousCheck]);
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(reads);
      expect(workspace.history).toMatchObject({
        error: "", loading: false, payload: failed ? savedHistory : finalHistory
      });
      expect(mocks.updateCheckHandler).toHaveBeenCalledTimes(1);
      expect(workspace.updates.error).toBe(failed ? checkResult.error : "");
      expect(mocks.updateCheckHandler.mock.calls[0][1]).toMatchObject({ body: { force: false }, method: "POST" });
    } finally {
      scope.stop();
      historyResponse.resolve(savedHistory);
      checkResponse.resolve(checkResult);
      await Promise.all([eventTask, previousCheck]);
      await flushPromises();
    }
  });

  it.each(["context replacement", "disposal"])("retires a pending Save history refresh after %s", async (change) => {
    const savedCommit = "b".repeat(40);
    const nextCommit = "c".repeat(40);
    const savedHistory = { historySnapshotCommit: savedCommit, ok: true, versions: [{ commit: savedCommit }] };
    const nextHistory = { historySnapshotCommit: nextCommit, ok: true, versions: [{ commit: nextCommit }] };
    const historyResponse = Promise.withResolvers();
    const checkResponse = Promise.withResolvers();
    const nextApiPath = "/api/app/other/vibe64/sessions";
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const dashboard = ref({ sessionId: "session-1", sessionsApiPath: "/api/app/sample/vibe64/sessions" });
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(dashboard, { view: ref("history") }));
    let eventTask;
    let previousCheck;
    try {
      await nextTick();
      await flushPromises();
      mocks.historyHandler = vi.fn((path) => path.startsWith("/api/app/other/") ? nextHistory : historyResponse.promise);
      mocks.updateCheckHandler = vi.fn((path) => path.startsWith(nextApiPath)
        ? { canonicalCommit: nextCommit, ok: true }
        : checkResponse.promise);
      previousCheck = workspace.checkForUpdates({ force: false });
      const sessionChanged = mocks.realtimeEvents.find(({ event }) => event === VIBE64_SESSION_CHANGED_EVENT);
      eventTask = sessionChanged.onEvent({ payload: { reason: "session-save-completed", sessionId: "session-1" } });
      checkResponse.resolve({ error: "Obsolete Save check failed.", ok: false });
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(1);
      expect(workspace.updates.checking).toBe(true);
      expect(workspace.updates.error).toBe("");
      if (change === "context replacement") {
        dashboard.value = { sessionId: "session-2", sessionsApiPath: nextApiPath };
        await nextTick();
        await flushPromises();
        expect(workspace.history.payload).toEqual(nextHistory);
        expect(mocks.updateCheckHandler.mock.calls.filter(([path]) => path.startsWith(nextApiPath))).toHaveLength(1);
      } else {
        scope.stop();
      }
      const requestsBeforeSettlement = mocks.requestCalls.length;
      const historyBeforeSettlement = { ...workspace.history, versions: [...workspace.history.versions] };
      historyResponse.resolve(savedHistory);
      await Promise.all([eventTask, previousCheck]);
      await flushPromises();
      expect(mocks.requestCalls).toHaveLength(requestsBeforeSettlement);
      expect(workspace.history).toEqual(historyBeforeSettlement);
      expect(workspace.updates.error).toBe("");
      if (change === "context replacement") {
        expect(workspace.sessionId.value).toBe("session-2");
        expect(workspace.updates.payload.canonicalCommit).toBe(nextCommit);
      }
    } finally {
      scope.stop();
      historyResponse.resolve(savedHistory);
      checkResponse.resolve({ ok: true });
      await Promise.all([eventTask, previousCheck]);
      await flushPromises();
    }
  });

  it.each(["older first", "newer first"])("keeps one check owner across repeated Saves settling %s", async (order) => {
    const savedCommit = "b".repeat(40);
    const nextCommit = "c".repeat(40);
    const savedHistory = { historySnapshotCommit: savedCommit, ok: true, versions: [{ commit: savedCommit }] };
    const nextHistory = { historySnapshotCommit: nextCommit, ok: true, versions: [{ commit: nextCommit }] };
    const savedResponse = Promise.withResolvers();
    const nextResponse = Promise.withResolvers();
    const checkResponse = Promise.withResolvers();
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1", sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    const eventTasks = [];
    let previousCheck;
    try {
      await nextTick();
      await flushPromises();
      mocks.historyHandler = vi.fn()
        .mockImplementationOnce(() => savedResponse.promise)
        .mockImplementationOnce(() => nextResponse.promise)
        .mockResolvedValue(nextHistory);
      mocks.updateCheckHandler = vi.fn(() => checkResponse.promise);
      previousCheck = workspace.checkForUpdates({ force: false });
      const sessionChanged = mocks.realtimeEvents.find(({ event }) => event === VIBE64_SESSION_CHANGED_EVENT);
      const event = { payload: { reason: "session-save-completed", sessionId: "session-1" } };
      eventTasks.push(sessionChanged.onEvent(event));
      checkResponse.resolve({ canonicalCommit: nextCommit, ok: true });
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(1);
      expect(workspace.updates.checking).toBe(true);
      eventTasks.push(sessionChanged.onEvent(event));
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(2);

      if (order === "older first") savedResponse.resolve(savedHistory);
      else nextResponse.resolve(nextHistory);
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(2);
      expect(mocks.updateCheckHandler).toHaveBeenCalledTimes(1);
      expect(workspace.history.payload.historySnapshotCommit).toBe(order === "older first"
        ? "a".repeat(40)
        : nextCommit);
      expect(workspace.history.loading).toBe(order === "older first");
      if (order === "newer first") {
        expect(workspace.updates.checking).toBe(false);
      }

      savedResponse.resolve(savedHistory);
      nextResponse.resolve(nextHistory);
      await Promise.all([...eventTasks, previousCheck]);
      await flushPromises();
      expect(mocks.historyHandler).toHaveBeenCalledTimes(2);
      expect(mocks.updateCheckHandler).toHaveBeenCalledTimes(1);
      expect(workspace.history).toMatchObject({ error: "", loading: false, payload: nextHistory });
      expect(workspace.updates).toMatchObject({
        checking: false, error: "", payload: { canonicalCommit: nextCommit }
      });
    } finally {
      scope.stop();
      savedResponse.resolve(savedHistory);
      nextResponse.resolve(nextHistory);
      checkResponse.resolve({ canonicalCommit: nextCommit, ok: true });
      await Promise.all([...eventTasks, previousCheck]);
      await flushPromises();
    }
  });

  it("restores the last successful update check while loading repository history", async () => {
    mocks.historyUpdateCheck = {
      ahead: 2,
      behind: 3,
      canonicalCommit: "b".repeat(40),
      checkedAt: "2026-08-19T07:15:00.000Z",
      relationship: "diverged",
      sessionHead: "c".repeat(40),
      updateAvailable: true,
      updateStrategy: "rebase"
    };
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") });

    await nextTick();
    await flushPromises();

    expect(workspace.updates.payload).toMatchObject(mocks.historyUpdateCheck);
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/repository/history?sessionId=session-1",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
  });

  it("accepts a cached history update check when no prior check exists", async () => {
    mocks.historyUpdateCheck = {
      behind: 1,
      canonicalCommit: "b".repeat(40),
      checkedAt: "2026-08-19T07:15:00.000Z",
      relationship: "behind",
      updateAvailable: true,
      updateStrategy: "rebase"
    };
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") });

    expect(workspace.updates.payload).toBeNull();
    await nextTick();
    await flushPromises();

    expect(workspace.history.error).toBe("");
    expect(workspace.updates.payload).toMatchObject({
      behind: 1,
      updateAvailable: true
    });
  });

  it("waits for the selected session before requesting repository history", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const dashboard = ref({
      sessionId: "",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    });
    useVibe64RepositoryWorkspace(dashboard, { view: ref("history") });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toEqual([]);

    dashboard.value = {
      ...dashboard.value,
      sessionId: "session-1"
    };
    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/repository/history?sessionId=session-1",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
  });

  it("releases previous version paging state and preserves a newer pending page", async () => {
    const firstCommit = "a".repeat(40);
    const secondCommit = "b".repeat(40);
    const firstPage = Promise.withResolvers();
    const secondPage = Promise.withResolvers();
    const firstPageResult = { commit: firstCommit, files: [{ path: "a-next.txt" }], ok: true, truncated: false };
    const secondPageResult = { commit: secondCommit, files: [{ path: "b-next.txt" }], ok: true, truncated: false };
    const secondDiffResult = { commit: secondCommit, diff: "+current version B", ok: true, path: "b.txt" };
    mocks.versionFilesHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, files: [{ path: "a.txt" }], ok: true, truncated: true })
      .mockImplementationOnce(() => firstPage.promise)
      .mockResolvedValueOnce({ commit: secondCommit, files: [{ path: "b.txt" }], ok: true, truncated: true })
      .mockImplementationOnce(() => secondPage.promise);
    mocks.versionDiffHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, diff: "+version A", ok: true, path: "a.txt" })
      .mockResolvedValueOnce(secondDiffResult);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let firstPaging;
    let secondPaging;
    try {
      await nextTick();
      await flushPromises();
      await workspace.selectVersion({ commit: firstCommit });
      firstPaging = workspace.loadMoreVersionFiles();
      expect(mocks.versionFilesHandler).toHaveBeenCalledTimes(2);
      expect(workspace.versionFiles.loadingMore).toBe(true);

      await workspace.selectVersion({ commit: secondCommit });
      expect(workspace.selectedVersion.value.commit).toBe(secondCommit);
      expect(workspace.versionFiles.loading).toBe(false);
      expect(workspace.versionFiles.loadingMore).toBe(false);
      expect(workspace.selectedVersionPath.value).toBe("b.txt");
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: false, payload: secondDiffResult });

      secondPaging = workspace.loadMoreVersionFiles();
      expect(mocks.versionFilesHandler).toHaveBeenCalledTimes(4);
      const secondPageUrl = new URL(mocks.versionFilesHandler.mock.calls[3][0], "http://vibe64.test");
      expect(secondPageUrl.pathname).toBe(`/api/app/sample/vibe64/repository/history/${secondCommit}/files`);
      expect(Object.fromEntries(secondPageUrl.searchParams)).toEqual({
        historySnapshotCommit: firstCommit,
        offset: "1",
        sessionId: "session-1"
      });

      firstPage.resolve(firstPageResult);
      await firstPaging;
      expect(workspace.versionFiles.loadingMore).toBe(true);
      expect(workspace.versionFiles.payload.files).toEqual([{ path: "b.txt" }]);

      secondPage.resolve(secondPageResult);
      await secondPaging;
      expect(workspace.versionFiles.loadingMore).toBe(false);
      expect(workspace.versionFiles.payload).toMatchObject({
        commit: secondCommit,
        files: [{ path: "b.txt" }, { path: "b-next.txt" }],
        truncated: false
      });
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: false, payload: secondDiffResult });
    } finally {
      firstPage.resolve(firstPageResult);
      secondPage.resolve(secondPageResult);
      await Promise.all([firstPaging, secondPaging]);
      scope.stop();
    }
  });

  it.each([
    ["a pending diff when opening another version", { commit: "b".repeat(40) }, false],
    ["a pending diff when clearing version selection", null, false],
    ["a failed diff when opening another version", { commit: "b".repeat(40) }, true]
  ])("retires %s", async (_scenario, nextVersion, settleFirst) => {
    const oldDiff = Promise.withResolvers();
    const oldFailure = { error: "The previous version diff failed.", ok: false };
    mocks.versionFilesHandler = vi.fn()
      .mockResolvedValueOnce({ files: [{ path: "a.txt" }], ok: true, truncated: false })
      .mockResolvedValue({ files: [], ok: true, truncated: false });
    mocks.versionDiffHandler = vi.fn(() => oldDiff.promise);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let selectingFirst;
    try {
      await nextTick();
      await flushPromises();
      selectingFirst = workspace.selectVersion({ commit: "a".repeat(40) });
      await flushPromises();
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(1);
      expect(workspace.versionDiff.loading).toBe(true);
      if (settleFirst) {
        oldDiff.resolve(oldFailure);
        await selectingFirst;
        expect(workspace.versionDiff.error).toBe(oldFailure.error);
      }

      await workspace.selectVersion(nextVersion);
      const afterSelection = {
        diffError: workspace.versionDiff.error,
        diffLoading: workspace.versionDiff.loading,
        filesLoading: workspace.versionFiles.loading
      };
      oldDiff.resolve(oldFailure);
      await selectingFirst;

      expect({
        afterSelection,
        diffErrorAfterSettlement: workspace.versionDiff.error,
        diffLoadingAfterSettlement: workspace.versionDiff.loading
      }).toEqual({
        afterSelection: { diffError: "", diffLoading: false, filesLoading: false },
        diffErrorAfterSettlement: "",
        diffLoadingAfterSettlement: false
      });
      expect(workspace.selectedVersion.value).toEqual(nextVersion);
      expect(workspace.selectedVersionPath.value).toBe("");
      expect(workspace.versionDiff.payload).toBeNull();
      expect(workspace.versionFiles.error).toBe("");
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(1);
    } finally {
      oldDiff.resolve(oldFailure);
      await selectingFirst;
      scope.stop();
    }
  });

  it("shows the current version diff failure and accepts a successful retry", async () => {
    const firstCommit = "a".repeat(40);
    const secondCommit = "b".repeat(40);
    const currentDiff = Promise.withResolvers();
    const retryDiff = Promise.withResolvers();
    const currentFailure = { error: "The current version diff failed.", ok: false };
    const retryResult = { commit: secondCommit, diff: "+retried version B", ok: true, path: "b.txt" };
    mocks.versionFilesHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, files: [{ path: "a.txt" }], ok: true, truncated: false })
      .mockResolvedValueOnce({ commit: secondCommit, files: [{ path: "b.txt" }], ok: true, truncated: false });
    mocks.versionDiffHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, diff: "+version A", ok: true, path: "a.txt" })
      .mockImplementationOnce(() => currentDiff.promise)
      .mockImplementationOnce(() => retryDiff.promise);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let selectingCurrent;
    let retrying;
    try {
      await nextTick();
      await flushPromises();
      await workspace.selectVersion({ commit: firstCommit });
      expect(workspace.versionDiff.payload).toMatchObject({ commit: firstCommit, path: "a.txt" });

      selectingCurrent = workspace.selectVersion({ commit: secondCommit });
      await flushPromises();
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(2);
      expect(workspace.selectedVersion.value.commit).toBe(secondCommit);
      expect(workspace.selectedVersionPath.value).toBe("b.txt");
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: true, payload: null });
      expect(workspace.versionFiles.loading).toBe(false);
      expect(workspace.versionFiles.payload.files).toEqual([{ path: "b.txt" }]);

      currentDiff.resolve(currentFailure);
      await selectingCurrent;
      expect(workspace.versionDiff).toMatchObject({ error: currentFailure.error, loading: false, payload: null });
      expect(workspace.versionFiles).toMatchObject({ error: "", loading: false });

      retrying = workspace.selectVersionFile({ path: "b.txt" });
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(3);
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: true, payload: null });
      const retryUrl = new URL(mocks.versionDiffHandler.mock.calls[2][0], "http://vibe64.test");
      expect(retryUrl.pathname).toBe(`/api/app/sample/vibe64/repository/history/${secondCommit}/diff`);
      expect(Object.fromEntries(retryUrl.searchParams)).toEqual({
        historySnapshotCommit: firstCommit,
        path: "b.txt",
        sessionId: "session-1"
      });

      retryDiff.resolve(retryResult);
      await retrying;
      expect(workspace.selectedVersion.value.commit).toBe(secondCommit);
      expect(workspace.selectedVersionPath.value).toBe("b.txt");
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: false, payload: retryResult });
    } finally {
      currentDiff.resolve(currentFailure);
      retryDiff.resolve(retryResult);
      await Promise.all([selectingCurrent, retrying]);
      scope.stop();
    }
  });

  it("keeps cached repository state quiet while renewal owns the source and refreshes on release", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const sourceOperationsSuspended = ref(true);
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions",
      sourceOperationsSuspended
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toEqual([]);
    expect(workspace.updates.error).toBe("");

    sourceOperationsSuspended.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    const cachedUpdate = workspace.updates.payload;

    mocks.requestCalls.length = 0;
    sourceOperationsSuspended.value = true;
    await nextTick();
    await expect(workspace.checkForUpdates()).resolves.toBe(false);
    await expect(workspace.applyUpdates()).resolves.toBe(false);
    await expect(workspace.saveWork()).resolves.toBe(false);
    expect(mocks.requestCalls).toEqual([]);
    expect(workspace.updates.payload).toBe(cachedUpdate);
    expect(workspace.updates.error).toBe("");

    sourceOperationsSuspended.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
  });

  it("discards an in-flight write-boundary collision and performs one current check after renewal", async () => {
    let finishFirstCheck;
    mocks.updateCheckHandler = vi.fn(() => new Promise((resolve) => {
      finishFirstCheck = resolve;
    }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const sourceOperationsSuspended = ref(false);
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions",
      sourceOperationsSuspended
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    sourceOperationsSuspended.value = true;
    await nextTick();
    finishFirstCheck({
      code: "vibe64_agent_write_mode_busy",
      error: "Session renewal is using this session source.",
      ok: false
    });
    await flushPromises();

    expect(workspace.updates.checking).toBe(false);
    expect(workspace.updates.error).toBe("");
    expect(workspace.updates.errorCode).toBe("");

    mocks.updateCheckHandler = null;
    sourceOperationsSuspended.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check",
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(workspace.updates.error).toBe("");
    expect(workspace.updates.payload).toMatchObject({ relationship: "current" });
  });

  it("uses the shared runtime update command instead of issuing a second update request", async () => {
    mocks.updateCheck = {
      behind: 1,
      relationship: "behind",
      updateAvailable: true,
      updateStrategy: "rebase"
    };
    const requestUpdateWork = vi.fn(async () => ({
      behind: 0,
      canonicalCommit: "b".repeat(40),
      ok: true,
      relationship: "current",
      updateAvailable: false
    }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      requestUpdateWork,
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();
    mocks.requestCalls.length = 0;

    await expect(workspace.applyUpdates()).resolves.toMatchObject({ ok: true });
    expect(requestUpdateWork).toHaveBeenCalledTimes(1);
    expect(mocks.requestCalls.some(({ path }) => String(path).includes("/updates/apply"))).toBe(false);
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes"
    ]);
  });

  it("renders the cached-canonical change list and initial diff before the authority check finishes", async () => {
    let finishUpdateCheck;
    mocks.changes = {
      changedPaths: ["src/app.js"],
      files: [{ added: 1, deleted: 1, path: "src/app.js", status: "M" }],
      initialDiff: {
        diff: "-old\n+new",
        ok: true,
        path: "src/app.js"
      },
      sessionId: "session-1",
      totalCount: 1,
      unsaved: true
    };
    mocks.updateCheckHandler = vi.fn(() => new Promise((resolve) => {
      finishUpdateCheck = resolve;
    }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();

    expect(workspace.changes.loading).toBe(false);
    expect(workspace.changes.payload?.files).toHaveLength(1);
    expect(workspace.selectedCurrentPath.value).toBe("src/app.js");
    expect(workspace.currentDiff.payload).toMatchObject({
      diff: "-old\n+new",
      path: "src/app.js"
    });
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(mocks.requestCalls.some(({ path }) => String(path).includes("/changes/diff"))).toBe(false);

    finishUpdateCheck({
      ahead: 0,
      behind: 0,
      canonicalCommit: "a".repeat(40),
      checkedAt: "2026-08-19T07:15:00.000Z",
      ok: true,
      relationship: "current",
      sessionHead: "a".repeat(40),
      updateAvailable: false,
      updateStrategy: "none"
    });
    await flushPromises();
    expect(workspace.updates.checking).toBe(false);
    expect(mocks.requestCalls).toHaveLength(2);
  });

  it("collapses a burst of source change events into one bounded follow-up inspection", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });
    await nextTick();
    await flushPromises();

    const pendingChanges = [];
    mocks.requestCalls.length = 0;
    mocks.changesHandler = vi.fn(() => new Promise((resolve) => {
      pendingChanges.push(resolve);
    }));
    const sourceChanged = mocks.realtimeEvents.find(({ event }) => (
      event === VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT
    ));
    expect(sourceChanged).toBeTruthy();

    sourceChanged.onEvent();
    sourceChanged.onEvent();
    sourceChanged.onEvent();
    await flushPromises();
    expect(mocks.changesHandler).toHaveBeenCalledTimes(1);

    pendingChanges.shift()({
      canonicalCommit: "a".repeat(40),
      files: [],
      ok: true,
      totalCount: 0,
      unsaved: false
    });
    await flushPromises();
    expect(mocks.changesHandler).toHaveBeenCalledTimes(2);

    pendingChanges.shift()({
      canonicalCommit: "a".repeat(40),
      files: [],
      ok: true,
      totalCount: 0,
      unsaved: false
    });
    await flushPromises();
    expect(mocks.changesHandler).toHaveBeenCalledTimes(2);
    expect(mocks.requestCalls).toHaveLength(2);
  });
});
