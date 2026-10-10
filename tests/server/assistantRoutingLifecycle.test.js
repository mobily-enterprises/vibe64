import assert from "node:assert/strict";

import { lstat, mkdir, writeFile } from "node:fs/promises";

import path from "node:path";

import test from "node:test";

import { readWorkPlan, readWorkPlanPage, manageWorkPlan, workPlanPath } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

import { codexAuthMarkerPath } from "@local/vibe64-core/server/codexAuthState";

import { readCodexSelectedAccountAccess } from "@local/vibe64-runtime/server/codexAppServerProvider";

import { assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";

const request = { messageId: "request-1", message: "Yes, implement it.", submissionKind: "send" };

const completion = (turnId = "turn-1", state = "completed") => ({ payload: { agentRun: { active: false, state, providerTurnId: turnId } } });

function sharedOpenCode(f, modelProviderId = "opencode", modelId = "big-pickle") {
  const catalog = { ...structuredClone(f.catalog), engineId: "opencode", transportId: "opencode_server", label: "OpenCode",
    agents: [{ id: "build", mode: "primary" }], defaults: { agentId: "build", modelProviderId, modelId, variantId: "" },
    modelProviders: [{ id: modelProviderId, label: modelProviderId, connected: true,
      models: [{ id: modelId, label: modelId, status: "available", variants: [] }] }] };
  f.catalogs.push(catalog);
  return { schema: "vibe64.assistant-selection.v1", engineId: "opencode", agentId: "build", modelProviderId, modelId,
    variantId: "", catalogRevision: catalog.revision, selectionSource: "explicit" };
}



import { fixture, planDocument, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";

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

for (const mode of ["senior", "junior"]) {
  for (const planState of ["absent", "active", "unreadable"]) {
    test(`direct ${mode} ignores a ${planState} working plan and never starts automatic review`, async (t) => {
      const f = await fixture(t, { mode, review: true }, { readyPlan: false });
      const file = workPlanPath(f.context);
      if (planState === "active") {
        await mkdir(path.dirname(file), { recursive: true });
        await publishPlanFixture(f.context, planDocument("active"));
        delete f.metadata.assistant_routing_request;
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
      assert.equal(f.state().status, "complete");
      assert.equal(f.state().workPlan, null);
      assert.equal(f.state().error, undefined);
      if (planState === "absent") await assert.rejects(lstat(path.dirname(file)), { code: "ENOENT" });
      else if (planState === "active") assert.equal((await readWorkPlan(f.context)).text, planDocument("active"));
      else assert.ok((await lstat(file)).isDirectory());
    });
  }
  test(`a stale Implement action cannot pull direct ${mode} into Auto's workflow`, async (t) => {
    const f = await fixture(t, { mode, review: true });
    await assert.rejects(f.service.send("session-1", { ...request, planRevision: (await readWorkPlan(f.context)).revision }, f.context), /Choose Auto to implement/);
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
    assert.equal(saved.status, "waiting");
    assert.equal(saved.delivery, "failed");
    f.metadata.assistant_routing_request = JSON.stringify({ ...saved, review: true,
      workPlan: { status: "active", text: "An old plan", approvedRevision: "old-revision" },
      input: { ...saved.input, planRevision: "old-revision" }
    });
    const restarted = f.restart();
    assert.equal((await restarted.send("session-1", request, f.context)).delivered, true);
    assert.equal(f.sends[0].selection.modelId, f.assignments[mode].modelId);
    assert.ok(!f.sends[0].input.message.includes(file));
    await restarted.afterTurn("session-1", completion(), f.context);
    assert.equal(f.state().status, "complete");
    assert.equal(f.sends.length, 1, "direct completion cannot start a reviewer");
  });
}

for (const planStatus of ["absent", "active", "completed"]) {
  for (const outcome of ["completed", "failed", "stopped"]) {
    test(`discussion preserves ${planStatus} plan after ${outcome}`, async t => {
      const f = await fixture(t, undefined, { readyPlan: false });
      if (planStatus !== "absent") {
        await mkdir(path.dirname(workPlanPath(f.context)), { recursive: true });
        await publishPlanFixture(f.context, planDocument(planStatus));
      }
      const before = await readWorkPlan(f.context);
      f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"conversation"}' });
      await f.service.send("session-1", { ...request, message: "Is this finished?" }, f.context);
      if (outcome === "stopped") await f.service.cancel("session-1", f.context);
      await f.restart().afterTurn("session-1", completion("turn-1", outcome === "stopped" ? "completed" : outcome), f.context, { recovered: true });
      assert.deepEqual(await readWorkPlan(f.context), before);
      assert.equal(f.sends.length, 1);
      assert.equal(f.state().status, outcome === "completed" ? "complete" : "waiting");
    });
  }
}

test("new planning leaves a completed document intact until Senior explicitly replaces it", async (t) => {
  const f = await fixture(t);
  await publishPlanFixture(f.context, planDocument("completed"));
  delete f.metadata.assistant_routing_request;
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"conversation"}' });
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
  assert.equal(f.state().status, "waiting");
});

test("generated Junior cannot change the mode of an unfinished Senior goal", async (t) => {
  const f = await fixture(t);
  f.metadata.assistant_routing_goal = JSON.stringify({ status: "active", mode: "senior", selection: f.assignments.senior });
  await assert.rejects(f.service.send("session-1", request, { ...f.context, purpose: "junior" }), /Finish or cancel/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.helperCalls(), 0);
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
      text: JSON.stringify({ mode, reason: mode === "senior" ? "planning" : "implementation" }) });

    await f.service.send("session-1", request, f.context);
    assert.equal(f.helperCalls(), 1);
    assert.equal(f.cleanupCalls(), 1);
    assert.equal(f.sends[0].selection.modelId, mode === "senior" ? "gpt-6-astra" : "deepseek-flash");
    assert.equal(f.state().decision.backupUsed, false);
    assert.equal(f.state().submittedBy.username, "collaborator");
    assert.equal(f.state().decision.seniorJuniorPair.senior.connectionIdentity, access.connectionIdentity);
    await reportOutcome(f, mode === "junior" ? "handoff" : "wait");
    await f.service.afterTurn("session-1", completion(), f.context);
    if (mode === "junior") {
      assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
      await reportOutcome(f, "wait");
      await f.service.afterTurn("session-1", completion("turn-2"), f.context);
      assert.equal(f.state().stage, "review");
    }
    assert.equal(f.sends.length, mode === "junior" ? 2 : 1);
    assert.equal(f.state().status, "waiting");
  });
}

test("interrupted Router results retain the provider error and never dispatch partial decisions", async (t) => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, status: "interrupted",
    text: '{"mode":"junior","reason":"implementation"}', error: "Claude output exceeded its size limit." });
  await assert.rejects(f.service.send("session-1", request, f.context), /Claude output exceeded its size limit/u);
  assert.equal(f.state().status, "waiting");
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

test("uncertain native admission is inspected on retry without resending", async (t) => {
  const f = await fixture(t);
  f.failAdmission();
  await assert.rejects(f.service.send("session-1", request, f.context), /Lost admission/);
  assert.equal(f.state().delivery, "uncertain");
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
    assert.equal(states.some((state) => state.delivery.includes("uncertain")), false);
    const sending = states.find((state) => state.delivery === "sending" && state.attemptedMessageId);
    assert.equal(sending.attemptedMessageId, request.messageId);
    assert.match(assistantRoutingStatusLabel(sending), /awaiting receipt/);
    assert.equal(f.helperCalls(), mode === "auto" ? 1 : 0);
  }
});

test("a late saved receipt clears interrupted delivery without dispatching again", async (t) => {
  const f = await fixture(t, { mode: "senior", review: false });
  f.failAdmission();
  await assert.rejects(f.service.send("session-1", request, f.context), /Lost admission/);
  await f.context.runtime.store.writeConversationUserMessage("session-1", { messageId: request.messageId });
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "working");
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

test("Stop cancels routing while helper cleanup finishes and prevents delivery", async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  f.router.respond = async () => {
    started.resolve();
    await finish.promise;
    return { ok: true, text: '{"mode":"junior","reason":"implementation"}' };
  };
  f.agent.stopEphemeralConversation = async () => { finish.resolve(); return { ok: true }; };
  const sending = f.service.send("session-1", request, f.context);
  void sending.catch(() => {});
  await started.promise;
  assert.equal(await f.service.cancel("session-1", f.context), true);
  await assert.rejects(sending, /cancelled/);
  assert.equal(f.state().status, "waiting");
  assert.equal(f.sends.length, 0);
  assert.equal(f.cleanupCalls(), 1);
});

test("Stop after classification finishes still prevents delivery while its helper closes", async (t) => {
  const f = await fixture(t);
  const plan = await readWorkPlan(f.context);
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
    assert.equal(f.state().status, "waiting");
    assert.equal(f.sends.length, 0);
  } finally {
    release.resolve();
  }
  await rejected;
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "waiting");
  assert.equal(f.state().helper, null);
  assert.equal(f.state().input.message, request.message);
  assert.equal(f.cleanupCalls(), 1);
  assert.equal(f.sends.length, 0);
  assert.deepEqual(f.state().workPlan, plan);
  assert.deepEqual(await readWorkPlan(f.context), plan);
});

test("Stop reports a clean routing cancellation instead of the provider's AbortError", async (t) => {
  const f = await fixture(t, undefined, { beforeExclusive() {
    if (f.state()?.stopped && !f.state().helper) {
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
  assert.equal(f.state().status, "waiting");
  assert.equal(f.sends.length, 0);
  assert.equal(f.state().stopped, true);
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
    return { ok: true, text: '{"mode":"junior","reason":"implementation"}' };
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
  assert.equal(f.state().status, "waiting");
  assert.ok(f.state().helper);
  releaseCleanup.resolve();
  await shutdown;
  await rejected;
  assert.equal(f.state().helper, null);
  assert.equal(f.sends.length, 0);
  await assert.rejects(f.service.send("session-1", { ...request, messageId: "late" }, f.context), /shutting down/);
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, "waiting");
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
      mode: "junior", reason: "implementation", [key]: "untrusted-router-value"
    }) });
    await assert.rejects(f.service.send("session-1", request, f.context), /Routing returned an invalid decision/);
    assert.equal(f.state().status, "waiting");
    assert.equal(f.state().helper, null);
    assert.equal(f.cleanupCalls(), 1);
    assert.equal(f.sends.length, 0);
    assert.equal(f.metadata.assistant_selection, originalSelection);
  });
}

test("replacing a captured connection while Router works refuses delivery", async (t) => {
  const f = await fixture(t);
  f.router.respond = async () => {
    f.connections.set("codex:deepseek", { connectionIdentity: "codex:deepseek:replacement" });
    return { ok: true, text: '{"mode":"junior","reason":"implementation"}' };
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
  assert.equal(f.state().status, "waiting");
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
  assert.equal(f.state().status, "waiting");
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
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 5, delivery: "failed", stage: null, workflow: false, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "waiting", review: false,
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
    const original = JSON.stringify({ schemaVersion: 5, delivery: "failed", stage: null, workflow: false, admissionRequired: true, workflowEngineId: "codex",
      messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "waiting", review: false,
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
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 5, delivery: "failed", stage: null, workflow: false, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "waiting", review: false,
    assignments: { junior: f.assignments.junior }, settingsRevision: 1, submittedBy: null });
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().submittedBy, null);
  assert.equal(f.state().admissionRequired, undefined);
});

test("a migrated uncertain request can inspect admission without authorizing fresh inference", async (t) => {
  const f = await fixture(t, { mode: "junior", review: false });
  f.metadata.assistant_routing_request = JSON.stringify({ schemaVersion: 5, delivery: "uncertain", stage: null, workflow: false, admissionRequired: true, workflowEngineId: "codex",
    messageId: request.messageId, input: { message: request.message }, mode: "junior", resolvedMode: "junior", status: "waiting", review: false,
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
  assert.equal(f.state().status, "working");
});

test("malformed plan status is an actionable error, never inferred completion", async t => {
  const f = await fixture(t);
  await writeFile(workPlanPath(f.context), "# Missing status\n- [x] Work");
  await assert.rejects(readWorkPlan(f.context), /state upgrade/);
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
    assert.equal(assistantRoutingStatusLabel(f.state()), "Reply finished.");
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
  assert.equal(f.state().status, "working");
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
        text: JSON.stringify({ mode: role === "junior" ? "senior" : "junior", reason: "conversation" }) });
      await f.service.send("session-1", { ...request, message: `${role} developer: say "hello"` }, f.context);
      assert.equal(f.state().resolvedMode, role, "an explicit address overrides the classifier's suggested role");
      assert.equal(f.state().review, false);
      assert.equal(f.sends[0].selection.modelId, f.assignments[role].modelId);
      await f.service.afterTurn("session-1", completion(), f.context);
      assert.equal(f.sends.length, 1);
      assert.deepEqual(await readWorkPlan(f.context), before);
    });
  }
  for (const reason of ["review"]) {
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
