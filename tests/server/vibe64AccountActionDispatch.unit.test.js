import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createActions, createAiConnectionActions } from "../../packages/vibe64-accounts/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import { testReply, testRouteApp, findRegisteredRoute, withLocalRequestBypass } from "./vibe64RouteTestHelpers.js";

test("all account operations use project-independent canonical contracts and authenticated actors", async () => {
  await withLocalRequestBypass(async () => {
    const owner = { username: "owner", role: "owner" };
    let user = owner;
    let managementAllowed = true;
    const calls = [];
    const events = [];
    const requireAiManagement = () => managementAllowed ? null : { ok: false, code: "management_disabled", error: "Management unavailable." };
    const cases = [
      ["GET", "", "read", "getStatus", { refresh: true, providerIds: ["codex"] }],
      ["GET", "/model-routing/workflows", "model-routing.workflows.read", "readModelRoutingWorkflows", {}],
      ["GET", "/model-routing", "model-routing.read", "readModelRouting", { engineId: "claude", includeOtherModels: true }],
      ["PATCH", "/model-routing", "model-routing.save", "saveModelRouting", { revision: 1, engineId: "codex", orchestrators: {}, reviewedHelperWorkflows: ["codex"] }],
      ["POST", "/model-routing/preview", "model-routing.preview", "previewModelRouting", { revision: 1, orchestrators: {} }],
      ["GET", "/codex-providers", "codex-providers.read", "readCodexProviders", {}],
      ["PATCH", "/codex-providers", "codex-providers.save", "saveCodexProvider", { modelProviderId: "deepseek", apiKey: "fixture-only" }],
      ["POST", "/codex-providers/remove", "codex-providers.remove", "removeCodexProvider", { modelProviderId: "deepseek" }],
      ["POST", "/auth", "auth.start", "startAuth", { accountId: "codex", mode: "device" }],
      ["POST", "/logout", "logout", "logout", { accountId: "codex" }],
      ["GET", "/auth/:sessionId", "auth-session.read", "readAuthSession", {}],
      ["DELETE", "/auth/:sessionId", "auth-session.cancel", "cancelAuthSession", {}],
      ["POST", "/git-identity", "git-identity.save", "saveGitIdentity", { gitUserName: "Owner", gitUserEmail: "owner@example.test" }],
      ["PATCH", "/personal-ai-profile", "personal-ai-profile.save", "savePersonalAiProfile", { preferredName: "Owner" }],
      ["GET", "/ai-connections", "ai-connections.list", "list", {}],
      ["GET", "/ai-connections/catalog", "ai-connections.catalog", "catalog", { modelProviderId: "deepseek" }],
      ["PATCH", "/ai-connections/:providerId", "ai-connections.save", "save", { apiKey: "fixture-only", providerRevision: `sha256:${"a".repeat(64)}`, label: "Provider", modelProviderId: "forged-provider" }],
      ["POST", "/ai-connections/:providerId/remove", "ai-connections.remove", "remove", {}],
      ["PATCH", "/ai-connections/:providerId/model-access", "ai-connections.modelAccess", "modelAccess", { operation: "check-available" }]
    ];
    const record = (method) => async (input) => { calls.push({ method, input }); return { ok: true }; };
    const accounts = { ...Object.fromEntries(cases.filter((entry) => !entry[2].startsWith("ai-connections.")).map((entry) => [entry[3], record(entry[3])])), subscribeAuthTerminal() {} };
    const aiConnectionService = Object.fromEntries(cases.filter((entry) => entry[2].startsWith("ai-connections.")).map((entry) => [entry[3], record(entry[3])]));
    const actions = createActionCatalogue({ events: { async publish(event) { events.push(event); } } });
    actions.register({ contributorId: "accounts", domain: "accounts", actions: [
      ...createActions({ accounts }), ...createAiConnectionActions({ aiConnectionService, requireAiManagement })
    ].map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { resolveUser: async () => user,
      authorizeProject() { throw new Error("Account access must not require a project."); } });
    const app = testRouteApp();
    registerRoutes(app.http, { accounts, aiConnectionService, requireAiManagement, fastify: { get() {} }, projectScoped: false,
      routeRelativePath: "vibe64/accounts", routeSurface: "app" });
    assert.equal(actions.listDefinitions().length, 19);
    for (const [method, suffix, operation, serviceMethod, data] of cases) {
      const route = findRegisteredRoute(app, { method, path: `/api/vibe64/accounts${suffix}` });
      assert.ok(route, operation);
      const actionId = `vibe64.accounts.${operation}`;
      let input;
      const request = { params: { ...(suffix.includes(":sessionId") ? { sessionId: "login-1" } : {}),
        ...(suffix.includes(":providerId") ? { providerId: "deepseek" } : {}) }, input: { [method === "GET" ? "query" : "body"]: data },
        executeAction({ actionId: id, input: value }) {
          assert.equal(id, actionId);
          assert.equal(Object.hasOwn(value, "vibe64User"), false);
          input = value;
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        }
      };
      const reply = testReply();
      const eventStart = events.length;
      await route.handler(request, reply);
      assert.equal(reply.payload.ok, true, `${operation}: ${JSON.stringify(reply.payload)}`);
      const expected = calls.at(-1);
      assert.equal(expected.method, serviceMethod);
      assert.equal(expected.input.vibe64User, owner);
      if (operation === "ai-connections.save") assert.equal(expected.input.modelProviderId, "deepseek");
      const execute = (value = input) => actions.execute({ actionId, input: value, context: { channel: "automation", surface: "app" } });
      const eventCount = events.length - eventStart;
      await execute();
      assert.deepEqual(calls.at(-1), expected, operation);
      assert.equal(events.length - eventStart, eventCount * 2);
      for (let index = 1; index <= eventCount; index++) {
        const { occurredAt: httpTime, ...httpEvent } = events.at(-index - eventCount);
        const { occurredAt: directTime, ...directEvent } = events.at(-index);
        assert.ok(httpTime && directTime);
        assert.deepEqual(directEvent, httpEvent);
      }
      assert.equal(actions.getDefinition(actionId).input.mode, "create");
      assert.equal(actions.getDefinition(actionId).extensions.vibe64.projectScoped, false);
      const count = calls.length;
      await assert.rejects(execute({ ...input, vibe64User: owner }), { code: "ACTION_VALIDATION_FAILED" });
      user = null;
      await assert.rejects(execute(), { statusCode: 401 });
      if (operation.startsWith("ai-connections.")) {
        user = { username: "member", role: "member" };
        await assert.rejects(execute(), { statusCode: 403 });
        await route.handler(request, reply);
        assert.equal(reply.statusCode, 403);
        user = owner;
        managementAllowed = false;
        assert.equal((await execute()).statusCode, 403);
        await route.handler(request, reply);
        assert.equal(reply.statusCode, 403);
        managementAllowed = true;
      }
      user = owner;
      assert.equal(calls.length, count, operation);
    }
    const count = calls.length;
    for (const [operation, input] of [
      ["logout", {}], ["auth.start", {}], ["auth-session.read", {}], ["git-identity.save", { gitUserName: "Name" }],
      ["model-routing.save", { orchestrators: {} }], ["model-routing.preview", { revision: 1 }],
      ["ai-connections.save", { modelProviderId: "deepseek", apiKey: "fixture-only" }],
      ["ai-connections.save", { modelProviderId: "deepseek", providerRevision: "revision" }],
      ["ai-connections.remove", { modelProviderId: "../other" }],
      ["ai-connections.modelAccess", { modelProviderId: "opencode", operation: "run-command" }]
    ]) await assert.rejects(actions.execute({ actionId: `vibe64.accounts.${operation}`, input, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" }, operation);
    assert.equal(calls.length, count);
  });
});
