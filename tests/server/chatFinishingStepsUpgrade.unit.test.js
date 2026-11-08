import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import chatFinishingSteps from "../../packages/vibe64-core/src/server/stateUpgrades/20261107-chat-finishing-steps.js";
import { __testables, upgradeChatFinishingSteps } from "../../packages/vibe64-terminals/src/server/chatFinishingStepsUpgrade.js";

const { chatFinishingStepsChanges } = __testables;

const opus = { schema: "vibe64.assistant-selection.v1", engineId: "claude", agentId: "claude", modelProviderId: "anthropic",
  modelId: "opus", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "recommended" };
const defaults = { review: true, deslop: true, uiPass: false, autoSave: true };
const none = { review: false, deslop: false, uiPass: false, autoSave: false };
const main = (saved) => JSON.parse(chatFinishingStepsChanges({ metadata: { assistant_routing: JSON.stringify(saved) } }).metadata.assistant_routing);

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

test("an Auto chat keeps its mandatory review and moves its Deslop, UI pass and save choices", () => {
  assert.deepEqual(main({ mode: "auto", review: true, autoSave: true }), { mode: "auto", review: true, deslop: true, uiPass: false, autoSave: true });
  assert.deepEqual(main({ mode: "auto", review: false, autoSave: false, uiPass: true }),
    { mode: "auto", review: true, deslop: false, uiPass: true, autoSave: false }, "the old review was Deslop; Auto's review stays on");
  assert.deepEqual(main({ mode: "auto" }), { mode: "auto", ...defaults }, "absent choices read as they did: Deslop and save on, UI pass off");
});

test("Senior and Junior chats keep the choices they saved for Auto, Custom chats start with the defaults, and Fix it with AI runs none", () => {
  for (const mode of ["senior", "junior"]) {
    assert.deepEqual(main({ mode, review: false, autoSave: false, uiPass: true }),
      { mode, review: true, deslop: false, uiPass: true, autoSave: false }, mode);
    assert.deepEqual(main({ mode }), { mode, ...defaults }, `${mode} without saved choices`);
  }
  assert.deepEqual(main({ mode: "custom", review: false, override: opus }), { mode: "custom", override: opus, ...defaults },
    "Custom saved no choice before; it now has the defaults");
  assert.deepEqual(main({ mode: "fix", review: false, autoSave: false }), { mode: "fix", ...none });
});

test("temporary chats run no finishing step, and a renewal's successor converts like main chat", () => {
  const changes = chatFinishingStepsChanges({
    metadata: {},
    conversations: [
      { conversationId: "senior", routingMetadata: { assistant_routing: JSON.stringify({ mode: "senior", review: false }) } },
      { conversationId: "custom", routingMetadata: { assistant_routing: JSON.stringify({ mode: "custom", review: false, override: opus }) } },
      { conversationId: "plain" }
    ],
    renewal: { status: "running", successor: { assistantSelection: opus, assistantRouting: { mode: "auto", review: false, autoSave: true } } }
  });
  assert.deepEqual(changes.metadata, {});
  const [senior, custom, plain] = changes.conversations;
  assert.deepEqual(JSON.parse(senior.routingMetadata.assistant_routing), { mode: "senior", ...none });
  assert.deepEqual(JSON.parse(custom.routingMetadata.assistant_routing), { mode: "custom", override: opus, ...none });
  assert.deepEqual(plain, { conversationId: "plain" });
  assert.deepEqual(changes.renewal.successor.assistantRouting, { mode: "auto", review: true, deslop: false, uiPass: false, autoSave: true });
});

test("a lesson's main chat and its pending successor run no finishing step", () => {
  const changes = chatFinishingStepsChanges({
    metadata: { learning_session: JSON.stringify({ schemaVersion: 1 }), assistant_routing: JSON.stringify({ mode: "junior", review: true }) },
    renewal: { status: "running", successor: { assistantSelection: opus, assistantRouting: { mode: "junior" } } }
  });
  assert.deepEqual(JSON.parse(changes.metadata.assistant_routing), { mode: "junior", ...none });
  assert.deepEqual(changes.renewal.successor.assistantRouting, { mode: "junior", ...none });
});

test("current values are left alone, so a retry changes nothing, and unreadable or unknown modes stop the upgrade", () => {
  const current = JSON.stringify({ mode: "senior", review: false, deslop: true, uiPass: true, autoSave: false });
  assert.equal(chatFinishingStepsChanges({ metadata: { assistant_routing: current } }).metadata.assistant_routing, current);
  const renewal = { successor: { assistantRouting: { mode: "junior", ...defaults } } };
  assert.equal(chatFinishingStepsChanges({ renewal }).renewal, undefined);
  assert.throws(() => chatFinishingStepsChanges({ metadata: { assistant_routing: "{" } }), /unreadable/u);
  assert.throws(() => chatFinishingStepsChanges({ metadata: { assistant_routing: JSON.stringify({ mode: "plan" }) } }), /unsupported/u);
});

test("every converted value reads back as the same choices at runtime", () => {
  for (const saved of [{ mode: "auto", review: false, uiPass: true }, { mode: "senior" }, { mode: "junior", uiPass: true }, { mode: "fix" }]) {
    const raw = JSON.stringify(main(saved));
    const read = assistantRoutingFromMetadata({ assistant_routing: raw });
    assert.deepEqual(JSON.parse(raw), read, saved.mode);
  }
});

test("the numbered upgrade converts main and temporary chats with a backup through the stopped session store", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-chat-finishing-steps-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: systemRoot, projectRuntimeRoot: path.join(systemRoot, "projects/project-one") });
  await store.createSession({ sessionId: "auto", runtimeKind: "genesis" });
  await store.writeMetadataValue("auto", "assistant_routing", JSON.stringify({ mode: "auto", review: false, autoSave: true }));
  await store.writeMetadataValue("auto", "unrelated", "keep");
  await store.writeSessionConversation("auto", "helper", { title: "Helper",
    routingMetadata: { assistant_routing: JSON.stringify({ mode: "junior", review: false }) } });
  await store.createSession({ sessionId: "senior", runtimeKind: "genesis" });
  await store.writeMetadataValue("senior", "assistant_routing", JSON.stringify({ mode: "senior", review: false }));
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261107-chat-finishing-steps");
  const context = { systemRoot, backupRoot, report: () => {}, upgradeChatFinishingSteps };
  assert.equal(chatFinishingSteps.id, "20261107-chat-finishing-steps");
  await assert.rejects(chatFinishingSteps.run({ systemRoot, backupRoot, report: () => {} }), /candidate upgrade-state command/u);
  const before = await snapshot(systemRoot);
  await chatFinishingSteps.run({ ...context, apply: false });
  assert.deepEqual(await snapshot(systemRoot), before, "the check writes nothing");
  await chatFinishingSteps.run({ ...context, apply: true });
  assert.deepEqual(JSON.parse(await store.readMetadataValue("auto", "assistant_routing")),
    { mode: "auto", review: true, deslop: false, uiPass: false, autoSave: true });
  assert.deepEqual(JSON.parse(await store.readMetadataValue("senior", "assistant_routing")),
    { mode: "senior", review: true, deslop: false, uiPass: false, autoSave: true });
  assert.equal(await store.readMetadataValue("auto", "unrelated"), "keep");
  assert.deepEqual(JSON.parse((await store.readSessionConversation("auto", "helper")).routingMetadata.assistant_routing), { mode: "junior", ...none });
  const backups = await snapshot(backupRoot);
  assert.ok(Object.keys(backups).some((name) => name.includes("before") && name.endsWith("assistant_routing")), Object.keys(backups).join(", "));
  const after = await snapshot(systemRoot);
  await chatFinishingSteps.run({ ...context, apply: true });
  assert.deepEqual(await snapshot(systemRoot), after, "a retry changes nothing");
});
