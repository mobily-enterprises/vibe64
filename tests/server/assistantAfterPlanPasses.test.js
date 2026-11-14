import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fixture, publishPlanFixture, planDocument, reportOutcome } from "../fixtures/assistantRouting.js";
import { GENESIS_PASSES } from "../fixtures/genesisPasses.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { afterPlanBase, rememberAfterPlanBase } from "../../packages/vibe64-terminals/src/server/afterPlanBase.js";

// Passes after a completed plan, through the real routing service: a completed
// plan is the only automatic trigger; each ticked pass runs in its own Senior
// turn over the changes since the session's base, then the plan is archived and
// the work saved.

const request = { messageId: "request-1", message: "Execute the plan", submissionKind: "send" };
const end = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
async function finish(f, decision, options = {}) {
  await reportOutcome(f, decision, { involved: true, ...options });
  const state = f.state();
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: state.followup?.messageId || state.messageId, text: "Execute the plan" },
    assistant: { text: "Actual final explanation." }, messages: [{ role: "assistant", text: "Actual final explanation." }] }];
  await f.service.afterTurn("session-1", end(state), f.context);
}
/** Senior completes the current plan, as its own turn does through the plan command. */
async function completePlan(f, role = "review") {
  const plan = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "complete", expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || "" }, role);
}
const planHistory = async (f) => (await manageWorkPlan(f.context, { operation: "history" }, "user")).history;
const noticeTexts = (f) => [...f.notices.values()].map((turn) => turn.system.text);
const afterPlanNotices = (f) => noticeTexts(f).filter((text) => text.includes("after the plan"));
const started = (title, deep = false) => `${title}${deep ? " deeply" : ""} started automatically after the plan (Passes: After a plan)`;
const since = (title, base, deep = false) => `${title}${deep ? " deeply" : ""}: the changes since base commit ${base}, judged against the whole app.`;
const readyPlan = (f) => publishPlanFixture(f.context, planDocument() + "\n- [x] Required-name validation verified\n");
// The request a turn sends: its message's last paragraph, after the role's instructions, where Genesis reads it.
const requestOf = (send) => send.input.message.split("\n\n").at(-1);

/**
 * Auto's work on the plan: Router sends it to Junior, Junior implements it in the session and hands
 * off, and Senior checks the plan in its own turn and completes it.
 */
async function implementAndComplete(f) {
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, f.assignments.junior.modelId);
  await f.source?.commit("Required-name validation");
  await finish(f, "handoff");
  await completePlan(f);
  await finish(f, "complete");
}

test("a completed plan runs each ticked pass in Master pass order, each its own Senior turn over the changes since the base, deep where ticked, then archives the plan and saves once", async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "auto", afterPlan: ["review", "security-pass", "data-pass", "speed-pass", "ux-pass", "deslop"],
    afterPlanDeep: ["data-pass"] }, { source: true, onPlanCompleted: async () => {
    saves.push({ archived: (await planHistory(f)).length, status: f.state().status });
    return "Saved automatically.";
  } });
  await readyPlan(f);
  // This project's Genesis cannot run the User experience pass.
  const reason = "This project's Genesis has no User experience pass. Update it to run it.";
  f.genesis.passes = GENESIS_PASSES.map((pass) => pass.id === "ux-pass" ? { ...pass, unavailable: reason, runs: [], sinceBase: null } : pass);

  await f.service.send("session-1", request, f.context);
  await f.source.commit("Required-name validation");
  await finish(f, "handoff");
  // Junior can't complete the plan: Senior checks and completes it in its own turn, which is not a pass.
  assert.equal(f.state().stage, "review");
  assert.equal(f.sends[1].selection.modelId, f.assignments.senior.modelId);
  assert.match(f.sends[1].input.message, /\n\nPlan completion: Read every page of BOTH Plan and Progress/u);
  assert.equal(f.sends[1].input.genesisTask, undefined, "the plan's completion renders no pass or review task");
  assert.equal(afterPlanNotices(f).length, 0, "nothing runs after a turn ends");
  await completePlan(f);
  await finish(f, "complete");

  const base = f.source.canonical;
  const expected = [["review", "Review"], ["security-pass", "Security pass"], ["data-pass", "Data pass", true],
    ["speed-pass", "Speed pass"], ["deslop", "Deslop"]];
  for (const [index, [id, title, deep]] of expected.entries()) {
    const send = f.sends[2 + index];
    assert.equal(f.state().stage, "pass", id);
    assert.equal(requestOf(send), since(title, base, deep), `${id} judges only the plan's changes`);
    assert.equal(send.input.genesisTask, id);
    assert.equal(send.input.automaticGenesisTask, true, "Vibe64 chose the task; it never becomes the Blueprint's");
    assert.equal(send.selection.modelId, f.assignments.senior.modelId, `${id} runs on Senior`);
    assert.equal((await readWorkPlan(f.context)).status, "completed", "the completed plan stays current while the passes run");
    assert.equal(saves.length, 0, "nothing is saved before the last pass ends");
    await f.service.afterTurn("session-1", end(f.state()), f.context);
  }
  assert.equal(f.sends.length, 7, "one turn per ticked pass Genesis offers, none for the others");
  assert.equal(f.helperCalls(), 1, "Router classifies only the person's request");
  assert.equal(f.state().status, "complete");
  assert.equal(await readWorkPlan(f.context), null);
  assert.equal((await planHistory(f)).length, 1, "the plan is archived after the last pass");
  assert.deepEqual(saves, [{ archived: 1, status: "complete" }], "and the work saved once, after that");
  assert.equal(f.metadata.after_plan_base, await f.source.head(), "the next after-plan passes start from here");
  assert.deepEqual(afterPlanNotices(f), [`User experience pass skipped after the plan: ${reason}`,
    ...expected.map(([, title, deep]) => started(title, deep))]);
  const notices = noticeTexts(f);
  assert.ok(notices.indexOf(started("Deslop")) < notices.indexOf("Save started automatically (Chat settings: Automatically save changes)"));
  assert.ok(notices.indexOf("Save started automatically (Chat settings: Automatically save changes)") < notices.indexOf("Saved automatically."));
});

test("a direct Senior chat's completed plan starts the passes from the recorded base; with save off nothing is saved", async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "senior", afterPlan: ["review", "security-pass"], autoSave: false },
    { source: true, onPlanCompleted: async () => { saves.push(true); return ""; } });
  await readyPlan(f);
  // The session's work before this plan, already judged by earlier passes.
  const base = await f.source.commit("Earlier work");
  f.metadata.after_plan_base = base;
  await f.service.send("session-1", request, f.context);
  assert.equal(f.helperCalls(), 0);
  await f.source.commit("Required-name validation");
  // Senior implementing directly verifies and completes the plan itself.
  await completePlan(f, "senior");
  await finish(f, "complete");
  // Each pass starts when the previous pass's turn ends.
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual(f.sends.slice(1).map((send) => [send.input.genesisTask, requestOf(send)]),
    [["review", since("Review", base)], ["security-pass", since("Security pass", base)]]);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().status, "complete");
  assert.equal((await planHistory(f)).length, 1);
  assert.deepEqual(saves, [], "Automatically save changes is off");
  assert.ok(!noticeTexts(f).some((text) => text.startsWith("Save started automatically")));
  assert.equal(f.metadata.after_plan_base, await f.source.head());
});

test("a plain reply in which Senior completed the plan starts the passes like a reported completion", async (t) => {
  const f = await fixture(t, { mode: "senior", afterPlan: ["review", "security-pass"] }, { source: true });
  await readyPlan(f);
  await f.service.send("session-1", request, f.context);
  await completePlan(f, "senior");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.state().stage, "pass");
  assert.equal(f.sends[1].input.genesisTask, "review");
});

test("no pass runs without a plan, with an active plan left unchanged, or with a plan completed before the request", async (t) => {
  for (const [name, mode, plan] of [["no plan", "senior", null], ["no plan", "auto", null], ["an unchanged active plan", "senior", "active"],
    ["a plan completed before the request", "senior", "completed"]]) {
    const saves = [];
    const f = await fixture(t, { mode }, { source: true, readyPlan: false, onPlanCompleted: async () => { saves.push(true); return ""; } });
    if (plan) await publishPlanFixture(f.context, planDocument(plan) + "\n- [x] Required-name validation verified\n");
    await f.service.send("session-1", request, f.context);
    await f.source.commit();
    await finish(f, "handoff", { involved: false });
    assert.equal(f.state().status, "complete", `${name} in ${mode}`);
    assert.equal(f.sends.length, 1, `${name} in ${mode}: the work ends after its own turn, with no review, Deslop or UI pass`);
    assert.deepEqual(afterPlanNotices(f), [], name);
    assert.deepEqual(saves, [true], `${name} in ${mode}: Automatically save changes saves it as before`);
  }
});

test("a Junior chat leaves the plan active for Senior and gets no completion turn; Junior can never complete a plan", async (t) => {
  const f = await fixture(t, { mode: "junior" }, { source: true });
  await readyPlan(f);
  await f.service.send("session-1", request, f.context);
  await assert.rejects(reportOutcome(f, "complete", { involved: true }), /Only Senior completes a plan/u);
  await finish(f, "handoff");
  assert.equal(f.state().status, "complete");
  assert.equal(f.sends.length, 1, "no Senior turn in a Junior chat");
  assert.equal((await readWorkPlan(f.context)).status, "active");
  assert.deepEqual(afterPlanNotices(f), []);
});

test("Auto work without a plan ends after Junior's turn: no Senior turn, no pass", async (t) => {
  const f = await fixture(t, { mode: "auto" }, { source: true, readyPlan: false });
  await f.service.send("session-1", request, f.context);
  await finish(f, "handoff");
  assert.equal(f.state().status, "complete");
  assert.equal(f.sends.length, 1);
  assert.deepEqual(afterPlanNotices(f), []);
});

for (const ending of ["failed", "stopped"]) test(`a ${ending} pass ends the passes with a notice, saves nothing and keeps the completed plan for the person`, async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "auto" }, { source: true, onPlanCompleted: async () => { saves.push(true); return ""; } });
  await readyPlan(f);
  await implementAndComplete(f);
  assert.equal(f.sends[2].input.genesisTask, "review");
  const pass = f.state();
  if (ending === "stopped") {
    assert.equal(await f.service.cancel("session-1", f.context), false, "the caller still interrupts the native turn");
    // Until the stopped turn ends, Resume can't send the pass again either.
    await assert.rejects(f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context),
      /The after-plan passes were stopped\. Run the rest from Passes\./u);
    await f.service.afterTurn("session-1", end(pass, "interrupted"), f.context);
  } else await f.service.afterTurn("session-1", end(pass, "failed"), f.context);
  assert.equal(f.sends.length, 3, "no later pass starts");
  assert.equal(f.state().status, "complete");
  assert.equal(f.state().passChain.stopped, true);
  assert.deepEqual(saves, []);
  assert.equal((await readWorkPlan(f.context)).status, "completed", "the plan stays current, completed");
  assert.equal(f.metadata.after_plan_base, undefined, "the base stays, so the passes run from Passes judge the same changes");
  assert.equal(afterPlanNotices(f).at(-1), `The passes after the plan stopped: Review ${ending === "stopped" ? "was stopped" : "ended (failed)"}, so ` +
    "Review, Security pass, Data pass, Quality pass, UI pass, Deslop didn't finish and nothing was saved automatically. Run them from Passes.");
  await assert.rejects(f.service.send("session-1", { messageId: request.messageId, reviewAction: "retry" }, f.context),
    /no pending workflow|after-plan passes were stopped/u);
  assert.equal(f.sends.length, 3);
});

test("when Vibe64 can't find where the plan's work started, no pass runs: the plan is archived and saved with a notice", async (t) => {
  const saves = [];
  const f = await fixture(t, { mode: "auto" }, { source: true, onPlanCompleted: async () => { saves.push(true); return ""; } });
  delete f.metadata.canonical_commit;
  await readyPlan(f);
  await implementAndComplete(f);
  assert.equal(f.sends.length, 2, "never a whole-app pass instead");
  assert.equal(f.state().status, "complete");
  assert.equal((await planHistory(f)).length, 1);
  assert.deepEqual(saves, [true]);
  assert.deepEqual(afterPlanNotices(f), ["The passes didn't run after the plan: Vibe64 can't tell where this plan's work started " +
    "in the session's history. Run them from Passes."]);
});

test("after-plan passes send only Genesis's requests since a base, which Genesis never records as a pass run", async (t) => {
  const f = await fixture(t, { mode: "auto", afterPlan: ["review", "security-pass", "data-pass", "quality-pass", "speed-pass", "ux-pass",
    "identity-pass", "ui-pass", "deslop"], afterPlanDeep: ["security-pass", "deslop"] }, { source: true });
  await readyPlan(f);
  await implementAndComplete(f);
  while (f.state().stage === "pass" && f.state().status === "working") await f.service.afterTurn("session-1", end(f.state()), f.context);
  const passes = f.sends.slice(2).map((send) => ({ genesisTask: send.input.genesisTask, message: requestOf(send) }));
  assert.deepEqual(passes.map(({ genesisTask }) => genesisTask), GENESIS_PASSES.map(({ id }) => id)
    .sort((a, b) => f.genesis.master.passes.indexOf(a) - f.genesis.master.passes.indexOf(b)), "every pass, in Master pass order");
  for (const { genesisTask, message } of passes) {
    const pass = GENESIS_PASSES.find(({ id }) => id === genesisTask);
    assert.ok([pass.sinceBase.request, pass.sinceBase.deep].map((text) => text.replace("{base}", f.source.canonical)).includes(message), message);
    assert.ok(!pass.runs.some((run) => run.request === message), "never a run Genesis records");
  }
});

test("the base: a plan becoming current records HEAD only when none is recorded, a finished chain moves it to HEAD, and a commit the source lost or a rebase left behind falls back to the merge base", async (t) => {
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
  assert.equal(f.metadata.after_plan_base, await f.source.head(), "a finished chain moves it to HEAD");
  f.metadata.after_plan_base = "";
  delete f.metadata.canonical_commit;
  assert.equal(await afterPlanBase(session), "", "no base: the passes don't run, rather than over the whole app");
});
