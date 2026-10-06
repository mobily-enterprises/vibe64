import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync, zstdDecompressSync } from "node:zlib";
import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/testing/native-codex";

import { CodexAppServerAgentProvider, startCodexAppServerProcess } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { codexAppServerProjectHookTrustConfig } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
const version = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5000 });

test("native Codex code-mode commands enter the session execution wrapper", {
  skip: version.status !== 0 ? "Codex CLI is not installed" : false, timeout: 30_000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-shell-hook-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "work");
  const socket = path.join(root, "app-server.sock");
  const wrapper = path.join(root, "session-wrapper");
  await mkdir(home);
  await mkdir(cwd);
  await writeFile(wrapper, '#!/bin/sh\nexport VIBE64_EXECUTION_ID=owned-session-command\nexec /bin/sh -c "$1"\n', { mode: 0o700 });
  let child, client, stderr = "", fixtureError, sequence = 0;
  const events = [];
  const api = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let raw = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "zstd") raw = zstdDecompressSync(raw);
      if (request.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      const body = JSON.parse(raw);
      const called = body.input.some((item) => item.type === "custom_tool_call_output");
      const tools = [...(body.tools || []), ...body.input.filter((item) => item.type === "additional_tools").flatMap((item) => item.tools || [])]
        .flatMap((tool) => tool.type === "namespace" ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name })) : [tool]);
      const tool = tools.find((entry) => entry.name === "exec");
      assert.ok(tool, "This regression must exercise code-mode exec_command");
      const id = `fixture-${++sequence}`;
      const args = { cmd: 'printf "%s" "$VIBE64_EXECUTION_ID" > owner.txt', login: false };
      const item = called
        ? { id, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] }
        : { id, call_id: id, type: "custom_tool_call", name: tool.name, namespace: tool.namespace,
          input: `text(await tools.exec_command(${JSON.stringify(args)}));`, status: "completed" };
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
    } catch (error) { fixtureError = error; response.writeHead(500).end(); }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    client?.close();
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      process.kill(-child.pid, "SIGTERM");
      await exited;
    }
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(home, "config.toml"), [
    'model_provider="probe"', 'model="gpt-6-astra"', 'check_for_update_on_startup=false', 'web_search="disabled"',
    '[model_providers.probe]', 'name="probe"', `base_url="http://127.0.0.1:${api.address().port}/v1"`,
    'wire_api="responses"', 'requires_openai_auth=false', 'supports_websockets=false'
  ].join("\n"));
  // Capture the production launcher's argv before starting a real native server.
  // Keep a trailing -c like the model-catalogue process wrapper: mixed placement
  // silently lost the command hook in Codex (openai/codex#39012).
  let nativeArgs;
  const captured = new Error("captured launch arguments");
  await assert.rejects(startCodexAppServerProcess({
    runtimeDir: root, codexCommand: "codex", authStateSignature: "fixture-auth",
    commandRunner: async (request) => {
      nativeArgs = request.args.slice(request.args.indexOf("codex") + 1);
      throw captured;
    }
  }), (error) => error === captured);
  child = spawn("codex", [...nativeArgs, "-c", "features.remote_control=false", "-c", "features.plugins=false", "-c", "features.remote_plugin=false"], {
    cwd, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: "C.UTF-8" }, stdio: ["ignore", "ignore", "pipe"], detached: true
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (!await predicate()) {
      if (fixtureError) throw fixtureError;
      assert.ok(Date.now() < deadline, `${label}: ${stderr.slice(-2000)}`);
      await delay(20);
    }
  };
  await waitFor(() => access(socket).then(() => true, () => false), "socket");
  client = new CodexAppServerJsonRpcClient({ endpoint: `unix://${socket}`, requestTimeoutMs: 10000 });
  await client.connect();
  await client.initialize();
  client.subscribe((event) => events.push(event));
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => client;
  const config = await codexAppServerProjectHookTrustConfig(provider, cwd);
  assert.ok(config?.["hooks.state"]?.["/<session-flags>/config.toml:pre_tool_use:0:0"], "Native Codex must discover and trust the managed hook");
  const { thread } = await client.request("thread/start", { cwd, model: "gpt-6-astra", modelProvider: "probe",
    approvalPolicy: "never", sandbox: "danger-full-access",
    config: { ...config, shell_environment_policy: { inherit: "none", set: { PATH: process.env.PATH, VIBE64_WRAPPER: wrapper } } } });
  const { turn } = await client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Run the ownership probe." }] });
  await waitFor(() => events.some((event) => event.method === "turn/completed" && event.params.turn.id === turn.id), "turn completion");
  assert.equal(await readFile(path.join(cwd, "owner.txt"), "utf8"), "owned-session-command");
  t.diagnostic(version.stdout.trim());
});
