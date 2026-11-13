import assert from "node:assert/strict";
import { test } from "node:test";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// A Main chat Claude goal continues by itself, once, after a server restart:
// working, between turns, after Claude compacted its context, and after a
// server that died without closing. claudeGoalRestartControls.unit.test.js
// covers a failed continuation and the person's controls, and
// claudeGoalUsageLimit.unit.test.js a goal at its AI account's usage limit.

test("a Claude goal that was working when the server stopped continues by itself, once, after restart", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    await h.restart();
    const recovery = await h.service.recoverActiveGoals();
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify(recovery));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "active");
    assert.equal(read.error, undefined);
    assert.equal(await h.turnActive(), true, "Claude works on the goal again");
    // The same server's recovery never continues it twice.
    await h.service.recoverActiveGoals();
    assert.equal(await h.goalCommands(), commandsBefore + 1);
  });
});

for (const [name, objective] of [["between turns", "Between turns: all checks pass"],
  ["between turns after Claude compacted its context", "Between turns, compacted: all checks pass"]])
test(`a Claude goal ${name} when the server stopped continues by itself, once, after restart`, { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal(objective, { finishes: true });
    const commandsBefore = await h.goalCommands();
    await h.restart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    const evidence = async () => JSON.stringify({ recovery, intent: await h.intent(), warnings: h.warnings });
    assert.equal(recovery.ok, true, await evidence());
    assert.equal(recovery.results.at(-1).resumed, true, await evidence());
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    await h.service.recoverActiveGoals();
    assert.equal(await h.goalCommands(), commandsBefore + 1);
  });
});

test("a Claude goal survives a server that died without closing and continues once on the next server", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    const dead = h.service;
    await h.restart({ graceful: false });
    try {
      const recovery = await h.service.recoverActiveGoals();
      assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
      assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify(recovery));
      assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    } finally {
      await dead.close().catch(() => {});
    }
  });
});
