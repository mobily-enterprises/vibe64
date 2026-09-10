import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  AGENT_PLAYWRIGHT_COMMAND_NAME,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
} from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";

const execFileAsync = promisify(execFile);

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function createRuntime(runtimeRoot, version, {
  current = false
} = {}) {
  const runtimePath = current
    ? path.join(runtimeRoot, "playwright")
    : path.join(runtimeRoot, "playwright-versions", version);
  await mkdir(path.join(runtimePath, "browsers"), {
    recursive: true
  });
  await writeExecutable(path.join(runtimePath, "bin", "playwright"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(runtimePath, "runtime.env"), `playwright_version=${version}\n`, "utf8");
  return runtimePath;
}

async function createProject(projectRoot, version) {
  const packageRoot = path.join(projectRoot, "node_modules", "@playwright", "test");
  await mkdir(packageRoot, {
    recursive: true
  });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    devDependencies: {
      "@playwright/test": version
    },
    scripts: {
      e2e: "playwright test"
    }
  }), "utf8");
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    version
  }), "utf8");
  await writeFile(path.join(packageRoot, "cli.js"), [
    "const { existsSync, readFileSync } = require(\"node:fs\");",
    "const storageStatePath = process.env.VIBE64_PLAYWRIGHT_STORAGE_STATE || \"\";",
    "process.stdout.write(JSON.stringify({",
    "  args: process.argv.slice(2),",
    "  baseUrl: process.env.PLAYWRIGHT_BASE_URL,",
    "  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,",
    "  managed: process.env.VIBE64_MANAGED_PLAYWRIGHT_TEST,",
    "  skipDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD,",
    "  storageState: storageStatePath && existsSync(storageStatePath)",
    "    ? JSON.parse(readFileSync(storageStatePath, \"utf8\"))",
    "    : null,",
    "  storageStateExists: Boolean(storageStatePath && existsSync(storageStatePath)),",
    "  storageStatePath",
    "}));"
  ].join("\n") + "\n", "utf8");
}

function authenticatedStorageState(identity = "default") {
  return {
    cookies: [{
      domain: "127.0.0.1",
      expires: -1,
      httpOnly: true,
      name: "app_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: identity
    }],
    origins: []
  };
}

async function writeAuthenticatedPreviewWrapper(wrapperPath, previewUrl, managedNpmPath) {
  await writeExecutable(wrapperPath, [
    "#!/usr/bin/env node",
    "const { spawnSync } = require(\"node:child_process\");",
    "const { writeFileSync } = require(\"node:fs\");",
    `const previewUrl = ${JSON.stringify(previewUrl)};`,
    `const managedNpmPath = ${JSON.stringify(managedNpmPath)};`,
    "const args = process.argv.slice(2);",
    "if (args[0] === \"playwright-run\" && [\"node\", \"npm\"].includes(args[1])) {",
    "  const command = args[1] === \"node\" ? process.execPath : managedNpmPath;",
    "  const result = spawnSync(command, args.slice(2), { cwd: process.cwd(), env: process.env, stdio: \"inherit\" });",
    "  process.exit(Number.isInteger(result.status) ? result.status : 1);",
    "}",
    "if (args[0] === \"ensure\") {",
    "  process.stdout.write(JSON.stringify({",
    "    endpoints: { agent: { url: previewUrl } },",
    "    identityTypes: [\"email\"],",
    "    ready: true",
    "  }));",
    "  process.exit(0);",
    "}",
    "if (args[0] === \"browser\" && args[1] === \"storage-state\" && args[2]) {",
    "  const identity = args[2];",
    `  const storageState = ${authenticatedStorageState.toString()}(identity);`,
    "  const outputIndex = args.indexOf(\"--output\");",
    "  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : \"\";",
    "  if (!outputPath) process.exit(64);",
    "  writeFileSync(outputPath, JSON.stringify(storageState) + \"\\n\", { flag: \"wx\", mode: 0o600 });",
    "  process.stdout.write(JSON.stringify({ outputPath }));",
    "  process.exit(0);",
    "}",
    "process.exit(64);"
  ].join("\n") + "\n");
}

async function prepareFixture(root, projectVersion, runtimeVersion = projectVersion, {
  previewFailure = "",
  previewUrl = "http://127.0.0.1:4104/home",
  withPreviewTarget = null,
  resourceProvider,
  publishSessionChanged
} = {}) {
  const runtimeRoot = path.join(root, "runtime-packs");
  const projectRoot = path.join(root, "project");
  await createProject(projectRoot, projectVersion);
  await createRuntime(runtimeRoot, runtimeVersion);
  await createRuntime(runtimeRoot, runtimeVersion, {
    current: true
  });
  await writeExecutable(
    path.join(runtimeRoot, "node26", "bin", "node"),
    `#!/bin/sh\nexec ${process.execPath} "$@"\n`
  );
  await writeExecutable(
    path.join(runtimeRoot, "node26", "bin", "npm"),
    [
      "#!/usr/bin/env node",
      "const { existsSync, readFileSync } = require(\"node:fs\");",
      "const storageStatePath = process.env.VIBE64_PLAYWRIGHT_STORAGE_STATE || \"\";",
      "process.stdout.write(JSON.stringify({",
      "  args: process.argv.slice(2),",
      "  baseUrl: process.env.PLAYWRIGHT_BASE_URL,",
      "  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,",
      "  managed: process.env.VIBE64_MANAGED_PLAYWRIGHT_TEST,",
      "  skipDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD,",
      "  storageState: storageStatePath && existsSync(storageStatePath)",
      "    ? JSON.parse(readFileSync(storageStatePath, \"utf8\"))",
      "    : null,",
      "  storageStateExists: Boolean(storageStatePath && existsSync(storageStatePath)),",
      "  storageStatePath",
      "}));"
    ].join("\n") + "\n"
  );
  const commandService = createAgentPreviewCommandService({
    resourceProvider,
    publishSessionChanged,
    launchTarget: {
      withPreviewTarget,
      previewTestRunAdmission() { return null; },
      async ensurePreview() {
        return previewFailure
          ? {
              error: previewFailure,
              ok: false
            }
          : {
              id: "managed-preview-terminal"
            };
      },
      async launchStatus() {
        return {
          activeTerminal: {
            id: "managed-preview-terminal",
            running: true,
            status: "running"
          },
          lastOutputTarget: {
            agentHref: previewUrl,
            id: "dev"
          },
          previewTarget: {
            available: true,
            href: previewUrl
          }
        };
      }
    },
    readSessionUiState: () => null,
    runManagedCommand(input = {}) {
      managedCommands.push(input);
      return new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, {
          cwd: input.cwd,
          env: {
            ...process.env,
            ...input.env,
            VIBE64_EXECUTION_ID: "fixture-child-execution"
          },
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          input.onOutput?.(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          input.onOutput?.(chunk);
        });
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({
          error: exitCode === 0 ? "" : stderr,
          execution: input.execution,
          exitCode: Number.isInteger(exitCode) ? exitCode : 1,
          ok: exitCode === 0 && !signal,
          output: stdout + stderr,
          signal,
          stderr,
          stdout
        }));
      });
    }
  });
  const managedCommands = [];
  const prepared = await prepareAgentPreviewCommand({
    commandService,
    env: {
      VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
    },
    project: {
      slug: "example"
    },
    sessionId: `playwright-${projectVersion}`,
    worktreePath: projectRoot,
    wrapperHostDir: path.join(root, "commands")
  });
  prepared.env.VIBE64_EXECUTION_ID = "assistant-execution";
  return {
    commandService,
    managedCommands,
    prepared,
    projectRoot,
    runtimeRoot
  };
}

test("managed Playwright target selection crosses the real wrapper/socket boundary before test preparation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-target-"));
  let active = false;
  const selected = [];
  const fixture = await prepareFixture(root, "1.61.1", "1.61.1", {
    async withPreviewTarget(sessionId, targetId, operation, { waitUntilReady }) {
      assert.equal(sessionId, "playwright-1.61.1");
      assert.equal(active, false);
      selected.push(targetId);
      active = true;
      try {
        await waitUntilReady({ id: "managed-preview-terminal" });
        return await operation("fixture-target-run");
      } finally {
        active = false;
      }
    }
  });
  t.after(async () => {
    await fixture.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, { recursive: true, force: true });
  });
  const options = { cwd: fixture.projectRoot, env: { ...process.env, ...fixture.prepared.env } };
  for (const args of [
    ["--target", "test-app", "test", "--grep", "checkout"],
    ["--target=test-app", "npm-run", "e2e", "--", "--grep", "checkout"]
  ]) {
    const result = JSON.parse((await execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, args, options)).stdout);
    assert.equal(result.baseUrl, "http://127.0.0.1:4104");
    assert.equal(active, false);
  }
  assert.deepEqual(selected, ["test-app", "test-app"]);
  assert.deepEqual(fixture.managedCommands.map((request) => request.execution.kind), ["control", "browser", "control", "browser"]);
  assert.equal(fixture.managedCommands[0].command, fixture.managedCommands[1].command);
  assert.equal(fixture.managedCommands[0].args[0], fixture.prepared.hostPlaywrightWrapperPath);
  assert.equal(fixture.managedCommands[1].env.PLAYWRIGHT_BASE_URL, "http://127.0.0.1:4104");

  for (const args of [
    ["--target", "test-app", "--target", "app", "test"],
    ["--target", "../app", "test"],
    ["--target", "test"],
    ["--target", "test-app", "status"],
    ["--target", "test-app", "install"],
    ["--target", "test-app", "npm-run", "missing"]
  ]) {
    await assert.rejects(execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, args, options));
  }
  await assert.rejects(execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["--target", "test-app", "test"], {
    ...options, env: { ...options.env, PLAYWRIGHT_BASE_URL: "https://production.example" }
  }), /own managed Preview URL/u);
  assert.deepEqual(selected, ["test-app", "test-app"]);
});

function approvalCommand(command, args, options) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ ok: code === 0 && !signal, stdout, stderr, code, signal }));
  });
  return { child, completion };
}

test("memory approval retains the original live command across the real wrapper/socket boundary", async (t) => {
  for (const action of ["accept", "start-failure", "cancel", "expire", "disconnect", "script-change", "session-close", "control-release", "release-during-resume", "generation-change"]) {
    await t.test(action, { timeout: 15_000 }, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-approval-"));
      const admissionId = randomUUID();
      const waiting = Promise.withResolvers();
      const authorizing = Promise.withResolvers();
      const authorizeGate = Promise.withResolvers();
      const ended = [];
      const selected = [];
      let approvals = 0;
      let fixture;
      fixture = await prepareFixture(root, "1.61.1", "1.61.1", {
        resourceProvider: () => ({
          async beginWorkflowApprovalWait(input) {
            assert.equal(input.admissionId, admissionId);
            assert.equal(input.parentExecutionId, "assistant-execution");
            assert.match(input.controlGenerationId, /^[a-f0-9-]{36}$/u);
            assert.equal(selected.length, 1, "wait begins after the first target attempt returns");
            return { expiresAt: new Date(Date.now() + (action === "expire" ? 100 : 300_000)).toISOString() };
          },
          async endWorkflowApprovalWait(input) { ended.push(input); }
        }),
        async publishSessionChanged(sessionId) {
          if (fixture?.commandService.testApprovalStatus(sessionId)?.state === "waiting") waiting.resolve();
        },
        async withPreviewTarget(sessionId, targetId, operation, { startTarget = (start) => start() }) {
          selected.push(targetId);
          if (selected.length === 1) return { ok: false, code: "vibe64_capacity_rejected", error: "Tight memory.",
            details: { admission: { id: admissionId, outcome: "tight", actions: ["start-anyway"] } } };
          await startTarget(() => { approvals += 1; });
          if (action === "start-failure") return { ok: false, exitCode: 1,
            code: "vibe64_command_failed", error: "The approved test target failed to start." };
          return operation("fixture-approved-run");
        }
      });
      const sessionId = "playwright-1.61.1";
      t.after(async () => {
        await fixture.commandService.closeAllForSession(sessionId);
        await rm(root, { recursive: true, force: true });
      });
      const command = approvalCommand(fixture.prepared.hostPlaywrightWrapperPath, ["--target", "test-app", "npm-run", "e2e"], {
        cwd: fixture.projectRoot, env: { ...process.env, ...fixture.prepared.env }
      });
      const completion = command.completion;
      await waiting.promise;
      assert.equal(fixture.managedCommands.length, 0, "no test preparation or browser starts while waiting");
      const identity = { projectSlug: "example", sessionId, admissionId };
      const wrong = await fixture.commandService.resumeTestApproval({ ...identity, projectSlug: "other" }, () => assert.fail());
      assert.equal(wrong.ok, false);
      assert.equal(fixture.commandService.testApprovalStatus(sessionId).state, "waiting");
      if (["accept", "start-failure", "script-change", "release-during-resume"].includes(action)) {
        if (action === "script-change") await writeFile(path.join(fixture.projectRoot, "package.json"), JSON.stringify({ scripts: { e2e: "playwright test changed" } }));
        let authorized = 0;
        const authorize = async (start) => {
          authorized += 1;
          if (action === "release-during-resume") {
            authorizing.resolve();
            await authorizeGate.promise;
          }
          return start();
        };
        const accepted = await Promise.all([
          fixture.commandService.resumeTestApproval(identity, authorize),
          fixture.commandService.resumeTestApproval(identity, authorize)
        ]);
        assert.ok(accepted.every((result) => result.accepted));
        if (action === "release-during-resume") {
          await authorizing.promise;
          assert.equal(fixture.commandService.testApprovalStatus(sessionId).state, "resuming");
          const released = fixture.commandService.releaseControlForSession(sessionId);
          authorizeGate.resolve();
          await released;
        }
        const result = await completion;
        assert.equal(result.ok, action === "accept");
        assert.equal(authorized, action === "script-change" ? 0 : 1);
        if (action === "accept") assert.match(result.stdout, /"managed":"1"/u);
        else if (action === "start-failure") {
          assert.match(result.stdout, /Waiting for memory approval/u);
          assert.match(result.stderr, /The approved test target failed to start\./u);
          assert.equal(fixture.managedCommands.length, 0, "failed target startup must not run tests");
        }
        else if (action === "script-change") assert.match(result.stderr, /script changed/u);
      } else if (action === "cancel") {
        assert.equal(fixture.commandService.cancelTestApproval(identity).ok, true);
      } else if (action === "disconnect") process.kill(-command.child.pid, "SIGTERM");
      else if (action === "session-close") await fixture.commandService.closeAllForSession(sessionId);
      else if (action === "control-release") await fixture.commandService.releaseControlForSession(sessionId);
      else if (action === "generation-change") fixture.commandService.registerBrowserWorker(sessionId, {
        socketPath: fixture.prepared.hostBrowserSocketPath,
        metadataPath: fixture.prepared.hostBrowserMetadataPath,
        worktreePath: fixture.projectRoot,
        controlGenerationId: randomUUID(), token: randomUUID()
      });
      const result = await completion;
      // A disconnected shell can exit before the server has observed its socket
      // closure. Closing this exact session drains that original command too.
      if (action === "disconnect") await fixture.commandService.closeAllForSession(sessionId);
      assert.equal(result.ok, action === "accept");
      assert.equal(approvals, ["accept", "start-failure"].includes(action) ? 1 : 0);
      assert.equal(fixture.commandService.testApprovalStatus(sessionId), null);
      assert.equal(ended.length, 1);
      assert.equal(ended[0].outcome, ["accept", "start-failure"].includes(action) ? "resumed" : action === "cancel" ? "cancelled" : action === "expire" ? "expired" : "interrupted");
      assert.equal((await fixture.commandService.resumeTestApproval(identity, () => assert.fail())).ok, false, "finished requests cannot replay");
    });
  }
});

test("managed Playwright test command uses the exact versioned browser runtime without downloads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-command-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1");
    assert.equal(path.basename(fixture.prepared.hostPlaywrightWrapperPath), AGENT_PLAYWRIGHT_COMMAND_NAME);
    const status = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["status"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-override"
        }
      }
    )).stdout);
    assert.equal(status.version, "1.61.1");
    assert.equal(status.applicationRoot, fixture.projectRoot);
    assert.equal(Object.hasOwn(status, "projectRoot"), false);
    assert.equal(
      status.browsersPath,
      path.join(fixture.runtimeRoot, "playwright-versions", "1.61.1", "browsers")
    );

    const executed = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "checkout"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env,
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-override",
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0",
          VIBE64_PLAYWRIGHT_STORAGE_STATE: "/tmp/stale-managed-state.json"
        }
      }
    )).stdout);
    assert.deepEqual(executed.args, ["test", "--grep", "checkout"]);
    assert.equal(executed.baseUrl, "http://127.0.0.1:4104");
    assert.equal(
      executed.browsersPath,
      path.join(fixture.runtimeRoot, "playwright-versions", "1.61.1", "browsers")
    );
    assert.equal(executed.managed, "1");
    assert.equal(executed.skipDownload, "1");
    assert.equal(executed.storageStatePath, "");

    const npmRun = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["npm-run", "e2e", "--", "--grep", "settings"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.deepEqual(npmRun.args, ["run", "e2e", "--", "--grep", "settings"]);
    assert.equal(npmRun.baseUrl, "http://127.0.0.1:4104");

    assert.equal(fixture.managedCommands.length, 2);
    for (const request of fixture.managedCommands) {
      assert.equal(request.execution.kind, "browser");
      assert.equal(request.execution.label, "Browser testing");
      assert.equal(request.execution.lifecycle, "finite");
      assert.equal(request.execution.parentExecutionId, "assistant-execution");
      assert.equal(request.execution.projectSlug, "example");
      assert.equal(request.execution.sessionId, "playwright-1.61.1");
      assert.equal(request.timeout, 30 * 60 * 1000);
    }
    const explicit = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "override"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env,
          PLAYWRIGHT_BASE_URL: "http://127.0.0.1:6200/custom",
          VIBE64_PLAYWRIGHT_STORAGE_STATE: "/tmp/explicit-state.json"
        }
      }
    )).stdout);
    assert.equal(explicit.baseUrl, "http://127.0.0.1:6200/custom");
    assert.equal(explicit.storageStatePath, "/tmp/explicit-state.json");

    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, [
        "--identity",
        "compas-owner@example.com",
        "test"
      ], {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: "http://127.0.0.1:6200/custom"
        }
      }),
      /Explicit Playwright application identity requires the Vibe64-managed preview/iu
    );
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed Playwright supplies and removes authenticated browser state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-auth-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1");
    await writeAuthenticatedPreviewWrapper(
      fixture.prepared.hostWrapperPath,
      "http://127.0.0.1:4104/home",
      path.join(fixture.runtimeRoot, "node26", "bin", "npm")
    );
    const expectedState = authenticatedStorageState("default");

    const executed = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "authenticated"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.equal(executed.storageStateExists, true);
    assert.deepEqual(executed.storageState, expectedState);
    await assert.rejects(access(executed.storageStatePath), {
      code: "ENOENT"
    });

    const explicitIdentity = "admin";
    const explicit = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["--identity", explicitIdentity, "test", "--grep", "expanded jobs"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.deepEqual(explicit.args, ["test", "--grep", "expanded jobs"]);
    assert.deepEqual(explicit.storageState, authenticatedStorageState(explicitIdentity));
    await assert.rejects(access(explicit.storageStatePath), {
      code: "ENOENT"
    });

    const npmRun = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["--identity=app-user-42", "npm-run", "e2e"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.equal(npmRun.storageStateExists, true);
    assert.deepEqual(npmRun.storageState, authenticatedStorageState("app-user-42"));
    assert.notEqual(npmRun.storageStatePath, executed.storageStatePath);
    await assert.rejects(access(npmRun.storageStatePath), {
      code: "ENOENT"
    });
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed Playwright test command reports a managed-preview blocker before starting tests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-preview-blocker-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1", "1.61.1", {
      previewFailure: "managed preview did not become ready"
    });
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["test"], {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }),
      /could not prepare the managed preview.+Project tests were not started.+managed preview did not become ready/isu
    );
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed Playwright preserves browser startup diagnostics without claiming an authentication failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-browser-blocker-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1");
    await writeExecutable(fixture.prepared.hostWrapperPath, `#!/usr/bin/env node
if (process.argv[2] === "ensure") {
  console.log(JSON.stringify({
    ready: true,
    endpoints: { agent: { url: "http://127.0.0.1:4104/home" } },
    identityTypes: ["email"]
  }));
} else {
  console.error("The managed browser socket still has an unverified listener; no replacement was started.");
  process.exit(1);
}
`);
    await assert.rejects(execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["test"], {
      cwd: fixture.projectRoot,
      env: { ...process.env, ...fixture.prepared.env }
    }), (error) => {
      assert.match(error.stderr, /could not prepare the managed browser and application identity/iu);
      assert.match(error.stderr, /unverified listener/iu);
      assert.doesNotMatch(error.stderr, /could not authenticate/iu);
      return true;
    });
    assert.equal(fixture.managedCommands.length, 0);
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, { force: true, recursive: true });
  }
});

test("managed Playwright test command refuses mismatched runtimes and browser installation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-mismatch-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.62.0", "1.61.1");
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["test"], {
        cwd: fixture.projectRoot
      }),
      /requires Playwright 1\.62\.0.*does not provide its matching managed browser runtime/isu
    );

    await createRuntime(fixture.runtimeRoot, "1.62.0");
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["install", "chromium"], {
        cwd: fixture.projectRoot
      }),
      /Browser installation is never permitted/iu
    );
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.62.0");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
