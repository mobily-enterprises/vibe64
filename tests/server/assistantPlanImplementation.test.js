import assert from "node:assert/strict";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { ASSISTANT_PLAN_COMPLETION_MESSAGE } from "@local/vibe64-runtime/shared/assistantFinishing";

// A plan runs to the end, in order: it stays in Implementation until every item outside its Passes is built,
// a plan change saved while it is being implemented lets the implementation go on, and only a question or Stop
// pauses it.

const end = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
async function finish(f, decision, options = {}) {
  await reportOutcome(f, decision, { involved: true, ...options });
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: "Execute the plan" },
    assistant: { text: "Actual final explanation." }, messages: [{ role: "assistant", text: "Actual final explanation." }] }];
  await f.service.afterTurn("session-1", end(state), f.context);
}
const noticeTexts = (f) => [...f.notices.values()].map((turn) => turn.system.text);
// Status first, where a write keeps it; the summary names the agreed required-field rule the Router fixture expects.
const PLAN = "Status: active\n# Contact threads\n\nOne thread per contact; the agreed required-field rule stays.\n\n- [ ] Store threads in Redis\n- [ ] Replies join their thread\n" +
  "- [ ] Old messages move over\n\n## Technical details\nGroup messages by contact id.\n";
async function writePlan(f, change, role) {
  const plan = await readWorkPlan(f.context);
  return manageWorkPlan(f.context, { operation: "write", text: change(plan.text), expectedRevision: plan.revision,
    expectedProgressRevision: plan.progressRevision || "" }, role);
}
/** Implement plan: the person's go-ahead for the plan as it stands, which Junior implements. */
async function implement(f) {
  await publishPlanFixture(f.context, PLAN);
  const plan = await readWorkPlan(f.context);
  await f.service.send("session-1", { messageId: "implement-1", message: "Implement the plan.", submissionKind: "send", planRevision: plan.revision }, f.context);
  assert.equal(f.sends.at(-1).selection.modelId, f.assignments.junior.modelId);
  assert.deepEqual([f.state().stage, f.state().planInvolved], ["implementation", true]);
}

test("Junior hands a plan change to Senior while implementing; once Senior saves it, Junior's implementation goes on in a new turn", async (t) => {
  for (const ending of ["handoff", "wait"]) {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
    await implement(f);
    // Junior finds the first item wrong for this project and hands the change to Senior.
    const { plan } = await planCommands(f);
    await plan({ operation: "handoff" });
    assert.equal(f.state().planHandoff.implementing, true);
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.equal(f.sends.length, 2);
    const senior = f.sends[1];
    assert.equal(senior.selection.modelId, f.assignments.senior.modelId);
    assert.equal(senior.input.displayMessage, "Senior changes the plan.");
    assert.match(senior.input.message, /Change the plan: the plan is being implemented/u);
    assert.match(senior.input.message, /once your change to it is saved, report handoff with the returned revisions, and Vibe64 continues the implementation/u);
    assert.ok(noticeTexts(f).includes("Senior is changing the plan. Implementation continues once the change is saved."), noticeTexts(f).join("\n"));
    assert.deepEqual([f.state().stage, f.state().resumeImplementation], ["planning", true]);
    await writePlan(f, (text) => text.replace("Store threads in Redis", "Store threads in the existing database"), "senior");
    await finish(f, ending, ending === "wait" ? { explanation: "1. Keep the old threads? Recommended: yes." } : {});
    if (ending === "wait") {
      // Needs you pauses it: nothing starts until the person answers.
      assert.equal(f.sends.length, 2);
      assert.deepEqual([f.state().status, f.state().stage], ["waiting", "planning"]);
      continue;
    }
    assert.equal(f.sends.length, 3, "the implementation goes on without the person asking");
    const junior = f.sends[2];
    assert.equal(junior.selection.modelId, f.assignments.junior.modelId);
    assert.equal(junior.input.displayMessage, "Continue implementation.");
    assert.match(junior.input.message, /Senior has changed it, so read it again and work its remaining items in the plan's order/u);
    assert.match(junior.input.message, /Auto workflow stage: implementation\./u);
    assert.deepEqual([f.state().stage, f.state().resolvedMode, f.state().workflow, f.state().planInvolved, f.state().resumeImplementation],
      ["implementation", "junior", true, true, undefined]);
    assert.ok(noticeTexts(f).some((text) => text.startsWith("Plan changed. Implementation continues.")), noticeTexts(f).join("\n"));
  }
});

test("a plan change the person asks for while the implementation waits lets it go on once saved; after Stop it waits for Continue", async (t) => {
  for (const stopped of [false, true]) {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
    await implement(f);
    if (stopped) {
      const running = f.state();
      await f.service.stop("session-1", f.context);
      await f.service.afterTurn("session-1", end(running, "interrupted"), f.context);
    } else {
      await finish(f, "wait", { explanation: "1. Which contact id? Recommended: the email address." });
    }
    assert.equal(f.state().status, "waiting");
    f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "senior", reason: "planning" }) });
    await f.service.send("session-1", { messageId: "change-1", message: "Add an item to the plan: replies keep their attachments.", submissionKind: "send" }, f.context);
    assert.deepEqual([f.state().stage, f.state().resolvedMode], ["planning", "senior"]);
    assert.equal(f.state().resumeImplementation, stopped ? undefined : true);
    await writePlan(f, (text) => text.replace("- [ ] Old messages move over", "- [ ] Old messages move over\n- [ ] Replies keep their attachments"), "senior");
    if (stopped) {
      await assert.rejects(reportOutcome(f, "handoff", { involved: true }), { code: "vibe64_assistant_workflow_planning_outcome_refused" });
      continue;
    }
    const sent = f.sends.length;
    await finish(f, "handoff");
    assert.equal(f.sends.length, sent + 1);
    assert.equal(f.sends.at(-1).selection.modelId, f.assignments.junior.modelId);
    assert.deepEqual([f.state().stage, f.state().messageId], ["implementation", "change-1"]);
  }
});

test("Continue after Stop resumes the implementation from the plan as it now is", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  await implement(f);
  // The stopped turn had built the first item: the plan changed since the request started.
  await writePlan(f, (text) => text.replace("- [ ] Store threads", "- [~] Store threads"), "junior");
  const running = f.state();
  await f.service.stop("session-1", f.context);
  await f.service.afterTurn("session-1", end(running, "interrupted"), f.context);
  assert.deepEqual([f.state().status, f.state().stopped], ["waiting", true]);
  await f.service.send("session-1", { messageId: "implement-1", reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 2);
  assert.deepEqual([f.state().status, f.state().stage, f.state().stopped], ["working", "implementation", false]);
  assert.equal(f.state().followup.planRevision, (await readWorkPlan(f.context)).revision);
});

test("the plan stays in Implementation until every item is built: Junior's handoff to Senior's review is refused before", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  await implement(f);
  await writePlan(f, (text) => text.replace("- [ ] Replies join", "- [~] Replies join").replace("- [ ] Old messages", "- [~] Old messages"), "junior");
  await assert.rejects(reportOutcome(f, "handoff", { involved: true }), (error) => {
    assert.equal(error.code, "vibe64_assistant_workflow_plan_items_open");
    assert.match(error.message, /item 1 of 3, “Store threads in Redis”, is still - \[ \]/u);
    return true;
  });
  await writePlan(f, (text) => text.replace("- [ ] Store threads", "- [~] Store threads"), "junior");
  await finish(f, "handoff");
  assert.deepEqual([f.state().stage, f.sends.length], ["review", 2]);
  assert.equal(f.sends[1].input.displayMessage, "Senior reviews the plan.");
});

test("Junior works the items in the plan's order and never starts the final checks; Senior's review runs them once", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  await implement(f);
  const message = f.sends[0].input.message;
  assert.match(message, /Implement a plan's items in the plan's order: do one earlier only when the plan says another item depends on it, and record why in Progress\./u);
  assert.match(message, /The plan's final checks \(the whole-project checks, such as one whole run of the test suite\) are not an implementation item: Senior's review runs them once, after every item is built, so never start them in an implementation turn/u);
  assert.match(ASSISTANT_PLAN_COMPLETION_MESSAGE, /Run the plan's final checks once, now: the whole-project checks the plan or project states, such as one whole run of the test suite\. No implementation turn ran them\. Read their result, record it in Progress/u);
});

test("a turn that builds another of the plan's items gets a fresh allowance of automatic steps", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false });
  await implement(f);
  const items = ["Store threads", "Replies join", "Old messages"];
  // Nine turns, each reporting progress: those that build an item keep the plan going past eight steps.
  for (let turn = 0; turn < 9; turn += 1) {
    if (turn % 3 === 2) await writePlan(f, (text) => text.replace(`- [ ] ${items[(turn - 2) / 3]}`, `- [~] ${items[(turn - 2) / 3]}`), "junior");
    await finish(f, "continue");
    assert.equal(f.state().status, "working", `turn ${turn + 1}: ${f.state().error || ""}`);
  }
  // Turns that build nothing still stop at eight steps.
  for (let turn = 0; turn < 8 && f.state().status === "working"; turn += 1) await finish(f, "continue");
  assert.equal(f.state().status, "waiting");
  assert.match(f.state().error, /Eight automatic workflow steps completed/u);
});
