import { checkTimeBudgets, loadTimeBudgets } from "./test-time-budgets.mjs";

// A Node test runner reporter for npm run test:full: it prints the slowest
// test files against their budgets in tooling/test-time-budgets.json, and
// fails the run when a file, the suite's total or its wall-clock time is over
// budget. The run's own summary, the one without a file, gives the wall-clock
// time.
export default async function* testTimeBudgets(source) {
  const started = Date.now();
  const files = new Map();
  let wallMs;
  for await (const event of source) {
    if (event.type !== "test:summary") continue;
    if (event.data.file) files.set(event.data.file, event.data.duration_ms);
    else wallMs = event.data.duration_ms;
  }
  wallMs ??= Date.now() - started;
  const { overruns, report } = checkTimeBudgets({ suite: "server", budgets: loadTimeBudgets("server"), files, wallMs });
  if (overruns.length > 0) process.exitCode = 1;
  yield report;
}
