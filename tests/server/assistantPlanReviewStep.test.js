import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { planPassesView } from "../../packages/vibe64-terminals/src/server/planPasses.js";
import { workPlanStatusLine, workPlanStep } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";
import { assistantRoutingStatusLabel } from "../../packages/vibe64-runtime/src/shared/assistantRouting.js";

// A plan's review step, through the real routing service: once every item outside Passes is built, one Senior turn
// reviews the plan and, when the plan's next pass is its Review, runs that pass too, so the plan's changes are reviewed
// once. In Auto after Junior's implementation, and in a Senior chat reviewing its own built plan.

const request = { messageId: "request-1", message: "Execute the plan", submissionKind: "send" };
const end = (state) => ({ payload: { agentRun: { active: false, state: "completed", providerTurnId: state.turnId } } });
const since = (title, base) => `${title}: the changes since base commit ${base}, judged against the whole app.`;
// The request a turn sends: its message's last paragraph, where Genesis reads it.
const requestOf = (send) => send.input.message.split("\n\n").at(-1);

/** A plan whose one item Junior has built, and whose Passes section lists these items. */
const planWith = (passes) => "Status: active\n# Required-field validation\n\nReject a blank name.\n\n- [~] Required-name validation\n\n" +
  "## Technical details\nAdd the check to src/form.js.\n" + (passes.length ? `\n## Passes\n\n${passes.map((item) => `- [ ] ${item}`).join("\n")}\n` : "");

async function writePlan(f, text, role = "review", options = {}) {
  const plan = await readWorkPlan(f.context);
  return manageWorkPlan(f.context, { operation: "write", text, expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" },
    role, options);
}
const tick = async (f, line, role = "review", options = {}) =>
  writePlan(f, (await readWorkPlan(f.context)).text.replace(`- [ ] ${line}`, `- [x] ${line}`).replace(`- [~] ${line}`, `- [x] ${line}`), role, options);

/** The turn reports its outcome, its final reply is delivered, and it ends. */
async function finish(f, decision, options = {}) {
  await reportOutcome(f, decision, { involved: true, ...options });
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: "Execute the plan" },
    assistant: { text: "Actual final explanation." }, messages: [{ role: "assistant", text: "Actual final explanation." }] }];
  await f.service.afterTurn("session-1", end(state), f.context);
}

/** What each turn the request sent ran: the implementation, Senior's review of the plan (with the Review pass), or a pass. */
function turns(f) {
  return f.sends.map(({ input }) => {
    if (/^Senior reviews the plan/u.test(input.displayMessage || "")) return input.genesisTask === "review" ? "Senior review + Review" : "Senior review";
    return input.genesisTask || "implementation";
  });
}

/**
 * Runs the plan's steps to the end, each turn doing what its message asks: Senior's review full-ticks the plan's item,
 * and the Review item too when its turn runs Genesis's Review, and completes a plan without Passes items; each pass
 * ticks its own item.
 */
async function runToEnd(f) {
  for (let step = 0; f.state().status === "working" && step < 8; step += 1) {
    const send = f.sends.at(-1);
    if (f.state().stage === "pass") {
      await tick(f, f.state().pass.item, "pass", { passItem: f.state().pass.item });
    } else {
      await tick(f, "Required-name validation");
      if (send.input.genesisTask === "review") await tick(f, "Review: the plan's changes");
      const plan = await readWorkPlan(f.context);
      if (!plan.text.includes("## Passes")) {
        await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, "review");
      }
    }
    await finish(f, "complete");
  }
}

test("Auto: Senior's review of a plan whose next pass is Review runs that pass in the same turn, so the plan's changes are reviewed once", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await publishPlanFixture(f.context, planWith(["Review: the plan's changes", "Security pass: the plan's changes"]));
  await f.service.send("session-1", request, f.context);
  await f.source.commit("Required-name validation");
  // Junior's turn already shows its item built: it records that it checked the plan.
  const built = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "checked", expectedRevision: built.revision, expectedProgressRevision: built.progressRevision || "" }, "junior");
  await finish(f, "handoff");
  await runToEnd(f);
  assert.deepEqual(turns(f), ["implementation", "Senior review + Review", "security-pass"], "one review turn, never a Senior review and then a Review pass");
  const review = f.sends[1];
  assert.equal(review.selection.modelId, f.assignments.senior.modelId);
  assert.equal(review.input.displayMessage, "Senior reviews the plan and runs its Review pass.");
  // Genesis's Review request word for word, the message's last paragraph, so Genesis recognises the pass's run.
  assert.equal(requestOf(review), since("Review", f.source.canonical));
  assert.equal(review.input.automaticGenesisTask, true);
  assert.equal(f.state().status, "complete");
  assert.equal(await readWorkPlan(f.context), null, "the plan is completed and archived after its last pass");
});

test("a Senior chat's review of its own built plan runs its Review pass in the same turn", async (t) => {
  const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
  await publishPlanFixture(f.context, planWith(["Review: the plan's changes"]).replace("- [~] Required", "- [ ] Required"));
  await f.service.send("session-1", { messageId: "request-1", message: "Build the validation.", submissionKind: "send" }, f.context);
  await f.source.commit("Required-name validation");
  const { plan, revisions } = await planCommands(f);
  await plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace("- [ ] Required", "- [~] Required"), ...await revisions() });
  // Senior's implementation turn ends asking whether to run the passes: Vibe64 starts Senior's review of the plan instead.
  await reportOutcome(f, "wait", { involved: true, explanation: "Should I run the passes before saving, or save now?" });
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: "request-1", text: "Build the validation." },
    messages: [{ role: "assistant", text: "Built. Should I run the passes before saving, or save now?" }] }];
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  await runToEnd(f);
  assert.deepEqual(turns(f), ["implementation", "Senior review + Review"], "one review turn, never a Senior review and then a Review pass");
  assert.equal(requestOf(f.sends[1]), since("Review", f.source.canonical));
  assert.equal(f.state().status, "complete");
  assert.equal(await readWorkPlan(f.context), null);
});

/** Auto's work on the plan: Junior builds its item, checks the plan and hands off to Senior's review. */
async function implement(f, passes, plan = planWith(passes)) {
  await publishPlanFixture(f.context, plan);
  await f.service.send("session-1", request, f.context);
  await f.source.commit("Required-name validation");
  const built = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "checked", expectedRevision: built.revision, expectedProgressRevision: built.progressRevision || "" }, "junior");
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
}

test("a plan whose Passes has no Review next keeps Senior's review alone: none at all, or Review later in the list", async (t) => {
  for (const [passes, expected] of [
    [["Security pass: the plan's changes"], ["implementation", "Senior review", "security-pass"]],
    [[], ["implementation", "Senior review"]],
    [["Security pass: the plan's changes", "Review: the plan's changes"], ["implementation", "Senior review", "security-pass", "review"]]
  ]) {
    const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
    await implement(f, passes);
    const review = f.sends[1];
    assert.equal(review.input.displayMessage, "Senior reviews the plan.", passes.join(", "));
    assert.equal(review.input.genesisTask, undefined, "Senior's review alone renders no Genesis task");
    assert.match(review.input.message, /Senior review of the plan: /u);
    assert.match(review.input.message, /This turn reviews the plan only: run no pass\./u);
    assert.equal(f.state().reviewPass, undefined);
    await runToEnd(f);
    assert.deepEqual(turns(f), expected, passes.join(", ") || "no passes");
  }
});

test("Senior's review running the Review pass is Done only when both hold, and each refusal says what is open", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implement(f, ["Review: the plan's changes", "Security pass: the plan's changes"]);
  await tick(f, "Review: the plan's changes");
  await assert.rejects(reportOutcome(f, "complete", { involved: true }), {
    code: "vibe64_assistant_workflow_plan_incomplete",
    message: "This review runs the plan's Review pass too, and is Done once both are ticked: verify and full-tick every item of the exact agreed plan outside its Passes, then report complete."
  });
  await writePlan(f, (await readWorkPlan(f.context)).text.replace("- [x] Review", "- [ ] Review"));
  await assert.rejects(reportOutcome(f, "complete", { involved: true }), {
    code: "vibe64_assistant_workflow_plan_incomplete",
    message: /, and its Passes item “Review: the plan's changes” once everything in the pass's scope is fixed and proven, then report complete\.$/u
  });
  await tick(f, "Required-name validation");
  await assert.rejects(reportOutcome(f, "complete", { involved: true }), {
    code: "vibe64_assistant_workflow_review_pass_unticked",
    message: "Every item outside the plan's Passes is proven, but this review runs the plan's Review pass too: full-tick its Passes item " +
      "“Review: the plan's changes” (- [x] Review: the plan's changes) once everything in its scope is fixed and proven, then report complete."
  });
  await tick(f, "Review: the plan's changes");
  await finish(f, "complete");
  assert.deepEqual([f.state().stage, f.state().pass.id, f.state().reviewPass], ["pass", "security-pass", undefined]);
});

test("the review step says it is one step: its label, status, plan line and Passes list name Senior's review and the Review pass", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implement(f, ["Review: the plan's changes", "Security pass: the plan's changes"]);
  const review = f.sends[1];
  assert.equal(review.input.turnMetadata.actorLabel, "Senior review and Review pass");
  assert.equal(review.trigger, "follow-up:review");
  assert.match(assistantRoutingStatusLabel(f.state()), /^Reviewing the plan and its Review pass · /u);
  // While its turn runs, before and after it ticks the plan's items, the plan line names the one step.
  for (const ticked of [false, true]) {
    if (ticked) await tick(f, "Required-name validation");
    const plan = await readWorkPlan(f.context);
    assert.equal(workPlanStatusLine(workPlanStep(plan), { request: f.state() }), "Plan: Senior review and Review pass", `items ticked ${ticked}`);
    assert.deepEqual(planPassesView(plan, f.state(), f.genesis).passes.map(({ state }) => state), ["running", ""], `items ticked ${ticked}`);
  }
  await tick(f, "Review: the plan's changes");
  await finish(f, "complete");
  assert.equal(workPlanStatusLine(workPlanStep(await readWorkPlan(f.context)), { request: f.state() }), "Plan: pass Security (2 of 2)");
});

test("rework Senior's review hands back to Junior returns to the same review step, which still runs the plan's Review", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implement(f, ["Review: the plan's changes", "Security pass: the plan's changes"]);
  await finish(f, "handoff", { explanation: "The blank-name check misses whitespace: Junior reworks it." });
  assert.deepEqual([f.state().stage, f.state().resolvedMode, f.state().reviewPass], ["implementation", "junior", undefined]);
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
  await runToEnd(f);
  assert.deepEqual(turns(f), ["implementation", "Senior review + Review", "implementation", "Senior review + Review", "security-pass"]);
});

test("a plan already past Senior's review, its request in a Review pass, just goes on: the pass runs as its own turn, then the next", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  // Senior's review full-ticked the items before this release, and the plan's Review pass is next.
  await publishPlanFixture(f.context, planWith(["Review: the plan's changes", "Security pass: the plan's changes"]).replace("- [~] Required", "- [x] Required"));
  await f.service.send("session-1", { messageId: "continue-1", message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" }, f.context);
  assert.deepEqual([f.state().stage, f.state().pass.id], ["pass", "review"]);
  assert.equal(f.sends[0].input.displayMessage, "Continue the plan's passes.");
  assert.equal(workPlanStatusLine(workPlanStep(await readWorkPlan(f.context)), { request: f.state() }), "Plan: pass Review (1 of 2)");
  await runToEnd(f);
  assert.deepEqual(turns(f), ["review", "security-pass"], "no Senior review runs again");
  assert.equal(f.state().status, "complete");
});

test("a review decided before this release (its request names no Review pass) is accepted as before, and the plan's Review then runs once as its own pass", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  await implement(f, ["Review: the plan's changes", "Security pass: the plan's changes"]);
  // The request as an earlier release saved it, mid-way through Senior's review: no reviewPass.
  const saved = f.state();
  delete saved.reviewPass;
  f.metadata.assistant_routing_request = JSON.stringify(saved);
  await tick(f, "Required-name validation");
  await finish(f, "complete");
  assert.deepEqual([f.state().stage, f.state().pass.id], ["pass", "review"], "one extra Review pass, once");
  await runToEnd(f);
  assert.deepEqual(turns(f).slice(2), ["review", "security-pass"]);
});

test("Senior's review running the Review pass covers the session's connected copies, as the pass's own turn would", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  const commit = "a".repeat(40);
  f.metadata.connected_copies = JSON.stringify({ "ui-kit": { repository: "example/ui-kit", branch: "main",
    path: `${path.dirname(f.source.source)}/connected/ui-kit`, baseCommit: commit, canonicalCommit: commit } });
  await implement(f, ["Review: the plan's changes"]);
  assert.match(f.sends[1].input.message, /this session's own copies at `\.\.\/connected\/ui-kit`, which you edit like this source and Save covers\./u);
  assert.equal(requestOf(f.sends[1]), since("Review", f.source.canonical), "Genesis's request stays last");
  // A review alone runs no pass, so it is told nothing of them.
  const alone = await fixture(t, { mode: "auto" }, { readyPlan: false, source: true });
  alone.metadata.connected_copies = f.metadata.connected_copies;
  await implement(alone, ["Security pass: the plan's changes"]);
  assert.doesNotMatch(alone.sends[1].input.message, /connected repositories/u);
});

test("a Senior chat's review that runs the Review pass and ends without an outcome moves the plan on only once both are ticked, never into a second Review", async (t) => {
  for (const ticks of [["Required-name validation"], ["Required-name validation", "Review: the plan's changes"]]) {
    const f = await fixture(t, { mode: "senior" }, { readyPlan: false, source: true });
    await publishPlanFixture(f.context, planWith(["Review: the plan's changes", "Security pass: the plan's changes"]).replace("- [~] Required", "- [ ] Required"));
    await f.service.send("session-1", { messageId: "request-1", message: "Build the validation.", submissionKind: "send" }, f.context);
    await f.source.commit("Required-name validation");
    const { plan, revisions } = await planCommands(f);
    await plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace("- [ ] Required", "- [~] Required"), ...await revisions() });
    // Senior's implementation turn ends asking whether to run the passes: Vibe64 starts Senior's review of the plan instead.
    await reportOutcome(f, "wait", { involved: true, explanation: "Should I run the passes before saving, or save now?" });
    f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: "request-1", text: "Build the validation." },
      messages: [{ role: "assistant", text: "Built. Should I run the passes before saving, or save now?" }] }];
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.deepEqual([f.state().stage, f.state().planReview, f.state().reviewPass?.item], ["review", true, "Review: the plan's changes"]);
    // The review's turn ticks, then ends with a plain reply: no outcome reported.
    for (const line of ticks) await tick(f, line);
    f.context.runtime.store.readConversationTail = async () => [{ user: { text: f.state().followup.displayMessage },
      messages: [{ role: "assistant", text: "Reviewed." }], assistant: { text: "Reviewed." } }];
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.deepEqual(turns(f), ["implementation", "Senior review + Review"], `${ticks.join(", ")}: no Review turn of its own`);
    if (ticks.length === 1) {
      assert.equal(f.state().status, "complete", "an unfinished review step is an ordinary reply");
      assert.equal(workPlanStatusLine(workPlanStep(await readWorkPlan(f.context)), { request: f.state() }),
        "Plan: ready for Senior review and Review pass, ask Senior to start it");
    } else {
      // Done: the plan moves on to its next pass, Security (here held for Continue, as for any plain review's reply).
      assert.deepEqual([f.state().stage, f.state().pass.id], ["pass", "security-pass"]);
    }
  }
});
