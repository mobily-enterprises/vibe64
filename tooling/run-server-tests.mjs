import { spawnSync } from "node:child_process";
import process from "node:process";

import { testConcurrency } from "./test-concurrency.mjs";

// npm run test:full: every server test file, as many at once as the machine's
// test budget allows (tooling/test-concurrency.mjs), with the time budgets of
// tooling/test-time-budgets.json. Node expands the file pattern itself.
const result = spawnSync(process.execPath, [
  "--test",
  `--test-concurrency=${testConcurrency()}`,
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
  "--test-reporter=./tooling/test-time-budget-reporter.mjs",
  "--test-reporter-destination=stderr",
  "tests/server/*.test.js"
], { stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
