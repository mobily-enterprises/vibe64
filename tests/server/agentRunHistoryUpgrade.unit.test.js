// 20261125-agent-run-history against runs shaped as earlier releases wrote them: every event of every turn, Codex's
// several a turn and one at each phase change, pretty-printed, up to the 4 MiB a long session's run reached.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeAgentRunHistory } from "@local/vibe64-runtime/server/agentRunHistoryUpgrade";
import { readVibe64WorkingTurns } from "@local/vibe64-runtime/server/workingTurns";

const upgradeId = "20261125-agent-run-history";
const at = (minute) => new Date(Date.UTC(2026, 9, 1) + minute * 1000).toISOString();
const turnId = (turn) => `019a${String(turn).padStart(4, "0")}-5f1e-7c2a-9b3d-${String(turn).padStart(12, "0")}`;

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-run-history-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const createStore = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects/example") });
  const backupRoot = path.join(systemRoot, "upgrades/backups", upgradeId);
  const reports = [];
  const run = (apply, report = (_level, message) => reports.push(message)) => upgradeAgentRunHistory({ systemRoot, backupRoot, apply, report });
  return { systemRoot, store: createStore(), createStore, backupRoot, reports, run };
}

/**
 * A Codex run as release 10 left it after `turns` turns: claimed, active, a phase change at each item (reasoning,
 * then a command, a few times over), completed or failed, result processed, with the fields the journal writes.
 * The last turn can be left working, as a stop mid-turn leaves it.
 */
function codexRun(turns, { working = false, phases = 6 } = {}) {
  const events = [];
  let second = 0;
  const event = (kind, state, extra = {}) => events.push({ kind, message: "", ...extra, at: at(second += 1), state });
  for (let turn = 1; turn <= turns; turn += 1) {
    const last = turn === turns;
    event("codex-app-server-turn-claimed", "starting", { clientId: `client-${turn}` });
    event("codex-app-server-pending-user-message-owned", "starting", { clientId: `client-${turn}` });
    for (let phase = 0; phase < phases; phase += 1) {
      event("codex-app-server-turn-active", "active", { phase: phase % 2 ? "" : "reasoning" });
    }
    if (last && working) break;
    const failed = turn % 17 === 0;
    event(failed ? "codex-app-server-turn-failed" : "codex-app-server-turn-completed", failed ? "failed" : "completed", failed
      ? { message: "Codex reported a stream disconnect before the turn completed; the reply so far was kept." }
      : {});
    event("codex-app-server-result-processed", failed ? "failed" : "completed", {
      providerThreadId: "019a0000-thread", providerTurnId: turnId(turn), resultReason: failed ? "failed" : "completed"
    });
  }
  const state = events.at(-1).state;
  return {
    active: ["starting", "active", "finalizing"].includes(state),
    error: "",
    events,
    finishedAt: working ? "" : events.at(-1).at,
    id: "codex_app_server",
    inputSource: "chat",
    outerTurnId: `outer-${turns}`,
    pendingUserMessageClientIds: working ? [`client-${turns}`] : [],
    provider: "codex",
    providerGoalStatus: "",
    providerGoalThreadId: "",
    providerGoalUpdatedAt: "",
    providerInterface: "codex_app_server",
    providerPhase: working ? "reasoning" : "",
    providerStatus: working ? "inProgress" : "completed",
    providerThreadId: "019a0000-thread",
    providerTurnId: turnId(turns),
    startedAt: events[0].at,
    state,
    updatedAt: events.at(-1).at
  };
}

/** A Claude run: one event at each state change, with the turn's fields. */
function claudeRun(turns) {
  const events = [];
  let second = 0;
  for (let turn = 1; turn <= turns; turn += 1) {
    for (const state of ["starting", "active", "completed"]) events.push({ kind: `claude-${state}`, state, message: "", at: at(second += 1) });
  }
  return {
    active: false, engineId: "claude", error: "", events, finishedAt: events.at(-1).at, id: "claude_stream_json", model: "claude-opus",
    phase: "", state: "completed", threadId: "claude-thread", turnId: `claude-turn-${turns}`, startedAt: events[0].at, updatedAt: events.at(-1).at
  };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function writeRun(store, sessionId, record) {
  await store.createSession({ runtimeKind: "genesis", sessionId });
  const file = path.join(store.paths(sessionId).agentRunsRoot, `${record.id}.json`);
  await writeFile(file, json(record));
  return file;
}

async function historyOf(runFile) {
  const text = await readFile(runFile.replace(/\.json$/u, ".history.jsonl"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** The record's events from the start of its second-to-last turn, as the run keeps them. */
function lastTwoTurns(events) {
  const active = (event) => ["starting", "active", "finalizing"].includes(event.state);
  const starts = events.map((event, index) => index > 0 && active(event) && !active(events[index - 1]) ? index : -1).filter((index) => index > 0);
  return starts.length >= 2 ? starts.at(-2) : 0;
}

test("the upgrade moves each open session's earlier turns to their histories, keeps the last two and the working one, and a second run changes nothing", async (t) => {
  const f = await fixture(t);
  // A long session's Codex run, grown past 4 MiB.
  const turns = Math.ceil(1000 * 4.1 * 1024 * 1024 / Buffer.byteLength(json(codexRun(1000))));
  const long = codexRun(turns);
  assert.ok(Buffer.byteLength(json(long)) > 4 * 1024 * 1024);
  const sessions = {
    long: [await writeRun(f.store, "long", long), long],
    working: [await writeRun(f.store, "working", codexRun(30, { working: true })), codexRun(30, { working: true })],
    claude: [await writeRun(f.store, "claude", claudeRun(12)), claudeRun(12)],
    short: [await writeRun(f.store, "short", codexRun(2)), codexRun(2)]
  };
  const originals = Object.fromEntries(await Promise.all(Object.entries(sessions).map(async ([name, [file]]) => [name, await readFile(file)])));
  // The working-turns reader does not read a run over 4 MiB, so it takes the long run for working, its start unknown.
  const workingBefore = await readVibe64WorkingTurns({ systemRoot: f.systemRoot });
  assert.deepEqual(workingBefore.map(({ sessionId, startedAt }) => [sessionId, Boolean(startedAt)]).sort(), [["long", false], ["working", true]]);
  t.diagnostic(`long run: ${turns} turns, ${long.events.length} events, ${(await stat(sessions.long[0])).size} bytes`);

  // Check changes nothing and says what it would do.
  let started = process.hrtime.bigint();
  await f.run(false);
  t.diagnostic(`check: ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(0)} ms`);
  assert.ok(f.reports.some((message) => /example: 3 agent run\(s\) to split/u.test(message)), JSON.stringify(f.reports));
  for (const [name, [file]] of Object.entries(sessions)) assert.deepEqual(await readFile(file), originals[name], name);

  started = process.hrtime.bigint();
  await f.run(true);
  t.diagnostic(`apply: ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(0)} ms`);

  for (const [name, [file, record]] of Object.entries(sessions)) {
    const after = JSON.parse(await readFile(file, "utf8"));
    const history = await historyOf(file);
    const keepFrom = lastTwoTurns(record.events);
    assert.deepEqual([...history, ...after.events], record.events, `${name}: every event once, in order`);
    assert.deepEqual(after.events, record.events.slice(keepFrom), `${name}: the last two turns stay`);
    const { events: _afterEvents, eventHistoryBytes, ...afterFields } = after;
    const { events: _events, ...fields } = record;
    void _afterEvents;
    void _events;
    assert.deepEqual(afterFields, fields, `${name}: nothing but its events changes`);
    if (name === "short") {
      assert.deepEqual(await readFile(file), originals.short, "a run of two turns is left as it is");
      assert.equal(eventHistoryBytes, undefined);
      continue;
    }
    assert.equal(eventHistoryBytes, (await stat(file.replace(/\.json$/u, ".history.jsonl"))).size);
    // Each original and each replacement is in the backup.
    assert.deepEqual(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, file))), originals[name]);
  }
  assert.ok((await stat(sessions.long[0])).size < 16 * 1024, "the long run keeps two turns");
  // The long run reads as ended now; the working run is still working, from the same start.
  assert.deepEqual(await readVibe64WorkingTurns({ systemRoot: f.systemRoot }), workingBefore.filter(({ sessionId }) => sessionId === "working"));
  const reader = f.createStore();
  const working = (await reader.readSession("working")).agentRuns[0];
  assert.equal(working.active, true);
  assert.equal(working.providerTurnId, turnId(30));
  assert.equal(working.events.findLast((event) => event.kind === "codex-app-server-result-processed").providerTurnId, turnId(29));

  // A second run finds nothing to split and changes nothing.
  const afterFirst = Object.fromEntries(await Promise.all(Object.entries(sessions).map(async ([name, [file]]) => [name, [
    await readFile(file), await readFile(file.replace(/\.json$/u, ".history.jsonl")).catch(() => null)]])));
  f.reports.length = 0;
  await f.run(true);
  assert.ok(f.reports.some((message) => /example: 0 agent run\(s\) to split/u.test(message)), JSON.stringify(f.reports));
  for (const [name, [file]] of Object.entries(sessions)) {
    assert.deepEqual([await readFile(file), await readFile(file.replace(/\.json$/u, ".history.jsonl")).catch(() => null)], afterFirst[name], name);
  }

  // The next turn moves the turn before the last two, from where the upgrade left the history.
  await reader.writeAgentRunEvent("long", "codex_app_server", { event: { kind: "codex-app-server-turn-claimed" }, patch: { state: "starting" } });
  const history = await historyOf(sessions.long[0]);
  const run = (await reader.readSession("long")).agentRuns[0];
  assert.deepEqual([...history, ...run.events].slice(0, long.events.length), long.events);
  assert.equal(history.length + run.events.length, long.events.length + 1);
});

test("an apply that stops between a history and its run leaves every event in the run, and the next apply, after the previous release wrote to it, splits it once", async (t) => {
  const f = await fixture(t);
  const record = codexRun(40);
  const file = await writeRun(f.store, "one", record);
  // The start step's time limit stops the apply after its first publication: the history, before its run.
  await assert.rejects(f.run(true, (_level, message) => {
    if (message.startsWith("Published state:")) throw new Error("start step timed out");
  }), /start step timed out/u);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), record, "the run still holds every event");
  assert.ok((await historyOf(file)).length > 0, "its history was published");

  // The previous release, started again while nothing is recorded, reads the run and writes to it as it always did.
  const older = JSON.parse(await readFile(file, "utf8"));
  older.events.push({ kind: "codex-app-server-pending-user-message-owned", message: "", clientId: "client-older", at: at(99_999), state: "completed" });
  await writeFile(file, json(older));

  f.reports.length = 0;
  await f.run(true);
  assert.ok(f.reports.some((message) => /stopped part way.*retry-2/u.test(message)), JSON.stringify(f.reports));
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual([...await historyOf(file), ...after.events], older.events, "each event once: the stopped run's lines were cut off");
  assert.equal(after.eventHistoryBytes, (await stat(file.replace(/\.json$/u, ".history.jsonl"))).size);
  // The first run's backup and the retry's are both kept.
  assert.deepEqual(JSON.parse(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, file)), "utf8")), record);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.backupRoot, "retry-2/before", path.relative(f.systemRoot, file)), "utf8")), older);
});

test("a run written while the upgrade prepares stops it before anything changes", async (t) => {
  const f = await fixture(t);
  const record = codexRun(10);
  const file = await writeRun(f.store, "one", record);
  await assert.rejects(f.run(true, (_level, message) => {
    // A session process that was not stopped writes to the run after the upgrade read it.
    if (/agent run\(s\) to split/u.test(message)) {
      const written = JSON.parse(readFileSync(file, "utf8"));
      written.events.push({ kind: "codex-app-server-pending-user-message-owned", message: "", at: at(99_999), state: "completed" });
      writeFileSync(file, json(written));
    }
  }), /Application state changed during preparation/u);
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(after.events.slice(0, -1), record.events, "the run keeps every event and the writer's");
  assert.equal(await historyOf(file).then((history) => history.length), 0, "no history was published");
  assert.deepEqual((await readdir(path.dirname(file))).sort(), ["codex_app_server.json"]);
});

test("an unreadable run stops the upgrade before anything changes", async (t) => {
  const f = await fixture(t);
  const good = await writeRun(f.store, "good", codexRun(10));
  const goodBefore = await readFile(good);
  await f.store.createSession({ runtimeKind: "genesis", sessionId: "torn" });
  const torn = path.join(f.store.paths("torn").agentRunsRoot, "codex_app_server.json");
  await writeFile(torn, json(codexRun(10)).slice(0, 4000));
  await assert.rejects(f.run(true), /codex_app_server\.json is not valid JSON\. Inspect it, or restore it from a backup/u);
  assert.deepEqual(await readFile(good), goodBefore);
  assert.deepEqual(await historyOf(good), []);
});
