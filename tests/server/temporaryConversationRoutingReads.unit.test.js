import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

import { createTemporaryConversationTurns } from "../../packages/vibe64-terminals/src/server/temporaryConversationTurns.js";

// A temporary chat's routing reads one turn through the transcript's message
// index and the tail it asks for, never the chat's whole log.
test("a temporary chat's routing reads turns by message and its tail by the asked user limit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-temporary-routing-reads-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  await store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  await store.writeSessionConversation("one", "chat", { state: "open" });
  const scope = { sessionId: "one", conversationId: "chat" };
  for (let number = 1; number <= 15; number += 1) {
    await store.writeConversationUserMessage(scope, { messageId: `m${number}`, text: `Question ${number}` });
  }
  const guarded = { ...store, async readConversationLog() { throw new Error("Routing read the chat's whole transcript."); } };
  const record = { conversationId: "chat", state: "open", routingMetadata: {}, recentChatContext: null };
  const admissions = [];
  const turns = createTemporaryConversationTurns({
    chatRecords: {
      recordFor: async () => record,
      selectedContext: () => ({ session: { metadata: {} } }),
      bindingKey: () => "codex"
    },
    sessionAgent: {},
    conversationRuntime: {
      async inspectPersistentConversationAdmission({ input }) {
        admissions.push(input.messageId);
        return { admission: "accepted" };
      }
    },
    attachments: {},
    runAgentWrite: async () => assert.fail("Reads need no session write."),
    routingWaitMs: 0,
    readSessionContext: async () => assert.fail("The context is given."),
    prepareAgentSkills: async () => {},
    systemRoot: path.join(root, "system"),
    prepareSelection: async () => {},
    publishSessionChanged: async () => {},
    temporarySaveDelayMs: 10,
    logger: silentLogger,
    conversationTurns: {}
  });
  const context = await turns.routingContext({ session: { sessionId: "one", metadata: {} }, runtime: { store: guarded } }, "chat");

  const tail = await context.runtime.store.readConversationTail("one", { userLimit: 2 });
  assert.deepEqual(tail.map((turn) => turn.user.messageId), ["m14", "m15"]);
  assert.deepEqual((await context.runtime.store.readConversationTail("one", { userLimit: 1 })).map((turn) => turn.user.messageId), ["m15"]);

  // A message saved without routing has no receipt: its admission is asked.
  assert.equal(await context.runtime.store.conversationMessageIdExists("one", "m3"), true);
  assert.deepEqual(admissions, ["m3"]);
  assert.equal(await context.runtime.store.conversationMessageIdExists("one", "unknown"), false);
  assert.deepEqual(admissions, ["m3"]);
});
