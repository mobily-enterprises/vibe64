import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../fixtures/assistantRouting.js";

// 28 Nov: a turn its AI account stopped while it ran (the person switched the workspace's Claude account, and the
// account connected partway through could not be used; or the account was signed out) waited for Continue even after
// the person set an account they could use. The owner's rule: such a turn is marked, on its interruption, as stopped
// by the account, and setting an account the person can use tells every turn so marked to continue, once, through the
// one resume every interrupted turn takes, whatever it was doing (a plan's step, a plain request, a temporary chat).
// A chat that was idle when the account changed, even with an active plan, is never continued by it.

const ACCOUNT_CHANGED = "The signed-in Claude account changed.";
const SIGNED_OUT = "Not logged in · Please run /login";
const RESUME = "Continue after the interruption.";
const end = (turnId, state = "completed", error = "") =>
  ({ payload: { agentRun: { active: false, state, error, providerTurnId: turnId } } });
const running = (turnId) => async () => ({ turn: { active: true, id: turnId } });
const idle = async () => ({ turn: { active: false } });
const noticeTexts = (f) => [...f.notices.values()].map((turn) => turn.system.text);

/** The account behind Senior's connection: another one, which `change` may make unusable (`{ available: false }`). */
const switchAccount = (f, change) => {
  const { engineId, modelProviderId } = f.assignments.senior;
  f.connections.set(`${engineId}:${modelProviderId}`, { connectionIdentity: "replacement-account", ...change });
};

/** A request sent and running as turn-1: `mode` is the chat's, `routerSays` Auto's classification. */
async function working(t, { mode = "senior", message = "Execute the plan", routerSays, allowAuto = true } = {}) {
  const f = await fixture(t, { mode }, { allowAuto });
  if (routerSays) f.router.respond = async () => ({ ok: true, text: JSON.stringify(routerSays) });
  await f.service.send("session-1", { messageId: "request-1", message, submissionKind: "send" }, f.context);
  assert.deepEqual([f.state().status, f.state().turnId], ["working", "turn-1"], f.state().error);
  f.agent.sessionState = running("turn-1");
  return f;
}

// Each turn the account stopped: how it runs, and how the account stops it.
const STOPPED_BY_THE_ACCOUNT = [
  ["a plan's step", { mode: "senior" }, "switch"],
  ["a plain request", { mode: "auto", message: "How does the form validate names?", routerSays: { mode: "senior", reason: "conversation" } }, "switch"],
  ["a temporary chat's request", { mode: "senior", message: "How does the form validate names?", allowAuto: false }, "switch"],
  ["a plain request the AI account was signed out of", { mode: "auto", message: "How does the form validate names?",
    routerSays: { mode: "senior", reason: "conversation" } }, "sign-out"]
];

/** The account stops the running turn: switched to one that can't be used yet, or signed out. */
async function stopByTheAccount(f, how) {
  f.agent.sessionState = idle;
  if (how === "switch") {
    switchAccount(f, { available: false });
    await f.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), f.context);
  } else {
    await f.service.afterTurn("session-1", end("turn-1", "failed", SIGNED_OUT), f.context);
  }
}

for (const [name, start, how] of STOPPED_BY_THE_ACCOUNT) {
  test(`${name} its AI account stopped waits for an account, and setting one continues it once, with no Continue`, async (t) => {
    const f = await working(t, start);
    const isPlan = f.state().workflow === true && f.state().stage === "implementation";
    assert.equal(isPlan, name === "a plan's step", "a plan's step and a plain request take the same path");
    await stopByTheAccount(f, how);
    assert.equal(f.sends.length, 1, "nothing is sent while the account can't be used");
    assert.deepEqual([f.state().status, f.state().delivery], ["waiting", "pending"]);
    assert.ok(f.state().followup?.messageId, "its resume is prepared");
    assert.match(f.state().error, /Vibe64 continues this turn once .*AI Accounts|in AI Accounts, and Vibe64 continues this turn/u);
    assert.ok(noticeTexts(f).some((text) => /\nNot resumed yet: .*Vibe64 continues it/u.test(text)), noticeTexts(f).join("\n---\n"));

    // An account the person can use is set: the turn continues by itself, through the resume any interrupted turn takes.
    switchAccount(f);
    const result = await f.service.continueAfterAccountSet("session-1", f.context);
    assert.deepEqual(result, { resumed: true });
    assert.equal(f.sends.length, 2, f.state().error);
    assert.equal(f.sends[1].input.displayMessage, RESUME);
    assert.match(f.sends[1].input.message, /\[Vibe64 note: your previous turn was interrupted\./u);
    assert.deepEqual([f.state().status, f.state().delivery, f.state().turnId], ["working", "accepted", "turn-2"]);
    assert.equal(f.state().error, undefined);
    assert.ok(noticeTexts(f).some((text) => /\nResumed after .*, with the AI account connected now\.$/u.test(text)),
      noticeTexts(f).join("\n---\n"));

    // The same account event again, here and on another server sharing the session's lock: nothing continues twice.
    f.agent.sessionState = running("turn-2");
    const again = await Promise.all([
      f.service.continueAfterAccountSet("session-1", f.context),
      f.restart().continueAfterAccountSet("session-1", f.context)
    ]);
    assert.deepEqual(again.map((outcome) => outcome.skipped), [true, true]);
    assert.equal(f.sends.length, 2);
  });
}

test("two account events at once continue a waiting turn once", async (t) => {
  const f = await working(t);
  await stopByTheAccount(f, "switch");
  switchAccount(f);
  const results = await Promise.all([
    f.service.continueAfterAccountSet("session-1", f.context),
    f.service.continueAfterAccountSet("session-1", f.context),
    f.restart().continueAfterAccountSet("session-1", f.context)
  ]);
  assert.equal(results.filter((outcome) => outcome.resumed).length, 1, JSON.stringify(results));
  assert.equal(f.sends.length, 2);
});

test("an account the person still can't use leaves the turn waiting, saying what to do, until one they can use is set", async (t) => {
  const f = await working(t);
  await stopByTheAccount(f, "switch");
  // Another account is set, but the turn's own still can't be used.
  assert.deepEqual(await f.service.continueAfterAccountSet("session-1", f.context), { waiting: true });
  assert.equal(f.sends.length, 1);
  assert.deepEqual([f.state().status, f.state().delivery], ["waiting", "pending"]);
  assert.equal(f.state().error,
    "The selected AI connection is unavailable. Vibe64 continues this turn once an AI account you can use is set in AI Accounts.");
  assert.ok(noticeTexts(f).some((text) => text.endsWith(
    "\nNot resumed yet: The selected AI connection is unavailable. Vibe64 continues it once an AI account you can use is set in AI Accounts.")),
  noticeTexts(f).join("\n---\n"));
  assert.ok(!noticeTexts(f).some((text) => /\nResumed after/u.test(text)), "no entry says it resumed while nothing was sent");
  switchAccount(f);
  assert.deepEqual(await f.service.continueAfterAccountSet("session-1", f.context), { resumed: true });
  assert.equal(f.sends.length, 2, f.state().error);
  assert.equal(f.state().status, "working");
});

test("a turn the person stopped stays stopped when an account is set", async (t) => {
  const f = await working(t);
  await stopByTheAccount(f, "switch");
  // The person's Stop, as it leaves the waiting request.
  f.metadata.assistant_routing_request = JSON.stringify({ ...f.state(), stopped: true, error: "Paused at your request." });
  switchAccount(f);
  assert.equal((await f.service.continueAfterAccountSet("session-1", f.context)).skipped, true);
  assert.equal(f.sends.length, 1);
  assert.deepEqual([f.state().stopped, f.state().status, f.state().error], [true, "waiting", "Paused at your request."]);
});

test("a chat that was idle when the account changed is not continued, even with an active plan waiting for Continue", async (t) => {
  // Its turn ended with nothing to say (no account stopped it): the plan's step waits for Continue.
  const waiting = await working(t);
  waiting.agent.sessionState = idle;
  await waiting.service.afterTurn("session-1", end("turn-1", "interrupted"), waiting.context);
  assert.deepEqual([waiting.state().status, waiting.state().error], ["waiting", "The implementation turn interrupted. Resume when ready."]);
  assert.ok(waiting.state().followup?.messageId, "Continue has a step to send");
  switchAccount(waiting);
  assert.equal((await waiting.service.continueAfterAccountSet("session-1", waiting.context)).skipped, true);
  assert.equal(waiting.sends.length, 1);
  assert.equal(waiting.state().error, "The implementation turn interrupted. Resume when ready.");

  // Its request finished before the change.
  const finished = await working(t, { mode: "senior", message: "How does the form validate names?" });
  finished.agent.sessionState = idle;
  await finished.service.afterTurn("session-1", end("turn-1"), finished.context);
  assert.equal(finished.state().status, "complete");
  switchAccount(finished);
  assert.equal((await finished.service.continueAfterAccountSet("session-1", finished.context)).skipped, true);
  assert.equal(finished.sends.length, 1);
});

test("a turn the loop rule stopped, or one whose resume may have reached the AI, is not continued by an account set", async (t) => {
  // The engine stops the turn three times in a row, each just after its resume: the third is the loop rule's.
  const looping = await working(t);
  for (const turnId of ["turn-1", "turn-2", "turn-3"]) {
    looping.agent.sessionState = idle;
    await looping.service.afterTurn("session-1", end(turnId, "interrupted", ACCOUNT_CHANGED), looping.context);
  }
  assert.equal(looping.sends.length, 3);
  assert.match(looping.state().error, /^Stopped: the AI engine stopped three times in a row/u);
  assert.equal((await looping.service.continueAfterAccountSet("session-1", looping.context)).skipped, true);
  assert.equal(looping.sends.length, 3);

  // The resume's send was lost on the way: only Retry, which checks its receipt, may go on.
  const unsure = await working(t);
  unsure.agent.sessionState = idle;
  unsure.failAdmission();
  await unsure.service.afterTurn("session-1", end("turn-1", "interrupted", ACCOUNT_CHANGED), unsure.context);
  assert.equal(unsure.state().delivery, "uncertain");
  unsure.failAdmission(false);
  const sent = unsure.sends.length;
  assert.equal((await unsure.service.continueAfterAccountSet("session-1", unsure.context)).skipped, true);
  assert.equal(unsure.sends.length, sent);
});
