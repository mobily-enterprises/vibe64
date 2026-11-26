import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CLIENT_BUILD_META_NAME } from "@jskit-ai/kernel/shared/support/clientBuild";

// The client build's id, JSKIT's digest of the built page, decides whether an open editor says "Vibe64 was updated",
// so it follows the source alone. The copies below build with their packages linked from outside each copy, as a
// composition links them, which is where a build's directory could reach its output.
const run = promisify(execFile);
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const NOT_BUILT_FROM = new Set(["node_modules", "dist", ".git", "tests"]);
const BUILD_ID = new RegExp(`<meta name="${CLIENT_BUILD_META_NAME}" content="([0-9a-f]+)"`, "u");

/**
 * A copy of the editor's source at `appRoot`, its node_modules a link to the source's own.
 * @param {string} appRoot
 */
async function copyApp(appRoot) {
  await cp(sourceRoot, appRoot, {
    recursive: true,
    filter: (source) => !NOT_BUILT_FROM.has(path.relative(sourceRoot, source))
  });
  await symlink(path.join(sourceRoot, "node_modules"), path.join(appRoot, "node_modules"));
}

/**
 * Builds the client at `appRoot` and returns the id its page names.
 * @param {string} appRoot
 */
async function buildId(appRoot) {
  const vite = path.join(sourceRoot, "node_modules", "vite", "bin", "vite.js");
  await run(process.execPath, [vite, "build", "--logLevel", "error"], {
    cwd: appRoot,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 240_000
  });
  const id = BUILD_ID.exec(await readFile(path.join(appRoot, "dist", "index.html"), "utf8"))?.[1];
  assert.ok(id, `the page built at ${appRoot} names its client build`);
  return id;
}

test("the same source builds to one client build id in any directory, and a one-line change to another", { timeout: 300_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-client-build-id-"));
  try {
    const near = path.join(root, "near");
    const far = path.join(root, "a", "b", "c", "far");
    const changed = path.join(root, "changed");
    await Promise.all([copyApp(near), copyApp(far), copyApp(changed)]);
    const entry = path.join(changed, "src", "main.js");
    await writeFile(entry, `${await readFile(entry, "utf8")}\nglobalThis.vibe64ClientBuildProbe = true;\n`);

    const [nearId, farId, changedId] = await Promise.all([buildId(near), buildId(far), buildId(changed)]);

    assert.equal(farId, nearId);
    assert.notEqual(changedId, nearId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
