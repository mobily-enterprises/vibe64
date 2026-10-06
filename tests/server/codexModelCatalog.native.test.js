import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/testing/native-codex";
import { CodexAppServerAgentProvider } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { createCodexProviderConnectionStore, codexProviderPaths } from "@local/vibe64-core/server/codexProviderConnections";

const leader = fileURLToPath(new URL("../../packages/vibe64-runtime/src/server/codexAppServerProcess.js", import.meta.url));
const cli = spawnSync("codex", ["--version"], { timeout: 5000 });

test("the managed native Codex runtime loads patch tools and context for real model switches before sending work", {
  skip: cli.status !== 0 ? "Codex CLI is not installed" : false, timeout: 60_000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-catalog-"));
  const requests = [];
  const nativeCatalog = spawnSync("codex", ["debug", "models", "--bundled"], { encoding: "utf8", timeout: 5000 });
  assert.equal(nativeCatalog.status, 0);
  const nativeModels = JSON.parse(nativeCatalog.stdout).models;
  let catalogGeneration = 1;
  let catalogReads = 0;
  let fixtureError;
  const api = createServer(async (request, response) => {
    try {
      if (request.url.startsWith("/models")) {
        assert.equal(request.headers.authorization, "Bearer fixture-catalog");
        catalogReads++;
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models: [
          ...nativeModels, { ...nativeModels.find((model) => model.slug === "gpt-6-sol"), slug: `gpt-live-catalog-${catalogGeneration}` }
        ] }));
        return;
      }
      let data = "";
      for await (const chunk of request) data += chunk;
      const body = JSON.parse(data);
      assert.ok(request.url.endsWith("/responses"));
      const current = body.input.findLast((item) => item.role === "user" && item.content?.some((part) => part.text?.startsWith("PATCH ")));
      const file = current.content.find((part) => part.text?.startsWith("PATCH ")).text.slice(6);
      const tools = [...(body.tools || []), ...body.input.filter((item) => item.type === "additional_tools").flatMap((item) => item.tools || [])];
      const flattened = tools.flatMap((tool) => tool.type === "namespace" ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name })) : [tool]);
      const patch = flattened.find((tool) => tool.name === "apply_patch") ||
        (body.model.startsWith("gpt-") && flattened.find((tool) => tool.name === "exec"));
      assert.ok(patch, `Missing apply_patch for ${body.model}: ${JSON.stringify(flattened.map((tool) => tool.name))}`);
      assert.equal(patch.type, "custom");
      if (patch.name === "apply_patch") assert.equal(patch.format?.type, "grammar");
      else assert.match(JSON.stringify(tools), /apply_patch/);
      requests.push({ body, authorization: request.headers.authorization });
      const id = `fixture-${requests.length}`;
      const alreadyPatched = body.input.some((item) => item.type === "custom_tool_call" && ["apply_patch", "exec"].includes(item.name) && item.input.includes(`Add File: ${file}`));
      const input = `*** Begin Patch\n*** Add File: ${file}\n+${body.model}\n*** End Patch`;
      const item = alreadyPatched
        ? { id, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Patched.", annotations: [] }] }
        : { id, call_id: id, type: "custom_tool_call", name: patch.name, namespace: patch.namespace,
          input: patch.name === "exec" ? `text(await tools.apply_patch(${JSON.stringify(input)}));` : input, status: "completed" };
      const result = { id, object: "response", created_at: 1, status: "completed", output: [item],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress" } },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result }
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) { fixtureError = error; response.writeHead(400).end(); }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = `http://127.0.0.1:${api.address().port}`;
  const preload = path.join(root, "transport.mjs");
  await writeFile(preload, `const original = globalThis.fetch; globalThis.fetch = (url, options) => original(new URL(new URL(url).pathname, ${JSON.stringify(fixtureUrl)}), options);`);
  const source = path.join(root, "source");
  await mkdir(source);
  const systemRoot = path.join(root, "system");
  const connections = createCodexProviderConnectionStore({ systemRoot,
    fetchImpl: async () => Response.json({ id: "checked", output: [], status: "completed" }) });
  for (const id of ["deepseek", "zai-coding-plan", "zai"]) await connections.change(id, { apiKey: `fixture-${id}` });
  const children = [];
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  async function start(home, label, bundled = false) {
    await mkdir(home, { recursive: true });
    const runtimeDir = path.join(root, label);
    await mkdir(runtimeDir, { mode: 0o700 });
    const socket = path.join(runtimeDir, "socket");
    const child = spawn(process.execPath, [leader, runtimeDir, "codex", "app-server", "--listen", `unix://${socket}`,
      "-c", "features.plugins=false", "-c", "features.remote_control=false", "-c", "features.remote_plugin=false"], {
      env: { PATH: process.env.PATH, HOME: path.dirname(home), CODEX_HOME: home, LANG: "C.UTF-8",
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, RUST_LOG: "warn",
        VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: randomUUID(), VIBE64_CODEX_MODEL_CATALOG_SOURCE: bundled ? "bundled" : "native" },
      cwd: source, detached: true, stdio: ["ignore", "ignore", "pipe"]
    });
    children.push(child);
    let diagnostic = "";
    child.stderr.on("data", (chunk) => { diagnostic += chunk; });
    const deadline = Date.now() + 15_000;
    while (true) {
      try { await access(socket); break; } catch {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Codex startup failed: ${diagnostic}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const client = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socket}`, requestTimeoutMs: 10_000 });
    clients.push(client);
    await client.connect();
    await client.initialize({ clientInfo: { name: "catalog-regression", version: "1" }, capabilities: { experimentalApi: true } });
    const adapter = JSON.parse(await readFile(path.join(runtimeDir, "history-adapter.json"), "utf8"));
    const environment = { PATH: "/usr/bin:/bin" };
    const provider = new CodexAppServerAgentProvider({
      threadEnv: environment,
      prepareThreadEnvironment: async () => environment,
      prepareThreadParams: async (params) => ({
        ...params,
        config: { ...params.config, ...await connections.threadConfig(params.modelProvider) }
      })
    });
    provider.runtime = { historyAdapterBaseUrl: adapter.baseUrl };
    provider.client = client;
    provider.activeClient = async () => client;
    client.subscribe((event) => provider.publishNotification(event));
    return { child, client, provider, diagnostic: () => diagnostic };
  }
  const settings = (id, model) => ({ modelProvider: id, model, cwd: source, approvalPolicy: "never", sandbox: "danger-full-access" });
  async function patch(runtime, threadId, id, model, file) {
    await runtime.provider.resumeThread(threadId, settings(id, model));
    const events = [];
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(fixtureError || new Error(`Patch timed out: ${runtime.diagnostic()}`)); }, 10_000);
      const unsubscribe = runtime.client.subscribe((event) => {
        events.push(event);
        if (event.method === "turn/completed" && event.params.threadId === threadId) {
          clearTimeout(timer); unsubscribe(); resolve(event.params.turn);
        }
      });
    });
    await runtime.provider.sendTurn(threadId, [{ type: "text", text: `PATCH ${file}` }], { model,
      approvalPolicy: "never", sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } });
    const turn = await done;
    if (fixtureError) throw fixtureError;
    assert.equal(turn.status, "completed", JSON.stringify(turn.error));
    assert.equal(await readFile(path.join(source, file), "utf8"), `${model}\n`);
    assert.equal(requests.at(-1).authorization, `Bearer fixture-${id}`);
    assert.equal(requests.at(-1).body.model, model);
    if (id !== "openai") {
      const tokenEvent = events.findLast((event) => event.method === "thread/tokenUsage/updated");
      assert.equal(tokenEvent?.params.tokenUsage.modelContextWindow, Math.floor(1048576 * 0.95));
    }
    assert.doesNotMatch(runtime.diagnostic(), /Unknown model .*fallback model metadata/);
    const lastUser = requests.at(-1).body.input.findLast((item) => item.role === "user");
    assert.deepEqual(lastUser.content, [{ type: "input_text", text: `PATCH ${file}` }]);
  }
  const home = path.join(root, "openai-home", ".codex");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "config.toml"), [
    'model_provider="catalog-fixture"', 'features.api_key_model_discovery=true',
    '[model_providers.catalog-fixture]', 'name="Native catalogue fixture"', 'wire_api="responses"', 'requires_openai_auth=true',
    `model_catalog_url="${fixtureUrl}/models"`, 'experimental_bearer_token="fixture-catalog"'
  ].join("\n"));
  const runtime = await start(home, "first");
  assert.ok(catalogReads > 0, "startup must refresh native metadata through the CLI");
  const initialModels = (await runtime.provider.listModels()).data;
  assert.ok(initialModels.some((model) => model.model === "gpt-live-catalog-1"));
  assert.ok(initialModels.find((model) => model.isDefault)?.model.startsWith("gpt-"));
  await runtime.client.request("account/login/start", { type: "apiKey", apiKey: "fixture-openai" });
  const threadId = (await runtime.provider.startThread(settings("openai", "gpt-6-sol"))).id;
  for (const [id, model] of [["deepseek", "deepseek-flash"], ["deepseek", "deepseek-v4-pro"],
    ["zai-coding-plan", "glm-5.3"], ["zai", "glm-5.3"], ["openai", "gpt-6-sol"], ["deepseek", "deepseek-flash"]]) {
    await patch(runtime, threadId, id, model, `patch-${requests.length}.txt`);
  }
  assert.equal(runtime.child.exitCode, null, "model changes retain the same native process");
  runtime.client.close();
  process.kill(-runtime.child.pid, "SIGTERM");
  await new Promise((resolve) => runtime.child.once("exit", resolve));
  catalogGeneration = 2;
  const restarted = await start(home, "restart");
  assert.ok((await restarted.provider.listModels()).data.some((model) => model.model === "gpt-live-catalog-2"));
  await patch(restarted, threadId, "zai", "glm-5.3", "after-restart.txt");
  for (const origin of ["deepseek", "zai-coding-plan"]) {
    const isolated = await start(codexProviderPaths(systemRoot, origin).codexHome, `origin-${origin}`, true);
    const isolatedId = (await isolated.provider.startThread(settings(origin, origin === "deepseek" ? "deepseek-flash" : "glm-5.3"))).id;
    await patch(isolated, isolatedId, "deepseek", "deepseek-flash", `${origin}-deepseek.txt`);
    await patch(isolated, isolatedId, "zai-coding-plan", "glm-5.3", `${origin}-glm.txt`);
  }
});
