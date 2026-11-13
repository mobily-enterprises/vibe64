import { checkTimeBudgets, loadTimeBudgets } from "./test-time-budgets.mjs";

// A Node test runner reporter for npm run test:full: it prints the slowest
// test files against their budgets in tooling/test-time-budgets.json, and
// fails the run when a file, the suite's total or its wall-clock time is over
// budget. The run's own summary, the one without a file, gives the wall-clock
// time.
//
// It also fails the run when a file's report ended before that file's own
// summary, the last thing its process reports: the tests after the cut never
// reached the runner, which would still count the file as passed. Only the
// suite's own files (tests/server/*.test.js, as tooling/run-server-tests.mjs
// runs them) have summaries: a test reports under the file that declares it,
// and the development example's test file runs the example project's tests
// (examples/hello-node/test/server.test.js) in its own process.
const SUITE_FILE = /\/tests\/server\/[^/]+\.test\.js$/u;

export default async function* testTimeBudgets(source) {
  const started = Date.now();
  const files = new Map();
  const reported = new Set();
  let wallMs;
  for await (const event of source) {
    if ((event.type === "test:pass" || event.type === "test:fail") && SUITE_FILE.test(event.data.file || "")) {
      reported.add(event.data.file);
    }
    if (event.type !== "test:summary") continue;
    if (event.data.file) files.set(event.data.file, event.data.duration_ms);
    else wallMs = event.data.duration_ms;
  }
  wallMs ??= Date.now() - started;
  const { overruns, report } = checkTimeBudgets({ suite: "server", budgets: loadTimeBudgets("server"), files, wallMs });
  const cut = [...reported].filter((file) => !files.has(file));
  if (overruns.length > 0 || cut.length > 0) process.exitCode = 1;
  yield report;
  if (cut.length > 0) {
    yield [
      "These test files' reports ended before their summaries, so tests they ran are missing from this run:",
      ...cut.map((file) => `  ${file}`),
      ""
    ].join("\n");
  }
}
