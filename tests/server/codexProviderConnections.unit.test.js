import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
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
    invalidateRuntimes: async (input) => { stops.push(input); return { ok: !stopFails }; }
  });
  return { root, requests, stops, store, reject: () => { reject = true; }, failStop: () => { stopFails = true; } };
}

test("only the curated DeepSeek and GLM routes can receive a saved key", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(CURATED_CODEX_PROVIDERS.map(({ label }) => label), ["DeepSeek", "GLM · Coding Plan"]);
  const rows = await f.store.change("deepseek", { apiKey: "fixture-secret", label: "My key", baseUrl: "https://attacker.invalid" });
  assert.equal(f.requests[0].url, "https://api.deepseek.com/responses");
  assert.equal(f.requests[0].input.redirect, "error");
  assert.equal(f.requests[0].input.headers.Authorization, "Bearer fixture-secret");
  assert.equal(JSON.stringify(rows).includes("fixture-secret"), false);
  assert.equal(rows[0].label, "DeepSeek");
  assert.equal(rows[0].claudeReady, true);
  assert.equal(f.requests[1].url, "https://api.deepseek.com/anthropic/v1/messages");
  await assert.rejects(f.store.change("unknown", { apiKey: "fixture-secret" }), /supported Codex provider/);
  await assert.rejects(f.store.change("deepseek", { apiKey: "bad\nkey" }), /valid provider API key/);
  assert.equal(f.requests.length, 2);
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
  assert.equal((await f.store.list()).find((row) => row.id === "deepseek").connected, false);
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
  assert.match(await readFile(codexProviderPaths(other.root, "deepseek").connectionPath, "utf8"), /original/);
});

test("curated connection identity changes on replacement and disappears on disconnect", async (t) => {
  const f = await fixture(t);
  const first = (await f.store.change("deepseek", { apiKey: "first-secret" }))[0];
  assert.match(first.connectionIdentity, /^curated:deepseek:[a-f0-9-]+$/);
  assert.equal((await f.store.list())[0].connectionIdentity, first.connectionIdentity);
  const next = (await f.store.change("deepseek", { apiKey: "second-secret" }))[0];
  assert.notEqual(next.connectionIdentity, first.connectionIdentity);
  assert.doesNotMatch(JSON.stringify(next), /first-secret|second-secret/);
  const removed = (await f.store.change("deepseek", { remove: true }))[0];
  assert.equal(removed.connectionIdentity, "");
  assert.equal(removed.connected, false);
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
