import { defineConfig } from "@playwright/test";

const managedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "")
  .trim()
  .replace(/\/+$/u, "");
const port = String(process.env.PLAYWRIGHT_PORT || "").trim() || "4173";
const baseURL = managedBaseUrl || `http://127.0.0.1:${port}`;
const storageState = String(process.env.VIBE64_PLAYWRIGHT_STORAGE_STATE || "").trim();
const useRunningServer = Boolean(managedBaseUrl) || process.env.VIBE64_LIVE_E2E === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: process.env.CI ? "github" : "list",
  workers: 1,
  use: {
    baseURL,
    headless: true,
    ...(storageState ? { storageState } : {}),
    trace: "retain-on-failure"
  },
  ...(useRunningServer ? {} : {
    webServer: {
      command: "npm run build && node ./tests/e2e/support/start-web-server.mjs",
      env: {
        PORT: port
      },
      // Playwright's default stop is SIGKILL, which skips the server's shutdown
      // and leaves its temporary folder behind. SIGTERM runs that shutdown; the
      // server forces its own exit after 8 s, inside this timeout.
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 10_000
      },
      url: `${baseURL}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000
    }
  })
});
