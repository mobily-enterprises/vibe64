import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "@local/vibe64-accounts/server/service";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantModePrompt, assistantRoutingPrompt, parseRoutingDecision, recommendedRoutingAssignments,
  routingAssignmentSelection } from "@local/vibe64-runtime/shared/assistantRouting";

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

test("recommendations keep Astra for Plan and prefer qualified DeepSeek over GLM for Code", () => {
  for (const [providers, expected] of [
    [["openai"], "gpt-6-sol"], [["openai", "zai-coding-plan"], "glm-5.3"],
    [["openai", "deepseek"], "deepseek-flash"], [["openai", "zai-coding-plan", "deepseek"], "deepseek-flash"]
  ]) {
    const roles = recommendedRoutingAssignments(catalog(providers));
    assert.equal(roles.plan.modelId, "gpt-6-astra");
    assert.equal(roles.code.modelId, expected);
    assert.equal(roles.economy.modelId, "gpt-6-luna");
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
    '{"mode":"code","reason":"explicit_implementation","url":"https://example.invalid"}']) {
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
  const service = createService({ systemRoot: root, targetRoot: root,
    canManageCodex: ({ vibe64User } = {}) => vibe64User?.role === "owner" ? null : { ok: false, error: "Owner required" },
    listAssistantCapabilities: async () => ({ engines: [catalog()] }) });
  const data = await service.readModelRouting();
  assert.equal(data.ok, true);
  assert.equal(data.engines[0].roles.plan.assignment, null);
  const input = { revision: data.revision, orchestrators: { codex: recommendedRoutingAssignments(catalog()) } };
  assert.equal((await service.saveModelRouting(input)).ok, false);
  const saved = await service.saveModelRouting({ ...input, vibe64User: { role: "owner" } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.engines[0].roles.code.assignment.modelId, "deepseek-flash");
  assert.equal(saved.engines[0].roles.code.assignment.selectionSource, "recommended");
  assert.equal((await service.saveModelRouting({ ...input, vibe64User: { role: "owner" } })).ok, false);
});
