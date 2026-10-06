import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upgradeColleagueConversations } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";

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
