import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createConversationTranscript, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { controllerHarness } from "../fixtures/opencodeController.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createOpenCodeSessionAgentProvider } from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";

const reasoning = "I am examining the application source to understand how its session state is persisted.";
const summary = "Examines session persistence.";
const part = () => ({ id: "reasoning-1", type: "reasoning", text: reasoning });
const summaries = (harness) => harness.promptCalls.filter(({ input }) => input.agent === "vibe64-economy");
async function until(check) {
  const deadline = Date.now() + 3_000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "Expected the observed operation to complete");
    await delay(20);
  }
}
async function fixture(t, { providers = [], readAccess = null, ...options } = {}) {
  const harness = await controllerHarness(options);
  const intern = { ...harness.selection, variantId: "low", selectionSource: "explicit" };
  harness.routing = { schemaVersion: 3, revision: 1, orchestrators: { opencode: { intern } } };
  harness.accessCalls = [];
  harness.controllerOptions.getAssistantManager = () => harness.manager;
  harness.controller = harness.createController();
  harness.manager = createSessionAgentManager({
    providers: [createOpenCodeSessionAgentProvider({ controller: harness.controller }), ...providers],
    readRoutingConfiguration: async () => harness.routing,
    readAssistantAccess: async (input) => {
      harness.accessCalls.push(input);
      if (readAccess) return readAccess(input);
      return { available: true, ownerOnly: false, connectionIdentity: "shared-deepseek" };
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  return harness;
}

test("reasoning reads a completed helper answer once per block and deletes native helpers across turns", async (t) => {
  const responses = [0, 1].map(() => ({ pending: true, text: "", content: [part()] }));
  const helper = { pending: true, text: "Partial helper answer" };
  let helperReads = 0;
  const harness = await fixture(t, {
    assistantResponses: responses, helperResponse: helper,
    beforeMessages(id) { if (id !== "ses_native_1") helperReads += 1; }
  });
  for (const [index, response] of responses.entries()) {
    helper.pending = true;
    helper.text = "Partial helper answer";
    await harness.controller.sendMessage("session-1", { message: "Review persistence", messageId: `summary-${index}` });
    await until(() => helperReads > index * 2 && summaries(harness).length === index + 1);
    assert.equal(harness.thinkingMessages.length, index, "Partial helper output must not become a headline");
    helper.text = summary;
    helper.pending = false;
    await until(() => harness.thinkingMessages.length === index + 1);
    assert.equal(harness.thinkingMessages[index].text, summary);
    response.pending = false;
    response.text = "Done.";
    await harness.controller.waitForTurn("session-1");
    await until(() => harness.upstreamSessions.size === 1);
    assert.equal(summaries(harness).length, index + 1, "Final projection must not submit the same block again");
    assert.equal(harness.thinkingMessages.length, index + 1);
  }
  assert.ok(helperReads >= 4);
  assert.ok(harness.createdSessionDirectories.filter(({ id }) => id !== "ses_native_1")
    .every(({ directory }) => directory !== harness.session.metadata.source_path));
  await harness.controller.closeAllForProject();
  assert.equal([...harness.upstreamSessions.values()].filter(({ agent }) => agent === "vibe64-economy").length, 0);
});

test("foreign Intern summaries use an isolated scope and leave the working OpenCode model alone", async (t) => {
  const calls = [];
  const provider = { id: "claude", transportId: "claude_stream_json",
    async capabilities() {
      return { engineId: "claude", transportId: "claude_stream_json", revision: `sha256:${"b".repeat(64)}`, agents: [{ id: "claude", mode: "primary" }],
        modelProviders: [{ id: "anthropic", connected: true,
          models: [{ id: "haiku", status: "available", variants: [] }] }] };
    },
    async resolveExecutionProfile(context, request) {
      calls.push({ method: "profile", context });
      return { ...request, providerId: "claude", model: context.assistantSelection.modelId,
        revision: "test-summary-v1", thinking: "", limits: { maxInputCharacters: 2_000, maxOutputCharacters: 300, timeoutMs: 10_000 },
        policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
        request: { allowProviderModelFallback: false, reasoning: false, summary: false } };
    },
    async createConversation(context) { calls.push({ method: "create", context }); return { ok: true, conversationId: "claude-summary" }; },
    async startConversationTurn(context, input) {
      calls.push({ method: "start", context, input }); return { ok: true, runId: "summary-turn", status: "inProgress" };
    },
    async waitForConversationTurn(context) { calls.push({ method: "wait", context }); return { ok: true, text: summary }; },
    async deleteConversation(context, input) { calls.push({ method: "delete", context, input }); return { ok: true }; }
  };
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, { providers: [provider], assistantResponses: [response] });
  harness.routing.orchestrators.opencode.intern = { engineId: "claude", agentId: "claude", modelProviderId: "anthropic",
    modelId: "haiku", variantId: "", catalogRevision: `sha256:${"b".repeat(64)}`, selectionSource: "explicit" };
  const decision = await harness.manager.resolveAssistantPurpose({ purpose: "conversation_summary", workflowEngineId: "opencode" }, {
    session: harness.session, vibe64User: { username: "member", role: "member" }
  });
  assert.equal(decision.available, true, JSON.stringify(decision));
  const selection = harness.session.metadata.assistant_selection;
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "foreign-summary" }, {
    vibe64User: { username: "member", role: "member" }
  });
  await until(() => harness.thinkingMessages.length === 1);
  assert.equal(harness.thinkingMessages[0].text, summary, JSON.stringify(calls));
  assert.deepEqual(calls.map(({ method }) => method), ["profile", "create", "start", "wait", "delete"]);
  for (const { context } of calls) {
    assert.match(context.sessionId, /^reasoning_/);
    assert.equal(context.session, null);
    assert.equal(context.runtime, null);
    assert.equal(context.vibe64User.username, "member");
    assert.equal(context.assistantSelection.engineId, "claude");
    assert.notEqual(context.assistantScope.workdir, harness.session.metadata.source_path);
    assert.deepEqual(context.assistantScope.environment, {});
  }
  assert.match(calls.find(({ method }) => method === "start").input.prompt, /session state is persisted/);
  assert.equal(calls.at(-1).input.conversationId, "claude-summary");
  assert.equal(harness.session.metadata.assistant_selection, selection);
  assert.equal(harness.promptCalls.length, 1);
  const registry = JSON.parse(await readFile(harness.processStarts[0].options.sessionEnvironmentRegistry, "utf8"));
  assert.equal(registry.sessions.find(({ sessionId }) => sessionId === "session-1").internModelId, "");
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
});

test("a replaced Intern connection prevents summary inference and preserves ordinary progress", async (t) => {
  let scopedAccess = 0;
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, { assistantResponses: [response], readAccess(input) {
    if (input.sessionId.startsWith("reasoning_")) scopedAccess += 1;
    return { available: true, ownerOnly: false, connectionIdentity: scopedAccess ? "replacement-key" : "original-key" };
  } });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "changed-key" });
  await until(() => harness.thinkingMessages.length === 1);
  assert.ok(scopedAccess > 0);
  assert.equal(summaries(harness).length, 0);
  assert.equal(harness.thinkingMessages[0].text, reasoning);
  assert.equal((await harness.runtime.store.readAgentRun("session-1", "opencode_server")).reasoningSummaryHelper, null);
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
});

test("a fresh controller retries the retained summary cleanup without starting another inference", async (t) => {
  let allowDeletion = false;
  let deletions = 0;
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, { assistantResponses: [response], helperResponse: summary,
    beforeDeleteSession(id) {
      assert.equal(id, "ses_native_2");
      deletions += 1;
      if (!allowDeletion) throw new Error("Deletion unavailable");
    }
  });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "cleanup-restart" });
  await until(() => harness.thinkingMessages.length === 1);
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
  await until(() => deletions >= 2);
  const retained = (await harness.runtime.store.readAgentRun("session-1", "opencode_server")).reasoningSummaryHelper;
  assert.equal(retained.conversationId, "ses_native_2");
  const previous = harness.controller;
  harness.controller = harness.createController();
  harness.manager = createSessionAgentManager({ providers: [createOpenCodeSessionAgentProvider({ controller: harness.controller })] });
  allowDeletion = true;
  await harness.controller.closeAllForSession("session-1");
  assert.equal((await harness.runtime.store.readAgentRun("session-1", "opencode_server")).reasoningSummaryHelper, null);
  assert.equal(harness.promptCalls.length, 2);
  assert.equal(harness.upstreamSessions.size, 1);
  await assert.rejects(readFile(retained.scope.runtimeRoot), { code: "ENOENT" });
  await previous.closeAllForProject();
});

test("an initial partial word does not suppress later live reasoning", async (t) => {
  const current = { ...part(), text: "I" };
  const response = { pending: true, text: "", content: [current] };
  const harness = await fixture(t, { assistantResponses: [response] });
  harness.routing.orchestrators.opencode.intern = null;
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "partial" });
  await delay(300);
  assert.equal(harness.thinkingMessages.length, 0);
  current.text = "I am examining session persistence.";
  await until(() => harness.thinkingMessages.length === 1);
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  assert.equal(harness.thinkingMessages[0].text, current.text);
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
  assert.equal(harness.thinkingMessages.length, 1);
  assert.equal(summaries(harness).length, 0);
});

test("a stalled cosmetic helper cannot keep a completed main turn busy or write into the next turn", async (t) => {
  const response = { pending: true, text: "", content: [part()] };
  let cancelled = false;
  const interrupted = [];
  const harness = await fixture(t, {
    assistantResponses: [response],
    async beforePrompt({ input, signal }) {
      if (input.agent !== "vibe64-economy") return;
      try { await delay(60_000, undefined, { signal }); }
      catch (error) { cancelled = true; throw error; }
    },
    async interrupt(id) { interrupted.push(id); return true; }
  });
  Object.assign(harness.runtime.store, createConversationTranscript({ storage: createMemoryConversationStorage() }));
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "held-summary" });
  await until(() => summaries(harness).length === 1);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false,
    "Cosmetic summaries must not advertise separate active work");
  response.text = "Done.";
  response.pending = false;
  const result = await Promise.race([
    harness.controller.waitForTurn("session-1").then(() => "completed"),
    delay(2_000).then(() => "still busy")
  ]);
  assert.equal(result, "completed");
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, false);
  await until(() => harness.upstreamSessions.size === 1);
  assert.equal(cancelled, true);
  assert.ok(interrupted.includes("ses_native_2"));
  await harness.controller.sendMessage("session-1", { message: "Next task", messageId: "next-turn" });
  await harness.controller.waitForTurn("session-1");
  const transcript = await harness.runtime.store.readConversationLog("session-1");
  assert.equal(transcript.length, 2);
  assert.equal(transcript[0].thinking.length, 1);
  assert.equal(transcript[0].assistant.text, "Done.");
  assert.equal(transcript[1].thinking?.length || 0, 0);
});

test("project closure aborts a running summary and deletes its native conversation", async (t) => {
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, {
    assistantResponses: [response],
    async beforePrompt({ input, signal }) {
      if (input.agent === "vibe64-economy") await delay(60_000, undefined, { signal });
    }
  });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "close-active" });
  await until(() => summaries(harness).length === 1);
  await harness.controller.closeAllForProject();
  assert.equal(harness.upstreamSessions.size, 1);
});

test("failed native helper deletion retains ownership and is retried on project closure", async (t) => {
  let allowDeletion = false;
  let deleteCalls = 0;
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, {
    assistantResponses: [response], helperResponse: summary,
    beforeDeleteSession(id) {
      if (id === "ses_native_1") return;
      deleteCalls += 1;
      if (!allowDeletion) throw new Error("Temporary deletion failure");
    }
  });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "retry-delete" });
  await until(() => harness.thinkingMessages.length === 1);
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
  await until(() => deleteCalls >= 2);
  assert.equal(harness.upstreamSessions.size, 2);
  assert.equal((await harness.runtime.store.readAgentRun("session-1", "opencode_server")).reasoningSummaryHelper.conversationId,
    "ses_native_2");
  allowDeletion = true;
  await harness.controller.closeAllForProject();
  assert.equal(harness.upstreamSessions.size, 1);
  assert.equal((await harness.runtime.store.readAgentRun("session-1", "opencode_server")).reasoningSummaryHelper, null);
});

test("summaries and representable native subagents use central Intern and retain the submitting actor", async (t) => {
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, { assistantResponses: [response], helperResponse: summary });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "helper-preference" }, {
    vibe64User: { role: "member", username: "collaborator" }
  });
  await until(() => harness.thinkingMessages.length === 1);
  assert.equal(summaries(harness)[0].input.model.id, "deepseek-chat");
  assert.equal(summaries(harness)[0].input.model.providerID, "deepseek");
  assert.equal(harness.accessCalls[0].modelProviderId, "deepseek");
  assert.equal(harness.accessCalls.every(({ vibe64User }) => vibe64User?.username === "collaborator"), true);
  const registry = JSON.parse(await readFile(harness.processStarts[0].options.sessionEnvironmentRegistry, "utf8"));
  assert.equal(registry.sessions.find(({ sessionId }) => sessionId === "session-1").internModelId, "deepseek-chat");
  assert.equal(registry.sessions[0].modelProviderId, "deepseek");
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
  await until(async () => !(await harness.runtime.store.readAgentRun("session-1", "opencode_server")).reasoningSummaryHelper);
  assert.equal((await harness.runtime.store.readAgentRun("session-1", "opencode_server")).submittedBy.username, "collaborator");
});
