import assert from "node:assert/strict";
import fs, { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerSpaNotFoundHandler } from "../../server/lib/spaFallback.js";

function pageRoute(distRoot) {
  let handler;
  registerSpaNotFoundHandler({ setNotFoundHandler: (value) => { handler = value; } }, { distRoot, hasWebBuild: true });
  return async (url) => {
    const reply = { header: () => reply, type: () => reply, code: () => reply, send: (body) => body };
    return handler({ url, method: "GET" }, reply);
  };
}

test("page routes serve the built index from memory until a build replaces it", async (t) => {
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-spa-"));
  const index = path.join(distRoot, "index.html");
  await writeFile(index, "<p>first build</p>");
  const realRead = fs.readFile;
  let reads = 0;
  const read = t.mock.method(fs, "readFile", async (file, ...rest) => {
    if (file === index) reads += 1;
    return realRead(file, ...rest);
  });
  syncBuiltinESMExports();
  try {
    const page = pageRoute(distRoot);
    assert.equal(await page("/projects"), "<p>first build</p>");
    assert.equal(await page("/projects/example/sessions"), "<p>first build</p>");
    assert.equal(await page("/account"), "<p>first build</p>");
    assert.equal(reads, 1, "an unchanged index is read once");
    await writeFile(`${index}.next`, "<p>second build</p>");
    await rename(`${index}.next`, index);
    assert.equal(await page("/projects"), "<p>second build</p>");
    assert.equal(reads, 2);
  } finally {
    read.mock.restore();
    syncBuiltinESMExports();
    await rm(distRoot, { recursive: true, force: true });
  }
});
