import { expect, test } from "@playwright/test";
import { DEFAULT_VIEWPORTS, runAdaptiveShellSmokeCase } from "@jskit-ai/shell-web/test/adaptiveShellSmoke";

test.describe("adaptive shell smoke", () => {
  for (const viewport of DEFAULT_VIEWPORTS) {
    test(`${viewport.name} layout has reachable navigation and no horizontal overflow`, async ({ page }) => {
      await runAdaptiveShellSmokeCase({ page, expect, viewport });
    });
  }
});
