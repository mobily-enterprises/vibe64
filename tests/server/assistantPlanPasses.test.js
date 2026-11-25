import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { GENESIS_PASSES } from "../fixtures/genesisPasses.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { afterPlanBase, rememberAfterPlanBase } from "../../packages/vibe64-terminals/src/server/afterPlanBase.js";
import { passesInMessage, planPassesView } from "../../packages/vibe64-terminals/src/server/planPasses.js";
import { workPlanPassItems } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";

// A plan's passes, through the real routing service: the plan's last section, ## Passes, lists
// them; once Senior has reviewed the plan, each unticked Passes item runs in its own Senior turn,
// in the plan's order, and after the last Vibe64 completes and archives the plan and saves the work.

const request = { messageId: "request-1", message: "Execute the plan", submissionKind: "send" };
const end = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
/** The turn reports its outcome, its final reply is delivered, and it ends. */
async function finish(f, decision, options = {}) {
  await reportOutcome(f, decision, { involved: true, ...options });
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: "Execute the plan" },
    assistant: { text: "Actual final explanation." }, messages: [{ role: "assistant", text: "Actual final explanation." }] }];
  await f.service.afterTurn("session-1", end(state), f.context);
}
const planHistory = async (f) => (await manageWorkPlan(f.context, { operation: "history" }, "user")).history;
const noticeTexts = (f) => [...f.notices.values()].map((turn) => turn.system.text);
const passNotices = (f) => noticeTexts(f).filter((text) => / started: the plan's next pass | can't run: /u.test(text));
const since = (title, base, deep = false) => `${title}${deep ? " deeply" : ""}: the changes since base commit ${base}, judged against the whole app.`;
// The request a turn sends: its message's last paragraph, after the role's instructions, where Genesis reads it.
const requestOf = (send) => send.input.message.split("\n\n").at(-1);
const SAVE_STARTED = "Save started automatically (Chat settings: Automatically save changes)";

/** A plan whose one item Junior has built, and whose Passes section lists these items. */
const planWith = (passes) => "Status: active\n# Required-field validation\n\nReject a blank name.\n\n- [~] Required-name validation\n\n" +
  "## Technical details\nAdd the check to src/form.js.\n" + (passes.length ? `\n## Passes\n\n${passes.map((item) => `- [ ] ${item}`).join("\n")}\n` : "");

/** Writes the plan as role does, changing only the text. */
async function writePlan(f, text, role = "review", options = {}) {
  const plan = await readWorkPlan(f.context);
  return manageWorkPlan(f.context, { operation: "write", text, expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" },
    role, options);
}
/**
 * The turn that committed the plan's work brings its plan up to date: the plan already shows the item built, so its AI
 * records that it checked the plan. Without it, Vibe64's plan check would follow the turn.
 */
async function planChecked(f, role = "junior") {
  const plan = await readWorkPlan(f.context);
  return manageWorkPlan(f.context, { operation: "checked", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, role);
}
/** Senior's review full-ticks the plan's own item. */
const tickItems = async (f, role = "review") => writePlan(f, (await readWorkPlan(f.context)).text.replace("- [~] Required-name", "- [x] Required-name"), role);
/** The running pass ticks its own Passes item, the only Plan change it may make. */
async function tickPass(f) {
  const { item } = f.state().pass;
  return writePlan(f, (await readWorkPlan(f.context)).text.replace(`- [ ] ${item}`, `- [x] ${item}`), "pass", { passItem: item });
}
/** The running pass is Done: its item ticked, complete reported, its turn ended. */
async function passDone(f) {
  await tickPass(f);
  await finish(f, "complete");
}

/**
 * Auto's work on the plan: Router sends it to Junior, who implements it and hands off; Senior
 * reviews it in its own turn, ticks its item and reports complete, so the plan reaches its passes.
 */
async function implementAndReview(f, passes) {
  await publishPlanFixture(f.context, planWith(passes));
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, f.assignments.junior.modelId);
  if (f.source) {
    await f.source.commit("Required-name validation");
    await planChecked(f);
  }
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
  await tickItems(f);
  await finish(f, "complete");
}

test("Senior's review leaves a plan with passes active; each Passes item runs in its own Senior turn in the plan's order, then Vibe64 completes, archives and saves the plan once", async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true, onPlanCompleted: async () => {
    saves.push({ archived: (await planHistory(f)).length, status: f.state().status });
    return "Saved automatically.";
  } });
  const passes = ["Review: the plan's changes", "Security pass: the plan's changes", "Data pass: the plan's changes, deeply", "User experience pass: whole app"];
  await publishPlanFixture(f.context, planWith(passes));
  await f.service.send("session-1", request, f.context);
  await f.source.commit("Required-name validation");
  await planChecked(f);
  await finish(f, "handoff");
  // Senior's review is not a pass; it verifies every item and runs none.
  assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
  assert.match(f.sends[1].input.message, /Senior review of the plan: /u);
  assert.equal(f.sends[1].input.displayMessage, "Senior reviews the plan.");
  assert.ok(!f.sends[1].input.genesisTask, "it runs no pass");
  // Done means every item outside Passes is proven: a built item is not.
  await assert.rejects(reportOutcome(f, "complete", { involved: true }), { code: "vibe64_assistant_workflow_plan_incomplete" });
  await tickItems(f);
  await finish(f, "complete");
  assert.equal((await readWorkPlan(f.context)).status, "active", "Senior leaves a plan with passes active");

  const base = f.source.canonical;
  const expected = [["review", since("Review", base)], ["security-pass", since("Security pass", base)],
    ["data-pass", since("Data pass", base, true)], ["ux-pass", "User experience pass the whole app."]];
  for (const [index, [id, message]] of expected.entries()) {
    const send = f.sends[2 + index];
    assert.deepEqual([f.state().stage, f.state().pass.id, f.state().pass.item], ["pass", id, passes[index]]);
    assert.equal(f.state().passChain, undefined, "the plan is the only list");
    assert.equal(requestOf(send), message, `${id} runs its Passes item's request`);
    assert.equal(send.input.genesisTask, id);
    assert.equal(send.input.automaticGenesisTask, true);
    assert.equal(send.selection.modelId, f.assignments.senior.modelId, `${id} runs on Senior`);
    assert.match(send.input.message, new RegExp(`the plan's Passes item “${passes[index].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}”, and only that pass`, "u"));
    assert.equal(/This is the plan's last pass/u.test(send.input.message), index === expected.length - 1, `${id}: only the last pass closes the plan`);
    assert.equal((await readWorkPlan(f.context)).status, "active", "the plan stays active while its passes run");
    assert.equal(saves.length, 0, "nothing is saved before the last pass ends");
    // A pass is Done only once its own item is ticked.
    if (index === 0) await assert.rejects(reportOutcome(f, "complete", { involved: true }), { code: "vibe64_assistant_workflow_pass_unticked" });
    await passDone(f);
  }
  assert.equal(f.sends.length, 6, "one turn per Passes item");
  assert.equal(f.helperCalls(), 1, "Router classifies only the person's request");
  assert.equal(f.state().status, "complete");
  assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await planHistory(f)).length, 1, "the plan is completed and archived after its last pass");
  assert.deepEqual(saves, [{ archived: 1, status: "complete" }], "and the work saved once, after that");
  assert.equal(f.metadata.after_plan_base, await f.source.head(), "the next plan's passes start from here");
  assert.deepEqual(passNotices(f), passes.map((item) => `${item.slice(0, item.indexOf(":"))} started: the plan's next pass (${item})`));
  const notices = noticeTexts(f);
  assert.ok(notices.indexOf(SAVE_STARTED) < notices.indexOf("Saved automatically."));
  // No pass ran the whole-project checks: once the plan is finished and saved, Vibe64 asks whether to run them.
  assert.match(notices.at(-1), /^The plan is finished\. Run the whole-project checks once now, on the finished plan's work\?/u);
  assert.deepEqual(f.state().wholeChecks, { status: "asked", plan: "Required-field validation" });
  for (const send of f.sends.slice(2)) {
    assert.match(send.input.message, /Run no whole-project checks, such as one whole run of the test suite, even where this pass's guidance asks for one: run the focused tests for what you changed\./u);
  }
});

test("a pass that needs the person waits for their answer, which goes back to that pass on Senior without Router", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implementAndReview(f, ["Data pass: whole app", "Deslop: whole app"]);
  const asked = f.state();
  const notices = f.notices.size;
  await finish(f, "wait", { explanation: "1. Add an index on bookings.date? Recommended: yes." });
  assert.deepEqual([f.state().status, f.state().awaitingAnswer, f.state().error],
    ["waiting", true, "Waiting for your answer. Reply in chat to continue."]);
  assert.equal(f.notices.size, notices, "the question is the pass's own reply; no notice repeats it");
  await f.service.send("session-1", { messageId: "reply-1", message: "1: yes, add it.", submissionKind: "send" }, f.context);
  assert.equal(f.helperCalls(), 1, "the reply is not routed");
  const reply = f.sends.at(-1);
  assert.equal(reply.selection.modelId, f.assignments.senior.modelId);
  assert.equal(reply.input.genesisTask, "data-pass");
  assert.equal(requestOf(reply), "Data pass the whole app.", "the pass's request stays last, where Genesis reads it");
  assert.ok(reply.input.message.includes("1: yes, add it.\n\nData pass the whole app."), "the person's reply comes first");
  assert.match(reply.input.message, /The person's message comes before this pass's request below/);
  assert.deepEqual([f.state().messageId, f.state().stage, f.state().pass.item, f.state().passReply], ["reply-1", "pass", asked.pass.item, true]);
  // Done, the plan moves on to its next pass.
  await passDone(f);
  assert.equal(f.state().pass.id, "deslop");
  assert.equal(f.state().passReply, undefined);
});

test("a pass that runs out of room continues in its next turn with the same request", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implementAndReview(f, ["Security pass: whole app", "Deslop: whole app"]);
  await finish(f, "continue");
  assert.equal(f.sends.length, 4);
  assert.deepEqual([f.state().stage, f.state().pass.id, f.state().status], ["pass", "security-pass", "working"]);
  assert.equal(requestOf(f.sends[3]), "Security pass the whole app.");
  assert.equal(f.sends[3].input.genesisTask, "security-pass");
});

for (const resume of ["retry", "Continue in Passes"]) test(`Stop pauses the plan at its pass; ${resume} runs that pass again from the plan`, async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implementAndReview(f, ["Security pass: whole app", "Deslop: whole app"]);
  const stopped = f.state();
  await f.service.stop("session-1", f.context);
  await f.service.afterTurn("session-1", end(stopped, "interrupted"), f.context);
  assert.equal(f.sends.length, 3, "no later pass starts");
  assert.deepEqual([f.state().status, f.state().stopped, f.state().pass.id], ["waiting", true, "security-pass"]);
  assert.equal((await readWorkPlan(f.context)).status, "active");
  assert.deepEqual(planPassesView(await readWorkPlan(f.context), f.state(), f.genesis).passes.map(({ state }) => state), ["paused", ""]);
  if (resume === "retry") await f.service.send("session-1", { messageId: stopped.messageId, message: stopped.input.message, reviewAction: "retry" }, f.context);
  else await f.service.send("session-1", { messageId: "continue-1", message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" }, f.context);
  assert.equal(f.sends.length, 4);
  assert.equal(f.sends[3].input.genesisTask, "security-pass");
  assert.equal(requestOf(f.sends[3]), "Security pass the whole app.");
  assert.deepEqual([f.state().stage, f.state().status, Boolean(f.state().stopped)], ["pass", "working", false]);
});

test("a retry after Stop runs the plan's next pass as the plan now says: a pass ticked meanwhile does not run again", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implementAndReview(f, ["Security pass: whole app", "Deslop: whole app"]);
  const stopped = f.state();
  await f.service.stop("session-1", f.context);
  await f.service.afterTurn("session-1", end(stopped, "interrupted"), f.context);
  await writePlan(f, (await readWorkPlan(f.context)).text.replace("- [ ] Security pass", "- [x] Security pass"), "senior");
  await f.service.send("session-1", { messageId: stopped.messageId, message: stopped.input.message, reviewAction: "retry" }, f.context);
  assert.equal(f.sends.length, 4);
  assert.equal(f.sends[3].input.genesisTask, "deslop");
  assert.deepEqual([f.state().stage, f.state().pass.item, f.state().status], ["pass", "Deslop: whole app", "working"]);
});

test("a pass Genesis can't run holds the plan at that pass with the reason, skipping nothing; Continue runs it once it can", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  const reason = "This Genesis source (genesis-compiler 1.10.21) has no User experience pass.";
  f.genesis.passes = GENESIS_PASSES.map((pass) => pass.id === "ux-pass" ? { ...pass, unavailable: reason, runs: [], sinceBase: null } : pass);
  await implementAndReview(f, ["User experience pass: whole app", "Deslop: whole app"]);
  assert.equal(f.sends.length, 2, "Deslop does not run in its place");
  const held = `User experience pass can't run: ${reason} Change the plan's Passes, or put it right and choose Continue in Passes.`;
  assert.deepEqual([f.state().status, f.state().stage, f.state().error], ["waiting", "pass", held]);
  assert.ok(noticeTexts(f).includes(held));
  assert.equal((await readWorkPlan(f.context)).status, "active");
  f.genesis.passes = GENESIS_PASSES;
  await f.service.send("session-1", { messageId: "continue-1", message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" }, f.context);
  assert.equal(f.sends.at(-1).input.genesisTask, "ux-pass");
});

test("a pass over the plan's changes, in a session whose history shows no start for them, holds the plan with the reason", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  delete f.metadata.canonical_commit;
  await implementAndReview(f, ["Review: the plan's changes"]);
  assert.equal(f.sends.length, 2, "never a whole-app pass instead");
  assert.match(f.state().error, /^Review can't run: Vibe64 can't tell where this plan's work started in the session's history\./u);
  assert.equal((await readWorkPlan(f.context)).status, "active");
});

test("Run in Passes with no open plan makes a small plan of its own and runs it at once; it completes like any plan", async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true, onPlanCompleted: async () => { saves.push(true); return ""; } });
  await f.service.send("session-1", { ...request, genesisTask: "security-pass", passRun: "whole", message: "Security pass the whole app." }, f.context);
  const plan = await readWorkPlan(f.context);
  assert.equal(plan.title, "Passes: Security pass, whole app");
  assert.deepEqual(workPlanPassItems(plan.text).map(({ text }) => text), ["Security pass: whole app"]);
  assert.ok(noticeTexts(f).includes("New plan for the passes you asked for: Passes: Security pass, whole app."));
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].input.genesisTask, "security-pass");
  assert.equal(f.sends[0].input.displayMessage, "Security pass the whole app.");
  assert.equal(requestOf(f.sends[0]), "Security pass the whole app.");
  assert.match(f.sends[0].input.message, /This is the plan's last pass/);
  assert.deepEqual([f.state().stage, f.state().workflow, f.state().pass.id], ["pass", true, "security-pass"]);
  await passDone(f);
  assert.equal(f.state().status, "complete");
  assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await planHistory(f)).length, 1);
  assert.deepEqual(saves, [true]);
  // Typed passes with no run named check the changes since the session's base, which the finished plan moved to HEAD.
  const base = await f.source.head();
  await f.service.send("session-1", { messageId: "request-2", message: "Run the security and data passes", submissionKind: "send" }, f.context);
  const typed = await readWorkPlan(f.context);
  assert.equal(typed.title, `Passes: Security pass and Data pass, since ${base.slice(0, 7)}`);
  assert.deepEqual(workPlanPassItems(typed.text).map(({ text }) => text), [`Security pass: the changes since ${base}`, `Data pass: the changes since ${base}`]);
  assert.equal(requestOf(f.sends.at(-1)), since("Security pass", base));
});

test("passes asked for while the plan is still being worked on join its Passes, and Senior says so without running one", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await publishPlanFixture(f.context, planWith([]));
  // Continue, Run this pass again and Restart wait for the plan's passes.
  for (const passAction of ["continue", "restart"]) {
    await assert.rejects(f.service.send("session-1", { ...request, messageId: `action-${passAction}`, message: "Continue the plan's passes.", passAction }, f.context),
      { code: "vibe64_assistant_routing_plan_passes_not_yet", delivery: "not-sent" });
  }
  const before = (await readWorkPlan(f.context)).text;
  assert.ok(!before.includes("## Passes"));
  await f.service.send("session-1", { ...request, message: "Run the Security pass deeply" }, f.context);
  const plan = await readWorkPlan(f.context);
  assert.deepEqual(workPlanPassItems(plan.text).map(({ text, checked }) => [text, checked]), [["Security pass: deep", false]]);
  assert.equal(plan.text, `${before.trimEnd()}\n\n## Passes\n\n- [ ] Security pass: deep\n`);
  assert.equal(f.helperCalls(), 0);
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].selection.modelId, f.assignments.senior.modelId);
  assert.equal(f.sends[0].input.genesisTask, undefined, "no pass runs");
  assert.match(f.sends[0].input.message, /\[Vibe64: Vibe64 added Security pass to the current plan's Passes: they run once Senior has reviewed the plan\. Tell the person so in a sentence or two; run no pass and change nothing\.\]/);
  assert.deepEqual([f.state().reason, f.state().stage, f.state().workflow], ["conversation", null, false]);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete");
  assert.equal(f.sends.length, 1);
});

test("several passes share one run; Run this pass again and Restart from the first pass untick the plan's Passes and run its next pass", async (t) => {
  const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
  await f.service.send("session-1", { ...request, message: "Run Data pass and Security pass deeply.", passes: ["data-pass", "security-pass"], passRun: "deep" }, f.context);
  const plan = await readWorkPlan(f.context);
  assert.equal(plan.title, "Passes: Security pass and Data pass, deep", "in Genesis's order");
  assert.deepEqual(workPlanPassItems(plan.text).map(({ text }) => text), ["Security pass: deep", "Data pass: deep"]);
  assert.equal(requestOf(f.sends[0]), "Security pass the whole app deeply.");
  await passDone(f);
  assert.equal(f.state().pass.id, "data-pass");
  await finish(f, "wait", { explanation: "1. Keep the old index? Recommended: no." });
  await f.service.send("session-1", { messageId: "again-1", message: "Run Security pass again.", passAction: "again", passId: "security-pass", submissionKind: "send" }, f.context);
  assert.equal(f.state().pass.id, "security-pass");
  assert.equal(f.state().passReply, undefined, "a Passes action is not an answer");
  assert.deepEqual(workPlanPassItems((await readWorkPlan(f.context)).text).map(({ checked }) => checked), [false, false]);
  await passDone(f);
  assert.equal(f.state().pass.id, "data-pass", "then the plan's next unticked pass");
  await passDone(f);
  assert.equal(f.state().status, "complete", "both passes Done: the plan is completed");
  // Restart from the first pass, on a plan at its passes with the first one Done.
  await publishPlanFixture(f.context, "Status: active\n# Bookings\n\n- [x] Book a slot\n\n## Passes\n\n- [x] Security pass: whole app\n- [ ] Deslop: whole app\n");
  await f.service.send("session-1", { messageId: "restart-1", message: "Restart the plan's passes from the first one.", passAction: "restart", submissionKind: "send" }, f.context);
  assert.equal(f.state().pass.id, "security-pass");
  assert.deepEqual(workPlanPassItems((await readWorkPlan(f.context)).text).map(({ checked }) => checked), [false, false]);
  await finish(f, "wait", { explanation: "1. Rotate the key? Recommended: yes." });
  // A pass the plan doesn't list can't run again; nothing is sent.
  const sent = f.sends.length;
  await assert.rejects(f.service.send("session-1", { messageId: "again-2", message: "Run UI pass again.", passAction: "again", passId: "ui-pass", submissionKind: "send" }, f.context),
    { code: "vibe64_assistant_routing_plan_pass_missing", delivery: "not-sent" });
  assert.equal(f.sends.length, sent);
});

test("a Senior chat's agent reviews its own plan: with passes it leaves it active and they run; a plain reply that reviewed it moves on too", async (t) => {
  for (const reported of [true, false]) {
    const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
    await publishPlanFixture(f.context, planWith(["Review: the plan's changes"]));
    await f.service.send("session-1", request, f.context);
    assert.equal(f.helperCalls(), 0);
    await f.source.commit("Required-name validation");
    await tickItems(f, "senior");
    if (reported) await finish(f, "complete");
    else await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.equal(f.state().stage, "pass", `reported ${reported}`);
    assert.equal(f.sends[1].input.genesisTask, "review");
    assert.equal(requestOf(f.sends[1]), since("Review", f.source.canonical));
  }
});

test("Junior's ticks leave the plan for Senior's review: in a Junior chat no pass runs, and Junior can't tick a pass", async (t) => {
  const f = await fixture(t, { mode: "junior" }, { readyPlan: false, source: true });
  await publishPlanFixture(f.context, planWith(["Review: the plan's changes"]));
  await f.service.send("session-1", request, f.context);
  await assert.rejects(reportOutcome(f, "complete", { involved: true }), /Only Senior completes a plan/u);
  const text = (await readWorkPlan(f.context)).text;
  await assert.rejects(writePlan(f, text.replace("- [ ] Review", "- [x] Review"), "junior"), { code: "vibe64_work_plan_pass_ticks_refused" });
  await tickItems(f, "junior");
  await finish(f, "handoff");
  assert.equal(f.state().status, "complete");
  assert.equal(f.sends.length, 1, "no pass and no Senior turn in a Junior chat");
  assert.equal((await readWorkPlan(f.context)).status, "active");
  assert.deepEqual(passNotices(f), []);
});

test("in Auto, Junior's full ticks still go to Senior's review before any pass", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await publishPlanFixture(f.context, planWith(["Review: the plan's changes"]));
  await f.service.send("session-1", request, f.context);
  await tickItems(f, "junior");
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
  assert.match(f.sends[1].input.message, /Senior review of the plan: /u);
});

test("no pass runs without a plan, with a plan without passes, or with a plan already at its passes or completed before the request", async (t) => {
  const reviewed = planWith(["Review: whole app"]).replace("- [~] Required", "- [x] Required");
  for (const [name, mode, plan] of [["no plan", "senior", null], ["no plan", "auto", null], ["a plan without passes", "senior", planWith([])],
    ["a plan already at its passes", "senior", reviewed],
    ["a plan completed before the request", "senior", "Status: completed\n# Done\n\n- [x] Required-name validation\n\n## Passes\n\n- [x] Review: whole app\n"]]) {
    const saves = [];
    const f = await fixture(t, { mode }, { source: true, readyPlan: false, onPlanCompleted: async () => { saves.push(true); return ""; } });
    if (plan) await publishPlanFixture(f.context, plan);
    await f.service.send("session-1", request, f.context);
    await f.source.commit();
    if ((await readWorkPlan(f.context))?.status === "active") await planChecked(f, "senior");
    await finish(f, "handoff", { involved: false });
    assert.equal(f.state().status, "complete", `${name} in ${mode}`);
    assert.equal(f.sends.length, 1, `${name} in ${mode}: the work ends after its own turn`);
    assert.deepEqual(passNotices(f), [], name);
    assert.deepEqual(saves, [true], `${name} in ${mode}: Automatically save changes saves it as before`);
  }
});

test("a new plan's Passes section starts with the chat's After a plan ticks; a plan Senior writes with its own Passes keeps them", async (t) => {
  const f = await fixture(t, { mode: "auto", afterPlan: ["review", "security-pass", "ui-pass", "deslop"], afterPlanDeep: ["deslop"] },
    { readyPlan: false, source: true });
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "senior", reason: "planning" }) });
  await f.service.send("session-1", { ...request, message: "Make the plan" }, f.context);
  const { plan, revisions } = await planCommands(f);
  const made = await plan({ operation: "new", text: "# Contact threads\n\n- [ ] One thread per contact\n" });
  assert.equal(made.text, "Status: active\n# Contact threads\n\n- [ ] One thread per contact\n\n## Passes\n\n" +
    "- [ ] Review: the plan's changes\n- [ ] Security pass: the plan's changes\n- [ ] UI pass: the plan's changes\n- [ ] Deslop: the plan's changes, deeply\n");
  const own = "# Contact threads\n\n- [ ] One thread per contact\n\n## Passes\n\n- [ ] Speed pass: whole app\n";
  assert.equal((await plan({ operation: "new", text: own, archiveCurrent: true, ...await revisions() })).text, `Status: active\n${own}`);
});

test("a steer whose words name a pass joins the running turn as written", async (t) => {
  const f = await fixture(t, { mode: "senior" }, { source: true });
  const plan = (await readWorkPlan(f.context)).text;
  f.agent.sessionState = async () => ({ turn: { active: true } });
  await f.service.send("session-1", { ...request, message: "Run the security pass", submissionKind: "steer" }, f.context);
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].input.message, "Run the security pass");
  assert.equal((await readWorkPlan(f.context)).text, plan);
});

test("Genesis's pass list is read only for a message that may ask for passes; typed words it can't check are an ordinary message", async (t) => {
  const plain = await fixture(t, { mode: "senior" }, { readyPlan: false });
  plain.passReads.failure = new Error("Genesis could not read this project.");
  await plain.service.send("session-1", { ...request, message: "Build the form." }, plain.context);
  assert.deepEqual([plain.passReads.count, plain.sends.length, plain.state().stage === "pass"], [0, 1, false]);
  assert.ok(plain.sends[0].input.message.includes("Build the form."));
  const typed = await fixture(t, { mode: "senior" }, { readyPlan: false });
  typed.passReads.failure = new Error("Genesis could not read this project.");
  await typed.service.send("session-1", { ...request, message: "Run the tests" }, typed.context);
  assert.deepEqual([typed.passReads.count, typed.sends.length, typed.state().stage === "pass"], [1, 1, false]);
  assert.ok(typed.sends[0].input.message.includes("Run the tests"));
  const listed = await fixture(t, { mode: "senior" }, { readyPlan: false });
  listed.passReads.failure = new Error("Genesis could not read this project.");
  await assert.rejects(listed.service.send("session-1", { ...request, message: "Security pass the whole app.", genesisTask: "security-pass", passRun: "whole" },
    listed.context), /Genesis could not read this project/u);
  await assert.rejects(listed.service.send("session-1", { ...request, messageId: "continue-1", message: "Continue the plan's passes.", passAction: "continue" },
    listed.context), /Genesis could not read this project/u);
  assert.equal(listed.sends.length, 0, "the Passes list's own Run and Continue are refused, not sent as words");
});

test("typed words name passes only as a request to run them", () => {
  const listing = { passes: GENESIS_PASSES, master: { passes: ["review", "security-pass", "data-pass", "quality-pass", "speed-pass", "ux-pass", "identity-pass", "ui-pass", "deslop"] } };
  for (const [message, expected] of [
    ["Security pass the whole app.", { ids: ["security-pass"], run: "whole" }],
    ["Deslop", { ids: ["deslop"], run: "" }],
    ["UI pass: the bookings pages", { ids: ["ui-pass"], run: "", section: "the bookings pages" }],
    ["Run Security, Data and Deslop", { ids: ["security-pass", "data-pass", "deslop"], run: "" }],
    ["Do the UX and UI passes deeply", { ids: ["ux-pass", "ui-pass"], run: "deep" }],
    ["Run every pass on the whole app", { ids: listing.master.passes, run: "whole" }],
    ["Run the Master pass", { ids: listing.master.passes, run: "deep" }],
    ["Start the speed pass since last completed", { ids: ["speed-pass"], run: "since-last" }],
    ["Do the review", { ids: ["review"], run: "" }]
  ]) assert.deepEqual(passesInMessage(message, listing), expected, message);
  for (const message of ["Do the UI", "Run all", "Run the tests", "What does the UI pass change?", "Start the data import", "Yes, implement it."]) {
    assert.equal(passesInMessage(message, listing), null, message);
  }
});

test("the Passes list shows the open plan's passes and the state of each", () => {
  const listing = { passes: GENESIS_PASSES };
  const plan = { status: "active", title: "Bookings", revision: "r1",
    text: "# Bookings\n\n- [x] Book a slot\n\n## Passes\n\n- [x] Review: the plan's changes\n- [ ] Security pass: whole app\n- [ ] Deslop: whole app\n" };
  const at = (fields) => ({ stage: "pass", pass: { id: "security-pass", title: "Security pass", item: "Security pass: whole app", request: "Security pass the whole app." }, ...fields });
  const states = (request) => planPassesView(plan, request, listing).passes.map(({ state }) => state);
  assert.deepEqual(planPassesView(plan, null, listing), { title: "Bookings", atPasses: true, passes: [
    { id: "review", title: "Review", scope: "the plan's changes", item: "Review: the plan's changes", done: true, state: "done" },
    { id: "security-pass", title: "Security pass", scope: "whole app", item: "Security pass: whole app", done: false, state: "" },
    { id: "deslop", title: "Deslop", scope: "whole app", item: "Deslop: whole app", done: false, state: "" }
  ] });
  assert.deepEqual(states(at({ status: "working" })), ["done", "running", ""]);
  assert.deepEqual(states(at({ status: "waiting", awaitingAnswer: true })), ["done", "needs-you", ""]);
  assert.deepEqual(states(at({ status: "waiting", stopped: true })), ["done", "paused", ""]);
  assert.deepEqual(states(at({ status: "waiting", pass: { title: "Security pass", item: "Security pass: whole app" } })), ["done", "blocked", ""]);
  assert.deepEqual(states(at({ status: "complete" })), ["done", "", ""]);
  assert.equal(planPassesView({ ...plan, status: "completed" }, null, listing), null);
  assert.equal(planPassesView({ ...plan, text: "# Bookings\n\n- [x] Book a slot\n" }, null, listing), null);
  assert.equal(planPassesView({ ...plan, text: plan.text.replace("- [x] Book", "- [ ] Book") }, null, listing).atPasses, false);
});

test("the base: a plan becoming current records HEAD only when none is recorded, a finished plan moves it to HEAD, and a commit the source lost or a rebase left behind falls back to the merge base", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { source: true, readyPlan: false });
  const { store } = f.context.runtime;
  const { session } = f.context;
  assert.equal(await afterPlanBase(session), f.source.canonical, "with none recorded: where the session's work leaves the canonical history");
  const first = await f.source.commit();
  await rememberAfterPlanBase(store, session, { onlyWhenUnset: true });
  assert.equal(f.metadata.after_plan_base, first);
  await f.source.commit();
  await rememberAfterPlanBase(store, session, { onlyWhenUnset: true });
  assert.equal(f.metadata.after_plan_base, first, "a recorded base stays when another plan becomes current");
  assert.equal(await afterPlanBase(session), first);
  f.metadata.after_plan_base = "f".repeat(40);
  assert.equal(await afterPlanBase(session), f.source.canonical, "a recorded commit the source no longer has is never used");
  // A Save that reconciles rebases the session's work onto newer canonical history: the recorded
  // commit still exists, outside HEAD's history, where a diff from it would hold others' work too.
  const git = (...args) => execFileSync("git", args, { cwd: f.source.source, encoding: "utf8" }).trim();
  f.metadata.after_plan_base = await f.source.head();
  git("reset", "--quiet", "--hard", f.source.canonical);
  git("commit", "--quiet", "--allow-empty", "-m", "Work saved by others");
  f.metadata.canonical_commit = git("rev-parse", "HEAD");
  await f.source.commit("The session's work, rebased");
  assert.equal(await afterPlanBase(session), f.metadata.canonical_commit, "a recorded commit a rebase left behind is never used");
  await rememberAfterPlanBase(store, session);
  assert.equal(f.metadata.after_plan_base, await f.source.head(), "a finished plan moves it to HEAD");
  f.metadata.after_plan_base = "";
  delete f.metadata.canonical_commit;
  assert.equal(await afterPlanBase(session), "", "no base: the passes don't run, rather than over the whole app");
});
