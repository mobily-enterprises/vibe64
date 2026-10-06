import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeSessionConversations } from "@local/vibe64-runtime/server/conversationStorageUpgrade";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v64-message-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const create = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects/example") });
  const store = create();
  await store.createSession({ sessionId: "test", runtimeKind: "genesis" });
  const log = store.paths("test").conversationLogRoot;
  return { store, create, log, index: path.join(log, "message-ids.json"),
    upgrade: () => upgradeSessionConversations({ systemRoot, apply: true,
      backupRoot: path.join(systemRoot, "upgrades/backups/20261002-session-conversations"), report: () => {} }) };
}

test("message receipts survive restarts without scanning historical turn directories", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 100; i++) {
    const turn = path.join(f.log, String(i).padStart(6, "0"));
    await fs.mkdir(turn, { recursive: true });
    await fs.writeFile(path.join(turn, `user.20260921T120000000Z.old-${i}.md`), "Old request\n");
  }
  await assert.rejects(f.store.conversationMessageIdExists("test", "old-1"), { code: "vibe64_conversation_upgrade_required" });
  await f.upgrade();
  assert.equal(await f.store.conversationMessageIdExists("test", "old-1"), true);
  await f.store.writeConversationUserMessage("test", { messageId: "new-request", text: "New request" });
  const restarted = f.create();
  const original = fs.readdir;
  let directoryReads = 0;
  fs.readdir = async (...args) => {
    if (String(args[0]).startsWith(f.log)) directoryReads++;
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    for (const id of ["old-1", "old-100", "new-request"]) {
      assert.equal(await restarted.conversationMessageIdExists("test", id), true);
    }
    assert.equal(await restarted.conversationMessageIdExists("test", "not-sent"), false);
    assert.equal(directoryReads, 0);
  } finally {
    fs.readdir = original;
    syncBuiltinESMExports();
  }
  assert.equal(await restarted.writeConversationUserMessage("test", { messageId: "new-request", text: "Retry" }), null);
});

test("offline conversion recovers missing or damaged legacy indexes from durable messages, including undone turns", async (t) => {
  for (const damaged of [false, true]) await t.test(damaged ? "damaged" : "missing", async t => {
    const f = await fixture(t);
    for (const [id, messageId, text] of [["000001", "first", "First"], ["000002", "accepted-before-crash", "Accepted"]]) {
      await fs.mkdir(path.join(f.log, id), { recursive: true });
      await fs.writeFile(path.join(f.log, id, `user.20260921T120000000Z.${messageId}.md`), `${text}\n`);
    }
    await fs.writeFile(path.join(f.log, "rewound.json"), '["000001"]');
    if (damaged) await fs.writeFile(f.index, "broken JSON");
    await f.upgrade();
    assert.equal(await f.store.conversationMessageIdExists("test", "first"), true);
    assert.equal(await f.create().conversationMessageIdExists("test", "accepted-before-crash"), true);
    await f.store.writeConversationUserMessage("test", { messageId: "next", text: "Next" });
    const record = JSON.parse(await fs.readFile(path.join(f.log, "transcript.json"), "utf8"));
    assert.deepEqual(new Set(record.turns.flatMap(([, turn]) => turn.messages.map(message => message.messageId))),
      new Set(["first", "accepted-before-crash", "next"]));
    assert.equal(await f.store.writeConversationUserMessage("test", { messageId: "first", text: "Retry hidden message" }), null);
  });
});

test("separate store instances serialize receipt updates and preserve duplicate protection", async (t) => {
  const f = await fixture(t);
  const other = f.create();
  await Promise.all([
    f.store.writeConversationUserMessage("test", { messageId: "one", text: "One" }),
    other.writeConversationUserMessage("test", { messageId: "two", text: "Two" })
  ]);
  assert.equal(await f.store.conversationMessageIdExists("test", "one"), true);
  assert.equal(await other.conversationMessageIdExists("test", "two"), true);
  await f.store.mutateSession("test", () => Promise.all([
    f.store.writeConversationUserMessage("test", { messageId: "nested-one", text: "Nested one" }),
    f.store.writeConversationUserMessage("test", { messageId: "nested-two", text: "Nested two" })
  ]));
  assert.equal(await other.conversationMessageIdExists("test", "nested-one"), true);
  assert.equal(await other.conversationMessageIdExists("test", "nested-two"), true);
});
