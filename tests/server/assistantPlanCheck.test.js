import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fixture, planCommands, reportOutcome } from "../fixtures/assistantRouting.js";
import { manageWorkPlan, readWorkPlan, readWorkPlanPage } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { planChangesSinceMark, readSourceState } from "../../packages/vibe64-terminals/src/server/planSourceChanges.js";
import { assistantPlanChecks } from "../../packages/vibe64-terminals/src/server/assistantPlanCheck.js";
import { workPlanFreshness, workPlanStatusLine, workPlanStep } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";

// Vibe64's plan check, through the real routing service: when a turn that may tick the active plan
// changes the session's source but not the plan's marks or Progress, the AI gets one note in the same
// chat asking it to walk the checklist. Vibe64 never judges which item a change built.

const run = promisify(execFile);
const request = { messageId: "request-1", message: "Build the contact threads", submissionKind: "send" };
const end = (state, result = "completed") => ({ payload: { agentRun: { active: false, state: result, providerTurnId: state.turnId } } });
const ITEMS = ["Store contact threads (the store the other items build on)", "List a contact's threads", "Reply in a thread",
  "Move old messages into threads"];
const PLAN = `# Contact threads\n\nGroup each contact's messages into one thread.\n\n${ITEMS.map((item) => `- [ ] ${item}`).join("\n")}\n\n` +
  "## Technical details\nsrc/threads.js holds the store; src/list.js, src/reply.js and src/migrate.js use it.\n";
const marks = async (f) => (await readWorkPlan(f.context)).text.split("\n").filter((line) => /^- \[/u.test(line)).map((line) => line.slice(3, 4));

/** A chat whose Senior wrote the plan through the plan command, which records the session's source then. */
async function planned(t, mode = "junior") {
  const f = await fixture(t, { mode }, { readyPlan: false, source: true });
  await manageWorkPlan(f.context, { operation: "new", text: PLAN }, "senior", { sourceState: () => readSourceState(f.context.session) });
  return f;
}

/** The turn on item 1 builds the store, and on the way most of items 2 to 4: three files committed, one not. */
async function buildAlongTheWay(f) {
  const git = (...args) => run("git", args, { cwd: f.source.source });
  await mkdir(path.join(f.source.source, "src"), { recursive: true });
  for (const [file, text] of [["src/threads.js", "export const threads = new Map();\n"], ["src/list.js", "export const list = () => [];\n"],
    ["src/reply.js", "export const reply = () => {};\n"]]) await writeFile(path.join(f.source.source, file), text);
  await git("add", "src");
  await git("commit", "--quiet", "-m", "Thread store, listing and replies");
  await writeFile(path.join(f.source.source, "src/migrate.js"), "// Started: moves old messages.\n");
}

test("a turn on item 1 that also built items 2 to 4 without ticking gets one plan check, and its AI ticks them and records Progress", async (t) => {
  const f = await planned(t);
  await f.service.send("session-1", request, f.context);
  // The guidance asks for ticks as items are built, across the checklist, not at the end.
  assert.match(f.sends[0].input.message, /tick each item the moment it is built and its own checks pass, not at the end of the turn/u);
  assert.match(f.sends[0].input.message, /When work on one item also builds others, walk the whole checklist/u);
  await buildAlongTheWay(f);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2, "the turn's end sends the check before the request settles");
  const check = f.sends[1].input;
  assert.equal(check.displayMessage, "4 files of the session's source changed in this turn, but the plan's checklist marks and Progress did not. " +
    "Vibe64 asked the AI to bring the plan up to date.");
  // Facts only: which files changed, never which item they built; the AI walks the whole checklist.
  assert.match(check.message, /Vibe64 plan check: 4 files of the session's source changed in this turn \(src\/list\.js, src\/migrate\.js, src\/reply\.js, src\/threads\.js\)/u);
  assert.match(check.message, /walk the checklist item by item, not only the item you were on: work on one item often builds parts of others/u);
  assert.match(check.message, /Half-tick \(- \[~\]\) every item this turn's work built whose own checks pass/u);
  assert.match(check.message, /run vibe64-helper plan checked with the paired revisions instead/u);
  assert.match(check.message, /Then stop: start no other work in this turn\.$/u);
  assert.doesNotMatch(check.message, /item 2|List a contact's threads/u, "the note names no item");
  // Vibe64's note in the person's chat, the same AI, no task and no workflow step of its own.
  assert.equal(check.turnMetadata.vibe64Note, true);
  assert.equal(check.turnMetadata.actorLabel, "Plan check");
  assert.equal(check.genesisTask, undefined);
  assert.doesNotMatch(check.message, /vibe64-helper plan outcome/u);
  assert.equal(f.sends[1].selection.modelId, f.sends[0].selection.modelId);
  assert.equal(f.state().status, "working");

  // The AI walks the checklist: items 1 to 3 are built and checked, item 4 only started; Progress says so.
  const { plan, revisions } = await planCommands(f);
  await plan({ operation: "progress-write", text: "# Progress\n\nThe thread store, listing and replies are built; their tests pass. " +
    "Moving old messages is started in src/migrate.js, not built.\n", ...await revisions() });
  const ticked = (await readWorkPlan(f.context)).text.replace(/- \[ \] (Store|List|Reply)/gu, "- [~] $1");
  await plan({ operation: "write", text: ticked, ...await revisions() });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2, "once per turn: the check's own turn gets none");
  assert.equal(f.state().status, "complete");
  assert.deepEqual(await marks(f), ["~", "~", "~", " "]);
  assert.deepEqual(workPlanStep(await readWorkPlan(f.context)), { step: "implementation", item: 4, items: 4, title: ITEMS[3] });
  // The plan view: brought up to date, nothing changed since.
  const { current } = await readWorkPlanPage(f.context);
  current.changedSince = await planChangesSinceMark(f.context);
  assert.deepEqual(current.changedSince, { files: 0, more: false });
  assert.equal(workPlanFreshness(current).text, "Updated just now · no files changed since");
});

test("a plan check the AI ignores ends the turn as it would have, and the plan view shows the plan behind: when it was updated, files changed since", async (t) => {
  const f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2);
  // The check's turn changes nothing in the plan, nor anything else.
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2, "never a loop");
  assert.equal(f.state().status, "complete");
  assert.deepEqual(await marks(f), [" ", " ", " ", " "]);
  const { current } = await readWorkPlanPage(f.context);
  current.changedSince = await planChangesSinceMark(f.context);
  assert.deepEqual(current.changedSince, { files: 4, more: false }, "counted since Senior wrote the plan");
  const freshness = workPlanFreshness(current, Date.parse(current.updatedAt) + 47 * 60_000);
  assert.deepEqual(freshness, { text: "Updated 47 min ago · 4 files changed since", updated: "Updated 47 min ago",
    changed: "4 files changed since", behind: true });
  assert.equal(workPlanStatusLine(workPlanStep(await readWorkPlan(f.context)), { freshness }),
    `Plan: implementing item 1 of 4, ${ITEMS[0]} · 4 files changed since the plan's last update`);
});

test("plan checked is the AI's explicit answer that nothing needs a new mark: the plan stays as it was and counts as current", async (t) => {
  const f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  const { revision } = await readWorkPlan(f.context);
  const { plan, revisions } = await planCommands(f);
  const answered = await plan({ operation: "checked", ...await revisions() });
  assert.match(answered.notice, /Recorded that the plan was checked/u);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.state().status, "complete");
  assert.equal((await readWorkPlan(f.context)).revision, revision);
  const { current } = await readWorkPlanPage(f.context);
  current.changedSince = await planChangesSinceMark(f.context);
  assert.equal(workPlanFreshness(current).text, "Checked just now · no files changed since");
  // The next turn that changes files without ticking is checked again: checked counts for the turn it answered.
  await f.service.send("session-1", { ...request, messageId: "request-2", message: "Now the migration" }, f.context);
  await writeFile(path.join(f.source.source, "src/migrate.js"), "export const migrate = () => {};\n");
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 4);
  assert.match(f.sends[3].input.message, /Vibe64 plan check: 1 file of the session's source changed in this turn \(src\/migrate\.js\)/u);
});

test("no plan check for a turn that ticked, wrote Progress or checked the plan itself, changed no files, did not complete, ended asking the person, or ran without a plan", async (t) => {
  // Ticks as it goes: nothing to check.
  let f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  let commands = await planCommands(f);
  await commands.plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace("- [ ] Store", "- [~] Store"),
    ...await commands.revisions() });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status], [1, "complete"], "ticked in the turn");
  // Progress only is an update too.
  f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  commands = await planCommands(f);
  await commands.plan({ operation: "progress-write", text: "# Progress\n\nThe store is half built.\n", ...await commands.revisions() });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status], [1, "complete"], "Progress written in the turn");
  // Ticks or Progress changed where no update record was kept (a plan write from outside the plan command, say)
  // still changed the plan: the check compares the plan itself too.
  for (const [operation, text] of [["write", (plan) => plan.text.replace("- [ ] List", "- [~] List")],
    ["progress-write", () => "# Progress\n\nListing is built.\n"]]) {
    f = await planned(t);
    await f.service.send("session-1", request, f.context);
    await buildAlongTheWay(f);
    const current = await readWorkPlan(f.context);
    await manageWorkPlan(f.context, { operation, text: text(current), expectedRevision: current.revision,
      expectedProgressRevision: current.progressRevision || "" }, "junior");
    await f.service.afterTurn("session-1", end(f.state()), f.context);
    assert.deepEqual([f.sends.length, f.state().status], [1, "complete"], `${operation} without an update record`);
  }
  // plan checked, run in the turn without being asked, answers it.
  f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  commands = await planCommands(f);
  await commands.plan({ operation: "checked", ...await commands.revisions() });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status], [1, "complete"], "checked in the turn");
  // An answer that changed no files.
  f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status], [1, "complete"], "no files changed");
  // A turn that failed or was interrupted.
  f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  await f.service.afterTurn("session-1", end(f.state(), "failed"), f.context);
  assert.equal(f.sends.length, 1, "a failed turn");
  // A turn the person stopped.
  f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  await f.service.cancel("session-1", f.context);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status], [1, "waiting"], "a stopped turn");
  // A turn that ended with a numbered question for the person waits for the answer instead.
  f = await planned(t);
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  const question = "The store is built.\n\n[1] Should a contact's threads list newest first?\nPossible answers:\n- Newest first\n- Oldest first";
  f.context.runtime.store.readConversationTail = async () => [{ user: { messageId: "request-1", text: request.message },
    messages: [{ role: "assistant", text: question }] }];
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().awaitingAnswer], [1, true], "a turn asking the person");
  // A plan completed or archived before the turn: no plan to check.
  f = await fixture(t, { mode: "junior" }, { readyPlan: false, source: true });
  await f.service.send("session-1", request, f.context);
  await buildAlongTheWay(f);
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.deepEqual([f.sends.length, f.state().status], [1, "complete"], "no plan");
});

test("which turns may tick the plan: Senior's, Junior's and Senior's review, never a pass, a task, an answer or a Custom chat", () => {
  const turn = (fields) => ({ status: "working", delivery: "accepted", stage: "implementation", ...fields });
  assert.equal(assistantPlanChecks(turn({ resolvedMode: "junior" })), true);
  assert.equal(assistantPlanChecks(turn({ resolvedMode: "senior" })), true);
  assert.equal(assistantPlanChecks(turn({ mode: "auto", resolvedMode: "senior", stage: "review", followup: { messageId: "f" } })), true);
  // The routing request is read before its turn is delivered: its saved status does not decide.
  assert.equal(assistantPlanChecks({ resolvedMode: "junior", stage: "implementation", status: "waiting", delivery: "pending" }), true);
  assert.equal(assistantPlanChecks(turn({ resolvedMode: "senior", stage: "pass", pass: { id: "security-pass" } })), false);
  assert.equal(assistantPlanChecks(turn({ resolvedMode: "senior", task: "deslop" })), false);
  assert.equal(assistantPlanChecks(turn({ resolvedMode: "senior", reason: "conversation" })), false);
  assert.equal(assistantPlanChecks(turn({ resolvedMode: "custom" })), false);
});

test("in Auto, the outcome Junior reported stands after the plan check: the check's ticks carry it on to the next step", async (t) => {
  const f = await planned(t, "auto");
  await f.service.send("session-1", request, f.context);
  assert.equal(f.sends[0].selection.modelId, f.assignments.junior.modelId);
  await buildAlongTheWay(f);
  await reportOutcome(f, "continue", { involved: true });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].input.turnMetadata.actorLabel, "Plan check");
  assert.equal(f.sends[1].selection.modelId, f.assignments.junior.modelId, "the same AI");
  const { plan, revisions } = await planCommands(f);
  await plan({ operation: "write", text: (await readWorkPlan(f.context)).text.replace(/- \[ \] (Store|List|Reply)/gu, "- [~] $1"),
    ...await revisions() });
  await f.service.afterTurn("session-1", end(f.state()), f.context);
  // continue: the implementation goes on with the plan as the check left it.
  assert.equal(f.sends.length, 3);
  assert.equal(f.sends[2].input.turnMetadata.actorLabel, "Continue implementation");
  assert.equal(f.state().status, "working");
  assert.equal(f.state().followup.planRevision, (await readWorkPlan(f.context)).revision, "from the plan as the check left it");
  assert.deepEqual(await marks(f), ["~", "~", "~", " "]);
});
