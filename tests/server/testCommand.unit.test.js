import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { targetedTestArguments } from "../../tooling/run-targeted-tests.mjs";

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

test("the targeted test command always fixes file concurrency at one", () => {
  assert.deepEqual(
    targetedTestArguments([
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]),
    [
      "--test-concurrency=1",
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]
  );
  assert.deepEqual(
    targetedTestArguments([
      "--runInBand",
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]),
    [
      "--test-concurrency=1",
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]
  );
  assert.throws(
    () => targetedTestArguments([
      "--test-concurrency=2",
      "tests/server/codexTemporaryConversationLifecycle.unit.test.js"
    ]),
    /concurrency is fixed at 1/u
  );
});

test("every direct Node test script fixes file concurrency at one", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));

  for (const [scriptName, command] of Object.entries(manifest.scripts)) {
    if (command.includes("node --test")) {
      assert.match(
        command,
        /node --test --test-concurrency=1/u,
        `${scriptName} must limit Node test-file concurrency`
      );
    }
  }
  assert.equal(
    manifest.scripts.verify,
    "npm run lint && npm run test:full && npm run test:client && npm run build && npm run verify:packages"
  );
});
