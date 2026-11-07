import { defineConfig } from "@playwright/test";

import { E2E_SERVERS_READY, e2eServerCount, e2eWorkerPort } from "./tests/e2e/support/e2e-servers.mjs";

const managedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "")
  .trim()
  .replace(/\/+$/u, "");
const storageState = String(process.env.PLAYWRIGHT_STORAGE_STATE || "").trim();
const useRunningServer = Boolean(managedBaseUrl) || process.env.VIBE64_LIVE_E2E === "1";
// Without a running server, each worker tests against its own server, so tests
// run in parallel without sharing a server's state (tests/e2e/support/e2e-servers.mjs).
// A running server is one shared server, so its tests run one at a time.
const baseURL = managedBaseUrl || `http://127.0.0.1:${e2eWorkerPort()}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  // The time budget reporter fails a run that went over tooling/test-time-budgets.json.
  reporter: [[process.env.CI ? "github" : "list"], ["./tests/e2e/support/time-budget-reporter.mjs"]],
  // Every test sets up its own page, mocks and folders; none depends on another.
  fullyParallel: true,
  workers: useRunningServer ? 1 : e2eServerCount(),
  use: {
    baseURL,
    headless: true,
    ...(storageState ? { storageState } : {}),
    // A failed test keeps its trace with a DOM snapshot of every action. The
    // trace's screencast is off: recording frames for every test took about a
    // quarter of the browser suite's CPU, and only failures keep a trace.
    trace: { mode: "retain-on-failure", screenshots: false }
  },
  ...(useRunningServer ? {} : {
    webServer: {
      // One build, then one server per worker, each started by the
      // single-server harness tests/e2e/support/start-web-server.mjs.
      command: "npm run build && node ./tests/e2e/support/start-web-servers.mjs",
      // Playwright's default stop is SIGKILL, which skips the servers' shutdown
      // and leaves their temporary folders behind. SIGTERM runs that shutdown;
      // each server forces its own exit after 8 s, inside this timeout.
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 10_000
      },
      // The launcher prints this once every server answers /api/health. Every
      // run tests the build it just made: the launcher refuses a port that
      // already answers, because that server may serve a build from before the
      // last JSKIT install.
      wait: {
        stdout: new RegExp(E2E_SERVERS_READY, "u")
      },
      timeout: 180_000
    }
  })
});
