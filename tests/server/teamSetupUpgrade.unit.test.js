import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import ownerTeamAiSetups from "../../packages/vibe64-core/src/server/stateUpgrades/20261023-owner-team-ai-setups.js";
import { upgradeTeamSetupRouting } from "../../packages/vibe64-accounts/src/server/teamSetupRoutingUpgrade.js";
import { teamSetupSessionChanges, upgradeTeamSetupSessions } from "../../packages/vibe64-terminals/src/server/teamSetupSessionUpgrade.js";

const S = (engineId, modelProviderId, modelId, variantId = "high") => ({ schema: "vibe64.assistant-selection.v1", engineId, agentId: engineId,
  modelProviderId, modelId, variantId, catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "recommended" });
const opus = S("claude", "anthropic", "opus");
const opusMedium = S("claude", "anthropic", "opus", "medium");
const haiku = S("claude", "anthropic", "haiku", "low");
const flash = S("claude", "deepseek", "deepseek-flash");
const ownerFollows = { colleague: { follows: "senior" }, fix: { follows: "junior" }, explain: { follows: "quickHelper" } };

async function snapshot(root, prefix = "") {
  const result = {};
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return result; throw error; }
  for (const entry of entries) {
    const name = path.join(prefix, entry.name), filename = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(filename, name));
    else result[name] = await readFile(filename, "utf8");
  }
  return result;
}

async function routingFixture(t, saved) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-team-setup-routing-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const file = path.join(systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(file), { recursive: true });
  if (saved) await writeFile(file, JSON.stringify(saved));
  const reports = [];
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261023-owner-team-ai-setups/routing");
  return { systemRoot, file, reports, backupRoot,
    read: async () => JSON.parse(await readFile(file, "utf8")),
    run: (apply) => upgradeTeamSetupRouting({ systemRoot, backupRoot, apply, report: (level, message) => reports.push({ level, message }) }) };
}

test("A: the gold standard keeps the owner's routes exactly and a workspace backup becomes the team setup", async (t) => {
  const v4 = { schemaVersion: 4, revision: 7, orchestrators: { claude: { senior: opus, junior: opusMedium, router: haiku, helper: haiku, sharedBackup: flash } } };
  const f = await routingFixture(t, v4);
  const before = await snapshot(f.systemRoot);
  await f.run(false);
  assert.deepEqual(await snapshot(f.systemRoot), before, "the check writes nothing");
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await f.run(true);
  const v5 = await f.read();
  assert.deepEqual(v5, { schemaVersion: 5, revision: 8,
    owner: { senior: opus, junior: opusMedium, router: haiku, quickHelper: haiku, ...ownerFollows },
    nonOwner: { colleague: flash, quickHelper: flash, fix: { follows: "colleague" }, explain: { follows: "quickHelper" } } });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.backupRoot, "before/ai-connections/routing.json"), "utf8")), v4);
  const upgraded = await snapshot(f.systemRoot);
  await f.run(true);
  assert.deepEqual(await snapshot(f.systemRoot), upgraded, "a retry after success changes nothing");
});

test("B: a personal backup leaves the team setup empty and warns that team members must wait", async (t) => {
  const astra = S("codex", "openai", "gpt-6-astra"), sol = S("codex", "openai", "gpt-6-sol");
  const f = await routingFixture(t, { schemaVersion: 4, revision: 2, orchestrators: {
    codex: { senior: astra, junior: sol, sharedBackup: S("codex", "zai-coding-plan", "glm-5.3", "max") } } });
  await f.run(true);
  assert.deepEqual(await f.read(), { schemaVersion: 5, revision: 3, owner: { senior: astra, junior: sol, ...ownerFollows }, nonOwner: {} });
  assert.ok(f.reports.some(({ level, message }) => level === "warning" && message === "Team members will be asked to wait until the owner sets up team AI."));
});

test("C: with two tools the Claude Code block wins and the other is left in the backup", async (t) => {
  const codex = { senior: S("codex", "openai", "gpt-6-astra"), junior: S("codex", "openai", "gpt-6-sol"), helper: S("codex", "openai", "gpt-6-luna", "low") };
  const f = await routingFixture(t, { schemaVersion: 4, revision: 1, orchestrators: { codex, claude: { senior: opus, junior: opusMedium, router: haiku } } });
  await f.run(true);
  const v5 = await f.read();
  assert.deepEqual(v5.owner, { senior: opus, junior: opusMedium, router: haiku, ...ownerFollows });
  assert.equal(Object.hasOwn(v5.owner, "quickHelper"), false, "an absent Helper stays absent");
  assert.ok(f.reports.some(({ message }) => message === "Codex routing (Senior, Junior, Helper) is left in the backup, not carried over."));
});

test("a Codex OpenAI backup is personal offline, a pending Helper review leaves Quick helper off and null stays off", async (t) => {
  const astra = S("codex", "openai", "gpt-6-astra");
  const f = await routingFixture(t, { schemaVersion: 4, revision: 4, orchestrators: { codex: { senior: astra, junior: astra, router: null,
    helper: S("codex", "openai", "gpt-6-luna"), sharedBackup: S("codex", "openai", "gpt-6-luna"),
    helperRoutingReview: { reason: "helper_choices_differ", previous: [{ engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-luna", selectionSource: "explicit" }],
      proposed: S("codex", "openai", "gpt-6-luna", "low") } } } });
  await f.run(true);
  const v5 = await f.read();
  assert.equal(v5.owner.router, null);
  assert.equal(v5.owner.quickHelper, null, "a pending Helper review keeps helpers off; its proposal is not applied");
  assert.deepEqual(v5.nonOwner, {});
  assert.ok(f.reports.some(({ message }) => /Quick helper is off until the owner chooses/u.test(message)));
});

test("routing without Senior or Junior, a missing file and an unreadable file", async (t) => {
  const f = await routingFixture(t, { schemaVersion: 4, revision: 0, orchestrators: { opencode: { helper: flash } } });
  await f.run(true);
  assert.deepEqual((await f.read()).owner, ownerFollows);
  const empty = await routingFixture(t);
  await empty.run(true);
  await assert.rejects(stat(empty.file), { code: "ENOENT" }, "a new installation has nothing to upgrade");
  const broken = await routingFixture(t);
  await writeFile(broken.file, "{");
  await assert.rejects(broken.run(false), /unreadable/);
  await writeFile(broken.file, JSON.stringify({ schemaVersion: 4, revision: 0, orchestrators: { codex: { sharedBackup: { modelId: "x" } } } }));
  await assert.rejects(broken.run(true), /schema-4 format/);
});

test("session preferences, temporary repair chats, saved requests, goals and renewals move to the setups", () => {
  const request = { schemaVersion: 5, status: "waiting", delivery: "pending", messageId: "m1", workflowEngineId: "claude", stage: "implementation",
    assignments: { senior: opus, helper: haiku }, decision: { role: "helper" },
    configuration: { revision: 6, orchestrators: { claude: { senior: opus, junior: opusMedium, helper: haiku, sharedBackup: flash }, codex: { senior: S("codex", "openai", "gpt-6-astra") } } } };
  const goal = { mode: "senior", workflowEngineId: "claude", selection: opus, configuration: { revision: 6, orchestrators: { claude: { senior: opus } } } };
  const changes = teamSetupSessionChanges({
    metadata: { assistant_routing: JSON.stringify({ mode: "auto", review: true, workflowEngineId: "claude" }),
      assistant_routing_request: JSON.stringify(request), assistant_routing_goal: JSON.stringify(goal) },
    conversations: [
      { conversationId: "repair", recoveryOperation: "update", routingMetadata: {
        assistant_routing: JSON.stringify({ mode: "senior", review: false, workflowEngineId: "claude", override: opus }) } },
      { conversationId: "custom-repair", recoveryOperation: "update", routingMetadata: {
        assistant_routing: JSON.stringify({ mode: "custom", review: false, workflowEngineId: "claude", override: opus }) } },
      { conversationId: "custom", routingMetadata: { assistant_routing: JSON.stringify({ mode: "custom", review: false, workflowEngineId: "codex", override: opus }) } },
      { conversationId: "plain" }
    ],
    renewal: { status: "running", successor: { assistantSelection: opus, assistantRouting: { mode: "senior", review: true, workflowEngineId: "claude" } } }
  });
  assert.deepEqual(JSON.parse(changes.metadata.assistant_routing), { mode: "auto", review: true });
  const upgraded = JSON.parse(changes.metadata.assistant_routing_request);
  assert.deepEqual(upgraded.configuration, { revision: 6, owner: { senior: opus, junior: opusMedium, quickHelper: haiku, ...ownerFollows } });
  assert.deepEqual(upgraded.assignments, { senior: opus, quickHelper: haiku });
  assert.deepEqual(upgraded.decision, { role: "quickHelper" });
  assert.deepEqual([upgraded.messageId, upgraded.delivery, upgraded.stage, upgraded.workflowEngineId], ["m1", "pending", "implementation", "claude"],
    "delivery, stage and identities are untouched");
  assert.deepEqual(JSON.parse(changes.metadata.assistant_routing_goal).configuration, { revision: 6, owner: { senior: opus, ...ownerFollows } });
  const [repair, customRepair, custom, plain] = changes.conversations;
  assert.deepEqual(JSON.parse(repair.routingMetadata.assistant_routing), { mode: "fix", review: false });
  assert.deepEqual(JSON.parse(customRepair.routingMetadata.assistant_routing), { mode: "custom", review: false, override: opus },
    "a repair chat on a Custom model keeps it, as at runtime");
  assert.deepEqual(JSON.parse(custom.routingMetadata.assistant_routing), { mode: "custom", review: false, override: opus });
  assert.deepEqual(plain, { conversationId: "plain" });
  assert.deepEqual(changes.renewal.successor.assistantRouting, { mode: "senior", review: true });
  const again = teamSetupSessionChanges({ metadata: { ...changes.metadata }, conversations: changes.conversations, renewal: changes.renewal });
  assert.deepEqual(again.metadata, changes.metadata, "v5 values are unchanged");
  assert.deepEqual(again.conversations, changes.conversations);
  assert.equal(again.renewal, undefined);
});

test("the numbered upgrade converts sessions then routing, each with its own backup, through the stopped session store", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-team-setup-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: systemRoot, projectRuntimeRoot: path.join(systemRoot, "projects/project-one") });
  await store.createSession({ sessionId: "active", runtimeKind: "genesis" });
  const preferences = JSON.stringify({ mode: "senior", review: true, workflowEngineId: "claude" });
  await store.writeMetadataValue("active", "assistant_routing", preferences);
  await store.writeMetadataValue("active", "unrelated", "keep");
  await store.writeSessionConversation("active", "repair", { title: "Repair", recoveryOperation: "update",
    routingMetadata: { assistant_routing: JSON.stringify({ mode: "senior", review: false, workflowEngineId: "claude" }) } });
  const file = path.join(systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ schemaVersion: 4, revision: 1, orchestrators: { claude: { senior: opus, junior: opusMedium, sharedBackup: flash } } }));
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261023-owner-team-ai-setups/run");
  const context = { systemRoot, backupRoot, report: () => {}, upgradeTeamSetupSessions, upgradeTeamSetupRouting };
  assert.equal(ownerTeamAiSetups.id, "20261023-owner-team-ai-setups");
  await assert.rejects(ownerTeamAiSetups.run({ systemRoot, backupRoot, report: () => {} }), /candidate upgrade-state command/);
  const before = await snapshot(systemRoot);
  await ownerTeamAiSetups.run({ ...context, apply: false });
  assert.deepEqual(await snapshot(systemRoot), before, "the check writes nothing");
  await ownerTeamAiSetups.run({ ...context, apply: true });
  assert.deepEqual(JSON.parse(await store.readMetadataValue("active", "assistant_routing")), { mode: "senior", review: true });
  assert.equal(await store.readMetadataValue("active", "unrelated"), "keep");
  assert.deepEqual(JSON.parse((await store.readSessionConversation("active", "repair")).routingMetadata.assistant_routing), { mode: "fix", review: false });
  assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 5);
  const backups = await snapshot(backupRoot);
  assert.ok(Object.keys(backups).some((name) => name.startsWith("sessions/before/") && name.endsWith("assistant_routing")), Object.keys(backups).join(", "));
  assert.ok(Object.keys(backups).includes("routing/before/ai-connections/routing.json"));
  const after = await snapshot(systemRoot);
  await ownerTeamAiSetups.run({ ...context, apply: true });
  assert.deepEqual(await snapshot(systemRoot), after, "a retry changes nothing");
});
