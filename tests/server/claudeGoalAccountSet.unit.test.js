import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// A goal whose turn its AI account stopped is marked, on the goal's own interruption record, as stopped by the account,
// and setting an account its person can use continues it once, through the same sweep that continues every turn so
// marked (serviceTurnsAfterAccountSet.js), as Resume goal would. A goal its person stopped or paused never is.

const goalNotices = async h => (await h.store.readConversationLog("test"))
  .filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:goal:"));
const OWNER = { loggedIn: true, authMethod: "claude.ai", email: "owner@example.test" };

test("a Claude goal whose turn a sign-out ended continues once, by itself, when an account its person can use is set", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    // The owner signs Claude out in AI Accounts while the goal works: Claude's next request is refused.
    await h.setAccount({ loggedIn: false });
    await h.waitFor(async () => !await h.turnActive(), "the sign-out ends the goal's turn");
    await h.waitFor(async () => (await goalNotices(h)).length === 1, async () => `its entry says it waits: ${JSON.stringify({
      intent: await h.intent(), warnings: h.warnings })}`);
    const [waiting] = await goalNotices(h);
    assert.match(waiting.system.text, /^The AI account needs signing in again at \d\d:\d\d UTC: Invalid API key · Please run \/login\.\n/u);
    assert.match(waiting.system.text, /\nNot resumed yet: sign in to the AI account again in AI Accounts, and Vibe64 continues it\.$/u);
    assert.equal(waiting.metadata.vibe64TurnInterruption.outcome, "account");
    const intent = await h.intent();
    assert.equal(intent.active, true, "the goal still waits to continue");
    assert.equal(intent.error, "Sign in to the AI account again in AI Accounts, and Vibe64 continues the goal.",
      "the goal control says it waits for the sign-in");
    // Another account set while Claude is still signed out (another AI's, say) leaves it waiting.
    await h.service.continueTurnsAfterAccountSet();
    assert.equal(await h.goalCommands(), commandsBefore, "nothing is sent while the account can't be used");
    assert.equal((await goalNotices(h)).length, 1, "it is told once");
    // The owner signs in again: the events of that sign-in reach the sweep twice, at once.
    await h.setAccount(OWNER);
    await Promise.all([h.service.continueTurnsAfterAccountSet(), h.service.continueTurnsAfterAccountSet()]);
    await h.waitFor(async () => await h.goalCommands() === commandsBefore + 1, async () => `the goal continues: ${JSON.stringify({
      intent: await h.intent(), warnings: h.warnings })}`);
    await h.waitFor(() => h.turnActive(), "Claude works on the goal again");
    const resumed = (await goalNotices(h)).at(-1);
    assert.match(resumed.system.text, /\nResumed after the AI account was signed out at \d\d:\d\d UTC, with the AI account connected now\.$/u);
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "active");
    assert.equal(read.error, undefined, "the wait no longer shows");
    // A later account set finds nothing marked.
    await h.service.continueTurnsAfterAccountSet();
    await delay(300);
    assert.equal(await h.goalCommands(), commandsBefore + 1, "it continues once");
  });
});

test("a Claude goal its person stopped is not continued when an account is set, even after a sign-out", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    await h.service.interruptAgentTurn("test", {}, h.options);
    await h.waitFor(async () => !await h.turnActive(), "Stop ends the goal's turn");
    assert.equal((await h.intent()).active, false, "Stop ends the goal's continuation");
    const commandsBefore = await h.goalCommands();
    await h.setAccount({ loggedIn: false });
    await h.setAccount(OWNER);
    await h.service.continueTurnsAfterAccountSet();
    await delay(300);
    assert.equal(await h.goalCommands(), commandsBefore, "nothing is sent");
    assert.deepEqual(await goalNotices(h), [], "nothing is said");
    assert.equal(await h.turnActive(), false);
  });
});

test("a Claude goal its person paused while it waited for an account stays paused when one is set", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    await h.setAccount({ loggedIn: false });
    await h.waitFor(async () => (await goalNotices(h)).length === 1, "the goal waits for an account");
    // Claude's goal reads again once Claude is signed in; the person pauses it before the account set reaches it.
    await h.setAccount(OWNER);
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    const paused = await h.service.updateCanonicalAgentGoal("test", { ...h.options, action: "pause",
      expectedSegmentId: read.target.segmentId, expectedGoalId: read.goal.id });
    assert.equal(paused.status, "paused", JSON.stringify(paused));
    await h.service.continueTurnsAfterAccountSet();
    await delay(300);
    assert.equal(await h.goalCommands(), commandsBefore, "nothing is sent");
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "paused");
  });
});

test("a Claude goal a restart found signed out waits for an account, through later restarts, and continues once when one is set", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    // Claude is signed out while Vibe64 is down.
    await h.restart({ beforeStart: () => h.setAccount({ loggedIn: false }) });
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    assert.equal(recovery.results.at(-1).waiting, true, JSON.stringify(recovery));
    const intent = await h.intent();
    assert.equal(intent.active, true, "it waits to continue");
    assert.match(intent.error, /\. Vibe64 continues the goal once an AI account you can use is set in AI Accounts\.$/u);
    const [waiting] = await goalNotices(h);
    assert.match(waiting.system.text, /^Vibe64 restarted at \d\d:\d\d UTC \(it was stopped and started again\)\.\nNot resumed yet: .+\. Vibe64 continues it once an AI account you can use is set in AI Accounts\.$/u);
    // A later restart leaves it waiting, and says nothing again.
    await h.restart();
    const later = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(later.results.at(-1).skipped, true, JSON.stringify(later));
    assert.equal(later.results.at(-1).reason, "waiting-for-account", JSON.stringify(later));
    assert.equal((await goalNotices(h)).length, 1, "it is told once");
    assert.equal(await h.goalCommands(), commandsBefore, "nothing was sent");
    await h.setAccount(OWNER);
    await h.service.continueTurnsAfterAccountSet();
    await h.waitFor(async () => await h.goalCommands() === commandsBefore + 1, async () => `the goal continues: ${JSON.stringify({
      intent: await h.intent(), warnings: h.warnings })}`);
    // It continues as the restart's continuation would have, the earlier server's run verified stopped first.
    assert.match((await goalNotices(h)).at(-1).system.text, /^Vibe64 was restarted at \d\d:\d\d UTC; the goal carried on\.$/u);
    await h.service.continueTurnsAfterAccountSet();
    await delay(300);
    assert.equal(await h.goalCommands(), commandsBefore + 1, "it continues once");
  });
});
