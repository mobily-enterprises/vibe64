import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantRoutingStore } from "../../packages/vibe64-core/src/server/assistantRoutingStore.js";
import { validateAssistantRoutingConfiguration } from "../../packages/vibe64-core/src/server/stateUpgrades/routingV2Format.js";
import { upgradeAssistantRoles } from "../../packages/vibe64-accounts/src/server/assistantRoleUpgrade.js";
import { upgradeAssistantRouting, upgradeAssistantRoutingConfiguration } from "../../packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js";
import { defineVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server";

const selection = (engineId, modelProviderId, modelId, selectionSource = "explicit") => ({
  schema: "vibe64.assistant-selection.v1", engineId, modelProviderId, modelId, selectionSource,
  agentId: engineId === "opencode" ? "build" : engineId, variantId: engineId === "opencode" ? "" : "low",
  catalogRevision: `sha256:${"a".repeat(64)}`
});
const astra = selection("codex", "openai", "gpt-6-astra");
const deepseek = selection("codex", "deepseek", "deepseek-flash");
const pickle = selection("opencode", "opencode", "big-pickle");
const nativeHelper = selection("codex", "openai", "gpt-5.6-luna");
const old = (roles = {}) => ({ schemaVersion: 1, revision: 6, orchestrators: { codex: { plan: astra, code: deepseek, economy: deepseek, ...roles } } });
const curatedConnections = [{ id: "deepseek", connected: true, claudeReady: true }];
const included = { id: "opencode", economyModelId: "big-pickle", connected: true, ownerOnly: false, builtIn: true };

test("configuration upgrade preserves selections and classifier while adding an eligible shared Backup", () => {
  const original = old();
  const result = upgradeAssistantRoutingConfiguration({ configuration: original, curatedConnections });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.revision, 7);
  for (const role of ["plan", "code", "economy"]) assert.deepEqual(result.orchestrators.codex[role], original.orchestrators.codex[role]);
  assert.deepEqual(result.orchestrators.codex.router, deepseek);
  assert.deepEqual(result.orchestrators.codex.sharedBackup, deepseek);
  assert.equal(result.orchestrators.codex.helperRoutingReview.previous.some((item) => item.modelId === "gpt-5.6-luna"), true);
  assert.equal(original.orchestrators.codex.router, undefined);
});

test("already saved independent Router and Backup choices, including null, remain authoritative", () => {
  for (const value of [pickle, null]) {
    const result = upgradeAssistantRoutingConfiguration({ configuration: old({ router: value, sharedBackup: value }), curatedConnections });
    assert.deepEqual(result.orchestrators.codex.router, value);
    assert.deepEqual(result.orchestrators.codex.sharedBackup, value);
  }
  const result = upgradeAssistantRoutingConfiguration({ configuration: old({ economy: pickle }), connections: [included] });
  assert.deepEqual(result.orchestrators.codex.economy, pickle);
  assert.deepEqual(result.orchestrators.codex.router, pickle);
  assert.deepEqual(result.orchestrators.codex.sharedBackup, pickle);
});

test("default and explicit helper conflicts retain narrow evidence, while identical destinations need no review", () => {
  const matching = upgradeAssistantRoutingConfiguration({ configuration: old({ economy: nativeHelper }) });
  assert.equal(matching.orchestrators.codex.helperRoutingReview, undefined);
  const explicit = upgradeAssistantRoutingConfiguration({ configuration: old(), nativeHelpers: { codex: { modelId: "old-custom-model" } } });
  assert.deepEqual(explicit.orchestrators.codex.helperRoutingReview.previous, [
    { engineId: "codex", modelProviderId: "openai", modelId: "old-custom-model", selectionSource: "explicit" }
  ]);
  assert.deepEqual(explicit.orchestrators.codex.economy, deepseek);
  const missing = upgradeAssistantRoutingConfiguration({ configuration: old({ economy: null }), nativeHelpers: { codex: { modelId: nativeHelper.modelId } } });
  assert.equal(missing.orchestrators.codex.economy.modelId, nativeHelper.modelId);
  assert.equal(missing.orchestrators.codex.economy.selectionSource, "explicit");
  assert.equal(missing.orchestrators.codex.router, null, "no previous classifier existed to migrate");
});

test("per-provider OpenCode helper settings require review instead of choosing one arbitrarily", () => {
  const result = upgradeAssistantRoutingConfiguration({ configuration: {
    schemaVersion: 1, revision: 1, orchestrators: { opencode: { plan: pickle, code: pickle } }
  }, connections: [included, { id: "deepseek", economyModelId: "deepseek-v4-flash", helperModelId: "custom-helper", connected: true, ownerOnly: false }] });
  const roles = result.orchestrators.opencode;
  assert.equal(roles.economy, null);
  assert.equal(roles.helperRoutingReview.previous.length, 2);
  assert.equal(roles.helperRoutingReview.previous.find((item) => item.modelProviderId === "deepseek").modelId, "custom-helper");
  assert.deepEqual(roles.sharedBackup, pickle, "an unqualified helper model cannot become the coding Backup");
});

test("missing routing establishes included defaults and native workflows evidenced by saved sessions", () => {
  const result = upgradeAssistantRoutingConfiguration({ configuration: null, historicalSelections: [astra, deepseek], curatedConnections });
  assert.equal(result.orchestrators.opencode.plan.modelId, "big-pickle");
  assert.deepEqual(result.orchestrators.codex.plan, { ...astra, selectionSource: "recommended" });
  assert.deepEqual(result.orchestrators.codex.code, { ...deepseek, selectionSource: "recommended" });
  assert.equal(result.orchestrators.codex.sharedBackup.modelId, "deepseek-flash");
});

test("configuration validation rejects unsupported shapes and direct mixed-engine Plan/Code", () => {
  for (const configuration of [{ ...old(), schemaVersion: 3 }, old({ code: pickle }), old({ plan: { ...astra, token: "SECRET" } })]) {
    assert.throws(() => upgradeAssistantRoutingConfiguration({ configuration }), /unsupported shape/u);
  }
  const current = upgradeAssistantRoutingConfiguration({ configuration: old() });
  assert.strictEqual(validateAssistantRoutingConfiguration(current), current);
  assert.strictEqual(upgradeAssistantRoutingConfiguration({ configuration: current }), current);
});

async function fixture(t, { populated = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-configuration-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const backupRoot = path.join(systemRoot, "upgrades/backups/20260923-routing-v2");
  const routingPath = path.join(systemRoot, "ai-connections/routing.json");
  const helperPath = path.join(systemRoot, "ai-connections/codex-helper-model.json");
  const connectionsPath = path.join(systemRoot, "ai-connections/connections.json");
  const projectRoot = path.join(systemRoot, "projects/project-one");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: projectRoot });
  const messages = [];
  const f = { root, systemRoot, backupRoot, routingPath, helperPath, connectionsPath, projectRoot, store, messages,
    run: (apply = false, onReport = () => {}) => upgradeAssistantRouting({ systemRoot, backupRoot, apply,
      report: (level, message) => { messages.push({ level, message }); onReport(level, message); } }) };
  if (!populated) return f;
  await mkdir(path.dirname(routingPath), { recursive: true });
  await writeFile(routingPath, JSON.stringify(old()));
  await writeFile(helperPath, JSON.stringify({ modelId: "old-custom-model" }));
  await writeFile(connectionsPath, JSON.stringify({ version: 5, preferredProviderId: "opencode", unrelated: "preserve", connections: {
    deepseek: { apiKey: "DO-NOT-LOG", helperModelId: "custom-helper", providerRevision: `sha256:${"a".repeat(64)}`, label: "My API" }
  } }));
  for (const sessionId of ["active", "archived"]) {
    await store.createSession({ sessionId, runtimeKind: "genesis" });
    await store.writeMetadataValue(sessionId, "assistant_selection", JSON.stringify(astra));
    await store.writeMetadataValue(sessionId, "agent_conversation_id", "native-main");
    await store.writeMetadataValue(sessionId, "assistant_routing_request", JSON.stringify({
      mode: "auto", assignments: { plan: astra, code: deepseek, economy: nativeHelper }, status: "uncertain",
      messageId: "original-message", attemptedMessageId: "original-message", threadId: "native-main", submittedBy: { id: "member" }
    }));
    await store.writeConversationUserMessage(sessionId, { messageId: "history-1", text: "Preserve full working context" });
    await store.writeSessionConversation(sessionId, "temporary-1", {
      assistantSelection: deepseek, providerConversationId: "native-temporary", title: "My chat"
    });
  }
  await store.writeSessionRenewalStateRecord("active", { kind: "vibe64.session_renewal", schemaVersion: 1, sessionId: "active", status: "running", stage: "successor_creating",
    approved: { text: "Retain the exact reviewed handover" }, successor: { assistantSelection: pickle, attempt: 2 } });
  await store.writeStatus("archived", VIBE64_SESSION_STATUS.ARCHIVED);
  await store.publishSessionArchive("archived");
  return f;
}

async function snapshot(root, prefix = "") {
  const result = {};
  let entries;
  try { entries = await readdir(path.join(root, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return result; throw error; }
  for (const entry of entries) {
    const key = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, key));
    else result[key] = (await readFile(path.join(root, key))).toString("base64");
  }
  return result;
}

test("preflight is read-only on fresh state and on active, temporary and archived conversations", async (t) => {
  const empty = await fixture(t, { populated: false });
  await empty.run();
  await assert.rejects(stat(empty.systemRoot), { code: "ENOENT" });
  const f = await fixture(t);
  const before = await snapshot(f.systemRoot);
  await f.run();
  assert.deepEqual(await snapshot(f.systemRoot), before);
  assert.equal(JSON.stringify(f.messages).includes("DO-NOT-LOG"), false);
  assert.ok(f.messages.some((item) => item.level === "warning" && item.message.includes("helpers differ")));
});

test("the live routing store reads only the current format and never upgrades during reads", async (t) => {
  const f = await fixture(t, { populated: false });
  const store = createAssistantRoutingStore({ systemRoot: f.systemRoot });
  assert.deepEqual(await store.read(), { schemaVersion: 3, revision: 0, orchestrators: {} });
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  const config = upgradeAssistantRoutingConfiguration({ configuration: old({ economy: pickle }), connections: [included] });
  await mkdir(path.dirname(f.routingPath), { recursive: true });
  await writeFile(f.routingPath, JSON.stringify(config));
  await upgradeAssistantRoles({ systemRoot: f.systemRoot, backupRoot: path.join(f.systemRoot, "upgrades/backups/roles"), apply: true, report() {} });
  const saved = await store.read();
  assert.equal(saved.schemaVersion, 3);
  assert.deepEqual((await store.read()).orchestrators.codex.helperRoutingReview, { ...config.orchestrators.codex.helperRoutingReview, reason: "helper_choices_differ" });
  await assert.rejects(store.write({ codex: { senior: pickle } }, saved.revision), /unsupported shape/u);
  assert.deepEqual(await store.read(), saved);
  await writeFile(f.routingPath, JSON.stringify(old()));
  const original = await readFile(f.routingPath, "utf8");
  await assert.rejects(store.read(), { code: "vibe64_assistant_routing_upgrade_required" });
  assert.equal(await readFile(f.routingPath, "utf8"), original);
});

test("check detects a conflicting partial backup before publication has begun", async (t) => {
  const f = await fixture(t);
  const savedPath = path.join(f.backupRoot, "before/ai-connections/routing.json");
  await mkdir(path.dirname(savedPath), { recursive: true });
  await writeFile(savedPath, "a different original");
  const before = await snapshot(f.systemRoot);
  await assert.rejects(f.run(), /backup differs/u);
  assert.deepEqual(await snapshot(f.systemRoot), before);
});

test("apply backs up every changed file and preserves credentials, history, receipts and native bindings", async (t) => {
  const f = await fixture(t);
  const before = await snapshot(f.systemRoot);
  const originalConnections = JSON.parse(await readFile(f.connectionsPath, "utf8"));
  const history = await f.store.readConversationLog("archived");
  await f.run(true);
  const config = JSON.parse(await readFile(f.routingPath, "utf8"));
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(config.orchestrators.codex.router, deepseek);
  assert.ok(config.orchestrators.codex.helperRoutingReview);
  assert.equal(config.orchestrators.opencode.helperRoutingReview.previous.some((item) =>
    item.modelProviderId === "deepseek" && item.modelId === "custom-helper" && item.selectionSource === "explicit"), true);
  await assert.rejects(stat(f.helperPath), { code: "ENOENT" });
  delete originalConnections.connections.deepseek.helperModelId;
  assert.deepEqual(JSON.parse(await readFile(f.connectionsPath, "utf8")), originalConnections);
  const manifest = JSON.parse(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    if (entry.before !== null) {
      const original = path.join(f.backupRoot, "before", entry.path);
      assert.equal((await readFile(original)).toString("base64"), before[entry.path]);
      assert.equal((await stat(original)).mode & 0o777, 0o600);
    }
    if (entry.after !== null) assert.equal((await stat(path.join(f.systemRoot, entry.path))).mode & 0o777, 0o600);
  }
  assert.deepEqual(await f.store.readConversationLog("archived"), history);
  for (const sessionId of ["active", "archived"]) {
    const saved = JSON.parse(await f.store.readMetadataValue(sessionId, "assistant_routing_request"));
    assert.deepEqual(saved.assignments.router, nativeHelper);
    assert.equal(saved.messageId, "original-message");
    assert.equal(saved.threadId, "native-main");
    assert.equal(saved.admissionRequired, true);
    assert.equal(await f.store.readMetadataValue(sessionId, "agent_conversation_id"), "native-main");
    const conversation = await f.store.readSessionConversation(sessionId, "temporary-1");
    assert.equal(conversation.nativeBindings["codex/deepseek"].conversationId, "native-temporary");
    assert.deepEqual(conversation.nativeBindings["codex/deepseek"].assistantSelection, defineVibe64AssistantSelection(conversation.assistantSelection));
  }
  const renewal = JSON.parse(await f.store.readSessionRenewalStateRecord("active"));
  assert.deepEqual(renewal.successor.assistantRouting, { mode: "code", review: false, workflowEngineId: "opencode", override: defineVibe64AssistantSelection(pickle) });
  assert.equal(renewal.approved.text, "Retain the exact reviewed handover");
  assert.equal(renewal.successor.attempt, 2);
  assert.ok(manifest.files.some((entry) => entry.path.endsWith("session-renewals/active.json")));
  const published = f.messages.filter((item) => item.message.startsWith("Published routing state:"));
  assert.ok(published.at(-1).message.endsWith("codex-helper-model.json"));
  assert.equal(JSON.stringify(f.messages).includes("DO-NOT-LOG"), false);
  const completed = await snapshot(f.systemRoot);
  await f.run(true);
  assert.deepEqual(await snapshot(f.systemRoot), completed);
});

test("each interrupted publication resumes its prepared choices and original backups", async (t) => {
  const baseline = await fixture(t);
  await baseline.run(true);
  const count = JSON.parse(await readFile(path.join(baseline.backupRoot, "manifest.json"), "utf8")).files.length;
  for (let failureAt = 0; failureAt <= count; failureAt++) {
    const f = await fixture(t);
    const before = await snapshot(f.systemRoot);
    let publications = 0;
    await assert.rejects(f.run(true, (_level, message) => {
      if (failureAt === 0 && message.startsWith("Verified ") || message.startsWith("Published routing state:") && ++publications === failureAt) {
        throw new Error("simulated interruption");
      }
    }), /simulated interruption/u);
    const savedManifest = await readFile(path.join(f.backupRoot, "manifest.json"), "utf8");
    await f.run();
    await f.run(true);
    assert.equal(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"), savedManifest);
    for (const entry of JSON.parse(savedManifest).files.filter((item) => item.before !== null)) {
      assert.equal((await readFile(path.join(f.backupRoot, "before", entry.path))).toString("base64"), before[entry.path]);
    }
    assert.equal(JSON.parse(await readFile(f.routingPath, "utf8")).revision, 7);
    assert.equal(JSON.parse(await f.store.readMetadataValue("active", "assistant_routing_request")).admissionRequired, true);
    await assert.rejects(stat(f.helperPath), { code: "ENOENT" });
  }
});

test("changed originals or damaged backup copies block resumed writes", async (t) => {
  for (const target of ["current", "before", "after"]) {
    const f = await fixture(t);
    await assert.rejects(f.run(true, (_level, message) => { if (message.startsWith("Verified ")) throw new Error("stop"); }), /stop/u);
    const targetPath = target === "current" ? f.routingPath : path.join(f.backupRoot, target, "ai-connections/routing.json");
    await writeFile(targetPath, "changed");
    const before = await snapshot(f.systemRoot);
    await assert.rejects(f.run(true), /differs|missing or changed/u);
    assert.deepEqual(await snapshot(f.systemRoot), before);
  }
});

test("corrupt configuration and symlinked state fail preflight without changes", async (t) => {
  const f = await fixture(t);
  await writeFile(f.routingPath, '{"secret":"DO-NOT-LOG"');
  const before = await snapshot(f.systemRoot);
  await assert.rejects(f.run(true), (error) => error.message.includes("Model routing is invalid") && !error.message.includes("DO-NOT-LOG"));
  assert.deepEqual(await snapshot(f.systemRoot), before);
  const linked = await fixture(t, { populated: false });
  await mkdir(linked.systemRoot);
  const outside = path.join(linked.root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(linked.systemRoot, "ai-connections"));
  await assert.rejects(linked.run(true), /regular directory/u);
  assert.deepEqual(await readdir(outside), []);
});

test("a newer pending renewal blocks the read-only upgrade instead of guessing its format", async (t) => {
  const f = await fixture(t);
  const renewal = JSON.parse(await f.store.readSessionRenewalStateRecord("active"));
  await f.store.writeSessionRenewalStateRecord("active", { ...renewal, schemaVersion: 99 });
  const before = await snapshot(f.systemRoot);
  await assert.rejects(f.run(), /unsupported format/);
  assert.deepEqual(await snapshot(f.systemRoot), before);
});
