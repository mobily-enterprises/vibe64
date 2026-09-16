import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { createSessionConversations } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { createSessionAttachments } from "../../packages/vibe64-terminals/src/server/sessionAttachments.js";
import { projectRuntimeRoot, sourceMetadata, withTemporaryRoot } from "./vibe64TestHelpers.js";

import {
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_DELETE_AGENT_ATTACHMENT,
  ACTION_DELETE_TEMPORARY_CONVERSATION,
  ACTION_READ_TEMPORARY_CONVERSATION,
  ACTION_START_TEMPORARY_CONVERSATION_TURN,
  ACTION_STOP_TEMPORARY_CONVERSATION,
  createTerminalActions
} from "../../packages/vibe64-terminals/src/server/actions.js";

function actionById(actions, id) {
  const action = actions.find((entry) => entry.id === id);
  assert.ok(action, `Missing action ${id}`);
  return action;
}

test("temporary conversation actions use durable conversation ownership", async () => {
  const calls = [];
  const terminals = {
    async createTemporaryConversation(...args) {
      calls.push(["create", ...args]);
      return { conversationId: "temporary-1", ok: true };
    },
    async deleteTemporaryConversation(...args) {
      calls.push(["delete", ...args]);
      return { ok: true };
    },
    async readTemporaryConversation(...args) {
      calls.push(["read", ...args]);
      return { ok: true };
    },
    async startTemporaryConversationTurn(...args) {
      calls.push(["start", ...args]);
      return { ok: true };
    },
    async stopTemporaryConversation(...args) {
      calls.push(["stop", ...args]);
      return { ok: true };
    }
  };
  const actions = createTerminalActions({ terminals });

  await actionById(actions, ACTION_CREATE_TEMPORARY_CONVERSATION).execute({
    agentSettings: { model: "gpt-test" },
    sessionId: "session-1"
  });
  await actionById(actions, ACTION_READ_TEMPORARY_CONVERSATION).execute({
    conversationId: "temporary-1",
    sessionId: "session-1"
  });
  await actionById(actions, ACTION_START_TEMPORARY_CONVERSATION_TURN).execute({
    conversationId: "temporary-1",
    message: "Resolve the conflict.",
    sessionId: "session-1"
  });
  await actionById(actions, ACTION_STOP_TEMPORARY_CONVERSATION).execute({
    conversationId: "temporary-1",
    runId: "turn-1",
    sessionId: "session-1"
  });
  await actionById(actions, ACTION_DELETE_TEMPORARY_CONVERSATION).execute({
    conversationId: "temporary-1",
    sessionId: "session-1"
  });

  assert.equal(calls[0][0], "create");
  assert.equal(calls[0][1], "session-1");
  assert.deepEqual(calls[0][2], {
    agentSettings: { model: "gpt-test" },
    sessionId: "session-1"
  });
  assert.deepEqual(calls.slice(1).map((entry) => entry[0]), ["read", "start", "stop", "delete"]);
  for (const call of calls.slice(1)) {
    assert.equal(call[2].ephemeral, undefined);
  }
});

test("one attachment cleanup action targets only its exact attachment", async () => {
  const calls = [];
  const actions = createTerminalActions({
    terminals: {
      async deleteAgentAttachment(...args) {
        calls.push(args);
        return { ok: true };
      }
    }
  });

  await actionById(actions, ACTION_DELETE_AGENT_ATTACHMENT).execute({
    attachmentId: "attachment-1",
    sessionId: "session-1"
  });
  assert.deepEqual(calls, [["session-1", {
    attachmentId: "attachment-1",
    sessionId: "session-1"
  }]]);
});

async function conversationFixture(root) {
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root) });
  await store.createSession({ runtimeKind: "genesis", sessionId: "one", metadata: sourceMetadata(root, "one") });
  const runtime = { store, getSession: (id) => store.readSession(id) };
  const projectService = { createRuntime: async () => runtime };
  const attachments = createSessionAttachments({ projectService, env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "uploads") } });
  const native = { messages: [], status: "ready", runId: "", admitted: false, starts: 0, deletes: 0, stopError: "", deleteError: "" };
  const sessionAgent = {
    async requireAssistantAccess() {},
    async createConversation(_id, input) {
      assert.equal(input.persistent, true);
      assert.notEqual(input.ephemeral, true);
      return { ok: true, conversationId: "native" };
    },
    async readConversation() { return { ok: true, ...native }; },
    async startConversationTurn(_id, input, options) {
      assert.equal(input.conversationId, "native");
      assert.equal(input.persistent, true);
      assert.equal(options.attachmentsPrepared, true);
      native.starts += 1;
      native.admitted = true;
      native.runId = `turn-${native.starts}`;
      native.status = "inProgress";
      return { ok: true, runId: native.runId, status: native.status };
    },
    async stopConversation() {
      if (native.stopError) throw new Error(native.stopError);
      native.status = "interrupted";
      return { ok: true };
    },
    async deleteConversation() {
      if (native.deleteError) throw new Error(native.deleteError);
      native.deletes += 1;
      return { ok: true };
    }
  };
  const events = [];
  const restart = (overrides = {}) => createSessionConversations({
    sessionAgent,
    attachments,
    prepareAgentSkills: async () => {},
    runAgentWrite: async (sessionId, _options, operation, lockOptions) => {
      const result = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
        const session = await runtime.getSession(sessionId);
        return operation({ runtime, session });
      }, lockOptions);
      return result.value;
    },
    publishSessionChanged: async (...args) => { events.push(args); },
    ...overrides
  });
  return { attachments, events, native, restart, service: restart(), store };
}

test("a temporary draft waits for another assistant operation and saves once the lock is released", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holding = store.runSessionExclusive("one", "agent-write-mode", async () => {
      entered.resolve();
      await release.promise;
    }, { operation: "prepare-agent-session" });
    await entered.promise;
    const saving = service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Ideas?" } });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      release.resolve();
      await holding;
    }
    assert.equal((await saving).ok, true);
    assert.equal((await store.readSessionConversation("one", "chat")).draft, "Ideas?");
  });
});

test("Close publishes its exact conversation after deletion, including retries, without recreating it on publication failure", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, store, restart, events } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    const failingPublisher = restart({ publishSessionChanged: async () => {
      assert.equal(await store.readSessionConversation("one", "chat"), null);
      throw new Error("Realtime unavailable");
    } });
    await assert.rejects(failingPublisher.deleteTemporaryConversation("one", { conversationId: "chat" }), /Realtime unavailable/);
    assert.equal(await store.readSessionConversation("one", "chat"), null);
    await service.deleteTemporaryConversation("one", { conversationId: "chat" });
    assert.deepEqual(events, [["one", { reason: "temporary-conversation-closed", payload: { conversationId: "chat" } }]]);
    await assert.rejects(service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Late save" } }), { code: "vibe64_conversation_closed" });
    assert.equal(await store.readSessionConversation("one", "chat"), null);
  });
});

test("temporary conversations survive a new service, stream and reconcile without entering main History", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, restart, store, native } = await conversationFixture(root);
    await store.writeConversationUserMessage("one", { text: "Main question", messageId: "main" });
    const main = await store.readConversationLog("one");
    const created = await service.createTemporaryConversation("one", {
      conversationId: "chat", presentation: { title: "Investigate", draft: "Edit this file" }, agentSettings: { model: "chosen" }
    });
    assert.equal(created.conversationId, "chat");
    await service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "input", message: "hidden context", displayMessage: "Edit this file" });
    native.messages = [{ id: "answer", role: "assistant", text: "Editing", complete: false }];
    const restored = (await restart().listTemporaryConversations("one")).conversations[0];
    assert.equal(restored.title, "Investigate");
    assert.equal(restored.status, "inProgress");
    assert.equal(restored.agentSettings.model, "chosen");
    assert.deepEqual(restored.messages.map((message) => message.text), ["Edit this file", "Editing"]);
    native.messages[0] = { id: "answer", role: "assistant", text: "Edited.", complete: true };
    native.status = "completed";
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await restart().readTemporaryConversation("one", { conversationId: "chat" });
      assert.deepEqual(reply.messages.map((message) => message.text), ["Edit this file", "Edited."]);
    }
    await restart().startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "input", message: "hidden context" });
    assert.equal(native.starts, 1, "an admitted retry must not start another turn");
    await service.updateTemporaryConversation("one", { conversationId: "chat", presentation: {
      recoveryOutcome: "succeeded", recoveryOutcomeMessage: "Update verified."
    } });
    const verified = (await restart().listTemporaryConversations("one")).conversations[0];
    assert.equal(verified.messages.at(-1).id, "recovery_turn-1");
    assert.equal(verified.messages.at(-1).text, "Update verified.");
    assert.deepEqual(await store.readConversationLog("one"), main);
  });
});

test("Close retains a retryable record until stop, native deletion and attachment cleanup succeed; edits remain", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, restart, store, native, attachments, events } = await conversationFixture(root);
    const edit = path.join(root, "user-edit.txt");
    await writeFile(edit, "preserve me");
    const upload = await attachments.uploadAttachment({ sessionId: "one" }, { fileName: "notes.txt", stream: Readable.from(["notes"]) });
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "input", message: "Use this", attachmentIds: [upload.attachmentId] });
    const saved = await attachments.readAttachment({ sessionId: "one" }, upload.attachmentId);
    const filePath = saved.attachment.path;
    await saved.fileHandle.close();
    native.stopError = "Stop not confirmed";
    await assert.rejects(service.deleteTemporaryConversation("one", { conversationId: "chat" }), /Stop not confirmed/);
    assert.equal(native.deletes, 0);
    const closing = (await restart().listTemporaryConversations("one")).conversations[0];
    assert.equal(closing.status, "closing");
    await assert.rejects(service.startTemporaryConversationTurn("one", { conversationId: "chat", message: "No" }), /closing/);
    native.stopError = "";
    native.deleteError = "Delete unavailable";
    await assert.rejects(restart().deleteTemporaryConversation("one", { conversationId: "chat" }), /Delete unavailable/);
    assert.deepEqual(events, []);
    await access(filePath);
    native.deleteError = "";
    await restart().deleteTemporaryConversation("one", { conversationId: "chat" });
    await restart().deleteTemporaryConversation("one", { conversationId: "chat" });
    assert.equal(native.deletes, 1);
    assert.deepEqual((await restart().listTemporaryConversations("one")).conversations, []);
    await assert.rejects(access(filePath), { code: "ENOENT" });
    assert.equal(await readFile(edit, "utf8"), "preserve me");
    assert.deepEqual(await store.readConversationLog("one"), []);
  });
});

test("saved temporary draft attachments survive restart and cannot take ownership of main attachments", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, restart, attachments } = await conversationFixture(root);
    const upload = await attachments.uploadAttachment({ sessionId: "one" }, { fileName: "draft.txt", stream: Readable.from(["draft file"]) });
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Review [File #1]" }, attachmentIds: [upload.attachmentId] });
    const restored = (await restart().listTemporaryConversations("one")).conversations[0];
    assert.equal(restored.draft, "Review [File #1]");
    assert.equal(restored.attachments[0].attachmentId, upload.attachmentId);
    await assert.rejects(attachments.prepareMessage({ sessionId: "one" }, { message: "Main", attachmentIds: [upload.attachmentId] }), /another conversation/);
    const mainUpload = await attachments.uploadAttachment({ sessionId: "one" }, { fileName: "main.txt", stream: Readable.from(["main file"]) });
    await attachments.prepareMessage({ sessionId: "one" }, { message: "Main", attachmentIds: [mainUpload.attachmentId] });
    await assert.rejects(service.updateTemporaryConversation("one", { conversationId: "chat", attachmentIds: [mainUpload.attachmentId] }), /another conversation/);
    await service.deleteTemporaryConversation("one", { conversationId: "chat" });
    const main = await attachments.readAttachment({ sessionId: "one" }, mainUpload.attachmentId);
    assert.equal(await main.fileHandle.readFile("utf8"), "main file");
    await main.fileHandle.close();
  });
});
