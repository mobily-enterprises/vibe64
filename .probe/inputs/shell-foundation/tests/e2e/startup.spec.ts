import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1280]) {
  test(`startup remains visible before JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseScripts!: () => void;
    const scriptsHeld = new Promise<void>(resolve => { releaseScripts = resolve; });
    let scriptRequests = 0;
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") {
        scriptRequests += 1;
        await scriptsHeld;
      }
      await route.continue();
    });
    try {
      await page.goto("/home", { waitUntil: "commit" });
      await expect(page.getByRole("status")).toHaveText("Loading application…");
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.getByRole("link", { name: "Reload page" })).toBeVisible();
      await expect.poll(() => scriptRequests).toBeGreaterThan(0);
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        reloadHeight: document.querySelector("#startup-shell a")!.getBoundingClientRect().height
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.reloadHeight).toBeGreaterThanOrEqual(48);
    } finally {
      releaseScripts();
    }
    await expect(page.locator("#app[data-v-app]")).toBeVisible();
    await expect(page.locator("#startup-shell")).toHaveCount(0);
  });
}

test("built assets are kept for good and the page itself is revalidated", async ({ page }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "A managed target's server and proxy set its own caching.");
  const assets: string[] = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname.startsWith("/assets/")) assets.push(response.headers()["cache-control"] ?? "");
  });
  const document = await page.goto("/home");
  await page.waitForLoadState("load");
  expect(document?.headers()["cache-control"] ?? "").not.toContain("immutable");
  expect(assets.length).toBeGreaterThan(0);
  expect(new Set(assets)).toEqual(new Set(["public, max-age=31536000, immutable"]));
});
