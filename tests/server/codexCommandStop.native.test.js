import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync, zstdDecompressSync } from "node:zlib";
import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/server/codex-client";
import { CodexAppServerAgentProvider } from "@local/vibe64-runtime/server/codexAppServerProvider";

const version = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5000 });

test("native Codex Stop kills current and late commands while preserving other work and its thread", {
  skip: version.status !== 0 ? "Codex CLI is not installed" : false, timeout: 60000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-command-stop-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "work");
  const socket = path.join(root, "s.sock");
  await mkdir(home);
  await mkdir(cwd);
  const notifications = [];
  const delayedStarts = [];
  const threads = [];
  const provider = new CodexAppServerAgentProvider({});
  let child, client, sequence = 0, stderr = "", delayCommandStart = false;
  const exists = (file) => access(path.join(cwd, file)).then(() => true, () => false);
  async function waitFor(predicate, label) {
    const until = Date.now() + 10000;
    while (!await predicate()) {
      assert.ok(Date.now() < until, `Timed out: ${label}; ${stderr.slice(-2000)}`);
      await delay(10);
    }
  }
  // Only the model transport is controlled. Codex really starts and stops these
  // processes through its ordinary exec_command tool, including code-mode calls.
  const api = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let raw = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "zstd") raw = zstdDecompressSync(raw);
      if (request.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      const body = JSON.parse(raw);
      const lastUser = body.input.findLastIndex((item) => item.role === "user");
      const label = JSON.stringify(body.input[lastUser]).match(/PROBE_(prior|other|current|late|followup)/)?.[1];
      assert.ok(label);
      const called = body.input.slice(lastUser + 1).some((item) => ["function_call_output", "custom_tool_call_output"].includes(item.type));
      const id = ++sequence;
      let item;
      if (!called && label !== "followup") {
        const tools = [...(body.tools || []), ...body.input.filter((item) => item.type === "additional_tools").flatMap((item) => item.tools || [])]
          .flatMap((tool) => tool.type === "namespace" ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name })) : [tool]);
        const tool = tools.find((entry) => ["exec_command", "exec"].includes(entry.name));
        assert.ok(tool, "Native command tool must be available");
        const background = ["prior", "other"].includes(label);
        const args = {
          cmd: `python3 -c "from pathlib import Path; import time; Path('${label}.started').write_text('STARTED'); time.sleep(${background ? 50 : 4}); Path('${label}.finished').write_text('FINISHED')"`,
          yield_time_ms: background ? 1000 : 30000
        };
        item = {
          id: `call-${id}`, call_id: `call-${id}`, type: tool.type === "custom" ? "custom_tool_call" : "function_call",
          name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), status: "completed",
          ...(tool.type === "custom" ? { input: `text(await tools.exec_command(${JSON.stringify(args)}))` } : { arguments: JSON.stringify(args) })
        };
      } else item = { id: `msg-${id}`, type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: `DONE_${label}`, annotations: [] }] };
      const result = { id: `resp-${id}`, object: "response", created_at: 1788797000, status: "completed", output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress" } },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result }
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) {
      stderr += `\nFixture: ${error.stack}`;
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const threadId of threads) await client?.request("thread/backgroundTerminals/clean", { threadId }).catch(() => null);
    client?.close();
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      process.kill(-child.pid, "SIGTERM");
      await exited;
    }
    provider.close();
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(home, "config.toml"), [
    'model_provider="probe"', 'model="gpt-6-astra"', 'check_for_update_on_startup=false', 'web_search="disabled"',
    '[model_providers.probe]', 'name="probe"', `base_url="http://127.0.0.1:${api.address().port}/v1"`,
    'wire_api="responses"', 'requires_openai_auth=false', 'supports_websockets=false'
  ].join("\n"));
  child = spawn("codex", ["app-server", "--listen", `unix://${socket}`, "-c", "features.remote_control=false", "-c", "features.plugins=false", "-c", "features.remote_plugin=false"], {
    cwd, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: "C.UTF-8" }, stdio: ["ignore", "ignore", "pipe"], detached: true
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await waitFor(() => access(socket).then(() => true, () => false), "socket");
  client = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socket}`, requestTimeoutMs: 10000 });
  await client.connect();
  await client.initialize();
  provider.client = client;
  provider.activeClient = async () => client;
  client.subscribe((event) => {
    notifications.push(event);
    if (delayCommandStart && event.method === "item/started" && event.params.item.type === "commandExecution") {
      delayedStarts.push(event);
    } else provider.publishNotification(event);
  });
  async function startThread() {
    const { thread } = await client.request("thread/start", { cwd, model: "gpt-6-astra", modelProvider: "probe", approvalPolicy: "never", sandbox: "danger-full-access" });
    threads.push(thread.id);
    return thread.id;
  }
  const send = async (threadId, label) => (await client.request("turn/start", { threadId, input: [{ type: "text", text: `PROBE_${label}` }] })).turn.id;
  const completed = (turnId) => notifications.some((event) => event.method === "turn/completed" && event.params.turn.id === turnId);
  const main = await startThread();
  const other = await startThread();
  const priorTurn = await send(main, "prior");
  await waitFor(() => completed(priorTurn), "prior background turn");
  const otherTurn = await send(other, "other");
  await waitFor(() => completed(otherTurn), "other conversation");
  for (const label of ["current", "late"]) {
    delayCommandStart = label === "late";
    const turnId = await send(main, label);
    await waitFor(() => exists(`${label}.started`), `${label} process startup`);
    if (label === "current") await waitFor(() => provider.commandExecutions.size === 3, "native command notification");
    else await waitFor(() => delayedStarts.length === 1, "delayed native command notification");
    await provider.interruptTurn(main, turnId);
    // Model command execution is native; delay only delivery of its start event
    // to deterministically exercise the observed post-interrupt notification race.
    delayCommandStart = false;
    for (const event of delayedStarts.splice(0)) provider.publishNotification(event);
    await waitFor(() => completed(turnId), "interrupted turn");
    await delay(4500);
    assert.equal(await exists(`${label}.finished`), false, "The interrupted command must not finish later");
    assert.equal(provider.observationFailure, undefined);
    const remaining = await client.request("thread/backgroundTerminals/list", { threadId: main });
    assert.equal(remaining.data.length, 1);
    assert.match(remaining.data[0].command, /prior\.started/);
    const foreign = await client.request("thread/backgroundTerminals/list", { threadId: other });
    assert.equal(foreign.data.length, 1);
    assert.match(foreign.data[0].command, /other\.started/);
  }
  const followup = await send(main, "followup");
  await waitFor(() => completed(followup), "follow-up in original thread");
  assert.equal(child.exitCode, null, "Stop must keep the native process available");
  assert.ok(notifications.some((event) => event.method === "item/completed" && event.params.threadId === main && event.params.item.text === "DONE_followup"));
  t.diagnostic(version.stdout.trim());
});
