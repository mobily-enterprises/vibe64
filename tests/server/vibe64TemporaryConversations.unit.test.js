import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveVibe64AssistantSelection, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS } from "@local/vibe64-runtime/shared";
import { createSessionConversations } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
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
  await routingStore.write({ [engineId]: { plan: role, code: role, economy: role, router: role } }, 0);
  const manager = createSessionAgentManager({ providers: [{ id: engineId, transportId: capabilities.transportId, capabilities: async () => capabilities }],
    readRoutingConfiguration: () => routingStore.read(),
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "fixture-connection" }) });
  Object.assign(sessionAgent, { resolveAssistantPurpose: (input, options) => manager.resolveAssistantPurpose(input, options),
    requireAssistantAccessForSelection: async () => {} });
  const events = [];
  const restart = (overrides = {}) => createSessionConversations({
    systemRoot: root,
    sessionAgent,
    attachments,
    prepareAgentSkills: async () => {},
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
  return { attachments, events, native, restart, service: restart(), runtime, store, selection, sessionAgent, capabilities };
}

test("temporary Auto planning, approval, review and Deslop retain the native conversation without changing main chat", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const role = (modelId) => ({ ...resolveVibe64AssistantSelection(f.capabilities, { ...f.selection, modelId, catalogRevision: f.capabilities.revision }), selectionSource: "explicit" });
    await createAssistantRoutingStore({ systemRoot: root }).write({ codex: {
      plan: role("gpt-6-astra"), code: role("chosen"), economy: role("main-model"), router: role("main-model")
    } }, 1);
    const admitted = new Set();
    const starts = [];
    const start = f.sessionAgent.startConversationTurn;
    const manager = createSessionAgentManager({ providers: [{ id: "codex", transportId: "codex_app_server",
      capabilities: async () => f.capabilities }],
      readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "fixture-connection" }) });
    Object.assign(f.sessionAgent, {
      resolveAssistantPurpose: (input, options) => manager.resolveAssistantPurpose(input, options),
      listCapabilities: async () => ({ engines: [f.capabilities] }),
      requireAssistantAccessForSelection: async () => {},
      resolveEphemeralExecutionProfile: async () => ({ model: "main-model", profileId: "economy", workloadId: "request_routing",
        providerId: "codex", revision: "fixture", thinking: "low", limits: VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS.request_routing,
        policy: { tools: "none", environmentAccess: false, networkAccess: false, repositoryWrite: false },
        request: { reasoning: true, summary: false, allowProviderModelFallback: false } }),
      createEphemeralConversation: async () => ({ ok: true, conversationId: "helper" }),
      startEphemeralConversationTurn: async (scope, _input, ctx) => {
        assert.notEqual(scope.id, "one");
        assert.equal(ctx.session, undefined);
        return { ok: true, runId: "helper-turn" };
      },
      waitForEphemeralConversationTurn: async () => ({ ok: true, text: '{"mode":"code","reason":"explicit_implementation"}' }),
      deleteEphemeralConversation: async () => ({ ok: true }),
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
    assert.equal(starts[0].selection.modelId, "gpt-6-astra");
    const planPath = path.join(f.store.paths("one").conversationsRoot, "chat", "work-plan", "plan.md");
    await writeFile(planPath, "# Agreed change\nStatus: ready\n\n" + ["Outcome and scope", "Findings", "Proposed changes", "Decisions", "Implementation steps", "Verification", "Progress and blockers"]
      .map((heading) => `## ${heading}\nConcrete implementation evidence for ${heading}.\n`).join("\n"));
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-1" } });
    const planned = JSON.parse((await f.store.readSessionConversation("one", "chat")).routingMetadata.assistant_routing_request);
    assert.equal(planned.workPlan.status, "ready");
    assert.equal(starts.length, 1, "no coding before approval");
    await service.startTemporaryConversationTurn("one", { ...input, messageId: "approve", planRevision: planned.workPlan.revision });
    assert.equal(starts[1].selection.modelId, "chosen");
    assert.match(starts[1].input.message, /Vibe64 mode: code/);
    const record = await f.store.readSessionConversation("one", "chat");
    assert.equal(JSON.parse(record.routingMetadata.assistant_routing_request).status, "sent");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
    assert.equal(JSON.parse((await f.store.readSession("one")).metadata.assistant_selection).modelId, "main-model");
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-2" } });
    assert.equal(starts.length, 3, (await f.store.readSessionConversation("one", "chat")).routingMetadata.assistant_routing_request);
    assert.equal(starts[2].selection.modelId, "gpt-6-astra");
    assert.equal(starts[2].input.conversationId, starts[1].input.conversationId);
    assert.equal(starts[2].input.messageId, JSON.parse(record.routingMetadata.assistant_routing_request).reviewMessageId);
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-3" } });
    const restored = await f.restart({ systemRoot: root }).readTemporaryConversation("one", { conversationId: "chat" });
    assert.equal(JSON.parse(restored.routingMetadata.assistant_routing_request).reviewStatus, "completed");
    assert.equal(starts.length, 3);
    assert.equal(restored.messages.filter((message) => message.role === "user").length, 3);
    await service.startTemporaryConversationTurn("one", { ...input, messageId: "cleanup", message: "Deslop" });
    assert.equal(starts[3].selection.modelId, "gpt-6-astra");
    assert.equal(starts[3].input.genesisTask, "deslop");
    assert.equal(starts[3].input.conversationId, starts[0].input.conversationId);
    assert.match(starts[3].input.message, /You may edit code for behavior-preserving cleanup/);
    f.native.status = "completed";
    await service.afterTemporaryTurn("one", { conversationId: "native", temporaryRun: { state: "completed", providerTurnId: "turn-4" } });
    assert.equal(starts.length, 4, "Deslop never schedules another review");
    f.sessionAgent.waitForEphemeralConversationTurn = async () => ({ ok: true, text: '{"mode":"plan","reason":"mixed_deslop_request"}' });
    await assert.rejects(service.startTemporaryConversationTurn("one", {
      ...input, messageId: "mixed", message: "Add a feature and deslop."
    }), /please request feature work and Deslop separately/);
    assert.equal(starts.length, 4, "neither part of the mixed request reaches the conversation");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
    assert.equal(JSON.parse((await f.store.readSession("one")).metadata.assistant_selection).modelId, "main-model");
    await service.deleteTemporaryConversation("one", { conversationId: "chat" });
    await assert.rejects(access(planPath), { code: "ENOENT" });
  });
});

test("Close waits for a starting Router and retains its parent when helper cleanup fails", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    const selection = { ...resolveVibe64AssistantSelection(f.capabilities, { ...f.selection, catalogRevision: f.capabilities.revision }), selectionSource: "explicit" };
    await createAssistantRoutingStore({ systemRoot: root }).write({ codex: {
      plan: selection, code: selection, router: selection
    } }, 1);
    const manager = createSessionAgentManager({ providers: [{ id: "codex", transportId: "codex_app_server",
      capabilities: async () => f.capabilities }],
      readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "fixture-connection" }) });
    const starting = Promise.withResolvers();
    const started = Promise.withResolvers();
    const stopped = Promise.withResolvers();
    const stops = [];
    let cleanupSucceeds = false;
    Object.assign(f.sessionAgent, {
      resolveAssistantPurpose: (input, options) => manager.resolveAssistantPurpose(input, options),
      resolveEphemeralExecutionProfile: async () => ({ model: "main-model", profileId: "economy", workloadId: "request_routing",
        providerId: "codex", revision: "fixture", thinking: "low", limits: VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS.request_routing,
        policy: { tools: "none", environmentAccess: false, networkAccess: false, repositoryWrite: false },
        request: { reasoning: true, summary: false, allowProviderModelFallback: false } }),
      createEphemeralConversation: async () => ({ ok: true, conversationId: "router-native" }),
      startEphemeralConversationTurn: async () => {
        starting.resolve();
        await started.promise;
        return { ok: true, runId: "late-router-turn" };
      },
      stopEphemeralConversation: async (_scope, input) => { stops.push(input.runId); stopped.resolve(); return { ok: true }; },
      deleteEphemeralConversation: async () => ({ ok: cleanupSucceeds })
    });
    const service = f.restart({ systemRoot: root });
    await service.createTemporaryConversation("one", { conversationId: "chat" });
    await service.updateTemporaryConversation("one", { conversationId: "chat", assistantRouting: { mode: "auto" } });
    const planRoot = path.join(f.store.paths("one").conversationsRoot, "chat", "work-plan");
    await mkdir(planRoot, { recursive: true });
    await writeFile(path.join(planRoot, "plan.md"), "Status: ready\n\n" + ["Outcome and scope", "Findings", "Proposed changes", "Decisions", "Implementation steps", "Verification", "Progress and blockers"]
      .map((heading) => `## ${heading}\nConcrete implementation evidence for ${heading}.\n`).join("\n"));
    const workPlan = await readWorkPlan({ session: { sessionId: "one" }, runtime: { store: f.store }, routingConversationId: "chat" });
    const planned = await f.store.readSessionConversation("one", "chat");
    await f.store.writeSessionConversation("one", "chat", { routingMetadata: { ...planned.routingMetadata,
      assistant_routing_request: JSON.stringify({ status: "done", workPlan }) } });
    const sending = service.startTemporaryConversationTurn("one", { conversationId: "chat", messageId: "request", message: "Implement it." });
    void sending.catch(() => {});
    await starting.promise;
    let closed = false;
    const closing = service.deleteTemporaryConversation("one", { conversationId: "chat" });
    void closing.then(() => { closed = true; }, () => {});
    await stopped.promise;
    assert.equal(closed, false);
    assert.equal((await f.store.readSessionConversation("one", "chat")).state, "open");
    started.resolve();
    await assert.rejects(sending, /routing helper could not be closed/);
    await assert.rejects(closing, /Retry closing/);
    const retained = await f.store.readSessionConversation("one", "chat");
    assert.equal(retained.state, "open");
    assert.equal(JSON.parse(retained.routingMetadata.assistant_routing_request).helper.runId, "late-router-turn");
    assert.deepEqual(stops, ["", "late-router-turn"]);
    assert.equal(f.native.starts, 0);
    cleanupSucceeds = true;
    assert.equal((await service.deleteTemporaryConversation("one", { conversationId: "chat" })).deleted, true);
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
        return { plan: { available: true } };
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
      assert.ok(records.every((record) => record.purposes.plan.available));
    });
  });
}

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
  const plan = select(f.capabilities, { modelId: "gpt-6-astra" });
  const code = select(f.capabilities, { modelProviderId: "deepseek", modelId: "deepseek-flash" });
  const economy = select(sharedCatalog, {});
  await createAssistantRoutingStore({ systemRoot: root }).write({ codex: { plan, code, economy, router: code, sharedBackup: economy } }, 1);
  await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "code", review, workflowEngineId: "codex" }));
  await f.store.writeMetadataValue("one", "assistant_changeover", '{"mainChatSentinel":true}');
  const native = new Map();
  const calls = { starts: [], stops: [], deletes: [] };
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
  const options = { vibe64User: actor };
  const preparation = async (id, selection, ctx) => {
    if (selection.engineId !== "codex" || ctx.session.metadata.codex_routing_home_provider) return;
    await ctx.runtime.store.writeMetadataValue(id, "codex_routing_home_provider", "openai");
  };
  let service = f.restart({ systemRoot: root, prepareSelection: preparation });
  await manager.assistantAccess("one", { session: await f.store.readSession("one"), ...options });
  await service.createTemporaryConversation("one", { conversationId: "chat" }, options);
  return { ...f, native, calls, failures, manager, options, plan, code, economy,
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

test("a temporary native goal fixes its mode and model, suppresses review, and remains visible after restoration", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, undefined, true);
    await f.send("code", "start-goal");
    const record = await f.record();
    const goal = { status: "paused", objective: "Finish this implementation" };
    f.native.get(record.providerConversationId).goal = goal;
    await f.finish("Paused the goal.");
    assert.equal(f.calls.starts.length, 1, "a goal never starts automatic review");
    const restored = (await f.restart().listTemporaryConversations("one", f.options)).conversations[0];
    assert.deepEqual(restored.goal, goal);
    for (const update of [{ assistantRouting: { mode: "auto", review: true } }, { agentSettings: { model: "gpt-6-astra" } }]) {
      await assert.rejects(f.service.updateTemporaryConversation("one", { conversationId: "chat", ...update }, f.options), /Finish this goal/);
    }
    const configuration = createAssistantRoutingStore({ systemRoot: root });
    const saved = await configuration.read();
    await configuration.write({ codex: { ...saved.orchestrators.codex, code: f.plan } }, saved.revision);
    await assert.rejects(f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "changed-coder", message: "Continue."
    }, f.options), /Finish or cancel the current goal before changing its AI/);
    assert.equal(f.calls.starts.length, 1);
    f.failures.read = true;
    await assert.rejects(f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "plan", review: false }
    }, f.options), /Reconnect this conversation/);
    assert.equal((await f.record()).routingMetadata.assistant_routing, record.routingMetadata.assistant_routing);
  });
});

test("temporary availability uses its own override and actor without inferring or exposing connection identities", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "member" });
    const initial = await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    assert.equal(initial.purposes.code.effectiveSelection.engineId, "opencode");
    assert.equal(initial.purposes.code.backupReason, "keep_workflow_together");
    assert.equal(initial.purposes.auto.available, false);
    const updated = await f.service.updateTemporaryConversation("one", { conversationId: "chat",
      assistantRouting: { mode: "plan", review: false, override: f.code }
    }, f.options);
    assert.equal(updated.purposes.plan.effectiveSelection.modelId, "deepseek-flash");
    assert.equal(updated.purposes.plan.backupUsed, false);
    assert.equal(updated.purposes.code.effectiveSelection.engineId, "opencode",
      "Switching to Code clears the Plan-only override and resolves that request afresh");
    assert.doesNotMatch(JSON.stringify(updated.purposes), /connectionIdentity/);
    const owner = await f.service.readTemporaryConversation("one", { conversationId: "chat" }, {
      vibe64User: { username: "owner", role: "owner" }
    });
    assert.equal(owner.purposes.code.effectiveSelection.engineId, "codex");
    assert.equal(owner.purposes.auto.available, true);
    assert.equal(f.calls.starts.length, 0);
    assert.equal(f.native.size, 0);
  });
});

test("generated and repair drafts explicitly choose Code while preserving the parent workflow", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "member" });
    await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "auto", review: true, workflowEngineId: "codex" }));
    for (const input of [
      { conversationId: "generated", assistantRouting: { mode: "code", review: false, workflowEngineId: "opencode" } },
      { conversationId: "repair", presentation: { recoveryOperation: "update" } }
    ]) {
      const created = await f.service.createTemporaryConversation("one", input, f.options);
      assert.deepEqual(JSON.parse(created.routingMetadata.assistant_routing), { mode: "code", review: false, workflowEngineId: "codex" });
      assert.equal(created.purposes.code.effectiveSelection.engineId, "opencode");
    }
    assert.equal(f.calls.starts.length, 0);
  });
});

test("a temporary personal turn restricts steering without blocking the member's next shared mode", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("plan", "owner-plan");
    const input = { conversationId: "chat" };
    const member = { vibe64User: { username: "member", role: "member" } };
    const during = await f.service.readTemporaryConversation("one", input, member);
    assert.equal(during.canSteer, false);
    assert.equal(during.purposes.plan.available, true);
    assert.equal(during.purposes.plan.effectiveSelection.engineId, "opencode");
    await f.finish("Here is the plan.");
    const after = await f.service.readTemporaryConversation("one", input, member);
    assert.equal(after.canSteer, null);
    assert.equal(after.purposes.code.available, true);
  });
});

test("temporary Economy changeover and return retain both native histories and leave Main chat untouched", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    const main = (await f.store.readSession("one")).metadata;
    await f.send("code", "first", "Implement the agreed design");
    await f.finish("Implemented the design in source files");
    const coderId = (await f.record()).providerConversationId;
    await f.send("economy", "second", "Explain the implementation");
    const economyId = (await f.record()).providerConversationId;
    assert.notEqual(coderId, economyId);
    assert.match(f.calls.starts[1].input.message, /Vibe64 conversation changeover/);
    assert.match(f.calls.starts[1].input.message, /Implemented the design in source files/);
    assert.doesNotMatch(f.calls.starts[1].input.message, /mainChatSentinel/);
    await f.finish("The design uses one validation function");
    f.restart();
    await f.send("code", "third", "Add the agreed check");
    assert.equal((await f.record()).providerConversationId, coderId);
    assert.match(f.calls.starts[2].input.message, /continuing your existing codex conversation/);
    assert.match(f.calls.starts[2].input.message, /The design uses one validation function/);
    const record = await f.record();
    assert.deepEqual(Object.keys(record.nativeBindings).sort(), ["codex", "opencode"]);
    assert.equal(record.nativeBindings.codex.conversationId, coderId);
    assert.equal(record.nativeBindings.opencode.conversationId, economyId);
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
    await f.send("code", "member-code");
    const record = await f.record();
    const row = f.native.get(record.providerConversationId);
    row.messages.push({ role: "assistant", id: "code-start", text: "I am implementing it.", complete: true });
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    row.messages.push({ role: "thinking", id: "code-progress", text: "Checking the changed file.", complete: true });
    await f.finish("Implemented the file.");
    assert.equal(f.calls.starts.length, 2, "the routed reviewer starts once");
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
      assert.equal(message.assistantRouting.resolvedMode, codeIds.includes(id) ? "code" : "review", id);
    }
    assert.equal(f.calls.starts.length, 2);
    assert.deepEqual((await f.store.readSession("one")).metadata, main);
    assert.deepEqual(await f.store.readConversationLog("one"), []);
  });
});

test("a temporary read can observe live completion before its idle event without losing review", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "collaborator" }, true);
    await f.send("code", "polled-code");
    const record = await f.record();
    const row = f.native.get(record.providerConversationId);
    row.status = "completed";
    await f.service.readTemporaryConversation("one", { conversationId: "chat" }, f.options);
    for (let attempt = 0; attempt < 100 && f.calls.starts.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(f.calls.starts.length, 2);
    await f.service.afterTemporaryTurn("one", { conversationId: row.id,
      temporaryRun: { active: false, state: "completed", providerTurnId: record.runId } }, f.options);
    assert.equal(f.calls.starts.length, 2);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).status, "reviewing");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
  });
});

for (const role of ["owner", "member"]) {
  test(`temporary ${role} coding waits for a structured answer before review without touching main chat`, async () => {
    await withTemporaryRoot(async (root) => {
      const f = await temporaryChangeoverFixture(root, { role, username: role }, true);
      await f.send("code", "needs-decision");
      const question = "[1] Should persistence stay in this browser or be shared?";
      await f.finish(question);
      assert.equal(f.calls.starts.length, 1);
      const waiting = await f.record();
      assert.equal(JSON.parse(waiting.routingMetadata.assistant_routing_request).reviewStatus, "skipped_question");
      const restored = await f.restart().readTemporaryConversation("one", { conversationId: "chat" }, f.options);
      assert.equal(restored.messages.at(-1).text, question);
      assert.equal(restored.assistantSelection.modelId, waiting.assistantSelection.modelId);
      assert.equal(f.calls.starts.length, 1);
      await f.send("code", "decision-answer", "Keep it in this browser.");
      await f.finish("Implemented and checked.");
      assert.equal(f.calls.starts.length, 3);
      assert.match(f.calls.starts[2].input.message, /Vibe64 mode: review/);
      await f.finish("Reviewed.");
      assert.equal((await f.store.readConversationLog("one")).length, 0);
    });
  });
}

test("temporary HTTP turn input captures its authenticated actor for later review", async () => {
  await withTemporaryRoot(async (root) => {
    const member = { role: "member", username: "collaborator" };
    const f = await temporaryChangeoverFixture(root, member, true);
    await f.service.updateTemporaryConversation("one", { conversationId: "chat", assistantRouting: { mode: "code", review: true } }, f.options);
    await f.service.startTemporaryConversationTurn("one", {
      conversationId: "chat", messageId: "http-member-code", message: "Implement the agreed design", vibe64User: member
    });
    assert.deepEqual(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).submittedBy, member);
    assert.equal(f.calls.starts[0].selection.engineId, "opencode");
    f.options.vibe64User = { role: "owner", username: "owner" };
    await f.finish("Implemented using the shared AI");
    assert.equal(f.calls.starts.length, 2);
    assert.equal(f.calls.starts[1].selection.engineId, "opencode");
    assert.deepEqual(JSON.parse((await f.record()).routingMetadata.assistant_routing_request).submittedBy, member);
  });
});

test("a member can create a temporary chat from a personal parent and keeps its foreign Backup pair for review", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root, { role: "member", username: "collaborator" }, true);
    await f.send("code", "member-code", "Implement the agreed design");
    const id = (await f.record()).providerConversationId;
    assert.equal(f.calls.starts[0].selection.engineId, "opencode");
    assert.equal(f.manager.binding("one"), "codex");
    assert.equal(f.manager.binding("one", { routingConversationId: "chat" }), "opencode");
    await f.finish("Implemented using the shared AI");
    assert.equal(f.calls.starts.length, 2);
    assert.equal(f.calls.starts[1].selection.engineId, "opencode");
    assert.equal(f.calls.starts[1].conversationId, id);
    assert.match(f.calls.starts[1].input.message, /Vibe64 mode: review/);
    await f.finish("Review completed");
    await f.send("plan", "member-plan", "Discuss the next change");
    assert.equal(f.calls.starts[2].conversationId, id);
    assert.equal(JSON.parse((await f.record()).routingMetadata.assistant_routing).workflowEngineId, "codex");
    assert.equal((await f.store.readConversationLog("one")).length, 0);
  });
});

test("temporary changeover stops before selection changes and Close retries only retained native histories", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await temporaryChangeoverFixture(root);
    await f.send("code", "first");
    await f.finish("Done");
    const original = await f.record();
    f.failures.stop = original.providerConversationId;
    await assert.rejects(f.send("economy", "second"), /stop not confirmed/);
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
    await f.send("code", "first");
    await f.finish("Done");
    f.failures.loseAdmission = true;
    await assert.rejects(f.send("economy", "second"), /Lost native admission reply/);
    const pending = await f.record();
    assert.equal(JSON.parse(pending.routingMetadata.assistant_routing_request).status, "uncertain");
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
      await f.send("code", "original");
      await f.finish("Original provider history");
      const original = await f.record();
      await f.send("economy", "explain");
      await f.finish("Explanation from Economy");
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
      for (const mode of ["plan", "code"]) {
        await assert.rejects(f.send(mode, `return-${mode}`), {
          code: "vibe64_codex_history_unsupported",
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

test("ordinary temporary chats start in Plan with review off and retain their parent's workflow", async () => {
  await withTemporaryRoot(async (root) => {
    const f = await conversationFixture(root);
    await f.store.writeMetadataValue("one", "assistant_routing", JSON.stringify({ mode: "auto", review: true, workflowEngineId: "codex" }));
    await f.service.createTemporaryConversation("one", { conversationId: "plan-chat" });
    const record = await f.store.readSessionConversation("one", "plan-chat");
    assert.deepEqual(JSON.parse(record.routingMetadata.assistant_routing), { mode: "plan", review: false, workflowEngineId: "codex" });
    await f.service.startTemporaryConversationTurn("one", { conversationId: "plan-chat", messageId: "discuss", message: "Discuss the design" });
    assert.match(f.native.lastInput.message, /Vibe64 mode: plan/);
    assert.equal(JSON.parse((await f.store.readSessionConversation("one", "plan-chat")).routingMetadata.assistant_routing_request).review, false);
  });
});
