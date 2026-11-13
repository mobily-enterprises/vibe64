import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { withHostPathGuard } from "./run-targeted-tests.mjs";
import { loadTimeBudgets } from "./test-time-budgets.mjs";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

// Past the run's deadline, the runner has this long to report the files still
// running before its whole process group is killed.
const DEADLINE_GRACE_MS = 10_000;
const REPORT_BLOCKING_STDOUT = `--import=${new URL("./test-report-blocking-stdout.mjs", import.meta.url).href}`;

// npm run test:full: every server test file, as many at once as the machine's
// test budget allows (JSKIT's testConcurrency()), with the time budgets of
// tooling/test-time-budgets.json, each file under the host path guard that a
// single-file run loads too. Node expands the file pattern itself.
//
// A hang fails the run quickly instead of holding it: each test has the
// suite's testMs as a hard deadline, after which Node fails it by name; its
// file then ends as soon as its other tests have (--test-force-exit), even
// when the hung test left a server, child or timer open; and the whole run
// stops at the suite's wall-clock bound, wallMs. That force exit would drop
// the end of a file's report still waiting for the runner to read it, so each
// file's process writes its report with blocking writes
// (tooling/test-report-blocking-stdout.mjs).
//
// CI runs the suite in parallel jobs, one part each: with `shard` "I/N"
// (npm run test:full -- --shard=I/N), Node's --test-shard runs every Nth
// file from the Ith, so the N parts together run every file once.
export function serverTestRun(env = process.env, budgets = loadTimeBudgets("server"), { shard = "" } = {}) {
  return {
    args: [
      "--test",
      `--test-concurrency=${testConcurrency({ env })}`,
      `--test-timeout=${budgets.testMs}`,
      "--test-force-exit",
      ...(shard ? [`--test-shard=${shard}`] : []),
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=./tooling/test-time-budget-reporter.mjs",
      "--test-reporter-destination=stderr",
      "tests/server/*.test.js"
    ],
    deadlineMs: budgets.wallMs,
    env: withBlockingReports(withHostPathGuard(env))
  };
}

function withBlockingReports(env) {
  const current = String(env.NODE_OPTIONS || "");
  return { ...env, NODE_OPTIONS: current.includes(REPORT_BLOCKING_STDOUT) ? current : `${current} ${REPORT_BLOCKING_STDOUT}`.trim() };
}

// The command line takes nothing, or one --shard=I/N with 1 <= I <= N;
// anything else answers null.
export function serverTestOptions(argv = []) {
  if (argv.length === 0) return {};
  const match = argv.length === 1 ? /^--shard=([1-9]\d*)\/([1-9]\d*)$/u.exec(argv[0]) : null;
  return match && Number(match[1]) <= Number(match[2]) ? { shard: `${match[1]}/${match[2]}` } : null;
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
  const options = serverTestOptions(process.argv.slice(2));
  if (options) {
    process.exitCode = await runServerTests(serverTestRun(process.env, loadTimeBudgets("server"), options));
  } else {
    console.error("npm run test:full runs every server test file, or one part of them: npm run test:full -- --shard=2/4");
    process.exitCode = 1;
  }
}
