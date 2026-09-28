import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/actions.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

async function withIntegrationTools(run) {
  await withRouteProject(async ({ projectContext, slug }) => {
    const state = { allowed: true, actor: { username: "member", role: "member" }, configuration: {
      schemaVersion: 1, integrations: { mail: { provider: "resend", displayName: "Team mail", accountMode: "shared",
        scopes: [], authentication: { method: "api-key", secretRef: "env:PRIVATE_KEY" },
        settings: { token: "private-settings" }, extensions: { data: "private-extension" } } },
      registrations: { app: { clientId: "private-registration" } }, extensions: { data: "private-root-extension" }
    } };
    const calls = [];
    const record = (input) => calls.push({ input, context: currentProjectRequestContext() });
    const actions = createActionCatalogue();
    actions.register({ contributorId: "source", domain: "source", actions: createSourceEditorActions({ sourceEditor: {
      async readIntegrations(input) { record(input); return state.failure || { ok: true, configuration: state.configuration, baseHash: "a".repeat(64), sourceRoot: "/private/source" }; },
      async readIntegrationProviders(input) { record(input); return { ok: true, total: 1, nextOffset: null,
        providers: [{ id: "resend", name: "Resend", description: "Email", descriptionTruncated: false }] }; }
    } }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => state.actor,
      authorizeProject() { if (!state.allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const execute = (operation, input = {}) => {
      const tool = toolSet.tools.find(({ actionId }) => actionId === `vibe64.source-editor.${operation}`);
      assert.ok(tool);
      assert.doesNotThrow(() => catalog.toOpenAiToolSchema(tool));
      return catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: "session-a", ...input }) });
    };
    await run({ actions, calls, execute, slug, state, toolSet });
  });
}

test("integration tools expose metadata through the same authorized session action without source or credentials", async () => {
  await withIntegrationTools(async ({ actions, calls, execute, slug, state, toolSet }) => {
    assert.deepEqual(toolSet.tools.map(({ actionId }) => actionId).sort(), [
      "vibe64.source-editor.integrations.providers.read", "vibe64.source-editor.integrations.read"
    ]);
    const response = await execute("integrations.read");
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result, { ok: true, total: 1, truncated: false, integrations: [
      { id: "mail", provider: "resend", displayName: "Team mail", accountMode: "shared", authenticationMethod: "api-key", scopeCount: 0 }
    ] });
    assert.equal(/private|PRIVATE_KEY|baseHash|sourceRoot/.test(JSON.stringify(response)), false);
    const read = await actions.execute({ actionId: "vibe64.source-editor.integrations.read", input: { projectSlug: slug, sessionId: "session-a" }, context: { channel: "api", surface: "app" } });
    assert.equal(read.configuration, state.configuration, "the ordinary UI retains the complete configuration");
    assert.equal(calls.every(({ input, context }) => input.vibe64User === state.actor && input.sessionId === "session-a" && context.slug === slug), true);
    const providers = await execute("integrations.providers.read", { search: "email", offset: 0 });
    assert.equal(providers.ok, true, JSON.stringify(providers));
    assert.equal(providers.result.providers[0].id, "resend");
    assert.equal(calls.at(-1).input.search, "email");
  });
});

test("integration metadata marks large or unrepresentable slot lists incomplete and preserves failures", async () => {
  await withIntegrationTools(async ({ execute, state }) => {
    const entry = state.configuration.integrations.mail;
    state.configuration.integrations = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`mail-${i}`, entry]));
    let result = (await execute("integrations.read")).result;
    assert.equal(result.integrations.length, 50);
    assert.equal(result.total, 51);
    assert.equal(result.truncated, true);
    state.configuration.integrations = { ["a".repeat(201)]: entry };
    result = (await execute("integrations.read")).result;
    assert.deepEqual(result, { ok: true, integrations: [], total: 1, truncated: true });
    state.configuration.integrations = {};
    assert.deepEqual((await execute("integrations.read")).result, { ok: true, integrations: [], total: 0, truncated: false });
    state.failure = { ok: false, code: "configuration_invalid", error: "Reload configuration.", fieldErrors: { token: "private-detail" } };
    result = (await execute("integrations.read")).result;
    assert.deepEqual(result, { ok: false, code: "configuration_invalid", error: "Reload configuration." });
  });
});

test("integration discovery rejects forged authority and invalid pages before service work, including revoked access", async () => {
  await withIntegrationTools(async ({ calls, execute, state }) => {
    for (const operation of ["integrations.read", "integrations.providers.read"]) {
      for (const input of [{ sessionId: "" }, { sourceRoot: "/another/source" }, { vibe64User: { role: "owner" } }]) {
        assert.equal((await execute(operation, input)).ok, false);
      }
    }
    for (const input of [{ offset: -1 }, { offset: 1.5 }, { search: "S".repeat(201) }]) {
      assert.equal((await execute("integrations.providers.read", input)).ok, false);
    }
    assert.equal(calls.length, 0);
    state.allowed = false;
    for (const operation of ["integrations.read", "integrations.providers.read"]) assert.equal((await execute(operation)).ok, false);
    assert.equal(calls.length, 0);
  });
});
