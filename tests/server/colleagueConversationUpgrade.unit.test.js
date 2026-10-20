import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upgradeColleagueConversations, upgradeColleagueConversationHistory, retireColleagueLearningWatches } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "colleague-upgrade-"));
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
    run: apply => upgradeColleagueConversations({ systemRoot, backupRoot, apply, report: (level, message) => reports.push({ level, message }) })
  };
}

const original = {
  schemaVersion: 1, scopeId: "colleague_test", assistantSelection: { engineId: "codex", modelId: "test" },
  status: "working", error: "", conversationId: "native-thread", runId: "native-turn", currentTurnId: "turn-1",
  conversationLog: [{ turnId: "turn-1", metadata: { application: "retained" }, messages: [
    { messageId: "request-1", role: "user", text: "Keep this history." },
    { messageId: "reply-1", role: "assistant", text: "Retained reply." }
  ] }],
  operation: { id: "operation-1", status: "executing", toolName: "example", arguments: '{"input":"retained"}' },
  watches: [{ watchId: "watch-1", status: "pending" }], observations: [{ id: "observation-1" }],
  assignments: [{ assignmentId: "assignment-1", status: "waiting", turns: [] }], extra: { retained: true }
};

test("preflight is read-only for new and existing Colleague installations", async t => {
  const f = await fixture(t);
  await f.run(false);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  await f.run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  assert.ok(f.reports.some(report => report.level === "warning" && /Stop all services/.test(report.message)));
});

test("upgrade backs up exact history, retires native identity and preserves uncertain effects and product data", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  const nativeHistory = path.join(path.dirname(file), "native-history.jsonl");
  await writeFile(nativeHistory, "native history must be untouched\n");
  await f.run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.equal(next.schemaVersion, 2);
  assert.deepEqual(next.conversationLog, original.conversationLog);
  for (const name of ["watches", "observations", "assignments", "assistantSelection", "extra"]) assert.deepEqual(next[name], original[name]);
  assert.equal(next.status, "interrupted");
  assert.match(next.error, /nothing was repeated/);
  assert.equal(next.conversationId, undefined);
  assert.equal(next.operation, undefined);
  assert.deepEqual(next.retiredConversation, { conversationId: "native-thread", runId: "native-turn", currentTurnId: "turn-1",
    assistantSelection: original.assistantSelection, operation: { ...original.operation, status: "unknown" } });
  assert.equal(next.conversationMetadata, undefined, "The upgrade does not invent or open a JSKIT native binding");
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  assert.equal(await readFile(backup, "utf8"), before);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await readFile(nativeHistory, "utf8"), "native history must be untouched\n");
  const written = await readFile(file, "utf8");
  await f.run(true);
  assert.equal(await readFile(file, "utf8"), written, "A retry after publication does not rewrite current state");
  assert.equal(await readFile(backup, "utf8"), before);
});

test("an interrupted backup can be reused but conflicting backup contents cannot be overwritten", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", { ...original, status: "ready", operation: null });
  const before = await readFile(file, "utf8");
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "conflicting original");
  await assert.rejects(f.run(true), /differs from its upgrade backup/);
  assert.equal(await readFile(file, "utf8"), before);
  await writeFile(backup, before);
  await f.run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.equal(next.status, "ready");
  assert.equal(next.retiredConversation.operation, undefined);
});

test("all histories are validated before any backup or publication", async t => {
  const f = await fixture(t);
  const file = await f.write("first", original);
  const before = await readFile(file, "utf8");
  const invalid = await f.write("second", "invalid JSON");
  await assert.rejects(f.run(true), /invalid JSON/);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await writeFile(invalid, JSON.stringify({ ...original, conversationMetadata: { runtime: {} } }));
  await assert.rejects(f.run(true), /conflicting runtime state/);
  await writeFile(invalid, JSON.stringify({ ...original, schemaVersion: 99 }));
  await assert.rejects(f.run(true), /unsupported shape/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("symlinked histories are refused without modifying their target", async t => {
  const f = await fixture(t);
  const target = path.join(f.root, "outside.json");
  await writeFile(target, JSON.stringify(original));
  const file = await f.write("owner", original);
  await rm(file);
  await symlink(target, file);
  await assert.rejects(f.run(true), /regular file/);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), original);
});


test("fresh-conversation upgrade preserves exact current identity with read-only preflight, backup and retry", async t => {
  const f = await fixture(t);
  const current = { ...original, schemaVersion: 2, status: "ready", retiredConversation: { operation: { status: "unknown", id: "retained-operation" } } };
  const file = await f.write("owner", current);
  const before = await readFile(file, "utf8");
  const run = apply => upgradeColleagueConversationHistory({ ...f, apply, report: (level, message) => f.reports.push({ level, message }) });
  await run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(next, { ...current, schemaVersion: 3, runtimeId: "owner", previousConversations: [] });
  assert.equal(await readFile(path.join(f.backupRoot, "owner", "conversation.json"), "utf8"), before);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const bytes = await readFile(file, "utf8");
  await run(true);
  assert.equal(await readFile(file, "utf8"), bytes);
  await f.run(true);
  assert.equal(await readFile(file, "utf8"), bytes, "Earlier published delegate recognizes validated format 3 without rewriting it");
});

test("fresh-conversation preflight accepts pending earlier conversion and refuses conflicting identities before backup", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  const run = apply => upgradeColleagueConversationHistory({ ...f, apply, report: () => {} });
  await run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(run(true), /earlier Colleague conversation upgrade/);
  await writeFile(file, JSON.stringify({ ...original, schemaVersion: 2, runtimeId: "unexpected" }));
  await assert.rejects(run(true), /conflicting fresh-chat/);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  const valid = { ...original, schemaVersion: 2 };
  await writeFile(file, JSON.stringify(valid));
  const invalid = await f.write("other", { ...valid, schemaVersion: 3, runtimeId: "owner", previousConversations: [] });
  await assert.rejects(run(true), /unsupported shape/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), valid);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await rm(invalid);
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "different original");
  await assert.rejects(run(true), /differs from its fresh-conversation upgrade backup/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), valid);
  await writeFile(backup, JSON.stringify(valid));
  await run(true);
  assert.equal(JSON.parse(await readFile(file, "utf8")).runtimeId, "owner");
});

test("learning-task watch retirement keeps history and other watches with read-only check, backup and retry", async t => {
  const f = await fixture(t);
  const backupRoot = path.join(f.systemRoot, "upgrades/backups/20261021-practice-sessions-ordinary/colleague");
  const run = apply => retireColleagueLearningWatches({ systemRoot: f.systemRoot, backupRoot, apply,
    report: (level, message) => f.reports.push({ level, message }) });
  await run(true);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" }, "a new installation has nothing to retire");
  const record = { schemaVersion: 3, scopeId: "colleague_42", runtimeId: "42", previousConversations: [],
    conversationLog: [{ turnId: "turn-1", messages: [{ role: "user", text: "Keep this history." }] }],
    watches: [{ watchId: "learning-1", source: "learning-task", status: "active", learningTask: { attemptId: "attempt-1" } },
      { watchId: "workspace-1", source: "workspace-repair", status: "paused" }],
    observations: [{ id: "observation-1", watchId: "learning-1" }, { id: "observation-2", watchId: "workspace-1" }] };
  const file = await f.write("42", record);
  const untouched = await f.write("43", { ...record, scopeId: "colleague_43", runtimeId: "43", watches: [record.watches[1]],
    observations: [record.observations[1]] });
  const before = await readFile(file, "utf8");
  const other = await readFile(untouched, "utf8");
  await run(false);
  assert.equal(await readFile(file, "utf8"), before, "check writes nothing");
  await assert.rejects(stat(backupRoot), { code: "ENOENT" });
  await run(true);
  const upgraded = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(upgraded.watches, [record.watches[1]]);
  assert.deepEqual(upgraded.observations, [record.observations[1]]);
  assert.deepEqual(upgraded.conversationLog, record.conversationLog);
  assert.equal(await readFile(untouched, "utf8"), other);
  assert.equal(await readFile(path.join(backupRoot, "before/colleague/42/conversation.json"), "utf8"), before);
  const manifest = await readFile(path.join(backupRoot, "manifest.json"), "utf8");
  await run(true);
  assert.equal(await readFile(path.join(backupRoot, "manifest.json"), "utf8"), manifest, "retry resumes the same backup");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), upgraded);
  await f.write("44", "{not json");
  await assert.rejects(retireColleagueLearningWatches({ systemRoot: f.systemRoot, apply: false, report() {},
    backupRoot: path.join(f.systemRoot, "upgrades/backups/other") }), /Colleague conversation state is invalid/u);
});
