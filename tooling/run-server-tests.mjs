import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { withHostPathGuard } from "./run-targeted-tests.mjs";
import { loadTimeBudgets } from "./test-time-budgets.mjs";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

// Past the run's deadline, the runner has this long to report the files still
// running before its whole process group is killed.
const DEADLINE_GRACE_MS = 10_000;

// npm run test:full: every server test file, as many at once as the machine's
// test budget allows (JSKIT's testConcurrency()), with the time budgets of
// tooling/test-time-budgets.json, each file under the host path guard that a
// single-file run loads too. Node expands the file pattern itself.
//
// A hang fails the run quickly instead of holding it: each test has the
// suite's testMs as a hard deadline, after which Node fails it by name; its
// file then ends as soon as its other tests have (--test-force-exit), even
// when the hung test left a server, child or timer open; and the whole run
// stops at the suite's wall-clock bound, wallMs.
export function serverTestRun(env = process.env, budgets = loadTimeBudgets("server")) {
  return {
    args: [
      "--test",
      `--test-concurrency=${testConcurrency({ env })}`,
      `--test-timeout=${budgets.testMs}`,
      "--test-force-exit",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=./tooling/test-time-budget-reporter.mjs",
      "--test-reporter-destination=stderr",
      "tests/server/*.test.js"
    ],
    deadlineMs: budgets.wallMs,
    env: withHostPathGuard(env)
  };
}

// Runs the suite in its own process group, so that its deadline stops the
// runner and every test file process it started. Resolves to the exit code:
// the runner's, or 1 past the deadline.
export function runServerTests({ args, deadlineMs, env }, { graceMs = DEADLINE_GRACE_MS } = {}) {
  const runner = spawn(process.execPath, args, { detached: true, env, stdio: ["ignore", "inherit", "inherit"] });
  const signalGroup = (signal) => {
    try {
      process.kill(-runner.pid, signal);
    } catch {
      // The group has already exited.
    }
  };
  // A person's Ctrl-C, or a stopping CI job, reaches the detached run too.
  const forwarded = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, () => signalGroup(signal)]);
  for (const [signal, forward] of forwarded) process.on(signal, forward);
  let pastDeadline = false;
  let forceKill = null;
  const deadline = setTimeout(() => {
    pastDeadline = true;
    console.error(
      `The server suite ran past its ${Math.round(deadlineMs / 60_000)} min wall-clock bound `
      + "(wallMs in tooling/test-time-budgets.json) and was stopped: something is clearly broken, "
      + "such as a test that never returns. Node's runner lists the files still running."
    );
    // The runner stops first, so it reports the files still running.
    runner.kill("SIGTERM");
    forceKill = setTimeout(() => signalGroup("SIGKILL"), graceMs);
  }, deadlineMs);
  const settle = () => {
    clearTimeout(deadline);
    clearTimeout(forceKill);
    for (const [signal, forward] of forwarded) process.off(signal, forward);
  };
  return new Promise((resolve, reject) => {
    runner.on("error", (error) => {
      settle();
      reject(error);
    });
    runner.on("exit", (code) => {
      settle();
      // Whatever a stopped run left behind goes with it.
      if (pastDeadline) signalGroup("SIGKILL");
      resolve(pastDeadline ? 1 : code ?? 1);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runServerTests(serverTestRun());
}
