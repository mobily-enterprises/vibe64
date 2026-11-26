import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
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
import { portBelowEphemeralRange } from "../fixtures/portBelowEphemeralRange.js";

// A busy editor's stop, end to end, in a real server process (fixtures/stopBudgetServer.mjs): a request waiting on a
// long command, a background job's long command and a poller starting a command every 50 ms. On release 10's stop of a
// hosted workspace (24 Nov 2026) the editor went on starting helper calls after SIGTERM and took 3.33 s to stop, while
// the edge in front of it answered 502 and 503. On SIGTERM the editor must stop in under a second: it closes its
// listener at once, starts no new command, gives the request in flight a short drain, ends the commands it started,
// leaves nothing of them running, and records its stop as planned, so the next server resumes the turns it interrupted
// as a restart. The stop is logged at warn, which a hosted editor's default level keeps, with how long it took.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVER = fileURLToPath(new URL("./fixtures/stopBudgetServer.mjs", import.meta.url));
const STOP_BUDGET_MS = 1000;

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

/** Whether a new TCP connection to the port is refused. */
function connectionRefused(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) => resolve(error?.code === "ECONNREFUSED"));
  });
}

test("a busy editor stops within a second of SIGTERM, starts nothing new, leaves none of its commands running, and records a planned stop", {
  skip: process.platform !== "linux",
  timeout: 90_000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-stop-budget-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const port = await portBelowEphemeralRange();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [SERVER], {
    cwd: APP_ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), VIBE64_STOP_TEST_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const keep = (chunk) => { output = `${output}${chunk}`.slice(-200_000); };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  const exited = once(server, "exit");
  const childPids = () => readEvents(root).filter(({ event }) => event === "child-running")
    .map(({ detail }) => Number(detail.split(" ")[1]));
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await exited;
    }
    // The commands a stop left running, by their own pids.
    for (const pid of childPids()) {
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

  const stopAt = Date.now();
  server.kill("SIGTERM");
  const refusedAfterMs = await waitUntil(async () => (await connectionRefused(port)) ? Date.now() - stopAt : 0,
    "the listener to close", 10_000);
  const [code, signal] = await exited;
  const stopMs = Date.now() - stopAt;
  const slowStatus = await slow;
  const events = readEvents(root);
  const pids = childPids();
  const report = JSON.stringify({ stopMs, refusedAfterMs, code, signal, slowStatus, events: events.slice(-40), output: output.slice(-6000) });
  t.diagnostic(`stopped ${stopMs} ms after SIGTERM; new connections refused after ${refusedAfterMs} ms; exit ${code}`);

  assert.ok(stopMs < STOP_BUDGET_MS, `the editor stopped ${stopMs} ms after SIGTERM, not within ${STOP_BUDGET_MS} ms: ${report}`);
  assert.deepEqual([code, signal], [0, null], `a stop within its budget is a clean exit: ${report}`);
  assert.ok(refusedAfterMs < 300, `new connections are refused at once (${refusedAfterMs} ms): ${report}`);
  // Each poll's line carries the time its process began: a busy host can take a while to write it, but none may begin
  // once the stop has (SIGTERM's delivery to the server takes a moment of the slack).
  const ranAfterStop = events.filter(({ event, at }) => event === "poll-ran" && at > stopAt + 250);
  assert.deepEqual(ranAfterStop, [], `no command starts once the stop has begun: ${report}`);
  assert.ok(events.some(({ event, detail }) => event === "poll-refused" && detail === "vibe64_server_stopping"),
    `the gateway refuses a new command as the editor stops: ${report}`);
  assert.equal(pids.length, 2, report);
  assert.deepEqual(pids.filter(processIsAlive), [], `no command the editor started outlives it: ${report}`);

  // The stop's own record says how long it took, at a level a hosted editor keeps.
  const stopped = output.split("\n").filter((line) => line.includes("\"vibe64.server.stopped\"")).map((line) => JSON.parse(line));
  assert.equal(stopped.length, 1, `the stop is logged once at warn: ${report}`);
  assert.equal(stopped[0].level, 40, report);
  assert.ok(Number.isInteger(stopped[0].durationMs) && stopped[0].durationMs < STOP_BUDGET_MS, report);

  // The turns this stop interrupted are the next server's to resume, as after a restart.
  const systemRoot = path.join(root, "state");
  const runs = await Promise.all((await readdir(path.join(systemRoot, "server-runs")))
    .map(async (name) => JSON.parse(await readFile(path.join(systemRoot, "server-runs", name), "utf8"))));
  const run = runs.find((record) => record.pid === server.pid);
  assert.ok(run, JSON.stringify(runs));
  assert.equal(run.stopReason, "server-shutdown", JSON.stringify(run));
  assert.ok(Date.parse(run.stoppedAt) - stopAt < 500, `the planned stop is recorded as the stop begins: ${JSON.stringify(run)}`);
  const next = createServerRun({ systemRoot });
  await next.started;
  const end = await next.endOf(run.id);
  assert.equal(end.cause, INTERRUPTION_CAUSE.RESTART, JSON.stringify(end));
  assert.equal(resumePolicy(end.cause), "now");
});
