import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runServerTests, serverTestOptions, serverTestRun } from "../../tooling/run-server-tests.mjs";
import { targetedTestArguments } from "../../tooling/run-targeted-tests.mjs";
import { loadTimeBudgets } from "../../tooling/test-time-budgets.mjs";
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

test("the full server suite gives every test a hard deadline and stops at its wall-clock bound", () => {
  const budgets = loadTimeBudgets("server");
  const { args, deadlineMs } = serverTestRun({});
  assert.ok(budgets.testMs > 0 && budgets.testMs < budgets.wallMs);
  assert.ok(args.includes(`--test-timeout=${budgets.testMs}`));
  // A file whose hung test left a server or timer open still ends with its tests.
  assert.ok(args.includes("--test-force-exit"));
  assert.equal(deadlineMs, budgets.wallMs);
});

test("CI runs the server suite in shards that together run every file once", async (t) => {
  assert.deepEqual(serverTestOptions([]), {});
  assert.deepEqual(serverTestOptions(["--shard=2/4"]), { shard: "2/4" });
  for (const argv of [["--shard=0/4"], ["--shard=5/4"], ["--shard=1"], ["--shard=1/4", "--shard=2/4"], ["tests/server/one.unit.test.js"]]) {
    assert.equal(serverTestOptions(argv), null, argv.join(" "));
  }
  const { args } = serverTestRun({}, loadTimeBudgets("server"), { shard: "2/4" });
  assert.ok(args.includes("--test-shard=2/4"));
  assert.equal(args.at(-1), "tests/server/*.test.js");
  assert.equal(serverTestRun({}).args.some((arg) => arg.startsWith("--test-shard")), false);
  // Node's --test-shard: each file of the pattern runs in exactly one of the shards.
  const directory = await mkdtemp(path.join(os.tmpdir(), "v64-server-shards-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const names = ["a", "b", "c", "d", "e"];
  await Promise.all(names.map((name) => writeFile(path.join(directory, `${name}.test.js`),
    `require("node:fs").appendFileSync(${JSON.stringify(path.join(directory, "ran"))}, "${name}\\n");\n`)));
  // This file runs under the test runner itself, whose NODE_TEST_CONTEXT would make the inner runner run nothing.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const shard of ["1/2", "2/2"]) {
    const result = spawnSync(process.execPath, ["--test", `--test-shard=${shard}`, "*.test.js"], { cwd: directory, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.deepEqual((await readFile(path.join(directory, "ran"), "utf8")).trim().split("\n").sort(), names);
});

test("a server run past its deadline is stopped with every process it started", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "v64-server-run-deadline-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const pidFile = path.join(directory, "child.pid");
  const messages = [];
  t.mock.method(console, "error", (message) => messages.push(message));
  // A runner and a child that both ignore SIGTERM, as a wedged run would.
  const runner = [
    "const { spawn } = require('node:child_process');",
    "process.on('SIGTERM', () => {});",
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { stdio: 'ignore' });",
    "require('node:fs').writeFileSync(process.argv[1], String(child.pid));",
    "setInterval(() => {}, 1000);"
  ].join("\n");
  const started = Date.now();
  const exitCode = await runServerTests(
    { args: ["-e", runner, pidFile], deadlineMs: 1_500, env: process.env },
    { graceMs: 100 }
  );
  assert.equal(exitCode, 1);
  assert.ok(Date.now() - started < 10_000);
  assert.match(messages.join("\n"), /ran past its \d+ min wall-clock bound/u);
  const childPid = Number(await readFile(pidFile, "utf8"));
  assert.ok(childPid > 1);
  const childGone = async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        process.kill(childPid, 0);
      } catch (error) {
        if (error.code === "ESRCH") return true;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };
  assert.equal(await childGone(), true);
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
