import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import Fastify from "fastify";
import { registerSpaNotFoundHandler, registerWebBuildFiles } from "../../server/lib/spaFallback.js";
import { precompressBuild } from "../../tooling/release/precompress-assets.mjs";

// An update as a browser meets it, in Chromium against the editor's own file serving (webBuildFiles.unit.test.js
// has the headers): a plain reload, never a hard one, runs the new build, while the hashed files a tab already has
// are never asked for again, even when the new page and an unhashed file have the old ones' sizes and every file is
// dated 1970 as the Nix store dates a release; and a tab still running the old build that loads one of its pages
// after the update gets the import failure JSKIT's shell offers a reload for (@jskit-ai/kernel's
// isDynamicImportError).

const PADDING = `// ${"padding so the build compresses this file ".repeat(40)}\n`;
// The time the Nix store gives every file of a release.
const NIX_STORE_TIME = new Date(1000);

/**
 * Replaces the build in `distRoot` with build `name` (one letter), as an update does: its page, its entry, which shows
 * the build and loads its page module on demand, that module, and an unhashed icon, every file of a build the size
 * of another's; none of the build before stays, and every file is dated as the Nix store dates it.
 * @param {string} distRoot
 * @param {string} name
 */
async function writeBuild(distRoot, name) {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(path.join(distRoot, "assets"), { recursive: true });
  const hash = name.repeat(8);
  const files = {
    // The page names no favicon, so the browser asks for none.
    "index.html": `<!doctype html><html><head><title>Build ${name}</title><link rel="icon" href="data:,">` +
      `<script type="module" src="/assets/index-${hash}.js"></script></head><body><main></main></body></html>`,
    "icon.svg": `<svg xmlns="http://www.w3.org/2000/svg"><title>${name}</title></svg>`,
    [`assets/index-${hash}.js`]: `${PADDING}document.querySelector("main").dataset.build = "${name}";\n` +
      `window.openPage = () => import("/assets/page-${hash}.js").then((page) => page.build, (error) => \`failed: \${error.message}\`);\n`,
    [`assets/page-${hash}.js`]: `${PADDING}export const build = "${name}";\n`
  };
  for (const [file, body] of Object.entries(files)) await writeFile(path.join(distRoot, file), body);
  await precompressBuild(distRoot);
  for (const folder of [distRoot, path.join(distRoot, "assets")]) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isFile()) await utimes(path.join(folder, entry.name), NIX_STORE_TIME, NIX_STORE_TIME);
    }
  }
}

/** The editor's file serving on `distRoot`, in Chromium, with each answer it sent. */
async function servedBuild(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-web-reload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, "dist");
  await writeBuild(distRoot, "A");
  const app = Fastify();
  t.after(() => app.close());
  /** @type {Array<{ url: string, status: number, encoding: string }>} */
  const served = [];
  app.addHook("onResponse", async (request, reply) => {
    served.push({ url: request.url, status: reply.statusCode, encoding: String(reply.getHeader("content-encoding") || "") });
  });
  await registerWebBuildFiles(app, distRoot);
  registerSpaNotFoundHandler(app, { distRoot, hasWebBuild: true });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  return { base, context, distRoot, served };
}

const shows = (tab, name) => tab.waitForSelector(`main[data-build="${name}"]`, { state: "attached", timeout: 10_000 });

test("a plain reload after an update runs the new build, and a stale tab's missing page fails as JSKIT expects", async (t) => {
  const { base, context, distRoot, served } = await servedBuild(t);
  const page = await context.newPage();
  const stale = await context.newPage();

  await page.goto(`${base}/projects`);
  await shows(page, "A");
  await stale.goto(`${base}/projects/example`);
  await shows(stale, "A");
  const entry = served.find((file) => file.url === "/assets/index-AAAAAAAA.js");
  assert.ok(["br", "gzip"].includes(entry?.encoding), `the entry arrives compressed: ${JSON.stringify(entry)}`);

  served.length = 0;
  await page.reload();
  await shows(page, "A");
  assert.deepEqual(served.map((file) => file.url), ["/projects"], "a reload asks for the page again, not for the files it names");

  await writeBuild(distRoot, "B");
  served.length = 0;
  await page.reload();
  await shows(page, "B");
  assert.equal(await page.title(), "Build B");
  assert.deepEqual(served.map((file) => `${file.url} ${file.status}`), ["/projects 200", "/assets/index-BBBBBBBB.js 200"]);
  await page.goto(`${base}/projects/other`);
  await shows(page, "B");

  served.length = 0;
  const opened = await stale.evaluate(() => window.openPage());
  assert.match(opened, /^failed: Failed to fetch dynamically imported module/u);
  assert.deepEqual(served.map((file) => `${file.url} ${file.status}`), ["/assets/page-AAAAAAAA.js 404"]);
  await stale.reload();
  await shows(stale, "B");
  assert.equal(await stale.evaluate(() => window.openPage()), "B");
});

test("an update whose page and unhashed files keep their sizes and the Nix store's 1970 date is seen by a plain reload", async (t) => {
  const { base, context, distRoot } = await servedBuild(t);
  const page = await context.newPage();
  const icon = () => page.evaluate(async () => (await fetch("/icon.svg")).text());

  await page.goto(`${base}/index.html`);
  await shows(page, "A");
  assert.match(await icon(), /<title>A<\/title>/u);
  assert.match(await icon(), /<title>A<\/title>/u);

  await writeBuild(distRoot, "C");
  await page.reload();
  await shows(page, "C");
  assert.equal(await page.title(), "Build C");
  assert.match(await icon(), /<title>C<\/title>/u);
  await page.goto(`${base}/projects`);
  await shows(page, "C");
});
