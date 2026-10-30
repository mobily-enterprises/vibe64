import { createRenderer, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, expect, it, vi } from "vitest";

import current from "../fixtures/usage-map/recording/api/current.json" with { type: "json" };

vi.mock("/src/composables/useVibe64ProjectScope.js", async () => {
  const { ref: makeRef } = await import("vue");
  return { useVibe64ProjectSlug: () => makeRef("fixture") };
});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix) => `/api/projects/fixture${suffix}` })
}));
import { useVibe64UsageRecording } from "@local/vibe64-usage-recording/client";

const BASE = "/api/projects/fixture/vibe64/usage-recordings/sessions/session-fixture";
const RUNNING = { ...current.recording, state: "recording", stoppedAt: null, stopReason: null,
  counts: { requests: 5, functions: 12 } };
const originalClient = getHttpWebClient();
let app;
let queryClient;
afterEach(() => {
  app?.unmount();
  app = null;
  queryClient?.clear();
  configureHttpWebClient(originalClient);
  vi.useRealTimers();
});

// Two readers of one session, like the header indicator and the usage view.
function mountReaders({ responses = {}, sessionId = "session-fixture" } = {}) {
  const requests = [];
  const listeners = new Map();
  configureHttpWebClient({
    request(path, options = {}) {
      requests.push({ path, method: options.method, body: options.body });
      const response = responses[`${options.method} ${path.replace(BASE, "")}`];
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(typeof response === "function" ? response() : response);
    }
  });
  const socket = {
    on(event, listener) { listeners.set(event, [...listeners.get(event) || [], listener]); },
    off(event, listener) { listeners.set(event, (listeners.get(event) || []).filter((entry) => entry !== listener)); }
  };
  const readers = [];
  const node = () => ({});
  app = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
    patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ setup() {
      readers.push(useVibe64UsageRecording({ sessionId }), useVibe64UsageRecording({ sessionId: ref(sessionId) }));
      return () => null;
    } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.mount({});
  return {
    readers,
    requests,
    emit(event, payload) { for (const listener of listeners.get(event) || []) listener(payload); }
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const changed = (payload) => ({ projectSlug: "fixture", sessionId: "session-fixture", recordingId: RUNNING.id, ...payload });

it("fetches the current recording once for every reader and corrects elapsed time for clock skew", async () => {
  // The client clock runs a minute behind the server's.
  vi.useFakeTimers({ now: Date.parse("2026-10-30T10:00:30.000Z") });
  const view = mountReaders({ responses: { "GET /current": { recording: RUNNING, serverTime: "2026-10-30T10:01:30.000Z" } } });
  const [indicator, usageView] = view.readers;
  expect(indicator.loading.value).toBe(true);
  await flush();

  expect(view.requests).toEqual([{ path: `${BASE}/current`, method: "GET", body: undefined }]);
  for (const reader of view.readers) {
    expect(reader.recording.value.id).toBe(RUNNING.id);
    expect(reader.active.value).toBe(true);
    expect(reader.loading.value).toBe(false);
  }
  expect(indicator.elapsedMs.value).toBe(90_000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(usageView.elapsedMs.value).toBe(92_000);
});

it("applies realtime changes for its own project and session only, and refetches when one finishes", async () => {
  vi.useFakeTimers({ now: Date.parse("2026-10-30T10:00:30.000Z") });
  let latest = { recording: RUNNING, serverTime: "2026-10-30T10:00:30.000Z" };
  const view = mountReaders({ responses: { "GET /current": () => latest } });
  await flush();
  const [indicator, usageView] = view.readers;

  view.emit("vibe64.usage-recording.changed", changed({ sessionId: "another-session", counts: { requests: 99, functions: 1 } }));
  view.emit("vibe64.usage-recording.changed", changed({ projectSlug: "another-project", counts: { requests: 98, functions: 1 } }));
  view.emit("vibe64.usage-recording.changed", changed({ state: "recording", counts: { requests: 37, functions: 40 } }));
  await flush();
  for (const reader of view.readers) expect(reader.recording.value.counts).toEqual({ requests: 37, functions: 40 });
  expect(view.requests).toHaveLength(1);
  // Merged changes keep the clock correction of the last read.
  expect(indicator.elapsedMs.value).toBe(30_000);

  latest = { recording: { ...RUNNING, state: "stopped", stoppedAt: "2026-10-30T10:00:31.000Z", stopReason: "person" },
    serverTime: "2026-10-30T10:00:31.000Z" };
  view.emit("vibe64.usage-recording.changed", changed({ state: "stopped", stoppedAt: "2026-10-30T10:00:31.000Z" }));
  expect(usageView.recording.value.state).toBe("stopped");
  await flush();
  expect(view.requests).toHaveLength(2);
  expect(usageView.recording.value.stopReason).toBe("person");
  expect(usageView.active.value).toBe(false);
  expect(usageView.elapsedMs.value).toBe(31_000);

  // Another recording of the same session is read in full.
  latest = { recording: { ...RUNNING, id: "rec_secondrecording2abcd", counts: { requests: 0, functions: 0 } },
    serverTime: "2026-10-30T10:01:00.000Z" };
  view.emit("vibe64.usage-recording.changed", changed({ recordingId: "rec_secondrecording2abcd", state: "starting" }));
  await flush();
  expect(view.requests).toHaveLength(3);
  expect(indicator.recording.value.id).toBe("rec_secondrecording2abcd");
});

it("refetches when realtime reconnects", async () => {
  vi.useFakeTimers();
  let latest = { recording: null, serverTime: new Date().toISOString() };
  const view = mountReaders({ responses: { "GET /current": () => latest } });
  await flush();
  expect(view.readers[0].recording.value).toBe(null);

  latest = { recording: RUNNING, serverTime: new Date().toISOString() };
  view.emit("connect");
  await flush();
  expect(view.requests.map((request) => request.path)).toEqual([`${BASE}/current`, `${BASE}/current`]);
  expect(view.readers[1].recording.value.state).toBe("recording");
});

it("shares operation results with every reader and reports server refusals verbatim", async () => {
  vi.useFakeTimers();
  const refused = Object.assign(new Error("A recording is already running in this session."), { status: 409 });
  const view = mountReaders({ responses: {
    "GET /current": { recording: null, serverTime: new Date().toISOString() },
    "GET /targets": { targets: [{ id: "preview", kind: "web", label: "Preview", available: true, parameters: [] }] },
    "POST ": { recording: { ...RUNNING, state: "starting" } },
    [`POST /${RUNNING.id}/stop`]: { recording: { ...RUNNING, state: "stopping" } },
    [`POST /${RUNNING.id}/interactions`]: { ok: true },
    [`POST /${RUNNING.id}/dismiss`]: refused
  } });
  await flush();
  const [indicator, controls] = view.readers;

  expect(await controls.readTargets()).toEqual({ targets: [expect.objectContaining({ id: "preview" })] });
  await controls.start({ targetId: "output:sessions-cli", parameters: { limit: "5" } });
  expect(view.requests.at(-1)).toEqual({ path: BASE, method: "POST", body: { targetId: "output:sessions-cli", parameters: { limit: "5" } } });
  expect(indicator.recording.value.state).toBe("starting");

  // Interactions are recorded only while recording.
  expect(await controls.recordInteraction({ id: "i_0001", at: "2026-10-30T10:00:01.000Z", label: "Save" })).toBe(null);
  view.emit("vibe64.usage-recording.changed", changed({ state: "recording" }));
  await controls.recordInteraction({ id: "i_0001", at: "2026-10-30T10:00:01.000Z", label: "x".repeat(90) });
  expect(view.requests.at(-1).body).toEqual({ id: "i_0001", at: "2026-10-30T10:00:01.000Z", label: "x".repeat(80), kind: "click", componentFile: null });

  expect(await indicator.stop()).toEqual(expect.objectContaining({ state: "stopping" }));
  expect(controls.recording.value.state).toBe("stopping");
  expect(controls.active.value).toBe(true);

  expect(await indicator.dismiss()).toBe(null);
  expect(indicator.error.value).toBe("A recording is already running in this session.");
  expect(controls.error.value).toBe("");
});
