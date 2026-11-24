// A one-off proof, not part of public's suite (it needs a test host's MariaDB and the npm registry). A project made as
// Vibe64 makes a new one (Genesis init, then `stack add jskit-mysql`, the database onboarding offers), built as JSKIT's
// guidance builds a first app with records (the shell foundation with the MySQL application pattern), runs its own
// browser suite in a session: `vibe64-helper playwright --target test-app npm-run test:e2e`, through public's real
// Preview controller and managed Playwright command, on the app's own browser test database, and the session's normal
// Preview comes back after. PROOF_INPUTS holds the branch's Genesis pieces (already copied into node_modules by run.sh),
// JSKIT's shell foundation and MySQL pattern, and the branch's jskit-catalog scripts. PROOF_DB_* name the MariaDB.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { addGenesisStack, initializeGenesisProject, inspectVibe64Outputs, inspectVibe64WorkspaceSetup } from "../../packages/vibe64-genesis/src/server/index.js";
import { createOutputTargetTerminalController } from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";
import { createAgentPreviewCommandService, prepareAgentPreviewCommand } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { startTerminalSession } from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/index.js";
import { runCaptureCommand, stopCaptureExecution } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import { runDetachedCommand, stopDetachedExecution } from "../../packages/vibe64-execution/src/server/engines/detached.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import { currentProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const browsersPath = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
const INPUTS = process.env.PROOF_INPUTS;
const MARIADB = process.env.PROOF_MARIADB_SQL;
const stamp = randomUUID().replaceAll("-", "").slice(0, 6);
const DB = {
  DB_CLIENT: "mysql2", DB_HOST: "127.0.0.1", DB_PORT: "3307", DB_USER: `fp${stamp}`, DB_PASSWORD: `pw${stamp}`,
  DB_NAME: `fp${stamp}_dev`, BROWSER_TEST_DB_NAME: `fp${stamp}_browser_test`, TEST_DB_NAME: `fp${stamp}_test`
};
const log = (...parts) => console.log(`[proof ${new Date().toISOString().slice(11, 19)}]`, ...parts);
const sql = async (statement) => (await execFileAsync(MARIADB, ["sql", "-N", "-B", "-e", statement], { maxBuffer: 4 << 20 })).stdout.trim();
const run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.once("error", reject);
  child.once("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${output.slice(-3000)}`))));
});

/** The new project, as Vibe64 and then the session's AI make it: Genesis, the jskit-mysql piece, the JSKIT app. */
async function makeProject(sourceRoot) {
  await mkdir(sourceRoot, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: sourceRoot });
  await initializeGenesisProject({ projectRoot: sourceRoot });
  const added = await addGenesisStack({ projectRoot: sourceRoot, pieces: ["jskit-mysql"] });
  log("stack add jskit-mysql:", JSON.stringify(added.components));
  // The shell foundation, then the MySQL application pattern's files and package entries.
  await cp(path.join(INPUTS, "shell-foundation"), sourceRoot, { recursive: true });
  await rename(path.join(sourceRoot, "gitignore"), path.join(sourceRoot, ".gitignore"));
  const pattern = path.join(INPUTS, "mysql-application");
  for (const file of ["knexfile.js", "scripts/prepare-database.js", "tests/e2e/databases.js"]) {
    await mkdir(path.dirname(path.join(sourceRoot, file)), { recursive: true });
    await cp(path.join(pattern, file), path.join(sourceRoot, file));
  }
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  const patternManifest = JSON.parse(await readFile(path.join(pattern, "package.json"), "utf8"));
  Object.assign(manifest.scripts, patternManifest.scripts);
  Object.assign(manifest.dependencies, patternManifest.dependencies);
  await writeFile(path.join(sourceRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(sourceRoot, "playwright.config.mjs"), `import { defineConfig } from "@playwright/test";
import { browserTestConfig } from "@jskit-ai/jskit-catalog/browser-tests";

// Each Playwright worker gets its own server on the production build and its own copy of BROWSER_TEST_DB_NAME; with
// PLAYWRIGHT_BASE_URL, the managed target.
export default defineConfig(browserTestConfig({ testDir: "./tests/e2e", prepare: "tests/e2e/databases.js" }));
`);
  // The app's first table, which the pattern's browser fixture seeds.
  await mkdir(path.join(sourceRoot, "migrations"));
  await writeFile(path.join(sourceRoot, "migrations", "20261124000000_create_fixtures.js"), `export async function up(knex) {
  await knex.schema.createTable("fixtures", (table) => {
    table.integer("id").unsigned().primary();
    table.string("label", 120).notNullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTable("fixtures");
}
`);
  let started = performance.now();
  await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: sourceRoot, env: { ...process.env, ...DB } });
  log(`npm install ${((performance.now() - started) / 1000).toFixed(1)} s`);
  // The branch's jskit-catalog, as its release will install it.
  await cp(path.join(INPUTS, "jskit-catalog-scripts"), path.join(sourceRoot, "node_modules/@jskit-ai/jskit-catalog/scripts"), { recursive: true, force: true });
  await stat(path.join(sourceRoot, "node_modules/.bin/jskit"));
  started = performance.now();
  log(await run("npm", ["run", "db:prepare"], { cwd: sourceRoot, env: { ...process.env, ...DB } }));
  log(`db:prepare on ${DB.DB_NAME} ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

async function session(t, sourceRoot, root) {
  const sessionId = `fresh-${stamp}`;
  const setup = await inspectVibe64WorkspaceSetup({ projectRoot: sourceRoot });
  const session = {
    sessionId, sessionRoot: path.join(root, "session"), targetRoot: sourceRoot,
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED },
    workspaceSetup: { status: "succeeded", recipeHash: setup.recipeHash }, sourceInspection: null
  };
  const runtime = {
    async getSession() { return session; },
    getSessionWithoutSource(id) { return this.getSession(id); },
    async resolvePromptEnvironment() { return {}; },
    store: {
      async mutateSession(_id, operation) { return operation(); },
      async readMetadataValue(_id, key) { return session.metadata[key]; },
      async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
      async deleteMetadataValue(_id, key) { delete session.metadata[key]; }
    }
  };
  // The session's Env: its database resource, with the browser and integration test databases its optionalBindings name.
  const project = {
    runInProjectContext: (_slug, operation) => operation(),
    async createRuntime() { return runtime; },
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
    inspectWorkspaceSetup: inspectVibe64WorkspaceSetup,
    currentTargetRoot() { return sourceRoot; },
    currentServiceDataRoot() { return root; },
    async projectExecutionEnvironment(input = {}) {
      return input.includeResourceConfiguration ? { environment: { ...DB }, resourceConfigurationFingerprint: "d".repeat(64) } : { ...DB };
    },
    async projectInspectionEnvironment(input = {}) {
      return input.includeResourceConfiguration ? { environment: { ...DB }, resourceConfigurationFingerprint: "d".repeat(64) } : { ...DB };
    },
    async readPreviewApplicationIdentities() { return { identities: [] }; },
    currentProjectSlug: () => currentProjectRequestContext()?.slug || "fresh-project",
    selectedProject: { slug: "fresh-project" }, targetRoot: sourceRoot
  };
  const captureExecutionIds = new Set();
  const detached = new Set();
  const socketRoot = await mkdtemp(path.join("/tmp", "v64-fresh-sockets-"));
  const commandEnv = {
    ...process.env,
    PLAYWRIGHT_BASE_URL: "", PLAYWRIGHT_STORAGE_STATE: "", VIBE64_PLAYWRIGHT_TARGET_RUN: "",
    TMPDIR: socketRoot, NPM_CONFIG_PREFIX: path.join(root, "tools"), VIBE64_SHARED_CACHE_ROOT: path.join(root, "cache"),
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  };
  // As Vibe64's execution gateway does, every command gets the project's Env the launch hands it (runtimeConfigEnv).
  const runCommand = async (input) => {
    const projectEnv = input.project?.runtimeConfigEnv || {};
    if (input.mode === "detached") {
      const id = `${sessionId}-browser-${detached.size}`;
      detached.add(id);
      return runDetachedCommand({ ...input, execution: { ...input.execution, id } }, {
        cwd: input.cwd, env: { ...commandEnv, ...projectEnv, ...input.env, VIBE64_EXECUTION_ID: id }
      });
    }
    if (input.mode === "pty") {
      return startTerminalSession({
        ...input.terminal, command: input.command, args: input.args, cwd: input.cwd,
        env: typeof input.env === "function" ? (identity) => ({ ...commandEnv, ...projectEnv, ...input.env(identity) }) : { ...commandEnv, ...projectEnv, ...input.env }
      });
    }
    const id = randomUUID();
    captureExecutionIds.add(id);
    try {
      return await runCaptureCommand(input.command, input.args, {
        ...input, execution: { ...input.execution, id }, env: { ...commandEnv, ...projectEnv, ...input.env, VIBE64_EXECUTION_ID: id }
      });
    } finally {
      captureExecutionIds.delete(id);
    }
  };
  const controller = createOutputTargetTerminalController({
    ensureProjectServices: async () => {}, publishSessionChanged: async () => null, sessionAdmissionFailure: () => null,
    ensureWorkspacePrepared: async () => ({ ok: true }), env: { ...process.env, TMPDIR: socketRoot }, project, runCommand,
    stopPreviewBrowsers: async () => ({ ok: true }), startWorkflow: async () => ({ ok: true, workflow: null })
  });
  const commandService = createAgentPreviewCommandService({
    logger: silentLogger, project, launchTarget: controller, runManagedCommand: runCommand,
    stopManagedExecution: stopDetachedExecution, readSessionUiState: () => null, publishSessionChanged: async () => null
  });
  // The test's own after hook closes the session before it drops the databases and removes the folders its servers use.
  const close = async () => {
    for (const id of captureExecutionIds) await stopCaptureExecution(id);
    await controller.closeAllForSession(sessionId);
    await controller.close();
    await commandService.closeAllForSession(sessionId);
    for (const id of detached) await stopDetachedExecution(id);
    await rm(socketRoot, { recursive: true, force: true });
  };
  // The session's runtime packs: Node 26 with npm, and Playwright with the host's browsers.
  const runtimeRoot = path.join(root, "runtimes");
  const nodeBin = path.join(runtimeRoot, "node26/bin");
  const playwrightRoot = path.join(runtimeRoot, "playwright");
  await mkdir(nodeBin, { recursive: true });
  await symlink(process.execPath, path.join(nodeBin, "node"));
  assert.ok(process.env.npm_execpath, "Run this proof through npm test so its npm entry point is supplied.");
  await symlink(process.env.npm_execpath, path.join(nodeBin, "npm"));
  await mkdir(path.join(playwrightRoot, "bin"), { recursive: true });
  await mkdir(path.join(playwrightRoot, "runtime/lib/node_modules"), { recursive: true });
  await symlink(path.dirname(require.resolve("playwright/package.json")), path.join(playwrightRoot, "runtime/lib/node_modules/playwright"));
  await symlink(browsersPath, path.join(playwrightRoot, "browsers"));
  await writeFile(path.join(playwrightRoot, "runtime.env"), `playwright_version=${require("@playwright/test/package.json").version}\n`);
  await writeFile(path.join(playwrightRoot, "bin/playwright"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(playwrightRoot, "bin/playwright"), 0o755);
  configureVibe64Host({ runtimePackRoot: runtimeRoot });
  const prepared = await prepareAgentPreviewCommand({
    commandService, env: { TMPDIR: socketRoot }, project: { slug: "fresh-project" }, sessionId,
    worktreePath: sourceRoot, wrapperHostDir: path.join(root, "commands")
  });
  const playwright = (args) => new Promise((resolve) => {
    const child = spawn(prepared.hostPlaywrightWrapperPath, args, {
      cwd: sourceRoot, detached: true,
      env: { ...process.env, ...prepared.env, VIBE64_EXECUTION_ID: "proof-parent", PLAYWRIGHT_BASE_URL: "", PLAYWRIGHT_STORAGE_STATE: "", VIBE64_PLAYWRIGHT_TARGET_RUN: "" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { sessionId, controller, commandService, playwright, close };
}

async function waitForPreview(controller, sessionId, targetId, ms = 240_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const status = await controller.launchStatus(sessionId);
    if (status.preview?.state === "ready" && status.activeTerminal?.metadata?.outputTargetId === targetId) return status;
    if (status.preview?.state === "failed") throw new Error(`${targetId}: ${status.preview.message}\n${status.activeTerminal?.output || ""}`);
    if (status.activeTerminal?.status === "exited") throw new Error(`${targetId} exited:\n${status.activeTerminal?.output || ""}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${targetId} was not ready within ${ms / 1000} s`);
}

test("a new project's browser suite runs in its session on its own browser test database through its Data test target", { timeout: 1_500_000 }, async (t) => {
  assert.ok(INPUTS && MARIADB, "Run through .probe/run.sh, which names PROOF_INPUTS and PROOF_MARIADB_SQL.");
  let f = null;
  const root = await mkdtemp(path.join(process.env.VIBE64_TEST_FIXTURE_ROOT || os.tmpdir(), "vibe64-fresh-project-"));
  const sourceRoot = path.join(root, "sessions", "active", `fresh-${stamp}`, "source");
  // The session's database account: its own databases and their numbered copies, as a host's database resource gives.
  await sql(`CREATE USER '${DB.DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB.DB_PASSWORD}'; ` +
    `GRANT ALL PRIVILEGES ON \`fp${stamp}\\_%\`.* TO '${DB.DB_USER}'@'127.0.0.1'; CREATE DATABASE \`${DB.DB_NAME}\`;`);
  t.after(async () => {
    try {
      await f?.close();
    } finally {
    const names = (await sql(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'fp${stamp}\\_%'`)).split("\n").filter(Boolean);
    log("dropping", names.join(" "));
    for (const name of names) await sql(`DROP DATABASE \`${name}\``);
    await sql(`DROP USER '${DB.DB_USER}'@'127.0.0.1'`);
    await rm(root, { recursive: true, force: true });
    }
  });

  let started = performance.now();
  await makeProject(sourceRoot);
  log(`project made in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  const stackSource = await readFile(path.join(sourceRoot, "genesis/stack.md"), "utf8");
  log("genesis/stack.md Outputs:\n" + stackSource.match(/^## Outputs\n[\s\S]*?(?=^## )/mu)?.[0]);
  const outputs = await inspectVibe64Outputs({ projectRoot: sourceRoot, environment: { ...process.env, ...DB } });
  assert.equal(outputs.status, "ready", JSON.stringify(outputs));
  const testTarget = outputs.targets.find(({ id }) => id === "test-app");
  assert.equal(testTarget?.dataMode, "test", JSON.stringify(outputs.targets));
  assert.match(stackSource, /"browserTestDatabase": "BROWSER_TEST_DB_NAME"/u);

  f = await session(t, sourceRoot, root);
  // The person's normal Preview first, on the development database.
  started = performance.now();
  const normal = await f.controller.startTerminal(f.sessionId, { outputTargetId: "app" });
  assert.notEqual(normal?.ok, false, JSON.stringify(normal));
  await waitForPreview(f.controller, f.sessionId, "app");
  log(`normal Preview ready in ${((performance.now() - started) / 1000).toFixed(1)} s`);

  // What the target's terminal said while the suite ran.
  const seen = { targets: new Set(), testOutput: "" };
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      const status = await f.controller.launchStatus(f.sessionId).catch(() => null);
      const id = status?.activeTerminal?.metadata?.outputTargetId;
      if (id) seen.targets.add(id);
      if (id === "test-app" && status.activeTerminal.output) seen.testOutput = status.activeTerminal.output;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  })();
  started = performance.now();
  const suite = await f.playwright(["--target", "test-app", "npm-run", "test:e2e"]);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  watching = false;
  await watcher;
  log(`vibe64-helper playwright --target test-app npm-run test:e2e: exit ${suite.code}${suite.signal ? ` ${suite.signal}` : ""} in ${seconds} s`);
  log("suite stdout (tail):\n" + suite.stdout.slice(-4000));
  log("suite stderr (tail):\n" + suite.stderr.slice(-3000));
  log("test-app terminal (tail):\n" + seen.testOutput.slice(-3000));
  assert.equal(suite.code, 0);
  const passed = Number(suite.stdout.match(/(\d+) passed/u)?.[1] || 0);
  assert.ok(passed > 0, "the suite ran tests");
  assert.doesNotMatch(suite.stdout, /\d+ (failed|flaky)/u);
  assert.ok(seen.targets.has("test-app"), [...seen.targets].join(","));

  // The suite's server ran on the browser test database, prepared and seeded; the development database kept no fixture.
  const workerFiles = (await execFileAsync("sh", ["-c", "cat node_modules/.cache/jskit-browser-tests/workers-*.json"], { cwd: sourceRoot })).stdout;
  log("target server environment from its prepare module:", workerFiles);
  assert.deepEqual(JSON.parse(workerFiles), [{ DB_NAME: DB.BROWSER_TEST_DB_NAME }]);
  assert.equal(await sql(`SELECT label FROM \`${DB.BROWSER_TEST_DB_NAME}\`.fixtures`), "Browser fixture");
  assert.equal(await sql(`SELECT COUNT(*) FROM \`${DB.DB_NAME}\`.fixtures`), "0");
  log("databases:", (await sql(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'fp${stamp}\\_%'`)).replaceAll("\n", " "));

  // The person's normal Preview is back.
  const restored = await waitForPreview(f.controller, f.sessionId, "app", 120_000);
  assert.equal(restored.lastOutputTarget.id, "app");
  log(`proof passed: ${passed} browser tests on ${DB.BROWSER_TEST_DB_NAME}; normal Preview restored`);
});
