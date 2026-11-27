// How many app servers a browser-test run gets, and the list of them its suite may receive.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  MAX_BROWSER_TEST_WORKERS,
  availableWorkMemoryBytes,
  browserTestWorkerCount,
  playwrightWorkerTargets
} from "../../packages/vibe64-terminals/src/server/browserTestWorkers.js";
import { installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";
import { MAX_EXECUTION_WORKERS } from "../../packages/vibe64-execution/src/server/index.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

test("a run's app servers: the budget's browser share or --workers within it, as many as free memory fits, never under one", () => {
  const plenty = 256 * GIB;
  const count = (input) => browserTestWorkerCount({ servesWorkers: true, budget: 8, freeBytes: plenty, ...input });
  // A target whose Run step takes no {workers} serves one, whatever is asked or free.
  assert.equal(browserTestWorkerCount({ servesWorkers: false, requested: 6, budget: 8, freeBytes: plenty }), 1);
  // A worker is a browser and an app server, two of the budget.
  assert.equal(count({}), 4);
  assert.equal(count({ budget: 9 }), 4);
  assert.equal(count({ budget: 1 }), 1);
  assert.equal(count({ requested: 6 }), 6);
  assert.equal(count({ requested: 1 }), 1);
  // Never more than the budget, whatever is asked.
  assert.equal(count({ requested: 12 }), 8);
  assert.equal(count({ requested: 2, budget: 1 }), 1);
  // Never more than one launch or execution may declare.
  assert.equal(count({ budget: 400 }), MAX_BROWSER_TEST_WORKERS);
  assert.equal(MAX_BROWSER_TEST_WORKERS, MAX_EXECUTION_WORKERS);
  // Without a Running high estimate a worker is planned at 1.5 GiB, within 80% of the free memory.
  assert.equal(count({ freeBytes: 4 * GIB }), 2);
  assert.equal(count({ freeBytes: 1 * GIB }), 1);
  // With one, a worker is the app server's high plus a Chromium.
  assert.equal(count({ freeBytes: 4 * GIB, runningHighBytes: 256 * MIB }), 4);
  assert.equal(count({ freeBytes: 2 * GIB, runningHighBytes: 256 * MIB }), 2);
  // A host that cannot tell its free memory gets one, as does one that has none.
  assert.equal(count({ freeBytes: null }), 1);
  assert.equal(count({ freeBytes: 0 }), 1);
});

test("a managed host's own free memory decides, and null when it cannot tell; this process's own without one", async (t) => {
  // This process's figure is a fixed one: two live reads a moment apart differ on a busy host.
  t.mock.method(process, "availableMemory", () => 5 * GIB);
  assert.equal(await availableWorkMemoryBytes(), 5 * GIB, "no provider: this process's own");
  let answer = 3 * GIB;
  const release = installVibe64ManagedExecutionProvider({
    runCommand() {},
    stopExecution() {},
    async availableMemoryBytes() { return answer; }
  });
  t.after(release);
  assert.equal(await availableWorkMemoryBytes(), 3 * GIB);
  for (const unknown of [null, undefined, -1, 1.5, "3221225472", Number.NaN]) {
    answer = unknown;
    assert.equal(await availableWorkMemoryBytes(), null, `${String(unknown)} is not a count of bytes`);
  }
  answer = 0;
  assert.equal(await availableWorkMemoryBytes(), 0);
});

test("a suite's PLAYWRIGHT_WORKER_TARGETS lists 2 to 64 HTTP servers, each with at most its sign-in state from the run's own directory", () => {
  const directory = "/tmp/vibe64-playwright-run-unit";
  const state = (worker) => path.join(directory, `storage-state-${worker}.json`);
  const list = [
    { baseURL: "http://127.0.0.1:4100", storageState: state(0) },
    { baseURL: "http://127.0.0.1:4101", storageState: state(1) }
  ];
  assert.deepEqual(playwrightWorkerTargets(JSON.stringify(list), directory), list);
  const signedOut = list.map(({ baseURL }) => ({ baseURL }));
  assert.deepEqual(playwrightWorkerTargets(JSON.stringify(signedOut), directory), signedOut);
  const refused = (text, stateDirectory = directory) => {
    const result = playwrightWorkerTargets(text, stateDirectory);
    assert.equal(result.error?.code, "vibe64_managed_playwright_worker_targets_invalid", text);
  };
  // Only a run's own suite, which has a run directory.
  refused(JSON.stringify(list), "");
  refused("[{");
  refused(JSON.stringify({ baseURL: "http://127.0.0.1:4100" }));
  refused(JSON.stringify(list.slice(0, 1)));
  refused(JSON.stringify(Array.from({ length: MAX_BROWSER_TEST_WORKERS + 1 }, (_unused, worker) => ({
    baseURL: `http://127.0.0.1:${4100 + worker}`
  }))));
  for (const entry of [
    { baseURL: "file:///etc/passwd" },
    { baseURL: "not a url" },
    { baseURL: "http://127.0.0.1:4101", storageState: "/home/person/.auth/state.json" },
    { baseURL: "http://127.0.0.1:4101", storageState: path.join(directory, "..", "elsewhere.json") },
    { baseURL: "http://127.0.0.1:4101", storageState: path.join(directory, "nested", "state.json") },
    { baseURL: "http://127.0.0.1:4101", storageState: "storage-state-1.json" },
    { baseURL: "http://127.0.0.1:4101", storageState: 1 },
    { baseURL: "http://127.0.0.1:4101", headers: { cookie: "x" } },
    null
  ]) {
    refused(JSON.stringify([list[0], entry]));
  }
});
