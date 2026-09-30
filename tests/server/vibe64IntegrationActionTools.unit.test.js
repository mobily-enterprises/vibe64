import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/actions.js";
import { createIntegrationSetupRequest, parseIntegrationSetupResponse } from "../../packages/vibe64-source-editor/src/server/integrationSetupCommand.js";
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
        providers: [{ id: "resend", name: "Resend", description: "Email", descriptionTruncated: false }] }; },
      async saveIntegrations(input) { record(input); return state.failure || { ok: true,
        configuration: state.configuration, baseHash: "b".repeat(64), fileChange: { path: "integrations.json" } }; },
      async runIntegrationSetup(input) {
        const request = createIntegrationSetupRequest(input);
        record(input);
        if (state.failure) return state.failure;
        const result = parseIntegrationSetupResponse(JSON.stringify({ protocol: request.protocol, requestId: request.requestId, ...state.setupResult }), request);
        return { ok: true, ...result, ...(state.setupRequestResult ? { integrationSetup: state.setupRequestResult } : {}) };
      }
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
      "vibe64.source-editor.integrations.providers.read", "vibe64.source-editor.integrations.read", "vibe64.source-editor.integrations.save", "vibe64.source-editor.integrations.setup"
    ]);
    const response = await execute("integrations.read");
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result, { ok: true, baseHash: "a".repeat(64), total: 1, truncated: false, integrations: [
      { id: "mail", provider: "resend", displayName: "Team mail", accountMode: "shared", authenticationMethod: "api-key", scopeCount: 0 }
    ] });
    assert.equal(/private|PRIVATE_KEY|sourceRoot/.test(JSON.stringify(response)), false);
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
    assert.deepEqual(result, { ok: true, baseHash: "a".repeat(64), integrations: [], total: 1, truncated: true });
    state.configuration.integrations = {};
    assert.deepEqual((await execute("integrations.read")).result, { ok: true, baseHash: "a".repeat(64), integrations: [], total: 0, truncated: false });
    state.failure = { ok: false, code: "configuration_invalid", error: "Reload configuration.", fieldErrors: { token: "private-detail" } };
    result = (await execute("integrations.read")).result;
    assert.deepEqual(result, { ok: false, code: "configuration_invalid", error: "Reload configuration." });
  });
});

test("configuration changes export native reference constraints and return revision metadata without saved values", async () => {
  await withIntegrationTools(async ({ calls, execute, state }) => {
    const changes = { integrations: { mail: { authentication: { secretRef: "env:ROTATED_MAIL_KEY" } } },
      registrations: { app: { clientSecretRef: "env:NEW_SECRET", callbackUrlRef: "env:NEW_CALLBACK" } } };
    const response = await execute("integrations.save", { baseHash: "a".repeat(64), changes });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.at(-1).input.changes, changes);
    assert.equal(response.result.baseHash, "b".repeat(64));
    assert.equal(/private|PRIVATE_KEY|ROTATED_MAIL_KEY|NEW_SECRET|NEW_CALLBACK|configuration|fileChange/.test(JSON.stringify(response.result)), false);
    const before = calls.length;
    for (const invalid of [
      { baseHash: "stale", changes }, { changes },
      { baseHash: null, changes: { integrations: { mail: { authentication: { secretRef: "raw-secret" } } } } },
      { baseHash: null, changes: { registrations: { app: { clientSecretRef: "https://secret.example" } } } },
      { baseHash: null, changes: { registrations: { app: { callbackUrlRef: "https://callback.example" } } } },
      { baseHash: null, changes: { integrations: { mail: { extensions: { command: "unsupported" } } } } },
      { baseHash: null, changes: { extensions: {} } },
      { baseHash: null, changes, sourceRoot: "/another/source" }
    ]) assert.equal((await execute("integrations.save", invalid)).ok, false, JSON.stringify(invalid));
    assert.equal(calls.length, before, "invalid configuration input never reaches the service");
    state.allowed = false;
    assert.equal((await execute("integrations.save", { baseHash: "a".repeat(64), changes })).ok, false);
    assert.equal(calls.length, before, "revoked project authority also prevents mutation");
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

test("integration connection tools retain exact selections and omit consent URLs, callbacks and chat request details", async () => {
  await withIntegrationTools(async ({ calls, execute, state }) => {
    state.setupResult = { status: "pending", authorizationUrl: "https://provider.example/authorize?state=private-url",
      callbackUrl: "https://private.example/callback", attemptId: "attempt-one", expiresAt: "2026-09-29T12:00:00Z" };
    let response = await execute("integrations.setup", { integrationId: "mail", operation: "status" });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result, { ok: true, status: "pending", consentRequired: true, attemptId: "attempt-one", expiresAt: state.setupResult.expiresAt });
    assert.equal(JSON.stringify(response).includes("private"), false);
    assert.equal(calls.at(-1).input.environment, "development");
    assert.equal(calls.at(-1).input.vibe64User, state.actor);
    state.setupResult = { status: "connected", verifiedAt: "2026-09-29T11:00:00Z", accountLabel: "Fixture account", grantedScopes: ["read-records"] };
    state.setupRequestResult = { outcome: "completed", message: "private-chat-details" };
    const request = { turnId: "000012", requestId: "a".repeat(64), configurationHash: "b".repeat(64) };
    response = await execute("integrations.setup", { integrationId: "mail", operation: "connect", verificationInput: { documentId: "supplied-id" }, setupRequest: request });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result, { ok: true, ...state.setupResult, consentRequired: false, setupRequestOutcome: "completed" });
    assert.deepEqual(calls.at(-1).input.setupRequest, request);
    assert.deepEqual(calls.at(-1).input.verificationInput, { documentId: "supplied-id" });
    delete state.setupRequestResult;
    for (const [operation, status] of [["cancel", "cancelled"], ["disconnect", "disconnected"]]) {
      state.setupResult = { status };
      response = await execute("integrations.setup", { integrationId: "mail", operation, ...(operation === "cancel" ? { attemptId: "attempt-one" } : {}) });
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(response.result.status, status);
    }
    assert.equal(calls.every(({ input }) => input.sessionId === "session-a" && input.integrationId === "mail"), true);
  });
});

test("setup tools preserve complete native payment reviews and advertising values without inventing readiness", async () => {
  await withIntegrationTools(async ({ execute, state }) => {
    state.setupResult = { status: "payments", paymentEnvironment: "sandbox", providerAccountId: "acct_fixture", review: {
      reviewId: "c".repeat(64), changes: [{ action: "create-price", planId: "pro", amount: 1234, currency: "USD", interval: "month" }],
      drift: [{ planId: "pro", reason: "Provider record differs" }], removed: ["old"], pending: true,
      pendingOperation: { action: "create-product", planId: "pro", name: "Pro" }
    } };
    let response = await execute("integrations.setup", { integrationId: "billing", operation: "payments-preview", paymentEnvironment: "sandbox" });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result.review, state.setupResult.review);
    state.setupResult = { status: "payments-history", paymentEnvironment: "sandbox", providerAccountId: "acct_fixture", subjectId: "subject-one", collection: "transactions",
      items: [{ id: "invoice-one", kind: "invoice", status: "open", createdAt: "2026-09-29T11:00:00.000Z", currency: "USD", totalMinor: "123456789012345678901234", paidMinor: null }], nextCursor: "next-page" };
    response = await execute("integrations.setup", { integrationId: "billing", operation: "payments-history", paymentEnvironment: "sandbox", subjectId: "subject-one", collection: "transactions" });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result.items, state.setupResult.items);
    assert.equal(response.result.nextCursor, "next-page");
    state.setupResult = { status: "ads", operation: "ads-report", data: { campaigns: [{ campaign: { id: "12345678901234567890" }, metrics: { costMicros: "1234567890123456789" } }] } };
    response = await execute("integrations.setup", { integrationId: "advertising", operation: "ads-report", ads: {} });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result.data, state.setupResult.data);
    state.setupResult.data.credential = "private-key";
    response = await execute("integrations.setup", { integrationId: "advertising", operation: "ads-report", ads: {} });
    assert.equal(response.ok, false);
    assert.equal(JSON.stringify(response).includes("private-key"), false);
  });
});

test("setup tools reject invalid contracts or revoked authority before work and preserve uncertain failures", async () => {
  await withIntegrationTools(async ({ calls, execute, state }) => {
    const base = { integrationId: "mail", operation: "connect" };
    for (const input of [{ operation: "run-shell" }, { environment: "production" }, { vibe64User: { role: "owner" } },
      { sourceRoot: "/other" }, { setupRequest: { turnId: "000001" } }, { paymentEnvironment: "production" },
      { reviewId: "invented" }, { ads: { actor: "owner" } }, { ads: { trackingConfirmed: "yes" } }]) {
      assert.equal((await execute("integrations.setup", { ...base, ...input })).ok, false);
    }
    assert.equal(calls.length, 0);
    state.allowed = false;
    assert.equal((await execute("integrations.setup", base)).ok, false);
    assert.equal(calls.length, 0);
    state.allowed = true;
    state.failure = { ok: false, code: "vibe64_integration_configuration_changed", error: "Reload and inspect before retrying.", diagnostics: "private-stderr" };
    const result = (await execute("integrations.setup", base)).result;
    assert.deepEqual(result, { ok: false, code: state.failure.code, error: state.failure.error });
    assert.equal(calls.length, 1);
  });
});
