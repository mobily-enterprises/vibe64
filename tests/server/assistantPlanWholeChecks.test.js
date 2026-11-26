import assert from "node:assert/strict";
import test from "node:test";
import { fixture, publishPlanFixture, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { assistantRoutingNotice } from "@local/vibe64-runtime/shared/assistantRoutingNotice";

// Loaded so that, without the module, each test fails on its own check rather than the file failing to load.
const wholeChecks = await import("@local/vibe64-runtime/shared/assistantWholeChecks").catch(() => ({}));
const {
  ASSISTANT_WHOLE_CHECKS_INSTRUCTION, WHOLE_CHECKS_OFFERED_NOTE, WHOLE_CHECKS_QUESTION, WHOLE_CHECKS_YES_MESSAGE,
  assistantWholeChecksDeclinedNotice, assistantWholeChecksInstructions
} = wholeChecks;
const serverChecks = await import("../../packages/vibe64-terminals/src/server/assistantWholeChecks.js").catch(() => ({}));
const { answerWholeChecks, askWholeChecks } = serverChecks;

// No step of a plan runs the whole-project checks, Senior's review included. Once the plan is finished (completed,
// archived and, with Automatically save changes on, saved), Vibe64 asks the person once whether to run them: Yes runs
// one Senior turn that runs them and fixes what they find as new work, saved like any other; No runs nothing. Either
// answer, or any other message, ends the question for good. Through the real routing service.

const request = { messageId: "request-1", message: "Execute the plan", submissionKind: "send" };
const end = (state) => ({ payload: { agentRun: { active: false, state: "completed", providerTurnId: state.turnId } } });
/** The turn reports its outcome, its final reply is delivered, and it ends. */
async function finish(f, decision, options = {}) {
  await reportOutcome(f, decision, { involved: true, ...options });
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: "Execute the plan" },
    assistant: { text: "Actual final explanation." }, messages: [{ role: "assistant", text: "Actual final explanation." }] }];
  await f.service.afterTurn("session-1", end(state), f.context);
}
const noticeTexts = (f) => [...f.notices.values()].map((turn) => turn.system.text);
const QUESTION = "The plan is finished. Run the whole-project checks once now, on the finished plan's work? They are the checks the project " +
  "runs as a whole, such as one whole run of the test suite, and can take a long time. Choose Yes or No above the message box.";
const DECLINED = "Whole-project checks not run. Vibe64 won't ask again for this plan.";
const yes = (messageId) => ({ messageId, message: WHOLE_CHECKS_YES_MESSAGE, wholeChecks: "run", submissionKind: "send" });
const no = (asked) => ({ messageId: asked.messageId, message: asked.input.message, reviewAction: "skip-checks" });
const notAsked = { code: "vibe64_assistant_routing_whole_checks_not_asked" };

// A plan without passes: Senior's review is its last step.
const PLAN = "Status: active\n# Required-field validation\n\nReject a blank name.\n\n- [~] Required-name validation\n\n" +
  "## Technical details\nAdd the check to src/form.js.\n";

async function change(f, operation, role, fields = {}) {
  const plan = await readWorkPlan(f.context);
  return manageWorkPlan(f.context, { operation, expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "", ...fields }, role);
}
const writePlan = async (f, edit, role) => change(f, "write", role, { text: edit((await readWorkPlan(f.context)).text) });

/** Auto: Junior builds the plan's work and hands off; Senior's review is the next turn. */
async function toReview(t, preferences, plan = PLAN) {
  const saves = [];
  const f = await fixture(t, preferences, { readyPlan: false, source: true, onPlanCompleted: async () => {
    saves.push(f.state().status);
    return "Saved automatically.";
  } });
  await publishPlanFixture(f.context, plan);
  await f.service.send("session-1", request, f.context);
  await f.source.commit("Required-name validation");
  await change(f, "checked", "junior");
  await finish(f, "handoff");
  assert.equal(f.state().stage, "review");
  return { f, saves };
}

/** Senior's review proves the item and completes the plan: the plan is finished. */
async function finishedPlan(t, preferences = { mode: "auto" }) {
  const { f, saves } = await toReview(t, preferences);
  await writePlan(f, (text) => text.replace("- [~] Required-name", "- [x] Required-name"), "review");
  await change(f, "complete", "review");
  await finish(f, "complete");
  return { f, saves };
}

test("a finished plan is completed, archived and saved as before, and then Vibe64 asks once whether to run the whole-project checks", async (t) => {
  const { f, saves } = await finishedPlan(t);
  assert.equal(await readWorkPlan(f.context), null, "completed and archived");
  assert.deepEqual(saves, ["complete"], "and saved once");
  assert.equal(f.sends.length, 2, "no turn ran the whole-project checks");
  assert.deepEqual([f.state().status, f.state().wholeChecks], ["complete", { status: "asked", plan: "Required-field validation" }]);
  const notices = noticeTexts(f);
  assert.equal(notices.at(-1), QUESTION, "the question follows the save's note");
  const archived = notices.indexOf("Completed plan archived: Required-field validation.\n\n[View plan history](#vibe64-plan-history)");
  assert.ok(archived >= 0 && archived < notices.indexOf("Saved automatically."), notices.join("\n"));
  assert.equal(notices.filter((text) => text.startsWith("The plan is finished.")).length, 1, "asked once");
  // Above the message box: the question, with Yes and No.
  const notice = assistantRoutingNotice(f.state(), { mode: "auto" });
  assert.deepEqual([notice.shown, notice.label, notice.needsAction, notice.stop], [true, WHOLE_CHECKS_QUESTION, true, false]);
  assert.deepEqual(notice.action, { kind: "checks", label: "Yes", enabled: true, waits: "", progress: "" });
  assert.deepEqual(assistantRoutingNotice(f.state(), { busy: "turn" }).action,
    { kind: "checks", label: "Yes", enabled: false, waits: "available when this answer ends", progress: "" });
  assert.deepEqual(assistantRoutingNotice(f.state(), { pendingAction: "run-checks" }).action,
    { kind: "checks", label: "Yes", enabled: false, waits: "", progress: "Starting…" });
});

test("with Automatically save changes off, the finished plan is not saved and Vibe64 still asks once", async (t) => {
  const { f, saves } = await finishedPlan(t, { mode: "auto", autoSave: false });
  assert.deepEqual(saves, []);
  assert.equal(noticeTexts(f).at(-1), QUESTION);
  assert.equal(noticeTexts(f).filter((text) => text.startsWith("The plan is finished.")).length, 1);
  assert.equal(f.state().wholeChecks.status, "asked");
});

test("Yes runs one Senior turn that runs the whole-project checks once; what it fixes is saved like any other work, and Vibe64 never asks again", async (t) => {
  const { f, saves } = await finishedPlan(t);
  const routed = f.helperCalls();
  await f.service.send("session-1", yes("yes-1"), f.context);
  assert.equal(f.helperCalls(), routed, "the Yes is not routed");
  assert.equal(f.sends.length, 3, "one turn");
  const run = f.sends[2];
  assert.equal(run.selection.modelId, f.assignments.senior.modelId, "on Senior");
  assert.ok(run.input.message.includes(ASSISTANT_WHOLE_CHECKS_INSTRUCTION));
  assert.match(run.input.message, /handoff: you fixed what the checks found \(files changed\); Vibe64 then saves the fixes\. complete: every check passed and you changed no files\./u);
  assert.match(run.input.message, /Your final reply records the result: each check you ran, with its command, whether it passed and its counts/u);
  assert.ok(run.input.message.endsWith(`\n\n${WHOLE_CHECKS_YES_MESSAGE}`), "the person's Yes is its request");
  assert.doesNotMatch(run.input.message, /Auto workflow stage|Senior review of the plan|Ready to try/u);
  assert.equal(run.input.genesisTask, undefined, "it runs no pass");
  const running = f.state();
  assert.deepEqual([running.messageId, running.stage, running.workflow, running.resolvedMode, running.reason, running.planInvolved, running.afterPlan],
    ["yes-1", "implementation", true, "senior", "implementation", false, null]);
  assert.deepEqual(running.wholeChecks, { status: "run", plan: "Required-field validation" });
  assert.equal(assistantRoutingNotice(running).shown, false, "the question is answered");
  // A turn that runs out of room carries on, never running them again from the start.
  await finish(f, "continue", { involved: false });
  assert.equal(f.sends.length, 4);
  assert.equal(f.sends[3].input.displayMessage, "Continue the whole-project checks.");
  assert.equal(f.sends[3].input.turnMetadata.actorLabel, "Whole-project checks");
  assert.match(f.sends[3].input.message, /Continue the whole-project checks the person asked for from where the last turn stopped: they run once in this request, never again/u);
  assert.ok(f.sends[3].input.message.includes(ASSISTANT_WHOLE_CHECKS_INSTRUCTION));
  // The fix is new work: the turn reports handoff and Automatically save changes saves it.
  await f.source.commit("Fix the test the whole run found failing");
  await finish(f, "handoff", { involved: false });
  assert.equal(f.state().status, "complete");
  assert.deepEqual(saves, ["complete", "complete"], "saved like any finished work");
  assert.equal(noticeTexts(f).filter((text) => text.startsWith("The plan is finished.")).length, 1, "never asked again");
  await assert.rejects(f.service.send("session-1", yes("yes-2"), f.context), notAsked);
  await assert.rejects(f.service.send("session-1", no(f.state()), f.context), notAsked);
  assert.equal(f.sends.length, 4, "nothing runs them again");
});

test("No runs nothing: Vibe64 notes it and never asks again for the plan", async (t) => {
  const { f, saves } = await finishedPlan(t);
  const asked = f.state();
  const routed = f.helperCalls();
  const answer = await f.service.send("session-1", no(asked), f.context);
  assert.deepEqual(answer, { ok: true, delivered: false, messageId: asked.messageId, wholeChecks: "declined" });
  assert.equal(f.sends.length, 2, "no turn");
  assert.equal(f.helperCalls(), routed, "no Router either");
  assert.deepEqual(saves, ["complete"], "no second save");
  assert.deepEqual([f.state().messageId, f.state().status, f.state().wholeChecks],
    [asked.messageId, "complete", { status: "declined", plan: "Required-field validation" }]);
  assert.equal(noticeTexts(f).at(-1), DECLINED);
  assert.equal(assistantRoutingNotice(f.state()).shown, false, "the question is gone");
  await assert.rejects(f.service.send("session-1", no(asked), f.context), notAsked);
  await assert.rejects(f.service.send("session-1", yes("yes-1"), f.context), notAsked);
  assert.equal(f.sends.length, 2, "and a later Yes runs nothing");
});

test("a message typed instead of Yes or No ends the question; its turn hears what was asked, so a typed yes runs them", async (t) => {
  const { f } = await finishedPlan(t);
  await f.service.send("session-1", { messageId: "typed-1", message: "Yes, run them, with the agreed required-field rule too.", submissionKind: "send" }, f.context);
  const sent = f.sends.at(-1);
  assert.equal(f.sends.length, 3);
  assert.ok(sent.input.message.includes(`[Vibe64: ${WHOLE_CHECKS_OFFERED_NOTE}]\n\nYes, run them, with the agreed required-field rule too.`),
    "the note leads the person's own message");
  assert.match(WHOLE_CHECKS_OFFERED_NOTE, /When it asks for them \("yes, run them", say\), run them once and fix what they find/u);
  assert.deepEqual(f.state().wholeChecks, { status: "offered", plan: "Required-field validation" });
  assert.equal(assistantRoutingNotice(f.state()).action?.kind, undefined, "no Yes or No any more");
  await assert.rejects(f.service.send("session-1", yes("yes-1"), f.context), notAsked);
  assert.equal(f.sends.length, 3);
});

test("an item that asks for the whole run, in a plan made before this rule: Senior rewrites it into what its review proves, never ticking it on focused tests", async (t) => {
  const legacy = PLAN.replace("- [~] Required-name validation\n", "- [~] Required-name validation\n- [~] The whole test suite passes\n");
  const { f } = await toReview(t, { mode: "auto" }, legacy);
  assert.match(f.sends.at(-1).input.message, new RegExp("An item that asks for them \\(\"the whole suite passes\", in a plan made before this rule\\) " +
    "is not proven by focused tests, so never tick it on them: rewrite it with the plan helper, as a plan change within the agreed outcome, " +
    "into what this review can prove \\(the focused tests for the plan's changes pass\\), record in Progress that Vibe64 offers the whole run " +
    "to the person once the plan is finished, and report continue with the returned revisions", "u"));
  // The review rewrites the item and records the offer, then reports continue: its next turn reviews the plan as it now stands.
  await writePlan(f, (text) => text.replace("- [~] The whole test suite passes", "- [~] The focused tests for the plan's changes pass"), "review");
  await change(f, "progress-write", "review", { progressText: "# Progress\n\nThe whole run is not a step of this plan: Vibe64 offers it once the plan is finished.\n" });
  await finish(f, "continue");
  assert.equal(f.sends.length, 3);
  assert.match(f.sends[2].input.message, /Senior review of the plan: /u);
  await writePlan(f, (text) => text.replaceAll("- [~]", "- [x]"), "review");
  const proven = (await readWorkPlan(f.context)).text;
  assert.match(proven, /- \[x\] The focused tests for the plan's changes pass/u);
  assert.doesNotMatch(proven, /whole test suite/u, "nothing claims the whole run");
  await change(f, "complete", "review");
  await finish(f, "complete");
  assert.equal(await readWorkPlan(f.context), null);
  assert.equal(f.sends.length, 3, "the review ran no whole run, and nothing else did");
  assert.equal(f.state().wholeChecks.status, "asked", "the person is asked about it instead");
});

// Genesis records a pass only after its whole-suite run passed with the person's OK, so the plan's passes that
// Genesis records (over the whole app, since their last completion or deeply) wait for the person's answer: the Yes's
// turn records them once every check passes, and after No they stay unrecorded. A pass over the plan's changes or a
// section is never recorded, and an unfinished pass is not either.
test("the plan's passes Genesis records wait for the person's answer: the Yes records them once every check passes, No leaves them unrecorded", () => {
  const plan = { title: "Tidy", text: "Status: completed\n# Tidy\n\n- [x] Tidy the forms\n\n## Passes\n\n" +
    "- [x] Review: the plan's changes\n- [x] Security pass: whole app\n- [x] Deslop: deep\n- [x] Visual identity: since last completed\n" +
    "- [x] Data pass: this section of the app: billing\n- [ ] UI pass: whole app\n" };
  const state = {};
  askWholeChecks(state, plan);
  assert.deepEqual(state.wholeChecks, { status: "asked", plan: "Tidy", passes: ["security-pass", "deslop", "identity-pass"] });
  // A plan with none of them asks as before.
  const none = {};
  askWholeChecks(none, { title: "Small", text: "# Small\n\n- [x] One\n\n## Passes\n\n- [x] Review: the plan's changes\n" });
  assert.deepEqual(none.wholeChecks, { status: "asked", plan: "Small" });
  // The Yes's turn carries them; a message typed instead does not.
  const saved = { messageId: "finished", status: "complete", wholeChecks: state.wholeChecks };
  assert.deepEqual(answerWholeChecks(saved, { messageId: "yes", wholeChecks: "run" }).fields.wholeChecks,
    { status: "run", plan: "Tidy", passes: ["security-pass", "deslop", "identity-pass"] });
  assert.deepEqual(answerWholeChecks(saved, { messageId: "other" }).fields.wholeChecks, { status: "offered", plan: "Tidy" });
  // The Yes's turn records them only once every check passes, and reports the records as changed files.
  const instructions = assistantWholeChecksInstructions({ autoSave: true, passes: ["security-pass", "deslop"] });
  assert.match(instructions, /Once every check passes, record the plan's passes Security pass and Deslop, which waited for this run: take the Genesis `passes done` operation for `security-pass`, `deslop`, one pass each, invoked as each pass's skill says, and leave the records with your other changes\. Record none while a check fails\./u);
  assert.match(instructions, /handoff: you fixed what the checks found or recorded the plan's passes \(files changed\); Vibe64 then saves the fixes\./u);
  assert.doesNotMatch(assistantWholeChecksInstructions({ autoSave: true }), /passes done|record the plan's/u);
  // No: the note says which passes stay unrecorded.
  assert.equal(assistantWholeChecksDeclinedNotice("turn-1", { passes: ["deslop"] }).text,
    "Whole-project checks not run. Vibe64 won't ask again for this plan. Deslop stays unrecorded as completed, since the whole-project checks didn't run.");
  assert.equal(assistantWholeChecksDeclinedNotice("turn-1").text, DECLINED);
});

test("the whole-project checks run in the session, and every failure is explained, never called pre-existing or environmental", () => {
  assert.match(ASSISTANT_WHOLE_CHECKS_INSTRUCTION, /through its own verification command, in this session, never detached to outlive it\./u);
  assert.match(ASSISTANT_WHOLE_CHECKS_INSTRUCTION, /Explain every failure; never call one pre-existing or environmental: a missing tool or an environment's refusal is a defect to fix, reported with what is missing\./u);
});
