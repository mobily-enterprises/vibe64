import os from "node:os";
import process from "node:process";

export const TEST_CONCURRENCY_ENV = "V64_TEST_CONCURRENCY";

// Moves to JSKIT's test concurrency helper at the next JSKIT repin; this module then re-exports it.
/**
 * How many test files, or Playwright workers, run at once: V64_TEST_CONCURRENCY
 * when it is set (a test runner gives each of its slots a share of the
 * machine), else half the machine's CPUs, so a run never takes the whole
 * machine and a 2-CPU computer runs one at a time.
 */
export function testConcurrency({ env = process.env, cpus = os.availableParallelism() } = {}) {
  const requested = String(env[TEST_CONCURRENCY_ENV] ?? "").trim();
  if (!requested) return Math.max(1, Math.floor(cpus / 2));
  const count = Number(requested);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${TEST_CONCURRENCY_ENV} must be a whole number of at least 1, not "${requested}".`);
  }
  return count;
}
