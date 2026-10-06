import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeSessionConversations, inspectConversationUndoRetirement } from "@local/vibe64-runtime/server/conversationStorageUpgrade";
import { verifyConversationStorageContract } from "@jskit-ai/assistant-core/testing/conversation-storage";
import { markHistoricalConversationRewound } from "./vibe64TestHelpers.js";

const at = "2026-10-02T09:00:00.000Z";
const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-conversation-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const projectRuntimeRoot = path.join(systemRoot, "projects", "example");
  const createStore = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot });
  const store = createStore();
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261002-session-conversations");
  return { root, systemRoot, backupRoot, store, createStore,
    upgrade: (apply = false, report = () => {}) => upgradeSessionConversations({ systemRoot, backupRoot, apply, report }) };
}

async function legacyConversation(root, text = "Original question") {
  const turn = path.join(root, "000001");
  await mkdir(turn, { recursive: true });
  await writeFile(path.join(turn, "user.20261002T090000000Z.request-one.md"), `${text}\n`);
  await writeFile(path.join(turn, "assistant.20261002T090001000Z.answer-one.md"), "Original answer\n");
  await writeFile(path.join(turn, "metadata.json"), JSON.stringify({ actorDisplayName: "Ada", actorId: "ada" }));
  await writeFile(path.join(turn, "attachments.json"), JSON.stringify([{ fileName: "notes.txt", size: 18 }]));
  return turn;
}

test("main-chat storage satisfies the shared transcript and runtime transaction contract", async t => {
  const f = await fixture(t);
  for (const sessionId of ["actor-a", "actor-b"]) await f.store.createSession({ sessionId, runtimeKind: "genesis" });
  await verifyConversationStorageContract({
    read: (scope, callback) => f.store.conversationStorage.read(scope.split(":")[0], callback),
    write: (scope, callback) => f.store.conversationStorage.write(scope.split(":")[0], callback)
  }, { runtime: true });
});

test("session runtime storage commits transcript, receipts and metadata together and rolls back a failed callback", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const storage = f.store.conversationStorage;
  await storage.write("one", async tx => {
    const id = await tx.nextTurnId();
    await tx.appendMessage(id, { role: "user", text: "Hello", messageId: "request", at,
      attachments: [{ id: "upload", name: "notes.txt" }], turnMetadata: { actorId: "ada", runtime: { status: "running" } } });
    await tx.writeMetadata({ runtime: { binding: { id: "native-1" }, receipt: "accepted" } });
    await tx.updateTurnMetadata(id, { runtime: { status: "complete" } });
    await tx.replaceAssistant(id, { role: "assistant", text: "Done", messageId: "000001:reply", at });
  });
  const inspect = async tx => ({ metadata: await tx.readMetadata(), ids: await tx.listTurnIds(), turn: await tx.readTurn("000001") });
  const before = await storage.read("one", inspect);
  assert.equal(before.turn.metadata.actorId, "ada");
  assert.deepEqual(before.turn.metadata.runtime, { status: "complete" });
  assert.deepEqual(before.turn.user.attachments, [{ id: "upload", name: "notes.txt" }]);
  assert.equal(before.turn.assistant.messageId, "000001:reply");
  await assert.rejects(storage.write("one", async tx => {
    await tx.writeMetadata({ runtime: { receipt: "uncommitted" } });
    await tx.updateTurnMetadata("000001", { actorId: "changed" });
    await tx.appendMessage(await tx.nextTurnId(), { role: "user", text: "Must not survive", messageId: "uncommitted", at });
    throw new Error("transaction rejected");
  }), /transaction rejected/);
  assert.deepEqual(await f.createStore().conversationStorage.read("one", inspect), before);
  assert.equal(await storage.read("one", tx => tx.hasMessage("uncommitted")), false);
  before.metadata.runtime.receipt = "client edit";
  assert.equal((await storage.read("one", tx => tx.readMetadata())).runtime.receipt, "accepted");
});

test("failed record publication preserves both history and native binding", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  await f.store.writeConversationUserMessage("one", { text: "Retained", messageId: "original" });
  const file = path.join(f.store.paths("one").conversationLogRoot, "transcript.json");
  const original = await readFile(file, "utf8");
  const realRename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === file) throw new Error("publication failed");
    return realRename(from, to);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.store.conversationStorage.write("one", async tx => {
      await tx.writeMetadata({ runtime: { binding: { id: "uncommitted-native" } } });
      await tx.appendMessage(await tx.nextTurnId(), { role: "user", text: "Uncommitted", at });
    }), /publication failed/);
  } finally { fs.rename = realRename; syncBuiltinESMExports(); }
  assert.equal(await readFile(file, "utf8"), original);
});

test("a missing transcript read remains a valid snapshot when its first record is published", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const file = path.join(f.store.paths("one").conversationLogRoot, "transcript.json");
  const realReadFile = fs.readFile;
  let intercepted = false;
  let saved;
  fs.readFile = async (target, ...options) => {
    if (target !== file || intercepted) return realReadFile(target, ...options);
    intercepted = true;
    try {
      return await realReadFile(target, ...options);
    } catch (error) {
      assert.equal(error.code, "ENOENT");
      saved = await f.store.writeConversationUserMessage("one", { text: "First receipt", messageId: "first-receipt" });
      throw error;
    }
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await f.store.readConversationLog("one"), []);
  } finally { fs.readFile = realReadFile; syncBuiltinESMExports(); }
  assert.equal(intercepted, true);
  const turns = await f.store.readConversationLog("one");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].turnId, saved.turnId);
  assert.equal(turns[0].user.messageId, "first-receipt");
  assert.equal(turns[0].user.text, "First receipt");
});

test("an existing empty transcript is rejected as corrupt storage", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const file = path.join(f.store.paths("one").conversationLogRoot, "transcript.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "");
  await assert.rejects(f.store.readConversationLog("one"), {
    code: "vibe64_invalid_conversation_storage",
    message: "Conversation storage is not valid JSON. Restore it before continuing."
  });
  assert.equal(await readFile(file, "utf8"), "");
});

test("independent stores serialize transactions and keep temporary conversations isolated", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const stores = [f.store, f.createStore()];
  await Promise.all(Array.from({ length: 8 }, (_, index) => stores[index % 2].conversationStorage.write("one", async tx => {
    const metadata = await tx.readMetadata();
    await tx.appendMessage(await tx.nextTurnId(), { role: "user", text: `Message ${index}`, messageId: `message-${index}`, at });
    await tx.writeMetadata({ count: (metadata.count || 0) + 1 });
  })));
  assert.equal((await f.store.conversationStorage.read("one", tx => tx.readMetadata())).count, 8);
  assert.equal((await f.store.readConversationLog("one")).length, 8);
  const scope = { sessionId: "one", conversationId: "temporary" };
  await f.store.conversationStorage.write(scope, tx => tx.writeMetadata({ runtime: { binding: "temporary-native" } }));
  await f.store.writeConversationUserMessage(scope, { text: "Temporary question" });
  assert.equal((await f.createStore().readConversationLog(scope)).length, 1);
  assert.equal((await f.store.readConversationLog("one")).length, 8);
});

test("historical rewind retains duplicate receipts and never reuses hidden turn IDs", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  await f.store.writeConversationUserMessage("one", { text: "Undone", messageId: "original" });
  await markHistoricalConversationRewound(f.store, "one", ["000001"]);
  assert.deepEqual(await f.store.readConversationLog("one"), []);
  assert.equal(await f.createStore().conversationMessageIdExists("one", "original"), true);
  assert.equal(await f.store.writeConversationUserMessage("one", { text: "Retry", messageId: "original" }), null);
  assert.equal((await f.store.writeConversationUserMessage("one", { text: "Next" })).turnId, "000002");
  await markHistoricalConversationRewound(f.store, "one", ["000002"]);
  await f.store.writeConversationUserMessage("one", { text: "Concurrent message", messageId: "concurrent" });
  const remaining = await f.createStore().readConversationLog("one");
  assert.deepEqual(remaining.map(turn => turn.turnId), ["000003"]);
  assert.equal(remaining[0].user.messageId, "concurrent");
  assert.equal(typeof f.store.rewindConversationLog, "undefined");
});

test("separate processes retain every message and runtime receipt under the session lease", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const source = `
    import { createVibe64SessionStore } from ${JSON.stringify(new URL("../../packages/vibe64-runtime/src/server/sessionStore.js", import.meta.url).href)};
    const [projectContextRoot, projectRuntimeRoot, child] = process.argv.slice(1);
    const store = createVibe64SessionStore({ projectContextRoot, projectRuntimeRoot });
    for (let index = 0; index < 3; index++) await store.conversationStorage.write("one", async tx => {
      const metadata = await tx.readMetadata();
      const messageId = child + "-" + index;
      await tx.appendMessage(await tx.nextTurnId(), { role: "user", text: messageId, messageId, at: ${JSON.stringify(at)} });
      await tx.writeMetadata({ receipts: [...(metadata.receipts || []), messageId] });
    });
  `;
  await Promise.all(["first", "second"].map(child => exec(process.execPath,
    ["--input-type=module", "-e", source, f.root, path.join(f.systemRoot, "projects/example"), child])));
  const turns = await f.store.readConversationLog("one");
  const metadata = await f.store.conversationStorage.read("one", tx => tx.readMetadata());
  assert.equal(turns.length, 6);
  assert.equal(new Set(turns.map(turn => turn.turnId)).size, 6);
  assert.deepEqual(turns.map(turn => turn.user.messageId).sort(), metadata.receipts.sort());
});

test("offline conversion covers live, closing, archived and temporary histories and preserves attachments and decisions", async t => {
  const f = await fixture(t);
  for (const sessionId of ["live", "closing", "archived"]) {
    await f.store.createSession({ sessionId, runtimeKind: "genesis" });
    await legacyConversation(f.store.paths(sessionId).conversationLogRoot, `${sessionId} question`);
  }
  const liveRoot = f.store.paths("live").conversationLogRoot;
  const decisionFile = path.join(liveRoot, "000001/integration-setup.json");
  await writeFile(decisionFile, "preserved application decision");
  await mkdir(path.join(liveRoot, "000002"));
  await writeFile(path.join(liveRoot, "000002/user.20261002T090002000Z.undone.md"), "Hidden question\n");
  await writeFile(path.join(liveRoot, "rewound.json"), '["000002"]');
  await writeFile(path.join(liveRoot, "message-ids.json"), '["request-one","answer-one","undone"]');
  await f.store.writeSessionConversation("live", "temporary", { title: "Retained chat" });
  await legacyConversation(path.join(f.store.paths("live").conversationsRoot, "temporary/conversation-log"));
  await f.store.writeStatus("archived", "archived");
  await f.store.publishSessionArchive("archived");
  const archiveRoot = f.store.paths().archivedSessionsRoot;
  const preparedRoot = path.join(archiveRoot, ".renewals/retained-renewal");
  await mkdir(preparedRoot, { recursive: true });
  for (const suffix of [".tar.gz", ".json"]) await copyFile(path.join(archiveRoot, `archived${suffix}`), path.join(preparedRoot, `archived${suffix}`));
  const closingRoot = path.join(f.store.paths().closingSessionsRoot, "closing");
  await mkdir(path.dirname(closingRoot), { recursive: true });
  await rename(f.store.paths("closing").sessionRoot, closingRoot);
  await assert.rejects(f.store.readConversationLog("live"), { code: "vibe64_conversation_upgrade_required" });
  await f.upgrade();
  await assert.rejects(readFile(path.join(liveRoot, "transcript.json")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
  await f.upgrade(true);
  const log = await f.createStore().readConversationLog("live");
  assert.equal(log.length, 1);
  assert.equal(log[0].user.text, "live question");
  assert.equal(log[0].metadata.actorId, "ada");
  assert.deepEqual(log[0].user.attachments, [{ fileName: "notes.txt", size: 18 }]);
  assert.equal(log[0].assistant.messageId, "answer-one");
  assert.equal(await f.store.conversationMessageIdExists("live", "undone"), true);
  assert.equal((await f.store.readConversationLog({ sessionId: "live", conversationId: "temporary" })).length, 1);
  assert.equal((await f.store.readConversationLog("archived"))[0].user.text, "archived question");
  const preparedArchive = path.join(preparedRoot, "archived.tar.gz");
  const members = (await exec("tar", ["-tzf", preparedArchive])).stdout.split("\n");
  const transcript = members.find(name => name.endsWith("/conversation-log/transcript.json"));
  assert.ok(transcript, "Prepared renewal archives must be upgraded as well.");
  const prepared = JSON.parse((await exec("tar", ["-xOf", preparedArchive, transcript])).stdout);
  assert.equal(prepared.turns[0][1].messages.find(message => message.role === "user").text, "archived question");
  assert.equal(JSON.parse(await readFile(path.join(closingRoot, "conversation-log/transcript.json"))).turns[0][1].messages[0].text, "Original answer");
  assert.equal(await readFile(decisionFile, "utf8"), "preserved application decision");
  const originalPath = path.join(liveRoot, "000001/user.20261002T090000000Z.request-one.md");
  assert.equal(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, originalPath)), "utf8"), "live question\n");
  await assert.rejects(readFile(originalPath), { code: "ENOENT" });
  await f.upgrade(true);
  assert.deepEqual(await f.store.readConversationLog("live"), log);
});

test("interrupted offline publication resumes prepared bytes without replacing original backups", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const root = f.store.paths("one").conversationLogRoot;
  await legacyConversation(root);
  await assert.rejects(f.upgrade(true, (_level, message) => {
    if (message.startsWith("Published state:")) throw new Error("interrupted publication");
  }), /interrupted publication/);
  const manifest = await readFile(path.join(f.backupRoot, "manifest.json"), "utf8");
  await f.upgrade();
  await f.upgrade(true);
  assert.equal(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"), manifest);
  assert.equal((await f.store.readConversationLog("one"))[0].user.text, "Original question");
  await assert.rejects(readFile(path.join(root, "000001/metadata.json")), { code: "ENOENT" });
});

test("malformed or symlinked legacy records block conversion without modifying histories", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const root = f.store.paths("one").conversationLogRoot;
  const turn = await legacyConversation(root);
  const metadata = path.join(turn, "metadata.json");
  await writeFile(metadata, "bad json");
  await assert.rejects(f.upgrade(true), /metadata is not valid JSON/);
  assert.equal(await readFile(metadata, "utf8"), "bad json");
  await rm(metadata);
  await symlink(path.join(f.root, "outside"), metadata);
  await assert.rejects(f.upgrade(true), /symbolic link/);
  await assert.rejects(readFile(path.join(root, "transcript.json")), { code: "ENOENT" });
});

test("Undo retirement preserves completed historical decisions and rejects incomplete metadata without writes", async t => {
  const f = await fixture(t);
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const file = path.join(f.store.paths("one").metadataRoot, "assistant_changeover");
  const context = { systemRoot: f.systemRoot, backupRoot: path.join(f.systemRoot, "upgrades/backups/20261003-conversation-undo-retirement"), report: () => {} };
  for (const raw of ['{"rewind":{"completed":true,"turnId":"000002"}}', '{"engines":{}}', "null"]) {
    await f.store.writeMetadataValue("one", "assistant_changeover", raw);
    const before = await readFile(file, "utf8");
    await inspectConversationUndoRetirement({ ...context, apply: false });
    await inspectConversationUndoRetirement({ ...context, apply: true });
    assert.equal(await readFile(file, "utf8"), before);
  }
  for (const raw of ['{"rewind":{"completed":false}}', '{"rewind":{}}', '{"rewind":true}', '{"rewind":{"completed":"true"}}', '[]', 'broken']) {
    await f.store.writeMetadataValue("one", "assistant_changeover", raw);
    const before = await readFile(file, "utf8");
    for (const apply of [false, true]) await assert.rejects(inspectConversationUndoRetirement({ ...context, apply }), /before upgrading/);
    assert.equal(await readFile(file, "utf8"), before);
  }
  await assert.rejects(readFile(path.join(context.backupRoot, "manifest.json")), { code: "ENOENT" });
});

test("Undo retirement checks temporary, closing, archived and prepared renewal conversations", async t => {
  for (const kind of ["temporary", "closing", "archived", "prepared"]) await t.test(kind, async t => {
    const f = await fixture(t);
    await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
    const pending = JSON.stringify({ rewind: { completed: false, turnId: "000002" } });
    if (kind === "temporary") {
      await f.store.writeSessionConversation("one", "temporary", { routingMetadata: { assistant_changeover: pending } });
    } else await f.store.writeMetadataValue("one", "assistant_changeover", pending);
    let original;
    let savedFile;
    if (kind === "closing") {
      const closing = path.join(f.store.paths().closingSessionsRoot, "one");
      await mkdir(path.dirname(closing), { recursive: true });
      await rename(f.store.paths("one").sessionRoot, closing);
      savedFile = path.join(closing, "metadata/assistant_changeover");
    } else if (kind === "archived" || kind === "prepared") {
      await f.store.writeStatus("one", "archived");
      await f.store.publishSessionArchive("one");
      const archives = f.store.paths().archivedSessionsRoot;
      savedFile = path.join(archives, "one.tar.gz");
      if (kind === "prepared") {
        const prepared = path.join(archives, ".renewals/retained");
        await mkdir(prepared, { recursive: true });
        for (const suffix of [".tar.gz", ".json"]) await rename(path.join(archives, `one${suffix}`), path.join(prepared, `one${suffix}`));
        savedFile = path.join(prepared, "one.tar.gz");
      }
    } else savedFile = path.join(f.store.paths("one").conversationsRoot, "temporary/conversation.json");
    original = await readFile(savedFile);
    await assert.rejects(inspectConversationUndoRetirement({ systemRoot: f.systemRoot,
      backupRoot: f.backupRoot, apply: true, report: () => {} }), /unfinished conversation Undo.*previous release/);
    assert.deepEqual(await readFile(savedFile), original);
    await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
  });
});
