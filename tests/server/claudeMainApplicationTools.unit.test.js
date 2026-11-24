import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// Claude in Main chat uses the application's actions (its application tools) in every turn it runs for a person: the
// person's own turns and Continue, and the turns Vibe64 sends for them (a workflow's next step, a turn resumed after a
// restart, a project message). Each acts as that person with their current access, so a person the assistant host
// no longer resolves gets no action. Claude is the goal harness's stand-in (claudeGoalTestHelpers.js): a message naming
// APP-TOOLS has it search the application's actions, and REPORT-CONTINUE has it report that more work remains, then,
// in the step Vibe64 sends for that, that it waits for the person.

/** Every application tool call Main chat's turns recorded, in order. */
async function toolCalls(h) {
  return (await h.store.readConversationLog("test")).flatMap(turn => turn.metadata?.applicationTools || []);
}

const routing = async h => assistantRoutingRequestForDisplay((await h.store.readSession("test")).metadata);

/** The first `count` recorded calls, once each has ended. */
function settledCalls(h, count) {
  return h.waitFor(async () => {
    const calls = await toolCalls(h);
    return calls.length >= count && calls.slice(0, count).every(call => call.status !== "running") ? calls : null;
  }, async () => JSON.stringify({ calls: await toolCalls(h), request: await routing(h), warnings: h.warnings.slice(-8) }), 30_000);
}

function assertSucceeded(call, label) {
  assert.equal(call?.status, "complete", `${label}: ${JSON.stringify(call)}`);
  assert.equal(call.result?.ok, true, `${label}: ${JSON.stringify(call)}`);
}

function waitingRequest(h) {
  return h.waitFor(async () => {
    const request = await routing(h);
    return request?.status === "waiting" ? request : null;
  }, async () => JSON.stringify({ request: await routing(h), warnings: h.warnings.slice(-8) }));
}

async function interruptionNotices(h) {
  return (await h.store.readConversationLog("test")).filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:"));
}

test("Claude's application tools work in the person's turn, in the Continue implementation turn Vibe64 sends after it, and after the person's Continue", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.routeAsSenior();
    const message = "APP-TOOLS REPORT-CONTINUE: tidy the report";
    const sent = await h.sendAsPerson({ messageId: "person-request", message });
    assert.notEqual(sent.ok, false, JSON.stringify(sent));
    // The person's turn reports that more work remains, so Vibe64 sends the next step itself, for them.
    const [own, next] = await settledCalls(h, 2);
    assertSucceeded(own, "the person's turn");
    assertSucceeded(next, "the Continue implementation turn Vibe64 sent");
    const turnOf = async call => (await h.store.readConversationLog("test"))
      .find(turn => (turn.metadata?.applicationTools || []).some(made => made.id === call.id));
    assert.equal((await turnOf(own))?.user?.messageId, "person-request");
    const nextTurn = await turnOf(next);
    assert.ok(nextTurn?.user?.messageId && nextTurn.user.messageId !== "person-request", JSON.stringify(nextTurn?.user));
    // That step waits for the person; their Continue sends the work on, and the step after it is Vibe64's once more.
    const waiting = await waitingRequest(h);
    assert.equal(waiting.messageId, "person-request");
    const continued = await h.sendAsPerson({ messageId: "person-request", message, reviewAction: "retry" });
    assert.notEqual(continued.ok, false, JSON.stringify(continued));
    const calls = await settledCalls(h, 4);
    assertSucceeded(calls[2], "the turn the person's Continue sent");
    assertSucceeded(calls[3], "the step Vibe64 sent after the Continue");
    await waitingRequest(h);
    assert.deepEqual(await interruptionNotices(h), [], "no turn was interrupted");
  });
});

test("a turn Vibe64 resumes after a restart runs Claude's application tools as the person it ran for", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.routeAsSenior();
    const sent = await h.sendAsPerson({ messageId: "long-request", message: "Keep working on the report, using APP-TOOLS" });
    assert.notEqual(sent.ok, false, JSON.stringify(sent));
    await h.waitFor(() => h.turnActive(), "Claude works on the turn");
    await h.restart();
    const recovery = await h.service.recoverInterruptedTurns({ retryDelaysMs: [] });
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    const [resumed] = await settledCalls(h, 1);
    assertSucceeded(resumed, "the resumed turn");
    const [notice] = await interruptionNotices(h);
    assert.equal(notice?.metadata?.vibe64TurnInterruption?.outcome, "resumed", JSON.stringify(notice));
  });
});

test("a turn Vibe64 sends for a person, as a project message, runs Claude's application tools as them, and none once they are no longer resolved", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    const sent = await h.service.sendAgentMessage("test", { message: "APP-TOOLS: a message from another project", messageId: "vibe64-send" }, h.options);
    assert.equal(sent.delivered, true, JSON.stringify(sent));
    const [allowed] = await settledCalls(h, 1);
    assertSucceeded(allowed, "the turn Vibe64 sent for the person");
    await h.waitFor(async () => !await h.turnActive(), "the turn ends");

    h.revokeAccess();
    const refusedSend = await h.service.sendAgentMessage("test", { message: "APP-TOOLS: another message", messageId: "vibe64-send-revoked" }, h.options);
    assert.equal(refusedSend.delivered, true, JSON.stringify(refusedSend));
    const frames = async () => (await h.trace()).map(row => row.frame).filter(Boolean);
    const asked = await h.waitFor(async () => (await frames()).find(frame => frame.type === "user" &&
      String(frame.message?.content).includes("another message")), "Claude receives the message");
    const id = `${asked.uuid}-search`;
    await h.waitFor(async () => !await h.turnActive(), "the turn ends");
    const answered = (await frames()).filter(frame => frame.type === "control_response" && frame.response?.request_id === id);
    assert.equal(answered.some(frame => frame.response.subtype === "success" &&
      !JSON.stringify(frame.response.response).includes('"isError":true')), false, JSON.stringify(answered));
    assert.equal((await toolCalls(h)).filter(call => call.id === id && call.result?.ok === true).length, 0);
  });
});
