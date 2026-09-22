import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { zstdDecompressSync, gunzipSync } from "node:zlib";
import { createCodexProviderConnectionStore, codexProviderPaths } from "@local/vibe64-core/server/codexProviderConnections";
import { createCodexTerminalController } from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import { createCodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { startCodexAppServerEconomyThread, sendCodexAppServerEconomyTurn } from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";
import { resolveCodexEconomyExecutionProfile } from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";
import { VIBE64_AGENT_EXECUTION_WORKLOAD_IDS, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";

const version = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5000 });

test("native Codex isolates GPT, DeepSeek and GLM keys, models, tools and persisted threads", {
  skip: version.status !== 0 ? "Codex CLI is not installed" : false, timeout: 60000
}, async (t) => {
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "curated-fixture";
  t.after(() => { if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE; else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace; });
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-curated-"));
  const home = path.join(root, "openai");
  const source = path.join(root, "managed", "sessions", "active", "test-session", "source");
  const systemRoot = path.join(root, "system");
  const codexHome = path.join(home, ".codex");
  await mkdir(codexHome, { recursive: true });
  await mkdir(source, { recursive: true });
  const children = [], providers = [], requests = [];
  let stderr = "";
  const api = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let data = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "zstd") data = zstdDecompressSync(data);
      if (request.headers["content-encoding"] === "gzip") data = gunzipSync(data);
      const body = JSON.parse(data.toString());
      const key = request.headers.authorization;
      const count = requests.filter((r) => r.key === key).length;
      requests.push({ key, body, count });
      const id = requests.length;
      let item;
      if (count === 0) {
        const tools = [...(body.tools || []), ...body.input.filter((item) => item.type === "additional_tools").flatMap((item) => item.tools || [])];
        const functions = tools.flatMap((tool) => tool.type === "namespace" ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name })) : [tool]);
        const tool = functions.find((tool) => ["shell_command", "exec_command", "shell", "exec"].includes(tool.name));
        assert.ok(tool, `Missing command tool: ${JSON.stringify(body.tools?.map((t) => [t.type, t.name]))}`);
        const command = `printf 'fixture' > ${body.model}.txt`;
        const args = tool.name === "exec_command" ? { cmd: command } : tool.name === "shell" ? { command: ["bash", "-lc", command] } : { command };
        item = { id: `call-${id}`, call_id: `call-${id}`, type: tool.type === "custom" ? "custom_tool_call" : "function_call", name: tool.name, namespace: tool.namespace,
          ...(tool.type === "custom" ? { input: `text(await tools.exec_command(${JSON.stringify({ cmd: command })}))` } : { arguments: JSON.stringify(args) }), status: "completed" };
      } else {
        item = { id: `message-${id}`, type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: body.text?.format?.type === "json_schema" ? JSON.stringify({ answer: "OK" }) : `DONE_${body.model}`, annotations: [] }] };
      }
      requests.at(-1).fixtureItem = item;
      const result = { id: `response-${id}`, object: "response", created_at: 1788797000, status: "completed",
        output: [item], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress" } },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result }
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) {
      stderr += `\nFixture: ${error.message}`;
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = `http://127.0.0.1:${api.address().port}/v1`;
  await writeFile(path.join(codexHome, "config.toml"), [
    'model_provider = "fixture-openai"', 'model = "gpt-5.6-luna"', 'cli_auth_credentials_store = "file"',
    '[model_providers.fixture-openai]', 'name = "OpenAI fixture"', `base_url = "${fixtureUrl}"`,
    'wire_api = "responses"', 'requires_openai_auth = true', 'supports_websockets = false'
  ].join("\n"));
  const login = spawnSync("codex", ["login", "--with-api-key"], { input: "fixture-gpt", encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome }, timeout: 5000 });
  assert.equal(login.status, 0, login.stderr);
  const originalAuth = await readFile(path.join(codexHome, "auth.json"), "utf8");
  const session = { sessionId: "test-session", status: "active", sourceReady: true, metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" } };
  const store = createVibe64SessionStore({ projectContextRoot: source, projectRuntimeRoot: path.join(root, "state") });
  await store.createSession({ sessionId: session.sessionId, metadata: session.metadata, runtimeKind: "genesis" });
  const projectService = {
    createSessionStore: () => store,
    createRuntime: () => ({ store, getSession: () => session, projectContextRoot: source, stateRoot: path.join(root, "state") }),
    projectInspectionEnvironment: async () => ({}), currentTargetRoot: () => source
  };
  async function commandRunner(request) {
    const requestHome = request.credentialHome?.home || home;
    const child = spawn(request.command, request.args, { cwd: request.cwd,
      env: { ...request.baseEnv, PATH: process.env.PATH, HOME: requestHome, CODEX_HOME: request.baseEnv.CODEX_HOME || path.join(requestHome, ".codex"), RUST_LOG: "error" },
      detached: true, stdio: ["ignore", "ignore", "pipe"] });
    children.push(child);
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16000); });
    return { ok: true, pid: child.pid, execution: { id: `curated-${child.pid}` } };
  }
  const controller = createCodexTerminalController({ codexToolHomeSource: home,
    codexAppServerProviderOptions: { systemRoot },
    env: { VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agents"), VIBE64_RUNTIME_NAMESPACE: "curated-fixture" },
    projectService, codexAppServerProviderFactory(options) {
      const provider = createCodexAppServerAgentProvider({ ...options, codexCommand: "codex", commandRunner });
      providers.push(provider); return provider;
    }
  });
  t.after(async () => {
    await controller.invalidateAppServerRuntimes({ reason: "server-shutdown" });
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const connections = createCodexProviderConnectionStore({ systemRoot,
    fetchImpl: async () => new Response(JSON.stringify({ id: "checked", output: [], status: "completed" })),
    invalidateRuntimes: (input) => controller.invalidateAppServerRuntimes(input) });
  const threads = new Map(), runtimes = new Map();
  for (const [id, model] of [["openai", "gpt-5.6-luna"], ["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"], ["openai", "gpt-5.6-luna"]]) {
    if (id !== "openai") {
      await connections.change(id, { apiKey: `fixture-${id}` });
      // Only the fixture changes the fixed production URL; no product API accepts this setting.
      const configPath = path.join(codexProviderPaths(systemRoot, id).codexHome, "config.toml");
      await writeFile(configPath, (await readFile(configPath, "utf8")).replace(/base_url = "[^"]+"/u, `base_url = "${fixtureUrl}"`));
      assert.equal(await readFile(path.join(codexHome, "auth.json"), "utf8"), originalAuth);
    }
    session.metadata.assistant_selection = serializeVibe64AssistantSelection({ engineId: "codex", agentId: "codex", modelProviderId: id,
      modelId: model, variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` });
    await controller.describeProvider(session.sessionId);
    const provider = providers.findLast((candidate) => (candidate.options.modelProviderId || "openai") === id);
    await provider.connect();
    const runtime = provider.runtime;
    if (runtimes.has(id)) assert.equal(runtime.pid, runtimes.get(id).pid, "returning to GPT retains its running service");
    runtimes.set(id, runtime);
    let threadId = threads.get(id);
    if (threadId) assert.equal((await provider.resumeThread(threadId, { cwd: source })).id, threadId);
    else {
      threadId = (await provider.startThread({ cwd: source, model, approvalPolicy: "never", sandbox: "danger-full-access" })).id;
      threads.set(id, threadId);
    }
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Turn timed out: ${stderr}`)); }, 12000);
      const unsubscribe = provider.subscribe((event) => {
        if (event.method === "turn/completed" && event.params.threadId === threadId) {
          clearTimeout(timer); unsubscribe(); resolve(event.params.turn);
        }
      });
    });
    await provider.sendTurn(threadId, ["Write the fixture file, then finish."], { cwd: source, model,
      approvalPolicy: "never", sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } });
    const turn = await completed;
    assert.equal(turn.status, "completed", `${JSON.stringify(turn)}\n${stderr}`);
    assert.equal(requests.at(-1).key, `Bearer fixture-${id === "openai" ? "gpt" : id}`);
    assert.equal(requests.at(-1).body.model, model);
    assert.equal(await readFile(path.join(source, `${model}.txt`), "utf8").catch(() => JSON.stringify({ requests: requests.map((r) => ({ count: r.count, model: r.body.model, input: r.body.input.map((i) => [i.type, i.role, i.output]), fixtureItem: r.fixtureItem })), turnItems: turn.items })), "fixture");
  }
  assert.equal(new Set([...runtimes.values()].map(({ pid }) => pid)).size, 3);
  for (const id of ["deepseek", "zai-coding-plan"]) {
    const interactive = providers.find((candidate) => candidate.options.modelProviderId === id);
    const helper = createCodexAppServerAgentProvider({ ...interactive.options,
      executionMode: "economy", runtimeDir: path.join(root, `codex-app-server-helper-${id}`), runtimeInstanceId: `codex-app-server-helper-${id}` });
    providers.push(helper);
    try {
      await helper.connect();
      const catalog = await helper.listModels({ includeHidden: false, limit: 100 });
      const helperModel = id === "deepseek" ? "deepseek-flash" : "glm-5.3";
      assert.ok(catalog.data.some((model) => model.model === helperModel));
      const executionProfile = resolveCodexEconomyExecutionProfile({ profileId: "economy", workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION }, catalog, helperModel);
      const thread = await startCodexAppServerEconomyThread({ provider: helper, executionProfile });
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("Helper turn timed out")); }, 12000);
        const unsubscribe = helper.subscribe((event) => {
          if (event.method === "turn/completed" && event.params.threadId === thread.threadId) {
            clearTimeout(timer); unsubscribe(); resolve(event.params.turn);
          }
        });
      });
      await sendCodexAppServerEconomyTurn({ provider: helper, executionProfile, threadId: thread.threadId,
        prompt: "Return the JSON answer OK.", outputSchema: { type: "object", additionalProperties: false,
          properties: { answer: { type: "string", maxLength: 20 } }, required: ["answer"] } });
      assert.equal((await completed).status, "completed");
      assert.equal(requests.at(-1).key, `Bearer fixture-${id}`);
      assert.equal(requests.at(-1).body.model, helperModel);
      assert.deepEqual(requests.at(-1).body.tools, []);
      await helper.deleteThread(thread.threadId);
      const isolatedConfig = await readFile(path.join(root, `codex-app-server-helper-${id}`, "codex-home", "config.toml"), "utf8");
      assert.match(isolatedConfig, new RegExp(`fixture-${id}`));
      assert.doesNotMatch(isolatedConfig, /fixture-gpt/);
      await assert.rejects(readFile(path.join(root, `codex-app-server-helper-${id}`, "codex-home", "auth.json")), { code: "ENOENT" });
    } catch (error) {
      t.diagnostic(`Helper startup: ${error.stack}\n${stderr}`);
      throw error;
    } finally {
      if (helper.runtime) {
        const stopped = await helper.stopRuntime();
        assert.ok(stopped.processExitVerified || stopped.runtimeDirRemoved || stopped.stopped, JSON.stringify(stopped));
      }
      helper.close();
    }
  }
  const gpt = runtimes.get("openai");
  await connections.change("deepseek", { remove: true });
  assert.doesNotThrow(() => process.kill(gpt.pid, 0), "disconnecting DeepSeek must not stop GPT");
  assert.equal(await readFile(path.join(codexHome, "auth.json"), "utf8"), originalAuth);
  assert.equal((await providers.find((provider) => !provider.options.modelProviderId).listThreadTurns(threads.get("openai"), { limit: 10, itemsView: "full" })).data.length, 2);
  t.diagnostic(`${version.stdout.trim()}: three isolated providers, command execution, GPT thread resumed, DeepSeek disconnected without changing GPT.`);
});
