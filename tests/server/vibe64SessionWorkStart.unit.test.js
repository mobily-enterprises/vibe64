// On 24 Nov 2026 a hosted workspace's Update session from main answered "Request failed with status 504." about a
// minute after it was pressed, while the Update of its connected repositories went on at the server: the Update ran
// inside its HTTP request, and the edge in front of the workspace ends a request after about a minute. Save ran the
// same way. The Save and Update buttons' requests now answer as soon as the work has started, the work runs to its
// end whatever becomes of the request, and a second press while one runs gets that one.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64ActionPolicy, registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { registerRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { createSessionsService } from "./vibe64SessionsTestHelpers.js";
import { findRegisteredRoute, testRouteApp, withRouteProject } from "./vibe64RouteTestHelpers.js";

const owner = { username: "owner", role: "owner" };
const SESSION_ID = "session-1";
const destinationReview = { sessionId: SESSION_ID, mode: "managed_git", repository: "example", branch: "main" };
// Long enough for any answer that comes at once; the work it waits for stays held until the test lets it go.
const ANSWER_WAIT_MS = 5_000;

/** A gate the stubbed work waits at until the test opens it. */
function gate() {
  const { promise, resolve } = Promise.withResolvers();
  return { open: resolve, promise };
}

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
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * The sessions service over an in-memory session store, with Save and Update stubbed at the terminals: each waits
 * for the agent-write lock (`lock`), records its start, reports a step, then holds (`work`) like the connected
 * repositories' Update did for minutes, before returning.
 */
function sessionWorkWorld() {
  const tasks = new Map();
  const metadata = new Map();
  const publications = [];
  const conversations = [];
  const calls = { save: 0, update: 0 };
  const gates = { save: { lock: gate(), work: gate() }, update: { lock: gate(), work: gate() } };
  const refusals = { save: null, update: null };
  const session = { agentRuns: [], metadata: {}, sessionId: SESSION_ID, status: "active" };
  const runtime = {
    async getSession() { return session; },
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    async listSessionSummaries() { return [session]; },
    store: {
      async listSessionConversations() { return conversations; },
      async readBackgroundTask(_sessionId, taskId) { return tasks.get(taskId) || null; },
      async readMetadataValue(_sessionId, name) { return metadata.get(name) ?? null; },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        const prior = input.reset === true ? { events: [], id: taskId } : tasks.get(taskId) || { events: [], id: taskId };
        const status = input.patch?.status || input.event?.status || prior.status;
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId,
          startedAt: status === "running" && prior.status !== "running" ? new Date().toISOString() : prior.startedAt,
          status
        };
        tasks.set(taskId, task);
        return task;
      },
      async writeMetadataValue(_sessionId, name, value) {
        metadata.set(name, value);
        session.metadata[name] = value;
      }
    }
  };
  async function runWork(kind, input, result) {
    calls[kind] += 1;
    await gates[kind].lock.promise;
    if (refusals[kind]) throw refusals[kind];
    await input.onRepositoryWriteAcquired();
    await input.onProgress(kind === "update"
      ? { kind: "connected", message: "Updating connected repositories.", stage: "connected-updating" }
      : { kind: "canonical-refreshed", message: "Canonical source refreshed." });
    await gates[kind].work.promise;
    return result;
  }
  const service = createSessionsService({
    project: {
      async createRuntimeWithoutSource() { return runtime; },
      async readCurrentProject() { return { slug: "unit_project", repository: { mode: "managed_git", defaultBranch: "main" } }; }
    },
    async publishSessionChanged(_sessionId, event) {
      publications.push(event.reason);
    },
    setupRunner: {
      isRunning: () => false,
      async start() {
        return { state: { status: "succeeded" }, completion: Promise.resolve({ status: "succeeded" }) };
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { ahead: 0, behind: 0, canonicalCommit: "canonical", sessionHead: "canonical", updateAvailable: false };
      },
      saveSessionWork: (_sessionId, input) => runWork("save", input, { reconciled: true, saveCommit: "saved-commit", status: "saved" }),
      updateSessionWork: (_sessionId, input) => runWork("update", input, {
        canonicalCommit: "canonical", reconciled: true, status: "updated", updatedPathCount: 0, updatedPaths: []
      })
    }
  });
  return { calls, conversations, gates, metadata, publications, refusals, service, tasks };
}

/** The sessions routes on a real Fastify server, over a real socket, as the browser reaches them. */
async function listen(service, { apiBase, apiRouteBase, projectContext }) {
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
  actions.register({ contributorId: "session-work", domain: "vibe64", actions: createSessionActions({ sessions: service })
    .map((action) => ({ ...action, channels: ["api", "automation"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => owner, authorizeProject: async () => {} });
  const app = testRouteApp();
  registerRoutes(app.http, { localhostCheckBypassed: true, projectContext });
  const server = Fastify();
  server.decorateRequest("executeAction", function executeAction({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
  });
  for (const suffix of ["/save", "/updates/apply"]) {
    const route = findRegisteredRoute(app, { method: "POST", path: `${apiRouteBase}/vibe64/sessions/:sessionId${suffix}` });
    server.post(route.path, route.handler);
  }
  await server.listen({ host: "127.0.0.1", port: 0 });
  const { port } = server.server.address();

  /**
   * Sends one POST; `answer` settles with its status and body, and `abort()` drops the connection, as the edge or a
   * closed tab does.
   */
  function post(suffix, body) {
    const payload = JSON.stringify(body);
    let request;
    const answer = new Promise((resolve, reject) => {
      request = http.request({
        headers: { "content-length": Buffer.byteLength(payload), "content-type": "application/json" },
        host: "127.0.0.1",
        method: "POST",
        path: `${apiBase}/vibe64/sessions/${SESSION_ID}${suffix}`,
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
    return { abort: () => request.destroy(), answer };
  }
  return { close: () => server.close(), post };
}

for (const kind of ["update", "save"]) {
  const suffix = kind === "update" ? "/updates/apply" : "/save";
  const taskId = kind === "update" ? "update-session" : "save-work";
  const body = kind === "update" ? { originId: "tab:test" } : { destinationReview, originId: "tab:test" };
  const outcome = kind === "update"
    ? { events: ["update-started", "connected", "updated"], progress: "session-update-progress", done: "session-update-completed" }
    : { events: ["save-started", "canonical-refreshed", "saved"], progress: "session-save-progress", done: "session-save-completed" };

  test(`the ${kind} request answers once it starts, and a second press gets the running one`, async () => {
    await withRouteProject(async (project) => {
      const world = sessionWorkWorld();
      const server = await listen(world.service, project);
      try {
        world.gates[kind].lock.open();
        const first = server.post(suffix, body);
        // The work is held past this answer, as the connected repositories' Update was past the edge's minute.
        const started = await within(first.answer, ANSWER_WAIT_MS, `the ${kind} request did not answer while its work ran`);
        assert.equal(started.status, 202, JSON.stringify(started.body));
        assert.equal(started.body.ok, true);
        assert.equal(started.body.running, true);
        const operationId = started.body.operationId;
        assert.ok(operationId);
        assert.equal(started.body.operation.operationId, operationId);
        assert.equal(started.body.operation.status, "running");
        assert.equal(world.tasks.get(taskId).status, "running");

        const again = await within(server.post(suffix, body).answer, ANSWER_WAIT_MS, "the second press did not answer");
        assert.equal(again.status, 202);
        assert.equal(again.body.operationId, operationId, "a second press gets the running one");
        assert.equal(again.body.operation.operationId, operationId);
        assert.equal(world.calls[kind], 1, `a second press starts no second ${kind}`);

        await eventually(() => world.publications.includes(outcome.progress), "each step is published as it happens");
        world.gates[kind].work.open();
        await eventually(() => world.tasks.get(taskId).status === "ready", `the ${kind} did not record its outcome`);
        const task = world.tasks.get(taskId);
        assert.equal(task.operationId, operationId);
        assert.deepEqual(task.events.map((event) => event.kind), outcome.events);
        assert.ok(world.publications.includes(outcome.done));
      } finally {
        world.gates[kind].lock.open();
        world.gates[kind].work.open();
        await server.close();
      }
    });
  });

  test(`a ${kind} whose request was dropped before it started still runs to its end and records it`, async () => {
    await withRouteProject(async (project) => {
      const world = sessionWorkWorld();
      const server = await listen(world.service, project);
      try {
        const first = server.post(suffix, body);
        const second = server.post(suffix, body);
        await eventually(() => world.calls[kind] >= 1, `the ${kind} did not reach the agent-write lock`);
        // While the first waits for the lock, a second press joins it; then the browser goes away.
        first.abort();
        await assert.rejects(first.answer);
        world.gates[kind].lock.open();
        const joined = await within(second.answer, ANSWER_WAIT_MS, "the press that joined did not answer");
        assert.equal(joined.status, 202);
        assert.equal(world.calls[kind], 1, `the press that joined starts no second ${kind}`);
        world.gates[kind].work.open();
        await eventually(() => world.tasks.get(taskId)?.status === "ready", `the dropped ${kind} did not run to its end`);
        assert.equal(world.tasks.get(taskId).operationId, joined.body.operationId);
        assert.deepEqual(world.tasks.get(taskId).events.map((event) => event.kind), outcome.events);
        if (kind === "update") assert.equal(world.metadata.get("canonical_commit"), "canonical");
        else assert.equal(world.metadata.get("canonical_commit"), "saved-commit");
      } finally {
        world.gates[kind].lock.open();
        world.gates[kind].work.open();
        await server.close();
      }
    });
  });

  test(`a ${kind} refused before it starts answers with that refusal, as before, and records nothing`, async () => {
    await withRouteProject(async (project) => {
      const world = sessionWorkWorld();
      const server = await listen(world.service, project);
      try {
        world.refusals[kind] = Object.assign(new Error("Another repository write is active."), {
          code: "vibe64_agent_write_mode_busy"
        });
        world.gates[kind].lock.open();
        const busy = await within(server.post(suffix, body).answer, ANSWER_WAIT_MS, "the refusal did not answer");
        assert.equal(busy.status, 409);
        assert.equal(busy.body.code, "vibe64_agent_write_mode_busy");
        assert.equal(busy.body.error, "Another repository write is active.");
        assert.equal(world.tasks.has(taskId), false);

        world.refusals[kind] = null;
        world.conversations.push({ conversationId: "fix", task: { active: true, repository: true, title: "Fix Update" } });
        const aiTask = await within(server.post(suffix, body).answer, ANSWER_WAIT_MS, "the AI task refusal did not answer");
        assert.equal(aiTask.status, 400);
        assert.equal(aiTask.body.code, "vibe64_ai_task_active");
        assert.equal(aiTask.body.error, "Fix Update is still running. Wait for it to finish first.");
        assert.equal(world.tasks.has(taskId), false);
        assert.equal(world.calls[kind], 1, "the AI task's refusal comes before the work is asked for");
      } finally {
        world.gates[kind].work.open();
        await server.close();
      }
    });
  });
}

test("the server's shutdown waits for an Update a button started to record its outcome, as it waited for its request", async () => {
  await withRouteProject(async (project) => {
    const world = sessionWorkWorld();
    const server = await listen(world.service, project);
    try {
      world.gates.update.lock.open();
      const started = await within(server.post("/updates/apply", { originId: "tab:test" }).answer, ANSWER_WAIT_MS,
        "the Update did not answer while its work ran");
      assert.equal(started.status, 202);
      let settled = false;
      const shutdown = world.service.settleStartedWork().then(() => { settled = true; });
      // Nothing to wait for would settle within this turn of the event loop.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "shutdown waits while the Update runs");
      world.gates.update.work.open();
      await within(shutdown, ANSWER_WAIT_MS, "shutdown did not end once the Update did");
      assert.equal(world.tasks.get("update-session").status, "ready");
    } finally {
      world.gates.update.work.open();
      await server.close();
    }
  });
});

test("the waiting Update, the one vibe64-helper and Fix Update run, still answers with its outcome", async () => {
  const world = sessionWorkWorld();
  world.gates.update.lock.open();
  world.gates.update.work.open();
  const result = await world.service.updateSessionWork(SESSION_ID, {});
  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.equal(result.updated.status, "updated");
  assert.equal(result.running, undefined);
});
