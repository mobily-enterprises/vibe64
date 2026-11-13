import assert from "node:assert/strict";
import test from "node:test";
import { fixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { assistantRoutingOutcomeNotice, assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";

// An Auto request Router classes as conversation is not a workflow: its turn is
// asked for no outcome and no save line, and Vibe64 records how it ended. Every
// Senior, Junior or Custom turn, and an Auto request classed as implementation,
// is a workflow turn that reads its identity and reports an outcome before its
// final reply: two tool calls, each answered by one more model request.
const OUTCOME_CALL = /report one outcome through vibe64-helper plan outcome/u;
const SAVE_LINE = /Vibe64 saves this work automatically|the person saves finished work with the Save button/u;
const ended = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
const question = "What does the form validate?";

async function conversation(t, { role = "junior", preferences = { mode: "auto", review: true, autoSave: true } } = {}) {
  const f = await fixture(t, preferences, { readyPlan: false });
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: role, reason: "conversation" }) });
  await f.service.send("session-1", { messageId: "request-1", message: question, submissionKind: "send" }, f.context);
  return f;
}

// A Senior, Junior or Custom request's first turn that only answers reports nothing.
const ANSWERS_REPORT_NOTHING = /If you only answer this request, or finish it without changing any files or plan, and no decision waits on the person, report no outcome/u;

/** The model requests and tool calls an answer costs, as its turn's instructions ask for them. */
function turnCost(f) {
  const message = f.sends.at(-1).input.message;
  const outcomeCalls = OUTCOME_CALL.test(message) && !ANSWERS_REPORT_NOTHING.test(message) ? 2 : 0; // plan read, then plan outcome
  return { routerRequests: f.helperCalls(), turns: f.sends.length, outcomeCalls };
}

for (const role of ["junior", "senior"]) test(`an Auto conversation turn for ${role} asks for no outcome and no save line, and ends complete with no Status message`, async t => {
  const f = await conversation(t, { role });
  const state = f.state();
  assert.equal(state.workflow, false); assert.equal(state.stage, null); assert.equal(state.reason, "conversation");
  const message = f.sends[0].input.message;
  assert.doesNotMatch(message, OUTCOME_CALL); assert.doesNotMatch(message, /Auto workflow stage/u); assert.doesNotMatch(message, SAVE_LINE);
  assert.deepEqual(turnCost(f), { routerRequests: 1, turns: 1, outcomeCalls: 0 });
  await f.service.afterTurn("session-1", ended(state), f.context);
  assert.equal(f.state().status, "complete");
  assert.equal(f.notices.size, 0, "no Status message is written");
  assert.equal(assistantRoutingOutcomeNotice(f.state()), null, "and none is projected");
  assert.equal(f.sends.length, 1);
});

test("an Auto conversation turn cannot report an outcome: the report is refused and the turn still ends complete", async t => {
  const f = await conversation(t);
  await assert.rejects(reportOutcome(f, "complete"), { code: "vibe64_assistant_workflow_outcome_mismatch" });
  assert.equal(f.state().outcome, undefined);
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  assert.equal(f.state().status, "complete"); assert.equal(f.notices.size, 0);
});

for (const result of ["failed", "interrupted"]) test(`an Auto conversation turn that ${result} waits, with no Status message`, async t => {
  const f = await conversation(t);
  await f.service.afterTurn("session-1", ended(f.state(), result), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.notices.size, 0); assert.equal(f.sends.length, 1);
});

test("an Auto conversation turn is not carried into the next request's finishing turn", async t => {
  const f = await conversation(t);
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "junior", reason: "implementation" }) });
  await f.service.send("session-1", { messageId: "request-2", message: "Add the required-name check.", submissionKind: "send" }, f.context);
  const work = f.state();
  assert.equal(work.workflow, true); assert.equal(work.stage, "implementation");
  assert.deepEqual(work.unreviewed, [], "the conversation is not listed as unreviewed work");
  assert.match(f.sends[1].input.message, OUTCOME_CALL, "the work request reports its outcome as before");
  assert.equal(f.helperCalls(), 2, "Router classifies each new request");
});

const customOverride = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai",
  modelId: "gpt-6-astra", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
for (const mode of ["senior", "junior", "custom"]) test(`a ${mode} chat's question is a workflow turn that reports an outcome and shows it as a Status message`, async t => {
  const f = await fixture(t, { mode, review: true, autoSave: true, ...(mode === "custom" ? { override: customOverride } : {}) }, { readyPlan: false });
  await f.service.send("session-1", { messageId: "request-1", message: question, submissionKind: "send" }, f.context);
  const message = f.sends[0].input.message;
  assert.match(message, OUTCOME_CALL); assert.match(message, SAVE_LINE);
  assert.deepEqual(turnCost(f), { routerRequests: 0, turns: 1, outcomeCalls: 2 });
  await reportOutcome(f, "complete", { explanation: "Nothing in the app was changed, so there's nothing to save." });
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: "request-1", text: question },
    assistant: { text: "It checks the name." }, messages: [{ role: "assistant", text: "It checks the name." }] }];
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  assert.equal(f.state().status, "complete");
  assert.match(assistantRoutingOutcomeNotice(f.state()).text, /^Finished\.\n\nNothing in the app was changed/u, "the client shows it under Workflow details");
});

test("an Auto request Router classed as implementation reports an outcome, and Junior cannot report complete", async t => {
  const f = await fixture(t, { mode: "auto", review: true, autoSave: true }, { readyPlan: false });
  await f.service.send("session-1", { messageId: "request-1", message: question, submissionKind: "send" }, f.context);
  assert.deepEqual(turnCost(f), { routerRequests: 1, turns: 1, outcomeCalls: 2 });
  await assert.rejects(reportOutcome(f, "complete"), { code: "vibe64_assistant_workflow_completion_senior_only" });
});

// Senior, Junior and Custom: a chat's own agent works without Router, and each
// request is a workflow from its first turn.
const DIRECT_MODES = ["senior", "junior", "custom"];
const STATUS_PREFIX = "assistant-routing-outcome:";
const askingQuestion = "The form checks the name.\n\n[1] Shall I also check the email?\nPossible answers:\n- Yes, check it\n- Not now";

async function direct(t, mode, { message = question, switches = {} } = {}) {
  const saves = [];
  const f = await fixture(t, { mode, review: true, deslop: true, uiPass: false, autoSave: true,
    ...(mode === "custom" ? { override: customOverride } : {}), ...switches }, {
    readyPlan: false,
    onPlanCompleted: async () => { saves.push(saves.length); return "Saved automatically."; }
  });
  await f.service.send("session-1", { messageId: "request-1", message, submissionKind: "send" }, f.context);
  return Object.assign(f, { saves });
}

/** The turn's reply, as the chat saved it under the message that started the turn. */
function replied(f, text = "It checks the name.", messages = [{ role: "assistant", text }]) {
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: question },
    assistant: { text }, messages }];
}

const statusMessages = f => [...f.notices.keys()].filter(id => id.startsWith(STATUS_PREFIX));

for (const mode of DIRECT_MODES) test(`a ${mode} chat's answer that reports nothing ends complete with no Status message, no finishing step and no save`, async t => {
  const f = await direct(t, mode);
  replied(f);
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  const state = f.state();
  assert.equal(state.status, "complete"); assert.equal(state.error, undefined); assert.equal(state.outcome, undefined);
  assert.deepEqual(statusMessages(f), []); assert.equal(assistantRoutingOutcomeNotice(state), null, "none is shown in chat");
  assert.equal(f.notices.size, 0, "no finishing step starts"); assert.deepEqual(f.saves, []);
  assert.equal(f.sends.length, 1); assert.equal(assistantRoutingStatusLabel(state), "Reply finished.");
});

for (const mode of DIRECT_MODES) test(`a ${mode} chat's unreported answer is covered by the next finishing turn, so its possible changes are reviewed and saved`, async t => {
  const f = await direct(t, mode);
  replied(f);
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  await f.service.send("session-1", { messageId: "request-2", message: "Add the required-name check.", submissionKind: "send" }, f.context);
  assert.deepEqual(f.state().unreviewed, [{ messageId: "request-1", message: question }]);
  await reportOutcome(f, "handoff");
  replied(f, "Added the check and its tests.");
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  assert.equal(f.state().stage, "review"); assert.equal(f.sends.length, 3);
  assert.match(f.sends[2].input.message, /Earlier requests whose changes no automatic review has covered yet; cover their changes too: .*request-1/u);
  await reportOutcome(f, "complete");
  replied(f, "Reviewed and deslopped.");
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  assert.equal(f.state().status, "complete"); assert.deepEqual(f.saves, [0], "Save runs once, after the finishing turn");
});

for (const mode of DIRECT_MODES) for (const reported of ["", "wait", "continue"]) test(`a ${mode} chat's question to the person waits for the answer${reported ? `, with ${reported} reported` : ", with nothing reported"}`, async t => {
  const f = await direct(t, mode);
  if (reported) await reportOutcome(f, reported);
  replied(f, askingQuestion);
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  const state = f.state();
  assert.equal(state.status, "waiting"); assert.equal(state.awaitingAnswer, true);
  assert.equal(state.error, "Waiting for your answer. Reply in chat to continue.");
  assert.equal(f.sends.length, 1, "no turn starts before the person answers"); assert.deepEqual(f.saves, []);
});

for (const mode of DIRECT_MODES) for (const result of ["failed", "interrupted"]) test(`a ${mode} chat's first turn that ${result} without an outcome waits to continue, never complete`, async t => {
  const f = await direct(t, mode);
  replied(f);
  await f.service.afterTurn("session-1", ended(f.state(), result), f.context);
  const state = f.state();
  assert.equal(state.status, "waiting"); assert.equal(state.stage, "implementation");
  assert.match(state.error, new RegExp(`The implementation turn ${result}`, "u"));
  assert.equal(state.delivery, "pending", "Continue implementation is offered"); assert.equal(f.sends.length, 1);
});

for (const mode of DIRECT_MODES) test(`a ${mode} chat's Stop leaves its answer waiting, and its changes fold into the next request`, async t => {
  const f = await direct(t, mode);
  await f.service.cancel("session-1", f.context);
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  assert.equal(f.state().status, "waiting"); assert.equal(f.state().stopped, true); assert.deepEqual(f.saves, []);
  await f.service.send("session-1", { messageId: "request-2", message: "Add the required-name check.", submissionKind: "send" }, f.context);
  assert.deepEqual(f.state().unreviewed.map(({ messageId }) => messageId), ["request-1"]);
});

for (const mode of DIRECT_MODES) for (const result of ["completed", "interrupted"]) test(`a ${mode} chat's answer whose turn ${result} across a restart settles once, without resending`, async t => {
  const f = await direct(t, mode);
  replied(f);
  f.context.session.agentRuns = [{ id: "codex_app_server", state: result, turnId: f.state().turnId }];
  await f.restart().reconcile("session-1", f.context);
  assert.equal(f.state().status, result === "completed" ? "complete" : "waiting");
  assert.deepEqual(statusMessages(f), []); assert.equal(f.sends.length, 1);
});

for (const mode of DIRECT_MODES) test(`a ${mode} chat's follow-up and finishing turns keep reporting their outcomes`, async t => {
  const f = await direct(t, mode, { message: "Add the required-name check." });
  await reportOutcome(f, "continue");
  replied(f, "Added the check; its tests are next.");
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  const continuing = f.sends[1].input.message;
  assert.match(continuing, OUTCOME_CALL); assert.doesNotMatch(continuing, ANSWERS_REPORT_NOTHING);
  assert.match(continuing, /During implementation, complete means you answered or finished without changing any files/u, "a follow-up turn keeps today's wording");
  await reportOutcome(f, "handoff");
  replied(f, "Added the tests.");
  await f.service.afterTurn("session-1", ended(f.state()), f.context);
  const finishing = f.sends[2].input.message;
  assert.equal(f.state().stage, "review"); assert.match(finishing, OUTCOME_CALL); assert.doesNotMatch(finishing, ANSWERS_REPORT_NOTHING);
});
