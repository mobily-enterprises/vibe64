import assert from "node:assert/strict";
import test from "node:test";
import { fixture, planCommands, reportOutcome } from "../fixtures/assistantRouting.js";
import { handActionOver } from "../../packages/vibe64-terminals/src/server/assistantActHandoff.js";

// A turn that may only answer (Router's conversation) or only plan, asked to act, hands the request on with
// `vibe64-helper plan act` instead of refusing it or telling the person to do it themselves: when the turn ends, the
// same request continues as an implementation turn, with no new message from the person. An Auto chat's Senior once
// ended with "1. Should I open an issue in the dependency's tracker ...? Recommended: yes."; Router took the person's
// "YES!!!" for conversation, and its turn said it could not file the issue from there.
const accepted = { messageId: "request-1", message: "YES!!!", submissionKind: "send" };
const end = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
const noticeTexts = f => [...f.notices.values()].map(turn => turn.system.text);
const routed = (f, decision) => { f.router.respond = async () => ({ ok: true, text: JSON.stringify(decision) }); };

/** The acting turn after a handoff: the same request, no new message from the person, its role's implementation turn. */
function assertActingTurn(f, send, { role, from }) {
  assert.equal(send.selection.modelId, f.assignments[role].modelId);
  assert.equal(send.input.turnMetadata.actor, "app", "Vibe64 sends it: the person asked once");
  assert.equal(send.input.turnMetadata.assistantRouting.reason, "implementation");
  assert.equal(send.input.turnMetadata.assistantRouting.parentMessageId, accepted.messageId, "the same request");
  const label = role === "junior" ? "Junior" : "Senior";
  assert.equal(send.input.displayMessage, `${label} does what you asked.`);
  assert.match(send.input.message, new RegExp(`^\\[Vibe64 role: ${label}\\.`, "u"));
  assert.match(send.input.message, /Do what I asked: my latest message asks you to act: it accepts your own offer or recommendation to act, or it authorises or asks for the action\./u);
  assert.match(send.input.message, /Do exactly the action I accepted or asked for, from my request and the conversation, and nothing more/u);
  assert.ok(send.input.message.includes(`Original request: ${accepted.message}`), "the acting turn gets the person's request");
  assert.ok(send.input.message.includes(`The previous turn (${from.label}) could only ${from.could} and handed this request on without acting.`),
    send.input.message);
  assert.match(send.input.message, /Auto workflow stage: implementation\./u, "an implementation workflow turn, which reports its outcome");
  assert.doesNotMatch(send.input.message, /Answer or investigate the user's question|vibe64-helper plan act\b/u, "no read-only instruction");
  assert.deepEqual([f.state().messageId, f.state().resolvedMode, f.state().reason, f.state().stage, f.state().status, f.state().workflow],
    [accepted.messageId, role, "implementation", "implementation", "working", true]);
  assert.equal(f.state().actHandoff, undefined, "the handoff is used once");
  assert.ok(noticeTexts(f).includes(`${label} is doing what you asked.`), noticeTexts(f).join("\n"));
}

for (const role of ["junior", "senior"]) {
  test(`an Auto conversation turn (${role}) asked to act hands the request on, and it continues as ${role}'s implementation turn without the person asking again`, async t => {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
    routed(f, { mode: role, reason: "conversation" });
    await f.service.send("session-1", accepted, f.context);
    assert.equal(f.sends.length, 1);
    assert.equal(f.state().reason, "conversation");
    // The conversation turn's guidance hands an action on instead of refusing it.
    assert.match(f.sends[0].input.message, /do nothing yourself: run vibe64-helper plan act and end your turn with one short line saying the work starts now/u);
    assert.match(f.sends[0].input.message, /never refuse it, and never tell the person to do it themselves or to ask again/u);
    const { plan } = await planCommands(f);
    const handed = await plan({ operation: "act" });
    assert.equal(handed.handedTo, "implementation");
    assert.match(handed.message, /Vibe64 continues this request in a turn that may act as soon as yours ends\. Do nothing yourself: end your turn now with one short line saying the work starts now\./u);
    assert.deepEqual(Object.keys(f.state().actHandoff).sort(), ["reason", "role", "turnId"]);
    assert.equal(f.state().actHandoff.turnId, f.state().turnId);
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.equal(f.sends.length, 2, "the acting turn follows without a new message");
    assert.equal(f.helperCalls(), 1, "and without a second routing");
    assertActingTurn(f, f.sends[1], { role, from: { label: role === "junior" ? "Junior" : "Senior", could: "answer" } });
    // It is an ordinary implementation turn: its finished work ends the request.
    await reportOutcome(f, "handoff", { explanation: "Opened the issue in the dependency's tracker." });
    f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: f.state().followup.messageId, text: "Junior does what you asked." },
      assistant: { text: "Opened the issue." }, messages: [{ role: "assistant", text: "Opened the issue." }] }];
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.equal(f.state().status, "complete");
    assert.equal(f.sends.length, 2);
  });
}

test("an Auto planning turn asked to act too hands the request on after saving the plan, and Junior's implementation turn follows", async t => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  routed(f, { mode: "senior", reason: "planning" });
  await f.service.send("session-1", { ...accepted, message: "Make the plan and implement it" }, f.context);
  assert.equal(f.state().stage, "planning");
  assert.match(f.sends[0].input.message, /save the plan change it asks for first, then run vibe64-helper plan act instead of reporting an outcome/u);
  const { plan } = await planCommands(f);
  await plan({ operation: "new", text: "# Contact threads\n\n- [ ] One thread per contact\n" });
  assert.equal((await plan({ operation: "act" })).handedTo, "implementation");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2);
  const send = f.sends[1];
  assert.equal(send.selection.modelId, f.assignments.junior.modelId, "implementation after planning is Junior's in Auto");
  assert.ok(send.input.message.includes("The previous turn (Senior) could only plan and handed this request on without acting."), send.input.message);
  assert.ok(send.input.message.includes("Original request: Make the plan and implement it"));
  assert.deepEqual([f.state().resolvedMode, f.state().reason, f.state().stage, f.state().workflow], ["junior", "implementation", "implementation", true]);
  assert.equal(f.state().actHandoff, undefined);
});

test("a turn that may act already refuses plan act, and nothing is handed on", async t => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  routed(f, { mode: "junior", reason: "implementation" });
  await f.service.send("session-1", accepted, f.context);
  assert.doesNotMatch(f.sends[0].input.message, /vibe64-helper plan act\b/u, "an acting turn is never told about it");
  const { plan } = await planCommands(f);
  await assert.rejects(plan({ operation: "act" }), (error) => {
    assert.equal(error.code, "vibe64_work_act_handoff_unavailable");
    assert.match(error.message, /^Only a turn that may only answer or only plan hands its request on with plan act; this turn may act itself: do what the person asked here, within its instructions\./u);
    return true;
  });
  assert.equal(f.state().actHandoff, undefined);
});

test("a stopped turn hands its action on to no one", async t => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  routed(f, { mode: "junior", reason: "conversation" });
  await f.service.send("session-1", accepted, f.context);
  const { plan } = await planCommands(f);
  await plan({ operation: "act" });
  assert.equal(await f.service.cancel("session-1", f.context), false);
  await f.service.afterTurn("session-1", end(f.state(), "interrupted"), f.context);
  assert.equal(f.sends.length, 1, "Stop means stop: no acting turn");
  assert.equal(f.state().stopped, true); assert.equal(f.state().stage, null);
});

test("a turn that hands its plan request to Senior and its action on too goes to Senior's planning turn, which decides the action", async t => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  routed(f, { mode: "junior", reason: "conversation" });
  await f.service.send("session-1", { ...accepted, message: "ok make the plan and build it" }, f.context);
  const { plan } = await planCommands(f);
  await plan({ operation: "handoff" });
  await plan({ operation: "act" });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].input.displayMessage, "Senior makes the plan.");
  assert.deepEqual([f.state().resolvedMode, f.state().stage], ["senior", "planning"]);
  assert.equal(f.state().actHandoff, undefined, "the planning turn hands the action on itself once the plan is saved");
});

test("a plan's pass, a task and the plan check hand nothing on with plan act; Vibe64's note on passes the person asked for may", async () => {
  const calls = [];
  const handActionOn = async (_id, input) => { calls.push(input); return { ok: true }; };
  const running = { messageId: "request-1", turnId: "turn-1", status: "working", delivery: "accepted", mode: "auto", resolvedMode: "senior" };
  const refused = async (request, pattern) => {
    await assert.rejects(handActionOver({ sessionId: "session-1", request, handActionOn }), (error) => {
      assert.equal(error.code, "vibe64_work_act_handoff_unavailable");
      assert.match(error.message, pattern);
      return true;
    });
  };
  const mayAct = /^Only a turn that may only answer or only plan hands its request on with plan act/u;
  await refused({ ...running, reason: "review", stage: "pass", pass: { id: "ui-pass" } }, mayAct);
  await refused({ ...running, reason: "review", stage: null, task: "deslop" }, mayAct);
  await refused({ ...running, reason: "planning", stage: "planning", followup: { planCheck: true } },
    /^This turn only brings the plan up to date with the turn before it, and hands nothing on: do what its note asks\./u);
  assert.deepEqual(calls, []);
  // A Senior chat's note on passes it can't run yet is a turn that may only answer.
  const noted = await handActionOver({ sessionId: "session-1", handActionOn,
    request: { ...running, mode: "senior", reason: "conversation", stage: null, planPassNote: "The plan has no pass left to run." } });
  assert.equal(noted.handedTo, "implementation");
  assert.deepEqual(calls, [{ messageId: "request-1", turnId: "turn-1" }]);
});
