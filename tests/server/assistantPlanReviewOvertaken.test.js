import assert from "node:assert/strict";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { NO_SERVER_RUN } from "../../packages/vibe64-terminals/src/server/turnInterruptions.js";

// A live session's case, in Auto through the real routing service. Junior's turn built every item of the plan and
// handed it to Senior's review. A message from another session (delivered as the owner's message) had its own answer
// turn first: the review's delivery was refused because a turn was running, or because the conversation had changed
// since the handoff was decided, and nothing ever started Senior's review. The person's Continue was refused too: it
// sent the old handoff again. The plan sat built and unreviewed for an hour.
// A refusal that means only that another turn or message came first leaves the review owed: it is decided again once
// that turn ends, from the conversation and plan as they are then (or by the server's recovery, when it restarted
// first). A message of the person's own still holds it for them, Stop still ends it, and a busy lock at the turn's
// end never loses it.

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

/** Senior's review of the plan is the request's next turn: the plan is never left built with nothing running it. */
function assertSeniorReview(f, label) {
  const review = f.sends.at(-1);
  assert.equal(f.sends.length, 2, `${label}: Senior's review follows (request: ${JSON.stringify(f.state())})`);
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
  await f.restart({ serverRun: { ...NO_SERVER_RUN, id: "run-2" } }).reconcile("session-1", f.context);
  assertSeniorReview(f, "recovery after a restart");
});
