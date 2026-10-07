import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/testing/native-codex";
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
  assert.equal(h.provider.conversationRuntime.bindingCount, 0);
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
      assert.equal(h.provider.conversationRuntime.bindingCount, 1);
    } else {
      await assert.rejects(h.provider.ensureThreadControls("thread-1"), { code: "vibe64_agent_control_recovery_failed" });
      assert.equal(h.provider.conversationRuntime.bindingCount, 0);
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
  assert.equal(h.provider.conversationRuntime.bindingCount, 0);
  assert.deepEqual(h.calls.map(({ method }) => method), ["thread/read"]);
});

test("native Codex paginated reload applies changed controls and preserves history, goal and files", {
  skip: spawnSync("codex", ["--version"], { timeout: 5000 }).status !== 0 ? "Codex CLI is not installed" : false, timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-native-controls-"));
  let modelRequests = 0;
  const modelInputs = [];
  let completeResponses = false;
  const model = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (!request.url.endsWith("/responses")) { response.writeHead(404).end(); return; }
    modelInputs.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    modelRequests += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (!completeResponses) { response.flushHeaders(); return; }
    const item = { id: `message-${modelRequests}`, type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "The conversation and its files are preserved.", annotations: [] }] };
    const result = { id: `response-${modelRequests}`, object: "response", status: "completed", output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    for (const event of [
      { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result }
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
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
    detached: true, stdio: ["ignore", "ignore", "pipe"]
  });
  const clients = [];
  const events = new Set();
  child.stderr.resume();
  t.after(async () => {
    clients.forEach((client) => client.close());
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", resolve));
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
  let instructionUpdates = 0;
  const nativeRequest = client.request.bind(client);
  client.request = (method, params, options) => {
    if (method === "thread/inject_items") instructionUpdates += 1;
    return nativeRequest(method, params, options);
  };
  client.subscribe((event) => { for (const listener of events) listener(event); });
  let environment = { PATH: "/usr/bin:/bin", VIBE64_TEST_CONTROL_GENERATION: "A" };
  let instructions = "CALENDAR_INSTRUCTIONS_A";
  const provider = new CodexAppServerAgentProvider({ threadEnv: environment, prepareThreadEnvironment: async () => environment,
    readInstructions: () => instructions });
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
  assert.equal(provider.conversationRuntime.bindingCount, 0);
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
  const retained = await connect();
  await retained.request("thread/resume", { threadId });
  instructions = "UNINSTALLED_INSTRUCTIONS";
  await assert.rejects(provider.resumeThread(threadId, { cwd: root }), { code: "vibe64_agent_control_recovery_failed" });
  assert.equal(instructionUpdates, 0, "a retained prompt configuration cannot authorize a revision or new work");
  instructions = "CALENDAR_INSTRUCTIONS_A";
  await retained.request("thread/unsubscribe", { threadId });
  retained.close();
  await provider.resumeThread(threadId, { cwd: root });
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
  assert.equal(JSON.stringify(modelInputs.at(-1)).split("CALENDAR_INSTRUCTIONS_A").length - 1, 1);
  instructions = "CALENDAR_INSTRUCTIONS_B";
  environment = { ...environment, VIBE64_TEST_CONTROL_GENERATION: "C" };
  await provider.ensureThreadControls(threadId);
  await waitForRequests(requestsBeforeGoal + 2);
  assert.equal(modelRequests, requestsBeforeGoal + 2);
  assert.equal(JSON.stringify(modelInputs.at(-1)).split("CALENDAR_INSTRUCTIONS_B").length - 1, 1);
  const updatedContext = modelInputs.at(-1).input.filter(item => item.role === "developer");
  assert.match(JSON.stringify(updatedContext.at(-1)), /replace earlier application instructions/);
  assert.match(JSON.stringify(updatedContext.at(-1)), /CALENDAR_INSTRUCTIONS_B/);
  await provider.ensureThreadControls(threadId);
  assert.equal(instructionUpdates, 1, "unchanged controls do not add another instruction revision");
  const resumedGoal = (await provider.readGoal(threadId)).goal;
  assert.equal(resumedGoal.createdAt, goal.createdAt);
  assert.equal(resumedGoal.status, "active");
  assert.equal(resumedGoal.objective, goal.objective);
  await provider.stopThreadForObservationLoss(threadId, "");
  assert.match(await shellMarker(), /GENERATION=C/);
  completeResponses = true;
  let compactListener;
  const compacted = new Promise((resolve) => {
    compactListener = (event) => {
      if (event.params?.threadId !== threadId) return;
      if (event.method === "thread/compacted" ||
          event.method === "item/completed" && event.params.item?.type === "contextCompaction") resolve();
    };
    events.add(compactListener);
  });
  await client.request("thread/compact/start", { threadId });
  await compacted;
  events.delete(compactListener);
  const beforeCompactedTurn = modelRequests;
  await provider.sendTurn(threadId, [{ type: "text", text: "Continue after compaction." }]);
  await waitForRequests(beforeCompactedTurn + 1);
  assert.equal(JSON.stringify(modelInputs.at(-1)).split("CALENDAR_INSTRUCTIONS_B").length - 1, 1);
  assert.equal(JSON.stringify(modelInputs.at(-1)).includes("CALENDAR_INSTRUCTIONS_A"), false);
});

test("native Codex completes once when its active command deletes and restores a Genesis reference", {
  skip: spawnSync("codex", ["--version"], { timeout: 5000 }).status !== 0 ? "Codex CLI is not installed" : false,
  timeout: 60_000
}, async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdir } = await import("node:fs/promises");
  const { gunzipSync, zstdDecompressSync } = await import("node:zlib");
  const { initializeGenesisProject, setGenesisCollaboration, vibe64ConversationInstructions,
    vibe64HostContextEnvironment, vibe64HostContextRegistry } = await import("../../packages/vibe64-genesis/src/server/index.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-native-genesis-refresh-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "source");
  const socket = path.join(root, "app-server.sock");
  const events = [], requests = [], modelInputs = [];
  let child, client, provider, registry, fixtureError, stderr = "", instructionReads = 0;
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 10_000;
    while (!await predicate()) {
      if (fixtureError) throw fixtureError;
      assert.ok(Date.now() < deadline, `${label}: ${stderr.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  // Use the original native Responses fixture and execution-tool protocol.
  // Codex itself runs the command; no test-authored native notifications exist.
  const model = createServer(async (request, response) => {
    try {
      if (!request.url.endsWith("/responses")) { response.writeHead(404).end(); return; }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let raw = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "zstd") raw = zstdDecompressSync(raw);
      if (request.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      const body = JSON.parse(raw);
      modelInputs.push(body);
      const id = `reference-${modelInputs.length}`;
      let item;
      if (modelInputs.length === 1) {
        const tools = [...(body.tools || []), ...body.input.filter(value => value.type === "additional_tools").flatMap(value => value.tools || [])]
          .flatMap(tool => tool.type === "namespace" ? tool.tools.map(nested => ({ ...nested, namespace: tool.name })) : [tool]);
        const tool = tools.find(value => ["exec_command", "exec"].includes(value.name));
        assert.ok(tool, "The real native execution tool must be available");
        const args = { login: false, yield_time_ms: 30_000, cmd: `python3 - <<'PY'
from pathlib import Path
import time
source = Path("referenced.js")
source.unlink()
Path("deleted.marker").write_text("deleted")
while not Path("restore.release").exists():
    time.sleep(0.02)
source.write_text("export const reference = 'restored';\\n")
Path("restored.marker").write_text("restored")
while not Path("finish.release").exists():
    time.sleep(0.02)
PY` };
        item = { id, call_id: id, type: tool.type === "custom" ? "custom_tool_call" : "function_call",
          name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), status: "completed",
          ...(tool.type === "custom" ? { input: `text(await tools.exec_command(${JSON.stringify(args)}));` } : { arguments: JSON.stringify(args) }) };
      } else {
        assert.equal(modelInputs.length, 2, "The one authored turn has only its command and final model rounds");
        assert.ok(body.input.some(value => ["function_call_output", "custom_tool_call_output"].includes(value.type)), "The final reply follows actual native execution");
        item = { id, type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: "The referenced source is restored.", annotations: [] }] };
      }
      const result = { id, object: "response", created_at: 1, status: "completed", output: [item],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress" } },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result }
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) {
      fixtureError = error;
      response.writeHead(500).end();
    }
  });
  t.after(async () => {
    await Promise.all(["restore.release", "finish.release"].map(file => writeFile(path.join(cwd, file), "release").catch(() => {})));
    client?.close();
    provider?.close();
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      process.kill(-child.pid, "SIGTERM");
      await exited;
    }
    await registry?.close();
    model.closeAllConnections();
    if (model.listening) await new Promise(resolve => model.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(home);
  await mkdir(cwd);
  await promisify(execFile)("git", ["init", "--quiet"], { cwd });
  await initializeGenesisProject({ projectRoot: cwd });
  await writeFile(path.join(cwd, "referenced.js"), "export const reference = 'original';\n");
  await mkdir(path.join(cwd, "genesis", "program", "reference"), { recursive: true });
  await writeFile(path.join(cwd, "genesis", "program", "reference", "read-reference.md"),
    "# Read reference\n\n## Sources\n\n- `referenced.js`\n\n## Public contract\n\nRead the project's current reference.\n");
  const promptContext = { scope: "session", conversationKind: "main", session: {
    managedDatabaseRefresh: false, managedEnvironment: false, managedGit: false, managedPreview: false
  } };
  const readInstructions = () => vibe64ConversationInstructions({ workdir: cwd, promptContext });
  const initialInstructions = await readInstructions();
  assert.doesNotMatch(initialInstructions, /Genesis needs attention:/u);
  registry = await vibe64HostContextRegistry(path.join(root, "runtime"));
  const hostEnvironment = await vibe64HostContextEnvironment(path.join(root, "runtime"));
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  await writeFile(path.join(home, "config.toml"), [
    'model_provider="probe"', 'model="gpt-6-astra"', 'check_for_update_on_startup=false', 'web_search="disabled"',
    '[model_providers.probe]', 'name="probe"', `base_url="http://127.0.0.1:${model.address().port}/v1"`,
    'wire_api="responses"', 'requires_openai_auth=false', 'supports_websockets=false'
  ].join("\n"));
  child = spawn("codex", ["app-server", "--listen", `unix://${socket}`, "-c", "features.remote_control=false",
    "-c", "features.plugins=false", "-c", "features.remote_plugin=false"], {
    cwd, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: "C.UTF-8", ...hostEnvironment },
    stdio: ["ignore", "ignore", "pipe"], detached: true
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  await waitFor(() => access(socket).then(() => true, () => false), "Native socket readiness");
  client = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socket}`, requestTimeoutMs: 10_000 });
  await client.connect();
  await client.initialize({ clientInfo: { name: "vibe64-genesis-refresh-test", version: "1" }, capabilities: { experimentalApi: true } });
  const nativeRequest = client.request.bind(client);
  client.request = (method, params, options) => { requests.push({ method, params }); return nativeRequest(method, params, options); };
  const environment = { PATH: process.env.PATH, ...hostEnvironment };
  provider = new CodexAppServerAgentProvider({ threadEnv: environment, prepareThreadEnvironment: async () => environment,
    readInstructions: async () => { instructionReads += 1; return readInstructions(); },
    bindThreadContext: (threadId, context, params) => registry.register(threadId, context, params.cwd) });
  provider.client = client;
  provider.activeClient = async () => client;
  client.subscribe(event => { events.push(event); provider.publishNotification(event); });
  const thread = await provider.startThread({ cwd, hostContext: promptContext, approvalPolicy: "never", sandbox: "danger-full-access" });
  assert.match(thread.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  const installed = provider.conversationRuntime.threadEnvironments.get(thread.id);
  const installedReads = instructionReads;
  const nativePid = child.pid;
  requests.length = 0;
  const turn = await provider.sendTurn(thread.id, [{ type: "text", text: "Delete and restore the referenced source once, then finish." }]);
  await waitFor(() => access(path.join(cwd, "deleted.marker")).then(() => true, () => false), "Native source deletion");
  await assert.rejects(readFile(path.join(cwd, "referenced.js")), { code: "ENOENT" });
  const missingInstructions = await readInstructions();
  assert.notEqual(missingInstructions, initialInstructions);
  assert.match(missingInstructions, /Genesis needs attention:/u);
  assert.match(missingInstructions, /Program module cites a missing or ineligible source file: referenced\.js/u);
  await provider.ensureThreadControls(thread.id);
  assert.equal(instructionReads, installedReads + 1, "Only the idle send admission reread the host before the native command started");
  assert.equal(provider.conversationRuntime.threadEnvironments.get(thread.id), installed);
  await writeFile(path.join(cwd, "restore.release"), "restore");
  await waitFor(() => access(path.join(cwd, "restored.marker")).then(() => true, () => false), "Native source restoration");
  assert.equal(await readFile(path.join(cwd, "referenced.js"), "utf8"), "export const reference = 'restored';\n");
  await setGenesisCollaboration({ projectRoot: cwd, requirements: "- Keep the restored source reference intact." });
  const latestInstructions = await readInstructions();
  assert.doesNotMatch(latestInstructions, /Genesis needs attention:/u);
  assert.match(latestInstructions, /Keep the restored source reference intact\./u);
  await provider.ensureThreadControls(thread.id);
  assert.equal(instructionReads, installedReads + 1, "An active restored source also retains the installed prompt");
  assert.equal(provider.conversationRuntime.threadEnvironments.get(thread.id), installed);
  assert.equal(child.pid, nativePid);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.equal(requests.filter(value => value.method === "turn/start").length, 1);
  assert.equal(requests.some(value => ["turn/interrupt", "thread/unsubscribe", "thread/resume", "thread/inject_items"].includes(value.method)), false);
  await writeFile(path.join(cwd, "finish.release"), "finish");
  await waitFor(() => events.some(event => event.method === "turn/completed" && event.params.threadId === thread.id && event.params.turn.id === turn.id), "The same native turn completion");
  const completions = events.filter(event => event.method === "turn/completed" && event.params.threadId === thread.id && event.params.turn.id === turn.id);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].params.turn.status, "completed");
  assert.ok(events.some(event => event.method === "item/started" && event.params.threadId === thread.id &&
    event.params.turnId === turn.id && event.params.item.type === "commandExecution"),
    JSON.stringify({ expectedThreadId: thread.id, expectedTurnId: turn.id, events: events.map(event => ({
      method: event.method, threadId: event.params?.threadId, turnId: event.params?.turnId || event.params?.turn?.id,
      itemType: event.params?.item?.type
    })) }));
  const finals = events.filter(event => event.method === "item/completed" && event.params.threadId === thread.id && event.params.turnId === turn.id && event.params.item.type === "agentMessage");
  assert.equal(finals.length, 1);
  assert.equal(finals[0].params.item.text, "The referenced source is restored.");
  assert.equal(modelInputs.length, 2, "Two HTTP rounds belong to the single accepted execution turn");
  const saved = await client.request("thread/turns/list", { threadId: thread.id, limit: 10, sortDirection: "asc", itemsView: "full" });
  assert.equal(saved.data.filter(value => value.id === turn.id).length, 1);
  assert.equal(saved.data.find(value => value.id === turn.id).status, "completed");
  assert.equal(requests.some(value => value.method === "turn/interrupt"), false);
  await provider.ensureThreadControls(thread.id);
  assert.equal(provider.conversationRuntime.threadEnvironments.get(thread.id).params.developerInstructions, latestInstructions);
  assert.equal(provider.conversationRuntime.threadEnvironments.get(thread.id).client, client);
  assert.equal(instructionReads, installedReads + 2, "The next idle admission reads the current Genesis composition");
  assert.equal(requests.filter(value => value.method === "thread/resume").length, 1);
  assert.equal(requests.find(value => value.method === "thread/resume").params.threadId, thread.id);
  assert.equal(requests.filter(value => value.method === "thread/inject_items").length, 1);
  assert.ok(requests.find(value => value.method === "thread/inject_items").params.items[0].content[0].text.endsWith(latestInstructions));
  assert.equal(requests.filter(value => value.method === "turn/start").length, 1);
  assert.equal(requests.some(value => value.method === "turn/interrupt"), false);
  assert.equal(child.pid, nativePid);
  if (fixtureError) throw fixtureError;
});
