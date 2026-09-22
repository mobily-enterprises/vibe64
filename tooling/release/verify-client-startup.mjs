import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

// Test the built document, not a development server or a replacement test shell.
async function verifyClientStartup(distRoot) {
  const root = path.resolve(distRoot);
  const html = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(html, /<script[^>]+src="[^"]+\.js"/u, "Expected a built JavaScript entry");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 768, 1280]) {
      for (const failure of ["entry", "dependency"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
        let releaseScripts;
        const scriptsHeld = new Promise(resolve => { releaseScripts = resolve; });
        try {
          const page = await context.newPage();
          let scriptRequests = 0;
          await page.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (route.request().resourceType() === "script") {
              if (failure === "dependency" && url.pathname !== "/startup-dependency.js") {
                return route.fulfill({ contentType: "text/javascript", body: 'import "/startup-dependency.js";' });
              }
              scriptRequests += 1;
              await scriptsHeld;
              await route.abort();
              return;
            }
            if (url.origin !== "http://startup.test") return route.abort();
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(`${root}${path.sep}`)) return route.abort();
            if (url.pathname === "/index.html") return route.fulfill({ contentType: "text/html", body: html });
            await route.fulfill({ path: file });
          });
          await page.goto("http://startup.test/index.html", { waitUntil: "commit" });
          await expect(page.getByRole("status")).toHaveText("Loading Vibe64…");
          await expect(page.getByRole("status")).toBeVisible();
          await expect(page.getByRole("link", { name: "Reload page" })).toBeVisible();
          await expect.poll(() => scriptRequests).toBeGreaterThan(0);
          const geometry = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            reloadHeight: document.querySelector("#startup-shell a").getBoundingClientRect().height
          }));
          assert.ok(geometry.scrollWidth <= geometry.width + 1, "Startup shell overflows horizontally");
          assert.ok(geometry.reloadHeight >= 48, "Reload must have a 48px touch target");
          releaseScripts();
          await expect(page.getByRole("status")).toHaveText("Vibe64 could not open. Reload the page to try again.");
          await expect(page.getByRole("link", { name: "Reload page" })).toBeVisible();
        } finally {
          releaseScripts();
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log("Cold startup proof passed: loading shell and failed entry/dependency recovery at 390, 768 and 1280px.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Provide the built frontend directory.");
  await verifyClientStartup(process.argv[2]);
}

export { verifyClientStartup };
