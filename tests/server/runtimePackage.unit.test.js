import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRuntimePackage, RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";
import { buildNodeBundle } from "../../tooling/release/server-build.mjs";
import { verifyRuntime } from "../../tooling/release/verify-runtime.mjs";

const execute = promisify(execFile);
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

test("bundled source search helper builds and searches a persistent index", async (t) => {
  const entry = "node_modules/@local/vibe64-source-editor/src/server/searchIndexWorker.js";
  assert.ok(RUNTIME_ENTRIES.includes(entry));
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-search-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outfile = path.join(root, "worker.mjs");
  await buildNodeBundle({ appRoot: sourceRoot, entryPoint: path.join(sourceRoot, entry), outfile });
  await mkdir(path.join(root, "source"));
  await writeFile(path.join(root, "source/test.txt"), "bundled needle\n");
  const run = (operation) => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [outfile], (error, stdout) => {
      if (error) reject(error);
      else resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify({ operation, sourceRoot: path.join(root, "source"), directory: path.join(root, "index"), query: "needle", limit: 10 }));
  });
  assert.equal((await run("refresh")).state, "ready");
  assert.deepEqual((await run("search")).results, [{ path: "test.txt", line: 1, column: 9, preview: "bundled needle" }]);
});

test("bundles relocate module URLs without rewriting generated worker source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-module-url-test-"));
  try {
    await symlink(path.join(sourceRoot, "node_modules"), path.join(root, "node_modules"));
    await mkdir(path.join(root, "source/nested"), { recursive: true });
    await writeFile(path.join(root, "source/nested/module.js"), `export const location = import.meta.url; export const worker = 'const location = import.meta.url;';`);
    const entryPoint = path.join(root, "source/entry.mjs");
    await writeFile(entryPoint, `export * from './nested/module.js';`);
    const outfile = path.join(root, "built/entry.mjs");
    await buildNodeBundle({ appRoot: root, entryPoint, outfile });
    const module = await import(pathToFileURL(outfile).href);
    assert.equal(module.location, pathToFileURL(path.join(root, "built/nested/module.js")).href);
    assert.equal(module.worker, 'const location = import.meta.url;');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime release relocates, runs native and browser services, and packs without the development graph", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-runtime-package-test-"));
  try {
    const appRoot = path.join(root, "source");
    await mkdir(appRoot);
    for (const entry of ["app.json", "package.json", "server.js", "server", "bin", "config"]) {
      await cp(path.join(sourceRoot, entry), path.join(appRoot, entry), { recursive: true });
    }
    await symlink(path.join(sourceRoot, "node_modules"), path.join(appRoot, "node_modules"));
    await mkdir(path.join(appRoot, "dist/assets"), { recursive: true });
    await writeFile(path.join(appRoot, "dist/index.html"), '<!doctype html><script type="module" src="/assets/proof.js"></script>');
    await writeFile(path.join(appRoot, "dist/assets/proof.js"), 'export const ready = true;');
    const source = path.join(appRoot, "node_modules/node-pty/package.json");
    const before = await readFile(source, "utf8");
    await writeFile(path.join(appRoot, "bin/sqlite-proof.js"), `
      import assert from "node:assert/strict";
      import { DatabaseSync } from "node:sqlite";
      import { withSessionKnex } from "@local/vibe64-database-tools/server/connection";
      const filename = process.argv[2];
      const db = new DatabaseSync(filename);
      db.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY); INSERT INTO proof VALUES (42)");
      db.close();
      await withSessionKnex({ kind: "sqlite", database: filename, readOnly: true }, async ({ knex }) => {
        assert.equal((await knex.raw("SELECT id FROM proof")).rows[0].id, 42n);
        await assert.rejects(knex.raw("DELETE FROM proof"));
      });
    `);
    await assert.rejects(createRuntimePackage({ appRoot, releaseAppRoot: appRoot }), /must not contain/u);
    const staged = path.join(root, "staged");
    await createRuntimePackage({ appRoot, releaseAppRoot: staged, extraEntries: ["bin/sqlite-proof.js"] });
    await assert.rejects(createRuntimePackage({ appRoot, releaseAppRoot: staged }), /must be empty/u);
    assert.equal(await readFile(source, "utf8"), before);
    const installed = path.join(root, "relocated");
    await rename(staged, installed);
    await verifyRuntime(installed);
    await execute(process.execPath, [path.join(installed, "bin/sqlite-proof.js"), path.join(root, "proof.sqlite")]);
    await assert.rejects(execute(process.execPath, [
      path.join(installed, "node_modules/@local/vibe64-execution/src/host/execHelper.js")
    ]), error => error.code === 2 && /Usage: vibe64-exec-helper execute/u.test(error.stderr));
    const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
    assert.ok(manifest.dependencies["node-pty"]);
    assert.ok(manifest.dependencies["genesis-compiler"]);
    for (const driver of ["mysql2", "pg"]) {
      assert.ok(manifest.dependencies[driver], `${driver} must be installed for Knex's dynamic loading`);
      assert.ok(!manifest.bundleDependencies.includes(driver));
    }
    assert.ok(!manifest.bundleDependencies.includes("node-pty"));
    for (const dependency of ["three", "elkjs", "@mdi/js", "vite", "typescript", "openai", "stripe"]) {
      assert.ok(!manifest.dependencies[dependency], `${dependency} must not be installed as a complete package`);
    }
    const packed = await execute("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], {
      cwd: installed, maxBuffer: 8 * 1024 * 1024
    });
    const [report] = JSON.parse(packed.stdout);
    assert.ok(report.unpackedSize < 40 * 1024 * 1024, `Unexpected runtime package growth: ${report.unpackedSize}`);
    const paths = report.files.map(file => file.path);
    assert.ok(paths.includes("server.bundle.mjs"));
    assert.ok(!paths.some(file => file.startsWith("packages/") || file.startsWith("server/") || /\.d\.ts$|\.map$/u.test(file)));
    assert.ok(!paths.some(file => file.startsWith("node_modules/node-pty/")));
    for (const name of manifest.bundleDependencies) {
      const metadata = JSON.parse(await readFile(path.join(installed, "node_modules", name, "package.json"), "utf8"));
      assert.equal(metadata.dependencies, undefined, `${name} must not reinstall bundled code`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
