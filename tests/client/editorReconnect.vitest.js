import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldRetryTransientQueryFailure } from "@jskit-ai/kernel/shared/support";

// A workspace's editor restarts for a release: its server stops, and for a while nothing answers (the hosted edge says
// 503 "No server is available", or the connection is refused), then the next server answers. The page works through
// it: a read waits it out, a write the person makes meanwhile is sent once the editor is back, and after a moment the
// page says "Updating…" in words, never a status code, and clears it by itself. These drive the page's own HTTP client
// (src/lib/vibe64HttpClient.js, which src/main.js configures) and the app's own error presentation (src/error.js)
// through such a restart.

const UPDATING = "Updating…";
const STATUS_TEXT = /status|\b50[0-9]\b|\b0\b/iu;

/** The editor behind the hosted edge: what answers each request, and which requests its handlers ran. */
function fakeEditor() {
  const handled = [];
  let mode = "up";
  async function fetchImpl(url, config = {}) {
    const method = String(config.method || "GET").toUpperCase();
    const { pathname } = new URL(String(url), "http://editor.test");
    if (mode === "refused") throw new TypeError("Failed to fetch");
    if (mode === "edge") {
      return new Response("<html><body><h1>503 Service Unavailable</h1>No server is available to handle this " +
        "request.</body></html>", { status: 503, headers: { "content-type": "text/html" } });
    }
    if (mode === "stopping") {
      // The stopping editor answers before any handler runs, and says so.
      return new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json", "x-vibe64-stopping": "1", connection: "close" }
      });
    }
    handled.push(`${method} ${pathname}`);
    if (mode === "applied-then-lost") {
      // The editor did the work, but its answer never came back: the edge says 502.
      return new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", {
        status: 502,
        headers: { "content-type": "text/html" }
      });
    }
    return new Response(JSON.stringify({ ok: true, method, path: pathname }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return {
    fetchImpl,
    handled,
    writes: () => handled.filter((entry) => !entry.startsWith("GET ")),
    set(next) {
      mode = next;
    }
  };
}

/** The shell's error runtime, as the app's error configuration receives it: what it shows now, and all it was asked. */
function fakeErrorRuntime() {
  const shown = new Map();
  const reports = [];
  let next = 0;
  return {
    reports,
    shown,
    report(event = {}) {
      next += 1;
      const presentationId = `presentation-${next}`;
      const entry = { ...event, presentationId };
      reports.push(entry);
      shown.set(presentationId, entry);
      return { presentationId, decision: { presenterId: "test" }, skipped: false };
    },
    dismiss(presentationId) {
      return shown.delete(presentationId) ? 1 : 0;
    },
    subscribe() {
      return () => {};
    }
  };
}

/** What the page shows for an action: its result, or its error reported to the shell as the page's feedback does. */
async function pageAction(runtime, run) {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    runtime.report({
      source: "test.page-action",
      intent: "action-feedback",
      severity: "error",
      message: error?.message,
      messageCode: error?.messageCode,
      cause: error
    });
    return { ok: false, error };
  }
}

function shownMessages(runtime) {
  return [...runtime.shown.values()].map((entry) => String(entry.message || ""));
}

function errorsShownOrReported(runtime) {
  return runtime.reports.filter((entry) => entry.severity !== "info" && entry.severity !== "success");
}

async function openPage() {
  vi.resetModules();
  const editor = fakeEditor();
  const runtime = fakeErrorRuntime();
  const { createVibe64HttpClient } = await import("../../src/lib/vibe64HttpClient.js");
  const { default: configureVibe64ErrorRuntime } = await import("../../src/error.js");
  configureVibe64ErrorRuntime({ runtime });
  const client = createVibe64HttpClient({ fetchImpl: editor.fetchImpl, resolveRequestUrl: (url) => url });
  // Mid-session: the page has already read from the editor.
  await expect(client.request("/api/sessions/status")).resolves.toMatchObject({ ok: true });
  return { client, editor, runtime };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page through an editor restart", () => {
  it("waits out a 5 s drop: the read finishes, a write made meanwhile is done once, and the page says Updating…", async () => {
    const { client, editor, runtime } = await openPage();

    editor.set("edge");
    const read = pageAction(runtime, () => client.request("/api/sessions/status"));
    await vi.advanceTimersByTimeAsync(1_000);
    const write = pageAction(runtime, () => client.request("/api/notes", { method: "POST", body: { text: "keep" } }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shownMessages(runtime)).toContain(UPDATING);

    await vi.advanceTimersByTimeAsync(3_000);
    editor.set("up");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await read).toMatchObject({ ok: true, value: { ok: true } });
    expect(await write).toMatchObject({ ok: true, value: { ok: true, method: "POST" } });
    expect(editor.writes()).toEqual(["POST /api/notes"]);
    expect(errorsShownOrReported(runtime)).toEqual([]);
    expect(shownMessages(runtime)).not.toContain(UPDATING);
    expect(runtime.reports.filter((entry) => entry.message === UPDATING)).toHaveLength(1);
  });

  it("waits out a 30 s drop with no connection at all, and the write made meanwhile is done once", async () => {
    const { client, editor, runtime } = await openPage();

    editor.set("refused");
    const read = pageAction(runtime, () => client.request("/api/sessions/status"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(shownMessages(runtime)).toContain(UPDATING);
    const write = pageAction(runtime, () => client.request("/api/notes", { method: "POST", body: { text: "keep" } }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(shownMessages(runtime)).toContain(UPDATING);
    expect(editor.writes()).toEqual([]);

    editor.set("up");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await read).toMatchObject({ ok: true });
    expect(await write).toMatchObject({ ok: true, value: { method: "POST" } });
    expect(editor.writes()).toEqual(["POST /api/notes"]);
    expect(errorsShownOrReported(runtime)).toEqual([]);
    expect(shownMessages(runtime)).not.toContain(UPDATING);
  });

  it("sends again, once the editor is back, a write the stopping editor refused before doing anything", async () => {
    const { client, editor, runtime } = await openPage();

    editor.set("stopping");
    const write = pageAction(runtime, () => client.request("/api/notes", { method: "POST", body: { text: "keep" } }));
    await vi.advanceTimersByTimeAsync(500);
    editor.set("refused");
    await vi.advanceTimersByTimeAsync(4_500);
    editor.set("up");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await write).toMatchObject({ ok: true, value: { method: "POST" } });
    expect(editor.writes()).toEqual(["POST /api/notes"]);
    expect(errorsShownOrReported(runtime)).toEqual([]);
  });

  it("never sends again a write whose answer was lost after the editor did it, and says so in words", async () => {
    const { client, editor, runtime } = await openPage();

    editor.set("applied-then-lost");
    const write = pageAction(runtime, () => client.request("/api/notes", { method: "POST", body: { text: "keep" } }));
    await vi.advanceTimersByTimeAsync(1_000);
    editor.set("up");
    await vi.advanceTimersByTimeAsync(60_000);

    const outcome = await write;
    expect(outcome.ok).toBe(false);
    expect(editor.writes()).toEqual(["POST /api/notes"]);
    // Its followers still read it as a lost answer: its status and code are the transport's.
    expect(outcome.error.status).toBe(502);
    expect(outcome.error.code ?? null).toBe(null);
    expect(outcome.error.message).not.toMatch(STATUS_TEXT);
    expect(outcome.error.messageCode ?? "").not.toBe("http.request.failedWithStatus");
    expect(outcome.error.message).toMatch(/can't tell whether/iu);
  });

  it("keeps a write that waits for the editor within its own time limit, and never sends it after that", async () => {
    const { client, editor, runtime } = await openPage();

    editor.set("refused");
    void client.request("/api/sessions/status").catch(() => null);
    await vi.advanceTimersByTimeAsync(500);
    let settled = false;
    const write = pageAction(runtime, () => client.request("/api/presence", {
      method: "POST",
      body: { typing: true },
      timeoutMs: 5_000
    })).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe(true);
    editor.set("up");
    await vi.advanceTimersByTimeAsync(10_000);

    const outcome = await write;
    expect(outcome.ok).toBe(false);
    expect(outcome.error.message).toMatch(/wasn't done/iu);
    expect(outcome.error.message).not.toMatch(STATUS_TEXT);
    expect(editor.writes()).toEqual([]);
  });

  it("gives a read up after about a minute, in words, and leaves no further retries to its query", async () => {
    const { client, editor, runtime } = await openPage();

    editor.set("refused");
    let settled = false;
    const read = pageAction(runtime, () => client.request("/api/sessions/status")).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(55_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);

    const outcome = await read;
    expect(outcome.ok).toBe(false);
    expect(outcome.error.status).toBe(0);
    expect(outcome.error.message).not.toMatch(STATUS_TEXT);
    expect(outcome.error.messageCode ?? "").not.toBe("http.request.networkFailed");
    expect(shouldRetryTransientQueryFailure(0, outcome.error)).toBe(false);
  });

  it("reconnects a realtime socket that lost the editor as soon as the editor answers again, and refetches", async () => {
    const { client, editor } = await openPage();
    const { attachVibe64RealtimeQueryRecovery } = await import("../../packages/main/src/client/vibe64RealtimeQueries.js");
    const listeners = new Map();
    const socket = {
      connected: false,
      active: false,
      io: { reconnection: () => true },
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
      connect: vi.fn(() => {
        socket.connected = true;
        listeners.get("connect")?.();
      }),
      disconnect: vi.fn()
    };
    const invalidateQueries = vi.fn(async () => null);
    const detach = attachVibe64RealtimeQueryRecovery({ queryClient: { invalidateQueries }, realtime: { socket } });

    editor.set("refused");
    const read = client.request("/api/sessions/status");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(socket.connect).not.toHaveBeenCalled();
    editor.set("up");
    await vi.advanceTimersByTimeAsync(4_000);
    await read;

    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    detach();
  });
});
