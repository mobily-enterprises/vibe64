import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readWorkPlan, readWorkPlanPage, readWorkPlanHistory, manageWorkPlan, workPlanPath, planProgressUpgradeChanges } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { validateConversationOutputSchema } from "@jskit-ai/assistant-core/server/conversation";
import { createAssistantRouting } from "../../packages/vibe64-terminals/src/server/assistantRouting.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { codexAuthMarkerPath } from "@local/vibe64-core/server/codexAuthState";
import { readCodexSelectedAccountAccess } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { VIBE64_AGENT_HELPER_WORKLOAD_LIMITS, defineVibe64AgentExecutionProfileRequest } from "@local/vibe64-runtime/shared";
import { assistantRoutingStatusLabel, recommendedRoutingAssignments } from "@local/vibe64-runtime/shared/assistantRouting";

// Explicit offline fixture publication; production readers never convert legacy data.
async function publishPlanFixture(context, text) {
  const root = path.dirname(workPlanPath(context));
  for (const { name, text: contents } of planProgressUpgradeChanges([{ name: "current.md", text }])) {
    const filename = path.join(root, name);
    if (contents === null) await rm(filename, { force: true });
    else {
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      await writeFile(filename, contents, { mode: 0o600 });
    }
  }
}

function planDocument(status = "active") {
  return `# Required-field validation
Status: ${status}

` + [
    ["Outcome and scope", "Validate the required name in the existing form only."],
    ["Findings", "The agreed required-field rule is missing from src/form.js and tests/form.test.js."],
    ["Proposed changes", "Reject a blank name before submitting; keep other validation unchanged."],
    ["Decisions", "Use the existing form error presentation; no unresolved decisions."],
    ["Implementation steps", "1. Add the name check. 2. Add empty and populated form cases."],
    ["Verification", "Run the form tests and verify submission is prevented only for empty names."],
    ["Progress and blockers", "Implementation has not started."]
  ].map(([heading, body]) => `## ${heading}
${body}
`).join("\n");
}

test("working plan pages preserve full Unicode text and reject mixing revisions", async (t) => {
  const f = await fixture(t, undefined, { readyPlan: false });
  assert.deepEqual(await readWorkPlanPage(f.context), { available: false, current: null, history: [] });
  const text = `${planDocument()}\n${"🙂 quoted \"text\" ".repeat(2300)}\n  `;
  await mkdir(path.dirname(workPlanPath(f.context)), { recursive: true });
  await publishPlanFixture(f.context, text);
  let page = await readWorkPlanPage(f.context);
  assert.equal(page.status, "active");
  const revision = page.revision;
  const parts = [];
  while (true) {
    assert.equal(page.revision, revision);
    assert.ok(Array.from(page.text).length <= 16000);
    parts.push(page.text);
    if (!page.hasMore) break;
    page = await readWorkPlanPage(f.context, { offset: page.nextOffset, expectedRevision: revision });
  }
  assert.equal(parts.join(""), text);
  assert.equal(page.nextOffset, Array.from(text).length);
  await assert.rejects(readWorkPlanPage(f.context, { offset: 1 }), { code: "vibe64_work_plan_revision_required" });
  await assert.rejects(readWorkPlanPage(f.context, { offset: page.totalCharacters + 1, expectedRevision: revision }),
    { code: "vibe64_work_plan_offset_invalid" });
  await publishPlanFixture(f.context, `${text}\nchanged`);
  await assert.rejects(readWorkPlanPage(f.context, { offset: 16000, expectedRevision: revision }), { code: "vibe64_work_plan_changed" });
  assert.notEqual((await readWorkPlanPage(f.context)).revision, revision);
  assert.equal(f.sends.length, 0);
});

async function fixture(t, preferences = { mode: "auto", review: true }, { resolveAssistantUser, beforeExclusive, readyPlan = true } = {}) {
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
  // Preserve the original explicit lifecycle routes independently of recommendation policy.
  assignments.junior = { ...assignments.junior, modelProviderId: "deepseek", modelId: "deepseek-flash", selectionSource: "explicit" };
  assignments.helper = { ...assignments.junior, variantId: "low" };
  // Keep a distinct, explicit classifier so lifecycle checks do not depend on recommendation rankings.
  assignments.router = { ...assignments.router, modelProviderId: "openai", modelId: "gpt-6-luna", selectionSource: "explicit" };
  const configuration = createAssistantRoutingStore({ systemRoot: root });
  await configuration.write({ codex: assignments }, 0);
  const metadata = { assistant_selection: JSON.stringify(assignments.senior),
    ...(preferences ? { assistant_routing: JSON.stringify({ workflowEngineId: "codex", ...preferences }) } : {}) };
  const receipts = new Map();
  const notices = new Map();
  const session = { sessionId: "session-1", metadata };
  const store = {
    paths: () => ({ sessionRoot: path.join(root, "sessions", session.sessionId), conversationsRoot: path.join(root, "sessions", session.sessionId, "conversations") }),
    readMetadataValue: async (_id, name) => metadata[name],
    writeMetadataValue: async (_id, name, value) => { metadata[name] = value; },
    conversationMessageIdExists: async (_id, messageId) => receipts.has(messageId),
    readConversationTail: async () => [{ user: { text: "Please propose validation." },
      messages: [{ role: "assistant", text: "Add the agreed required-field rule." }, { role: "thinking", text: "PRIVATE THOUGHT" }] }],
    writeConversationUserMessage: async (_id, value) => { receipts.set(value.messageId, value); },
    writeConversationSystemMessage: async (_id, value) => {
      if (notices.has(value.messageId)) return null;
      const turn = { turnId: value.messageId, system: { role: "system", ...value } };
      notices.set(value.messageId, turn);
      return turn;
    }
  };
  const context = { runtime: { store, stateRoot: root }, session, vibe64User: { role: "owner", username: "owner" } };
  if (readyPlan) {
    await mkdir(path.dirname(workPlanPath(context)), { recursive: true });
    await publishPlanFixture(context, planDocument());
    metadata.assistant_routing_request = JSON.stringify({ status: "done", workPlan: await readWorkPlan(context) });
  }
  const sends = [];
  const events = [];
  let helperCalls = 0;
  let cleanupCalls = 0;
  const router = {
    respond: async () => ({ ok: true, text: '{"mode":"junior","reason":"plan_implementation"}' }),
    review: async () => ({ ok: true, text: '{"decision":"review","reason":"ready","explanation":"Implementation is ready for review.","nextStep":"","progress":true}' }),
    classifyInputs: [],
    reviewInputs: []
  };
  const agent = {
    listCapabilities: async () => ({ engines: [catalog] }),
    requireAssistantAccessForSelection: async () => {},
    sessionState: async () => ({ turn: { active: false } }),
    readGoal: async () => ({ goal: null }),
    resolveEphemeralExecutionProfile: async (_scope, input, options) => ({ model: options.assistantSelection.modelId,
      ...defineVibe64AgentExecutionProfileRequest(input), providerId: options.assistantSelection.engineId,
      revision: "test", thinking: "low", limits: VIBE64_AGENT_HELPER_WORKLOAD_LIMITS.request_routing,
      policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
      request: { allowProviderModelFallback: false, reasoning: true, summary: false } }),
    createEphemeralConversation: async () => ({ ok: true, conversationId: "helper-1" }),
    startEphemeralConversationTurn: async (scope, input, options) => {
      validateConversationOutputSchema(input.outputSchema, input.executionProfile.limits);
      helperCalls++;
      if (input.outputSchema.properties.decision) router.reviewInputs.push(input);
      else {
        router.classifyInputs.push(input);
        assert.match(input.message, /agreed required-field/);
      }
      assert.doesNotMatch(input.message, /PRIVATE THOUGHT/);
      assert.notEqual(scope.id, session.sessionId);
      assert.equal(options.session, undefined);
      assert.equal(options.runtime, undefined);
      assert.equal(JSON.parse(metadata.assistant_routing_request).helper.conversationId, "helper-1",
        "capture the native helper before submitting any inference");
      return { ok: true, runId: input.outputSchema.properties.decision ? "review-helper-turn" : "helper-turn-1" };
    },
    waitForEphemeralConversationTurn: async (...args) => args[1].runId === "review-helper-turn"
      ? router.review(...args) : router.respond(...args),
    deleteEphemeralConversation: async () => { cleanupCalls++; return { ok: true }; },
    stopEphemeralConversation: async () => ({ ok: true }),
    inspectMessageAdmission: async () => ({ admission: "unknown" })
  };
  const catalogs = [catalog];
  const connections = new Map();
  const manager = createSessionAgentManager({
    resolveAssistantUser,
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
    const next = lock.catch(() => {}).then(() => {
      beforeExclusive?.();
      return operation({ ...context, ..._options });
    });
    lock = next;
    return next;
  };
  let failAdmission = false;
  const routingOptions = { systemRoot: root, agent, exclusive,
    publish: async (_id, value) => { events.push(structuredClone(value)); },
    dispatch: async (_id, input, selected) => {
      await manager.requireAssistantAccessForSelection(selected.assistantSelection || JSON.parse(selected.session.metadata.assistant_selection), selected);
      await input.onPromptSending?.({ threadId: "native-thread" });
      sends.push({ input, selection: selected.assistantSelection });
      if (failAdmission) throw new Error("Lost admission response.");
      receipts.set(input.messageId, input);
      return { ok: true, delivered: true, threadId: "native-thread", turnId: `turn-${sends.length}` };
    } };
  const service = createAssistantRouting(routingOptions);
  return { service, context, metadata, agent, router, sends, events, notices, catalog, catalogs, connections, assignments, configuration,
    restart: () => createAssistantRouting(routingOptions),
    helperCalls: () => helperCalls, cleanupCalls: () => cleanupCalls,
    failAdmission: () => { failAdmission = true; }, state: () => JSON.parse(metadata.assistant_routing_request || "null") };
}
const request = { messageId: "request-1", message: "Yes, implement it.", submissionKind: "send" };
const completion = (turnId = "turn-1", state = "completed") => ({ payload: { agentRun: { active: false, state, providerTurnId: turnId } } });

test("a pause steer is included in the last five messages and suppresses automatic review and Deslop", async (t) => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.context.runtime.store.readConversationTail = async (_id, options) => {
    if (options) assert.equal(options.userLimit, 5);
    return [
      { user: { text: "Execute the plan" }, messages: [{ role: "assistant", text: "Implementing the form." }] },
      { user: { text: "Are you still working on it?" }, messages: [{ role: "assistant", text: "The code is ready; browser checks are blocked." }] },
      { user: { text: "Wait I am trying to fix the browser" }, messages: [
        { role: "thinking", text: "PRIVATE THOUGHT" },
        { role: "assistant", text: "I'll pause here while you fix the browser. The plan remains active." }
      ] }
    ];
  };
  f.router.review = async () => ({ ok: true, text: '{"decision":"wait","reason":"user_wait","explanation":"Waiting for the requested input.","nextStep":"","progress":true}' });
  await f.service.afterTurn("session-1", completion(), f.context);
  const prompt = f.router.reviewInputs[0].message;
  const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
  assert.equal(input.originalRequest, request.message);
  assert.deepEqual(input.messages.map(({ text }) => text), [
    "Implementing the form.", "Are you still working on it?", "The code is ready; browser checks are blocked.",
    "Wait I am trying to fix the browser", "I'll pause here while you fix the browser. The plan remains active."
  ]);
  assert.equal(f.state().status, "done");
  assert.equal(f.state().reviewStatus, "cancelled");
  assert.equal(f.state().helper, null);
  assert.equal(f.state().workPlan.status, "active");
  await f.restart().afterTurn("session-1", completion(), f.context, { recovered: true });
  assert.equal(f.sends.length, 1, "neither review nor Deslop is admitted after the pause");
  assert.equal(f.helperCalls(), 2);
});

test("Router can allow review after a later explicit resume supersedes a pause", async (t) => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.context.runtime.store.readConversationTail = async () => [
    { user: { text: "Wait while I fix the browser" }, messages: [{ role: "assistant", text: "Paused." }] },
    { user: { text: "Browser is fixed. Continue and review the implementation." }, messages: [{ role: "assistant", text: "Implementation and browser checks are complete." }] }
  ];
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.match(f.router.reviewInputs[0].message, /Continue and review the implementation/);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
  assert.match(f.sends[1].input.message, /Automatic review and Deslop/);
});

for (const [reason, status] of [["question", "skipped_question"], ["blocked", "skipped_incomplete"], ["no_progress", "skipped_incomplete"], ["unclear", "skipped_unconfirmed"]]) {
  test(`Router defers automatic review for ${reason}`, async (t) => {
    const f = await fixture(t);
    await f.service.send("session-1", request, f.context);
    f.router.review = async () => ({ ok: true, text: JSON.stringify({ decision: "wait", reason, explanation: "A required decision or resource is missing.", nextStep: "", progress: false }) });
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().status, "done");
    assert.equal(f.state().reviewStatus, status);
    assert.equal(f.sends.length, 1);
  });
}

for (const outcome of ["malformed", "unavailable", "oversized", "changed"]) {
  test(`a ${outcome} review decision leaves an explicit retry without launching Senior`, async (t) => {
    const f = await fixture(t);
    await f.service.send("session-1", request, f.context);
    f.router.review = async () => {
      if (outcome === "unavailable") throw new Error("Router unavailable");
      if (outcome === "changed") f.context.runtime.store.readConversationTail = async () => [{ user: { text: "Wait for me." }, messages: [] }];
      return { ok: true, text: outcome === "malformed" ? "not json" : '{"decision":"review","reason":"ready","explanation":"Implementation is ready for review.","nextStep":"","progress":true}' };
    };
    if (outcome === "oversized") f.context.runtime.store.readConversationTail = async () => [{ user: { text: "long".repeat(33000) }, messages: [] }];
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().status, "review_pending");
    assert.match(f.state().error, /Router|too long|conversation changed/);
    assert.equal(f.state().helper, null);
    assert.equal(f.sends.length, 1);
    assert.equal(f.router.reviewInputs.length, outcome === "oversized" ? 0 : 1);
    if (outcome === "malformed") {
      await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
      assert.equal(f.sends.length, 2, "the person's explicit Retry authorizes the pending review");
    }
  });
}

for (const action of ["stop", "close"]) {
  test(`${action} interrupts the review decision and suppresses a late ready answer`, { timeout: 5000 }, async (t) => {
    const f = await fixture(t);
    await f.service.send("session-1", request, f.context);
    const started = Promise.withResolvers();
    const finish = Promise.withResolvers();
    f.router.review = async () => {
      started.resolve();
      await finish.promise;
      return { ok: true, text: '{"decision":"review","reason":"ready","explanation":"Implementation is ready for review.","nextStep":"","progress":true}' };
    };
    let stops = 0;
    f.agent.stopEphemeralConversation = async () => { stops++; finish.resolve(); return { ok: true }; };
    const following = f.service.afterTurn("session-1", completion(), f.context);
    await started.promise;
    assert.equal(assistantRoutingStatusLabel(f.state()), "Router is deciding whether to continue, review or wait…");
    await f.service.afterTurn("session-1", completion(), f.context);
    await assert.rejects(f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context), /Wait for Router/);
    if (action === "stop") await f.service.cancel("session-1", f.context, { waitForCleanup: true });
    else await f.service.close();
    await following;
    assert.equal(stops, 1);
    assert.equal(f.state().status, "done");
    assert.equal(f.state().reviewStatus, "cancelled");
    assert.equal(f.state().helper, null);
    assert.equal(f.sends.length, 1);
    assert.equal(f.router.reviewInputs.length, 1);
  });
}

for (const mode of ["senior", "junior"]) {
  for (const planState of ["absent", "active", "unreadable"]) {
    test(`direct ${mode} ignores a ${planState} working plan and never starts automatic review`, async (t) => {
      const f = await fixture(t, { mode, review: true }, { readyPlan: false });
      const file = workPlanPath(f.context);
      if (planState === "active") {
        await mkdir(path.dirname(file), { recursive: true });
        await publishPlanFixture(f.context, planDocument("active"));
        f.metadata.assistant_routing_request = JSON.stringify({ status: "done", workPlan: await readWorkPlan(f.context) });
      } else if (planState === "unreadable") {
        await mkdir(file, { recursive: true });
        await assert.rejects(readWorkPlan(f.context), /regular Markdown file/);
      }
      const message = "What is the relation between Staff roster and /admin/contacts/1404572?";
      await f.service.send("session-1", { ...request, message }, f.context);
      assert.equal(f.helperCalls(), 0);
      assert.equal(f.sends[0].selection.modelId, f.assignments[mode].modelId);
      assert.equal(f.sends[0].input.displayMessage, message);
      assert.equal(f.state().workPlan, null);
      assert.equal(f.state().review, false, "a saved review preference only applies in Auto");
      const prompt = f.sends[0].input.message;
      assert.ok(!prompt.includes(file), "do not supply the plan path");
      assert.doesNotMatch(prompt, /Read the plan|Read the working plan|Progress and blockers|Status: blocked|Do not change application files/);
      assert.match(prompt, /Unrelated requests do not need a plan/);
      assert.match(prompt, /means save a Vibe64 checklist through vibe64-helper plan/);
      assert.match(prompt, /Writes require expectedRevision and expectedProgressRevision from the latest paired read/);
      assert.match(prompt, /Only report a plan created or updated after the helper succeeds/);
      if (mode === "junior") assert.match(prompt, /You cannot create, archive, reopen or complete the plan/);
      await f.service.afterTurn("session-1", completion(), f.context);
      await f.restart().afterTurn("session-1", completion(), f.context, { recovered: true });
      assert.equal(f.sends.length, 1, "no automatic planning or review turn");
      assert.equal(f.state().status, "done");
      assert.equal(f.state().workPlan, null);
      assert.equal(f.state().error, undefined);
      if (planState === "absent") await assert.rejects(lstat(path.dirname(file)), { code: "ENOENT" });
      else if (planState === "active") assert.equal((await readWorkPlan(f.context)).text, planDocument("active"));
      else assert.ok((await lstat(file)).isDirectory());
    });
  }
  test(`a stale Implement action cannot pull direct ${mode} into Auto's workflow`, async (t) => {
    const f = await fixture(t, { mode, review: true });
    await assert.rejects(f.service.send("session-1", { ...request, planRevision: f.state().workPlan.revision }, f.context), /Choose Auto to implement/);
    assert.equal(f.sends.length, 0);
    assert.equal(f.helperCalls(), 0);
  });
}

for (const mode of ["senior", "junior"]) {
  test(`retrying direct ${mode} ignores a retained plan snapshot and review flag`, async t => {
    const f = await fixture(t, { mode, review: true }, { readyPlan: false });
    const file = workPlanPath(f.context);
    await mkdir(file, { recursive: true });
    await assert.rejects(f.service.send("session-1", request, { ...f.context,
      onPromptSending: async () => { throw new Error("Interrupted before admission"); }
    }), /Interrupted before admission/);
    const saved = f.state();
    assert.equal(saved.status, "failed");
    f.metadata.assistant_routing_request = JSON.stringify({ ...saved, review: true,
      workPlan: { status: "active", text: "An old plan", approvedRevision: "old-revision" },
      input: { ...saved.input, planRevision: "old-revision" }
    });
    const restarted = f.restart();
    assert.equal((await restarted.send("session-1", request, f.context)).delivered, true);
    assert.equal(f.sends[0].selection.modelId, f.assignments[mode].modelId);
    assert.ok(!f.sends[0].input.message.includes(file));
    await restarted.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().status, "done");
    assert.equal(f.sends.length, 1, "direct completion cannot start a reviewer");
  });
}

test("Auto choosing Senior does not report that coding stopped or a review was skipped", async (t) => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"discussion"}' });
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().status, "done");
  assert.equal(f.state().resolvedMode, "senior");
  assert.equal(f.state().reviewStatus, undefined);
  assert.equal(f.sends.length, 1);
  assert.equal(assistantRoutingStatusLabel(f.state()), "Senior · Codex (gpt-6-astra high)");
  assert.equal(assistantRoutingStatusLabel({ ...f.state(), reviewStatus: "skipped_incomplete" }), "Coding stopped. Automatic review was skipped.");
});

for (const planStatus of ["absent", "active", "completed"]) {
  for (const outcome of ["completed", "failed", "stopped"]) {
    test(`discussion preserves ${planStatus} plan after ${outcome}`, async t => {
      const f = await fixture(t, undefined, { readyPlan: false });
      if (planStatus !== "absent") {
        await mkdir(path.dirname(workPlanPath(f.context)), { recursive: true });
        await publishPlanFixture(f.context, planDocument(planStatus));
      }
      const before = await readWorkPlan(f.context);
      f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"discussion"}' });
      await f.service.send("session-1", { ...request, message: "Is this finished?" }, f.context);
      if (outcome === "stopped") await f.service.cancel("session-1", f.context);
      await f.restart().afterTurn("session-1", completion("turn-1", outcome === "stopped" ? "completed" : outcome), f.context, { recovered: true });
      assert.deepEqual(await readWorkPlan(f.context), before);
      assert.equal(f.sends.length, 1);
      assert.equal(f.state().status, "done");
    });
  }
}

test("new planning leaves a completed document intact until Senior explicitly replaces it", async (t) => {
  const f = await fixture(t);
  await publishPlanFixture(f.context, planDocument("completed"));
  f.metadata.assistant_routing_request = JSON.stringify({ status: "done", workPlan: await readWorkPlan(f.context) });
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"discussion"}' });
  await f.service.send("session-1", { ...request, message: "How does this work?" }, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal((await readWorkPlan(f.context)).status, "completed");
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, messageId: "new-plan", message: "Plan an additional feature." }, f.context);
  assert.equal(f.state().workPlan.status, "completed");
  assert.equal((await readWorkPlan(f.context)).status, "completed");
  assert.match(f.sends[1].input.message, /checklists/);
});

for (const mode of ["senior", "auto"]) {
  test(`${mode} plan creation receives the saved-plan contract without changing a plan on admission`, async (t) => {
    const f = await fixture(t, { mode, review: false }, { readyPlan: false });
    f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
    const message = "Make a plan to complete issue 53.";
    await f.service.send("session-1", { ...request, message }, f.context);
    const prompt = f.sends[0].input.message;
    assert.match(prompt, /means save a Vibe64 checklist through vibe64-helper plan/);
    assert.match(prompt, /Read all pages of BOTH current Plan and Progress first/);
    assert.match(prompt, /ask whether to update it or archive it and start a new plan/);
    assert.match(prompt, /wait for their answer before replacing it/);
    assert.match(prompt, /explicit instruction to archive and replace already counts/);
    assert.match(prompt, /Only report a plan created or updated after the helper succeeds/);
    assert.equal(f.sends[0].input.displayMessage, message);
    assert.equal(await readWorkPlan(f.context), null, "sending a request cannot create a plan on its own");
    assert.equal(f.helperCalls(), mode === "auto" ? 1 : 0, "direct Senior needs no classification call");

    const saved = await manageWorkPlan(f.context, {
      operation: "new", text: "# Complete issue 53\n- [ ] Implement the agreed outcome\n- [ ] Verify acceptance"
    }, f.state().resolvedMode);
    assert.equal(saved.available, true);
    assert.equal(saved.current.revision, (await readWorkPlan(f.context)).revision);
    assert.equal(saved.total, 2);
    assert.equal(saved.status, "active");
  });
}

test("generated Junior preserves chat preferences and reports its destination before inference without routing or review", async (t) => {
  const f = await fixture(t, { mode: "senior", review: true });
  const preferences = f.metadata.assistant_routing;
  const admitted = [];
  const options = { ...f.context, purpose: "junior", onPromptSending: async (destination) => {
    assert.equal(f.sends.length, 0);
    assert.equal(f.state().attemptedMessageId, undefined);
    admitted.push(destination);
  } };
  assert.equal((await f.service.send("session-1", request, options)).delivered, true);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.deepEqual(admitted, [{ threadId: "native-thread", assistantSelection: f.sends[0].selection }]);
  assert.equal(f.state().resolvedMode, "junior");
  assert.equal(f.state().review, false);
  assert.equal(f.state().workPlan, null);
  assert.ok(!f.sends[0].input.message.includes(workPlanPath(f.context)));
  assert.equal(f.metadata.assistant_routing, preferences);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal((await f.service.send("session-1", request, options)).duplicate, true);
  assert.equal(admitted.length, 1);
});

test("generated Junior stops before inference when its domain receipt cannot be claimed", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.send("session-1", request, { ...f.context, purpose: "junior",
    onPromptSending: async () => { throw new Error("Configuration changed before admission."); }
  }), /Configuration changed/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.state().status, "failed");
});

test("generated Junior cannot change the mode of an unfinished Senior goal", async (t) => {
  const f = await fixture(t);
  f.metadata.assistant_routing_goal = JSON.stringify({ status: "active", mode: "senior", selection: f.assignments.senior });
  await assert.rejects(f.service.send("session-1", request, { ...f.context, purpose: "junior" }), /Finish or cancel/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
});

for (const sameModel of [false, true]) {
  test(`Auto reviews with Deslop disabled and ${sameModel ? "identical" : "different"} Junior/Senior models`, async (t) => {
    const f = await fixture(t, { mode: "auto", review: false });
    if (sameModel) await f.configuration.write({ codex: { ...f.assignments, senior: f.assignments.junior } }, 1);
    await f.service.send("session-1", request, f.context);
    assert.equal(f.state().review, true);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.sends.length, 2);
    if (sameModel) assert.deepEqual(f.sends[1].selection, f.sends[0].selection);
    else assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
    assert.notEqual(f.sends[1].input.messageId, f.sends[0].input.messageId, "review is a separate admitted turn even on the same model");
    assert.equal(f.state().status, "reviewing");
    assert.match(f.sends[1].input.message, /Explicitly complete an involved plan when every requirement is verified/);
    assert.doesNotMatch(f.sends[1].input.message, /perform Deslop|review and Deslop/i);
    assert.equal((await readWorkPlan(f.context)).status, "active", "dispatching review cannot complete the document");
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    assert.equal(f.sends.length, 2, "only one Senior review is scheduled");
    assert.equal(f.state().reviewStatus, "completed");
    assert.equal((await readWorkPlan(f.context)).status, "active", "a successful review turn still requires explicit plan completion");
  });
}

test("Auto uses a bounded helper then ordinary delivery and one Senior-model review with Deslop", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.send("session-1", request, f.context)).delivered, true);
  assert.equal(f.helperCalls(), 1);
  assert.equal(f.cleanupCalls(), 1);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.equal(f.sends[0].input.displayMessage, request.message);
  assert.match(f.sends[0].input.message, /Vibe64 role: Junior/);
  assert.equal(f.events[0].payload.assistantRoutingRequest.status, "routing");
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
  assert.equal(f.sends[1].input.messageId, f.state().reviewMessageId);
  assert.equal(f.sends[1].input.turnMetadata.assistantRouting.parentMessageId, "request-1");
  assert.match(f.sends[1].input.message, /may directly fix/);
  assert.match(f.sends[1].input.message, /Then perform Deslop on the coding changes and your review fixes/);
  assert.match(f.sends[1].input.message, /Perform both parts yourself in this turn/);
  assert.match(f.sends[1].input.message, /Run relevant checks after cleanup/);
  assert.match(f.sends[1].input.message, /Only after review, any enabled Deslop and their checks are finished/);
  assert.ok(f.sends[1].input.message.indexOf("Explicitly complete an involved plan") >
    f.sends[1].input.message.indexOf("Run relevant checks after cleanup"), "Plan completion follows review, cleanup and checks");
  assert.match(f.sends[1].input.message, /including the complete technical implementation plan/);
  assert.match(f.sends[1].input.displayMessage, /Automatic review and Deslop/);
  assert.equal(f.sends[1].input.genesisTask, undefined);
  await f.service.afterTurn("session-1", completion(), f.context);
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().reviewStatus, "completed");
});

for (const mode of ["senior", "junior"]) {
  test(`a member's API-key Codex account permits Auto to ${mode} without Backup`, async (t) => {
    const f = await fixture(t);
    const root = f.context.runtime.stateRoot;
    const authPath = path.join(root, ".codex", "auth.json");
    const markerPath = codexAuthMarkerPath(root);
    await mkdir(path.dirname(authPath), { recursive: true });
    await mkdir(path.dirname(markerPath), { recursive: true });
    await writeFile(authPath, JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "fixture-key-not-sent" }));
    await writeFile(markerPath, JSON.stringify({ connected: true, version: 1,
      loginId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updatedAt: "2026-09-25T00:00:00.000Z" }));
    const access = await readCodexSelectedAccountAccess({ toolHomeSource: root, systemRoot: root });
    assert.equal(access.ownerOnly, false);
    assert.equal(access.endpointCode, "openai_api");
    assert.ok(access.connectionIdentity);
    f.connections.set("codex:openai", access);
    f.context.vibe64User = { role: "member", username: "collaborator" };
    f.router.respond = async () => ({ ok: true,
      text: JSON.stringify({ mode, reason: mode === "senior" ? "planning" : "plan_implementation" }) });

    await f.service.send("session-1", request, f.context);
    assert.equal(f.helperCalls(), 1);
    assert.equal(f.cleanupCalls(), 1);
    assert.equal(f.sends[0].selection.modelId, mode === "senior" ? "gpt-6-astra" : "deepseek-flash");
    assert.equal(f.state().decision.backupUsed, false);
    assert.equal(f.state().submittedBy.username, "collaborator");
    assert.equal(f.state().decision.seniorJuniorPair.senior.connectionIdentity, access.connectionIdentity);
    await f.service.afterTurn("session-1", completion(), f.context);
    if (mode === "junior") {
      assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
      await f.service.afterTurn("session-1", completion("turn-2"), f.context);
      assert.equal(f.state().reviewStatus, "completed");
    }
    assert.equal(f.sends.length, mode === "junior" ? 2 : 1);
    assert.equal(f.state().status, "done");
  });
}

test("interrupted Router results retain the provider error and never dispatch partial decisions", async (t) => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, status: "interrupted",
    text: '{"mode":"junior","reason":"plan_implementation"}', error: "Claude output exceeded its size limit." });
  await assert.rejects(f.service.send("session-1", request, f.context), /Claude output exceeded its size limit/u);
  assert.equal(f.state().status, "failed");
  assert.equal(f.state().error, "Claude output exceeded its size limit.");
  assert.equal(f.state().helper, null);
  assert.equal(f.cleanupCalls(), 1);
  assert.equal(f.sends.length, 0);
});

test("changing routing settings while classifying does not retarget this request", async (t) => {
  const f = await fixture(t);
  const classify = f.router.respond;
  f.router.respond = async (...args) => {
    await f.configuration.write({ codex: { ...f.assignments, junior: f.assignments.senior } }, 1);
    return classify(...args);
  };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
});

for (const question of [
  "[1] Should persistence stay in this browser or be shared across devices?",
  "Where should persistence live?\n\nPossible answers:\n- Browser: Keep it in this browser.\n- Server: Share it across devices."
]) {
  test(`review preserves an unanswered structured question: ${question.split("\n")[0]}`, async (t) => {
    const f = await fixture(t, { mode: "auto", review: true });
    await f.service.send("session-1", request, f.context);
    const codingSelection = f.metadata.assistant_selection;
    const turns = [{ user: { text: request.message }, messages: [{ role: "assistant", text: question }] }];
    f.context.runtime.store.readConversationTail = async () => turns;
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.sends.length, 1);
    assert.equal(f.state().status, "done");
    assert.equal(f.state().reviewStatus, "skipped_question");
    assert.equal(f.events.some((event) => ["review_sending", "reviewing"].includes(event.payload.assistantRoutingRequest.status)), false);
    assert.equal(f.metadata.assistant_selection, codingSelection);
    assert.equal(turns[0].messages[0].text, question);
    await f.restart().afterTurn("session-1", completion(), f.context, { recovered: true });
    assert.equal(f.sends.length, 1);

    f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
    await f.service.send("session-1", { ...request, messageId: "answer-1", message: "Keep it in this browser." }, f.context);
    turns.push({ user: { text: "Keep it in this browser." }, messages: [{ role: "assistant", text: "Implemented and checked." }] });
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    assert.equal(f.sends.length, 2, "the answer returns to Senior planning before more implementation");
    assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
    assert.equal(f.state().resolvedMode, "senior");
    assert.equal(f.helperCalls(), 3);
  });
}

test("review retry rechecks saved questions before changing models or sending", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  const codingSelection = f.metadata.assistant_selection;
  const restarted = f.restart();
  await restarted.afterTurn("session-1", completion(), f.context, { recovered: true });
  assert.equal(f.state().status, "review_pending");
  f.context.runtime.store.readConversationTail = async () => [{ messages: [{
    role: "assistant", text: "[1] Should persistence stay in this browser?"
  }] }];
  await restarted.send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().reviewStatus, "skipped_question");
  assert.equal(f.state().error, undefined);
  assert.equal(f.metadata.assistant_selection, codingSelection);
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
  assert.equal(f.state().error, undefined);
});

test("successful direct and automatic sends never publish uncertain delivery", async (t) => {
  for (const mode of ["senior", "junior", "auto"]) {
    const f = await fixture(t, { mode, review: true });
    await f.service.send("session-1", request, f.context);
    if (mode === "auto") await f.service.afterTurn("session-1", completion(), f.context);
    const states = f.events.map((event) => event.payload.assistantRoutingRequest);
    assert.equal(states.some((state) => state.status.includes("uncertain")), false);
    const sending = states.find((state) => state.status === "sending" && state.attemptedMessageId);
    assert.equal(sending.attemptedMessageId, request.messageId);
    assert.match(assistantRoutingStatusLabel(sending), /awaiting receipt/);
    assert.equal(f.helperCalls(), mode === "auto" ? 2 : 0);
  }
});

test("a late saved receipt clears interrupted delivery without dispatching again", async (t) => {
  const f = await fixture(t, { mode: "senior", review: false });
  f.failAdmission();
  await assert.rejects(f.service.send("session-1", request, f.context), /Lost admission/);
  await f.context.runtime.store.writeConversationUserMessage("session-1", { messageId: request.messageId });
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "sent");
  assert.equal(f.state().error, undefined);
  assert.equal(f.sends.length, 1);
});

test("steering does not classify, and an unfinished goal rejects Auto", async (t) => {
  const f = await fixture(t);
  f.agent.sessionState = async () => ({ turn: { active: true } });
  await f.service.send("session-1", { ...request, submissionKind: "steer" }, f.context);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends[0].input.message, request.message);
  f.agent.sessionState = async () => ({ turn: { active: false } });
  f.agent.readGoal = async () => ({ goal: { status: "active" } });
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "next" }, f.context), /before working on a goal/);
});

test("unavailable goal observation cannot erase a saved active goal and unlock Auto", async (t) => {
  const f = await fixture(t);
  f.metadata.assistant_routing_goal = JSON.stringify({ mode: "junior", status: "active", selection: f.assignments.junior });
  for (const status of ["unsupported", "unavailable"]) {
    f.agent.readGoal = async () => ({ status, goal: null });
    await assert.rejects(f.service.send("session-1", request, f.context), /before working on a goal/);
  }
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends.length, 0);
  assert.equal(JSON.parse(f.metadata.assistant_routing_goal).status, "active");
  f.agent.readGoal = async () => ({ status: "available", goal: null });
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends.length, 1);
});

test("a retained goal prevents automatic review even when native goal observation is unavailable", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  f.metadata.assistant_routing_goal = JSON.stringify({ mode: "junior", status: "active", selection: f.assignments.junior });
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
  const f = await fixture(t, { mode: "auto", review: true });
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
  f.router.respond = async () => {
    started.resolve();
    await finish.promise;
    return { ok: true, text: '{"mode":"junior","reason":"plan_implementation"}' };
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

test("Stop after classification finishes still prevents delivery while its helper closes", async (t) => {
  const f = await fixture(t);
  const plan = f.state().workPlan;
  const closing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const remove = f.agent.deleteEphemeralConversation;
  f.agent.deleteEphemeralConversation = async (...args) => {
    closing.resolve();
    await release.promise;
    return remove(...args);
  };
  const sending = f.service.send("session-1", request, f.context);
  const rejected = assert.rejects(sending, { code: "vibe64_assistant_routing_cancelled" });
  await closing.promise;
  try {
    assert.equal(f.helperCalls(), 1);
    assert.equal(await f.service.cancel("session-1", f.context), true);
    assert.equal(f.state().status, "cancelled");
    assert.equal(f.sends.length, 0);
  } finally {
    release.resolve();
  }
  await rejected;
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.state().helper, null);
  assert.equal(f.state().input.message, request.message);
  assert.equal(f.cleanupCalls(), 1);
  assert.equal(f.sends.length, 0);
  assert.deepEqual(f.state().workPlan, plan);
  assert.deepEqual(await readWorkPlan(f.context), plan);
});

test("Stop reports a clean routing cancellation instead of the provider's AbortError", async (t) => {
  const f = await fixture(t, undefined, { beforeExclusive() {
    if (f.state()?.status === "cancelled" && !f.state().helper) {
      throw Object.assign(new Error("Another conversation is starting."), { code: "vibe64_agent_write_mode_busy" });
    }
  } });
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.router.respond = async () => {
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
  f.router.respond = async () => {
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

test("shutdown cancels routing and waits for helper cleanup before native providers can close", async (t) => {
  const f = await fixture(t);
  assert.equal(typeof f.service.close, "function");
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const cleaning = Promise.withResolvers();
  const releaseCleanup = Promise.withResolvers();
  f.router.respond = async () => {
    started.resolve();
    await finish.promise;
    return { ok: true, text: '{"mode":"junior","reason":"plan_implementation"}' };
  };
  f.agent.stopEphemeralConversation = async () => { finish.resolve(); return { ok: true }; };
  f.agent.deleteEphemeralConversation = async () => {
    cleaning.resolve();
    await releaseCleanup.promise;
    return { ok: true };
  };
  const sending = f.service.send("session-1", request, f.context);
  const rejected = assert.rejects(sending, /cancelled/);
  await started.promise;
  let closed = false;
  const shutdown = f.service.close().then(() => { closed = true; });
  await cleaning.promise;
  assert.equal(closed, false);
  assert.equal(f.state().status, "cancelled");
  assert.ok(f.state().helper);
  releaseCleanup.resolve();
  await shutdown;
  await rejected;
  assert.equal(f.state().helper, null);
  assert.equal(f.sends.length, 0);
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "late" }, f.context), /shutting down/);
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "cancelled");
  assert.equal(f.sends.length, 0);
});

test("shutdown reports unconfirmed Router cleanup instead of claiming completion", async (t) => {
  const f = await fixture(t);
  assert.equal(typeof f.service.close, "function");
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.router.respond = async () => {
    started.resolve();
    await finish.promise;
    return { ok: false };
  };
  f.agent.stopEphemeralConversation = async () => { finish.resolve(); return { ok: true }; };
  f.agent.deleteEphemeralConversation = async () => ({ ok: false });
  const sending = f.service.send("session-1", request, f.context);
  const rejected = assert.rejects(sending, /helper could not be closed/);
  await started.promise;
  await assert.rejects(f.service.close(), /routing shutdown/i);
  await rejected;
  assert.ok(f.state().helper);
  assert.equal(f.sends.length, 0);
});

test("an interrupted Junior turn never starts a review", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion("turn-1", "interrupted"), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.helperCalls(), 1);
});

test("Stop during Junior disables its review and still asks the caller to interrupt native work", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  f.agent.sessionState = async () => ({ turn: { active: true, id: "turn-1" } });
  assert.equal(await f.service.cancel("session-1", f.context), false);
  f.agent.sessionState = async () => ({ turn: { active: false, id: "turn-1" } });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
});

test("Stop during review keeps a late successful completion incomplete and allows a fresh request", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
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
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  await f.service.cancel("session-1", f.context);
  f.context.session.agentRuns = [completion().payload.agentRun];
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "done");
  assert.equal(f.state().reviewStatus, "cancelled");
});

test("restart recovery offers the unsent review for explicit retry and reviews exactly once", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
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

test("Stop at a recovered Junior-to-review boundary prevents Retry and late completion from starting review", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  f.context.session.agentRuns = [completion().payload.agentRun];
  const restarted = f.restart();
  await restarted.reconcile("session-1", f.context);
  assert.equal(f.state().status, "review_pending");
  const stopping = restarted.cancel("session-1", f.context);
  const lateCompletion = restarted.afterTurn("session-1", completion(), f.context);
  assert.equal(await stopping, true);
  await lateCompletion;
  await assert.rejects(restarted.send("session-1", { ...request, reviewAction: "retry" }, f.context), /no pending follow-up/i);
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "done");
  assert.equal(f.state().reviewStatus, "cancelled");
  assert.equal(f.sends.length, 1);
  assert.equal(f.helperCalls(), 1);
});

test("restart during request preparation exposes recovery without automatically resending", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  const accepted = f.state();
  f.context.runtime.store.conversationMessageIdExists = async () => false;
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
  const f = await fixture(t, { mode: "auto", review: true });
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
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), turnId: "" });
  await f.service.afterTurn("session-1", completion("unrelated-turn"), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().reviewStatus, "skipped_unconfirmed");
  assert.match(f.state().error, /could not be matched/);
});

test("a new request cannot overtake a pending review and explicit Stop cancels it", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "next" }, f.context), /preparing its Senior review/);
  f.catalog.modelProviders[0].connected = false;
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().status, "review_pending");
  assert.equal(await f.service.cancel("session-1", f.context), true);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
});

test("an uncertain review checks its existing native receipt and never starts a second reviewer", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
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
  const classify = f.router.respond;
  f.router.respond = async (...args) => {
    const result = await classify(...args);
    f.metadata.assistant_selection = JSON.stringify({ ...f.assignments.senior, engineId: "claude" });
    return result;
  };
  await assert.rejects(f.service.send("session-1", request, f.context), /orchestrator changed/);
  assert.equal(f.sends.length, 0);
});

test("goal preparation pins an explicit route only for the caller to commit after native acceptance", async (t) => {
  const f = await fixture(t, { mode: "junior", review: true });
  const prepared = await f.service.prepareGoal("session-1", { action: "set", objective: "Implement agreed validation" }, f.context);
  assert.equal(prepared.pinned.selection.modelId, "deepseek-flash");
  assert.match(prepared.input.objective, /Vibe64 role: Junior/);
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

test("Auto uses a foreign Router and does not require Helper", async (t) => {
  const f = await fixture(t);
  const router = sharedOpenCode(f, "deepseek", "deepseek-chat");
  await f.configuration.write({ codex: { ...f.assignments, router, helper: null } }, 1);
  const start = f.agent.startEphemeralConversationTurn;
  f.agent.startEphemeralConversationTurn = async (scope, input, options) => {
    assert.equal(options.assistantSelection.engineId, "opencode");
    assert.equal(JSON.parse(f.metadata.assistant_selection).engineId, "codex");
    assert.deepEqual(scope.environment, {});
    return start(scope, input, options);
  };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.state().assignments.router.modelId, "deepseek-chat");
  assert.equal(f.state().assignments.helper, undefined);
  assert.equal(f.sends[0].selection.engineId, "codex");
  assert.equal(f.state().helper, null);
});

for (const review of [false, true]) {
  test(`same-engine Backup keeps a different accessible coder through completion and restart with review ${review}`, async (t) => {
    const f = await fixture(t, { mode: "junior", review, workflowEngineId: "opencode" });
    const backup = sharedOpenCode(f);
    f.catalogs.at(-1).modelProviders.push(...structuredClone(f.catalog.modelProviders));
    const senior = { ...f.assignments.senior, engineId: "opencode", agentId: "build" };
    const junior = { ...f.assignments.junior, engineId: "opencode", agentId: "build" };
    await f.configuration.write({ codex: f.assignments, opencode: {
      senior, junior, helper: junior, router: junior, sharedBackup: backup
    } }, 1);
    const configuration = await f.configuration.read();
    f.context.vibe64User = { role: "member", username: "collaborator" };
    await f.service.send("session-1", request, f.context);
    assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
    assert.equal(f.sends[0].selection.engineId, "opencode");
    assert.equal(f.state().assignments.senior.modelId, "big-pickle");
    assert.equal(f.state().assignments.junior.modelId, "deepseek-flash");
    assert.equal(f.state().decision.seniorJuniorPair.junior.backupUsed, false);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().review, false, "direct Junior ignores Auto review preferences");
    assert.equal(f.sends.length, 1);
    f.metadata.assistant_routing = JSON.stringify({ mode: "senior", review: false, workflowEngineId: "opencode" });
    await f.restart().send("session-1", { ...request, messageId: "next-plan" }, f.context);
    assert.equal(f.sends.at(-1).selection.modelId, "big-pickle");
    assert.equal(f.state().assignments.junior.modelId, "deepseek-flash");
    assert.equal(f.state().workflowEngineId, "opencode");
    assert.equal(f.helperCalls(), 0);
    assert.deepEqual(await f.configuration.read(), configuration);
  });

  test(`a member's foreign Backup keeps Plan and Code together with review ${review}`, async (t) => {
    const f = await fixture(t, { mode: "junior", review });
    const backup = sharedOpenCode(f);
    await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
    f.context.vibe64User = { role: "member", username: "collaborator" };
    await f.service.send("session-1", request, f.context);
    assert.equal(f.sends[0].selection.engineId, "opencode");
    assert.equal(f.state().assignments.senior.modelId, "big-pickle");
    assert.equal(f.state().assignments.junior.modelId, "big-pickle", "even the otherwise-shared original coder follows the pair");
    assert.equal(f.state().workflowEngineId, "codex");
    assert.equal(f.sends[0].input.turnMetadata.assistantRouting.backupUsed, true);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().review, false, "direct Junior ignores Auto review preferences");
    assert.equal(f.sends.length, 1);
    f.metadata.assistant_routing = JSON.stringify({ mode: "senior", workflowEngineId: "codex", review: false });
    await f.service.send("session-1", { ...request, messageId: "next-plan" }, f.context);
    assert.equal(f.sends.at(-1).selection.engineId, "opencode");
    assert.equal(f.state().workflowEngineId, "codex", "a backup execution never chooses its own workflow profile");
  });

  test(`a saved Code override survives member Backup, restart and owner return with review ${review}`, async (t) => {
    const f = await fixture(t, { mode: "junior", review });
    const backup = sharedOpenCode(f);
    await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
    const override = { ...f.assignments.junior, variantId: "low", selectionSource: "explicit" };
    const preferences = JSON.stringify({ mode: "junior", review, workflowEngineId: "codex", override });
    f.metadata.assistant_routing = preferences;
    f.context.vibe64User = { role: "member", username: "collaborator" };
    await f.service.send("session-1", request, f.context);
    assert.equal(f.sends[0].selection.engineId, "opencode");
    assert.equal(f.state().decision.seniorJuniorPair.junior.configuredSelection.variantId, "low");
    assert.equal(f.state().decision.seniorJuniorPair.junior.backupReason, "keep_workflow_together");
    const restarted = f.restart();
    await restarted.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().review, false, "direct Junior ignores Auto review preferences");
    assert.equal(f.sends.length, 1);
    assert.equal(f.metadata.assistant_routing, preferences);
    f.context.vibe64User = { role: "owner", username: "owner" };
    await restarted.send("session-1", { ...request, messageId: "owner-return" }, f.context);
    assert.equal(f.sends.at(-1).selection.engineId, "codex");
    assert.equal(f.sends.at(-1).selection.modelId, "deepseek-flash");
    assert.equal(f.sends.at(-1).selection.variantId, "low");
    assert.equal(f.state().decision.backupUsed, false);
    assert.equal(f.metadata.assistant_routing, preferences);
  });
}

test("an incapable Backup refuses Senior and Junior before delivery without splitting the pair or dropping review", async (t) => {
  const f = await fixture(t);
  const backup = sharedOpenCode(f);
  f.catalogs[1].modelProviders[0].models[0].capabilities = { toolcall: false };
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.context.vibe64User = { role: "member", username: "collaborator" };
  const originalSelection = f.metadata.assistant_selection;
  for (const mode of ["senior", "junior"]) {
    for (const review of [false, true]) {
      f.metadata.assistant_routing = JSON.stringify({ mode, review, workflowEngineId: "codex" });
      await assert.rejects(f.service.send("session-1", request, f.context), {
        code: "vibe64_assistant_capability_unavailable"
      });
      assert.equal(f.metadata.assistant_selection, originalSelection);
      assert.equal(f.sends.length, 0);
      assert.equal(f.helperCalls(), 0);
    }
  }
});

for (const key of ["engineId", "modelId", "command"]) {
  test(`Router-supplied ${key} is rejected before delivery and its helper is removed`, async (t) => {
    const f = await fixture(t);
    const originalSelection = f.metadata.assistant_selection;
    f.router.respond = async () => ({ ok: true, text: JSON.stringify({
      mode: "junior", reason: "explicit_implementation", [key]: "untrusted-router-value"
    }) });
    await assert.rejects(f.service.send("session-1", request, f.context), /Routing returned an invalid decision/);
    assert.equal(f.state().status, "failed");
    assert.equal(f.state().helper, null);
    assert.equal(f.cleanupCalls(), 1);
    assert.equal(f.sends.length, 0);
    assert.equal(f.metadata.assistant_selection, originalSelection);
  });
}

test("Auto uses a shared fallback for a member's Router, implementation and review", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  const backup = sharedOpenCode(f, "zai", "glm-4.7");
  await f.configuration.write({ codex: { ...f.assignments, router: f.assignments.senior, sharedBackup: backup } }, 1);
  f.context.vibe64User = { role: "member", username: "collaborator" };
  const startHelper = f.agent.startEphemeralConversationTurn;
  f.agent.startEphemeralConversationTurn = async (scope, input, options) => {
    assert.equal(options.assistantSelection.modelId, "glm-4.7");
    assert.equal(options.vibe64User.username, "collaborator");
    return startHelper(scope, input, options);
  };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.helperCalls(), 1);
  assert.equal(f.sends[0].selection.modelId, "glm-4.7");
  assert.equal(f.sends[0].input.turnMetadata.assistantRouting.backupUsed, true);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, "glm-4.7");
  assert.equal(f.state().submittedBy.username, "collaborator");
  assert.equal(f.state().workflowEngineId, "codex");
});

test("review retries retain the original member when the owner triggers the retry", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  f.connections.set("codex:openai", { ownerOnly: false });
  f.context.vibe64User = { role: "member", username: "collaborator" };
  await f.service.send("session-1", request, f.context);
  f.context.session.agentRuns = [completion().payload.agentRun];
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "review_pending");
  f.context.vibe64User = { role: "owner", username: "owner" };
  await f.restart().send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
  assert.equal(f.state().submittedBy.username, "collaborator");
});

test("a changed Senior assignment affects the next request but not the captured reviewer", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  await f.configuration.write({ codex: { ...f.assignments, senior: f.assignments.junior } }, 1);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), workPlan: await readWorkPlan(f.context) });
  await f.service.send("session-1", { ...request, messageId: "next-code", planRevision: f.state().workPlan.revision }, f.context);
  await f.service.afterTurn("session-1", completion("turn-3"), f.context);
  assert.equal(f.sends[3].selection.modelId, "deepseek-flash");
});

test("review cannot use a revoked or replacement connection and keeps the completed coding turn", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  await f.service.send("session-1", request, f.context);
  const codingSelection = f.metadata.assistant_selection;
  f.connections.set("codex:openai", { available: false, current: null, history: [] });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "review_pending");
  assert.ok(f.state().error);
  assert.equal(f.metadata.assistant_selection, codingSelection);
  f.connections.set("codex:openai", { available: true, connectionIdentity: "codex:openai:replacement" });
  await assert.rejects(f.service.send("session-1", { ...request, reviewAction: "retry" }, f.context), /connection changed/);
  assert.equal(f.sends.length, 1);
  f.connections.delete("codex:openai");
  await f.service.send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
});

test("revoking the submitting member blocks review even when an owner retries it", async (t) => {
  let active = true;
  const actors = [];
  const f = await fixture(t, { mode: "auto", review: true }, {
    resolveAssistantUser: async (actor) => {
      actors.push(actor?.username);
      if (!active || !actor?.username) throw Object.assign(new Error("The submitting user no longer has workspace access."), {
        code: "vibe64_assistant_actor_unavailable"
      });
      return actor;
    }
  });
  f.connections.set("codex:openai", { ownerOnly: false });
  f.context.vibe64User = { role: "member", username: "collaborator" };
  await f.service.send("session-1", request, f.context);
  active = false;
  f.context.vibe64User = { role: "owner", username: "owner" };
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().status, "review_pending");
  assert.match(f.state().error, /no longer has workspace access/);
  assert.equal(f.sends.length, 1);
  await assert.rejects(f.restart().send("session-1", { ...request, reviewAction: "retry" }, f.context), {
    code: "vibe64_assistant_actor_unavailable"
  });
  assert.equal(f.sends.length, 1);
  assert.equal(actors.every((username) => username === "collaborator"), true);
  assert.equal(f.state().submittedBy.username, "collaborator");
  await f.service.cancel("session-1", f.context);
  assert.equal(f.state().reviewStatus, "cancelled");
  assert.equal(f.state().status, "done", "Skipping an unsent review finishes the already completed coding request");
  assert.equal(f.state().error, undefined, "Skip clears the resolved review-admission warning");
  assert.equal(f.sends.length, 1);
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "done");
  assert.equal(f.sends.length, 1);
});

test("replacing a captured connection while Router works refuses delivery", async (t) => {
  const f = await fixture(t);
  f.router.respond = async () => {
    f.connections.set("codex:deepseek", { connectionIdentity: "codex:deepseek:replacement" });
    return { ok: true, text: '{"mode":"junior","reason":"plan_implementation"}' };
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

test("Helper cannot be selected for direct chat or sent as a chat mode", async (t) => {
  const f = await fixture(t, { mode: "helper", review: false });
  await assert.rejects(f.service.send("session-1", request, f.context), /Choose Custom, Senior, Junior, or Auto/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
});

test("a goal switching orchestrators requires ordinary Send before native goal admission", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  const backup = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.context.vibe64User = { role: "member", username: "collaborator" };
  await assert.rejects(f.service.prepareGoal("session-1", { action: "set", objective: "Implement agreed validation" }, f.context),
    { code: "vibe64_changeover_message_required" });
  assert.equal(f.metadata.assistant_routing_goal, undefined);
  assert.equal(JSON.parse(f.metadata.assistant_selection).engineId, "opencode");
});

test("a migrated unsent request goes through fresh admission while retaining its original actor", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  const backup = sharedOpenCode(f);
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 4, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "failed", review: false,
    assignments: { junior: f.assignments.junior }, settingsRevision: 1, submittedBy: { role: "member", username: "original-member" } });
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.engineId, "opencode");
  assert.equal(f.state().submittedBy.username, "original-member");
  assert.equal(f.state().admissionRequired, undefined);
  assert.equal(f.state().decision.backupUsed, true);
});

for (const actorFields of [{}, { submittedBy: null }]) {
  test(`a migrated request with ${Object.hasOwn(actorFields, "submittedBy") ? "null" : "missing"} actor cannot borrow the hosted retry user's identity`, async (t) => {
    const actors = [];
    const f = await fixture(t, { mode: "junior", review: false }, {
      resolveAssistantUser: async (actor) => {
        actors.push(actor);
        if (!actor?.username) throw Object.assign(new Error("The submitting user is unavailable. Cancel and send a new request."), {
          code: "vibe64_assistant_actor_unavailable"
        });
        return actor;
      }
    });
    const original = JSON.stringify({ schemaVersion: 4, admissionRequired: true, workflowEngineId: "codex",
      messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "failed", review: false,
      assignments: { junior: f.assignments.junior }, settingsRevision: 1, ...actorFields });
    f.metadata.assistant_routing_request = original;
    await assert.rejects(f.restart().send("session-1", request, f.context), { code: "vibe64_assistant_actor_unavailable" });
    assert.equal(actors.length, 1);
    assert.equal(actors[0]?.username, undefined);
    assert.equal(f.metadata.assistant_routing_request, original, "Refusal preserves the old request evidence");
    assert.equal(f.sends.length, 0);
    assert.equal(f.helperCalls(), 0);

    await f.service.cancel("session-1", f.context);
    await f.service.send("session-1", { ...request, messageId: "new-owner-request" }, f.context);
    assert.equal(f.sends.length, 1, "An explicit new request can use its authenticated sender");
    assert.equal(f.state().submittedBy.username, "owner");
  });
}

test("standalone admission can retry a migrated request without a hosted actor", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.context.vibe64User = null;
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 4, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "failed", review: false,
    assignments: { junior: f.assignments.junior }, settingsRevision: 1, submittedBy: null });
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().submittedBy, null);
  assert.equal(f.state().admissionRequired, undefined);
});

test("a migrated uncertain request can inspect admission without authorizing fresh inference", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 4, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "uncertain", review: false,
    assignments: { junior: f.assignments.junior }, attemptedMessageId: request.messageId, threadId: "retained-thread", settingsRevision: 1 });
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

test("an unavailable Router holds automatic review but the person can explicitly retry it", async (t) => {
  const f = await fixture(t);
  const router = sharedOpenCode(f, "deepseek", "deepseek-chat");
  await f.configuration.write({ codex: { ...f.assignments, router } }, 1);
  await f.service.send("session-1", request, f.context);
  f.connections.set("opencode:deepseek", { available: false, current: null, history: [] });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "review_pending");
  assert.equal(f.router.reviewInputs.length, 0);
  await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
});

test("a legacy explicit goal retains its model when the current configured coder differs", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.metadata.assistant_routing_goal = JSON.stringify({ mode: "junior", workflowEngineId: "codex", selection: f.assignments.junior,
    objective: "Implement validation", status: "active" });
  await f.configuration.write({ codex: { ...f.assignments, junior: f.assignments.senior } }, 1);
  const prepared = await f.service.prepareGoal("session-1", { action: "resume" }, f.context);
  assert.equal(prepared.pinned.selection.modelId, "deepseek-flash");
});

test("an uncertain request inspects its receipt while native work is still active", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.failAdmission();
  await assert.rejects(f.service.send("session-1", request, f.context), /Lost admission/);
  f.agent.sessionState = async () => ({ turn: { active: true, id: "turn-1" } });
  f.agent.inspectMessageAdmission = async () => ({ admission: "accepted", turnId: "turn-1" });
  assert.equal((await f.service.send("session-1", request, f.context)).delivered, true);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().status, "sent");
});

test("new Auto implementation needs no plan and receives Senior review", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true }, { readyPlan: false });
  f.router.respond = async () => ({ ok: true, text: '{"mode":"junior","reason":"explicit_implementation"}' });
  await f.service.send("session-1", { ...request, message: "Change ALL washers to bathers." }, f.context);
  assert.equal(f.state().resolvedMode, "junior");
  assert.equal(f.helperCalls(), 1);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.equal(f.state().workPlan, null);
  assert.match(f.sends[0].input.message, /You may edit application files/);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(await readWorkPlan(f.context), null);
});

test("Auto routes execution through Router and only Senior explicitly completes the plan", async t => {
  const f = await fixture(t, { mode: "auto", review: true }, { readyPlan: false });
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, message: "Plan validation." }, f.context);
  await manageWorkPlan(f.context, { operation: "new", text: "# Validation\n- [ ] Reject empty name" }, "senior");
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().workPlan.status, "active");
  assert.equal(f.sends.length, 1);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"junior","reason":"plan_implementation"}' });
  await f.service.send("session-1", { ...request, messageId: "execute", message: "Complete it then." }, f.context);
  assert.equal(f.helperCalls(), 2);
  let plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "progress-write", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision, text: "# Progress\nReject empty name — focused test passed" }, "junior");
  assert.equal((await readWorkPlan(f.context)).text, plan.text, "Junior evidence preserves the original agreed scope bytes");
  assert.equal((await readWorkPlan(f.context)).progressText, "# Progress\nReject empty name — focused test passed");
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.state().workPlan.status, "active", "finished coding cannot complete the plan");
  assert.equal(f.sends[2].selection.modelId, "gpt-6-astra");
  assert.match(f.sends[2].input.message, /record specific gaps and verification evidence in its paired Progress document/);
  plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision }, "review");
  await f.service.afterTurn("session-1", completion("turn-3"), f.context);
  assert.equal(f.state().workPlan.status, "completed");
  assert.equal(f.sends.length, 3, "review never starts another implementation cycle");
});

for (const role of ["junior", "senior", "review"]) {
  test(`ending ${role} successfully cannot complete an active plan`, async t => {
    const f = await fixture(t, { mode: "auto", review: role === "review" });
    if (role === "senior") f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
    await f.service.send("session-1", request, f.context);
    await f.service.afterTurn("session-1", completion(), f.context);
    if (role === "review") await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    assert.equal(f.state().workPlan.status, "active");
    assert.equal((await readWorkPlan(f.context)).status, "active");
    assert.equal(f.sends.length, role === "senior" ? 1 : 2);
  });
}

for (const state of ["completed", "absent"]) {
  test(`execution with ${state} plan explains why it cannot start without reopening`, async t => {
    const f = await fixture(t, undefined, { readyPlan: state !== "absent" });
    if (state === "completed") await publishPlanFixture(f.context, planDocument("completed"));
    const before = await readWorkPlan(f.context);
    await assert.rejects(f.service.send("session-1", request, f.context),
      state === "completed" ? /already completed/ : /no current plan/);
    assert.equal(f.state().resolvedMode, "junior");
    assert.deepEqual(await readWorkPlan(f.context), before);
    assert.equal(f.sends.length, 0);
  });
}

test("Senior can update requirements and implement in one request, then receives separate review", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"plan_implementation"}' });
  await f.service.send("session-1", { ...request, message: "Senior, add the missing acceptance case to the plan and implement it." }, f.context);
  assert.equal(f.sends[0].selection.modelId, "gpt-6-astra");
  assert.match(f.sends[0].input.message, /including any explicitly requested planning changes/);
  assert.doesNotMatch(f.sends[0].input.message, /Do not change application files/);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].input.turnMetadata.assistantRouting.resolvedMode, "review");
});

for (const deslop of [true, false]) {
  test(`explicitly deferring the last blocked requirement retains review and archives the revised pair with Deslop ${deslop ? "on" : "off"}`, async t => {
    const f = await fixture(t, { mode: "auto", review: deslop });
    const scope = planDocument() + "\n- [x] Reject blank names\n- [ ] Verify real email delivery\n";
    await publishPlanFixture(f.context, scope);
    let plan = await readWorkPlan(f.context);
    const evidence = "# Progress\nThe agreed required-field rule is implemented; empty and populated form tests passed.\nEmail delivery is blocked: no SMTP server or sender is configured.\n";
    await manageWorkPlan(f.context, { operation: "progress-write", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "", text: evidence }, "junior");
    await f.service.send("session-1", request, f.context);
    f.router.review = async () => ({ ok: true, text: JSON.stringify({ decision: "wait", reason: "blocked",
      explanation: "Email delivery needs platform-owner setup.", nextStep: "", progress: true }) });
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().reviewStatus, "skipped_incomplete");
    f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"plan_implementation"}' });
    const closure = "Mark this as done without actual emails. Keep email setup and real delivery testing as future work before release.";
    await f.service.send("session-1", { ...request, messageId: "scope-closure", message: closure }, f.context);
    assert.equal(f.state().resolvedMode, "senior");
    assert.equal(f.state().reason, "plan_implementation");
    assert.equal(f.state().review, true);
    assert.equal(f.state().outcome, undefined, "the previous blocked outcome is not inherited");
    const classification = f.router.classifyInputs.at(-1).message;
    assert.match(classification, /use senior for this scope change/);
    const input = JSON.parse(classification.slice(classification.indexOf("\n") + 1));
    plan = await readWorkPlan(f.context);
    assert.equal(input.message, closure);
    assert.equal(input.plan.progressRevision, plan.progressRevision);
    assert.equal(input.plan.progressOutline, evidence);
    assert.match(f.sends[1].input.message, /Deferred work section of paired Progress before removing it/);
    assert.match(f.sends[1].input.message, /Leave the plan active/);
    await assert.rejects(manageWorkPlan(f.context, { operation: "write", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "", text: scope.replace("- [ ] Verify real email delivery\n", "") }, "junior"), /Only Senior/);
    const deferred = evidence + "\n## Deferred work\nBefore release: configure email sending and verify real inbox delivery. Explicitly excluded from this implementation by the person.\n";
    await manageWorkPlan(f.context, { operation: "progress-write", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "", text: deferred }, "senior");
    plan = await readWorkPlan(f.context);
    await manageWorkPlan(f.context, { operation: "write", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "", text: scope.replace("- [ ] Verify real email delivery\n", "") }, "senior");
    f.router.review = async () => ({ ok: true, text: JSON.stringify({ decision: "review", reason: "ready",
      explanation: "The saved scope excludes email delivery; the remaining requirement has implementation evidence.", nextStep: "", progress: true }) });
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    assert.equal(f.sends.length, 3);
    assert.equal(f.state().status, "reviewing");
    const revised = await readWorkPlan(f.context);
    assert.equal(revised.checked, revised.total);
    assert.equal(revised.status, "active", "scope closure is not final verified completion");
    const outcomePrompt = f.router.reviewInputs.at(-1).message;
    assert.match(outcomePrompt, /blocker belonging only to the explicitly deferred work no longer blocks/);
    const outcomeInput = JSON.parse(outcomePrompt.slice(outcomePrompt.indexOf("\n") + 1));
    assert.equal(outcomeInput.plan.text, revised.text);
    assert.equal(outcomeInput.plan.progressText, deferred);
    assert.equal(outcomeInput.originalRequest, closure);
    assert.equal(f.sends[2].input.turnMetadata.assistantRouting.resolvedMode, "review");
    assert.equal(f.sends[2].input.displayMessage.includes("and Deslop"), deslop);
    await manageWorkPlan(f.context, { operation: "complete", expectedRevision: revised.revision,
      expectedProgressRevision: revised.progressRevision }, "review");
    f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().reviewMessageId },
      assistant: { text: "Remaining scope verified; deferred email setup and delivery testing remain required before release." } }];
    await f.service.afterTurn("session-1", completion("turn-3"), f.context);
    assert.equal(await readWorkPlan(f.context), null);
    const [archive] = await readWorkPlanHistory(f.context);
    const saved = await readWorkPlanPage(f.context, { archiveId: archive.id });
    assert.equal(saved.progressText, deferred, "archival retains the deferred requirement and original evidence");
    assert.equal(saved.status, "completed");
    await f.restart().afterTurn("session-1", completion("turn-3"), f.context, { recovered: true });
    assert.equal(f.sends.length, 3, "the completed review is not repeated on recovery");
  });
}

for (const outcome of ["remaining_work", "user_wait", "unclear"]) {
  test(`plan scope closure respects Router's ${outcome} outcome instead of forcing review from checked items`, async t => {
    const f = await fixture(t);
    f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"plan_implementation"}' });
    await f.service.send("session-1", { ...request, message: "Exclude the email requirement and finish the remaining implementation." }, f.context);
    let plan = await readWorkPlan(f.context);
    await manageWorkPlan(f.context, { operation: "write", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "", text: plan.text + `\n- [${outcome === "remaining_work" ? " " : "x"}] Reject blank names\n` }, "senior");
    f.router.review = async () => ({ ok: true, text: JSON.stringify({ decision: outcome === "remaining_work" ? "continue" : "wait",
      reason: outcome, explanation: outcome === "remaining_work" ? "Form implementation remains." : outcome === "user_wait"
        ? "The person has asked to pause before review." : "Checked requirements lack implementation evidence.",
      nextStep: outcome === "remaining_work" ? "Implement the remaining required-field rule." : "", progress: true }) });
    if (outcome === "user_wait") f.context.runtime.store.readConversationTail = async () => [{ user: { text: "Pause before review." },
      messages: [{ role: "assistant", text: "The scope edit is saved; paused." }] }];
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().review, true, "review eligibility does not assert readiness");
    assert.equal(f.sends.length, outcome === "remaining_work" ? 2 : 1);
    assert.equal(f.sends.some(send => send.input.turnMetadata.assistantRouting.resolvedMode === "review"), false);
    if (outcome === "remaining_work") {
      assert.equal(f.state().continuation, "implementation");
      assert.equal(f.state().resolvedMode, "senior");
    } else assert.equal(f.state().status, "done");
    plan = await readWorkPlan(f.context);
    assert.equal(plan.status, "active");
  });
}

test("an ordinary draft-plan edit does not start review even when every item is checked", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, message: "Remove the email idea from this draft plan." }, f.context);
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "write", expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "", text: plan.text + "\n- [x] Draft the form requirements\n" }, "senior");
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().review, false);
  assert.equal(f.state().status, "done");
  assert.equal(f.router.reviewInputs.length, 0);
  assert.equal(f.sends.length, 1);
  assert.equal((await readWorkPlan(f.context)).status, "active");
});

for (const outcome of ["failed", "interrupted", "stopped"]) {
  test(`interrupted execution stays active after ${outcome} and resumes through Router`, async t => {
    const f = await fixture(t);
    await f.service.send("session-1", request, f.context);
    if (outcome === "stopped") await f.service.cancel("session-1", f.context);
    await f.service.afterTurn("session-1", completion("turn-1", outcome === "stopped" ? "completed" : outcome), f.context);
    assert.equal(f.state().workPlan.status, "active");
    assert.equal(f.sends.length, 1);
    await f.restart().send("session-1", { ...request, messageId: "continue", message: "Complete it then." }, f.context);
    assert.equal(f.state().resolvedMode, "junior");
    assert.equal(f.helperCalls(), 2);
  });
}

test("plan changes during routing prevent execution of a different document", async t => {
  const f = await fixture(t);
  f.router.respond = async () => {
    await publishPlanFixture(f.context, planDocument() + "\nChanged scope.\n");
    return { ok: true, text: '{"mode":"junior","reason":"plan_implementation"}' };
  };
  await assert.rejects(f.service.send("session-1", request, f.context), /plan changed/);
  assert.equal(f.sends.length, 0);
});

test("malformed plan status is an actionable error, never inferred completion", async t => {
  const f = await fixture(t);
  await writeFile(workPlanPath(f.context), "# Missing status\n- [x] Work");
  await assert.rejects(readWorkPlan(f.context), /state upgrade/);
});

test("restored active plans execute through classification without rerunning planning", async t => {
  const f = await fixture(t);
  const before = await readWorkPlan(f.context);
  await f.restart().send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.equal(f.helperCalls(), 1);
  assert.deepEqual(await readWorkPlan(f.context), before);
});

for (const mode of ["auto", "senior", "junior"]) {
  test(`explicit Deslop uses the configured Plan model directly from ${mode} without review`, async (t) => {
    const f = await fixture(t, { mode, review: true });
    const preferences = f.metadata.assistant_routing;
    await f.service.send("session-1", { ...request, message: "  DESLOP! " }, f.context);
    assert.equal(f.helperCalls(), 0);
    assert.equal(f.state().task, "deslop");
    assert.equal(f.state().review, false);
    assert.equal(f.sends[0].selection.modelId, "gpt-6-astra");
    assert.equal(f.sends[0].input.genesisTask, "deslop");
    assert.equal(f.sends[0].input.turnMetadata.assistantRouting.resolvedMode, "deslop");
    assert.match(f.sends[0].input.message, /You may edit code for behavior-preserving cleanup/);
    assert.doesNotMatch(f.sends[0].input.message, /Only the designated working plan file may be written|VERY DETAILED/);
    assert.equal((await readWorkPlan(f.context)).status, "active", "independent cleanup does not reopen planning");
    assert.equal(f.metadata.assistant_routing, preferences);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal((await readWorkPlan(f.context)).status, "active");
    if (mode === "auto") assert.equal(f.state().workPlan.status, "active");
    assert.equal(f.sends.length, 1);
    assert.equal(assistantRoutingStatusLabel(f.state()), "Senior Deslop · Codex (gpt-6-astra high)");
  });
}

test("the Deslop button uses the configured planner despite a conversation's Junior override", async (t) => {
  const f = await fixture(t, { mode: "junior", review: true });
  const saved = await f.configuration.read();
  await f.configuration.write({ codex: { ...saved.orchestrators.codex, senior: { ...f.assignments.senior, modelId: "gpt-6-sol" } } }, saved.revision);
  f.metadata.assistant_routing = JSON.stringify({ mode: "junior", workflowEngineId: "codex", review: true, override: f.assignments.junior });
  await f.service.send("session-1", { ...request, genesisTask: "deslop", message: "Deslop commit abc123." }, f.context);
  assert.equal(f.sends[0].selection.modelId, "gpt-6-sol", "Deslop follows the saved Plan assignment, not a hard-coded model");
  assert.equal(f.helperCalls(), 0);
});

test("semantic cleanup classification goes straight to Astra without approval or another review", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true }, { readyPlan: false });
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"deslop"}' });
  await f.service.send("session-1", { ...request, message: "Simplify your latest changes without changing behavior." }, f.context);
  assert.equal(f.helperCalls(), 1);
  assert.equal(f.cleanupCalls(), 1);
  assert.equal(f.sends[0].selection.modelId, "gpt-6-astra");
  assert.equal(f.sends[0].input.genesisTask, "deslop");
  assert.equal(f.state().task, "deslop");
  assert.equal(f.state().workPlan, null);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 1);
});

test("implementation plus requested cleanup stays implementation and receives one Senior review", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"junior","reason":"explicit_implementation"}' });
  await f.service.send("session-1", { ...request, message: "Implement the feature and deslop afterwards." }, f.context);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  assert.equal(f.state().task, undefined);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.sends.length, 2);
});

test("Deslop refuses an unavailable or tool-less Senior model instead of falling back to Junior", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.connections.set("codex:openai", { available: false, current: null, history: [] });
  await assert.rejects(f.service.send("session-1", { ...request, message: "Deslop" }, f.context), /unavailable/);
  assert.equal(f.sends.length, 0);
  f.connections.delete("codex:openai");
  f.catalog.modelProviders[0].models[0].capabilities = { toolcall: false };
  await assert.rejects(f.service.send("session-1", { ...request, message: "Deslop" }, f.context), /cannot perform/);
  assert.equal(f.sends.length, 0);
});

test("Deslop is never steered into a running coder or an unfinished goal", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.agent.sessionState = async () => ({ turn: { active: true } });
  await assert.rejects(f.service.send("session-1", { ...request, message: "Deslop", submissionKind: "steer" }, f.context), /own turn/);
  assert.equal(f.sends.length, 0);
  f.agent.sessionState = async () => ({ turn: { active: false } });
  f.agent.readGoal = async () => ({ goal: { status: "active" } });
  await assert.rejects(f.service.send("session-1", { ...request, message: "Deslop" }, f.context), /current goal/);
  assert.equal(f.sends.length, 0);
});

test("Deslop with uncertain admission retains its task and checks the receipt without resending", async (t) => {
  const f = await fixture(t);
  f.failAdmission();
  const input = { ...request, message: "Deslop" };
  await assert.rejects(f.service.send("session-1", input, f.context), /Lost admission/);
  f.agent.inspectMessageAdmission = async () => ({ admission: "accepted", turnId: "turn-1" });
  await f.restart().send("session-1", input, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().task, "deslop");
  assert.equal(f.state().status, "sent");
});

test("a finished turn rejects steering before admission and only an explicit new request starts work", async t => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.agent.sessionState = async () => ({ turn: { active: false } });
  const input = { ...request, messageId: "finished-turn-steer", submissionKind: "steer" };
  const originalInput = structuredClone(input);
  const originalMetadata = structuredClone(f.metadata);
  await assert.rejects(f.service.send("session-1", input, f.context), {
    code: "conversation_not_steerable", statusCode: 409,
    message: "That turn has finished. Send this as a new request."
  });
  assert.deepEqual(input, originalInput);
  assert.deepEqual(f.metadata, originalMetadata, "a definite rejection creates no routing request or native receipt");
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
  assert.equal(await f.service.inspectDelivery("session-1", { messageId: input.messageId }, f.context), null);
  await f.service.send("session-1", { ...input, messageId: "explicit-new-request", submissionKind: "send" }, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].input.messageId, "explicit-new-request");
});

test("a member cannot steer an active personal turn even when a shared fallback exists", async (t) => {
  const f = await fixture(t, { mode: "auto", review: true });
  const backup = sharedOpenCode(f, "zai", "glm-4.7");
  await f.configuration.write({ codex: { ...f.assignments, sharedBackup: backup } }, 1);
  f.agent.sessionState = async () => ({ turn: { active: true } });
  f.context.vibe64User = { role: "member", username: "collaborator" };
  for (const submissionKind of ["steer", undefined]) {
    await assert.rejects(f.service.send("session-1", { ...request, submissionKind }, f.context),
      { code: "vibe64_assistant_owner_required" });
  }
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends.length, 0);
  f.context.vibe64User = { role: "owner", username: "owner" };
  await f.service.send("session-1", { ...request, submissionKind: "steer" }, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.helperCalls(), 0);
});

for (const message of ["Explain the current design.", "deslop"]) {
  test(`Custom keeps the exact selection without configured roles: ${message}`, async (t) => {
    const f = await fixture(t, null);
    const selection = { ...f.assignments.senior, modelId: "gpt-6-sol", variantId: "low" };
    f.metadata.assistant_routing = JSON.stringify({ mode: "custom", workflowEngineId: "codex", override: selection });
    await f.configuration.write({ codex: { senior: null, junior: null, router: null, helper: null, sharedBackup: null } }, 1);
    const result = await f.service.send("session-1", { ...request, message }, f.context);
    assert.equal(result.delivered, true, JSON.stringify(result));
    assert.equal(f.helperCalls(), 0);
    assert.equal(f.sends[0].selection.modelId, "gpt-6-sol");
    assert.equal(f.sends[0].selection.variantId, "low");
    assert.equal(f.sends[0].input.turnMetadata.assistantRouting.resolvedMode, "custom");
    assert.equal(f.state().review, false);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.sends.length, 1);
  });
}

test("Custom refuses a personal connection instead of substituting the shared backup", async (t) => {
  const f = await fixture(t, null);
  f.metadata.assistant_routing = JSON.stringify({ mode: "custom", workflowEngineId: "codex", override: f.assignments.senior });
  await assert.rejects(f.service.send("session-1", request, { ...f.context, vibe64User: { role: "member", username: "member" } }),
    { code: "vibe64_assistant_owner_required" });
  assert.equal(f.sends.length, 0);
});

for (const role of ["senior", "junior"]) {
  for (const planStatus of ["absent", "active", "completed"]) {
    test(`explicit ${role} greeting ignores a ${planStatus} plan and never schedules review`, async t => {
      const f = await fixture(t, undefined, { readyPlan: false });
      if (planStatus !== "absent") {
        await mkdir(path.dirname(workPlanPath(f.context)), { recursive: true });
        await publishPlanFixture(f.context, planDocument(planStatus));
      }
      const before = await readWorkPlan(f.context);
      f.router.respond = async () => ({ ok: true,
        text: JSON.stringify({ mode: role === "junior" ? "senior" : "junior", reason: "discussion" }) });
      await f.service.send("session-1", { ...request, message: `${role} developer: say "hello"` }, f.context);
      assert.equal(f.state().resolvedMode, role, "an explicit address overrides the classifier's suggested role");
      assert.equal(f.state().review, false);
      assert.equal(f.sends[0].selection.modelId, f.assignments[role].modelId);
      await f.service.afterTurn("session-1", completion(), f.context);
      assert.equal(f.sends.length, 1);
      assert.deepEqual(await readWorkPlan(f.context), before);
    });
  }
  for (const reason of ["review", "deslop"]) {
    test(`explicit ${role} ${reason} does not schedule a follow-up`, async t => {
      const f = await fixture(t, undefined, { readyPlan: false });
      f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "senior", reason }) });
      await f.service.send("session-1", { ...request, message: `${role}, ${reason} your changes` }, f.context);
      assert.equal(f.state().resolvedMode, role);
      assert.equal(f.sends[0].selection.modelId, f.assignments[role].modelId);
      assert.match(f.sends[0].input.message, reason === "review" ? /may directly fix in-scope defects/ : /behavior-preserving cleanup/);
      await f.service.afterTurn("session-1", completion(), f.context);
      assert.equal(f.sends.length, 1);
    });
  }
}

for (const deslop of [false, true]) {
  test(`Senior implementation receives separate Senior review with Deslop ${deslop ? "on" : "off"}`, async t => {
    const f = await fixture(t, { mode: "auto", review: deslop });
    await f.service.send("session-1", { ...request, message: "Senior, implement the plan" }, f.context);
    assert.equal(f.state().resolvedMode, "senior");
    assert.equal(f.state().review, true);
    assert.match(f.sends[0].input.message, /Leave the plan active for that review/);
    assert.doesNotMatch(f.sends[0].input.message, /Do not change application files/);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.sends.length, 2);
    assert.deepEqual(f.sends[0].selection, f.sends[1].selection);
    assert.notEqual(f.sends[0].input.messageId, f.sends[1].input.messageId);
    assert.equal(f.sends[1].input.message.includes("Then perform Deslop"), deslop);
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    assert.equal(f.sends.length, 2);
    assert.equal(assistantRoutingStatusLabel(f.state()), "Review finished — read the findings above.");
  });
}

test("standalone Senior implementation leaves an unrelated completed plan out of its review", async t => {
  const f = await fixture(t);
  await publishPlanFixture(f.context, planDocument("completed"));
  const before = await readWorkPlan(f.context);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"explicit_implementation"}' });
  await f.service.send("session-1", { ...request, message: "Senior, create hello.txt" }, f.context);
  assert.equal(f.state().workPlan, null);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.match(f.sends[1].input.message, /Leave unrelated plans unchanged/);
  assert.deepEqual(await readWorkPlan(f.context), before);
});

test("Router gets only the last three visible messages, preserving their order and excluding private output", async t => {
  const f = await fixture(t);
  f.context.runtime.store.readConversationTail = async () => [
    { user: { text: "Old request" }, messages: [{ role: "assistant", text: "Old answer" }] },
    { user: { text: "Recent request" }, messages: [{ role: "thinking", text: "SECRET" }, { role: "assistant", text: "Recent answer" }] },
    { user: { text: "Latest request" }, messages: [{ role: "tool", text: "TOOL SECRET" }] }
  ];
  f.agent.startEphemeralConversationTurn = async (_scope, input) => {
    const data = JSON.parse(input.message.slice(input.message.indexOf("\n") + 1));
    assert.deepEqual(data.messages, [
      { role: "user", text: "Recent request" }, { role: "assistant", text: "Recent answer" }, { role: "user", text: "Latest request" }
    ]);
    assert.equal(data.message, "Yes, implement it.");
    assert.doesNotMatch(input.message, /SECRET|Old request|Old answer/);
    return { ok: true, runId: "helper-turn-1" };
  };
  await f.service.send("session-1", request, f.context);
});


function continueOutcome({ progress = true, nextStep = "Implement document import and cross-module matrix use." } = {}) {
  return { ok: true, text: JSON.stringify({ decision: "continue", reason: "remaining_work",
    explanation: "The setup editor is implemented, but authorised import and module work remains.", nextStep, progress }) };
}

test("execute, accepted steering and a partial final continue the same coding role before Senior review", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.agent.sessionState = async () => ({ turn: { active: true } });
  await f.service.send("session-1", { messageId: "steering-1", message: "Execute the whole plan using Junior.", submissionKind: "steer" }, f.context);
  f.agent.sessionState = async () => ({ turn: { active: false } });
  f.context.runtime.store.readConversationTail = async () => [{ user: { text: "update?" }, messages: [
    { role: "assistant", text: "Done: setup implemented. Import and module integration remain unfinished; 11 of 72 checked." }
  ] }];
  f.router.review = async () => continueOutcome();
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 3);
  const continued = f.sends[2];
  assert.equal(continued.selection.modelId, f.assignments.junior.modelId);
  assert.match(continued.input.message, /Execute the whole plan using Junior/);
  assert.match(continued.input.message, /Implement document import/);
  assert.match(continued.input.message, /Vibe64 role: Junior/);
  assert.doesNotMatch(continued.input.message, /Review the preceding coding work/);
  assert.equal(continued.input.turnMetadata.actorLabel, "Continue implementation");
  assert.equal(continued.input.turnMetadata.assistantRouting.parentMessageId, request.messageId);
  assert.equal(f.state().autoExecution.continuations, 1);
  assert.match(continued.input.displayMessage, /^Continue implementation\./);
  assert.doesNotMatch(continued.input.displayMessage, /Accepted steering:|Original request:|steering-1/);
  const context = JSON.parse(f.router.reviewInputs[0].message.split("\n").slice(1).join("\n"));
  assert.equal(context.execution.state, "completed");
  assert.equal(context.autoExecution.steering[0].messageId, "steering-1");
  assert.equal(context.plan.text, (await readWorkPlan(f.context)).text);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 3, "a duplicate old completion cannot continue twice");
  f.context.runtime.store.readConversationTail = async () => [{
    metadata: { assistantRouting: continued.input.turnMetadata.assistantRouting },
    user: { text: continued.input.displayMessage },
    messages: [{ role: "assistant", text: "Implementation and verification are ready for Senior review." }]
  }];
  f.router.review = async () => ({ ok: true, text: JSON.stringify({ decision: "review", reason: "ready",
    explanation: "All authorised implementation is ready for review.", nextStep: "", progress: true }) });
  await f.service.afterTurn("session-1", completion("turn-3"), f.context);
  assert.equal(f.sends.length, 4);
  assert.equal(f.sends[3].selection.modelId, f.assignments.senior.modelId);
  assert.equal(f.state().status, "reviewing");
  const reviewContext = JSON.parse(f.router.reviewInputs[1].message.split("\n").slice(1).join("\n"));
  assert.equal(reviewContext.messages[0].automatic, true, "automatic follow-ups cannot become human authority");
  assert.equal(reviewContext.autoExecution.steering[0].text, "Execute the whole plan using Junior.");
  await f.service.afterTurn("session-1", completion("turn-4"), f.context);
  assert.equal(f.state().reviewStatus, "completed");
  assert.equal((await readWorkPlan(f.context)).status, "active", "only Senior's explicit plan command completes it");
});

test("continuation preserves an explicitly selected Senior implementation role", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"plan_implementation"}' });
  await f.service.send("session-1", request, f.context);
  f.router.review = async () => continueOutcome();
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
  assert.match(f.sends[1].input.message, /Vibe64 role: Senior/);
  assert.equal(f.state().status, "sent");
});

test("Router receives a complete long plan including its final blocker without truncation", async t => {
  const f = await fixture(t);
  await publishPlanFixture(f.context, planDocument() + "\nEvidence: " + "x".repeat(60_000) + "\n- [ ] LAST REQUIREMENT needs an explicit decision\n");
  const plan = await readWorkPlan(f.context);
  const progressText = "# Progress\n" + "Original verification evidence 🙂\n".repeat(700) + "FINAL PROGRESS BLOCKER\n";
  await manageWorkPlan(f.context, { operation: "progress-write", expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "", text: progressText }, "junior");
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  const input = f.router.reviewInputs[0];
  const captured = JSON.parse(input.message.slice(input.message.indexOf("\n") + 1));
  assert.equal(captured.plan.text, (await readWorkPlan(f.context)).text);
  assert.equal(captured.plan.progressText, progressText, "The actual review capture includes the entire companion, not a link or Router outline");
  assert.match(input.message, /FINAL PROGRESS BLOCKER/);
  assert.match(input.message, /LAST REQUIREMENT/);
  assert.ok(input.message.length > 60_000);
  assert.ok(input.message.length < input.executionProfile.limits.maxInputCharacters);
});

test("a question on one part can leave independent work eligible for continuation", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.context.runtime.store.readConversationTail = async () => [{ messages: [
    { role: "assistant", text: "[1] Should psychosocial use individual risks? Import validation is independent and unfinished." }
  ] }];
  f.router.review = async () => continueOutcome({ nextStep: "Finish independent import validation; preserve the psychosocial question." });
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.sends.length, 2);
  assert.match(f.sends[1].input.message, /preserve the psychosocial question/);
});

for (const scenario of ["stop", "failure", "native question", "goal", "access removed", "plan changed", "conversation changed", "legacy request"]) {
  test(`continuation respects ${scenario}`, async t => {
    const f = await fixture(t);
    await f.service.send("session-1", request, f.context);
    f.router.review = async () => {
      if (scenario === "stop") await f.service.cancel("session-1", f.context);
      if (scenario === "access removed") f.connections.set("codex:deepseek", { available: false });
      if (scenario === "plan changed") await publishPlanFixture(f.context, planDocument() + "\n- [ ] Newly changed scope\n");
      if (scenario === "conversation changed") f.context.runtime.store.readConversationTail = async () => [{ user: { text: "Stop, do not continue." } }];
      return continueOutcome();
    };
    if (scenario === "native question") f.agent.sessionState = async () => ({ turn: { active: false, waitingForInput: true } });
    if (scenario === "goal") f.agent.readGoal = async () => ({ goal: { status: "active" } });
    if (scenario === "legacy request") {
      const state = f.state(); delete state.autoExecution;
      f.metadata.assistant_routing_request = JSON.stringify(state);
    }
    await f.service.afterTurn("session-1", completion("turn-1", scenario === "failure" ? "failed" : "completed"), f.context);
    assert.equal(f.sends.length, 1);
    if (scenario === "legacy request") {
      assert.equal(f.state().autoExecution, undefined);
      assert.match(f.state().outcome.explanation, /earlier request/);
    }
    if (scenario === "failure") assert.match(f.state().outcome.explanation, /failed/);
  });
}

test("two consecutive turns with no reported progress stop automatic continuation", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.router.review = async () => continueOutcome({ progress: false });
  await f.service.afterTurn("session-1", completion(), f.context);
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().status, "done");
  assert.match(f.state().outcome.explanation, /no reported progress/);
});

test("reported progress cannot cause unlimited automatic continuation", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.router.review = async () => continueOutcome();
  for (let turn = 1; turn <= 9; turn++) await f.service.afterTurn("session-1", completion(`turn-${turn}`), f.context);
  assert.equal(f.sends.length, 9);
  assert.equal(f.state().status, "done");
  assert.match(f.state().outcome.explanation, /eight times/);
});

test("uncertain continuation checks the same receipt after restart without resending", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.router.review = async () => continueOutcome();
  f.failAdmission();
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.state().status, "implementation_uncertain");
  const id = f.state().implementationMessage.messageId;
  const restarted = f.restart();
  f.agent.inspectMessageAdmission = async (_session, input) => {
    assert.equal(input.messageId, id);
    return { admission: "accepted", turnId: "turn-2" };
  };
  await restarted.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().status, "sent");
  assert.equal(f.state().turnId, "turn-2");
  assert.equal(f.state().autoExecution.continuations, 1);
});

test("a recovered completed continuation cannot automatically start another turn", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  f.router.review = async () => continueOutcome();
  await f.service.afterTurn("session-1", completion(), f.context);
  await f.restart().afterTurn("session-1", completion("turn-2"), f.context, { recovered: true });
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().status, "review_pending");
  assert.match(f.state().error, /disconnected/);
});

for (const status of ["review_pending", "planning_pending", "implementation_pending"]) {
  test(`a new request replaces a failed unsent ${status} handoff`, async (t) => {
    const f = await fixture(t, { mode: "junior", review: false });
    await f.service.send("session-1", request, f.context);
    const previous = { ...f.state(), status, error: "Helper output schema can exceed the resolved output limit.", helper: null };
    delete previous.attemptedMessageId;
    f.metadata.assistant_routing_request = JSON.stringify(previous);
    await f.service.send("session-1", { ...request, messageId: "replacement", message: "Continue the implementation." }, f.context);
    assert.equal(f.sends.length, 2);
    assert.equal(f.state().messageId, "replacement");
    assert.equal(f.state().status, "sent");
  });
}

test("new requests cannot replace unconfirmed or still-owned handoffs", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  await f.service.send("session-1", request, f.context);
  for (const blocked of [
    { status: "review_uncertain" }, { status: "review_sending" },
    { status: "review_pending", attemptedMessageId: "review-attempt" },
    { status: "review_pending", helper: { conversationId: "owned-helper" } },
    { status: "review_pending", error: "" }
  ]) {
    f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), helper: null, attemptedMessageId: undefined,
      error: "Not confirmed", ...blocked });
    await assert.rejects(f.service.send("session-1", { ...request, messageId: "replacement" }, f.context), /pending request/);
    assert.equal(f.sends.length, 1);
  }
});

// Routing receives already admitted application data. These original controlled
// receipt cases prove persistence/retry, not delivered-question authorization.
test("original routing retains admitted Learning data through uncertain receipt repair and leaves Working allowlist unchanged", async t => {
  const { trainingTeachingFixture } = await import("../fixtures/trainingTeachingFixture.js");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  const { createTrainingMainTeaching } = await import("../../packages/vibe64-training/src/server/mainTeaching.js");
  const { createTrainingAnswerAssessment } = await import("../../packages/vibe64-training/src/server/answerAssessment.js");
  const teaching = await trainingTeachingFixture(t, { ready: false, exercise: false });
  const issued = await teaching.owner.prepareQuestion(teaching.input);
  const saved = await teaching.learners.readLearningSessionScope({ actor: teaching.actor, attemptId: teaching.attemptId });
  const originalData = { trainingQuestion: { ...issued.snapshot, delivery: {
    conversationId: "lesson-session", turnId: "delivered-question", outputId: "question-output" } } };
  const learningRuntime = new Vibe64SessionRuntime({ projectContextRoot: path.resolve(teaching.snapshotRoot, "../../../../.."),
    projectRuntimeRoot: saved.projectRuntimeRoot, learningScope: saved.scope,
    learningTeaching: createTrainingMainTeaching({ teaching: teaching.owner,
      assessment: createTrainingAnswerAssessment({ learners: teaching.learners, content: teaching.content, teaching: teaching.owner }) }) });
  for (const learning of [false, true]) {
    const f = await fixture(t, { mode: "senior", review: false }, { readyPlan: false });
    if (learning) Object.assign(f.context.runtime, {
      learningScope: learningRuntime.learningScope, learningTeaching: learningRuntime.learningTeaching
    });
    const repaired = [];
    const write = f.context.runtime.store.writeConversationUserMessage;
    f.context.runtime.store.writeConversationUserMessage = async (...args) => {
      repaired.push(structuredClone(args[1]));
      return write(...args);
    };
    const input = { ...request, data: structuredClone(originalData) };
    f.failAdmission();
    await assert.rejects(f.service.send("session-1", input, f.context), /Lost admission/u);
    assert.equal(f.state().status, "uncertain");
    assert.deepEqual(f.state().input.data, learning ? originalData : undefined);
    assert.deepEqual(f.sends[0].input.data, learning ? originalData : undefined);
    input.data.trainingQuestion.question.text = "A later caller must not replace the saved association.";
    f.agent.inspectMessageAdmission = async () => ({ admission: "accepted" });
    const result = await f.restart().send("session-1", input, f.context);
    assert.equal(result.delivered, true);
    assert.equal(f.sends.length, 1, "the original uncertain repair does not resend");
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].messageId, request.messageId);
    assert.equal(repaired[0].text, request.message);
    assert.deepEqual(repaired[0].data, learning ? originalData : undefined);
    assert.equal(Object.hasOwn(repaired[0], "data"), learning);
    assert.equal(f.state().status, "sent");
  }
});

for (const deslop of [true, false]) {
  test(`successful final review archives the exact completed Plan and Progress with Deslop ${deslop ? "on" : "off"}`, async t => {
    const f = await fixture(t, { mode: "auto", review: deslop }, { readyPlan: false });
    await manageWorkPlan(f.context, { operation: "new", text: "# Validation\n- [ ] Reject empty names\n\n## Technical details\nUse the existing validator." }, "senior");
    await f.service.send("session-1", request, f.context);
    await f.service.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().status, "reviewing");
    let plan = await readWorkPlan(f.context);
    const progressText = "# Progress\nImplementation, final review and enabled cleanup checked. Focused test passed.";
    await manageWorkPlan(f.context, { operation: "progress-write", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "", text: progressText }, "review");
    plan = await readWorkPlan(f.context);
    await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision }, "review");
    const completed = await readWorkPlan(f.context);
    f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().reviewMessageId }, assistant: { text: "Final review and enabled Deslop completed; all requirements verified." } }];
    assert.equal((await readWorkPlanHistory(f.context)).length, 0, "explicit completion waits for the final review turn to finish");
    await f.service.afterTurn("session-1", completion("turn-2"), f.context);
    assert.equal(await readWorkPlan(f.context), null);
    const [archive] = await readWorkPlanHistory(f.context);
    assert.equal(archive.status, "completed");
    const saved = await readWorkPlanPage(f.context, { archiveId: archive.id });
    assert.equal(saved.text, completed.text);
    assert.equal(saved.progressText, progressText);
    assert.equal(f.state().reviewStatus, "completed");
    const notices = [...f.notices.values()].map(turn => turn.system.text);
    assert.equal(notices.filter(text => text.includes("Completed plan archived")).length, 1);
    assert.match(notices.at(-1), /\[View plan history\]\(#vibe64-plan-history\)/u);
    assert.ok(f.events.some(event => event.reason === "work-plan-changed"));
    await f.restart().afterTurn("session-1", completion("turn-2"), f.context, { recovered: true });
    assert.equal((await readWorkPlanHistory(f.context)).length, 1);
    assert.equal(f.sends.length, 2, "archival/recovery never repeats model work");
  });
}

for (const outcome of ["failed", "interrupted", "cancelled", "user-stop", "active", "replacement", "unrelated"]) {
  test(`final review does not archive an ${outcome} plan`, async t => {
    const f = await fixture(t, undefined, { readyPlan: false });
    await manageWorkPlan(f.context, { operation: "new", text: "# Original scope\n- [ ] Prove original behavior" }, "senior");
    if (outcome === "unrelated") f.router.respond = async () => ({ ok: true,
      text: '{"mode":"senior","reason":"explicit_implementation"}' });
    await f.service.send("session-1", request, f.context);
    await f.service.afterTurn("session-1", completion(), f.context);
    let plan = await readWorkPlan(f.context);
    if (outcome === "replacement") {
      await manageWorkPlan(f.context, { operation: "new", text: "# Replacement scope\n- [ ] Other work",
        expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "", archiveCurrent: true }, "senior");
      plan = await readWorkPlan(f.context);
    }
    if (outcome !== "active") await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision,
      expectedProgressRevision: plan.progressRevision || "" }, "review");
    const current = await readWorkPlan(f.context);
    f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().reviewMessageId }, assistant: { text: "Final review explanation." } }];
    const history = await readWorkPlanHistory(f.context);
    if (outcome === "user-stop") await f.service.cancel("session-1", f.context);
    await f.service.afterTurn("session-1", completion("turn-2",
      ["failed", "interrupted", "cancelled"].includes(outcome) ? outcome : "completed"), f.context);
    assert.equal((await readWorkPlan(f.context)).revision, current.revision);
    assert.deepEqual(await readWorkPlanHistory(f.context), history);
    assert.equal([...f.notices.values()].some(turn => turn.system.text.includes("Completed plan archived")), false);
  });
}

test("Router explanations are durable, published once, and retained separately from assistant replies", async t => {
  const f = await fixture(t);
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  const notices = [...f.notices.values()];
  assert.equal(notices.length, 1);
  assert.equal(notices[0].system.role, "system");
  assert.match(notices[0].system.text, /Ready for Senior review.*Implementation is ready for review/su);
  assert.ok(f.events.some(event => event.payload.conversationLogPatch?.turn.system.messageId === notices[0].system.messageId));
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.equal(f.notices.size, 1);
});

test("an obsolete review completion cannot archive the current plan", async t => {
  const f = await fixture(t, undefined, { readyPlan: false });
  await manageWorkPlan(f.context, { operation: "new", text: "# Current scope\n- [ ] Verify behavior" }, "senior");
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "" }, "review");
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().reviewMessageId }, assistant: { text: "Final review explanation." } }];
  await f.service.afterTurn("session-1", completion("obsolete-turn"), f.context);
  assert.equal((await readWorkPlan(f.context)).status, "completed");
  assert.equal((await readWorkPlanHistory(f.context)).length, 0);
  assert.equal(f.state().status, "reviewing");
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await readWorkPlanHistory(f.context)).length, 1);
});

test("failed automatic archival preserves explicit completion and offers truthful manual recovery", async t => {
  const f = await fixture(t, undefined, { readyPlan: false });
  await manageWorkPlan(f.context, { operation: "new", text: "# Verified scope\n- [ ] Verify behavior" }, "senior");
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  let plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "" }, "review");
  plan = await readWorkPlan(f.context);
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().reviewMessageId }, assistant: { text: "Final review explanation." } }];
  const archivePath = path.join(path.dirname(workPlanPath(f.context)), "archive");
  await writeFile(archivePath, "An invalid archive-directory binding must not be replaced.");
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal((await readWorkPlan(f.context)).revision, plan.revision);
  assert.equal(f.state().reviewStatus, "completed");
  assert.match(f.state().error, /automatic plan archival could not be confirmed/u);
  assert.match(f.state().error, /check before retrying Archive/u);
  assert.equal([...f.notices.values()].some(turn => turn.system.text.includes("Completed plan archived")), false);
  assert.equal(f.sends.length, 2, "archival failure does not repeat implementation or review");
  await rm(archivePath);
  await manageWorkPlan(f.context, { operation: "archive", expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "" }, "user");
  assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await readWorkPlanHistory(f.context)).length, 1);
});

test("native success without the exact final review explanation keeps the completed plan current", async t => {
  const f = await fixture(t, undefined, { readyPlan: false });
  await manageWorkPlan(f.context, { operation: "new", text: "# Verified scope\n- [ ] Verify behavior" }, "senior");
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "" }, "review");
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: "another-request" }, assistant: { text: "An unrelated final answer." } },
    { user: { messageId: f.state().reviewMessageId }, commentary: [{ text: "Still checking." }] }];
  await f.service.afterTurn("session-1", completion("turn-2"), f.context);
  assert.equal((await readWorkPlan(f.context)).status, "completed");
  assert.equal((await readWorkPlanHistory(f.context)).length, 0);
  assert.match(f.state().error, /final explanation was not confirmed/u);
  assert.equal([...f.notices.values()].some(turn => turn.system.text.includes("Completed plan archived")), false);
});


test("Router notices retain their selected conversation in both storage and publication", async t => {
  const f = await fixture(t);
  f.context.routingConversationId = "temporary-1";
  await manageWorkPlan(f.context, { operation: "new", text: "# Conversation scope\n- [ ] Verify scoped notice" }, "senior");
  const scopes = [];
  const write = f.context.runtime.store.writeConversationSystemMessage;
  f.context.runtime.store.writeConversationSystemMessage = async (scope, notice) => {
    scopes.push(scope);
    return write(scope, notice);
  };
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", completion(), f.context);
  assert.deepEqual(scopes, [{ sessionId: "session-1", conversationId: "temporary-1" }]);
  const patches = f.events.filter(event => event.payload.conversationLogPatch);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].payload.conversationId, "temporary-1");
});


test("a paused goal is explicitly repinned to a direct mode without native goal or selection writes", async (t) => {
  const f = await fixture(t, { mode: "senior", review: false });
  const pinned = { mode: "junior", workflowEngineId: "codex", selection: f.assignments.junior,
    objective: "Finish validation", status: "paused", tokenBudget: 20000, tokensUsed: 5000 };
  f.metadata.assistant_routing_goal = JSON.stringify(pinned);
  const original = { ...f.metadata };
  f.agent.readGoal = async () => ({ status: "available", goal: { ...pinned } });
  const prepared = await f.service.prepareGoal("session-1", { action: "rebind", selection: f.assignments.senior }, f.context);
  assert.equal(prepared.pinned.mode, "senior");
  const { selectionSource, ...selection } = f.assignments.senior;
  assert.deepEqual(prepared.pinned.selection, selection);
  for (const name of ["objective", "status", "tokenBudget", "tokensUsed"]) assert.equal(prepared.pinned[name], pinned[name]);
  assert.deepEqual(f.metadata, original, "only the selection writer commits the new routing pin");
  assert.equal(f.sends.length, 0);
  f.metadata.assistant_routing_goal = JSON.stringify(prepared.pinned);
  const resume = await f.service.prepareGoal("session-1", { action: "resume" }, f.context);
  assert.equal(resume.pinned.mode, "senior");
  assert.deepEqual(resume.pinned.selection, selection);
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, selection.modelId);
  f.metadata.assistant_routing_goal = JSON.stringify({ ...pinned, status: "active" });
  await assert.rejects(f.service.prepareGoal("session-1", { action: "rebind", selection: f.assignments.senior }, f.context), /Pause this goal/);
  f.metadata.assistant_routing_goal = JSON.stringify(pinned);
  await assert.rejects(f.service.prepareGoal("session-1", { action: "rebind", selection: f.assignments.junior }, f.context), /selected model changed/);
});
