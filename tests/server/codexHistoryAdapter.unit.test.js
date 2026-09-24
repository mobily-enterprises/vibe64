import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { startCodexHistoryAdapter, translateCodexHistory } from "@local/vibe64-runtime/server/codexHistoryAdapter";
import { CodexAppServerAgentProvider } from "@local/vibe64-runtime/server/codexAppServerProvider";

const foreign = { type: "reasoning", id: "foreign-id", encrypted_content: "foreign-opaque-state",
  summary: [{ type: "summary_text", text: "Prior summary" }], content: [{ type: "reasoning_text", text: "Exact history\n  kept intact." }] };

test("history translation preserves every ordinary item, plaintext and native history", () => {
  const body = { model: "gpt-6-astra", input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "Implement it." }] },
    foreign,
    { type: "function_call", call_id: "tool-1", name: "shell_command", arguments: "{}" },
    { type: "function_call_output", call_id: "tool-1", output: "test passed" },
    { type: "reasoning", summary: [], content: [], encrypted_content: "openai-state" }
  ] };
  const original = structuredClone(body);
  const translated = translateCodexHistory(body);
  assert.deepEqual(body, original);
  assert.equal(translated.input.length, body.input.length);
  assert.equal(translated.input[1].role, "assistant");
  assert.ok(translated.input[1].content[0].text.includes("Prior summary\nExact history\n  kept intact."));
  assert.ok(!JSON.stringify(translated).includes("foreign-opaque-state"));
  for (const index of [0, 2, 3, 4]) assert.equal(translated.input[index], body.input[index]);
  assert.throws(() => translateCodexHistory({ input: [{ ...foreign, content: [{ type: "unknown", text: "keep me" }] }] }), /not supported/);
});

test("DeepSeek receives unsupported exec history as context while keeping tools, images and native state intact", () => {
  const call = { type: "custom_tool_call", name: "exec", call_id: "exec-1", input: "text(await tools.exec_command({cmd: 'pwd'}));" };
  const image = { type: "input_image", image_url: "data:image/png;base64,fixture", detail: "original" };
  const output = { type: "custom_tool_call_output", call_id: "exec-1", output: [
    { type: "input_text", text: "Exact output\n  with whitespace" }, image
  ] };
  const previousFailure = { type: "function_call", name: "exec", call_id: "exec-bad", arguments: '{"input":"text(42)"}' };
  const ordinary = { type: "function_call", name: "exec_command", call_id: "shell-1", arguments: '{"cmd":"pwd"}' };
  const patch = { type: "custom_tool_call", name: "apply_patch", call_id: "patch-1", input: "*** Begin Patch\n*** End Patch" };
  const body = { tools: [{ type: "function", name: "exec_command" }], input: [foreign, call, output,
    previousFailure, { type: "function_call_output", call_id: "exec-bad", output: "unsupported call: exec" }, ordinary, patch] };
  const saved = structuredClone(body);
  const translated = translateCodexHistory(body, "deepseek");
  assert.deepEqual(body, saved);
  assert.equal(translated.tools, body.tools);
  for (const index of [0, 5, 6]) assert.equal(translated.input[index], body.input[index]);
  assert.match(translated.input[1].content[0].text, /context only, not an available tool/);
  assert.ok(translated.input[1].content[0].text.includes(JSON.stringify(call)));
  assert.equal(translated.input[2].content[1], output.output[0]);
  assert.equal(translated.input[2].content[2], image);
  assert.ok(translated.input[3].content[0].text.includes(JSON.stringify(previousFailure)));
  assert.equal(translated.input[4].content[1].text, "unsupported call: exec");
  assert.equal(translateCodexHistory(body).input[1], call);
  assert.throws(() => translateCodexHistory({ input: [call, { ...output, output: [{ type: "unknown" }] }] }, "deepseek"), /history is not supported/);
});

test("adapter forwards bounded compressed requests only to fixed provider routes and streams responses", async (t) => {
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return new Response("data: one\n\ndata: two\n\n", { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "upstream-id" } });
  } });
  t.after(() => adapter.close());
  for (const [encoding, encode] of [["identity", Buffer.from], ["gzip", gzipSync], ["zstd", zstdCompressSync]]) {
    const result = await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST",
      headers: { "content-encoding": encoding, authorization: "Bearer native-auth" },
      body: encode(JSON.stringify({ input: [foreign] })) });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-request-id"), "upstream-id");
    assert.equal(await result.text(), "data: one\n\ndata: two\n\n");
    const call = calls.at(-1);
    assert.equal(call.url, "https://chatgpt.com/backend-api/codex/responses");
    assert.equal(call.headers.get("authorization"), "Bearer native-auth");
    assert.equal(call.headers.has("content-encoding"), false);
    assert.equal(call.redirect, "error");
    assert.equal(JSON.parse(call.body).input[0].type, "message");
  }
  const compact = await fetch(`${adapter.baseUrl}/apiKey/responses/compact`, { method: "POST", body: JSON.stringify({ input: [foreign] }) });
  await compact.text();
  assert.equal(calls.at(-1).url, "https://api.openai.com/v1/responses/compact");
  const models = await fetch(`${adapter.baseUrl}/chatgpt/models?client_version=1`);
  await models.text();
  assert.equal(calls.at(-1).url, "https://chatgpt.com/backend-api/codex/models?client_version=1");
  const deepseek = await fetch(`${adapter.baseUrl}/deepseek/responses`, { method: "POST",
    headers: { authorization: "Bearer deepseek-key" }, body: JSON.stringify({ input: [foreign,
      { type: "custom_tool_call", name: "exec", call_id: "exec-1", input: "text(42)" },
      { type: "custom_tool_call_output", call_id: "exec-1", output: "42" }
    ] }) });
  assert.equal(await deepseek.text(), "data: one\n\ndata: two\n\n");
  assert.equal(calls.at(-1).url, "https://api.deepseek.com/responses");
  assert.equal(calls.at(-1).headers.get("authorization"), "Bearer deepseek-key");
  const deepseekHistory = JSON.parse(calls.at(-1).body).input;
  assert.deepEqual(deepseekHistory[0], foreign);
  assert.equal(deepseekHistory[1].type, "message");
  assert.equal(deepseekHistory[2].content[1].text, "42");
  const count = calls.length;
  for (const url of ["/chatgpt/arbitrary", "/https://example.com/responses", "/chatgpt/responses?redirect=https://example.com"]) {
    const result = await fetch(`${adapter.baseUrl}${url}`);
    assert.equal(result.status, 404);
  }
  assert.equal((await fetch(adapter.baseUrl.replace(/[^/]+$/u, "wrong-token") + "/chatgpt/models")).status, 404);
  assert.equal(calls.length, count);
});

test("bad or oversized history fails visibly before upstream admission", async (t) => {
  let called = false;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), maxRequestBytes: 512,
    fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  t.after(() => adapter.close());
  for (const [body, headers, status] of [
    ["not JSON", {}, 400],
    ["x".repeat(600), {}, 413],
    [gzipSync("x".repeat(10000)), { "content-encoding": "gzip" }, 400],
    [JSON.stringify({ input: [{ ...foreign, summary: [{ type: "unknown", text: "preserve" }] }] }), {}, 422]
  ]) {
    const response = await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST", body, headers });
    assert.equal(response.status, status);
    assert.match((await response.json()).error.message, /history/i);
  }
  assert.equal(called, false);
});

test("native disconnection aborts upstream once without retrying or buffering the stream", { timeout: 5000 }, async (t) => {
  const aborted = Promise.withResolvers();
  let attempts = 0;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async (_url, { signal }) => {
    attempts += 1;
    signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: first\n\n")); } }));
  } });
  t.after(() => adapter.close());
  await new Promise((resolve, reject) => {
    const req = request(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST" }, (res) => {
      res.once("data", () => { req.destroy(); resolve(); });
    });
    req.once("error", reject);
    req.end('{"input":[]}');
  });
  await aborted.promise;
  assert.equal(attempts, 1);
});

test("upstream stream failure closes native delivery and leaves the adapter usable", async (t) => {
  let attempts = 0;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async () => {
    attempts += 1;
    if (attempts > 1) return new Response("next request");
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error("private upstream detail")); } }));
  } });
  t.after(() => adapter.close());
  await assert.rejects(async () => (await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST", body: '{"input":[]}' })).text());
  assert.equal(await (await fetch(`${adapter.baseUrl}/chatgpt/models`)).text(), "next request");
  assert.equal(attempts, 2);
});

test("native OpenAI account selects its upstream without changing provider or external model credentials", async () => {
  const provider = new CodexAppServerAgentProvider();
  provider.runtime = { historyAdapterBaseUrl: `http://127.0.0.1:23456/${randomUUID()}` };
  for (const type of ["chatgpt", "apiKey"]) {
    const params = await provider.withHistoryAdapter({ modelProvider: "openai", config: { web_search: "disabled" } }, {
      request: async (method) => { assert.equal(method, "account/read"); return { account: { type } }; }
    });
    assert.equal(params.modelProvider, "openai");
    assert.equal(params.config.openai_base_url, `${provider.runtime.historyAdapterBaseUrl}/${type}`);
    assert.equal(params.config.web_search, "disabled");
  }
  const external = { modelProvider: "deepseek", config: { "model_providers.deepseek": { experimental_bearer_token: "external-key" } } };
  assert.equal(await provider.withHistoryAdapter(external, { request() { throw new Error("must not read OpenAI auth"); } }), external);
  const curated = { modelProvider: "deepseek", config: { "model_providers.deepseek": {
    base_url: "https://api.deepseek.com/", experimental_bearer_token: "external-key", wire_api: "responses"
  }, web_search: "disabled" } };
  const translated = await provider.withHistoryAdapter(curated, { request() { throw new Error("must not read OpenAI auth"); } });
  assert.equal(translated.config["model_providers.deepseek"].base_url, `${provider.runtime.historyAdapterBaseUrl}/deepseek`);
  assert.equal(translated.config["model_providers.deepseek"].experimental_bearer_token, "external-key");
  assert.equal(translated.config.web_search, "disabled");
  assert.equal(curated.config["model_providers.deepseek"].base_url, "https://api.deepseek.com/");
  await assert.rejects(provider.withHistoryAdapter({ modelProvider: "openai" }, { request: async () => ({ account: null }) }), /Reconnect/);
});

test("managed process owns adapter lifetime and drains it with native shutdown", { timeout: 10000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-adapter-lifetime-"));
  const fixture = path.join(root, "native.mjs");
  await writeFile(fixture, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000);');
  const processPath = fileURLToPath(import.meta.resolve("@local/vibe64-runtime/server/codexAppServerProcess"));
  const child = spawn(process.execPath, [processPath, root, process.execPath, fixture, path.join(root, "native.pid")], {
    env: { ...process.env, VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: randomUUID() }, stdio: "ignore"
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); });
  let nativePid;
  for (let i = 0; i < 100; i += 1) {
    nativePid = await readFile(path.join(root, "native.pid"), "utf8").catch(() => "");
    if (nativePid) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(nativePid);
  const { baseUrl } = JSON.parse(await readFile(path.join(root, "history-adapter.json"), "utf8"));
  assert.equal((await fetch(`${baseUrl}/not-an-upstream`)).status, 404);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
  assert.throws(() => process.kill(Number(nativePid), 0), { code: "ESRCH" });
  await assert.rejects(fetch(`${baseUrl}/not-an-upstream`));
  await assert.rejects(readFile(path.join(root, "history-adapter.json")), { code: "ENOENT" });
});
