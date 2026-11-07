import { checkTimeBudgets, loadTimeBudgets } from "./test-time-budgets.mjs";

// A Node test runner reporter for npm run test:full: it prints the slowest
// test files against their budgets in tooling/test-time-budgets.json, and
// fails the run when a file or the suite's total is over budget.
export default async function* testTimeBudgets(source) {
  const files = new Map();
  for await (const event of source) {
    if (event.type === "test:summary" && event.data.file) files.set(event.data.file, event.data.duration_ms);
  }
  const { overruns, report } = checkTimeBudgets({ suite: "server", budgets: loadTimeBudgets("server"), files });
  if (overruns.length > 0) process.exitCode = 1;
  yield report;
}
