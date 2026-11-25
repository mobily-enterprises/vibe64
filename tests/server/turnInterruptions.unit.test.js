import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CRASH_KIND, crashRecordId, readVibe64CrashRecords, writeCrashRecordSync } from "@local/vibe64-core/server/crashRecords";
import {
  TURN_RESUME_LOOP_WINDOW_MS,
  TURN_RESUME_PLANNED_LOOP_LIMIT,
  createServerRun,
  interruptionNotice,
  nextTurnInterruptions,
  resumeNoteForAi,
  resumePolicy,
  turnEnding
} from "../../packages/vibe64-terminals/src/server/turnInterruptions.js";
import { turnInterruptionCarriedOn, turnInterruptionLines } from "../../packages/vibe64-terminals/src/shared/turnInterruptionText.js";

async function systemRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-server-runs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("a server run tells how the run before it ended: an orderly stop, an update, a crash with its record", async t => {
  const root = await systemRoot(t);
  // Three servers one after another, a second apart.
  const start = Date.now() - 10_000;
  const stopped = createServerRun({ systemRoot: root, now: () => start });
  await stopped.recordPlannedStop("server-shutdown");
  const crashed = createServerRun({ systemRoot: root, now: () => start + 1000 });
  await crashed.started;
  const now = createServerRun({ systemRoot: root, now: () => start + 2000 });
  await now.started;
  assert.equal(await now.endOf(now.id), null, "this run has not ended");
  assert.deepEqual(await now.endOf(stopped.id), { cause: "restart", at: JSON.parse(await readFile(path.join(root, "server-runs", `${stopped.id}.json`), "utf8")).stoppedAt });
  // No crash record yet: an unexpected end, at this run's start.
  assert.deepEqual(await now.endOf(crashed.id), { cause: "crash", at: now.startedAt });
  // The crash record from that run's start on names what crashed and when.
  const at = new Date().toISOString();
  const id = crashRecordId(at, 4242);
  writeCrashRecordSync({ systemRoot: root, record: { id, at, pid: 4242, kind: CRASH_KIND.FATAL_ERROR,
    error: { name: "Error", message: "read ECONNRESET", code: "ECONNRESET", stack: null }, uptimeSeconds: 10, version: "0.1.0",
    activeTurns: 2, resumed: null } });
  assert.deepEqual(await now.endOf(crashed.id), { cause: "crash", at, crashMessage: "read ECONNRESET", crashId: id });
  // A run whose record is gone (an older Vibe64 sent the turn) is an unknown run.
  assert.deepEqual(await now.endOf(""), { cause: "crash", at: now.startedAt, unknownRun: true });
  // An earlier release that stopped in order: an update.
  const earlier = path.join(root, "server-runs", `${stopped.id}.json`);
  await writeFile(earlier, JSON.stringify({ ...JSON.parse(await readFile(earlier, "utf8")), version: "0.0.0-earlier" }));
  assert.equal((await now.endOf(stopped.id)).cause, "update");
  assert.deepEqual(await now.previousEnd(), await now.endOf(crashed.id), "the run before this one is the last to start");
  // The crash's turns resumed are counted into its record, once each.
  await now.countCrashTurn(id, true);
  await now.countCrashTurn(id, false);
  await now.countCrashTurn(id, true);
  const [record] = (await readVibe64CrashRecords({ systemRoot: root })).records;
  assert.equal(record.resumed, 2);
});

test("a server run keeps the last runs' records and never the oldest beyond them", async t => {
  const root = await systemRoot(t);
  for (let index = 0; index < 23; index += 1) await createServerRun({ systemRoot: root, now: () => Date.UTC(2026, 10, 24, 4, 0, index) }).started;
  assert.equal((await readdir(path.join(root, "server-runs"))).length, 20);
});

test("an earlier run still runs only while its own process does: not this one, not a dead or reused pid", async t => {
  const root = await systemRoot(t);
  const own = createServerRun({ systemRoot: root });
  await own.started;
  const now = createServerRun({ systemRoot: root });
  await now.started;
  assert.equal(await now.isRunning(own.id), false, "a run of this process (in a test) is not another server");
  assert.equal(await now.isRunning(now.id), false);
  assert.equal(await now.isRunning(""), false);
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { if (other.exitCode === null && other.signalCode === null) other.kill("SIGKILL"); });
  const file = path.join(root, "server-runs", `${own.id}.json`);
  const record = JSON.parse(await readFile(file, "utf8"));
  const stat = await readFile(`/proc/${other.pid}/stat`, "utf8").catch(() => "");
  const start = stat ? stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] : null;
  await writeFile(file, JSON.stringify({ ...record, pid: other.pid, processStart: start }));
  assert.equal(await now.isRunning(own.id), true, "the earlier server's process still runs");
  if (start) {
    // The same pid with another start is another process: the earlier server ended.
    await writeFile(file, JSON.stringify({ ...record, pid: other.pid, processStart: `${start}1` }));
    assert.equal(await now.isRunning(own.id), false);
  }
  const exited = new Promise(resolve => other.once("exit", resolve));
  other.kill("SIGKILL");
  await exited;
  await writeFile(file, JSON.stringify({ ...record, pid: other.pid, processStart: start }));
  assert.equal(await now.isRunning(own.id), false, "an exited process no longer runs the turn");
});

test("the loop rule resumes an unplanned end twice in a row and stops the third, each within the window of the resume before it", () => {
  const now = Date.parse("2026-11-24T04:20:00.000Z");
  const first = nextTurnInterruptions(undefined, { key: "a", at: "2026-11-24T04:18:05.000Z", cause: "crash" }, now);
  assert.equal(first.resume, true);
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].resumedAt, new Date(now).toISOString());
  const repeated = nextTurnInterruptions(first.history, { key: "a", at: "2026-11-24T04:18:05.000Z", cause: "crash" }, now + 1000);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.history, first.history);
  // The second unplanned end in a row is resumed too.
  const second = nextTurnInterruptions(first.history, { key: "b", at: "x", cause: "engine" }, now + 60_000);
  assert.deepEqual([second.resume, second.loop], [true, false]);
  // The third, within the window of the second's resume, stops: Continue or Resume goal is the person's.
  const loop = nextTurnInterruptions(second.history, { key: "c", at: "x", cause: "crash" }, now + 60_000 + TURN_RESUME_LOOP_WINDOW_MS - 1);
  assert.deepEqual([loop.resume, loop.loop, loop.entry.resumedAt], [false, true, null]);
  const later = nextTurnInterruptions(second.history, { key: "c", at: "x", cause: "crash" }, now + 60_000 + TURN_RESUME_LOOP_WINDOW_MS);
  assert.equal(later.resume, true, "one long after the last resume starts a new run");
  // A second end long after the first's resume starts the count again, so the third in a row is one more.
  const slow = nextTurnInterruptions(first.history, { key: "b", at: "x", cause: "crash" }, now + TURN_RESUME_LOOP_WINDOW_MS);
  assert.equal(nextTurnInterruptions(slow.history, { key: "c", at: "x", cause: "crash" }, now + TURN_RESUME_LOOP_WINDOW_MS + 1000).resume, true);
  // After a loop stop the next interruption is resumed again: Continue resumed it, or it ran on.
  assert.equal(nextTurnInterruptions(loop.history, { key: "d", at: "x", cause: "crash" }, now + 2 * 60_000).resume, true);
  assert.equal(nextTurnInterruptions(undefined, { key: "a", at: "x", cause: "sign-in" }, now, { resumes: false }).resume, false);
});

test("a planned stop (a release, a rollback, a restart) never counts: what ran carries on, and the stops between unplanned ends neither count nor part them", () => {
  const now = Date.parse("2026-11-24T04:20:00.000Z");
  let history;
  // A move's reboot, the rollback four minutes later, the release again, and five more: each carries on.
  for (const [index, cause] of ["restart", "update", "update", "restart", "update", "restart", "update", "restart", "update"].entries()) {
    const decision = nextTurnInterruptions(history, { key: `p${index}`, at: "x", cause }, now + index * 60_000);
    assert.deepEqual([decision.resume, decision.loop], [true, false], `planned stop ${index + 1}`);
    history = decision.history;
  }
  // Unplanned ends with planned stops between them: the third unplanned end in a row still stops.
  history = undefined;
  const causes = ["crash", "update", "crash", "restart", "crash"];
  const decisions = causes.map((cause, index) => {
    const decision = nextTurnInterruptions(history, { key: `u${index}`, at: "x", cause }, now + index * 60_000);
    history = decision.history;
    return decision.resume;
  });
  assert.deepEqual(decisions, [true, true, true, true, false]);
});

test("the backstop: a turn that keeps stopping Vibe64 in order at once stops at the tenth planned stop in a row", () => {
  const now = Date.parse("2026-11-24T04:20:00.000Z");
  let history;
  const resumes = [];
  for (let index = 0; index < TURN_RESUME_PLANNED_LOOP_LIMIT; index += 1) {
    const decision = nextTurnInterruptions(history, { key: `k${index}`, at: "x", cause: "restart" }, now + index * 30_000);
    history = decision.history;
    resumes.push(decision.resume);
  }
  assert.deepEqual(resumes, [...Array(TURN_RESUME_PLANNED_LOOP_LIMIT - 1).fill(true), false]);
  // Ten minutes of work between two of them is progress: the run starts again.
  history = undefined;
  for (let index = 0; index < TURN_RESUME_PLANNED_LOOP_LIMIT; index += 1) {
    const gap = index === 5 ? TURN_RESUME_LOOP_WINDOW_MS : 30_000;
    const decision = nextTurnInterruptions(history, { key: `g${index}`, at: "x", cause: "update" }, now + index * 30_000 + (index >= 5 ? gap : 0));
    assert.equal(decision.resume, true, `planned stop ${index + 1}`);
    history = decision.history;
  }
  assert.equal(history.length, TURN_RESUME_PLANNED_LOOP_LIMIT - 1, "the history keeps what the backstop reads");
});

test("what ended a turn this server sent, and when Vibe64 resumes each", () => {
  const ended = (state, error = "", observationError = "") => turnEnding({ state, error, observationError });
  assert.equal(ended("completed"), null);
  assert.equal(ended("cancelled"), null);
  assert.equal(ended("interrupted"), null, "an interrupt with nothing to say is the person's Stop");
  assert.deepEqual(ended("failed", "Claude stopped unexpectedly (exit 1). The conversation so far is saved; send a message to continue."),
    { cause: "engine", detail: "Claude stopped unexpectedly (exit 1)." });
  assert.equal(ended("failed", "", "The connection to Codex was lost.").cause, "connection");
  assert.equal(ended("failed", "read ECONNRESET").cause, "connection");
  assert.equal(ended("failed", "API Error: 529 Overloaded").cause, "overloaded");
  assert.equal(ended("failed", "Not logged in · Please run /login").cause, "sign-in");
  assert.equal(ended("failed", "Claude AI usage limit reached|1767225600").cause, "usage-limit");
  assert.equal(ended("failed", "Model refused the request.").cause, "failed");
  assert.equal(ended("timed_out").cause, "failed");
  assert.deepEqual(["crash", "restart", "update", "engine", "connection", "overloaded", "sign-in", "usage-limit", "failed"].map(resumePolicy),
    ["now", "now", "now", "now", "later", "later", "never", "never", "never"]);
});

test("the red entry and the AI's note say what happened, with the time in UTC on the server and the viewer's own clock", () => {
  const interruption = { key: "m:t", cause: "crash", at: "2026-11-24T04:18:05.000Z", crashMessage: "read ECONNRESET", crashId: "x" };
  const notice = interruptionNotice(interruption, "resumed");
  assert.equal(notice.messageId, "vibe64-turn-interrupted:m:t:resumed");
  assert.equal(notice.text, "Vibe64 crashed at 04:18 UTC: read ECONNRESET.\nResumed after Vibe64 restarted at 04:18 UTC.");
  assert.deepEqual(notice.data.vibe64TurnInterruption, { cause: "crash", at: interruption.at, outcome: "resumed", crashMessage: "read ECONNRESET" });
  const perth = at => new Date(at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Perth" });
  assert.deepEqual(turnInterruptionLines(notice.data.vibe64TurnInterruption, perth),
    ["Vibe64 crashed at 12:18: read ECONNRESET.", "Resumed after Vibe64 restarted at 12:18."]);
  assert.equal(interruptionNotice({ ...interruption, crashMessage: "" }, "loop").text,
    "Vibe64 restarted at 04:18 UTC (the server stopped unexpectedly).\nNot resumed: stopped: Vibe64 stopped unexpectedly three times in a row while it ran. Choose Continue to try again.");
  assert.equal(interruptionNotice({ key: "g", cause: "update", at: interruption.at }, "loop", { goal: true }).text,
    "Vibe64 was updated at 04:18 UTC, which stopped this turn.\nNot resumed: stopped: Vibe64 was stopped and started again 10 times in a row while it ran. Choose Resume goal to try again.");
  assert.equal(interruptionNotice({ key: "o", cause: "overloaded", at: interruption.at }, "loop").text,
    "The AI service was overloaded at 04:18 UTC.\nNot resumed: stopped: the AI service was overloaded three times in a row while it ran. Choose Continue to try again.");
  // A planned stop that what ran carried on through is one informational line, not a red entry.
  const update = interruptionNotice({ key: "u", cause: "update", at: interruption.at }, "resumed", { goal: true });
  assert.equal(update.text, "Vibe64 was updated at 04:18 UTC; the goal carried on.");
  assert.deepEqual(update.data.vibe64TurnInterruption, { cause: "update", at: interruption.at, outcome: "resumed", goal: true });
  assert.equal(turnInterruptionCarriedOn(update.data.vibe64TurnInterruption), true);
  assert.equal(turnInterruptionCarriedOn(notice.data.vibe64TurnInterruption), false, "a crash's resume is still a red entry");
  assert.deepEqual(turnInterruptionLines(update.data.vibe64TurnInterruption, perth), ["Vibe64 was updated at 12:18; the goal carried on."]);
  assert.equal(interruptionNotice({ key: "r", cause: "restart", at: interruption.at }, "resumed").text,
    "Vibe64 was restarted at 04:18 UTC; this turn carried on.");
  // Continued on the AI account connected now, which changed since it last ran.
  assert.equal(interruptionNotice({ key: "r", cause: "restart", at: interruption.at }, "resumed", { goal: true, newConnection: true }).text,
    "Vibe64 was restarted at 04:18 UTC; the goal carried on with the AI account connected now.");
  assert.equal(interruptionNotice(interruption, "resumed", { goal: true, newConnection: true }).text,
    "Vibe64 crashed at 04:18 UTC: read ECONNRESET.\nResumed after Vibe64 restarted at 04:18 UTC, with the AI account connected now.");
  // A goal its restart could not continue says why, and what to do.
  assert.equal(interruptionNotice({ key: "n", cause: "restart", at: interruption.at }, "not-resumed",
    { goal: true, error: "Sign in to Claude Code with your Claude account before continuing." }).text,
  "Vibe64 restarted at 04:18 UTC (it was stopped and started again).\nNot resumed: Sign in to Claude Code with your Claude account before continuing. Choose Resume goal to try again.");
  assert.equal(interruptionNotice({ key: "n", cause: "restart", at: interruption.at }, "not-resumed").text,
    "Vibe64 restarted at 04:18 UTC (it was stopped and started again).\nNot resumed: choose Continue to try again.");
  assert.equal(interruptionNotice({ key: "e", cause: "engine", at: interruption.at, detail: "Claude stopped unexpectedly (exit 137)." }, "failed",
    { error: "The AI account is unavailable." }).text,
  "The AI engine stopped at 04:18 UTC: Claude stopped unexpectedly (exit 137).\nThe resume could not be sent: The AI account is unavailable. Choose Continue to try again.");
  assert.equal(interruptionNotice({ key: "s", cause: "restart", at: interruption.at }, "stopped").text,
    "Vibe64 restarted at 04:18 UTC (it was stopped and started again).\nNot resumed: you stopped this turn.");
  assert.equal(resumeNoteForAi(interruption), "[Vibe64 note: your previous turn was interrupted. Vibe64 crashed at 04:18 UTC: " +
    "read ECONNRESET. Vibe64 resumed this conversation. Your work so far is kept. Before repeating any step, check the state " +
    "of what you were doing (files, Git, commands you started, anything half-done), then continue.]");
  assert.match(resumeNoteForAi({ key: "u", cause: "update", at: interruption.at }),
    /^\[Vibe64 note: your previous turn was interrupted\. Vibe64 was updated at 04:18 UTC, which stopped this turn\. Vibe64 resumed/u);
});
