import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { RealtimeProvider } from "@jskit-ai/realtime/server/RealtimeProvider";
import { io as connect } from "socket.io-client";
import { registerVibe64ActionContext } from "../../packages/vibe64-core/src/server/actionContext.js";
import { createSessionChangedPublisher } from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";

const FULL = "vibe64.session.changed";
const SUMMARY = "vibe64.session.summary.changed";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recordingEvents() {
  const published = [];
  return { published, events: { async publish(event) { published.push(event); return event; } } };
}

const turnIdle = {
  reason: "claude-stream-turn-idle",
  payload: {
    agentRun: { active: false, runId: "run-1", startedAt: "2026-10-29T00:00:00.000Z" },
    agentSession: { thread: { id: "thread-1" }, turn: { active: false, id: "turn-1", items: ["x".repeat(4000)] } },
    conversationStream: null
  },
  session: { sessionId: "s1", projectSlug: "alpha", revision: 7, status: "active" }
};

// Every session change used to reach every connected browser, including each
// streamed assistant delta with its whole text so far.
test("a session change reaches its viewers in full and its project's pages as a small summary", async () => {
  const { events, published } = recordingEvents();
  await createSessionChangedPublisher(events)("s1", turnIdle);
  assert.deepEqual(published.map(({ type, realtime }) => [type, realtime.event, realtime.audience]), [
    ["entity.changed", FULL, { room: "vibe64:project:alpha:session:s1" }],
    ["entity.summary", SUMMARY, { room: "vibe64:project:alpha:sessions" }]
  ]);
  assert.deepEqual(published[0].realtime.payload.agentSession, turnIdle.payload.agentSession);
  assert.deepEqual(published[1].realtime.payload, {
    sessionId: "s1",
    revision: 7,
    status: "active",
    projectSlug: "alpha",
    reason: "claude-stream-turn-idle",
    agentSession: { turn: { active: false } },
    agentRun: { active: false }
  }, "the summary names the session, its state and its turn activity only");
});

test("streamed work reaches only the session's viewers", async () => {
  const { events, published } = recordingEvents();
  const publish = createSessionChangedPublisher(events);
  for (const reason of ["claude-stream-message", "codex-app-server-live-progress", "output-target-ready"]) {
    await publish("s1", { reason, session: { sessionId: "s1", projectSlug: "alpha" } });
  }
  assert.deepEqual(published.map(({ realtime }) => [realtime.event, realtime.audience.room]),
    Array(3).fill([FULL, "vibe64:project:alpha:session:s1"]));
});

// Viewers receive a conversation's live text and transcript through its
// conversation subscription. The application change carried them again, the
// whole streamed text so far with every delta, and no page read them there.
test("a session change never carries the conversation's stream or transcript", async () => {
  const { events, published } = recordingEvents();
  await createSessionChangedPublisher(events)("s1", {
    reason: "claude-stream-message",
    payload: {
      conversationLogPatch: { type: "upsert-turn", turn: { turnId: "t1", text: "x".repeat(4000) } },
      conversationStream: { revision: 3, messages: [{ text: "y".repeat(4000) }] }
    },
    session: { sessionId: "s1", projectSlug: "alpha", revision: 4 }
  });
  assert.deepEqual(published.map(({ realtime }) => realtime.payload), [{
    sessionId: "s1", revision: 4, projectSlug: "alpha", clientRefresh: { includeAccess: false }, reason: "claude-stream-message"
  }]);
});

test("a streamed delta is not a session change", async () => {
  const { events, published } = recordingEvents();
  const publish = createSessionChangedPublisher(events);
  assert.equal(await publish("s1", { reason: "assistant-stream", payload: { conversationStream: { text: "Hel" } },
    session: { sessionId: "s1", projectSlug: "alpha" } }), null);
  assert.deepEqual(published, [], "its subscribers receive the delta natively; no page reads it as a change");
});

// Work that outlives its request, such as Preview cleanup or a browser test
// after a restart, publishes outside any project context. It names its
// session's project itself, so the session's viewers still receive it.
const viewersOf = (published) => published.filter(({ type }) => type === "entity.changed").map(({ realtime }) => realtime.audience);

test("a Preview change made outside any request reaches the session's viewers", async (t) => {
  const { events, published } = recordingEvents();
  const { createOutputTargetTerminalController } = await import("../../packages/vibe64-terminals/src/server/outputTargetTerminal.js");
  const sessionId = `preview-${crypto.randomUUID()}`;
  const store = { async mutateSession(_id, update) { return update(); }, async writeMetadataValue() {} };
  const controller = createOutputTargetTerminalController({
    // Outside a request, the project service still knows the project it holds.
    projectService: { currentProjectSlug: () => "alpha", async createRuntime() { return { store }; } },
    publishSessionChanged: createSessionChangedPublisher(events),
    stopPreviewBrowsers: () => ({ ok: true })
  });
  t.after(() => controller.close());
  assert.equal((await controller.stopTerminal(sessionId, "")).ok, true);
  await delay(0);
  assert.deepEqual(viewersOf(published), [{ room: `vibe64:project:alpha:session:${sessionId}` }]);
});

test("a browser test's change made outside any request reaches the session's viewers", async () => {
  const { events, published } = recordingEvents();
  const { createAgentPreviewCommandService } = await import("../../packages/vibe64-terminals/src/server/agentPreviewCommand.js");
  const service = createAgentPreviewCommandService({
    launchTarget: { previewTestRunAdmission: () => null },
    projectService: {},
    publishSessionChanged: createSessionChangedPublisher(events)
  });
  // The assistant's start registers its browser inside the session's project.
  service.registerBrowserWorker("s1", { socketPath: "/tmp/v64-browser.sock", token: "t1", project: { slug: "alpha" } });
  const result = await service.playwrightRun("s1", { browserSocketPath: "/tmp/v64-browser.sock" });
  assert.equal(result.code, "vibe64_managed_browser_runtime_invalid");
  assert.deepEqual(viewersOf(published), [{ room: "vibe64:project:alpha:session:s1" }]);
});

test("pages receive only the changes of the projects and sessions they watch", { timeout: 30_000 }, async (t) => {
  // Imported here so that the publisher tests above stand on their own.
  const [{ PROJECT_WATCH, PROJECT_WATCH_RELEASE }, { Vibe64RepositoryUpdatesProvider }] = await Promise.all([
    import("../../packages/vibe64-sessions/src/shared/projectWatch.js"),
    import("../../packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js")
  ]);
  const probes = [];
  const httpServer = createServer((_request, response) => { response.statusCode = 404; response.end(); });
  let events;
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.config": {}, "runtime.env": {}, "runtime.fastify": { server: httpServer },
      "runtime.logger": { debug() {}, warn() {}, info() {}, error() {} },
      "vibe64.sessions": { async probeRepositoryUpdates(slug) { probes.push(slug); return { failed: false, inUse: false }; } }
    },
    providers: [EventProvider, createActionProvider(), RealtimeProvider, Vibe64RepositoryUpdatesProvider, defineProvider({
      id: "test.action-context", requires: { actions: "runtime.actions", events: "runtime.events" },
      setup(values) {
        events = values.events;
        registerVibe64ActionContext(values.actions, {
          projectContext: { projectsRoot: "/fixture", readWorkspaceProject: async ({ slug }) => ({ project: { path: `/fixture/${slug}` } }) },
          resolveUser: async () => ({ uid: 1, role: "owner" }),
          authorizeProject() {}
        });
        return {};
      }
    })]
  });
  await runtime.start();
  t.after(() => runtime.shutdown());
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  t.after(() => new Promise((resolve) => httpServer.close(resolve)));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  // One person's three tabs: one shows session s1 of alpha, one alpha's other
  // work, and one a page outside alpha.
  const tabs = {};
  const received = {};
  for (const name of ["viewer", "list", "elsewhere"]) {
    const socket = connect(url, { transports: ["websocket"], reconnection: false });
    tabs[name] = socket;
    received[name] = [];
    t.after(() => socket.disconnect());
    socket.on(FULL, (payload) => received[name].push([FULL, payload]));
    socket.on(SUMMARY, (payload) => received[name].push([SUMMARY, payload]));
    await once(socket, "connect");
  }
  const watch = (name, input) => new Promise((resolve) => tabs[name].emit(PROJECT_WATCH, input, resolve));
  assert.deepEqual(await watch("viewer", { watchId: "project", projectSlug: "alpha" }), { ok: true });
  assert.deepEqual(await watch("viewer", { watchId: "session", projectSlug: "alpha", sessionId: "s1" }), { ok: true });
  assert.deepEqual(await watch("list", { watchId: "project", projectSlug: "alpha" }), { ok: true });
  assert.deepEqual(await watch("elsewhere", { watchId: "project", projectSlug: "beta" }), { ok: true });
  await delay(50);
  assert.deepEqual(probes.sort(), ["alpha", "beta"], "a session watch starts no probe");

  const publish = createSessionChangedPublisher(events);
  const reasons = () => Object.fromEntries(Object.entries(received).map(([name, list]) =>
    [name, list.map(([event, payload]) => `${event === FULL ? "full" : "summary"}:${payload.reason}`)]));
  await publish("s1", { reason: "codex-app-server-live-progress", session: { sessionId: "s1", projectSlug: "alpha" } });
  await publish("s1", turnIdle);
  await publish("s2", { reason: "session-renamed", session: { sessionId: "s2", projectSlug: "alpha", revision: 3 } });
  await delay(100);
  assert.deepEqual(reasons(), {
    viewer: ["full:codex-app-server-live-progress", "full:claude-stream-turn-idle", "summary:claude-stream-turn-idle", "summary:session-renamed"],
    list: ["summary:claude-stream-turn-idle", "summary:session-renamed"],
    elsewhere: []
  });

  tabs.viewer.emit(PROJECT_WATCH_RELEASE, { watchId: "session" });
  await delay(50);
  for (const list of Object.values(received)) list.length = 0;
  await publish("s1", { reason: "codex-app-server-live-progress", session: { sessionId: "s1", projectSlug: "alpha" } });
  await publish("s1", { reason: "session-renamed", session: { sessionId: "s1", projectSlug: "alpha", revision: 8 } });
  await delay(100);
  assert.deepEqual(reasons(), {
    viewer: ["summary:session-renamed"],
    list: ["summary:session-renamed"],
    elsewhere: []
  }, "a released session watch receives only its project's summaries");
});
