import type { BrowserContext, Page } from "@playwright/test";

// Snoozes AI onboarding ("Set up later") for the local actor far into the
// future, so specs that are not about onboarding see the editor instead.
async function suppressAiOnboarding(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    try {
      window.localStorage.setItem("vibe64.aiOnboarding.snoozedUntil:local", String(Number.MAX_SAFE_INTEGER));
    } catch {
      // Storage can be unavailable on opaque origins; nothing to suppress there.
    }
  });
}

export { suppressAiOnboarding };
