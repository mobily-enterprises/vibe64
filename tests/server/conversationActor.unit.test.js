import assert from "node:assert/strict";
import test from "node:test";

import {
  codexTerminalConversationMetadata,
  conversationActorMetadata
} from "../../packages/vibe64-terminals/src/server/conversationActor.js";

test("conversation actor metadata uses the standalone profile without prompt context", async () => {
  const metadata = await conversationActorMetadata({
    actorUser: () => ({ displayName: "Ada OS", username: "ada" }),
    personalProfileStore: {
      async read() {
        return { preferredName: "Ada" };
      }
    }
  });

  assert.deepEqual(metadata, {
    actorDisplayName: "Ada",
    actorId: "ada"
  });
});

test("authenticated actor preference wins without reading the standalone profile", async () => {
  let localReads = 0;
  const metadata = await conversationActorMetadata({
    personalProfileStore: {
      async read() {
        localReads += 1;
        return { preferredName: "Wrong person" };
      }
    },
    vibe64User: {
      displayName: "Ada Account",
      preferredName: "Countess Ada",
      username: "ada"
    }
  });

  assert.equal(localReads, 0);
  assert.deepEqual(metadata, {
    actorDisplayName: "Countess Ada",
    actorId: "ada"
  });
});

test("a terminal message takes the newest user turn's actor from the transcript's tail", async () => {
  const turn = (id, metadata) => ({ turnId: id, user: { messageId: id, text: id }, ...(metadata ? { metadata } : {}) });
  const reads = [];
  const store = (tail, log) => ({
    async readConversationTail(sessionId, options) { reads.push(["tail", sessionId, options]); return tail; },
    async readConversationLog(sessionId) {
      reads.push(["log", sessionId]);
      if (!log) throw new Error("The newest user turn named its actor; the whole log must not be read.");
      return log;
    },
    async readMetadataValue() { return ""; }
  });
  const newest = await codexTerminalConversationMetadata(
    store([turn("000009", { actorId: "ada", actorDisplayName: "Ada" }), { turnId: "000010", assistant: { text: "Done" } }]), "one");
  assert.deepEqual([newest.actorId, newest.actorDisplayName, newest.engineId], ["ada", "Ada", "codex"]);
  assert.deepEqual(reads, [["tail", "one", { userLimit: 1 }]]);

  reads.length = 0;
  const earlier = await codexTerminalConversationMetadata(
    store([turn("000009")], [turn("000008", { actorId: "reviewer", actorDisplayName: "Reviewer" }), turn("000009")]), "one");
  assert.equal(earlier.actorId, "reviewer", "a newest user turn without metadata still falls back to an earlier one");
  assert.deepEqual(reads.map(([kind]) => kind), ["tail", "log"]);

  reads.length = 0;
  const none = await codexTerminalConversationMetadata(store([{ turnId: "000001", assistant: { text: "Hello" } }]), "one");
  assert.equal(none.actorId, undefined);
  assert.deepEqual(reads.map(([kind]) => kind), ["tail"], "a tail without a user turn is already the whole log");
});
