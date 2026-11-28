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
const RESUME = "Continue after the interruption.";
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
  assert.ok(!f.sends.some(({ input }) => input.displayMessage === RESUME), "no resume on top of the steer's turn");
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

test("a request its replaced turn's end already settled takes the steer's own turn as well", async (t) => {
  const f = await implementing(t);
  // turn-1's end, interrupted with nothing to say, is decided between the steer's admission, which saw turn-1
  // running, and its dispatch.
  await f.service.afterTurn("session-1", end("turn-1", "interrupted"), f.context);
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

const noticeTexts = (f) => [...f.notices.values()].map((turn) => turn.system.text);

test("a plan turn its engine stopped with a reason of its own resumes at once, as after a restart, instead of waiting for Resume", async (t) => {
  const f = await implementing(t);
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.equal(f.sends.length, 2, f.state().error);
  assert.equal(f.sends[1].input.displayMessage, "Continue after the interruption.");
  assert.deepEqual([f.state().status, f.state().delivery, f.state().turnId], ["working", "accepted", "turn-2"]);
  assert.equal(f.state().interruptions.at(-1).cause, "engine");
  const notice = noticeTexts(f).find((text) => text.includes(ACCOUNT_CHANGED));
  assert.match(notice, /^The AI engine stopped at \d\d:\d\d UTC: The signed-in Claude account changed\.\nResumed/u);
  // The same end published again resumes nothing twice.
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.equal(f.sends.length, 2);
});

test("a plan turn the person stopped stays paused whatever else ended it", async (t) => {
  const f = await implementing(t);
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), stopped: true });
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.equal(f.sends.length, 1);
  assert.deepEqual([f.state().status, f.state().error], ["waiting", "Paused at your request."]);
});

test("the stopped turn's end decided before the steer is sent resumes the step once, and the steer joins that resumed turn", async (t) => {
  const f = await implementing(t);
  // turn-1's end is decided between the steer's admission, which saw turn-1 running, and its dispatch: the resume
  // goes first, and the steer reaches the engine while the resumed turn runs, so it joins that turn.
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.deepEqual([f.sends.length, f.sends[1].input.displayMessage, f.state().turnId], [2, RESUME, "turn-2"]);
  f.agent.sessionState = running("turn-1");
  f.deliverNextAs({ deliveryMode: "steer", turnId: "turn-2" });
  await f.service.send("session-1", steer, f.context);
  assert.deepEqual([f.state().status, f.state().delivery, f.state().turnId], ["working", "accepted", "turn-2"]);
  assert.deepEqual(f.state().steering.map(({ messageId }) => messageId), ["steer-1"]);
  f.agent.sessionState = running("turn-2");
  await reportOutcome(f, "continue", { involved: true });
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-2"), f.context);
  assert.equal(f.sends.length, 4, "the plan's next turn, once");
  assert.equal(f.sends[3].input.displayMessage, "Continue implementation.");
  assert.equal(f.sends.filter(({ input }) => input.displayMessage === RESUME).length, 1);
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  await f.service.afterTurn("session-1", end("turn-2"), f.context);
  assert.equal(f.sends.length, 4);
});

// 28 Nov, 12:05: the person switched the workspace's Claude account while the plan's implementation turn ran. The
// engine stopped the turn for it, and every resume of the plan's request, Vibe64's own and the person's Continue, was
// refused: "The selected AI connection changed. Cancel this request and send it again." The request kept the
// connection it was admitted on, though Main chat and a goal follow the account connected now.
const switchAccount = (f, change) => {
  const { engineId, modelProviderId } = f.assignments.senior;
  f.connections.set(`${engineId}:${modelProviderId}`, { connectionIdentity: "replacement-account", ...change });
};
const seniorConnection = (f) => (f.state().decision.seniorJuniorPair?.senior ?? f.state().decision).connectionIdentity;

test("a plan turn the engine stopped because the signed-in account changed resumes on the account connected now", async (t) => {
  const f = await implementing(t);
  switchAccount(f);
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.equal(f.sends.length, 2, f.state().error);
  assert.equal(f.sends[1].input.displayMessage, RESUME);
  assert.deepEqual([f.state().status, f.state().delivery, f.state().turnId], ["working", "accepted", "turn-2"]);
  assert.equal(seniorConnection(f), "replacement-account", "the request now holds to the account connected now");
});

test("a plan's request whose new account cannot be used waits, and Continue resumes it once the account can be", async (t) => {
  const f = await implementing(t);
  switchAccount(f, { available: false });
  f.agent.sessionState = idle;
  await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  assert.equal(f.sends.length, 1, "an account the request's person cannot use sends nothing");
  assert.equal(f.state().status, "waiting");
  assert.ok(f.state().followup?.messageId, "Continue has the prepared resume to send");
  switchAccount(f);
  await f.service.send("session-1", { ...request, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2, f.state().error);
  assert.equal(f.sends[1].input.displayMessage, RESUME);
  assert.equal(f.state().status, "working");
  assert.equal(seniorConnection(f), "replacement-account");
});
