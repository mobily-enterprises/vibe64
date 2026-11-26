import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { createRuntimePackage, RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";
import { buildNodeBundle, SERVER_BUNDLE_EXTERNALS } from "../../tooling/release/server-build.mjs";
import { verifyRuntime } from "../../tooling/release/verify-runtime.mjs";
import { endChildInput } from "./childInputTestHelpers.js";

const execute = promisify(execFile);
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

test("bundled Genesis ownership hook defers the compiler until instructions are requested", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-context-hook-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outfile = path.join(root, "resolver.mjs");
  await buildNodeBundle({
    appRoot: sourceRoot,
    entryPoint: path.join(sourceRoot, "packages/vibe64-genesis/bin/vibe64-genesis-host-context"),
    outfile,
    external: [...SERVER_BUNDLE_EXTERNALS, "@local/vibe64-genesis/server"]
  });
  const registryPath = path.join(root, "sessions.json");
  await writeFile(registryPath, JSON.stringify({ sessions: ["main", "temporary"].map(kind => ({
    upstreamSessionId: kind, workdir: root,
    promptContext: { scope: "session", conversationKind: kind, session: {
      managedDatabaseRefresh: true, managedEnvironment: true, managedGit: true, managedPreview: true
    } }
  })) }));
  const run = (request, instructions = false) => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["--input-type=module", "--eval", `
      import { registerHooks } from "node:module";
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === "@local/vibe64-genesis/server" && ${instructions}) {
          return { url: "data:text/javascript," + encodeURIComponent(
            'export const vibe64ConversationInstructions = async request => "instructions:" + JSON.stringify(request);'
          ), shortCircuit: true };
        }
        if (specifier === "@local/vibe64-genesis/server" || specifier.startsWith("genesis-compiler")) {
          throw new Error("Ownership checks must not load the compiler: " + specifier);
        }
        return nextResolve(specifier, context);
      } });
      process.argv[2] = ${JSON.stringify(instructions ? "--instructions" : "")};
      await import(${JSON.stringify(pathToFileURL(outfile).href)});
    `], { cwd: root, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    endChildInput(child, JSON.stringify(request));
  });
  const request = { scope: "session", providerSessionId: "main", data: { registryPath } };
  for (const providerSessionId of ["main", "temporary"]) {
    assert.deepEqual(JSON.parse(await run({ ...request, providerSessionId })), { kind: "delivery", text: "" });
  }
  assert.deepEqual(JSON.parse(await run({ ...request, providerSessionId: "child", parentSessionIds: ["main"] })),
    { kind: "delivery", text: "" });
  assert.deepEqual(JSON.parse(await run({ ...request, providerSessionId: "unmanaged" })), { kind: "unclaimed" });
  assert.deepEqual(JSON.parse(await run({ ...request, scope: "turn" })), { kind: "unclaimed" });
  await writeFile(registryPath, JSON.stringify({ sessions: [{
    upstreamSessionId: "main", workdir: path.join(root, "another-project"),
    promptContext: { scope: "session" }
  }] }));
  await assert.rejects(run(request), /different project directory/u);
  await writeFile(registryPath, "invalid JSON");
  await assert.rejects(run(request), /JSON/u);
  const input = { projectRoot: root, scope: "session", providerSessionId: "main" };
  assert.equal(await run(input, true), `instructions:${JSON.stringify(input)}`);
});

// Folders of a package whose code never runs in the editor server or its helpers.
const NOT_SERVER = new Set(["client", "docs", "examples", "node_modules", "test", "tests", "__tests__"]);
// A module that computes paths from its own location: import.meta.url, dirname or resolve(), or require.resolve().
const LOCATES_FILES = /import\.meta\.(?:url|dirname|filename|resolve)|require\.resolve\(/u;
// Static imports and exports, side-effect imports and literal dynamic imports, which a bundle includes.
const BUNDLED_IMPORTS = [
  /\b(?:import|export)\b[^;"'`]*?\bfrom\s*(["'])[^"'\n]+\1/gu,
  /^\s*import\s*(["'])[^"'\n]+\1/gmu,
  /\bimport\s*\(\s*(["'])[^"'\n]+\1\s*\)/gu
];
// A path in a string: relative ("./x.js", "../bin/x"), a file name (path.join(directory, "build.mjs")), or a package
// specifier (import.meta.resolve("@local/x/server/y")).
const PATH_LITERAL = /(["'`])((?:\.\.?\/)[^"'`\s]+|[\w.-]+\.[cm]?js|@local\/[\w./-]+)\1/gu;

/** Every file below `directory` outside NOT_SERVER folders, as absolute paths. */
async function serverFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_SERVER.has(entry.name)) files.push(...await serverFiles(filename));
    } else if (entry.isFile()) {
      files.push(filename);
    }
  }
  return files;
}

/** Whether a file is a JavaScript program: a .js, .mjs or .cjs module, or a script whose first line runs Node. */
async function isScript(filename) {
  if (/\.[cm]?js$/u.test(filename)) return readFile(filename).then(() => true, () => false);
  if (path.extname(filename)) return false;
  const text = await readFile(filename, "utf8").catch(() => "");
  return /^#!.*\bnode\b/u.test(text.split("\n", 1)[0]);
}

/** The file a package export names, for a string or a conditional export. */
function exportTarget(target) {
  if (typeof target === "string") return target;
  return target && exportTarget(target.node ?? target.import ?? target.default);
}

/**
 * Each JavaScript program a server module of public's source names by a path it computes at run time (from its own
 * URL, or by resolving a workspace package's export), at its path in a release: node_modules/<package name>/<path in
 * the package> for a workspace package, its own path for the app's bin and server.
 */
async function locatedScripts(root) {
  const scanned = [];
  const packages = new Map();
  for (const name of await readdir(path.join(root, "packages"))) {
    const packageRoot = path.join(root, "packages", name);
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8").catch(() => "null"));
    if (!manifest?.name) continue;
    packages.set(manifest.name, { exports: manifest.exports || {}, root: packageRoot });
    scanned.push({ files: await serverFiles(packageRoot), from: packageRoot, to: `node_modules/${manifest.name}` });
  }
  scanned.push({ files: [...await serverFiles(path.join(root, "bin")), ...await serverFiles(path.join(root, "server")),
    path.join(root, "server.js")], from: root, to: "" });
  const releasePath = (target) => {
    for (const { from, to } of scanned) {
      const relative = path.relative(from, target);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) return path.posix.join(to, relative.split(path.sep).join("/"));
    }
    return null;
  };
  const located = new Set();
  for (const { files } of scanned) {
    for (const filename of files) {
      if (!await isScript(filename)) continue;
      let source = await readFile(filename, "utf8");
      if (!LOCATES_FILES.test(source)) continue;
      for (const pattern of BUNDLED_IMPORTS) source = source.replace(pattern, "");
      for (const [, , literal] of source.matchAll(PATH_LITERAL)) {
        let target = null;
        if (literal.startsWith("@local/")) {
          const name = literal.split("/").slice(0, 2).join("/");
          const workspace = packages.get(name);
          const file = workspace && exportTarget(workspace.exports[`.${literal.slice(name.length)}`]);
          if (file) target = path.join(workspace.root, file);
        } else {
          target = path.resolve(path.dirname(filename), literal);
        }
        if (target && await isScript(target)) {
          const entry = releasePath(target);
          if (entry) located.add(entry);
        }
      }
    }
  }
  return [...located].sort();
}

// A bundle keeps each module's own URL, so a server module that forks, spawns or loads a program by a path it computes
// (new URL("./x.js", import.meta.url), path.join(its directory, "x.mjs"), import.meta.resolve or require.resolve of a
// workspace export) finds it at that path in a release too. A release copies a package's data files beside their
// modules, but its JavaScript only as a runtime entry: commandSpawner.js's commandSpawnerProcess.js was not one
// (68705fca2, 26 Nov), so the released editor could start no command at all.
test("every program a server module locates at run time ships as a runtime entry", async () => {
  const located = await locatedScripts(sourceRoot);
  for (const known of [
    "node_modules/@local/vibe64-execution/src/server/engines/commandSpawnerProcess.js",
    "node_modules/@local/vibe64-genesis/bin/vibe64-genesis-host-context",
    "node_modules/@local/vibe64-accounts/bin/claude-auth-browser",
    "node_modules/@local/vibe64-database-tools/src/server/sqliteWorker.js",
    "node_modules/@local/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js",
    "node_modules/@local/vibe64-usage-recording/runtime/php/build.mjs"
  ]) assert.ok(located.includes(known), `the scan finds ${known}`);
  assert.deepEqual(located.filter((entry) => !RUNTIME_ENTRIES.includes(entry)), []);
});

test("every Genesis server export ships as a runtime entry", async () => {
  const { exports } = JSON.parse(await readFile(path.join(sourceRoot, "packages/vibe64-genesis/package.json"), "utf8"));
  const server = Object.entries(exports).filter(([subpath]) => subpath === "./server" || subpath.startsWith("./server/"));
  assert.ok(server.length >= 3);
  for (const [, target] of server) {
    assert.ok(RUNTIME_ENTRIES.includes(`node_modules/@local/vibe64-genesis/${target.slice(2)}`), target);
  }
});

test("the usage recorder's Node preload ships bundled and leaves an unrecorded process untouched", async (t) => {
  const entry = "node_modules/@local/vibe64-usage-recording/runtime/node/preload.mjs";
  assert.ok(RUNTIME_ENTRIES.includes(entry));
  assert.ok(RUNTIME_ENTRIES.includes("node_modules/@local/vibe64-usage-recording/runtime/php/build.mjs"));
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-preload-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outfile = path.join(root, "preload.mjs");
  await buildNodeBundle({ appRoot: sourceRoot, entryPoint: path.join(sourceRoot, entry), outfile });
  const stdout = await new Promise((resolve, reject) => {
    execFile(process.execPath, [`--import=${outfile}`, "-e", "console.log('ran')"], (error, output) => {
      if (error) reject(error);
      else resolve(output);
    });
  });
  assert.equal(stdout, "ran\n");
});

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
    endChildInput(child, JSON.stringify({ operation, sourceRoot: path.join(root, "source"), directory: path.join(root, "index"), query: "needle", limit: 10 }));
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

test("bundled file-backed assistant runtime relocates without resolving or loading SQL", async (t) => {
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
    import { ActionProvider } from "@jskit-ai/kernel/server/actions";
    import { EventProvider } from "@jskit-ai/kernel/server/runtime";
    import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
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
    const host = createCapabilityRuntime({ inputs: { "runtime.logger": silentLogger }, providers: [EventProvider, ActionProvider,
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
  await buildNodeBundle({ appRoot, entryPoint, outfile, plugins: [{
    name: "reject-assistant-database-resolution",
    setup(build) {
      build.onResolve({ filter: /^(?:@jskit-ai\/database-runtime|knex)(?:\/|$)/ }, args => ({
        errors: [{ text: `Unexpected database resolution: ${args.path}` }]
      }));
    }
  }] });
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
    for (const entry of ["app.json", "package.json", "server.js", "server", "bin", "config", "docs/colleague-usage", "docs/training-content.md", "docs/templates/learn-topic"]) {
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
    // The editor server sends every finite command to its command spawner (server.js starts it at boot).
    await writeFile(path.join(appRoot, "bin/spawner-proof.js"), `
      import assert from "node:assert/strict";
      import { execFileCommand, startCommandSpawner } from "@local/vibe64-execution/server/commandSpawner";
      startCommandSpawner();
      const { stdout } = await execFileCommand(process.execPath, ["-e", "process.stdout.write(String(process.ppid))"], {
        env: { PATH: process.env.PATH || "" }
      });
      assert.notEqual(Number(stdout), process.pid, "the command ran in the spawner's child, not in this process's");
      console.log("a command ran through the packaged spawner");
    `);
    await assert.rejects(createRuntimePackage({ appRoot, releaseAppRoot: appRoot }), /must not contain/u);
    const staged = path.join(root, "staged");
    await createRuntimePackage({ appRoot, releaseAppRoot: staged, extraEntries: ["bin/sqlite-proof.js", "bin/spawner-proof.js"] });
    await assert.rejects(createRuntimePackage({ appRoot, releaseAppRoot: staged }), /must be empty/u);
    assert.equal(await readFile(source, "utf8"), before);
    const installed = path.join(root, "relocated");
    await rename(staged, installed);
    await verifyRuntime(installed);
    await assert.rejects(execute(process.execPath, [path.join(installed, "bin/run.js"), "training"]),
      error => error.code === 1 && /Usage: vibe64 training validate/u.test(error.stderr));
    assert.equal(await readFile(path.join(installed, "docs/training-content.md"), "utf8"),
      await readFile(path.join(appRoot, "docs/training-content.md"), "utf8"));
    const authorTemplate = path.join(installed, "docs/templates/learn-topic");
    const templateValidation = await execute(process.execPath, [path.join(installed, "bin/run.js"), "training", "validate", authorTemplate]);
    assert.equal(JSON.parse(templateValidation.stdout).lessons[0].status, "draft");
    await execute(process.execPath, [path.join(installed, "bin/sqlite-proof.js"), path.join(root, "proof.sqlite")]);
    const spawned = await execute(process.execPath, [path.join(installed, "bin/spawner-proof.js")], { cwd: installed, timeout: 30_000 });
    assert.match(spawned.stdout, /a command ran through the packaged spawner/u);
    // Hosts load the public host profile by its package export before any entry point.
    const hostProfile = await import(pathToFileURL(createRequire(path.join(installed, "bin/upgrade-state.js"))
      .resolve("@local/vibe64-execution/server/hostProfile")).href);
    assert.equal(typeof hostProfile.configureVibe64Host, "function");
    // A host's own tools load the working-turns reader by its package export from the app, outside its bundle.
    const workingTurns = await import(pathToFileURL(createRequire(path.join(installed, "package.json"))
      .resolve("@local/vibe64-runtime/server/workingTurns")).href);
    assert.deepEqual(await workingTurns.readVibe64WorkingTurns({ systemRoot: root }), []);
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
    for (const dependency of ["three", "elkjs", "vite", "typescript", "openai", "stripe"]) {
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
