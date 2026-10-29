import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { codexProviderPaths, createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { codexAppServerRuntimeDir } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { codexAppServerIdentityMetadata, codexAppServerThreadIdForSession, codexAppServerThreadSettings, codexAppServerTurnSettings } from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";
import { serializeVibe64AssistantSelection, vibe64AssistantConversationKey } from "@local/vibe64-runtime/shared";

function selection(modelProviderId, modelId) {
  return { engineId: "codex", agentId: "codex", modelProviderId, modelId, variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-providers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [], stops = [];
  let reject = false, stopFails = false;
  const store = createCodexProviderConnectionStore({ systemRoot: root,
    fetchImpl: async (url, input) => { requests.push({ url, input }); return new Response(JSON.stringify(url.endsWith("/messages") ? { id: "fixture", type: "message", content: [] } : { id: "fixture", output: [], status: "completed" }), { status: reject ? 401 : 200 }); },
    invalidateRuntimes: async (input) => {
      stops.push(input);
      if (!stopFails) { await input.prepare?.(); await input.publish?.(); }
      return { ok: !stopFails };
    }
  });
  return { root, requests, stops, store, reject: () => { reject = true; }, failStop: () => { stopFails = true; } };
}

test("only the curated DeepSeek and GLM routes can receive a saved key", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(CURATED_CODEX_PROVIDERS.map(({ label }) => label), ["DeepSeek", "GLM · Coding Plan", "GLM · Pay-as-you-go API"]);
  const rows = await f.store.change("deepseek", { apiKey: "fixture-secret", label: "My key", baseUrl: "https://attacker.invalid" });
  assert.equal(f.requests[0].url, "https://api.deepseek.com/responses");
  assert.equal(f.requests[0].input.redirect, "error");
  assert.equal(f.requests[0].input.headers.Authorization, "Bearer fixture-secret");
  assert.equal(JSON.stringify(rows).includes("fixture-secret"), false);
  assert.equal(rows[0].label, "DeepSeek");
  assert.equal(rows[0].claudeReady, false);
  assert.deepEqual(rows[0].configuredEngines, ["codex"]);
  assert.equal(f.requests.length, 1, "connecting Codex must not probe Claude");
  await assert.rejects(f.store.change("unknown", { apiKey: "fixture-secret" }), /supported Codex or Claude Code provider/);
  await assert.rejects(f.store.change("deepseek", { apiKey: "bad\nkey" }), /valid provider API key/);
  assert.equal(f.requests.length, 1);
  const locations = codexProviderPaths(f.root, "deepseek");
  assert.equal((await stat(locations.connectionPath)).mode & 0o777, 0o600);
  await writeFile(locations.connectionPath, JSON.stringify({ apiKey: "fixture-secret", label: "An old connection name" }));
  assert.equal((await f.store.list())[0].label, "DeepSeek");
  const config = await readFile(path.join(locations.codexHome, "config.toml"), "utf8");
  assert.match(config, /model_provider = "deepseek"/);
  assert.match(config, /requires_openai_auth = false/);
  assert.equal(config.includes("attacker"), false);
  assert.equal(f.stops[0].toolHomeSource, locations.toolHomeSource);
});

test("Z.AI Coding Plan keys use the verified Responses route and an isolated GLM catalogue", async (t) => {
  const f = await fixture(t);
  await f.store.change("zai-coding-plan", { apiKey: "fixture-plan-secret" });
  assert.equal(f.requests[0].url, "https://api.z.ai/api/v1/responses");
  assert.equal(JSON.parse(f.requests[0].input.body).model, "glm-5.3");
  const locations = codexProviderPaths(f.root, "zai-coding-plan");
  const config = await readFile(path.join(locations.codexHome, "config.toml"), "utf8");
  assert.match(config, /model_provider = "zai-coding-plan"/);
  assert.match(config, /base_url = "https:\/\/api\.z\.ai\/api\/v1"/);
  const catalog = JSON.parse(await readFile(path.join(locations.codexHome, "models.json"), "utf8"));
  assert.deepEqual(catalog.models.map((model) => model.slug), ["glm-5.3"]);
  assert.equal(catalog.models[0].shell_type, "shell_command");
  assert.equal(catalog.models[0].apply_patch_tool_type, "freeform");
  assert.equal((await f.store.runtimeOptions("zai-coding-plan")).runtimeInstanceId, "provider:zai-coding-plan");
  assert.equal(Object.hasOwn(await f.store.threadConfig("zai-coding-plan"), "model_catalog_json"), false,
    "thread routing must not pretend it can replace process-wide model metadata");
  assert.equal((await f.store.list()).find((row) => row.id === "deepseek").connected, false);
});

test("pay-as-you-go keeps its key and exact route separate from Coding Plan for both orchestrators", async (t) => {
  const f = await fixture(t);
  await f.store.change("zai-coding-plan", { apiKey: "codex-plan-fixture" });
  await f.store.change("zai-coding-plan", { engineId: "claude", apiKey: "plan-fixture" });
  await f.store.change("zai", { apiKey: "codex-api-fixture" });
  await f.store.change("zai", { engineId: "claude", apiKey: "api-fixture" });
  assert.equal(f.requests[3].url, "https://api.z.ai/api/anthropic/v1/messages");
  assert.equal(f.requests[2].url, "https://api.z.ai/api/v1/responses");
  assert.equal(f.requests[3].input.headers.Authorization, "Bearer api-fixture");
  const rows = await f.store.list();
  assert.deepEqual(rows.find(({ id }) => id === "zai").configuredEngines, ["codex", "claude"]);
  assert.doesNotMatch(JSON.stringify(rows), /api-fixture|plan-fixture/);
  assert.equal((await f.store.threadConfig("zai"))["model_providers.zai"].experimental_bearer_token, "codex-api-fixture");
  assert.equal((await f.store.claudeProviderSettings("zai-coding-plan")).apiKey, "plan-fixture");
  assert.equal((await f.store.claudeProviderSettings("zai")).apiKey, "api-fixture");
  for (const modelProviderId of ["zai", "zai-coding-plan"]) {
    const settings = codexAppServerThreadSettings({ cwd: "/workspace", agentSettings: { providerId: "codex", modelProviderId, model: "glm-5.3" } });
    assert.equal(settings.modelProvider, modelProviderId);
  }
  await f.store.change("zai", { remove: true });
  assert.equal((await f.store.claudeProviderSettings("zai-coding-plan")).apiKey, "plan-fixture");
});

test("an incompatible pay-as-you-go endpoint cannot create a connection or disturb Coding Plan", async (t) => {
  const f = await fixture(t);
  await f.store.change("zai-coding-plan", { engineId: "claude", apiKey: "plan-fixture" });
  const store = createCodexProviderConnectionStore({ systemRoot: f.root,
    fetchImpl: async () => new Response("private upstream details", { status: 404 }),
    invalidateRuntimes: async () => { assert.fail("Rejected credentials must not stop runtimes"); }
  });
  for (const engineId of ["codex", "claude"]) {
    await assert.rejects(store.change("zai", { engineId, apiKey: "api-fixture" }), (error) =>
      /HTTP 404/.test(error.message) && !error.message.includes("private upstream"));
  }
  assert.deepEqual((await store.list()).find(({ id }) => id === "zai").configuredEngines, []);
  assert.equal((await store.claudeProviderSettings("zai-coding-plan")).apiKey, "plan-fixture");
});

test("bad keys leave the previous connection intact; unverified process exit blocks replacement", async (t) => {
  const f = await fixture(t);
  await f.store.change("deepseek", { apiKey: "original" });
  const originalConfig = await readFile(path.join(codexProviderPaths(f.root, "deepseek").codexHome, "config.toml"), "utf8");
  f.reject();
  await assert.rejects(f.store.change("deepseek", { apiKey: "replacement" }), /rejected this key/);
  assert.ok(await f.store.runtimeOptions("deepseek"));
  assert.equal(await readFile(path.join(codexProviderPaths(f.root, "deepseek").codexHome, "config.toml"), "utf8"), originalConfig);
  assert.equal(f.stops.length, 1);
  const other = await fixture(t);
  await other.store.change("deepseek", { apiKey: "original" });
  other.failStop();
  await assert.rejects(other.store.change("deepseek", { apiKey: "replacement" }), /could not be stopped/);
  await assert.rejects(other.store.runtimeOptions("deepseek"), /Reconnect/);
  const [unavailable] = await other.store.list();
  assert.deepEqual(unavailable.configuredEngines, ["codex"]);
  assert.equal(unavailable.connected, false);
  assert.equal(unavailable.claudeReady, false);
  assert.match(await readFile(codexProviderPaths(other.root, "deepseek").connectionPath, "utf8"), /original/);
});

test("curated connection identity changes on replacement and disappears on disconnect", async (t) => {
  const f = await fixture(t);
  const first = (await f.store.change("deepseek", { apiKey: "first-secret" }))[0];
  assert.match(first.connectionIdentity, /^curated:codex:deepseek:[a-f0-9-]+$/);
  assert.equal((await f.store.list())[0].connectionIdentity, first.connectionIdentity);
  const next = (await f.store.change("deepseek", { apiKey: "second-secret" }))[0];
  assert.notEqual(next.connectionIdentity, first.connectionIdentity);
  assert.doesNotMatch(JSON.stringify(next), /first-secret|second-secret/);
  const removed = (await f.store.change("deepseek", { remove: true }))[0];
  assert.equal(removed.connectionIdentity, "");
  assert.equal(removed.connected, false);
  assert.deepEqual(removed.configuredEngines, []);
});

test("disconnect removes credentials after stopping only their owner and retains native conversations", async (t) => {
  const f = await fixture(t);
  await f.store.change("deepseek", { apiKey: "original" });
  const locations = codexProviderPaths(f.root, "deepseek");
  await writeFile(path.join(locations.codexHome, "fixture-history"), "retained");
  await f.store.change("deepseek", { remove: true });
  await assert.rejects(readFile(locations.connectionPath), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(locations.codexHome, "config.toml")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(locations.codexHome, "fixture-history"), "utf8"), "retained");
  assert.equal((await f.store.list())[0].connected, false);
  await assert.rejects(f.store.runtimeOptions("deepseek"), /Connect Codex/);
});

test("disconnect also drops the stopped home's Codex logs and temporary files, keeping its state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-providers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { codexHome } = codexProviderPaths(root, "deepseek");
  let logsWhileStopping = [];
  const store = createCodexProviderConnectionStore({ systemRoot: root,
    fetchImpl: async () => new Response(JSON.stringify({ id: "fixture", output: [], status: "completed" })),
    invalidateRuntimes: async (input) => {
      logsWhileStopping.push(await stat(path.join(codexHome, "logs_2.sqlite")).then(() => true, () => false));
      await input.prepare?.(); await input.publish?.(); return { ok: true };
    } });
  await store.change("deepseek", { apiKey: "original" });
  const disposable = ["logs_2.sqlite", "logs_2.sqlite-wal", ".tmp/git-a1/HEAD", ".tmp/plugins/README.md",
    "cache/remote_plugin_catalog/catalog.json", "tmp/arg0/apply_patch"];
  const kept = ["state_5.sqlite", "goals_1.sqlite", "sessions/2026/10/09/rollout.jsonl", "models.json"];
  for (const entry of [...disposable, ...kept]) {
    await mkdir(path.dirname(path.join(codexHome, entry)), { recursive: true });
    await writeFile(path.join(codexHome, entry), "native");
  }
  logsWhileStopping = [];
  await store.change("deepseek", { remove: true });
  assert.deepEqual(logsWhileStopping, [true], "nothing is removed before the runtimes are stopped");
  for (const entry of ["logs_2.sqlite", "logs_2.sqlite-wal", ".tmp", "cache", "tmp"]) {
    await assert.rejects(stat(path.join(codexHome, entry)), { code: "ENOENT" }, entry);
  }
  for (const entry of kept) assert.equal(await readFile(path.join(codexHome, entry), "utf8"), "native", entry);
});

test("curated provider settings keep credential runtimes separate and cannot retarget the recorded thread", (t) => {
  const previous = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "curated-unit";
  t.after(() => { if (previous === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE; else process.env.VIBE64_RUNTIME_NAMESPACE = previous; });
  const base = { env: { VIBE64_AGENT_RUNTIME_DIR: "/tmp/codex-provider-fixture" } };
  const dirs = ["", "deepseek", "zai-coding-plan"].map((modelProviderId) => codexAppServerRuntimeDir({ ...base, modelProviderId }));
  assert.equal(new Set(dirs).size, 3);
  let metadata = {};
  for (const [providerId, modelId] of [["openai", "gpt-5.6-sol"], ["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    const selected = selection(providerId, modelId);
    const thread = `${providerId}-thread`;
    metadata = { ...metadata, ...codexAppServerIdentityMetadata({ modelProviderId: providerId, threadId: thread, workdir: "/workspace" }) };
    const settings = codexAppServerThreadSettings({ cwd: "/workspace", agentSettings: { providerId: "codex", model: modelId } });
    assert.equal(settings.model, modelId);
    if (providerId !== "openai") {
      assert.equal(settings.modelProvider, providerId);
      assert.equal(settings.config.model_reasoning_summary, undefined);
      assert.equal(codexAppServerTurnSettings({ cwd: "/workspace", agentSettings: { providerId: "codex", model: modelId } }).summary, undefined);
    }
    assert.equal(vibe64AssistantConversationKey(selected), providerId === "openai" ? "codex" : `codex/${providerId}`);
  }
  for (const [providerId, modelId] of [["openai", "gpt-5.6-sol"], ["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    const session = { metadata: { ...metadata, assistant_selection: serializeVibe64AssistantSelection(selection(providerId, modelId)) } };
    assert.equal(codexAppServerThreadIdForSession(session, "/workspace"), metadata.agent_identity_conversation_id,
      "Changing the selected model cannot restore a different provider's saved thread.");
    assert.equal(codexAppServerThreadIdForSession(session, "/different-workspace"), "");
  }
});

test("Claude-only verification saves a usable Claude connection without advertising Codex", async (t) => {
  const f = await fixture(t);
  const calls = [];
  const store = createCodexProviderConnectionStore({ systemRoot: f.root, fetchImpl: async (url) => {
    calls.push(url);
    return url.endsWith("/messages")
      ? Response.json({ id: "message", type: "message", content: [{ type: "text", text: "OK" }] })
      : new Response("unsupported", { status: 404 });
  } });
  const [connection] = await store.change("deepseek", { engineId: "claude", apiKey: "claude-only-secret" });
  assert.equal(calls[0], "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(connection.connected, false);
  assert.equal(connection.claudeReady, true);
  assert.deepEqual(connection.configuredEngines, ["claude"]);
  assert.equal(connection.engineStates.claude.status, "connected");
  assert.match(connection.claudeConnectionIdentity, /^curated:claude:/u);
  assert.equal((await store.claudeProviderSettings("deepseek")).apiKey, "claude-only-secret");
  await assert.rejects(store.runtimeOptions("deepseek"), /Connect Codex/u);
  await assert.rejects(readFile(path.join(codexProviderPaths(f.root, "deepseek").codexHome, "config.toml")), { code: "ENOENT" });
  assert.doesNotMatch(JSON.stringify(connection), /claude-only-secret/u);
});

test("a saved key can be checked for Claude without being re-entered; rejected checks preserve prior credentials", async (t) => {
  const f = await fixture(t);
  await f.store.change("deepseek", { engineId: "claude", apiKey: "original" });
  const [checked] = await f.store.change("deepseek", { engineId: "claude", useSavedKey: true });
  assert.equal(checked.claudeReady, true);
  assert.equal(f.requests[1].url, "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(f.requests[1].input.headers.Authorization, "Bearer original");
  const before = await readFile(codexProviderPaths(f.root, "deepseek", "claude").connectionPath, "utf8");
  f.reject();
  await assert.rejects(f.store.change("deepseek", { engineId: "claude", apiKey: "replacement" }), /rejected this key/u);
  assert.equal(await readFile(codexProviderPaths(f.root, "deepseek", "claude").connectionPath, "utf8"), before);
});

test("Claude failure leaves Codex available and cannot return provider error text", async (t) => {
  const f = await fixture(t);
  const store = createCodexProviderConnectionStore({ systemRoot: f.root, fetchImpl: async (url) =>
    url.endsWith("/messages") ? new Response("secret request details", { status: 503 })
      : Response.json({ id: "response", output: [], status: "completed" })
  });
  const [connection] = await store.change("deepseek", { apiKey: "codex-secret" });
  assert.equal(connection.connected, true);
  assert.equal(connection.claudeReady, false);
  assert.deepEqual(connection.configuredEngines, ["codex"]);
  await assert.rejects(store.change("deepseek", { engineId: "claude", apiKey: "claude-secret" }), error =>
    /HTTP 503/u.test(error.message) && !error.message.includes("secret request details"));
  assert.equal((await store.list())[0].connected, true);
});


test("different keys and intentionally equal keys remain independent across restart and mutations", async (t) => {
  const f = await fixture(t);
  for (const [providerId, key] of [["deepseek", "codex-deepseek"], ["zai", "codex-api"], ["zai-coding-plan", "same-plan"]]) {
    await f.store.change(providerId, { engineId: "codex", apiKey: key });
  }
  for (const [providerId, key] of [["deepseek", "claude-deepseek"], ["zai", "claude-api"], ["zai-coding-plan", "same-plan"]]) {
    await f.store.change(providerId, { engineId: "claude", apiKey: key });
  }
  assert.equal(f.requests.length, 6, "one selected-engine probe per connection");
  const restarted = createCodexProviderConnectionStore({ systemRoot: f.root });
  assert.equal((await restarted.threadConfig("deepseek"))["model_providers.deepseek"].experimental_bearer_token, "codex-deepseek");
  assert.equal((await restarted.claudeProviderSettings("deepseek")).apiKey, "claude-deepseek");
  assert.equal((await restarted.threadConfig("zai"))["model_providers.zai"].experimental_bearer_token, "codex-api");
  assert.equal((await restarted.claudeProviderSettings("zai")).apiKey, "claude-api");
  const codexPaths = codexProviderPaths(f.root, "deepseek", "codex");
  const original = await readFile(codexPaths.connectionPath, "utf8");
  const originalConfig = await readFile(path.join(codexPaths.codexHome, "config.toml"), "utf8");
  const originalIdentity = (await f.store.list())[0].connectionIdentity;
  f.stops.length = 0;
  await f.store.change("deepseek", { engineId: "claude", apiKey: "claude-replacement" });
  await f.store.change("deepseek", { engineId: "claude", remove: true });
  assert.equal(await readFile(codexPaths.connectionPath, "utf8"), original);
  assert.equal(await readFile(path.join(codexPaths.codexHome, "config.toml"), "utf8"), originalConfig);
  assert.equal((await f.store.list())[0].connectionIdentity, originalIdentity);
  assert.ok(f.stops.every((input) => input.provider === "claude" && input.modelProviderId === "deepseek"));
  await assert.rejects(restarted.claudeProviderSettings("deepseek"), /Reconnect/);
  await f.store.change("zai-coding-plan", { engineId: "codex", remove: true });
  assert.equal((await restarted.claudeProviderSettings("zai-coding-plan")).apiKey, "same-plan");
  assert.equal((await restarted.claudeProviderSettings("zai")).apiKey, "claude-api");
  await assert.rejects(f.store.change("deepseek", { engineId: "claude", useSavedKey: true }), /valid provider API key/);
});


test("Claude native terminal refusal precedes reconnect marker and key publication", async t => {
  const f = await fixture(t);
  await f.store.change("deepseek", { engineId: "claude", apiKey: "fixture-working" });
  const root = codexProviderPaths(f.root, "deepseek", "claude").systemRoot;
  const status = path.join(root, "auth", "codex", "auth-status.json");
  await writeFile(status, JSON.stringify({ status: "prior-status", message: "Fixture" }));
  const before = await Promise.all(["connection.json", "auth/codex/status.json", "auth/codex/auth-status.json"].map(p => readFile(path.join(root, p), "utf8")));
  const store = createCodexProviderConnectionStore({ systemRoot: f.root,
    fetchImpl: async () => Response.json({ id: "fixture", type: "message", content: [] }),
    invalidateRuntimes: async input => {
      assert.equal(typeof input.prepare, "function"); assert.equal(typeof input.publish, "function");
      throw Object.assign(new Error("Close Claude Code native terminal and retry."), { code: "vibe64_claude_connection_in_use" });
    }
  });
  await assert.rejects(store.change("deepseek", { engineId: "claude", apiKey: "fixture-new" }), { code: "vibe64_claude_connection_in_use" });
  await assert.rejects(store.change("deepseek", { engineId: "claude", remove: true }), { code: "vibe64_claude_connection_in_use" });
  assert.deepEqual(await Promise.all(["connection.json", "auth/codex/status.json", "auth/codex/auth-status.json"].map(p => readFile(path.join(root, p), "utf8"))), before);
});
