import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/server/codex-client";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { CodexAppServerAgentProvider } from "@local/vibe64-runtime/server/codexAppServerProvider";

function harness({ status = "idle", historyMode = "paginated", goal = null, stayLoaded = false, beforeUnsubscribe = async () => {} } = {}) {
  const calls = [];
  const logs = [];
  let environment = { MARKER: "A", PRIVATE_VALUE: "must-not-be-logged" };
  let loadedEnvironment = { ...environment };
  const client = { async request(method, params) {
    calls.push({ method, params });
    if (method === "account/read") return { account: { type: "chatgpt" } };
    if (method === "thread/read") return { thread: { id: "thread-1", status, historyMode } };
    if (method === "thread/goal/get") return { goal: goal && { ...goal } };
    if (method === "thread/goal/set") {
      goal = { ...goal, status: params.status, updatedAt: goal.updatedAt + 1 };
      return { goal: { ...goal } };
    }
    if (method === "thread/turns/list") return { data: [{ id: "turn-1", status: "inProgress" }] };
    if (method === "turn/interrupt") { status = "idle"; return {}; }
    if (method === "thread/unsubscribe") {
      await beforeUnsubscribe();
      if (!stayLoaded) status = "notLoaded";
      return { status: stayLoaded ? "retained" : "unsubscribed" };
    }
    if (method === "thread/resume") {
      if (status === "notLoaded") loadedEnvironment = params.config.shell_environment_policy.set;
      status = "idle";
      return { thread: { id: "thread-1", status } };
    }
    if (method === "thread/start") {
      loadedEnvironment = params.config.shell_environment_policy.set;
      return { thread: { id: "thread-1", status } };
    }
    if (method === "turn/start") return { turn: { id: "turn-2" } };
    throw new Error(`Unexpected RPC ${method}`);
  } };
  const provider = new CodexAppServerAgentProvider({
    threadEnv: environment,
    threadControlTimeoutMs: 500,
    logger: { info: (fields) => logs.push(fields) },
    prepareThreadEnvironment: async () => ({ ...environment })
  });
  provider.activeClient = async () => client;
  return { provider, client, calls, logs, rotate: () => { environment = { ...environment, MARKER: "B" }; },
    get environment() { return loadedEnvironment; }, get goal() { return goal; } };
}

const activeGoal = { status: "active", objective: "Finish the application", createdAt: 10, updatedAt: 20,
  tokenBudget: 10000, tokensUsed: 123, timeUsedSeconds: 45 };

test("an unverified loaded thread is cold-resumed with current controls, without replacing its identity", async () => {
  const h = harness();
  h.rotate();
  const result = await h.provider.resumeThread("thread-1", { cwd: "/project" });
  assert.equal(result.id, "thread-1");
  assert.equal(h.environment.MARKER, "B");
  assert.equal(h.calls.filter((call) => call.method === "thread/unsubscribe").length, 1);
  assert.equal(h.calls.filter((call) => call.method === "thread/resume").length, 1);
  assert.ok(!JSON.stringify(h.logs).includes("must-not-be-logged"));
});

test("repeated reconnect checks preserve healthy work and coalesce a changed environment into one reload", async () => {
  const h = harness();
  await h.provider.startThread();
  h.calls.length = 0;
  await Promise.all(Array.from({ length: 4 }, () => h.provider.ensureThreadControls("thread-1")));
  assert.ok(h.calls.every((call) => call.method === "thread/read"));
  h.rotate();
  await Promise.all(Array.from({ length: 4 }, () => h.provider.ensureThreadControls("thread-1")));
  assert.equal(h.environment.MARKER, "B");
  assert.equal(h.calls.filter((call) => call.method === "thread/unsubscribe").length, 1);
});

test("a replaced history adapter rebinds the same thread once without replaying work", async () => {
  const h = harness();
  h.provider.runtime = { historyAdapterBaseUrl: "http://127.0.0.1:12345/old-runtime" };
  await h.provider.startThread();
  h.calls.length = 0;
  h.provider.runtime = { historyAdapterBaseUrl: "http://127.0.0.1:23456/new-runtime" };
  await h.provider.ensureThreadControls("thread-1");
  await h.provider.ensureThreadControls("thread-1");
  const resumes = h.calls.filter((call) => call.method === "thread/resume");
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].params.threadId, "thread-1");
  assert.equal(resumes[0].params.config.openai_base_url, "http://127.0.0.1:23456/new-runtime/chatgpt");
  assert.equal(h.calls.filter((call) => call.method === "turn/start").length, 0);
});

test("active goal recovery confirms interruption, preserves usage and resumes the same goal once", async () => {
  const h = harness({ status: "active", goal: { ...activeGoal } });
  await h.provider.startThread();
  h.rotate();
  await h.provider.ensureThreadControls("thread-1");
  assert.deepEqual(h.goal, { ...activeGoal, updatedAt: 22 });
  const methods = h.calls.map((call) => call.method);
  assert.ok(methods.indexOf("turn/interrupt") < methods.indexOf("thread/unsubscribe"));
  assert.ok(methods.indexOf("thread/unsubscribe") < methods.indexOf("thread/resume"));
  assert.equal(h.calls.filter((call) => call.method === "thread/goal/set" && call.params.status === "active").length, 1);
  assert.equal(methods.filter((method) => method === "turn/start").length, 0);
});

test("an explicit pause during recovery wins over automatic continuation", async () => {
  let unblock;
  let reached;
  const waiting = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { unblock = resolve; });
  const h = harness({ goal: { ...activeGoal }, beforeUnsubscribe: async () => { reached(); await gate; } });
  await h.provider.startThread();
  h.rotate();
  const recovery = h.provider.ensureThreadControls("thread-1");
  await waiting;
  await h.provider.setGoalStatus("thread-1", "paused");
  unblock();
  await recovery;
  assert.equal(h.goal.status, "paused");
  assert.equal(h.calls.filter((call) => call.method === "thread/goal/set" && call.params.status === "active").length, 0);
});

test("an unconfirmed detach leaves the goal stopped and never claims readiness", async () => {
  const h = harness({ goal: { ...activeGoal }, stayLoaded: true });
  await assert.rejects(h.provider.resumeThread("thread-1"), { code: "vibe64_agent_control_recovery_failed" });
  assert.equal(h.goal.status, "paused");
  assert.equal(h.calls.filter((call) => call.method === "thread/resume").length, 0);
  assert.equal(h.provider.threadEnvironments.size, 0);
});

test("restricted helpers retain their explicitly empty environment", async () => {
  const h = harness();
  await h.provider.startThread({ config: { shell_environment_policy: { inherit: "none", set: {} } } });
  h.rotate();
  await h.provider.ensureThreadControls("thread-1");
  assert.deepEqual(h.environment, {});
  assert.equal(h.calls.filter((call) => call.method === "thread/unsubscribe").length, 0);
});

test("recovery waits for an admitted send and never replays an uncertain turn", async () => {
  const h = harness();
  await h.provider.startThread();
  const request = h.client.request;
  let entered;
  let release;
  const admitted = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  h.client.request = async (method, params) => {
    const result = await request(method, params);
    if (method === "turn/start") {
      entered();
      await gate;
      throw new Error("The turn was accepted but its acknowledgement was lost.");
    }
    return result;
  };
  const send = h.provider.sendTurn("thread-1", [{ type: "text", text: "Continue" }]);
  const rejected = assert.rejects(send, /acknowledgement was lost/u);
  await admitted;
  h.rotate();
  const recovery = h.provider.ensureThreadControls("thread-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.filter((call) => call.method === "thread/unsubscribe").length, 0);
  release();
  await rejected;
  await recovery;
  assert.equal(h.environment.MARKER, "B");
  assert.equal(h.calls.filter((call) => call.method === "turn/start").length, 1);
});

test("control probe filtering preserves a concurrent native user's turn", () => {
  const h = harness();
  const forwarded = [];
  h.provider.subscribe((event) => forwarded.push(event));
  h.provider.threadControlProbes.set("thread-1", { marker: "probe-marker", pending: [], verified: false, turnId: "" });
  const events = [
    { method: "thread/status/changed", params: { threadId: "thread-1", status: { type: "active" } } },
    { method: "turn/started", params: { threadId: "thread-1", turn: { id: "user-turn" } } },
    { method: "item/started", params: { threadId: "thread-1", turnId: "user-turn", item: { type: "userMessage" } } }
  ];
  events.forEach((event) => h.provider.publishNotification(event));
  assert.deepEqual(forwarded, events);
  assert.equal(h.provider.threadControlProbes.size, 0);
});

for (const valid of [true, false]) {
  test(`control verification uses its exact live completion and rejects an incorrect digest (valid: ${valid})`, async () => {
    const h = harness();
    const forwarded = [];
    h.provider.subscribe((event) => forwarded.push(event));
    const environment = { VIBE64_TEST_CONTROL: "B" };
    h.provider.options.prepareThreadEnvironment = async () => environment;
    const request = h.client.request;
    h.client.request = async (method, params) => {
      assert.notEqual(method, "thread/turns/list", "a control check must not depend on saved history items");
      if (method !== "thread/shellCommand") return request(method, params);
      const marker = params.command.match(/VIBE64_CONTROL_CHECK_[0-9a-f-]+:/u)?.[0];
      assert.ok(marker);
      const digest = createHash("sha256").update(JSON.stringify(Object.entries(environment))).digest("hex");
      const item = { id: "probe-item", type: "commandExecution", command: params.command };
      const emit = (method, fields) => h.provider.publishNotification({ method, params: { threadId: params.threadId, ...fields } });
      emit("turn/started", { turn: { id: "probe-turn", status: "inProgress" } });
      emit("item/started", { turnId: "probe-turn", item });
      // A different item or turn cannot satisfy this check.
      emit("item/completed", { turnId: "probe-turn", item: { ...item, id: "other-item", exitCode: 0, aggregatedOutput: `${marker}${digest}` } });
      emit("turn/completed", { turn: { id: "other-turn", status: "completed" } });
      const probe = h.provider.threadControlProbes.get(params.threadId);
      assert.equal(probe.result, undefined);
      assert.equal(probe.completed, undefined);
      emit("item/completed", { turnId: "probe-turn", item: { ...item, exitCode: 0, aggregatedOutput: `${marker}${valid ? digest : "incorrect"}` } });
      emit("turn/completed", { turn: { id: "probe-turn", status: "completed" } });
      return {};
    };
    if (valid) {
      await h.provider.ensureThreadControls("thread-1");
      assert.equal(h.provider.threadEnvironments.size, 1);
    } else {
      await assert.rejects(h.provider.ensureThreadControls("thread-1"), { code: "vibe64_agent_control_recovery_failed" });
      assert.equal(h.provider.threadEnvironments.size, 0);
    }
    assert.deepEqual(forwarded, []);
    assert.equal(h.provider.isControlProbeTurn("thread-1", "probe-turn"), true);
    assert.equal(h.provider.isControlProbeTurn("thread-1", "other-turn"), false);
    assert.equal(h.provider.isControlProbeTurn("thread-2", "probe-turn"), false);
  });
}

test("unsupported Codex history requires renewal without attempting native recovery", async () => {
  const h = harness({ historyMode: "legacy" });
  await assert.rejects(h.provider.resumeThread("thread-1"), { code: "vibe64_codex_history_unsupported" });
  assert.equal(h.provider.threadEnvironments.size, 0);
  assert.deepEqual(h.calls.map(({ method }) => method), ["thread/read"]);
});

test("native Codex paginated reload applies changed controls and preserves history, goal and files", {
  skip: spawnSync("codex", ["--version"], { timeout: 5000 }).status !== 0 ? "Codex CLI is not installed" : false, timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-native-controls-"));
  let modelRequests = 0;
  const model = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    if (!request.url.endsWith("/responses")) { response.writeHead(404).end(); return; }
    modelRequests += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
  });
  await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
  await writeFile(path.join(root, "config.toml"), [
    'model_provider = "probe"', 'check_for_update_on_startup = false',
    '[model_providers.probe]', 'name = "probe"',
    `base_url = "http://127.0.0.1:${model.address().port}/v1"`,
    'wire_api = "responses"', 'requires_openai_auth = false', 'supports_websockets = false', ''
  ].join("\n"));
  const socketPath = path.join(root, "app-server.sock");
  const child = spawn("codex", ["app-server", "--listen", `unix://${socketPath}`, "-c", "features.remote_control=false"], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: root, LANG: "C.UTF-8" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  const clients = [];
  const events = new Set();
  child.stderr.resume();
  t.after(async () => {
    clients.forEach((client) => client.close());
    child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const deadline = Date.now() + 10_000;
  while (true) {
    try { await access(socketPath); break; } catch {
      if (Date.now() > deadline) throw new Error("Native app-server did not create its socket.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const connect = async () => {
    const client = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socketPath}`, requestTimeoutMs: 10_000 });
    clients.push(client);
    await client.connect();
    await client.initialize({ clientInfo: { name: "vibe64-test", version: "1" }, capabilities: { experimentalApi: true } });
    return client;
  };
  const client = await connect();
  client.subscribe((event) => { for (const listener of events) listener(event); });
  let environment = { PATH: "/usr/bin:/bin", VIBE64_TEST_CONTROL_GENERATION: "A" };
  const provider = new CodexAppServerAgentProvider({ threadEnv: environment, prepareThreadEnvironment: async () => environment });
  provider.client = client;
  provider.activeClient = async () => client;
  const forwarded = [];
  provider.subscribe((event) => forwarded.push(event));
  client.subscribe((event) => provider.publishNotification(event));
  const started = await provider.startThread({ cwd: root, historyMode: "paginated", approvalPolicy: "never", sandbox: "danger-full-access" });
  const threadId = started.id;
  await client.request("thread/name/set", { threadId, name: "Managed control regression" });
  await client.request("thread/read", { threadId, includeTurns: true });
  await writeFile(path.join(root, "preserved.txt"), "partial implementation");
  const shellMarker = async () => {
    let stop;
    let output;
    const completed = new Promise((resolve) => {
      stop = (message) => {
        if (message.params?.threadId !== threadId) return;
        if (message.method === "item/completed" && message.params.item?.type === "commandExecution") output = message.params.item.aggregatedOutput;
        if (message.method === "turn/completed") resolve();
      };
      events.add(stop);
    });
    try {
      await client.request("thread/shellCommand", { threadId, command: 'printf "GENERATION=%s\\n" "$VIBE64_TEST_CONTROL_GENERATION"', timeoutMs: 2000 });
      await completed;
      return output;
    } finally { events.delete(stop); }
  };
  assert.match(await shellMarker(), /GENERATION=A/);
  const history = await client.request("thread/turns/list", { threadId, limit: 10, sortDirection: "asc", itemsView: "summary" });
  environment = { ...environment, VIBE64_TEST_CONTROL_GENERATION: "B" };
  // This is the native behavior that made the old mocked-parameter test pass.
  await client.request("thread/resume", { threadId, config: { shell_environment_policy: { inherit: "none", set: environment } } });
  assert.match(await shellMarker(), /GENERATION=A/);
  const { goal } = await client.request("thread/goal/set", { threadId, objective: "Preserve this paused goal", status: "paused", tokenBudget: 1000 });
  const observer = await connect();
  await observer.request("thread/resume", { threadId });
  await assert.rejects(provider.resumeThread(threadId, { cwd: root }), { code: "vibe64_agent_control_recovery_failed" });
  assert.equal(provider.threadEnvironments.size, 0);
  assert.match(await shellMarker(), /GENERATION=A/);
  await observer.request("thread/unsubscribe", { threadId });
  observer.close();
  const beforeRepair = forwarded.length;
  await provider.resumeThread(threadId, { cwd: root });
  assert.ok(!forwarded.slice(beforeRepair).some((event) => event.method === "turn/started"));
  assert.match(await shellMarker(), /GENERATION=B/);
  assert.ok(forwarded.slice(beforeRepair).some((event) => event.method === "turn/started"));
  const after = await client.request("thread/turns/list", { threadId, limit: 10, sortDirection: "asc", itemsView: "summary" });
  assert.equal(after.data[0].id, history.data[0].id);
  const currentGoal = (await client.request("thread/goal/get", { threadId })).goal;
  assert.equal(currentGoal.createdAt, goal.createdAt);
  assert.equal(currentGoal.objective, goal.objective);
  assert.equal(currentGoal.status, "paused");
  assert.equal(currentGoal.tokenBudget, goal.tokenBudget);
  assert.equal(await readFile(path.join(root, "preserved.txt"), "utf8"), "partial implementation");
  const waitForRequests = async (count) => {
    const deadline = Date.now() + 5000;
    while (modelRequests < count) {
      if (Date.now() > deadline) throw new Error(`Goal did not resume: expected ${count} local model requests, got ${modelRequests}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const requestsBeforeGoal = modelRequests;
  await provider.setGoalStatus(threadId, "active");
  await waitForRequests(requestsBeforeGoal + 1);
  environment = { ...environment, VIBE64_TEST_CONTROL_GENERATION: "C" };
  await provider.ensureThreadControls(threadId);
  await waitForRequests(requestsBeforeGoal + 2);
  assert.equal(modelRequests, requestsBeforeGoal + 2);
  const resumedGoal = (await provider.readGoal(threadId)).goal;
  assert.equal(resumedGoal.createdAt, goal.createdAt);
  assert.equal(resumedGoal.status, "active");
  assert.equal(resumedGoal.objective, goal.objective);
  await provider.stopThreadForObservationLoss(threadId, "");
  assert.match(await shellMarker(), /GENERATION=C/);
});
