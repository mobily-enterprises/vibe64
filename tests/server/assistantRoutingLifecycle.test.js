import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantRouting } from "../../packages/vibe64-terminals/src/server/assistantRouting.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS } from "@local/vibe64-runtime/shared";
import { recommendedRoutingAssignments } from "@local/vibe64-runtime/shared/assistantRouting";

async function fixture(t, preferences = { mode: "auto", review: true }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-lifecycle-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const catalog = { engineId: "codex", revision: `sha256:${"a".repeat(64)}`, transportId: "codex_app_server", label: "Codex",
    defaults: { agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "high" },
    agents: [{ id: "codex", mode: "primary" }], modelProviders: [
      { id: "openai", label: "GPT", connected: true, models: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"].map((id) => ({
        id, label: id, status: "available", variants: [{ id: "low" }, { id: "high" }]
      })) }, { id: "deepseek", label: "DeepSeek", connected: true, models: [{ id: "deepseek-flash", label: "DeepSeek Flash",
        status: "available", variants: [{ id: "low" }, { id: "high" }] }] }
    ] };
  const assignments = recommendedRoutingAssignments(catalog);
  // Keep a distinct, explicit classifier so lifecycle checks do not depend on recommendation rankings.
  assignments.router = { ...assignments.router, modelProviderId: "openai", modelId: "gpt-6-luna", selectionSource: "explicit" };
  const configuration = createAssistantRoutingStore({ systemRoot: root });
  await configuration.write({ codex: assignments }, 0);
  const metadata = { assistant_selection: JSON.stringify(assignments.plan),
    ...(preferences ? { assistant_routing: JSON.stringify({ workflowEngineId: "codex", ...preferences }) } : {}) };
  const receipts = new Map();
  const session = { sessionId: "session-1", metadata };
  const store = {
    readMetadataValue: async (_id, name) => metadata[name],
    writeMetadataValue: async (_id, name, value) => { metadata[name] = value; },
    conversationMessageIdExists: async (_id, messageId) => receipts.has(messageId),
    readConversationTail: async () => [{ user: { text: "Please propose validation." },
      messages: [{ role: "assistant", text: "Add the agreed required-field rule." }, { role: "thinking", text: "PRIVATE THOUGHT" }] }],
    writeConversationUserMessage: async (_id, value) => { receipts.set(value.messageId, value); }
  };
  const context = { runtime: { store, stateRoot: root }, session, vibe64User: { role: "owner", username: "owner" } };
  const sends = [];
  const events = [];
  let helperCalls = 0;
  let cleanupCalls = 0;
  const agent = {
    listCapabilities: async () => ({ engines: [catalog] }),
    requireAssistantAccessForSelection: async () => {},
    sessionState: async () => ({ turn: { active: false } }),
    readGoal: async () => ({ goal: null }),
    resolveEphemeralExecutionProfile: async (_scope, _input, options) => ({ model: options.assistantSelection.modelId,
      profileId: "economy", workloadId: "request_routing", providerId: options.assistantSelection.engineId,
      revision: "test", thinking: "low", limits: VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS.request_routing,
      policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
      request: { allowProviderModelFallback: false, reasoning: true, summary: false } }),
    createEphemeralConversation: async () => ({ ok: true, conversationId: "helper-1" }),
    startEphemeralConversationTurn: async (scope, input, options) => {
      helperCalls++;
      assert.match(input.message, /agreed required-field/);
      assert.doesNotMatch(input.message, /PRIVATE THOUGHT/);
      assert.notEqual(scope.id, session.sessionId);
      assert.equal(options.session, undefined);
      assert.equal(options.runtime, undefined);
      assert.equal(JSON.parse(metadata.assistant_routing_request).helper.conversationId, "helper-1",
        "capture the native helper before submitting any inference");
      return { ok: true, runId: "helper-turn-1" };
    },
    waitForEphemeralConversationTurn: async () => ({ ok: true, text: '{"mode":"code","reason":"explicit_implementation"}' }),
    deleteEphemeralConversation: async () => { cleanupCalls++; return { ok: true }; },
    stopEphemeralConversation: async () => ({ ok: true }),
    inspectMessageAdmission: async () => ({ admission: "unknown" })
  };
  const catalogs = [catalog];
  const connections = new Map();
  const manager = createSessionAgentManager({
    providers: ["codex", "opencode", "claude"].map((id) => ({ id, transportId: id === "codex" ? "codex_app_server" : id === "claude" ? "claude_stream_json" : "opencode_server",
      capabilities: async () => catalogs.find((row) => row.engineId === id) })),
    readRoutingConfiguration: () => configuration.read(),
    readAssistantAccess: async ({ engineId, modelProviderId }) => ({ available: true,
      ownerOnly: modelProviderId === "openai", connectionIdentity: `${engineId}:${modelProviderId}:1`,
      ...connections.get(`${engineId}:${modelProviderId}`) })
  });
  agent.resolveAssistantPurpose = (input, options) => manager.resolveAssistantPurpose(input, options);
  let lock = Promise.resolve();
  const exclusive = (_id, _options, operation) => {
    const next = lock.catch(() => {}).then(() => operation({ ...context, ..._options }));
    lock = next;
    return next;
  };
  let failAdmission = false;
  const routingOptions = { systemRoot: root, agent, exclusive,
    publish: async (_id, value) => { events.push(structuredClone(value)); },
    dispatch: async (_id, input, selected) => {
      await input.onPromptSending?.({ threadId: "native-thread" });
      sends.push({ input, selection: selected.assistantSelection });
      if (failAdmission) throw new Error("Lost admission response.");
      receipts.set(input.messageId, input);
      return { ok: true, delivered: true, threadId: "native-thread", turnId: `turn-${sends.length}` };
    } };
  const service = createAssistantRouting(routingOptions);
  return { service, context, metadata, agent, sends, events, catalog, catalogs, connections, assignments, configuration,
    restart: () => createAssistantRouting(routingOptions),
    helperCalls: () => helperCalls, cleanupCalls: () => cleanupCalls,
    failAdmission: () => { failAdmission = true; }, state: () => JSON.parse(metadata.assistant_routing_request || "null") };
}
const request = { messageId: "request-1", message: "Yes, implement it.", submissionKind: "send" };
const completion = (turnId = "turn-1", state = "completed") => ({ payload: { agentRun: { active: false, state, providerTurnId: turnId } } });

test("generated Code preserves chat preferences and reports its destination before inference without routing or review", async (t) => {
  const f = await fixture(t, { mode: "plan", review: true });
  const preferences = f.metadata.assistant_routing;
  const admitted = [];
  const options = { ...f.context, purpose: "code", onPromptSending: async (destination) => {
    assert.equal(f.sends.length, 0);
    assert.equal(f.state().attemptedMessageId, undefined);
    admitted.push(destination);
  } };
  assert.equal((await f.service.send("session-1", request, options)).delivered, true);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.deepEqual(admitted, [{ threadId: "native-thread", assistantSelection: f.sends[0].selection }]);
  assert.equal(f.state().resolvedMode, "code");
  assert.equal(f.state().review, false);
  assert.equal(f.metadata.assistant_routing, preferences);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal((await f.service.send("session-1", request, options)).duplicate, true);
  assert.equal(admitted.length, 1);
});

test("generated Code stops before inference when its domain receipt cannot be claimed", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.send("session-1", request, { ...f.context, purpose: "code",
    onPromptSending: async () => { throw new Error("Configuration changed before admission."); }
  }), /Configuration changed/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.state().status, "failed");
});

test("generated Code cannot change the mode of an unfinished Plan goal", async (t) => {
  const f = await fixture(t);
  f.metadata.assistant_routing_goal = JSON.stringify({ status: "paused", mode: "plan", selection: f.assignments.plan });
  await assert.rejects(f.service.send("session-1", request, { ...f.context, purpose: "code" }), /Finish or cancel/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
});

test("Auto uses a bounded helper then ordinary delivery and exactly one visible review", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.send("session-1", request, f.context)).delivered, true);
  assert.equal(f.helperCalls(), 1);
  assert.equal(f.cleanupCalls(), 1);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.equal(f.sends[0].input.displayMessage, request.message);
  assert.match(f.sends[0].input.message, /Vibe64 mode: code/);
  assert.equal(f.events[0].payload.assistantRoutingRequest.status, "routing");
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
  assert.equal(f.sends[1].input.messageId, f.state().reviewMessageId);
  assert.equal(f.sends[1].input.turnMetadata.assistantRouting.parentMessageId, "request-1");
  assert.match(f.sends[1].input.message, /may directly fix/);
  await f.service.afterTurn("session-1", completion(), f.context);
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().reviewStatus, "completed");
});

test("changing routing settings while classifying does not retarget this request", async (t) => {
  const f = await fixture(t);
  const classify = f.agent.waitForEphemeralConversationTurn;
  f.agent.waitForEphemeralConversationTurn = async (...args) => {
    await f.configuration.write({ codex: { ...f.assignments, code: f.assignments.plan } }, 1);
    return classify(...args);
  };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
});

test("uncertain native admission is inspected on retry without resending", async (t) => {
  const f = await fixture(t);
  f.failAdmission();
  await assert.rejects(f.service.send("session-1", request, f.context), /Lost admission/);
  assert.equal(f.state().status, "uncertain");
  await assert.rejects(f.service.send("session-1", request, f.context), /Delivery is uncertain/);
  f.agent.inspectMessageAdmission = async () => ({ admission: "accepted" });
  assert.equal((await f.service.send("session-1", request, f.context)).delivered, true);
  assert.equal(f.sends.length, 1);
  assert.equal(f.helperCalls(), 1);
});

test("steering does not classify, and an unfinished goal rejects Auto", async (t) => {
  const f = await fixture(t);
  f.agent.sessionState = async () => ({ turn: { active: true } });
  await f.service.send("session-1", { ...request, submissionKind: "steer" }, f.context);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends[0].input.message, request.message);
  f.agent.sessionState = async () => ({ turn: { active: false } });
  f.agent.readGoal = async () => ({ goal: { status: "paused" } });
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "next" }, f.context), /before working on a goal/);
});

test("unavailable goal observation cannot erase a saved active goal and unlock Auto", async (t) => {
  const f = await fixture(t);
  f.metadata.assistant_routing_goal = JSON.stringify({ mode: "code", status: "paused", selection: f.assignments.code });
  for (const status of ["unsupported", "unavailable"]) {
    f.agent.readGoal = async () => ({ status, goal: null });
    await assert.rejects(f.service.send("session-1", request, f.context), /before working on a goal/);
  }
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends.length, 0);
  assert.equal(JSON.parse(f.metadata.assistant_routing_goal).status, "paused");
  f.agent.readGoal = async () => ({ status: "available", goal: null });
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends.length, 1);
});

test("a retained goal prevents automatic review even when native goal observation is unavailable", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  f.metadata.assistant_routing_goal = JSON.stringify({ mode: "code", status: "active", selection: f.assignments.code });
  f.agent.readGoal = async () => ({ status: "unavailable", goal: null });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().reviewStatus, "skipped_goal");
  assert.equal(f.state().status, "done");
  f.agent.readGoal = async () => ({ status: "available", goal: null });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
});

test("polling completion before the native event schedules a live review exactly once", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context, { recovered: true });
  assert.equal(f.state().status, "reviewing");
  assert.equal(f.sends.length, 2);
  await f.service.afterTurn("session-1", completion(), f.context);
  await f.service.afterTurn("session-1", completion(), f.context, { recovered: true });
  assert.equal(f.sends.length, 2);
});

test("Stop cancels routing while helper cleanup finishes and prevents delivery", async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.agent.waitForEphemeralConversationTurn = async () => {
    started.resolve();
    await finish.promise;
    return { ok: true, text: '{"mode":"code","reason":"explicit_implementation"}' };
  };
  f.agent.stopEphemeralConversation = async () => { finish.resolve(); return { ok: true }; };
  const sending = f.service.send("session-1", request, f.context);
  void sending.catch(() => {});
  await started.promise;
  assert.equal(await f.service.cancel("session-1", f.context), true);
  await assert.rejects(sending, /cancelled/);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.sends.length, 0);
  assert.equal(f.cleanupCalls(), 1);
});

test("Stop reports a clean routing cancellation instead of the provider's AbortError", async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.agent.waitForEphemeralConversationTurn = async () => {
    started.resolve();
    await finish.promise;
    throw new DOMException("This operation was aborted", "AbortError");
  };
  f.agent.stopEphemeralConversation = async () => { finish.resolve(); return { ok: true }; };
  const sending = f.service.send("session-1", request, f.context);
  void sending.catch(() => {});
  await started.promise;
  await f.service.cancel("session-1", f.context);
  await assert.rejects(sending, { code: "vibe64_assistant_routing_cancelled", statusCode: 409 });
  assert.equal(f.state().helper, null);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.sends.length, 0);
  assert.equal(f.state().review, false);
});

test("Stop still reports a helper cleanup failure and retains the helper for retry", async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.agent.waitForEphemeralConversationTurn = async () => {
    started.resolve();
    await finish.promise;
    throw new DOMException("This operation was aborted", "AbortError");
  };
  f.agent.stopEphemeralConversation = async () => { finish.resolve(); return { ok: true }; };
  f.agent.deleteEphemeralConversation = async () => ({ ok: false });
  const sending = f.service.send("session-1", request, f.context);
  void sending.catch(() => {});
  await started.promise;
  await f.service.cancel("session-1", f.context);
  await assert.rejects(sending, /helper could not be closed/);
  assert.equal(f.state().helper.conversationId, "helper-1");
  assert.match(f.state().error, /helper could not be closed/);
  assert.equal(f.sends.length, 0);
});

test("an interrupted Code turn never starts a review", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion("turn-1", "interrupted"), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.helperCalls(), 0);
});

test("Stop during Code disables its review and still asks the caller to interrupt native work", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  f.agent.sessionState = async () => ({ turn: { active: true, id: "turn-1" } });
  assert.equal(await f.service.cancel("session-1", f.context), false);
  f.agent.sessionState = async () => ({ turn: { active: false, id: "turn-1" } });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
});

test("Stop during review keeps a late successful completion incomplete and allows a fresh request", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(await f.service.cancel("session-1", f.context), false);
  const restarted = f.restart();
  await restarted.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.state().reviewStatus, "incomplete");
  await restarted.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  await restarted.send("session-1", { ...request, messageId: "fresh-request" }, f.context);
  assert.equal(f.sends.length, 3);
  assert.equal(f.state().messageId, "fresh-request");
});

test("a restart after Stop cannot resurrect the cancelled review", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  await f.service.cancel("session-1", f.context);
  f.context.session.agentRuns = [completion().payload.agentRun];
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "done");
  assert.equal(f.state().reviewStatus, "cancelled");
});

test("restart recovery offers the unsent review for explicit retry and reviews exactly once", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  f.context.session.agentRuns = [completion().payload.agentRun];
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "review_pending");
  await f.restart().send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2);
  f.context.session.agentRuns = [completion("turn-2").payload.agentRun];
  await f.restart().reconcile("session-1", f.context);
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().reviewStatus, "completed");
});

test("restart during request preparation exposes recovery without automatically resending", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  const accepted = f.state();
  for (const [status, attemptedMessageId, expected] of [
    ["routing", null, "failed"], ["sending", null, "failed"],
    ["sending", request.messageId, "uncertain"], ["review_sending", null, "review_pending"],
    ["review_sending", accepted.reviewMessageId, "review_uncertain"], ["review_pending", null, "review_pending"]
  ]) {
    f.metadata.assistant_routing_request = JSON.stringify({ ...accepted, status, attemptedMessageId });
    await f.restart().reconcile("session-1", f.context);
    assert.equal(f.state().status, expected);
    assert.equal(f.sends.length, 1);
  }
});

test("an unrelated idle event cannot authorize review when the original turn ID needs recovery", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), turnId: "" });
  f.agent.inspectMessageAdmission = async (_id, input) => {
    assert.equal(input.messageId, request.messageId);
    return { admission: "accepted", turnId: "turn-1" };
  };
  await f.service.afterTurn("session-1", completion("unrelated-turn"), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().turnId, "turn-1");
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
});

test("missing native turn evidence skips automatic review instead of guessing completion", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), turnId: "" });
  await f.service.afterTurn("session-1", completion("unrelated-turn"), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().reviewStatus, "skipped_unconfirmed");
  assert.match(f.state().error, /could not be matched/);
});

test("a new request cannot overtake a pending review and Skip releases that boundary", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "next" }, f.context), /preparing its review/);
  f.catalog.modelProviders[0].connected = false;
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().status, "review_pending");
  assert.equal(await f.service.cancel("session-1", f.context), true);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
});

test("an uncertain review checks its existing native receipt and never starts a second reviewer", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  await f.service.send("session-1", request, f.context);
  f.failAdmission();
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().status, "review_uncertain");
  f.agent.inspectMessageAdmission = async () => ({ admission: "accepted", turnId: "turn-2" });
  await f.service.send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.state().turnId, "turn-2");
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.state().reviewStatus, "completed");
  assert.equal(f.sends.length, 2);
});

test("an orchestrator change during classification refuses delivery", async (t) => {
  const f = await fixture(t);
  const classify = f.agent.waitForEphemeralConversationTurn;
  f.agent.waitForEphemeralConversationTurn = async (...args) => {
    const result = await classify(...args);
    f.metadata.assistant_selection = JSON.stringify({ ...f.assignments.plan, engineId: "claude" });
    return result;
  };
  await assert.rejects(f.service.send("session-1", request, f.context), /orchestrator changed/);
  assert.equal(f.sends.length, 0);
});

test("goal preparation pins an explicit route only for the caller to commit after native acceptance", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  const prepared = await f.service.prepareGoal("session-1", { action: "set", objective: "Implement agreed validation" }, f.context);
  assert.equal(prepared.pinned.selection.modelId, "deepseek-flash");
  assert.match(prepared.input.objective, /Vibe64 mode: code/);
  assert.equal(f.metadata.assistant_routing_goal, undefined);
});

function sharedOpenCode(f, modelProviderId = "opencode", modelId = "big-pickle") {
  const catalog = { ...structuredClone(f.catalog), engineId: "opencode", transportId: "opencode_server", label: "OpenCode",
    agents: [{ id: "build", mode: "primary" }], defaults: { agentId: "build", modelProviderId, modelId, variantId: "" },
    modelProviders: [{ id: modelProviderId, label: modelProviderId, connected: true,
      models: [{ id: modelId, label: modelId, status: "available", variants: [] }] }] };
  f.catalogs.push(catalog);
  return { schema: "vibe64.assistant-selection.v1", engineId: "opencode", agentId: "build", modelProviderId, modelId,
    variantId: "", catalogRevision: catalog.revision, selectionSource: "explicit" };
}

test("Auto uses a foreign Router and does not require Economy", async (t) => {
  const f = await fixture(t);
  const router = sharedOpenCode(f, "deepseek", "deepseek-chat");
  await f.configuration.write({ codex: { ...f.assignments, router, economy: null } }, 1);
  const start = f.agent.startEphemeralConversationTurn;
  f.agent.startEphemeralConversationTurn = async (scope, input, options) => {
    assert.equal(options.assistantSelection.engineId, "opencode");
    assert.equal(JSON.parse(f.metadata.assistant_selection).engineId, "codex");
    assert.deepEqual(scope.environment, {});
    return start(scope, input, options);
  };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.state().assignments.router.modelId, "deepseek-chat");
  assert.equal(f.state().assignments.economy, undefined);
  assert.equal(f.sends[0].selection.engineId, "codex");
  assert.equal(f.state().helper, null);
});

for (const review of [false, true]) {
  test(`a member's foreign Backup keeps Plan and Code together with review ${review}`, async (t) => {
    const f = await fixture(t, { mode: "code", review });
    const backup = sharedOpenCode(f);
    await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
    f.context.vibe64User = { role: "member", username: "collaborator" };
    await f.service.send("session-1", request, f.context);
    assert.equal(f.sends[0].selection.engineId, "opencode");
    assert.equal(f.state().assignments.plan.modelId, "big-pickle");
    assert.equal(f.state().assignments.code.modelId, "big-pickle", "even the otherwise-shared original coder follows the pair");
    assert.equal(f.state().workflowEngineId, "codex");
    assert.equal(f.sends[0].input.turnMetadata.assistantRouting.backupUsed, true);
    await f.service.afterTurn("session-1", completion(), f.context);
    if (review) {
      assert.equal(f.sends[1].selection.engineId, "opencode");
      assert.equal(f.sends[1].selection.modelId, "big-pickle");
      await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    }
    assert.equal(f.sends.length, review ? 2 : 1);
    f.metadata.assistant_routing = JSON.stringify({ mode: "plan", workflowEngineId: "codex", review: false });
    await f.service.send("session-1", { ...request, messageId: "next-plan" }, f.context);
    assert.equal(f.sends.at(-1).selection.engineId, "opencode");
    assert.equal(f.state().workflowEngineId, "codex", "a backup execution never chooses its own workflow profile");
  });
}

test("a member cannot unlock Auto through Backup", async (t) => {
  const f = await fixture(t);
  const backup = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, router: backup, sharedBackup: backup } }, 1);
  f.context.vibe64User = { role: "member", username: "collaborator" };
  await assert.rejects(f.service.send("session-1", request, f.context), /Auto requires direct access/);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends.length, 0);
});

test("review retries retain the original member when the owner triggers the retry", async (t) => {
  const f = await fixture(t, { mode: "code", review: true });
  const backup = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.context.vibe64User = { role: "member", username: "collaborator" };
  await f.service.send("session-1", request, f.context);
  f.context.session.agentRuns = [completion().payload.agentRun];
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "review_pending");
  f.context.vibe64User = { role: "owner", username: "owner" };
  await f.restart().send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.sends[1].selection.modelId, "big-pickle");
  assert.equal(f.state().submittedBy.username, "collaborator");
});

test("replacing a captured connection while Router works refuses delivery", async (t) => {
  const f = await fixture(t);
  f.agent.waitForEphemeralConversationTurn = async () => {
    f.connections.set("codex:deepseek", { connectionIdentity: "codex:deepseek:replacement" });
    return { ok: true, text: '{"mode":"code","reason":"explicit_implementation"}' };
  };
  await assert.rejects(f.service.send("session-1", request, f.context), /connection changed/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.cleanupCalls(), 1);
});

test("failed Router cleanup retains ownership across restart and blocks a new request", async (t) => {
  const f = await fixture(t);
  const cleanup = f.agent.deleteEphemeralConversation;
  f.agent.deleteEphemeralConversation = async () => ({ ok: false });
  await assert.rejects(f.service.send("session-1", request, f.context), /could not be closed/);
  assert.equal(f.state().helper.conversationId, "helper-1");
  assert.equal(f.sends.length, 0);
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().helper.conversationId, "helper-1");
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "next" }, f.context), /cleanup/);
  f.agent.deleteEphemeralConversation = async (scope, input, options) => {
    assert.equal(scope.id, f.state().helper.scope.id);
    assert.equal(input.conversationId, "helper-1");
    return cleanup(scope, input, options);
  };
  assert.equal(await f.restart().cancel("session-1", f.context), true);
  assert.equal(f.state().helper, null);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.sends.length, 0);
});

test("Stop during native helper startup stops the late turn before delivery", async (t) => {
  const f = await fixture(t);
  const starting = Promise.withResolvers();
  const finishStart = Promise.withResolvers();
  let stops = 0;
  f.agent.startEphemeralConversationTurn = async () => {
    starting.resolve();
    await finishStart.promise;
    return { ok: true, runId: "late-turn" };
  };
  f.agent.stopEphemeralConversation = async (_scope, input) => {
    stops++;
    if (stops === 1) assert.equal(input.runId, "");
    else assert.equal(input.runId, "late-turn");
    return { ok: true };
  };
  const sending = f.service.send("session-1", request, f.context);
  void sending.catch(() => {});
  await starting.promise;
  await f.service.cancel("session-1", f.context);
  finishStart.resolve();
  await assert.rejects(sending, /cancelled/);
  assert.equal(stops, 2);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.state().helper, null);
  assert.equal(f.sends.length, 0);
});

test("foreign Economy returns to the saved workflow's Plan role", async (t) => {
  const f = await fixture(t, { mode: "economy", review: true });
  const economy = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, economy } }, 1);
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, "big-pickle");
  assert.equal(f.state().review, false);
  await f.service.afterTurn("session-1", completion(), f.context);
  f.metadata.assistant_routing = JSON.stringify({ mode: "plan", workflowEngineId: "codex", review: false });
  await f.service.send("session-1", { ...request, messageId: "plan-again" }, f.context);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
  assert.equal(f.state().workflowEngineId, "codex");
});

test("a goal switching orchestrators requires ordinary Send before native goal admission", async (t) => {
  const f = await fixture(t, { mode: "code", review: false });
  const backup = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.context.vibe64User = { role: "member", username: "collaborator" };
  await assert.rejects(f.service.prepareGoal("session-1", { action: "set", objective: "Implement agreed validation" }, f.context),
    { code: "vibe64_changeover_message_required" });
  assert.equal(f.metadata.assistant_routing_goal, undefined);
  assert.equal(JSON.parse(f.metadata.assistant_selection).engineId, "opencode");
});

test("a migrated unsent request goes through fresh admission while retaining its original actor", async (t) => {
  const f = await fixture(t, { mode: "code", review: false });
  const backup = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 2, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "code", resolvedMode: "code", status: "failed", review: false,
    assignments: { code: f.assignments.code }, settingsRevision: 1, submittedBy: { role: "member", username: "original-member" } });
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.engineId, "opencode");
  assert.equal(f.state().submittedBy.username, "original-member");
  assert.equal(f.state().admissionRequired, undefined);
  assert.equal(f.state().decision.backupUsed, true);
});

test("a migrated uncertain request can inspect admission without authorizing fresh inference", async (t) => {
  const f = await fixture(t, { mode: "code", review: false });
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 2, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "code", resolvedMode: "code", status: "uncertain", review: false,
    assignments: { code: f.assignments.code }, attemptedMessageId: request.messageId, threadId: "retained-thread", settingsRevision: 1 });
  f.agent.resolveAssistantPurpose = async () => { throw new Error("No inference admission should run for receipt inspection"); };
  f.agent.inspectMessageAdmission = async (_id, input) => {
    assert.equal(input.threadId, "retained-thread");
    return { admission: "accepted", turnId: "original-turn" };
  };
  assert.equal((await f.service.send("session-1", request, f.context)).delivered, true);
  assert.equal(f.sends.length, 0);
  assert.equal(f.state().turnId, "original-turn");
  assert.equal(f.state().admissionRequired, true);
});

test("review does not depend on the completed Router's connection remaining available", async (t) => {
  const f = await fixture(t);
  const router = sharedOpenCode(f, "deepseek", "deepseek-chat");
  await f.configuration.write({ codex: { ...f.assignments, router } }, 1);
  await f.service.send("session-1", request, f.context);
  f.connections.set("opencode:deepseek", { available: false });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
});

test("a legacy explicit goal retains its model when the current configured coder differs", async (t) => {
  const f = await fixture(t, { mode: "code", review: false });
  f.metadata.assistant_routing_goal = JSON.stringify({ mode: "code", workflowEngineId: "codex", selection: f.assignments.code,
    objective: "Implement validation", status: "paused" });
  await f.configuration.write({ codex: { ...f.assignments, code: f.assignments.plan } }, 1);
  const prepared = await f.service.prepareGoal("session-1", { action: "resume" }, f.context);
  assert.equal(prepared.pinned.selection.modelId, "deepseek-flash");
});

test("an uncertain request inspects its receipt while native work is still active", async (t) => {
  const f = await fixture(t, { mode: "code", review: false });
  f.failAdmission();
  await assert.rejects(f.service.send("session-1", request, f.context), /Lost admission/);
  f.agent.sessionState = async () => ({ turn: { active: true, id: "turn-1" } });
  f.agent.inspectMessageAdmission = async () => ({ admission: "accepted", turnId: "turn-1" });
  assert.equal((await f.service.send("session-1", request, f.context)).delivered, true);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "sent");
});
