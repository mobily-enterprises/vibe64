import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import {
  COMMAND_REPEAT_LIMITS,
  createAgentCommandRepeats
} from "../../packages/vibe64-terminals/src/server/agentCommandRepeats.js";
import { createAgentSessionCommandService } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { createServiceTurnPublication } from "../../packages/vibe64-terminals/src/server/serviceTurnPublication.js";

// The editor counts each Main turn's own shell commands (agentCommandRepeats.js): the same command text run again and
// again, and the time repeated commands take. A turn that crosses the line, clearly broken and not a target, tells
// its AI once through the turn's steer, and the person reads the same numbers in Main chat when the turn ends. The
// count never stops, slows or changes a command.

const MINUTE = 60_000;
const SESSION = "2026-11-26_20-00-00";
const TEST_COMMAND = "npm test -- tests/server/shop.test.js 2>&1 | tail -40";

test("the line is clearly broken, not a target: five runs of one text with five minutes in all, or fifteen minutes of repeats", () => {
  assert.deepEqual({ ...COMMAND_REPEAT_LIMITS }, { runs: 5, runsMs: 5 * MINUTE, repeatedMs: 15 * MINUTE });
});

test("a turn that reruns one command five times gets exactly one notice, with the command, its runs and its minutes", () => {
  const repeats = createAgentCommandRepeats();
  const notices = [];
  for (let run = 0; run < 4; run += 1) notices.push(repeats.record(SESSION, "turn-1", TEST_COMMAND, 2 * MINUTE));
  assert.deepEqual(notices, ["", "", "", ""], "four runs are not the line");
  // Whitespace alone never makes a different command.
  notices.push(repeats.record(SESSION, "turn-1", `  npm test --  tests/server/shop.test.js\n2>&1 | tail -40 `, 2 * MINUTE));
  repeats.record(SESSION, "turn-1", "git status --short", 1_000);
  for (let run = 0; run < 3; run += 1) notices.push(repeats.record(SESSION, "turn-1", TEST_COMMAND, 2 * MINUTE));
  const given = notices.filter(Boolean);
  assert.equal(given.length, 1, "one notice per turn, however often the command runs again");
  assert.equal(notices[4], given[0], "the notice comes with the run that crosses the line");
  assert.match(given[0], /`npm test -- tests\/server\/shop\.test\.js 2>&1 \| tail -40` has run 5 times \(10 min in all\)/u);
  assert.match(given[0], /commands run more than once have taken 10 min of this turn's 10 min of commands/u);
  assert.match(given[0], /batch your changes/u);
  assert.match(given[0], /narrowest test/u);
  assert.match(given[0], /full set once at the end/u);
  assert.match(given[0], /nothing is stopped or slowed/u);
  assert.deepEqual(repeats.read(SESSION), {
    turnId: "turn-1", runs: 9, totalMs: 16 * MINUTE + 1_000, repeatedMs: 16 * MINUTE, crossed: true, commands: 2
  });
});

test("a normal turn gets none: a few focused reruns, many cheap repeats, and different commands of any length", () => {
  const repeats = createAgentCommandRepeats();
  const notices = [];
  for (let run = 0; run < 4; run += 1) notices.push(repeats.record(SESSION, "turn-1", TEST_COMMAND, 3 * MINUTE));
  for (let run = 0; run < 40; run += 1) notices.push(repeats.record(SESSION, "turn-1", "git status --short", 200));
  for (let file = 0; file < 30; file += 1) notices.push(repeats.record(SESSION, "turn-1", `npm test -- tests/server/f${file}.test.js`, 2 * MINUTE));
  notices.push(repeats.record(SESSION, "turn-1", "npm run test:full", 40 * MINUTE));
  assert.deepEqual(notices.filter(Boolean), []);
  assert.equal(repeats.read(SESSION).crossed, false);
  assert.equal(repeats.endTurn(SESSION), null, "and the person reads nothing at its end");
});

test("fifteen minutes of repeated commands is the line too, though no one command ran five times", () => {
  const repeats = createAgentCommandRepeats();
  const notices = [];
  for (const command of ["npm test -- tests/server/a.test.js", "npm test -- tests/server/b.test.js"]) {
    for (let run = 0; run < 2; run += 1) notices.push(repeats.record(SESSION, "turn-1", command, 3 * MINUTE));
  }
  assert.deepEqual(notices.filter(Boolean), [], "twelve minutes is not the line");
  const notice = repeats.record(SESSION, "turn-1", "npm test -- tests/server/a.test.js", 3 * MINUTE);
  assert.match(notice, /`npm test -- tests\/server\/a\.test\.js` has run 3 times \(9 min in all\)/u);
  assert.match(notice, /commands run more than once have taken 15 min of this turn's 15 min of commands/u);
});

test("the count follows the turn's own commands: a new turn, its end and the session's close start again from nothing", () => {
  const repeats = createAgentCommandRepeats();
  for (let run = 0; run < 4; run += 1) assert.equal(repeats.record(SESSION, "turn-1", TEST_COMMAND, 3 * MINUTE), "");
  // The next turn's runs never add to the last one's: together they would be 8 runs and 24 minutes.
  for (let run = 0; run < 4; run += 1) assert.equal(repeats.record(SESSION, "turn-2", TEST_COMMAND, 3 * MINUTE), "");
  assert.deepEqual(repeats.read(SESSION), {
    turnId: "turn-2", runs: 4, totalMs: 12 * MINUTE, repeatedMs: 12 * MINUTE, crossed: false, commands: 1
  });
  assert.equal(repeats.endTurn(SESSION), null);
  assert.equal(repeats.read(SESSION), null, "the turn's end forgets its count");
  for (let run = 0; run < 4; run += 1) assert.equal(repeats.record(SESSION, "turn-3", TEST_COMMAND, 3 * MINUTE), "");
  repeats.forget(SESSION);
  assert.equal(repeats.read(SESSION), null, "a closed session keeps nothing");
  // Another session's turn is its own.
  for (let run = 0; run < 4; run += 1) repeats.record("other-session", "turn-9", TEST_COMMAND, 2 * MINUTE);
  assert.equal(repeats.record(SESSION, "turn-9", TEST_COMMAND, 2 * MINUTE), "");
});

test("the person's summary at the turn's end gives the turn's final numbers, the most costly repeats first", () => {
  const repeats = createAgentCommandRepeats();
  for (let run = 0; run < 7; run += 1) repeats.record(SESSION, "turn-1", TEST_COMMAND, 4 * MINUTE);
  for (let run = 0; run < 3; run += 1) repeats.record(SESSION, "turn-1", "npm run lint", 2 * MINUTE);
  repeats.record(SESSION, "turn-1", "npm run build", 6 * MINUTE);
  const summary = repeats.endTurn(SESSION);
  assert.equal(summary.turnId, "turn-1");
  assert.match(summary.text, /`npm test -- tests\/server\/shop\.test\.js 2>&1 \| tail -40` 7 times \(28 min\), `npm run lint` 3 times \(6 min\)/u);
  assert.match(summary.text, /Commands run more than once took 34 min of the turn's 40 min of commands/u);
  assert.match(summary.text, /Vibe64 told the AI once/u);
});

test("a command shows only as a short excerpt, its secrets and token-looking strings masked", () => {
  const repeats = createAgentCommandRepeats();
  const secretCommand = "GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz curl -H 'Authorization: Bearer abc.def.ghi' " +
    "https://deploy:hunter2@example.test/x --with-token=sk0123456789abcdefghijklmnopqrstu9 tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0 " +
    `&& npm test ${"-- tests/server/long.test.js ".repeat(20)}`;
  let notice = "";
  for (let run = 0; run < 5; run += 1) notice ||= repeats.record(SESSION, "turn-1", secretCommand, 2 * MINUTE);
  assert.ok(notice);
  for (const secret of ["ghp_0123456789", "abc.def.ghi", "hunter2", "sk0123456789", "9f8e7d6c5b4a"]) {
    assert.equal(notice.includes(secret), false, `${secret} is masked`);
  }
  const excerpt = notice.match(/`([^`]*)` has run/u)[1];
  assert.ok(excerpt.length <= 160, "a long command is cut");
  assert.ok(excerpt.endsWith("…"));
});

test("a turn holds at most a bounded number of different commands, and still counts their time", () => {
  const repeats = createAgentCommandRepeats();
  for (let index = 0; index < 1_500; index += 1) repeats.record(SESSION, "turn-1", `sed -n ${index},+5p file.js`, 10);
  assert.deepEqual(repeats.read(SESSION), {
    turnId: "turn-1", runs: 1_500, totalMs: 15_000, repeatedMs: 0, crossed: false, commands: 1_000
  });
});

test("Main turn ends ask for the turn's command summary; a temporary chat's turn and a running turn do not", async () => {
  const summarized = [];
  const work = [];
  const warnings = [];
  const { publishAgentSessionChanged } = createServiceTurnPublication({
    afterRoutedTurn: async () => {},
    afterTemporaryTurn: async () => {},
    cancelGoalIfMainAiChanged: async () => false,
    continueGoalWhenLimitResets: async () => {},
    conversationTurns: { settled: async () => {} },
    finishInterruptedCloses: async () => {},
    restorePreviewAfterTurn: () => null,
    summarizeTurnCommands: async (sessionId) => {
      summarized.push(sessionId);
      if (summarized.length === 2) throw new Error("store gone");
    },
    logger: { warn: (fields) => warnings.push(fields.event), info() {}, error() {}, debug() {} },
    providerUsage: { observe() {} },
    publishSessionChanged: { agentTerminal: async () => {} },
    resumeGoalAfterTurn: async () => false,
    waitGoalForAccountAfterTurn: async () => false,
    state: { lifecycle: { closing: false }, trackShutdownWork: (promise) => { work.push(promise); return promise; } },
    workspacePreparation: { ensureWorkspacePrepared: async () => {} }
  });
  for (const reason of ["claude-stream-turn-active", "temporary-agent-turn-idle", "agent-plan-usage"]) {
    await publishAgentSessionChanged(SESSION, { reason });
  }
  await Promise.all(work);
  assert.deepEqual(summarized, []);
  for (const reason of ["claude-stream-turn-idle", "codex-app-server-turn-idle", "opencode-server-turn-idle"]) {
    await publishAgentSessionChanged(SESSION, { reason });
  }
  await Promise.all(work);
  assert.deepEqual(summarized, [SESSION, SESSION, SESSION]);
  assert.deepEqual(warnings, ["vibe64.agent_session_command.repeats_summary_failed"], "a summary that fails is only logged");
});

/** The command service with one bound session whose Main turn is `routing`, its commands taking `minutes` each. */
async function sessionCommands(t, { routing, minutes, runCommand, noteAgent }) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-command-repeats-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  // A short TMPDIR of its own holds the session's temporary folder, as the other session command tests keep it.
  const editorTemp = await realpath(await mkdtemp("/tmp/v64-acr-"));
  t.after(() => rm(editorTemp, { recursive: true, force: true }));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = editorTemp;
  t.after(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });
  const sourceRoot = path.join(temporaryRoot, "sessions", "active", SESSION, "source");
  await mkdir(sourceRoot, { recursive: true });
  const descriptor = {
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: "managed_session_source" },
    sessionId: SESSION
  };
  let clock = Date.parse("2026-11-26T12:00:00Z");
  const systemRows = [];
  const published = [];
  const commandRepeats = createAgentCommandRepeats();
  const service = createAgentSessionCommandService({
    logger: silentLogger,
    now: () => clock,
    commandRepeats,
    noteAgent,
    publishSessionChanged: async (sessionId, payload) => { published.push([sessionId, payload]); },
    project: {
      async createSessionStore() {
        return {
          async readSessionSourceDescriptor() { return descriptor; },
          async readMetadataValue(_sessionId, name) {
            return name === "assistant_routing_request" ? JSON.stringify(routing()) : "";
          },
          async writeConversationSystemMessage(sessionId, notice) {
            systemRows.push([sessionId, notice]);
            return { id: notice.messageId, system: notice };
          }
        };
      },
      async readCurrentProject() { return { projectRoot: path.join(temporaryRoot, "project"), slug: "shop" }; },
      async runInProjectContext(_slug, operation) { return operation(); }
    },
    async runCommand(request) {
      clock += minutes * MINUTE;
      const exit = await runCommand(request);
      await writeFile(request.baseEnv.VIBE64_AGENT_SESSION_RUN_OUTPUT_PATH, "ok\n");
      await writeFile(request.baseEnv.VIBE64_AGENT_SESSION_RUN_RESULT_PATH, `${exit}\n`);
      return { execution: { id: `execution-${clock}` }, ok: true };
    }
  });
  await service.bindSession(SESSION, { wrapperHostDir: path.join(temporaryRoot, "wrappers") });
  const run = (command) => service.run({ commandBase64: Buffer.from(command, "utf8").toString("base64url"), cwd: sourceRoot, sessionId: SESSION });
  return { commandRepeats, published, run, service, systemRows };
}

async function eventually(check, message) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("through run(): a routed Main turn's repeated test runs steer one notice to its AI, and its end shows the person the numbers", async (t) => {
  const notes = [];
  let turnId = "turn-a";
  const person = { id: 7, username: "owner" };
  const { commandRepeats, published, run, service, systemRows } = await sessionCommands(t, {
    routing: () => ({ status: "working", turnId, stage: "pass", pass: { item: "Speed pass" }, submittedBy: person }),
    minutes: 3,
    runCommand: async () => 1,
    noteAgent: async (sessionId, message, options) => { notes.push({ sessionId, message, options }); }
  });
  for (let index = 0; index < 6; index += 1) {
    const result = await run(TEST_COMMAND);
    // The command's own answer is untouched: its exit code and output, whatever the count says.
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "ok\n");
  }
  await eventually(() => commandRepeats.read(SESSION)?.runs === 6, "every run is counted after it answers");
  await eventually(() => notes.length === 1, "the turn's AI is told");
  assert.equal(notes.length, 1, "exactly one notice for the turn");
  assert.equal(notes[0].sessionId, SESSION);
  assert.match(notes[0].message, /has run 5 times \(15 min in all\)/u);
  assert.deepEqual(notes[0].options, { actor: person, projectSlug: "shop" }, "the note acts for the person whose request runs");

  await service.summarizeTurnCommands(SESSION);
  assert.equal(systemRows.length, 1);
  assert.equal(systemRows[0][1].messageId, "vibe64-command-repeats:turn-a");
  assert.match(systemRows[0][1].text, /`npm test -- tests\/server\/shop\.test\.js 2>&1 \| tail -40` 6 times \(18 min\)/u);
  assert.match(systemRows[0][1].text, /Commands run more than once took 18 min of the turn's 18 min of commands/u);
  assert.deepEqual(published.map(([, payload]) => payload.payload.conversationLogPatch.type), ["upsert-turn"]);
  assert.equal(await service.summarizeTurnCommands(SESSION), null, "one summary per turn");

  // The next turn counts from nothing.
  turnId = "turn-b";
  for (let index = 0; index < 4; index += 1) await run(TEST_COMMAND);
  await eventually(() => commandRepeats.read(SESSION)?.runs === 4, "the next turn counts its own runs");
  assert.equal(commandRepeats.read(SESSION).turnId, "turn-b");
  assert.equal(notes.length, 1);
});

test("through run(): a normal turn gets no notice, and commands outside a routed Main turn are not counted", async (t) => {
  const notes = [];
  let routing = { status: "working", turnId: "turn-a" };
  const { commandRepeats, run, service, systemRows } = await sessionCommands(t, {
    routing: () => routing,
    minutes: 0.5,
    runCommand: async () => 0,
    noteAgent: async (sessionId, message) => { notes.push(message); throw new Error("the turn ended"); }
  });
  for (let index = 0; index < 6; index += 1) assert.equal((await run(TEST_COMMAND)).ok, true);
  await eventually(() => commandRepeats.read(SESSION)?.runs === 6, "every run is counted");
  assert.deepEqual(notes, [], "six half-minute runs are a normal turn");
  assert.equal(await service.summarizeTurnCommands(SESSION), null);
  assert.deepEqual(systemRows, []);

  // No Main turn runs (a temporary chat's command, say): nothing is counted.
  routing = { status: "complete", turnId: "turn-a" };
  for (let index = 0; index < 3; index += 1) await run(TEST_COMMAND);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(commandRepeats.read(SESSION), null);
});

test("through run(): a note that fails is only logged, and every command still answers as it ran", async (t) => {
  const notes = [];
  const slow = await sessionCommands(t, {
    routing: () => ({ status: "working", turnId: "turn-c" }),
    minutes: 4,
    runCommand: async () => 0,
    noteAgent: async (sessionId, message) => { notes.push(message); throw new Error("the turn ended"); }
  });
  for (let index = 0; index < 5; index += 1) {
    const result = await slow.run(TEST_COMMAND);
    assert.deepEqual([result.ok, result.exitCode, result.stdout], [true, 0, "ok\n"]);
  }
  await eventually(() => notes.length === 1, "the crossing run tries its note once");
});

test("through run(): a tally that fails is only logged, and every command still answers as it ran", async (t) => {
  let reads = 0;
  const { commandRepeats, run } = await sessionCommands(t, {
    routing: () => {
      reads += 1;
      throw new Error("the routing request is unreadable");
    },
    minutes: 4,
    runCommand: async () => 3,
    noteAgent: async () => assert.fail("nothing is counted, so nothing is noted")
  });
  for (let index = 0; index < 5; index += 1) {
    const result = await run(TEST_COMMAND);
    assert.deepEqual([result.ok, result.exitCode, result.stderr], [false, 3, "ok\n"]);
  }
  await eventually(() => reads === 5, "each finished command tried its tally");
  assert.equal(commandRepeats.read(SESSION), null);
});
