import assert from "node:assert/strict";
import test from "node:test";
import { fixture, publishPlanFixture, planDocument, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { assistantWorkflowUpgradeChanges, parseRoutingDecision, assistantWorkflowInstructions, assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

/** The plan History, read through the plan command's history operation. */
async function planHistory(context) {
  return (await manageWorkPlan(context, { operation: "history" }, "user")).history;
}

const request = { messageId: "request-1", message: "Execute the plan", submissionKind: "send" };
const end = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
const report = (f, decision, options) => reportOutcome(f, decision, { involved: true, ...options });
async function finish(f, decision, options) {
  await report(f, decision, options);
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: "Execute the plan" },
    assistant: { text: "Actual final explanation." }, messages: [{ role: "assistant", text: "Actual final explanation." }] }];
  await f.service.afterTurn("session-1", end(state), f.context);
}
async function review(f) { await f.service.send("session-1", request, f.context); await finish(f, "handoff"); }
/** The chat's system notices, oldest first. */
const noticeTexts = f => [...f.notices.values()].map(turn => turn.system.text);
const started = f => noticeTexts(f).filter(text => text.includes("started automatically"));
const AUTO_SAVE_STARTED = "Save started automatically (Chat settings: Automatically save changes)";
// Without a managed session source the passes after a plan can't name a base: the plan is archived and saved without them.
const NO_BASE = "The passes didn't run after the plan: Vibe64 can't tell where this plan's work started in the session's history. Run them from Passes.";

test("implementation, Senior's check of the plan and its explicit completion archive and auto-save exactly once", async t => {
  const saves = [];
  const f = await fixture(t, { mode: "auto" }, { onPlanCompleted: async (sessionId, input) => {
    saves.push({ sessionId, input, archived: (await planHistory(f.context)).length, status: f.state().status });
    return "Saved automatically.";
  } });
  await publishPlanFixture(f.context, planDocument() + "\n- [x] Required-name validation verified\n");
  await review(f);
  assert.equal(f.state().stage, "review"); assert.equal(f.state().status, "working");
  assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
  assert.equal(f.helperCalls(), 1, "Router classifies only the new human request");
  assert.match(f.sends[1].input.message, /\n\nPlan completion: /u);
  assert.match(f.sends[1].input.message, /This turn checks the plan only: run no Deslop, UI pass or other pass\./u);
  assert.equal(f.sends[1].input.genesisTask, undefined, "Senior's check of the plan is not a review or a pass");
  assert.deepEqual(started(f), [], "nothing starts automatically before the plan is completed");
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  const terminal = f.state(); await finish(f, "complete");
  assert.equal(f.state().status, "complete"); assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await planHistory(f.context)).length, 1);
  await f.service.afterTurn("session-1", end(terminal), f.context);
  assert.equal((await planHistory(f.context)).length, 1); assert.equal(f.sends.length, 2);
  // Save follows the archived plan once, after the completing turn ended, and says it started.
  assert.equal(saves.length, 1);
  assert.equal(saves[0].sessionId, "session-1"); assert.equal(saves[0].archived, 1); assert.equal(saves[0].status, "complete");
  const notices = noticeTexts(f);
  assert.ok(notices.includes(NO_BASE), notices.join("\n"));
  assert.ok(notices.indexOf(AUTO_SAVE_STARTED) < notices.indexOf("Saved automatically."), notices.join("\n"));
});

test("a refused automatic save leaves a short note and keeps the completed plan", async t => {
  const f = await fixture(t, { mode: "auto" }, { onPlanCompleted: async () => { throw new Error("Nothing changed."); } });
  await publishPlanFixture(f.context, planDocument() + "\n- [x] Required-name validation verified\n");
  await review(f);
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  await finish(f, "complete");
  assert.equal(f.state().status, "complete"); assert.equal((await planHistory(f.context)).length, 1);
  assert.match([...f.notices.values()].map(turn => JSON.stringify(turn)).join("\n"), /Automatic save didn't run: Nothing changed\./);
});

test("Senior can reconcile checklist ticks during review and archive the completed pair", async t => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  await manageWorkPlan(f.context, { operation: "new", text: "# FDA controls\n\n- [ ] Block invoice\n- [ ] Block transaction\n- [ ] Block shortcut\n- [ ] Allow no FDA\n- [ ] Cancel\n- [ ] Transfers unchanged\n- [ ] Browser verification\n" }, "senior");
  await review(f);
  let plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "progress-write", text: "# Progress\n\nVerified blocked and allowed controls in Preview.\n",
    expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "write", text: plan.text.replaceAll("- [ ]", "- [x]"),
    expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  const completed = await readWorkPlan(f.context);
  await assert.rejects(report(f, "complete", { expectedRevision: plan.revision }), /Read the complete current/);
  await finish(f, "complete");
  assert.equal(f.state().status, "complete");
  assert.equal(await readWorkPlan(f.context), null);
  const history = await planHistory(f.context);
  assert.equal(history.length, 1);
  assert.equal(history[0].revision, completed.revision);
  assert.equal(history[0].progressRevision, completed.progressRevision);
});

for (const change of ["wording", "fenced example"]) test(`completion still rejects changed ${change} during review`, async t => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  await manageWorkPlan(f.context, { operation: "new", text: "# FDA controls\n\n- [ ] Block invoice\n\n```md\n- [ ] literal example\n```\n" }, "senior");
  await review(f);
  let plan = await readWorkPlan(f.context);
  const text = change === "wording" ? plan.text.replace("Block invoice", "Allow invoice") : plan.text.replace("- [ ] literal", "- [x] literal");
  await manageWorkPlan(f.context, { operation: "write", text, expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  await assert.rejects(report(f, "complete"), /explicitly complete/);
  assert.equal((await planHistory(f.context)).length, 0);
});

test("Senior saves necessary rework, Junior implements it, then Senior reviews again", async t => {
  const f = await fixture(t); await review(f);
  const plan = await readWorkPlan(f.context);
  const text = plan.text + "\n- [ ] Repair an exposed edge case within the agreed outcome\n";
  await manageWorkPlan(f.context, { operation: "write", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "", text }, "review");
  await finish(f, "handoff", { explanation: "The review discovered missing edge-case handling. The technical plan now records its repair." });
  assert.equal(f.state().stage, "implementation"); assert.equal(f.sends[2].selection.modelId, f.assignments.junior.modelId);
  assert.match((await readWorkPlan(f.context)).text, /Repair an exposed edge case/);
  await finish(f, "handoff"); assert.equal(f.state().stage, "review");
  assert.equal(f.sends[3].selection.modelId, f.assignments.senior.modelId); assert.equal(f.helperCalls(), 1);
});

for (const stage of ["implementation", "review"]) test(`continue retains ${stage} and the correct agent`, async t => {
  const f = await fixture(t); if (stage === "review") await review(f); else await f.service.send("session-1", request, f.context);
  const before = f.sends.at(-1).selection;
  await finish(f, "continue"); assert.equal(f.state().stage, stage); assert.deepEqual(f.sends.at(-1).selection, before);
  assert.equal(f.state().status, "working"); assert.equal(f.helperCalls(), 1);
});

for (const stage of ["implementation", "review"]) test(`wait retains ${stage} and resumes only on explicit action`, async t => {
  const f = await fixture(t); if (stage === "review") await review(f); else await f.service.send("session-1", request, f.context);
  const count = f.sends.length;
  await finish(f, "wait", { explanation: "A required resource is unavailable." });
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stage, stage); assert.equal(f.sends.length, count);
  await f.restart().reconcile("session-1", f.context); assert.equal(f.sends.length, count);
  await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, count + 1); assert.equal(f.state().stage, stage);
});

for (const state of ["completed", "failed", "interrupted"]) test(`native ${state} without an outcome cannot complete or advance review`, async t => {
  const f = await fixture(t); await review(f); const before = f.state();
  await f.service.afterTurn("session-1", end(before, state), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stage, "review"); assert.equal(f.sends.length, 2);
  assert.equal((await readWorkPlan(f.context)).status, "active");
});

test("Stop during review suppresses a late outcome and explicit resume starts a new Senior turn", async t => {
  const f = await fixture(t); await review(f); await report(f, "continue"); const old = f.state();
  assert.equal(await f.service.cancel("session-1", f.context), false, "caller must still interrupt native work");
  await f.restart().afterTurn("session-1", end(old), f.context);
  assert.equal(f.sends.length, 2); assert.equal(f.state().status, "waiting"); assert.equal(f.state().stopped, true);
  await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 3); assert.notEqual(f.sends[2].input.messageId, f.sends[1].input.messageId);
  assert.equal(f.sends[2].selection.modelId, f.assignments.senior.modelId);
});

test("accepted steering invalidates an earlier outcome and remains with Senior", async t => {
  const f = await fixture(t); await review(f); await report(f, "handoff");
  f.agent.sessionState = async () => ({ turn: { active: true } });
  await f.service.send("session-1", { messageId: "steer-1", message: "Include this clarification", submissionKind: "steer" }, f.context);
  assert.equal(f.state().outcome, undefined); assert.equal(f.state().steering.at(-1).text, "Include this clarification");
  assert.equal(f.helperCalls(), 1);
});

for (const changes of [{ messageId: "foreign" }, { turnId: "old" }, { stage: "planning" }, { decision: "invented" }, { explanation: "" }]) {
  test(`invalid or stale outcome is refused: ${JSON.stringify(changes)}`, async t => {
    const f = await fixture(t); await f.service.send("session-1", request, f.context);
    await assert.rejects(report(f, "handoff", changes)); assert.equal(f.sends.length, 1); assert.equal(f.state().outcome, undefined);
  });
}

test("Junior cannot complete and Senior native success cannot substitute for explicit plan completion", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context);
  await assert.rejects(report(f, "complete"), /Only Senior/); await finish(f, "handoff");
  await assert.rejects(report(f, "complete"), /explicitly complete/);
});

test("a changed plan after the outcome cannot advance the workflow", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context); await report(f, "handoff");
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "write", text: plan.text + "\n- [ ] Another agreed condition\n", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "senior");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.sends.length, 1);
});

test("completed work found after a restart requires explicit stage resumption, never replay", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context); await report(f, "handoff");
  await f.restart().afterTurn("session-1", end(f.state()), f.context, { recovered: true });
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stage, "review"); assert.equal(f.sends.length, 1);
  await f.restart().send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context); assert.equal(f.sends.length, 2);
});

test("uncertain Senior delivery is checked against its original receipt without resending", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context); f.failAdmission(); await finish(f, "handoff");
  const pending = f.state(); assert.equal(pending.delivery, "uncertain"); assert.equal(f.sends.length, 2);
  f.agent.inspectMessageAdmission = async () => ({ admission: "accepted", turnId: "turn-2" });
  await f.restart().send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2); assert.equal(f.state().delivery, "accepted"); assert.equal(f.state().followup.messageId, pending.followup.messageId);
});

for (const blocked of ["goal", "question", "access"]) test(`${blocked} prevents follow-up without discarding review ownership`, async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context); await report(f, "handoff");
  if (blocked === "goal") f.agent.readGoal = async () => ({ goal: { status: "active" } });
  if (blocked === "question") f.agent.sessionState = async () => ({ turn: { active: false, waitingForInput: true } });
  if (blocked === "access") f.connections.set("codex:openai", { available: false, errorCode: "disabled", message: "Account disabled" });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stage, "review"); assert.equal(f.sends.length, 1);
});

const customOverride = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai",
  modelId: "gpt-6-astra", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
for (const mode of ["senior", "junior", "custom"]) test(`direct ${mode} work ends with its own agent's last turn, without Router or a review turn`, async t => {
  const f = await savingFixture(t, mode === "custom" ? { mode: "custom", override: customOverride } : { mode });
  const model = mode === "custom" ? customOverride.modelId : f.assignments[mode].modelId;
  await f.service.send("session-1", request, f.context);
  assert.equal(f.state().workflow, true); assert.equal(f.state().stage, "implementation"); assert.equal(f.helperCalls(), 0);
  assert.match(f.sends[0].input.message, /Workflow stage: implementation/);
  assert.equal(f.sends[0].selection.modelId, model);
  await finish(f, "handoff");
  assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 1);
  assert.equal(f.helperCalls(), 0);
  assert.equal((await readWorkPlan(f.context)).status, "active", "a plan left active stays for Senior to complete");
  assert.deepEqual(started(f), [AUTO_SAVE_STARTED]); assert.deepEqual(f.saves, [0]);
});

test("planning cannot authorise execution or completion", async t => {
  const f = await fixture(t); f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, message: "Make the plan" }, f.context);
  await assert.rejects(report(f, "handoff"), /Planning alone/); await assert.rejects(report(f, "complete"), /Planning alone/);
  await finish(f, "wait", { explanation: "The plan is ready; execution has not been authorised." }); assert.equal(f.sends.length, 1);
});

test("explicit Implement plan replaces repeated planning continuations with a new human implementation request", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, message: "Make a plan" }, f.context);
  await finish(f, "wait", { explanation: "The saved plan awaits implementation approval." });
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
    assert.equal(f.state().stage, "planning");
    await finish(f, "wait", { explanation: "Planning is finished; implementation is not authorised." });
  }
  const plan = await readWorkPlan(f.context);
  const implement = { messageId: "human-implementation", message: "Implement the saved plan. I authorize implementation within its agreed scope.",
    planRevision: plan.revision, submissionKind: "send" };
  await f.service.send("session-1", implement, f.context);
  assert.equal(f.state().messageId, implement.messageId);
  assert.equal(f.state().stage, "implementation");
  assert.equal(f.state().workflow, true);
  assert.equal(f.state().followup, undefined);
  assert.equal(f.state().stopped, undefined);
  assert.equal(f.sends.at(-1).selection.modelId, f.assignments.junior.modelId);
  assert.equal(f.sends.at(-1).input.displayMessage, implement.message);
  assert.equal(f.helperCalls(), 1, "Explicit plan approval cannot be reclassified as planning");
  assert.equal((await readWorkPlan(f.context)).revision, plan.revision);
  await f.service.send("session-1", implement, f.context);
  assert.equal(f.sends.length, 4, "The same human request cannot dispatch twice");
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
  assert.equal(f.sends.at(-1).selection.modelId, f.assignments.senior.modelId);
});

for (const state of ["changed", "completed", "absent"]) test(`Implement plan refuses a ${state} plan without sending work`, async t => {
  const f = await fixture(t, undefined, { readyPlan: state !== "absent" });
  const revision = (await readWorkPlan(f.context))?.revision || "missing";
  if (state === "changed") await publishPlanFixture(f.context, planDocument() + "\nChanged requirements.\n");
  if (state === "completed") await publishPlanFixture(f.context, planDocument("completed"));
  await assert.rejects(f.service.send("session-1", { ...request, planRevision: revision }, f.context), /active plan changed/);
  assert.equal(f.sends.length, 0); assert.equal(f.helperCalls(), 0);
});

test("Router has exactly four purposes and the agent outcome contract has four decisions", () => {
  for (const reason of ["conversation", "planning", "implementation", "review"]) assert.equal(parseRoutingDecision(JSON.stringify({ mode: "junior", reason })).reason, reason);
  for (const reason of ["discussion", "explicit_implementation", "plan_implementation", "deslop"]) assert.throws(() => parseRoutingDecision(JSON.stringify({ mode: "junior", reason })));
  assert.match(assistantWorkflowInstructions({ stage: "review" }), /continue, handoff, wait, or complete/);
});

test("two no-progress turns and eight automatic steps retain the stage for deliberate resume", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context); await finish(f, "continue", { progress: false }); await finish(f, "continue", { progress: false });
  assert.equal(f.state().status, "waiting"); assert.match(f.state().error, /Two turns/);
  const g = await fixture(t); await g.service.send("session-1", request, g.context);
  for (let i = 0; i < 9; i++) await finish(g, "continue");
  assert.equal(g.state().status, "waiting"); assert.equal(g.sends.length, 9); assert.match(g.state().error, /Eight/);
});

test("offline conversion preserves identities and temporary records without granting automatic execution", () => {
  const old = { schemaVersion: 4, mode: "auto", status: "review_uncertain", reason: "plan_implementation", messageId: "original", input: { message: "Execute" }, assignments: { senior: {} }, turnId: "turn", threadId: "thread", reviewMessageId: "review-message", reviewMessage: "Review", attemptedMessageId: "review-message", submittedBy: { username: "member" } };
  const record = { conversationId: "temporary-1", history: ["preserved"], nativeBindings: { codex: "native" }, routingMetadata: { unrelated: "keep", assistant_routing_request: JSON.stringify(old) } };
  const result = assistantWorkflowUpgradeChanges({ metadata: { assistant_routing_request: JSON.stringify(old) }, conversations: [record] });
  const converted = JSON.parse(result.metadata.assistant_routing_request);
  assert.equal(converted.status, "waiting"); assert.equal(converted.stage, "review"); assert.equal(converted.delivery, "uncertain");
  assert.equal(converted.attemptedMessageId, "review-message"); assert.equal(converted.followup.messageId, "review-message"); assert.deepEqual(converted.submittedBy, old.submittedBy);
  assert.deepEqual(result.conversations[0].history, record.history); assert.deepEqual(result.conversations[0].nativeBindings, record.nativeBindings); assert.equal(result.conversations[0].routingMetadata.unrelated, "keep");
  assert.deepEqual(assistantWorkflowUpgradeChanges(result), result);
  assert.throws(() => assistantWorkflowUpgradeChanges({ metadata: { assistant_routing_request: "{" } }), /unreadable/);
});

for (const selected of ["junior", "senior"]) test(`initial ${selected} implementation of a plan keeps its captured Senior after routing settings change`, async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: selected, reason: "implementation" }) });
  await f.service.send("session-1", request, f.context); await report(f, "handoff");
  const configuration = await f.configuration.read();
  await f.configuration.write({ ...configuration, owner: { ...f.assignments, senior: { ...f.assignments.senior, modelId: "gpt-6-sol" } } }, configuration.revision);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.helperCalls(), 1);
  if (selected === "senior") {
    // Senior completes a plan it implemented itself: no turn follows its own.
    assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 1);
    assert.equal((await readWorkPlan(f.context)).status, "active");
    return;
  }
  assert.equal(f.state().stage, "review"); assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
});

test("a member's main chat request waits for the owner's approval without sending", async t => {
  const f = await fixture(t);
  f.context.vibe64User = { role: "member", username: "member" };
  await assert.rejects(f.service.send("session-1", request, f.context), { code: "vibe64_main_chat_approval_required" });
  assert.equal(f.sends.length, 0);
});

test("a Router disconnected after classification cannot strand an authorised review", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context); await report(f, "handoff");
  f.router.respond = async () => { throw new Error("Router unavailable after classification"); };
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().stage, "review"); assert.equal(f.sends.length, 2); assert.equal(f.helperCalls(), 1);
});

test("explicit resume after the no-progress allowance starts a fresh allowance at the retained stage", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context);
  await finish(f, "continue", { progress: false }); await finish(f, "continue", { progress: false });
  await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  await finish(f, "continue", { progress: false }); assert.equal(f.state().status, "working"); assert.equal(f.state().stage, "implementation");
});

for (const final of ["missing", "archive-failure", "obsolete"]) test(`${final} cannot falsely archive or complete a review`, async t => {
  const f = await fixture(t);
  await publishPlanFixture(f.context, planDocument() + "\n- [x] Required-name validation verified\n");
  await review(f);
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  await report(f, "complete");
  const terminal = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: terminal.followup.messageId }, assistant: { text: final === "missing" ? "" : "Final verified explanation." } }];
  if (final === "archive-failure") {
    const { mkdir } = await import("node:fs/promises");
    const { __testables: { workPlanPath } } = await import("../../packages/vibe64-terminals/src/server/assistantWorkPlan.js");
    const path = await import("node:path");
    await mkdir(path.join(path.dirname(workPlanPath(f.context)), "archive"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    // Block the original archive directory with an actual incompatible entry.
    const { rm } = await import("node:fs/promises");
    await rm(path.join(path.dirname(workPlanPath(f.context)), "archive"), { recursive: true });
    await writeFile(path.join(path.dirname(workPlanPath(f.context)), "archive"), "blocked");
  }
  await f.service.afterTurn("session-1", final === "obsolete" ? end({ turnId: "old-turn" }) : end(terminal), f.context);
  assert.notEqual(f.state().status, "complete"); assert.equal((await readWorkPlan(f.context)).status, "completed");
  if (final !== "archive-failure") assert.equal((await planHistory(f.context)).length, 0);
  else assert.match(f.state().error, /could not be archived/);
});

test("the bound plan helper returns workflow identity without a plan and forwards an outcome through the existing owner", async t => {
  const { createAgentSessionCommandService } = await import("../../packages/vibe64-terminals/src/server/agentSessionCommand.js");
  const f = await fixture(t, undefined, { readyPlan: false });
  // The initial classifier fixture's visible conversation still supplies context.
  await f.service.send("session-1", request, f.context);
  f.context.runtime.store.readSessionSourceDescriptor = async () => ({ metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: `${f.context.runtime.stateRoot}/sessions/active/session-1/source` } });
  const calls = [];
  const commands = createAgentSessionCommandService({ logger: silentLogger, project: {
    readCurrentProject: async () => ({ slug: "fixture", projectRoot: f.context.runtime.stateRoot }),
    createSessionStore: async () => f.context.runtime.store,
    runInProjectContext: async (_slug, operation) => operation()
  }, reportWorkflowOutcome: async (id, input, options) => { calls.push(options); return f.service.recordOutcome(id, input, f.context); } });
  await commands.bindSession("session-1", { wrapperHostDir: f.context.runtime.stateRoot });
  const read = await commands.managePlan("session-1", { operation: "read" });
  assert.equal(read.available, false); assert.deepEqual(read.workflow, { messageId: request.messageId, turnId: "turn-1", stage: "implementation", status: "working" });
  f.agent.sessionState = async () => ({ turn: { active: true, id: read.workflow.turnId } });
  const result = await commands.managePlan("session-1", { operation: "outcome", ...read.workflow, decision: "handoff", explanation: "Implementation and focused checks finished.", progress: true });
  assert.equal(result.outcome.decision, "handoff"); assert.equal(calls[0].vibe64User.username, "owner");
  await assert.rejects(commands.managePlan("session-1", { operation: "outcome", ...read.workflow, turnId: "old", decision: "complete", explanation: "Spoofed", progress: true }));
});

test("a live planning completion observed before its native event continues planning without reclassification", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, message: "Make the plan" }, f.context);
  await report(f, "continue");
  await f.service.afterTurn("session-1", end(f.state()), f.context, { recovered: true });
  assert.equal(f.state().status, "working"); assert.equal(f.state().stage, "planning"); assert.equal(f.sends.length, 2);
  assert.equal(f.helperCalls(), 1); assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
});

test("an explicitly chosen Junior reviewer hands verification to Senior instead of starting implementation", async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: '{"mode":"junior","reason":"review"}' });
  await f.service.send("session-1", { ...request, message: "Junior, review this work" }, f.context);
  assert.equal(f.sends[0].selection.modelId, "deepseek-flash");
  await assert.rejects(report(f, "complete"), /Only Senior/);
  await finish(f, "handoff"); assert.equal(f.state().stage, "review"); assert.equal(f.sends[1].selection.modelId, "gpt-6-astra");
});

test("Stop during the first implementation resumes at implementation with a fresh message and keeps the stopped receipt", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context);
  assert.equal(await f.service.cancel("session-1", f.context), false, "the caller must interrupt the admitted native turn");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 1);
  await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  assert.equal(f.state().status, "working"); assert.equal(f.state().stage, "implementation"); assert.equal(f.state().stopped, false);
  assert.equal(f.sends.length, 2); assert.notEqual(f.sends[1].input.messageId, f.sends[0].input.messageId);
});

// The chat composer shows answer controls for this reply; Auto must wait for that answer.
const question = "The agreed required-field rule is done.\n\n[1] Shall I also fix the unrelated findings now?\nPossible answers:\n- Yes, fix them\n- Not now";
function askPerson(f, messages = [{ role: "assistant", text: question }]) {
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().followup?.messageId || request.messageId, text: "Execute the plan" },
    messages }];
}

for (const decision of ["continue", "handoff"]) test(`a final question waits for the person even when the agent reported ${decision}`, async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context);
  await report(f, decision); askPerson(f);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 1, "no automatic turn may start before the person answers");
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stage, "implementation"); assert.equal(f.state().awaitingAnswer, true);
});

// The AI often asks, reports its outcome and closes with one short line; the
// questions it wrote before that tool call are saved as commentary.
for (const [role, decision] of [["commentary", "wait"], ["commentary", "continue"], ["assistant", "handoff"]]) {
  test(`questions followed by a short closing message wait for the answer (questions as ${role}, agent reported ${decision})`, async t => {
    const f = await fixture(t); await f.service.send("session-1", request, f.context);
    await report(f, decision);
    askPerson(f, [{ role: "user", text: "Execute the plan" }, { role, text: question }, { role: "thinking", text: "Outcome reported." },
      { role: "assistant", text: "No files have changed. I'll continue once you've answered." }]);
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.equal(f.sends.length, 1, "no automatic turn may start before the person answers");
    assert.equal(f.state().status, "waiting"); assert.equal(f.state().awaitingAnswer, true);
    assert.equal(f.state().error, "Waiting for your answer. Reply in chat to continue.");
  });
}

test("a final question without an outcome is never resumed from the saved request; the reply starts the next request", async t => {
  const f = await fixture(t); await f.service.send("session-1", request, f.context);
  askPerson(f);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().followup, undefined);
  await f.restart().reconcile("session-1", f.context);
  await assert.rejects(f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context), /Answer the question/);
  assert.equal(f.sends.length, 1, "neither recovery nor Continue may resend the original request");
  await f.service.send("session-1", { messageId: "answer-1", message: "Yes, fix them", submissionKind: "send" }, f.context);
  assert.equal(f.sends.length, 2); assert.equal(f.sends[1].input.messageId, "answer-1"); assert.equal(f.state().messageId, "answer-1");
});

const checkedPlan = planDocument() + "\n- [x] Required-name validation verified\n";
async function completePlan(f, role = "review") {
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, role);
}
async function savingFixture(t, preferences, options) {
  const saves = [];
  const f = await fixture(t, preferences, { ...options, onPlanCompleted: async () => { saves.push(saves.length); return "Saved automatically."; } });
  return Object.assign(f, { saves });
}
// Auto's work on a plan, up to Senior's check of it: the turn that completes the plan.
async function checking(t) {
  const f = await savingFixture(t, { mode: "auto" });
  await publishPlanFixture(f.context, checkedPlan);
  await review(f);
  assert.equal(f.state().stage, "review");
  return f;
}

test("a Senior chat executing a plan completes it itself: nothing runs per step or per turn, and Save runs once, last", async t => {
  const f = await savingFixture(t, { mode: "senior" });
  await publishPlanFixture(f.context, checkedPlan);
  await f.service.send("session-1", request, f.context);
  await finish(f, "continue");
  assert.equal(f.state().stage, "implementation", "a plan step is not the end of the work");
  assert.deepEqual(started(f), [], "nothing starts per step or per turn");
  await completePlan(f, "senior");
  await finish(f, "complete");
  assert.equal(f.state().status, "complete"); assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await planHistory(f.context)).length, 1);
  assert.equal(f.sends.length, 2, "no review turn follows Senior's own completion");
  assert.ok(f.sends.every(({ selection }) => selection.modelId === f.assignments.senior.modelId), "Senior does every part");
  assert.equal(f.helperCalls(), 0);
  assert.deepEqual(f.saves, [0], "Save runs once, last"); assert.deepEqual(started(f), [AUTO_SAVE_STARTED]);
  assert.ok(noticeTexts(f).includes(NO_BASE));
  for (const { input } of f.sends) assert.match(input.message, /Vibe64 saves this work automatically .*never ask the person to press Save\./, "every turn knows Save is automatic");
});

test("a request without a plan that its agent reports finished ends there and is saved, with no review", async t => {
  const f = await savingFixture(t, { mode: "senior" }, { readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await finish(f, "handoff", { involved: false });
  assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 1); assert.deepEqual(f.saves, [0]);
  assert.deepEqual(started(f), [AUTO_SAVE_STARTED]);
});

// The person steers a message into the running turn, as a chat's composer does.
async function steer(f, messageId = "status", message = "status?") {
  const { turnId } = f.state();
  f.agent.sessionState = async () => ({ turn: { active: true, id: turnId } });
  await f.service.send("session-1", { messageId, message, submissionKind: "steer" }, f.context);
  f.agent.sessionState = async () => ({ turn: { active: false } });
}
// The store reads the newest entries back to the userLimit-th one with a user message.
function transcript(f, entries) {
  f.context.runtime.store.readConversationTail = async (_sessionId, { userLimit = 2 } = {}) => {
    const tail = [];
    let users = 0;
    for (const turn of [...entries].reverse()) {
      tail.unshift(turn);
      if (turn.user && ++users >= userLimit) break;
    }
    return tail;
  };
}
// A transcript entry: the user message that starts it, if any, its commentary and its final reply, if any.
const entry = (messageId, final = "") => ({
  user: messageId ? { messageId, text: messageId } : null,
  assistant: final ? { role: "assistant", text: final } : null,
  messages: [...messageId ? [{ role: "user", text: messageId }] : [], { role: "commentary", text: "Checking the form." },
    ...final ? [{ role: "assistant", text: final }] : []]
});
// The transcript a steered Claude turn leaves (the Claude stream test proves it):
// the turn's own message keeps its commentary, and the reply to the steer and the
// turn's final reply join the steered message.
function steeredTail(f, steerId, final) {
  const turnMessage = f.state().followup?.messageId || f.state().messageId;
  transcript(f, [
    { user: { messageId: turnMessage, text: "Senior checks and completes the plan." }, assistant: null,
      messages: [{ role: "user", text: "Senior checks and completes the plan." }, { role: "commentary", text: "Checking the form." }] },
    { user: { messageId: steerId, text: "status?" }, assistant: final ? { role: "assistant", text: final } : null,
      messages: [{ role: "user", text: "status?" }, { role: "commentary", text: "Almost done." },
        ...final ? [{ role: "assistant", text: final }] : []] }
  ]);
}
// The receipt of a project message the turn sends: a system notice in an entry of
// its own, so the runtime writes the turn's later output into a fresh entry after it.
const receipt = {
  user: null, assistant: null,
  system: { role: "system", messageId: "project-message:other-app:session-2:reply-1", text: "Message to other-app: delivered\n\nThe check passes." },
  messages: [{ role: "system", text: "Message to other-app: delivered\n\nThe check passes." }]
};

test("Senior's check of the plan, steered by the person, completes and saves once it reports complete and ends", async t => {
  const f = await checking(t);
  await completePlan(f);
  await report(f, "complete");
  await steer(f);
  assert.equal(f.state().outcome, undefined, "steering invalidates the earlier outcome");
  await report(f, "complete");
  steeredTail(f, "status", "Plan complete: the form rejects a blank name and its tests pass.");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete", f.state().error);
  assert.equal((await planHistory(f.context)).length, 1);
  assert.deepEqual(f.saves, [0], "Save runs once, as without steering");
  assert.deepEqual(started(f), [AUTO_SAVE_STARTED]);
});

for (const [name, steered, final, error] of [
  ["its final reply is missing", "status", "", /final explanation was not confirmed/],
  ["the reply follows a message that is not this turn's", "another-request", "Unrelated answer.", /final explanation was not confirmed/]
]) test(`a steered check of the plan still waits when ${name}`, async t => {
  const f = await checking(t);
  await completePlan(f);
  await steer(f);
  await report(f, "complete");
  steeredTail(f, steered, final);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.match(f.state().error, error);
  assert.deepEqual(f.saves, []);
});

test("a check of the plan steered after its outcome, that never reports again, still waits for that outcome", async t => {
  const f = await checking(t);
  await completePlan(f);
  await report(f, "complete");
  await steer(f);
  steeredTail(f, "status", "Plan complete.");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.match(f.state().error, /without a confirmed workflow outcome/);
  assert.equal(f.state().stage, "review"); assert.deepEqual(f.saves, []);
});

test("Junior's implementation of a plan, steered by the person, starts Senior's check once it reports handoff and ends", async t => {
  const f = await savingFixture(t, { mode: "auto" });
  await publishPlanFixture(f.context, checkedPlan);
  await f.service.send("session-1", request, f.context);
  await report(f, "handoff");
  await steer(f);
  await report(f, "handoff");
  steeredTail(f, "status", "Implemented the blank-name check and its tests.");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "working", f.state().error); assert.equal(f.state().stage, "review");
  assert.deepEqual(started(f), []);
  assert.equal(f.sends.length, 3, "the request, the steer and Senior's check of the plan");
  assert.match(f.sends.at(-1).input.message, /Accepted steering: .*status\?/);
});

for (const stage of ["implementation", "review"]) test(`a ${stage} turn whose final reply follows its own project message's receipt completes`, async t => {
  const f = stage === "review" ? await checking(t) : await savingFixture(t, { mode: "senior" }, { readyPlan: false });
  if (stage === "review") await completePlan(f);
  else await f.service.send("session-1", request, f.context);
  await report(f, "complete", { involved: stage === "review" });
  transcript(f, [entry(f.state().followup?.messageId || request.messageId), receipt, entry("", "Done; I told the other app the check passes.")]);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete", f.state().error);
  assert.deepEqual(f.saves, stage === "review" ? [0] : [], "only finished work that changed files saves, once");
  assert.deepEqual(started(f), stage === "review" ? [AUTO_SAVE_STARTED] : []);
});

test("a check of the plan steered twice completes and saves once with its final reply under the second steer", async t => {
  const f = await checking(t);
  await completePlan(f);
  await steer(f, "status", "status?");
  await steer(f, "eta", "how long?");
  await report(f, "complete");
  transcript(f, [entry(f.state().followup.messageId), entry("status"), entry("eta", "Plan complete.")]);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete", f.state().error);
  assert.deepEqual(f.saves, [0]);
});

test("a steered implementation turn that changed nothing completes with nothing after it and no Save", async t => {
  const f = await savingFixture(t, { mode: "senior" }, { readyPlan: false });
  await f.service.send("session-1", { ...request, message: "What does the form validate?" }, f.context);
  await steer(f);
  await report(f, "complete", { involved: false, explanation: "Answered; no files changed." });
  steeredTail(f, "status", "It rejects a blank name; nothing changed.");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete"); assert.equal(f.state().error, undefined);
  assert.deepEqual(started(f), []); assert.deepEqual(f.saves, []);
  assert.equal(f.sends.length, 2, "the request and the steer");
});

test("a check of the plan still waits when the only reply comes after another request's message", async t => {
  const f = await checking(t);
  await completePlan(f);
  await report(f, "complete");
  transcript(f, [entry(f.state().followup.messageId), entry("another-request"), entry("", "Unrelated answer.")]);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.match(f.state().error, /final explanation was not confirmed/);
  assert.deepEqual(f.saves, []);
});

test("Stop runs nothing after the stopped turn and saves nothing", async t => {
  const f = await savingFixture(t, { mode: "senior" }, { readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await f.service.cancel("session-1", f.context);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stopped, true);
  assert.equal(f.sends.length, 1); assert.deepEqual(started(f), []); assert.deepEqual(f.saves, []);
});

test("a question that changes nothing runs nothing after it and saves nothing", async t => {
  const f = await savingFixture(t, { mode: "junior" }, { readyPlan: false });
  await f.service.send("session-1", { ...request, message: "What does the form validate?" }, f.context);
  await finish(f, "complete", { involved: false, explanation: "Answered; no files changed." });
  assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 1);
  assert.deepEqual(started(f), []); assert.deepEqual(f.saves, []);
  assert.equal(assistantRoutingStatusLabel(f.state()), "Reply finished.");
});

test("a direct turn that ends without reporting is a plain reply: nothing runs after it and nothing is saved", async t => {
  const f = await savingFixture(t, { mode: "senior" }, { readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete"); assert.equal(f.state().error, undefined);
  assert.equal(f.sends.length, 1); assert.deepEqual(started(f), []); assert.deepEqual(f.saves, []);
});

test("wait holds the work until it is reported finished, then it is saved", async t => {
  const f = await savingFixture(t, { mode: "senior" }, { readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await finish(f, "wait", { involved: false, explanation: "Which error colour should I use?" });
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stage, "implementation");
  assert.equal(f.sends.length, 1); assert.deepEqual(started(f), []);
  await f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context);
  await finish(f, "handoff", { involved: false });
  assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 2);
  assert.deepEqual(started(f), [AUTO_SAVE_STARTED]); assert.deepEqual(f.saves, [0]);
});

test("Auto work without a plan goes straight to Save after Junior's turn", async t => {
  const f = await savingFixture(t, { mode: "auto" }, { readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await finish(f, "handoff", { involved: false });
  assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 1, "no Senior turn");
  assert.deepEqual(f.saves, [0]); assert.deepEqual(started(f), [AUTO_SAVE_STARTED]);
  assert.ok(noticeTexts(f).some(text => text.startsWith("Work finished.")));
  assert.equal(assistantRoutingStatusLabel(f.state()), "Work finished.");
});

test("a lesson's work runs no pass and is never saved automatically, whatever its settings say", async t => {
  const f = await savingFixture(t, { mode: "junior" }, { readyPlan: false });
  // A lesson's runtime is bound to its learner's attempt.
  f.context.runtime.learningScope = { learnerId: "learner-1", attemptId: "attempt-1", noExercise: false };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.state().workflow, false); assert.equal(f.state().afterPlan, null);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete"); assert.equal(f.sends.length, 1);
  assert.deepEqual(started(f), []); assert.deepEqual(f.saves, []);
});

test("with automatic save off, finished work is not saved", async t => {
  const f = await savingFixture(t, { mode: "senior", autoSave: false }, { readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await finish(f, "handoff", { involved: false });
  assert.equal(f.state().status, "complete"); assert.deepEqual(f.saves, []);
  assert.deepEqual(started(f), []);
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0].input.message, /the person saves finished work with the Save button\./, "the turn knows the person saves");
  assert.doesNotMatch(f.sends[0].input.message, /saved automatically/);
});

test("an explicit Deslop and generated Junior work run no pass after a plan", async t => {
  const f = await fixture(t, { mode: "senior" }, { readyPlan: false });
  await f.service.send("session-1", { ...request, messageId: "deslop", message: "Deslop" }, f.context);
  assert.equal(f.state().workflow, false); assert.equal(f.state().afterPlan, null);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  await f.service.send("session-1", { ...request, messageId: "generated" }, { ...f.context, purpose: "junior" });
  assert.equal(f.state().workflow, false); assert.equal(f.state().afterPlan, null);
});

// How a turn is told to end: Auto's Junior implementing a plan says the work
// continues after it, since Senior checks and completes the plan; every other
// workflow turn ends normally.
const CONTINUES = "When you report continue or handoff, this piece of work continues automatically after your turn: end your final reply with what you changed and what you verified, and don't use it to ask the person to try, publish or deploy the work or to offer next steps.";
const SAVE_ON = "Vibe64 saves this work automatically once it is finished, after any plan-completion turn and after-plan passes: after your complete reply, say it will be saved automatically, as a note that never replaces the reply, since the person reads only your final response; never ask the person to press Save.";
const SAVE_OFF = "This chat's settings turn automatic save off: the person saves finished work with the Save button.";
const continues = f => f.sends.map(({ input }) => input.message.includes(CONTINUES));
const withMode = (mode, settings) => ({ ...(mode === "custom" ? { override: customOverride } : {}), mode, ...settings });

test("in Auto, Junior's implementation of a plan says the work continues, and Senior's check of it ends normally", async t => {
  const f = await savingFixture(t, { mode: "auto" });
  await publishPlanFixture(f.context, checkedPlan);
  await f.service.send("session-1", request, f.context);
  await finish(f, "continue");
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
  // Substantial rework goes back to Junior, whose implementation Senior checks again.
  await finish(f, "handoff", { explanation: "The check found substantial rework." });
  assert.equal(f.state().stage, "implementation");
  await finish(f, "handoff");
  await completePlan(f);
  await finish(f, "complete");
  assert.equal(f.state().status, "complete"); assert.deepEqual(f.saves, [0]);
  assert.deepEqual(continues(f), [true, true, false, true, false], "Junior's turns go on; Senior's checks end the work normally");
  for (const { input } of f.sends) {
    assert.ok(input.message.endsWith(`\n${SAVE_ON}`), "the save line stays last");
    if (input.message.includes(CONTINUES)) assert.ok(input.message.endsWith(`\n${CONTINUES}\n${SAVE_ON}`), "the work goes on, then it is saved");
  }
});

for (const mode of ["auto", "senior", "junior", "custom"]) test(`in ${mode}, work without a plan, and a direct chat's work on one, ends with its only turn, whatever Save says`, async t => {
  for (const plan of mode === "auto" ? [false] : [false, true]) for (const autoSave of [true, false]) {
    const f = await savingFixture(t, withMode(mode, { autoSave }), { readyPlan: plan });
    await f.service.send("session-1", request, f.context);
    await finish(f, "handoff", { involved: plan });
    assert.equal(f.state().status, "complete", `plan ${plan}, save ${autoSave}`);
    assert.deepEqual(f.saves, autoSave ? [0] : []);
    assert.deepEqual(continues(f), [false]);
    assert.ok(f.sends[0].input.message.endsWith(`\n${autoSave ? SAVE_ON : SAVE_OFF}`), `plan ${plan}, save ${autoSave}`);
  }
});

test("turns that run nothing after them never say the work continues", async t => {
  const plain = async (preferences, input, options = {}) => {
    const f = await fixture(t, preferences, { readyPlan: false });
    if (options.lesson) f.context.runtime.learningScope = { learnerId: "learner-1", attemptId: "attempt-1", noExercise: false };
    if (options.reason) f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "senior", reason: options.reason }) });
    await f.service.send("session-1", { ...request, ...input }, { ...f.context, ...options.context });
    assert.equal(f.sends.length, 1);
    return f.sends[0].input.message;
  };
  for (const message of [
    await plain({ mode: "senior" }, { message: "Deslop" }),
    await plain({ mode: "senior" }, { message: "UI pass" }),
    await plain({ mode: "senior" }, {}, { context: { purpose: "junior" } }),
    await plain({ mode: "junior" }, {}, { lesson: true }),
    await plain({ mode: "auto" }, { message: "What does the form validate?" }, { reason: "conversation" }),
    await plain({ mode: "auto" }, { message: "Make a plan" }, { reason: "planning" }),
    await plain({ mode: "auto" }, {})
  ]) assert.ok(!message.includes(CONTINUES), message);
});
