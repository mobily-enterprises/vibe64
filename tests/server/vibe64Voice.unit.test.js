import assert from "node:assert/strict";
import { once, on } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket, WebSocketServer } from "ws";
import { createVoiceAccessToken } from "@jskit-ai/assistant-voice/server";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import {
  Vibe64VoiceProvider,
  registerVoiceCatalogueRoute
} from "../../packages/vibe64-voice/src/server/Vibe64VoiceProvider.js";
import {
  ACTION_READ_VOICE_CATALOGUE,
  createVoiceActions
} from "../../packages/vibe64-voice/src/server/actions.js";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";

async function fixture(t, { inspection = { ok: true, sessionId: "session-one" }, colleagueDenied = false, delayAccess = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-voice-"));
  const context = configureStudioProjectContext({ explicitProjectsRoot: root, env: {}, home: root });
  await context.createWorkspaceProjectRecord({ slug: "one" });
  const token = createVoiceAccessToken({ key: "0123456789abcdef0123456789abcdef", tenant: "fixture" });
  const tokenFile = path.join(root, "voice.token"); await writeFile(tokenFile, token);
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(upstream, "listening");
  const upstreams = []; const upstreamRequests = []; const inspections = []; const actions = [];
  upstream.on("connection", (socket, request) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    upstreams.push(socket); upstreamRequests.push(request); socket.send(JSON.stringify({ type: "voice.ready" }));
  });
  const fastify = Fastify(); await fastify.register(websocket);
  const sockets = [];
  let realtime;
  t.after(async () => { for (const socket of [...sockets, ...upstreams]) socket.terminate(); for (const socket of fastify.websocketServer.clients) socket.terminate(); await fastify.close(); realtime?.close(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const actionCatalogue = createActionCatalogue();
  actionCatalogue.register({ contributorId: "fixture-colleague", domain: "vibe64-colleague", actions: [{
    id: "vibe64.colleague.state.read", kind: "query", input: { schema: createSchema({}) },
    channels: ["api"], surfaces: ["app"],
    async execute(input, context) {
      actions.push({ actionId: "vibe64.colleague.state.read", input, context });
      if (colleagueDenied) throw Object.assign(new Error("Denied"), { statusCode: 403, code: "voice_auth_required" });
      return { ok: true };
    }
  }] });
  if (delayAccess) {
    const { createSocketIoServer } = await import("@jskit-ai/realtime/server/runtime");
    realtime = createSocketIoServer({ fastify });
    fastify.addHook("preHandler", async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
  }
  await Vibe64VoiceProvider.setup({ env: { VIBE64_VOICE_ENDPOINT: `ws://127.0.0.1:${upstream.address().port}/v1/voice`, VIBE64_VOICE_ACCESS_TOKEN_FILE: tokenFile }, fastify,
    sessions: { async inspectSession(id) { inspections.push({ id, scope: currentProjectScopeKey() }); return inspection; } },
    actionCatalogue
  }, {});
  await fastify.listen({ host: "127.0.0.1", port: 0 });
  return { upstreams, upstreamRequests, inspections, actions,
    async open({ colleague = false, origin = `http://127.0.0.1:${fastify.server.address().port}`, slug = "one", sessionId = "session-one" } = {}) {
      const route = colleague ? "/api/vibe64/colleague/voice/ws" : `/api/app/${slug}/vibe64/sessions/${encodeURIComponent(sessionId)}/voice/ws`;
      const socket = new WebSocket(`ws://127.0.0.1:${fastify.server.address().port}${route}`, { headers: { origin } }); sockets.push(socket);
      const messages = on(socket, "message", { signal: t.signal }); t.after(() => messages.return());
      const closed = once(socket, "close", { signal: t.signal }); void closed.catch(() => {});
      await once(socket, "open", { signal: t.signal });
      return { socket, messages, closed };
    }
  };
}

test("voice catalogue HTTP reads dispatch through the canonical voice action", { timeout: 5000 }, async () => {
  let route = null;
  const calls = [];
  registerVoiceCatalogueRoute({
    get(pathname, handler) { route = { pathname, handler }; }
  }, {
    async execute(call) {
      calls.push(call);
      return [{ id: "voice-one", name: "Voice One" }];
    }
  });
  const request = { vibe64User: { uid: 42 } };
  assert.equal(route.pathname, "/api/vibe64/voice/voices");
  assert.deepEqual(await route.handler(request), [{ id: "voice-one", name: "Voice One" }]);
  assert.equal(calls[0].actionId, ACTION_READ_VOICE_CATALOGUE);
  assert.deepEqual(calls[0].input, {});
  assert.equal(calls[0].context.channel, "api");
  assert.equal(calls[0].context.surface, "app");
  assert.equal(calls[0].context.requestMeta.request, request);
});

test("canonical voice catalogue action preserves Colleague authorization before reading voices", { timeout: 5000 }, async () => {
  const context = { channel: "api", surface: "app", requestMeta: { request: { vibe64User: { uid: 42 } } },
    vibe64Action: { user: { uid: 42 } } };
  const calls = [];
  const [action] = createVoiceActions({
    actions: { async execute(call) { calls.push(call); return { ok: true }; } },
    voice: { async readCatalogue() { return [{ id: "voice-two" }]; } }
  });
  assert.equal(action.id, ACTION_READ_VOICE_CATALOGUE);
  assert.deepEqual(await action.execute({}, context), [{ id: "voice-two" }]);
  assert.deepEqual(calls, [{
    actionId: "vibe64.colleague.state.read",
    input: {},
    context: { channel: context.channel, surface: context.surface, requestMeta: context.requestMeta }
  }]);
  assert.equal(context.vibe64Action.user.uid, 42, "The caller's resolved authority remains intact.");
});

test("Colleague lists installed speaking voices by exact id, label and language only", () => {
  const [action] = createVoiceActions({ actions: { async execute() { return { ok: true }; } }, voice: { async readCatalogue() { return {}; } } });
  const tool = action.extensions.assistant;
  assert.equal(tool.exclude, undefined);
  assert.match(tool.description, /exact id.*British female voice.*changes nothing/su);
  assert.deepEqual(tool.transformResult({ defaultVoice: "bella", engine: "private-engine",
    voices: [{ id: "bella", label: "Bella (American female)", language: "en-us", path: "/private/model" }, { id: "george", label: "George (British male)" }] }),
  { defaultVoice: "bella", voices: [{ id: "bella", label: "Bella (American female)", language: "en-us" }, { id: "george", label: "George (British male)" }] });
});

test("public project voice checks exact session ownership and retains native proxy frame order", { timeout: 10000 }, async t => {
  const f = await fixture(t, { delayAccess: true });
  const v = await f.open();
  const [ready, readyIsBinary] = (await v.messages.next()).value;
  assert.equal(JSON.parse(ready).type, "voice.ready"); assert.equal(readyIsBinary, false);
  assert.equal(f.inspections[0].id, "session-one"); assert.ok(f.inspections[0].scope);
  assert.deepEqual(f.inspections.map(({ id }) => id), ["session-one"]);
  assert.equal(f.upstreams.length, 1);
  assert.equal(f.upstreamRequests[0].headers["sec-websocket-extensions"], undefined);
  assert.equal(v.socket.readyState, WebSocket.OPEN);
  const forwarded = on(f.upstreams[0], "message", { signal: t.signal }); t.after(() => forwarded.return());
  for (const bytes of [0, 3]) {
    v.socket.send(Buffer.alloc(bytes));
    const [raw, isBinary] = (await v.messages.next()).value;
    assert.equal(isBinary, false);
    assert.equal(JSON.parse(raw).code, "voice_audio_frame_invalid");
    assert.equal(v.socket.readyState, WebSocket.OPEN);
  }
  const start = JSON.stringify({ type: "listen.start", turnId: "one", sampleRate: 16000 });
  const pcm = Buffer.from([0, 0, 1, 0]); const stop = JSON.stringify({ type: "listen.stop", turnId: "one" });
  for (const frame of [start, pcm, stop]) v.socket.send(frame);
  for (const [frame, binary] of [[start, false], [pcm, true], [stop, false]]) assert.deepEqual((await forwarded.next()).value, [Buffer.from(frame), binary]);
  const reply = JSON.stringify({ type: "transcript.final", turnId: "one", text: "Native reply" });
  f.upstreams[0].send(reply); f.upstreams[0].send(pcm);
  assert.deepEqual((await v.messages.next()).value, [Buffer.from(reply), false]);
  assert.deepEqual((await v.messages.next()).value, [pcm, true]);
  f.upstreams[0].close(1012, "Speech service restarting"); assert.equal((await v.closed)[0], 1012);
  assert.deepEqual(await v.closed, [1012, Buffer.from("Speech service restarting")]);
});

test("native browser closure preserves its code and reason at the upstream connection", { timeout: 5000 }, async t => {
  const f = await fixture(t); const v = await f.open();
  await v.messages.next();
  const upstreamClosed = once(f.upstreams[0], "close", { signal: t.signal });
  v.socket.close(1000, "Browser finished");
  assert.deepEqual(await upstreamClosed, [1000, Buffer.from("Browser finished")]);
  assert.deepEqual(await v.closed, [1000, Buffer.from("Browser finished")]);
});

for (const [label, inspection] of [["mismatched", { ok: true, sessionId: "other" }], ["failed", { ok: false, sessionId: "session-one" }], ["unconfirmed", { sessionId: "session-one" }], ["missing inspected ID", { ok: true }]]) {
  test(`project voice refuses ${label} session inspection before upstream access`, { timeout: 5000 }, async t => {
    const f = await fixture(t, { inspection }); const v = await f.open();
    const [raw, isBinary] = (await v.messages.next()).value;
    assert.equal(isBinary, false);
    assert.equal(JSON.parse(raw).code, "voice_session_unavailable");
    assert.equal((await v.closed)[0], 1008); assert.equal(f.upstreams.length, 0);
    assert.deepEqual(f.inspections.map(({ id }) => id), ["session-one"]);
  });
}

test("project voice refuses an empty normalized requested session ID before upstream access", { timeout: 5000 }, async t => {
  const f = await fixture(t, { inspection: { ok: true, sessionId: "" } });
  const v = await f.open({ sessionId: " " });
  const [raw, isBinary] = (await v.messages.next()).value;
  assert.equal(isBinary, false);
  assert.equal(JSON.parse(raw).code, "voice_session_unavailable");
  assert.equal((await v.closed)[0], 1008); assert.equal(f.upstreams.length, 0);
  assert.deepEqual(f.inspections.map(({ id }) => id), [""]);
});

test("cross-origin sockets are rejected before any project or Colleague read", { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (const colleague of [false, true]) {
    const v = await f.open({ origin: "https://foreign.example", colleague });
    const [raw, isBinary] = (await v.messages.next()).value;
    assert.equal(isBinary, false);
    assert.equal(JSON.parse(raw).code, "voice_auth_required");
    assert.equal((await v.closed)[0], 1008);
  }
  assert.equal(f.inspections.length, 0); assert.equal(f.actions.length, 0); assert.equal(f.upstreams.length, 0);
});

test("Colleague uses its canonical action authorization independently of projects", { timeout: 5000 }, async t => {
  const f = await fixture(t); const v = await f.open({ colleague: true });
  assert.equal(JSON.parse((await v.messages.next()).value[0]).type, "voice.ready");
  assert.equal(f.actions[0].actionId, "vibe64.colleague.state.read"); assert.equal(f.inspections.length, 0);
});

test("revoked Colleague permission never opens a speech connection", { timeout: 5000 }, async t => {
  const f = await fixture(t, { colleagueDenied: true }); const v = await f.open({ colleague: true });
  assert.equal(JSON.parse((await v.messages.next()).value[0]).code, "voice_auth_required");
  assert.equal((await v.closed)[0], 1008); assert.equal(f.upstreams.length, 0);
});
