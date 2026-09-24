import assert from "node:assert/strict";
import test from "node:test";

import {
  vibe64Driver
} from "../../packages/vibe64-genesis/src/server/promptContext.js";
import {
  createCodexSessionAgentProvider
} from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";
import {
  createOpenCodeSessionAgentProvider
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";
import {
  createSessionAgentManager,
  defineEphemeralAssistantScope
} from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";

const catalogRevision = `sha256:${"a".repeat(64)}`;

test("generic ephemeral assistant scope is exact, bounded, and independent of projects", () => {
  const scope = defineEphemeralAssistantScope({
    environment: {},
    id: "repair_123",
    runtimeRoot: "/tmp/vibe64-ephemeral-runtime",
    stableContext: "Trusted host context",
    workdir: "/tmp/vibe64-ephemeral-workdir"
  });
  assert.equal(scope.id, "repair_123");
  assert.equal(scope.stableContext, "Trusted host context");
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(vibe64Driver({
    scope: "ephemeral",
    stableContext: scope.stableContext
  }), scope.stableContext);
  assert.throws(() => defineEphemeralAssistantScope({
    ...scope,
    projectSlug: "should-not-exist"
  }), /unsupported fields: projectSlug/u);
  assert.throws(() => defineEphemeralAssistantScope({
    ...scope,
    stableContext: "x".repeat((64 * 1024) + 1)
  }), /bounded stable context/u);
  const missingRuntimeRoot = { ...scope };
  delete missingRuntimeRoot.runtimeRoot;
  assert.throws(() => defineEphemeralAssistantScope(missingRuntimeRoot), /missing required fields: runtimeRoot/u);
  assert.throws(() => defineEphemeralAssistantScope({
    ...scope,
    stableContext: { text: "not a string" }
  }), /stable context must be a string/u);
  assert.throws(() => vibe64Driver({
    conversationKind: "system-repair",
    scope: "ephemeral",
    stableContext: "No hosted kinds in public Genesis."
  }), /unsupported fields: conversationKind/u);
});

for (const engineId of ["codex", "opencode"]) {
  test(`${engineId} reuses its provider lifecycle for one non-project ephemeral conversation`, async () => {
    const calls = [];
    const controller = conversationController(calls);
    const provider = engineId === "codex"
      ? createCodexSessionAgentProvider({ controller })
      : createOpenCodeSessionAgentProvider({ controller });
    const manager = createSessionAgentManager({
      providers: [provider],
      async readAssistantAccess() {
        return {
          available: true,
          ownerOnly: true
        };
      }
    });
    const selection = {
      agentId: engineId,
      catalogRevision,
      engineId,
      modelId: "model-1",
      modelProviderId: engineId === "codex" ? "openai" : "provider-1",
      schema: "vibe64.assistant-selection.v1",
      variantId: "low"
    };
    const scope = {
      environment: {},
      id: `${engineId}_ephemeral_1`,
      runtimeRoot: `/tmp/${engineId}-ephemeral-runtime`,
      stableContext: "Host-supplied context without tools.",
      workdir: `/tmp/${engineId}-ephemeral-workdir`
    };
    const options = {
      assistantSelection: selection,
      vibe64User: { role: "owner", username: "owner" }
    };

    const created = await manager.createEphemeralConversation(scope, {}, options);
    const started = await manager.startEphemeralConversationTurn(scope, {
      conversationId: created.conversationId,
      message: "Inspect this state unchanged.",
      messageId: "message_1"
    }, options);
    const read = await manager.readEphemeralConversation(scope, {
      conversationId: created.conversationId,
      runId: started.runId
    }, options);
    const waited = await manager.waitForEphemeralConversationTurn(scope, {
      conversationId: created.conversationId,
      runId: started.runId
    }, options);
    await manager.stopEphemeralConversation(scope, {
      conversationId: created.conversationId,
      runId: started.runId
    }, options);
    await manager.deleteEphemeralConversation(scope, {
      conversationId: created.conversationId
    }, options);

    assert.equal(read.message, "Done");
    assert.equal(waited.message, "Done");
    assert.deepEqual(calls.map((call) => call.name), [
      "create",
      "start",
      "read",
      "wait",
      "stop",
      "delete"
    ]);
    for (const call of calls) {
      assert.equal(call.sessionId, scope.id);
      assert.equal(call.options.assistantScope.id, scope.id);
      assert.equal(call.options.assistantScope.stableContext, scope.stableContext);
      if (engineId === "opencode") {
        assert.equal(call.options.runtime, null);
        assert.equal(call.options.session, null);
      }
    }
    assert.equal(calls.find((call) => call.name === "start").input.message, "Inspect this state unchanged.");
    assert.equal(manager.binding(scope.id), "");
  });
}

test("owner-only assistant access rejects a member before provider creation", async () => {
  let providerCalls = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async createConversation() {
        providerCalls += 1;
        return { conversationId: "conversation_1", ok: true };
      }
    }],
    async readAssistantAccess() {
      return { available: true, ownerOnly: true };
    }
  });
  await assert.rejects(() => manager.createEphemeralConversation({
    environment: {},
    id: "member_ephemeral",
    runtimeRoot: "/tmp/member-ephemeral-runtime",
    stableContext: "Trusted context",
    workdir: "/tmp/member-ephemeral-workdir"
  }, {}, {
    assistantSelection: {
      agentId: "codex",
      catalogRevision,
      engineId: "codex",
      modelId: "model-1",
      modelProviderId: "openai",
      variantId: "low"
    },
    vibe64User: { role: "member" }
  }), /owner/u);
  assert.equal(providerCalls, 0);
});

test("a foreign scoped helper retains its exact model, profile provenance and independent binding", async () => {
  const calls = [];
  let identity = "shared-key-1";
  const provider = createOpenCodeSessionAgentProvider({ controller: conversationController(calls) });
  const manager = createSessionAgentManager({
    providers: [provider, { id: "codex", transportId: "codex_app_server" }],
    readAssistantAccess: async () => ({ available: true, ownerOnly: false,
      connectionIdentity: identity, economyModelId: "legacy-helper-model" })
  });
  const mainSelection = { engineId: "codex", agentId: "codex", modelProviderId: "openai",
    modelId: "gpt-6-astra", variantId: "", catalogRevision };
  const session = { sessionId: "main", metadata: { assistant_selection: JSON.stringify(mainSelection) } };
  await manager.assistantAccess("main", { session });
  const scope = { id: "router_job", environment: {}, workdir: "/tmp/helper-work", runtimeRoot: "/tmp/helper-runtime",
    stableContext: "Classify supplied text only." };
  const selection = { engineId: "opencode", agentId: "opencode", modelProviderId: "deepseek",
    modelId: "selected-router-model", variantId: "", catalogRevision };
  const options = { assistantSelection: selection, session, runtime: { stateRoot: "/tmp/parent-runtime" },
    routingConversationId: "temporary-parent", vibe64User: { username: "member", role: "user" } };
  const profile = await manager.resolveEphemeralExecutionProfile(scope, { profileId: "economy", workloadId: "prompt_hint" }, options);
  assert.equal(profile.model, selection.modelId, "scoped helpers ignore the old per-connection helper model");
  assert.equal(manager.binding("main"), "codex");
  assert.equal(manager.binding(scope.id), "opencode");
  const create = (executionProfile, change = {}, changedScope = scope) => manager.createEphemeralConversation(changedScope, {
    executionProfile, ephemeral: true
  }, { ...options, ...change });
  await assert.rejects(create(structuredClone(profile)), /not issued/);
  await assert.rejects(create(profile, { assistantSelection: { ...selection, modelProviderId: "another-provider" } }), /not issued/);
  await assert.rejects(create(profile, { vibe64User: { username: "another-user", role: "user" } }), /not issued/);
  await assert.rejects(create(profile, {}, { ...scope, stableContext: "Changed private context" }), /not issued/);
  identity = "shared-key-2";
  await assert.rejects(create(profile), /not issued/);
  identity = "shared-key-1";
  await assert.rejects(create(profile, { expectedConnectionIdentity: "replaced-key" }), { code: "vibe64_assistant_connection_changed" });
  const created = await create(profile);
  await assert.rejects(manager.startEphemeralConversationTurn(scope, { executionProfile: profile,
    conversationId: created.conversationId, message: "Changed", steer: true }, options), /supplied text only/);
  await assert.rejects(manager.startEphemeralConversationTurn(scope, { executionProfile: profile,
    conversationId: created.conversationId, message: "Changed", attachments: [{ path: "/private/file" }] }, options), /supplied text only/);
  await manager.startEphemeralConversationTurn(scope, { executionProfile: profile, ephemeral: true,
    conversationId: created.conversationId, message: "Supplied text" }, options);
  for (const call of calls) {
    assert.equal(call.sessionId, scope.id);
    assert.equal(call.options.session, null);
    assert.equal(call.options.runtime, null);
    assert.equal(call.options.assistantSelection.modelId, selection.modelId);
  }
  await manager.deleteEphemeralConversation(scope, { conversationId: created.conversationId }, options);
  assert.equal(manager.binding("main"), "codex");
  assert.equal(manager.binding(scope.id), "");
  await assert.rejects(create(profile), /not issued/, "cleanup retires the profile's binding");
});

test("Codex scoped profile discovery and every lifecycle operation keep the selected provider context", async () => {
  const calls = [];
  const controller = { ...conversationController(calls),
    async readHelperModel() { throw new Error("Scoped helpers must not read the legacy helper preference"); },
    async executionProfileModelCatalog(sessionId, options) {
      calls.push({ name: "profile", sessionId, options });
      return { data: [{ model: "deepseek-flash", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }] };
    }
  };
  const manager = createSessionAgentManager({ providers: [createCodexSessionAgentProvider({ controller })] });
  const scope = { id: "codex_helper", environment: {}, workdir: "/tmp/helper", runtimeRoot: "/tmp/runtime",
    stableContext: "Summarize supplied text only." };
  const options = { assistantSelection: { engineId: "codex", agentId: "codex", modelProviderId: "deepseek",
    modelId: "deepseek-flash", variantId: "high", catalogRevision } };
  const profile = await manager.resolveEphemeralExecutionProfile(scope, { profileId: "economy", workloadId: "conversation_summary" }, options);
  assert.equal(profile.model, "deepseek-flash");
  assert.equal(profile.thinking, "low");
  const created = await manager.createEphemeralConversation(scope, { ephemeral: true, executionProfile: profile }, options);
  const input = { conversationId: created.conversationId, executionProfile: profile, message: "Summarize", runId: "run_1" };
  await manager.startEphemeralConversationTurn(scope, input, options);
  await manager.readEphemeralConversation(scope, input, options);
  await manager.waitForEphemeralConversationTurn(scope, input, options);
  await manager.stopEphemeralConversation(scope, input, options);
  await manager.deleteEphemeralConversation(scope, input, options);
  for (const call of calls) {
    assert.equal(call.sessionId, scope.id);
    assert.equal(call.options.assistantScope.id, scope.id);
    assert.equal((call.name === "profile" ? call.options : call.input).agentSettings.modelProviderId, "deepseek");
  }
});

function conversationController(calls) {
  const capture = (name, result) => async (sessionId, input = {}, options = {}) => {
    calls.push({ input, name, options, sessionId });
    return result;
  };
  return {
    createConversation: capture("create", { conversationId: "conversation_1", ok: true }),
    deleteConversation: capture("delete", { deleted: true, ok: true }),
    readConversation: capture("read", { message: "Done", ok: true, status: "completed" }),
    startConversationTurn: capture("start", { ok: true, runId: "run_1", status: "inProgress" }),
    stopConversation: capture("stop", { ok: true, status: "interrupted" }),
    waitForConversationTurn: capture("wait", { message: "Done", ok: true, status: "completed" })
  };
}

test("a bounded helper turn awaits parent ownership and leaves the working chat bound to its own agent", async () => {
  const calls = [];
  const controller = conversationController(calls);
  controller.waitForConversationTurn = async (sessionId, input) => {
    calls.push({ name: "wait", sessionId, input });
    return { ok: true, status: "completed", rawText: '{"subject":"Improve search"}' };
  };
  const manager = createSessionAgentManager({ providers: [createOpenCodeSessionAgentProvider({ controller }),
    { id: "codex", transportId: "codex_app_server" }],
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "shared" }) });
  const scope = { id: "naming_job", environment: {}, workdir: "/tmp/naming-work", runtimeRoot: "/tmp/naming-runtime",
    stableContext: "Name only the supplied change." };
  const session = { sessionId: "main", metadata: { assistant_selection: JSON.stringify({ engineId: "codex", agentId: "codex",
    modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "", catalogRevision }) } };
  await manager.assistantAccess("main", { session });
  const retained = Promise.withResolvers();
  const threadObserved = Promise.withResolvers();
  const options = { session, assistantSelection: { engineId: "opencode", agentId: "build", modelProviderId: "deepseek",
    modelId: "deepseek-flash", variantId: "", catalogRevision }, vibe64User: { role: "member" },
    async onEvent(event) {
      if (event.type === "thread") { threadObserved.resolve(event); await retained.promise; }
    } };
  const executionProfile = await manager.resolveEphemeralExecutionProfile(scope, { profileId: "economy", workloadId: "commit_title" }, options);
  const running = manager.runEphemeralChatTurn(scope, { executionProfile, prompt: "Name this work." }, options);
  assert.equal((await threadObserved.promise).threadId, "conversation_1");
  assert.equal(calls.some(({ name }) => name === "start"), false);
  retained.resolve();
  const result = await running;
  assert.equal(result.text, '{"subject":"Improve search"}');
  assert.equal(result.executionProfile.model, "deepseek-flash");
  assert.equal(manager.binding("main"), "codex");
  assert.equal(calls.find(({ name }) => name === "start").sessionId, scope.id);
  assert.equal(calls.some(({ name }) => name === "delete"), false, "the parent keeps cleanup ownership");
  await manager.deleteEphemeralConversation(scope, { conversationId: result.threadId }, options);
  assert.equal(manager.binding(scope.id), "");
});

for (const phase of ["starting", "waiting"]) {
  test(`a bounded helper aborted while ${phase} stops its exact late native turn`, async () => {
    const calls = [];
    const controller = conversationController(calls);
    const started = Promise.withResolvers();
    const released = Promise.withResolvers();
    const abort = new AbortController();
    controller.startConversationTurn = async () => {
      if (phase === "starting") { started.resolve(); await released.promise; }
      return { ok: true, runId: "late-run", status: "inProgress" };
    };
    controller.waitForConversationTurn = async () => { started.resolve(); await released.promise; return { ok: true, status: "interrupted" }; };
    controller.stopConversation = async (sessionId, input) => {
      calls.push({ sessionId, input });
      released.resolve();
      return { ok: true };
    };
    const manager = createSessionAgentManager({ providers: [createOpenCodeSessionAgentProvider({ controller })] });
    const scope = { id: "cancel_helper", environment: {}, workdir: "/tmp/cancel-work", runtimeRoot: "/tmp/cancel-runtime",
      stableContext: "Supplied text only." };
    const options = { signal: abort.signal, assistantSelection: { engineId: "opencode", agentId: "build", modelProviderId: "opencode",
      modelId: "big-pickle", variantId: "", catalogRevision } };
    const executionProfile = await manager.resolveEphemeralExecutionProfile(scope, { profileId: "economy", workloadId: "prompt_hint" }, options);
    const running = manager.runEphemeralChatTurn(scope, { executionProfile, prompt: "Suggest." }, options);
    const rejected = assert.rejects(running, /cancelled/);
    await started.promise;
    abort.abort(new Error("cancelled"));
    released.resolve();
    await rejected;
    assert.equal(calls.at(-1).sessionId, scope.id);
    assert.equal(calls.at(-1).input.conversationId, "conversation_1");
    assert.equal(calls.at(-1).input.runId, "late-run");
  });
}

test("an aborted empty helper scope closes its provider resources and releases its binding", async () => {
  const calls = [];
  const manager = createSessionAgentManager({ providers: [{ id: "codex", transportId: "codex_app_server",
    async closeSession(context) { calls.push(context); return { ok: true, closed: true }; } }] });
  const scope = { id: "aborted_router", runtimeRoot: "/tmp/aborted-runtime", workdir: "/tmp/aborted-work",
    environment: {}, stableContext: "Supplied context only." };
  await manager.deleteEphemeralConversation(scope, {}, { assistantSelection: {
    engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-luna", variantId: "low", catalogRevision } });
  assert.equal(calls[0].assistantScope.id, scope.id);
  assert.equal(calls[0].session, null);
  assert.equal(calls[0].runtime, null);
  assert.equal(manager.binding(scope.id), "");
});
