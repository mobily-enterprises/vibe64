import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createAccountsRuntime, createService } from "@local/vibe64-accounts/server/service";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { runWithPracticeProjectContext } from "@local/vibe64-core/server/projectRequestContext";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantModePrompt, assistantGoalManagementMessage, assistantRoutingPrompt, assistantWorkflowInstructions, parseRoutingDecision, recommendedRoutingAssignments,
  routingAssignmentSelection, routingModelChoices, routingModelScore, routingRunsInChoices, resolveAssistantPurpose, assistantRoutingPreferences, assistantRoutingAutomation,
  assistantRoutingSetupFor, assistantMainAiChanged, ASSISTANT_PURPOSE_ROLES, MAIN_CHAT_PURPOSES,
  assistantRoutingGoalFromMetadata, assistantRoutingRequestFromMetadata, assistantRoutingRequestForDisplay, goalStatusIsComplete,
  assistantGoalIsActive, assistantWorkflowStateIsSupported, assistantWorkflowRole, assistantWorkflowMessageIds, assistantRoutingStatusLabel,
  assistantRoutingRequestCanBeReplaced, assistantWorkflowUpgradeChanges } from "@local/vibe64-runtime/shared/assistantRouting";
import { sameVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { assistantRoutingRequestForMessage } from "../../packages/vibe64-terminals/src/server/assistantRouting.js";
import { curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import routingScores from "../../packages/vibe64-runtime/src/shared/assistantRoutingScores.json" with { type: "json" };

const revision = `sha256:${"a".repeat(64)}`;
function catalog(providerIds = ["openai", "deepseek", "zai-coding-plan"], engineId = "codex") {
  const models = { anthropic: ["opus", "sonnet", "haiku"], openai: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"], deepseek: ["deepseek-flash", "deepseek-v4-pro"], "zai-coding-plan": ["glm-5.3"], zai: ["glm-5.3"] };
  return { engineId, label: engineId, revision, transportId: engineId === "claude" ? "claude_stream_json" : "codex_app_server",
    defaults: { agentId: engineId, modelProviderId: engineId === "claude" ? "anthropic" : "openai", modelId: engineId === "claude" ? "opus" : "gpt-6-astra", variantId: "high" },
    agents: [{ id: engineId, mode: "primary" }],
    modelProviders: providerIds.map((id) => ({ id, label: id, connected: true, models: models[id].map((modelId) => ({
      id: modelId, label: modelId, status: "available", variants: [{ id: "low" }, { id: "medium" }, { id: "high" }]
    })) })) };
}

test("goal management presentation requires native admission or exact generated confirmation provenance", () => {
  const turn = { metadata: { engineId: "claude", upstreamMessageId: "native-user" } };
  for (const text of ["/goal", "/goal Finish checks", "/goal clear", "/goal stop", "/goal off", "/goal reset", "/goal none", "/goal cancel"]) {
    const message = { role: "user", text };
    assert.equal(assistantGoalManagementMessage(message, turn), true, text);
    assert.equal(assistantGoalManagementMessage(message, { ...turn, optimistic: { status: "pending" } }), false);
    assert.equal(assistantGoalManagementMessage(message, { ...turn, optimistic: { status: "failed" } }), false);
    assert.equal(assistantGoalManagementMessage({ ...message, receipt: false }, turn), false);
    assert.equal(assistantGoalManagementMessage(message, { metadata: { engineId: "claude" } }), false);
    assert.equal(assistantGoalManagementMessage(message, { metadata: { engineId: "codex", upstreamMessageId: "native-user" } }), false);
  }
  for (const text of ["Use /goal to set an objective.", "`/goal clear`", "/goals are useful"]) {
    assert.equal(assistantGoalManagementMessage({ role: "user", text }, turn), false);
  }
  for (const role of ["assistant", "commentary"]) {
    for (const prefix of ["Goal set: ", "Goal cleared: ", "Goal active: "]) {
      for (const mode of ["custom", "senior", "junior"]) {
        const message = { role, text: prefix + assistantModePrompt(mode, "Finish checks") };
        assert.equal(assistantGoalManagementMessage(message, turn), true);
        assert.equal(assistantGoalManagementMessage({ role, text: prefix + "[Vibe64 role: Junior]\n\nKeep this example." }, turn), false);
      }
      const prose = { role, text: prefix + "Finish checks" };
      assert.equal(assistantGoalManagementMessage(prose, turn), false, "Ordinary assistant goal prose remains visible");
      assert.equal(assistantGoalManagementMessage({ ...prose, data: { native: { engineId: "claude", type: "system", subtype: "local_command_output" } } }, turn), true);
    }
  }
  assert.equal(assistantGoalManagementMessage({ role: "assistant", text: "The goal is paused; the work is saved." }, turn), false);
});

test("synthetic goal presentation uses native command/output identity and preserves errors and other commands", () => {
  for (const type of ["assistant", "result"]) {
    const native = { engineId: "claude", type, command: "goal", output: "stdout" };
    const message = { role: "assistant", text: "Completed condition: all checks passed", data: { native } };
    assert.equal(assistantGoalManagementMessage(message), true);
    for (const changed of [{ output: "stderr" }, { command: "status" }, { engineId: "codex" }, { output: undefined }]) {
      assert.equal(assistantGoalManagementMessage({ ...message, data: { native: { ...native, ...changed } } }), false);
    }
    assert.equal(assistantGoalManagementMessage({ ...message, data: undefined }), false);
    assert.equal(assistantGoalManagementMessage(message, { optimistic: { status: "failed" } }), false);
  }
});

const SCORED_ROLES = ["senior", "junior", "router", "quickHelper"];
const recommend = (catalogs, options = {}) => recommendedRoutingAssignments({ catalogs: [catalogs].flat(), ...options });

test("Codex recommendations prefer native OpenAI for every role when DeepSeek and GLM are connected", () => {
  for (const providers of [["openai"], ["openai", "zai-coding-plan"],
    ["openai", "deepseek"], ["openai", "zai-coding-plan", "deepseek"]]) {
    const roles = recommend(catalog(providers));
    assert.equal(roles.senior.modelId, "gpt-6-astra");
    assert.equal(roles.junior.modelId, "gpt-6-sol");
    assert.equal(roles.quickHelper.modelId, "gpt-6-luna");
    assert.equal(roles.router.modelId, roles.quickHelper.modelId);
    assert.equal(roles.quickHelper.variantId, "low");
    assert.deepEqual([roles.colleague, roles.fix, roles.explain], [{ follows: "senior" }, { follows: "junior" }, { follows: "quickHelper" }]);
  }
});

test("every role ranks Claude above every other provider, and DeepSeek above both GLM connections", () => {
  const scores = (role, providers) => routingScores.models.filter(row => providers.includes(row.modelProviderId)).map(row => routingModelScore(row, role));
  for (const role of SCORED_ROLES) {
    assert.ok(Math.min(...scores(role, ["anthropic"])) > Math.max(...scores(role, ["openai", "deepseek", "zai", "zai-coding-plan"])), role);
    assert.ok(Math.max(...scores(role, ["deepseek"])) > Math.max(...scores(role, ["zai", "zai-coding-plan"])), role);
  }
});

test("live recommendations follow provider priority; the team setup never recommends personal plans", () => {
  const codex = catalog();
  const claude = catalog(["anthropic", "deepseek", "zai-coding-plan"], "claude");
  const catalogs = [codex, claude];
  const connectionAccess = catalogs.flatMap(engine => engine.modelProviders.map(provider => ({
    engineId: engine.engineId, modelProviderId: provider.id, available: true,
    ownerOnly: ["anthropic", "openai"].includes(provider.id)
  })));
  const owner = recommend(claude);
  assert.deepEqual([owner.senior.modelId, owner.senior.variantId], ["opus", "high"]);
  assert.deepEqual([owner.junior.modelId, owner.junior.variantId], ["opus", "medium"], "Claude Code Junior is Opus with Medium thinking");
  assert.deepEqual([owner.quickHelper.modelId, owner.router.modelId, owner.router.variantId], ["haiku", "haiku", "low"]);
  assert.deepEqual([recommend(codex).junior.modelId, recommend(codex).junior.variantId], ["gpt-6-sol", "high"]);
  const values = { quickHelper: { ...recommend(codex).quickHelper, modelProviderId: "deepseek", modelId: "deepseek-flash" } };
  const original = structuredClone(values);
  for (const [providerId, modelId] of [["anthropic", "haiku"], ["openai", "gpt-6-luna"], ["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    for (const ordered of [catalogs, [...catalogs].reverse()]) {
      const roles = recommend(ordered, { connectionAccess, values });
      for (const role of ["quickHelper", "router"]) assert.deepEqual([roles[role].modelProviderId, roles[role].modelId], [providerId, modelId], role);
      const team = recommend(ordered, { setup: "nonOwner", connectionAccess, values });
      assert.ok(["deepseek", "zai-coding-plan"].includes(team.colleague.modelProviderId), "personal models never serve team members");
      assert.deepEqual([team.fix, team.explain], [{ follows: "colleague" }, { follows: "quickHelper" }]);
    }
    for (const access of connectionAccess) if (access.modelProviderId === providerId) access.available = false;
  }
  assert.deepEqual(values, original, "recommendation inspection preserves saved choices");
});

test("the gold standard team setup is DeepSeek in Claude Code; preferProvider keeps roles on one provider and tool", () => {
  const catalogs = [catalog(["anthropic", "deepseek"], "claude"), catalog(["deepseek"], "codex"), catalog(["deepseek"], "opencode")];
  const connectionAccess = catalogs.flatMap(({ engineId, modelProviders }) => modelProviders.map(({ id }) => ({
    engineId, modelProviderId: id, available: true, ownerOnly: id === "anthropic" })));
  const team = recommend(catalogs, { setup: "nonOwner", connectionAccess });
  assert.deepEqual([team.colleague.engineId, team.colleague.modelId, team.colleague.variantId], ["claude", "deepseek-v4-pro", "high"]);
  assert.deepEqual([team.quickHelper.engineId, team.quickHelper.modelId, team.quickHelper.variantId], ["claude", "deepseek-flash", "low"]);
  assert.equal(recommend(catalogs, { connectionAccess }).senior.modelId, "opus");
  const preferred = recommend(catalogs, { connectionAccess, preferProvider: { modelProviderId: "deepseek", engineId: "opencode" } });
  for (const role of SCORED_ROLES) assert.deepEqual([preferred[role].engineId, preferred[role].modelProviderId], ["opencode", "deepseek"], role);
  const values = { senior: preferred.senior };
  assert.equal(recommend(catalogs, { connectionAccess, values, preferProvider: { modelProviderId: "zai", engineId: "codex" } }).senior, values.senior,
    "a provider with no valid choice keeps the role's current value");
});

test("unlisted native models retain provider priority without admitting unsupported routes", () => {
  const codex = catalog();
  const claude = catalog(["anthropic"], "claude");
  claude.modelProviders[0].models = [{ id: "claude-sonnet-4-6", label: "Claude Sonnet", status: "available", variants: [{ id: "low" }, { id: "high" }] }];
  assert.equal(recommend([codex, claude]).quickHelper.modelId, "claude-sonnet-4-6");
  codex.modelProviders[0].models = [{ id: "gpt-new", label: "GPT", status: "available", variants: [] }];
  // Scored DeepSeek V4 Pro ties OpenAI's provider default; leave only DeepSeek's default to compare.
  const deepseek = codex.modelProviders.find(({ id }) => id === "deepseek");
  deepseek.models = deepseek.models.filter(({ id }) => id !== "deepseek-v4-pro");
  const roles = recommend(codex);
  for (const role of ["senior", "junior", "router"]) assert.equal(roles[role].modelId, "gpt-new", role);
  assert.equal(roles.quickHelper.modelId, "deepseek-flash", "DeepSeek Flash is a strong Quick helper");
  assert.equal(routingModelScore({ engineId: "opencode", modelProviderId: "unknown", modelId: "unknown" }, "quickHelper"), 2);
});

test("a saved assignment is revalidated without replacing it with a recommendation", () => {
  const engine = catalog();
  const saved = { ...recommend(engine).junior, modelProviderId: "zai-coding-plan", modelId: "glm-5.3", selectionSource: "explicit" };
  assert.equal(recommend(engine).junior.modelId, "gpt-6-sol");
  assert.equal(routingAssignmentSelection(engine, saved).modelId, "glm-5.3");
  engine.modelProviders.find(({ id }) => id === "deepseek").models.push({ id: "deepseek-unqualified", label: "deepseek-unqualified", status: "available", variants: [{ id: "high" }] });
  assert.throws(() => routingAssignmentSelection(engine, { ...saved, modelProviderId: "deepseek", modelId: "deepseek-unqualified" }), /has not been verified/);
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
    assistantSelection: recommend(catalog()).senior, assistantRouting
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
  assert.deepEqual(await store.read(), { schemaVersion: 5, revision: 0, owner: {}, nonOwner: {} });
  const { senior, junior } = recommend(catalog());
  const first = await store.write({ owner: { senior, junior, colleague: { follows: "senior" } }, nonOwner: {} }, 0);
  assert.equal(first.revision, 1);
  await assert.rejects(store.write({ owner: {}, nonOwner: {} }, 0), /another tab/);
  assert.deepEqual(await store.read(), first);
  const file = path.join(root, "ai-connections", "routing.json");
  for (const owner of [{ colleague: { follows: "junior" }, fix: { follows: "colleague" } }, { senior: { follows: "junior" } },
    { colleague: { follows: "colleague" } }, { colleague: { follows: "senior", extra: true } }, { sharedBackup: senior }]) {
    await assert.rejects(store.write({ owner, nonOwner: {} }, 1), /unsupported shape/);
  }
  await assert.rejects(store.write({ owner: {}, nonOwner: { senior } }, 1), /unsupported shape/, "team members have no main chat roles");
  await assert.rejects(store.write({ owner: { senior, junior: { ...junior, engineId: "opencode" } }, nonOwner: {} }, 1), /same tool/);
  await writeFile(file, JSON.stringify({ schemaVersion: 4, revision: 1, orchestrators: {} }));
  await assert.rejects(store.read(), (error) => error.code === "vibe64_assistant_routing_upgrade_required");
  await writeFile(file, "broken");
  await assert.rejects(store.write({ owner: {}, nonOwner: {} }, 1));
  assert.equal(await readFile(file, "utf8"), "broken");
});

test("Accounts reads and saves both setups for the owner only and refuses personal team models per field", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-accounts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const manager = createSessionAgentManager({
    providers: [{ id: "codex", transportId: "codex_app_server", async capabilities() { return catalog(); } },
      { id: "opencode", transportId: "opencode_server", async capabilities() { return catalog(["deepseek"], "opencode"); } }],
    readAssistantAccess: async ({ modelProviderId }) => ({ available: true, ownerOnly: modelProviderId === "openai", connectionIdentity: `fixture-${modelProviderId}` })
  });
  const service = createService({
    accountRuntime: createAccountsRuntime({ systemRoot: root, targetRoot: root,
      requireAiManagement: ({ vibe64User } = {}) => vibe64User?.role === "owner" ? null : { ok: false, error: "Owner required" } }),
    inspectRoutingConfiguration: (configuration, options) => manager.inspectRoutingConfiguration(configuration, options) });
  assert.equal(service.readModelRoutingWorkflows, undefined, "the per-tool workflow read is gone");
  const owner = { role: "owner" };
  const data = await service.readModelRouting();
  assert.equal(data.ok, true, JSON.stringify(data));
  assert.deepEqual(data.team, { available: false, ownerName: "", memberCount: 0 });
  assert.deepEqual([data.setups.owner.roles.senior.value, data.setups.owner.roles.senior.configured], [null, false]);
  assert.equal(data.setups.nonOwner.roles.colleague.choices.some(({ modelProviderId }) => modelProviderId === "openai"), false,
    "team pickers list no personal choices");
  const recommendations = recommend(catalog());
  const input = { revision: data.revision, owner: Object.fromEntries(SCORED_ROLES.map((role) => [role, recommendations[role]])) };
  assert.equal((await service.saveModelRouting(input)).ok, false);
  const saved = await service.saveModelRouting({ ...input, vibe64User: owner });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.setups.owner.roles.junior.value.modelId, "gpt-6-sol");
  assert.equal(saved.setups.owner.roles.junior.value.selectionSource, "recommended");
  assert.equal((await service.saveModelRouting({ ...input, vibe64User: owner })).ok, false, "a stale revision is refused");
  const personal = await service.saveModelRouting({ revision: saved.revision, nonOwner: { colleague: recommendations.senior }, vibe64User: owner });
  assert.equal(personal.ok, false);
  assert.equal(personal.fieldErrors["nonOwner.colleague"], "Team members can't use personal plans. Choose a Workspace-use model.");
  const split = await service.saveModelRouting({ revision: saved.revision, owner: { junior: { ...recommendations.junior, engineId: "opencode", agentId: "opencode", modelProviderId: "deepseek", modelId: "deepseek-flash" } }, vibe64User: owner });
  assert.equal(split.fieldErrors["owner.junior"], "Senior and Junior must run in the same tool.");
  const team = await service.initializeModelRouting({ setup: "nonOwner", vibe64User: owner,
    preferProvider: { modelProviderId: "deepseek", engineId: "codex" } });
  assert.equal(team.ok, true, JSON.stringify(team));
  const filled = await createAssistantRoutingStore({ systemRoot: root }).read();
  assert.equal(filled.nonOwner.quickHelper.modelProviderId, "deepseek");
  assert.deepEqual([filled.nonOwner.fix, filled.nonOwner.explain], [{ follows: "colleague" }, { follows: "quickHelper" }]);
  assert.deepEqual(filled.owner, (await createAssistantRoutingStore({ systemRoot: root }).read()).owner);
  assert.deepEqual((await service.initializeModelRouting({ setup: "nonOwner", vibe64User: owner })).initialized, [], "filled roles are kept");
});

test("the main AI changes with the Senior or Junior tool or model, not a thinking level, Router or first setup", () => {
  const senior = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-sol", variantId: "high" };
  const owner = { senior, junior: senior, router: senior };
  assert.equal(assistantMainAiChanged({}, owner), false, "a first setup has no previous main AI");
  assert.equal(assistantMainAiChanged(owner, { ...owner, senior: { ...senior, variantId: "low" } }), false, "a thinking level change keeps the main AI");
  assert.equal(assistantMainAiChanged(owner, { ...owner, router: { ...senior, modelId: "gpt-6-luna" } }), false);
  assert.equal(assistantMainAiChanged(owner, { ...owner, junior: { ...senior, modelId: "gpt-6-luna" } }), true);
  assert.equal(assistantMainAiChanged(owner, { ...owner, senior: { ...senior, engineId: "opencode" } }), true);
});

function routingFixture() {
  const codex = catalog();
  const opencode = { ...catalog(["openai"]), engineId: "opencode", label: "OpenCode",
    defaults: { agentId: "build", modelProviderId: "opencode", modelId: "zen-model", variantId: "" },
    agents: [{ id: "build", mode: "primary" }],
    modelProviders: [{ id: "opencode", label: "Zen", connected: true, models: [
      { id: "zen-model", label: "Zen model", status: "available", variants: [], capabilities: { toolcall: true } }
    ] }] };
  const connectionAccess = [
    { engineId: "codex", modelProviderId: "openai", ownerOnly: true, available: true, connectionIdentity: "native-login-1" },
    { engineId: "codex", modelProviderId: "deepseek", ownerOnly: false, available: true, connectionIdentity: "deepseek-key-1" },
    { engineId: "codex", modelProviderId: "zai-coding-plan", ownerOnly: true, available: true, connectionIdentity: "glm-plan-1" },
    { engineId: "opencode", modelProviderId: "opencode", ownerOnly: false, available: true, connectionIdentity: "workspace-zen" }
  ];
  const roles = recommend(codex);
  // Resolver/access cases keep explicit shared DeepSeek routes independently of recommendation policy.
  roles.junior = routingAssignmentSelection(codex, { ...roles.junior, modelProviderId: "deepseek", modelId: "deepseek-flash" });
  roles.quickHelper = { ...roles.junior, variantId: "low" };
  roles.router = { ...roles.quickHelper };
  const zen = recommend(opencode).senior;
  const configuration = { revision: 4, owner: roles,
    nonOwner: { colleague: zen, quickHelper: roles.quickHelper, fix: { follows: "colleague" }, explain: { follows: "quickHelper" } } };
  const input = { actor: { id: "member", role: "member" }, configuration, catalogs: [codex, opencode], connectionAccess };
  return { input, roles, zen, resolve: (purpose, options = {}) => resolveAssistantPurpose({ ...input, purpose, ...options }) };
}

test("shipped score JSON has complete bounded scores and unique exact route identities", () => {
  const identities = new Set();
  for (const row of routingScores.models) {
    const key = JSON.stringify([row.engineId, row.modelProviderId, row.modelId]);
    assert.ok(!identities.has(key), key);
    identities.add(key);
    assert.ok(["codex", "claude", "opencode"].includes(row.engineId));
    assert.ok(row.modelProviderId && row.modelId);
    for (const role of SCORED_ROLES) assert.equal(routingModelScore(row, role), row.scores[role]);
  }
  for (const scores of [routingScores.defaultScores, ...Object.values(routingScores.providerDefaultScores), ...routingScores.models.map(({ scores }) => scores)]) {
    assert.deepEqual(Object.keys(scores).sort(), [...SCORED_ROLES].sort());
    for (const value of Object.values(scores)) assert.ok(Number.isInteger(value) && value >= 1 && value <= 10);
  }
});

test("scores do not admit unsupported Codex history routes; isolated Router has its own compatibility", () => {
  const engine = catalog();
  engine.modelProviders.find(({ id }) => id === "deepseek").models.push({ id: "deepseek-unqualified", label: "deepseek-unqualified", status: "available", variants: [{ id: "high" }] });
  const choice = (modelId, options) => routingModelChoices(engine, options).find((candidate) => candidate.modelId === modelId);
  // Curated models follow JSKIT's live Codex history qualification.
  for (const modelId of ["deepseek-flash", "deepseek-v4-pro"]) {
    assert.equal(Boolean(choice(modelId).compatibilityError), curatedCodexModel(modelId, "deepseek").codexHistoryRouting !== true, modelId);
    assert.equal(choice(modelId, { purpose: "request_routing" }).compatibilityError, "", modelId);
  }
  assert.ok(choice("deepseek-unqualified").compatibilityError);
  const ordinary = choice("deepseek-flash");
  engine.modelProviders.push({ id: "unqualified", connected: true, models: [{ id: "gpt-6-astra", status: "available", variants: [] }] });
  assert.ok(routingModelChoices(engine, { purpose: "request_routing" }).find(({ modelProviderId }) => modelProviderId === "unqualified").compatibilityError);
  assert.equal(routingModelScore({ ...ordinary, modelId: "fake-deepseek-flash" }, "junior"), 4);
});

test("equal recommendations prefer Claude Code, then saved choices, then a stable order", () => {
  const catalogs = [["claude", "claude_stream_json"], ["codex", "codex_app_server"], ["opencode", "opencode_server"]].map(([engineId, transportId]) => ({
    ...catalog(["deepseek"]), engineId, transportId,
    defaults: { agentId: engineId, modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low" },
    agents: [{ id: engineId, mode: "primary" }]
  }));
  const connectionAccess = catalogs.map(({ engineId }) => ({ engineId, modelProviderId: "deepseek", ownerOnly: false, available: true }));
  for (const ordered of [catalogs, [...catalogs].reverse()]) {
    const roles = recommend(ordered, { connectionAccess });
    for (const role of ["router", "quickHelper"]) assert.deepEqual([roles[role].engineId, roles[role].modelId], ["claude", "deepseek-flash"], role);
  }
  const unavailable = connectionAccess.map((access) => ({ ...access, available: access.engineId !== "claude" }));
  const values = { quickHelper: recommend(catalogs[2], { connectionAccess }).quickHelper };
  assert.equal(recommend(catalogs, { connectionAccess: unavailable, values }).quickHelper.engineId, "opencode",
    "an unavailable connection cannot win; the saved choice breaks the remaining tie");
});

test("main chat always uses the owner setup; everyone else's helpers use their own setup", () => {
  for (const purpose of MAIN_CHAT_PURPOSES) {
    for (const actor of [null, { role: "owner" }, { role: "member" }]) assert.equal(assistantRoutingSetupFor(purpose, actor), "owner", purpose);
  }
  for (const purpose of Object.keys(ASSISTANT_PURPOSE_ROLES).filter((purpose) => !MAIN_CHAT_PURPOSES.includes(purpose))) {
    assert.equal(assistantRoutingSetupFor(purpose, null), "owner", purpose);
    assert.equal(assistantRoutingSetupFor(purpose, { role: "owner" }), "owner", purpose);
    assert.equal(assistantRoutingSetupFor(purpose, { role: "member" }), "nonOwner", purpose);
  }
  assert.equal(assistantRoutingSetupFor("custom", { role: "member" }, { temporaryChat: true }), "nonOwner",
    "a temporary chat's Custom model is the person's own choice");
});

test("team members never reach main chat models; their messages need the owner's approval", () => {
  const f = routingFixture();
  for (const purpose of ["senior", "junior", "auto", "review", "deslop", "request_routing"]) {
    const member = f.resolve(purpose, { reviewEnabled: purpose === "auto" });
    assert.deepEqual([member.available, member.reasonCode, member.approvalRequired], [false, "vibe64_main_chat_approval_required", true], purpose);
    assert.equal(member.message, "Main chat runs on the owner's AI. Your messages wait for their approval.");
    assert.equal(member.effectiveSelection, null);
    const owner = f.resolve(purpose, { actor: { role: "owner" }, reviewEnabled: purpose === "auto" });
    assert.equal(owner.available, true, `${purpose}: ${owner.message}`);
    assert.equal(owner.setup, "owner");
  }
  assert.equal(f.resolve("custom", { override: { role: "custom", selection: f.zen } }).approvalRequired, true);
});

test("a team member's lesson runs main chat on the team setup without approval, never on a personal plan", () => {
  const f = routingFixture();
  const lesson = { practice: true };
  for (const purpose of MAIN_CHAT_PURPOSES.filter((purpose) => purpose !== "custom")) {
    assert.equal(assistantRoutingSetupFor(purpose, { role: "member" }, lesson), "nonOwner", purpose);
    assert.equal(assistantRoutingSetupFor(purpose, { role: "owner" }, lesson), "owner", `${purpose}: owner lessons are unchanged`);
    const member = f.resolve(purpose, { ...lesson, reviewEnabled: purpose === "auto" });
    assert.equal(member.available, true, `${purpose}: ${member.message}`);
    assert.equal(member.setup, "nonOwner");
    assert.equal(member.approvalRequired, undefined);
  }
  const senior = f.resolve("senior", lesson);
  assert.deepEqual([senior.effectiveSelection.modelId, senior.connectionIdentity], ["zen-model", "workspace-zen"], "Senior is the team Colleague");
  assert.deepEqual(Object.values(senior.seniorJuniorPair).map(({ effectiveSelection }) => effectiveSelection.modelId), ["zen-model", "zen-model"]);
  const auto = f.resolve("auto", { ...lesson, reviewEnabled: true });
  assert.deepEqual([auto.seniorJuniorPair.junior.effectiveSelection.modelId, auto.router.modelId], ["zen-model", "deepseek-flash"],
    "Router is the team Quick helper");
  assert.equal(f.resolve("custom", { ...lesson, override: { role: "custom", selection: f.zen } }).available, true,
    "the learner may choose any team model");
  const personal = f.resolve("custom", { ...lesson, override: { role: "custom", selection: f.roles.senior } });
  assert.deepEqual([personal.available, personal.reasonCode], [false, "vibe64_assistant_owner_required"]);
  // The owner's personal Senior is never reached, even when the team Colleague is missing.
  delete f.input.configuration.nonOwner.colleague;
  for (const purpose of ["senior", "junior", "auto"]) {
    const missing = f.resolve(purpose, lesson);
    assert.deepEqual([missing.available, missing.reasonCode, missing.message], [false, "vibe64_team_ai_role_unconfigured",
      "The workspace owner hasn't chosen a Colleague model for team members yet."], purpose);
  }
  f.input.configuration.nonOwner.colleague = f.roles.senior;
  assert.equal(f.resolve("senior", lesson).reasonCode, "vibe64_assistant_owner_required");
  assert.equal(f.resolve("senior").approvalRequired, true, "outside a lesson members still wait for approval");
});

test("dispatch knows a lesson from its practice project, never from its input", async () => {
  const f = routingFixture();
  const manager = createSessionAgentManager({
    providers: [{ id: "codex", transportId: "codex_app_server" }, { id: "opencode", transportId: "opencode_server" }],
    readAssistantAccess: async ({ engineId, modelProviderId }) => f.input.connectionAccess
      .find((fact) => fact.engineId === engineId && fact.modelProviderId === modelProviderId)
  });
  const member = { vibe64User: f.input.actor, configuration: f.input.configuration };
  const inspect = () => manager.inspectAssistantPurposes({ practice: true }, member);
  assert.equal((await inspect()).senior.approvalRequired, true);
  const lesson = await runWithPracticeProjectContext("lesson-test", { slug: `training-${"b".repeat(32)}` }, inspect);
  assert.deepEqual([lesson.senior.available, lesson.senior.setup, lesson.senior.effectiveSelection.modelId], [true, "nonOwner", "zen-model"]);
  const practiceRuntime = { projectContextRoot: `/projects/training-${"c".repeat(32)}` };
  const followup = await manager.inspectAssistantPurposes({}, { ...member, runtime: practiceRuntime });
  assert.equal(followup.auto.available, true, "work after the request still knows its lesson");
});

test("Same as follows one role of the same setup and names the followed role", () => {
  const f = routingFixture();
  const owner = { actor: { role: "owner" } };
  const ownerColleague = f.resolve("colleague", owner);
  assert.deepEqual([ownerColleague.role, ownerColleague.setup, ownerColleague.followedRole], ["colleague", "owner", "senior"]);
  assert.equal(ownerColleague.effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(f.resolve("fix", owner).effectiveSelection.modelId, "deepseek-flash");
  const memberColleague = f.resolve("colleague");
  assert.deepEqual([memberColleague.setup, memberColleague.followedRole, memberColleague.effectiveSelection.modelId], ["nonOwner", "", "zen-model"]);
  const fix = f.resolve("fix");
  assert.deepEqual([fix.followedRole, fix.effectiveSelection.modelId, fix.connectionIdentity], ["colleague", "zen-model", "workspace-zen"]);
  for (const purpose of ["source_explanation", "database_assistant", "lesson_review"]) {
    const explain = f.resolve(purpose);
    assert.deepEqual([explain.role, explain.followedRole, explain.effectiveSelection.modelProviderId], ["explain", "quickHelper", "deepseek"], purpose);
    assert.deepEqual(explain.executionProfileRequest, { profileId: "helper", workloadId: purpose });
  }
  for (const purpose of ["commit_title", "session_title", "prompt_hint", "conversation_summary", "voice_turn", "quick_helper"]) {
    assert.equal(f.resolve(purpose).role, "quickHelper", purpose);
    assert.equal(f.resolve(purpose).available, true, purpose);
  }
  delete f.input.configuration.nonOwner.colleague;
  assert.deepEqual([f.resolve("fix").reasonCode, f.resolve("fix").message], ["vibe64_team_ai_role_unconfigured",
    "The workspace owner hasn't chosen a Colleague model for team members yet."]);
  f.input.configuration.owner.quickHelper = null;
  assert.deepEqual([f.resolve("source_explanation", owner).reasonCode, f.resolve("source_explanation", owner).message],
    ["vibe64_assistant_role_unconfigured", "Choose a Quick helper model in Models."]);
  f.input.configuration.owner.explain = null;
  assert.equal(f.resolve("source_explanation", owner).message, "Choose an Explain & check model in Models.");
});

test("a personal model in the team setup is refused at use while the owner keeps it", () => {
  const f = routingFixture();
  f.input.configuration.nonOwner.colleague = f.roles.senior;
  const member = f.resolve("colleague");
  assert.equal(member.available, false);
  assert.equal(member.reasonCode, "vibe64_assistant_owner_required");
  assert.equal(member.message, "This team model uses a personal plan. The workspace owner must choose a Workspace-use model.");
  assert.equal(f.resolve("colleague", { actor: { role: "owner" } }).effectiveSelection.modelId, "gpt-6-astra");
  const custom = f.resolve("custom", { temporaryChat: true, override: { role: "custom", selection: f.roles.senior } });
  assert.equal(custom.message, "This custom model uses a personal connection. Choose a model you can access.");
  assert.equal(f.resolve("custom", { temporaryChat: true, override: { role: "custom", selection: f.zen } }).available, true);
});

test("Senior and Junior run in one tool; no result carries Backup fields", () => {
  const f = routingFixture();
  const owner = { actor: { role: "owner" } };
  for (const purpose of [...Object.keys(ASSISTANT_PURPOSE_ROLES), "auto"]) {
    for (const actor of [{ role: "owner" }, { role: "member" }]) {
      const result = f.resolve(purpose, { actor, override: purpose === "custom" ? { role: "custom", selection: f.zen } : undefined });
      assert.ok(!["backupUsed", "backupReason"].some((key) => Object.hasOwn(result, key)), purpose);
    }
  }
  assert.equal(f.resolve("junior", { ...owner, override: { role: "junior", selection: f.zen } }).message,
    "Senior and Junior overrides must run in your main AI's tool.");
  f.input.configuration.owner.junior = f.zen;
  assert.equal(f.resolve("junior", owner).message, "Senior and Junior must run in the same tool.");
});

test("old routing snapshots and chat preferences require the state upgrade", () => {
  const f = routingFixture();
  for (const configuration of [{ revision: 3, orchestrators: { codex: f.roles } }, { revision: 3 }]) {
    const result = f.resolve("junior", { actor: { role: "owner" }, configuration });
    assert.equal(result.reasonCode, "vibe64_assistant_routing_upgrade_required");
    assert.match(result.message, /predates the current AI setup/);
  }
  assert.throws(() => assistantRoutingPreferences({ mode: "senior", workflowEngineId: "codex" }),
    (error) => error.code === "vibe64_assistant_routing_upgrade_required");
  assert.deepEqual(assistantRoutingPreferences({ mode: "fix", review: true }), { mode: "fix", review: false, autoSave: false });
});

test("Deslop and automatic save default on and keep an explicit off", () => {
  assert.deepEqual(assistantRoutingPreferences({ mode: "auto" }), { mode: "auto", review: true, autoSave: true });
  assert.deepEqual(assistantRoutingPreferences({ mode: "auto", review: false, autoSave: false }), { mode: "auto", review: false, autoSave: false });
  // Custom carries no choice, so Auto after it starts with both on.
  assert.deepEqual(assistantRoutingAutomation({ mode: "custom", review: false, autoSave: false }), { review: true, autoSave: true });
  assert.deepEqual(assistantRoutingAutomation(null), { review: true, autoSave: true });
});

test("Auto names missing assignments and preserves connection and access failure reasons", () => {
  const f = routingFixture();
  const owner = { actor: { role: "owner" } };
  const roles = f.input.configuration.owner;
  const router = roles.router;
  roles.router = null;
  const missing = f.resolve("auto", owner);
  assert.equal(missing.available, false);
  assert.deepEqual(missing.missingRoles, ["router"]);
  assert.equal(missing.message, "Auto needs a Router model. Choose one in Models.");
  const senior = roles.senior;
  roles.senior = null;
  assert.equal(f.resolve("auto", owner).message, "Auto needs models for Senior and Router. Choose them in Models.");
  assert.equal(f.resolve("junior", owner).message, "Choose a Senior model in Models.");
  roles.router = router;
  roles.senior = senior;
  const shared = f.resolve("auto", owner);
  assert.equal(shared.available, true, shared.message);
  assert.equal(shared.router.modelId, "deepseek-flash");
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").available = false;
  assert.match(f.resolve("auto", owner).message, /connection is unavailable/);
});

test("the owner keeps the configured pair and captured review uses Senior", () => {
  const f = routingFixture();
  const result = f.resolve("junior", { actor: { role: "owner" }, reviewEnabled: true });
  assert.equal(result.available, true, result.message);
  assert.equal(result.engineId, "codex");
  assert.equal(result.effectiveSelection.modelId, "deepseek-flash");
  assert.equal(result.seniorJuniorPair.senior.effectiveSelection.modelId, "gpt-6-astra");
  const override = { role: "junior", selection: { ...f.roles.junior, variantId: "low" } };
  const overridden = f.resolve("junior", { actor: { role: "owner" }, override });
  assert.equal(overridden.configuredSelection.variantId, "low");
});

test("a deleted connection identity or an unavailable model is an error, never a substitution", () => {
  const f = routingFixture();
  const owner = { actor: { role: "owner" } };
  f.input.connectionAccess.find(({ modelProviderId }) => modelProviderId === "deepseek").available = false;
  const result = f.resolve("junior", owner);
  assert.deepEqual([result.available, result.reasonCode], [false, "vibe64_assistant_connection_unavailable"]);
  assert.equal(f.resolve("prompt_hint").available, false);
  f.input.connectionAccess.shift();
  assert.match(f.resolve("senior", owner).message, /no longer recognised/);
});

test("capability requirements are checked on effective models without changing destinations", () => {
  const f = routingFixture();
  const owner = { actor: { role: "owner" } };
  assert.equal(f.resolve("senior", { ...owner, requirements: { capabilities: ["images"] } }).available, false);
  assert.equal(f.resolve("junior", { ...owner, reviewEnabled: true, requirements: { review: ["images"] } }).available, false);
  assert.equal(f.resolve("auto", { ...owner, reviewEnabled: false, requirements: { review: ["images"] } }).available, false,
    "Auto must validate the mandatory reviewer even when optional cleanup is disabled");
  const result = f.resolve("colleague", { requirements: { capabilities: ["toolcall"] } });
  assert.equal(result.available, true, result.message);
  assert.equal(result.effectiveSelection.modelId, "zen-model");
});

test("the pure resolver requires a trusted actor input; standalone null is the owner", () => {
  const f = routingFixture();
  assert.equal(f.resolve("senior", { actor: undefined }).available, false);
  assert.equal(f.resolve("senior", { actor: null }).effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(f.resolve("colleague", { actor: null }).setup, "owner");
  assert.equal(f.resolve("unknown", { actor: null }).available, false);
});

test("a workspace Zen model is eligible for chat, Router and bounded Helpers in either setup", () => {
  const f = routingFixture();
  const engine = f.input.catalogs[1];
  for (const setup of ["owner", "nonOwner"]) {
    const recommended = recommend(engine, { setup, connectionAccess: f.input.connectionAccess });
    for (const role of setup === "owner" ? SCORED_ROLES : ["colleague", "quickHelper"]) assert.equal(recommended[role].modelId, "zen-model", `${setup} ${role}`);
  }
  Object.assign(f.input.configuration.owner, { router: f.zen, quickHelper: f.zen });
  for (const purpose of ["request_routing", "prompt_hint", "voice_turn", "auto"]) {
    const result = f.resolve(purpose, { actor: { role: "owner" } });
    assert.equal(result.available, true, result.message);
  }
});

test("subscriptions run only in their own tool; key models list every tool that offers them", () => {
  const sources = (code) => readdirSync(path.resolve("packages"), { recursive: true })
    .filter((file) => /\/src\/.*\.js$/u.test(`/${file}`) && readFileSync(path.resolve("packages", file), "utf8").includes(`"${code}"`))
    .filter((file) => !file.endsWith("shared/assistantRouting.js"));
  assert.deepEqual(sources("claude_subscription"), ["vibe64-terminals/src/server/claudeConversationAccounts.js"]);
  assert.deepEqual(sources("codex_subscription"), ["vibe64-runtime/src/server/codexAppServerProvider.js"]);
  const choice = (engineId, modelProviderId, modelId, endpointCode) => ({ engineId, modelProviderId, modelId, endpointCode });
  const groups = routingRunsInChoices([choice("claude", "anthropic", "opus", "claude_subscription"), choice("codex", "openai", "gpt-6-sol", "codex_subscription"),
    choice("claude", "deepseek", "deepseek-v4-pro", ""), choice("codex", "deepseek", "deepseek-v4-pro", ""), choice("opencode", "deepseek", "deepseek-v4-pro", "")]);
  assert.deepEqual(groups.map(({ modelId, billing, engineIds, fixedRunsIn }) => [modelId, billing, engineIds, fixedRunsIn]), [
    ["opus", "claude_subscription", ["claude"], { engineId: "claude", reason: "claude_plan" }],
    ["gpt-6-sol", "codex_subscription", ["codex"], { engineId: "codex", reason: "chatgpt_plan" }],
    ["deepseek-v4-pro", "key", ["claude", "codex", "opencode"], undefined]
  ]);
});

test("routing metadata readers and goal completion share one definition", () => {
  assert.equal(goalStatusIsComplete("complete"), true);
  assert.equal(goalStatusIsComplete("completed"), true);
  for (const status of ["active", "paused", "", undefined]) assert.equal(goalStatusIsComplete(status), false);
  const metadata = {
    assistant_routing_goal: JSON.stringify({ status: "active", objective: "Ship it" }),
    assistant_routing_request: JSON.stringify({ status: "working", delivery: "accepted" })
  };
  assert.deepEqual(assistantRoutingGoalFromMetadata(metadata), { status: "active", objective: "Ship it" });
  assert.deepEqual(assistantRoutingRequestFromMetadata(metadata), { status: "working", delivery: "accepted" });
  assert.equal(assistantRoutingGoalFromMetadata({}), null);
  assert.equal(assistantRoutingRequestFromMetadata(undefined), null);
  // Guards refuse an unreadable saved request; views show it as none.
  const unreadable = { assistant_routing_request: "{not json" };
  assert.throws(() => assistantRoutingRequestFromMetadata(unreadable), SyntaxError);
  assert.equal(assistantRoutingRequestForDisplay(unreadable), null);
  assert.deepEqual(assistantRoutingRequestForDisplay(metadata), { status: "working", delivery: "accepted" });
});

test("an unreadable pinned goal is refused with one coded error, and goal activity has one rule", () => {
  for (const raw of ["{not json", "[]", "\"text\"", "7"]) {
    assert.throws(() => assistantRoutingGoalFromMetadata({ assistant_routing_goal: raw }),
      (error) => error.code === "vibe64_assistant_goal_invalid" && error.statusCode === 409);
  }
  assert.equal(assistantRoutingGoalFromMetadata({ assistant_routing_goal: "null" }), null);
  assert.equal(assistantGoalIsActive(null), false);
  assert.equal(assistantGoalIsActive({ status: "completed" }), false);
  assert.equal(assistantGoalIsActive({ status: "paused" }), true);
});

test("workflow state, role, sent messages and selection identity each have one owner", () => {
  assert.equal(assistantWorkflowStateIsSupported({ status: "waiting", delivery: "pending" }), true);
  assert.equal(assistantWorkflowStateIsSupported({ status: "reviewing", delivery: "pending" }), false);
  assert.equal(assistantWorkflowStateIsSupported({ status: "waiting", delivery: "sent" }), false);
  // The upgrade refuses exactly the v5 states the coordinator refuses.
  assert.throws(() => assistantWorkflowUpgradeChanges({ metadata: { assistant_routing_request: JSON.stringify({ schemaVersion: 5, status: "waiting", delivery: "sent" }) } }),
    /unsupported state/u);
  const assignments = { senior: { engineId: "codex", modelId: "senior-model" }, junior: { engineId: "codex", modelId: "junior-model" } };
  const followup = { messageId: "followup-1" };
  assert.equal(assistantWorkflowRole({ stage: "review", followup, resolvedMode: "junior" }), "senior");
  assert.equal(assistantWorkflowRole({ stage: "review", resolvedMode: "junior" }), "junior");
  assert.match(assistantRoutingStatusLabel({ stage: "review", followup, resolvedMode: "junior", status: "working", delivery: "accepted", assignments }), /senior-model/u);
  assert.deepEqual(assistantWorkflowMessageIds({ messageId: "message-1", followup }), ["message-1", "followup-1"]);
  assert.deepEqual(assistantWorkflowMessageIds({ messageId: "message-1" }), ["message-1"]);
  const selection = { engineId: "codex", modelProviderId: "openai", modelId: "gpt", agentId: "", variantId: "high" };
  assert.equal(sameVibe64AssistantSelection(selection, { ...selection, agentId: undefined }), true);
  assert.equal(sameVibe64AssistantSelection(selection, { ...selection, modelId: " gpt " }), true);
  assert.equal(sameVibe64AssistantSelection(selection, { ...selection, variantId: "low" }), false);
  assert.equal(assistantRoutingRequestCanBeReplaced({ stopped: true, deliverySelection: selection }, { ...selection, variantId: "low" }), true);
});

test("a restored automatic follow-up turn is recognised as the routed request's own", () => {
  const request = { schemaVersion: 5, status: "working", delivery: "accepted", messageId: "message-1",
    followup: { messageId: "followup-1" }, submittedBy: { id: "owner", username: "owner", role: "owner" } };
  const metadata = { assistant_routing_request: JSON.stringify(request) };
  const upstream = (id) => `upstream:${id}`;
  for (const id of ["message-1", "followup-1"]) {
    assert.deepEqual(assistantRoutingRequestForMessage(metadata, (messageId) => upstream(messageId) === upstream(id))?.submittedBy, request.submittedBy);
  }
  assert.equal(assistantRoutingRequestForMessage(metadata, (messageId) => messageId === "other"), null);
  assert.equal(assistantRoutingRequestForMessage({}, () => true), null);
  // The retired v4 field is not a routed message.
  const legacy = { assistant_routing_request: JSON.stringify({ ...request, followup: undefined, reviewMessageId: "review-1" }) };
  assert.equal(assistantRoutingRequestForMessage(legacy, (messageId) => messageId === "review-1"), null);
  assert.throws(() => assistantRoutingRequestForMessage({ assistant_routing_request: JSON.stringify({ ...request, schemaVersion: 4 }) }, () => true),
    (error) => error.code === "vibe64_assistant_workflow_upgrade_required");
});
