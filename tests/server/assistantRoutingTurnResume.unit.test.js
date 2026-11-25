import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServerRun } from "../../packages/vibe64-terminals/src/server/turnInterruptions.js";
import { fixture } from "../fixtures/assistantRouting.js";

// An AI turn that ends without finishing, and without the person stopping it, is resumed once in the same
// conversation with Vibe64's note leading its message, and its chat's history keeps an entry of what happened and
// what Vibe64 did: red for an unexpected end, one informational line for a planned restart it carried on through. The server-level proof (a real process killed mid-turn) is turnResumeAfterKill.integration.test.js.

const request = { messageId: "request-1", message: "Yes, implement it.", submissionKind: "send" };
// After the per-turn role instructions every routed message carries, the note leads the request itself.
const NOTE = /\n\n\[Vibe64 note: your previous turn was interrupted\. [^\n]*\]\n\nContinue the authorised work/u;

/**
 * A chat whose first turn is running under one server run, in its own system root; `next()` is the server after it.
 * With `stopWhileSending`, that server's orderly stop begins while the message is being sent: its prompt is out and
 * its receipt not yet back.
 * @param {import("node:test").TestContext} t
 * @param {object} [options] the routing fixture's options
 * @param {{ stopWhileSending?: boolean }} [how]
 */
async function runningTurn(t, options = {}, { stopWhileSending = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-turn-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createServerRun({ systemRoot: root });
  await first.started;
  const f = await fixture(t, { mode: "senior" }, { serverRun: first, ...options });
  if (stopWhileSending) {
    const dispatch = f.holdDispatch();
    const sending = f.service.send("session-1", request, f.context);
    await dispatch.started;
    await first.recordPlannedStop("server-shutdown");
    const closed = f.service.close();
    dispatch.release();
    await Promise.all([sending, closed]);
    assert.notEqual(f.state().stopped, true, "the server's stop is not the person's Stop");
  } else {
    await f.service.send("session-1", request, f.context);
  }
  assert.equal(f.state().status, "working");
  assert.equal(f.state().serverRunId, first.id);
  return {
    f,
    first,
    /** This server run's record. */
    runFile: run => path.join(root, "server-runs", `${run.id}.json`),
    /** The next server: its own run beside the earlier ones. */
    async next(overrides = {}) {
      const run = createServerRun({ systemRoot: root });
      await run.started;
      return { run, routing: f.restart({ serverRun: run, ...overrides }) };
    },
    notices: () => [...f.notices.values()].map(turn => turn.system),
    entries: () => [...f.notices.values()].map(turn => turn.system.data?.vibe64TurnInterruption).filter(Boolean)
  };
}

test("a turn the previous server was running when it crashed is resumed once, with its red entry", async t => {
  const h = await runningTurn(t);
  // The server dies: no planned stop is recorded. Nothing runs the turn now.
  const { routing } = await h.next();
  await routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2, "the turn is resumed with exactly one message");
  const resumed = h.f.sends[1].input;
  assert.match(resumed.message, NOTE);
  assert.match(resumed.message, /Vibe64 restarted at \d\d:\d\d UTC \(the server stopped unexpectedly\)\./u);
  assert.match(resumed.message, /check the state of what you were doing/u);
  assert.equal(resumed.displayMessage, "Continue after the interruption.");
  assert.equal(h.f.state().status, "working");
  assert.equal(h.f.state().delivery, "accepted");
  const [entry] = h.entries();
  assert.deepEqual({ cause: entry.cause, outcome: entry.outcome }, { cause: "crash", outcome: "resumed" });
  assert.match(h.notices()[0].text, /^Vibe64 restarted at \d\d:\d\d UTC \(the server stopped unexpectedly\)\.\nResumed after Vibe64 restarted at \d\d:\d\d UTC\.$/u);
  assert.equal(h.notices()[0].messageId, "vibe64-turn-interrupted:request-1:turn-1:resumed");
  // The same server reconciling again finds the resumed turn its own: nothing more is sent or written.
  await routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2);
  assert.equal(h.notices().length, 1);
});

test("a resumed turn whose server ends unexpectedly again is resumed once more, and the third time in a row stops with Continue and says why", async t => {
  const h = await runningTurn(t);
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2);
  // The resumed turn's server dies too, at once: the second unplanned end in a row is resumed too.
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 3, "the second unplanned end in a row is resumed");
  assert.equal(h.entries().at(-1).outcome, "resumed");
  // And at once a third time: a crash loop is not resumed again.
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 3, "a crash loop is not resumed again");
  assert.equal(h.f.state().status, "waiting");
  assert.equal(h.f.state().error, "Stopped: Vibe64 stopped unexpectedly three times in a row while it ran. Choose Continue to try again.");
  assert.ok(h.f.state().followup?.messageId, "Continue has the prepared resume to send");
  assert.equal(h.entries().at(-1).outcome, "loop");
  assert.match(h.notices().at(-1).text,
    /\nNot resumed: stopped: Vibe64 stopped unexpectedly three times in a row while it ran\. Choose Continue to try again\.$/u);
  // Continue sends that resume once.
  await h.f.service.send("session-1", { ...request, reviewAction: "retry" }, h.f.context);
  assert.equal(h.f.sends.length, 4);
});

test("a turn carries on through planned restarts however close together, each told in one informational line", async t => {
  const h = await runningTurn(t);
  let run = h.first;
  for (let restart = 1; restart <= 3; restart += 1) {
    // Each server stops in order, as a release, its rollback and a machine restart stop it.
    await run.recordPlannedStop("server-shutdown");
    const next = await h.next();
    await next.routing.reconcile("session-1", h.f.context);
    assert.equal(h.f.sends.length, restart + 1, `restart ${restart} is carried on with exactly one message`);
    run = next.run;
  }
  assert.equal(h.f.state().status, "working");
  assert.equal(h.f.state().error, undefined);
  assert.deepEqual(h.notices().map(notice => notice.text.replace(/\d\d:\d\d/u, "HH:MM")),
    Array(3).fill("Vibe64 was restarted at HH:MM UTC; this turn carried on."));
  assert.deepEqual(h.entries().map(entry => [entry.cause, entry.outcome]), Array(3).fill(["restart", "resumed"]));
});

test("an interruption long after the last resume is resumed again", async t => {
  const h = await runningTurn(t);
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  const saved = h.f.state();
  saved.interruptions = saved.interruptions.map(entry => ({ ...entry, resumedAt: new Date(Date.now() - 11 * 60_000).toISOString() }));
  h.f.metadata.assistant_routing_request = JSON.stringify(saved);
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 3);
  assert.equal(h.entries().filter(entry => entry.outcome === "resumed").length, 2);
});

test("an orderly restart and an update are named as such", async t => {
  const h = await runningTurn(t);
  await h.first.recordPlannedStop("server-shutdown");
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.match(h.notices()[0].text, /^Vibe64 was restarted at \d\d:\d\d UTC; this turn carried on\.$/u);
  assert.match(h.f.sends[1].input.message, /Vibe64 restarted at \d\d:\d\d UTC \(it was stopped and started again\)\./u,
    "the AI's note still says what stopped its turn");
  // An earlier release's run that stopped in order: this server's version differs.
  const updated = await runningTurn(t);
  const file = updated.runFile(updated.first);
  const record = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...record, version: "0.0.0-earlier", stoppedAt: new Date().toISOString() }));
  await (await updated.next()).routing.reconcile("session-1", updated.f.context);
  assert.match(updated.notices()[0].text, /^Vibe64 was updated at \d\d:\d\d UTC; this turn carried on\.$/u);
  assert.match(updated.f.sends[1].input.message, /Vibe64 was updated at/u);
});

// A server's stop that catches a message while it is being sent leaves its request as the sending leaves it: the turn
// it started is resumed by the next server, as after a crash, never stopped as the person's Stop would stop it.
test("a turn whose message an orderly stop catches while it is sent is resumed once by the next server", async t => {
  const h = await runningTurn(t, {}, { stopWhileSending: true });
  assert.equal(h.f.state().delivery, "accepted");
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2, "the turn is resumed with exactly one message");
  assert.match(h.f.sends[1].input.message, NOTE);
  const [entry] = h.entries();
  assert.deepEqual({ cause: entry?.cause, outcome: entry?.outcome }, { cause: "restart", outcome: "resumed" });
  assert.match(h.notices()[0].text, /^Vibe64 was restarted at \d\d:\d\d UTC; this turn carried on\.$/u);
});

test("a turn the person stopped is never resumed; a Stop the crash overtook says so", async t => {
  const h = await runningTurn(t);
  // Stop was saved, but the turn's end was never reported before the server died.
  h.f.metadata.assistant_routing_request = JSON.stringify({ ...h.f.state(), stopped: true });
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 1, "a stopped turn is not resumed");
  assert.equal(h.f.state().status, "waiting");
  assert.equal(h.entries()[0].outcome, "stopped");
  assert.match(h.notices()[0].text, /\nNot resumed: you stopped this turn\.$/u);
  // A turn the person stopped that ended as stopped gets no entry at all.
  const quiet = await runningTurn(t);
  await quiet.f.service.afterTurn("session-1", { payload: { agentRun: { active: false, state: "cancelled", providerTurnId: "turn-1" } } }, quiet.f.context);
  assert.equal(quiet.f.sends.length, 1);
  assert.deepEqual(quiet.entries(), []);
});

test("a finished turn is never resumed", async t => {
  const h = await runningTurn(t);
  await h.f.service.afterTurn("session-1", { payload: { agentRun: { active: false, state: "completed", providerTurnId: "turn-1" } } }, h.f.context);
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 1);
  assert.deepEqual(h.entries(), []);
});

test("the AI engine dying mid-turn resumes it at once; a lost connection after a short wait", async t => {
  const h = await runningTurn(t);
  await h.f.service.afterTurn("session-1", { payload: { agentRun: { active: false, state: "failed", providerTurnId: "turn-1",
    error: "Claude stopped unexpectedly (exit 1). The conversation so far is saved; send a message to continue." } } }, h.f.context);
  assert.equal(h.f.sends.length, 2);
  assert.match(h.notices()[0].text, /^The AI engine stopped at \d\d:\d\d UTC: Claude stopped unexpectedly \(exit 1\)\.\nResumed after the AI engine stopped/u);
  assert.match(h.f.sends[1].input.message, /The AI engine stopped at/u);

  const lost = await runningTurn(t);
  await lost.f.service.afterTurn("session-1", { payload: { agentRun: { active: false, state: "failed", providerTurnId: "turn-1",
    error: "Codex stopped.", observationError: "The connection to Codex was lost." } } }, lost.f.context);
  assert.equal(lost.f.sends.length, 1, "nothing is sent before the wait");
  const waiting = lost.f.state();
  assert.equal(waiting.status, "waiting");
  const wait = Date.parse(waiting.resumeAt) - Date.now();
  assert.ok(wait > 20_000 && wait <= 30_000, `resumes after the backoff (${wait} ms)`);
  assert.equal(lost.entries()[0].outcome, "resuming");
  assert.match(lost.notices()[0].text, /^The connection to the AI was lost at \d\d:\d\d UTC: The connection to Codex was lost\.\nVibe64 resumes it at /u);
  // Its time comes (here at once): the same server resumes it, once.
  lost.f.metadata.assistant_routing_request = JSON.stringify({ ...waiting, resumeAt: new Date(Date.now() - 1).toISOString() });
  await lost.f.service.reconcile("session-1", lost.f.context);
  const deadline = Date.now() + 5_000;
  while (lost.f.sends.length < 2) {
    assert.ok(Date.now() < deadline, "the waiting resume is sent");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(lost.f.state().status, "working");
  assert.equal(lost.f.state().resumeAt, undefined);
  assert.equal(lost.entries().at(-1).outcome, "resumed");
  await lost.f.service.reconcile("session-1", lost.f.context);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(lost.f.sends.length, 2);
});

for (const [name, error, outcome, line] of [
  ["needs signing in", "Not logged in · Please run /login", "sign-in", /\nNot resumed: sign in to the AI account again in AI Accounts, then choose Continue\.$/u],
  ["reached its usage limit", "Claude AI usage limit reached|1767225600", "usage-limit", /\nNot resumed: choose Continue, or send a message, once the limit resets\.$/u],
  ["reported another error", "Model refused the request.", "not-resumed", /\nNot resumed: choose Continue to try again\.$/u]
]) {
  test(`a turn ended because the AI account ${name} gets its red entry and is not resumed`, async t => {
    const h = await runningTurn(t);
    await h.f.service.afterTurn("session-1", { payload: { agentRun: { active: false, state: "failed", providerTurnId: "turn-1", error } } }, h.f.context);
    assert.equal(h.f.sends.length, 1);
    assert.equal(h.entries()[0].outcome, outcome);
    assert.match(h.notices()[0].text, line);
  });
}

test("a message the previous server never sent is sent once; one it may have sent is checked, never repeated", async t => {
  const h = await runningTurn(t);
  // The server died while preparing to send: no attempt was made.
  const preparing = { ...h.f.state(), status: "working", delivery: "sending" };
  delete preparing.attemptedMessageId;
  delete preparing.turnId;
  h.f.metadata.assistant_routing_request = JSON.stringify(preparing);
  h.f.receipts.clear();
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2);
  assert.equal(h.f.sends[1].input.messageId, request.messageId, "the person's own message, as they sent it");
  assert.equal(h.f.sends[1].input.message, h.f.sends[0].input.message);
  assert.equal(h.notices()[0].messageId, "vibe64-turn-interrupted:request-1:unsent:resumed");

  const unsure = await runningTurn(t);
  unsure.f.metadata.assistant_routing_request = JSON.stringify({ ...unsure.f.state(), status: "working", delivery: "sending", turnId: "" });
  unsure.f.receipts.clear();
  await (await unsure.next()).routing.reconcile("session-1", unsure.f.context);
  assert.equal(unsure.f.sends.length, 1, "an attempt the AI may have received is never sent again");
  assert.equal(unsure.f.state().delivery, "uncertain");
  assert.equal(unsure.entries()[0].outcome, "uncertain");
});

test("a turn an earlier server still runs is left to it until that server has exited", async t => {
  const h = await runningTurn(t);
  // The earlier server's record names a process that still runs, as during a brief overlap at restart.
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { if (other.exitCode === null) other.kill("SIGKILL"); });
  const file = h.runFile(h.first);
  const start = (await readFile(`/proc/${other.pid}/stat`, "utf8").catch(() => "")).split(") ")[1]?.split(" ")[19] || null;
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), pid: other.pid, processStart: start }));
  const { routing } = await h.next();
  await routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 1, "nothing is sent while the earlier server may still run the turn");
  assert.equal(h.f.state().status, "working");
  const exited = new Promise(resolve => other.once("exit", resolve));
  other.kill("SIGKILL");
  await exited;
  await routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2);
});

test("a temporary chat's turn is resumed the same way unless its read says it completed; a Main chat goal's turn is left to goal recovery", async t => {
  const h = await runningTurn(t, { allowAuto: false });
  h.f.context.routingConversationId = "chat-1";
  await (await h.next()).routing.reconcile("session-1", h.f.context);
  assert.equal(h.f.sends.length, 2, "a temporary chat continues its own interrupted turn");
  assert.equal(h.entries()[0].outcome, "resumed");

  // A turn the earlier server's shutdown left whose answer had arrived: the chat's read (JSKIT's, from OpenCode's
  // history) reports it completed, so it is finished, never resumed.
  const answered = await runningTurn(t, { allowAuto: false });
  answered.f.context.routingConversationId = "chat-1";
  answered.f.agent.sessionState = async () => ({ turn: { id: answered.f.state().turnId, status: "completed", active: false } });
  await (await answered.next()).routing.reconcile("session-1", answered.f.context);
  assert.equal(answered.f.sends.length, 1, "a completed turn is not resumed");
  assert.deepEqual(answered.entries(), [], "and gets no red entry");

  const goal = await runningTurn(t);
  goal.f.agent.readGoal = async () => ({ status: "available", goal: { status: "active", objective: "All checks pass" } });
  await (await goal.next()).routing.reconcile("session-1", goal.f.context);
  assert.equal(goal.f.sends.length, 1);
  assert.deepEqual(goal.entries(), []);
});
