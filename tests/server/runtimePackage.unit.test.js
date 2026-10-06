import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRuntimePackage, RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";
import { ASSISTANT_SQL_RUNTIME_ENTRIES, buildNodeBundle } from "../../tooling/release/server-build.mjs";
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

test("bundled assistant file runtime preserves lazy optional SQL imports after relocation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-assistant-sql-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "source");
  await mkdir(appRoot);
  await symlink(path.join(sourceRoot, "node_modules"), path.join(appRoot, "node_modules"));
  const entryPoint = path.join(appRoot, "entry.mjs");
  await writeFile(entryPoint, `
    import assert from "node:assert/strict";
    import { AssistantFeature } from "@jskit-ai/assistant-runtime/server";
    import { createConversationRuntime, createFileConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
    import { createActionProvider } from "@jskit-ai/kernel/server/actions";
    import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
    const conversations = createConversationRuntime({
      storage: createFileConversationStorage({ directory: ${JSON.stringify(path.join(root, "conversations"))} }),
      authorize: ({ context }) => context.actor?.id === "42",
      connections: { resolve() { throw new Error("Reading must not invoke inference."); } }
    });
    const conversation = await conversations.open({ id: "chat", context: { actor: { id: "42" } },
      configuration: { integrationId: "selected", systemPrompt: "Answer briefly." } });
    const valueProvider = (capability, value) => defineProvider({ id: capability,
      provides: { value: capability }, setup: () => ({ value }) });
    const routes = [];
    let assistant, actions;
    const host = createCapabilityRuntime({ providers: [createActionProvider(),
      valueProvider("runtime.config", {
        surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
        assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
      }),
      valueProvider("runtime.env", {}),
      valueProvider("runtime.http", { router: { register(...route) { routes.push(route); } } }),
      valueProvider("runtime.database", { get knex() { throw new Error("File storage must not touch the host database."); } }),
      valueProvider("assistant.conversations", conversations),
      AssistantFeature,
      defineProvider({ id: "observer", requires: { assistant: "assistant.runtime", actions: "runtime.actions" },
        setup(values) { ({ assistant, actions } = values); return {}; } })
    ] });
    try {
      await host.start();
      assert.equal(assistant.conversationRuntime, conversations);
      assert.equal(assistant.services.config, null);
      assert.equal(assistant.services.chat, undefined);
      assert.equal((await conversation.read()).id, "chat");
      assert.ok(actions.listDefinitions().some(entry => entry.id === "assistant.conversation.read"));
      assert.ok(routes.some(([method, path]) => method === "GET" && path.endsWith("/:conversationId")));
      console.log("relocated file-backed assistant ready without SQL");
    } finally {
      await host.shutdown();
      await conversations.close();
    }
  `);
  const outfile = path.join(root, "relocated/entry.mjs");
  const result = await buildNodeBundle({ appRoot, entryPoint, outfile, plugins: [{
    name: "reject-assistant-database-resolution",
    setup(build) {
      build.onResolve({ filter: /^(?:@jskit-ai\/database-runtime|knex)(?:\/|$)/ }, args => ({
        errors: [{ text: `Unexpected database resolution: ${args.path}` }]
      }));
    }
  }] });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  const sqlImports = imports.filter(entry => entry.path.includes("/repositories/"));
  assert.deepEqual(sqlImports.map(entry => entry.path).sort(), ASSISTANT_SQL_RUNTIME_ENTRIES.map(entry => `./${entry}`).sort());
  assert.ok(sqlImports.every(entry => entry.external && entry.kind === "dynamic-import"));
  assert.ok(!Object.keys(result.metafile.inputs).some(entry =>
    /\/repositories\/(?:assistantConfigRepository|conversationsRepository|messagesRepository|repositoryPersistenceUtils)\.js$/u.test(entry)));
  const child = await execute(process.execPath, ["--input-type=module", "--eval", `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (/^(?:@jskit-ai\\/database-runtime|knex)(?:\\/|$)/.test(specifier)) {
        throw new Error("Unexpected database import: " + specifier);
      }
      return nextResolve(specifier, context);
    } });
    await import(${JSON.stringify(pathToFileURL(outfile).href)});
  `], { cwd: path.dirname(outfile), timeout: 10000 });
  assert.match(child.stdout, /relocated file-backed assistant ready without SQL/u);
});

test("runtime release relocates, runs native and browser services, and packs without the development graph", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-runtime-package-test-"));
  try {
    const appRoot = path.join(root, "source");
    await mkdir(appRoot);
    for (const entry of ["app.json", "package.json", "server.js", "server", "bin", "config", "docs/colleague-usage"]) {
      await cp(path.join(sourceRoot, entry), path.join(appRoot, entry), { recursive: true });
    }
    await symlink(path.join(sourceRoot, "node_modules"), path.join(appRoot, "node_modules"));
    const installedAssistantDatabase = await readFile(path.join(appRoot, "node_modules/@jskit-ai/database-runtime/package.json"), "utf8")
      .catch(error => { if (error.code === "ENOENT") return null; throw error; });
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
    await assert.rejects(execute(process.execPath, [path.join(installed, "bin/run.js"), "training"]),
      error => error.code === 1 && /Usage: vibe64 training validate/u.test(error.stderr));
    await execute(process.execPath, [path.join(installed, "bin/sqlite-proof.js"), path.join(root, "proof.sqlite")]);
    await assert.rejects(execute(process.execPath, [
      path.join(installed, "node_modules/@local/vibe64-execution/src/host/execHelper.js")
    ]), error => error.code === 2 && /Usage: vibe64-exec-helper execute/u.test(error.stderr));
    const codexRuntime = path.join(root, "codex-runtime");
    await mkdir(codexRuntime);
    const descriptor = path.join(codexRuntime, "history-adapter.json");
    const codexFixture = path.join(root, "codex-fixture.mjs");
    await writeFile(codexFixture, `#!${process.execPath}
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      if (process.argv[2] === 'debug') {
        console.log(JSON.stringify({ models: [{ slug: 'fixture-native' }] }));
      } else {
        const { baseUrl } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
        assert.equal((await fetch(baseUrl + '/not-an-upstream')).status, 404);
        const override = process.argv.find(arg => arg.startsWith('model_catalog_json='));
        const catalogPath = JSON.parse(override.slice('model_catalog_json='.length));
        const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
        assert.ok(catalog.models.some(model => model.slug === 'fixture-native'));
        for (const slug of ['deepseek-flash', 'deepseek-v4-pro', 'glm-5.3']) {
          assert.equal(catalog.models.find(model => model.slug === slug).apply_patch_tool_type, 'freeform');
        }
        console.log('packaged Codex child, model catalogue and history adapter ready');
      }
    `);
    await chmod(codexFixture, 0o700);
    const codexProcess = await execute(process.execPath, [
      path.join(installed, "node_modules/@local/vibe64-runtime/src/server/codexAppServerProcess.js"),
      codexRuntime, codexFixture, descriptor
    ], {
      cwd: installed,
      env: { ...process.env, VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: randomUUID() },
      timeout: 10000
    });
    assert.match(codexProcess.stdout, /packaged Codex child, model catalogue and history adapter ready/u);
    await assert.rejects(readFile(descriptor), { code: "ENOENT" });
    const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
    for (const entry of ASSISTANT_SQL_RUNTIME_ENTRIES) {
      assert.ok(RUNTIME_ENTRIES.includes(entry));
      assert.ok((await readFile(path.join(installed, entry), "utf8")).length > 0);
    }
    if (installedAssistantDatabase === null) {
      assert.equal(manifest.dependencies["@jskit-ai/database-runtime"], undefined);
      assert.ok(!manifest.bundleDependencies.includes("@jskit-ai/database-runtime"));
      await assert.rejects(readFile(path.join(installed, "node_modules/@jskit-ai/database-runtime/package.json")), { code: "ENOENT" });
    }
    assert.ok(manifest.dependencies["node-pty"]);
    assert.ok(manifest.dependencies["genesis-compiler"]);
    for (const driver of ["mysql2", "pg"]) {
      assert.ok(manifest.dependencies[driver], `${driver} must be installed for Knex's dynamic loading`);
      assert.ok(!manifest.bundleDependencies.includes(driver));
    }
    assert.ok(!manifest.bundleDependencies.includes("node-pty"));
    for (const dependency of ["three", "elkjs", "@mdi/js", "vite", "typescript", "openai", "stripe"]) {
      assert.ok(!manifest.dependencies[dependency] || manifest.bundleDependencies.includes(dependency),
        `${dependency} must not be installed as a complete package`);
    }
    const packed = await execute("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], {
      cwd: installed, maxBuffer: 8 * 1024 * 1024
    });
    const [report] = JSON.parse(packed.stdout);
    assert.ok(report.unpackedSize < 40 * 1024 * 1024, `Unexpected runtime package growth: ${report.unpackedSize}`);
    const paths = report.files.map(file => file.path);
    assert.ok(!paths.some(file => file.startsWith("node_modules/openai/") && /\.(?:[cm]?js|[cm]?ts|map)$/u.test(file)),
      "bundled OpenAI metadata must not bring a separate SDK implementation into the release");
    assert.ok(paths.includes("server.bundle.mjs"));
    assert.ok(paths.includes("docs/colleague-usage/plans.md"));
    assert.equal(await readFile(path.join(installed, "docs/colleague-usage/plans.md"), "utf8"),
      await readFile(path.join(sourceRoot, "docs/colleague-usage/plans.md"), "utf8"));
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
