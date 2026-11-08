import assert from "node:assert/strict";
import test from "node:test";

import { browserTestWorkers } from "@jskit-ai/jskit-catalog/browser-tests";
import {
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import playwrightConfig from "../../playwright.config.mjs";
import { loadTimeBudgets } from "../../tooling/test-time-budgets.mjs";
import {
  playwrightServerStartOptions
} from "../e2e/support/start-web-server.mjs";

const TARGET_VARIABLES = ["VIBE64_LIVE_E2E", "PLAYWRIGHT_BASE_URL", "PLAYWRIGHT_PORT", "PLAYWRIGHT_STORAGE_STATE", "PLAYWRIGHT_WORKERS"];

// The config as Playwright's main process reads it with only these of its
// variables set; the process's own are restored afterwards.
async function configWith(variables) {
  const saved = Object.fromEntries(TARGET_VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of TARGET_VARIABLES) delete process.env[name];
  Object.assign(process.env, variables);
  try {
    const { default: config } = await import(`../../playwright.config.mjs?${new URLSearchParams(variables)}`);
    return config;
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

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

test("browser tests run on JSKIT's harness with the suite's own bound, reduced motion and time budgets", () => {
  // The harness's workers, from the machine's test budget, never a count of the config's own.
  assert.equal(playwrightConfig.workers, browserTestWorkers());
  assert.equal(playwrightConfig.globalTimeout, loadTimeBudgets("browser").wallMs);
  assert.equal(playwrightConfig.fullyParallel, true);
  assert.equal(playwrightConfig.use.contextOptions.reducedMotion, "reduce");
  assert.deepEqual(playwrightConfig.reporter.at(-1), ["./tests/e2e/support/time-budget-reporter.mjs"]);
});

test("a running target, or a server the person started, is tested with one worker and no servers of the run's own", async () => {
  const managed = await configWith({
    PLAYWRIGHT_BASE_URL: "https://preview.example.test/",
    PLAYWRIGHT_STORAGE_STATE: "/tmp/preview-login/state.json"
  });
  assert.equal(managed.use.baseURL, "https://preview.example.test");
  // The login state its host supplies is handed on as it is.
  assert.equal(managed.use.storageState, "/tmp/preview-login/state.json");
  assert.equal(managed.workers, 1);
  assert.equal(managed.webServer, undefined);

  const live = await configWith({ VIBE64_LIVE_E2E: "1", PLAYWRIGHT_PORT: "4200" });
  assert.equal(live.use.baseURL, "http://127.0.0.1:4200");
  assert.equal(live.workers, 1);
  assert.equal(live.webServer, undefined);

  const local = await configWith({ PLAYWRIGHT_PORT: "4200" });
  assert.equal(local.use.baseURL, "http://127.0.0.1:4200");
  assert.ok(local.webServer, "a local run starts its own servers");
});
