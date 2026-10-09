import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, upgradeColleagueNativeContinuity } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "colleague-runtime-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const backupRoot = path.join(root, "backup");
  const reports = [];
  return { root, systemRoot, backupRoot, reports,
    async write(key, value) {
      const file = path.join(systemRoot, "colleague", key, "conversation.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
      return file;
    },
    run: (apply, report) => upgradeColleagueConversationRuntime({ systemRoot, backupRoot, apply,
      report: (level, message) => { reports.push({ level, message }); report?.(level, message); } })
  };
}

const original = {
  schemaVersion: 2, scopeId: "colleague_retained", assistantSelection: { engineId: "codex", modelId: "selected" },
  status: "interrupted", error: "Existing error", watches: [{ watchId: "watch" }], observations: [{ id: "observation" }],
  assignments: [{ assignmentId: "assignment" }], retiredConversation: { conversationId: "older-native" },
  conversationLog: [{ turnId: "000001", metadata: { runtime: { engine: "codex", segmentId: "saved-segment", status: "complete" } },
    messages: [{ role: "user", text: "Retained request", messageId: "accepted" }, { role: "assistant", text: "Retained answer" }] }],
  conversationMetadata: { application: "retained", runtime: {
    version: 2, segmentId: "saved-segment", engine: "codex", configuration: { systemPrompt: "Retained instructions" },
    predecessors: [], seen: { "000001/user/": "original-version" },
    binding: { threadId: "exact-native-thread", configRoot: "/private/codex", workdir: "/private/workspace", executionId: "exact-execution" },
    request: { messageId: "uncertain", text: "Authored pending input", origin: "user", attachments: [],
      at: "2026-10-02T00:00:00.000Z", seen: { "000001/user/": "original-version" } }
  } }
};

test("runtime preflight is read-only and accepts the earlier pending outer-schema upgrade", async t => {
  const f = await fixture(t);
  await f.run(false);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  await f.run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  assert.ok(f.reports.some(({ level, message }) => level === "warning" && /not reconstructed/.test(message)));
  const { conversationMetadata, retiredConversation, ...legacy } = original;
  await f.write("legacy", { ...legacy, schemaVersion: 1 });
  await f.run(false);
  await assert.rejects(f.run(true), /earlier Colleague conversation upgrade/);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await upgradeColleagueConversations({ systemRoot: f.systemRoot, backupRoot: path.join(f.root, "old-backup"),
    apply: true, report() {} });
  await f.run(true);
  const old = JSON.parse(await readFile(path.join(f.systemRoot, "colleague", "legacy", "conversation.json"), "utf8"));
  assert.equal(old.schemaVersion, 2);
  assert.equal(old.conversationMetadata, undefined, "Earlier transcript migration still invents no native binding");
});

test("runtime upgrade preserves product identity and native history with exact backups and safe retry", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  const nativeHistory = path.join(path.dirname(file), "native-history.db");
  await writeFile(nativeHistory, "native bytes including event history");
  await f.run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual({ ...next, conversationMetadata: original.conversationMetadata }, original);
  assert.equal(next.conversationMetadata.runtime.version, 3);
  assert.equal(next.conversationMetadata.runtime.lastEngine, "codex");
  assert.deepEqual(next.conversationMetadata.runtime.binding, original.conversationMetadata.runtime.binding);
  assert.deepEqual(next.conversationMetadata.runtime.request, { ...original.conversationMetadata.runtime.request,
    inspectionOnly: true, threadId: "exact-native-thread" });
  assert.equal(next.conversationMetadata.runtime.request.message, undefined);
  assert.equal(await readFile(nativeHistory, "utf8"), "native bytes including event history");
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  assert.equal(await readFile(backup, "utf8"), before);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const written = await readFile(file, "utf8");
  await f.run(true);
  assert.equal(await readFile(file, "utf8"), written);
  assert.equal(await readFile(backup, "utf8"), before);
});

test("an unsupported native database blocks every metadata write and backup", async t => {
  const f = await fixture(t);
  const file = await f.write("first", original);
  const before = await readFile(file, "utf8");
  const other = structuredClone(original);
  other.conversationMetadata.runtime.engine = "opencode";
  other.conversationMetadata.runtime.binding = { sessionId: "saved-session", directory: "/old/private/native" };
  const unsupported = await f.write("second", other);
  const native = path.join(path.dirname(unsupported), "history.db");
  await writeFile(native, "private native event history");
  await assert.rejects(f.run(true), /complete offline native-history upgrade/);
  assert.equal(await readFile(file, "utf8"), before);
  assert.deepEqual(JSON.parse(await readFile(unsupported, "utf8")), other);
  assert.equal(await readFile(native, "utf8"), "private native event history");
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

test("conflicting backups and concurrent changes cannot overwrite the saved conversation", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "conflicting original");
  await assert.rejects(f.run(true), /differs from its runtime upgrade backup/);
  assert.equal(await readFile(file, "utf8"), before);
  await writeFile(backup, before);
  const changed = JSON.stringify({ ...original, error: "A writer changed this history" });
  await assert.rejects(f.run(true, level => { if (level === "info") writeFileSync(file, changed); }), /changed during runtime upgrade/);
  assert.equal(await readFile(file, "utf8"), changed);
  assert.equal(await readFile(backup, "utf8"), before);
});

test("retry after one record was published retains its original backup and upgrades the remaining record", async t => {
  const f = await fixture(t);
  const converted = upgradeConversationRuntimeState({ metadata: original.conversationMetadata, conversationLog: original.conversationLog });
  const first = await f.write("first", { ...original, conversationMetadata: converted.metadata });
  const alreadyWritten = await readFile(first, "utf8");
  const backup = path.join(f.backupRoot, "first", "conversation.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, JSON.stringify(original));
  const second = await f.write("second", original);
  await f.run(true);
  assert.equal(await readFile(first, "utf8"), alreadyWritten);
  assert.deepEqual(JSON.parse(await readFile(backup, "utf8")), original);
  assert.equal(JSON.parse(await readFile(second, "utf8")).conversationMetadata.runtime.version, 3);
});

test("invalid versions and symlinked histories fail before any upgrade", async t => {
  const f = await fixture(t);
  const invalid = structuredClone(original);
  invalid.conversationMetadata.runtime.version = 1;
  const file = await f.write("owner", invalid);
  await assert.rejects(f.run(true), /unsupported runtime version/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), invalid);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  const target = path.join(f.root, "outside.json");
  await writeFile(target, JSON.stringify(original));
  await rm(file);
  await symlink(target, file);
  await assert.rejects(f.run(true), /regular file/);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), original);
});

test("format 3 retains active and archived native journals and rejects malformed archived runtime state", async t => {
  const f = await fixture(t);
  const converted = upgradeConversationRuntimeState({ metadata: original.conversationMetadata, conversationLog: original.conversationLog });
  const active = { ...original, schemaVersion: 3, scopeId: "colleague_fresh", runtimeId: "owner:colleague_fresh", conversationLog: [], conversationMetadata: {} };
  const archived = { ...original, runtimeId: "owner", archivedAt: "2026-10-06T00:00:00.000Z", conversationMetadata: converted.metadata,
    unconfirmedMessages: [], freshOperation: { operationId: "rotate", conversationId: active.scopeId } };
  delete archived.schemaVersion;
  active.previousConversations = [archived];
  const file = await f.write("owner", active);
  const before = await readFile(file, "utf8");
  await f.run(false);
  await f.run(true);
  await upgradeColleagueConversations({ ...f, apply: true, report: () => {} });
  await upgradeColleagueConversationHistory({ ...f, apply: true, report: () => {} });
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  const broken = structuredClone(active);
  broken.previousConversations[0].conversationMetadata.runtime.version = 99;
  await writeFile(file, JSON.stringify(broken));
  for (const upgrade of [upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory]) {
    await assert.rejects(upgrade({ ...f, apply: true, report: () => {} }), /unsupported runtime version/);
  }
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), broken);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

// Captured from the frozen original product/controlled native producer. Only the
// fixture's physical HOME is relocated; product/native IDs and written words stay exact.
async function nativeContinuityFixture(t, { schema = 3, longHome = false } = {}) {
  const f = await fixture(t);
  const captured = JSON.parse(await readFile(new URL("../fixtures/colleagueNativeContinuity.json", import.meta.url), "utf8"));
  const product = JSON.parse(captured.originalProductBytes);
  const receipt = JSON.parse(captured.stoppedNativeReceiptBytes);
  const env = { HOME: path.join(f.root, longHome ? "h".repeat(210) : "home") };
  await mkdir(env.HOME, { recursive: true });
  const scopeWorkdir = path.join(f.systemRoot, "colleague", "NDI", product.scopeId);
  const receiptPath = path.join(scopeWorkdir, "claude-conversations", product.scopeId, `${product.conversationId}.json`);
  await mkdir(path.dirname(receiptPath), { recursive: true });
  receipt.nativeWorkdir = env.HOME;
  await writeFile(receiptPath, JSON.stringify(receipt));
  const encodedHome = env.HOME.normalize("NFC").replace(/[^a-zA-Z0-9]/gu, "-");
  const projectDirectory = path.join(env.HOME, ".claude", "projects", encodedHome.length > 200 ? `${encodedHome.slice(0, 200)}-one` : encodedHome);
  await mkdir(projectDirectory, { recursive: true });
  const nativePath = path.join(projectDirectory, `${product.conversationId}.jsonl`);
  await writeFile(nativePath, captured.nativeHistoryBytes);
  const filePath = await f.write("NDI", product);
  const report = (level, message) => f.reports.push({ level, message });
  if (schema >= 2) await upgradeColleagueConversations({ ...f, backupRoot: path.join(f.root, "outer-backup"), apply: true, report });
  if (schema === 3) await upgradeColleagueConversationHistory({ ...f, backupRoot: path.join(f.root, "history-backup"), apply: true, report });
  const backupRoot = path.join(f.systemRoot, "upgrades", "backups", "20261009-colleague-native-continuity");
  return { ...f, env, product, receipt, receiptPath, nativePath, projectDirectory, scopeWorkdir, filePath, backupRoot,
    run: (apply, extraReport = () => {}) => upgradeColleagueNativeContinuity({ systemRoot: f.systemRoot, backupRoot, env, apply,
      report: (level, message) => { report(level, message); extraReport(level, message); } }) };
}

test("native continuity preflight creates no installation or backup and accepts earlier pending product upgrades", async t => {
  const empty = await fixture(t);
  await upgradeColleagueNativeContinuity({ ...empty, backupRoot: path.join(empty.systemRoot, "upgrades", "backups", "native"), apply: false, report() {} });
  await assert.rejects(stat(empty.systemRoot), { code: "ENOENT" });
  for (const schema of [1, 2, 3]) {
    const f = await nativeContinuityFixture(t, { schema });
    const before = await readFile(f.filePath, "utf8");
    await f.run(false);
    assert.equal(await readFile(f.filePath, "utf8"), before);
    await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
    if (schema !== 3) await assert.rejects(f.run(true), /Complete earlier numbered/);
    assert.equal(await readFile(f.filePath, "utf8"), before);
  }
});

test("native continuity restores the actual original UUID/account pin with exact history, backups and stable retry", async t => {
  const f = await nativeContinuityFixture(t);
  const before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath, "utf8"), receipt = await readFile(f.receiptPath, "utf8");
  await f.run(true);
  const written = await readFile(f.filePath, "utf8"), next = JSON.parse(written), previous = JSON.parse(before);
  const { conversationMetadata, ...retained } = next;
  assert.deepEqual(retained, previous);
  assert.deepEqual(next.conversationLog, f.product.conversationLog);
  assert.equal(next.conversationMetadata.runtime.binding.conversationId, f.product.conversationId);
  assert.deepEqual(next.conversationMetadata.runtime.binding, { conversationId: f.product.conversationId,
    workdir: f.env.HOME, scopeWorkdir: f.scopeWorkdir, configRoot: path.join(f.env.HOME, ".claude"),
    executionId: "", sent: true, accountIdentity: f.receipt.accountIdentity.slice(7) });
  assert.equal(next.conversationMetadata.runtime.configuration.integrationId, undefined, "Native account guard must not become an external-connection first-use guard");
  assert.equal(next.conversationMetadata.runtime.configuration.model, f.product.assistantSelection.modelId);
  assert.equal(next.conversationMetadata.runtime.lastEngine, "claude");
  assert.equal(Object.keys(next.conversationMetadata.runtime.seen).length, 4);
  assert.equal(next.conversationMetadata.runtime.request, undefined, "Do not fabricate or replay the old native request");
  assert.equal(await readFile(f.nativePath, "utf8"), native);
  assert.equal(await readFile(f.receiptPath, "utf8"), receipt);
  const relative = path.relative(f.systemRoot, f.filePath);
  assert.equal(await readFile(path.join(f.backupRoot, "before", relative), "utf8"), before);
  assert.equal((await stat(path.join(f.backupRoot, "before", relative))).mode & 0o777, 0o600);
  assert.equal((await stat(f.filePath)).mode & 0o777, 0o600);
  await f.run(false);
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), written);
});

const nativeRefusals = [
  ["active product", async f => { const saved = JSON.parse(await readFile(f.filePath, "utf8")); saved.status = "working"; await writeFile(f.filePath, JSON.stringify(saved)); }],
  ["unknown effect", async f => { const saved = JSON.parse(await readFile(f.filePath, "utf8")); saved.retiredConversation.operation = { status: "unknown" }; await writeFile(f.filePath, JSON.stringify(saved)); }],
  ["changed selection", async f => { const saved = JSON.parse(await readFile(f.filePath, "utf8")); saved.assistantSelection.modelId = "other"; await writeFile(f.filePath, JSON.stringify(saved)); }],
  ["missing receipt", f => rm(f.receiptPath)],
  ["running receipt", async f => { f.receipt.executionId = "still-owned"; await writeFile(f.receiptPath, JSON.stringify(f.receipt)); }],
  ["unconfirmed receipt", async f => { f.receipt.state = "unknown"; await writeFile(f.receiptPath, JSON.stringify(f.receipt)); }],
  ["different native turn", async f => { f.receipt.lastMessageId = "other"; await writeFile(f.receiptPath, JSON.stringify(f.receipt)); }],
  ["missing account", async f => { delete f.receipt.accountIdentity; await writeFile(f.receiptPath, JSON.stringify(f.receipt)); }],
  ["multiple provider pins", async f => { f.receipt.accountIdentities.deepseek = f.receipt.accountIdentity; await writeFile(f.receiptPath, JSON.stringify(f.receipt)); }],
  ["foreign home", async f => { f.receipt.nativeWorkdir = f.root; await writeFile(f.receiptPath, JSON.stringify(f.receipt)); }],
  ["partial newer user", async f => { await writeFile(f.nativePath, await readFile(f.nativePath, "utf8") + '{"type":"user","uuid":"newer"'); }],
  ["complete newer user", async f => { await writeFile(f.nativePath, await readFile(f.nativePath, "utf8") + JSON.stringify({ type: "user", uuid: "newer", message: { content: "Unconfirmed work" } }) + "\n"); }],
  ["active native goal", async f => { await writeFile(f.nativePath, await readFile(f.nativePath, "utf8") + JSON.stringify({ type: "attachment", timestamp: "2026-10-09T00:00:00Z", attachment: { type: "goal_status", condition: "Still working", met: false } }) + "\n"); }],
  ["missing native answer", async f => { const frames = (await readFile(f.nativePath, "utf8")).trim().split("\n").map(JSON.parse); await writeFile(f.nativePath, frames.filter(frame => frame.uuid !== `${f.receipt.lastMessageId}-answer`).map(JSON.stringify).join("\n") + "\n"); }],
  ["missing native file", f => rm(f.nativePath)],
  ["symlink native file", async f => { const other = path.join(f.root, "other.jsonl"); await writeFile(other, await readFile(f.nativePath, "utf8")); await rm(f.nativePath); await symlink(other, f.nativePath); }],
  ["symlink receipt", async f => { const other = path.join(f.root, "other.json"); await writeFile(other, await readFile(f.receiptPath, "utf8")); await rm(f.receiptPath); await symlink(other, f.receiptPath); }],
  ["foreign current owner", async f => { const saved = JSON.parse(await readFile(f.filePath, "utf8")); const foreign = { ...saved, scopeId: "colleague_foreign", runtimeId: "other", retiredConversation: undefined,
    conversationMetadata: { runtime: { version: 3, engine: "claude", segmentId: "foreign", lastEngine: "claude", configuration: {}, predecessors: [], seen: {}, binding: { conversationId: f.product.conversationId } } } }; await f.write("other", foreign); }]
];
for (const [name, alter] of nativeRefusals) test(`native continuity refuses ${name} before any backup or product change`, async t => {
  const f = await nativeContinuityFixture(t);
  await alter(f);
  const before = await readFile(f.filePath, "utf8");
  await assert.rejects(f.run(false));
  await assert.rejects(f.run(true));
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

test("native continuity refuses ambiguous native long paths", async t => {
  const f = await nativeContinuityFixture(t, { longHome: true });
  await mkdir(`${f.projectDirectory.slice(0, -3)}two`);
  await assert.rejects(f.run(false), /ambiguous/);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

test("native continuity reinspects original evidence before finishing a backed-up publication", async t => {
  const f = await nativeContinuityFixture(t);
  const before = await readFile(f.filePath, "utf8");
  await f.run(true);
  await writeFile(f.filePath, before); // Simulate interruption before this backed-up replacement.
  const tail = await readFile(f.nativePath, "utf8");
  await writeFile(f.nativePath, tail + '{"type":"user"');
  await assert.rejects(f.run(true), /incomplete frame/);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await writeFile(f.nativePath, tail);
  await f.run(true);
  assert.equal(JSON.parse(await readFile(f.filePath, "utf8")).conversationMetadata.runtime.binding.conversationId, f.product.conversationId);
});

test("native continuity detects changes during preparation before publishing any owner", async t => {
  const f = await nativeContinuityFixture(t);
  const before = await readFile(f.filePath, "utf8");
  await assert.rejects(f.run(true, (_level, message) => {
    if (message.includes("retain the exact original")) writeFileSync(f.nativePath, "changed\n");
  }), /changed during inspection/);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

test("native continuity never publishes an old prepared pin after a valid receipt changes on retry", async t => {
  const f = await nativeContinuityFixture(t);
  const before = await readFile(f.filePath, "utf8");
  await f.run(true);
  const written = await readFile(f.filePath, "utf8");
  await writeFile(f.filePath, before);
  f.receipt.accountIdentity = `sha256:${"b".repeat(64)}`;
  f.receipt.accountIdentities.anthropic = f.receipt.accountIdentity;
  await writeFile(f.receiptPath, JSON.stringify(f.receipt));
  await assert.rejects(f.run(true), /prepared native binding differs/);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  assert.equal(await readFile(path.join(f.backupRoot, "after", path.relative(f.systemRoot, f.filePath)), "utf8"), written);
});
