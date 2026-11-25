import assert from "node:assert/strict";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { NO_SERVER_RUN } from "../../packages/vibe64-terminals/src/server/turnInterruptions.js";
import { requestWasWorking } from "../../packages/vibe64-terminals/src/server/serviceTurnRecovery.js";

// A live session's case, in Auto through the real routing service. Junior's turn built every item of the plan and
// handed it to Senior's review. A message from another session (delivered as the owner's message) had its own answer
// turn first: the review's delivery was refused because a turn was running, or because the conversation had changed
// since the handoff was decided, and nothing ever started Senior's review. The person's Continue was refused too: it
// sent the old handoff again. The plan sat built and unreviewed for an hour.
// A refusal that means only that another turn or message came first leaves the review owed: it is decided again once
// that turn ends, from the conversation and plan as they are then (or by the server's recovery, when it restarted
// first). A message of the person's own still holds it for them, Stop still ends it, and a busy lock at the turn's
// end never loses it. Another session's message never replaces it, and a step a restart cut off is decided the same
// way by the next server's recovery.

const PLAN = "Status: active\n# Contact threads\n\nGroup each contact's messages into one thread.\n\n" +
  "- [~] Store contact threads\n- [~] List a contact's threads\n- [~] Reply in a thread\n- [ ] Move old messages into threads\n\n" +
  "## Technical details\nsrc/threads.js holds the store; src/list.js, src/reply.js and src/migrate.js use it.\n";
const end = (turnId) => ({ payload: { agentRun: { active: false, state: "completed", providerTurnId: turnId } } });
// The other session's message and its answer, as the chat records them: the owner's message, marked as received
// from that session, then the reply.
const OTHER_TURN = "turn-other-session";
const otherSessionTurn = {
  user: { messageId: "other-session-1", text: "Is the threads change saved yet?" },
  metadata: { projectMessage: { sourceProject: "shop", sourceSession: "release", messageId: "other-session-1", direction: "received" } },
  messages: [{ role: "assistant", text: "Not yet: Senior reviews the plan next, then it is saved." }]
};
// A second message from that session, as it is sent and as the chat records it with its answer.
const SECOND_TURN = "turn-other-session-2";
const secondProjectMessage = { sourceProject: "shop", sourceSession: "release", messageId: "other-session-2", direction: "received" };
const secondSessionMessage = {
  messageId: "other-session-2",
  message: "From project shop (session release)\n\nIs Senior reviewing the threads plan yet?",
  displayMessage: "Is Senior reviewing the threads plan yet?",
  turnMetadata: { projectMessage: secondProjectMessage }
};
const secondSessionTurn = {
  user: { messageId: "other-session-2", text: "Is Senior reviewing the threads plan yet?" },
  metadata: { projectMessage: secondProjectMessage },
  messages: [{ role: "assistant", text: "Senior's review starts once this answer ends." }]
};
// The person's own message, which reached the chat in another turn, and its answer.
const personTurn = {
  user: { messageId: "person-1", text: "Hold on, I want to try the threads page myself first." },
  messages: [{ role: "assistant", text: "Sure: the threads page is at /threads." }]
};

/**
 * Implement plan in Auto; Junior's turn builds the last item, half-ticks it and hands the plan to Senior's review.
 * @param {import("node:test").TestContext} t
 * @param {object} [options] the routing fixture's options
 */
async function juniorBuildsEveryItem(t, options = {}) {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true, ...options });
  await publishPlanFixture(f.context, PLAN);
  const request = { messageId: "implement-1", message: "Implement the plan.", submissionKind: "send", planRevision: (await readWorkPlan(f.context)).revision };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, f.assignments.junior.modelId, "Junior implements");
  await f.source.commit("Move old messages into threads");
  const { plan, revisions } = await planCommands(f);
  await plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace("- [ ] Move", "- [~] Move"), ...await revisions() });
  await reportOutcome(f, "handoff", { involved: true, explanation: "Every item is built and half-ticked." });
  f.tail = [{ user: { messageId: request.messageId, text: request.message },
    messages: [{ role: "assistant", text: "Every item is built; Senior reviews the plan next." }] }];
  f.context.runtime.store.readConversationTail = async () => f.tail;
  return f;
}

/**
 * Senior's review of the plan is the request's next turn: the plan is never left built with nothing running it.
 * @param {object} f the routing fixture
 * @param {string} label
 * @param {number} [sends] the turns sent in all, the review last
 */
function assertSeniorReview(f, label, sends = 2) {
  const review = f.sends.at(-1);
  assert.equal(f.sends.length, sends, `${label}: Senior's review follows (request: ${JSON.stringify(f.state())})`);
  assert.equal(review.selection.modelId, f.assignments.senior.modelId, `${label}: on Senior`);
  assert.match(review.input.message, /Senior review of the plan:/u, label);
  assert.deepEqual([f.state().status, f.state().stage, f.state().delivery], ["working", "review", "accepted"], label);
}

/**
 * Junior's turn ends; the review's delivery pauses where it reads the native session, just before it compares the
 * conversation with its handoff, and meanwhile `turn` (a message and its answer) has its own turn, which ends.
 */
async function overtakenHandoff(f, turn) {
  const checking = Promise.withResolvers();
  const held = Promise.withResolvers();
  let first = true;
  f.agent.sessionState = async () => {
    if (first) {
      first = false;
      checking.resolve();
      await held.promise;
    }
    return { turn: { active: false } };
  };
  const juniorEnded = f.service.afterTurn("session-1", end(f.state().turnId), f.context);
  await checking.promise;
  assert.deepEqual([f.state().stage, f.state().delivery], ["review", "pending"], "Senior's review was handed off");
  f.tail = [...f.tail, turn];
  const otherEnded = f.service.afterTurn("session-1", end(OTHER_TURN), f.context);
  held.resolve();
  await Promise.all([juniorEnded, otherEnded]);
}

test("another session's message whose turn ran and ended before Senior's review of a built plan was delivered: the review still starts once that turn has ended", async (t) => {
  const f = await juniorBuildsEveryItem(t);
  await overtakenHandoff(f, otherSessionTurn);
  assertSeniorReview(f, "conversation changed before the handoff");
});

test("another session's message whose turn was running when Junior's turn ended: Senior's review of the built plan starts once that turn ends", async (t) => {
  const f = await juniorBuildsEveryItem(t);
  f.agent.sessionState = async () => ({ turn: { active: true, id: OTHER_TURN } });
  await f.service.afterTurn("session-1", end(f.state().turnId), f.context);
  assert.equal(f.sends.length, 1, "nothing is sent while the other turn runs");
  f.tail = [...f.tail, otherSessionTurn];
  f.agent.sessionState = async () => ({ turn: { active: false } });
  await f.service.afterTurn("session-1", end(OTHER_TURN), f.context);
  assertSeniorReview(f, "another turn running at the handoff");
});

test("the person's own message overtook the handoff: the automatic start waits for them, and their Continue starts Senior's review from the conversation as it now is", async (t) => {
  const f = await juniorBuildsEveryItem(t);
  await overtakenHandoff(f, personTurn);
  assert.deepEqual([f.sends.length, f.state().status, f.state().stage], [1, "waiting", "review"], "the person's message is theirs: nothing starts by itself");
  await f.service.send("session-1", { messageId: "implement-1", message: "Implement the plan.", reviewAction: "retry" }, f.context);
  assertSeniorReview(f, "Continue");
});

test("the person's Stop while Senior's review waits for another turn: nothing starts once that turn ends", async (t) => {
  const f = await juniorBuildsEveryItem(t);
  f.agent.sessionState = async () => ({ turn: { active: true, id: OTHER_TURN } });
  await f.service.afterTurn("session-1", end(f.state().turnId), f.context);
  await f.service.stop("session-1", f.context);
  f.tail = [...f.tail, otherSessionTurn];
  f.agent.sessionState = async () => ({ turn: { active: false } });
  await f.service.afterTurn("session-1", end(OTHER_TURN), f.context);
  assert.deepEqual([f.sends.length, f.state().stopped, f.state().status], [1, true, "waiting"], "Stop is the person's: nothing starts");
});

test("Junior's turn ends while another operation holds the session's lock past the usual wait: Senior's review still follows once it is free", async (t) => {
  const f = await juniorBuildsEveryItem(t);
  const hold = f.holdLock();
  await hold.started;
  f.lockWait(20);
  // What the turn's end leaves: null once it has run, or the error it gave up with.
  const ended = f.service.afterTurn("session-1", end(f.state().turnId), f.context).then(() => null, (error) => error);
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(f.sends.length, 1, "nothing is sent while the lock is held");
  } finally {
    hold.release();
  }
  assert.equal(await ended, null, "the turn's end is not given up");
  assertSeniorReview(f, "a lock held past the usual wait");
});

test("the server restarted before it saw the other turn end: its recovery starts Senior's review of the built plan, which opening the session in the same run never does", async (t) => {
  const f = await juniorBuildsEveryItem(t, { serverRun: { ...NO_SERVER_RUN, id: "run-1" } });
  f.agent.sessionState = async () => ({ turn: { active: true, id: OTHER_TURN } });
  await f.service.afterTurn("session-1", end(f.state().turnId), f.context);
  f.tail = [...f.tail, otherSessionTurn];
  f.agent.sessionState = async () => ({ turn: { active: false } });
  await f.service.reconcile("session-1", f.context);
  assert.equal(f.sends.length, 1, "opening the session sends nothing");
  assert.equal(requestWasWorking(f.metadata), true, "the next server's startup recovery takes it up, with no page open");
  await f.restart({ serverRun: { ...NO_SERVER_RUN, id: "run-2" } }).reconcile("session-1", f.context);
  assertSeniorReview(f, "recovery after a restart");
});

test("another session's message routed after the other turn ended but before that end was decided: it runs as its own turn, never replacing the owed review, which starts once it ends", async (t) => {
  const f = await juniorBuildsEveryItem(t);
  f.agent.sessionState = async () => ({ turn: { active: true, id: OTHER_TURN } });
  await f.service.afterTurn("session-1", end(f.state().turnId), f.context);
  // The other turn ends; its end has not been decided when the session's second message is routed.
  f.tail = [...f.tail, otherSessionTurn];
  f.agent.sessionState = async () => ({ turn: { active: false } });
  await f.service.send("session-1", secondSessionMessage, f.context);
  assert.deepEqual([f.sends.length, f.sends.at(-1).input.messageId, f.state().messageId, f.state().status, f.state().stopped],
    [2, "other-session-2", "implement-1", "waiting", undefined], "the message has its own turn; the review is still owed");
  // The first turn's end is decided while the message's turn runs: the review stays owed.
  f.agent.sessionState = async () => ({ turn: { active: true, id: SECOND_TURN } });
  await f.service.afterTurn("session-1", end(OTHER_TURN), f.context);
  assert.equal(f.sends.length, 2, "nothing starts while that turn runs");
  f.tail = [...f.tail, secondSessionTurn];
  f.agent.sessionState = async () => ({ turn: { active: false } });
  await f.service.afterTurn("session-1", end(SECOND_TURN), f.context);
  assertSeniorReview(f, "the second message's turn ended", 3);
});

/**
 * Junior's turn ended while its server was down: the next server's recovery finds it ended, its handoff reported, and
 * prepares Senior's review, which no earlier server sent.
 * @param {import("node:test").TestContext} t
 * @param {{ tail?: object[], steering?: object[] }} [after] what the chat holds after Junior's own message and its
 *   answer; steering: the request's accepted steering of that turn
 */
async function recoveredHandoff(t, { tail = [], steering = [] } = {}) {
  const f = await juniorBuildsEveryItem(t, { serverRun: { ...NO_SERVER_RUN, id: "run-1" } });
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), steering });
  f.tail = [...f.tail, ...tail];
  f.context.session.agentRuns = [{ id: "codex_app_server", state: "completed", turnId: f.state().turnId }];
  f.agent.sessionState = async () => ({ turn: { active: false } });
  await f.restart({ serverRun: { ...NO_SERVER_RUN, id: "run-2" } }).reconcile("session-1", f.context);
  return f;
}

test("Junior's turn ended across a restart, its handoff to Senior's review reported: the next server's recovery starts the review, steered turn too", async (t) => {
  assertSeniorReview(await recoveredHandoff(t), "recovered handoff");
  const steer = { messageId: "steer-1", text: "Keep the old inbox link too." };
  const steered = await recoveredHandoff(t, {
    steering: [steer],
    tail: [{ user: steer, messages: [{ role: "assistant", text: "Kept it; every item is built." }] }]
  });
  assertSeniorReview(steered, "recovered handoff of a steered turn");
});

test("Junior's turn ended across a restart, and a message of the person's own came after it: the recovered review waits for their Continue", async (t) => {
  const f = await recoveredHandoff(t, { tail: [personTurn] });
  assert.deepEqual([f.sends.length, f.state().status, f.state().stage, f.state().delivery], [1, "waiting", "review", "pending"],
    "the person's message is newer than the turn: nothing starts by itself");
  await f.service.send("session-1", { messageId: "implement-1", message: "Implement the plan.", reviewAction: "retry" }, f.context);
  assertSeniorReview(f, "Continue after recovery");
});
