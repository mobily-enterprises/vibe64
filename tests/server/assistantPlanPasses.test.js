import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
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
// Genesis's passes as a refusal and the plan guidance list them: each exact title, quoted, in Genesis's order.
const listedTitles = (passes = GENESIS_PASSES) => {
  const titles = passes.map(({ title }) => `“${title}”`);
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
};
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
  assert.equal(notices.at(-1), "Run the full test suite?");
  // Genesis records only the whole-app run, and only after the whole-project checks pass: it waits for the answer.
  assert.deepEqual(f.state().wholeChecks, { status: "asked", plan: "Required-field validation", passes: ["ux-pass"] });
  for (const send of f.sends.slice(2)) {
    assert.match(send.input.message, /Run no whole-project checks, such as one whole run of the test suite, even where this pass's guidance asks for one: run the focused tests for what you changed\./u);
    assert.match(send.input.message, /never take this pass's PASS RECORD step: the turn the person's Yes starts records the plan's passes once every check passes\./u);
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

test("a Passes item that names a pass Genesis doesn't have holds the plan at it, naming Genesis's passes and the fix, never blaming the project's Genesis; renamed, Continue runs it", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  // A plan written before the plan command checked its Passes, or before Genesis changed.
  await implementAndReview(f, ["UX pass: whole app", "Deslop: whole app"]);
  assert.equal(f.sends.length, 2, "Deslop does not run in its place");
  const held = `UX pass can't run: the plan names “UX pass”, a pass Genesis doesn't have. Genesis's passes are ${listedTitles()}. ` +
    "Rename the plan's Passes item “UX pass: whole app” to one of them, then choose Continue in Passes.";
  assert.deepEqual([f.state().status, f.state().stage, f.state().error], ["waiting", "pass", held]);
  assert.ok(noticeTexts(f).includes(held));
  assert.doesNotMatch(held, /this project's Genesis/u);
  await writePlan(f, (await readWorkPlan(f.context)).text.replace("- [ ] UX pass: whole app", "- [ ] User experience pass: whole app"), "senior");
  await f.service.send("session-1", { messageId: "continue-1", message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" }, f.context);
  assert.equal(f.sends.at(-1).input.genesisTask, "ux-pass");
  assert.equal(f.state().pass.item, "User experience pass: whole app");
});

test("a Passes item's scope in words of the plan's own runs its pass over those words, also on Continue after Stop; an item with no scope runs over the plan's changes", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  // whs2's Review item, as Senior wrote it: no Genesis run names this scope, so the pass reads it as written.
  const scope = "the changes since commit fa01419e (the Work groups plan and this plan)";
  await implementAndReview(f, [`Review: ${scope}`, "Security pass", "Deslop: the billing screens, deeply"]);
  assert.deepEqual([f.sends.length, f.sends[2].input.genesisTask, requestOf(f.sends[2])], [3, "review", `Run the Review on ${scope}.`]);
  assert.deepEqual([f.state().stage, f.state().status, f.state().pass.item], ["pass", "working", `Review: ${scope}`]);
  const stopped = f.state();
  await f.service.stop("session-1", f.context);
  await f.service.afterTurn("session-1", end(stopped, "interrupted"), f.context);
  await f.service.send("session-1", { messageId: "continue-1", message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" }, f.context);
  assert.deepEqual([f.sends.at(-1).input.genesisTask, requestOf(f.sends.at(-1))], ["review", `Run the Review on ${scope}.`]);
  await passDone(f);
  assert.deepEqual([f.sends.at(-1).input.genesisTask, requestOf(f.sends.at(-1))],
    ["security-pass", since("Security pass", f.source.canonical)]);
  await passDone(f);
  assert.deepEqual([f.sends.at(-1).input.genesisTask, requestOf(f.sends.at(-1))], ["deslop", "Run the Deslop on the billing screens, deeply."]);
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

test("a pass in a session with connected repositories covers them: its turn names each copy and asks which repositories it covered", async (t) => {
  const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
  const commit = "a".repeat(40);
  f.metadata.connected_copies = JSON.stringify(Object.fromEntries(["ui-kit", "billing"].map((name) => [name, {
    repository: `example/${name}`, branch: "main", path: path.join(path.dirname(f.source.source), "connected", name),
    baseCommit: commit, canonicalCommit: commit
  }])));
  await f.service.send("session-1", { ...request, genesisTask: "security-pass", passRun: "whole", message: "Security pass the whole app." }, f.context);
  const { message } = f.sends[0].input;
  assert.match(message, /this session's own copies at `\.\.\/connected\/ui-kit` and `\.\.\/connected\/billing`, which you edit like this source and Save covers\./u);
  assert.match(message, /Say in your final reply which repositories it covered\./u);
  assert.equal(requestOf(f.sends[0]), "Security pass the whole app.");
});

test("every listing of a session's passes gives Genesis its connected copies' roots, so a deep run is sized over them too", async (t) => {
  const commit = "a".repeat(40);
  const connected = async (copies) => {
    const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
    const roots = copies.map((name) => path.join(path.dirname(f.source.source), "connected", name));
    if (roots.length) {
      f.metadata.connected_copies = JSON.stringify(Object.fromEntries(roots.map((root) => [path.basename(root), {
        repository: `example/${path.basename(root)}`, branch: "main", path: root, baseCommit: commit, canonicalCommit: commit
      }])));
    }
    // Each step must list the passes, and every listing carries the copies' roots.
    const listed = async (step, label) => {
      const before = f.passReads.options.length;
      await step();
      assert.ok(f.passReads.options.length > before, `${label} lists the passes`);
      assert.deepEqual(f.passReads.options.map(({ connectedRoots }) => connectedRoots), f.passReads.options.map(() => roots), label);
    };
    return { f, listed };
  };
  // A Senior turn's plan instructions name the pass titles.
  const turn = await connected(["ui-kit", "billing"]);
  await turn.listed(() => turn.f.service.send("session-1", request, turn.f.context), "a Senior turn");
  // A pass the request names, by its fields.
  const explicit = await connected(["ui-kit", "billing"]);
  await explicit.listed(() => explicit.f.service.send("session-1", { ...request, genesisTask: "security-pass", passRun: "deep", message: "Security pass the whole app deeply." }, explicit.f.context), "a named pass");
  // Several passes the request names, which become a plan's Passes, then the plan's next pass once the first is done.
  const plan = await connected(["ui-kit"]);
  await plan.listed(() => plan.f.service.send("session-1", { ...request, message: "Run Data pass and Security pass deeply.", passes: ["data-pass", "security-pass"], passRun: "deep" }, plan.f.context), "the passes a request names");
  await plan.listed(() => passDone(plan.f), "the plan's next pass");
  assert.equal(plan.f.state().pass.id, "data-pass");
  // A session without connected repositories gives Genesis none.
  const own = await connected([]);
  await own.listed(() => own.f.service.send("session-1", request, own.f.context), "a Senior turn without copies");
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

/** A plan an earlier request's Senior review already brought to its passes: its item proven, no pass run yet. */
const reviewedPlan = (passes) => planWith(passes).replace("- [~] Required-name", "- [x] Required-name");

for (const route of ["Implement plan", "a typed request to continue"]) test(`a plan found at its passes runs them once Senior's review completes it again, unchanged (${route}), and is saved only after the last`, async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true, onPlanCompleted: async () => {
    saves.push((await planHistory(f)).length);
    return "Saved automatically.";
  } });
  const passes = ["Review: the plan's changes", "Security pass: the plan's changes"];
  await publishPlanFixture(f.context, reviewedPlan(passes));
  const plan = await readWorkPlan(f.context);
  await f.service.send("session-1", route === "Implement plan"
    ? { messageId: "implement-1", message: "Implement the saved plan. I authorize implementation within its agreed scope.", planRevision: plan.revision, submissionKind: "send" }
    : { messageId: "continue-1", message: "Continue the plan!", submissionKind: "send" }, f.context);
  // Junior finds nothing left to build; Senior's review finds nothing new and reports complete, the plan unchanged.
  await finish(f, "handoff");
  assert.equal(f.sends[1].input.displayMessage, "Senior reviews the plan.");
  await finish(f, "complete");
  assert.equal((await readWorkPlan(f.context)).revision, plan.revision, "the review changed nothing");
  assert.deepEqual([f.state().stage, f.state().pass?.id, f.state().status], ["pass", "review", "working"], "the plan's first pass starts");
  assert.equal(f.sends[2].input.genesisTask, "review");
  assert.equal(requestOf(f.sends[2]), since("Review", f.source.canonical));
  assert.deepEqual(saves, [], "nothing is saved before the passes");
  assert.ok(!noticeTexts(f).includes(SAVE_STARTED));
  await passDone(f);
  assert.equal(f.state().pass.id, "security-pass");
  await passDone(f);
  assert.equal(await readWorkPlan(f.context), null);
  assert.deepEqual(saves, [1], "the plan is completed, archived and saved once, after its last pass");
});

test("a planning turn that finds the plan already at its passes reports it complete and the passes run; planning that brings it there itself still can't", async (t) => {
  for (const found of [true, false]) {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
    const passes = ["Review: the plan's changes"];
    await publishPlanFixture(f.context, found ? reviewedPlan(passes) : planWith(passes));
    f.router.respond = async () => ({ ok: true, text: '{"mode":"senior","reason":"planning"}' });
    await f.service.send("session-1", { messageId: "go-1", message: "OK do them!", submissionKind: "send" }, f.context);
    assert.deepEqual([f.state().stage, f.state().resolvedMode], ["planning", "senior"]);
    if (!found) {
      await tickItems(f, "senior");
      await assert.rejects(reportOutcome(f, "complete", { involved: true }), { code: "vibe64_assistant_workflow_planning_outcome_refused" });
      continue;
    }
    // Nothing is left to implement: handoff is refused, naming the outcome that runs the passes.
    await assert.rejects(reportOutcome(f, "handoff", { involved: true }),
      { code: "vibe64_assistant_workflow_planning_plan_at_passes", message: /report complete/u });
    // Completing needs the plan read, as any plan's completion does.
    await assert.rejects(reportOutcome(f, "complete"), { code: "vibe64_assistant_workflow_planning_plan_at_passes" });
    await finish(f, "complete");
    assert.deepEqual([f.state().stage, f.state().pass?.id, f.state().status], ["pass", "review", "working"]);
    assert.equal(f.sends[1].input.genesisTask, "review");
  }
});

test("\"Run the Review pass\" while the plan's Review is still to run is the plan's own Review: no second Review joins its Passes", async (t) => {
  const passes = ["Review: the plan's changes", "Security pass: the plan's changes"];
  for (const reviewed of [true, false]) {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
    await publishPlanFixture(f.context, reviewed ? reviewedPlan(passes) : planWith(passes));
    const before = (await readWorkPlan(f.context)).revision;
    await f.service.send("session-1", { messageId: "run-1", message: "Run the Review pass", submissionKind: "send" }, f.context);
    assert.equal((await readWorkPlan(f.context)).revision, before, `reviewed ${reviewed}: the plan's Passes stay as they are`);
    assert.ok(!noticeTexts(f).some((text) => text.startsWith("Added to the plan's Passes")), `reviewed ${reviewed}`);
    assert.equal(f.helperCalls(), 0);
    if (reviewed) {
      // The plan at its passes: the message continues them, from its next pass.
      assert.deepEqual([f.state().stage, f.state().pass?.item], ["pass", passes[0]]);
      assert.equal(requestOf(f.sends[0]), since("Review", f.source.canonical));
      continue;
    }
    // Before Senior's review, Senior says Review is in the plan already and runs nothing.
    assert.equal(f.sends[0].input.genesisTask, undefined);
    assert.match(f.sends[0].input.message,
      /\[Vibe64: Review is in the current plan's Passes already: they run once Senior has reviewed the plan\. Tell the person so/u);
  }
});

test("a reply to Senior's review of the plan that waited for the person goes back to that review on Senior without Router; done, the plan runs its passes", async (t) => {
  const passes = ["Review: the plan's changes", "Security pass: the plan's changes"];
  const QUESTION = "The validation is built.\n\n[1] Keep blank names out of the export too?\nPossible answers:\n- Yes (recommended)\n- No";
  for (const asks of [true, false]) {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
    await publishPlanFixture(f.context, planWith(passes));
    await f.service.send("session-1", request, f.context);
    await f.source.commit("Required-name validation");
    await planChecked(f);
    await finish(f, "handoff");
    // Senior's review needs the person: a numbered question in its reply, or a reported wait.
    await reportOutcome(f, "wait", { involved: true, explanation: "1. Keep blank names out of the export too? Recommended: yes." });
    const text = asks ? QUESTION : "Actual final explanation.";
    const review = f.state();
    f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: review.followup?.messageId || review.messageId, text: "Senior reviews the plan." },
      assistant: { text }, messages: [{ role: "assistant", text }] }];
    await f.service.afterTurn("session-1", end(review), f.context);
    assert.deepEqual([f.state().status, f.state().stage, f.state().awaitingAnswer === true], ["waiting", "review", asks], `asks ${asks}`);
    const routed = f.helperCalls();
    await f.service.send("session-1", { messageId: "reply-1", message: "1: yes, keep them out.", submissionKind: "send" }, f.context);
    assert.equal(f.helperCalls(), routed, `asks ${asks}: the reply is not routed`);
    const reply = f.sends.at(-1);
    assert.equal(reply.selection.modelId, f.assignments.senior.modelId);
    assert.equal(reply.input.genesisTask, undefined, "Senior's review of the plan runs no Genesis task");
    assert.ok(reply.input.message.includes("1: yes, keep them out.\n\n"), "the person's reply comes first");
    assert.match(reply.input.message, /Senior review of the plan: /u);
    assert.deepEqual([f.state().messageId, f.state().stage, f.state().reason, f.state().planInvolved], ["reply-1", "review", "review", true]);
    // Senior ticks the plan's items and reports complete: the plan runs its passes.
    await tickItems(f);
    await finish(f, "complete");
    assert.deepEqual([f.state().stage, f.state().pass?.item, (await readWorkPlan(f.context)).status], ["pass", passes[0], "active"], `asks ${asks}`);
  }
});

test("only Main chat's own requests are told Vibe64 runs the plan's passes: a goal's turns are told the passes wait", async (t) => {
  for (const goal of [false, true]) {
    const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
    await publishPlanFixture(f.context, planWith(["Review: the plan's changes"]));
    if (goal) {
      const { pinned } = await f.service.prepareGoal("session-1", { action: "set", objective: "Finish validation" }, f.context);
      f.metadata.assistant_routing_goal = JSON.stringify({ ...pinned, status: "active" });
      f.agent.readGoal = async () => ({ status: "available", goal: { status: "active", objective: pinned.objective } });
    }
    await f.service.send("session-1", request, f.context);
    const { message } = f.sends[0].input;
    assert.equal(f.state().afterPlan === null, goal, `goal ${goal}: a goal's request never starts the plan's passes`);
    assert.equal(/This request runs no plan passes \(it is a goal, a temporary chat or a lesson\)/u.test(message), goal, `goal ${goal}`);
    assert.equal(/having full-ticked every item outside a plan's Passes or reported complete on a plan already there, Vibe64 runs its Passes items/u
      .test(message), !goal, `goal ${goal}`);
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

test("the plan command refuses a Passes item that names a pass Genesis doesn't have, naming it and Genesis's exact titles, so the AI renames it in the same turn", async (t) => {
  const f = await fixture(t, { mode: "auto", afterPlan: ["review", "security-pass"] }, { readyPlan: false, source: true });
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "senior", reason: "planning" }) });
  await f.service.send("session-1", { ...request, message: "Run the six passes" }, f.context);
  const { plan, revisions } = await planCommands(f);
  const asked = "# Contact threads\n\n- [ ] One thread per contact\n\n## Passes\n\n- [ ] Review: the plan's changes\n- [x] UI pass: the plan's changes\n" +
    "- [ ] UX pass: the plan's changes\n";
  await assert.rejects(plan({ operation: "new", text: asked }), {
    code: "vibe64_work_plan_pass_unknown",
    message: "The plan's Passes item “UX pass: the plan's changes” names a pass Genesis doesn't have: nothing changed. " +
      `Genesis's passes are ${listedTitles()}. Rename the item to one of them exactly, keeping its scope (- [ ] <title>: <scope>), and write the plan again.`
  });
  assert.equal(await readWorkPlan(f.context), null, "nothing is written");
  const made = await plan({ operation: "new", text: asked.replace("UX pass:", "User experience pass:") });
  assert.deepEqual(workPlanPassItems(made.text).map(({ title }) => title), ["Review", "UI pass", "User experience pass"]);
  // A write that adds or changes items is checked the same way, every wrong item named at once.
  const added = made.text.replace("- [ ] Review: the plan's changes", "- [ ] Reviews: the plan's changes") + "- [ ] Sec pass: whole app\n";
  await assert.rejects(plan({ operation: "write", text: added, ...await revisions() }), {
    code: "vibe64_work_plan_pass_unknown",
    message: /^The plan's Passes items “Reviews: the plan's changes” and “Sec pass: whole app” name passes Genesis doesn't have: nothing changed\. .* Rename each item /u
  });
  // An item the plan already holds is not refused when Genesis changes later: the pass turn says so when it reaches it.
  f.genesis.passes = GENESIS_PASSES.filter(({ id }) => id !== "ux-pass");
  const ticked = await plan({ operation: "write", text: made.text.replace("- [ ] One thread", "- [~] One thread"), ...await revisions() });
  assert.match(ticked.text, /- \[~\] One thread per contact/u);
  // Genesis's list is read only for a write that adds or changes a Passes item.
  const reads = f.passReads.count;
  await plan({ operation: "write", text: ticked.text.replace("- [~] One thread", "- [x] One thread"), ...await revisions() });
  assert.equal(f.passReads.count, reads);
});

test("a new plan's After a plan passes and Senior's plan guidance take each pass's exact title from Genesis's list, never a list of Vibe64's own", async (t) => {
  const f = await fixture(t, { mode: "auto", afterPlan: ["review", "security-pass", "ux-pass"] }, { readyPlan: false, source: true });
  const renamed = GENESIS_PASSES.map((pass) => pass.id === "ux-pass" ? { ...pass, title: "Usability pass" } : pass);
  f.genesis.passes = renamed;
  f.router.respond = async () => ({ ok: true, text: JSON.stringify({ mode: "senior", reason: "planning" }) });
  await f.service.send("session-1", { ...request, message: "Make the plan" }, f.context);
  const guidance = f.sends[0].input.message;
  assert.ok(guidance.includes(`one checklist item each (- [ ] <pass title>, optionally followed by ": " and what it should check, which you leave off ` +
    `for the plan's changes, such as - [ ] ${renamed[0].title} or - [ ] ${renamed[0].title}: the billing screens). ` +
    `<pass title> is one of Genesis's passes, written exactly as Genesis titles it: ${listedTitles(renamed)}; never a short name or other words for one.`), guidance);
  assert.ok(guidance.includes("plan new and write refuse an item that names a pass Genesis doesn't have, and list Genesis's passes: rename it and write again."));
  assert.doesNotMatch(guidance, /User experience pass/u, "no title Genesis doesn't list");
  const { plan } = await planCommands(f);
  const made = await plan({ operation: "new", text: "# Contact threads\n\n- [ ] One thread per contact\n" });
  assert.deepEqual(workPlanPassItems(made.text).map(({ text }) => text),
    ["Review: the plan's changes", "Security pass: the plan's changes", "Usability pass: the plan's changes"]);
  // Junior never changes Passes: its guidance names no titles and reads no list.
  const junior = await fixture(t, { mode: "junior" }, { readyPlan: false });
  await junior.service.send("session-1", { ...request, message: "Build the form." }, junior.context);
  assert.equal(junior.passReads.count, 0);
  assert.ok(junior.sends[0].input.message.includes("<pass title> being a pass's exact title in Genesis's list, never a short name or other words for one"));
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

test("Genesis's pass list is read for a message only when it may ask for passes, and for Senior's plan guidance; typed words it can't check are an ordinary message", async (t) => {
  const plain = await fixture(t, { mode: "junior" }, { readyPlan: false });
  plain.passReads.failure = new Error("Genesis could not read this project.");
  await plain.service.send("session-1", { ...request, message: "Build the form." }, plain.context);
  assert.deepEqual([plain.passReads.count, plain.sends.length, plain.state().stage === "pass"], [0, 1, false]);
  assert.ok(plain.sends[0].input.message.includes("Build the form."));
  // Senior's plan guidance reads the list for the passes' exact titles; a list it can't read names none, and the turn goes.
  const senior = await fixture(t, { mode: "senior" }, { readyPlan: false });
  senior.passReads.failure = new Error("Genesis could not read this project.");
  await senior.service.send("session-1", { ...request, message: "Build the form." }, senior.context);
  assert.deepEqual([senior.passReads.count, senior.sends.length, senior.state().stage === "pass"], [1, 1, false]);
  assert.ok(senior.sends[0].input.message.includes("<pass title> being a pass's exact title in Genesis's list"));
  const typed = await fixture(t, { mode: "senior" }, { readyPlan: false });
  typed.passReads.failure = new Error("Genesis could not read this project.");
  await typed.service.send("session-1", { ...request, message: "Run the tests" }, typed.context);
  assert.deepEqual([typed.passReads.count, typed.sends.length, typed.state().stage === "pass"], [2, 1, false]);
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
