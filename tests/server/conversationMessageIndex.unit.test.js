import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v64-message-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const create = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  const store = create();
  await store.createSession({ sessionId: "test", runtimeKind: "genesis" });
  const log = store.paths("test").conversationLogRoot;
  return { store, create, log, index: path.join(log, "message-ids.json") };
}

test("message receipts survive restarts without scanning historical turn directories", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 100; i++) {
    const turn = path.join(f.log, String(i).padStart(6, "0"));
    await fs.mkdir(turn, { recursive: true });
    await fs.writeFile(path.join(turn, `user.20260921T120000000Z.old-${i}.md`), "Old request\n");
  }
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

test("interrupted and damaged indexes rebuild from durable messages, including undone turns", async (t) => {
  const f = await fixture(t);
  const turn = await f.store.writeConversationUserMessage("test", { messageId: "first", text: "First" });
  await f.store.rewindConversationLog("test", [turn.turnId]);
  assert.equal(await f.store.conversationMessageIdExists("test", "first"), true);
  await fs.rm(f.index);
  const interruptedTurn = path.join(f.log, "000002");
  await fs.mkdir(interruptedTurn, { recursive: true });
  await fs.writeFile(path.join(interruptedTurn, "user.20260921T120000000Z.accepted-before-crash.md"), "Accepted\n");
  assert.equal(await f.create().conversationMessageIdExists("test", "accepted-before-crash"), true);
  await fs.writeFile(f.index, "broken JSON");
  await f.store.writeConversationUserMessage("test", { messageId: "next", text: "Next" });
  assert.deepEqual(new Set(JSON.parse(await fs.readFile(f.index, "utf8"))), new Set(["first", "accepted-before-crash", "next"]));
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
