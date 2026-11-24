// A one-off proof, not part of public's suite: Mercbot Online's branch (PROOF_ONLINE_TREE, with public/ installed)
// runs its own browser suite in a session through its Stack's test-app target, `vibe64-helper playwright --target
// test-app npm-run test:e2e`, through public Vibe64's real Preview controller and managed Playwright command, on its own
// browser test database (PostgreSQL on the test host), signed in as the suite's own owner. It records what passed and
// what failed; it does not require a clean run, since Online's managed path has never run before.
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
const ONLINE = process.env.PROOF_ONLINE_TREE;
const PSQL = process.env.PROOF_PG_SQL;
const stamp = randomUUID().replaceAll("-", "").slice(0, 6);
const DB = {
  DB_CLIENT: "pg", DB_HOST: path.join(os.homedir(), "v64-remote/postgres/run"), DB_PORT: "5442", DB_USER: os.userInfo().username,
  DB_PASSWORD: "", DB_NAME: `mo${stamp}_dev`, TEST_DB_NAME: `mo${stamp}_test`, BROWSER_TEST_DB_NAME: `mo${stamp}_browser_test`
};
const log = (...parts) => console.log(`[proof ${new Date().toISOString().slice(11, 19)}]`, ...parts);
const sql = async (database, statement) => (await execFileAsync(PSQL, ["sql", "-d", database, "-At", "-c", statement], { maxBuffer: 4 << 20 })).stdout.trim();

async function session(t, sourceRoot, root, identities) {
  const sessionId = `online-${stamp}`;
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
    async readPreviewApplicationIdentities() { return { identities }; },
    currentProjectSlug: () => currentProjectRequestContext()?.slug || "mercbot-online",
    selectedProject: { slug: "mercbot-online" }, targetRoot: sourceRoot
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
    commandService, env: { TMPDIR: socketRoot }, project: { slug: "mercbot-online" }, sessionId,
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

test("Mercbot Online's browser suite runs in its session on its own browser test database through its test-app target", { timeout: 2_400_000 }, async (t) => {
  assert.ok(ONLINE && PSQL, "Run through .probe/run-online.sh, which names PROOF_ONLINE_TREE and PROOF_PG_SQL.");
  let f = null;
  let sessionsRoot = "";
  const root = await mkdtemp(path.join(process.env.VIBE64_TEST_FIXTURE_ROOT || os.tmpdir(), "vibe64-online-target-"));
  for (const name of [DB.DB_NAME, DB.TEST_DB_NAME, DB.BROWSER_TEST_DB_NAME]) await sql("postgres", `CREATE DATABASE ${name}`);
  t.after(async () => {
    try {
      await f?.close();
    } finally {
    for (const name of [DB.DB_NAME, DB.TEST_DB_NAME, DB.BROWSER_TEST_DB_NAME]) await sql("postgres", `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await rm(root, { recursive: true, force: true });
    if (sessionsRoot) await rm(sessionsRoot, { recursive: true, force: true });
    }
  });
  const outputs = await inspectVibe64Outputs({ projectRoot: ONLINE, environment: { ...process.env, ...DB } });
  assert.equal(outputs.status, "ready", JSON.stringify(outputs.diagnostics));
  assert.equal(outputs.targets.find(({ id }) => id === "test-app")?.dataMode, "test");
  const identities = JSON.parse(await readFile(path.join(ONLINE, "tests/e2e/preview-identities.json"), "utf8")).identities;
  // The session's source, where Vibe64 keeps one (<data>/sessions/active/<session>/source, which a launch context requires
  // of a managed session's source path): a clone of the branch at its commit, with its installed node_modules and
  // public/ linked in (same filesystem, so cp -al), and nothing else of the mirrored tree.
  sessionsRoot = await mkdtemp(path.join(path.dirname(ONLINE), ".online-proof-session-"));
  const sourceRoot = path.join(sessionsRoot, "sessions", "active", `online-${stamp}`, "source");
  await mkdir(path.dirname(sourceRoot), { recursive: true });
  const head = (await execFileAsync("git", ["-C", ONLINE, "rev-parse", "HEAD"])).stdout.trim();
  await execFileAsync("git", ["clone", "-q", "--no-checkout", ONLINE, sourceRoot]);
  await execFileAsync("git", ["-C", sourceRoot, "checkout", "-q", "--detach", head]);
  for (const name of ["node_modules", "public"]) await execFileAsync("cp", ["-al", path.join(ONLINE, name), path.join(sourceRoot, name)]);
  log("session source:", sourceRoot, "at", head);
  f = await session(t, sourceRoot, root, identities);
  // What the session sees before the run: Workspace setup, the Outputs with the session's Env alone, and each target.
  const setupSeen = await inspectVibe64WorkspaceSetup({ projectRoot: sourceRoot });
  log("workspace setup:", setupSeen.status, JSON.stringify(setupSeen.diagnostics || []).slice(0, 2000));
  const sessionOutputs = await inspectVibe64Outputs({ projectRoot: sourceRoot, environment: { ...DB } });
  log("outputs with the session's Env:", sessionOutputs.status, JSON.stringify(sessionOutputs.diagnostics || []).slice(0, 2000));
  const before = await f.controller.launchStatus(f.sessionId).catch((error) => ({ error: String(error?.stack || error) }));
  log("launch status targets:", JSON.stringify((before.outputTargets || before.targets || []).map((target) => ({
    id: target.id, available: target.available, disabledReason: target.disabledReason, kind: target.presentation?.kind
  }))), before.error || "", JSON.stringify(Object.keys(before)));
  const seen = { targets: new Set(), testOutput: "" };
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      const status = await f.controller.launchStatus(f.sessionId).catch(() => null);
      const id = status?.activeTerminal?.metadata?.outputTargetId;
      if (id) seen.targets.add(id);
      if (id === "test-app" && status.activeTerminal.output) seen.testOutput = status.activeTerminal.output;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();
  const started = performance.now();
  const suite = await f.playwright(["--target", "test-app", "npm-run", "test:e2e"]);
  watching = false;
  await watcher;
  log(`vibe64-helper playwright --target test-app npm-run test:e2e: exit ${suite.code}${suite.signal ? ` ${suite.signal}` : ""} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  // The whole report and what each failed test left, kept beside the proof's log.
  await writeFile(path.resolve(".probe/online-suite.log"), suite.stdout + "\n=== stderr\n" + suite.stderr);
  await rm(path.resolve(".probe/online-test-results"), { recursive: true, force: true });
  await cp(path.join(sourceRoot, "test-results"), path.resolve(".probe/online-test-results"), { recursive: true }).catch(() => {});
  log("suite stdout (tail):\n" + suite.stdout.slice(-12000));
  log("suite stderr (tail):\n" + suite.stderr.slice(-4000));
  log("test-app terminal (tail):\n" + seen.testOutput.slice(-4000));
  log("targets seen:", [...seen.targets].join(","));
  for (const name of [DB.DB_NAME, DB.TEST_DB_NAME, DB.BROWSER_TEST_DB_NAME]) {
    log(`${name}: ${await sql(name, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")} tables`);
  }
  assert.ok(seen.targets.has("test-app"), "the test-app target ran");
});
