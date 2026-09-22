import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registryHarness = vi.hoisted(() => ({
  documentListeners: new Map(),
  intervalCallbacks: [],
  realtimeEvents: [],
  requestHandler: null,
  requests: []
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => ({
    async request(path, options = {}) {
      registryHarness.requests.push({ options, path });
      if (registryHarness.requestHandler) return registryHarness.requestHandler(path, options);
      return String(path).endsWith("/updates/check")
        ? { ok: true, relationship: "current", updateAvailable: false }
        : { changedPaths: [], ok: true, unsaved: false };
    }
  })
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    registryHarness.realtimeEvents.push(options);
    return {};
  }
}));

import {
  createVibe64SessionRepositoryStatusQueue,
  useVibe64SessionRepositoryStatusRegistry
} from "../../src/composables/useVibe64SessionRepositoryStatusRegistry.js";
import {
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
} from "../../src/lib/vibe64RepositoryRealtime.js";
import {
  visibleVibe64ToolbarSessions
} from "../../src/lib/vibe64SessionToolbarVisibility.js";

describe("session repository status registry", () => {
  beforeEach(() => {
    registryHarness.documentListeners.clear();
    registryHarness.intervalCallbacks.length = 0;
    registryHarness.realtimeEvents.length = 0;
    registryHarness.requests.length = 0;
    registryHarness.requestHandler = null;
    vi.stubGlobal("document", {
      addEventListener: vi.fn((event, callback) => {
        registryHarness.documentListeners.set(event, callback);
      }),
      removeEventListener: vi.fn((event) => {
        registryHarness.documentListeners.delete(event);
      }),
      visibilityState: "visible"
    });
    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      setInterval: vi.fn((callback) => {
        registryHarness.intervalCallbacks.push(callback);
        return registryHarness.intervalCallbacks.length;
      })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function settleRegistryRequests() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("inspects only the session chips the toolbar can actually display", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `session-${index + 1}`
    }));

    expect(visibleVibe64ToolbarSessions({
      limit: 3,
      selectedSessionId: "session-8",
      sessions
    }).map((session) => session.sessionId)).toEqual([
      "session-1",
      "session-2",
      "session-8"
    ]);
  });

  it("bounds concurrent Git inspections and deduplicates queued sessions", async () => {
    let active = 0;
    let maximumActive = 0;
    const calls = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      maxConcurrency: 2,
      async requestWork(sessionId) {
        calls.push(sessionId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          changedPaths: [],
          ok: true,
          unsaved: false
        };
      }
    });

    const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index + 1}`);
    queue.enqueue(sessionIds);
    queue.enqueue(sessionIds);
    await queue.waitForIdle();

    expect(maximumActive).toBe(2);
    expect(calls).toHaveLength(10);
    expect(new Set(calls).size).toBe(10);
    queue.dispose();
  });

  it("coalesces repeated forced invalidations while an inspection is active", async () => {
    let release;
    const calls = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      requestWork(sessionId) {
        calls.push(sessionId);
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, unsaved: false });
        });
      }
    });

    queue.enqueue(["session-a"], { force: true });
    queue.enqueue(["session-a"], { force: true });
    queue.enqueue(["session-a"], { force: true });
    expect(calls).toEqual(["session-a"]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["session-a", "session-a"]);
    release();
    await queue.waitForIdle();
    expect(calls).toHaveLength(2);
    queue.dispose();
  });

  it("fails closed when a repository inspection cannot be completed", async () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: (state) => states.push(state),
      async requestWork() {
        throw new Error("Git is unavailable");
      }
    });

    queue.enqueue(["session-a"]);
    await queue.waitForIdle();

    expect(states.at(-1)).toMatchObject({
      sessionId: "session-a",
      workState: {
        error: "Git is unavailable",
        loading: false,
        unsaved: null
      }
    });
    queue.dispose();
  });

  it("keeps Save blocked while a canonical update check is pending", async () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      async requestWork() {
        return { ok: true, unsaved: false, updateAvailable: false };
      }
    });

    queue.markUpdatePending("session-a");
    queue.enqueue(["session-a"], { force: true });
    await queue.waitForIdle();

    expect(states.at(-1)).toMatchObject({
      unsaved: false,
      updateAvailable: true,
      updateStatusPending: true
    });
    queue.dispose();
  });

  it("keeps a newer Save notification when an older canonical check finishes", () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      requestWork: async () => ({ ok: true })
    });
    queue.observe("session-a", { canonicalCommit: "old-version", unsaved: true });
    queue.markUpdatePending("session-a", "first-save");
    queue.markUpdatePending("session-a", "second-save");
    queue.confirmCanonical("session-a", { canonicalCommit: "first-save", updateAvailable: true });
    queue.observe("session-a", { canonicalCommit: "first-save", unsaved: true, updateAvailable: false });
    expect(states.at(-1)).toMatchObject({ updateAvailable: true, updateStatusPending: true });
    queue.observe("session-a", { canonicalCommit: "second-save", unsaved: true, updateAvailable: false });
    expect(states.at(-1)).toMatchObject({ updateAvailable: false });
    expect(states.at(-1).updateStatusPending).not.toBe(true);
    queue.dispose();
  });

  it("announces a confirmed update without letting an old inspection clear it", async () => {
    const states = [];
    const work = Promise.withResolvers();
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      requestWork: () => work.promise
    });
    queue.observe("session-a", { canonicalCommit: "new-version", unsaved: false });
    queue.enqueue(["session-a"], { force: true });
    queue.confirmCanonical("session-a", { canonicalCommit: "new-version", updateAvailable: true });
    expect(states.at(-1)).toMatchObject({ updateAvailable: true, updateStatusPending: true });
    work.resolve({ ok: true, canonicalCommit: "old-version", unsaved: false, updateAvailable: false });
    await queue.waitForIdle();
    expect(states.at(-1)).toMatchObject({ updateAvailable: true, updateStatusPending: true });
    queue.observe("session-a", { canonicalCommit: "new-version", unsaved: false, updateAvailable: false });
    expect(states.at(-1)).toMatchObject({ updateAvailable: false });
    expect(states.at(-1).updateStatusPending).not.toBe(true);
    queue.dispose();
  });

  for (const first of ["HTTP", "realtime"]) {
    it(`shows Rebase immediately and shares one inspection when ${first} arrives first`, async () => {
      const check = Promise.withResolvers();
      const work = Promise.withResolvers();
      const states = [];
      const result = {
        ok: true, checkedAt: "2026-09-08T10:00:00.000Z",
        canonicalCommit: "new-version", updateAvailable: true
      };
      registryHarness.requestHandler = (path) => String(path).endsWith("/updates/check")
        ? check.promise : work.promise;
      const scope = effectScope();
      scope.run(() => useVibe64SessionRepositoryStatusRegistry({
        onState: ({ workState }) => states.push(workState),
        selectedSessionId: ref("session-a"),
        sessions: ref([{ sessionId: "session-a" }]),
        sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
      }));
      const event = registryHarness.realtimeEvents[0];
      const notify = () => event.onEvent({ payload: {
        reason: "session-repository-checked", sessionId: "session-a", repositoryUpdateCheck: result
      } });
      if (first === "realtime") notify();
      else check.resolve(result);
      await settleRegistryRequests();
      expect(states.at(-1)).toMatchObject({ loading: false, updateAvailable: true, updateStatusPending: true });
      expect(registryHarness.requests.filter(({ options }) => options.method === "GET")).toHaveLength(1);
      if (first === "realtime") check.resolve(result);
      else notify();
      await settleRegistryRequests();
      expect(registryHarness.requests.filter(({ options }) => options.method === "GET")).toHaveLength(1);
      work.resolve({ ok: true, canonicalCommit: "new-version", unsaved: false, updateAvailable: true });
      await settleRegistryRequests();
      expect(states.at(-1)).toMatchObject({ updateAvailable: true, unsaved: false });
      expect(states.at(-1).updateStatusPending).not.toBe(true);
      expect(registryHarness.requests).toHaveLength(2);
      scope.stop();
    });
  }

  it("ignores an older check delivered after a newer realtime confirmation", async () => {
    const check = Promise.withResolvers();
    const work = Promise.withResolvers();
    const states = [];
    registryHarness.requestHandler = (path) => String(path).endsWith("/updates/check")
      ? check.promise : work.promise;
    const scope = effectScope();
    scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      onState: ({ workState }) => states.push(workState),
      selectedSessionId: ref("session-a"), sessions: ref([{ sessionId: "session-a" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    registryHarness.realtimeEvents[0].onEvent({ payload: {
      reason: "session-repository-checked", sessionId: "session-a", repositoryUpdateCheck: {
        canonicalCommit: "second-save", checkedAt: "2026-09-08T10:01:00.000Z", updateAvailable: true
      }
    } });
    check.resolve({ ok: true, canonicalCommit: "first-save", checkedAt: "2026-09-08T10:00:00.000Z", updateAvailable: true });
    await settleRegistryRequests();
    expect(registryHarness.requests).toHaveLength(2);
    expect(states.at(-1)).toMatchObject({ updateAvailable: true, updateStatusPending: true });
    work.resolve({ ok: true, canonicalCommit: "second-save", unsaved: false, updateAvailable: false });
    await settleRegistryRequests();
    expect(states.at(-1)).toMatchObject({ updateAvailable: false });
    expect(states.at(-1).updateStatusPending).not.toBe(true);
    scope.stop();
  });

  it("settles a pending recheck without an announced version only after inspecting its confirmed version", () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      requestWork: async () => ({ ok: true })
    });
    queue.markUpdatePending("session-a");
    queue.confirmCanonical("session-a", { canonicalCommit: "current-version" });
    queue.observe("session-a", { canonicalCommit: "old-version", unsaved: true, updateAvailable: false });
    expect(states.at(-1)).toMatchObject({ updateAvailable: true, updateStatusPending: true });
    queue.observe("session-a", { canonicalCommit: "current-version", unsaved: true, updateAvailable: false });
    expect(states.at(-1)).toMatchObject({ updateAvailable: false });
    expect(states.at(-1).updateStatusPending).not.toBe(true);
    queue.dispose();
  });

  it("fails closed when canonical freshness cannot be checked", () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      async requestWork() {
        return { ok: true, unsaved: true };
      }
    });

    queue.observe("session-a", { error: "", unsaved: true });
    queue.markCanonicalCheckUnavailable("session-a", "GitHub is unavailable");

    expect(states.at(-1)).toMatchObject({
      error: "GitHub is unavailable",
      loading: false,
      unsaved: true
    });
    queue.dispose();
  });

  it("does not publish a late repository result after disposal", async () => {
    let release;
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: (state) => states.push(state),
      requestWork() {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
    });

    queue.enqueue(["session-a"]);
    expect(states).toHaveLength(1);
    queue.dispose();
    release({ ok: true, unsaved: false });
    await queue.waitForIdle();

    expect(states).toHaveLength(1);
    expect(states[0].workState.loading).toBe(true);
  });

  it("keeps every durable-renewal invalidation away from the selected source until release", async () => {
    const selectedSessionId = ref("session-a");
    const sessions = ref([{ sessionId: "session-a", status: "active" }]);
    const sourceAccess = reactive({ "session-a": false });
    const states = [];
    const scope = effectScope();
    const registry = scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      onState: (state) => states.push(state),
      selectedSessionId,
      sessionSourceOperationsSuspended: (sessionId) => sourceAccess[sessionId] === true,
      sessions,
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    expect(registryHarness.requests.map(({ options, path }) => [options.method, path])).toEqual([
      ["POST", "/api/app/sample/vibe64/sessions/session-a/updates/check"],
      ["GET", "/api/app/sample/vibe64/sessions/session-a/work"]
    ]);

    registryHarness.requests.length = 0;
    states.length = 0;
    sourceAccess["session-a"] = true;
    await nextTick();

    // The confirm response refreshes the list, realtime emits several session
    // invalidations, and both repository timers can fire while renewal remains
    // durably running. None may inspect the predecessor source.
    sessions.value = [{
      renewalAdvisory: { level: "required" },
      sessionId: "session-a",
      status: "active"
    }];
    await nextTick();
    const sessionChanged = registryHarness.realtimeEvents[0];
    const payload = {
      reason: "repository-canonical-changed",
      session: { sessionId: "session-a" }
    };
    expect(sessionChanged.matches({ payload })).toBe(false);
    sessionChanged.onEvent({ payload });
    sessionChanged.onEvent({ payload });
    registry.inspectVisible({ force: true, includeSelected: true });
    for (const callback of registryHarness.intervalCallbacks) {
      callback();
    }
    await settleRegistryRequests();

    expect(registryHarness.requests).toEqual([]);
    expect(states).toEqual([]);

    sourceAccess["session-a"] = false;
    await settleRegistryRequests();
    expect(registryHarness.requests.map(({ options, path }) => [options.method, path])).toEqual([
      ["POST", "/api/app/sample/vibe64/sessions/session-a/updates/check"],
      ["GET", "/api/app/sample/vibe64/sessions/session-a/work"]
    ]);
    expect(states.at(-1)).toMatchObject({
      sessionId: "session-a",
      workState: { error: "", unsaved: false }
    });

    scope.stop();
  });

  it("invalidates only meaningful work events for their exact session", () => {
    expect(repositoryStatusSessionId({ session: { sessionId: "session-a" } })).toBe("session-a");
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "codex-app-server-turn-idle" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "codex-turn-checkpoint-updated" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "opencode-server-turn-idle" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-save-completed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "repository-canonical-changed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-repository-checked" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "codex-app-server-live-progress" })).toBe(false);
  });

  it("refreshes visible repository fallbacks without bypassing the server's shared check cache", async () => {
    const scope = effectScope();
    scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      selectedSessionId: ref("session-a"),
      sessions: ref([
        { sessionId: "session-a", status: "active" },
        { sessionId: "session-b", status: "active" }
      ]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    registryHarness.requests.length = 0;

    document.visibilityState = "visible";
    registryHarness.documentListeners.get("visibilitychange")();
    await settleRegistryRequests();

    expect(registryHarness.requests.map(({ options, path }) => [options.method, path])).toEqual([
      ["GET", "/api/app/sample/vibe64/sessions/session-b/work"],
      ["POST", "/api/app/sample/vibe64/sessions/session-a/updates/check"],
      ["GET", "/api/app/sample/vibe64/sessions/session-a/work"]
    ]);
    expect(registryHarness.requests.find(({ options }) => options.method === "POST").options.body)
      .toEqual({ force: false });
    scope.stop();
    expect(registryHarness.documentListeners.has("visibilitychange")).toBe(false);
  });
});
