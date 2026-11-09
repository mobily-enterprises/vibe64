import assert from "node:assert/strict";
import test from "node:test";

import { createConversationStorage, createConversationTranscript } from "@jskit-ai/assistant-core/server/conversation";

import { createAssignmentOperations } from "../../packages/vibe64-colleague/src/server/assignments.js";

// An assignment request is the person's message found by its ID: in the
// current Colleague conversation, then in earlier ones only when it is not
// there, never by reading every kept conversation in full.
const at = "2026-11-09T09:00:00.000Z";
const userTurn = (messageId, text) => ({ messages: [{ role: "user", messageId, text, at }] });
const conversations = {
  now: new Map([
    ["000001", userTurn("now-1", "Fix the login page.")],
    ["000002", { messages: [{ role: "assistant", messageId: "000001:reply", text: "On it.", at }] }],
    ["000003", userTurn("now-2", "Also check the signup page.")]
  ]),
  before: new Map([["000001", userTurn("before-1", "Start the reports work.")]])
};

function fixture() {
  const reads = [];
  const storage = createConversationStorage({
    async readRecord(key) {
      reads.push(key);
      return { metadata: {}, turns: new Map(conversations[key]) };
    },
    async writeRecord() { assert.fail("Finding a request writes nothing."); }
  });
  const transcript = {
    ...createConversationTranscript({ storage }),
    async readConversationLog() { throw new Error("A whole Colleague conversation was read."); }
  };
  const operations = createAssignmentOperations({ actions: {}, persist: async () => {}, transcript });
  const assignment = (requestMessageId) => ({
    assignmentId: `for-${requestMessageId}`, requestMessageId, request: "", criteria: "Done when it works.", projectSlug: "notes",
    sessionId: "session-1", conversationId: "", turnLimit: 8, status: "active", summary: "", turns: [], amendments: []
  });
  const state = { record: { runtimeId: "now", previousConversations: [{ runtimeId: "before" }],
    assignments: ["now-2", "before-1"].map(assignment) } };
  const create = (userMessageIds, requestMessageId) => operations.create(state, {
    assignmentId: `for-${requestMessageId}`, requestMessageId, projectSlug: "notes", sessionId: "session-1"
  }, { colleague: { userMessageIds } });
  return { create, reads };
}

test("an assignment request is found by its message ID in the current conversation first", async () => {
  const f = fixture();
  assert.equal((await f.create(["now-2"], "now-2")).assignment.requestMessageId, "now-2");
  assert.deepEqual(f.reads, ["now"], "an earlier conversation is not read once every ID is found");

  f.reads.length = 0;
  assert.equal((await f.create(["before-1"], "before-1")).assignment.requestMessageId, "before-1");
  assert.ok(f.reads.includes("before"), "an ID not in the current conversation is looked up in earlier ones");

  await assert.rejects(f.create(["now-1"], "before-1"), { code: "vibe64_colleague_assignment_request_missing" });
  await assert.rejects(f.create(["000001:reply"], "000001:reply"), { code: "vibe64_colleague_assignment_request_missing" },
    "only a person's message can be the request");
});
