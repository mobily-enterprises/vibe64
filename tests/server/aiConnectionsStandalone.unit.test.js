import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAiConnectionRuntime, configureAiConnectionRuntime } from "../../packages/vibe64-accounts/src/server/aiConnectionRuntime.js";
import { createAiConnectionService } from "../../packages/vibe64-accounts/src/server/aiConnectionService.js";
import { createConnections } from "../../packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js";
import { registerRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import { testRouteApp, findRegisteredRoute, testReply } from "./vibe64RouteTestHelpers.js";

const revision = `sha256:${"a".repeat(64)}`;
const provider = {
  id: "deepseek", label: "DeepSeek", defaultModelId: "deepseek-flash",
  definitionRevision: revision, apiKeyCompatible: true,
  models: [{ id: "deepseek-flash", label: "Flash", status: "available" }]
};

test("standalone connects an OpenCode provider and reopens its existing credentials through the shared runtime", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "v64-ai-standalone-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  let configured;
  const invalidations = [];
  const events = [];
  const terminals = {
    configureAssistantRuntime(runtime) { configured = runtime; },
    async invalidateAgentRuntimes(input) { invalidations.push(input); return { ok: true }; },
    async verifyAssistantConnection(input) {
      assert.equal(input.modelProviderId, "deepseek");
      assert.equal(input.modelId, "deepseek-flash");
      return { ok: true };
    },
    async listAssistantCapabilities() {
      return { ok: true, engines: [{ engineId: "opencode", modelProviders: [provider] }] };
    }
  };
  const aiConnections = createAiConnectionRuntime({ systemRoot, terminals,
    publishConnectionChanged(...args) { events.push(args); } });
  configureAiConnectionRuntime({ terminals, aiConnections, accountService: {
    async getStatus() { return { ok: true, accounts: [{ id: "codex", connected: false }] }; },
    async getClaudeStatus() { return { ok: true, account: { connected: true } }; }
  } });
  assert.equal(await configured.codexConnectionStatus(), false);
  assert.equal(await configured.claudeConnectionStatus(), true);
  assert.equal((await configured.listConnections())[0].id, "opencode");

  const service = createAiConnectionService({ aiConnections, readAssistantCapabilities: terminals.listAssistantCapabilities });
  const app = testRouteApp();
  registerRoutes(app.http, { accounts: { subscribeAuthTerminal() {} }, fastify: app.fastify,
    aiConnectionService: service, projectScoped: false, routeSurface: "app", routeRelativePath: "vibe64/accounts" });
  const save = findRegisteredRoute(app, { method: "PATCH", path: "/api/vibe64/accounts/ai-connections/:providerId" });
  const reply = testReply();
  await save.handler({ hostname: "localhost", ip: "127.0.0.1", params: { providerId: "deepseek" },
    body: { apiKey: "fixture-deepseek-private-key", providerRevision: revision, label: "My DeepSeek" } }, reply);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.connection.connected, true);
  assert.doesNotMatch(JSON.stringify(reply.payload), /fixture-deepseek-private-key/u);
  assert.equal(invalidations[0].provider, "opencode");
  assert.equal(events[0][0], "deepseek");
  assert.equal((await configured.resolveConnection({ modelProviderId: "deepseek" })).apiKey, "fixture-deepseek-private-key");
  for (const path of ["/api/vibe64/accounts/helper-model", "/api/vibe64/accounts/ai-connections/:providerId/helper-model"]) {
    const route = findRegisteredRoute(app, { method: "PATCH", path });
    const retired = testReply();
    await route.handler({ hostname: "localhost", ip: "127.0.0.1", params: { providerId: "deepseek" },
      body: { modelId: "retired-setting" } }, retired);
    assert.equal(retired.statusCode, 410);
    assert.match(retired.payload.error, /Reload.*Economy/);
  }
  const storedBefore = await readFile(aiConnections.filePath, "utf8");
  const reopened = createAiConnectionRuntime({ systemRoot, terminals });
  assert.equal((await reopened.resolveConnection("deepseek")).apiKey, "fixture-deepseek-private-key");
  assert.equal(await readFile(aiConnections.filePath, "utf8"), storedBefore);

});

test("provider management rejects a forged owner in the request body before touching connections", async () => {
  const app = testRouteApp();
  let called = false;
  registerRoutes(app.http, { accounts: { subscribeAuthTerminal() {} }, fastify: app.fastify,
    aiConnectionService: { save() { called = true; } },
    requireAiManagement({ vibe64User }) {
      return vibe64User?.role === "owner" ? null : { ok: false, code: "owner_required", error: "Owner required." };
    },
    projectScoped: false, routeSurface: "app", routeRelativePath: "vibe64/accounts" });
  const route = findRegisteredRoute(app, { method: "PATCH", path: "/api/vibe64/accounts/ai-connections/:providerId" });
  const reply = testReply();
  await route.handler({ hostname: "localhost", params: { providerId: "deepseek" },
    vibe64User: { role: "member", username: "member" }, body: { vibe64User: { role: "owner" } } }, reply);
  assert.equal(reply.statusCode, 403);
  assert.equal(called, false);
});

test("connecting OpenCode initializes routing after saving and keeps connection success when routing needs review", async () => {
  const owner = { role: "owner", username: "owner" };
  let saved = false;
  let inspected = 0;
  const service = createAiConnectionService({
    aiConnections: { async upsertConnection() { saved = true; return { id: "deepseek", connected: true }; } },
    async readAssistantCapabilities() { return { engines: [{ engineId: "opencode", modelProviders: [provider] }] }; },
    async initializeModelRouting(input) {
      inspected++;
      assert.equal(saved, true);
      assert.deepEqual(input, { engineIds: ["opencode"], vibe64User: owner });
      if (inspected === 1) return { ok: true, initialized: [{ engineId: "opencode", role: "plan" }] };
      throw new Error("Model routing changed in another tab.");
    }
  });
  const first = await service.save({ modelProviderId: "deepseek", apiKey: "unused", vibe64User: owner });
  assert.equal(first.ok, true);
  assert.equal(first.routing.ok, true);
  const second = await service.save({ modelProviderId: "deepseek", apiKey: "unused", vibe64User: owner });
  assert.equal(second.ok, true);
  assert.equal(second.connection.connected, true);
  assert.deepEqual(second.routing, { ok: false, error: "Model routing changed in another tab." });
});

test("project AI readiness accepts Claude or OpenCode without requiring Codex", async () => {
  for (const engineId of ["claude", "opencode"]) {
    const connections = createConnections({
      accounts: { async getStatus() { return { ok: true, accounts: [{ id: "codex", connected: false, required: true }] }; } },
      project: { async readCurrentProject() { return { repository: { mode: "local_source" } }; } },
      async listAssistantCapabilities(input) {
        assert.equal(input.configuredOnly, "true");
        return { ok: true, engines: [{ engineId, modelProviders: [{ connected: true }] }] };
      }
    });
    const status = await connections.getStatus();
    assert.equal(status.ready, true);
    assert.deepEqual(status.connections.map(({ id, connected }) => ({ id, connected })), [{ id: "ai", connected: true }]);
  }
});
