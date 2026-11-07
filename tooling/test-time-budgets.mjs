import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Coarse time budgets: each test file has a budget for the time its tests
// take, and each suite one for the time all its files take together, so a run
// fails when something is clearly broken (a file that waits out timeouts, a
// suite that would run for hours) instead of quietly adding minutes. Each
// budget is about five times the time measured with this repository's own
// commands on busy, parallel test hosts, and a suite's defaultFileMs, the
// budget of every file without its own entry, is a floor for small files, so
// normal variation never trips one. The suite budget adds up the files' times
// rather than timing the run, so it holds however many files run at once; a
// suite's wallMs bounds the run's own wall-clock time, about three times what
// it took running files in parallel on a busy test host, so a suite that would
// take hours fails loudly. These are coarse backstops: the real guard against
// a suite falling back to one file at a time is the test that no script fixes
// its own concurrency (tests/server/testCommand.unit.test.js). Every run prints
// its slowest files against their budgets, so waste shows at a glance.
const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUDGETS_FILE = fileURLToPath(new URL("./test-time-budgets.json", import.meta.url));
const SLOWEST_SHOWN = 10;

function loadTimeBudgets(suite, budgetsFile = BUDGETS_FILE) {
  const budgets = JSON.parse(readFileSync(budgetsFile, "utf8"))[suite];
  if (!budgets) throw new Error(`${path.basename(budgetsFile)} has no budgets for the ${suite} suite.`);
  return budgets;
}

function repositoryPath(file) {
  return path.relative(APP_ROOT, path.resolve(APP_ROOT, file)).split(path.sep).join("/");
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

// Wall-clock time: seconds under a minute, else minutes.
function wallTime(ms) {
  return ms < 60_000 ? seconds(ms) : `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * Checks a run against its suite's budgets. `files` maps each test file to the
 * time its tests took, and `wallMs` is the run's wall-clock time. Returns the
 * budgets it exceeded, as messages, and a report that always lists the slowest
 * files against their budgets, then any overruns.
 */
function checkTimeBudgets({ suite, budgets, files, wallMs }) {
  const rows = [...files].map(([file, ms]) => {
    const name = repositoryPath(file);
    return { name, ms, budget: budgets.fileMs?.[name] ?? budgets.defaultFileMs };
  });
  const totalMs = rows.reduce((sum, row) => sum + row.ms, 0);
  const overruns = rows
    .filter((row) => row.ms > row.budget)
    .map((row) => `${row.name} took ${seconds(row.ms)}, over its ${seconds(row.budget)} budget.`);
  if (totalMs > budgets.totalMs) {
    overruns.push(`The suite's files took ${seconds(totalMs)} in all, over its ${seconds(budgets.totalMs)} budget.`);
  }
  if (wallMs > budgets.wallMs) {
    overruns.push(`The suite ran for ${wallTime(wallMs)}, over its ${wallTime(budgets.wallMs)} wall-clock bound.`);
  }
  const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST_SHOWN);
  const lines = [
    `Slowest ${suite} test files, time / budget (tooling/test-time-budgets.json); all ${rows.length}: ${seconds(totalMs)} / ${seconds(budgets.totalMs)}; wall ${wallTime(wallMs)} / ${wallTime(budgets.wallMs)}`,
    ...slowest.map((row) => `  ${seconds(row.ms)} / ${seconds(row.budget)}  ${row.name}`)
  ];
  if (overruns.length > 0) {
    lines.push(
      `Time budget exceeded in the ${suite} suite: something is clearly broken.`,
      ...overruns.map((overrun) => `  ${overrun}`),
      "Find what got slow and fix it; change a budget only when the work itself grew, with the measurement."
    );
  }
  return { overruns, report: `${lines.join("\n")}\n` };
}

export {
  checkTimeBudgets,
  loadTimeBudgets
};
