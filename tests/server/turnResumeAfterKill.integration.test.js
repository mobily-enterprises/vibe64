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
// conversation, with Vibe64's note leading its message and a red entry in the chat's history; interrupted again at
// once, it stops for Continue. Claude is the goal harness's synthetic one (claudeGoalTestHelpers.js); the routing rules'
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

test("a Main chat turn whose server was killed mid-turn resumes once on the next server, and stops when interrupted again at once", { timeout: 60_000 }, async t => {
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

    // Stopped and started again within the crash-loop window: the turn waits for the person.
    await h.restart();
    assert.equal((await h.service.recoverInterruptedTurns({ retryDelaysMs: [] })).ok, true, JSON.stringify(h.warnings));
    const loop = await h.waitFor(async () => (await notices()).find(turn => turn.metadata?.vibe64TurnInterruption?.outcome === "loop"),
      async () => JSON.stringify({ notices: await notices(), warnings: h.warnings }));
    assert.match(loop.system.text, /^Vibe64 restarted at \d\d:\d\d UTC \(it was stopped and started again\)\.\n/u);
    assert.match(loop.system.text, /\nNot resumed: stopped: Vibe64 restarted twice while it ran\. Choose Continue to try again\.$/u);
    const session = await h.store.readSession("test");
    const request = assistantRoutingRequestForDisplay(session.metadata);
    assert.equal(request.status, "waiting", JSON.stringify(request));
    assert.equal(request.error, "Stopped: Vibe64 restarted twice while it ran. Choose Continue to try again.");
    assert.equal(sessionAssistantWorking(session), false, "Save and Update see no AI at work");
    assert.equal(await h.turnActive(), false);
    assert.equal((await resumes()).length, 1, "nothing is resumed twice");
    assert.equal((await notices()).length, 2, "each interruption is told once");
  });
});
