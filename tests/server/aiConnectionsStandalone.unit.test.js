import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAiConnectionRuntime, configureAiConnectionRuntime } from "../../packages/vibe64-accounts/src/server/aiConnectionRuntime.js";
import { createAiConnectionService } from "../../packages/vibe64-accounts/src/server/aiConnectionService.js";
import { createConnections } from "../../packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js";
import { registerRoutes as registerAccountRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import { testRouteApp, findRegisteredRoute, testReply } from "./vibe64RouteTestHelpers.js";

import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createAiConnectionActions } from "../../packages/vibe64-accounts/src/server/actions.js";

function registerRoutes(http, options) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "accounts", domain: "accounts", actions: createAiConnectionActions(options).map((action) => ({
    channels: ["api", "automation"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, { resolveUser: async ({ request }) => request?.vibe64User || { role: "owner", username: "local" },
    authorizeProject() { throw new Error("Account operations do not require a project."); } });
  registerAccountRoutes({ router: { register(method, path, routeOptions, handler) {
    http.router.register(method, path, routeOptions, (request, reply) => {
      request.executeAction = ({ actionId, input }) => actions.execute({ actionId, input,
        context: { channel: "api", surface: "app", requestMeta: { request } } });
      return handler(request, reply);
    });
  } } }, options);
}

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
    async invalidateAgentRuntimes(input) { invalidations.push(input); await input.publish?.(); return { ok: true }; },
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
  configureAiConnectionRuntime({ terminals, aiConnections, requireAiManagement: () => null });
  assert.deepEqual(Object.keys(configured).sort(), ["listConnections", "readAssistantAccess", "resolveConnection", "updateModelAccess"],
    "only the OpenCode connection hooks; the Accounts feature owns the sign-in status hooks");
  // Vibe64 includes no AI of its own: nothing is connected until the person adds a provider.
  assert.deepEqual(await configured.listConnections(), []);

  const service = createAiConnectionService({ aiConnections, readAssistantCapabilities: terminals.listAssistantCapabilities });
  const app = testRouteApp();
  registerRoutes(app.http, { accounts: { subscribeAuthTerminal() {} }, fastify: app.fastify, requireAiManagement: () => null,
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
  for (const method of ["GET", "PATCH"]) {
    for (const path of ["/api/vibe64/accounts/helper-model", "/api/vibe64/accounts/ai-connections/:providerId/helper-model"]) {
      assert.equal(findRegisteredRoute(app, { method, path }), null, `${method} ${path} is not registered`);
    }
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
    vibe64User: { role: "member", username: "member" },
    body: { apiKey: "fixture-only", providerRevision: revision, vibe64User: { role: "owner" } } }, reply);
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


test("private runtime publication cannot report connection success without the native owner's write barrier", async t => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "v64-ai-barrier-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const runtime = createAiConnectionRuntime({ systemRoot, terminals: {
    async verifyAssistantConnection() { return { ok: true }; },
    async invalidateAgentRuntimes() { return { ok: true }; }
  } });
  await assert.rejects(runtime.upsertConnection({ modelProviderId: "deepseek", apiKey: "fixture-key", providerRevision: revision }, { provider }), /Close OpenCode/);
  assert.equal(await runtime.resolveConnection("deepseek"), null);
});

test("changing model access stops no OpenCode runtime: admission checks access on every turn", async t => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "v64-ai-model-access-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const invalidations = [];
  const published = [];
  const zen = { ...provider, id: "opencode", label: "OpenCode Zen", defaultModelId: "big-pickle",
    models: [{ id: "big-pickle", status: "available" }, { id: "claude-haiku-4-5", status: "available" }] };
  const runtime = createAiConnectionRuntime({ systemRoot, terminals: {
    async verifyAssistantConnection() { return { ok: true }; },
    async invalidateAgentRuntimes(input) { invalidations.push(input.publish ? "credential" : input.reason); await input.publish?.(); return { ok: true }; }
  }, publishConnectionChanged(modelProviderId, change) { published.push([modelProviderId, change.reason]); } });
  await runtime.upsertConnection({ modelProviderId: "opencode", apiKey: "fixture-zen-key", providerRevision: revision }, { provider: zen });
  assert.deepEqual(invalidations, ["credential"]);
  for (const operation of ["enable-all", "disable-additional"]) {
    await runtime.updateModelAccess("opencode", { operation });
  }
  assert.deepEqual(invalidations, ["credential"], "model access is admission policy; running OpenCode work keeps going");
  assert.deepEqual(published.map(([, reason]) => reason), ["created", "model-access-updated", "model-access-updated"]);
});

test("OpenCode connection changes write one operational line each with their duration", async () => {
  const lines = [];
  const logger = Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (fields) => { lines.push({ level, fields }); }]));
  const service = createAiConnectionService({ logger, aiConnections: {
    async removeConnection() { throw Object.assign(new Error("Close OpenCode native terminals, then retry this connection change."), { code: "vibe64_opencode_connection_in_use" }); },
    async updateModelAccess(id) { return { id, modelAccess: { mode: "all" } }; }
  } });
  const owner = { role: "owner", username: "owner" };
  await assert.rejects(service.remove({ modelProviderId: "deepseek", vibe64User: owner }), { code: "vibe64_opencode_connection_in_use" });
  assert.equal((await service.modelAccess({ modelProviderId: "opencode", operation: "enable-all", vibe64User: owner })).ok, true);
  assert.deepEqual(lines.map(({ level, fields }) => [level, fields.event, fields.operation, fields.modelProviderId, fields.actor]), [
    ["warn", "vibe64.accounts.change_failed", "remove-connection", "deepseek", "owner"],
    ["info", "vibe64.accounts.change_completed", "update-model-access", "opencode", "owner"]
  ]);
  assert.equal(lines[0].fields.code, "vibe64_opencode_connection_in_use");
  assert.ok(lines.every(({ fields }) => typeof fields.durationMs === "number"));
});
