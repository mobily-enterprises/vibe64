import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeAssistantWorkflow } from "../../packages/vibe64-terminals/src/server/assistantPlanProgressUpgrade.js";
import { assistantWorkflowUpgradeChanges } from "@local/vibe64-runtime/shared/assistantRouting";

const legacy = { schemaVersion: 4, mode: "auto", resolvedMode: "junior", reason: "plan_implementation", status: "review_uncertain",
  messageId: "original", input: { message: "Execute the plan" }, assignments: { senior: {}, junior: {} },
  submittedBy: { username: "original-member" }, threadId: "native-thread", turnId: "native-turn", attemptedMessageId: "review-message",
  reviewMessageId: "review-message", reviewMessage: "Review the authorised implementation" };
async function snapshot(root, prefix = "") {
  const result = {};
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return result; throw e; }
  for (const entry of entries) {
    const name = path.join(prefix, entry.name), filename = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(filename, name));
    else result[name] = (await readFile(filename)).toString("base64");
  }
  return result;
}
async function fixture(t) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-workflow-upgrade-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const projectRoot = path.join(systemRoot, "projects/project-one");
  const store = createVibe64SessionStore({ projectContextRoot: systemRoot, projectRuntimeRoot: projectRoot });
  for (const id of ["active", "archived"]) {
    await store.createSession({ sessionId: id, runtimeKind: "genesis" });
    await store.writeMetadataValue(id, "assistant_routing_request", JSON.stringify(legacy));
    await store.writeMetadataValue(id, "unrelated", "keep");
    await store.writeConversationUserMessage(id, { messageId: "authored", text: "Original history" });
    await store.writeSessionConversation(id, "temporary-1", { title: "Preserved title", providerConversationId: "native-temporary",
      nativeBindings: { codex: { threadId: "captured" } }, routingMetadata: { unrelated: "preserved", assistant_routing_request: JSON.stringify(legacy) } });
  }
  await store.writeStatus("archived", VIBE64_SESSION_STATUS.ARCHIVED);
  await store.publishSessionArchive("archived");
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261010-assistant-workflow");
  return { systemRoot, projectRoot, store, backupRoot,
    run: (apply = false, report = () => {}) => upgradeAssistantWorkflow({ systemRoot, backupRoot, apply, report }) };
}

test("workflow preflight is read-only across active and archived Main/temporary records", async t => {
  const f = await fixture(t), before = await snapshot(f.systemRoot);
  await f.run(); assert.deepEqual(await snapshot(f.systemRoot), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

test("workflow apply backs up exact state and preserves archived history, temporary data and receipt identity on retry", async t => {
  const f = await fixture(t), history = await f.store.readConversationTail("active");
  await f.run(true);
  for (const id of ["active", "archived"]) {
    const state = JSON.parse(await f.store.readMetadataValue(id, "assistant_routing_request"));
    assert.equal(state.status, "waiting"); assert.equal(state.stage, "review"); assert.equal(state.delivery, "uncertain");
    assert.equal(state.attemptedMessageId, "review-message"); assert.equal(state.turnId, "native-turn");
    assert.deepEqual(state.submittedBy, legacy.submittedBy); assert.equal(await f.store.readMetadataValue(id, "unrelated"), "keep");
    const temporary = await f.store.readSessionConversation(id, "temporary-1");
    assert.equal(temporary.title, "Preserved title"); assert.equal(temporary.providerConversationId, "native-temporary");
    assert.deepEqual(temporary.nativeBindings, { codex: { threadId: "captured" } });
    assert.equal(temporary.routingMetadata.unrelated, "preserved");
    assert.equal(JSON.parse(temporary.routingMetadata.assistant_routing_request).followup.messageId, "review-message");
  }
  assert.deepEqual(await f.store.readConversationTail("active"), history);
  const manifest = JSON.parse(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"));
  assert.ok(manifest.files.length >= 3);
  for (const item of manifest.files) {
    assert.ok((await stat(path.join(f.backupRoot, "before", item.path))).isFile());
    assert.ok((await stat(path.join(f.backupRoot, "after", item.path))).isFile());
  }
  const after = await snapshot(f.systemRoot); await f.run(true); assert.deepEqual(await snapshot(f.systemRoot), after);
});

test("workflow publication refuses unreadable state before writing backups or changing another session", async t => {
  const f = await fixture(t); await f.store.writeMetadataValue("active", "assistant_routing_request", "{");
  const before = await snapshot(f.systemRoot);
  await assert.rejects(f.run(true), /unreadable/); assert.deepEqual(await snapshot(f.systemRoot), before);
});

test("workflow retry refuses changed product or verified backup bytes", async t => {
  for (const target of ["product", "before", "after"]) {
    const f = await fixture(t); await f.run(true);
    const manifest = JSON.parse(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"));
    const entry = manifest.files.find(item => !item.path.endsWith(".tar")) || manifest.files[0];
    const filename = path.join(target === "product" ? f.systemRoot : path.join(f.backupRoot, target), entry.path);
    await writeFile(filename, "changed bytes");
    const before = await snapshot(f.systemRoot); await assert.rejects(f.run(true), /changed|differs|verified|match/iu);
    assert.deepEqual(await snapshot(f.systemRoot), before);
  }
});

for (const [oldStatus, expected] of [["review_pending", "pending"], ["review_sending", "sending"], ["review_uncertain", "uncertain"], ["reviewing", "accepted"]]) {
  test(`offline conversion retains ${oldStatus} stage and separate delivery`, () => {
    const result = assistantWorkflowUpgradeChanges({ metadata: { assistant_routing_request: JSON.stringify({ ...legacy, status: oldStatus }) } });
    const state = JSON.parse(result.metadata.assistant_routing_request);
    assert.equal(state.status, "waiting"); assert.equal(state.stage, "review"); assert.equal(state.delivery, expected);
    assert.equal(state.followup.messageId, legacy.reviewMessageId);
  });
}

for (const attempted of [false, true]) test(`cancelled legacy delivery with attempted ${attempted} retains truthful receipt uncertainty`, () => {
  const old = { ...legacy, status: "cancelled", reviewStatus: "cancelled", ...(attempted ? {} : { attemptedMessageId: undefined }) };
  const result = JSON.parse(assistantWorkflowUpgradeChanges({ metadata: { assistant_routing_request: JSON.stringify(old) } }).metadata.assistant_routing_request);
  assert.equal(result.status, "waiting"); assert.equal(result.stage, "review"); assert.equal(result.stopped, true);
  assert.equal(result.delivery, attempted ? "uncertain" : "failed"); assert.equal(result.followup.messageId, "review-message");
});
