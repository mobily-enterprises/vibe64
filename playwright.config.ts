import { defineConfig } from "@playwright/test";

const externalBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "").trim();
const liveE2eEnabled = process.env.VIBE64_LIVE_E2E === "1";
const port = Number(process.env.PLAYWRIGHT_PORT || 5173);
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;

export default defineConfig({
  expect: {
    timeout: 5000
  },
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: externalBaseUrl || liveE2eEnabled
    ? undefined
    : {
        command: `node ./bin/dev.js --host 127.0.0.1 --port ${port} --strictPort`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        url: baseURL
      }
});
