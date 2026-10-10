import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import codexCompletedPolicyUpgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261010-colleague-codex-completed-policy.js";
import { openCodeDetachedPrompt } from "@jskit-ai/assistant-core/server/opencode-turn";
import { upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, upgradeColleagueNativeContinuity, upgradeColleagueCodexCompletedPolicy } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";

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

const oldCodexPolicy = "565d936fcb00d90ddef65fa80b1db8ed6d3bb4faec815cf15dc8723e4d259a16";
const emptyCodexPolicy = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
async function codexPolicyFixture(t) {
  const f = await fixture(t);
  const saved = structuredClone(original);
  saved.schemaVersion = 3;
  saved.runtimeId = "owner:colleague_retained";
  saved.previousConversations = [];
  saved.status = "ready";
  saved.conversationMetadata.runtime.version = 3;
  saved.conversationMetadata.runtime.lastEngine = "codex";
  delete saved.conversationMetadata.runtime.request;
  saved.conversationMetadata.runtime.binding = { threadId: "exact-native-thread", executionId: "", accountIdentity: "original-account",
    workdir: path.join(f.systemRoot, "colleague/owner/colleague_retained"), configRoot: path.join(f.root, "original-home/.codex"),
    toolSchemaIdentity: oldCodexPolicy, goal: { status: "active", condition: "Retained original goal" } };
  const previous = { ...structuredClone(saved), scopeId: "colleague_older", runtimeId: "owner", archivedAt: "2026-10-09T00:00:00Z",
    freshOperation: { operationId: "original-fresh-operation", conversationId: saved.scopeId }, unconfirmedMessages: [] };
  delete previous.schemaVersion; delete previous.previousConversations;
  previous.conversationMetadata.runtime.binding.threadId = "older-private-thread";
  saved.previousConversations = [previous];
  saved.conversationLog[0].metadata.applicationTools = [{ id: "settled-effect", status: "complete", result: { ok: true } }];
  const filePath = await f.write("owner", saved);
  const nativePath = path.join(f.root, "native-rollout.jsonl");
  await writeFile(nativePath, "original native bytes; independent native goal retained\n");
  const backupRoot = path.join(f.systemRoot, "upgrades/backups/20261010-colleague-codex-completed-policy");
  return { ...f, saved, filePath, nativePath, backupRoot,
    run: (apply, report = () => {}) => upgradeColleagueCodexCompletedPolicy({ systemRoot: f.systemRoot, backupRoot, apply,
      report: (level, message) => { f.reports.push({ level, message }); report(level, message); } }) };
}

test("Codex tool-policy check is read-only and retirement preserves the original selection, full history and native files", async t => {
  const empty = await fixture(t);
  await upgradeColleagueCodexCompletedPolicy({ ...empty, backupRoot: path.join(empty.systemRoot, "upgrades/backups/codex-policy"), apply: false, report() {} });
  await assert.rejects(stat(empty.systemRoot), { code: "ENOENT" });
  const f = await codexPolicyFixture(t), before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath, "utf8");
  await f.run(false);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await f.run(true);
  const afterBytes = await readFile(f.filePath, "utf8"), after = JSON.parse(afterBytes), old = JSON.parse(before);
  assert.deepEqual({ ...after, conversationMetadata: old.conversationMetadata }, old);
  const runtime = after.conversationMetadata.runtime, previous = runtime.predecessors.at(-1);
  assert.deepEqual(runtime.binding, { threadId: "", workdir: old.conversationMetadata.runtime.binding.workdir,
    configRoot: old.conversationMetadata.runtime.binding.configRoot, executionId: "" });
  assert.deepEqual(previous.binding, old.conversationMetadata.runtime.binding);
  assert.deepEqual(previous.configuration, old.conversationMetadata.runtime.configuration);
  assert.equal(previous.replacement.retireNative, true);
  assert.equal(previous.replacement.operation, "select");
  assert.equal(previous.successorId, runtime.segmentId);
  assert.equal(runtime.lastEngine, "");
  assert.deepEqual(runtime.seen, {});
  assert.equal(runtime.request, undefined);
  assert.equal(runtime.replacement, undefined);
  assert.equal(await readFile(f.nativePath, "utf8"), native);
  const relative = path.relative(f.systemRoot, f.filePath);
  assert.equal(await readFile(path.join(f.backupRoot, "before", relative), "utf8"), before);
  assert.equal(await readFile(path.join(f.backupRoot, "after", relative), "utf8"), afterBytes);
  assert.equal((await stat(path.join(f.backupRoot, "before", relative))).mode & 0o777, 0o600);
  assert.equal((await stat(f.filePath)).mode & 0o777, 0o600);
  await f.run(false);
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), afterBytes, "Retry keeps exact successor and operation identities");
});

const codexPolicyRefusals = [
  ["unknown policy", saved => { saved.conversationMetadata.runtime.binding.toolSchemaIdentity = "a".repeat(64); }],
  ["missing policy", saved => { delete saved.conversationMetadata.runtime.binding.toolSchemaIdentity; }],
  ["active application", saved => { saved.status = "working"; }],
  ["pending request", saved => { saved.conversationMetadata.runtime.request = { messageId: "pending", text: "Retained pending words", attachments: [], at: "2026-10-10T00:00:00Z", attempted: false }; }],
  ["active native receipt", saved => { saved.conversationMetadata.runtime.nativeTurn = { active: true }; }],
  ["unconfirmed observation cleanup", saved => { saved.conversationMetadata.runtime.binding.observationLoss = { stopped: false }; }],
  ["missing observation cleanup confirmation", saved => { saved.conversationMetadata.runtime.binding.observationLoss = {}; }],
  ["pending native input", saved => { saved.conversationMetadata.runtime.binding.codexAppServerRun = { state: "completed", pendingUserMessageClientIds: ["unconfirmed"] }; }],
  ["active saved run", saved => { saved.conversationMetadata.runtime.binding.codexAppServerRun = { state: "active" }; }],
  ["running canonical turn", saved => { saved.conversationLog[0].metadata.runtime.status = "running"; }],
  ["unknown effect", saved => { saved.conversationLog[0].metadata.applicationTools[0].status = "unknown"; }],
  ["missing effect result", saved => { delete saved.conversationLog[0].metadata.applicationTools[0].result; }],
  ["retired uncertain effect", saved => { saved.retiredConversation.operation = { status: "unknown" }; }],
  ["reserved assignment", saved => { saved.assignments = [{ turns: [{ status: "reserved" }] }]; }],
  ["foreign scope path", saved => { saved.conversationMetadata.runtime.binding.workdir += "/foreign"; }],
  ["relative configuration", saved => { saved.conversationMetadata.runtime.binding.configRoot = "relative"; }],
  ["unfinished Undo", saved => { saved.conversationMetadata.runtime.replacement = { reason: "rewind" }; }]
];
for (const [name, alter] of codexPolicyRefusals) test(`Codex tool-policy refuses ${name} without backups, replay or product changes`, async t => {
  const f = await codexPolicyFixture(t);
  alter(f.saved); await writeFile(f.filePath, JSON.stringify(f.saved));
  const before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath, "utf8");
  await assert.rejects(f.run(false));
  await assert.rejects(f.run(true));
  assert.equal(await readFile(f.filePath, "utf8"), before);
  assert.equal(await readFile(f.nativePath, "utf8"), native);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

test("Codex tool-policy leaves empty, inert and other engine bindings unchanged", async t => {
  for (const change of [saved => { saved.conversationMetadata.runtime.binding.toolSchemaIdentity = emptyCodexPolicy; },
    saved => { saved.conversationMetadata.runtime.binding.threadId = ""; },
    saved => { saved.conversationMetadata.runtime.engine = "claude"; saved.conversationMetadata.runtime.binding = { conversationId: "retained" }; }]) {
    const f = await codexPolicyFixture(t); change(f.saved); await writeFile(f.filePath, JSON.stringify(f.saved));
    const before = await readFile(f.filePath, "utf8"); await f.run(false); await f.run(true);
    assert.equal(await readFile(f.filePath, "utf8"), before);
    await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  }
});

test("Codex tool-policy resumes a partial publication using exact prepared IDs and rejects changed backup or product bytes", async t => {
  const f = await codexPolicyFixture(t), before = await readFile(f.filePath, "utf8");
  await f.run(true);
  const after = await readFile(f.filePath, "utf8");
  await writeFile(f.filePath, before);
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), after);
  const relative = path.relative(f.systemRoot, f.filePath), backup = path.join(f.backupRoot, "after", relative);
  await writeFile(backup, after + " ");
  await assert.rejects(f.run(true), /after copy is missing or changed/);
  assert.equal(await readFile(f.filePath, "utf8"), after);
  await writeFile(backup, after);
  await writeFile(f.filePath, JSON.stringify({ ...JSON.parse(before), error: "Independent product writer changed state" }));
  await assert.rejects(f.run(true), /differs from both upgrade copies/);
});

test("Codex tool-policy detects a product writer during preparation before backing up or publishing", async t => {
  const f = await codexPolicyFixture(t), before = await readFile(f.filePath, "utf8");
  const changed = JSON.stringify({ ...f.saved, error: "Concurrent product writer" });
  await assert.rejects(f.run(true, (level, message) => { if (level === "warning" && message.includes("retire only")) writeFileSync(f.filePath, changed); }), /changed during preparation/);
  assert.equal(await readFile(f.filePath, "utf8"), changed);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  assert.notEqual(changed, before);
});

test("Codex tool-policy numbered wrapper requires the existing feature owner and preserves check/apply context", async t => {
  const f = await codexPolicyFixture(t);
  assert.equal(codexCompletedPolicyUpgrade.id, "20261010-colleague-codex-completed-policy");
  await assert.rejects(codexCompletedPolicyUpgrade.run({ ...f, apply: false, report() {} }), /tool-policy owner is required/);
  const calls = [];
  for (const apply of [false, true]) await codexCompletedPolicyUpgrade.run({ systemRoot: f.systemRoot, backupRoot: f.backupRoot,
    apply, report() {}, upgradeColleagueCodexCompletedPolicy: async context => {
      calls.push(context.apply);
      assert.equal(context.systemRoot, f.systemRoot);
      assert.equal(context.backupRoot, f.backupRoot);
      await upgradeColleagueCodexCompletedPolicy(context);
    } });
  assert.deepEqual(calls, [false, true]);
  assert.equal(JSON.parse(await readFile(f.filePath, "utf8")).conversationMetadata.runtime.binding.threadId, "");
});

test("Codex tool-policy retry finishes multiple owners without reconstructing history or replacement IDs", async t => {
  const f = await codexPolicyFixture(t), second = structuredClone(f.saved);
  second.runtimeId = "second:colleague_retained";
  second.previousConversations = [];
  second.conversationMetadata.runtime.binding.workdir = path.join(f.systemRoot, "colleague/second/colleague_retained");
  second.conversationMetadata.runtime.binding.threadId = "second-private-thread";
  const secondPath = await f.write("second", second);
  let published = 0;
  await assert.rejects(f.run(true, (_level, message) => { if (message.startsWith("Published state:") && ++published === 1) throw new Error("Interrupted product publication"); }), /Interrupted product publication/);
  const manifest = JSON.parse(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.files.length, 2);
  const prepared = await Promise.all(manifest.files.map(entry => readFile(path.join(f.backupRoot, "after", entry.path), "utf8")));
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), prepared[manifest.files.findIndex(entry => entry.path === path.relative(f.systemRoot, f.filePath))]);
  assert.equal(await readFile(secondPath, "utf8"), prepared[manifest.files.findIndex(entry => entry.path === path.relative(f.systemRoot, secondPath))]);
  await f.run(true);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8")), manifest);
});

test("Codex tool-policy requires earlier outer-schema publication before apply while check stays read-only", async t => {
  const f = await codexPolicyFixture(t);
  f.saved.schemaVersion = 2;
  await writeFile(f.filePath, JSON.stringify(f.saved));
  const before = await readFile(f.filePath, "utf8");
  await f.run(false);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(f.run(true), /Complete earlier numbered/);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});


// Literal frozen869ebb protocol.outputSchema, independently retained as the
// original producer's persisted prompt grammar (current shared schema differs).
const originalOpenCodeSchema = {
  type: "object", additionalProperties: false,
  required: ["kind", "text", "toolName", "arguments"],
  properties: {
    kind: { type: "string", enum: ["reply", "tool"] },
    text: { type: "string", description: "The final reply, or a brief progress sentence for the first tool request; empty for subsequent tool requests." }, toolName: { type: "string" }, arguments: { type: "string" }
  }
};
// Original schema1 fields and original MessageV2 storage grammar; controlled
// SQLite fixture proof, not an authenticated historical native conversion.
async function openCodeContinuityFixture(t) {
  const f = await fixture(t);
  const product = { schemaVersion: 1, scopeId: "colleague_opencode_original", conversationId: "ses_original",
    assistantSelection: { engineId: "opencode", modelProviderId: "deepseek", modelId: "deepseek-flash", agentId: "build", variantId: "high" },
    status: "ready", error: "", operation: null, runId: "msg_original_user", currentTurnId: "000001",
    conversationLog: [{ turnId: "000001", messages: [
      { role: "user", text: "Keep this original discussion.", messageId: "authored_original" },
      { role: "assistant", text: "The frozen OpenCode discussion is settled." }
    ] }], watches: [], observations: [], assignments: [] };
  const filePath = await f.write("NDI", product);
  const scopeWorkdir = path.join(f.systemRoot, "colleague", "NDI", product.scopeId);
  await mkdir(scopeWorkdir, { recursive: true });
  const databasePath = path.join(f.systemRoot, "services", "opencode", "opencode.db");
  await mkdir(path.dirname(databasePath), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, revert TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);
    CREATE TABLE session_input (session_id TEXT, promoted_seq INTEGER);`);
  database.prepare("INSERT INTO session VALUES (?, ?, NULL, NULL)").run(product.conversationId, scopeWorkdir);
  database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(product.runId, product.conversationId, 1, JSON.stringify({ role: "user", time: { created: 1 } }));
  database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_original_final", product.conversationId, 2,
    JSON.stringify({ role: "assistant", parentID: product.runId, finish: "stop", time: { created: 2, completed: 3 } }));
  database.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("prt_original_input", product.runId, product.conversationId,
    JSON.stringify({ type: "text", text: openCodeDetachedPrompt({ outputSchema: originalOpenCodeSchema,
      prompt: JSON.stringify({ assistantName: "Colleague", autonomous: false, readOnly: false, userMessages: [
        { messageId: product.conversationLog[0].messages[0].messageId, text: product.conversationLog[0].messages[0].text }
      ] }) }) }));
  database.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("prt_original_final", "msg_original_final", product.conversationId,
    JSON.stringify({ type: "text", text: JSON.stringify({ kind: "reply", text: product.conversationLog[0].messages[1].text, toolName: "", arguments: "" }) }));
  database.close();
  await upgradeColleagueConversations({ ...f, backupRoot: path.join(f.root, "outer-backup"), apply: true, report() {} });
  await upgradeColleagueConversationHistory({ ...f, backupRoot: path.join(f.root, "history-backup"), apply: true, report() {} });
  const backupRoot = path.join(f.systemRoot, "upgrades", "backups", "20261009-colleague-native-continuity");
  return { ...f, product, filePath, scopeWorkdir, databasePath, backupRoot,
    run: apply => upgradeColleagueNativeContinuity({ systemRoot: f.systemRoot, backupRoot, env: {}, apply, report() {} }) };
}

test("native continuity keeps the original OpenCode scope/session/database and written history without inventing an old key", async t => {
  const f = await openCodeContinuityFixture(t);
  const before = await readFile(f.filePath, "utf8");
  const native = await readFile(f.databasePath);
  await f.run(false);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await f.run(true);
  const written = await readFile(f.filePath, "utf8");
  const next = JSON.parse(written);
  const { conversationMetadata, ...retained } = next;
  assert.deepEqual(retained, JSON.parse(before));
  assert.equal(conversationMetadata.runtime.engine, "opencode");
  assert.equal(conversationMetadata.runtime.binding.sessionId, f.product.conversationId);
  assert.equal(conversationMetadata.runtime.binding.workdir, f.scopeWorkdir);
  assert.equal(conversationMetadata.runtime.binding.databasePath, f.databasePath);
  assert.equal(path.dirname(conversationMetadata.runtime.binding.directory), path.join(f.scopeWorkdir, "native"));
  assert.equal(conversationMetadata.runtime.binding.accountIdentity, undefined);
  assert.equal(conversationMetadata.runtime.binding.executionId, "");
  assert.equal(conversationMetadata.runtime.request, undefined);
  assert.equal(conversationMetadata.runtime.configuration.integrationId, "deepseek");
  assert.deepEqual(await readFile(f.databasePath), native);
  assert.equal(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, f.filePath)), "utf8"), before);
  assert.equal((await stat(f.filePath)).mode & 0o777, 0o600);
  await f.run(false);
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), written);
  assert.deepEqual(await readFile(f.databasePath), native);
});

for (const change of ["foreign directory", "pending native request", "newer user", "unfinished answer", "wrong final", "native journal", "missing original schema suffix", "changed original schema suffix"]) {
  test(`native OpenCode continuity refuses ${change} before publishing any metadata`, async t => {
    const f = await openCodeContinuityFixture(t);
    const { DatabaseSync } = await import("node:sqlite");
    if (change === "native journal") await writeFile(`${f.databasePath}-wal`, "Retained uncheckpointed storage");
    else {
      const db = new DatabaseSync(f.databasePath);
      if (change === "foreign directory") db.prepare("UPDATE session SET directory = ?").run(f.root);
      if (change === "pending native request") db.exec("INSERT INTO session_input VALUES ('ses_original', NULL)");
      if (change === "newer user") db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_newer", "ses_original", 4, JSON.stringify({ role: "user", time: { created: 4 } }));
      if (change === "unfinished answer") db.prepare("UPDATE message SET data = ? WHERE id = 'msg_original_final'").run(JSON.stringify({ role: "assistant", parentID: "msg_original_user", time: { created: 2 } }));
      if (change === "missing original schema suffix" || change === "changed original schema suffix") {
        const part = JSON.parse(db.prepare("SELECT data FROM part WHERE id = 'prt_original_input'").get().data);
        const suffix = openCodeDetachedPrompt({ outputSchema: originalOpenCodeSchema });
        part.text = part.text.slice(0, -suffix.length) + (change === "changed original schema suffix" ? openCodeDetachedPrompt({ outputSchema: { type: "object" } }) : "");
        db.prepare("UPDATE part SET data = ? WHERE id = 'prt_original_input'").run(JSON.stringify(part));
      }
      if (change === "wrong final") db.prepare("UPDATE part SET data = ?").run(JSON.stringify({ type: "text", text: JSON.stringify({ kind: "reply", text: "A different answer", toolName: "", arguments: "" }) }));
      db.close();
    }
    const product = await readFile(f.filePath, "utf8");
    const native = await readFile(f.databasePath);
    await assert.rejects(f.run(false));
    await assert.rejects(f.run(true));
    assert.equal(await readFile(f.filePath, "utf8"), product);
    assert.deepEqual(await readFile(f.databasePath), native);
    await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  });
}

// Original external Claude pins include the key, but not the native endpoint.
// Reuse both owners when adapting that receipt to the current connection pin.
async function externalClaudeContinuityFixture(t) {
  const f = await nativeContinuityFixture(t);
  const { claudeProviderAccountIdentity } = await import("../../packages/vibe64-terminals/src/server/claudeConversationAccounts.js");
  const { codexProviderPaths } = await import("../../packages/vibe64-core/src/server/codexProviderConnections.js");
  const providerId = "deepseek", apiKey = "fixture-original-private-provider-key";
  const configRoot = path.join(f.env.HOME, ".claude");
  const connectionPath = codexProviderPaths(f.systemRoot, providerId, "claude").connectionPath;
  await mkdir(path.dirname(connectionPath), { recursive: true });
  await writeFile(connectionPath, JSON.stringify({ apiKey, claudeReady: true }));
  const saved = JSON.parse(await readFile(f.filePath, "utf8"));
  saved.assistantSelection = { ...saved.assistantSelection, modelProviderId: providerId, modelId: "deepseek-flash" };
  saved.retiredConversation.assistantSelection = saved.assistantSelection;
  f.receipt.accountIdentity = claudeProviderAccountIdentity(configRoot, providerId, apiKey);
  f.receipt.accountIdentities = { [providerId]: f.receipt.accountIdentity };
  await writeFile(f.receiptPath, JSON.stringify(f.receipt));
  await writeFile(f.filePath, JSON.stringify(saved));
  return { ...f, configRoot, providerId, apiKey, connectionPath };
}

test("native continuity verifies original external Claude key pins and translates through the actual identity owners without changing credentials", async t => {
  const f = await externalClaudeContinuityFixture(t);
  const { claudeConnectionIdentity } = await import("@jskit-ai/assistant-core/server/claude-process");
  const { curatedCodexProvider } = await import("../../packages/vibe64-core/src/shared/curatedCodexProviders.js");
  const before = await readFile(f.filePath, "utf8"), keyBytes = await readFile(f.connectionPath, "utf8");
  const nativeBytes = await readFile(f.nativePath, "utf8"), receiptBytes = await readFile(f.receiptPath, "utf8");
  await f.run(false);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await f.run(true);
  const converted = JSON.parse(await readFile(f.filePath, "utf8"));
  const { conversationMetadata, ...retained } = converted;
  assert.deepEqual(retained, JSON.parse(before));
  assert.equal(conversationMetadata.runtime.binding.conversationId, f.product.conversationId);
  assert.equal(conversationMetadata.runtime.binding.accountIdentity, undefined);
  assert.deepEqual(conversationMetadata.runtime.binding.connectionIdentities, { [f.providerId]:
    claudeConnectionIdentity(f.configRoot, f.providerId, curatedCodexProvider(f.providerId).claudeBaseUrl, f.apiKey) });
  assert.equal(conversationMetadata.runtime.configuration.integrationId, f.providerId);
  assert.equal(conversationMetadata.runtime.binding.executionId, "");
  assert.equal(conversationMetadata.runtime.request, undefined);
  assert.equal(await readFile(f.connectionPath, "utf8"), keyBytes);
  assert.equal(await readFile(f.nativePath, "utf8"), nativeBytes);
  assert.equal(await readFile(f.receiptPath, "utf8"), receiptBytes);
  const written = await readFile(f.filePath, "utf8");
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), written);
});

for (const [name, change] of [
  ["missing original external Claude key", f => rm(f.connectionPath)],
  ["replaced original external Claude key", f => writeFile(f.connectionPath, JSON.stringify({ apiKey: "fixture-replacement-key", claudeReady: true }))],
  ["unverified external Claude connection", f => writeFile(f.connectionPath, JSON.stringify({ apiKey: f.apiKey, claudeReady: false }))]
]) test(`native continuity refuses ${name} without touching product or credentials`, async t => {
  const f = await externalClaudeContinuityFixture(t);
  await change(f);
  const before = await readFile(f.filePath, "utf8"), receiptBytes = await readFile(f.receiptPath, "utf8");
  await assert.rejects(f.run(false), /original.*(?:key|connection)/);
  await assert.rejects(f.run(true), /original.*(?:key|connection)/);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  assert.equal(await readFile(f.receiptPath, "utf8"), receiptBytes);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});

// Controlled original schema1 product shape plus the supported native rollout
// and separate native goal-store schema. This is not authentic legacy custody.
async function codexContinuityFixture(t, { providerId = "openai" } = {}) {
  const f = await nativeContinuityFixture(t, { schema: 1 });
  const { DatabaseSync } = await import("node:sqlite");
  const product = structuredClone(f.product);
  product.assistantSelection = { ...product.assistantSelection, engineId: "codex", agentId: "codex", modelProviderId: providerId, modelId: providerId === "openai" ? "gpt-6.1-sol" : "deepseek-flash" };
  product.conversationId = "01234567-0123-4567-89ab-0123456789ab";
  product.runId = "12345678-0123-4567-89ab-0123456789ab";
  await writeFile(f.filePath, JSON.stringify(product));
  await upgradeColleagueConversations({ ...f, backupRoot: path.join(f.root, "outer-codex"), apply: true, report() {} });
  await upgradeColleagueConversationHistory({ ...f, backupRoot: path.join(f.root, "history-codex"), apply: true, report() {} });
  const configRoot = path.join(f.env.HOME, ".codex"), sqliteHome = path.join(f.root, "native-sqlite");
  let nativeRoot = configRoot;
  if (providerId !== "openai") {
    const { codexProviderPaths } = await import("../../packages/vibe64-core/src/server/codexProviderConnections.js");
    const paths = codexProviderPaths(f.systemRoot, providerId);
    nativeRoot = paths.codexHome;
    await mkdir(path.dirname(paths.connectionPath), { recursive: true });
    await writeFile(paths.connectionPath, JSON.stringify({ apiKey: "fixture-existing-codex-provider-key" }));
  }
  await mkdir(path.join(nativeRoot, "sessions", "2026", "10", "10"), { recursive: true });
  await mkdir(sqliteHome);
  const goalPath = path.join(sqliteHome, "goals_1.sqlite");
  const database = new DatabaseSync(goalPath);
  database.exec("CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,objective TEXT NOT NULL,status TEXT NOT NULL,token_budget INTEGER,tokens_used INTEGER NOT NULL,time_used_seconds INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,updated_at_ms INTEGER NOT NULL)");
  database.close();
  f.env.CODEX_SQLITE_HOME = sqliteHome;
  const nativePath = path.join(nativeRoot, "sessions", "2026", "10", "10", `rollout-2026-10-10T00-00-00-${product.conversationId}.jsonl`);
  const last = product.conversationLog.at(-1);
  const authored = last.messages.find(message => message.role === "user"), answer = last.messages.find(message => message.role === "assistant").text;
  const reply = JSON.stringify({ kind: "reply", text: answer, toolName: "", arguments: "" });
  const rows = [
    { type: "session_meta", payload: { id: product.conversationId, cwd: f.scopeWorkdir, model_provider: providerId, dynamic_tools: [] } },
    { type: "event_msg", payload: { type: "task_started", turn_id: product.runId } },
    { type: "turn_context", payload: { turn_id: product.runId, cwd: f.scopeWorkdir, model: product.assistantSelection.modelId } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: JSON.stringify({ assistantName: "Colleague", autonomous: false, readOnly: false, userMessages: [{ messageId: authored.messageId, text: authored.text }] }) }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: reply }] } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: product.runId, last_agent_message: reply } }
  ];
  const writeNative = () => writeFile(nativePath, rows.map(JSON.stringify).join("\n") + "\n");
  await writeNative();
  return { ...f, product, configRoot, nativeRoot, sqliteHome, goalPath, nativePath, rows, writeNative, DatabaseSync };
}

test("native continuity keeps the exact original Codex thread/scope/completed turn with stopped native goal custody and no invented account", async t => {
  const f = await codexContinuityFixture(t);
  const before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath), goals = await readFile(f.goalPath);
  await f.run(false);
  assert.equal(await readFile(f.filePath, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await f.run(true);
  const written = await readFile(f.filePath, "utf8"), next = JSON.parse(written);
  const { conversationMetadata, ...retained } = next;
  assert.deepEqual(retained, JSON.parse(before));
  assert.equal(conversationMetadata.runtime.engine, "codex");
  assert.deepEqual(conversationMetadata.runtime.binding, { threadId: f.product.conversationId, workdir: f.scopeWorkdir, configRoot: f.configRoot,
    executionId: "", processInstanceId: "", toolSchemaIdentity: emptyCodexPolicy });
  assert.equal(conversationMetadata.runtime.binding.accountIdentity, undefined, "Original schema1 had no old native account digest to fabricate");
  assert.equal(conversationMetadata.runtime.request, undefined);
  assert.equal(conversationMetadata.runtime.configuration.integrationId, undefined);
  assert.deepEqual(await readFile(f.nativePath), native);
  assert.deepEqual(await readFile(f.goalPath), goals);
  assert.equal(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, f.filePath)), "utf8"), before);
  await f.run(true);
  assert.equal(await readFile(f.filePath, "utf8"), written);
});

const codexContinuityRefusals = [
  ["foreign native scope", f => { f.rows[0].payload.cwd = f.root; return f.writeNative(); }],
  ["foreign native provider", f => { f.rows[0].payload.model_provider = "deepseek"; return f.writeNative(); }],
  ["foreign native thread", f => { f.rows[0].payload.id = "ffffffff-0123-4567-89ab-0123456789ab"; return f.writeNative(); }],
  ["forked native history", f => { f.rows[0].payload.forked_from_id = "other"; return f.writeNative(); }],
  ["different native tool policy", f => { f.rows[0].payload.dynamic_tools = [{ name: "unowned" }]; return f.writeNative(); }],
  ["uncompleted native request", f => { f.rows.pop(); return f.writeNative(); }],
  ["wrong completed native turn", f => { f.rows.at(-1).payload.turn_id = "ffffffff-0123-4567-89ab-0123456789ab"; return f.writeNative(); }],
  ["different native final", f => { f.rows.at(-1).payload.last_agent_message = JSON.stringify({ kind: "reply", text: "Different", toolName: "", arguments: "" }); return f.writeNative(); }],
  ["newer native work", f => { f.rows.push({ type: "event_msg", payload: { type: "task_started", turn_id: "ffffffff-0123-4567-89ab-0123456789ab" } }); return f.writeNative(); }],
  ["native Undo", f => { f.rows.push({ type: "event_msg", payload: { type: "thread_rolled_back" } }); return f.writeNative(); }],
  ["partial native tail", async f => writeFile(f.nativePath, await readFile(f.nativePath, "utf8") + '{"type":')],
  ["live native goal journal", f => writeFile(`${f.goalPath}-wal`, "owned-live-native-wal")],
  ["missing native goal store", f => rm(f.goalPath)],
  ["ambiguous native rollout", async f => { await mkdir(path.join(f.configRoot, "archived_sessions")); await writeFile(path.join(f.configRoot, "archived_sessions", path.basename(f.nativePath)), await readFile(f.nativePath)); }],
  ["different native model", f => { f.rows[2].payload.model = "other"; return f.writeNative(); }],
  ["missing final turn context", f => { f.rows.splice(2, 1); return f.writeNative(); }],
  ["known final native error", f => { f.rows.at(-1).payload.error = { message: "Fixture native failure" }; return f.writeNative(); }],
  ["newer authored item in the native batch", f => { const input = JSON.parse(f.rows[3].payload.content[0].text); input.userMessages.push({ messageId: "newer", text: "Unwritten newer instruction" }); f.rows[3].payload.content[0].text = JSON.stringify(input); return f.writeNative(); }],
  ["inherited native history", f => { f.rows[0].payload.history_base = { thread_id: "other" }; return f.writeNative(); }],
  ["subagent inherited boundary", f => { f.rows[0].payload.subagent_history_start_ordinal = 0; return f.writeNative(); }],
  ["subagent source", f => { f.rows[0].payload.source = { subagent: "other" }; return f.writeNative(); }],
  ["autonomous input on an authored product reply", f => { const input = JSON.parse(f.rows[3].payload.content[0].text); input.autonomous = true; f.rows[3].payload.content[0].text = JSON.stringify(input); return f.writeNative(); }],
  ["malformed final application input", f => { const input = JSON.parse(f.rows[3].payload.content[0].text); input.userMessages = "unverified"; f.rows[3].payload.content[0].text = JSON.stringify(input); return f.writeNative(); }],
  ["malformed native tool policy", f => { f.rows[0].payload.dynamic_tools = "unknown"; return f.writeNative(); }],
  ["unknown native history mode", f => { f.rows[0].payload.history_mode = "unknown"; return f.writeNative(); }],
  ["different authored native input", f => { f.rows[3].payload.content[0].text = JSON.stringify({ userMessages: [{ messageId: "foreign", text: "Different" }] }); return f.writeNative(); }]
];
for (const status of ["active", "blocked", "usage_limited", "budget_limited"]) {
  codexContinuityRefusals.push([`unsettled native goal ${status}`, f => {
    const database = new f.DatabaseSync(f.goalPath);
    database.prepare("INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?,?,?)").run(f.product.conversationId, "abcdefab-0123-4567-89ab-0123456789ab", "Retained native goal", status, null, 0, 0, 1, 1);
    database.close();
  }]);
}
for (const [name, alter] of codexContinuityRefusals) test(`native continuity refuses original Codex ${name} before backup/publication`, async t => {
  const f = await codexContinuityFixture(t);
  await alter(f);
  const before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath);
  await assert.rejects(f.run(false));
  await assert.rejects(f.run(true));
  assert.equal(await readFile(f.filePath, "utf8"), before);
  assert.deepEqual(await readFile(f.nativePath), native);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});


test("native continuity preserves original external Codex provider history HOME separately from the shared app binding HOME", async t => {
  const f = await codexContinuityFixture(t, { providerId: "deepseek" });
  const before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath);
  assert.notEqual(f.nativeRoot, f.configRoot);
  await f.run(true);
  const next = JSON.parse(await readFile(f.filePath, "utf8"));
  const { conversationMetadata, ...retained } = next;
  assert.deepEqual(retained, JSON.parse(before));
  assert.equal(conversationMetadata.runtime.binding.threadId, f.product.conversationId);
  assert.equal(conversationMetadata.runtime.binding.configRoot, f.configRoot, "Retain the current original host's app binding fence");
  assert.equal(conversationMetadata.runtime.configuration.integrationId, "deepseek");
  assert.equal(conversationMetadata.runtime.binding.accountIdentity, undefined);
  assert.deepEqual(await readFile(f.nativePath), native, "Provider-native history remains in its exact original HOME");
});

for (const status of ["paused", "complete"]) test(`native continuity preserves an original Codex ${status} native goal without changing it`, async t => {
  const f = await codexContinuityFixture(t);
  const database = new f.DatabaseSync(f.goalPath);
  database.prepare("INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?,?,?)").run(f.product.conversationId,
    "abcdefab-0123-4567-89ab-0123456789ab", "Retained native goal", status, null, 4, 5, 1, 2);
  database.close();
  const goals = await readFile(f.goalPath);
  await f.run(true);
  assert.equal(JSON.parse(await readFile(f.filePath, "utf8")).conversationMetadata.runtime.binding.threadId, f.product.conversationId);
  assert.deepEqual(await readFile(f.goalPath), goals);
});


test("native continuity retains original Codex authored identity across completed tool continuations and existing compacted history", async t => {
  const f = await codexContinuityFixture(t);
  const olderRun = "abcdefab-0123-4567-89ab-0123456789ab";
  // The original run loop empties pending userMessages after its first response.
  // Compaction keeps the original rollout; no replacement-history reconstruction.
  f.rows[1].payload.turn_id = olderRun;
  f.rows[2].payload.turn_id = olderRun;
  f.rows[4].payload.content[0].text = JSON.stringify({ kind: "tool", toolName: "existing-read-only-tool", arguments: "{}", text: "" });
  f.rows[5].payload = { type: "task_complete", turn_id: olderRun, last_agent_message: f.rows[4].payload.content[0].text };
  f.rows.push({ type: "event_msg", payload: { type: "task_started", turn_id: f.product.runId } },
    { type: "compacted", payload: { replacement_history: [] } },
    { type: "turn_context", payload: { turn_id: f.product.runId, cwd: f.scopeWorkdir, model: f.product.assistantSelection.modelId } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: JSON.stringify({ autonomous: false, readOnly: false, userMessages: [], feedback: "The read succeeded." }) }] } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: f.product.runId, last_agent_message: JSON.stringify({ kind: "reply", text: f.product.conversationLog.at(-1).messages.find(message => message.role === "assistant").text, toolName: "", arguments: "" }) } });
  await f.writeNative();
  const native = await readFile(f.nativePath);
  await f.run(true);
  assert.equal(JSON.parse(await readFile(f.filePath, "utf8")).conversationMetadata.runtime.binding.threadId, f.product.conversationId);
  assert.deepEqual(await readFile(f.nativePath), native);
});

for (const engine of ["codex", "claude", "opencode"]) test(`native continuity retains the original ${engine} autonomous watched-update turn without treating its currentTurnId as a user reply`, async t => {
  const f = await (engine === "codex" ? codexContinuityFixture(t) : engine === "claude" ? nativeContinuityFixture(t) : openCodeContinuityFixture(t));
  const saved = JSON.parse(await readFile(f.filePath, "utf8"));
  const answer = saved.conversationLog.at(-1).messages.find(message => message.role === "assistant").text;
  saved.conversationLog.push({ turnId: "000999", messages: [
    { role: "system", text: "An update from your watched conversations." }, { role: "assistant", text: answer }
  ] });
  assert.notEqual(saved.conversationLog.at(-1).turnId, saved.retiredConversation.currentTurnId);
  const input = JSON.stringify({ autonomous: true, readOnly: true, observations: [{ id: "original-watched-update" }], userMessages: [] });
  if (engine === "codex") {
    f.rows[3].payload.content[0].text = input;
    await f.writeNative();
  } else if (engine === "claude") {
    const frames = (await readFile(f.nativePath, "utf8")).trim().split("\n").map(JSON.parse);
    frames.find(frame => frame.type === "user" && frame.uuid === f.receipt.lastMessageId).message.content = input;
    await writeFile(f.nativePath, frames.map(JSON.stringify).join("\n") + "\n");
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(f.databasePath);
    database.prepare("UPDATE part SET data = ? WHERE id = ?").run(JSON.stringify({ type: "text", text: openCodeDetachedPrompt({ prompt: input, outputSchema: originalOpenCodeSchema }) }), "prt_original_input");
    database.close();
  }
  await writeFile(f.filePath, JSON.stringify(saved));
  const before = await readFile(f.filePath, "utf8");
  await f.run(true);
  const next = JSON.parse(await readFile(f.filePath, "utf8"));
  const { conversationMetadata, ...retained } = next;
  assert.deepEqual(retained, JSON.parse(before));
  assert.equal(conversationMetadata.runtime.engine, engine);
  assert.equal(conversationMetadata.runtime.request, undefined);
});


for (const carrier of ["StructuredOutput", "successful structured result"]) test(`native Claude continuity qualifies ${carrier} only with its original completed scoped receipt and exact canonical reply`, async t => {
  const f = await nativeContinuityFixture(t);
  const frames = (await readFile(f.nativePath, "utf8")).trim().split("\n").map(JSON.parse);
  const frame = frames.find(frame => frame.uuid === `${f.receipt.lastMessageId}-answer`);
  const envelope = JSON.parse(frame.message.content[0].text);
  if (carrier === "StructuredOutput") frame.message.content = [{ type: "tool_use", id: "original_structured_output", name: "StructuredOutput", input: envelope }];
  else {
    frames.splice(frames.indexOf(frame), 1);
    frames.push({ type: "result", subtype: "success", is_error: false, uuid: "original_successful_result", structured_output: envelope });
  }
  await writeFile(f.nativePath, frames.map(JSON.stringify).join("\n") + "\n");
  const before = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath);
  await f.run(true);
  const { conversationMetadata, ...retained } = JSON.parse(await readFile(f.filePath, "utf8"));
  assert.deepEqual(retained, JSON.parse(before));
  assert.equal(conversationMetadata.runtime.binding.conversationId, f.product.conversationId);
  assert.deepEqual(await readFile(f.nativePath), native);
});

for (const conflict of ["competing StructuredOutput", "recorded terminal failure"]) test(`native Claude continuity refuses ${conflict} despite an old completed receipt`, async t => {
  const f = await nativeContinuityFixture(t);
  const frames = (await readFile(f.nativePath, "utf8")).trim().split("\n").map(JSON.parse);
  if (conflict === "competing StructuredOutput") frames.push({ type: "assistant", uuid: "competing_candidate", message: { content: [
    { type: "tool_use", id: "competing_tool_output", name: "StructuredOutput", input: { kind: "reply", text: "A competing reply", toolName: "", arguments: "" } }
  ] } });
  else frames.push({ type: "result", uuid: "recorded_failure", subtype: "error_during_execution", is_error: true, errors: ["Native failed"] });
  await writeFile(f.nativePath, frames.map(JSON.stringify).join("\n") + "\n");
  const product = await readFile(f.filePath, "utf8"), native = await readFile(f.nativePath);
  await assert.rejects(f.run(false));
  await assert.rejects(f.run(true));
  assert.equal(await readFile(f.filePath, "utf8"), product);
  assert.deepEqual(await readFile(f.nativePath), native);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
});
