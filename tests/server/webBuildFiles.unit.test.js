import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import Fastify from "fastify";
import { registerSpaNotFoundHandler, registerWebBuildFiles } from "../../server/lib/spaFallback.js";
import { precompressBuild } from "../../tooling/release/precompress-assets.mjs";
import viteConfig from "../../vite.config.mjs";

// The built client as the editor sends it: the build compresses the files under assets/ once, beside them, and the
// server sends the compressed copy a browser accepts, keeps those files for good, since each is named by its content,
// and fetches the page and every other file again on each use, so a plain reload after an update runs the new build
// (webBuildReload.browser.test.js).

const IMMUTABLE = "public, max-age=31536000, immutable";
const SCRIPT = Buffer.from(Array.from({ length: 400 }, (_, i) => `export const value${i} = "built file ${i}";\n`).join(""));
const STYLE = Buffer.from(".card { color: red; }\n".repeat(200));
const FILES = {
  "index.html": '<!doctype html><script type="module" src="/assets/index-AbCd_-12.js"></script>',
  "favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg">${"<g></g>".repeat(300)}</svg>`,
  "assets/index-AbCd_-12.js": SCRIPT,
  "assets/chunks/vendor-EeFf1234.js": SCRIPT,
  "assets/index-Zz9-xYwQ.css": STYLE,
  "assets/roboto-AAAAAAAA.woff2": randomBytes(4096),
  // Bytes no compression shrinks.
  "assets/random-CCCCCCCC.js": randomBytes(4096),
  "assets/tiny-BBBBBBBB.js": "export const tiny = 1;\n"
};

async function builtClient(t) {
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-web-build-"));
  t.after(() => rm(distRoot, { recursive: true, force: true }));
  await mkdir(path.join(distRoot, "assets/chunks"), { recursive: true });
  for (const [name, body] of Object.entries(FILES)) await writeFile(path.join(distRoot, name), body);
  // As package.json's build runs it, after `vite build`.
  await precompressBuild(distRoot);
  const app = Fastify();
  t.after(() => app.close());
  await registerWebBuildFiles(app, distRoot);
  registerSpaNotFoundHandler(app, { distRoot, hasWebBuild: true });
  await app.ready();
  return { app, distRoot };
}

test("Vite writes under assets/ only files named by their content, which the server keeps for good", () => {
  // Vite's defaults name every file it writes [name]-[hash] under build.assetsDir ("assets"), and copies public/
  // beside index.html; a name without the hash would stay in browsers after an update changed it.
  const { build = {}, publicDir = "public" } = viteConfig;
  assert.ok([undefined, "assets"].includes(build.assetsDir), `build.assetsDir is ${build.assetsDir}`);
  assert.equal(existsSync(path.join(import.meta.dirname, "../..", publicDir, "assets")), false, `${publicDir}/assets would be copied unhashed`);
  for (const output of [build.rolldownOptions?.output, build.rollupOptions?.output].flat()) {
    for (const option of ["entryFileNames", "chunkFileNames", "assetFileNames"]) {
      const names = output?.[option];
      assert.ok(names === undefined || (typeof names === "string" && names.includes("[hash]")), `build output ${option} must name each file by its [hash]`);
    }
  }
});

test("the build compresses the files under assets/ that shrink, and nothing else", async (t) => {
  const { distRoot } = await builtClient(t);
  assert.deepEqual((await readdir(path.join(distRoot, "assets"), { recursive: true })).sort(), [
    "chunks", "chunks/vendor-EeFf1234.js", "chunks/vendor-EeFf1234.js.br", "chunks/vendor-EeFf1234.js.gz",
    "index-AbCd_-12.js", "index-AbCd_-12.js.br", "index-AbCd_-12.js.gz",
    "index-Zz9-xYwQ.css", "index-Zz9-xYwQ.css.br", "index-Zz9-xYwQ.css.gz",
    "random-CCCCCCCC.js",
    "roboto-AAAAAAAA.woff2",
    "tiny-BBBBBBBB.js"
  ]);
  assert.deepEqual((await readdir(distRoot)).sort(), ["assets", "favicon.svg", "index.html"]);
});

test("a file under assets/ is sent as the compressed copy the browser accepts, varies by it, and is kept for good", async (t) => {
  const { app } = await builtClient(t);
  const cases = [
    { acceptEncoding: "gzip, deflate, br, zstd", encoding: "br", decode: brotliDecompressSync },
    { acceptEncoding: "br", encoding: "br", decode: brotliDecompressSync },
    { acceptEncoding: "gzip", encoding: "gzip", decode: gunzipSync },
    { acceptEncoding: "br;q=0, gzip", encoding: "gzip", decode: gunzipSync },
    { acceptEncoding: "identity", encoding: undefined, decode: (body) => body },
    { acceptEncoding: undefined, encoding: undefined, decode: (body) => body }
  ];
  for (const [url, original, type] of [
    ["/assets/index-AbCd_-12.js", SCRIPT, /^(?:text|application)\/javascript; charset=utf-8$/u],
    ["/assets/chunks/vendor-EeFf1234.js", SCRIPT, /^(?:text|application)\/javascript; charset=utf-8$/u],
    ["/assets/index-Zz9-xYwQ.css", STYLE, /^text\/css; charset=utf-8$/u]
  ]) {
    for (const { acceptEncoding, encoding, decode } of cases) {
      const label = `${url} with Accept-Encoding ${acceptEncoding}`;
      const response = await app.inject({ url, headers: acceptEncoding === undefined ? {} : { "accept-encoding": acceptEncoding } });
      assert.equal(response.statusCode, 200, label);
      assert.equal(response.headers["content-encoding"], encoding, label);
      assert.match(response.headers.vary || "", /accept-encoding/iu, label);
      assert.equal(response.headers["cache-control"], IMMUTABLE, label);
      assert.match(response.headers["content-type"], type, label);
      assert.deepEqual(decode(response.rawPayload), original, label);
      if (encoding) assert.ok(response.rawPayload.length < original.length / 4, `${label}: ${response.rawPayload.length} bytes`);
    }
  }
  for (const url of ["/assets/tiny-BBBBBBBB.js", "/assets/random-CCCCCCCC.js", "/assets/roboto-AAAAAAAA.woff2"]) {
    const response = await app.inject({ url, headers: { "accept-encoding": "gzip, deflate, br, zstd" } });
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers["content-encoding"], undefined, `${url} has no compressed copy`);
    assert.equal(response.headers["cache-control"], IMMUTABLE, url);
  }
});

test("the page and every file outside assets/ are fetched again on each use; a missing file is not kept", async (t) => {
  const { app } = await builtClient(t);
  for (const url of ["/", "/projects", "/projects/example/sessions"]) {
    const response = await app.inject({ url, headers: { "accept-encoding": "gzip, deflate, br, zstd" } });
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers["cache-control"], "no-store", url);
    assert.equal(response.headers["content-encoding"], undefined, url);
    assert.equal(response.body, FILES["index.html"], url);
  }
  for (const url of ["/index.html", "/favicon.svg"]) {
    const response = await app.inject({ url, headers: { "accept-encoding": "gzip, deflate, br, zstd" } });
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers["cache-control"], "no-cache", url);
    assert.equal(response.headers["content-encoding"], undefined, url);
    // No validator: the Nix store dates every file 1970, so one from its size and date would match a changed file of
    // the same size, and a revalidation would keep the old one.
    assert.equal(response.headers.etag, undefined, url);
    assert.equal(response.headers["last-modified"], undefined, url);
  }
  const missing = await app.inject({ url: "/assets/page-DDDDDDDD.js", headers: { "accept-encoding": "br" } });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers["cache-control"], undefined);
});
