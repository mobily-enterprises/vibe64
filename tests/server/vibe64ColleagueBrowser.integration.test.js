import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createColleagueService } from "../../packages/vibe64-colleague/src/server/service.js";
import { createColleagueActions } from "../../packages/vibe64-colleague/src/server/actions.js";
import { io } from "socket.io-client";
import { createServer } from "../../server.js";

// Node exercises the installed API owner without loading unrelated Vue SFCs
// from the browser entry. Package resolution still selects its actual archive.
const { createAssistantApi } = await import(new URL("./lib/assistantApi.js",
  import.meta.resolve("@jskit-ai/assistant-core/client")));

const subscribeEvent = "assistant.conversation.subscribe";
const unsubscribeEvent = "assistant.conversation.unsubscribe";
const conversationEvent = "assistant.conversation.event";

function command(socket, event, input) {
  return new Promise((resolve, reject) => socket.timeout(5000).emit(event, input,
    (error, response) => error ? reject(error) : resolve(response)));
}

async function connect(socket) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Colleague Socket.IO connection timed out.")), 5000);
    const connected = () => finish();
    function finish(error) {
      clearTimeout(timer);
      socket.off("connect", connected);
      socket.off("connect_error", finish);
      if (error) reject(error);
      else resolve();
    }
    socket.once("connect", connected);
    socket.once("connect_error", finish);
    socket.connect();
  });
}

// Complements the original real-binding client and direct service assertions.
// Actual installed package discovery must supply the sole AssistantFeature;
// no provider registration, action, conversation or transport is substituted.
test("the installed Public Colleague shares its canonical HTTP and private realtime boundary before AI setup", { timeout: 30000 }, async t => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-colleague-browser-"));
  const systemRoot = path.join(temporaryRoot, "state");
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `colleague-browser-${process.pid}`;
  const httpFetch = globalThis.fetch.bind(globalThis);
  const inference = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Reading and stopping an unconfigured Colleague must not invoke account or model requests.");
  });
  const sockets = [];
  let app;
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    try {
      try { await app?.vibe64CapabilityRuntime?.shutdown(); }
      finally { await app?.close(); }
    } finally {
      if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
      else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
      await rm(temporaryRoot, { recursive: true, force: true });
      assert.equal(inference.mock.callCount(), 0);
    }
  });

  app = await createServer({
    managedSourceRoot: path.join(temporaryRoot, "managed"),
    projectsRoot: path.join(temporaryRoot, "projects"),
    systemRoot
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function request(url, options = {}) {
    const response = await httpFetch(`${origin}${url}`, {
      method: options.method || "GET", signal: options.signal || AbortSignal.timeout(5000),
      headers: { ...options.headers, Origin: origin,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message || value.error || `HTTP ${response.status}`), {
      statusCode: response.status, code: value.code
    });
    return value;
  }
  const api = createAssistantApi({ request,
    resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app" });
  function socketFor(header = origin) {
    const socket = io(origin, { autoConnect: false, forceNew: true, reconnection: false,
      transports: ["websocket"], extraHeaders: { Origin: header } });
    sockets.push(socket);
    return socket;
  }

  const product = await request("/api/vibe64/colleague?clientId=browser-integration");
  assert.equal(product.ok, true);
  assert.match(product.conversationId, /^colleague_[\w-]+$/u);
  assert.equal(product.assistantSelection, null);
  const id = product.conversationId;
  const initial = await api.readConversation(id);
  assert.equal(initial.id, id);
  assert.equal(initial.status, "ready");
  assert.deepEqual(initial.conversationLog, []);
  assert.equal(initial.configuration, undefined);
  assert.equal(initial.capabilities.goals, false);
  await assert.rejects(api.readConversation("colleague_another_private_scope"), { statusCode: 403 });

  const socket = socketFor();
  await connect(socket);
  const subscription = { subscriptionId: "colleague-view", conversationId: id,
    targetSurfaceId: "app", hostSurfaceId: "app" };
  const first = await command(socket, subscribeEvent, subscription);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.state.id, id);
  assert.deepEqual(first.state.conversationLog, []);
  const unknown = await command(socket, subscribeEvent, { ...subscription,
    subscriptionId: "unknown-view", conversationId: "colleague_another_private_scope" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 403);

  const foreign = socketFor("https://foreign.example");
  await connect(foreign);
  const foreignEvents = [];
  foreign.on(conversationEvent, event => foreignEvents.push(event));
  const denied = await command(foreign, subscribeEvent, { ...subscription,
    actor: { id: "1" }, request: { headers: { origin } }, requestPolicy: "authenticated",
    actionId: "assistant.conversation.subscribe", room: "clients" });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403, JSON.stringify(denied));

  const changed = once(socket, conversationEvent, { signal: AbortSignal.timeout(5000) });
  const stopped = await api.cancelConversation(id);
  assert.equal(stopped.ok, true);
  const [event] = await changed;
  assert.equal(event.conversationId, id);
  assert.equal(event.entityId, id);
  assert.equal(event.subscriptionId, subscription.subscriptionId);
  assert.equal(event.streamEpoch, first.streamEpoch);
  assert.equal(event.source, "assistant");
  assert.equal(event.entity, "conversation");
  assert.deepEqual(event.event, { type: "application", interimReply: null });
  assert.equal(Object.hasOwn(event, "actorId"), false, "Local history must not acquire a fabricated hosted actor");
  assert.equal(Object.hasOwn(event, "scope"), false);
  assert.equal(Object.hasOwn(event, "navigation"), false, "Product navigation is read by its initiating browser");
  assert.equal((await request("/api/vibe64/colleague?clientId=browser-integration")).status, "interrupted");

  assert.deepEqual(await command(socket, unsubscribeEvent, { subscriptionId: subscription.subscriptionId }), { ok: true });
  socket.disconnect();
  await connect(socket);
  const reconnected = await command(socket, subscribeEvent, subscription);
  assert.equal(reconnected.ok, true, JSON.stringify(reconnected));
  assert.equal(reconnected.state.id, id);
  assert.notEqual(reconnected.streamEpoch, first.streamEpoch);
  assert.deepEqual(reconnected.state.conversationLog, []);
  const nextChange = once(socket, conversationEvent, { signal: AbortSignal.timeout(5000) });
  await api.cancelConversation(id);
  const [nextEvent] = await nextChange;
  assert.equal(nextEvent.streamEpoch, reconnected.streamEpoch);
  assert.equal(nextEvent.event.type, "application");
  assert.equal(foreignEvents.length, 0, "A rejected foreign subscriber must not receive the local conversation's events");

  const localKey = Buffer.from("local").toString("base64url");
  assert.deepEqual(await readdir(path.join(systemRoot, "colleague")), [localKey]);
  const saved = JSON.parse(await readFile(path.join(systemRoot, "colleague", localKey, "conversation.json"), "utf8"));
  assert.equal(saved.scopeId, id);
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.assistantSelection, null);
  assert.equal(saved.conversationMetadata?.runtime, undefined, "Browser opening must not initialize an AI runtime");
  assert.deepEqual(saved.conversationLog, []);
  assert.deepEqual((await api.readConversation(id)).conversationLog, []);
});

// Keep the installed standalone integration above intact. This cookie-authorized
// facade case uses an actual Fastify request without invoking any AI account.
test("Colleague browser facade retains Fastify cookie headers and revalidates logout", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "colleague-cookie-browser-"));
  const app = Fastify();
  const actions = createActionCatalogue();
  const user = { username: "cookie-owner", uid: 42, role: "owner" };
  const cookie = "fixture-session=owner-session";
  let signedIn = true;
  let browser;
  let id;
  registerVibe64ActionContext(actions, {
    resolveUser: async ({ request }) => signedIn && request?.headers?.cookie === cookie ? user : null,
    authorizeProject() { assert.fail("Colleague reading must not authorize a project."); }
  });
  const service = createColleagueService({ actions, accounts: {}, terminals: {}, systemRoot: root });
  t.after(async () => {
    try { await app.close(); }
    finally { try { await service.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  });
  actions.register({ contributorId: "cookie-colleague", domain: "colleague",
    actions: createColleagueActions(service).map(definition => ({ channels: ["api", "internal"], surfaces: ["app"], ...definition })) });
  app.get("/conversation", async request => {
    assert.equal(Object.hasOwn(request, "headers"), false, "Exercise Fastify's inherited header getter");
    request.vibe64User = user;
    const context = { channel: "api", surface: "app", requestMeta: { request } };
    const product = await actions.execute({ actionId: "vibe64.colleague.state.read", input: {}, context });
    id = product.conversationId;
    browser = await service.browserConversations.open({ id, context });
    return browser.read();
  });
  const response = await app.inject({ method: "GET", url: "/conversation", headers: { cookie } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().id, id);
  assert.equal(response.json().status, "ready");
  assert.deepEqual(response.json().conversationLog, []);
  assert.equal((await browser.read()).id, id);
  signedIn = false;
  await assert.rejects(browser.read(), { statusCode: 401 });
  await assert.rejects(browser.cancel(), { statusCode: 401 });
  const denied = await app.inject({ method: "GET", url: "/conversation", headers: { cookie } });
  assert.equal(denied.statusCode, 401, denied.body);
});
