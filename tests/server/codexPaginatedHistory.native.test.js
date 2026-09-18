import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/server/codex-client";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  CodexAppServerAgentProvider,
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import { ensureCodexAppServerThreadForSession } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";

const codexVersion = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5000 });

test("native paginated conversations accept their first message and survive reconnects and restart", {
  skip: codexVersion.status !== 0 ? "Codex CLI is not installed" : false,
  timeout: 60000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-paginated-"));
  const toolHome = path.join(root, "home");
  const workdir = path.join(root, "work");
  const socketPath = path.join(root, "app-server.sock");
  await mkdir(toolHome);
  await mkdir(workdir);
  let processHandle;
  let client;
  let requestCount = 0;
  let holdResponses = false;
  let stderr = "";
  const notifications = [];
  const protocolCalls = [];
  const api = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    if (!request.url.endsWith("/responses")) {
      response.writeHead(404).end();
      return;
    }
    requestCount += 1;
    if (holdResponses) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      return;
    }
    const item = {
      id: `message-${requestCount}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "PROBE_OK", annotations: [] }]
    };
    const result = {
      id: `response-${requestCount}`,
      object: "response",
      created_at: 1788797000,
      status: "completed",
      output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    };
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "PROBE_OK" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result }
    ]) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const config = {
    model_provider: "probe",
    model_providers: {
      probe: {
        name: "probe",
        base_url: `http://127.0.0.1:${api.address().port}/v1`,
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false
      }
    },
    check_for_update_on_startup: false
  };
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => client;
  // The production bridge resumes with the user's configured default provider.
  // Keep that default local too, instead of relying only on per-thread overrides.
  await writeFile(path.join(toolHome, "config.toml"), [
    'model_provider = "probe"', 'check_for_update_on_startup = false',
    '[model_providers.probe]', 'name = "probe"',
    `base_url = ${JSON.stringify(config.model_providers.probe.base_url)}`,
    'wire_api = "responses"', 'requires_openai_auth = false', 'supports_websockets = false', ''
  ].join("\n"));

  async function connectClient() {
    client = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socketPath}`, requestTimeoutMs: 10000 });
    await client.connect();
    await client.initialize();
    provider.client = client;
    client.subscribe((notification) => notifications.push(notification));
    const request = client.request.bind(client);
    client.request = (method, params, options) => {
      protocolCalls.push({ method, params });
      return request(method, params, options);
    };
  }

  async function startProcess() {
    processHandle = spawn("codex", ["app-server", "--listen", `unix://${socketPath}`], {
      cwd: workdir,
      env: { PATH: process.env.PATH, HOME: toolHome, CODEX_HOME: toolHome, RUST_LOG: "error" },
      detached: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await access(socketPath);
        break;
      } catch {
        assert.ok(attempt < 100 && processHandle.exitCode === null, stderr);
        await delay(50);
      }
    }
    await connectClient();
  }

  async function stopProcess() {
    client?.close();
    if (processHandle?.exitCode === null) {
      const exited = once(processHandle, "exit");
      process.kill(-processHandle.pid, "SIGTERM");
      const force = setTimeout(() => process.kill(-processHandle.pid, "SIGKILL"), 5000);
      try { await exited; } finally { clearTimeout(force); }
    }
  }

  t.after(async () => {
    await stopProcess();
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await startProcess();
  t.diagnostic(codexVersion.stdout.trim());

  const threadIds = [];
  await t.test("five empty paginated threads can immediately resume and list zero turns", async () => {
    for (let index = 0; index < 5; index += 1) {
      const thread = await provider.startThread({
        cwd: workdir, model: "gpt-5.6-luna", approvalPolicy: "never", sandbox: "read-only",
        historyMode: "paginated", config
      });
      assert.equal(thread.raw.historyMode, "paginated");
      threadIds.push(thread.id);
      assert.equal((await provider.resumeThread(thread.id, { cwd: workdir, config })).id, thread.id);
      assert.deepEqual((await provider.listThreadTurns(thread.id, { limit: 1, itemsView: "summary" })).data, []);
    }
    assert.equal(new Set(threadIds).size, 5);
    assert.equal(requestCount, 0, "initialization must not create a model turn");
  });
  const threadId = threadIds[0];
  protocolCalls.length = 0;
  await t.test("an empty thread resumes on a new connection and after a cold restart", async () => {
    client.close();
    await connectClient();
    assert.equal((await provider.resumeThread(threadId, { cwd: workdir, config })).id, threadId);
    await stopProcess();
    await startProcess();
    assert.equal((await provider.resumeThread(threadId, { cwd: workdir, config })).id, threadId);
    assert.equal(requestCount, 0);
  });
  await t.test("first send and repeated follow-ups stream and remain independently paginated", async () => {
    for (let index = 0; index < 5; index += 1) {
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Turn timed out: ${stderr}`)); }, 10000);
        const unsubscribe = client.subscribe((notification) => {
          if (notification.method === "turn/completed" && notification.params.threadId === threadId) {
            clearTimeout(timer);
            unsubscribe();
            resolve(notification.params.turn);
          }
        });
      });
      const sent = await provider.sendTurn(threadId, [`Message ${index}: reply PROBE_OK`], {
        cwd: workdir, model: "gpt-5.6-luna", approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }
      });
      const turn = await completed;
      assert.equal(turn.id, sent.id);
      assert.equal(turn.status, "completed");
      const latest = await provider.listThreadTurns(threadId, { limit: 1, sortDirection: "desc", itemsView: "full" });
      assert.equal(latest.data.length, 1);
      assert.equal(latest.data[0].id, sent.id);
      assert.match(JSON.stringify(latest.data[0].items), /PROBE_OK/u);
      await provider.resumeThread(threadId, { cwd: workdir, config });
    }
    assert.equal(requestCount, 5);
  });
  await t.test("paged answers survive another cold restart without full-history hydration", async () => {
    await stopProcess();
    await startProcess();
    assert.equal((await provider.resumeThread(threadId, { cwd: workdir, config })).id, threadId);
    let cursor;
    const turns = [];
    do {
      const page = await provider.listThreadTurns(threadId, { limit: 2, sortDirection: "asc", itemsView: "full", ...(cursor ? { cursor } : {}) });
      assert.ok(page.data.length <= 2);
      turns.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(turns.length, 5);
    assert.match(JSON.stringify(turns[0]), /Message 0:/u);
    assert.match(JSON.stringify(turns.at(-1)), /Message 4:/u);
    assert.equal(new Set(turns.map((turn) => turn.id)).size, 5);
    assert.equal(protocolCalls.some(({ method, params }) => method === "thread/read" && params.includeTurns), false);
    assert.equal(notifications.some((event) => event.method === "item/completed" && event.params.item.type === "agentMessage"), true);
  });
  await t.test("observation cancellation pauses a native goal and stops two active threads across restart", async () => {
    const originalAnswers = (await provider.listThreadTurns(threadId, {
      limit: 10, itemsView: "full"
    })).data.map((turn) => ({ id: turn.id, items: turn.items }));
    holdResponses = true;
    const running = [];
    for (const id of [threadId, threadIds[1]]) {
      await provider.resumeThread(id, { cwd: workdir, config });
      const turn = await provider.sendTurn(id, ["Keep working until interrupted"], {
        cwd: workdir, model: "gpt-5.6-luna", approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }
      });
      running.push({ threadId: id, turnId: turn.id });
    }
    for (let attempt = 0; requestCount < 7; attempt += 1) {
      assert.ok(attempt < 100, `Native turns did not reach the model: ${stderr}`);
      await delay(50);
    }
    const { goal } = await client.request("thread/goal/set", { threadId, objective: "Continue until explicitly stopped" });
    assert.equal(goal.status, "active");
    for (const active of running) {
      await provider.stopThreadForObservationLoss(active.threadId, "");
      assert.equal((await provider.readThreadStatus(active.threadId)).raw.status.type, "idle");
    }
    const { goal: paused } = await provider.readGoal(threadId);
    assert.equal(paused.status, "paused");
    assert.equal(paused.objective, goal.objective);
    assert.equal(paused.createdAt, goal.createdAt);
    await stopProcess();
    await startProcess();
    for (const { threadId: id, turnId } of running) {
      const history = await provider.listThreadTurns(id, { limit: 10, itemsView: "full" });
      assert.ok(history.data.some((turn) => turn.id === turnId));
    }
    const restored = (await provider.listThreadTurns(threadId, { limit: 10, itemsView: "full" })).data;
    assert.deepEqual(restored.filter((turn) => originalAnswers.some((saved) => saved.id === turn.id))
      .map((turn) => ({ id: turn.id, items: turn.items })), originalAnswers);
    assert.equal((await provider.readGoal(threadId)).goal.status, "paused");
    assert.equal(requestCount, 7, "read-only recovery must not start another model request");
  });
  await t.test("changeover restores the original native conversation without a separate model request", async () => {
    holdResponses = false;
    const before = requestCount;
    const writes = [];
    const previousEnsure = provider.ensureAvailable;
    provider.ensureAvailable = async () => ({ runtime: {
      endpoint: `unix://${socketPath}`, runtimeDir: root, socketPath, transport: "unix"
    } });
    try {
      const resumed = await ensureCodexAppServerThreadForSession({
        agentSettings: { model: "gpt-5.6-luna", thinking: "low" },
        provider, workdir, observeThread() {},
        runtime: { store: {
          async mutateSession(_id, operation) { return operation(); },
          async writeMetadataValue(_id, name, value) { writes.push({ name, value }); }
        } },
        session: { sessionId: "native-changeover", metadata: {
          agent_identity_provider: "opencode", agent_identity_conversation_id: "ses_other",
          agent_transport_id: "opencode_server", codex_conversation_id: threadId,
          codex_conversation_workdir: workdir, codex_changeover_pause_goal: "yes"
        } }
      });
      assert.equal(resumed.threadId, threadId);
      assert.equal(requestCount, before, "resuming for changeover must not send an acknowledgement or restart a goal");
      assert.ok(writes.some((write) => write.name === "codex_changeover_pause_goal" && write.value === ""));
      const combined = '[Vibe64 conversation changeover]\n{"messages":[{"role":"user","text":"OpenCode changed the plan"}]}\n[End Vibe64 conversation changeover]\n\nUser\'s message:\nContinue with that plan';
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Changeover turn timed out: ${stderr}`)); }, 10000);
        const unsubscribe = client.subscribe((event) => {
          if (event.method === "turn/completed" && event.params.threadId === threadId) {
            clearTimeout(timer); unsubscribe(); resolve(event.params.turn);
          }
        });
      });
      const sent = await provider.sendTurn(threadId, [combined], {
        cwd: workdir, model: "gpt-5.6-luna", approvalPolicy: "never", sandboxPolicy: { type: "readOnly" },
        clientUserMessageId: "native-changeover-message"
      });
      assert.equal((await completed).id, sent.id);
      assert.equal(requestCount, before + 1);
      const latest = await provider.listThreadTurns(threadId, { limit: 1, sortDirection: "desc", itemsView: "full" });
      const user = latest.data[0].items.find((item) => item.type === "userMessage");
      assert.equal(user.content[0].text, combined);
      assert.equal(user.clientId, "native-changeover-message");
    } finally {
      provider.ensureAvailable = previousEnsure;
    }
  });
  await t.test("explicit deletion removes the stopped conversation and preserves project edits", async () => {
    const editedFile = path.join(workdir, "keep.txt");
    await writeFile(editedFile, "Keep this project edit.");
    await provider.deleteThread(threadId);
    await assert.rejects(provider.readThreadStatus(threadId));
    assert.equal(await readFile(editedFile, "utf8"), "Keep this project edit.");
  });

});
