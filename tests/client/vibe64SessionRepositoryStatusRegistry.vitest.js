import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registryHarness = vi.hoisted(() => ({
  documentListeners: new Map(),
  intervalCallbacks: [],
  realtimeEvents: [],
  requestHandler: null,
  requests: [],
  socket: null
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
  },
  useRealtimeSocket: () => registryHarness.socket
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
    const socketListeners = new Map();
    registryHarness.socket = {
      connected: true,
      emitted: [],
      listeners: socketListeners,
      emit(event, input) { this.emitted.push([event, input]); },
      off(event) { socketListeners.delete(event); },
      on(event, callback) { socketListeners.set(event, callback); }
    };
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function settleRegistryRequests() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  // A burst's inspection starts once the burst has been quiet for a second.
  async function settleBurst() {
    await settleRegistryRequests();
    await vi.advanceTimersByTimeAsync(1_000);
    await settleRegistryRequests();
  }

  function fakeQueueClock() {
    let time = 0;
    const timers = new Set();
    return {
      now: () => time,
      setTimer(callback, delay) {
        const timer = { at: time + delay, callback };
        timers.add(timer);
        return timer;
      },
      clearTimer(timer) {
        timers.delete(timer);
      },
      async advance(ms) {
        const end = time + ms;
        for (;;) {
          await settleRegistryRequests();
          const next = [...timers].filter((timer) => timer.at <= end).sort((left, right) => left.at - right.at)[0];
          if (!next) break;
          timers.delete(next);
          time = next.at;
          next.callback();
        }
        time = end;
        await settleRegistryRequests();
      }
    };
  }

  // A queue whose settle timers run on the fake clock.
  function queueOnClock(clock, options) {
    return createVibe64SessionRepositoryStatusQueue({
      clearTimer: clock.clearTimer, now: clock.now, setTimer: clock.setTimer, ...options
    });
  }

  // The registry's own settle timers, and the dates its checks record.
  function fakeRegistryTimers() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  }

  function realtimeListener(event) {
    return registryHarness.realtimeEvents.find((options) => options.event === event);
  }

  function workRequests(sessionId = "") {
    return registryHarness.requests.filter(({ options, path }) => options.method === "GET" &&
      (!sessionId || path.endsWith(`/${sessionId}/work`)));
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

  // One change reaches a session as a burst of events: the burst gets one
  // inspection, not one per event.
  it("inspects each session once for a burst of changes, after the burst settles", async () => {
    const clock = fakeQueueClock();
    const calls = [];
    const queue = queueOnClock(clock, {
      async requestWork(sessionId) {
        calls.push(sessionId);
        return { ok: true, unsaved: false };
      }
    });

    for (let event = 0; event < 6; event += 1) {
      queue.enqueue(["session-a", "session-b"], { force: true, settle: true });
      await clock.advance(300);
    }
    expect(calls).toEqual([]);
    await clock.advance(1_000);
    expect(calls.sort()).toEqual(["session-a", "session-b"]);
    await clock.advance(10_000);
    await queue.waitForIdle();
    expect(calls).toHaveLength(2);
    queue.dispose();
  });

  it("follows a change that lands during an inspection with exactly one settled inspection", async () => {
    const clock = fakeQueueClock();
    const releases = [];
    const queue = queueOnClock(clock, {
      requestWork: () => new Promise((resolve) => releases.push(resolve))
    });

    queue.enqueue(["session-a"], { force: true, settle: true });
    await clock.advance(1_000);
    expect(releases).toHaveLength(1);
    for (let event = 0; event < 5; event += 1) {
      queue.enqueue(["session-a"], { force: true, settle: true });
      await clock.advance(200);
    }
    expect(releases).toHaveLength(1);
    releases[0]({ ok: true, unsaved: true });
    await clock.advance(0);
    expect(releases).toHaveLength(1);
    await clock.advance(1_000);
    expect(releases).toHaveLength(2);
    releases[1]({ ok: true, unsaved: false });
    await clock.advance(10_000);
    await queue.waitForIdle();
    expect(releases).toHaveLength(2);
    queue.dispose();
  });

  it("does not let a continuous stream of changes postpone an inspection past five seconds", async () => {
    const clock = fakeQueueClock();
    const startedAt = [];
    const queue = queueOnClock(clock, {
      async requestWork() {
        startedAt.push(clock.now());
        return { ok: true, unsaved: false };
      }
    });

    for (let event = 0; event < 16; event += 1) {
      queue.enqueue(["session-a"], { force: true, settle: true });
      await clock.advance(500);
    }
    expect(startedAt[0]).toBe(5_000);
    queue.dispose();
  });

  it("starts a direct inspection at once, sharing it with the burst that is settling", async () => {
    const clock = fakeQueueClock();
    const releases = [];
    const inspected = [];
    const queue = queueOnClock(clock, {
      onInspected: (state) => inspected.push(state),
      requestWork: () => new Promise((resolve) => releases.push(resolve))
    });

    queue.enqueue(["session-a"], { force: true, settle: true });
    const direct = queue.inspect("session-a");
    await clock.advance(0);
    expect(releases).toHaveLength(1);
    releases[0]({ ok: true, unsaved: true });
    await expect(direct).resolves.toMatchObject({ error: "", loading: false, unsaved: true });
    expect(inspected).toEqual([{ sessionId: "session-a", workState: expect.objectContaining({ unsaved: true }) }]);
    await clock.advance(10_000);
    expect(releases).toHaveLength(1);
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
      fakeRegistryTimers();
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
      await settleBurst();
      expect(workRequests()).toHaveLength(1);
      if (first === "realtime") check.resolve(result);
      else notify();
      await settleBurst();
      expect(workRequests()).toHaveLength(1);
      work.resolve({ ok: true, canonicalCommit: "new-version", unsaved: false, updateAvailable: true });
      await settleBurst();
      expect(states.at(-1)).toMatchObject({ updateAvailable: true, unsaved: false });
      expect(states.at(-1).updateStatusPending).not.toBe(true);
      expect(registryHarness.requests).toHaveLength(2);
      scope.stop();
    });
  }

  it("ignores an older check delivered after a newer realtime confirmation", async () => {
    fakeRegistryTimers();
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
    await settleBurst();
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
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "claude-stream-turn-idle" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-turn-checkpoint-updated" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-turn-checkpoint-failed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-save-update-required" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "opencode-server-turn-idle" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-save-completed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "repository-canonical-changed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-repository-checked" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-starter-applied" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "codex-app-server-live-progress" })).toBe(false);
  });

  // The starter is applied outside any turn, Save or editor event, so without
  // its own reason the selected session kept showing "All work is saved".
  it("re-inspects the selected session's work when a starter is applied to it", async () => {
    fakeRegistryTimers();
    const states = [];
    const scope = effectScope();
    scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      onState: ({ sessionId, workState }) => states.push({ sessionId, workState }),
      selectedSessionId: ref("session-a"),
      sessions: ref([{ sessionId: "session-a" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    expect(states.at(-1).workState.unsaved).toBe(false);
    registryHarness.requests.length = 0;
    const starterFiles = ["genesis/stack.md", "package.json", "src/main.js"];
    registryHarness.requestHandler = () => ({ changedPaths: starterFiles, ok: true, unsaved: true });

    const sessionEvent = realtimeListener("vibe64.session.summary.changed");
    const change = { payload: { reason: "session-starter-applied", sessionId: "session-a" } };
    expect(sessionEvent.matches(change)).toBe(true);
    sessionEvent.onEvent(change);
    await settleBurst();

    expect(registryHarness.requests.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-a/work"
    ]);
    expect(states.at(-1)).toMatchObject({
      sessionId: "session-a",
      workState: { changedPaths: starterFiles, unsaved: true }
    });
    scope.stop();
  });

  it("reuses checked repository state across session switches and still responds to real invalidation", async () => {
    fakeRegistryTimers();
    const selectedSessionId = ref("session-a");
    let revision = 0;
    registryHarness.requestHandler = (path) => String(path).endsWith("/updates/check")
      ? { ok: true, checkedAt: new Date(Date.now() + revision++).toISOString(), updateAvailable: false }
      : { ok: true, changedPaths: [], unsaved: true };
    const scope = effectScope();
    const registry = scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      selectedSessionId,
      sessions: ref([{ sessionId: "session-a" }, { sessionId: "session-b" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    selectedSessionId.value = "session-b";
    await settleRegistryRequests();
    expect(registryHarness.requests.filter(({ options }) => options.method === "POST")).toHaveLength(2);
    registryHarness.requests.length = 0;
    for (const id of ["session-a", "session-b", "session-a"]) {
      selectedSessionId.value = id;
      await settleRegistryRequests();
    }
    expect(registryHarness.requests).toEqual([]);

    const sourceEvent = realtimeListener("vibe64.source-editor.file.changed");
    sourceEvent.onEvent({ payload: { sessionId: "session-b" } });
    await settleBurst();
    expect(registryHarness.requests.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-b/work"
    ]);
    registryHarness.requests.length = 0;
    await registry.refresh("session-a");
    expect(registryHarness.requests.some(({ options, path }) => options.method === "POST" &&
      options.body.force && path.endsWith("/session-a/updates/check"))).toBe(true);
    scope.stop();
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

    // Returning to the tab refreshes local work; the server probe owns update checks.
    expect(registryHarness.requests.map(({ options, path }) => [options.method, path])).toEqual([
      ["GET", "/api/app/sample/vibe64/sessions/session-b/work"]
    ]);
    scope.stop();
    expect(registryHarness.documentListeners.has("visibilitychange")).toBe(false);
  });

  // A project open only in background tabs still gets the 30 s probe, so a
  // person returning to that tab sees accurate state: only leaving the
  // project or the page ends the watch.
  it("watches its project for the server's update probe while the tab is open, visible or hidden", async () => {
    const projectSlug = ref("sample");
    const scope = effectScope();
    scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      projectSlug,
      selectedSessionId: ref("session-a"),
      sessions: ref([{ sessionId: "session-a", status: "active" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    const { socket } = registryHarness;
    const [[event, watch]] = socket.emitted;
    expect(event).toBe("vibe64.sessions.project.watch");
    expect(watch).toEqual({ projectSlug: "sample", watchId: expect.any(String) });
    const emitted = () => socket.emitted.map(([name, input]) => [name.split(".").at(-1), input.projectSlug || ""]);

    registryHarness.requests.length = 0;
    for (const callback of registryHarness.intervalCallbacks) callback();
    await settleRegistryRequests();
    expect(registryHarness.requests.filter(({ options }) => options.method === "POST")).toEqual([]);

    document.visibilityState = "hidden";
    registryHarness.documentListeners.get("visibilitychange")();
    expect(emitted()).toEqual([["watch", "sample"]]);
    document.visibilityState = "visible";
    registryHarness.documentListeners.get("visibilitychange")();
    socket.listeners.get("connect")();
    projectSlug.value = "other";
    await nextTick();
    projectSlug.value = "";
    await nextTick();
    expect(emitted()).toEqual([
      ["watch", "sample"], ["watch", "sample"], ["watch", "other"], ["release", ""]
    ]);
    projectSlug.value = "sample";
    await nextTick();
    expect(new Set(socket.emitted.map(([, input]) => input.watchId)).size).toBe(1);
    scope.stop();
    expect(emitted().slice(-2)).toEqual([["watch", "sample"], ["release", ""]]);
    expect(socket.listeners.has("connect")).toBe(false);
  });

  it("reads each visible session's work once for a burst of realtime changes", async () => {
    fakeRegistryTimers();
    const scope = effectScope();
    const registry = scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      selectedSessionId: ref("session-a"),
      sessions: ref([{ sessionId: "session-a" }, { sessionId: "session-b" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleBurst();
    registryHarness.requests.length = 0;
    const sessionChanged = realtimeListener("vibe64.session.summary.changed");
    const fileChanged = realtimeListener("vibe64.source-editor.file.changed");
    for (const sessionId of ["session-a", "session-b"]) {
      for (const reason of ["session-turn-checkpoint-updated", "claude-stream-turn-idle"]) {
        sessionChanged.onEvent({ payload: { reason, sessionId } });
      }
      fileChanged.onEvent({ payload: { sessionId } });
    }
    // The selected session's runtime host refreshes for the same change.
    const hostRead = registry.sessionWork.inspect("session-a", { settle: true });
    await vi.advanceTimersByTimeAsync(400);
    sessionChanged.onEvent({ payload: { reason: "session-turn-checkpoint-updated", sessionId: "session-b" } });
    await settleRegistryRequests();
    expect(workRequests()).toEqual([]);

    await settleBurst();
    expect(workRequests().map(({ path }) => path).sort()).toEqual([
      "/api/app/sample/vibe64/sessions/session-a/work",
      "/api/app/sample/vibe64/sessions/session-b/work"
    ]);
    await expect(hostRead).resolves.toMatchObject({ error: "", unsaved: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(workRequests()).toHaveLength(2);
    scope.stop();
  });

  for (const outcome of ["confirms", "fails"]) {
    it(`inspects a canonical change once, after the forced check it starts ${outcome}`, async () => {
      fakeRegistryTimers();
      const states = [];
      const scope = effectScope();
      scope.run(() => useVibe64SessionRepositoryStatusRegistry({
        onState: ({ sessionId, workState }) => states.push({ sessionId, workState }),
        selectedSessionId: ref("session-a"),
        sessions: ref([{ sessionId: "session-a" }, { sessionId: "session-b" }]),
        sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
      }));
      await settleBurst();
      registryHarness.requests.length = 0;
      const check = Promise.withResolvers();
      registryHarness.requestHandler = (path) => String(path).endsWith("/updates/check")
        ? check.promise : { changedPaths: [], ok: true, unsaved: false };
      const sessionChanged = realtimeListener("vibe64.session.summary.changed");
      sessionChanged.onEvent({ payload: {
        canonicalCommit: "new-version", reason: "repository-canonical-changed", sessionId: "session-b"
      } });
      await settleBurst();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(states.at(-1)).toMatchObject({ sessionId: "session-b", workState: { updateAvailable: true, updateStatusPending: true } });
      expect(workRequests()).toEqual([]);

      const result = { canonicalCommit: "new-version", checkedAt: new Date().toISOString(), ok: true, updateAvailable: true };
      if (outcome === "confirms") check.resolve(result);
      else check.resolve({ error: "GitHub is unavailable", ok: false });
      await settleBurst();
      expect(workRequests().map(({ path }) => path)).toEqual(["/api/app/sample/vibe64/sessions/session-b/work"]);
      if (outcome === "confirms") {
        // The same check's realtime result reaches this tab too.
        sessionChanged.onEvent({ payload: {
          reason: "session-repository-checked", repositoryUpdateCheck: result, sessionId: "session-b"
        } });
      }
      await settleBurst();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(workRequests()).toHaveLength(1);
      scope.stop();
    });
  }

  it("inspects a canonical change that joins a running check once, when its forced recheck fails", async () => {
    fakeRegistryTimers();
    const checks = [];
    registryHarness.requestHandler = (path) => {
      if (!String(path).endsWith("/updates/check")) return { changedPaths: [], ok: true, unsaved: false };
      const check = Promise.withResolvers();
      checks.push(check);
      return check.promise;
    };
    const scope = effectScope();
    scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      selectedSessionId: ref("session-a"),
      sessions: ref([{ sessionId: "session-a" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    expect(checks).toHaveLength(1);
    const sessionChanged = realtimeListener("vibe64.session.summary.changed");
    sessionChanged.onEvent({ payload: {
      canonicalCommit: "new-version", reason: "repository-canonical-changed", sessionId: "session-a"
    } });
    checks[0].resolve({ canonicalCommit: "old-version", checkedAt: new Date().toISOString(), ok: true });
    await settleBurst();
    expect(checks).toHaveLength(2);
    expect(workRequests()).toEqual([]);
    checks[1].resolve({ error: "GitHub is unavailable", ok: false });
    await settleBurst();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(workRequests().map(({ path }) => path)).toEqual(["/api/app/sample/vibe64/sessions/session-a/work"]);
    scope.stop();
  });

  it("shows a server probe failure on its session's repository status", async () => {
    const states = [];
    const scope = effectScope();
    scope.run(() => useVibe64SessionRepositoryStatusRegistry({
      onState: (state) => states.push(state),
      projectSlug: ref("sample"),
      selectedSessionId: ref("session-a"),
      sessions: ref([{ sessionId: "session-a", status: "active" }]),
      sessionsApiPath: ref("/api/app/sample/vibe64/sessions")
    }));
    await settleRegistryRequests();
    registryHarness.requests.length = 0;
    const sessionChanged = registryHarness.realtimeEvents[0];
    const payload = {
      reason: "session-repository-check-failed",
      repositoryUpdateCheckError: { code: "vibe64_git_failed", message: "Could not resolve host: github.com" },
      sessionId: "session-a"
    };
    expect(sessionChanged.matches({ payload })).toBe(true);
    sessionChanged.onEvent({ payload });
    await settleRegistryRequests();
    expect(states.at(-1)).toMatchObject({
      sessionId: "session-a",
      workState: { error: "Could not resolve host: github.com", loading: false }
    });
    expect(registryHarness.requests).toEqual([]);
    scope.stop();
  });
});
