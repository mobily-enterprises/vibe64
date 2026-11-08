import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { serverTestRun } from "../../tooling/run-server-tests.mjs";
import { targetedTestArguments } from "../../tooling/run-targeted-tests.mjs";
import { BUDGET_VARIABLE, testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

const runnerPath = fileURLToPath(new URL("../../tooling/run-targeted-tests.mjs", import.meta.url));

test("the targeted test runner executes its command-line guard", () => {
  const result = spawnSync(process.execPath, [runnerPath], {
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to run an untargeted test command/u);
});

test("the root test command requires one explicit test file", async () => {
  assert.throws(
    () => targetedTestArguments([]),
    /Refusing to run an untargeted test command/u
  );
  assert.throws(
    () => targetedTestArguments([
      "tests/server/one.unit.test.js",
      "tests/server/two.unit.test.js"
    ]),
    /Pass exactly one test file/u
  );

  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
  assert.equal(manifest.scripts.test, "node tooling/run-targeted-tests.mjs");
});

test("the targeted test command passes Node test options through to its one file", () => {
  assert.deepEqual(
    targetedTestArguments([
      "--runInBand",
      "--test-name-pattern=closes",
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]),
    [
      "--test-name-pattern=closes",
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]
  );
});

test("test files run as many at once as the machine's test budget allows", () => {
  // JSKIT's budget: V64_TEST_CONCURRENCY when it is a whole number of at least 1, otherwise half the machine.
  assert.equal(BUDGET_VARIABLE, "V64_TEST_CONCURRENCY");
  assert.equal(testConcurrency({ env: {}, parallelism: 2 }), 1);
  assert.equal(testConcurrency({ env: {}, parallelism: 1 }), 1);
  assert.equal(testConcurrency({ env: {}, parallelism: 8 }), 4);
  assert.equal(testConcurrency({ env: { [BUDGET_VARIABLE]: "3" }, parallelism: 2 }), 3);
  for (const value of [" ", "0", "-1", "1.5", "two"]) {
    assert.equal(testConcurrency({ env: { [BUDGET_VARIABLE]: value }, parallelism: 8 }), 4);
  }
});

test("the full server suite loads the host path guard a single-file run loads", () => {
  const guard = `--import=${new URL("../../tooling/test-host-path-guard.mjs", import.meta.url).href}`;
  const { args, env } = serverTestRun({ [BUDGET_VARIABLE]: "3", NODE_OPTIONS: "--no-warnings" });
  assert.equal(env.NODE_OPTIONS, `--no-warnings ${guard}`);
  assert.ok(args.includes("--test-concurrency=3"));
  assert.equal(args.at(-1), "tests/server/*.test.js");
  // A guard already in NODE_OPTIONS is not added twice.
  assert.equal(serverTestRun({ NODE_OPTIONS: guard }).env.NODE_OPTIONS, guard);
});

test("the full suites run under the machine's test budget", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
  assert.equal(manifest.scripts["test:full"], "node tooling/run-server-tests.mjs");
  assert.equal(manifest.scripts["test:client"], "vitest run tests/client");
  for (const [scriptName, command] of Object.entries(manifest.scripts)) {
    assert.doesNotMatch(command, /node --test /u, `${scriptName} must run Node tests through a budgeted runner`);
    assert.doesNotMatch(command, /--test-concurrency|--maxWorkers|--no-file-parallelism|--workers|\s-j\s*\d/u, `${scriptName} must not fix its own concurrency`);
  }
  assert.equal(
    manifest.scripts.verify,
    "npm run lint && npm run test:full && npm run test:client && npm run build && npm run verify:packages"
  );
});
