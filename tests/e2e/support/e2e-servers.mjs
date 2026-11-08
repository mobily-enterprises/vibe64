import os from "node:os";
import process from "node:process";

import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

// Each Playwright worker tests against its own app server, so no test shares a
// server's state with a test running at the same time: worker N (Playwright's
// TEST_PARALLEL_INDEX) uses port PLAYWRIGHT_PORT + N.
const DEFAULT_BASE_PORT = 4173;
// The main Playwright process settles the worker count and passes it to its
// workers, which re-read the config, through this variable.
const SERVER_COUNT_ENV = "VIBE64_E2E_SERVER_COUNT";
// start-web-servers.mjs prints this once every worker's server answers.
const E2E_SERVERS_READY = "Vibe64 test servers ready";

function basePort(env = process.env) {
  return Number(String(env.PLAYWRIGHT_PORT || "").trim() || DEFAULT_BASE_PORT);
}

// Playwright's own reading of a worker count: a number, or a share of the CPUs.
function workerCount(value, cpus = os.availableParallelism()) {
  const text = String(value ?? "").trim();
  const share = /^(\d+)%$/u.exec(text);
  if (share) return Math.max(1, Math.floor(cpus * Number(share[1]) / 100));
  const count = Number.parseInt(text, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

// The last --workers/-j on the command line, as Playwright's CLI reads it.
function commandLineWorkers(argv) {
  let requested = "";
  for (const [index, argument] of argv.entries()) {
    if (argument === "--workers" || argument === "-j") requested = argv[index + 1] ?? "";
    else if (argument.startsWith("--workers=")) requested = argument.slice("--workers=".length);
    else if (/^-j=?\d/u.test(argument)) requested = argument.replace(/^-j=?/u, "");
  }
  return requested;
}

// A browser worker keeps about two CPU threads busy: its test process, its
// browser and its app server (2.0-2.6 measured on 8-thread hosts). With one
// worker per thread of the budget, tests ran up to twice as slowly without the
// run finishing sooner, and the slowest reached their timeout.
const THREADS_PER_BROWSER_WORKER = 2;

/** One browser worker for every two threads of the machine's test budget, at least one. */
function defaultWorkerCount(env = process.env) {
  return Math.max(1, Math.floor(testConcurrency({ env }) / THREADS_PER_BROWSER_WORKER));
}

/**
 * How many workers, and so servers, this run uses: --workers on the command
 * line, else a share of the machine's test budget (JSKIT's testConcurrency())
 * that fits each worker's browser and server. Playwright's main process decides
 * and records it; its workers read the recorded count.
 */
function e2eServerCount({ argv = process.argv, env = process.env } = {}) {
  const recorded = workerCount(env[SERVER_COUNT_ENV]);
  if (recorded) return recorded;
  const count = workerCount(commandLineWorkers(argv)) || defaultWorkerCount(env);
  env[SERVER_COUNT_ENV] = String(count);
  return count;
}

function e2eServerPorts(env = process.env) {
  const base = basePort(env);
  return Array.from({ length: e2eServerCount({ env }) }, (_, index) => base + index);
}

// The server of the worker this code runs in (the first one outside a worker).
// A server the person started (VIBE64_LIVE_E2E) is one server on PLAYWRIGHT_PORT.
function e2eWorkerPort(env = process.env) {
  if (env.VIBE64_LIVE_E2E === "1") return basePort(env);
  const index = Number.parseInt(String(env.TEST_PARALLEL_INDEX || "0"), 10) || 0;
  return basePort(env) + (index % e2eServerCount({ env }));
}

export {
  E2E_SERVERS_READY,
  SERVER_COUNT_ENV,
  commandLineWorkers,
  defaultWorkerCount,
  e2eServerCount,
  e2eServerPorts,
  e2eWorkerPort,
  workerCount
};
