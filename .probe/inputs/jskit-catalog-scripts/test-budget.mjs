import os from "node:os";
import process from "node:process";

// The machine's test budget: how many test files (node --test), Playwright workers or Vitest workers a run may use at
// once. A test runner that hands out slots exports V64_TEST_CONCURRENCY for each run; anywhere else a run takes half
// of the machine, so a test suite neither runs one file at a time nor overwhelms the machine (a 2-vCPU VPS stays at 1).
const BUDGET_VARIABLE = "V64_TEST_CONCURRENCY";

/**
 * @param {{ env?: Record<string, string | undefined>, parallelism?: number }} [options]
 * @returns {number} a whole number of at least 1
 */
function testConcurrency({ env = process.env, parallelism = os.availableParallelism() } = {}) {
  const configured = String(env[BUDGET_VARIABLE] ?? "").trim();
  if (/^[1-9]\d*$/u.test(configured)) return Number(configured);
  return Math.max(1, Math.floor(parallelism / 2));
}

export { BUDGET_VARIABLE, testConcurrency };
