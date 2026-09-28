import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

const preferences = { experience: "comfortable", explanationStyle: "concise", responseLength: "concise", tone: "encouraging" };
const operations = ["settings.read", "engineering.read", "collaboration.save", "engineering.profile.save", "prompt-hints.save"];

async function withSettingsTools(run) {
  await withRouteProject(async ({ projectContext, slug }) => {
    const state = { actor: { username: "owner", role: "owner" }, allowed: true };
    state.developmentDatabase = { scope: "project", canChange: false, managed: true, disabledReason: "Close the open session first.",
      openSessionCount: 1, password: "private-password" };
    const source = { rootKind: "session-source", sessionId: "session-a", sourceRoot: "/private/source" };
    state.collaboration = { available: true, canEdit: true, source, status: "configured", unavailableReason: "",
      ...preferences, requirements: "Preserve this project requirement.\nAnd its second line.",
      choices: Object.fromEntries(Object.entries(preferences).map(([key, id]) => [key, [{ id, name: id, guidance: `Guidance for ${id}` }]])) };
    state.engineering = { available: true, source, status: "configured", unavailableReason: "",
      profile: { id: "focused.v1", name: "Focused", description: "Small changes.", path: "/private/profile" },
      profiles: [{ id: "focused.v1", name: "Focused", description: "Small changes." }, { id: "durable.v1", name: "Durable", description: "Durable changes." }] };
    const calls = [];
    const events = [];
    const record = (operation, input) => calls.push({ operation, input, context: currentProjectRequestContext() });
    const actions = createActionCatalogue({ events: { async publish(event) { events.push(event); } } });
    actions.register({ contributorId: "settings", domain: "project", actions: createProjectActions({ project: {
      async readSettings(input) {
        record("settings.read", input);
        return { ok: true, collaboration: state.collaboration, promptHints: { canEdit: true, enabled: true },
          repositoryWorkflow: { available: false, canEdit: true, requirePullRequest: false, credential: "private-credential" },
          developmentDatabase: state.developmentDatabase };
      },
      async readEngineeringSettings(input) { record("engineering.read", input); return { ok: true, engineering: state.engineering }; },
      async saveCollaborationSettings(input) {
        record("collaboration.save", input);
        for (const key of [...Object.keys(preferences), "requirements"]) state.collaboration[key] = input[key];
        return { ok: true, collaboration: state.collaboration, projectSlug: slug };
      },
      async saveEngineeringProfile(input) {
        record("engineering.profile.save", input);
        if (state.failure) return state.failure;
        state.engineering.profile = state.engineering.profiles.find(({ id }) => id === input.profile);
        return { ok: true, engineering: state.engineering, projectSlug: slug };
      },
      async savePromptHints(input) {
        record("prompt-hints.save", input);
        return { ok: true, projectSlug: slug, promptHints: { canEdit: true, enabled: input.promptHints } };
      }
    } }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => state.actor,
      authorizeProject() { if (!state.allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const execute = (operation, input = {}, callerContext = context) => {
      const tool = toolSet.tools.find(({ actionId }) => actionId === `vibe64.project.${operation}`);
      assert.ok(tool, operation);
      assert.doesNotThrow(() => catalog.toOpenAiToolSchema(tool));
      return catalog.executeToolCall({ toolName: tool.name, toolSet, context: callerContext,
        argumentsText: JSON.stringify({ projectSlug: slug, ...(operation === "prompt-hints.save" ? {} : { sessionId: "session-a" }), ...input }) });
    };
    await run({ actions, calls, events, execute, slug, state });
  });
}

test("settings tools use the existing project/source action and return current choices without private fields", async () => {
  await withSettingsTools(async ({ calls, events, execute, slug, state }) => {
    const read = await execute("settings.read");
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.result.collaboration.requirements, state.collaboration.requirements);
    assert.equal(read.result.collaboration.requirementsTruncated, false);
    assert.equal(read.result.collaboration.choicesTruncated, false);
    assert.deepEqual(read.result.collaboration.source, { rootKind: "session-source", sessionId: "session-a" });
    assert.equal(read.result.developmentDatabase.canChange, false);
    assert.equal(read.result.developmentDatabase.disabledReason, "Close the open session first.");
    const engineering = await execute("engineering.read");
    assert.equal(engineering.ok, true, JSON.stringify(engineering));
    assert.equal(engineering.result.engineering.profiles[1].id, "durable.v1");
    assert.equal(JSON.stringify([read, engineering]).includes("private"), false);
    const saved = await execute("collaboration.save", { ...preferences, requirements: read.result.collaboration.requirements, tone: "direct" });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.result.collaboration.tone, "direct");
    assert.equal(saved.result.collaboration.requirements, read.result.collaboration.requirements);
    const profile = await execute("engineering.profile.save", { profile: engineering.result.engineering.profiles[1].id });
    assert.equal(profile.ok, true, JSON.stringify(profile));
    assert.equal(profile.result.engineering.profile.id, "durable.v1");
    const hints = await execute("prompt-hints.save", { promptHints: false });
    assert.equal(hints.ok, true, JSON.stringify(hints));
    assert.deepEqual(hints.result.promptHints, { canEdit: true, enabled: false });
    assert.equal(calls.every(({ input, context }) => input.vibe64User === state.actor && context.vibe64User === state.actor && context.slug === slug), true);
    assert.equal(calls.filter(({ operation }) => operation !== "prompt-hints.save").every(({ input }) => input.sessionId === "session-a"), true);
    assert.equal(events.length, 3);
    assert.equal(events.every((event) => event.realtime.payload.projectSlug === slug), true);
  });
});

test("settings tools bound long content, mark incomplete replacements and represent unavailable source", async () => {
  await withSettingsTools(async ({ execute, state }) => {
    state.collaboration.requirements = "R".repeat(12001);
    state.collaboration.choices.tone = Array.from({ length: 21 }, (_, i) => ({ id: `tone-${i}`, name: "N".repeat(513), guidance: "G".repeat(513) }));
    state.engineering.profiles = Array.from({ length: 21 }, (_, i) => ({ id: `profile-${i}`, name: `Profile ${i}`, description: "D".repeat(1201) }));
    const read = await execute("settings.read");
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.result.collaboration.requirements.length, 12000);
    assert.equal(read.result.collaboration.requirementsTruncated, true);
    assert.equal(read.result.collaboration.choices.tone.length, 20);
    assert.equal(read.result.collaboration.choices.tone[0].guidance.length, 512);
    assert.equal(read.result.collaboration.choicesTruncated, true);
    const engineering = await execute("engineering.read");
    assert.equal(engineering.ok, true, JSON.stringify(engineering));
    assert.equal(engineering.result.engineering.profiles.length, 20);
    assert.equal(engineering.result.engineering.profiles[0].description.length, 1200);
    assert.equal(engineering.result.engineering.profilesTruncated, true);
    state.engineering = { available: false, profile: null, profiles: [], source: { rootKind: "unavailable", sessionId: null }, unavailableReason: "Create a session." };
    const unavailable = await execute("engineering.read");
    assert.equal(unavailable.ok, true, JSON.stringify(unavailable));
    assert.equal(unavailable.result.engineering.available, false);
    assert.equal(unavailable.result.engineering.profile, null);
    assert.equal(unavailable.result.engineering.unavailableReason, "Create a session.");
    state.developmentDatabase = { managed: false, scope: "external" };
    const local = await execute("settings.read");
    assert.equal(local.ok, true, JSON.stringify(local));
    assert.deepEqual(local.result.developmentDatabase, { managed: false, scope: "external", disabledReason: "" });
  });
});

test("settings tools recheck owner and project authority and reject malformed inputs before effects", async () => {
  await withSettingsTools(async ({ calls, execute, state }) => {
    const valid = {
      "settings.read": {}, "engineering.read": {},
      "collaboration.save": { ...preferences, requirements: "" },
      "engineering.profile.save": { profile: "durable.v1" }, "prompt-hints.save": { promptHints: false }
    };
    for (const operation of operations) {
      assert.equal((await execute(operation, { ...valid[operation], vibe64User: state.actor })).ok, false);
      assert.equal((await execute(operation, { ...valid[operation], sourceRoot: "/another/source" })).ok, false);
    }
    for (const operation of ["collaboration.save", "engineering.profile.save", "prompt-hints.save"]) assert.equal((await execute(operation)).ok, false);
    assert.equal((await execute("prompt-hints.save", { promptHints: { enabled: false } })).ok, false);
    assert.equal(calls.length, 0);
    state.actor = { username: "member", role: "member" };
    for (const operation of ["collaboration.save", "prompt-hints.save"]) assert.equal((await execute(operation, valid[operation])).ok, false);
    assert.equal(calls.length, 0);
    // Engineering intentionally retains the source editor's ordinary project permission.
    assert.equal((await execute("engineering.profile.save", valid["engineering.profile.save"])).ok, true);
    state.actor = { username: "owner", role: "owner" };
    state.allowed = false;
    for (const operation of operations) assert.equal((await execute(operation, valid[operation])).ok, false);
    assert.equal(calls.length, 1);
    state.allowed = true;
    state.failure = { ok: false, errors: [{ code: "source_busy", message: "Another conversation is editing this source.", details: "private-failure-detail" }] };
    const failed = await execute("engineering.profile.save", valid["engineering.profile.save"]);
    assert.equal(failed.result.ok, false);
    assert.equal(failed.result.code, "source_busy");
    assert.equal(failed.result.error, "Another conversation is editing this source.");
    assert.equal(JSON.stringify(failed).includes("private"), false);
  });
});
