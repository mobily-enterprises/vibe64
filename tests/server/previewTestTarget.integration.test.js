import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { initializeGenesisProject, inspectVibe64Outputs, inspectVibe64WorkspaceSetup } from "../../packages/vibe64-genesis/src/server/index.js";
import { createOutputTargetTerminalController } from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";
import { createAgentPreviewCommandService, prepareAgentPreviewCommand } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { startTerminalSession } from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { runCaptureCommand, stopCaptureExecution } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import { runDetachedCommand, stopDetachedExecution } from "../../packages/vibe64-execution/src/server/engines/detached.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import { vibe64Driver } from "../../packages/vibe64-genesis/src/server/promptContext.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const browsersPath = path.dirname(path.dirname(path.dirname(chromium.executablePath())));

test("shared assistant instructions explain target discovery, safe setup, invocation and restoration", () => {
  const instructions = vibe64Driver({
    conversationKind: "main", scope: "session",
    session: { managedPreview: true, managedEnvironment: true, managedDatabaseRefresh: false, managedGit: false }
  });
  for (const required of [
    "vibe64-helper preview targets --json", "vibe64-helper playwright --target", "npm-run <script>",
    "restores the previous Preview", "application must verify the server's actual test database",
    "preview-identity command must use the same database", "Never spoof safety checks",
    "add one through the project's existing Outputs contract", "external-effect controls are missing"
  ]) assert.ok(instructions.includes(required), required);
});

async function fixture(t, name, workflowHooks = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `vibe64-test-target-${name}-`));
  const sessionId = `target-${name}`;
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  await mkdir(sourceRoot, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: sourceRoot });
  await initializeGenesisProject({ projectRoot: sourceRoot });
  const target = (id, mode = id) => `### Target \`${id}\`: ${id}
${id === "app" ? "- Default.\n" : ""}- Mode: \`interactive\`
- Runtimes: \`nodejs\`
- Run \`Start\`: \`node\` \`server.mjs\` \`${mode}\` \`{parameter:label}\`
#### Parameter \`label\`: Label
- Default: \`${id} default\`
- Required.
#### Presentation
- Kind: \`web\`
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
### Target \`terminal\`: terminal
- Mode: \`interactive\`
- Runtimes: \`nodejs\`
- Run \`Start\`: \`node\` \`server.mjs\` \`app\`
#### Presentation
- Kind: \`terminal\`
`);
  await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({
    type: "module", scripts: { e2e: "playwright test" }, devDependencies: { "@playwright/test": "1.61.1" }
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
import { readFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
const testData = JSON.parse(readFileSync('test.json', 'utf8'));
process.stdout.write(JSON.stringify({
  protocol: request.protocol, requestId: request.requestId, ok: true,
  identity: { userId: 'test-user', email: 'test@example.test' },
  setCookie: ['test_login=test-app-' + testData.count + '; Path=/; HttpOnly; SameSite=Lax']
}));
`);
  await chmod(path.join(sourceRoot, "tools/test-identity"), 0o755);
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
    async resolvePromptEnvironment() { return {}; },
    store: {
      async mutateSession(_id, operation) { return operation(); },
      async readMetadataValue(_id, key) { return session.metadata[key]; },
      async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
      async deleteMetadataValue(_id, key) { delete session.metadata[key]; }
    }
  };
  const projectService = {
    async createRuntime() { return runtime; },
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
    selectedProject: { slug: name }, targetRoot: sourceRoot
  };
  const captureExecutionIds = new Set();
  const previewStarts = [];
  const detached = new Set();
  const commandEnv = {
    ...process.env,
    NPM_CONFIG_PREFIX: path.join(root, "tools"),
    VIBE64_SHARED_CACHE_ROOT: path.join(root, "cache"),
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  };
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
        env: { ...commandEnv, ...input.env, VIBE64_EXECUTION_ID: id }
      });
    } finally {
      captureExecutionIds.delete(id);
    }
  };
  const controller = createOutputTargetTerminalController({ projectService, runCommand, ...workflowHooks });
  const commandService = createAgentPreviewCommandService({
    launchTarget: controller, runManagedCommand: runCommand,
    stopManagedExecution: stopDetachedExecution, readSessionUiState: () => null,
    resourceProvider: workflowHooks.resourceProvider,
    publishSessionChanged: workflowHooks.publishSessionChanged
  });
  t.after(async () => {
    for (const id of captureExecutionIds) await stopCaptureExecution(id);
    await controller.closeAllForSession(sessionId);
    await controller.close();
    await commandService.closeAllForSession(sessionId);
    for (const id of detached) await stopDetachedExecution(id);
    await rm(root, { recursive: true, force: true });
  });
  const command = args => commandService.run({ sessionId, args });
  const waitReady = async (terminal) => {
    for (let count = 0; count < 100; count++) {
      const status = await controller.launchStatus(sessionId);
      if (status.preview?.state === "ready") return status;
      if (status.ok === false || status.activeTerminal?.status === "exited") throw new Error(status.error || status.activeTerminal?.output || "Preview exited");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Preview ${terminal.id} did not become ready`);
  };
  return { root, sourceRoot, sessionId, controller, commandService, command, waitReady, captureExecutionIds, previewStarts };
}

async function browserCommands(f) {
  const runtimeRoot = path.join(f.root, "runtimes");
  const nodeBin = path.join(runtimeRoot, "node26/bin");
  const playwrightRoot = path.join(runtimeRoot, "playwright");
  await mkdir(nodeBin, { recursive: true });
  await symlink(process.execPath, path.join(nodeBin, "node"));
  await symlink(path.join(path.dirname(process.execPath), "npm"), path.join(nodeBin, "npm"));
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
    use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.VIBE64_PLAYWRIGHT_STORAGE_STATE || undefined }
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
  const prepared = await prepareAgentPreviewCommand({
    commandService: f.commandService, env: { VIBE64_RUNTIME_PACK_ROOT: runtimeRoot },
    project: { slug: "test-target" }, sessionId: f.sessionId,
    worktreePath: f.sourceRoot, wrapperHostDir: path.join(f.root, "commands")
  });
  return {
    execute(args) {
      const child = spawn(prepared.hostPlaywrightWrapperPath, args, {
        cwd: f.sourceRoot, detached: true,
        env: { ...process.env, ...prepared.env, VIBE64_EXECUTION_ID: "test-parent" },
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
        assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
      } finally { await browser.close(); }
    });
    for (const outcome of [
      { ok: false, exitCode: 17, error: "assertion failed" },
      { ok: false, exitCode: 1, signal: "SIGTERM", error: "cancelled" },
      { ok: false, exitCode: 1, timedOut: true, error: "timed out" }
    ]) {
      const result = await run(async () => outcome);
      assert.deepEqual(result, outcome);
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
    }
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
      assert.deepEqual(f.previewStarts.slice(startsBeforeSuite), ["test-app", "app"], "the whole suite switches once and restores once");
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
      await assert.rejects(commands.execute(["--target=test-app", "npm-run", "e2e", "--", "--grep", "intentional failure"]), error => {
        assert.match(error.stdout + error.stderr, /1 failed/u);
        return true;
      });
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");
      assert.equal(await readFile(path.join(f.sourceRoot, "working.json"), "utf8"), workingBytes);

      await assert.rejects(commands.execute(["--target", "test-app", "--identity", "guest", "test"]), error => {
        assert.match(error.stdout + error.stderr, /does not support application identity selection/u);
        return true;
      });
      assert.equal((await f.controller.launchStatus(f.sessionId)).lastOutputTarget.id, "app");

      const authenticated = await commands.execute(["--target", "authenticated-test", "--identity", "tester", "test", "--grep", "test target login"]);
      assert.match(authenticated.stdout, /1 passed/u);
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
        assert.match(error.stdout + error.stderr, /Could not restore Preview/u);
        return true;
      });
      const failed = JSON.parse((await commands.execute(["status"])).stdout).run;
      assert.equal(failed.state, "restore_failed");
      assert.equal((await f.command(["ensure", "--target", "app", "--json"])).ok, false);
      await rm(path.join(f.sourceRoot, "fail-normal-start"));
      assert.equal(JSON.parse((await commands.execute(["cancel", failed.id])).stdout).ok, true);
      assert.equal(JSON.parse((await commands.execute(["status"])).stdout).run, null);
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
  const restored = await f.controller.launchStatus(f.sessionId);
  assert.deepEqual(restored.activeTerminal.metadata.outputParameters, parameters);
  assert.deepEqual(restored.lastOutputTarget.outputParameters, parameters);
  const url = new URL(restored.previewTarget.href);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/parameter`;
  assert.equal(await (await fetch(url)).text(), parameters.label);
});
