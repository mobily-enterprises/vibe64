import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMIT_RESET_MARGIN_MS } from "../../packages/vibe64-terminals/src/server/serviceGoalLimitReset.js";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// A Main chat Claude goal whose turn ended at its AI account's usage limit
// continues by itself, once, once the limit has reset, in the same server and
// across restarts, unless the person paused it; out of credit it waits for them.

/**
 * Claude's own message when the AI account reaches its usage limit, which
 * resets this long from when Claude meets it (negative: already reset).
 * @param {number} resetsInMs
 */
const usageLimit = resetsInMs => ({ error: "rate_limit", apiError: "usage_limit_reached", resetsInMs,
  text: "You've hit your session limit" });
// Claude's own message when the AI account is out of credit.
const OUT_OF_CREDIT = Object.freeze({ error: "billing_error", text: "Credit balance is too low" });
// The goal continues about this long after the test's goal command meets the limit.
const CONTINUES_IN_MS = 3_000;

test("a Claude goal whose turn ended at its AI account's usage limit continues by itself, once, once the limit has reset", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    const limited = await h.startRunningGoal("Until the usage limit: every check succeeds",
      { limit: usageLimit(CONTINUES_IN_MS - LIMIT_RESET_MARGIN_MS) });
    const commandsBefore = await h.goalCommands();
    // The goal says when it continues: shortly after the limit resets.
    const waiting = await h.waitFor(async () => {
      const read = await h.service.readCanonicalAgentGoal("test", h.options);
      return read.goal?.resumesAt ? read : null;
    }, "the waiting goal says when it continues");
    assert.equal(waiting.goal.status, "usageLimited");
    assert.equal(waiting.goal.resumesAt, limited.goal.resetsAt + LIMIT_RESET_MARGIN_MS / 1000);
    assert.equal(await h.goalCommands(), commandsBefore, "nothing is sent into the limit");
    await h.waitFor(async () => await h.goalCommands() === commandsBefore + 1, "the goal continues once the limit has reset");
    await h.waitFor(() => h.turnActive(), "Claude works on the goal again");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "active");
    assert.equal(read.goal.resumesAt, undefined);
    assert.equal(read.error, undefined);
    assert.equal((await h.intent()).active, true, "a restart would continue it too");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "it is never sent twice");
  });
});

test("a goal waiting at its usage limit that the person pauses stays paused when the limit resets", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("Until the usage limit: every check succeeds", { limit: usageLimit(CONTINUES_IN_MS - LIMIT_RESET_MARGIN_MS) });
    const waiting = await h.waitFor(async () => {
      const read = await h.service.readCanonicalAgentGoal("test", h.options);
      return read.goal?.resumesAt ? read : null;
    }, "the waiting goal says when it continues");
    const paused = await h.service.updateCanonicalAgentGoal("test", { ...h.options, action: "pause",
      expectedSegmentId: waiting.target.segmentId, expectedGoalId: waiting.goal.id });
    assert.equal(paused.status, "paused", JSON.stringify(paused));
    const commandsBefore = await h.goalCommands();
    await new Promise(resolve => setTimeout(resolve, Math.max(0, waiting.goal.resumesAt * 1000 - Date.now()) + 1_500));
    assert.equal(await h.goalCommands(), commandsBefore, "a paused goal is not continued");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "paused");
    assert.equal(read.goal.resumesAt, undefined);
  });
});

test("a goal waiting at its usage limit across restarts continues once the limit has reset, and out of credit waits for the person", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    const limited = await h.startRunningGoal("Until the usage limit: every check succeeds", { limit: usageLimit(60 * 60_000) });
    const commandsBefore = await h.goalCommands();
    // The limit resets in an hour: a restart sends nothing now, and says when the goal continues.
    await h.restart();
    const waiting = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    const resumesAt = limited.goal.resetsAt + LIMIT_RESET_MARGIN_MS / 1000;
    assert.equal(waiting.results.at(-1).waiting, true, JSON.stringify(waiting));
    assert.equal(waiting.results.at(-1).resumesAt, resumesAt, JSON.stringify(waiting));
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.resumesAt, resumesAt);
    assert.equal(await h.goalCommands(), commandsBefore, "a restart sends nothing into the limit");
    // Out of credit, the goal waits for the person, after a restart too.
    await h.restart();
    await h.appendLimit(OUT_OF_CREDIT);
    const credit = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(credit.results.at(-1).waiting, true, JSON.stringify(credit));
    assert.equal(credit.results.at(-1).resumesAt, undefined, JSON.stringify(credit));
    const creditRead = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(creditRead.goal.outOfCredit, true);
    assert.equal(creditRead.goal.resumesAt, undefined);
    // The limit reset while the server was stopped: the next server continues the goal at once, once.
    await h.restart();
    await h.appendLimit(usageLimit(-2 * LIMIT_RESET_MARGIN_MS));
    await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    await h.waitFor(async () => await h.goalCommands() === commandsBefore + 1,
      async () => `the goal continues: ${JSON.stringify({ intent: await h.intent(), warnings: h.warnings })}`);
    await h.waitFor(() => h.turnActive(), "Claude works on the goal again");
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "active");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "it is never sent twice");
  });
});
