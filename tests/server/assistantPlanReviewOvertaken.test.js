import assert from "node:assert/strict";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

// A live session's case, in Auto through the real routing service. Junior's turn built every item of the plan and
// handed it to Senior's review. Before that review's delivery read the conversation, a message from another session
// (delivered as the owner's message) had its own turn, an answer, which ran and ended. The review's delivery found the
// conversation changed since its handoff was decided and refused it, and nothing ever started Senior's review: the
// plan sat built and unreviewed, and later messages were only answered. Once the other turn has ended, the plan's next
// step is decided again from the plan as it is, so Senior's review starts.

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

/** Implement plan in Auto; Junior's turn builds the last item, half-ticks it and hands the plan to Senior's review. */
async function juniorBuildsEveryItem(t) {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
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
