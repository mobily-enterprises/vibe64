import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { sessionAssistantWorking } from "../../packages/vibe64-terminals/src/server/serviceSessionRecords.js";
import { goalHarness } from "./claudeGoalTestHelpers.js";

// The server-level proof that an interrupted turn is resumed: a real Vibe64 server process whose Main chat turn is
// working is killed (SIGKILL, by its own pid), and the next server resumes that turn once, in the same Claude
// conversation, with Vibe64's note leading its message and a red entry in the chat's history; a planned restart at
// once after that resume is carried on through too, told in one informational line. Claude is the goal harness's synthetic one (claudeGoalTestHelpers.js); the routing rules'
// other cases are assistantRoutingTurnResume.unit.test.js.

const SERVER = fileURLToPath(new URL("./fixtures/turnResumeServer.mjs", import.meta.url));
const NOTE = "[Vibe64 note: your previous turn was interrupted.";

/** A second server process over the harness's folder, once its Main chat turn is working. */
async function startKillableServer(t, root) {
  const output = [];
  const server = spawn(process.execPath, [SERVER, root], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  server.stdout.on("data", chunk => output.push(String(chunk)));
  server.stderr.on("data", chunk => output.push(String(chunk)));
  const exited = new Promise(resolve => server.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    await exited;
  });
  const first = await Promise.race([new Promise(resolve => server.once("message", resolve)), exited]);
  assert.deepEqual(first, { working: true }, output.join(""));
  return { server, exited };
}

test("a Main chat turn whose server was killed mid-turn resumes once on the next server, and carries on through a planned restart at once", { timeout: 60_000 }, async t => {
  // This harness's server only sets the session up; the server process it starts runs the turn and is killed.
  const h = await goalHarness(t);
  const { server, exited } = await startKillableServer(t, h.root);
  server.kill("SIGKILL");
  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });
  await h.restart();

  // The Claude processes that ran the Main chat conversation (not its account or model checks).
  const starts = async () => (await h.trace()).filter(row => Array.isArray(row.args) &&
    (row.args.includes("--session-id") || row.args.includes("--resume")));
  const resumes = async () => (await h.trace()).filter(row => row.frame?.type === "user" &&
    JSON.stringify(row.frame.message.content).includes(NOTE));
  const notices = async () => (await h.store.readConversationLog("test"))
    .filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:"));
  const conversationOf = args => args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1];
  await h.inProject(async () => {
    const [killed] = await starts();
    const recovery = await h.service.recoverInterruptedTurns({ retryDelaysMs: [] });
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    await h.waitFor(async () => (await resumes()).length === 1, async () => JSON.stringify({ trace: await h.trace(), warnings: h.warnings }));
    await h.waitFor(() => h.turnActive(), "Claude works on the turn again");
    // The same Claude conversation continues it.
    const resumedBy = (await starts()).at(-1);
    assert.ok(resumedBy.args.includes("--resume"), JSON.stringify(resumedBy));
    assert.equal(conversationOf(resumedBy.args), conversationOf(killed.args));
    const [resumed] = await notices();
    assert.match(resumed.system.text,
      /^Vibe64 restarted at (\d\d:\d\d) UTC \(the server stopped unexpectedly\)\.\nResumed after Vibe64 restarted at \1 UTC\.$/u);
    assert.equal(resumed.metadata.vibe64TurnInterruption.outcome, "resumed");
    const events = h.warnings.map(record => record?.event);
    for (const event of ["vibe64.turn_resume.recovery_started", "vibe64.turn_resume.resumed", "vibe64.turn_resume.recovery_finished"]) {
      assert.ok(events.includes(event), JSON.stringify(h.warnings));
    }
    assert.equal(sessionAssistantWorking(await h.store.readSession("test")), true, "the resumed turn is the AI at work");

    // Stopped and started again at once, in order, as a release or its rollback stops it: the turn carries on, told
    // in one informational line, however soon after its resume.
    await h.restart();
    assert.equal((await h.service.recoverInterruptedTurns({ retryDelaysMs: [] })).ok, true, JSON.stringify(h.warnings));
    await h.waitFor(async () => (await resumes()).length === 2, async () => JSON.stringify({ notices: await notices(), warnings: h.warnings }));
    const carried = await h.waitFor(async () => (await notices()).find(turn => turn.metadata?.vibe64TurnInterruption?.cause === "restart"),
      async () => JSON.stringify({ notices: await notices(), warnings: h.warnings }));
    assert.match(carried.system.text, /^Vibe64 was restarted at \d\d:\d\d UTC; this turn carried on\.$/u);
    assert.equal(carried.metadata.vibe64TurnInterruption.outcome, "resumed");
    await h.waitFor(() => h.turnActive(), "Claude works on the turn again");
    const session = await h.store.readSession("test");
    assert.equal(assistantRoutingRequestForDisplay(session.metadata).error, undefined);
    assert.equal(sessionAssistantWorking(session), true, "the turn is the AI at work again");
    assert.equal((await notices()).length, 2, "each interruption is told once");
  });
});

test("a Main chat turn no attempt after a restart could recover stops once, saying why in red, and no later restart tries it again", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  const request = async () => assistantRoutingRequestForDisplay((await h.store.readSession("test")).metadata);
  const notices = async () => (await h.store.readConversationLog("test"))
    .filter(turn => turn.system?.messageId?.startsWith("vibe64-turn-interrupted:"));
  const events = name => h.warnings.filter(record => record?.event === name).length;
  await h.inProject(async () => {
    await h.routeAsSenior();
    const sent = await h.sendAsPerson({ messageId: "long-request", message: "Keep working on the report" });
    assert.notEqual(sent.ok, false, JSON.stringify(sent));
    await h.waitFor(async () => await h.turnActive() && (await request())?.delivery === "accepted", "Claude works on the delivered turn");
    // The person who sent it is removed from the project while Vibe64 restarts: no attempt can resume it as them.
    h.removeSender();
    await h.restart();
    // The last attempt (here the only one) fails.
    const recovery = await h.service.recoverInterruptedTurns({ retryDelaysMs: [] });
    assert.equal(recovery.ok, false, JSON.stringify(recovery));
    assert.equal(recovery.results.find(result => result.chat === "main")?.stopped, true, JSON.stringify({ recovery, warnings: h.warnings }));
    const stopped = await request();
    assert.equal(stopped.status, "waiting", "it no longer reads as the AI at work");
    assert.equal(stopped.error,
      "Vibe64 could not resume this turn after the restart: goal-owner can no longer use this project. Choose Continue to try again.");
    assert.ok(stopped.followup, "Continue resumes it");
    const entries = await notices();
    assert.equal(entries.length, 1, JSON.stringify(entries));
    assert.match(entries[0].system.text,
      /^Vibe64 restarted at \d\d:\d\d UTC \(it was stopped and started again\)\.\nNot resumed: goal-owner can no longer use this project\. Choose Continue to try again\.$/u);
    assert.equal(entries[0].metadata.vibe64TurnInterruption.outcome, "not-resumed");
    assert.equal(events("vibe64.turn_resume.recovery_stopped"), 1, JSON.stringify(h.warnings));
    const failures = events("vibe64.turn_resume.recovery_failed");
    // Later restarts leave it alone: no attempt, no entry and no log line of its own.
    for (let restart = 0; restart < 2; restart += 1) {
      await h.restart();
      const later = await h.service.recoverInterruptedTurns({ retryDelaysMs: [] });
      assert.equal(later.ok, true, JSON.stringify({ later, warnings: h.warnings }));
      assert.equal(later.results.find(result => result.sessionId === "test")?.reason, "nothing-working", JSON.stringify(later));
    }
    assert.equal((await notices()).length, 1, "it is told once");
    assert.equal(events("vibe64.turn_resume.recovery_failed"), failures);
    assert.equal(events("vibe64.turn_resume.recovery_stopped"), 1);
  });
});
