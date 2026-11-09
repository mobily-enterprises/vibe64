import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexProviderPaths, createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { CURATED_CODEX_PROVIDERS, customEndpointProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { effectiveVibe64AgentExecutionSettings } from "@local/vibe64-runtime/shared";
import { routingModelChoices } from "../../packages/vibe64-runtime/src/shared/assistantRoutingAssignments.js";
import { __testables as claudeAccounts } from "../../packages/vibe64-terminals/src/server/claudeConversationAccounts.js";
import { __testables as codexAgent } from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";
import { openCodeAssistantCapabilities } from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";
import { __testables as openCodeProcess } from "../../packages/vibe64-terminals/src/server/opencodeServerProcess.js";

const MODEL = "qwen3.5:4b-q4_K_M";
const OLLAMA = "http://127.0.0.1:11434";

// What Ollama 0.40.15 answered on 2026-11-06 for each engine's API, reduced to
// the fields the connection check reads (the JSKIT fixture keeps them in full).
const ANSWERS = Object.freeze({
  "/v1/responses": { id: "resp_128", object: "response", status: "completed", model: MODEL,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }] },
  "/v1/messages": { id: "msg_ac8a55117ab9c4d3ec25734f", type: "message", role: "assistant", model: MODEL,
    content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" },
  "/v1/chat/completions": { id: "chatcmpl-128", object: "chat.completion", model: MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }
});

/** A fake Ollama: the three engine APIs, its loaded-context answer and its model list. */
function ollama({ context = 65536 } = {}) {
  const requests = [];
  async function fetchImpl(url, options = {}) {
    const { pathname } = new URL(url);
    requests.push({ url: String(url), method: options.method || "GET", headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null, redirect: options.redirect });
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (pathname === "/api/ps") {
      return json(200, { models: [{ name: MODEL, model: MODEL, context_length: context }] });
    }
    if (pathname === "/v1/models") return json(200, { object: "list", data: [{ id: MODEL, object: "model" }] });
    return ANSWERS[pathname] ? json(200, ANSWERS[pathname]) : json(404, { error: "404 page not found" });
  }
  return { fetchImpl, requests };
}

async function fixture(t, server = ollama()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-custom-endpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stops = [];
  const store = createCodexProviderConnectionStore({
    systemRoot: root,
    fetchImpl: server.fetchImpl,
    async invalidateRuntimes(input) {
      stops.push(input);
      // The session agent runs Claude's own steps; OpenCode's runtime publishes.
      if (input.provider === "claude") await input.prepare();
      if (input.publish) await input.publish();
      return { ok: true };
    }
  });
  return { root, server, stops, store };
}

const ENDPOINTS = Object.freeze({
  codex: { baseUrl: `${OLLAMA}/v1`, model: MODEL, contextWindow: 65536 },
  claude: { baseUrl: OLLAMA, model: MODEL, contextWindow: 65536 },
  opencode: { baseUrl: `${OLLAMA}/v1/`, model: MODEL, contextWindow: 65536 }
});

test("a custom endpoint connects each engine without a key, on that engine's own API", async (t) => {
  const f = await fixture(t);
  assert.equal(CURATED_CODEX_PROVIDERS.at(-1).id, "custom");
  for (const engineId of ["codex", "claude", "opencode"]) {
    await f.store.change("custom", { engineId, ...ENDPOINTS[engineId], apiKey: "" });
  }
  assert.deepEqual(f.server.requests.filter(({ method }) => method === "POST").map(({ url }) => url), [
    `${OLLAMA}/v1/responses`, `${OLLAMA}/v1/messages`, `${OLLAMA}/v1/chat/completions`
  ]);
  assert.equal(f.server.requests.every(({ redirect }) => redirect === "error"), true);
  // Only Claude Code gets the placeholder token, so its saved claude.ai login never goes there.
  assert.deepEqual(f.server.requests.filter(({ method }) => method === "POST").map(({ headers }) => headers.Authorization),
    [undefined, "Bearer local", undefined]);
  const row = (await f.store.list()).find(({ id }) => id === "custom");
  assert.deepEqual(row.configuredEngines, ["codex", "claude", "opencode"]);
  assert.equal(row.connected && row.claudeReady && row.engineStates.opencode.connected, true);
  assert.deepEqual(row.engineStates.opencode.endpoint,
    { baseUrl: `${OLLAMA}/v1`, model: MODEL, contextWindow: 65536, keySaved: false });
  // An assistant access check reads the one provider it needs, as the list shows it.
  assert.deepEqual(await f.store.connectionFor("custom"), row);
  assert.equal(await f.store.connectionFor("not-a-provider"), null);
  assert.deepEqual(f.stops.map(({ provider, modelProviderId }) => `${provider}:${modelProviderId}`),
    ["codex:custom", "claude:custom", "opencode:custom"]);

  const codex = codexProviderPaths(f.root, "custom", "codex");
  assert.equal((await stat(codex.connectionPath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(codex.connectionPath, "utf8")), { ...ENDPOINTS.codex, apiKey: "" });
  const config = await readFile(path.join(codex.codexHome, "config.toml"), "utf8");
  assert.match(config, /^model_provider = "custom"$/mu);
  assert.match(config, new RegExp(`^base_url = "${OLLAMA}/v1"$`, "mu"));
  assert.doesNotMatch(config, /experimental_bearer_token/u);
  const [catalogue] = JSON.parse(await readFile(path.join(codex.codexHome, "models.json"), "utf8")).models;
  assert.equal(catalogue.slug, MODEL);
  assert.equal(catalogue.context_window, 65536);
  assert.equal(catalogue.supports_parallel_tool_calls, false);
  assert.equal(Object.hasOwn(catalogue, "apply_patch_tool_type"), false);

  const thread = await f.store.threadConfig("custom");
  assert.equal(thread["model_providers.custom"].base_url, `${OLLAMA}/v1`);
  assert.equal(Object.hasOwn(thread["model_providers.custom"], "experimental_bearer_token"), false);
  const claude = await f.store.claudeProviderSettings("custom");
  assert.equal(claude.baseUrl, OLLAMA);
  assert.equal(claude.apiKey, "");
  assert.equal(claude.provider.models[0].contextWindow, 65536);
  const openCode = await f.store.openCodeEndpoint();
  assert.equal(openCode.provider.baseUrl, `${OLLAMA}/v1`);

  await f.store.change("custom", { engineId: "opencode", remove: true });
  assert.equal(await f.store.openCodeEndpoint(), null);
  assert.deepEqual((await f.store.list()).find(({ id }) => id === "custom").configuredEngines, ["codex", "claude"]);
});

test("a key the owner enters is kept, sent as a bearer token and never listed", async (t) => {
  const f = await fixture(t, ollama({ context: 131072 }));
  await f.store.change("custom", { engineId: "codex", ...ENDPOINTS.codex, apiKey: "their-server-key" });
  await f.store.change("custom", { engineId: "codex", ...ENDPOINTS.codex, contextWindow: 131072, useSavedKey: true });
  const posts = f.server.requests.filter(({ method }) => method === "POST");
  assert.deepEqual(posts.map(({ headers }) => headers.Authorization), ["Bearer their-server-key", "Bearer their-server-key"]);
  const rows = await f.store.list();
  assert.equal(JSON.stringify(rows).includes("their-server-key"), false);
  assert.deepEqual(rows.find(({ id }) => id === "custom").engineStates.codex.endpoint,
    { baseUrl: `${OLLAMA}/v1`, model: MODEL, contextWindow: 131072, keySaved: true });
  assert.equal((await f.store.threadConfig("custom"))["model_providers.custom"].experimental_bearer_token, "their-server-key");
});

test("the connection refuses what would fail later, naming the fix", async (t) => {
  const f = await fixture(t, ollama({ context: 4096 }));
  await assert.rejects(f.store.change("custom", { engineId: "codex", ...ENDPOINTS.codex, baseUrl: "ftp://127.0.0.1/v1" }),
    { code: "vibe64_custom_endpoint_url_invalid", status: 400 });
  await assert.rejects(f.store.change("custom", { engineId: "codex", ...ENDPOINTS.codex, baseUrl: "http://user:pw@127.0.0.1/v1" }),
    { code: "vibe64_custom_endpoint_url_invalid" });
  await assert.rejects(f.store.change("custom", { engineId: "codex", ...ENDPOINTS.codex, contextWindow: 4096 }),
    { code: "vibe64_custom_endpoint_context_invalid", message: "Enter a context length of at least 32,768 tokens." });
  await assert.rejects(f.store.change("custom", { engineId: "codex", ...ENDPOINTS.codex, model: "two words" }),
    { code: "vibe64_custom_endpoint_model_invalid" });
  assert.equal(f.server.requests.length, 0);
  // Ollama's silent 4,096-token default would cut every prompt.
  await assert.rejects(f.store.change("custom", { engineId: "claude", ...ENDPOINTS.claude }), {
    code: "vibe64_custom_endpoint_context_too_small",
    message: `Ollama loaded ${MODEL} with 4,096 tokens of context, less than the 65,536 entered. It would cut prompts ` +
      "without an error. Restart it with OLLAMA_CONTEXT_LENGTH=65536, then choose Check again."
  });
  assert.equal((await f.store.list()).find(({ id }) => id === "custom").configuredEngines.length, 0);
  // Only a custom endpoint connects OpenCode here.
  await assert.rejects(f.store.change("deepseek", { engineId: "opencode", apiKey: "fixture-secret" }),
    /supported Codex or Claude Code provider/u);
});

test("Health's read asks each saved endpoint for its model list and loads no model", async (t) => {
  const f = await fixture(t);
  await f.store.change("custom", { engineId: "claude", ...ENDPOINTS.claude });
  f.server.requests.length = 0;
  assert.deepEqual(await f.store.customEndpointReachability(),
    [{ engineId: "claude", baseUrl: OLLAMA, model: MODEL, answers: true }]);
  assert.deepEqual(f.server.requests.map(({ method, url }) => `${method} ${url}`), [`GET ${OLLAMA}/v1/models`]);
});

test("Models offers the saved model in each engine, below cloud AI and without a Codex switching warning", () => {
  const codexProvider = customEndpointProvider("codex", ENDPOINTS.codex);
  const engine = {
    engineId: "codex",
    revision: "r1",
    defaults: { variantId: "medium" },
    agents: [{ id: "codex", mode: "primary" }],
    modelProviders: [{
      id: "custom", label: codexProvider.label, description: codexProvider.description, connected: true,
      models: codexProvider.models.map(({ id, label, variants }) => ({
        id, label, status: "available", capabilities: {}, variants: variants.map((variant) => ({ id: variant, label: variant }))
      }))
    }]
  };
  const [choice] = routingModelChoices(engine);
  assert.equal(choice.modelId, MODEL);
  assert.equal(choice.modelProviderId, "custom");
  assert.equal(choice.compatibilityError, "");
  assert.equal(choice.variantId, "medium");
  // A Codex turn sends the server's own model name and asks for no reasoning summary.
  assert.deepEqual(effectiveVibe64AgentExecutionSettings({ providerId: "codex", modelProviderId: "custom", model: MODEL }), {
    model: MODEL, providerId: "codex", modelProviderId: "custom", thinking: "medium", request: { reasoning: true, summary: false }
  });

  // The OpenAI runtime's catalogue also knows the saved model; only the endpoint offers it.
  const codex = codexAgent.codexAssistantCapabilities(false, { data: [{ model: MODEL, displayName: MODEL, hidden: false }] }, [{
    id: "custom", connected: true, engineStates: { codex: { connected: true, endpoint: { ...ENDPOINTS.codex, keySaved: false } } } }]);
  assert.deepEqual(codex.modelProviders.find(({ id }) => id === "openai").models, []);
  const codexCustom = codex.modelProviders.find(({ id }) => id === "custom");
  assert.equal(codexCustom.label, "Custom endpoint");
  assert.equal(codex.defaults.modelProviderId, "custom");
  assert.deepEqual(codexCustom.models.map(({ id, variants }) => [id, variants.map(({ id: variant }) => variant)]),
    [[MODEL, ["low", "medium", "high"]]]);
  assert.equal(codexAgent.codexAssistantCapabilities(false, { data: [] }, []).modelProviders.some(({ id }) => id === "custom"), false);

  const claude = claudeAccounts.claudeCapabilities({}, false, [{ id: "custom", claudeReady: true,
    engineStates: { claude: { connected: true, endpoint: { ...ENDPOINTS.claude, keySaved: false } } } }]);
  const claudeCustom = claude.modelProviders.find(({ id }) => id === "custom");
  assert.equal(claudeCustom.connected, true);
  assert.deepEqual(claudeCustom.models.map(({ id, variants }) => [id, variants]), [[MODEL, []]]);
  assert.equal(claude.defaults.modelProviderId, "custom");
  assert.equal(claudeAccounts.claudeCapabilities({}, false, []).modelProviders.some(({ id }) => id === "custom"), false);

  const openCode = openCodeAssistantCapabilities({
    agents: [{ name: "build", mode: "primary" }],
    connections: [{ modelProviderId: "custom", connected: true, productLabel: "Custom endpoint", defaultModelId: MODEL,
      fingerprint: `sha256:${"a".repeat(64)}` }],
    providers: { all: [], default: {} }
  });
  const openCodeCustom = openCode.modelProviders.find(({ id }) => id === "custom");
  assert.equal(openCodeCustom.connected, true);
  assert.equal(openCodeCustom.defaultModelId, MODEL);
});

test("OpenCode's server gets the endpoint as an OpenAI-compatible provider, over plain HTTP", () => {
  const provider = customEndpointProvider("opencode", { ...ENDPOINTS.opencode, baseUrl: `${OLLAMA}/v1` });
  const config = JSON.parse(openCodeProcess.openCodeInlineConfig({
    providerConnections: [{ modelProviderId: "custom", apiKey: "", canonicalUrl: "", customProvider: provider }]
  }));
  assert.deepEqual(config.provider.custom, {
    npm: "@ai-sdk/openai-compatible",
    name: "Custom endpoint",
    options: { baseURL: `${OLLAMA}/v1` },
    models: { [MODEL]: { name: MODEL, tool_call: true, limit: { context: 65536, output: 8192 } } }
  });
  // Every other route still needs a canonical HTTPS URL.
  assert.throws(() => openCodeProcess.openCodeInlineConfig({
    providerConnections: [{ modelProviderId: "openai", apiKey: "k", canonicalUrl: `${OLLAMA}/v1` }]
  }), /canonical HTTPS URL/u);
});
