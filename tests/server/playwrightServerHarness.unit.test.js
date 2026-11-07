import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  SERVER_COUNT_ENV,
  commandLineWorkers,
  defaultWorkerCount,
  e2eServerCount,
  e2eServerPorts,
  e2eWorkerPort,
  workerCount
} from "../e2e/support/e2e-servers.mjs";
import {
  playwrightServerStartOptions
} from "../e2e/support/start-web-server.mjs";

test("Playwright starts the local app without browser-disconnect shutdown", () => {
  const env = {
    PORT: "4173"
  };

  assert.deepEqual(playwrightServerStartOptions({
    cwd: "/workspace/vibe64",
    env
  }), {
    browserLifecycleShutdown: false,
    port: undefined,
    runtimeMode: "local",
    startupSlug: "vibe64",
    strictPort: true,
    targetRoot: "/workspace/vibe64"
  });
  assert.equal(
    env[VIBE64_RUNTIME_NAMESPACE_ENV],
    VIBE64_LOCAL_RUNTIME_NAMESPACE
  );
});

test("Playwright reads a worker count as a number or a share of the CPUs", () => {
  assert.equal(workerCount("3"), 3);
  assert.equal(workerCount("50%", 8), 4);
  assert.equal(workerCount("10%", 8), 1);
  assert.equal(workerCount(""), 0);
  assert.equal(workerCount("0"), 0);
  assert.equal(workerCount("many"), 0);
});

test("the last --workers or -j on the command line is the one Playwright uses", () => {
  assert.equal(commandLineWorkers(["node", "playwright", "test", "--workers=2", "a.spec.ts"]), "2");
  assert.equal(commandLineWorkers(["node", "playwright", "test", "--workers", "3"]), "3");
  assert.equal(commandLineWorkers(["node", "playwright", "test", "-j", "4", "-j2"]), "2");
  assert.equal(commandLineWorkers(["node", "playwright", "test", "-j=50%"]), "50%");
  assert.equal(commandLineWorkers(["node", "playwright", "test"]), "");
});

test("the main process settles one server per worker and its workers read that count", () => {
  const env = { PLAYWRIGHT_PORT: "4183", V64_TEST_CONCURRENCY: "2" };
  assert.equal(e2eServerCount({ argv: ["node", "playwright", "test", "--workers=3"], env }), 3);
  assert.equal(env[SERVER_COUNT_ENV], "3");
  assert.deepEqual(e2eServerPorts(env), [4183, 4184, 4185]);
  // A worker sees no --workers of its own, only the recorded count and its index.
  assert.equal(e2eWorkerPort({ ...env, TEST_PARALLEL_INDEX: "0" }), 4183);
  assert.equal(e2eWorkerPort({ ...env, TEST_PARALLEL_INDEX: "2" }), 4185);
  // Without --workers, a worker for every two threads of the machine's test budget sets the count.
  assert.equal(e2eServerCount({ argv: ["node", "playwright", "test"], env: { V64_TEST_CONCURRENCY: "6" } }), 3);
  assert.ok(e2eServerCount({ argv: ["node", "playwright", "test"], env: {} }) >= 1);
});

test("each browser worker gets two threads of the test budget, and a small budget still runs one", () => {
  assert.equal(defaultWorkerCount({ V64_TEST_CONCURRENCY: "6" }), 3);
  assert.equal(defaultWorkerCount({ V64_TEST_CONCURRENCY: "5" }), 2);
  assert.equal(defaultWorkerCount({ V64_TEST_CONCURRENCY: "2" }), 1);
  assert.equal(defaultWorkerCount({ V64_TEST_CONCURRENCY: "1" }), 1);
});

test("a server the person started is one server on PLAYWRIGHT_PORT", () => {
  assert.equal(e2eWorkerPort({ PLAYWRIGHT_PORT: "4200", VIBE64_LIVE_E2E: "1", TEST_PARALLEL_INDEX: "3" }), 4200);
});
