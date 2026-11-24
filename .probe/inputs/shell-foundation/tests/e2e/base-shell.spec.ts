import { expect, test } from "@playwright/test";

const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "compact", width: 390, height: 844 }),
  Object.freeze({ name: "medium", width: 768, height: 1024 }),
  Object.freeze({ name: "expanded", width: 1280, height: 900 })
]);

test.describe("application responsive smoke", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} home route renders without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/home");
      await expect(page.getByText("Service health")).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    });
  }
});
