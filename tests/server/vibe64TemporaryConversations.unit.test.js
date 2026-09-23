import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveVibe64AssistantSelection, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { createSessionConversations } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
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

async function conversationFixture(root, engineId = "codex") {
  const selection = { engineId, modelProviderId: engineId === "opencode" ? "deepseek" : "openai",
    agentId: engineId === "opencode" ? "build" : "codex", modelId: "main-model", variantId: "high",
    catalogRevision: `sha256:${"a".repeat(64)}` };
  const capabilities = {
    engineId, transportId: engineId, revision: `sha256:${"b".repeat(64)}`, defaults: selection,
    agents: [{ id: selection.agentId, mode: "primary" }],
    modelProviders: [{ id: selection.modelProviderId, connected: true, models: [
      ...["main-model", "chosen", "gpt-6-astra", "deepseek-reasoner"].map(id => ({
        id, status: "available", variants: [{ id: "high" }, { id: "ultra" }]
      })),
      { id: "disabled-model", status: "unavailable", variants: [] }
    ] }]
  };
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root) });
  await store.createSession({ runtimeKind: "genesis", sessionId: "one", metadata: {
    ...sourceMetadata(root, "one"), assistant_selection: serializeVibe64AssistantSelection(selection)
  } });
  const runtime = { store, getSession: (id) => store.readSession(id) };
  const projectService = { createRuntime: async () => runtime };
  const attachments = createSessionAttachments({ projectService, env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "uploads") } });
  const native = { messages: [], status: "ready", runId: "", admitted: false, starts: 0, deletes: 0, stopError: "", deleteError: "" };
  const sessionAgent = {
    async requireAssistantAccess() {},
    async resolveSelection(input) { return resolveVibe64AssistantSelection(capabilities, input); },
    async createConversation(_id, input, options) {
      native.createdSelection = options.assistantSelection;
      assert.equal(input.persistent, true);
      assert.notEqual(input.ephemeral, true);
      return { ok: true, conversationId: "native" };
    },
    async readConversation() { return { ok: true, ...native }; },
    async startConversationTurn(_id, input, options) {
      native.turnSelection = options.assistantSelection;
      native.lastInput = input;
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
  return { attachments, events, native, restart, service: restart(), store, selection, sessionAgent, capabilities };
}

test("temporary Auto and one automatic review retain the native conversation without changing main chat", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const role = (modelId) => resolveVibe64AssistantSelection(f.capabilities, { ...f.selection, modelId, catalogRevision: f.capabilities.revision });
    await createAssistantRoutingStore({ systemRoot: root }).write({ codex: {
      plan: role("gpt-6-astra"), code: role("chosen"), economy: role("main-model")
    } }, 0);
    const admitted = new Set();
    const starts = [];
    const start = f.sessionAgent.startConversationTurn;
    Object.assign(f.sessionAgent, {
      listCapabilities: async () => ({ engines: [f.capabilities] }),
      requireAssistantAccessForSelection: async () => {},
      resolveExecutionProfile: async () => ({ model: "main-model" }),
      streamDetachedChatTurn: async () => ({ ok: true, threadId: "helper", text: '{"mode":"code","reason":"explicit_implementation"}' }),
      deleteDetachedChatThread: async () => ({ ok: true }),
      readConversation: async (_id, input) => ({ ok: true, ...f.native, admitted: admitted.has(input.messageId) }),
      startConversationTurn: async (id, input, context) => {
        assert.equal(await f.store.conversationMessageIdExists({ sessionId: id, conversationId: "chat" }, input.messageId), false);
        await input.onPromptSending?.({ threadId: input.conversationId });
        const result = await start(id, input, context);
        admitted.add(input.messageId); starts.push({ input, selection: context.assistantSelection });
        return result;
      }
    });
    const service = f.restart({ systemRoot: root });
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await service.updateTemporaryConversation("one", { conversationId: "chat", assistantRouting: { mode: "auto", review: true } });
    const input = { conversationId: "chat", messageId: "request", message: "Implement the agreed change." };
    await service.startTemporaryConversationTurn("one", input);
    assert.equal(starts[0].selection.modelId, "chosen");
    assert.match(starts[0].input.message, /Vibe64 mode: code/);
    const record = await f.store.readSessionConversation("one", "chat");
    assert.equal(JSON.parse(record.routingMetadata.assistant_routing_request).status, "sent");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
    assert.equal(JSON.parse((await f.store.readSession("one")).metadata.assistant_selection).modelId, "main-model");
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-1" } });
    assert.equal(starts.length, 2, (await f.store.readSessionConversation("one", "chat")).routingMetadata.assistant_routing_request);
    assert.equal(starts[1].selection.modelId, "gpt-6-astra");
    assert.equal(starts[1].input.conversationId, starts[0].input.conversationId);
    assert.equal(starts[1].input.messageId, JSON.parse(record.routingMetadata.assistant_routing_request).reviewMessageId);
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-2" } });
    const restored = await f.restart({ systemRoot: root }).readTemporaryConversation("one", { conversationId: "chat" });
    assert.equal(JSON.parse(restored.routingMetadata.assistant_routing_request).reviewStatus, "completed");
    assert.equal(starts.length, 2);
    assert.equal(restored.messages.filter((message) => message.role === "user").length, 2);
  });
});

for (const [engineId, model] of [["codex", "gpt-6-astra"], ["opencode", "deepseek-reasoner"]]) {
  test(`temporary ${engineId} validates and retains its own model without changing main chat`, async () => {
    await withTemporaryRoot(async (root) => {
      const { service, store, native, selection, restart } = await conversationFixture(root, engineId);
      await service.createTemporaryConversation("one", { conversationId: "chat" });
      await service.updateTemporaryConversation("one", {
        conversationId: "chat", agentSettings: { providerId: engineId, model, thinking: "ultra" }
      });
      await restart().startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "input", message: "Question" });
      assert.equal(native.createdSelection.modelId, model);
      assert.equal(native.turnSelection.modelId, model);
      assert.equal(native.turnSelection.variantId, "ultra");
      assert.equal(native.turnSelection.modelProviderId, selection.modelProviderId);
      assert.equal(native.turnSelection.catalogRevision, `sha256:${"b".repeat(64)}`);
      assert.equal((await store.readSession("one")).metadata.assistant_selection, serializeVibe64AssistantSelection(selection));
      assert.equal((await restart().listTemporaryConversations("one")).conversations[0].agentSettings.model, model);
    });
  });
}

test("temporary model and effort must be currently available before native work starts", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, native, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    for (const agentSettings of [
      { model: "missing-model" }, { model: "disabled-model" }, { model: "gpt-6-astra", thinking: "unsupported" }
    ]) {
      await assert.rejects(service.startTemporaryConversationTurn("one", {
        conversationId: "chat", messageId: "input", message: "Question", agentSettings
      }), { code: "vibe64_assistant_selection_unavailable" });
    }
    assert.equal(native.createdSelection, undefined);
    assert.equal(native.starts, 0);
    assert.deepEqual(await store.readConversationLog({ sessionId: "one", conversationId: "chat" }), []);
  });
});

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


test("temporary conversations steer active work without changing its model or preparing source", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, native, restart, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "first", message: "Investigate" });
    native.admitted = false;
    let preparations = 0;
    const current = restart({ prepareAgentSkills: async () => { preparations += 1; } });
    await current.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "steer", message: "Focus on the logs", agentSettings: { model: "missing-model" }
    });
    assert.equal(native.lastInput.steer, true);
    assert.equal(native.lastInput.conversationId, "native");
    assert.equal(preparations, 0);
    const log = await store.readConversationLog({ sessionId: "one", conversationId: "chat" });
    assert.deepEqual(log.filter(turn => turn.user).map(turn => turn.user.text), ["Investigate", "Focus on the logs"]);
    assert.deepEqual(await store.readConversationLog("one"), []);
    await current.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "steer", message: "Focus on the logs" });
    assert.equal(native.starts, 2);
  });
});
