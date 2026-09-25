import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createService } from "@local/vibe64-accounts/server/service";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantModePrompt, assistantRoutingPrompt, parseRoutingDecision, recommendedRoutingAssignments,
  routingAssignmentSelection, routingModelChoices, routingModelScore, resolveAssistantPurpose,
  ASSISTANT_ROUTING_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import routingScores from "../../packages/vibe64-runtime/src/shared/assistantRoutingScores.json" with { type: "json" };

const revision = `sha256:${"a".repeat(64)}`;
function catalog(providerIds = ["openai", "deepseek", "zai-coding-plan"]) {
  const models = { openai: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"], deepseek: ["deepseek-flash", "deepseek-v4-pro"], "zai-coding-plan": ["glm-5.3"] };
  return { engineId: "codex", label: "Codex", revision, transportId: "codex_app_server",
    defaults: { agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "high" },
    agents: [{ id: "codex", mode: "primary" }],
    modelProviders: providerIds.map((id) => ({ id, label: id, connected: true, models: models[id].map((modelId) => ({
      id: modelId, label: modelId, status: "available", variants: [{ id: "low" }, { id: "high" }]
    })) })) };
}

test("JSON recommendations keep Astra for Plan and prefer DeepSeek, then Sol, over GLM for Code", () => {
  for (const [providers, expected] of [
    [["openai"], "gpt-6-sol"], [["openai", "zai-coding-plan"], "gpt-6-sol"],
    [["openai", "deepseek"], "deepseek-flash"], [["openai", "zai-coding-plan", "deepseek"], "deepseek-flash"]
  ]) {
    const roles = recommendedRoutingAssignments(catalog(providers));
    assert.equal(roles.plan.modelId, "gpt-6-astra");
    assert.equal(roles.code.modelId, expected);
    assert.equal(roles.economy.modelId, providers.includes("deepseek") ? "deepseek-flash" : "gpt-6-luna");
    assert.equal(roles.router.modelId, roles.economy.modelId);
    assert.equal(roles.economy.variantId, "low");
  }
});

test("a saved assignment is revalidated without replacing it with a recommendation", () => {
  const engine = catalog();
  const saved = { ...recommendedRoutingAssignments(engine).code, modelProviderId: "zai-coding-plan", modelId: "glm-5.3", selectionSource: "explicit" };
  assert.equal(recommendedRoutingAssignments(engine).code.modelId, "deepseek-flash");
  assert.equal(routingAssignmentSelection(engine, saved).modelId, "glm-5.3");
  assert.throws(() => routingAssignmentSelection(engine, { ...saved, modelProviderId: "deepseek", modelId: "deepseek-v4-pro" }), /has not been verified/);
  assert.throws(() => routingAssignmentSelection(engine, { ...saved, modelId: "glm-unverified" }), /available/);
  engine.modelProviders.find(({ id }) => id === "zai-coding-plan").connected = false;
  assert.throws(() => routingAssignmentSelection(engine, saved), /Connect/);
});

test("short follow-ups receive their latest exchange and bounded older context", () => {
  const prompt = assistantRoutingPrompt({ message: "Yes, implement it.", exchanges: [
    { user: "OLD".repeat(10_000), assistant: "old context" },
    { user: "Plan input validation", assistant: "Add the agreed required-field rule." }
  ] });
  assert.match(prompt, /Yes, implement it/);
  assert.match(prompt, /agreed required-field/);
  assert.ok(!prompt.includes("OLD"));
  assert.throws(() => assistantRoutingPrompt({ message: "x".repeat(25_000) }), /too long/);
  assert.throws(() => assistantRoutingPrompt({ message: "Yes", exchanges: [{ assistant: "x".repeat(25_000) }] }), /too long/);
});

test("the classifier cannot supply executable destinations or malformed decisions", () => {
  assert.deepEqual(parseRoutingDecision('{"mode":"code","reason":"explicit_implementation"}'), { mode: "code", reason: "explicit_implementation" });
  for (const output of ["code", "null", '{"mode":"economy","reason":"unclear"}',
    '{"mode":"code","reason":"explicit_implementation","url":"https://example.invalid"}',
    ...["engineId", "modelId", "command"].map((key) => JSON.stringify({
      mode: "code", reason: "explicit_implementation", [key]: "untrusted-router-value"
    }))]) {
    assert.throws(() => parseRoutingDecision(output), /Routing returned/);
  }
});

test("Plan prohibits edits while the scoped review instruction allows fixes", () => {
  const text = "The original human text.";
  assert.match(assistantModePrompt("plan", text), /Do not create, modify, or delete files/);
  assert.match(assistantModePrompt("code", text), /Stop for an unresolved architectural/);
  assert.match(assistantModePrompt("review", text), /may directly fix in-scope defects/);
  assert.ok(assistantModePrompt("review", text).endsWith(text));
});

test("routing receipts and reviewer identity survive transcript storage and reload", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-transcript-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const create = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  const store = create();
  await store.createSession({ sessionId: "routing", runtimeKind: "genesis" });
  const assistantRouting = { requestedMode: "auto", resolvedMode: "review", reason: "explicit_implementation", parentMessageId: "code-request", settingsRevision: 2 };
  await store.writeConversationUserMessage("routing", { messageId: "review-request", text: "Automatic review", turnMetadata: {
    actorId: "app", actorDisplayName: "Automatic review", engineId: "codex",
    assistantSelection: recommendedRoutingAssignments(catalog()).plan, assistantRouting
  } });
  await store.writeConversationAssistantMessage("routing", { text: "Checked the code." });
  const [turn] = await create().readConversationTail("routing");
  assert.deepEqual(turn.metadata.assistantRouting, assistantRouting);
  assert.equal(turn.metadata.actorDisplayName, "Automatic review");
  assert.equal(turn.metadata.assistantSelection.modelId, "gpt-6-astra");
});

test("routing saves are atomic, revision-checked, private and preserve unreadable state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createAssistantRoutingStore({ systemRoot: root });
  const first = await store.write({ codex: recommendedRoutingAssignments(catalog()) }, 0);
  assert.equal(first.revision, 1);
  await assert.rejects(store.write({}, 0), /another tab/);
  assert.deepEqual(await store.read(), first);
  const file = path.join(root, "ai-connections", "routing.json");
  await writeFile(file, "broken");
  await assert.rejects(store.write({}, 1));
  assert.equal(await readFile(file, "utf8"), "broken");
});

test("Accounts exposes safe choices and validates owner-managed assignments", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-accounts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const manager = createSessionAgentManager({
    providers: [{ id: "codex", transportId: "codex_app_server", async capabilities() { return catalog(); } }],
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "fixture-connection" })
  });
  const service = createService({ systemRoot: root, targetRoot: root,
    inspectRoutingConfiguration: (configuration, options) => manager.inspectRoutingConfiguration(configuration, options),
    canManageCodex: ({ vibe64User } = {}) => vibe64User?.role === "owner" ? null : { ok: false, error: "Owner required" } });
  const data = await service.readModelRouting();
  assert.equal(data.ok, true, JSON.stringify(data));
  assert.equal(data.engines[0].roles.plan.assignment, null);
  const recommendations = recommendedRoutingAssignments(catalog());
  const input = { revision: data.revision, orchestrators: { codex: Object.fromEntries(
    ASSISTANT_ROUTING_ROLES.map((role) => [role, recommendations[role]])
  ) } };
  assert.equal((await service.saveModelRouting(input)).ok, false);
  const saved = await service.saveModelRouting({ ...input, vibe64User: { role: "owner" } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.engines[0].roles.code.assignment.modelId, "deepseek-flash");
  assert.equal(saved.engines[0].roles.code.assignment.selectionSource, "recommended");
  assert.equal((await service.saveModelRouting({ ...input, vibe64User: { role: "owner" } })).ok, false);
});

function routingFixture() {
  const codex = catalog();
  const opencode = { ...catalog(["openai"]), engineId: "opencode", label: "OpenCode",
    defaults: { agentId: "build", modelProviderId: "opencode", modelId: "big-pickle", variantId: "" },
    agents: [{ id: "build", mode: "primary" }],
    modelProviders: [{ id: "opencode", label: "Zen", connected: true, models: [
      { id: "big-pickle", label: "Pickle", status: "available", variants: [], capabilities: { toolcall: true } }
    ] }] };
  const connectionAccess = [
    { engineId: "codex", modelProviderId: "openai", ownerOnly: true, available: true, connectionIdentity: "native-login-1" },
    { engineId: "codex", modelProviderId: "deepseek", ownerOnly: false, available: true, connectionIdentity: "deepseek-key-1" },
    { engineId: "codex", modelProviderId: "zai-coding-plan", ownerOnly: true, available: true, connectionIdentity: "glm-plan-1" },
    { engineId: "opencode", modelProviderId: "opencode", ownerOnly: false, available: true, connectionIdentity: "included-zen" }
  ];
  const roles = recommendedRoutingAssignments(codex);
  const backup = recommendedRoutingAssignments(opencode).code;
  const configuration = { revision: 4, orchestrators: { codex: { ...roles, sharedBackup: backup } } };
  const input = { workflowEngineId: "codex", actor: { id: "member", role: "member" }, configuration,
    catalogs: [codex, opencode], connectionAccess };
  return { input, roles, backup, resolve: (purpose, options = {}) => resolveAssistantPurpose({ ...input, purpose, ...options }) };
}

test("shipped score JSON has complete bounded scores and unique exact route identities", () => {
  const identities = new Set();
  for (const row of routingScores.models) {
    const key = JSON.stringify([row.engineId, row.modelProviderId, row.modelId]);
    assert.ok(!identities.has(key), key);
    identities.add(key);
    assert.ok(["codex", "claude", "opencode"].includes(row.engineId));
    assert.ok(row.modelProviderId && row.modelId);
    for (const role of ASSISTANT_ROUTING_ROLES) assert.equal(routingModelScore(row, role), row.scores[role]);
  }
  for (const scores of [routingScores.defaultScores, ...routingScores.models.map(({ scores }) => scores)]) {
    assert.deepEqual(Object.keys(scores).sort(), [...ASSISTANT_ROUTING_ROLES].sort());
    for (const value of Object.values(scores)) assert.ok(Number.isInteger(value) && value >= 1 && value <= 10);
  }
});

test("scores do not admit unsupported Codex history routes; isolated Router has its own compatibility", () => {
  const engine = catalog();
  const ordinary = routingModelChoices(engine).find(({ modelId }) => modelId === "deepseek-v4-pro");
  const isolated = routingModelChoices(engine, { purpose: "request_routing" }).find(({ modelId }) => modelId === "deepseek-v4-pro");
  assert.ok(ordinary.compatibilityError);
  assert.equal(isolated.compatibilityError, "");
  engine.modelProviders.push({ id: "unqualified", connected: true, models: [{ id: "gpt-6-astra", status: "available", variants: [] }] });
  assert.ok(routingModelChoices(engine, { purpose: "request_routing" }).find(({ modelProviderId }) => modelProviderId === "unqualified").compatibilityError);
  assert.equal(routingModelScore({ ...ordinary, modelId: "fake-deepseek-flash" }, "code"), 2);
});

test("independent recommendations compare engines, retain saved ties and filter Backup by connection scope", () => {
  const f = routingFixture();
  const options = { catalogs: f.input.catalogs, connectionAccess: f.input.connectionAccess };
  const before = structuredClone(f.input);
  const recommended = recommendedRoutingAssignments(f.input.catalogs[1], options);
  assert.equal(recommended.plan.engineId, "opencode");
  assert.equal(recommended.code.engineId, "opencode");
  assert.equal(recommended.economy.engineId, "codex");
  assert.equal(recommended.router.modelId, "deepseek-flash");
  assert.equal(recommended.sharedBackup.modelProviderId, "deepseek");
  assert.deepEqual(f.input, before, "recommendations do not rewrite saved assignments");
  const withoutDeepSeek = { ...options, catalogs: [catalog(["openai"]), f.input.catalogs[1]] };
  for (const catalogs of [withoutDeepSeek.catalogs, [...withoutDeepSeek.catalogs].reverse()]) {
    const choices = recommendedRoutingAssignments(f.input.catalogs[1], { ...withoutDeepSeek, catalogs });
    assert.equal(choices.economy.modelId, "gpt-6-luna");
    assert.equal(choices.router.modelId, "gpt-6-luna");
    assert.equal(choices.sharedBackup.modelId, "big-pickle");
  }
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").ownerOnly = true;
  assert.equal(recommendedRoutingAssignments(f.input.catalogs[0], options).sharedBackup.modelId, "big-pickle");
  const engine = f.input.catalogs[1];
  engine.modelProviders[0].models.push(...["model-b", "model-a"].map((id) => ({ id, status: "available", variants: [] })));
  assert.equal(recommendedRoutingAssignments(engine).code.modelId, "model-a");
  const saved = { ...recommendedRoutingAssignments(engine).code, modelId: "model-b" };
  engine.modelProviders[0].models.reverse();
  assert.equal(recommendedRoutingAssignments(engine, { assignments: { code: saved } }).code.modelId, "model-b");
});

test("owner retains the configured pair and captured review uses Plan", () => {
  const f = routingFixture();
  const result = f.resolve("code", { actor: { role: "owner" }, reviewEnabled: true });
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "deepseek-flash");
  assert.equal(result.planCodePair.plan.effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(result.backupUsed, false);
});

test("foreign Backup moves both effective roles even when Code is accessible and review is off", () => {
  const f = routingFixture();
  const before = structuredClone(f.input);
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["plan", "code", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "opencode");
      assert.equal(result.planCodePair.plan.effectiveSelection.modelId, "big-pickle");
      assert.equal(result.planCodePair.code.effectiveSelection.modelId, "big-pickle");
      assert.equal(result.planCodePair.plan.backupReason, "personal_connection");
      assert.equal(result.planCodePair.code.backupReason, "keep_workflow_together");
    }
  }
  assert.deepEqual(f.input, before, "resolution must not rewrite saved settings or catalogues");
});

test("foreign Backup moves accessible Plan when only Code is personal", () => {
  const f = routingFixture();
  Object.assign(f.input.configuration.orchestrators.codex, { plan: f.roles.code, code: f.roles.plan });
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["plan", "code", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "opencode");
      assert.equal(result.planCodePair.plan.backupReason, "keep_workflow_together");
      assert.equal(result.planCodePair.code.backupReason, "personal_connection");
      assert.deepEqual(result.planCodePair.plan.effectiveSelection, result.planCodePair.code.effectiveSelection);
    }
  }
});

test("both personal roles share the same foreign Backup without inventing another assignment", () => {
  const f = routingFixture();
  f.input.configuration.orchestrators.codex.code = { ...f.roles.plan, modelId: "gpt-6-sol" };
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["plan", "code", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "opencode");
      assert.equal(result.planCodePair.plan.backupReason, "personal_connection");
      assert.equal(result.planCodePair.code.backupReason, "personal_connection");
      assert.deepEqual(result.planCodePair.plan.effectiveSelection, result.planCodePair.code.effectiveSelection);
    }
  }
});

test("same-engine Backup substitutes personal Plan without replacing an accessible different coder", () => {
  const f = routingFixture();
  const roles = f.input.configuration.orchestrators.codex;
  roles.sharedBackup = f.roles.code;
  roles.code = { ...f.roles.plan, modelId: "gpt-6-sol" };
  f.input.connectionAccess.push({ engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-sol",
    ownerOnly: false, available: true, connectionIdentity: "shared-openai-api" });
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["plan", "code", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "codex");
      assert.equal(result.effectiveSelection.modelId, purpose === "code" ? "gpt-6-sol" : "deepseek-flash");
      assert.equal(result.backupUsed, purpose !== "code");
      assert.equal(result.planCodePair.plan.effectiveSelection.modelId, "deepseek-flash");
      assert.equal(result.planCodePair.code.effectiveSelection.modelId, "gpt-6-sol");
    }
  }
});

test("Economy helpers stay independent of the Backup pair and Router has a distinct assignment", () => {
  const f = routingFixture();
  const external = { ...f.backup, modelId: "external-helper" };
  f.input.catalogs[1].modelProviders[0].models.push({ id: external.modelId, status: "available", variants: [] });
  f.input.configuration.orchestrators.codex.router = external;
  const result = f.resolve("prompt_hint");
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "deepseek-flash");
  assert.equal(result.planCodePair, undefined);
  assert.deepEqual(result.executionProfileRequest, { profileId: "economy", workloadId: "prompt_hint" });
  const router = f.resolve("request_routing");
  assert.equal(router.effectiveSelection.modelId, "external-helper");
  assert.equal(router.executionProfileRequest.workloadId, "request_routing");
  f.input.configuration.orchestrators.codex.economy = f.roles.plan;
  f.input.configuration.orchestrators.codex.sharedBackup = external;
  assert.equal(f.resolve("prompt_hint").effectiveSelection.engineId, "opencode");
});

test("unresolved migration helper choices block only Economy helpers", () => {
  const f = routingFixture();
  f.input.configuration.orchestrators.codex.helperRoutingReview = { reason: "legacy_helpers_differ", previous: [] };
  assert.equal(f.resolve("prompt_hint").reasonCode, "vibe64_assistant_helper_review_required");
  assert.equal(f.resolve("economy").available, true);
  assert.equal(f.resolve("code").available, true);
  assert.equal(f.resolve("request_routing").available, true);
});

test("Auto requires direct Router/Plan/Code and never depends on Economy or uses Backup", () => {
  const f = routingFixture();
  assert.equal(f.resolve("auto").reasonCode, "vibe64_assistant_auto_requires_direct_roles");
  f.input.connectionAccess[0].ownerOnly = false;
  delete f.input.configuration.orchestrators.codex.economy;
  assert.equal(f.resolve("auto").available, true);
  f.input.configuration.orchestrators.codex.router = { ...f.roles.plan, modelProviderId: "zai-coding-plan", modelId: "glm-5.3" };
  assert.equal(f.resolve("request_routing").reasonCode, "vibe64_assistant_owner_required");
  assert.equal(f.resolve("auto").reasonCode, "vibe64_assistant_auto_requires_direct_roles");
});

test("known personal connection health does not prevent shared access, but deleted identity does", () => {
  const f = routingFixture();
  f.input.connectionAccess[0].available = false;
  f.input.catalogs[0].modelProviders[0].connected = false;
  assert.equal(f.resolve("code").available, true);
  f.input.connectionAccess.shift();
  assert.equal(f.resolve("code").available, false);
  assert.match(f.resolve("code").message, /no longer recognised/);
});

test("missing, personal, unhealthy or incompatible Backup fails before any request can be dispatched", () => {
  for (const change of [
    (f) => { delete f.input.configuration.orchestrators.codex.sharedBackup; },
    (f) => { f.input.connectionAccess.at(-1).ownerOnly = true; },
    (f) => { f.input.connectionAccess.at(-1).available = false; },
    (f) => { f.input.catalogs[1].modelProviders[0].models[0].capabilities.toolcall = false; }
  ]) {
    const f = routingFixture();
    change(f);
    for (const reviewEnabled of [false, true]) assert.equal(f.resolve("code", { reviewEnabled }).available, false);
  }
});

test("an unavailable accessible model is an error, not a reason to use Backup", () => {
  const f = routingFixture();
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").available = false;
  const result = f.resolve("code", { actor: { role: "owner" } });
  assert.equal(result.available, false);
  assert.equal(result.reasonCode, "vibe64_assistant_connection_unavailable");
  assert.equal(result.backupUsed, false);
  assert.equal(f.resolve("prompt_hint").available, false);
});

test("capability requirements are checked on effective models without changing destinations", () => {
  const f = routingFixture();
  assert.equal(f.resolve("plan", { requirements: { capabilities: ["images"] } }).available, false);
  assert.equal(f.resolve("code", { reviewEnabled: true, requirements: { review: ["images"] } }).available, false);
  const result = f.resolve("plan", { requirements: { capabilities: ["toolcall"] } });
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "big-pickle");
});

test("overrides cannot split a required Backup pair and direct Plan/Code cannot cross engines", () => {
  const f = routingFixture();
  const before = structuredClone(f.input);
  const override = { role: "code", selection: { ...f.roles.code, variantId: "low" } };
  const originalOverride = structuredClone(override);
  for (const reviewEnabled of [false, true]) {
    const result = f.resolve("code", { override, reviewEnabled });
    assert.equal(result.available, true, result.message);
    assert.equal(result.configuredSelection.variantId, "low");
    assert.equal(result.effectiveSelection.engineId, "opencode");
    assert.equal(result.planCodePair.plan.effectiveSelection.engineId, "opencode");
    assert.equal(result.planCodePair.code.backupReason, "keep_workflow_together");
    const sharedPlan = f.resolve("plan", { override: { role: "plan", selection: f.roles.code }, reviewEnabled });
    assert.equal(sharedPlan.available, true, sharedPlan.message);
    assert.equal(sharedPlan.effectiveSelection.engineId, "codex");
    assert.equal(sharedPlan.planCodePair.code.effectiveSelection.engineId, "codex");
    assert.equal(sharedPlan.backupUsed, false, "an accessible Plan override removes the need for Backup before resolving the pair");
  }
  assert.deepEqual(f.input, before);
  assert.deepEqual(override, originalOverride);
  assert.equal(f.resolve("code", { override: { role: "code", selection: f.backup } }).available, false);
  assert.equal(f.resolve("plan", { override: { role: "plan", selection: f.backup } }).available, false);
  assert.equal(f.resolve("economy", { override: { role: "economy", selection: f.backup } }).available, true);
});

test("the pure resolver requires a trusted actor input; standalone null remains explicit", () => {
  const f = routingFixture();
  assert.equal(f.resolve("plan", { actor: undefined }).available, false);
  assert.equal(f.resolve("plan", { actor: null }).effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(f.resolve("unknown").available, false);
});


test("included Pickle remains usable for chat and Backup but cannot route or run restricted helpers", () => {
  const f = routingFixture();
  const engine = f.input.catalogs[1];
  const recommended = recommendedRoutingAssignments(engine, { connectionAccess: f.input.connectionAccess });
  assert.equal(recommended.plan.modelId, "big-pickle");
  assert.equal(recommended.code.modelId, "big-pickle");
  assert.equal(recommended.sharedBackup.modelId, "big-pickle");
  assert.equal(recommended.router, null);
  assert.equal(recommended.economy, null);
  Object.assign(f.input.configuration.orchestrators.codex, { router: f.backup, economy: f.backup });
  assert.equal(f.resolve("economy").available, true);
  for (const purpose of ["request_routing", "prompt_hint", "auto"]) {
    const result = f.resolve(purpose, { actor: { role: "owner" } });
    assert.equal(result.available, false);
    assert.match(result.message, /provider rejects restricted/);
  }
});
