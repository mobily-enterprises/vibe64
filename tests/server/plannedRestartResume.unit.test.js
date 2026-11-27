import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { plannedRestart } from "@local/vibe64-core/server/plannedRestart";
import { readBootId } from "@local/vibe64-core/server/plannedRestartNotice";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// After a planned restart, Main chat's work goes on by itself: a turn the notice told (steered, or led by its note)
// that ended before the restart, as the AI does once it has written where it is, is resumed once with the restart's
// note, as the person it ran for; one the person stopped is not; and one still running at the restart is resumed by
// the recovery of interrupted turns alone, once, however often the recovery checks again. The real terminals service,
// its planned restart reader and its recovery run here (claudeGoalTestHelpers.js); only Claude is synthetic, and a
// steer ends its turn. The reader's own rules are plannedRestart.unit.test.js.

// The server started again counts as the restarted one when it starts at or after a minute before the restart time,
// and every server in this process starts at the process's start: the restart time is a minute after it.
const RESTART_AT_MS = Math.round(performance.timeOrigin) + 60_000;
const RESUME_NOTE = "Vibe64: Restarted at";

/** The host gives the notice, and the server reads it now. */
async function giveNotice(h, id) {
  await writeFile(h.noticeFile, JSON.stringify({
    schema: "vibe64.planned-restart.v1",
    id,
    restartAt: new Date(RESTART_AT_MS).toISOString(),
    expiresAt: new Date(RESTART_AT_MS + 3 * 60_000).toISOString(),
    reason: "Platform update",
    bootId: readBootId()
  }));
  await plannedRestart().poll();
  assert.equal(plannedRestart().current()?.id, id, "the notice is in force");
}

/** The editor stops for the restart, and the host removes the notice as the machine comes back. */
function restartForTheNotice(h) {
  return h.restart({ beforeStart: () => rm(h.noticeFile, { force: true }) });
}

/** Each message Claude was sent, as its text. */
async function messages(h) {
  return (await h.trace()).filter(row => row.frame?.type === "user").map(row => JSON.stringify(row.frame.message.content));
}

const resumes = async h => (await messages(h)).filter(text => text.includes(RESUME_NOTE));
const request = async h => assistantRoutingRequestForDisplay((await h.store.readSession("test")).metadata);
const finishedChecks = h => h.warnings.filter(record => record?.event === "vibe64.turn_resume.recovery_finished");

/** A Senior request the person sent, working in Main chat. */
async function sendWork(h, messageId) {
  const sent = await h.sendAsPerson({ messageId, message: "Keep working on the report" });
  assert.notEqual(sent.ok, false, JSON.stringify(sent));
  await h.waitFor(async () => await h.turnActive() && (await request(h))?.delivery === "accepted", "Claude works on the request");
}

/** The harness's session, its routing Senior's, on a server that has started its recovery (and so tells its chats). */
async function preparedHarness(t) {
  const h = await goalHarness(t, { plannedRestart: true });
  if (!readBootId()) return null;
  await h.inProject(async () => {
    await h.routeAsSenior();
    assert.equal((await h.service.recoverInterruptedTurns({ retryDelaysMs: [] })).ok, true, JSON.stringify(h.warnings));
  });
  return h;
}

test("a turn the notice steered that ended before the restart goes on after it, once, with the restart's note", { timeout: 60_000 }, async t => {
  const h = await preparedHarness(t);
  if (!h) return t.skip("this machine has no boot id, so no planned restart notice is obeyed");
  await h.inProject(async () => {
    await sendWork(h, "before-notice");
    await giveNotice(h, "steered-then-ended");
    // The note reaches the running turn, and the AI ends its turn, as it does once it has written where it is.
    await h.waitFor(async () => (await messages(h)).some(text => text.includes("this workspace restarts at")), "the turn is steered");
    await h.waitFor(() => h.warnings.some(record => record?.event === "vibe64.planned_restart.steered" && record.steered === 1),
      () => JSON.stringify(h.warnings));
    await h.waitFor(async () => !await h.turnActive() && (await request(h))?.status !== "working", "the steered turn ends");

    await restartForTheNotice(h);
    const recovery = await h.service.recoverInterruptedTurns({ retryDelaysMs: [] });
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    assert.deepEqual(recovery.results.map(({ chat, resumed }) => ({ chat, resumed })), [{ chat: "main", resumed: true }],
      JSON.stringify(recovery));
    const [resumed, ...again] = await resumes(h);
    assert.deepEqual(again, [], "it is resumed once");
    assert.match(resumed, /Vibe64: Restarted at \d\d:\d\d UTC\. This was stopped: your turn\. Continue from your notes\./u);
    assert.match(resumed, /Original request: Keep working on the report/u, "the request it ran goes on");
    await h.waitFor(() => h.turnActive(), "Claude works on the request again");
    const session = await h.store.readSession("test");
    assert.equal(assistantRoutingRequestForDisplay(session.metadata).submittedBy?.username, h.actor.username,
      "as the person it ran for");
    const entries = (await h.store.readConversationLog("test")).filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:"));
    assert.deepEqual(entries.map(turn => turn.system.text.replace(/\d\d:\d\d/u, "HH:MM")),
      ["Vibe64 was restarted at HH:MM UTC; this turn carried on."]);
  });
});

test("a turn the person stopped during the notice is not resumed after the restart, and the recovery says why", { timeout: 60_000 }, async t => {
  const h = await preparedHarness(t);
  if (!h) return t.skip("this machine has no boot id, so no planned restart notice is obeyed");
  await h.inProject(async () => {
    await giveNotice(h, "stopped-by-person");
    // A turn that starts in the window is led by the note, then the person stops it.
    await sendWork(h, "in-window");
    assert.ok((await messages(h)).some(text => text.includes("this workspace restarts at") && text.includes("Keep working")),
      "the note leads the turn");
    await h.service.interruptAgentTurn("test", {}, h.options);
    await h.waitFor(async () => !await h.turnActive() && (await request(h))?.stopped === true, "the person's Stop ends the turn");

    await restartForTheNotice(h);
    const recovery = await h.service.recoverInterruptedTurns({ retryDelaysMs: [] });
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    assert.deepEqual(recovery.results.map(({ chat, skipped, reason }) => ({ chat, skipped, reason })),
      [{ chat: "main", skipped: true, reason: "stopped-by-person" }], JSON.stringify(recovery));
    assert.deepEqual(finishedChecks(h).at(-1).skipped,
      [{ projectSlug: "claude-goal-restart", sessionId: "test", chat: "main", reason: "stopped-by-person" }]);
    assert.deepEqual(await resumes(h), [], "nothing is resumed");
    assert.equal((await request(h)).stopped, true);
  });
});

test("a turn the notice led that was still running at the restart is resumed once, however often the recovery checks again", { timeout: 60_000 }, async t => {
  const h = await preparedHarness(t);
  if (!h) return t.skip("this machine has no boot id, so no planned restart notice is obeyed");
  await h.inProject(async () => {
    await giveNotice(h, "running-at-restart");
    await sendWork(h, "in-window");
    await restartForTheNotice(h);

    // Another open project the first check cannot reach, so the recovery checks again; on its second check that
    // project holds it until the resumed turn has ended.
    const { listProjects, runInProjectContext } = h.project;
    let hold = null;
    let held = null;
    h.project.listProjects = async () => ({ ok: true, projects: [{ slug: "unreachable", runtime: { open: true } }, ...(await listProjects()).projects] });
    h.project.runInProjectContext = async (slug, operation) => {
      if (slug !== "unreachable") return runInProjectContext(slug, operation);
      [held, hold] = [hold, null];
      await held?.promise;
      throw Object.assign(new Error("This project could not be read."), { code: "test_project_unreachable" });
    };
    try {
      const checksBefore = finishedChecks(h).length;
      const first = await h.service.recoverInterruptedTurns({ retryDelaysMs: [1] });
      // Set before the second check starts, a timer's turn after the first one ends.
      hold = Promise.withResolvers();
      assert.equal(first.ok, false, JSON.stringify(first));
      assert.equal(first.results.find(result => result.chat === "main")?.reconciled, true, JSON.stringify(first));
      await h.waitFor(async () => (await resumes(h)).length === 1, async () => JSON.stringify({ messages: await messages(h), warnings: h.warnings }));
      await h.waitFor(() => h.turnActive(), "Claude works on the resumed turn");

      // The resumed turn ends before the second check reaches the session (a steer ends the synthetic turn).
      await h.waitFor(() => held !== null, "the second check reaches the project that holds it");
      await h.service.noteMainChat("test", { message: "Vibe64: a note for the running turn." }, h.options);
      await h.waitFor(async () => !await h.turnActive() && (await request(h))?.status !== "working",
        async () => JSON.stringify({ request: await request(h), messages: await messages(h) }));
      held.resolve();
      await h.waitFor(() => finishedChecks(h).length === checksBefore + 2, () => JSON.stringify(h.warnings));

      // The second check finds the chat the notice told sent since the restart: it is not resumed again.
      assert.equal((await resumes(h)).length, 1, "the turn is resumed once");
      assert.deepEqual(finishedChecks(h).at(-1).skipped,
        [{ projectSlug: "claude-goal-restart", sessionId: "test", chat: "main", reason: "sent-since-restart" }],
        JSON.stringify(finishedChecks(h).at(-1)));
    } finally {
      // A check still held lets go, so the server's stop never waits for it.
      hold?.resolve();
      held?.resolve();
      Object.assign(h.project, { listProjects, runInProjectContext });
    }
  });
});
