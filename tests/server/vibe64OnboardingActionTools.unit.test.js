import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { projectOnboardingRequest } from "../../packages/vibe64-project/src/shared/onboardingRequest.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

test("onboarding tools share action authority and return bounded setup choices without source or credentials", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    let allowed = true;
    const actor = { username: "owner", role: "owner" };
    const calls = [];
    const templates = Array.from({ length: 23 }, (_, index) => ({ id: `official:nodejs/starter-${index}`,
      name: `Starter ${index}`, technology: "nodejs", description: "D".repeat(1201), repository: "/private/repository" }));
    let result = { ok: true, available: true, source: { rootKind: "session-source", sessionId: "session-a", sourceRoot: "/private/source" },
      inspection: { state: "new", nextAction: "create", templateEligible: true, diagnostics: [], projectFormat: { status: "current" },
        contents: "private-source-contents" }, templates };
    const actions = createActionCatalogue({ events: { async publish() {} } });
    actions.register({ contributorId: "onboarding", domain: "project", actions: createProjectActions({ project: {
      async readOnboarding(input) { calls.push({ input, context: currentProjectRequestContext() }); return result; },
      async applyTemplate(input) { calls.push({ input, context: currentProjectRequestContext() });
        return { ok: true, projectSlug: slug, application: { template: templates[0], source: { repository: "/private/repository" } } }; }
    } }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const execute = (operation, input = {}) => {
      const tool = toolSet.tools.find(({ actionId }) => actionId === `vibe64.project.${operation}`);
      assert.ok(tool, operation);
      assert.doesNotThrow(() => catalog.toOpenAiToolSchema(tool));
      return catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: "session-a", ...input }) });
    };
    const read = async (input) => {
      const response = await execute("onboarding.read", input);
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(JSON.stringify(response).includes("private"), false);
      return response.result;
    };
    let response = await read({ purpose: "An invoice CLI for bookkeepers" });
    assert.equal(response.templates.length, 10);
    assert.equal(response.templateTotal, 23);
    assert.equal(response.nextTemplateOffset, 10);
    assert.equal(response.templates[0].description.length, 1200);
    assert.equal(response.templates[0].descriptionTruncated, true);
    assert.deepEqual(response.setupRequests, [{ kind: "create", ...projectOnboardingRequest("create", { purpose: "An invoice CLI for bookkeepers" }) }]);
    assert.equal(calls.at(-1).context.vibe64User, actor);
    result = { ...result, templates: templates.slice(10, 20), templateOffset: 10, templateTotal: 23 };
    response = await read({ templateOffset: 10 });
    assert.equal(calls.at(-1).input.templateOffset, 10);
    assert.equal(response.templates[0].id, templates[10].id);
    assert.equal(response.nextTemplateOffset, 20);
    result = { ...result, templates: [templates[22]], templateOffset: 0, templateTotal: 1 };
    response = await read({ templateId: templates[22].id });
    assert.equal(calls.at(-1).input.templateId, templates[22].id);
    assert.equal(response.nextTemplateOffset, null);
    result = { ...result, templates: [], templateTotal: 0, inspection: { ...result.inspection, state: "adoption", nextAction: "adopt", templateEligible: false } };
    response = await read();
    assert.deepEqual(response.setupRequests, [{ kind: "inspect", ...projectOnboardingRequest("inspect") }]);
    const purpose = "A Python CLI that checks invoices.\nRun it from a terminal.";
    response = await read({ purpose });
    assert.deepEqual(response.setupRequests[1], { kind: "adopt", ...projectOnboardingRequest("adopt", { purpose }) });
    assert.equal(calls.every(({ input }) => !input.message), true, "inspection never sends an agent request");
    result.inspection = { state: "attention", nextAction: "update-genesis", templateEligible: false,
      diagnostics: Array.from({ length: 11 }, () => ({ code: "FORMAT_NEWER", message: "F".repeat(600), contents: "private-diagnostic" })) };
    response = await read();
    assert.equal(response.diagnostics.length, 10);
    assert.equal(response.diagnostics[0].message.length, 512);
    assert.equal(response.diagnosticsTruncated, true);
    assert.equal(response.setupRequests[0].kind, "repair");
    assert.match(response.setupRequests[0].message, /do not downgrade/);
    result.inspection = { state: "ready", nextAction: "work", templateEligible: false, diagnostics: [] };
    result.environmentSetup = { missingKeys: Array.from({ length: 21 }, (_, index) => `KEY_${index}`), warning: "W".repeat(600), values: { SECRET: "private-value" } };
    response = await read();
    assert.deepEqual(response.setupRequests, []);
    assert.equal(response.environmentSetup.missingKeys.length, 20);
    assert.equal(response.environmentSetup.missingKeyCount, 21);
    assert.equal(response.environmentSetup.truncated, true);
    const applied = await execute("templates.apply", { templateId: templates[0].id });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.result.template.id, templates[0].id);
    assert.equal(JSON.stringify(applied).includes("private"), false);
    const count = calls.length;
    for (const operation of ["onboarding.read", "templates.apply"]) {
      const base = operation === "templates.apply" ? { templateId: templates[0].id } : {};
      for (const bad of [{ sessionId: "" }, { sessionId: null }, { vibe64User: actor }, { repository: "https://invented.test/starter" }]) {
        assert.equal((await execute(operation, { ...base, ...bad })).ok, false);
      }
    }
    for (const input of [{ templateOffset: -1 }, { templateOffset: 1.5 }, { purpose: "x".repeat(24001) }, { templateId: "" }]) {
      assert.equal((await execute("onboarding.read", input)).ok, false);
    }
    assert.equal((await execute("templates.apply")).ok, false);
    allowed = false;
    assert.equal((await execute("onboarding.read")).ok, false);
    assert.equal((await execute("templates.apply", { templateId: templates[0].id })).ok, false);
    assert.equal(calls.length, count);
  });
});
