import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createService } from "@local/vibe64-accounts/server/service";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantModePrompt, assistantRoutingPrompt, assistantWorkflowInstructions, parseRoutingDecision, recommendedRoutingAssignments,
  routingAssignmentSelection, routingModelChoices, routingModelScore, resolveAssistantPurpose,
  ASSISTANT_ROUTING_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_AGENT_EXECUTION_WORKLOAD_IDS } from "@local/vibe64-runtime/shared";
import routingScores from "../../packages/vibe64-runtime/src/shared/assistantRoutingScores.json" with { type: "json" };

const revision = `sha256:${"a".repeat(64)}`;
function catalog(providerIds = ["openai", "deepseek", "zai-coding-plan"], engineId = "codex") {
  const models = { anthropic: ["opus", "sonnet", "haiku"], openai: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"], deepseek: ["deepseek-flash", "deepseek-v4-pro"], "zai-coding-plan": ["glm-5.3"], zai: ["glm-5.3"] };
  return { engineId, label: engineId, revision, transportId: engineId === "claude" ? "claude_stream_json" : "codex_app_server",
    defaults: { agentId: engineId, modelProviderId: engineId === "claude" ? "anthropic" : "openai", modelId: engineId === "claude" ? "opus" : "gpt-6-astra", variantId: "high" },
    agents: [{ id: engineId, mode: "primary" }],
    modelProviders: providerIds.map((id) => ({ id, label: id, connected: true, models: models[id].map((modelId) => ({
      id: modelId, label: modelId, status: "available", variants: [{ id: "low" }, { id: "high" }]
    })) })) };
}

test("Codex recommendations prefer native OpenAI for every role when DeepSeek and GLM are connected", () => {
  for (const providers of [["openai"], ["openai", "zai-coding-plan"],
    ["openai", "deepseek"], ["openai", "zai-coding-plan", "deepseek"]]) {
    const roles = recommendedRoutingAssignments(catalog(providers));
    assert.equal(roles.senior.modelId, "gpt-6-astra");
    assert.equal(roles.junior.modelId, "gpt-6-sol");
    assert.equal(roles.helper.modelId, "gpt-6-luna");
    assert.equal(roles.router.modelId, roles.helper.modelId);
    assert.equal(roles.helper.variantId, "low");
  }
});

test("every role ranks Claude above OpenAI, then DeepSeek, then both GLM connections", () => {
  const groups = [["anthropic"], ["openai"], ["deepseek"], ["zai", "zai-coding-plan"]];
  for (const role of [...ASSISTANT_ROUTING_ROLES, "sharedBackup"]) {
    for (let i = 0; i < groups.length - 1; i += 1) {
      const scores = providers => routingScores.models.filter(row => providers.includes(row.modelProviderId))
        .map(row => routingModelScore(row, role));
      assert.ok(Math.min(...scores(groups[i])) > Math.max(...scores(groups[i + 1])), `${role}: ${groups[i]} > ${groups[i + 1]}`);
    }
  }
});

test("live recommendations follow provider priority after availability and personal Backup eligibility", () => {
  const codex = catalog();
  const claude = catalog(["anthropic", "deepseek", "zai-coding-plan"], "claude");
  const catalogs = [codex, claude];
  const connectionAccess = catalogs.flatMap(engine => engine.modelProviders.map(provider => ({
    engineId: engine.engineId, modelProviderId: provider.id, available: true,
    ownerOnly: ["anthropic", "openai"].includes(provider.id)
  })));
  const native = recommendedRoutingAssignments(claude);
  assert.equal(native.senior.modelId, "opus");
  assert.equal(native.junior.modelId, "sonnet");
  assert.equal(native.helper.modelId, "haiku");
  assert.equal(native.router.modelId, "haiku");
  const assignments = { helper: { ...recommendedRoutingAssignments(codex).helper, modelProviderId: "deepseek", modelId: "deepseek-flash" } };
  const original = structuredClone(assignments);
  for (const [providerId, modelId] of [["anthropic", "haiku"], ["openai", "gpt-6-luna"], ["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    for (const ordered of [catalogs, [...catalogs].reverse()]) {
      const roles = recommendedRoutingAssignments(codex, { catalogs: ordered, connectionAccess, assignments });
      for (const role of ["helper", "router"]) {
        assert.equal(roles[role].modelProviderId, providerId, role);
        assert.equal(roles[role].modelId, modelId, role);
      }
      assert.ok(["deepseek", "zai-coding-plan"].includes(roles.sharedBackup.modelProviderId), "personal models cannot supply a shared Backup");
    }
    for (const access of connectionAccess) if (access.modelProviderId === providerId) access.available = false;
  }
  assert.deepEqual(assignments, original, "recommendation inspection preserves saved choices");
});

test("unlisted native models retain provider priority without admitting unsupported routes", () => {
  const codex = catalog();
  const claude = catalog(["anthropic"], "claude");
  claude.modelProviders[0].models = [{ id: "claude-sonnet-4-6", label: "Claude Sonnet", status: "available", variants: [{ id: "low" }, { id: "high" }] }];
  assert.equal(recommendedRoutingAssignments(codex, { catalogs: [codex, claude] }).helper.modelId, "claude-sonnet-4-6");
  codex.modelProviders[0].models = [{ id: "gpt-new", label: "GPT", status: "available", variants: [] }];
  const roles = recommendedRoutingAssignments(codex);
  for (const role of ASSISTANT_ROUTING_ROLES) assert.equal(roles[role].modelId, "gpt-new", role);
  assert.equal(routingModelScore({ engineId: "opencode", modelProviderId: "unknown", modelId: "unknown" }, "helper"), 2);
});

test("a saved assignment is revalidated without replacing it with a recommendation", () => {
  const engine = catalog();
  const saved = { ...recommendedRoutingAssignments(engine).junior, modelProviderId: "zai-coding-plan", modelId: "glm-5.3", selectionSource: "explicit" };
  assert.equal(recommendedRoutingAssignments(engine).junior.modelId, "gpt-6-sol");
  assert.equal(routingAssignmentSelection(engine, saved).modelId, "glm-5.3");
  assert.throws(() => routingAssignmentSelection(engine, { ...saved, modelProviderId: "deepseek", modelId: "deepseek-v4-pro" }), /has not been verified/);
  assert.throws(() => routingAssignmentSelection(engine, { ...saved, modelId: "glm-unverified" }), /available/);
  engine.modelProviders.find(({ id }) => id === "zai-coding-plan").connected = false;
  assert.throws(() => routingAssignmentSelection(engine, saved), /Connect/);
});

test("GLM API and Coding Plan remain distinct eligible routing choices despite sharing a model name", () => {
  const engine = catalog(["zai", "zai-coding-plan"]);
  const choices = routingModelChoices(engine);
  assert.equal(choices.length, 2);
  for (const choice of choices) {
    assert.equal(choice.compatibilityError, "");
    assert.equal(routingAssignmentSelection(engine, choice).modelProviderId, choice.modelProviderId);
    assert.equal(routingModelScore(choice, "junior"), 3);
  }
});

test("short follow-ups receive their latest exchange and bounded older context", () => {
  const prompt = assistantRoutingPrompt({ message: "Yes, implement it.", messages: [
    { role: "user", text: "OLD".repeat(10_000) },
    { role: "assistant", text: "Add the agreed required-field rule." }
  ] });
  assert.match(prompt, /Yes, implement it/);
  assert.match(prompt, /agreed required-field/);
  assert.ok(!prompt.includes("OLD"));
  assert.throws(() => assistantRoutingPrompt({ message: "x".repeat(25_000) }), /too long/);
  assert.throws(() => assistantRoutingPrompt({ message: "Yes", messages: [{ role: "assistant", text: "x".repeat(25_000) }] }), /too long/);
});

test("the classifier cannot supply executable destinations or malformed decisions", () => {
  assert.deepEqual(parseRoutingDecision('{"mode":"junior","reason":"implementation"}'), { mode: "junior", reason: "implementation" });
  assert.deepEqual(parseRoutingDecision('{"mode":"junior","reason":"review"}'), { mode: "junior", reason: "review" });
  assert.deepEqual(parseRoutingDecision('{"mode":"senior","reason":"implementation"}'), { mode: "senior", reason: "implementation" });
  for (const output of ["junior", "null", '{"mode":"helper","reason":"unclear"}',
    '{"mode":"deslop","reason":"planning"}', '{"mode":"deslop","reason":"deslop"}',
    '{"mode":"junior","reason":"mixed_deslop_request"}',
    '{"mode":"junior","reason":"implementation","url":"https://example.invalid"}',
    ...["engineId", "modelId", "command"].map((key) => JSON.stringify({
      mode: "junior", reason: "implementation", [key]: "untrusted-router-value"
    }))]) {
    assert.throws(() => parseRoutingDecision(output), /Routing returned/);
  }
});

test("Auto distinguishes plan execution and confirmations from planning while preserving explicit role choices", () => {
  const prompt = assistantRoutingPrompt({
    message: "[1] Yes\n[2] Go with recommended option\n[3] Use all recommendations.",
    messages: [
      { role: "user", text: "Execute the plan" },
      { role: "assistant", text: "Confirm the open choices before I implement it." }
    ],
    plan: { status: "active", revision: "fixture", outline: "# Pet Notes\n- [ ] Implement accepted form rules" }
  });
  assert.match(prompt, /Honor an explicit Senior or Junior request/);
  assert.match(prompt, /Implementation executes authorised changes.*continuing a plan or accepted choices that allow execution/);
  assert.match(prompt, /Otherwise planning and review use Senior; implementation and other conversation use Junior/);
  assert.match(prompt, /Conversation answers or investigates without changes/);
  assert.match(prompt, /Questions and ambiguous offers are conversation, not execution authority/);
  const context = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
  assert.equal(context.messages[0].text, "Execute the plan");
  assert.equal(context.messages[1].text, "Confirm the open choices before I implement it.");
  assert.match(context.message, /Use all recommendations/);
});

test("explicit closure by scope reduction keeps implementation review while draft edits and unrequested deferrals do not", () => {
  const plan = { status: "active", revision: "scope", outline: "# Notifications\n- [x] In-app notifications\n- [ ] Real email delivery",
    progressRevision: "evidence", progressOutline: "In-app delivery tested. SMTP setup is missing." };
  const prompt = assistantRoutingPrompt({ message: "Finish without actual emails; keep email setup and delivery testing for before release.", plan });
  const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
  assert.deepEqual(input.plan, plan);
  assert.match(prompt, /explicitly authorised scope reduction of already implemented work is implementation using Senior/);
  assert.match(prompt, /who owns plan scope/);
  assert.match(prompt, /Planning creates or changes an agreed plan/);
  assert.match(prompt, /Preserve deferred requirements; never infer permission to drop them from blockers or checked boxes/);
  const coding = assistantModePrompt("senior", input.message, { intent: "implementation" });
  assert.match(coding, /record the exact deferred requirement and its agreed timing/);
  assert.match(coding, /before removing it from Plan's current acceptance scope/);
  assert.match(coding, /Preserve completed implementation evidence and do not perform deferred work/);
  assert.match(coding, /Leave the plan active/);

});

test("workflow instructions delegate outcomes to the admitted agent and retain review rework", () => {
  const prompt = assistantWorkflowInstructions({ stage: "review" });
  assert.match(prompt, /continue, handoff, wait, or complete/);
  assert.match(prompt, /Senior review back to Junior/);
  assert.match(prompt, /explicit Stop/iu);
  assert.match(prompt, /application archives only after your final explanation/);
});

test("task intent sets permissions independently of the selected role", () => {
  const text = "The original human text.";
  assert.match(assistantModePrompt("senior", text, { intent: "planning", planInstructions: "Auto planning instructions" }), /Do not change application files/);
  assert.match(assistantModePrompt("senior", text), /You may edit application files when requested/);
  const conversation = assistantModePrompt("senior", text, { intent: "conversation" });
  assert.match(conversation, /Do not create or update a plan, change its status, edit application files/);
  assert.match(conversation, /vibe64-helper plan read or history/);
  assert.doesNotMatch(conversation, /Auto's planning stage|You may edit application files|Do not read or update/);
  assert.ok(conversation.endsWith(text));
  assert.match(assistantModePrompt("junior", text, { intent: "implementation", planInstructions: "Approved Auto plan" }), /Stop for an unresolved architectural/);
  assert.match(assistantModePrompt("review", text), /may directly fix in-scope defects/);
  assert.ok(assistantModePrompt("review", text).endsWith(text));
  assert.match(assistantModePrompt("deslop", text), /You may edit code for behavior-preserving cleanup/);
  assert.match(assistantModePrompt("deslop", text), /Do not implement features/);
  assert.ok(assistantModePrompt("deslop", text).endsWith(text));
});

test("routing receipts and reviewer identity survive transcript storage and reload", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-transcript-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const create = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  const store = create();
  await store.createSession({ sessionId: "routing", runtimeKind: "genesis" });
  const assistantRouting = { requestedMode: "auto", resolvedMode: "review", reason: "implementation", parentMessageId: "code-request", settingsRevision: 2 };
  await store.writeConversationUserMessage("routing", { messageId: "review-request", text: "Automatic review", turnMetadata: {
    actorId: "app", actorDisplayName: "Automatic review", engineId: "codex",
    assistantSelection: recommendedRoutingAssignments(catalog()).senior, assistantRouting
  } });
  await store.writeConversationAssistantMessage("routing", { text: "Checked the code." });
  const [turn] = await create().readConversationTail("routing");
  assert.deepEqual(turn.metadata.assistantRouting, assistantRouting);
  assert.equal(turn.metadata.actorDisplayName, "Automatic review");
  assert.equal(turn.metadata.assistantSelection.modelId, "gpt-6-astra");
});

test("review context can read five recent user messages instead of the default two", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-review-tail-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  await store.createSession({ sessionId: "routing", runtimeKind: "genesis" });
  for (let i = 1; i <= 6; i++) {
    await store.writeConversationUserMessage("routing", { messageId: `user-${i}`, text: `User ${i}` });
  }
  assert.deepEqual((await store.readConversationTail("routing")).map(turn => turn.user.text), ["User 5", "User 6"]);
  assert.deepEqual((await store.readConversationTail("routing", { userLimit: 5 })).map(turn => turn.user.text),
    ["User 2", "User 3", "User 4", "User 5", "User 6"]);
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
  assert.equal(data.engines[0].roles.senior.assignment, null);
  const recommendations = recommendedRoutingAssignments(catalog());
  const input = { revision: data.revision, orchestrators: { codex: Object.fromEntries(
    ASSISTANT_ROUTING_ROLES.map((role) => [role, recommendations[role]])
  ) } };
  assert.equal((await service.saveModelRouting(input)).ok, false);
  const saved = await service.saveModelRouting({ ...input, vibe64User: { role: "owner" } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.engines[0].roles.junior.assignment.modelId, "gpt-6-sol");
  assert.equal(saved.engines[0].roles.junior.assignment.selectionSource, "recommended");
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
  // Resolver/access cases retain their original saved shared DeepSeek routes;
  // a recommendation change does not rewrite those existing assignments.
  roles.junior = routingAssignmentSelection(codex, { ...roles.junior, modelProviderId: "deepseek", modelId: "deepseek-flash" });
  roles.helper = { ...roles.junior, variantId: "low" };
  roles.router = { ...roles.helper };
  const backup = recommendedRoutingAssignments(opencode).junior;
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
  for (const scores of [routingScores.defaultScores, ...Object.values(routingScores.providerDefaultScores), ...routingScores.models.map(({ scores }) => scores)]) {
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
  assert.equal(routingModelScore({ ...ordinary, modelId: "fake-deepseek-flash" }, "junior"), 4);
});

test("independent recommendations compare engines, retain saved ties and filter Backup by connection scope", () => {
  const f = routingFixture();
  const options = { catalogs: f.input.catalogs, connectionAccess: f.input.connectionAccess };
  const before = structuredClone(f.input);
  const recommended = recommendedRoutingAssignments(f.input.catalogs[1], options);
  assert.equal(recommended.senior.engineId, "opencode");
  assert.equal(recommended.junior.engineId, "opencode");
  assert.equal(recommended.helper.engineId, "codex");
  assert.equal(recommended.router.modelId, "gpt-6-luna");
  assert.equal(recommended.sharedBackup.modelProviderId, "deepseek");
  assert.deepEqual(f.input, before, "recommendations do not rewrite saved assignments");
  const withoutDeepSeek = { ...options, catalogs: [catalog(["openai"]), f.input.catalogs[1]] };
  for (const catalogs of [withoutDeepSeek.catalogs, [...withoutDeepSeek.catalogs].reverse()]) {
    const choices = recommendedRoutingAssignments(f.input.catalogs[1], { ...withoutDeepSeek, catalogs });
    assert.equal(choices.helper.modelId, "gpt-6-luna");
    assert.equal(choices.router.modelId, "gpt-6-luna");
    assert.equal(choices.sharedBackup.modelId, "big-pickle");
  }
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").ownerOnly = true;
  assert.equal(recommendedRoutingAssignments(f.input.catalogs[0], options).sharedBackup.modelId, "big-pickle");
  const engine = f.input.catalogs[1];
  engine.modelProviders[0].models.push(...["model-b", "model-a"].map((id) => ({ id, status: "available", variants: [] })));
  assert.equal(recommendedRoutingAssignments(engine).junior.modelId, "model-a");
  const saved = { ...recommendedRoutingAssignments(engine).junior, modelId: "model-b" };
  engine.modelProviders[0].models.reverse();
  assert.equal(recommendedRoutingAssignments(engine, { assignments: { junior: saved } }).junior.modelId, "model-b");
});

test("equal recommendations prefer the workflow orchestrator before saved or alphabetical ties", () => {
  const catalogs = [
    ["claude", "claude_stream_json"], ["codex", "codex_app_server"], ["opencode", "opencode_server"]
  ].map(([engineId, transportId]) => ({
    ...catalog(["deepseek"]), engineId, transportId,
    defaults: { agentId: engineId, modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low" },
    agents: [{ id: engineId, mode: "primary" }]
  }));
  const connectionAccess = catalogs.map(({ engineId }) => ({
    engineId, modelProviderId: "deepseek", ownerOnly: false, available: true
  }));
  for (const engine of catalogs) {
    const foreign = catalogs.find((candidate) => candidate.engineId !== engine.engineId);
    const assignments = recommendedRoutingAssignments(foreign, { connectionAccess });
    const saved = structuredClone(assignments);
    for (const orderedCatalogs of [catalogs, [...catalogs].reverse()]) {
      const roles = recommendedRoutingAssignments(engine, { catalogs: orderedCatalogs, assignments, connectionAccess });
      for (const role of ["router", "helper", "sharedBackup"]) {
        assert.equal(roles[role].engineId, engine.engineId, `${engine.engineId} ${role}`);
        assert.equal(roles[role].modelId, "deepseek-flash");
      }
    }
    assert.deepEqual(assignments, saved, "recommendations leave saved choices unchanged");
    const unavailable = connectionAccess.map((access) => ({ ...access, available: access.engineId !== engine.engineId }));
    const roles = recommendedRoutingAssignments(engine, { catalogs, assignments, connectionAccess: unavailable });
    for (const role of ["router", "helper", "sharedBackup"]) {
      assert.equal(roles[role].engineId, foreign.engineId, "an unavailable local connection cannot win a tie");
    }
  }
});

test("Auto names missing assignments and preserves connection and access failure reasons", () => {
  const f = routingFixture();
  const roles = f.input.configuration.orchestrators.codex;
  const router = roles.router;
  roles.router = null;
  const missing = f.resolve("auto", { actor: { role: "owner" } });
  assert.equal(missing.available, false);
  assert.deepEqual(missing.missingRoles, ["router"]);
  assert.equal(missing.message, "Auto needs a Router model. Choose one in Model routing.");
  const senior = roles.senior;
  roles.senior = null;
  assert.equal(f.resolve("auto").message, "Auto needs models for Senior and Router. Choose them in Model routing.");
  assert.equal(f.resolve("junior").message, "Choose a Senior model in Model routing.");
  roles.router = router;
  roles.senior = senior;
  const shared = f.resolve("auto");
  assert.equal(shared.available, true, shared.message);
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").available = false;
  assert.match(f.resolve("auto", { actor: { role: "owner" } }).message, /connection is unavailable/);
});

test("owner retains the configured pair and captured review uses Senior", () => {
  const f = routingFixture();
  const result = f.resolve("junior", { actor: { role: "owner" }, reviewEnabled: true });
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "deepseek-flash");
  assert.equal(result.seniorJuniorPair.senior.effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(result.backupUsed, false);
});

test("foreign Backup moves both effective roles even when Junior is accessible and review is off", () => {
  const f = routingFixture();
  const before = structuredClone(f.input);
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["senior", "junior", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "opencode");
      assert.equal(result.seniorJuniorPair.senior.effectiveSelection.modelId, "big-pickle");
      assert.equal(result.seniorJuniorPair.junior.effectiveSelection.modelId, "big-pickle");
      assert.equal(result.seniorJuniorPair.senior.backupReason, "personal_connection");
      assert.equal(result.seniorJuniorPair.junior.backupReason, "keep_workflow_together");
    }
  }
  assert.deepEqual(f.input, before, "resolution must not rewrite saved settings or catalogues");
});

test("foreign Backup moves accessible Senior when only Junior is personal", () => {
  const f = routingFixture();
  Object.assign(f.input.configuration.orchestrators.codex, { senior: f.roles.junior, junior: f.roles.senior });
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["senior", "junior", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "opencode");
      assert.equal(result.seniorJuniorPair.senior.backupReason, "keep_workflow_together");
      assert.equal(result.seniorJuniorPair.junior.backupReason, "personal_connection");
      assert.deepEqual(result.seniorJuniorPair.senior.effectiveSelection, result.seniorJuniorPair.junior.effectiveSelection);
    }
  }
});

test("both personal roles share the same foreign Backup without inventing another assignment", () => {
  const f = routingFixture();
  f.input.configuration.orchestrators.codex.junior = { ...f.roles.senior, modelId: "gpt-6-sol" };
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["senior", "junior", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "opencode");
      assert.equal(result.seniorJuniorPair.senior.backupReason, "personal_connection");
      assert.equal(result.seniorJuniorPair.junior.backupReason, "personal_connection");
      assert.deepEqual(result.seniorJuniorPair.senior.effectiveSelection, result.seniorJuniorPair.junior.effectiveSelection);
    }
  }
});

test("same-engine Backup substitutes personal Senior without replacing an accessible different coder", () => {
  const f = routingFixture();
  const roles = f.input.configuration.orchestrators.codex;
  roles.sharedBackup = f.roles.junior;
  roles.junior = { ...f.roles.senior, modelId: "gpt-6-sol" };
  f.input.connectionAccess.push({ engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-sol",
    ownerOnly: false, available: true, connectionIdentity: "shared-openai-api" });
  for (const reviewEnabled of [false, true]) {
    for (const purpose of ["senior", "junior", "review"]) {
      const result = f.resolve(purpose, { reviewEnabled });
      assert.equal(result.available, true, result.message);
      assert.equal(result.effectiveSelection.engineId, "codex");
      assert.equal(result.effectiveSelection.modelId, purpose === "junior" ? "gpt-6-sol" : "deepseek-flash");
      assert.equal(result.backupUsed, purpose !== "junior");
      assert.equal(result.seniorJuniorPair.senior.effectiveSelection.modelId, "deepseek-flash");
      assert.equal(result.seniorJuniorPair.junior.effectiveSelection.modelId, "gpt-6-sol");
    }
  }
});

test("background helpers stay independent of the Backup pair and Router has a distinct assignment", () => {
  const f = routingFixture();
  const external = { ...f.backup, modelId: "external-helper" };
  f.input.catalogs[1].modelProviders[0].models.push({ id: external.modelId, status: "available", variants: [] });
  f.input.configuration.orchestrators.codex.router = external;
  const result = f.resolve("prompt_hint");
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "deepseek-flash");
  assert.equal(result.seniorJuniorPair, undefined);
  assert.deepEqual(result.executionProfileRequest, { profileId: "helper", workloadId: "prompt_hint" });
  const assessment = f.resolve("training_assessment");
  assert.equal(assessment.available, true, assessment.message);
  assert.equal(assessment.effectiveSelection.modelId, "deepseek-flash");
  assert.equal(assessment.seniorJuniorPair, undefined);
  assert.deepEqual(assessment.executionProfileRequest, { profileId: "helper", workloadId: "training_assessment" });
  const router = f.resolve("request_routing");
  assert.equal(router.effectiveSelection.modelId, "external-helper");
  assert.equal(router.executionProfileRequest.workloadId, "request_routing");
  f.input.configuration.orchestrators.codex.helper = f.roles.senior;
  f.input.configuration.orchestrators.codex.sharedBackup = external;
  assert.equal(f.resolve("prompt_hint").effectiveSelection.engineId, "opencode");
});

test("unresolved migration helper choices block only background helpers", () => {
  const f = routingFixture();
  f.input.configuration.orchestrators.codex.helperRoutingReview = { reason: "helper_choices_differ", previous: [] };
  assert.equal(f.resolve("prompt_hint").reasonCode, "vibe64_assistant_helper_review_required");
  assert.equal(f.resolve("helper").available, true);
  assert.equal(f.resolve("junior").available, true);
  assert.equal(f.resolve("request_routing").available, true);
});

test("known personal connection health does not prevent shared access, but deleted identity does", () => {
  const f = routingFixture();
  f.input.connectionAccess[0].available = false;
  f.input.catalogs[0].modelProviders[0].connected = false;
  assert.equal(f.resolve("junior").available, true);
  f.input.connectionAccess.shift();
  assert.equal(f.resolve("junior").available, false);
  assert.match(f.resolve("junior").message, /no longer recognised/);
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
    for (const reviewEnabled of [false, true]) assert.equal(f.resolve("junior", { reviewEnabled }).available, false);
  }
});

test("an unavailable accessible model is an error, not a reason to use Backup", () => {
  const f = routingFixture();
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").available = false;
  const result = f.resolve("junior", { actor: { role: "owner" } });
  assert.equal(result.available, false);
  assert.equal(result.reasonCode, "vibe64_assistant_connection_unavailable");
  assert.equal(result.backupUsed, false);
  assert.equal(f.resolve("prompt_hint").available, false);
});

test("capability requirements are checked on effective models without changing destinations", () => {
  const f = routingFixture();
  assert.equal(f.resolve("senior", { requirements: { capabilities: ["images"] } }).available, false);
  assert.equal(f.resolve("junior", { reviewEnabled: true, requirements: { review: ["images"] } }).available, false);
  assert.equal(f.resolve("auto", { reviewEnabled: false, requirements: { review: ["images"] } }).available, false,
    "Auto must validate the mandatory reviewer even when optional cleanup is disabled");
  const result = f.resolve("senior", { requirements: { capabilities: ["toolcall"] } });
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "big-pickle");
});

test("overrides cannot split a required Backup pair and direct Senior/Junior cannot cross engines", () => {
  const f = routingFixture();
  const before = structuredClone(f.input);
  const override = { role: "junior", selection: { ...f.roles.junior, variantId: "low" } };
  const originalOverride = structuredClone(override);
  for (const reviewEnabled of [false, true]) {
    const result = f.resolve("junior", { override, reviewEnabled });
    assert.equal(result.available, true, result.message);
    assert.equal(result.configuredSelection.variantId, "low");
    assert.equal(result.effectiveSelection.engineId, "opencode");
    assert.equal(result.seniorJuniorPair.senior.effectiveSelection.engineId, "opencode");
    assert.equal(result.seniorJuniorPair.junior.backupReason, "keep_workflow_together");
    const sharedPlan = f.resolve("senior", { override: { role: "senior", selection: f.roles.junior }, reviewEnabled });
    assert.equal(sharedPlan.available, true, sharedPlan.message);
    assert.equal(sharedPlan.effectiveSelection.engineId, "codex");
    assert.equal(sharedPlan.seniorJuniorPair.junior.effectiveSelection.engineId, "codex");
    assert.equal(sharedPlan.backupUsed, false, "an accessible Plan override removes the need for Backup before resolving the pair");
  }
  assert.deepEqual(f.input, before);
  assert.deepEqual(override, originalOverride);
  assert.equal(f.resolve("junior", { override: { role: "junior", selection: f.backup } }).available, false);
  assert.equal(f.resolve("senior", { override: { role: "senior", selection: f.backup } }).available, false);
  assert.equal(f.resolve("helper", { override: { role: "helper", selection: f.backup } }).available, false);
});

test("the pure resolver requires a trusted actor input; standalone null remains explicit", () => {
  const f = routingFixture();
  assert.equal(f.resolve("senior", { actor: undefined }).available, false);
  assert.equal(f.resolve("senior", { actor: null }).effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(f.resolve("unknown").available, false);
});


test("included Pickle is eligible for chat, Backup, Router and bounded Helpers", () => {
  const f = routingFixture();
  const engine = f.input.catalogs[1];
  const recommended = recommendedRoutingAssignments(engine, { connectionAccess: f.input.connectionAccess });
  assert.equal(recommended.senior.modelId, "big-pickle");
  assert.equal(recommended.junior.modelId, "big-pickle");
  assert.equal(recommended.sharedBackup.modelId, "big-pickle");
  assert.equal(recommended.router.modelId, "big-pickle");
  assert.equal(recommended.helper.modelId, "big-pickle");
  Object.assign(f.input.configuration.orchestrators.codex, { router: f.backup, helper: f.backup });
  assert.equal(f.resolve("helper").available, true);
  for (const purpose of ["request_routing", "prompt_hint", "voice_turn", "auto"]) {
    const result = f.resolve(purpose, { actor: { role: "owner" } });
    assert.equal(result.available, true, result.message);
  }
});

for (const purpose of ["senior", "junior", "helper", "review", "deslop", ...Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS)]) {
  test(`${purpose} resolves a personal assignment through the same collaborator fallback`, () => {
    const f = routingFixture();
    const assignments = f.input.configuration.orchestrators.codex;
    Object.assign(assignments, { senior: f.roles.senior, junior: f.roles.senior,
      helper: f.roles.senior, router: f.roles.senior, sharedBackup: f.roles.junior });
    const before = structuredClone(f.input.configuration);
    const member = f.resolve(purpose);
    assert.equal(member.available, true, member.message);
    assert.equal(member.effectiveSelection.modelProviderId, "deepseek");
    assert.equal(member.connectionIdentity, "deepseek-key-1");
    assert.equal(member.backupUsed, true);
    const owner = f.resolve(purpose, { actor: { role: "owner" } });
    assert.equal(owner.available, true, owner.message);
    assert.equal(owner.effectiveSelection.modelProviderId, "openai");
    assert.equal(owner.backupUsed, false);
    assert.deepEqual(f.input.configuration, before);
    assignments.sharedBackup = f.roles.senior;
    assert.equal(f.resolve(purpose).reasonCode, "vibe64_assistant_backup_invalid");
  });
}

test("Auto resolves its pair and Router through fallback without depending on Helper", () => {
  const f = routingFixture();
  const assignments = f.input.configuration.orchestrators.codex;
  assignments.router = f.roles.senior;
  assignments.sharedBackup = f.roles.junior;
  delete assignments.helper;
  const result = f.resolve("auto", { reviewEnabled: true });
  assert.equal(result.available, true, result.message);
  assert.equal(result.router.modelProviderId, "deepseek");
  assert.equal(result.routerConnectionIdentity, "deepseek-key-1");
  for (const role of ["senior", "junior"]) {
    assert.equal(result.seniorJuniorPair[role].effectiveSelection.modelProviderId, "deepseek");
  }
  assignments.sharedBackup = f.backup;
  const included = f.resolve("auto");
  assert.equal(included.available, true, included.message);
  assert.equal(included.router.modelId, "big-pickle");
});
