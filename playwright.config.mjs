import { defineConfig } from "@playwright/test";
import { createJskitPlaywrightConfig } from "@jskit-ai/jskit-cli/test/playwright";

const jskitConfig = createJskitPlaywrightConfig();

export default defineConfig({
  ...jskitConfig,
  reporter: process.env.CI ? "github" : "list",
  workers: 1,
  use: {
    ...jskitConfig.use,
    trace: "retain-on-failure"
  },
  ...(process.env.VIBE64_LIVE_E2E === "1" ? { webServer: undefined } : {})
});
