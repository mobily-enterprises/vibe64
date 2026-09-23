import { codexHistoryAdapterFixture } from "../fixtures/codexHistoryAdapterFixture.js";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAccountsRuntime, createService as createAccountsService } from "../../packages/vibe64-accounts/src/server/service.js";
import { createCodexTerminalController } from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import { createCodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";

const version = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5_000 });

test("native account logout and credential restoration drain old processes and continue one thread", {
  skip: version.status !== 0 ? "Codex CLI is not installed" : false,
  timeout: 60_000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-auth-"));
  const toolHome = path.join(root, "home");
  const codexHome = path.join(toolHome, ".codex");
  const systemRoot = path.join(root, "system");
  const source = path.join(root, "managed", "sessions", "active", "session-1", "source");
  await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(source, { recursive: true })]);
  assert.equal(spawnSync("git", ["init", "--quiet", source]).status, 0);
  const credentialPath = path.join(codexHome, "auth.json");
  const nativeEnv = { PATH: process.env.PATH, HOME: toolHome, CODEX_HOME: codexHome, RUST_LOG: "error" };
  const requests = [];
  const credentials = new Map();
  const children = [];
  const providers = [];
  let stderr = "";
  const api = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    if (!request.url.endsWith("/responses")) {
      response.writeHead(404).end();
      return;
    }
    requests.push(request.headers.authorization);
    const id = requests.length;
    const item = {
      id: `message-${id}`, type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: `HANDOVER_OK_${id}`, annotations: [] }]
    };
    const result = {
      id: `response-${id}`, object: "response", created_at: 1_788_797_000, status: "completed",
      output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    };
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: `HANDOVER_OK_${id}` },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result }
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const adapterOptions = await codexHistoryAdapterFixture(root, `http://127.0.0.1:${api.address().port}`);
  await writeFile(path.join(codexHome, "config.toml"), [
    'model_provider = "handover"',
    'model = "gpt-5.6-luna"',
    'cli_auth_credentials_store = "file"',
    'check_for_update_on_startup = false',
    '[model_providers.handover]',
    'name = "Local handover test"',
    `base_url = "http://127.0.0.1:${api.address().port}/v1"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    'supports_websockets = false'
  ].join("\n"));
  const session = {
    sessionId: "session-1", status: "active", sourceReady: true,
    metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" }
  };
  const store = createVibe64SessionStore({
    projectContextRoot: source,
    projectRuntimeRoot: path.join(root, "project-state")
  });
  await store.createSession({ sessionId: session.sessionId, metadata: session.metadata, runtimeKind: "genesis" });
  const projectService = {
    createSessionStore: () => store,
    createRuntime: () => ({
      getSession: async () => session,
      projectContextRoot: source,
      stateRoot: path.join(root, "project-state")
    }),
    projectInspectionEnvironment: async () => ({}),
    currentTargetRoot: () => source
  };
  // Only the host command transport is replaced: runtime ownership, process
  // identity checks, account transitions and JSON-RPC use production code.
  async function commandRunner(request) {
    const commandEnv = { ...request.baseEnv, ...nativeEnv, NODE_OPTIONS: adapterOptions };
    if (request.mode === "capture") {
      const result = spawnSync("codex", request.args, {
        cwd: request.cwd, env: commandEnv, encoding: "utf8", timeout: 10_000
      });
      return { ok: result.status === 0, exitCode: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
    }
    const child = spawn(request.command, request.args, {
      cwd: request.cwd, env: commandEnv, detached: true, stdio: ["ignore", "ignore", "pipe"]
    });
    children.push(child);
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8_000); });
    return { ok: true, pid: child.pid, execution: { id: `native-${child.pid}` } };
  }
  const controller = createCodexTerminalController({
    codexToolHomeSource: toolHome,
    codexAppServerProviderOptions: { systemRoot },
    env: { VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agents"), VIBE64_RUNTIME_NAMESPACE: "native-handover" },
    projectService,
    codexAppServerProviderFactory(options) {
      const provider = createCodexAppServerAgentProvider({ ...options, codexCommand: "codex", commandRunner });
      providers.push(provider);
      return provider;
    }
  });
  const accounts = createAccountsService({
    accountRuntime: createAccountsRuntime({ daemonHome: toolHome, systemRoot }),
    projectService,
    invalidateAgentRuntimes: (input) => controller.invalidateAppServerRuntimes(input),
    runHostToolCommand: async (args) => {
      const result = spawnSync("codex", args.slice(1), { env: nativeEnv, encoding: "utf8", timeout: 10_000 });
      return { ok: result.status === 0, output: `${result.stdout || ""}${result.stderr || ""}` };
    }
  });
  function assertDrained(child) {
    assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" }, `process group ${child.pid} survived`);
  }
  t.after(async () => {
    await controller.invalidateAppServerRuntimes({ reason: "server-shutdown" });
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  t.diagnostic(version.stdout.trim());
  let threadId = "";
  let previousSignature = "";
  for (const [index, key] of ["fixture-account-a", "fixture-account-b", "fixture-account-a"].entries()) {
    if (index > 0) {
      const loggedOut = await accounts.logout({ accountId: "codex" });
      assert.equal(loggedOut.ok, true, JSON.stringify(loggedOut));
      assert.equal(loggedOut.account.connected, false);
      await assert.rejects(readFile(credentialPath), { code: "ENOENT" });
      children.forEach(assertDrained);
    }
    if (credentials.has(key)) {
      await writeFile(credentialPath, credentials.get(key), { mode: 0o600 });
    } else {
      const login = spawnSync("codex", ["login", "--with-api-key"], {
        env: nativeEnv, encoding: "utf8", input: key, timeout: 10_000
      });
      assert.equal(login.status, 0, login.stderr);
      credentials.set(key, await readFile(credentialPath));
    }
    const loggedIn = await accounts.getCodexStatus();
    assert.equal(loggedIn.ok, true, JSON.stringify(loggedIn));
    assert.equal(loggedIn.account.connected, true, JSON.stringify(loggedIn));
    const beforeCatalog = children.length;
    await Promise.all([controller.modelCatalog(), controller.modelCatalog()]);
    assert.equal(children.length, beforeCatalog + 1, "one catalog probe per login");
    children.forEach(assertDrained);
    const description = await controller.describeProvider(session.sessionId);
    assert.notEqual(description.accountIdentitySignature, previousSignature);
    previousSignature = description.accountIdentitySignature;
    const provider = providers.at(-1);
    if (!threadId) {
      threadId = (await provider.startThread({
        cwd: source, model: "gpt-5.6-luna", approvalPolicy: "never", sandbox: "read-only", historyMode: "paginated"
      })).id;
    } else {
      assert.equal((await provider.resumeThread(threadId, { cwd: source })).id, threadId);
    }
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Turn timed out: ${stderr}`)); }, 10_000);
      const unsubscribe = provider.subscribe((event) => {
        if (event.method === "turn/completed" && event.params.threadId === threadId) {
          clearTimeout(timer);
          unsubscribe();
          resolve(event.params.turn);
        }
      });
    });
    const sent = await provider.sendTurn(threadId, [`Reply HANDOVER_OK_${index + 1}`], {
      cwd: source, model: "gpt-5.6-luna", approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }
    });
    const turn = await completed;
    assert.equal(turn.id, sent.id);
    assert.equal(turn.status, "completed", JSON.stringify(turn));
    assert.equal(requests.at(-1), `Bearer ${key}`);
    assert.equal(requests.length, index + 1, "no duplicate delivery during handover");
    const history = await provider.listThreadTurns(threadId, { limit: 10, itemsView: "full" });
    assert.equal(history.data.length, index + 1);
    assert.match(JSON.stringify(history.data[0].items), /HANDOVER_OK/u);
  }
  const stopped = await controller.invalidateAppServerRuntimes({ reason: "server-shutdown" });
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  children.forEach(assertDrained);
  t.diagnostic(`Three credential restorations, two logouts, ${children.length} native processes verified drained, one continued thread.`);
});
