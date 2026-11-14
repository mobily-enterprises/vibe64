import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantRoutingRequestForMessage } from "../../packages/vibe64-terminals/src/server/assistantRoutingRequests.js";
import afterPlanPasses from "../../packages/vibe64-core/src/server/stateUpgrades/20261114-after-plan-passes.js";
import { __testables, upgradeAfterPlanPasses } from "../../packages/vibe64-terminals/src/server/afterPlanPassesUpgrade.js";

const { afterPlanPassesChanges } = __testables;

const opus = { schema: "vibe64.assistant-selection.v1", engineId: "claude", agentId: "claude", modelProviderId: "anthropic",
  modelId: "opus", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "recommended" };
const finishing = (deslop, uiPass, autoSave = true) => ({ review: true, deslop, uiPass, autoSave });
const ticked = (...extra) => ["review", "security-pass", "data-pass", "quality-pass", ...extra];
const none = { afterPlan: ["review", "security-pass"], afterPlanDeep: [], autoSave: false };
const main = (saved) => JSON.parse(afterPlanPassesChanges({ metadata: { assistant_routing: JSON.stringify(saved) } }).metadata.assistant_routing);
const request = (fields) => JSON.stringify({ schemaVersion: 5, messageId: "m1", status: "waiting", delivery: "accepted", mode: "auto",
  stage: "implementation", workflow: true, input: { message: "Add validation." }, finishing: { review: true, deslop: true, uiPass: false },
  unreviewed: [{ messageId: "m0", message: "Earlier." }], reviewMessage: "Review, then run Deslop.", ...fields });
const converted = (fields) => JSON.parse(afterPlanPassesChanges({ metadata: { assistant_routing_request: request(fields) } })
  .metadata.assistant_routing_request);

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

test("each main-chat mode's switches become its after-plan passes: Review and Security always, Data and Quality added, Deslop and the UI pass as switched, none deep", () => {
  for (const mode of ["auto", "senior", "junior"]) {
    assert.deepEqual(main({ mode, ...finishing(true, true) }),
      { mode, afterPlan: ticked("ui-pass", "deslop"), afterPlanDeep: [], autoSave: true }, `${mode} with both on`);
    assert.deepEqual(main({ mode, ...finishing(false, false, false) }),
      { mode, afterPlan: ticked(), afterPlanDeep: [], autoSave: false }, `${mode} with both off keeps its save choice`);
  }
  assert.deepEqual(main({ mode: "auto", review: false, deslop: true }),
    { mode: "auto", afterPlan: ticked("ui-pass", "deslop"), afterPlanDeep: [], autoSave: true },
    "Review stays ticked whatever the old switch said, and absent UI pass and save switches read as on");
  assert.deepEqual(main({ mode: "custom", ...finishing(true, false), override: opus }),
    { mode: "custom", override: opus, afterPlan: ticked("deslop"), afterPlanDeep: [], autoSave: true });
  assert.deepEqual(main({ mode: "fix", ...finishing(false, false, false) }), { mode: "fix", ...none });
});

test("temporary chats and lessons keep only the mandatory pair and no save, and a renewal's successor converts like its main chat", () => {
  const changes = afterPlanPassesChanges({
    metadata: {},
    conversations: [
      { conversationId: "senior", routingMetadata: { assistant_routing: JSON.stringify({ mode: "senior", ...finishing(false, false, false) }) } },
      { conversationId: "plain" }
    ],
    renewal: { status: "running", successor: { assistantSelection: opus, assistantRouting: { mode: "auto", ...finishing(false, true) } } }
  });
  assert.deepEqual(changes.metadata, {});
  assert.deepEqual(JSON.parse(changes.conversations[0].routingMetadata.assistant_routing), { mode: "senior", ...none });
  assert.deepEqual(changes.conversations[1], { conversationId: "plain" });
  assert.deepEqual(changes.renewal.successor.assistantRouting, { mode: "auto", afterPlan: ticked("ui-pass"), afterPlanDeep: [], autoSave: true });
  const lesson = afterPlanPassesChanges({
    metadata: { learning_session: JSON.stringify({ schemaVersion: 1 }), assistant_routing: JSON.stringify({ mode: "junior", ...finishing(false, false, false) }) },
    renewal: { status: "running", successor: { assistantSelection: opus, assistantRouting: { mode: "junior", ...finishing(false, false, false) } } }
  });
  assert.deepEqual(JSON.parse(lesson.metadata.assistant_routing), { mode: "junior", ...none });
  assert.deepEqual(lesson.renewal.successor.assistantRouting, { mode: "junior", ...none });
});

test("saved routing requests move to version 6 without their finishing records, and none starts after-plan passes", () => {
  const { finishing: _f, unreviewed: _u, reviewMessage: _r, ...kept } = JSON.parse(request({}));
  assert.deepEqual(converted({}), { ...kept, schemaVersion: 6, afterPlan: null });
  assert.deepEqual(converted({ status: "complete", stage: "review", mode: "senior" }).status, "complete", "a finished request stays finished");
});

test("a finishing turn that never reached the AI is stopped with the reason, so a Resume cannot send its old instructions", () => {
  const followup = { messageId: "f1", message: "Review, then run Deslop.\n\nOriginal request: Add validation.", messages: [] };
  const direct = converted({ mode: "senior", stage: "review", followup, delivery: "pending" });
  assert.equal(direct.followup, undefined);
  assert.equal(direct.stopped, true);
  assert.equal(direct.status, "waiting");
  assert.match(direct.error, /only after a completed plan/u);
  assert.equal(converted({ mode: "junior", stage: "review", delivery: "accepted" }).stopped, true, "a direct chat's finishing turn never resumes");
  const pendingReview = converted({ stage: "review", followup, delivery: "pending" });
  assert.equal(pendingReview.followup, undefined, "Auto's prepared review that was never sent");
  assert.equal(pendingReview.stopped, true);
  assert.deepEqual(converted({ stage: "review", followup, delivery: "accepted", status: "working" }).followup, followup,
    "Auto's review already with the AI keeps its turn");
  assert.deepEqual(converted({ mode: "senior", stage: "review", followup, delivery: "uncertain" }).followup, followup,
    "an uncertain delivery keeps its follow-up for the receipt check");
  assert.deepEqual(converted({ stage: "implementation", followup, delivery: "pending" }).followup, followup, "implementation continues");
});

test("current values are left alone, so a retry changes nothing, and unreadable, unknown or older values stop the upgrade", () => {
  const current = JSON.stringify({ mode: "senior", afterPlan: ["review", "security-pass"], afterPlanDeep: [], autoSave: false });
  const currentRequest = JSON.stringify({ ...JSON.parse(request({})), schemaVersion: 6 });
  const metadata = { assistant_routing: current, assistant_routing_request: currentRequest };
  assert.deepEqual(afterPlanPassesChanges({ metadata }).metadata, metadata);
  const renewal = { successor: { assistantRouting: JSON.parse(current) } };
  assert.equal(afterPlanPassesChanges({ renewal }).renewal, undefined);
  assert.throws(() => afterPlanPassesChanges({ metadata: { assistant_routing: "{" } }), /unreadable/u);
  assert.throws(() => afterPlanPassesChanges({ metadata: { assistant_routing: JSON.stringify({ mode: "plan" }) } }), /unsupported/u);
  assert.throws(() => afterPlanPassesChanges({ metadata: { assistant_routing: JSON.stringify({ mode: "auto", review: true }) } }), /20261107/u);
  assert.throws(() => afterPlanPassesChanges({ metadata: { assistant_routing_request: request({ schemaVersion: 4 }) } }), /unsupported/u);
  assert.throws(() => afterPlanPassesChanges({ metadata: { assistant_routing_request: "{" } }), /unreadable/u);
});

test("every converted value reads back at runtime: the chat's choices as saved, and its request without an upgrade refusal", () => {
  for (const saved of [{ mode: "auto", ...finishing(false, true) }, { mode: "senior", ...finishing(true, false) },
    { mode: "junior", ...finishing(true, true) }, { mode: "fix", ...finishing(false, false, false) }]) {
    const raw = afterPlanPassesChanges({ metadata: { assistant_routing: JSON.stringify(saved) } }).metadata.assistant_routing;
    assert.deepEqual(assistantRoutingFromMetadata({ assistant_routing: raw }), JSON.parse(raw), saved.mode);
  }
  assert.throws(() => assistantRoutingFromMetadata({ assistant_routing: JSON.stringify({ mode: "auto", ...finishing(true, true) }) }),
    (error) => error.code === "vibe64_assistant_routing_upgrade_required", "a chat that missed the upgrade is refused, never read as the defaults");
  const raw = afterPlanPassesChanges({ metadata: { assistant_routing_request: request({}) } }).metadata.assistant_routing_request;
  assert.equal(assistantRoutingRequestForMessage({ assistant_routing_request: raw }, (id) => id === "m1").messageId, "m1");
  assert.throws(() => assistantRoutingRequestForMessage({ assistant_routing_request: request({}) }, () => true),
    (error) => error.code === "vibe64_assistant_workflow_upgrade_required");
});

test("the numbered upgrade refuses without its owner, checks without writing, converts with a backup and changes nothing on retry", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-after-plan-passes-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: systemRoot, projectRuntimeRoot: path.join(systemRoot, "projects/project-one") });
  await store.createSession({ sessionId: "auto", runtimeKind: "genesis" });
  await store.writeMetadataValue("auto", "assistant_routing", JSON.stringify({ mode: "auto", ...finishing(false, true) }));
  await store.writeMetadataValue("auto", "assistant_routing_request", request({ status: "complete" }));
  await store.writeMetadataValue("auto", "unrelated", "keep");
  await store.writeSessionConversation("auto", "helper", { title: "Helper",
    routingMetadata: { assistant_routing: JSON.stringify({ mode: "junior", ...finishing(false, false, false) }) } });
  await store.createSession({ sessionId: "senior", runtimeKind: "genesis" });
  await store.writeMetadataValue("senior", "assistant_routing", JSON.stringify({ mode: "senior", ...finishing(true, false) }));
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261114-after-plan-passes");
  const context = { systemRoot, backupRoot, report: () => {}, upgradeAfterPlanPasses };
  assert.equal(afterPlanPasses.id, "20261114-after-plan-passes");
  await assert.rejects(afterPlanPasses.run({ systemRoot, backupRoot, report: () => {} }), /candidate upgrade-state command/u);
  const before = await snapshot(systemRoot);
  await afterPlanPasses.run({ ...context, apply: false });
  assert.deepEqual(await snapshot(systemRoot), before, "the check writes nothing");
  await afterPlanPasses.run({ ...context, apply: true });
  assert.deepEqual(JSON.parse(await store.readMetadataValue("auto", "assistant_routing")),
    { mode: "auto", afterPlan: ticked("ui-pass"), afterPlanDeep: [], autoSave: true });
  assert.deepEqual(JSON.parse(await store.readMetadataValue("senior", "assistant_routing")),
    { mode: "senior", afterPlan: ticked("deslop"), afterPlanDeep: [], autoSave: true });
  const savedRequest = JSON.parse(await store.readMetadataValue("auto", "assistant_routing_request"));
  assert.equal(savedRequest.schemaVersion, 6);
  assert.equal(savedRequest.finishing, undefined);
  assert.equal(await store.readMetadataValue("auto", "unrelated"), "keep");
  assert.deepEqual(JSON.parse((await store.readSessionConversation("auto", "helper")).routingMetadata.assistant_routing), { mode: "junior", ...none });
  const backups = await snapshot(backupRoot);
  assert.ok(Object.keys(backups).some((name) => name.includes("before") && name.endsWith("assistant_routing")), Object.keys(backups).join(", "));
  const after = await snapshot(systemRoot);
  await afterPlanPasses.run({ ...context, apply: true });
  assert.deepEqual(await snapshot(systemRoot), after, "a retry changes nothing");
});
