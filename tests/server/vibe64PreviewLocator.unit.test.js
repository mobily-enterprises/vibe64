import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readPreviewLocatorSource } from "../../packages/vibe64-terminals/src/server/previewLocator.js";

// The locator the Preview bridge inlines: read only as Architecture inspection
// declares it, parsed but never run, and "" whenever it cannot be used.
const LOCATOR = "globalThis.__vibe64LocateElement = (element) => element ? { file: \"src/App.vue\" } : null;\n";

async function sessionProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-locator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "sessions", "active", "session-1", "source");
  await mkdir(path.join(sourceRoot, "node_modules", "@acme", "locator", "src"), { recursive: true });
  const write = async (relative, text) => {
    await mkdir(path.dirname(path.join(sourceRoot, relative)), { recursive: true });
    await writeFile(path.join(sourceRoot, relative), text);
  };
  return {
    root,
    sourceRoot,
    write,
    session: {
      sessionId: "session-1",
      sourcePath: sourceRoot,
      metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source" }
    }
  };
}

function declaring(previewLocator, calls = []) {
  return async (options) => {
    calls.push(options);
    return { inspectors: [{ id: "routes" }, { id: "vue", previewLocator }] };
  };
}

test("the first declared locator is read from the session source, node_modules included", async (t) => {
  const project = await sessionProject(t);
  const locatorPath = "node_modules/@acme/locator/src/previewLocator.js";
  await project.write(locatorPath, LOCATOR);
  const calls = [];
  assert.equal(await readPreviewLocatorSource(project.session, { inspect: declaring(locatorPath, calls) }), LOCATOR);
  assert.deepEqual(calls, [{ projectRoot: project.sourceRoot }]);

  await project.write(locatorPath, `${LOCATOR}// changed\n`);
  assert.equal(await readPreviewLocatorSource(project.session, { inspect: declaring(locatorPath) }), `${LOCATOR}// changed\n`,
    "a changed file is read again");
});

test("a linked package folder is followed as node resolution follows it", async (t) => {
  const project = await sessionProject(t);
  const linked = path.join(project.root, "connected", "inspector");
  await mkdir(path.join(linked, "src"), { recursive: true });
  await writeFile(path.join(linked, "src", "previewLocator.js"), LOCATOR);
  await symlink(linked, path.join(project.sourceRoot, "node_modules", "@acme", "inspector"));
  assert.equal(await readPreviewLocatorSource(project.session, {
    inspect: declaring("node_modules/@acme/inspector/src/previewLocator.js")
  }), LOCATOR);
});

test("no source, no declaration or a failing inspection gives no locator", async (t) => {
  const project = await sessionProject(t);
  await project.write("locator.js", LOCATOR);
  assert.equal(await readPreviewLocatorSource({ sessionId: "session-1", sourcePath: project.sourceRoot }, {
    inspect: declaring("locator.js")
  }), "", "a source path the session does not own is not read");
  assert.equal(await readPreviewLocatorSource(null), "");
  assert.equal(await readPreviewLocatorSource(project.session, {
    inspect: async () => ({ inspectors: [{ id: "vue" }] })
  }), "");
  assert.equal(await readPreviewLocatorSource(project.session, {
    inspect: async () => { throw new Error("Stack needs attention."); }
  }), "");
});

test("path escape, symlinks, size, extension and unparsable scripts are refused", async (t) => {
  const project = await sessionProject(t);
  const outside = path.join(project.root, "outside.js");
  await writeFile(outside, LOCATOR);
  await project.write("locator.js", LOCATOR);
  await symlink(outside, path.join(project.sourceRoot, "linked.js"));
  await symlink(project.root, path.join(project.sourceRoot, "escape"));
  await project.write("largest.js", `${LOCATOR}//${"x".repeat(64 * 1024 - LOCATOR.length - 3)}\n`);
  await project.write("too-large.js", `${LOCATOR}//${"x".repeat(64 * 1024)}\n`);
  await project.write("locator.mjs", LOCATOR);
  await project.write("locator.ts", LOCATOR);
  await mkdir(path.join(project.sourceRoot, "folder.js"));
  await project.write("module.js", "export default function locate() { return null; }\n");
  await project.write("broken.js", "globalThis.__vibe64LocateElement = (element => {\n");

  const read = (locatorPath) => readPreviewLocatorSource(project.session, { inspect: declaring(locatorPath) });
  assert.equal(await read("locator.js"), LOCATOR);
  assert.equal((await read("largest.js")).length, 64 * 1024, "64 KiB is allowed");
  for (const refused of [
    "../outside.js",
    "/etc/locator.js",
    "escape/outside.js",
    "linked.js",
    "too-large.js",
    "locator.mjs",
    "locator.ts",
    "folder.js",
    "missing.js",
    "module.js",
    "broken.js"
  ]) {
    assert.equal(await read(refused), "", `${refused} is refused`);
  }
});
