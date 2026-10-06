import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";

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
