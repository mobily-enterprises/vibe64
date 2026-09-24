import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startCodexHistoryAdapter } from "@local/vibe64-runtime/server/codexHistoryAdapter";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/server/codex-client";
import { CodexAppServerAgentProvider } from "@local/vibe64-runtime/server/codexAppServerProvider";

test("native provider switches preserve history without restarting, and cold recovery restores the provider", {
  skip: spawnSync("codex", ["--version"], { timeout: 5000 }).status !== 0 ? "Codex CLI is not installed" : false,
  timeout: 60_000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-provider-switch-"));
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (!request.url.endsWith("/responses")) { response.writeHead(404).end(); return; }
    const input = JSON.parse(body);
    requests.push({ route: request.url, authorization: request.headers.authorization, input });
    if (request.url === "/openai/responses" && input.input.some((item) => item.type === "reasoning" && item.content?.length)) {
      response.writeHead(400).end(JSON.stringify({ error: { message: "reasoning.content must be empty" } })); return;
    }
    const foreignProvider = request.url.split("/")[1];
    const reasoning = foreignProvider !== "openai" ? [{
      id: `reasoning-${requests.length}`, type: "reasoning", summary: [],
      encrypted_content: foreignProvider === "deepseek" ? "deepseek-opaque-state" : null,
      content: [{ type: "reasoning_text", text: `${foreignProvider.toUpperCase()}_REASONING_MARKER: preserve the tool result.` }]
    }] : [];
    const item = { id: `message-${requests.length}`, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: "Fixture reply", annotations: [] }] };
    const result = { id: `response-${requests.length}`, object: "response", created_at: 1, status: "completed",
      model: input.model, output: [...reasoning, item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
      ...reasoning.map((item) => ({ type: "response.output_item.done", output_index: 0, item })),
      { type: "response.output_item.added", output_index: reasoning.length, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: reasoning.length, content_index: 0, delta: "Fixture reply" },
      { type: "response.output_item.done", output_index: reasoning.length, item },
      { type: "response.completed", response: result }
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: (_url, options) =>
    fetch(`http://127.0.0.1:${server.address().port}/openai/responses`, options) });
  await writeFile(path.join(root, "config.toml"), "check_for_update_on_startup = false\n");
  const socket = path.join(root, "server.sock");
  const child = spawn("codex", ["app-server", "--listen", `unix://${socket}`, "-c", "features.remote_control=false", "-c", "features.plugins=false", "-c", "features.remote_plugin=false"], {
    env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root, LANG: "C.UTF-8" }, stdio: ["ignore", "ignore", "pipe"], detached: true
  });
  child.stderr.resume();
  let client;
  let observer;
  let nextChild;
  let nextClient;
  t.after(async () => {
    observer?.close(); client?.close(); nextClient?.close();
    for (const ownedChild of [child, nextChild].filter(Boolean)) {
      try { process.kill(-ownedChild.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      await new Promise((resolve) => ownedChild.exitCode !== null || ownedChild.signalCode !== null ? resolve() : ownedChild.once("exit", resolve));
    }
    await adapter.close();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 10_000;
  while (true) {
    try { await access(socket); break; } catch {
      if (Date.now() > deadline) throw new Error("Native app-server did not create its socket.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  async function connect() {
    const connection = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socket}`, requestTimeoutMs: 10_000 });
    await connection.connect();
    await connection.initialize({ clientInfo: { name: "vibe64-routing-test", version: "1" }, capabilities: { experimentalApi: true } });
    return connection;
  }
  client = await connect();
  await client.request("account/login/start", { type: "apiKey", apiKey: "fixture-secret-openai" });
  const environment = { PATH: "/usr/bin:/bin", VIBE64_TEST_CONTROL_GENERATION: "routing-fixture" };
  const logs = [];
  const provider = new CodexAppServerAgentProvider({
    threadEnv: environment, prepareThreadEnvironment: async () => environment,
    logger: { info: (fields) => logs.push(fields), warn: (fields) => logs.push(fields) },
    prepareThreadParams: async (params) => params.modelProvider === "openai" ? params : ({ ...params, config: { ...params.config,
      [`model_providers.${params.modelProvider}`]: { name: params.modelProvider,
        base_url: `http://127.0.0.1:${server.address().port}/${params.modelProvider}`, wire_api: "responses",
        requires_openai_auth: false, supports_websockets: false, experimental_bearer_token: `fixture-secret-${params.modelProvider}` }
    } })
  });
  provider.runtime = { historyAdapterBaseUrl: adapter.baseUrl };
  provider.client = client;
  provider.activeClient = async () => client;
  client.subscribe((event) => provider.publishNotification(event));
  const settings = (modelProvider) => ({ modelProvider, model: "gpt-6-sol", cwd: root, approvalPolicy: "never", sandbox: "danger-full-access" });
  const { id: threadId } = await provider.startThread(settings("openai"));
  const { id: otherId } = await provider.startThread(settings("openai"));
  async function completed(operation) {
    let unsubscribe;
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe?.(); reject(new Error("Native turn timed out.")); }, 10_000);
      unsubscribe = client.subscribe((event) => {
        if (event.method === "turn/completed" && event.params.threadId === threadId) {
          clearTimeout(timer); unsubscribe(); resolve(event.params.turn);
        }
      });
    });
    await operation();
    assert.equal((await done).status, "completed");
  }
  async function send(text) {
    await completed(() => client.request("turn/start", { threadId, model: "gpt-6-sol", input: [{ type: "text", text }] }));
  }
  await send("Remember FIRST_CONTEXT_MARKER.");
  await completed(() => client.request("thread/shellCommand", {
    threadId, command: "printf '%s' \"$VIBE64_TEST_CONTROL_GENERATION\" > preserved.txt", timeoutMs: 2000
  }));
  const switched = await provider.resumeThread(threadId, settings("deepseek"));
  assert.equal(switched.id, threadId);
  assert.equal(switched.response.modelProvider, "deepseek");
  await send("Continue using the previous context and tool result.");
  assert.equal(requests.at(-1).route, "/deepseek/responses");
  assert.match(JSON.stringify(requests.at(-1).input.input), /FIRST_CONTEXT_MARKER/);
  assert.match(JSON.stringify(requests.at(-1).input.input), /preserved\.txt/);
  assert.equal((await client.request("thread/read", { threadId: otherId })).thread.status.type, "idle");
  assert.equal(await readFile(path.join(root, "preserved.txt"), "utf8"), "routing-fixture");
  await provider.resumeThread(threadId, settings("openai"));
  await send("Check the implementation in the same conversation.");
  assert.equal(requests.at(-1).route, "/openai/responses");
  assert.match(JSON.stringify(requests.at(-1).input.input), /DEEPSEEK_REASONING_MARKER/);
  assert.ok(!JSON.stringify(requests.at(-1).input.input).includes("deepseek-opaque-state"));
  await provider.resumeThread(threadId, settings("deepseek"));
  await send("Continue after the review.");
  assert.ok(requests.at(-1).input.input.some((item) => item.type === "reasoning" &&
    item.encrypted_content === "deepseek-opaque-state" && item.content?.[0]?.text.includes("DEEPSEEK_REASONING_MARKER")));
  await provider.resumeThread(threadId, settings("openai"));
  const glm = await provider.resumeThread(threadId, settings("glm"));
  assert.equal(glm.id, threadId);
  assert.equal(glm.response.modelProvider, "glm");
  await send("Implement using GLM with the same context and tools.");
  assert.equal(requests.at(-1).route, "/glm/responses");
  assert.match(JSON.stringify(requests.at(-1).input.input), /FIRST_CONTEXT_MARKER/);
  assert.match(JSON.stringify(requests.at(-1).input.input), /preserved\.txt/);
  await provider.resumeThread(threadId, settings("openai"));
  await send("Review GLM's implementation in the same conversation.");
  assert.equal(requests.at(-1).route, "/openai/responses");
  assert.match(JSON.stringify(requests.at(-1).input.input), /GLM_REASONING_MARKER/);
  assert.ok(!requests.at(-1).input.input.some((item) => item.type === "reasoning" && item.content?.length));
  await provider.resumeThread(threadId, settings("glm"));
  await send("Continue with GLM after review.");
  assert.ok(requests.at(-1).input.input.some((item) => item.type === "reasoning" &&
    item.encrypted_content === null && item.content?.[0]?.text.includes("GLM_REASONING_MARKER")));
  await provider.resumeThread(threadId, settings("openai"));
  assert.ok(requests.every((request) => request.authorization === `Bearer fixture-secret-${request.route.split("/")[1]}`));
  assert.equal((await client.request("thread/read", { threadId: otherId })).thread.status.type, "idle");
  assert.equal(child.exitCode, null);
  assert.ok(!JSON.stringify(logs).includes("fixture-secret"));

  // A fresh observer must reconstruct the saved provider's configuration when
  // restoring a cold thread, even though a history read has no model override.
  for (const modelProvider of ["deepseek", "glm"]) {
    await provider.resumeThread(threadId, settings(modelProvider));
    await client.request("thread/unsubscribe", { threadId });
    const restored = new CodexAppServerAgentProvider(provider.options);
    restored.runtime = provider.runtime;
    restored.client = client;
    restored.activeClient = async () => client;
    const beforeRead = requests.length;
    await restored.ensureThreadControls(threadId);
    await restored.readThreadStatus(threadId);
    assert.equal((await client.request("thread/read", { threadId })).thread.modelProvider, modelProvider);
    assert.equal(requests.length, beforeRead, "restoring history must not send an inference request");
    await provider.resumeThread(threadId, settings("openai"));
  }


  // A second native subscriber must not make a successful settings ack conceal
  // an unchanged recipient. No user request is sent under uncertain settings.
  observer = await connect();
  await observer.request("thread/resume", { threadId });
  const before = requests.length;
  await assert.rejects(provider.resumeThread(threadId, settings("deepseek")), /native subscriber/);
  assert.equal(requests.length, before);

  // This installed protocol documents path resume but does not expose its
  // path field. Keep older separate-home histories intact; do not pretend a
  // fresh thread is an adoption of that history.
  observer.close(); observer = null;
  const original = await client.request("thread/read", { threadId });
  assert.ok(original.thread.path, JSON.stringify(Object.keys(original.thread)));
  await client.request("thread/unsubscribe", { threadId });
  const nextHome = path.join(root, "next-home");
  await mkdir(nextHome, { mode: 0o700 });
  const nextSocket = path.join(nextHome, "server.sock");
  nextChild = spawn("codex", ["app-server", "--listen", `unix://${nextSocket}`, "-c", "features.remote_control=false", "-c", "features.plugins=false", "-c", "features.remote_plugin=false"], {
    env: { PATH: process.env.PATH, HOME: nextHome, CODEX_HOME: nextHome, LANG: "C.UTF-8" }, stdio: ["ignore", "ignore", "pipe"], detached: true
  });
  let nextDiagnostic = "";
  nextChild.stderr.on("data", (chunk) => { nextDiagnostic += chunk; });
  const nextDeadline = Date.now() + 10_000;
  while (true) {
    try { await access(nextSocket); break; } catch {
      if (Date.now() > nextDeadline) throw new Error(`Second native app-server did not create its socket: ${nextDiagnostic}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  nextClient = new CodexAppServerJsonRpcClient({ endpoint: `unix://${nextSocket}`, requestTimeoutMs: 10_000 });
  await nextClient.connect();
  await nextClient.initialize({ clientInfo: { name: "vibe64-adoption-test", version: "1" }, capabilities: { experimentalApi: true } });
  await assert.rejects(nextClient.request("thread/resume", { threadId, path: original.thread.path,
    ...settings("deepseek"), config: { "model_providers.deepseek": {
      name: "deepseek", base_url: `http://127.0.0.1:${server.address().port}/deepseek`, wire_api: "responses",
      requires_openai_auth: false, supports_websockets: false, experimental_bearer_token: "fixture-secret-deepseek"
    } }
  }), /no rollout found/);

  // Restart the native process as well as the observer, using the same saved history.
  await provider.resumeThread(threadId, settings("deepseek"));
  await client.request("thread/unsubscribe", { threadId });
  client.close();
  nextClient.close();
  for (const ownedChild of [child, nextChild]) {
    process.kill(-ownedChild.pid, "SIGTERM");
    await new Promise((resolve) => ownedChild.exitCode !== null || ownedChild.signalCode !== null ? resolve() : ownedChild.once("exit", resolve));
  }
  const coldSocket = path.join(root, "cold.sock");
  nextChild = spawn("codex", ["app-server", "--listen", `unix://${coldSocket}`, "-c", "features.remote_control=false", "-c", "features.plugins=false"], {
    env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root, LANG: "C.UTF-8" }, stdio: ["ignore", "ignore", "pipe"], detached: true
  });
  nextChild.stderr.resume();
  const coldDeadline = Date.now() + 10_000;
  while (true) {
    try { await access(coldSocket); break; } catch {
      if (Date.now() > coldDeadline) throw new Error("Cold native app-server did not create its socket.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  nextClient = new CodexAppServerJsonRpcClient({ endpoint: `unix://${coldSocket}`, requestTimeoutMs: 10_000 });
  await nextClient.connect();
  await nextClient.initialize({ clientInfo: { name: "vibe64-cold-provider-test", version: "1" }, capabilities: { experimentalApi: true } });
  const coldObserver = new CodexAppServerAgentProvider(provider.options);
  coldObserver.runtime = provider.runtime;
  coldObserver.client = nextClient;
  coldObserver.activeClient = async () => nextClient;
  const coldCalls = [];
  const coldRequest = nextClient.request.bind(nextClient);
  nextClient.request = (method, ...args) => { coldCalls.push(method); return coldRequest(method, ...args); };
  const beforeColdRead = requests.length;
  await coldObserver.ensureThreadControls(threadId);
  await coldObserver.readThreadStatus(threadId);
  assert.equal((await nextClient.request("thread/read", { threadId })).thread.modelProvider, "deepseek");
  assert.equal(requests.length, beforeColdRead, "cold recovery must not make an inference request");
  assert.ok(!coldCalls.includes("account/read"), "an external-provider recovery must not require an OpenAI account");
});
