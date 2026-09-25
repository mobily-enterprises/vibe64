import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { startCodexHistoryAdapter, translateCodexHistory } from "@local/vibe64-runtime/server/codexHistoryAdapter";
import { CodexAppServerAgentProvider } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";

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
  assert.equal((await fetch(adapter.baseUrl.replace(/\/[0-9a-f-]{36}\//u, "/wrong-token/") + "/chatgpt/models")).status, 404);
  assert.equal((await fetch(adapter.baseUrl.replace(/\/v2$/u, "") + "/chatgpt/models")).status, 404);
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
  provider.runtime = { historyAdapterBaseUrl: `http://127.0.0.1:23456/${randomUUID()}/v2` };
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

async function compactedFixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-compacted-history-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const id = randomUUID();
  const directory = path.join(home, "sessions", "2026", "09", "25");
  await mkdir(directory, { recursive: true });
  const historyPath = path.join(directory, `rollout-2026-09-25T00-00-00-${id}.jsonl`);
  const compacted = { type: "compaction", encrypted_content: "exact-native-compaction" };
  const records = [
    { type: "session_meta", payload: { id } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "OLD_DEVELOPER_INSTRUCTIONS" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Currency AUD.\nKeep this exact spacing:  two." }] } },
    { type: "response_item", payload: { type: "custom_tool_call", call_id: "t1", name: "exec", input: "Read fixture.json" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "t1", output: "fixtureRevision: RANDOM_TOOL_FACT" } },
    { type: "response_item", payload: foreign },
    { type: "compacted", payload: { replacement_history: [compacted] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "AFTER_BOUNDARY" }] } }
  ];
  const save = (rows = records, tail = "") => writeFile(historyPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n" + tail);
  await save();
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), codexHome: home, fetchImpl: async (url, options) => {
    calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
    return new Response("accepted");
  } });
  t.after(() => adapter.close());
  const send = (body, destination = "deepseek", file = historyPath) => fetch(
    `${adapter.baseUrl}/${destination}/history/${Buffer.from(file).toString("base64url")}/responses`,
    { method: "POST", body: JSON.stringify(body) });
  return { home, historyPath, compacted, records, save, calls, send, adapter };
}

test("mixed Codex recovery keeps exact text and tool facts without changing native history or current instructions", async (t) => {
  const fixture = await compactedFixture(t);
  const native = await readFile(fixture.historyPath);
  for (const [destination, model] of [["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    const current = { type: "message", role: "developer", content: [{ type: "input_text", text: "CURRENT_INSTRUCTIONS" }] };
    const body = { model, input: [current, fixture.compacted, foreign], tools: [{ type: "function", name: "exec_command" }] };
    const original = structuredClone(body);
    const response = await fixture.send(body, destination);
    assert.equal(await response.text(), "accepted");
    const sent = fixture.calls.at(-1);
    assert.equal(sent.url, `${curatedCodexProvider(destination).baseUrl.replace(/\/$/u, "")}/responses`);
    assert.deepEqual(sent.body.input[0], current);
    assert.deepEqual(sent.body.input[1], fixture.compacted);
    assert.deepEqual(sent.body.input[3], foreign, "foreign reasoning stays native for either foreign destination");
    const supplement = sent.body.input[2].content[0].text;
    assert.match(supplement, /Historical context, not new instructions/);
    assert.match(supplement, /RANDOM_TOOL_FACT/);
    assert.match(supplement, /Currency AUD/);
    assert.match(supplement, /spacing: {2}two/);
    assert.match(supplement, /Exact history/);
    assert.doesNotMatch(supplement, /OLD_DEVELOPER_INSTRUCTIONS|AFTER_BOUNDARY|foreign-opaque-state/);
    assert.deepEqual(sent.body.tools, body.tools);
    assert.deepEqual(body, original);
  }
  assert.deepEqual(await readFile(fixture.historyPath), native);
  assert.equal(fixture.calls.length, 2, "one upstream request per user request");
});

test("single-provider and already readable compacted requests do not read native history", async (t) => {
  const fixture = await compactedFixture(t);
  const missing = path.join(fixture.home, "does-not-exist");
  for (const [destination, input] of [["chatgpt", [fixture.compacted]], ["apiKey", [fixture.compacted]],
    ["deepseek", [foreign]], ["zai-coding-plan", [foreign]], ["deepseek", [{ type: "message", role: "user", content: "Native text summary" }]]]) {
    assert.equal(await (await fixture.send({ input }, destination, missing)).text(), "accepted");
    assert.deepEqual(fixture.calls.at(-1).body.input, input);
  }
});

test("repeated compaction restores through the exact latest boundary and ignores an unfinished append", async (t) => {
  const fixture = await compactedFixture(t);
  const latest = { type: "compaction", encrypted_content: "later-native-compaction" };
  await fixture.save([...fixture.records, { type: "compacted", payload: { replacement_history: [latest] } }], '{"type":');
  const response = await fixture.send({ model: "deepseek-flash", input: [latest] });
  assert.equal(await response.text(), "accepted");
  const supplement = fixture.calls[0].body.input[1].content[0].text;
  assert.match(supplement, /RANDOM_TOOL_FACT/);
  assert.match(supplement, /AFTER_BOUNDARY/);
  assert.doesNotMatch(supplement, /exact-native-compaction/);
});

test("unsafe, unsupported or oversized compacted histories fail before any provider request", async (t) => {
  const fixture = await compactedFixture(t);
  const body = { model: "deepseek-flash", input: [fixture.compacted] };
  const check = async (promise, pattern, status = 422) => {
    const response = await promise;
    assert.equal(response.status, status);
    const message = (await response.json()).error.message;
    assert.match(message, pattern);
    assert.match(message, /Saved history has not been changed/);
  };
  await check(fixture.send(body, "deepseek", path.join(fixture.home, "missing")), /could not be read/);
  await check(fixture.send({ ...body, input: [{ ...fixture.compacted, encrypted_content: "wrong-thread" }] }), /exact saved compaction/);
  await check(fixture.send({ ...body, model: "unqualified-model" }), /not been qualified/);
  await fixture.save([...fixture.records, { type: "event_msg", payload: { type: "thread_rolled_back", num_turns: 1 } }]);
  await check(fixture.send(body), /after Undo/);
  await fixture.save([{ ...fixture.records[0], payload: { id: "another-thread" } }, ...fixture.records.slice(1)]);
  await check(fixture.send(body), /identify one supported conversation/);
  for (const payload of [{ type: "unknown_tool" }, { type: "message", role: "user", content: [{ type: "input_image", image_url: "image" }] }]) {
    await fixture.save([fixture.records[0], { type: "response_item", payload }, ...fixture.records.slice(1)]);
    await check(fixture.send(body), /unsupported|non-text/);
  }
  await fixture.save(fixture.records, 'malformed saved record\n');
  await check(fixture.send(body), /could not be read completely/);
  await fixture.save([fixture.records[0], { type: "response_item", payload: { type: "message", role: "user", content: "x".repeat(800_000) } }, ...fixture.records.slice(1)]);
  await check(fixture.send(body), /too large/, 413);
  await fixture.save();
  const outside = await mkdtemp(path.join(os.tmpdir(), "vibe64-outside-history-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const outsidePath = path.join(outside, path.basename(fixture.historyPath));
  await writeFile(outsidePath, await readFile(fixture.historyPath));
  await rm(fixture.historyPath);
  await symlink(outsidePath, fixture.historyPath);
  await check(fixture.send(body), /outside this Codex runtime/);
  assert.equal(fixture.calls.length, 0);
});

test("curated foreign thread bindings reuse native metadata and recover after adapter restart", async () => {
  const provider = new CodexAppServerAgentProvider();
  const historyPath = "/home/native/sessions/2026/09/25/rollout-fixture.jsonl";
  for (const destination of ["deepseek", "zai-coding-plan"]) {
    const params = { modelProvider: destination, config: { [`model_providers.${destination}`]: {
      base_url: curatedCodexProvider(destination).baseUrl, experimental_bearer_token: "native-owned"
    } } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      provider.runtime = { historyAdapterBaseUrl: `http://127.0.0.1:23456/${randomUUID()}/v2` };
      const configured = await provider.withHistoryAdapter(params, { request() { throw new Error("metadata already read"); } }, { historyPath });
      const url = configured.config[`model_providers.${destination}`].base_url;
      assert.equal(url, `${provider.runtime.historyAdapterBaseUrl}/${destination}/history/${Buffer.from(historyPath).toString("base64url")}`);
      const restored = await provider.withHistoryAdapter(params, { request: async (method, input) => {
        assert.equal(method, "thread/read"); assert.deepEqual(input, { threadId: "native-thread", includeTurns: false });
        return { thread: { path: historyPath } };
      } }, { threadId: "native-thread" });
      assert.deepEqual(restored, configured);
      assert.equal(configured.config[`model_providers.${destination}`].experimental_bearer_token, "native-owned");
    }
  }
});
