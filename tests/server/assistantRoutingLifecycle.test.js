import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantRouting } from "../../packages/vibe64-terminals/src/server/assistantRouting.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
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
  const configuration = createAssistantRoutingStore({ systemRoot: root });
  await configuration.write({ codex: assignments }, 0);
  const metadata = { assistant_selection: JSON.stringify(assignments.plan),
    ...(preferences ? { assistant_routing: JSON.stringify(preferences) } : {}) };
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
    resolveExecutionProfile: async () => ({ model: "gpt-6-luna", profileId: "economy", workloadId: "request_routing" }),
    streamDetachedChatTurn: async (_id, input, options) => {
      helperCalls++;
      assert.match(input.prompt, /agreed required-field/);
      assert.doesNotMatch(input.prompt, /PRIVATE THOUGHT/);
      assert.equal(options.assistantSelection.modelId, "gpt-6-luna");
      options.onEvent({ threadId: "helper-1" });
      return { ok: true, threadId: "helper-1", text: '{"mode":"code","reason":"explicit_implementation"}' };
    },
    deleteDetachedChatThread: async () => { cleanupCalls++; return { ok: true }; },
    interruptDetachedChatTurn: async () => ({ ok: true }),
    inspectMessageAdmission: async () => ({ admission: "unknown" })
  };
  let lock = Promise.resolve();
  const exclusive = (_id, _options, operation) => {
    const next = lock.catch(() => {}).then(() => operation(context));
    lock = next;
    return next;
  };
  let failAdmission = false;
  const routingOptions = { systemRoot: root, agent, exclusive,
    publish: async (_id, value) => { events.push(structuredClone(value)); },
    dispatch: async (_id, input, selected) => {
      sends.push({ input, selection: selected.assistantSelection });
      await input.onPromptSending?.({ threadId: "native-thread" });
      if (failAdmission) throw new Error("Lost admission response.");
      receipts.set(input.messageId, input);
      return { ok: true, delivered: true, threadId: "native-thread", turnId: `turn-${sends.length}` };
    } };
  const service = createAssistantRouting(routingOptions);
  return { service, context, metadata, agent, sends, events, catalog, assignments, configuration,
    restart: () => createAssistantRouting(routingOptions),
    helperCalls: () => helperCalls, cleanupCalls: () => cleanupCalls,
    failAdmission: () => { failAdmission = true; }, state: () => JSON.parse(metadata.assistant_routing_request || "null") };
}
const request = { messageId: "request-1", message: "Yes, implement it.", submissionKind: "send" };
const completion = (turnId = "turn-1", state = "completed") => ({ payload: { agentRun: { active: false, state, providerTurnId: turnId } } });

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
  const classify = f.agent.streamDetachedChatTurn;
  f.agent.streamDetachedChatTurn = async (...args) => {
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

test("Stop cancels routing while helper cleanup finishes and prevents delivery", async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.agent.streamDetachedChatTurn = async (_id, _input, options) => {
    options.onEvent({ threadId: "helper-1" }); started.resolve();
    await finish.promise;
    return { ok: true, text: '{"mode":"code","reason":"explicit_implementation"}' };
  };
  f.agent.interruptDetachedChatTurn = async () => { finish.resolve(); return { ok: true }; };
  const sending = f.service.send("session-1", request, f.context);
  void sending.catch(() => {});
  await started.promise;
  assert.equal(await f.service.cancel("session-1", f.context), true);
  await assert.rejects(sending, /cancelled/);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.sends.length, 0);
  assert.equal(f.cleanupCalls(), 1);
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
  const classify = f.agent.streamDetachedChatTurn;
  f.agent.streamDetachedChatTurn = async (...args) => {
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
