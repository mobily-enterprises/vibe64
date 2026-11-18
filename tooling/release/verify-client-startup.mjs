import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

// The loading screen paints before any stylesheet arrives, and the editor's code runs only once every one has: a
// stylesheet the parser met holds the page's module scripts, wherever it stands.
async function verifyStylesheetsHoldOnlyTheEditor(browser, root, html) {
  const entry = html.match(/<script\b[^>]*\bsrc="([^"]+)"/u)[1];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  let releaseStylesheets;
  const stylesheetsHeld = new Promise(resolve => { releaseStylesheets = resolve; });
  try {
    // The editor's first request reports whether every stylesheet had applied by then.
    await context.addInitScript(() => {
      const { fetch } = window;
      window.fetch = (...request) => {
        window.stylesheetsAtFirstRequest ??= [...document.querySelectorAll('link[rel="stylesheet"]')].every((link) => link.sheet);
        return fetch(...request);
      };
    });
    const page = await context.newPage();
    const editorRequests = [];
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://startup.test") return route.abort();
      if (url.pathname === "/index.html") return route.fulfill({ contentType: "text/html", body: html });
      // What the editor's code asks for once it runs: its lazy modules and the API, which this proof has not.
      if (url.pathname !== entry && ["script", "fetch", "xhr"].includes(route.request().resourceType())) editorRequests.push(url.pathname);
      if (url.pathname.startsWith("/api/")) return route.abort();
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(`${root}${path.sep}`)) return route.abort();
      if (url.pathname.endsWith(".css")) await stylesheetsHeld;
      await route.fulfill({ path: file });
    });
    const entryLoaded = page.waitForEvent("requestfinished", { predicate: request => new URL(request.url()).pathname === entry });
    await page.goto("http://startup.test/index.html", { waitUntil: "commit" });
    await entryLoaded;
    await expect(page.getByRole("status")).toHaveText("Loading Vibe64…");
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("first-contentful-paint").length)).toBe(1);
    // A second with the entry downloaded: an editor that ran without its stylesheets would ask for its lazy modules.
    await page.waitForTimeout(1_000);
    assert.deepEqual(editorRequests, [], "The editor ran before its stylesheets applied");
    releaseStylesheets();
    await expect.poll(() => page.evaluate(() => window.stylesheetsAtFirstRequest)).toBe(true);
    assert.ok(editorRequests.length > 0, "The editor ran once its stylesheets applied");
  } finally {
    releaseStylesheets();
    await context.close();
  }
}

// Test the built document, not a development server or a replacement test shell.
async function verifyClientStartup(distRoot) {
  const root = path.resolve(distRoot);
  const html = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(html, /<script[^>]+src="[^"]+\.js"/u, "Expected a built JavaScript entry");
  // vite.config.mjs: the entry's file holds every module it imports statically, and the stylesheets follow the
  // loading screen.
  assert.equal(html.match(/<script\b[^>]*\bsrc=/gu).length, 1, "Expected one script, the entry, with its static imports in it");
  assert.doesNotMatch(html, /rel="modulepreload"/u, "Expected no module preloads: the entry's static imports come in its own file");
  const bodyEnd = html.indexOf("</body>");
  const appEnd = html.lastIndexOf("</div>", bodyEnd);
  const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/gu)];
  assert.ok(stylesheets.length > 0, "Expected the editor's stylesheets");
  assert.ok(stylesheets.every(({ index }) => index > appEnd && index < bodyEnd), "Expected the stylesheets after the loading screen");
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyStylesheetsHoldOnlyTheEditor(browser, root, html);
    for (const width of [390, 768, 1280]) {
      for (const failure of ["entry", "dependency"]) {
        // The phone width also stands for a device that asks for reduced motion.
        const reducedMotion = width === 390 ? "reduce" : "no-preference";
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion });
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
          await page.clock.install();
          await page.goto("http://startup.test/index.html", { waitUntil: "commit" });
          const status = page.getByRole("status");
          const reload = page.getByRole("link", { name: "Reload the page" });
          await expect(status).toHaveText("Loading Vibe64…");
          await expect(status).toBeVisible();
          await expect(page.getByText("Vibe64", { exact: true })).toBeVisible();
          await expect(reload).toBeHidden();
          await expect.poll(() => scriptRequests).toBeGreaterThan(0);
          // With every stylesheet applied, the app's own reduced-motion rule among them, the bar still shows that
          // the editor is loading: it slides, or pulses in place for reduced motion.
          await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')]
            .every((link) => link.sheet))).toBe(true);
          const motion = await page.locator("#startup-shell .startup-progress span").evaluate((bar) => bar.getAnimations()
            .map((animation) => ({ name: animation.animationName, iterations: animation.effect.getTiming().iterations })));
          assert.deepEqual(motion, [{ name: reducedMotion === "reduce" ? "startup-pulse" : "startup-slide", iterations: Infinity }]);
          if (failure === "entry") {
            // A slow start offers the reload after ten seconds, not before.
            await page.clock.fastForward(9_000);
            await expect(reload).toBeHidden();
            await page.clock.fastForward(1_000);
            await expect(page.getByText("Taking longer than usual?")).toBeVisible();
            await expect(reload).toBeVisible();
          }
          const geometry = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            reloadHeight: document.querySelector("#startup-shell a").getBoundingClientRect().height
          }));
          assert.ok(geometry.scrollWidth <= geometry.width + 1, "Startup shell overflows horizontally");
          assert.ok(geometry.reloadHeight >= 48, "Reload must have a 48px touch target");
          releaseScripts();
          await expect(status).toHaveText("Vibe64 could not open. Reload the page to try again.");
          // A failure offers the reload at once and stops the loading bar.
          await expect(reload).toBeVisible();
          await expect(page.locator("#startup-shell .startup-progress")).toBeHidden();
        } finally {
          releaseScripts();
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log("Cold startup proof passed: one entry file, the loading screen painted before its stylesheets and the editor run after them, reload after ten seconds and failed entry/dependency recovery at 390, 768 and 1280px.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Provide the built frontend directory.");
  await verifyClientStartup(process.argv[2]);
}

export { verifyClientStartup };
