import assert from "node:assert/strict";
import test from "node:test";
import { fixture, reportOutcome } from "../fixtures/assistantRouting.js";

// A live Senior chat's case (28 Nov): the person steered the plan's implementation turn, and while the steer was
// being sent the engine stopped that turn because the signed-in account had changed ("claude-interrupted", 1 s
// after the message), then started the steer as a turn of its own ("claude-starting", 13 s later). Routing filed the
// message as a steer of the plan's request, kept the stopped turn's id, and settled the request as "The
// implementation turn interrupted. Resume when ready.", so nothing moved the plan on when the new turn ended, and
// every later steer joined a request that was waiting.

const request = { messageId: "request-1", message: "Execute the plan", submissionKind: "send" };
const steer = { messageId: "steer-1", message: "How much work is left on item 6?", submissionKind: "steer" };
const ACCOUNT_CHANGED = "The signed-in Claude account changed.";
const end = (turnId, state = "completed", error = "") =>
  ({ payload: { agentRun: { active: false, state, error, providerTurnId: turnId } } });
const running = (turnId) => async () => ({ turn: { active: true, id: turnId } });
const idle = async () => ({ turn: { active: false } });

/** A Senior chat implementing its plan: the request's own turn, turn-1, is running. */
async function implementing(t) {
  const f = await fixture(t, { mode: "senior" });
  await f.service.send("session-1", request, f.context);
  const state = f.state();
  assert.deepEqual([state.status, state.stage, state.workflow, state.turnId], ["working", "implementation", true, "turn-1"]);
  f.agent.sessionState = running("turn-1");
  return f;
}

/** The steered turn reports continue and ends: the plan's next implementation turn starts by itself, once. */
async function assertPlanGoesOn(f) {
  assert.deepEqual([f.state().status, f.state().delivery, f.state().turnId], ["working", "accepted", "turn-2"],
    f.state().error);
  assert.equal(f.state().error, undefined);
  assert.equal(f.state().followup, undefined, "nothing waits for Continue");
  assert.deepEqual(f.state().steering.map(({ messageId }) => messageId), ["steer-1"]);
  await reportOutcome(f, "continue", { involved: true });
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-2"), f.context);
  assert.equal(f.sends.length, 3, "the plan's next turn");
  assert.equal(f.sends[2].input.displayMessage, "Continue implementation.");
  assert.deepEqual([f.state().status, f.state().turnId], ["working", "turn-3"]);
  // The stopped turn's end, and the steered turn's, published again: nothing continues twice.
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  await f.service.afterTurn("session-1", end("turn-2"), f.context);
  assert.equal(f.sends.length, 3);
}

test("a steer the engine started as its own turn, after stopping the plan's turn for an account change, is that step's turn: the plan goes on when it ends", async (t) => {
  const f = await implementing(t);
  // The steer is being sent, under the lock, when the engine stops turn-1; its end waits for the lock.
  const held = f.holdDispatch();
  f.deliverNextAs({ deliveryMode: "new_turn" });
  const steered = f.service.send("session-1", steer, f.context);
  await held.started;
  f.agent.sessionState = idle;
  const stopped = f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  held.release();
  await Promise.all([steered, stopped]);
  f.agent.sessionState = running("turn-2");
  await assertPlanGoesOn(f);
});

test("a steer sent while a Save holds the lock, which the engine started as its own turn, is that step's turn as well", async (t) => {
  const f = await implementing(t);
  const save = f.holdLock({ whileAssistantWorks: true });
  await save.started;
  f.deliverNextAs({ deliveryMode: "new_turn" });
  let stopped;
  try {
    // The steer goes to the engine without the lock; the stopped turn's end waits for the Save.
    await f.service.send("session-1", steer, f.context);
    f.agent.sessionState = idle;
    stopped = f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  } finally {
    save.release();
  }
  await stopped;
  f.agent.sessionState = running("turn-2");
  await assertPlanGoesOn(f);
});

test("a request its stopped turn's end already settled takes the steer's own turn as well", async (t) => {
  const f = await implementing(t);
  // turn-1's end is decided between the steer's admission, which saw turn-1 running, and its dispatch.
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.deepEqual([f.state().status, f.state().delivery, f.state().error],
    ["waiting", "pending", "The implementation turn interrupted. Resume when ready."]);
  f.deliverNextAs({ deliveryMode: "new_turn" });
  await f.service.send("session-1", steer, f.context);
  f.agent.sessionState = running("turn-2");
  await assertPlanGoesOn(f);
});

test("a request the person stopped while the steer was sent stays paused when the steer starts its own turn", async (t) => {
  const f = await implementing(t);
  const held = f.holdDispatch();
  f.deliverNextAs({ deliveryMode: "new_turn" });
  const steered = f.service.send("session-1", steer, f.context);
  await held.started;
  // The person's Stop, as it leaves the request.
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), stopped: true, status: "waiting",
    error: "Paused at your request." });
  held.release();
  await steered;
  assert.deepEqual([f.state().stopped, f.state().status, f.state().turnId, f.state().error],
    [true, "waiting", "turn-1", "Paused at your request."]);
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-2"), f.context);
  assert.equal(f.sends.length, 2, "nothing continues a stopped plan");
  assert.equal(f.state().error, "Paused at your request.");
});

test("a steer that joins the running turn leaves the request's turn as it is", async (t) => {
  const f = await implementing(t);
  f.deliverNextAs({ deliveryMode: "steer", turnId: "turn-1" });
  await f.service.send("session-1", steer, f.context);
  assert.deepEqual([f.state().status, f.state().turnId], ["working", "turn-1"]);
  assert.deepEqual(f.state().steering.map(({ messageId }) => messageId), ["steer-1"]);
});
