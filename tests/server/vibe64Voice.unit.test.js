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
import { Vibe64VoiceProvider } from "../../packages/vibe64-voice/src/server/Vibe64VoiceProvider.js";
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
  let realtime;
  if (delayAccess) {
    const { createSocketIoServer } = await import("@jskit-ai/realtime/server/runtime");
    realtime = createSocketIoServer({ fastify });
    fastify.addHook("preHandler", async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
  }
  await Vibe64VoiceProvider.setup({ env: { VIBE64_VOICE_ENDPOINT: `ws://127.0.0.1:${upstream.address().port}/v1/voice`, VIBE64_VOICE_ACCESS_TOKEN_FILE: tokenFile }, fastify,
    sessions: { async inspectSession(id) { inspections.push({ id, scope: currentProjectScopeKey() }); return inspection; } },
    actionCatalogue: { async execute(input) { actions.push(input); if (colleagueDenied) throw Object.assign(new Error("Denied"), { statusCode: 403, code: "voice_auth_required" }); } }
  }, {});
  await fastify.listen({ host: "127.0.0.1", port: 0 });
  const sockets = [];
  t.after(async () => { for (const socket of [...sockets, ...upstreams]) socket.terminate(); for (const socket of fastify.websocketServer.clients) socket.terminate(); await fastify.close(); realtime?.close(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); });
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

// Genuine new Learning URL; original contributor/action/proxy are exercised.
// Only the owning saved-context/session read is controlled at this unit boundary.
const learningVoiceAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherLearningVoiceAttempt = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function learningVoiceFixture(t, { inspection = { ok: true, sessionId: "learning-session" }, user = { uid: 42, username: "learner", role: "owner" }, ownerId = "42", denied = false } = {}) {
  const { createActionCatalogue } = await import("@jskit-ai/kernel/server/actions");
  const { createSessionActions, ACTION_INSPECT_SESSION } = await import("../../packages/vibe64-sessions/src/server/actions.js");
  const { registerVibe64ActionContext } = await import("../../packages/vibe64-core/src/server/actionContext.js");
  const { currentProjectRequestContext } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "learning-voice-"));
  const token = createVoiceAccessToken({ key: "0123456789abcdef0123456789abcdef", tenant: "fixture" });
  const tokenFile = path.join(root, "voice.token"); await writeFile(tokenFile, token);
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(upstream, "listening");
  const upstreams = [], inspections = [], authorizations = [], sockets = [];
  upstream.on("connection", (socket, request) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    upstreams.push(socket); socket.send(JSON.stringify({ type: "voice.ready" }));
  });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "actual-sessions", domain: "vibe64-sessions", actions: createSessionActions({
    sessions: { async inspectSession(id, input) { inspections.push({ id, input, scope: currentProjectRequestContext() }); return inspection; } }
  }).filter(action => action.id === ACTION_INSPECT_SESSION).map(action => ({ channels: ["api"], surfaces: ["app"], ...action })) });
  registerVibe64ActionContext(actions, {
    resolveUser: async () => user,
    authorizeProject() { assert.fail("Learning voice cannot authorize a Working project"); },
    async resolveLearningContext(input) {
      authorizations.push(input);
      if (denied || input.attemptId !== learningVoiceAttempt || input.sessionId !== "learning-session") {
        throw Object.assign(new Error("Saved Learning scope unavailable"), { code: "learning_scope_unavailable", statusCode: 403 });
      }
      return { learningScope: { learnerId: ownerId, attemptId: learningVoiceAttempt },
        projectRuntimeRoot: path.join(root, "learning-sessions", learningVoiceAttempt), systemRoot: root };
    }
  });
  const fastify = Fastify(); await fastify.register(websocket);
  await Vibe64VoiceProvider.setup({ env: { VIBE64_VOICE_ENDPOINT: `ws://127.0.0.1:${upstream.address().port}/v1/voice`, VIBE64_VOICE_ACCESS_TOKEN_FILE: tokenFile },
    fastify, sessions: { inspectSession() { assert.fail("No direct Working/session fallback"); } }, actionCatalogue: actions }, {});
  await fastify.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => {
    for (const socket of [...sockets, ...upstreams, ...fastify.websocketServer.clients]) socket.terminate();
    await fastify.close(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true });
  });
  return { inspections, authorizations, upstreams,
    async open({ attemptId = learningVoiceAttempt, sessionId = "learning-session", origin = `http://127.0.0.1:${fastify.server.address().port}` } = {}) {
      const socket = new WebSocket(`ws://127.0.0.1:${fastify.server.address().port}/api/learning/${encodeURIComponent(attemptId)}/vibe64/sessions/${encodeURIComponent(sessionId)}/voice/ws`, { headers: { origin } });
      sockets.push(socket);
      const messages = on(socket, "message", { signal: t.signal }); t.after(() => messages.return());
      const closed = once(socket, "close", { signal: t.signal }); void closed.catch(() => {});
      await once(socket, "open", { signal: t.signal });
      return { socket, messages, closed };
    }
  };
}

test("Learning voice uses canonical exact actor/attempt/session observation and the original ordered speech proxy", { timeout: 10000 }, async t => {
  const f = await learningVoiceFixture(t); const v = await f.open();
  assert.equal(JSON.parse((await v.messages.next()).value[0]).type, "voice.ready");
  assert.equal(f.authorizations.length, 1);
  assert.deepEqual(f.authorizations[0], { actor: { uid: 42, username: "learner", role: "owner" }, attemptId: learningVoiceAttempt, sessionId: "learning-session", access: "observe" });
  assert.equal(f.inspections.length, 1); assert.equal(f.inspections[0].id, "learning-session");
  assert.equal(f.inspections[0].scope.learningScope.attemptId, learningVoiceAttempt);
  assert.equal(f.inspections[0].scope.learningScope.learnerId, "42");
  assert.equal(f.inspections[0].scope.slug, undefined); assert.equal(f.inspections[0].scope.targetRoot, undefined);
  assert.equal(f.inspections[0].input.vibe64User.uid, 42);
  const forwarded = on(f.upstreams[0], "message", { signal: t.signal }); t.after(() => forwarded.return());
  const start = JSON.stringify({ type: "listen.start", turnId: "learning-one", sampleRate: 16000 });
  const pcm = Buffer.from([0, 0, 1, 0]); const stop = JSON.stringify({ type: "listen.stop", turnId: "learning-one" });
  for (const frame of [start, pcm, stop]) v.socket.send(frame);
  for (const [frame, binary] of [[start, false], [pcm, true], [stop, false]]) assert.deepEqual((await forwarded.next()).value, [Buffer.from(frame), binary]);
  const final = JSON.stringify({ type: "transcript.final", turnId: "learning-one", text: "Captured lesson words" });
  f.upstreams[0].send(final); assert.deepEqual((await v.messages.next()).value, [Buffer.from(final), false]);
  const upstreamClosed = once(f.upstreams[0], "close", { signal: t.signal });
  v.socket.close(1000, "Lesson voice finished"); assert.deepEqual(await upstreamClosed, [1000, Buffer.from("Lesson voice finished")]);
});

for (const [label, options, target, code] of [
  ["foreign owner", { ownerId: "other" }, {}, "vibe64_learning_scope_mismatch"],
  ["signed out", { user: null }, {}, "vibe64_auth_required"],
  ["revoked saved scope", { denied: true }, {}, "learning_scope_unavailable"],
  ["another attempt", {}, { attemptId: otherLearningVoiceAttempt }, "learning_scope_unavailable"],
  ["another session", {}, { sessionId: "other" }, "learning_scope_unavailable"],
  ["mismatched inspection", { inspection: { ok: true, sessionId: "other" } }, {}, "voice_session_unavailable"],
  ["failed inspection", { inspection: { ok: false, sessionId: "learning-session" } }, {}, "voice_session_unavailable"]
]) test(`Learning voice refuses ${label} before upstream access`, { timeout: 5000 }, async t => {
  const f = await learningVoiceFixture(t, options); const v = await f.open(target);
  assert.equal(JSON.parse((await v.messages.next()).value[0]).code, code);
  assert.equal((await v.closed)[0], 1008); assert.equal(f.upstreams.length, 0);
});

test("Learning voice checks the original socket origin before any saved scope or session read", { timeout: 5000 }, async t => {
  const f = await learningVoiceFixture(t); const v = await f.open({ origin: "https://foreign.example" });
  assert.equal(JSON.parse((await v.messages.next()).value[0]).code, "voice_auth_required");
  assert.equal((await v.closed)[0], 1008); assert.equal(f.authorizations.length, 0);
  assert.equal(f.inspections.length, 0); assert.equal(f.upstreams.length, 0);
});
