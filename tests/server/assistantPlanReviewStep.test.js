import assert from "node:assert/strict";
import test from "node:test";
import { fixture, planCommands, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

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
 * and the Review item too when its turn runs Genesis's Review; each pass ticks its own item.
 */
async function runToEnd(f) {
  for (let step = 0; f.state().status === "working" && step < 8; step += 1) {
    const send = f.sends.at(-1);
    if (f.state().stage === "pass") {
      await tick(f, f.state().pass.item, "pass", { passItem: f.state().pass.item });
    } else {
      await tick(f, "Required-name validation");
      if (send.input.genesisTask === "review") await tick(f, "Review: the plan's changes");
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
