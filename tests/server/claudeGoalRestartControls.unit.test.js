import assert from "node:assert/strict";
import { test } from "node:test";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// Across a server restart, a Main chat Claude goal whose continuation fails
// is tried again, a paused one resumes at once when the person asks, and one
// the person stopped is left alone until their next message.

test("a goal whose continuation fails right after a restart is tried again and continues once", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    await h.restart();
    await h.failNextStart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [200] });
    assert.equal(recovery.ok, false, JSON.stringify(recovery));
    assert.match((await h.intent()).error, /Vibe64 tries again shortly\.$/u);
    await h.waitFor(async () => await h.goalCommands() === commandsBefore + 1, "the next attempt continues the goal");
    await h.waitFor(() => h.turnActive(), "Claude works on the goal again");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "active");
    assert.equal(read.error, undefined, "the earlier failure no longer shows");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "nothing is sent twice");
  });
});

test("Resume of a paused Claude goal after a restart answers within seconds", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    const running = await h.startRunningGoal("All checks pass");
    const paused = await h.service.updateCanonicalAgentGoal("test", { ...h.options, action: "pause",
      expectedSegmentId: running.target.segmentId, expectedGoalId: running.goal.id });
    assert.equal(paused.status, "paused", JSON.stringify(paused));
    await h.restart();
    const recovery = await h.service.recoverActiveGoals();
    assert.equal(recovery.results.at(-1).skipped, true, "a paused goal stays paused");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "paused");
    const commandsBefore = await h.goalCommands();
    const startedAt = Date.now();
    const resumed = await h.service.updateCanonicalAgentGoal("test", { ...h.options, action: "resume",
      expectedSegmentId: read.target.segmentId, expectedGoalId: read.goal.id, messageId: "resume-after-restart" });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(resumed.status, "accepted", JSON.stringify(resumed));
    assert.ok(elapsedMs < 10_000, `Resume answered in ${elapsedMs} ms`);
    assert.equal(await h.goalCommands(), commandsBefore + 1);
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "active");
  });
});

test("after Stop a restart leaves a Claude goal alone, and the person's next message makes restarts continue it again, once", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    await h.service.interruptAgentTurn("test", {}, h.options);
    await h.waitFor(async () => !await h.turnActive(), "Stop ends the goal's turn");
    assert.equal((await h.intent()).active, false, "Stop ends the goal's continuation");
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "active", "Claude's goal stays active");
    const commandsBefore = await h.goalCommands();
    await h.restart();
    const afterStop = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(afterStop.results.at(-1).skipped, true, JSON.stringify(afterStop));
    assert.equal(await h.goalCommands(), commandsBefore, "a restart after Stop sends nothing");
    // The person's next message continues the goal and enrolls its continuation again.
    const sent = await h.waitFor(async () => {
      const result = await h.service.sendAgentMessage("test", { message: "Keep going", messageId: "after-stop" }, h.options);
      return result?.code === "vibe64_agent_write_mode_busy" ? null : result;
    }, "the message is admitted once the restart's own work ends");
    assert.equal(sent.delivered, true, JSON.stringify(sent));
    assert.equal((await h.intent()).active, true, "the message enrolls the goal's continuation again");
    assert.equal(await h.goalCommands(), commandsBefore, "the message itself sends no goal command");
    await h.waitFor(async () => !await h.turnActive(), "the message's turn ends");
    await h.restart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify({ recovery, intent: await h.intent(), warnings: h.warnings }));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(await h.goalCommands(), commandsBefore + 1, "it is never sent twice");
  });
});
