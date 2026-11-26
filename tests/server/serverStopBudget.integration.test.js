import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INTERRUPTION_CAUSE,
  createServerRun,
  resumePolicy
} from "../../packages/vibe64-terminals/src/server/turnInterruptions.js";
import { linuxProcessStat, processEnded } from "../../packages/vibe64-execution/src/server/runtime/processEnded.js";
import { STOP_DRAIN_MS } from "../../server/lib/stopGate.js";
import { portBelowEphemeralRange } from "../fixtures/portBelowEphemeralRange.js";

// A busy editor's stop, end to end, in a real server process (fixtures/stopBudgetServer.mjs): a request waiting on a
// long command, a background job's long command, a poller starting a command every 50 ms and a terminal that ignores
// SIGTERM. On release 10's stop of a hosted workspace (24 Nov 2026) the editor went on starting helper calls after
// SIGTERM and took 3.33 s to stop, while the edge in front of it answered 502 and 503; on 26 Nov two hosted editors'
// terminals held their restarts past the deadline. On SIGTERM the editor closes its listener and its command gate at
// once, starts no new command, gives the request in flight, the commands then running and its terminals a drain of
// STOP_DRAIN_MS, then from the drain's own timer closes those connections, SIGKILLs the terminals and ends the commands,
// leaves nothing of them running, and records its stop as planned, so the next server resumes the turns it interrupted
// as a restart. Its deadline exits whatever is left. The tests read the server's own timeline, ordered as the server
// lived it, so a machine that starves the process changes how long the stop takes, never what they prove; how long it
// took is reported, not asserted, and a busy machine may meet the deadline (exit 1, no crash record) instead.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVER = fileURLToPath(new URL("./fixtures/stopBudgetServer.mjs", import.meta.url));

async function waitUntil(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

/** The fixture's events: `{ at, event, detail }`, in the order written. */
function readEvents(root) {
  let text = "";
  try {
    text = readFileSync(path.join(root, "events.log"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return text.split("\n").filter(Boolean).map((line) => {
    const [at, event, ...detail] = line.split(" ");
    return { at: Number(at), event, detail: detail.join(" ") };
  });
}

// A killed process its parent has not reaped yet is a zombie: it has ended all the same (processEnded).
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return !processEnded(linuxProcessStat(stat));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Starts the busy stop test server (`env` adds to its environment) and waits until its request, background job,
 * poller and terminal all run. The test's end kills whatever of it is left, by pid.
 */
async function startBusyServer(t, env = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-stop-budget-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const port = await portBelowEphemeralRange();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [SERVER], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env, HOST: "127.0.0.1", PORT: String(port), VIBE64_STOP_TEST_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const keep = (chunk) => { output = `${output}${chunk}`.slice(-200_000); };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  const exited = once(server, "exit");
  // The commands' pids and the terminal's.
  const childPids = () => readEvents(root).filter(({ event }) => event === "child-running")
    .map(({ detail }) => Number(detail.split(" ")[1]));
  const terminalPids = () => readEvents(root).filter(({ event }) => event === "terminal-running")
    .map(({ detail }) => Number(detail));
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await exited;
    }
    // What a stop left running, by its own pids.
    for (const pid of [...childPids(), ...terminalPids()]) {
      try { process.kill(pid, "SIGKILL"); } catch { /* ended */ }
    }
  });

  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error(`The stop test server exited at its start:\n${output}`);
    return fetch(`${origin}/api/health`).then((response) => response.ok, () => false);
  }, "the stop test server's health");
  const slow = fetch(`${origin}/api/stop-test/slow`).then((response) => response.status, (error) => error?.cause?.code || "failed");
  await waitUntil(() => {
    const running = readEvents(root).filter(({ event }) => event === "child-running").map(({ detail }) => detail.split(" ")[0]);
    return running.includes("slow-request") && running.includes("background");
  }, "the request's and the background job's long commands", 30_000);
  await waitUntil(() => readEvents(root).filter(({ event }) => event === "poll-ran").length >= 3, "the poller's commands");
  await waitUntil(() => terminalPids().length === 1, "the terminal that ignores SIGTERM and SIGHUP");
  return { root, server, exited, slow, output: () => output, childPids, terminalPids };
}

/** The files in a folder of the server's crash records ("records", or "running" for its running marker). */
async function crashFiles(root, folder = "records") {
  return readdir(path.join(root, "state", "crashes", folder)).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
}

/** The server's JSON log lines of one event. */
function logged(output, event) {
  return output.split("\n").filter((line) => line.includes(`"${event}"`)).map((line) => JSON.parse(line));
}

/**
 * The stop's timeline from the fixture's events: SIGTERM's arrival, the stop's first moment, the signals the server
 * sent each process group, in order, and the exit.
 */
function stopTimeline(events) {
  const indexed = events.map((entry, index) => ({ ...entry, index }));
  const first = (event) => indexed.find((entry) => entry.event === event);
  const signals = indexed.filter(({ event }) => event === "signal")
    .map((entry) => ({ ...entry, group: Number(entry.detail.split(" ")[0]), signal: entry.detail.split(" ")[1] }));
  return { sigterm: first("sigterm"), began: first("stop-began"), exit: first("exit"), signals,
    sent: (group, signal) => signals.filter((entry) => entry.group === group && entry.signal === signal) };
}

/** The signal events in the same synchronous step as the one at `index`: those straight after it, up to another event. */
function sameStep(events, index) {
  const after = events.slice(index + 1);
  const end = after.findIndex(({ event }) => event !== "signal");
  return after.slice(0, end === -1 ? after.length : end);
}

test("a busy editor's stop closes its listener and gate at once, starts nothing new, gives its terminals and commands the drain, then kills them from the drain's own timer, leaves none running, and records a planned stop", {
  skip: process.platform !== "linux",
  timeout: 90_000
}, async (t) => {
  const { root, server, exited, slow, output: serverOutput, childPids, terminalPids } = await startBusyServer(t);

  const stopAt = Date.now();
  server.kill("SIGTERM");
  const [code, signal] = await exited;
  const stopMs = Date.now() - stopAt;
  const slowStatus = await slow;
  const events = readEvents(root);
  const pids = childPids();
  const [terminalPid] = terminalPids();
  const output = serverOutput();
  const report = JSON.stringify({ stopMs, code, signal, slowStatus, events: events.slice(-60), output: output.slice(-6000) });
  const { sigterm, began, exit, signals, sent } = stopTimeline(events);
  const terminalKill = sent(terminalPid, "SIGKILL");
  t.diagnostic(`stopped ${stopMs} ms after SIGTERM, exit ${code}; the drain's kill came ${terminalKill[0]?.at - sigterm?.at} ms after SIGTERM arrived`);

  // The listener and the command gate are closed at the stop's first moment, before it signals anything.
  assert.ok(sigterm && began && sigterm.index < began.index, report);
  assert.equal(began.detail, "listening=false gate=true", `the listener and the gate close as the stop begins: ${report}`);
  assert.ok(signals.every(({ index }) => index > began.index), report);

  // No call made once the stop had begun reached a process; one was made, and the gate refused it.
  const calledAfterStop = new Set(events.slice(began.index).filter(({ event }) => event === "poll-call").map(({ detail }) => detail));
  const ranAfterStop = events.filter(({ event, detail }) => event === "poll-ran" && calledAfterStop.has(detail));
  assert.deepEqual(ranAfterStop, [], `no command starts once the stop has begun: ${report}`);
  assert.ok(events.some(({ event, detail }) => event === "poll-refused" && calledAfterStop.has(detail.split(" ")[0]) &&
    detail.endsWith(" vibe64_server_stopping")), `the gateway refuses a new command as the editor stops: ${report}`);

  // The terminal's close sends SIGTERM as the stop begins; it ignores it. Its SIGKILL comes from the drain's own timer,
  // whose same step ends the two commands running as the stop began, once the drain has passed and before the exit.
  assert.equal(pids.length, 2, report);
  const terminalTerm = sent(terminalPid, "SIGTERM");
  assert.equal(terminalTerm.length, 1, report);
  assert.equal(terminalKill.length, 1, `the terminal gets one SIGKILL: ${report}`);
  assert.ok(terminalTerm[0].index < terminalKill[0].index, report);
  const drainStep = sameStep(events, terminalKill[0].index);
  for (const pid of pids) {
    assert.ok(drainStep.some(({ detail }) => detail === `${pid} SIGTERM`), `the drain's step also ends command ${pid}: ${report}`);
  }
  assert.ok(terminalKill[0].at - sigterm.at >= STOP_DRAIN_MS - 1, `the terminal had the whole drain first: ${report}`);
  assert.ok(exit && terminalKill[0].index < exit.index && exit.detail === String(code), report);

  // Nothing it started outlives it, and its stop is no crash.
  await waitUntil(() => [...pids, terminalPid].every((pid) => !processIsAlive(pid)), "the commands and the terminal to end", 10_000);
  assert.deepEqual(await crashFiles(root), [], `a planned stop records no crash: ${report}`);

  // It exits 0 with its stop logged at warn, which a hosted editor's default level keeps, or, on a machine too busy to
  // finish by the deadline, 1 with the overrun logged; never both.
  const stopped = logged(output, "vibe64.server.stopped");
  const timedOut = logged(output, "vibe64.server.shutdown_timeout");
  assert.deepEqual({ code, signal, stopped: stopped.length, timedOut: timedOut.length },
    { code, signal: null, stopped: code === 0 ? 1 : 0, timedOut: code === 1 ? 1 : 0 }, report);
  for (const record of stopped) {
    assert.equal(record.level, 40, report);
    assert.ok(Number.isInteger(record.durationMs), report);
  }

  // The turns this stop interrupted are the next server's to resume, as after a restart; the stop was recorded as
  // planned before its drain ended.
  const systemRoot = path.join(root, "state");
  const runs = await Promise.all((await readdir(path.join(systemRoot, "server-runs")))
    .map(async (name) => JSON.parse(await readFile(path.join(systemRoot, "server-runs", name), "utf8"))));
  const run = runs.find((record) => record.pid === server.pid);
  assert.ok(run, JSON.stringify(runs));
  assert.equal(run.stopReason, "server-shutdown", JSON.stringify(run));
  assert.ok(Date.parse(run.stoppedAt) <= terminalKill[0].at, `the planned stop is recorded before the drain ends: ${JSON.stringify(run)} ${report}`);
  const next = createServerRun({ systemRoot });
  await next.started;
  const end = await next.endOf(run.id);
  assert.equal(end.cause, INTERRUPTION_CAUSE.RESTART, JSON.stringify(end));
  assert.equal(resumePolicy(end.cause), "now");
});

test("a stop that overruns its deadline, even one that comes with its drain, ends what still runs and exits 1, but records no crash: it is the stop that was asked for", {
  skip: process.platform !== "linux",
  timeout: 90_000
}, async (t) => {
  // Its Fastify close never ends, as a hosted editor's did not end within the deadline on 26 Nov 2026. Its deadline is
  // the drain's own moment, the earliest a deadline can come, so the drain's kill must come first however the machine
  // schedules the process.
  const { root, server, exited, output: serverOutput, childPids, terminalPids } = await startBusyServer(t, {
    VIBE64_STOP_TEST_STALL_CLOSE: "1",
    VIBE64_STOP_TEST_DEADLINE_MS: String(STOP_DRAIN_MS)
  });

  server.kill("SIGTERM");
  const [code, signal] = await exited;
  const output = serverOutput();
  const events = readEvents(root);
  const report = JSON.stringify({ code, signal, events: events.slice(-60), output: output.slice(-6000) });
  const timedOut = logged(output, "vibe64.server.shutdown_timeout");
  assert.equal(timedOut.length, 1, `the overrun is logged: ${report}`);
  assert.ok(timedOut[0].pendingOperations.includes("fastify"), report);
  assert.deepEqual([code, signal], [1, null], report);
  assert.deepEqual(await crashFiles(root), [], `an overrun is no crash: ${report}`);
  assert.deepEqual(await crashFiles(root, "running"), [], `nor does its running marker stay for the next start to record: ${report}`);
  assert.equal(output.includes("\"vibe64.server.crashed\""), false, report);
  // The terminal that ignores SIGTERM got its SIGKILL from the drain, before the deadline's exit, and the commands
  // their SIGTERM in the same step, so nothing it started outlives it.
  const { exit, sent } = stopTimeline(events);
  const [terminalPid] = terminalPids();
  const terminalKill = sent(terminalPid, "SIGKILL");
  assert.equal(terminalKill.length, 1, `the drain kills the terminal before the exit: ${report}`);
  assert.ok(exit && terminalKill[0].index < exit.index && exit.detail === "1", report);
  for (const pid of childPids()) {
    assert.ok(sameStep(events, terminalKill[0].index).some(({ detail }) => detail === `${pid} SIGTERM`), report);
  }
  await waitUntil(() => [...childPids(), terminalPid].every((pid) => !processIsAlive(pid)),
    "the commands and the terminal to end", 10_000);
});
