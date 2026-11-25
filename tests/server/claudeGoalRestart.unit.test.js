import assert from "node:assert/strict";
import { test } from "node:test";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// A Main chat Claude goal continues by itself, once, after a server restart:
// working, between turns, after Claude compacted its context, and after a
// server that died without closing. A planned restart is told in one
// informational line in Main chat's history however often it comes; an
// unexpected end is told in red, and the third in a row stops it, paused.
// claudeGoalRestartControls.unit.test.js
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

test("a goal carries on through every planned restart, however close together, each told in one informational line", { timeout: 90_000 }, async t => {
  const h = await goalHarness(t);
  const notices = async () => (await h.store.readConversationLog("test"))
    .filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:goal:"));
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    // A move's reboot, then the rollback minutes later, then the release again: each a stop in order.
    for (let restart = 1; restart <= 3; restart += 1) {
      await h.restart();
      const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
      assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify({ restart, recovery, warnings: h.warnings }));
      assert.equal(await h.goalCommands(), commandsBefore + restart, "each continues with exactly one native command");
    }
    const lines = await notices();
    assert.equal(lines.length, 3, "each restart is told once");
    for (const line of lines) {
      assert.match(line.system.text, /^Vibe64 was restarted at \d\d:\d\d UTC; the goal carried on\.$/u);
      assert.deepEqual({ ...line.metadata.vibe64TurnInterruption, at: undefined },
        { cause: "restart", at: undefined, outcome: "resumed", goal: true });
    }
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "active");
    assert.equal((await h.intent()).active, true, "the next restart continues it too");
    // Recovery tells the operator what it did, at warn, which production logs.
    const events = h.warnings.map(record => record?.event).filter(Boolean);
    for (const event of ["vibe64.agent_goal.recovery_started", "vibe64.agent_goal.recovery_outcome", "vibe64.agent_goal.recovery_finished"]) {
      assert.ok(events.includes(event), JSON.stringify(events));
    }
  });
});

test("a goal whose server ends unexpectedly is continued twice in a row, and the third time stops, paused, in red, for Resume goal", { timeout: 90_000 }, async t => {
  const h = await goalHarness(t);
  const notices = async () => (await h.store.readConversationLog("test"))
    .filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:goal:"));
  const dead = [];
  await h.inProject(async () => {
    try {
      await h.startRunningGoal("All checks pass");
      const commandsBefore = await h.goalCommands();
      const outcomes = [];
      for (let crash = 1; crash <= 3; crash += 1) {
        // The server dies without closing: no planned stop is recorded.
        dead.push(h.service);
        await h.restart({ graceful: false });
        const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
        outcomes.push(Object.keys(recovery.results.at(-1)).find(name => ["resumed", "stoppedLoop"].includes(name)) || JSON.stringify(recovery));
      }
      assert.deepEqual(outcomes, ["resumed", "resumed", "stoppedLoop"], JSON.stringify(h.warnings));
      const [first, second, loop] = await notices();
      for (const resumed of [first, second]) {
        assert.match(resumed.system.text,
          /^Vibe64 restarted at (\d\d:\d\d) UTC \(the server stopped unexpectedly\)\.\nResumed after Vibe64 restarted at \1 UTC\.$/u);
      }
      assert.match(loop.system.text,
        /\nNot resumed: stopped: Vibe64 stopped unexpectedly three times in a row while it ran\. Choose Resume goal to try again\.$/u);
      assert.equal(loop.metadata.vibe64TurnInterruption.outcome, "loop");
      assert.equal(await h.goalCommands(), commandsBefore + 2, "the goal is not continued a third time");
      assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "paused");
      assert.equal((await h.intent()).active, false, "no later server continues it either");
      assert.ok(h.warnings.some(record => record?.event === "vibe64.agent_goal.recovery_outcome" && record.outcome === "stoppedLoop"),
        JSON.stringify(h.warnings));
      await h.restart();
      assert.equal((await h.service.recoverActiveGoals({ retryDelaysMs: [] })).results.at(-1).skipped, true);
      assert.equal((await notices()).length, 3, "each interruption is told once");
    } finally {
      for (const service of dead) await service.close().catch(() => {});
    }
  });
});
