import assert from "node:assert/strict";
import test from "node:test";
import { fixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { assistantRoutingOutcomeNotice } from "@local/vibe64-runtime/shared/assistantRouting";

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

/** The model requests and tool calls one turn costs, as its instructions ask for them. */
function turnCost(f) {
  const message = f.sends.at(-1).input.message;
  const outcomeCalls = OUTCOME_CALL.test(message) ? 2 : 0; // plan read, then plan outcome
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
