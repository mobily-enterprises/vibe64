import { defineConfig } from "@playwright/test";
import { browserTestConfig } from "@jskit-ai/jskit-catalog/browser-tests";

import { loadTimeBudgets } from "./tooling/test-time-budgets.mjs";

// JSKIT's browser-test harness: it builds the app once (reused while its
// sources are unchanged) and starts one app server per worker on
// PLAYWRIGHT_PORT + N (4173 by default), each through the single-server harness
// with its own throwaway state, so tests running at once never share a server.
// With PLAYWRIGHT_BASE_URL, the tests use that running target instead, one
// worker at a time, with the login state its host supplies in
// PLAYWRIGHT_STORAGE_STATE. VIBE64_LIVE_E2E=1 makes a Vibe64 server the person
// started on PLAYWRIGHT_PORT that target.
if (process.env.VIBE64_LIVE_E2E === "1" && !String(process.env.PLAYWRIGHT_BASE_URL || "").trim()) {
  process.env.PLAYWRIGHT_BASE_URL = `http://127.0.0.1:${String(process.env.PLAYWRIGHT_PORT || "").trim() || 4173}`;
}

const harness = browserTestConfig({
  server: "node ./tests/e2e/support/start-web-server.mjs",
  // The whole suite needs longer than the harness's 20 minutes: its measured
  // wall-clock bound is in tooling/test-time-budgets.json.
  globalTimeout: loadTimeBudgets("browser").wallMs
});

export default defineConfig({
  ...harness,
  // Every test sets up its own page, mocks and folders; none depends on
  // another, so a file's tests spread across the workers too.
  fullyParallel: true,
  // The time budget reporter fails a run that went over tooling/test-time-budgets.json.
  reporter: [...harness.reporter, ["./tests/e2e/support/time-budget-reporter.mjs"]],
  use: {
    ...harness.use,
    // The app's reduced-motion setting (src/styles/vibe64-m3.css, and src/main.js
    // for Vuetify's menus and dialogs) ends transitions at once, so no step waits
    // out a menu, dialog, expand or route animation, measures an element still
    // moving into place, or taps a menu still fading in. Playwright reads this
    // only from contextOptions, not from use itself.
    contextOptions: { reducedMotion: "reduce" }
  }
});
