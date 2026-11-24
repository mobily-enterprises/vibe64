import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

// A live session's cases, in Auto through the real routing service: Junior's turn on the plan's last item ended
// asking whether to run the passes or save, once with that item unticked and once with every item half-ticked
// because their last proof (a real phone, the browser suite) can't run in the session. Vibe64 never waits there:
// Senior's review of the plan follows, which verifies every item, ticks it, and asks the person what can't be proven
// here as numbered Needs you questions. Vibe64 judges no item itself: the plan check asks the AI, the marks are its.

const PLAN = "Status: active\n# Contact threads\n\nGroup each contact's messages into one thread.\n\n" +
  "- [~] Store contact threads\n- [~] List a contact's threads\n- [~] Reply in a thread\n- [ ] Move old messages into threads\n\n" +
  "## Technical details\nsrc/threads.js holds the store; src/list.js, src/reply.js and src/migrate.js use it.\n";
const PASSES_OR_SAVE = "The migration is built and its checks pass.\n\nTo do: the plan's passes (Review, Security, Data, Quality, " +
  "Deslop) haven't been run yet, and nothing is saved.\n\n[1] Should I run the passes before saving, or save now?\n" +
  "Possible answers:\n- Run the passes first\n- Save now";
const end = (state) => ({ payload: { agentRun: { active: false, state: "completed", providerTurnId: state.turnId } } });
const marks = async (f) => (await readWorkPlan(f.context)).text.split("\n").filter((line) => /^- \[/u.test(line)).map((line) => line.slice(3, 4));

/** Implement plan in Auto, Junior's turn building the last item: its file is written, the reply is `reply`. */
async function lastItemTurn(t, reply) {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await publishPlanFixture(f.context, PLAN);
  const request = { messageId: "implement-1", message: "Implement the plan.", submissionKind: "send", planRevision: (await readWorkPlan(f.context)).revision };
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, f.assignments.junior.modelId, "Junior implements");
  await mkdir(path.join(f.source.source, "src"), { recursive: true });
  await writeFile(path.join(f.source.source, "src/migrate.js"), "export const migrate = () => {};\n");
  f.tail = [{ user: { messageId: request.messageId, text: request.message }, messages: [{ role: "assistant", text: reply }] }];
  f.context.runtime.store.readConversationTail = async () => f.tail;
  return f;
}

/** Senior's review of the plan is the request's next turn, and nothing waits for the person. */
function assertSeniorReview(f, sent, label) {
  assert.equal(f.sends.length, sent, `${label}: Senior's review follows`);
  const review = f.sends.at(-1);
  assert.equal(review.selection.modelId, f.assignments.senior.modelId, `${label}: on Senior`);
  assert.match(review.input.message, /Senior review of the plan:/u);
  assert.match(review.input.message, /Verify EVERY checklist item outside the plan's Passes section/u);
  assert.match(review.input.message, /Each item whose proof can't run in this session .* ends as Needs you: a numbered question with a recommended answer, in your final reply and in Progress/u);
  assert.match(review.input.message, /Whether to run the passes or save is never one: Vibe64 runs the passes and saves/u);
  assert.deepEqual([f.state().status, f.state().stage, Boolean(f.state().awaitingAnswer)], ["working", "review", false], label);
}

for (const checkTurn of ["ticks the last item", "leaves the plan as it was"]) {
  test(`the last item built but not ticked, the turn asking whether to run the passes or save: the plan check, then Senior's review; the check's turn ${checkTurn}`, async (t) => {
    const f = await lastItemTurn(t, PASSES_OR_SAVE);
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.equal(f.state().awaitingAnswer, undefined, "no wait for the answer at the plan's last item");
    assert.equal(f.sends.length, 2, "the plan check");
    assert.equal(f.sends[1].input.turnMetadata.actorLabel, "Plan check");
    assert.match(f.sends[1].input.message, /Senior's review, the plan's passes and Save are the plan's next steps, which Vibe64 runs/u);
    f.tail = [{ user: { messageId: f.state().followup.messageId, text: f.state().followup.displayMessage },
      messages: [{ role: "assistant", text: checkTurn === "ticks the last item" ? "The migration item is built: half-ticked." : "Checked." }] }];
    if (checkTurn === "ticks the last item") {
      const { plan, revisions } = await planCommands(f);
      await plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace("- [ ] Move", "- [~] Move"), ...await revisions() });
      assert.deepEqual(await marks(f), ["~", "~", "~", "~"]);
    }
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assertSeniorReview(f, 3, checkTurn);
    // Junior was told to tick each item, the last one too, and never to ask about the passes or Save.
    assert.match(f.sends[0].input.message, /and the last item too before your turn ends/u);
    assert.match(f.sends[0].input.message, /Never ask the person whether to run the plan's passes or Save/u);
  });
}

test("every item half-ticked because its last proof can't run in the session, the turn asking whether to run the passes or save, waiting or reporting nothing: Senior's review follows", async (t) => {
  for (const ending of ["asks the person", "reports wait", "reports nothing"]) {
    const f = await lastItemTurn(t, PASSES_OR_SAVE);
    const { plan, revisions } = await planCommands(f);
    await plan({ operation: "progress-write", text: "# Progress\n\nThe migration is built; its unit tests pass. Unproven here: a real phone, the browser suite.\n", ...await revisions() });
    await plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace("- [ ] Move", "- [~] Move"), ...await revisions() });
    if (ending === "reports wait") await reportOutcome(f, "wait", { involved: true, explanation: "Should I run the passes before saving, or save now?" });
    if (ending !== "asks the person") f.tail[0].messages[0].text = "The migration is built. Should I run the passes before saving, or save now?";
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assertSeniorReview(f, 2, ending);
    assert.equal(f.state().outcome.decision, "handoff", ending);
    // Junior was told to half-tick such an item, record why in Progress and leave the question to Senior's review.
    assert.match(f.sends[0].input.message, /An item built whose remaining proof can't run in this session \(a real phone, a suite only CI runs\) is half-ticked \(- \[~\]\) with what is unproven and why in Progress; never end your turn asking about it: Senior's review asks the person, as a numbered question with a recommended answer/u);
  }
});

test("a question while an item is still open waits for the person's answer, as before", async (t) => {
  const f = await lastItemTurn(t, "Old messages need a contact id.\n\n[1] Which contact id should old messages use?\n" +
    "Possible answers:\n- The email address (recommended)\n- The phone number");
  const { plan, revisions } = await planCommands(f);
  await plan({ operation: "progress-write", text: "# Progress\n\nThe migration waits for the contact id.\n", ...await revisions() });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status, f.state().awaitingAnswer], [1, "waiting", true]);
});
