import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { withHostPathGuard } from "./run-targeted-tests.mjs";
import { testConcurrency } from "./test-concurrency.mjs";

// npm run test:full: every server test file, as many at once as the machine's
// test budget allows (tooling/test-concurrency.mjs), with the time budgets of
// tooling/test-time-budgets.json, each file under the host path guard that a
// single-file run loads too. Node expands the file pattern itself.
export function serverTestRun(env = process.env) {
  return {
    args: [
      "--test",
      `--test-concurrency=${testConcurrency({ env })}`,
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=./tooling/test-time-budget-reporter.mjs",
      "--test-reporter-destination=stderr",
      "tests/server/*.test.js"
    ],
    env: withHostPathGuard(env)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { args, env } = serverTestRun();
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
