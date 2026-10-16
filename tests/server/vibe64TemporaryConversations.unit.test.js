import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { assistantModePrompt } from "@local/vibe64-runtime/shared/assistantRouting";
import { resolveVibe64AssistantSelection, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createSessionConversations } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { prepareCodexModelRouting } from "../../packages/vibe64-terminals/src/server/nativeConversationRetirement.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createSessionAttachments } from "../../packages/vibe64-terminals/src/server/sessionAttachments.js";
import { createMainBrowserConversations } from "../../packages/vibe64-sessions/src/server/mainBrowserConversations.js";
import { mainConversationId, temporaryConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { ACTION_READ_CONVERSATION_CONTEXT } from "../../packages/vibe64-sessions/src/server/actions.js";
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

test("Main and temporary browser history default to ten messages and forward opaque cursors", async () => {
  const calls = [];
  const conversation = { async read(query) { calls.push(query); return { conversationLog: [] }; } };
  const facade = createMainBrowserConversations({
    actions: { async execute() { return { actor: { id: "owner" }, user: { username: "owner" }, project: { slug: "unit_project" } }; } },
    terminals: { openBrowserConversation: async () => conversation, openTemporaryBrowserConversation: async () => conversation }
  });
  const target = { projectSlug: "unit_project", sessionId: "one" };
  const cursor = 'message:["000001","assistant"]';
  for (const id of [mainConversationId(target), temporaryConversationId({ ...target, conversationId: "chat" })]) {
    const browser = await facade.open({ id, context: { requestMeta: { request: {} } } });
    await browser.read();
    await browser.read({ beforeTurnId: cursor });
  }
  assert.deepEqual(calls, [{ limit: "10", pageUnit: "messages" }, { limit: "10", pageUnit: "messages", beforeTurnId: cursor },
    { limit: "10", pageUnit: "messages" }, { limit: "10", pageUnit: "messages", beforeTurnId: cursor }]);
});

test("temporary conversation actions use durable conversation ownership", async () => runWithProjectRequestContext({ slug: "unit_project" }, async () => {
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
}));

test("one attachment cleanup action targets only its exact attachment", async () => runWithProjectRequestContext({ slug: "unit_project" }, async () => {
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
}));

async function conversationFixture(root, engineId = "codex") {
  const selection = { engineId, modelProviderId: engineId === "opencode" ? "deepseek" : "openai",
    agentId: engineId === "opencode" ? "build" : "codex", modelId: "main-model", variantId: "high",
    catalogRevision: `sha256:${"a".repeat(64)}` };
  const capabilities = {
    engineId, transportId: engineId === "codex" ? "codex_app_server" : "opencode_server", revision: `sha256:${"b".repeat(64)}`, defaults: selection,
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
  const runtime = { store, stateRoot: projectRuntimeRoot(root), getSession: (id) => store.readSession(id) };
  const projectService = { createRuntime: async () => runtime };
  const attachments = createSessionAttachments({ projectService, env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "uploads") } });
  const native = { messages: [], status: "ready", runId: "", admitted: false, starts: 0, deletes: 0, stopError: "", deleteError: "" };
  const sessionAgent = {
    async inspectAssistantPurposes() { return {}; },
    async assistantAccess() { return { canUse: true }; },
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
      await input.onPromptSending?.({ threadId: input.conversationId });
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
  const routingStore = createAssistantRoutingStore({ systemRoot: root });
  const role = { ...resolveVibe64AssistantSelection(capabilities, { ...selection, catalogRevision: capabilities.revision }), selectionSource: "explicit" };
  await routingStore.write({ [engineId]: { senior: role, junior: role, helper: role, router: role } }, 0);
  const manager = createSessionAgentManager({ providers: [{ id: engineId, transportId: capabilities.transportId, capabilities: async () => capabilities }],
    readRoutingConfiguration: () => routingStore.read(),
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "fixture-connection" }) });
  Object.assign(sessionAgent, { resolveAssistantPurpose: (input, options) => manager.resolveAssistantPurpose(input, options),
    requireAssistantAccessForSelection: async () => {} });
  const events = [];
  const restart = (overrides = {}) => {
    let service;
    const conversationRuntime = overrides.conversationRuntime || createConversationRuntime({
      authorize: async () => true,
      host: { conversation: ({ id, context }) => service.conversationBinding(id, context) }
    });
    service = createSessionConversations({
      systemRoot: root,
      sessionAgent,
      conversationRuntime,
      attachments,
      prepareAgentSkills: async () => {},
      readSessionContext: async (sessionId, options = {}) => ({
        ...options, runtime, session: await runtime.getSession(sessionId)
      }),
      runAgentWrite: async (sessionId, options, operation, lockOptions) => {
        const result = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const session = await runtime.getSession(sessionId);
          return operation({ ...options, runtime, session });
        }, lockOptions);
        return result.value;
      },
      publishSessionChanged: async (...args) => { events.push(args); },
      ...overrides
    });
    return service;
  };
  return { attachments, events, native, restart, service: restart(), runtime, store, selection, sessionAgent, capabilities };
}

test("temporary provisional rows require exact native admission across read failure and restart without replay", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const admitted = new Set();
    let readFailure = false;
    const reads = [];
    const originalStart = f.sessionAgent.startConversationTurn;
    f.sessionAgent.readConversation = async (_id, input) => {
      reads.push({ conversationId: input.conversationId, messageId: input.messageId });
      if (readFailure) throw new Error("Native history unavailable");
      return { ok: true, ...f.native, admitted: admitted.has(input.messageId) };
    };
    f.sessionAgent.startConversationTurn = async (id, input, context) => {
      if (input.messageId === "uncertain-steer") {
        await input.onPromptSending?.({ threadId: input.conversationId });
        f.native.starts += 1;
        readFailure = true;
        throw new Error("Native acknowledgement lost");
      }
      const result = await originalStart(id, input, context);
      admitted.add(input.messageId);
      return result;
    };
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    await f.service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "first", message: "Begin" });
    const input = { conversationId: "chat", messageId: "uncertain-steer", message: "Continue carefully", submissionKind: "steer" };
    const response = await f.service.startTemporaryConversationTurn("one", input);
    assert.equal(response.ok, false);
    assert.equal(response.delivered, false);
    assert.equal(response.status, "uncertain");
    assert.equal(response.readError, true);
    assert.equal(response.messageId, input.messageId);
    assert.equal(response.messages.find(message => message.id === input.messageId).receipt, false);
    assert.equal(response.messages.find(message => message.id === "first").receipt, undefined);
    assert.equal(f.native.starts, 2);
    await f.service.close();
    const restored = f.restart();
    await assert.rejects(restored.startTemporaryConversationTurn("one", input), /Native history unavailable/);
    const failedRead = await restored.readTemporaryConversation("one", { conversationId: "chat" });
    assert.equal(failedRead.readError, true);
    assert.equal(failedRead.messages.find(message => message.id === input.messageId).receipt, false);
    readFailure = false;
    for (let check = 0; check < 2; check += 1) {
      const unknown = await restored.startTemporaryConversationTurn("one", input);
      assert.equal(unknown.ok, false);
      assert.equal(unknown.delivered, false);
      assert.equal(unknown.code, "vibe64_changeover_delivery_unconfirmed");
      assert.equal(f.native.starts, 2);
    }
    admitted.add(input.messageId);
    const accepted = await restored.startTemporaryConversationTurn("one", input);
    assert.equal(accepted.delivered, true);
    const observed = await restored.readTemporaryConversation("one", { conversationId: "chat" });
    assert.equal(observed.messages.find(message => message.id === input.messageId).receipt, undefined);
    assert.equal(f.native.starts, 2);
    assert.ok(reads.some(read => read.conversationId === "native" && read.messageId === input.messageId));
    const turns = await f.store.readConversationLog({ sessionId: "one", conversationId: "chat" });
    assert.equal(turns.filter(turn => turn.user?.messageId === input.messageId).length, 1);
    assert.equal(turns.some(turn => turn.messages.some(message => Object.hasOwn(message, "receipt"))), false);
    assert.equal(JSON.stringify(await f.store.readSessionConversation("one", "chat")).includes('"receipt"'), false);
    await restored.close();
  });
});

test("temporary historical provisional receipt inspection uses its recorded native binding", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    await f.store.writeConversationUserMessage({ sessionId: "one", conversationId: "chat" }, {
      text: "Earlier direct message", messageId: "historical", turnMetadata: { assistantSelection: f.selection }
    });
    const otherSelection = { ...f.selection, engineId: "opencode", agentId: "build", modelProviderId: "deepseek" };
    await f.store.writeSessionConversation("one", "chat", {
      assistantSelection: otherSelection, providerConversationId: "current-other-thread",
      nativeBindings: { codex: { conversationId: "original-codex-thread", assistantSelection: f.selection, agentSettings: {}, runId: "original-turn" } }
    });
    const reads = [];
    f.sessionAgent.readConversation = async (_id, input, context) => {
      reads.push({ threadId: input.conversationId, messageId: input.messageId, selection: context.assistantSelection });
      return { ok: true, admitted: true, runId: "original-turn", status: "completed", messages: [] };
    };
    const result = await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "historical", message: "Earlier direct message"
    });
    assert.equal(result.delivered, true);
    assert.deepEqual(reads, [{ threadId: "original-codex-thread", messageId: "historical", selection: f.selection }]);
    assert.equal(f.native.starts, 0);
    assert.equal((await f.store.readSessionConversation("one", "chat")).providerConversationId, "current-other-thread");
    assert.equal((await f.store.readConversationLog({ sessionId: "one", conversationId: "chat" })).length, 1);
    await f.service.close();
  });
});

test("a fresh Update repair routes independently of its parent's older Codex history", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const parentHistory = {
      codex_deepseek_conversation_id: "parent-deepseek-thread",
      codex_conversation_id: "parent-openai-thread",
      agent_identity_provider: "codex",
      agent_identity_model_provider: "deepseek",
      agent_identity_conversation_id: "parent-deepseek-thread"
    };
    for (const [key, value] of Object.entries(parentHistory)) await f.store.writeMetadataValue("one", key, value);
    const parent = await f.store.readSession("one");
    const service = f.restart({ prepareSelection: prepareCodexModelRouting });
    await service.createTemporaryConversation("one", { conversationId: "repair", presentation: { recoveryOperation: "update" } });
    await service.startTemporaryConversationTurn("one", {
      conversationId: "repair", messageId: "fix-update", message: "Fix this Update problem without losing work."
    });
    assert.equal(f.native.starts, 1);
    const repair = await f.store.readSessionConversation("one", "repair");
    assert.equal(repair.providerConversationId, "native");
    assert.equal(repair.routingMetadata.codex_routing_home_provider, "openai");
    assert.deepEqual((await f.store.readSession("one")).metadata, parent.metadata);
    assert.deepEqual(await f.store.readConversationLog("one"), []);
    await service.close();
  });
});

test("temporary direct Junior ignores an unusable working plan and persists no plan snapshot", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    await f.service.updateTemporaryConversation("one", { conversationId: "chat", assistantRouting: { mode: "junior", review: false } });
    const planPath = path.join(f.store.paths("one").conversationsRoot, "chat", "work-plan", "plan.md");
    await mkdir(planPath, { recursive: true });
    const message = "Explain how the staff roster relates to a contact.";
    await f.service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "question", message });
    assert.equal(f.native.starts, 1);
    assert.equal(f.native.lastInput.displayMessage, message);
    assert.match(f.native.lastInput.message, /Unrelated requests do not need a plan and must leave existing plans unchanged/);
    assert.ok(!f.native.lastInput.message.includes(planPath));
    f.native.status = "completed";
    await f.service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-1" } });
    const restored = await f.restart().readTemporaryConversation("one", { conversationId: "chat" });
    const request = JSON.parse(restored.routingMetadata.assistant_routing_request);
    assert.equal(request.status, "complete");
    assert.equal(request.workPlan, null);
    assert.equal(request.error, undefined);
    assert.equal(f.native.starts, 1);
    assert.equal((await f.store.readConversationLog("one")).length, 0);
  });
});

test("temporary conversation reads page backwards by stable message identity without touching Main", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    const scope = { sessionId: "one", conversationId: "chat" };
    for (let index = 0; index < 8; index += 1) {
      await f.store.writeConversationUserMessage(scope, { messageId: `question-${index}`, text: `Question ${index}` });
      await f.store.writeConversationAssistantMessage(scope, { messageId: `answer-${index}`, text: `Answer ${index}` });
    }
    const latest = await f.service.readTemporaryConversation("one", { conversationId: "chat", messageLimit: 4 });
    assert.deepEqual(latest.messages.map((message) => message.id), ["question-6", "answer-6", "question-7", "answer-7"]);
    assert.equal(latest.earlierMessages, true);
    const earlier = await f.service.readTemporaryConversation("one", { conversationId: "chat", beforeMessageId: "question-6", messageLimit: 12 });
    assert.equal(earlier.messages.length, 12);
    assert.equal(earlier.messages.at(-1).id, "answer-5");
    assert.equal(earlier.earlierMessages, false);
    await assert.rejects(f.service.readTemporaryConversation("one", { conversationId: "chat", beforeMessageId: "absent" }), { code: "vibe64_conversation_cursor_missing" });
    assert.equal((await f.store.readConversationLog("one")).length, 0);
  });
});

test("temporary chats reject Auto at creation, preference updates and request admission", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await assert.rejects(f.service.createTemporaryConversation("one", {
      conversationId: "rejected", assistantRouting: { mode: "auto" }
    }), /Main chat only/);
    assert.equal(await f.store.readSessionConversation("one", "rejected"), null);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    const record = await f.store.readSessionConversation("one", "chat");
    await assert.rejects(f.service.updateTemporaryConversation("one", {
      conversationId: "chat", assistantRouting: { mode: "auto", review: true }
    }), /Main chat only/);
    assert.deepEqual((await f.store.readSessionConversation("one", "chat")).routingMetadata, record.routingMetadata);
    await f.store.writeSessionConversation("one", "chat", { routingMetadata: {
      ...record.routingMetadata, assistant_routing: JSON.stringify({ mode: "auto", review: true, workflowEngineId: "codex" })
    } });
    await assert.rejects(f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "blocked", message: "Implement it"
    }), /Main chat only/);
    assert.equal(f.native.starts, 0);
    assert.equal((await f.store.readConversationLog({ sessionId: "one", conversationId: "chat" })).length, 0);
  });
});

test("temporary Auto requests cannot retry or continue into planning or review", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    await f.service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "first", message: "Explain this" });
    const record = await f.store.readSessionConversation("one", "chat");
    const request = { ...JSON.parse(record.routingMetadata.assistant_routing_request), mode: "auto", resolvedMode: "junior", review: true };
    await f.store.writeSessionConversation("one", "chat", { routingMetadata: { ...record.routingMetadata,
      assistant_routing_request: JSON.stringify(request) } });
    f.native.status = "completed";
    await f.service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-1" } });
    const finished = JSON.parse((await f.store.readSessionConversation("one", "chat")).routingMetadata.assistant_routing_request);
    assert.equal(finished.status, "waiting");
    assert.match(finished.error, /Main chat only/);
    for (const delivery of ["failed", "pending", "uncertain"]) {
      await f.store.writeSessionConversation("one", "chat", { routingMetadata: { ...record.routingMetadata,
        assistant_routing_request: JSON.stringify({ ...request, messageId: "pending", status: "waiting", delivery }) } });
      await assert.rejects(f.service.startTemporaryConversationTurn("one", {
        conversationId: "chat", messageId: "pending", message: "Explain this",
        ...(delivery === "pending" ? { reviewAction: "retry" } : {})
      }), /Main chat only/);
    }
    assert.equal(f.native.starts, 1);
  });
});

test("Close retains a temporary chat when its saved helper cannot be cleaned up", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    let cleanupSucceeds = false;
    f.sessionAgent.deleteEphemeralConversation = async () => ({ ok: cleanupSucceeds });
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    const record = await f.store.readSessionConversation("one", "chat");
    const helperRoot = path.join(f.runtime.stateRoot, "assistant-helpers", "saved-router");
    const helper = { conversationId: "router", runId: "router-turn", selection: f.selection,
      scope: { id: "saved-router", runtimeRoot: path.join(helperRoot, "runtime"), workdir: path.join(helperRoot, "workdir") } };
    await f.store.writeSessionConversation("one", "chat", { routingMetadata: { ...record.routingMetadata,
      assistant_routing_request: JSON.stringify({ schemaVersion: 5, status: "waiting", delivery: "failed", messageId: "owned-helper", input: { message: "Preserved request" }, mode: "auto", helper }) } });
    await assert.rejects(f.service.deleteTemporaryConversation("one", { conversationId: "chat" }), /routing helper could not be closed/);
    const retained = await f.store.readSessionConversation("one", "chat");
    assert.equal(retained.state, "open");
    assert.equal(JSON.parse(retained.routingMetadata.assistant_routing_request).helper.runId, "router-turn");
    cleanupSucceeds = true;
    assert.equal((await f.service.deleteTemporaryConversation("one", { conversationId: "chat" })).deleted, true);
    assert.equal(await f.store.readSessionConversation("one", "chat"), null);
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
      await assert.rejects(service.updateTemporaryConversation("one", {
        conversationId: "chat", agentSettings
      }), { code: "vibe64_assistant_selection_unavailable" });
    }
    assert.equal(native.createdSelection, undefined);
    assert.equal(native.starts, 0);
    assert.deepEqual(await store.readConversationLog({ sessionId: "one", conversationId: "chat" }), []);
  });
});

test("a temporary draft saves while another assistant operation holds the source lease", { timeout: 5000 }, async () => {
  await withTemporaryRoot(async (root) => {
    const { service, store, native } = await conversationFixture(root);
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
      assert.equal((await saving).ok, true);
      assert.equal((await store.readSessionConversation("one", "chat")).draft, "Ideas?");
      assert.equal(native.starts, 0);
      const mixed = await service.updateTemporaryConversation("one", {
        conversationId: "chat", presentation: { draft: "Mixed", title: "New title" }
      }, { lockWaitMs: 0 });
      assert.equal(mixed.code, "vibe64_agent_write_mode_busy");
      assert.equal(mixed.retryable, true);
      await assert.rejects(service.startTemporaryConversationTurn("one", {
        conversationId: "chat", messageId: "blocked-start", message: "Do not dispatch while busy"
      }, { lockWaitMs: 0 }), { code: "vibe64_agent_write_mode_busy" });
      assert.equal(native.starts, 0);
    } finally {
      release.resolve();
      await holding;
    }
  });
});

test("plain drafts cannot recreate a closed chat or write into one that is closing", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await store.writeSessionConversation("one", "chat", { state: "closing" });
    await assert.rejects(service.updateTemporaryConversation("one", {
      conversationId: "chat", presentation: { draft: "Late" }
    }), { code: "vibe64_conversation_closing" });
    await store.deleteSessionConversation("one", "chat");
    await assert.rejects(service.updateTemporaryConversation("one", {
      conversationId: "chat", presentation: { draft: "Later" }
    }), { code: "vibe64_conversation_closed" });
    assert.equal(await store.readSessionConversation("one", "chat"), null);
  });
});

test("a newly created chat gives its initial draft a durable revision", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", {
      conversationId: "chat", presentation: { draft: "Initial idea" }
    });
    const record = await store.readSessionConversation("one", "chat");
    assert.equal(record.draft, "Initial idea");
    assert.match(record.draftRevision, /^[0-9a-f-]{36}$/u);
  });
});

test("a queued draft merges into current lifecycle state and refuses a renewed session", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const queuedService = f.restart({ readSessionContext: async (sessionId, options = {}) => {
      const session = await f.runtime.getSession(sessionId);
      entered.resolve(); await release.promise;
      return { ...options, runtime: f.runtime, session };
    } });
    const saving = queuedService.updateTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Later draft" } });
    await entered.promise;
    const lifecycle = { status: "completed", recoveryOutcome: "succeeded", providerConversationId: "existing-native",
      runId: "existing-run", attachments: [{ attachmentId: "retained-file" }], routingMetadata: { retained: "policy" } };
    try { await f.store.writeSessionConversation("one", "chat", lifecycle); }
    finally { release.resolve(); }
    assert.equal((await saving).ok, true);
    const saved = await f.store.readSessionConversation("one", "chat");
    for (const [key, value] of Object.entries(lifecycle)) assert.deepEqual(saved[key], value);
    assert.equal(saved.draft, "Later draft");
    await f.store.quiesceSessionForRenewal({ sourceSessionId: "one", renewalId: "renewal-test" });
    await assert.rejects(f.service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Too late" } }),
      { code: "vibe64_session_renewal_quiesced" });
    assert.equal((await f.store.readSessionConversation("one", "chat")).draft, "Later draft");
  });
});

test("two session stores preserve draft-before-Close and reject draft-after-Close order", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat" });
    const secondStore = createVibe64SessionStore({
      projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root)
    });
    const secondRuntime = { ...f.runtime, store: secondStore,
      getSession: id => secondStore.readSession(id) };
    const secondService = f.restart({ readSessionContext: async (sessionId, options = {}) => ({
      ...options, runtime: secondRuntime, session: await secondRuntime.getSession(sessionId)
    }) });
    await secondService.updateTemporaryConversation("one", {
      conversationId: "chat", presentation: { draft: "Before Close" }
    });
    await f.store.writeSessionConversation("one", "chat", { state: "closing" });
    assert.equal((await secondStore.readSessionConversation("one", "chat")).draft, "Before Close");
    await assert.rejects(secondService.updateTemporaryConversation("one", {
      conversationId: "chat", presentation: { draft: "After Close" }
    }), { code: "vibe64_conversation_closing" });
    assert.equal((await f.store.readSessionConversation("one", "chat")).draft, "Before Close");
  });
});

test("saved conversation history remains readable while source work holds the lease", { timeout: 5000 }, async () => {
  await withTemporaryRoot(async (root) => {
    const { service, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await store.writeConversationUserMessage({ sessionId: "one", conversationId: "chat" }, {
      messageId: "saved-1", text: "Saved question"
    });
    await store.writeConversationUserMessage({ sessionId: "one", conversationId: "chat" }, {
      messageId: "saved-2", text: "Another saved question"
    });
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holding = store.runSessionExclusive("one", "agent-write-mode", async () => {
      entered.resolve();
      await release.promise;
    }, { operation: "prepare-agent-session" });
    await entered.promise;
    try {
      const listed = await service.listTemporaryConversations("one");
      const read = await service.readTemporaryConversation("one", { conversationId: "chat" });
      assert.equal(listed.conversations[0].deferredReconciliation, true);
      assert.equal(read.deferredReconciliation, true);
      assert.equal(read.messages[0].text, "Saved question");
      assert.equal(read.messages[0].receipt, false);
      const latest = await service.readTemporaryConversation("one", { conversationId: "chat", messageLimit: 1 });
      assert.deepEqual(latest.messages.map(message => message.id), ["saved-2"]);
      assert.equal(latest.earlierMessages, true);
      const earlier = await service.readTemporaryConversation("one", {
        conversationId: "chat", beforeMessageId: "saved-2", messageLimit: 1
      });
      assert.deepEqual(earlier.messages.map(message => message.id), ["saved-1"]);
      await assert.rejects(service.readTemporaryConversation("one", { conversationId: "chat", beforeMessageId: "unknown" }),
        { code: "vibe64_conversation_cursor_missing" });
    } finally {
      release.resolve();
      await holding;
    }
    assert.equal((await service.readTemporaryConversation("one", { conversationId: "chat" })).deferredReconciliation, undefined);
  });
});

for (const newerDraft of ["Question B", "Question A"]) {
  test(`native admission cannot clear a newer ${newerDraft === "Question A" ? "identical" : "different"} draft saved during source work`, { timeout: 5000 }, async () => {
    await withTemporaryRoot(async (root) => {
      const f = await conversationFixture(root);
      await f.service.createTemporaryConversation("one", { conversationId: "chat" });
      await f.service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Question A" } });
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const startNative = f.sessionAgent.startConversationTurn;
      f.sessionAgent.startConversationTurn = async (...args) => {
        entered.resolve();
        await release.promise;
        return startNative(...args);
      };
      const sending = f.service.startTemporaryConversationTurn("one", {
        conversationId: "chat", messageId: "question-a", message: "Question A", presentation: { draft: "" }
      });
      await entered.promise;
      try {
        assert.equal((await f.service.updateTemporaryConversation("one", {
          conversationId: "chat", presentation: { draft: newerDraft }
        })).ok, true);
      } finally {
        release.resolve();
      }
      await sending;
      assert.equal((await f.store.readSessionConversation("one", "chat")).draft, newerDraft);
      await f.service.readTemporaryConversation("one", { conversationId: "chat" });
      assert.equal((await f.store.readSessionConversation("one", "chat")).draft, newerDraft);
    });
  });
}

for (const operation of ["list", "read"]) {
  test(`temporary ${operation} availability checks do not block another conversation's saved draft`, async () => {
    await withTemporaryRoot(async (root) => {
      const f = await conversationFixture(root);
      await f.service.createTemporaryConversation("one", { conversationId: "chat" });
      await f.service.createTemporaryConversation("one", { conversationId: "other" });
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      f.sessionAgent.inspectAssistantPurposes = async () => {
        entered.resolve();
        await release.promise;
        return { senior: { available: true } };
      };
      const reading = operation === "list" ? f.service.listTemporaryConversations("one")
        : f.service.readTemporaryConversation("one", { conversationId: "chat" });
      await entered.promise;
      try {
        const saving = await runVibe64AgentWriteExclusive(f.runtime, "one", () =>
          f.service.updateTemporaryConversation("one", { conversationId: "other", presentation: { draft: "Still editable" } }));
        assert.equal(saving.acquired, true, "provider availability must not hold the session write lock");
        assert.equal(saving.value.ok, true);
        assert.equal((await f.store.readSessionConversation("one", "other")).draft, "Still editable");
      } finally {
        release.resolve();
        await reading;
      }
      const result = await reading;
      const records = operation === "list" ? result.conversations : [result];
      assert.ok(records.every((record) => record.purposes.senior.available));
    });
  });
}

test("recovered admission retains attachments added after the submitted draft", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    await f.service.createTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Question A" } });
    await f.service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "question-a", message: "Question A" });
    // Recreate the persisted boundary after dispatch but before its acknowledgement.
    await f.store.writeSessionConversation("one", "chat", { status: "starting" });
    const upload = await f.attachments.uploadAttachment({ sessionId: "one" }, {
      fileName: "later.txt", stream: Readable.from(["For the next question"])
    });
    await f.service.updateTemporaryConversation("one", { conversationId: "chat", attachmentIds: [upload.attachmentId] });
    await f.service.readTemporaryConversation("one", { conversationId: "chat" });
    assert.equal((await f.store.readSessionConversation("one", "chat")).attachments[0]?.attachmentId, upload.attachmentId);
    const retained = await f.attachments.readAttachment({ sessionId: "one" }, upload.attachmentId);
    assert.equal(await retained.fileHandle.readFile("utf8"), "For the next question");
    await retained.fileHandle.close();
    assert.equal(f.native.starts, 1);
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
    assert.equal(restored.agentSettings.model, "main-model", "a new Plan chat uses its configured role, not copied parent model settings");
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
    assert.equal(events.some(([, event]) => event.reason === "temporary-conversation-closed"), false);
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


test("session conversation routing preserves native completed status for a stale steer", async () => {
  await withTemporaryRoot(async (root) => {
    const { service, native, store } = await conversationFixture(root);
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "first", message: "Investigate" });
    native.admitted = false;
    const input = { conversationId: "chat", messageId: "followup", message: "Continue carefully" };
    for (const status of ["completed", "interrupted", "stopped", "failed", "unverified", "ready"]) {
      native.status = status;
      await assert.rejects(service.startTemporaryConversationTurn("one", { ...input, submissionKind: "steer" }), error => {
        assert.equal(error.code, status === "completed" ? "conversation_steer_turn_finished" : "conversation_not_steerable");
        assert.equal(error.delivery, "not-sent");
        return true;
      });
      assert.equal(native.starts, 1, `${status} must not admit the rejected steer`);
      assert.equal(await store.conversationMessageIdExists({ sessionId: "one", conversationId: "chat" }, input.messageId), false);
    }
    native.status = "completed";
    const sent = await service.startTemporaryConversationTurn("one", { ...input, submissionKind: "send" });
    assert.equal(sent.delivered, true);
    assert.equal(native.starts, 2);
    assert.equal(native.lastInput.messageId, input.messageId);
    assert.equal(native.lastInput.steer, false);
    await service.startTemporaryConversationTurn("one", { ...input, submissionKind: "send" });
    assert.equal(native.starts, 2, "retrying the accepted fallback must not send twice");
    await service.close();
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

async function temporaryChangeoverFixture(root, actor = { role: "owner", username: "owner" }, review = false) {
  const f = await conversationFixture(root);
  f.capabilities.modelProviders.push({ id: "deepseek", connected: true, models: [
    { id: "deepseek-flash", status: "available", variants: [{ id: "high" }, { id: "low" }] }
  ] });
  const sharedCatalog = { engineId: "opencode", transportId: "opencode_server", label: "OpenCode", revision: f.capabilities.revision,
    agents: [{ id: "build", mode: "primary" }], defaults: { agentId: "build", modelProviderId: "opencode", modelId: "big-pickle", variantId: "" },
    modelProviders: [{ id: "opencode", connected: true, models: [{ id: "big-pickle", status: "available", variants: [] }] }] };
  const select = (catalog, input) => ({ ...resolveVibe64AssistantSelection(catalog, { ...catalog.defaults, ...input,
    catalogRevision: catalog.revision }), selectionSource: "explicit" });
  const senior = select(f.capabilities, { modelId: "gpt-6-astra" });
  const junior = select(f.capabilities, { modelProviderId: "deepseek", modelId: "deepseek-flash" });
  const helper = select(sharedCatalog, {});
  await createAssistantRoutingStore({ systemRoot: root }).write({ codex: { senior, junior, helper, router: junior, sharedBackup: helper } }, 1);
  await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "junior", review, workflowEngineId: "codex" }));
  await f.store.writeMetadataValue("one", "assistant_changeover", '{"mainChatSentinel":true}');
  const native = new Map();
  const calls = { starts: [], stops: [], deletes: [], settings: [] };
  const failures = { stop: "", delete: "", loseAdmission: false, read: false };
  let nextId = 0;
  const manager = createSessionAgentManager({
    readRoutingConfiguration: () => createAssistantRoutingStore({ systemRoot: root }).read(),
    providers: [f.capabilities, sharedCatalog].map((catalog) => ({ id: catalog.engineId, transportId: catalog.transportId,
      capabilities: async () => catalog,
      async createConversation(ctx) {
        const id = `${catalog.engineId}-${++nextId}`;
        native.set(id, { id, engineId: ctx.assistantSelection.engineId, messages: [], accepted: new Set(), status: "ready", runId: "" });
        return { ok: true, conversationId: id };
      },
      async readConversation(ctx, input) {
        if (failures.read) throw new Error("Native receipt temporarily unreadable");
        const row = native.get(input.conversationId);
        assert.equal(row.engineId, ctx.assistantSelection.engineId);
        return { ok: true, status: row.status, runId: row.runId, messages: row.messages, goal: row.goal || null, admitted: row.accepted.has(input.messageId) };
      },
      async startConversationTurn(ctx, input) {
        const row = native.get(input.conversationId);
        assert.equal(row.engineId, ctx.assistantSelection.engineId);
        assert.equal(ctx.routingConversationId, "chat");
        await input.onPromptSending?.({ threadId: row.id });
        row.accepted.add(input.messageId);
        row.runId = `turn-${calls.starts.length + 1}`;
        row.status = "inProgress";
        calls.starts.push({ input, selection: ctx.assistantSelection, conversationId: row.id });
        if (failures.loseAdmission) { failures.read = true; throw new Error("Lost native admission reply"); }
        return { ok: true, runId: row.runId, status: row.status };
      },
      async stopConversation(ctx, input) {
        calls.stops.push(input.conversationId);
        if (failures.stop === input.conversationId) throw new Error("Native stop not confirmed");
        assert.equal(native.get(input.conversationId).engineId, ctx.assistantSelection.engineId);
        native.get(input.conversationId).status = "interrupted";
        return { ok: true };
      },
      async deleteConversation(ctx, input) {
        calls.deletes.push(input.conversationId);
        if (failures.delete === input.conversationId) throw new Error("Native deletion not confirmed");
        assert.equal(native.get(input.conversationId).engineId, ctx.assistantSelection.engineId);
        native.delete(input.conversationId);
        return { ok: true };
      }
    })),
    readAssistantAccess: async ({ engineId, modelProviderId }) => ({ available: true, ownerOnly: modelProviderId === "openai",
      connectionIdentity: `${engineId}:${modelProviderId}` })
  });
  Object.assign(f.sessionAgent, manager);
  f.sessionAgent.updateSessionSettings = async (id, input, ctx) => {
    assert.equal(id, "one");
    assert.equal(ctx.routingConversationId, "chat");
    assert.equal(ctx.runtime.store, f.store, "Native settings use the actual store, with the temporary selection");
    assert.ok(native.has(input.threadId));
    calls.settings.push({ input, selection: ctx.assistantSelection });
    return { ok: true };
  };
  const options = { vibe64User: actor };
  const preparation = async (id, selection, ctx) => {
    if (selection.engineId !== "codex" || ctx.session.metadata.codex_routing_home_provider) return;
    await ctx.runtime.store.writeMetadataValue(id, "codex_routing_home_provider", "openai");
  };
  let service = f.restart({ systemRoot: root, prepareSelection: preparation });
  await manager.assistantAccess("one", { session: await f.store.readSession("one"), ...options });
  await service.createTemporaryConversation("one", { conversationId: "chat" }, options);
  return { ...f, native, calls, failures, manager, options, senior, junior, helper,
    get service() { return service; },
    restart() { service = f.restart({ systemRoot: root, prepareSelection: preparation }); return service; },
    record: () => f.store.readSessionConversation("one", "chat"),
    async send(mode, messageId, message = `Request ${messageId}`) {
      await service.updateTemporaryConversation("one", { conversationId: "chat", assistantRouting: { mode, review } }, options);
      return service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId, message }, options);
    },
    async finish(reply) {
      const record = await f.store.readSessionConversation("one", "chat");
      const row = native.get(record.providerConversationId);
      row.status = "completed";
      row.messages.push({ role: "assistant", id: `reply-${row.runId}`, text: reply, complete: true });
      await service.afterTemporaryTurn("one", { conversationId: row.id, temporaryRun: { active: false, state: "completed", providerTurnId: row.runId } }, options);
    }
  };
}

test("temporary goals retain identity while settings remain editable during activity and unavailable reads", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, undefined, true);
    await f.send("junior", "start-goal");
    const record = await f.record();
    const goal = { status: "paused", objective: "Finish this implementation" };
    f.native.get(record.providerConversationId).goal = goal;
    await f.finish("Paused the goal.");
    assert.equal(f.calls.starts.length, 1, "a goal never starts automatic review");
    const restored = (await f.restart().listTemporaryConversations("one", f.options)).conversations[0];
    assert.deepEqual(restored.goal, goal);
    await assert.rejects(f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "auto", review: true }
    }, f.options), /Auto is available in Main chat only/);
    const configuration = createAssistantRoutingStore({ systemRoot: root });
    const saved = await configuration.read();
    await configuration.write({ codex: { ...saved.orchestrators.codex, junior: f.senior } }, saved.revision);
    await assert.rejects(f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "changed-coder", message: "Continue."
    }, f.options), /Finish or cancel the current goal before changing its AI/);
    assert.equal(f.calls.starts.length, 1);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holding = f.store.runSessionExclusive("one", "agent-write-mode", async () => {
      entered.resolve();
      await release.promise;
    }, { operation: "prepare-agent-session" });
    await entered.promise;
    try {
      for (const status of ["paused", "active"]) {
        goal.status = status;
        const result = await f.service.updateTemporaryConversation("one", { conversationId: "chat",
          assistantRouting: { mode: "senior", review: false, override: f.senior }
        }, { ...f.options, lockWaitMs: 0 });
        assert.equal(result.ok, true);
        assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing_goal).objective, goal.objective);
        assert.equal(f.calls.settings.at(-1).input.threadId, record.providerConversationId);
        assert.equal(f.calls.settings.at(-1).selection.modelId, f.senior.modelId);
        assert.equal(f.native.get(record.providerConversationId).goal, goal);
      }
    } finally {
      release.resolve();
      await holding;
    }
    assert.equal(f.calls.starts.length, 1);
    assert.deepEqual(f.calls.stops, []);
    const pinned = (await f.record()).routingMetadata.assistant_routing_goal;
    f.failures.read = true;
    assert.equal((await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "junior", review: false }
    }, f.options)).ok, true);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing).mode, "junior");
    assert.equal((await f.record()).routingMetadata.assistant_routing_goal, pinned);
    assert.equal(f.calls.settings.length, 2, "An unavailable native goal is never mutated speculatively");
  });
});

test("temporary availability uses its own override and actor without inferring or exposing connection identities", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "member" });
    const initial = await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    assert.equal(initial.purposes.junior.effectiveSelection.engineId, "opencode");
    assert.equal(initial.purposes.junior.backupReason, "keep_workflow_together");
    assert.equal(initial.purposes.auto.available, false);
    const updated = await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "senior", review: false, override: f.junior }
    }, f.options);
    assert.equal(updated.purposes.senior.effectiveSelection.modelId, "deepseek-flash");
    assert.equal(updated.purposes.senior.backupUsed, false);
    assert.equal(updated.purposes.junior.effectiveSelection.engineId, "opencode",
      "Switching to Code clears the Plan-only override and resolves that request afresh");
    assert.doesNotMatch(JSON.stringify(updated.purposes), /connectionIdentity/);
    const owner = await f.service.readTemporaryConversation("one", { conversationId: "chat" }, {
      vibe64User: { username: "owner", role: "owner" }
    });
    assert.equal(owner.purposes.junior.effectiveSelection.engineId, "codex");
    assert.equal(owner.purposes.auto.available, false);
    assert.equal(f.calls.starts.length, 0);
    assert.equal(f.native.size, 0);
  });
});

test("generated drafts choose Junior and merge repairs choose Senior in the parent workflow", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "member" });
    await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "auto", review: true, workflowEngineId: "codex" }));
    for (const input of [
      { conversationId: "generated", assistantRouting: { mode: "junior", review: false, workflowEngineId: "opencode" } },
      { conversationId: "repair", presentation: { recoveryOperation: "update" } }
    ]) {
      const created = await f.service.createTemporaryConversation("one", input, f.options);
      const role = input.presentation?.recoveryOperation ? "senior" : "junior";
      assert.deepEqual(JSON.parse(created.routingMetadata.assistant_routing), { mode: role, review: false, workflowEngineId: "codex" });
      assert.equal(created.purposes[role].effectiveSelection.engineId, "opencode");
    }
    assert.equal(f.calls.starts.length, 0);
  });
});

test("a temporary personal turn restricts steering without blocking the member's next shared mode", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("senior", "owner-plan");
    const input = { conversationId: "chat" };
    const member = { vibe64User: { username: "member", role: "member" } };
    const during = await f.service.readTemporaryConversation("one", input, member);
    assert.equal(during.canSteer, false);
    assert.equal(during.purposes.senior.available, true);
    assert.equal(during.purposes.senior.effectiveSelection.engineId, "opencode");
    await f.finish("Here is the plan.");
    const after = await f.service.readTemporaryConversation("one", input, member);
    assert.equal(after.canSteer, null);
    assert.equal(after.purposes.junior.available, true);
  });
});

test("temporary collaborator fallback and return retain both native histories and leave Main chat untouched", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    const main = (await f.store.readSession("one")).metadata;
    await f.send("junior", "first", "Implement the agreed design");
    await f.finish("Implemented the design in source files");
    const coderId = (await f.record()).providerConversationId;
    f.options.vibe64User = { role: "member", username: "member" };
    await f.send("junior", "second", "Explain the implementation");
    const backupId = (await f.record()).providerConversationId;
    assert.notEqual(coderId, backupId);
    assert.match(f.calls.starts[1].input.message, /Vibe64 conversation changeover/);
    assert.match(f.calls.starts[1].input.message, /Implemented the design in source files/);
    assert.doesNotMatch(f.calls.starts[1].input.message, /mainChatSentinel/);
    await f.finish("The design uses one validation function");
    f.restart();
    f.options.vibe64User = { role: "owner", username: "owner" };
    await f.send("junior", "third", "Add the agreed check");
    assert.equal((await f.record()).providerConversationId, coderId);
    assert.match(f.calls.starts[2].input.message, /continuing your existing codex conversation/);
    assert.match(f.calls.starts[2].input.message, /The design uses one validation function/);
    const record = await f.record();
    assert.deepEqual(Object.keys(record.nativeBindings).sort(), ["codex", "opencode"]);
    assert.equal(record.nativeBindings.codex.conversationId, coderId);
    assert.equal(record.nativeBindings.opencode.conversationId, backupId);
    assert.equal(JSON.parse(record.routingMetadata.assistant_routing).workflowEngineId, "codex");
    assert.equal(f.manager.binding("one"), "codex");
    assert.equal(f.manager.binding("one", { routingConversationId: "chat" }), "codex");
    assert.deepEqual((await f.store.readSession("one")).metadata, main);
    assert.equal((await f.store.readConversationLog("one")).length, 0);
    const turns = await f.store.readConversationLog({ sessionId: "one", conversationId: "chat" });
    assert.deepEqual(turns.filter((turn) => turn.user).map((turn) => turn.user.text),
      ["Implement the agreed design", "Explain the implementation", "Add the agreed check"]);
    assert.deepEqual(turns.filter((turn) => turn.user).map((turn) => turn.metadata.assistantSelection.engineId), ["codex", "opencode", "codex"]);
  });
});

test("temporary replies retain their routed identity across multiple native messages and restoration", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "member" }, true);
    const main = (await f.store.readSession("one")).metadata;
    await f.send("junior", "member-code");
    const record = await f.record();
    const row = f.native.get(record.providerConversationId);
    row.messages.push({ role: "assistant", id: "code-start", text: "I am implementing it.", complete: true });
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    row.messages.push({ role: "thinking", id: "code-progress", text: "Checking the changed file.", complete: true });
    await f.finish("Implemented the file.");
    assert.equal(f.calls.starts.length, 1, "direct Junior never starts a reviewer");
    await f.send("senior", "member-senior", "Explain your findings.");
    row.messages.push({ role: "assistant", id: "review-start", text: "I am reviewing it.", complete: true });
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    row.messages.push({ role: "thinking", id: "review-progress", text: "Checking the result.", complete: true });
    await f.finish("Reviewed the file.");
    const snapshot = (await f.restart().listTemporaryConversations("one", f.options)).conversations[0];
    const codeIds = ["member-code", "code-start", "code-progress", "reply-turn-1"];
    const reviewIds = ["review-start", "review-progress", "reply-turn-2"];
    for (const id of [...codeIds, ...reviewIds]) {
      const message = snapshot.messages.find((message) => message.id === id);
      assert.ok(message, id);
      assert.equal(message.assistantSelection.engineId, "opencode", id);
      assert.equal(message.assistantSelection.modelId, "big-pickle", id);
      assert.equal(message.assistantRouting.resolvedMode, codeIds.includes(id) ? "junior" : "senior", id);
    }
    assert.equal(f.calls.starts.length, 2);
    assert.deepEqual((await f.store.readSession("one")).metadata, main);
    assert.deepEqual(await f.store.readConversationLog("one"), []);
  });
});

test("a temporary direct Junior read observes completion without starting review", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "collaborator" }, true);
    await f.send("junior", "polled-code");
    const record = await f.record();
    const row = f.native.get(record.providerConversationId);
    row.status = "completed";
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    assert.equal(f.calls.starts.length, 1);
    await f.service.afterTemporaryTurn("one", { conversationId: row.id,
      temporaryRun: { active: false, state: "completed", providerTurnId: record.runId } }, f.options);
    assert.equal(f.calls.starts.length, 1);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).status, "complete");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
  });
});

for (const role of ["owner", "member"]) {
  test(`temporary ${role} direct Junior keeps questions and answers with Junior without automatic review`, async () => {
    await withTemporaryRoot(async (root) => {
      const f = await temporaryChangeoverFixture(root, { role, username: role }, true);
      await f.send("junior", "needs-decision");
      const question = "[1] Should persistence stay in this browser or be shared?";
      await f.finish(question);
      assert.equal(f.calls.starts.length, 1);
      const waiting = await f.record();
      assert.equal(JSON.parse(waiting.routingMetadata.assistant_routing_request).reviewStatus, undefined);
      const restored = await f.restart().readTemporaryConversation("one", { conversationId: "chat" }, f.options);
      assert.equal(restored.messages.at(-1).text, question);
      assert.equal(restored.assistantSelection.modelId, waiting.assistantSelection.modelId);
      assert.equal(f.calls.starts.length, 1);
      await f.send("junior", "decision-answer", "Keep it in this browser.");
      await f.finish("Implemented and checked.");
      assert.equal(f.calls.starts.length, 2);
      assert.match(f.calls.starts[1].input.message, /Vibe64 role: Junior/);
      assert.equal((await f.store.readConversationLog("one")).length, 0);
    });
  });
}

test("temporary HTTP direct Junior input records its actor and never starts a review", async () => {
  await withTemporaryRoot(async (root) => {
    const member = { role: "member", username: "collaborator" };
    const f = await temporaryChangeoverFixture(root, member, true);
    await f.service.updateTemporaryConversation("one", { conversationId: "chat", assistantRouting: { mode: "junior", review: true } }, f.options);
    await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "http-member-code", message: "Implement the agreed design", vibe64User: member
    });
    assert.deepEqual(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).submittedBy, member);
    assert.equal(f.calls.starts[0].selection.engineId, "opencode");
    f.options.vibe64User = { role: "owner", username: "owner" };
    await f.finish("Implemented using the shared AI");
    assert.equal(f.calls.starts.length, 1);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).review, false);
    assert.deepEqual(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).submittedBy, member);
  });
});

test("a member can use direct Junior and Senior through the same foreign Backup without automatic review", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "collaborator" }, true);
    await f.send("junior", "member-code", "Implement the agreed design");
    const id = (await f.record()).providerConversationId;
    assert.equal(f.calls.starts[0].selection.engineId, "opencode");
    assert.equal(f.manager.binding("one"), "codex");
    assert.equal(f.manager.binding("one", { routingConversationId: "chat" }), "opencode");
    await f.finish("Implemented using the shared AI");
    assert.equal(f.calls.starts.length, 1);
    await f.send("senior", "member-plan", "Discuss the next change");
    assert.equal(f.calls.starts[1].conversationId, id);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing).workflowEngineId, "codex");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
  });
});

test("temporary changeover stops before selection changes and Close retries only retained native histories", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("junior", "first");
    await f.finish("Done");
    const original = await f.record();
    f.failures.stop = original.providerConversationId;
    f.options.vibe64User = { role: "member", username: "member" };
    await assert.rejects(f.send("junior", "second"), /stop not confirmed/);
    const failed = await f.record();
    assert.equal(failed.providerConversationId, original.providerConversationId);
    assert.deepEqual(failed.assistantSelection, original.assistantSelection);
    assert.equal(f.native.size, 1);
    f.failures.stop = "";
    await f.service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "second", message: "Request second" }, f.options);
    const sharedId = (await f.record()).providerConversationId;
    f.failures.delete = sharedId;
    await assert.rejects(f.service.deleteTemporaryConversation("one", { conversationId: "chat" }, f.options), /deletion not confirmed/);
    const closing = await f.record();
    assert.equal(closing.state, "closing");
    assert.deepEqual(Object.keys(closing.nativeBindings), ["opencode"]);
    f.failures.delete = "";
    await f.restart().deleteTemporaryConversation("one", { conversationId: "chat" }, f.options);
    assert.equal(await f.record(), null);
    assert.deepEqual(f.calls.deletes, [original.providerConversationId, sharedId, sharedId]);
    assert.equal(f.manager.binding("one"), "codex");
    assert.equal(f.manager.binding("one", { routingConversationId: "chat" }), "");
  });
});

test("temporary foreign delivery recovers its exact receipt after restart without sending twice", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("junior", "first");
    await f.finish("Done");
    f.failures.loseAdmission = true;
    f.options.vibe64User = { role: "member", username: "member" };
    await assert.rejects(f.send("junior", "second"), /Lost native admission reply/);
    const pending = await f.record();
    assert.equal(JSON.parse(pending.routingMetadata.assistant_routing_request).delivery, "uncertain");
    f.failures.loseAdmission = false;
    f.failures.read = false;
    assert.equal(f.native.get(pending.providerConversationId).status, "inProgress");
    const recovered = await f.restart().startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "second", message: "Request second" }, f.options);
    assert.equal(recovered.delivered, true);
    assert.equal(f.calls.starts.length, 2);
    const turns = await f.store.readConversationLog({ sessionId: "one", conversationId: "chat" });
    assert.equal(turns.filter((turn) => turn.user?.messageId === "second").length, 1);
  });
});

for (const pinned of [false, true]) {
  test(`temporary Codex routing rejects unsupported retained bindings before changing native ownership (pinned: ${pinned})`, async () => {
    await withTemporaryRoot(async (root) => {
      const f = await temporaryChangeoverFixture(root);
      await f.send("junior", "original");
      await f.finish("Original provider history");
      const original = await f.record();
      f.options.vibe64User = { role: "member", username: "member" };
      await f.send("junior", "explain");
      await f.finish("Explanation from shared backup");
      f.options.vibe64User = { role: "owner", username: "owner" };
      const record = await f.record();
      const routingMetadata = { ...record.routingMetadata };
      if (!pinned) delete routingMetadata.codex_routing_home_provider;
      const changeover = JSON.parse(routingMetadata.assistant_changeover);
      changeover.engines["codex/deepseek"] = changeover.engines.codex;
      delete changeover.engines.codex;
      routingMetadata.assistant_changeover = JSON.stringify(changeover);
      const nativeBindings = { ...record.nativeBindings, "codex/deepseek": record.nativeBindings.codex };
      delete nativeBindings.codex;
      await f.store.writeSessionConversation("one", "chat", { routingMetadata, nativeBindings });
      const stops = [...f.calls.stops];
      for (const mode of ["senior", "junior"]) {
        await assert.rejects(f.send(mode, `return-${mode}`), {
          code: "vibe64_codex_history_unsupported",
          statusCode: 409,
          message: /Start a new temporary chat/
        });
        const after = await f.record();
        assert.deepEqual(after.assistantSelection, record.assistantSelection);
        assert.equal(after.providerConversationId, record.providerConversationId);
        assert.deepEqual(after.nativeBindings, nativeBindings);
        assert.equal(after.routingMetadata.codex_routing_home_provider, routingMetadata.codex_routing_home_provider);
        assert.equal(after.routingMetadata.assistant_changeover, routingMetadata.assistant_changeover);
        assert.deepEqual(f.calls.stops, stops);
        assert.equal(f.calls.starts.length, 2);
        assert.deepEqual(f.calls.deletes, []);
        assert.equal(f.native.size, 2);
        assert.ok(f.native.has(original.providerConversationId));
      }
    });
  });
}

test("ordinary temporary chats start in Senior with review off and retain their parent's workflow", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "auto", review: true, workflowEngineId: "codex" }));
    await f.service.createTemporaryConversation("one", { conversationId: "plan-chat" });
    const record = await f.store.readSessionConversation("one", "plan-chat");
    assert.deepEqual(JSON.parse(record.routingMetadata.assistant_routing), { mode: "senior", review: false, workflowEngineId: "codex" });
    await f.service.startTemporaryConversationTurn("one", { conversationId: "plan-chat", messageId: "discuss", message: "Discuss the design" });
    assert.match(f.native.lastInput.message, /Vibe64 role: Senior/);
    assert.equal(JSON.parse((await f.store.readSessionConversation("one", "plan-chat")).routingMetadata.assistant_routing_request).review, false);
  });
});

test("temporary chats inherit Main's role and custom model; Auto becomes Senior", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const override = resolveVibe64AssistantSelection(f.capabilities, { ...f.selection, catalogRevision: f.capabilities.revision, modelId: "chosen", variantId: "ultra" });
    const routingPath = path.join(root, "ai-connections", "routing.json");
    const savedRouting = JSON.parse(await readFile(routingPath, "utf8"));
    const oldSettings = JSON.stringify({ ...savedRouting, temporaryChatRole: "junior" });
    await writeFile(routingPath, oldSettings);
    for (const mode of ["senior", "junior", "auto"]) {
      const preferences = { mode, review: true, workflowEngineId: "codex", ...(mode === "auto" ? {} : { override }) };
      await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify(preferences));
      const parent = await f.store.readSession("one");
      const created = await f.service.createTemporaryConversation("one", { conversationId: mode });
      assert.deepEqual(JSON.parse(created.routingMetadata.assistant_routing), {
        ...preferences, mode: mode === "auto" ? "senior" : mode, review: false
      });
      assert.deepEqual((await f.store.readSession("one")).metadata, parent.metadata);
      assert.equal(created.providerConversationId, "");
    }
    assert.equal(await readFile(routingPath, "utf8"), oldSettings, "creation ignores the retired setting without rewriting it");
    await f.service.startTemporaryConversationTurn("one", { conversationId: "junior", messageId: "hello", message: "Explain the project" });
    assert.equal(f.native.turnSelection.modelId, "chosen");
    assert.equal(f.native.turnSelection.variantId, "ultra");
    assert.match(f.native.lastInput.message, /Vibe64 role: Junior/);
    assert.match(f.native.lastInput.message, /Unrelated requests do not need a plan and must leave existing plans unchanged/);
    assert.deepEqual(await f.store.readConversationLog("one"), []);
  });
});

test("inherited temporary choices stay independent across Main changes and restart", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "junior", review: false, workflowEngineId: "codex" }));
    const first = await f.service.createTemporaryConversation("one", { conversationId: "first" });
    await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "senior", review: false, workflowEngineId: "codex" }));
    const service = f.restart();
    const restored = await service.readTemporaryConversation("one", { conversationId: "first" });
    assert.deepEqual(restored.routingMetadata, first.routingMetadata);
    const second = await service.createTemporaryConversation("one", { conversationId: "second" });
    assert.equal(JSON.parse(second.routingMetadata.assistant_routing).mode, "senior");
    const changed = await service.updateTemporaryConversation("one", { conversationId: "first", assistantRouting: { mode: "senior", review: true } });
    assert.deepEqual(JSON.parse(changed.routingMetadata.assistant_routing), { mode: "senior", review: false, workflowEngineId: "codex" });
    await assert.rejects(service.updateTemporaryConversation("one", { conversationId: "first", assistantRouting: { useWorkspaceDefault: true } }), /Choose Custom, Senior, Junior, or Auto/);
    await assert.rejects(service.updateTemporaryConversation("one", { conversationId: "first", assistantRouting: { mode: "helper" } }), /Choose Custom, Senior, Junior, or Auto/);
    const explicit = await service.createTemporaryConversation("one", { conversationId: "generated", assistantRouting: { mode: "junior" } });
    assert.equal(JSON.parse(explicit.routingMetadata.assistant_routing).mode, "junior");
    const repair = await service.createTemporaryConversation("one", { conversationId: "repair", presentation: { recoveryOperation: "update" } });
    assert.equal(JSON.parse(repair.routingMetadata.assistant_routing).mode, "senior");
  });
});

test("a Main chat without routing preferences passes its exact AI into a new temporary chat", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const created = await f.service.createTemporaryConversation("one", { conversationId: "legacy-main" });
    const preferences = JSON.parse(created.routingMetadata.assistant_routing);
    assert.equal(preferences.mode, "senior");
    assert.equal(preferences.override.modelId, f.selection.modelId);
    assert.equal(preferences.override.variantId, f.selection.variantId);
    assert.equal(preferences.workflowEngineId, f.selection.engineId);
  });
});


test("existing idle merge repairs use Senior without rewriting saved preferences on read", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.store.writeSessionConversation("one", "chat", { recoveryOperation: "update" });
    const before = await f.record();
    const observed = await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    assert.equal(JSON.parse(observed.routingMetadata.assistant_routing).mode, "senior");
    assert.deepEqual((await f.record()).routingMetadata, before.routingMetadata);
    await assert.rejects(f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "junior" } }, f.options), /always use Senior/);
    const started = await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "repair", message: "Resolve this merge while preserving both changes."
    }, f.options);
    assert.notEqual(started.ok, false, JSON.stringify(started));
    assert.equal(f.calls.starts[0].selection.modelId, "gpt-6-astra");
    assert.match(f.calls.starts[0].input.message, /Vibe64 role: Senior/);
    assert.equal(f.calls.starts[0].input.turnMetadata.assistantRouting.resolvedMode, "senior");
    assert.equal((await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "custom", override: f.helper } }, f.options)).ok, true);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing).override.modelId, f.helper.modelId);
    assert.equal(f.calls.starts.length, 1, "Saving the next repair model does not start another turn");
    assert.deepEqual(f.calls.stops, []);
    await f.service.stopTemporaryConversation("one", { conversationId: "chat" }, f.options);
    await f.service.close();
  });
});

test("a repair can move to a chosen Codex model after Stop and retains history, instructions and Senior role", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    const main = (await f.store.readSession("one")).metadata;
    await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "custom", override: f.helper } }, f.options);
    await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "original", message: "Preserve the booking validation while repairing this merge."
    }, f.options);
    // Existing active repairs from before this policy retain their native turn until Stop.
    await f.store.writeSessionConversation("one", "chat", { recoveryOperation: "update", recoveryContext: "Keep both versions' validation." });
    await assert.rejects(f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "steer-old", message: "Continue"
    }, f.options), /Stop the running turn/);
    await f.service.stopTemporaryConversation("one", { conversationId: "chat" }, f.options);
    const changed = await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "custom", override: f.senior } }, f.options);
    const preferences = JSON.parse(changed.routingMetadata.assistant_routing);
    assert.equal(preferences.mode, "senior");
    assert.equal(preferences.workflowEngineId, "codex");
    assert.equal(preferences.override.modelId, "gpt-6-astra");
    assert.equal((await f.record()).recoveryContext, "Keep both versions' validation.");
    const result = await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "take-over", message: "Check the merge and finish it correctly."
    }, f.options);
    assert.notEqual(result.ok, false, JSON.stringify(result));
    assert.equal(f.calls.starts[1].selection.engineId, "codex");
    assert.equal(f.calls.starts[1].selection.modelId, "gpt-6-astra");
    assert.match(f.calls.starts[1].input.message, /Preserve the booking validation/);
    assert.match(f.calls.starts[1].input.message, /Vibe64 role: Senior/);
    assert.equal((await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options)).messages.filter(message => message.role === "user").length, 2);
    assert.deepEqual((await f.store.readSession("one")).metadata, main);
    await f.service.stopTemporaryConversation("one", { conversationId: "chat" }, f.options);
    await f.service.close();
  });
});

test("an old pending Junior repair cannot be resumed by polling or retry", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("junior", "previous");
    await f.service.stopTemporaryConversation("one", { conversationId: "chat" }, f.options);
    const record = await f.record();
    const request = JSON.parse(record.routingMetadata.assistant_routing_request);
    Object.assign(request, { messageId: "old-unsent", status: "working", delivery: "sending", stopped: false, attemptedMessageId: "",
      input: { message: "Repair the merge.", displayMessage: "Repair the merge." } });
    await f.store.writeSessionConversation("one", "chat", { recoveryOperation: "update", routingMetadata: {
      ...record.routingMetadata, assistant_routing_request: JSON.stringify(request)
    } });
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    await assert.rejects(f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "old-unsent", message: "Repair the merge."
    }, f.options), /require Senior/);
    assert.equal(f.calls.starts.length, 1);
    await f.service.close();
  });
});

test("temporary Custom changes orchestrator with conversation context and leaves Main unchanged", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "owner", username: "owner" });
    const main = (await f.store.readSession("one")).metadata;
    await f.send("senior", "first", "Remember the bicycle is blue.");
    await f.finish("The bicycle is blue.");
    const changed = await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "custom", override: f.helper } }, f.options);
    assert.equal(JSON.parse(changed.routingMetadata.assistant_routing).workflowEngineId, "opencode");
    assert.equal(changed.purposes.custom.available, true);
    const result = await f.service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "custom", message: "What colour is it?" }, f.options);
    assert.notEqual(result.ok, false, JSON.stringify(result));
    assert.equal(f.calls.starts[1].selection.engineId, "opencode");
    assert.match(f.calls.starts[1].input.message, /bicycle is blue/);
    assert.deepEqual((await f.store.readSession("one")).metadata, main);
  });
});

test("temporary canonical facade uses the original logical record, actions, stream and exact native receipts", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    const user = { username: "owner", role: "owner" };
    const project = { slug: "unit_project" };
    const accepted = new Set();
    const actionCalls = [];
    let allowed = true;
    let readFailure = false;
    let revokeDuringRead = false;
    let onEvent;
    let common;
    let definitions;
    const actions = { async execute({ actionId, input, context }) {
      if (!allowed) throw Object.assign(new Error("Access revoked"), { code: "conversation_forbidden" });
      if (actionId === ACTION_READ_CONVERSATION_CONTEXT) {
        assert.deepEqual(input, { projectSlug: project.slug, sessionId: "one" });
        return { actor: { id: user.username }, user, project };
      }
      actionCalls.push({ actionId, input });
      return actionById(definitions, actionId).execute(input, { ...context, vibe64Action: { user, project } });
    } };
    const originalStart = f.sessionAgent.startConversationTurn;
    f.sessionAgent.startConversationTurn = async (id, input, options) => {
      onEvent = options.onEvent;
      const result = await originalStart(id, input, options);
      accepted.add(input.messageId);
      return result;
    };
    f.sessionAgent.readConversation = async (_id, input) => {
      if (readFailure) throw new Error("Native history unavailable");
      if (revokeDuringRead) allowed = false;
      return { ok: true, ...f.native, admitted: accepted.has(input.messageId) };
    };
    let service;
    common = createConversationRuntime({
      authorize: async ({ context, conversationId }) => allowed && context?.sessionId === conversationId,
      host: { conversation: ({ id, context }) => service.conversationBinding(id, context) }
    });
    service = f.restart({ actions, conversationRuntime: common, publishConversation: event => common.publishNative(event) });
    definitions = createTerminalActions({ terminals: service });
    const terminals = { ...service, openBrowserConversation() { throw new Error("Unexpected Main open"); },
      async openTemporaryBrowserConversation(sessionId, conversationId, options) {
        return common.open({ id: sessionId, context: { ...options, sessionId, temporaryConversationId: conversationId,
          runtime: f.runtime, session: await f.runtime.getSession(sessionId) } });
      }
    };
    const facade = createMainBrowserConversations({ actions, terminals });
    assert.ok(facade.conversationSelectionSchema.getFieldDefinitions().assistantRouting.schema.getFieldDefinitions().mode.enum.includes("auto"));
    assert.equal(facade.conversationDataSchema.getFieldDefinitions().planRevision.maxLength, undefined);
    const open = conversationId => facade.open({
      id: temporaryConversationId({ projectSlug: project.slug, sessionId: "one", conversationId }),
      context: { requestMeta: { request: { vibe64User: user } } }
    });
    await service.createTemporaryConversation("one", { conversationId: "chat", presentation: { draft: "Saved draft" } });
    await service.createTemporaryConversation("one", { conversationId: "peer" });
    const original = await f.store.readSessionConversation("one", "chat");
    const mainMetadata = (await f.runtime.getSession("one")).metadata;
    const browser = await open("chat");
    const peer = await open("peer");
    const first = await browser.read();
    assert.equal(first.segmentId, null);
    assert.equal(first.presentation.draft, "Saved draft");
    assert.equal(first.capabilities.goals, false);
    assert.equal(first.capabilities.wake, false);
    assert.equal(f.native.starts, 0);
    assert.deepEqual(await f.store.readSessionConversation("one", "chat"), original);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holding = f.store.runSessionExclusive("one", "agent-write-mode", async () => {
      entered.resolve(); await release.promise;
    });
    await entered.promise;
    try {
      const saved = await browser.read();
      assert.equal(saved.presentation.draft, "Saved draft");
      assert.equal(f.native.starts, 0);
      assert.deepEqual(await f.store.readSessionConversation("one", "chat"), original);
      allowed = false;
      await assert.rejects(browser.read(), /Access revoked|forbidden/i);
      allowed = true;
    } finally { release.resolve(); await holding; }
    await assert.rejects(browser.select({ assistantRouting: { mode: "auto" } }), /Auto is available in Main chat only/);
    const events = [];
    const peerEvents = [];
    await browser.subscribe(event => events.push(event));
    await peer.subscribe(event => peerEvents.push(event));
    const sent = await browser.send({ messageId: "canonical-input", text: "Change this file." });
    assert.equal(sent.delivered, true);
    assert.equal(f.native.lastInput.messageId, "canonical-input");
    assert.equal(actionCalls.find(call => call.actionId === ACTION_START_TEMPORARY_CONVERSATION_TURN).input.conversationId, "chat");
    assert.equal((await browser.send({ messageId: "canonical-input", text: "Change this file." })).delivered, true);
    assert.equal(f.native.starts, 1);
    await onEvent({ type: "message", threadId: "native", turnId: "turn-1",
      message: { messageId: "live-answer", outputId: "exact-output", role: "assistant", text: "Editing" } });
    const live = await browser.read();
    assert.equal(live.segmentId, "codex:native");
    assert.equal(live.streaming.messages[0].text, "Editing");
    assert.equal(live.conversationLog[0].user.receipt, undefined);
    assert.equal(peerEvents.length, 0);
    assert.equal((await peer.read()).segmentId, null);
    f.native.messages = [{ id: "saved-answer", outputId: "exact-output", role: "assistant", text: "Edited.", complete: true }];
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { active: false, state: "completed", providerTurnId: "turn-1" } });
    assert.ok(events.some(event => event.type === "transcript" && event.patch.turn.assistant?.text === "Edited."));
    assert.ok(events.some(event => event.type === "message-complete" && !event.streaming.messages.length));
    const completed = await browser.read();
    assert.equal(completed.streaming.messages.length, 0);
    assert.equal(completed.conversationLog[0].assistant.messageId, "saved-answer");
    assert.equal((await browser.inspectDelivery({ messageId: "canonical-input" })).turnId, completed.conversationLog[0].turnId);
    accepted.add("native-only");
    const nativeOnly = await browser.inspectDelivery({ messageId: "native-only" });
    assert.equal(nativeOnly.status, "accepted");
    assert.equal(Object.hasOwn(nativeOnly, "turnId"), false);
    readFailure = true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal((await browser.inspectDelivery({ messageId: "unknown" })).status, "unknown");
    }
    assert.equal(f.native.starts, 1);
    readFailure = false;
    await browser.cancel();
    await browser.select({ assistantRouting: { mode: "junior" } });
    assert.equal(f.native.starts, 1);
    assert.equal((await f.store.readConversationLog({ sessionId: "one", conversationId: "chat" })).length, 1);
    assert.deepEqual((await f.runtime.getSession("one")).metadata, mainMetadata);
    assert.deepEqual(await f.store.readConversationLog("one"), []);
    revokeDuringRead = true;
    await assert.rejects(browser.read(), error => error.code === "conversation_forbidden");
    revokeDuringRead = false;
    const beforeRevokedPublication = events.length;
    await service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { title: "Changed privately" } });
    assert.equal(events.length, beforeRevokedPublication, "each publication rechecks the retained reader's access");
    allowed = true;
    await service.updateTemporaryConversation("one", { conversationId: "chat", presentation: { title: "Still requires a new subscription" } });
    assert.equal(events.length, beforeRevokedPublication, "a revoked subscriber is removed rather than revived");
    await common.close();
    assert.ok(await f.store.readSessionConversation("one", "chat"));
    assert.equal(f.native.deletes, 0);
    await service.close();
  });
});

test("temporary canonical inspection recovers the original foreign receipt before clearing its pending journal", async () => {
  await withTemporaryRoot(async root => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("junior", "first");
    await f.finish("Done");
    f.failures.loseAdmission = true;
    f.options.vibe64User = { role: "member", username: "member" };
    await assert.rejects(f.send("junior", "second"), /Lost native admission reply/);
    const pending = await f.record();
    const sourceState = JSON.parse(pending.routingMetadata.assistant_changeover);
    assert.equal(sourceState.engines.opencode.pending.messageId, "second");
    const restored = f.restart();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.deepEqual(await restored.inspectTemporaryConversationDelivery("one", {
        conversationId: "chat", messageId: "second"
      }, f.options), { status: "unknown", messageId: "second" });
    }
    assert.equal(f.calls.starts.length, 2);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_changeover).engines.opencode.pending.messageId, "second");
    f.failures.loseAdmission = false;
    f.failures.read = false;
    const writeRecord = f.store.writeSessionConversation;
    let checkedClear = false;
    f.store.writeSessionConversation = async (sessionId, conversationId, patch) => {
      if (patch.routingMetadata?.assistant_changeover &&
          !JSON.parse(patch.routingMetadata.assistant_changeover).engines.opencode.pending) {
        const turns = await f.store.readConversationLog({ sessionId, conversationId });
        assert.equal(turns.filter(turn => turn.user?.messageId === "second").length, 1);
        checkedClear = true;
      }
      return writeRecord(sessionId, conversationId, patch);
    };
    const recovered = await restored.inspectTemporaryConversationDelivery("one", {
      conversationId: "chat", messageId: "second"
    }, f.options);
    assert.equal(recovered.status, "accepted");
    assert.equal(typeof recovered.turnId, "string");
    assert.equal(checkedClear, true);
    assert.equal(f.calls.starts.length, 2);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_changeover).engines.opencode.pending, undefined);
    await restored.close();
  });
});


test("missed completion stays deferred during source work and reconciles once after release", { timeout: 5000 }, async () => {
  await withTemporaryRoot(async root => {
    const f = await temporaryChangeoverFixture(root);
    await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "original", message: "Explain the booking validation."
    }, f.options);
    f.native.get((await f.record()).providerConversationId).status = "completed";
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const completed = Promise.withResolvers();
    const originalWrite = f.store.writeSessionConversation;
    let completions = 0;
    f.store.writeSessionConversation = async (...args) => {
      const result = await originalWrite(...args);
      if (JSON.parse(result.routingMetadata?.assistant_routing_request || "null")?.status === "complete") {
        completions += 1; completed.resolve();
      }
      return result;
    };
    const holding = f.store.runSessionExclusive("one", "agent-write-mode", async () => {
      entered.resolve(); await release.promise;
    });
    await entered.promise;
    try {
      for (let read = 0; read < 3; read++) {
        const saved = await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
        assert.equal(saved.deferredReconciliation, true);
      }
      assert.equal(completions, 0);
      assert.equal(f.calls.starts.length, 1);
    } finally { release.resolve(); await holding; }
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    await completed.promise;
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    assert.equal(completions, 1);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).messageId, "original");
    assert.equal(f.calls.starts.length, 1);
    await f.service.close();
  });
});

test("temporary repair model preferences survive recovered completion in either write order", async (t) => {
  for (const order of ["preferences-first", "completion-first"]) await t.test(order, async () => {
    await withTemporaryRoot(async (root) => {
      const f = await temporaryChangeoverFixture(root);
      const main = (await f.store.readSession("one")).metadata;
      await f.service.updateTemporaryConversation("one", { conversationId: "chat",
        assistantRouting: { mode: "custom", override: f.helper } }, f.options);
      await f.service.startTemporaryConversationTurn("one", {
        conversationId: "chat", messageId: "original", message: "Preserve the booking validation."
      }, f.options);
      await f.store.writeSessionConversation("one", "chat", { recoveryOperation: "update" });
      // Native completion was missed; leave the accepted request for read recovery.
      f.native.get((await f.record()).providerConversationId).status = "completed";
      assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).status, "working");

      const preferencesWritten = Promise.withResolvers();
      const completionWritten = Promise.withResolvers();
      const writes = [];
      let exclusiveCalls = 0;
      let recovery;
      let reading;
      let updating;
      let accessHeld = false;
      const bounded = async (promise, label) => {
        let timer;
        try {
          return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Did not reach ${label} in ${order}`)), 5000);
          })]);
        } finally { clearTimeout(timer); }
      };
      const writeRecord = f.store.writeSessionConversation;
      const exclusive = f.store.runSessionExclusive;
      const requireAccess = f.sessionAgent.requireAssistantAccessForSelection;
      f.store.writeSessionConversation = async (...args) => {
        const result = await writeRecord(...args);
        const preferences = JSON.parse(result.routingMetadata?.assistant_routing || "null");
        const request = JSON.parse(result.routingMetadata?.assistant_routing_request || "null");
        if (request?.messageId === "original") {
          if (preferences?.mode === "senior" && preferences.override?.modelId === f.senior.modelId && !writes.includes("preferences")) {
            writes.push("preferences"); preferencesWritten.resolve();
          }
          if (request.status === "complete" && !writes.includes("completion")) {
            writes.push("completion"); completionWritten.resolve();
          }
        }
        return result;
      };
      f.store.runSessionExclusive = (...args) => {
        if (args[1] !== "agent-write-mode" || ++exclusiveCalls !== 2) return exclusive(...args);
        // The read's snapshot is the second admission. Hold it before entering
        // the existing lock, never while owning the metadata mutation.
        recovery = (async () => {
          if (order === "preferences-first") await bounded(preferencesWritten.promise, "preferences write");
          return exclusive(...args);
        })();
        return recovery;
      };
      f.sessionAgent.requireAssistantAccessForSelection = async (...args) => {
        await requireAccess(...args);
        if (order === "completion-first" && args[0].modelId === f.senior.modelId) {
          accessHeld = true;
          // The normal access check precedes the update's final persistence.
          await bounded(completionWritten.promise, "completion write");
        }
      };
      try {
        reading = f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
        updating = f.service.updateTemporaryConversation("one", { conversationId: "chat",
          assistantRouting: { mode: "custom", override: f.senior } }, f.options);
        const changed = await updating;
        await bounded(completionWritten.promise, "completion write");
        await recovery;
        assert.ok(recovery, "the concurrent read recovered the missed completion");
        assert.deepEqual(writes, order === "preferences-first" ? ["preferences", "completion"] : ["completion", "preferences"]);
        assert.equal(accessHeld, order === "completion-first");
        const saved = await f.record();
        const preferences = JSON.parse(saved.routingMetadata.assistant_routing);
        assert.equal(preferences.mode, "senior");
        assert.equal(preferences.workflowEngineId, "codex");
        assert.equal(preferences.override.modelId, f.senior.modelId);
        assert.deepEqual(JSON.parse(changed.routingMetadata.assistant_routing), preferences);
        assert.equal(JSON.parse(saved.routingMetadata.assistant_routing_request).status, "complete");
        if (order === "completion-first") {
          assert.equal(JSON.parse(changed.routingMetadata.assistant_routing_request).status, "complete");
        }
        assert.equal(f.calls.starts.length, 1, "completion recovery does not start another turn");
        assert.deepEqual((await f.store.readSession("one")).metadata, main);
      } finally {
        preferencesWritten.resolve(); completionWritten.resolve();
        await Promise.allSettled([updating, reading, recovery].filter(Boolean));
        f.store.writeSessionConversation = writeRecord;
        f.store.runSessionExclusive = exclusive;
        f.sessionAgent.requireAssistantAccessForSelection = requireAccess;
        await f.service.close();
      }
    });
  });
});


test("temporary context captures forty visible messages once, without reasoning or native goal scaffolding", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    for (let i = 0; i < 22; i++) {
      await f.store.writeConversationUserMessage("one", { text: `Question ${i}`, messageId: `main-${i}` });
      await f.store.writeConversationAssistantMessage("one", { text: `Answer ${i}` });
    }
    await f.store.writeConversationThinkingMessage("one", { text: "PRIVATE REASONING" });
    await f.store.writeConversationCommentaryMessage("one", { text: "Visible progress" });
    await f.store.writeConversationUserMessage("one", {
      text: `/goal ${assistantModePrompt("junior", "Keep my authored objective")}`, messageId: "goal"
    });
    const parentBefore = await f.store.readConversationLog("one");
    const created = await f.service.createTemporaryConversation("one", { conversationId: "context", includeRecentChatContext: true });
    const snapshot = created.recentChatContext;
    assert.equal(snapshot.messages.length, 40);
    assert.equal(snapshot.messages[0].text, "Question 3");
    assert.equal(snapshot.messages.at(-2).text, "Visible progress");
    assert.equal(snapshot.messages.at(-1).text, "/goal Keep my authored objective");
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE REASONING"));
    assert.ok(!JSON.stringify(snapshot).includes("Vibe64 role"));
    assert.deepEqual(await f.store.readConversationLog("one"), parentBefore);
    assert.deepEqual(await f.store.readConversationLog({ sessionId: "one", conversationId: "context" }), []);
    await f.store.writeConversationAssistantMessage("one", { text: "Later Main reply" });
    const retry = await f.service.createTemporaryConversation("one", { conversationId: "context", includeRecentChatContext: true });
    assert.deepEqual(retry.recentChatContext, snapshot);
    const ordinary = await f.service.createTemporaryConversation("one", { conversationId: "empty" });
    assert.equal(ordinary.recentChatContext, undefined);
    await f.service.startTemporaryConversationTurn("one", { conversationId: "context", messageId: "ask", message: "Explain that progress" });
    assert.match(f.native.lastInput.message, /Question 3/);
    assert.match(f.native.lastInput.message, /Visible progress/);
    assert.ok(!f.native.lastInput.message.includes("Later Main reply"));
    assert.ok(!f.native.lastInput.message.includes("PRIVATE REASONING"));
    const log = await f.store.readConversationLog({ sessionId: "one", conversationId: "context" });
    assert.equal(log.length, 1);
    assert.equal(log[0].user.text, "Explain that progress");
    await f.service.close();
  });
});

test("temporary context is UTF-8 bounded and reports omitted older text", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    await f.store.writeConversationUserMessage("one", { text: "Old "+"🐨".repeat(30000), messageId: "big" });
    await f.store.writeConversationAssistantMessage("one", { text: "Most recent answer" });
    const created = await f.service.createTemporaryConversation("one", { conversationId: "bounded", includeRecentChatContext: true });
    assert.equal(created.recentChatContext.truncated, true);
    assert.equal(created.recentChatContext.messages.at(-1).text, "Most recent answer");
    assert.ok(created.recentChatContext.messages.reduce((total, message) => total + Buffer.byteLength(message.text), 0) <= 64 * 1024);
    assert.ok(created.recentChatContext.messages.every(message => !message.text.includes("�")));
    await f.service.close();
  });
});


test("temporary context uses existing visible goal and integration projections", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    const objective = assistantModePrompt("junior", "Keep writing my report");
    await f.store.writeConversationUserMessage("one", { text: "My own instructions remain verbatim", messageId: "authored", turnMetadata: { engineId: "claude" } });
    await f.store.writeConversationCommentaryMessage("one", { text: `Goal active: ${objective} (3 turns)` });
    await f.store.writeConversationAssistantMessage("one", { text: `Goal cleared: ${objective}` });
    await f.store.writeConversationCommentaryMessage("one", { text: "No goal set", data: {
      native: { engineId: "claude", type: "system", subtype: "local_command_output" }
    } });
    await f.store.writeConversationAssistantMessage("one", { text: "Goal set: ordinary authored explanation" });
    await f.store.writeConversationUserMessage("one", { text: `/goal ${objective}`, messageId: "admitted-goal",
      turnMetadata: { engineId: "claude", upstreamMessageId: "native-goal" } });
    await f.store.writeConversationAssistantMessage("one", { text: "I will continue writing the report." });
    await f.store.writeConversationUserMessage("one", { text: "Please configure the integration", messageId: "integration" });
    await f.store.writeConversationAssistantMessage("one", { text: 'Configure this connection.\n```vibe64-integration\n{"integrationId":"private-slot"}\n```' });
    await f.store.writeConversationSystemMessage("one", { text: "INTERNAL SYSTEM TEXT" });
    const created = await f.service.createTemporaryConversation("one", { conversationId: "visible", includeRecentChatContext: true });
    assert.deepEqual(created.recentChatContext.messages.map(message => message.text), [
      "My own instructions remain verbatim", "Goal set: ordinary authored explanation",
      "I will continue writing the report.", "Please configure the integration", "Configure this connection."
    ]);
    await f.service.close();
  });
});


test("temporary context follows visible chronology across interleaved native turns", async () => {
  await withTemporaryRoot(async root => {
    const f = await conversationFixture(root);
    await f.store.writeConversationUserMessage("one", { text: "Start the report", messageId: "first", at: "2026-10-16T01:00:00.000Z" });
    await f.store.writeConversationAssistantMessage("one", { text: "The final result", at: "2026-10-16T01:00:03.000Z" });
    await f.store.writeConversationUserMessage("one", { text: "Include this correction", messageId: "steer", at: "2026-10-16T01:00:02.000Z" });
    const created = await f.service.createTemporaryConversation("one", { conversationId: "chronology", includeRecentChatContext: true });
    assert.deepEqual(created.recentChatContext.messages.map(message => message.text), [
      "Start the report", "Include this correction", "The final result"
    ]);
    await f.service.close();
  });
});
