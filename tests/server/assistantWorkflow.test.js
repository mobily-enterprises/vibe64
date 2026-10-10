import assert from "node:assert/strict";
import test from "node:test";
import { fixture, publishPlanFixture, planDocument, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan, readWorkPlanHistory } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { assistantWorkflowUpgradeChanges, parseRoutingDecision, assistantWorkflowInstructions } from "@local/vibe64-runtime/shared/assistantRouting";

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

for (const deslop of [true, false]) test(`implementation, review and explicit completion archive exactly once with Deslop ${deslop}`, async t => {
  const f = await fixture(t, { mode: "auto", review: deslop });
  await publishPlanFixture(f.context, planDocument() + "\n- [x] Required-name validation verified\n");
  await review(f);
  assert.equal(f.state().stage, "review"); assert.equal(f.state().status, "working");
  assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
  assert.equal(f.helperCalls(), 1, "Router classifies only the new human request");
  assert.equal(f.sends[1].input.message.includes("Then perform Deslop"), deslop);
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
  const terminal = f.state(); await finish(f, "complete");
  assert.equal(f.state().status, "complete"); assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await readWorkPlanHistory(f.context)).length, 1);
  await f.service.afterTurn("session-1", end(terminal), f.context);
  assert.equal((await readWorkPlanHistory(f.context)).length, 1); assert.equal(f.sends.length, 2);
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

for (const mode of ["senior", "junior", "custom"]) test(`direct ${mode} remains direct and cannot declare workflow outcomes`, async t => {
  const f = await fixture(t, mode === "custom" ? { mode: "custom", override: { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` } } : { mode, review: true });
  await f.service.send("session-1", request, f.context); await assert.rejects(report(f, "handoff"));
  await f.service.afterTurn("session-1", end(f.state()), f.context); assert.equal(f.sends.length, 1); assert.equal(f.helperCalls(), 0);
  assert.equal((await readWorkPlan(f.context)).status, "active");
});

test("planning cannot authorise execution or completion", async t => {
  const f = await fixture(t); f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
  await f.service.send("session-1", { ...request, message: "Make the plan" }, f.context);
  await assert.rejects(report(f, "handoff"), /Planning alone/); await assert.rejects(report(f, "complete"), /Planning alone/);
  await finish(f, "wait", { explanation: "The plan is ready; execution has not been authorised." }); assert.equal(f.sends.length, 1);
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

for (const selected of ["junior", "senior"]) test(`initial ${selected} implementation keeps its captured reviewer after routing settings change`, async t => {
  const f = await fixture(t);
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: selected, reason: "implementation" }) });
  await f.service.send("session-1", request, f.context); await report(f, "handoff");
  const configuration = await f.configuration.read();
  await f.configuration.write({ codex: { ...f.assignments, senior: { ...f.assignments.senior, modelId: "gpt-6-sol" } } }, configuration.revision);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends[1].selection.modelId, "gpt-6-astra"); assert.equal(f.helperCalls(), 1);
});

for (const revoked of ["unavailable", "replaced", "actor"]) test(`review rechecks the original ${revoked} access after an outcome and again on explicit resume`, async t => {
  let available = true;
  const f = await fixture(t, undefined, { resolveAssistantUser: async user => {
    if (!available && user.username === "original-member") throw new Error("Submitting member removed");
    return user;
  } });
  f.context.vibe64User = { role: "member", username: "original-member" };
  f.connections.set("codex:openai", { ownerOnly: false });
  await f.service.send("session-1", request, f.context); await report(f, "handoff");
  if (revoked === "actor") available = false;
  else f.connections.set("codex:openai", revoked === "unavailable" ? { available: false, ownerOnly: false } : { ownerOnly: false, connectionIdentity: "replaced" });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.sends.length, 1);
  f.context.vibe64User = { role: "owner", username: "owner" };
  await assert.rejects(f.restart().send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context));
  assert.equal(f.sends.length, 1); assert.equal(f.state().submittedBy.username, "original-member");
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
    const { workPlanPath } = await import("../../packages/vibe64-terminals/src/server/assistantWorkPlan.js");
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
  if (final !== "archive-failure") assert.equal((await readWorkPlanHistory(f.context)).length, 0);
  else assert.match(f.state().error, /could not be archived/);
});

test("the bound plan helper returns workflow identity without a plan and forwards an outcome through the existing owner", async t => {
  const { createAgentSessionCommandService } = await import("../../packages/vibe64-terminals/src/server/agentSessionCommand.js");
  const f = await fixture(t, undefined, { readyPlan: false });
  // The initial classifier fixture's visible conversation still supplies context.
  await f.service.send("session-1", request, f.context);
  f.context.runtime.store.readSessionSourceDescriptor = async () => ({ metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: `${f.context.runtime.stateRoot}/sessions/active/session-1/source` } });
  const calls = [];
  const commands = createAgentSessionCommandService({ projectService: {
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
