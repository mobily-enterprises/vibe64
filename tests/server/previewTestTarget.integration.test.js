import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { initializeGenesisProject, inspectVibe64Outputs, inspectVibe64WorkspaceSetup } from "../../packages/vibe64-genesis/src/server/index.js";
import { createOutputTargetTerminalController } from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";
import { browserSuiteDatabaseEnvironment } from "../../packages/vibe64-project/src/server/browserSuiteDatabaseEnvironment.js";
import { createAgentPreviewCommandService, prepareAgentPreviewCommand } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { closeTerminalSessionsForNamespace, startTerminalSession } from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { outputTargetTerminalNamespace } from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/index.js";
import { runCaptureCommand, stopCaptureExecution } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import { runDetachedCommand, stopDetachedExecution } from "../../packages/vibe64-execution/src/server/engines/detached.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import { currentProjectRequestContext, runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import { vibe64Driver } from "../../packages/vibe64-genesis/src/server/promptContext.js";
import { portBelowEphemeralRange } from "../fixtures/portBelowEphemeralRange.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { playwrightChildEnvironment } from "./playwrightChildEnvironment.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const browsersPath = path.dirname(path.dirname(path.dirname(chromium.executablePath())));

test.after(() => configureVibe64Host(null));

test("shared assistant instructions point browser suites at the browser-tests spec", () => {
  const instructions = vibe64Driver({
    conversationKind: "main", scope: "session",
    session: { managedPreview: true, managedEnvironment: true, managedDatabaseRefresh: false, managedGit: false }
  });
  // Target discovery, safe setup, invocation and restoration are in `vibe64-helper spec browser-tests`, whose text
  // vibe64AgentSpecs.unit.test.js checks; the always-loaded guidance names it and keeps the one rule for writes.
  for (const required of [
    "vibe64-helper spec browser-tests", "declared test targets (`vibe64-helper playwright --target <id>`)",
    "Tests that write never use the person's development target"
  ]) assert.ok(instructions.includes(required), required);
});

// A test target whose Run step takes {workers}: one process serving that many app servers, server i on PORT+i with its
// own data, and an identity command whose cookie names the server it signed in on.
const parallelTarget = (previewPort) => `### Target \`parallel\`: parallel
- Mode: \`interactive\`
- Data: \`test\`
- Runtimes: \`nodejs\`
- Run \`Start\`: \`node\` \`parallel.mjs\` \`{workers}\`
#### Presentation
- Kind: \`web\`
- Preferred port: \`${previewPort}\`
- URL path: \`/\`
- Ready when: \`GET\` \`/api/health\` returns \`200\`
#### Preview identity
- Command: \`tools/parallel-identity\`
- Protocol: \`vibe64.preview-identity.command.v1\`
- Identity types: \`email\`
- Runtimes: \`nodejs\`
`;

/**
 * @param {object} [workflowHooks] the controller's options to replace (a test budget, the free memory, a workflow)
 * @param {{ extraOutputs?: (previewPort: number) => string }} [options] more targets for the Stack's Outputs
 */
async function fixture(t, name, workflowHooks = {}, { extraOutputs = () => "" } = {}) {
  // Managed Git needs a permitted checkout path; control sockets still use the
  // ordinary short OS temp directory, independently of this fixture location.
  const root = await mkdtemp(path.join(process.env.VIBE64_TEST_FIXTURE_ROOT || os.tmpdir(), `vibe64-test-target-${name}-`));
  const sessionId = `target-${name}`;
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  await mkdir(sourceRoot, { recursive: true });
  const initializeGit = execFileAsync("git", ["init", "--initial-branch=main"], { cwd: sourceRoot });
  // Managed Git reads stdin before submitting a command; this fixture has no input.
  initializeGit.child.stdin.end();
  await initializeGit;
  await initializeGenesisProject({ projectRoot: sourceRoot });
  // Its own free port, not the default 4100: test files run at the same time, and a port another file's Preview chose
  // between its check and its start is lost. Below the ephemeral range, where no outgoing connection takes it first.
  const previewPort = await portBelowEphemeralRange();
  const target = (id, mode = id) => `### Target \`${id}\`: ${id}
${id === "app" ? "- Default.\n" : ""}- Mode: \`interactive\`
- Data: \`${id === "app" ? "development" : "test"}\`
- Runtimes: \`nodejs\`
- Run \`Start\`: \`node\` \`server.mjs\` \`${mode}\` \`{parameter:label}\`
#### Parameter \`label\`: Label
- Default: \`${id} default\`
- Required.
#### Presentation
- Kind: \`web\`
- Preferred port: \`${previewPort}\`
- URL path: \`/\`
- Ready when: \`GET\` \`/api/health\` returns \`200\`
`;
  await writeFile(path.join(sourceRoot, "genesis/stack.md"), `# Stack
## Stack packages
- \`genesis-stack\`
## Components
- \`nodejs\`
## Workspace setup
- Nothing.
## Outputs
${target("app")}
${target("test-app")}
${target("authenticated-test", "test-app")}
#### Preview identity
- Command: \`tools/test-identity\`
- Protocol: \`vibe64.preview-identity.command.v1\`
- Identity types: \`email\`
- Runtimes: \`nodejs\`
${target("broken", "broken")}
${extraOutputs(previewPort)}
### Target \`terminal\`: terminal
- Mode: \`interactive\`
- Runtimes: \`nodejs\`
- Run \`Start\`: \`node\` \`server.mjs\` \`app\`
#### Presentation
- Kind: \`terminal\`
`);
  await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({
    type: "module",
    scripts: {
      e2e: "playwright test",
      "test:playwright:fixture": "node browser-check.mjs",
      unrelated: "node browser-check.mjs"
    },
    devDependencies: { "@playwright/test": "1.61.1" }
  }));
  await writeFile(path.join(sourceRoot, "working.json"), '{"count":42}\n');
  await writeFile(path.join(sourceRoot, "server.mjs"), `
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const mode = process.argv[2];
if (mode === 'broken') process.exit(17);
if (mode === 'app' && existsSync('fail-normal-start')) process.exit(18);
const file = mode === 'test-app' ? 'test.json' : 'working.json';
if (mode === 'test-app') writeFileSync(file, JSON.stringify({count: 0}));
http.createServer((req, res) => {
  const data = JSON.parse(readFileSync(file));
  if (req.url === '/parameter') { res.end(process.argv[3] || ''); return; }
  if (req.url === '/api/health') { res.end('ok'); return; }
  if (req.url === '/test-state') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({mode, count:data.count, effects:'disabled'})); return; }
  if (req.url === '/test-login') { res.end(req.headers.cookie || ''); return; }
  if (req.url === '/add') { data.count++; writeFileSync(file, JSON.stringify(data)); res.end('ok'); return; }
  res.setHeader('content-type','text/html');
  res.end('<h1>'+mode+'</h1><p>Count: '+data.count+'</p><button>Add fixture</button><script>document.querySelector("button").onclick=()=>fetch("/add").then(()=>location.reload())</script>');
}).listen(Number(process.env.PORT), process.env.HOST || '127.0.0.1');
`);
  await mkdir(path.join(sourceRoot, "tools"));
  await writeFile(path.join(sourceRoot, "tools/test-identity"), `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
const testData = JSON.parse(readFileSync('test.json', 'utf8'));
// The database this command would open itself, as an app's command does through its knexfile, when the app has a .env.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
  writeFileSync('identity-database.json', JSON.stringify({ DB_HOST: process.env.DB_HOST, DB_NAME: process.env.DB_NAME }));
}
process.stdout.write(JSON.stringify({
  protocol: request.protocol, requestId: request.requestId, ok: true,
  identity: { userId: 'test-user', email: 'test@example.test' },
  setCookie: ['test_login=test-app-' + testData.count + '; Path=/; HttpOnly; SameSite=Lax']
}));
`);
  await chmod(path.join(sourceRoot, "tools/test-identity"), 0o755);
  await writeFile(path.join(sourceRoot, "parallel.mjs"), `
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const workers = Number(process.argv[2]);
writeFileSync('parallel.pid', String(process.pid));
// Each worker's own environment, by the first server's port, as JSKIT's browser-test server writes it for its suite.
mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/workers-' + process.env.PORT + '.json', JSON.stringify(Array.from({ length: workers }, (_, worker) => ({ DB_NAME: 'parallel-' + worker + '.json' }))));
for (let worker = 0; worker < workers; worker++) {
  const file = 'parallel-' + worker + '.json';
  writeFileSync(file, JSON.stringify({ count: 0 }));
  http.createServer((req, res) => {
    if (req.url === '/api/health') { res.end('ok'); return; }
    if (req.url === '/worker') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ worker, workers, count: JSON.parse(readFileSync(file)).count })); return; }
    if (req.url === '/add') { const data = JSON.parse(readFileSync(file)); data.count++; writeFileSync(file, JSON.stringify(data)); res.end('ok'); return; }
    if (req.url === '/test-login') { res.end(req.headers.cookie || ''); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<h1>parallel ' + worker + '</h1>');
  }).listen(Number(process.env.PORT) + worker, process.env.HOST || '127.0.0.1');
}
`);
  await writeFile(path.join(sourceRoot, "tools/parallel-identity"), `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify({
  protocol: request.protocol, requestId: request.requestId, ok: true,
  identity: { userId: 'test-user', email: 'test@example.test' },
  setCookie: ['test_login=port-' + new URL(request.target.href).port + '; Path=/; HttpOnly; SameSite=Lax']
}));
`);
  await chmod(path.join(sourceRoot, "tools/parallel-identity"), 0o755);
  const setup = await inspectVibe64WorkspaceSetup({ projectRoot: sourceRoot });
  const outputs = await inspectVibe64Outputs({ projectRoot: sourceRoot });
  assert.equal(outputs.status, "ready", JSON.stringify(outputs));
  const session = {
    sessionId, sessionRoot: path.join(root, "session"), targetRoot: sourceRoot,
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED },
    workspaceSetup: { status: "succeeded", recipeHash: setup.recipeHash }, sourceInspection: null
  };
  const runtime = {
    async getSession() { return session; },
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    async resolvePromptEnvironment() { return {}; },
    store: {
      async mutateSession(_id, operation) { return operation(); },
      async readMetadataValue(_id, key) { return session.metadata[key]; },
      async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
      async deleteMetadataValue(_id, key) { delete session.metadata[key]; }
    }
  };
  const project = {
    runInProjectContext: (_slug, operation) => operation(),
    async createRuntime() { return runtime; },
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
    inspectWorkspaceSetup: inspectVibe64WorkspaceSetup,
    currentTargetRoot() { return sourceRoot; },
    currentServiceDataRoot() { return root; },
    async projectExecutionEnvironment() { return {}; },
    async projectInspectionEnvironment(input) {
      return input.includeResourceConfiguration
        ? { environment: {}, resourceConfigurationFingerprint: "d".repeat(64) }
        : {};
    },
    async readPreviewApplicationIdentities() {
      return { identities: [{ name: "tester", type: "email", value: "test@example.test" }] };
    },
    // As the project service names a session's project: the request's, else the selected one.
    currentProjectSlug: () => currentProjectRequestContext()?.slug || name,
    selectedProject: { slug: name }, targetRoot: sourceRoot
  };
  const captureExecutionIds = new Set();
  const previewStarts = [];
  const detached = new Set();
  const socketRoot = await mkdtemp(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "v64-test-sockets-"));
  // What the fixture's server gives every command, as a managed host's does: none of this process's own Playwright
  // settings (a test host lane's PLAYWRIGHT_PORT, an outer suite's targets), then the command's own env on top.
  const commandEnv = playwrightChildEnvironment({
    VIBE64_PLAYWRIGHT_TARGET_RUN: "",
    TMPDIR: socketRoot,
    NPM_CONFIG_PREFIX: path.join(root, "tools"),
    VIBE64_SHARED_CACHE_ROOT: path.join(root, "cache"),
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  });
  const runCommand = async (input) => {
    if (input.mode === "detached") {
      const id = `${sessionId}-browser-${detached.size}`;
      detached.add(id);
      return runDetachedCommand({ ...input, execution: { ...input.execution, id } }, {
        cwd: input.cwd, env: { ...commandEnv, ...input.env, VIBE64_EXECUTION_ID: id }
      });
    }
    if (input.mode === "pty") {
      previewStarts.push(input.terminal.metadata.outputTargetId);
      return startTerminalSession({
        ...input.terminal, command: input.command, args: input.args, cwd: input.cwd,
        env: typeof input.env === "function" ? (identity) => ({ ...commandEnv, ...input.env(identity) }) : { ...commandEnv, ...input.env }
      });
    }
    const id = randomUUID();
    captureExecutionIds.add(id);
    try {
      return await runCaptureCommand(input.command, input.args, {
        ...input, execution: { ...input.execution, id },
        // As runVibe64Command gives a command its project's Env under its own.
        env: { ...commandEnv, ...input.project?.runtimeConfigEnv, ...input.env, VIBE64_EXECUTION_ID: id }
      });
    } finally {
      captureExecutionIds.delete(id);
    }
  };
  // The session-changed publisher a test watches, or one that publishes nowhere.
  const publishSessionChanged = workflowHooks.publishSessionChanged ?? (async () => null);
  // What a controller of this fixture is made from, for a test that makes another, as a restarted server does.
  const controllerOptions = { ensureProjectServices: async () => {}, publishSessionChanged, sessionAdmissionFailure: () => null,
    ensureWorkspacePrepared: async () => ({ ok: true }),
    // The server's env, with a short temporary folder for this fixture's sockets.
    env: { ...process.env, TMPDIR: socketRoot },
    project,
    runCommand,
    stopPreviewBrowsers: async () => ({ ok: true }),
    // This standalone fixture runs inside the test execution, not a catalogue project.
    startWorkflow: async () => ({ ok: true, workflow: null }),
    ...workflowHooks
  };
  const controller = createOutputTargetTerminalController(controllerOptions);
  const commandService = createAgentPreviewCommandService({ logger: silentLogger,
    project,
    launchTarget: controller, runManagedCommand: runCommand,
    stopManagedExecution: stopDetachedExecution, readSessionUiState: () => null,
    resourceProvider: workflowHooks.resourceProvider,
    publishSessionChanged
  });
  t.after(async () => {
    for (const id of captureExecutionIds) await stopCaptureExecution(id);
    await controller.closeAllForSession(sessionId);
    await controller.close();
    await commandService.closeAllForSession(sessionId);
    for (const id of detached) await stopDetachedExecution(id);
    await rm(root, { recursive: true, force: true });
    await rm(socketRoot, { recursive: true, force: true });
  });
  const command = args => commandService.run({ sessionId, args });
  const waitReadyOn = (target) => async (terminal) => {
    assert.notEqual(terminal?.ok, false, JSON.stringify(terminal));
    for (let count = 0; count < 100; count++) {
      const status = await target.launchStatus(sessionId);
      if (status.preview?.state === "ready") return status;
      if (status.preview?.state === "failed") throw new Error(status.preview.message);
      if (status.ok === false || status.activeTerminal?.status === "exited") throw new Error(status.error || status.activeTerminal?.output || "Preview exited");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Preview ${terminal.id} did not become ready`);
  };
  const waitReady = waitReadyOn(controller);
  return { root, socketRoot, sourceRoot, sessionId, project, controller, controllerOptions, commandService, command, waitReady,
    waitReadyOn, captureExecutionIds, previewStarts };
}

async function browserCommands(f) {
  const runtimeRoot = path.join(f.root, "runtimes");
  const nodeBin = path.join(runtimeRoot, "node26/bin");
  const playwrightRoot = path.join(runtimeRoot, "playwright");
  await mkdir(nodeBin, { recursive: true });
  await symlink(process.execPath, path.join(nodeBin, "node"));
  assert.ok(process.env.npm_execpath, "Run this fixture through npm test so its npm entry point is supplied.");
  await symlink(process.env.npm_execpath, path.join(nodeBin, "npm"));
  await mkdir(path.join(playwrightRoot, "bin"), { recursive: true });
  await mkdir(path.join(playwrightRoot, "runtime/lib/node_modules"), { recursive: true });
  await symlink(path.dirname(require.resolve("playwright/package.json")), path.join(playwrightRoot, "runtime/lib/node_modules/playwright"));
  await symlink(browsersPath, path.join(playwrightRoot, "browsers"));
  await writeFile(path.join(playwrightRoot, "runtime.env"), `playwright_version=${require("@playwright/test/package.json").version}\n`);
  await writeFile(path.join(playwrightRoot, "bin/playwright"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(playwrightRoot, "bin/playwright"), 0o755);
  await symlink(path.dirname(path.dirname(require.resolve("playwright/package.json"))), path.join(f.sourceRoot, "node_modules"));
  await writeFile(path.join(f.sourceRoot, "playwright.config.mjs"), `export default {
    testDir: '.', testMatch: 'browser.spec.mjs', workers: 1,
    reporter: 'line', timeout: 30000,
    use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STORAGE_STATE || undefined }
  };`);
  await writeFile(path.join(f.sourceRoot, "browser.spec.mjs"), `
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('test database round trip', async ({page, request}) => {
  const state = await (await request.get('/test-state')).json();
  expect(state).toEqual({mode:'test-app',count:0,effects:'disabled'});
  await page.goto('/');
  await expect(page.getByRole('heading')).toHaveText('test-app');
  await page.getByRole('button').click();
  await expect(page.getByText('Count: 1', {exact:true})).toBeVisible();
});
test('same suite keeps its fixture', async ({request}) => {
  expect(await (await request.get('/test-state')).json()).toEqual({mode:'test-app',count:1,effects:'disabled'});
});
test('intentional failure', async () => { expect(1).toBe(2); });
test('ordinary Preview is readable', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('app');
  await expect(page.locator('p')).toHaveText('Count: 42');
});
test('test target login', async ({page}) => {
  await page.goto('/test-login');
  await expect(page.locator('body')).toContainText('test_login=test-app-0');
});
test('restoration failure', async () => {
  await writeFile('fail-normal-start', 'yes');
  expect('original test failure').toBe('success');
});
test('cancelled test', async ({page}) => {
  await page.goto('/');
  console.log('TARGET_TEST_READY_TO_CANCEL');
  await writeFile('test-started', 'ready');
  await new Promise(resolve => setTimeout(resolve, 25000));
});
`);
  await writeFile(path.join(f.sourceRoot, "browser-check.mjs"), `
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(await page.locator('h1').textContent(), 'test-app');
  console.log('Node browser assertions passed');
} finally { await browser.close(); }
`);
  configureVibe64Host({ runtimePackRoot: runtimeRoot });
  const prepared = await prepareAgentPreviewCommand({
    commandService: f.commandService, env: { TMPDIR: f.socketRoot },
    project: { slug: "test-target" }, sessionId: f.sessionId,
    worktreePath: f.sourceRoot, wrapperHostDir: path.join(f.root, "commands")
  });
  return {
    execute(args) {
      const child = spawn(prepared.hostPlaywrightWrapperPath, args, {
        cwd: f.sourceRoot, detached: true,
        // This fixture owns a different Preview and identity from its outer suite: none of their settings reach it.
        env: playwrightChildEnvironment({ ...prepared.env, VIBE64_EXECUTION_ID: "test-parent", VIBE64_PLAYWRIGHT_TARGET_RUN: "" }),
        stdio: ["ignore", "pipe", "pipe"]
      });
      const completion = new Promise((resolve, reject) => {
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code === 0 && !signal) resolve({ stdout, stderr });
          else reject(Object.assign(new Error(stderr || "Playwright command failed"), { stdout, stderr, code, signal }));
        });
      });
      completion.child = child;
      return completion;
    }
  };
}

test("a restore at the turn's end that fails stays visible until managed recovery, or a Preview restart, takes over", async t => {
  const f = await fixture(t, "restore-status");
  const normal = await f.controller.ensurePreview(f.sessionId);
  await f.waitReady(normal);
  const breakNormalStart = () => f.controller.withPreviewTarget(f.sessionId, "test-app", async () => {
    await writeFile(path.join(f.sourceRoot, "fail-normal-start"), "yes");
    return { ok: true, exitCode: 0 };
  }, { waitUntilReady: f.waitReady });
  assert.deepEqual(await breakNormalStart(), { ok: true, exitCode: 0, previewRestorePending: true });
  assert.deepEqual((await f.controller.launchStatus(f.sessionId)).previewTestRun, { targetId: "test-app", state: "restore_pending" });
  assert.equal((await f.controller.restorePreviewAfterTurn(f.sessionId)).previewRecoveryRequired, true);
  assert.deepEqual((await f.controller.launchStatus(f.sessionId)).previewTestRun, { targetId: "test-app", state: "restore_failed" });
  await rm(path.join(f.sourceRoot, "fail-normal-start"));
  assert.equal((await f.controller.retryPreviewTestCleanup(f.sessionId)).ok, true);
  assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun, undefined);

  // The same failure, then the person's Restart: it puts their saved target back and starts it.
  await breakNormalStart();
  assert.equal((await f.controller.restorePreviewAfterTurn(f.sessionId)).previewRecoveryRequired, true);
  await rm(path.join(f.sourceRoot, "fail-normal-start"));
  const restarted = await f.controller.restartPreview(f.sessionId);
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  const status = await f.waitReady(restarted);
  assert.equal(status.previewTestRun, undefined);
  assert.equal(status.activeTerminal.metadata.outputTargetId, "app");
});

test("back-to-back test runs skip starting the person's app between them, each on a fresh test target, until the turn ends or Preview is asked for", async t => {
  const f = await fixture(t, "back-to-back");
  const parameters = { label: "kept between runs" };
  const normal = await f.controller.startTerminal(f.sessionId, { outputTargetId: "app", outputParameters: parameters });
  await f.waitReady(normal);
  const testState = async (status, action = "test-state") => {
    const url = new URL(status.previewTarget.href);
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/${action}`;
    const response = await fetch(url);
    return action === "test-state" ? response.json() : response.text();
  };
  const testRun = (operation = async () => ({ ok: true, exitCode: 0 })) => f.controller.withPreviewTarget(f.sessionId, "test-app",
    operation, { waitUntilReady: f.waitReady });
  const terminals = [];
  const repeated = async () => {
    const startsBefore = f.previewStarts.length;
    for (let run = 0; run < 3; run++) {
      const result = await testRun(async () => {
        const status = await f.controller.launchStatus(f.sessionId);
        terminals.push(status.activeTerminal.id);
        assert.deepEqual(await testState(status), { mode: "test-app", count: 0, effects: "disabled" }, "each run starts on fresh test data");
        assert.equal(await testState(status, "add"), "ok");
        return { ok: true, exitCode: 0 };
      });
      assert.deepEqual(result, { ok: true, exitCode: 0, previewRestorePending: true });
      assert.deepEqual((await f.controller.launchStatus(f.sessionId)).previewTestRun, { targetId: "test-app", state: "restore_pending" });
    }
    assert.deepEqual(f.previewStarts.slice(startsBefore), ["test-app", "test-app", "test-app"], "the person's app never starts between runs");
    assert.equal(new Set(terminals.splice(0)).size, 3, "no run reuses the last run's server");
  };

  // The turn ends: the person's app comes back with its parameters.
  await repeated();
  let startsBefore = f.previewStarts.length;
  await f.controller.restorePreviewAfterTurn(f.sessionId);
  let status = await f.controller.launchStatus(f.sessionId);
  assert.deepEqual(f.previewStarts.slice(startsBefore), ["app"]);
  assert.equal(status.previewTestRun, undefined);
  assert.equal(status.activeTerminal.metadata.outputTargetId, "app");
  assert.deepEqual(status.activeTerminal.metadata.outputParameters, parameters);
  assert.equal(await f.controller.restorePreviewAfterTurn(f.sessionId), null, "nothing waits after the restore");

  // The person presses Restart before the turn ends: their app, once.
  await repeated();
  startsBefore = f.previewStarts.length;
  const restarted = await f.controller.restartPreview(f.sessionId);
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  status = await f.waitReady(restarted);
  assert.deepEqual(f.previewStarts.slice(startsBefore), ["app"]);
  assert.equal(status.previewTestRun, undefined);
  assert.deepEqual(status.activeTerminal.metadata.outputParameters, parameters);

  // The person presses Stop: the test app stops and theirs stays stopped, ready for its next start.
  await repeated();
  startsBefore = f.previewStarts.length;
  const pendingTerminal = (await f.controller.launchStatus(f.sessionId)).activeTerminal.id;
  assert.equal((await f.controller.stopTerminal(f.sessionId, pendingTerminal)).ok, true);
  status = await f.controller.launchStatus(f.sessionId);
  assert.deepEqual(f.previewStarts.slice(startsBefore), []);
  assert.equal(status.previewTestRun, undefined);
  assert.equal(status.activeTerminal, null);
  assert.equal(status.preview.stoppedIntent, true);
  assert.equal(status.lastOutputTarget.id, "app");
  assert.deepEqual(status.lastOutputTarget.outputParameters, parameters);
  assert.equal(await f.controller.restorePreviewAfterTurn(f.sessionId), null);
  const started = await f.controller.ensurePreview(f.sessionId);
  status = await f.waitReady(started);
  assert.equal(status.activeTerminal.metadata.outputTargetId, "app");
  assert.deepEqual(status.activeTerminal.metadata.outputParameters, parameters);

  // A turn that ends while a run still tests restores as that run finishes, and the session's close drops a waiting run.
  startsBefore = f.previewStarts.length;
  const finished = await testRun(async () => {
    assert.equal(await f.controller.restorePreviewAfterTurn(f.sessionId), null);
    return { ok: true, exitCode: 0 };
  });
  assert.deepEqual(finished, { ok: true, exitCode: 0 });
  assert.deepEqual(f.previewStarts.slice(startsBefore), ["test-app", "app"]);
  assert.equal((await testRun()).previewRestorePending, true);
  await f.controller.closeAllForSession(f.sessionId);
  assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun, undefined);
});

test("a server restart while the person's Preview waits for its restore hands their target back with its parameters", async t => {
  const f = await fixture(t, "restore-after-restart");
  const parameters = { label: "kept through a restart" };
  await f.waitReady(await f.controller.startTerminal(f.sessionId, { outputTargetId: "app", outputParameters: parameters }));
  const result = await f.controller.withPreviewTarget(f.sessionId, "test-app", async () => ({ ok: true, exitCode: 0 }),
    { waitUntilReady: f.waitReady });
  assert.equal(result.previewRestorePending, true);
  // The server stops while the test app runs: the app's process ends with it, and the session's record stays as the
  // test app's start wrote it.
  const { metadata } = await (await f.project.createRuntime()).getSession(f.sessionId);
  const record = { ...metadata };
  assert.equal(record.output_target_id, "test-app");
  await closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(f.sessionId));
  for (let count = 0; count < 100 && metadata.output_target_terminal_id; count++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(metadata.output_target_terminal_id, undefined);
  for (const name of Object.keys(metadata)) delete metadata[name];
  Object.assign(metadata, record);
  // The restarted server reads the session's record afresh for each request, as it reads it from its files.
  const restartedProject = {
    ...f.project,
    async createRuntime() {
      const runtime = await f.project.createRuntime();
      const getSession = async (id) => {
        const session = await runtime.getSession(id);
        return { ...session, metadata: { ...session.metadata } };
      };
      return { ...runtime, getSession, getSessionWithoutSource: getSession };
    }
  };
  const restarted = createOutputTargetTerminalController({ ...f.controllerOptions, project: restartedProject });
  t.after(() => restarted.close());
  // The agent's first ensure after the restart starts the person's target with its parameters, not the test target.
  const status = await f.waitReadyOn(restarted)(await restarted.ensurePreview(f.sessionId));
  assert.equal(status.activeTerminal.metadata.outputTargetId, "app");
  assert.deepEqual(status.activeTerminal.metadata.outputParameters, parameters);
  assert.equal(status.previewTestRun, undefined);
  assert.equal(metadata.output_target_preview_restore, undefined, "a restore handed back is not handed back again");
});

test("a refused start of the person's app keeps the waiting restore, failed, until the turn's end or the next request brings it back", async t => {
  let refuse = false;
  let gate = null;
  let reached = null;
  const f = await fixture(t, "refused-restore", {
    async startWorkflow(input) {
      if (input.environment === "development" && gate) {
        reached.resolve();
        await gate.promise;
      }
      return refuse && input.environment === "development"
        ? { ok: false, code: "vibe64_capacity_rejected", error: "Your app may not fit comfortably." }
        : { ok: true, workflow: null };
    }
  });
  const parameters = { label: "kept through a refusal" };
  await f.waitReady(await f.controller.startTerminal(f.sessionId, { outputTargetId: "app", outputParameters: parameters }));
  const testRun = async () => assert.equal((await f.controller.withPreviewTarget(f.sessionId, "test-app",
    async () => ({ ok: true, exitCode: 0 }), { waitUntilReady: f.waitReady })).previewRestorePending, true);
  const testRunState = async () => (await f.controller.launchStatus(f.sessionId)).previewTestRun?.state;
  const personsApp = (status) => {
    assert.equal(status.previewTestRun, undefined);
    assert.equal(status.activeTerminal.metadata.outputTargetId, "app");
    assert.deepEqual(status.activeTerminal.metadata.outputParameters, parameters);
  };
  // The page's start answers as starting while it runs; the outputs read reports how it ended.
  const pageStart = async (startId) => {
    const answer = await f.controller.startTerminal(f.sessionId, { startId, outputTargetId: "" });
    for (let count = 0; answer.starting && count < 100; count++) {
      const start = f.controller.launchStarts(f.sessionId).find(entry => entry.startId === startId);
      if (start?.status !== "starting") return start;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return answer;
  };

  // Restart is refused: the restore waits, failed, and each turn's end tries it again.
  await testRun();
  refuse = true;
  assert.equal((await f.controller.restartPreview(f.sessionId)).code, "vibe64_capacity_rejected");
  assert.equal(await testRunState(), "restore_failed");
  assert.equal((await f.controller.restorePreviewAfterTurn(f.sessionId)).code, "vibe64_preview_restore_failed");
  assert.equal(await testRunState(), "restore_failed");
  refuse = false;
  await f.controller.restorePreviewAfterTurn(f.sessionId);
  personsApp(await f.controller.launchStatus(f.sessionId));

  // The page's Start is refused: the restore waits, failed, and the next request brings the person's app back.
  await testRun();
  refuse = true;
  assert.equal((await pageStart("refused-start")).code, "vibe64_capacity_rejected");
  assert.equal(await testRunState(), "restore_failed");
  refuse = false;
  personsApp(await f.waitReady(await f.controller.ensurePreview(f.sessionId)));

  // Stop during a slow start of the person's app answers at once and ends that restore: nothing is left to restore.
  await testRun();
  gate = Promise.withResolvers();
  reached = Promise.withResolvers();
  const restart = f.controller.restartPreview(f.sessionId);
  await reached.promise;
  assert.equal(await testRunState(), "restoring");
  const stopped = await f.controller.stopTerminal(f.sessionId, "");
  assert.equal(stopped.stopping, true, JSON.stringify(stopped));
  gate.resolve();
  gate = null;
  await restart;
  const status = await f.controller.launchStatus(f.sessionId);
  assert.equal(status.previewTestRun, undefined);
  assert.equal(status.preview.stoppedIntent, true);
  assert.equal(status.preview.state, "stopped");
});

test("ordinary managed suites restore a stopped Preview and retain an already running Preview", async t => {
  const f = await fixture(t, "ordinary");
  const commands = await browserCommands(f);
  const parameters = { label: "saved ordinary target" };
  const normal = await f.controller.startTerminal(f.sessionId, { outputTargetId: "app", outputParameters: parameters });
  await f.waitReady(normal);
  for (const running of [true, false]) {
    if (!running) assert.equal((await f.controller.stopTerminal(f.sessionId, normal.id)).ok, true);
    for (const name of ["ordinary Preview is readable", "intentional failure", "cancelled test"]) {
      await t.test(`${running ? "running" : "stopped"}: ${name}`, async () => {
        const marker = path.join(f.sourceRoot, "test-started");
        await rm(marker, { force: true });
        const completion = commands.execute(["test", "--grep", name]);
        if (name === "cancelled test") {
          const cancellation = completion.then(value => ({ value }), error => ({ error }));
          for (let attempt = 0; attempt < 160; attempt++) {
            if (await readFile(marker, "utf8").catch(() => "")) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          assert.equal(await readFile(marker, "utf8"), "ready");
          assert.equal(f.commandService.playwrightStatus(f.sessionId).run.state, "running");
          process.kill(-completion.child.pid, "SIGINT");
          assert.ok((await cancellation).error, "interrupted launcher must fail");
          for (let attempt = 0; attempt < 100 && f.commandService.playwrightStatus(f.sessionId).run; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else if (name === "intentional failure") await assert.rejects(completion, error => {
          assert.equal(error.code, 1);
          assert.match(error.stdout + error.stderr, /1 failed/u);
          return true;
        });
        else assert.match((await completion).stdout, /1 passed/u);
        assert.equal(f.commandService.playwrightStatus(f.sessionId).run, null);
        assert.equal(f.captureExecutionIds.size, 0, "nested managed test commands have drained");
        const restored = await f.controller.launchStatus(f.sessionId);
        assert.equal(restored.lastOutputTarget.id, "app");
        assert.deepEqual(restored.lastOutputTarget.outputParameters, parameters);
        if (running) {
          assert.equal(restored.activeTerminal.id, normal.id);
          assert.deepEqual(restored.activeTerminal.metadata.outputParameters, parameters);
        } else {
          assert.equal(restored.activeTerminal, null);
          assert.equal(restored.preview.state, "stopped");
          assert.equal(restored.preview.stoppedIntent, true);
        }
      });
    }
  }
  assert.equal(JSON.parse(await readFile(path.join(f.sourceRoot, "working.json"), "utf8")).count, 42);
});

test("explicitly stopped Preview stays stopped after test success, failure and cancellation", async t => {
  const f = await fixture(t, "stopped");
  const parameters = { label: "saved stopped target" };
  const normal = await f.controller.startTerminal(f.sessionId, { outputTargetId: "app", outputParameters: parameters });
  await f.waitReady(normal);
  const originalData = await readFile(path.join(f.sourceRoot, "working.json"), "utf8");
  assert.equal((await f.controller.stopTerminal(f.sessionId, normal.id)).ok, true);
  const saved = await (await f.project.createRuntime()).getSession(f.sessionId);
  assert.equal(saved.metadata.output_target_id, "app");
  assert.deepEqual(JSON.parse(saved.metadata.output_target_parameters), parameters);
  assert.equal(saved.metadata.output_target_terminal_id, undefined);
  assert.equal(saved.metadata.output_target_preview_auth, undefined);
  for (const outcome of [
    { ok: true, exitCode: 0 },
    { ok: false, exitCode: 17, error: "assertion failed" },
    { ok: false, exitCode: 1, signal: "SIGTERM", error: "cancelled" }
  ]) {
    const result = await f.controller.withPreviewTarget(f.sessionId, "test-app", async () => {
      const status = await f.controller.launchStatus(f.sessionId);
      assert.equal(status.preview.state, "ready");
      assert.equal(status.preview.stoppedIntent, true, "temporary tests retain the user's saved intent");
      return outcome;
    }, { waitUntilReady: f.waitReady });
    assert.deepEqual(result, outcome);
    const restored = await f.controller.launchStatus(f.sessionId);
    assert.equal(restored.activeTerminal, null);
    assert.equal(restored.preview.state, "stopped");
    assert.equal(restored.preview.stoppedIntent, true);
    assert.equal(restored.lastOutputTarget.id, "app");
    assert.deepEqual(restored.lastOutputTarget.outputParameters, parameters);
    assert.equal((await f.controller.startTerminal(f.sessionId, { automatic: true })).code, "vibe64_preview_stopped");
    assert.equal(await readFile(path.join(f.sourceRoot, "working.json"), "utf8"), originalData);
  }
  const reopened = createOutputTargetTerminalController({ ensureWorkspacePrepared: async () => ({ ok: true }), stopPreviewBrowsers: async () => ({ ok: true }), ensureProjectServices: async () => {}, publishSessionChanged: async () => null, sessionAdmissionFailure: () => null, env: { ...process.env, TMPDIR: f.socketRoot }, project: f.project });
  t.after(() => reopened.close());
  const afterReopen = await reopened.launchStatus(f.sessionId);
  assert.equal(afterReopen.preview.state, "stopped");
  assert.equal(afterReopen.activeTerminal, null);
  assert.equal(afterReopen.lastOutputTarget.id, "app");
  assert.deepEqual(afterReopen.lastOutputTarget.outputParameters, parameters);
  assert.equal((await reopened.startTerminal(f.sessionId, { automatic: true })).code, "vibe64_preview_stopped");
  const restarted = await f.controller.ensurePreview(f.sessionId);
  await f.waitReady(restarted);
  const running = await f.controller.launchStatus(f.sessionId);
  assert.notEqual(running.preview.stoppedIntent, true);
  assert.deepEqual(running.lastOutputTarget.outputParameters, parameters);
});

test("workflow metadata separates real test target runs from development restoration without resource declarations", async t => {
  const starts = [];
  const phases = [];
  const finishes = [];
  await runWithProjectRequestContext({ slug: "legacy-resource-project" }, async () => {
    const f = await fixture(t, "resource-workflow", {
      async startWorkflow(input) {
        starts.push(input);
        return { ok: true, workflow: { id: `workflow-${starts.length}` } };
      },
      async setWorkflowPhase(id, phase) { phases.push({ id, phase }); },
      async finishWorkflow(id, options) { finishes.push({ id, ...options }); }
    });
    const normal = await f.controller.ensurePreview(f.sessionId);
    assert.equal(normal.ok, true, JSON.stringify(normal));
    await f.waitReady(normal);
    const result = await f.controller.withPreviewTarget(f.sessionId, "test-app", async () => {
      const status = await f.controller.launchStatus(f.sessionId);
      assert.deepEqual(status.previewTestRun, { targetId: "test-app", state: "running" });
      assert.equal(status.outputTargets.find(target => target.id === "test-app").dataMode, "test");
      const url = new URL(status.previewTarget.href);
      url.pathname = `${url.pathname.replace(/\/$/u, "")}/test-state`;
      const response = await fetch(url);
      assert.equal(response.ok, true, `${url}: ${await response.clone().text()}`);
      const state = await response.json();
      assert.equal(state.mode, "test-app");
      assert.equal((await f.controller.ensurePreview(f.sessionId)).id, status.activeTerminal.id);
      assert.equal(starts.length, 2, "a repeated ensure does not start another workflow");
      return { ok: true, exitCode: 0 };
    }, { waitUntilReady: f.waitReady });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual((await f.controller.launchStatus(f.sessionId)).previewTestRun, { targetId: "test-app", state: "restore_pending" });
    await f.controller.restorePreviewAfterTurn(f.sessionId);
    assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun, undefined);
    assert.deepEqual(starts.map((input) => [input.operation.targetId, input.environment]), [
      ["app", "development"], ["test-app", "test"], ["app", "development"]
    ]);
    assert.equal(starts.every((input) => input.estimates.status === "unconfigured"), true);
    assert.deepEqual(new Set(phases.map(({ id, phase }) => `${id}:${phase}`)), new Set([
      "workflow-1:running", "workflow-2:running", "workflow-3:running"
    ]));
    await f.controller.closeAllForSession(f.sessionId);
    assert.deepEqual(finishes.map(({ id, outcome, defer }) => [id, outcome, defer]), [
      ["workflow-1", "stopped", true], ["workflow-2", "stopped", true], ["workflow-3", "stopped", true]
    ]);
  });
});

test("test-target capacity approval resumes the original suite and restores development outside the approval scope", async t => {
  await runWithProjectRequestContext({ slug: "test-capacity" }, async () => {
    const starts = [];
    const approvalScope = new AsyncLocalStorage();
    const waiting = Promise.withResolvers();
    const ends = [];
    let f;
    const admission = { id: "76cb5cf2-412d-479d-b06c-5ae0cfaa9551", outcome: "unavailable", code: "project_memory_unavailable",
      availableBytes: 1600 * 1024 ** 2, typicalBytes: 512 * 1024 ** 2, highBytes: 1536 * 1024 ** 2,
      actions: ["recheck", "manage-resources"] };
    f = await fixture(t, "capacity", {
      resourceProvider: () => ({
        async beginWorkflowApprovalWait() {
          assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal.metadata.outputTargetId, "app");
          assert.equal(f.controller.previewTestRunAdmission(f.sessionId), null, "Preview is unlocked before approval wait");
          return { expiresAt: new Date(Date.now() + 300_000).toISOString() };
        },
        async endWorkflowApprovalWait(input) { ends.push(input.outcome); }
      }),
      async publishSessionChanged(sessionId) {
        if (f.commandService.testApprovalStatus(sessionId)?.state === "waiting") waiting.resolve();
      },
      async startWorkflow(input) {
        starts.push([input.operation.targetId, input.environment]);
        if (input.environment === "development") assert.equal(approvalScope.getStore(), undefined, "restoration cannot inherit a test approval");
        return !approvalScope.getStore() && input.environment === "test"
          ? { ok: false, code: "vibe64_capacity_rejected", error: "This test Preview may not fit comfortably.", admission }
          : { ok: true, workflow: { id: `workflow-${starts.length}` } };
      },
      async setWorkflowPhase() {},
      async finishWorkflow() {}
    });
    await f.waitReady(await f.controller.ensurePreview(f.sessionId));
    const rejected = await f.controller.withPreviewTarget(f.sessionId, "test-app", () => assert.fail("refused tests must not run"), {
      waitUntilReady: f.waitReady
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_capacity_rejected");
    assert.equal(rejected.error, "This test Preview may not fit comfortably.");
    assert.deepEqual(rejected.details.admission, admission);
    assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal.metadata.outputTargetId, "app");
    await assert.rejects(readFile(path.join(f.sourceRoot, "test.json")), { code: "ENOENT" });
    assert.deepEqual(starts, [["app", "development"], ["test-app", "test"], ["app", "development"]]);
    const commands = await browserCommands(f);
    const original = commands.execute(["--target", "test-app", "test", "--grep", "test database round trip"]);
    const completion = original.then((value) => value, (error) => { throw error; });
    await Promise.race([
      waiting.promise,
      completion.then(() => assert.fail("Command ended before resource approval"))
    ]);
    assert.deepEqual(starts.slice(3), [["test-app", "test"], ["app", "development"]]);
    await assert.rejects(readFile(path.join(f.sourceRoot, "test.json")), { code: "ENOENT" });
    const normal = await f.controller.launchStatus(f.sessionId);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(normal.previewTarget.href);
      assert.equal(await page.locator("h1").textContent(), "app");
      assert.match(await page.locator("p").textContent(), /42/u);
    } finally { await browser.close(); }
    const accepted = await f.commandService.resumeTestApproval({ projectSlug: "test-target", sessionId: f.sessionId, admissionId: admission.id },
      (start) => approvalScope.run(true, start));
    assert.equal(accepted.accepted, true);
    const result = await completion;
    assert.match(result.stdout, /Waiting for resources/u);
    assert.match(result.stdout, /1 passed/u);
    assert.deepEqual(starts.slice(5), [["test-app", "test"]], "development returns at the turn's end");
    await f.controller.restorePreviewAfterTurn(f.sessionId);
    assert.deepEqual(starts.slice(5), [["test-app", "test"], ["app", "development"]]);
    assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal.metadata.outputTargetId, "app");
    assert.equal(JSON.parse(await readFile(path.join(f.sourceRoot, "working.json"), "utf8")).count, 42);
    assert.deepEqual(ends, ["resumed"]);
    assert.equal(f.commandService.testApprovalStatus(f.sessionId), null);
  });
});

test("declared test Preview runs real servers, isolates session state, and restores success/failure/cancellation", async t => {
  await runWithProjectRequestContext({ slug: "test-target" }, async () => {
    const f = await fixture(t, "one");
    const options = { waitUntilReady: f.waitReady };
    const run = operation => f.controller.withPreviewTarget(f.sessionId, "test-app", operation, options);
    const before = await f.controller.ensurePreview(f.sessionId);
    assert.equal(before.ok, true, JSON.stringify(before));
    await f.waitReady(before);
    const workingBytes = await readFile(path.join(f.sourceRoot, "working.json"), "utf8");
    const targets = JSON.parse((await f.command(["targets", "--json"])).stdout).targets;
    assert.deepEqual(targets.map(target => target.id), ["app", "test-app", "authenticated-test", "broken", "terminal"]);

    await t.test("invalid targets preserve the active terminal", async () => {
      for (const targetId of ["unknown", "terminal"]) {
        await assert.rejects(f.controller.withPreviewTarget(f.sessionId, targetId, () => assert.fail("must not run"), options), /available declared web target/u);
        assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal.id, before.id);
      }
    });
    await t.test("real browser writes only the test fixture while other starts are rejected", async () => {
      const browser = await chromium.launch();
      try {
        const result = await run(async () => {
          const status = await f.controller.launchStatus(f.sessionId);
          const page = await browser.newPage();
          const errors = [];
          page.on("pageerror", error => errors.push(error.message));
          await page.goto(status.previewTarget.href);
          assert.equal(await page.locator("h1").textContent(), "test-app");
          await page.getByRole("button", { name: "Add fixture" }).click();
          await page.getByText("Count: 1", { exact: true }).waitFor();
          assert.deepEqual(errors, []);
          assert.equal((await f.controller.ensurePreview(f.sessionId)).id, status.activeTerminal.id);
          assert.equal((await f.controller.restartPreview(f.sessionId)).code, "vibe64_preview_test_busy");
          assert.equal((await f.controller.startTerminal(f.sessionId, { outputTargetId: "app" })).code, "vibe64_preview_test_busy");
          assert.equal((await f.controller.stopTerminal(f.sessionId, status.activeTerminal.id)).code, "vibe64_preview_test_busy");
          assert.equal(f.controller.previewTestRunAdmission(f.sessionId).code, "vibe64_preview_test_busy");
          assert.equal(f.controller.previewTestRunAdmission(f.sessionId, "wrong-run").code, "vibe64_preview_test_busy");
          await assert.rejects(run(() => assert.fail("concurrent run")), /already own/u);
          await page.close();
          return { ok: true, exitCode: 0 };
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        await f.controller.restorePreviewAfterTurn(f.sessionId);
        assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
      } finally { await browser.close(); }
    });
    for (const outcome of [
      { ok: false, exitCode: 17, error: "assertion failed" },
      { ok: false, exitCode: 1, signal: "SIGTERM", error: "cancelled" },
      { ok: false, exitCode: 1, timedOut: true, error: "timed out" }
    ]) {
      // Each run's tests ran: the person's Preview comes back at the turn's end, and the next run starts its own target.
      const startsBefore = f.previewStarts.length;
      const result = await run(async () => outcome);
      assert.deepEqual(result, { ...outcome, previewRestorePending: true });
      assert.deepEqual(f.previewStarts.slice(startsBefore), ["test-app"]);
      assert.deepEqual((await f.controller.launchStatus(f.sessionId)).previewTestRun, { targetId: "test-app", state: "restore_pending" });
    }
    // A run whose target never serves restores at once, the waiting run's restore included.
    const broken = await f.controller.withPreviewTarget(f.sessionId, "broken", () => assert.fail("unready target"), options);
    assert.equal(broken.ok, false);
    assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
    const abortedStart = await f.controller.withPreviewTarget(f.sessionId, "test-app", () => assert.fail("cancelled before test start"), {
      waitUntilReady: async (terminal, { restoring = false } = {}) => {
        if (!restoring) throw new Error("cancelled during startup");
        return f.waitReady(terminal);
      }
    });
    assert.match(abortedStart.error, /cancelled during startup/u);
    assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
    assert.equal(await readFile(path.join(f.sourceRoot, "working.json"), "utf8"), workingBytes);

    await t.test("the complete managed command runs Playwright and restores after actual assertion failure", async () => {
      const commands = await browserCommands(f);
      async function waitForTestStart() {
        const marker = path.join(f.sourceRoot, "test-started");
        for (let attempt = 0; attempt < 160; attempt++) {
          if (await readFile(marker, "utf8").catch(() => "")) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(await readFile(marker, "utf8"), "ready");
      }
      const startsBeforeSuite = f.previewStarts.length;
      const result = await commands.execute(["--target", "test-app", "test", "--grep", "test database round trip|same suite keeps its fixture"]);
      assert.match(result.stdout, /2 passed/u);
      assert.match(result.stdout, /keeps the test target in Preview for your next run/u);
      assert.deepEqual(f.previewStarts.slice(startsBeforeSuite), ["test-app"], "the whole suite switches once and leaves the restore to the turn");
      assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun.state, "restore_pending");
      const nodeSuite = await commands.execute(["--target", "test-app", "npm-run", "test:playwright:fixture"]);
      assert.match(nodeSuite.stdout, /Node browser assertions passed/u);
      assert.deepEqual(f.previewStarts.slice(startsBeforeSuite), ["test-app", "test-app"]);
      assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun.state, "restore_pending");
      await assert.rejects(commands.execute(["--target", "test-app", "npm-run", "unrelated"]), error => {
        assert.match(error.stdout + error.stderr, /not a declared Playwright test script/u);
        return true;
      });
      await assert.rejects(commands.execute(["--target=test-app", "npm-run", "e2e", "--", "--grep", "intentional failure"]), error => {
        assert.match(error.stdout + error.stderr, /1 failed/u);
        return true;
      });
      await f.controller.restorePreviewAfterTurn(f.sessionId);
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
      assert.equal(await readFile(path.join(f.sourceRoot, "working.json"), "utf8"), workingBytes);

      await assert.rejects(commands.execute(["--target", "test-app", "--identity", "guest", "test"]), error => {
        assert.match(error.stdout + error.stderr, /does not support application identity selection/u);
        return true;
      });
      await f.controller.restorePreviewAfterTurn(f.sessionId);
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");

      const authenticated = await commands.execute(["--target", "authenticated-test", "--identity", "tester", "test", "--grep", "test target login"]);
      assert.match(authenticated.stdout, /1 passed/u);
      await f.controller.restorePreviewAfterTurn(f.sessionId);
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");

      const launcher = commands.execute(["--target", "test-app", "test", "--grep", "cancelled test"]);
      const cancellation = launcher.then(value => ({ value }), error => ({ error }));
      await waitForTestStart();
      const active = JSON.parse((await commands.execute(["status"])).stdout).run;
      assert.equal(active.state, "running");
      assert.equal(active.targetId, "test-app");
      process.kill(-launcher.child.pid, "SIGINT");
      assert.ok((await cancellation).error, "interrupted launcher must fail");
      for (let attempt = 0; attempt < 100 && f.commandService.playwrightStatus(f.sessionId).run; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(f.commandService.playwrightStatus(f.sessionId).run, null, "disconnect alone completes cancellation");
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
      assert.equal(f.captureExecutionIds.size, 0, "nested managed test commands have drained");
      assert.equal(JSON.parse((await commands.execute(["status"])).stdout).run, null);
      assert.equal((await f.commandService.cancelPlaywrightRun(f.sessionId, active.id)).code, "vibe64_test_run_unavailable");

      await rm(path.join(f.sourceRoot, "test-started"));
      const next = commands.execute(["--target", "test-app", "test", "--grep", "cancelled test"])
        .then(value => ({ value }), error => ({ error }));
      await waitForTestStart();
      const nextRun = JSON.parse((await commands.execute(["status"])).stdout).run;
      assert.notEqual(nextRun.id, active.id);
      assert.equal((await f.commandService.cancelPlaywrightRun(f.sessionId, active.id)).ok, false, "old cancellation cannot affect a new run");
      const startsBeforeCancel = f.previewStarts.length;
      const cancelled = await Promise.all([commands.execute(["cancel", nextRun.id]), commands.execute(["cancel", nextRun.id])]);
      assert.ok(cancelled.every(result => JSON.parse(result.stdout).ok));
      assert.ok((await next).error);
      assert.deepEqual(f.previewStarts.slice(startsBeforeCancel), ["app"], "repeated cancellation restores only once");

      await assert.rejects(commands.execute(["--target", "test-app", "test", "--grep", "restoration failure"]), error => {
        assert.match(error.stdout + error.stderr, /original test failure/u);
        assert.doesNotMatch(error.stdout + error.stderr, /Could not restore Preview/u, "the restore waits for the turn's end");
        return true;
      });
      assert.equal(JSON.parse((await commands.execute(["status"])).stdout).run, null);
      assert.equal((await f.controller.restorePreviewAfterTurn(f.sessionId)).previewRecoveryRequired, true);
      assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun.state, "restore_failed");
      // The agent's ensure takes the failed restore over; the app itself still cannot start.
      assert.equal((await f.command(["ensure", "--target", "app", "--wait", "--json"])).ok, false);
      assert.equal((await f.controller.launchStatus(f.sessionId)).previewTestRun, undefined);
      await rm(path.join(f.sourceRoot, "fail-normal-start"));
      const recovered = await f.command(["ensure", "--target", "app", "--wait", "--json"]);
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
    });

    await t.test("a sibling session can keep its ordinary Preview running during this session's test", async () => {
      const sibling = await fixture(t, "two");
      const terminal = await sibling.controller.ensurePreview(sibling.sessionId);
      await sibling.waitReady(terminal);
      const result = await run(async () => {
        const status = await sibling.controller.launchStatus(sibling.sessionId);
        assert.equal(status.activeTerminal.id, terminal.id);
        assert.equal(status.lastOutputTarget.id, "app");
        const url = new URL(status.previewTarget.href);
        url.pathname = "/test-state";
        const response = await fetch(url);
        assert.equal((await response.json()).count, 42);
        return { ok: true };
      });
      assert.equal(result.ok, true, JSON.stringify(result));
    });
    await f.controller.closeAllForSession(f.sessionId);
    const idleRun = await run(async () => ({ ok: true }));
    assert.equal(idleRun.ok, true, JSON.stringify(idleRun));
    assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal, null);
    const closedRun = await run(async () => {
      await f.controller.closeAllForSession(f.sessionId);
      return { ok: false, error: "session closed" };
    });
    assert.equal(closedRun.error, "session closed");
    assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal, null);
  });
});


test("failed cleanup keeps Preview owned until every execution drains, without repeating completed stops", async t => {
  const stops = [];
  let parentCanStop = false;
  const f = await fixture(t, "cleanup", {
    async stopExecution(id) {
      stops.push(id);
      if (id === "parent" && !parentCanStop) throw new Error("host cleanup unavailable");
      return { ok: true, scopeEmpty: true };
    }
  });
  await f.waitReady(await f.controller.ensurePreview(f.sessionId));
  const result = await f.controller.withPreviewTarget(f.sessionId, "test-app", async () => ({
    ok: false, exitCode: 1, code: "vibe64_execution_cleanup_required",
    execution: { id: "parent", state: "active" }, cleanupExecutionIds: ["child", "parent"]
  }), { waitUntilReady: f.waitReady });
  assert.equal(result.previewRecoveryRequired, true);
  const starts = f.previewStarts.length;
  const retries = await Promise.all([
    f.controller.retryPreviewTestCleanup(f.sessionId),
    f.controller.retryPreviewTestCleanup(f.sessionId)
  ]);
  assert.ok(retries.every(result => result.previewRecoveryRequired));
  assert.deepEqual(stops, ["child", "parent"]);
  assert.equal(f.previewStarts.length, starts, "unproven cleanup never restarts Preview");
  assert.equal((await f.command(["ensure", "--target", "app", "--json"])).ok, false);
  parentCanStop = true;
  const recovered = await f.controller.retryPreviewTestCleanup(f.sessionId);
  assert.equal(recovered.previewRecoveryRequired, undefined);
  assert.deepEqual(stops, ["child", "parent", "parent"], "a proven empty execution is not stopped again");
  assert.deepEqual(f.previewStarts.slice(starts), ["app"]);
  assert.equal(f.controller.previewTestRunAdmission(f.sessionId), null);
});

test("output parameters survive reuse, restart and temporary test-target restoration", async t => {
  const f = await fixture(t, "parameters");
  const parameters = { label: "chosen value '{port}' $(printf literal)" };
  const start = (extra = {}) => f.controller.startTerminal(f.sessionId, { outputTargetId: "app", ...extra });
  let normal = await start({ outputParameters: parameters });
  assert.equal(normal.ok, true, JSON.stringify(normal));
  await f.waitReady(normal);
  assert.equal((await start({ outputParameters: parameters, ensurePreview: true })).id, normal.id);
  for (const outputParameters of [{ label: "" }, null, { unknown: "value" }]) {
    const rejected = await start({ outputParameters, forceRestart: true });
    assert.equal(rejected.ok, false);
    assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal.id, normal.id);
  }
  const changed = await start({ outputParameters: { label: "changed" }, ensurePreview: true });
  assert.notEqual(changed.id, normal.id, "changed parameters cannot reuse a running command");
  await f.waitReady(changed);
  normal = await start({ outputParameters: parameters, forceRestart: true });
  await f.waitReady(normal);
  const restarted = await f.controller.restartPreview(f.sessionId);
  await f.waitReady(restarted);
  assert.deepEqual(restarted.metadata.outputParameters, parameters);
  const result = await f.controller.withPreviewTarget(f.sessionId, "test-app", async () => {
    const status = await f.controller.launchStatus(f.sessionId);
    assert.deepEqual(status.activeTerminal.metadata.outputParameters, { label: "test-app default" });
    return { ok: true, exitCode: 0 };
  }, { waitUntilReady: f.waitReady });
  assert.equal(result.ok, true, JSON.stringify(result));
  await f.controller.restorePreviewAfterTurn(f.sessionId);
  const restored = await f.controller.launchStatus(f.sessionId);
  assert.deepEqual(restored.activeTerminal.metadata.outputParameters, parameters);
  assert.deepEqual(restored.lastOutputTarget.outputParameters, parameters);
  const url = new URL(restored.previewTarget.href);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/parameter`;
  assert.equal(await (await fetch(url)).text(), parameters.label);
});

// Whether the parallel target's process is gone and none of its app servers answers.
async function parallelClosed(f, ports) {
  const pid = Number(await readFile(path.join(f.sourceRoot, "parallel.pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the target's process is gone");
  for (const port of ports) {
    const answer = await fetch(`http://127.0.0.1:${port}/worker`).then(response => response.text(), () => "");
    assert.doesNotMatch(answer, /"workers"/u, `nothing of the target answers on ${port}`);
  }
}

test("a test target taking {workers} serves one app server per worker, each with its own data, and closes as a run with several ends", async t => {
  const GIB = 1024 ** 3;
  let freeBytes = 64 * GIB;
  const f = await fixture(t, "parallel", { testBudget: () => 6, availableMemory: async () => freeBytes },
    { extraOutputs: parallelTarget });
  const parameters = { label: "the person's" };
  const normal = await f.controller.startTerminal(f.sessionId, { outputTargetId: "app", outputParameters: parameters });
  await f.waitReady(normal);
  const run = async (workers) => {
    let served;
    const startsBefore = f.previewStarts.length;
    const result = await f.controller.withPreviewTarget(f.sessionId, "parallel", async () => {
      const status = await f.controller.launchStatus(f.sessionId);
      // Each app server itself, as testWorkers lists them: the Preview's own address carries its access token, which a
      // relative URL would drop.
      const urls = (status.activeTerminal.metadata.testWorkers || [{ url: status.activeTerminal.metadata.targetUrl }])
        .map(({ url }) => url);
      served = await Promise.all(urls.map(async (url) => {
        assert.equal(await (await fetch(new URL("add", url))).text(), "ok");
        return { port: Number(new URL(url).port), ...await (await fetch(new URL("worker", url))).json() };
      }));
      return { ok: true, exitCode: 0 };
    }, { waitUntilReady: f.waitReady, workers });
    assert.ok(served, `the run reached its suite: ${JSON.stringify(result)}`);
    return { result, served, starts: f.previewStarts.slice(startsBefore) };
  };
  const personsAppIsBack = async () => {
    const status = await f.controller.launchStatus(f.sessionId);
    assert.equal(status.previewTestRun, undefined);
    assert.equal(status.activeTerminal.metadata.outputTargetId, "app");
    assert.deepEqual(status.activeTerminal.metadata.outputParameters, parameters);
  };

  // Asked for 2 of a budget of 6: two servers on consecutive ports, each with its own data.
  let { result, served, starts } = await run(2);
  assert.deepEqual(result, { ok: true, exitCode: 0 }, "nothing waits for the turn's end: the run closed its target");
  assert.deepEqual(served.map(({ worker, workers, count }) => ({ worker, workers, count })),
    [{ worker: 0, workers: 2, count: 1 }, { worker: 1, workers: 2, count: 1 }]);
  assert.equal(served[1].port, served[0].port + 1);
  assert.deepEqual(starts, ["parallel", "app"], "the person's app comes back as the run ends");
  await personsAppIsBack();
  const appPort = (await f.controller.launchStatus(f.sessionId)).activeTerminal.metadata.port;
  await parallelClosed(f, served.map(({ port }) => port).filter(port => port !== appPort));

  // No count asked: the budget's browser share; more than the budget asked: the budget.
  ({ served } = await run(0));
  assert.deepEqual(served.map(({ worker }) => worker), [0, 1, 2]);
  assert.ok(served.every(({ count }) => count === 1), "each run starts each server on fresh data");
  ({ served } = await run(20));
  assert.equal(served.length, 6);
  // No more than 80% of the free memory fits, at 1.5 GiB a worker without a Running high estimate.
  freeBytes = 3.75 * GIB;
  ({ served } = await run(0));
  assert.equal(served.length, 2);
  // Once a run's app servers have recorded their peak (JSKIT's launcher writes it in the target's folder), a worker is
  // that peak and a Chromium: 256 MiB fits the budget's share of 3, 2.5 GiB only one.
  const recorded = path.join(f.sourceRoot, "node_modules", ".cache", "jskit-browser-tests", "server-memory.json");
  await mkdir(path.dirname(recorded), { recursive: true });
  for (const [peak, count] of [[256 * 1024 ** 2, 3], [2.5 * GIB, 1]]) {
    await writeFile(recorded, JSON.stringify({ serverPeakBytes: peak }));
    ({ served } = await run(0));
    assert.equal(served.length, count, `at a recorded peak of ${peak} bytes`);
  }
  await rm(recorded);

  // A host that cannot tell its free memory gets one server: the run is today's, its restore waiting for the turn's end.
  freeBytes = null;
  ({ result, served, starts } = await run(0));
  assert.deepEqual(served.map(({ worker, workers }) => ({ worker, workers })), [{ worker: 0, workers: 1 }]);
  assert.deepEqual(result, { ok: true, exitCode: 0, previewRestorePending: true });
  assert.deepEqual(starts, ["parallel"]);
  const waiting = await f.controller.launchStatus(f.sessionId);
  assert.deepEqual(waiting.previewTestRun, { targetId: "parallel", state: "restore_pending" });
  assert.equal(Object.hasOwn(waiting.activeTerminal.metadata, "testWorkers"), false);
  await f.controller.restorePreviewAfterTurn(f.sessionId);
  await personsAppIsBack();
});

test("a suite on a test target serving workers signs each Playwright worker in on its own server, and a normal end or a cancel leaves nothing behind", async t => {
  await runWithProjectRequestContext({ slug: "test-target" }, async () => {
    const f = await fixture(t, "parallel-suite", { testBudget: () => 8, availableMemory: async () => 64 * 1024 ** 3 },
      { extraOutputs: parallelTarget });
    const commands = await browserCommands(f);
    await writeFile(path.join(f.sourceRoot, "playwright.config.mjs"), `
const targets = JSON.parse(process.env.PLAYWRIGHT_WORKER_TARGETS || '[]');
export default {
  testDir: '.', testMatch: 'parallel.spec.mjs', workers: Math.max(1, targets.length), fullyParallel: true,
  reporter: 'line', timeout: 30000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STORAGE_STATE || undefined }
};`);
    await writeFile(path.join(f.sourceRoot, "parallel.spec.mjs"), `
import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const targets = JSON.parse(process.env.PLAYWRIGHT_WORKER_TARGETS || '[]');
// Each Playwright worker on its own app server, signed in there, as JSKIT's browserTestConfig() gives a suite.
const test = base.extend({
  baseURL: async ({}, use, testInfo) => use(targets[testInfo.parallelIndex].baseURL),
  storageState: async ({}, use, testInfo) => use(targets[testInfo.parallelIndex].storageState)
});
for (const n of [0, 1, 2, 3]) {
  test('parallel test ' + n, async ({ page, baseURL }, testInfo) => {
    const { worker } = await (await page.request.get('/worker')).json();
    expect(worker).toBe(testInfo.parallelIndex);
    await page.goto('/test-login');
    await expect(page.locator('body')).toContainText('test_login=port-' + new URL(baseURL).port);
    await writeFile('parallel-seen-' + n + '.json', JSON.stringify({ worker, targets }));
  });
}
test('parallel slow test', async () => {
  await writeFile('parallel-slow.json', JSON.stringify({ targets }));
  await new Promise(resolve => setTimeout(resolve, 25000));
});
`);
    const leftNothing = async (targets) => {
      assert.equal(targets.length, 2);
      const ports = targets.map(({ baseURL }) => Number(new URL(baseURL).port));
      assert.equal(ports[1], ports[0] + 1);
      const runDirectory = path.dirname(targets[0].storageState);
      assert.equal(path.dirname(targets[1].storageState), runDirectory);
      await assert.rejects(access(runDirectory), { code: "ENOENT" }, "the run's directory goes with it");
      await parallelClosed(f, ports);
      assert.equal(JSON.parse((await commands.execute(["status"])).stdout).run, null);
      assert.equal(f.captureExecutionIds.size, 0, "nested managed test commands have drained");
      assert.equal((await f.controller.launchStatus(f.sessionId)).activeTerminal, null, "nothing ran before: nothing runs after");
    };

    const result = await commands.execute(["--target", "parallel", "--workers", "2", "--identity", "tester",
      "test", "--grep", "parallel test"]);
    assert.match(result.stdout, /4 passed/u);
    assert.match(result.stdout + result.stderr, /runs this suite on 2 app servers, one per Playwright worker/u);
    const seen = await Promise.all([0, 1, 2, 3].map(async n => (
      JSON.parse(await readFile(path.join(f.sourceRoot, `parallel-seen-${n}.json`), "utf8")))));
    assert.deepEqual([...new Set(seen.map(({ worker }) => worker))].sort(), [0, 1], "both workers tested, each on its own server");
    await leftNothing(seen[0].targets);

    const launcher = commands.execute(["--target", "parallel", "--workers", "2", "--identity", "tester",
      "test", "--grep", "parallel slow"]);
    const cancellation = launcher.then(value => ({ value }), error => ({ error }));
    const marker = path.join(f.sourceRoot, "parallel-slow.json");
    for (let attempt = 0; attempt < 300 && !await readFile(marker, "utf8").catch(() => ""); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const { targets } = JSON.parse(await readFile(marker, "utf8"));
    const active = JSON.parse((await commands.execute(["status"])).stdout).run;
    assert.equal(active.targetId, "parallel");
    assert.ok(JSON.parse((await commands.execute(["cancel", active.id])).stdout).ok);
    assert.ok((await cancellation).error, "a cancelled run fails");
    for (let attempt = 0; attempt < 100 && f.commandService.playwrightStatus(f.sessionId).run; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await leftNothing(targets);
  });
});

test("a suite's own process, and its test target's identity command, open only its test-data target's databases, and none on development data, whatever the app's .env says", async t => {
  await runWithProjectRequestContext({ slug: "test-target" }, async () => {
    const f = await fixture(t, "database", { testBudget: () => 8, availableMemory: async () => 64 * 1024 ** 3 },
      { extraOutputs: parallelTarget });
    const commands = await browserCommands(f);
    // The session's development database, as its Env gives it and as Vibe64 writes it into the app's .env.
    const development = { DB_HOST: "127.0.0.1", DB_PORT: "3306", DB_USER: "session", DB_PASSWORD: "pw-session",
      DB_NAME: "session_dev", BROWSER_TEST_DB_NAME: "session_browser" };
    await writeFile(path.join(f.sourceRoot, ".env"), Object.entries(development).map(([key, value]) => `${key}=${value}\n`).join(""));
    const resources = [{ component: "app", resource: { id: "database", kind: "mysql", environmentAlternatives: [{ preferred: true,
      bindings: { database: "DB_NAME", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USER" } }],
    optionalBindings: { browserTestDatabase: "BROWSER_TEST_DB_NAME" } } }];
    // As the project's session environment answers (projectSessionEnvironment.js): its Env, for a suite its databases'.
    f.project.projectInspectionEnvironment = async (input) => input.browserSuiteData
      ? { ...development, ...browserSuiteDatabaseEnvironment(resources, development, { testData: input.browserSuiteData === "test" }) }
      : development;
    // A spec that opens the database as a fixture does through the app's knexfile, with .env loaded into its process.
    await writeFile(path.join(f.sourceRoot, "browser.spec.mjs"), `
import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
test('opens the database', async () => {
  process.loadEnvFile('.env');
  const { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, PLAYWRIGHT_PORT } = process.env;
  const reached = await lookup(DB_HOST).then(() => 'resolved', (error) => error.message);
  // The app server on PLAYWRIGHT_PORT, when the run names one: the target's own.
  const served = PLAYWRIGHT_PORT ? (await (await fetch('http://127.0.0.1:' + PLAYWRIGHT_PORT + '/test-state')).json()).mode : undefined;
  writeFileSync('database-opened.json', JSON.stringify({ DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, served, reached }));
});
`);
    const opened = async (args) => {
      await rm(path.join(f.sourceRoot, "database-opened.json"), { force: true });
      assert.match((await commands.execute(args)).stdout, /1 passed/u);
      return JSON.parse(await readFile(path.join(f.sourceRoot, "database-opened.json"), "utf8"));
    };
    // On a test-data target: its first app server's copy, on the session's server with its credentials, and the port
    // that server listens on.
    assert.deepEqual(await opened(["--target", "test-app", "test"]), {
      DB_HOST: "127.0.0.1", DB_NAME: "session_browser", DB_PASSWORD: "pw-session", DB_PORT: "3306", DB_USER: "session",
      served: "test-app", reached: "resolved"
    });
    // On development data, a named target's or the person's Preview: no database and no test server, and opening one
    // says why.
    for (const args of [["--target", "app", "test"], ["test"]]) {
      const none = await opened(args);
      assert.deepEqual({ ...none, reached: undefined }, {
        DB_HOST: "vibe64-no-database-in-browser-runs.invalid", DB_NAME: "vibe64_no_database_in_browser_runs",
        DB_PASSWORD: "vibe64_no_database_in_browser_runs", DB_PORT: "1", DB_USER: "vibe64_no_database_in_browser_runs",
        reached: undefined
      }, args.join(" "));
      assert.match(none.reached, /vibe64-no-database-in-browser-runs\.invalid/u, args.join(" "));
    }
    // A test-data target's identity command, which may open the database itself, opens its test database too.
    assert.match((await commands.execute(["--target", "authenticated-test", "--identity", "tester", "test"])).stdout,
      /1 passed/u);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.sourceRoot, "identity-database.json"), "utf8")),
      { DB_HOST: "127.0.0.1", DB_NAME: "session_browser" });

    // Two workers: each finds its own server's copy by PLAYWRIGHT_PORT, as JSKIT's browserTestConfig() does, and its
    // write lands there.
    await writeFile(path.join(f.sourceRoot, "playwright.config.mjs"), `
const targets = JSON.parse(process.env.PLAYWRIGHT_WORKER_TARGETS || '[]');
export default {
  testDir: '.', testMatch: 'browser.spec.mjs', workers: Math.max(1, targets.length), fullyParallel: true,
  reporter: 'line', timeout: 30000
};`);
    await writeFile(path.join(f.sourceRoot, "browser.spec.mjs"), `
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const targets = JSON.parse(process.env.PLAYWRIGHT_WORKER_TARGETS || '[]');
for (const n of [0, 1]) {
  test('writes its own copy ' + n, async ({ request }, testInfo) => {
    const worker = testInfo.parallelIndex;
    const port = Number(process.env.PLAYWRIGHT_PORT);
    expect(Number(new URL(targets[worker].baseURL).port)).toBe(port + worker);
    const { DB_NAME } = JSON.parse(readFileSync('.cache/workers-' + port + '.json', 'utf8'))[worker];
    const data = JSON.parse(readFileSync(DB_NAME, 'utf8'));
    writeFileSync(DB_NAME, JSON.stringify({ ...data, count: data.count + 100 }));
    const served = await (await request.get(new URL('worker', targets[worker].baseURL).href)).json();
    expect(served.worker).toBe(worker);
    expect(served.count).toBeGreaterThanOrEqual(100);
    writeFileSync('copy-written-' + n + '.json', JSON.stringify({ worker, port }));
  });
}
`);
    const written = await commands.execute(["--target", "parallel", "--workers", "2", "--identity", "tester", "test"]);
    assert.match(written.stdout, /2 passed/u);
    const writes = await Promise.all([0, 1].map(async n => JSON.parse(await readFile(path.join(f.sourceRoot, `copy-written-${n}.json`), "utf8"))));
    assert.equal(writes[0].port, writes[1].port, "one PLAYWRIGHT_PORT for the run: its first server's");
  });
});
