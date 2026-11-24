// On 24 Nov 2026, about 55 minutes after a hosted workspace's server restarted, a message sent in a session that
// was preparing its workspace again ("Keep connected JSKIT AI in effect (npm)") showed "Request failed with status
// 504." with Retry and Cancel: the send waited inside its HTTP request for the whole preparation
// (sessionMessages.js, setupRunner.wait), the edge in front of the workspace ends a request after a minute, and the
// message was delivered about 90 s after it was sent, once the preparation ended. A send now answers at once with
// the message held while it waits, its delivery runs on, a second send of the same message joins that delivery, and
// the message's delivery check says what it waits for and, once it ends, how it ended.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64ActionPolicy, registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { registerRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { createSessionsService } from "./vibe64SessionsTestHelpers.js";
import { findRegisteredRoute, testRouteApp, withRouteProject } from "./vibe64RouteTestHelpers.js";

const owner = { username: "owner", role: "owner" };
const SESSION_ID = "session-1";
// Far below the edge's minute, and long enough for any answer that comes at once.
const ANSWER_WAIT_MS = 5_000;

function within(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function eventually(check, message) {
  const deadline = Date.now() + ANSWER_WAIT_MS;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * The sessions service over an in-memory session, with the terminals stubbed: the workspace preparation runs until
 * the test ends it (`preparation`), and the assistant's delivery answers at once (`deliver`).
 */
function messageWorld({ preparing = true, deliver = async (input) => ({ ok: true, delivered: true, messageId: input.messageId }) } = {}) {
  const session = { agentRuns: [], metadata: {}, sessionId: SESSION_ID, status: "active" };
  const runtime = {
    async getSession() { return session; },
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    store: {}
  };
  const preparation = Promise.withResolvers();
  const state = { preparing };
  const delivered = [];
  const publications = [];
  const service = createSessionsService({
    project: { async createRuntimeWithoutSource() { return runtime; } },
    async publishSessionChanged(_sessionId, event) { publications.push(event.reason); },
    terminals: {
      async openBrowserConversation() {
        return { async inspectDelivery({ messageId }) { return { status: "unknown", messageId }; } };
      },
      async sendAgentMessage(sessionId, input, options) {
        delivered.push({ sessionId, input, options });
        return deliver(input, options);
      },
      waitForWorkspaceSetup: () => state.preparing ? preparation.promise : null,
      workspaceSetupIsRunning: () => state.preparing
    }
  });
  function finishPreparation() {
    state.preparing = false;
    preparation.resolve({ status: "succeeded" });
  }
  return { delivered, finishPreparation, publications, service };
}

/** The sessions routes on a real Fastify server, over a real socket, as the browser reaches them. */
async function listen(service, { apiBase, apiRouteBase, projectContext, slug }) {
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
  actions.register({ contributorId: "session-messages", domain: "vibe64", actions: createSessionActions({ sessions: service })
    .map((action) => ({ ...action, channels: ["api", "automation", "internal"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => owner, authorizeProject: async () => {} });
  const app = testRouteApp();
  registerRoutes(app.http, { localhostCheckBypassed: true, projectContext });
  const server = Fastify();
  server.decorateRequest("executeAction", function executeAction({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
  });
  const route = findRegisteredRoute(app, { method: "POST", path: `${apiRouteBase}/vibe64/sessions/:sessionId/agent-message` });
  server.post(route.path, route.handler);
  // The Main conversation's delivery check, as the assistant route's inspect reaches it.
  const conversationId = mainConversationId({ projectSlug: slug, sessionId: SESSION_ID });
  server.post("/inspect/:messageId", async (request) => {
    const conversation = await service.browserConversations.open({
      id: conversationId,
      context: { channel: "api", surface: "app", requestMeta: { request } }
    });
    return conversation.inspectDelivery({ messageId: request.params.messageId });
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const { port } = server.server.address();

  function post(path, body) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = http.request({
        headers: { "content-length": Buffer.byteLength(payload), "content-type": "application/json" },
        host: "127.0.0.1",
        method: "POST",
        path,
        port
      }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { text += chunk; });
        response.on("end", () => resolve({ body: JSON.parse(text), status: response.statusCode }));
      });
      request.on("error", reject);
      request.end(payload);
    });
  }
  return {
    close: () => server.close(),
    inspect: (messageId) => post(`/inspect/${messageId}`, {}),
    send: (body) => post(`${apiBase}/vibe64/sessions/${SESSION_ID}/agent-message`, body)
  };
}

test("a message sent while the workspace is prepared answers at once, held, and is delivered once when it ends", async (t) => {
  await withRouteProject(async (project) => {
    const world = messageWorld();
    const server = await listen(world.service, project);
    const message = { message: "Fix the login page", messageId: "message_tab_held_1" };
    try {
      const sentAt = Date.now();
      const first = await within(server.send(message), ANSWER_WAIT_MS,
        "the send did not answer while the workspace was being prepared");
      const answeredMs = Date.now() - sentAt;
      t.diagnostic(`the send arrived while preparing and answered ${first.status} after ${answeredMs} ms`);
      assert.ok(first.status < 300, JSON.stringify(first.body));
      assert.ok(answeredMs < ANSWER_WAIT_MS);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.status, "queued");
      assert.equal(first.body.waitingFor, "workspace-preparation");
      assert.equal(first.body.messageId, message.messageId);
      assert.equal(world.delivered.length, 0, "the message waits for the preparation before it reaches the assistant");

      const check = await within(server.inspect(message.messageId), ANSWER_WAIT_MS, "the delivery check did not answer");
      assert.deepEqual(check.body, { status: "pending", messageId: message.messageId, waitingFor: "workspace-preparation" });

      // Retry, or a reload's Retry, while the first send still waits: it joins that send.
      const again = await within(server.send(message), ANSWER_WAIT_MS, "the second send did not answer");
      assert.equal(again.body.status, "queued");
      assert.equal(world.delivered.length, 0);

      const preparedAt = Date.now();
      world.finishPreparation();
      await eventually(() => world.delivered.length === 1, "the held message was not delivered after the preparation");
      t.diagnostic(`the held message reached the assistant ${Date.now() - preparedAt} ms after the preparation ended`);
      assert.equal(world.delivered[0].input.messageId, message.messageId);
      assert.equal(world.delivered[0].input.message, message.message);
      assert.equal(world.delivered[0].options.browserAuthority.sessionId, SESSION_ID);
      await eventually(() => world.publications.includes("session-agent-message-accepted"), "the delivery was not announced");
      const settled = await server.inspect(message.messageId);
      assert.deepEqual(settled.body, { status: "accepted", messageId: message.messageId });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(world.delivered.length, 1, "two sends of one message reach the assistant once");
    } finally {
      world.finishPreparation();
      await server.close();
    }
  });
});

test("a held message the assistant refuses reports that refusal to its delivery check", async () => {
  await withRouteProject(async (project) => {
    const world = messageWorld({
      deliver: async () => {
        throw Object.assign(new Error("Resolve or cancel the pending request before sending another."), {
          code: "vibe64_assistant_routing_request_unresolved", delivery: "not-sent", statusCode: 409
        });
      }
    });
    const server = await listen(world.service, project);
    try {
      const held = await within(server.send({ message: "Add a footer", messageId: "message_tab_held_2" }), ANSWER_WAIT_MS,
        "the send did not answer while the workspace was being prepared");
      assert.equal(held.body.status, "queued");
      world.finishPreparation();
      await eventually(() => world.delivered.length === 1, "the held message was not delivered after the preparation");
      const check = await eventually(async () => {
        const { body } = await server.inspect("message_tab_held_2");
        return body.status === "pending" ? null : body;
      }, "the held message's delivery did not end");
      assert.deepEqual(check, {
        status: "not-sent",
        messageId: "message_tab_held_2",
        error: "Resolve or cancel the pending request before sending another.",
        code: "vibe64_assistant_routing_request_unresolved"
      });
    } finally {
      world.finishPreparation();
      await server.close();
    }
  });
});

test("a message sent to a prepared workspace answers with its delivery, as before", async () => {
  await withRouteProject(async (project) => {
    const world = messageWorld({ preparing: false });
    const server = await listen(world.service, project);
    try {
      const sent = await within(server.send({ message: "Hello", messageId: "message_tab_prepared_1" }), ANSWER_WAIT_MS,
        "the send did not answer");
      assert.equal(sent.body.ok, true);
      assert.equal(sent.body.delivered, true);
      assert.notEqual(sent.body.status, "queued");
      assert.equal(world.delivered.length, 1);
    } finally {
      await server.close();
    }
  });
});

test("an editor stopping while a held message waits refuses it, unsent, and its delivery check says so", async () => {
  await withRouteProject(async (project) => {
    const world = messageWorld();
    const server = await listen(world.service, project);
    try {
      const held = await within(server.send({ message: "Add a footer", messageId: "message_tab_held_3" }), ANSWER_WAIT_MS,
        "the send did not answer while the workspace was being prepared");
      assert.equal(held.body.status, "queued");
      await within(world.service.closeHeldMessages(), ANSWER_WAIT_MS, "the stopping editor waited for the preparation");
      const { body } = await server.inspect("message_tab_held_3");
      assert.equal(body.status, "not-sent");
      assert.equal(body.code, "vibe64_agent_message_server_restarting");
      assert.equal(world.delivered.length, 0, "a message the editor stopped holding never reaches the assistant");
    } finally {
      world.finishPreparation();
      await server.close();
    }
  });
});

test("held messages deliver each message once, answer a quick delivery with its result and forget an old outcome", async () => {
  const { createHeldMessages } = await import("../../packages/vibe64-sessions/src/server/heldMessages.js");
  const logged = [];
  const logger = { debug() {}, error() {}, info: (fields) => logged.push(fields), warn: (fields) => logged.push(fields),
    child() { return logger; } };
  const held = createHeldMessages({ logger, answerMs: 20, outcomeMs: 60 });
  const release = Promise.withResolvers();
  let starts = 0;
  const slow = async ({ stage }) => { starts += 1; stage("workspace-preparation"); await release.promise; return { ok: true, delivered: true }; };
  try {
    assert.deepEqual(await held.send("s1", "m1", slow), {
      ok: true, delivered: false, status: "queued", messageId: "m1", sessionId: "s1", waitingFor: "workspace-preparation"
    });
    assert.equal((await held.send("s1", "m1", slow)).status, "queued");
    assert.equal(starts, 1, "a second send of a held message joins its delivery");
    // Another session's message of the same id is its own.
    assert.equal((await held.send("s2", "m1", slow)).status, "queued");
    assert.equal(starts, 2);
    release.resolve();
    await eventually(() => held.inspect("s1", "m1")?.status === "accepted", "the held delivery did not settle");
    const timing = logged.find(({ event, sessionId }) => event === "vibe64.agent_message.send_timing" && sessionId === "s1");
    assert.equal(timing.held, true);
    assert.ok(Number.isFinite(timing.stages["workspace-preparation"]) && Number.isFinite(timing.stages.finished));
    assert.ok(timing.receivedAt);

    assert.deepEqual(await held.send("s1", "quick", async () => ({ ok: true, delivered: true })), { ok: true, delivered: true });
    const refusal = Object.assign(new Error("Refused"), { code: "refused", delivery: "not-sent" });
    await assert.rejects(held.send("s1", "refused", async () => { throw refusal; }), refusal);
    // A Retry after a refusal delivers again.
    assert.deepEqual(await held.send("s1", "refused", async () => ({ ok: true, delivered: true })), { ok: true, delivered: true });

    await eventually(() => held.inspect("s1", "m1") === null, "an old outcome was kept");
  } finally {
    release.resolve();
    await held.close();
  }
});
