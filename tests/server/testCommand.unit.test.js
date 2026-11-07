import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { targetedTestArguments } from "../../tooling/run-targeted-tests.mjs";
import { TEST_CONCURRENCY_ENV, testConcurrency } from "../../tooling/test-concurrency.mjs";

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
  assert.equal(testConcurrency({ env: {}, cpus: 2 }), 1);
  assert.equal(testConcurrency({ env: {}, cpus: 1 }), 1);
  assert.equal(testConcurrency({ env: {}, cpus: 8 }), 4);
  assert.equal(testConcurrency({ env: { [TEST_CONCURRENCY_ENV]: "3" }, cpus: 2 }), 3);
  assert.equal(testConcurrency({ env: { [TEST_CONCURRENCY_ENV]: " " }, cpus: 8 }), 4);
  for (const value of ["0", "-1", "1.5", "two"]) {
    assert.throws(() => testConcurrency({ env: { [TEST_CONCURRENCY_ENV]: value }, cpus: 8 }), /V64_TEST_CONCURRENCY must be a whole number/u);
  }
});

test("the full suites run under the machine's test budget", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
  assert.equal(manifest.scripts["test:full"], "node tooling/run-server-tests.mjs");
  assert.equal(manifest.scripts["test:client"], "vitest run tests/client");
  for (const [scriptName, command] of Object.entries(manifest.scripts)) {
    assert.doesNotMatch(command, /node --test /u, `${scriptName} must run Node tests through a budgeted runner`);
    assert.doesNotMatch(command, /--test-concurrency|--maxWorkers|--no-file-parallelism/u, `${scriptName} must not fix its own concurrency`);
  }
  assert.equal(
    manifest.scripts.verify,
    "npm run lint && npm run test:full && npm run test:client && npm run build && npm run verify:packages"
  );
});
