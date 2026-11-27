// How many app servers a browser-test run gets. A target whose Run step takes `{workers}` (a web target with
// `- Data: test`) serves one app server per Playwright worker, worker i on {port}+i with its own copy of the test
// database, so the suite runs in parallel; any other target serves one, as always. The count is the test budget's
// browser share (a worker is a browser and an app server, about two threads: JSKIT's rule), or the run's --workers
// capped at the budget, never more than the free memory fits, never under one.
import path from "node:path";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";
import { MAX_EXECUTION_WORKERS, vibe64ManagedExecutionProvider } from "@local/vibe64-execution/server";
import { commandFailure } from "./commandFailure.js";

const MIB = 1024 * 1024;
// One worker's Chromium, beside the app server its measure (recorded peak or Running high estimate) describes.
const CHROMIUM_BYTES = 512 * MIB;
// One worker, app server and Chromium, for a target with neither.
const DEFAULT_WORKER_BYTES = 1536 * MIB;
// The share of the free memory a run's workers may plan to take: the rest absorbs estimates that ran low.
const MEMORY_SHARE = 0.8;
// The most app servers one run starts: as many as one launch or execution may declare.
const MAX_BROWSER_TEST_WORKERS = MAX_EXECUTION_WORKERS;

/**
 * The app servers a browser-test run serves.
 * @param {object} input
 * @param {boolean} input.servesWorkers whether the target's Run step takes `{workers}`
 * @param {number} [input.requested] the run's --workers, 0 for the default
 * @param {number} input.budget the test budget (JSKIT's testConcurrency())
 * @param {number | null} input.freeBytes the memory free for the run's work; null when the host cannot tell
 * @param {number} [input.runningHighBytes] one app server's memory: the last run's recorded peak, else the target's
 *   Running high estimate, 0 without either
 * @returns {number} a whole number from 1 to MAX_BROWSER_TEST_WORKERS
 */
function browserTestWorkerCount({ servesWorkers, requested = 0, budget, freeBytes, runningHighBytes = 0 }) {
  if (!servesWorkers) return 1;
  const want = requested > 0 ? Math.min(requested, budget) : Math.floor(budget / 2);
  const perWorker = runningHighBytes > 0 ? runningHighBytes + CHROMIUM_BYTES : DEFAULT_WORKER_BYTES;
  const memoryFit = Number.isFinite(freeBytes) && freeBytes > 0 ? Math.floor((MEMORY_SHARE * freeBytes) / perWorker) : 1;
  return Math.max(1, Math.min(want, memoryFit, MAX_BROWSER_TEST_WORKERS));
}

/**
 * The memory free for a run's work: a managed host's own count (its provider's availableMemoryBytes(), null when it
 * cannot tell), else this process's (its cgroup's limit or the machine's available memory). A host's provider counts
 * the pool its executions run in, which the editor's own cgroup is not.
 * @returns {Promise<number | null>}
 */
async function availableWorkMemoryBytes() {
  const provider = vibe64ManagedExecutionProvider();
  // readable-check: allow method-probe - optional operation: a host's provider that cannot count its pool offers none
  if (typeof provider?.availableMemoryBytes !== "function") return process.availableMemory();
  const bytes = await provider.availableMemoryBytes();
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

/**
 * A run's PLAYWRIGHT_WORKER_TARGETS: a JSON list of 2 to MAX_BROWSER_TEST_WORKERS entries, each worker's app server
 * ({ baseURL }, an HTTP origin) and, for an app with sign-in, its signed-in state ({ storageState }, a file in the
 * run's own directory), which JSKIT's browserTestConfig() reads. Refused outside a run's own suite (no run directory).
 * @param {string} text
 * @param {string} stateDirectory
 * @returns {Array<{ baseURL: string, storageState: string }> & { error?: undefined } | { error: object }}
 */
function playwrightWorkerTargets(text, stateDirectory) {
  const refuse = (message) => ({
    error: commandFailure(message, "vibe64_managed_playwright_worker_targets_invalid")
  });
  if (!stateDirectory) return refuse("Only a browser-test run's own suite gets PLAYWRIGHT_WORKER_TARGETS.");
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    return refuse("PLAYWRIGHT_WORKER_TARGETS is not JSON.");
  }
  if (!Array.isArray(list) || list.length < 2 || list.length > MAX_BROWSER_TEST_WORKERS) {
    return refuse(`PLAYWRIGHT_WORKER_TARGETS lists 2 to ${MAX_BROWSER_TEST_WORKERS} workers.`);
  }
  for (const entry of list) {
    let protocol = "";
    try {
      protocol = new URL(String(entry?.baseURL)).protocol;
    } catch {
      // Refused below.
    }
    const storageState = entry?.storageState;
    if (!["http:", "https:"].includes(protocol) ||
        (storageState !== undefined && (typeof storageState !== "string" || !path.isAbsolute(storageState) ||
          path.dirname(path.resolve(storageState)) !== path.resolve(stateDirectory))) ||
        Object.keys(entry).some((key) => !["baseURL", "storageState"].includes(key))) {
      return refuse("Each PLAYWRIGHT_WORKER_TARGETS entry is { baseURL, storageState? }: an HTTP URL and the run's own sign-in state.");
    }
  }
  return list;
}

export {
  MAX_BROWSER_TEST_WORKERS,
  availableWorkMemoryBytes,
  browserTestWorkerCount,
  playwrightWorkerTargets,
  testConcurrency as browserTestBudget
};
