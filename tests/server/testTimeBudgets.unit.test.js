import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import TimeBudgetReporter from "../e2e/support/time-budget-reporter.mjs";
import testTimeBudgets from "../../tooling/test-time-budget-reporter.mjs";
import { checkTimeBudgets, loadTimeBudgets } from "../../tooling/test-time-budgets.mjs";
import VitestTimeBudgetReporter from "../../tooling/vitest-time-budget-reporter.mjs";

const budgets = { totalMs: 60_000, defaultFileMs: 10_000, fileMs: { "tests/e2e/slow.spec.ts": 30_000 } };
const OVER_EVERY_BUDGET = Number.MAX_SAFE_INTEGER;

function withExitCode(t) {
  const original = process.exitCode;
  t.after(() => { process.exitCode = original; });
}

function collectedOutput() {
  const chunks = [];
  return { write: (chunk) => chunks.push(chunk), text: () => chunks.join("") };
}

test("every suite has a total budget and a default file budget", () => {
  for (const suite of ["server", "client", "browser"]) {
    const suiteBudgets = loadTimeBudgets(suite);
    assert.ok(suiteBudgets.totalMs > 0, suite);
    assert.ok(suiteBudgets.defaultFileMs > 0, suite);
  }
});

test("a file keeps to its own budget, or else to the default, and all files together to the suite's", () => {
  const check = (files) => checkTimeBudgets({ suite: "browser", budgets, files: new Map(files) }).overruns;
  assert.deepEqual(check([["tests/e2e/slow.spec.ts", 29_000], ["tests/e2e/quick.spec.ts", 9_000]]), []);
  assert.deepEqual(check([["tests/e2e/slow.spec.ts", 31_000], ["tests/e2e/quick.spec.ts", 11_000]]), [
    "tests/e2e/slow.spec.ts took 31.0 s, over its 30.0 s budget.",
    "tests/e2e/quick.spec.ts took 11.0 s, over its 10.0 s budget."
  ]);
  assert.deepEqual(
    check([["tests/e2e/slow.spec.ts", 25_000], ...Array.from({ length: 4 }, (_, index) => [`tests/e2e/q${index}.spec.ts`, 9_000])]),
    ["The suite's files took 61.0 s in all, over its 60.0 s budget."]
  );
});

test("every run reports its ten slowest files against their budgets, then any overruns", () => {
  const files = new Map(Array.from({ length: 12 }, (_, index) => [`tests/e2e/f${index}.spec.ts`, (index + 1) * 100]));
  const { overruns, report } = checkTimeBudgets({ suite: "browser", budgets, files });
  assert.deepEqual(overruns, []);
  const lines = report.trimEnd().split("\n");
  assert.equal(lines[0], "Slowest browser test files, time / budget (tooling/test-time-budgets.json); all 12: 7.8 s / 60.0 s");
  assert.equal(lines.length, 11);
  assert.equal(lines[1], "  1.2 s / 10.0 s  tests/e2e/f11.spec.ts");
  assert.equal(lines[10], "  0.3 s / 10.0 s  tests/e2e/f2.spec.ts");

  files.set("tests/e2e/slow.spec.ts", 31_000);
  const over = checkTimeBudgets({ suite: "browser", budgets, files });
  assert.equal(over.report.split("\n")[1], "  31.0 s / 30.0 s  tests/e2e/slow.spec.ts");
  assert.match(over.report, /\nTime budget exceeded in the browser suite: something is clearly broken\.\n {2}tests\/e2e\/slow\.spec\.ts took 31\.0 s, over its 30\.0 s budget\.\n/u);
});

test("the Node test reporter reports test:full's slowest files and fails it when a file is over its budget", async (t) => {
  withExitCode(t);
  async function* events(slowMs) {
    yield { type: "test:summary", data: { file: "tests/server/kept.unit.test.js", duration_ms: 1 } };
    yield { type: "test:summary", data: { file: "tests/server/slow.unit.test.js", duration_ms: slowMs } };
  }
  const run = async (slowMs) => {
    const output = [];
    for await (const chunk of testTimeBudgets(events(slowMs))) output.push(chunk);
    return output.join("");
  };
  const kept = await run(2);
  assert.notEqual(process.exitCode, 1);
  assert.match(kept, /^Slowest server test files[^\n]*\n {2}0\.0 s \/ [^\n]+ {2}tests\/server\/slow\.unit\.test\.js\n/u);
  assert.doesNotMatch(kept, /Time budget exceeded/u);
  const over = await run(OVER_EVERY_BUDGET);
  assert.equal(process.exitCode, 1);
  assert.match(over, /tests\/server\/slow\.unit\.test\.js took/u);
  assert.doesNotMatch(over, /kept\.unit\.test\.js took/u);
});

test("the Playwright reporter reports the slowest spec files and fails the run when one is over its budget", () => {
  const output = collectedOutput();
  const reporter = new TimeBudgetReporter({ output });
  reporter.onTestEnd({ location: { file: "tests/e2e/kept.spec.ts" } }, { duration: 1 });
  assert.equal(reporter.onEnd(), undefined);
  assert.match(output.text(), /^Slowest browser test files/u);
  reporter.onTestEnd({ location: { file: "tests/e2e/kept.spec.ts" } }, { duration: OVER_EVERY_BUDGET });
  assert.deepEqual(reporter.onEnd(), { status: "failed" });
  assert.match(output.text(), /tests\/e2e\/kept\.spec\.ts took/u);
});

test("the Vitest reporter reports the slowest files and fails the run when one, import included, is over its budget", (t) => {
  withExitCode(t);
  const output = collectedOutput();
  const reporter = new VitestTimeBudgetReporter({ output });
  const testModule = (moduleId, { collectDuration = 0, duration = 0 }) => ({
    moduleId,
    diagnostic: () => ({ environmentSetupDuration: 0, prepareDuration: 0, collectDuration, setupDuration: 0, duration })
  });
  reporter.onTestRunEnd([testModule("tests/client/kept.vitest.js", { collectDuration: 1, duration: 1 })]);
  assert.notEqual(process.exitCode, 1);
  assert.match(output.text(), /^Slowest client test files/u);
  reporter.onTestRunEnd([testModule("tests/client/slow-import.vitest.js", { collectDuration: OVER_EVERY_BUDGET })]);
  assert.equal(process.exitCode, 1);
  assert.match(output.text(), /tests\/client\/slow-import\.vitest\.js took/u);
});

test("each suite's own command checks its budgets", async () => {
  const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");
  assert.match(await read("tooling/run-server-tests.mjs"), /"--test-reporter=\.\/tooling\/test-time-budget-reporter\.mjs"/u);
  assert.match(await read("vite.config.mjs"), /reporters: \["default", "\.\/tooling\/vitest-time-budget-reporter\.mjs"\]/u);
  assert.match(await read("playwright.config.mjs"), /\["\.\/tests\/e2e\/support\/time-budget-reporter\.mjs"\]/u);
  assert.match(await read(".github/workflows/nightly-browser.yml"), /--reporter=list,blob,\.\/tests\/e2e\/support\/time-budget-reporter\.mjs/u);
});
