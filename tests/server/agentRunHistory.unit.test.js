// A session's agent run gains several events every turn (Codex one at each phase change as well). Opening or
// reloading the session reads the run, so a run that kept every turn's events made each open cost the session's
// whole stored history. The run keeps its last two turns; the turns before them are in its history, which no session
// read opens, and nothing is lost.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { readVibe64WorkingTurns } from "@local/vibe64-runtime/server/workingTurns";
import { publicSession } from "../../packages/vibe64-sessions/src/server/sessionResults.js";

const RUN_ID = "codex_app_server";
const THREAD_ID = "thread-0001";
const AGENT_RUNS = `${path.sep}agent-runs${path.sep}`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibe64-run-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects/example") });
  await store.createSession({ runtimeKind: "genesis", sessionId: "main" });
  const runsRoot = store.paths("main").agentRunsRoot;
  return {
    store,
    systemRoot,
    runPath: path.join(runsRoot, `${RUN_ID}.json`),
    historyPath: path.join(runsRoot, `${RUN_ID}.history.jsonl`)
  };
}

const turnId = (turn) => `turn-${String(turn).padStart(4, "0")}`;

/**
 * One Codex turn as the app-server journal writes it: claimed, provider turn active (and a phase change), completed,
 * result processed. The last turn can be left working.
 */
async function writeTurn(store, turn, { working = false } = {}) {
  const write = (event, patch = {}) => store.writeAgentRunEvent("main", RUN_ID, { event, patch });
  await write({ kind: "codex-app-server-turn-claimed", message: "" }, {
    state: "starting", outerTurnId: `outer-${turnId(turn)}`, providerThreadId: THREAD_ID, providerTurnId: "",
    pendingUserMessageClientIds: [`client-${turnId(turn)}`]
  });
  await write({ kind: "codex-app-server-turn-active" }, { state: "active", providerTurnId: turnId(turn), providerPhase: "reasoning" });
  await write({ kind: "codex-app-server-turn-active" }, { state: "active", providerPhase: "" });
  if (working) return;
  await write({ kind: "codex-app-server-turn-completed" }, { state: "completed", providerPhase: "", pendingUserMessageClientIds: [] });
  await write({
    kind: "codex-app-server-result-processed", providerThreadId: THREAD_ID, providerTurnId: turnId(turn), resultReason: "completed"
  });
}

const EVENTS_PER_TURN = 5;

/** Counts what a session read reads of agent-run files, by the bytes their handles return. */
function countRunReads(t) {
  const counts = { bytes: 0, files: 0 };
  const originalOpen = fs.open;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).includes(AGENT_RUNS)) {
      const readFile = handle.readFile.bind(handle);
      handle.readFile = async (...readArgs) => {
        const value = await readFile(...readArgs);
        counts.files += 1;
        counts.bytes += Buffer.byteLength(value);
        return value;
      };
    }
    return handle;
  });
  syncBuiltinESMExports();
  return {
    counts,
    restore() {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  };
}

async function readCost(t, turns) {
  const f = await fixture(t);
  for (let turn = 1; turn <= turns; turn += 1) await writeTurn(f.store, turn);
  // A fresh store, as a reload after the editor restarted: nothing is remembered from the writes.
  const reader = createVibe64SessionStore({ projectContextRoot: path.dirname(f.systemRoot), projectRuntimeRoot: path.join(f.systemRoot, "projects/example") });
  const reads = countRunReads(t);
  let session;
  const started = process.hrtime.bigint();
  try {
    session = await reader.readSession("main");
  } finally {
    reads.restore();
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const events = session.agentRuns.reduce((sum, run) => sum + run.events.length, 0);
  t.diagnostic(`${turns} stored turn(s): read ${reads.counts.files} run file(s), ${reads.counts.bytes} bytes, ${events} events, ${ms.toFixed(2)} ms`);
  return { ...reads.counts, events, session };
}

test("a session read costs its run's last two turns, at 2 stored turns as at 100", async (t) => {
  const one = await readCost(t, 1);
  const two = await readCost(t, 2);
  const hundred = await readCost(t, 100);
  assert.equal(one.events, EVENTS_PER_TURN);
  assert.deepEqual([two.files, hundred.files], [1, 1]);
  assert.equal(two.events, 2 * EVENTS_PER_TURN);
  assert.equal(hundred.events, two.events, "100 stored turns return the same two turns' events as 2 do");
  // The run also says how much of its history it wrote: a few bytes more, never a turn's worth.
  assert.ok(hundred.bytes <= two.bytes + 64, `100 stored turns read ${hundred.bytes} bytes, 2 read ${two.bytes}`);
  assert.deepEqual(hundred.session.agentRuns[0].events.map((event) => event.providerTurnId).filter(Boolean), [turnId(99), turnId(100)]);
});

test("the turns before the last two move to the run's history whole and in order, and the working turn and the one just ended stay", async (t) => {
  const f = await fixture(t);
  const written = [];
  const store = {
    async writeAgentRunEvent(...args) {
      const record = await f.store.writeAgentRunEvent(...args);
      written.push(record.events.at(-1));
      return record;
    }
  };
  for (let turn = 1; turn <= 6; turn += 1) await writeTurn(store, turn, { working: turn === 6 });

  const run = (await f.store.readSession("main")).agentRuns[0];
  const historyText = await fs.readFile(f.historyPath, "utf8");
  const history = historyText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual([...history, ...run.events], written, "every event is in the history or the run, once, in order");
  assert.equal(run.eventHistoryBytes, Buffer.byteLength(historyText));
  assert.equal(history.length, 4 * EVENTS_PER_TURN, "turns 1 to 4 are in the history");
  // Turn 5's result-processed event, which a late result of that turn finds, and turn 6 working.
  assert.equal(run.events.findLast((event) => event.kind === "codex-app-server-result-processed").providerTurnId, turnId(5));
  assert.equal(run.active, true);
  assert.equal(run.providerTurnId, turnId(6));
  // The working turn's start is the same as before the move.
  assert.deepEqual(await readVibe64WorkingTurns({ systemRoot: f.systemRoot }),
    [{ projectSlug: "example", sessionId: "main", startedAt: written.at(-3).at }]);
});

test("a history append whose run never reached the disk is cut off before the next one, so no event is there twice", async (t) => {
  const f = await fixture(t);
  for (let turn = 1; turn <= 3; turn += 1) await writeTurn(f.store, turn);
  const runBefore = await fs.readFile(f.runPath, "utf8");
  const historyBefore = await fs.readFile(f.historyPath, "utf8");
  // Turn 4 starts: its history append lands, and the power goes before its run is published.
  await writeTurn(f.store, 4);
  await fs.writeFile(f.runPath, runBefore);
  assert.ok((await fs.stat(f.historyPath)).size > Buffer.byteLength(historyBefore));

  for (let turn = 4; turn <= 5; turn += 1) await writeTurn(f.store, turn);
  const run = (await f.store.readSession("main")).agentRuns[0];
  const history = (await fs.readFile(f.historyPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const turns = [...history, ...run.events].filter((event) => event.kind === "codex-app-server-result-processed")
    .map((event) => event.providerTurnId);
  assert.deepEqual(turns, [1, 2, 3, 4, 5].map(turnId));
});

test("a page's session carries its runs' fields without their events", () => {
  const session = publicSession({
    sessionId: "main",
    agentRuns: [{ id: RUN_ID, active: true, state: "active", providerTurnId: turnId(1), events: [{ kind: "x", state: "active" }] }],
    backgroundTasks: [{ id: "save-work", events: [{ kind: "started" }] }]
  });
  assert.deepEqual(session.agentRuns, [{ id: RUN_ID, active: true, state: "active", providerTurnId: turnId(1) }]);
  assert.deepEqual(session.backgroundTasks[0].events, [{ kind: "started" }], "background tasks' events are shown");
  assert.equal(session.ok, true);
});
