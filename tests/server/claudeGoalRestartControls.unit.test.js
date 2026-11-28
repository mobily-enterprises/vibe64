import assert from "node:assert/strict";
import { test } from "node:test";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// Across a server restart, a Main chat Claude goal whose continuation fails
// is tried again, one whose AI account changed continues on the account
// connected now, one no attempt could continue stops once, paused, saying why,
// a paused one resumes at once when the person asks, and one the person
// stopped is left alone until their next message.

const goalNotices = async h => (await h.store.readConversationLog("test"))
  .filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:goal:"));

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

test("a goal whose AI account changed while it ran continues after a restart on the account connected now, and says so", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    const before = (await h.intent()).connectionIdentity;
    assert.ok(before, "the goal records the AI connection it runs on");
    // The owner signs Claude in with another account in AI Accounts while the goal runs.
    await h.setAccount({ loggedIn: true, authMethod: "claude.ai", email: "second@example.test" });
    await h.restart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify(recovery));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    const [line] = await goalNotices(h);
    assert.match(line.system.text, /^Vibe64 was restarted at \d\d:\d\d UTC; the goal carried on with the AI account connected now\.$/u);
    const after = await h.intent();
    assert.equal(after.active, true);
    assert.ok(after.connectionIdentity && after.connectionIdentity !== before, "it now runs on the account connected now");
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).error, undefined);
    // The next restart finds it on that account and carries it on as usual.
    await h.restart();
    const next = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(next.results.at(-1).resumed, true, JSON.stringify({ next, warnings: h.warnings }));
    assert.match((await goalNotices(h)).at(-1).system.text, /^Vibe64 was restarted at \d\d:\d\d UTC; the goal carried on\.$/u);
  });
});

test("a goal no attempt after a restart could continue stops once, saying why in red, and no later restart tries it again", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    // The project no longer authorizes the person who set it while Vibe64 restarts. (A goal a restart finds signed out
    // waits for an account instead: claudeGoalAccountSet.unit.test.js.)
    h.removeSender();
    await h.restart();
    // The last attempt (here the only one) fails.
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(recovery.ok, false, JSON.stringify(recovery));
    assert.equal(recovery.results.at(-1).stopped, true, JSON.stringify({ recovery, warnings: h.warnings }));
    const intent = await h.intent();
    assert.equal(intent.active, false, "no later restart continues it by itself");
    assert.match(intent.error, /^Goal continuation after restart failed: .+ Choose Resume goal to try again\.$/u);
    assert.doesNotMatch(intent.error, /tries again/u);
    const entries = await goalNotices(h);
    assert.equal(entries.length, 1, JSON.stringify(entries));
    assert.match(entries[0].system.text,
      /^Vibe64 restarted at \d\d:\d\d UTC \(it was stopped and started again\)\.\nNot resumed: .+\. Choose Resume goal to try again\.$/u);
    assert.equal(entries[0].metadata.vibe64TurnInterruption.outcome, "not-resumed");
    assert.equal(h.warnings.filter(record => record?.event === "vibe64.agent_goal.recovery_stopped").length, 1, JSON.stringify(h.warnings));
    // Later restarts leave it alone: Resume goal continues it once the person can use the project again.
    for (let restart = 0; restart < 2; restart += 1) {
      await h.restart();
      const later = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
      assert.equal(later.ok, true, JSON.stringify({ later, warnings: h.warnings }));
      assert.equal(later.results.at(-1).skipped, true, JSON.stringify(later));
    }
    assert.equal(await h.goalCommands(), commandsBefore, "nothing was sent");
    assert.equal((await goalNotices(h)).length, 1, "it is told once");
    assert.match((await h.service.readCanonicalAgentGoal("test", h.options)).error, /Choose Resume goal to try again\.$/u,
      "the goal control shows why");
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
