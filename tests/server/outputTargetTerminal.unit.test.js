import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  commandWithHttpReadiness,
  createVibe64WebLaunchTargetTerminalSpec,
  httpReadinessProbeCommand
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  previewPublicSocketPath
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
import {
  createLaunchRestartBaseline,
  createOutputTargetTerminalController,
  launchRestartState,
  outputTargetExecutionDescriptor,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewPublicOriginForLaunch
} from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";
import {
  addGenesisStack,
  initializeGenesisProject,
  inspectVibe64WorkspaceSetup
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  closeTerminalSession,
  freezeTerminalNamespaceAdmission,
  readTerminalSession,
  startTerminalSession,
  thawTerminalNamespaceAdmission
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import {
  outputTargetTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  launchRestartRulesMatcher,
  launchRestartRulesMatcherSource
} from "../../packages/vibe64-core/src/server/launchRestartRules.js";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

const execFileAsync = promisify(execFile);

test("preview status, open, and identity selection reject frozen sessions before project access", async (t) => {
  let projectReads = 0;
  const frozen = {
    code: "vibe64_session_renewal_quiesced",
    error: "Session renewal has frozen preview access.",
    ok: false
  };
  const controller = createOutputTargetTerminalController({
    projectService: {
      async createRuntime() {
        projectReads += 1;
        throw new Error("Frozen preview must not read the project.");
      }
    },
    sessionAdmissionFailure() {
      return frozen;
    }
  });
  t.after(() => controller.close());

  const status = await controller.launchStatus("session-frozen");
  const start = await controller.startTerminal("session-frozen", { outputTargetId: "app" });
  const opened = await controller.openOutputTarget("session-frozen");
  const identity = await controller.selectPreviewIdentity("session-frozen", {
    identity: "guest"
  });

  assert.deepEqual(status, frozen);
  assert.deepEqual(start, frozen);
  assert.deepEqual(opened, frozen);
  assert.equal(identity.ok, false);
  assert.equal(identity.code, frozen.code);
  assert.equal(projectReads, 0);
});

test("output targets declare the managed workload kind independently of their PTY transport", () => {
  assert.deepEqual(outputTargetExecutionDescriptor({ label: "Build binary" }, {
    metadata: {
      outputMode: "finite",
      outputPresentationKind: "none"
    }
  }), {
    kind: "job",
    label: "Build binary"
  });
  assert.deepEqual(outputTargetExecutionDescriptor({ label: "Run CLI" }, {
    metadata: {
      outputMode: "interactive",
      outputPresentationKind: "terminal"
    }
  }), {
    kind: "terminal",
    label: "Run CLI"
  });
  assert.deepEqual(outputTargetExecutionDescriptor({ label: "Run app" }, {
    metadata: {
      outputMode: "interactive",
      outputPresentationKind: "web"
    }
  }), {
    kind: "preview",
    label: "Run app"
  });
});

test("HTTP launch readiness requires the declared exact success status", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/ready" ? 204 : 401);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const marker = "[[READY-EXACT]]";
    const command = httpReadinessProbeCommand({
      expectedStatus: 204,
      href: `http://127.0.0.1:${port}/ready`,
      marker,
      method: "GET",
      timeoutSeconds: 1
    });
    const { stdout } = await execFileAsync("bash", ["-lc", command]);
    assert.match(stdout, /\[\[READY-EXACT\]\]/u);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("HTTP launch readiness stops immediately when the server exits", async () => {
  let markLaunchStarted;
  const launchStarted = new Promise((resolve) => {
    markLaunchStarted = resolve;
  });
  const command = commandWithHttpReadiness({
    command: "printf '[[LAUNCH-STARTED]]\\n'; exit 23",
    expectedStatus: 200,
    href: "http://127.0.0.1:9/api/health",
    marker: "[[NEVER-READY]]",
    method: "GET",
    timeoutSeconds: 30
  });
  const completion = new Promise((resolve, reject) => {
    const child = execFile("bash", ["-lc", command], (error, stdout) => {
      if (error) {
        error.stdout = stdout;
        reject(error);
        return;
      }
      resolve({ stdout });
    });
    child.stdout.once("data", (chunk) => {
      assert.match(String(chunk), /\[\[LAUNCH-STARTED\]\]/u);
      markLaunchStarted();
    });
  });

  await launchStarted;
  const startedAt = Date.now();
  await assert.rejects(
    completion,
    (error) => {
      assert.equal(error.code, 23);
      assert.match(error.stdout, /\[\[LAUNCH-STARTED\]\]/u);
      return true;
    }
  );
  assert.ok(Date.now() - startedAt < 2_000);
});

async function runGit(cwd, args) {
  await execFileAsync("git", args, {
    cwd
  });
}

test("launch start awaits preparation, publishes hosted ingress, and cannot retain its preview child", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-workspace-"));
  const sessionId = "session-workspace";
  const projectContextRoot = path.join(root, "project-namespace");
  const previewSocketDir = path.join(root, "preview-sockets");
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  const sessionRoot = path.join(root, "state", sessionId);
  await mkdir(sourceRoot, {
    recursive: true
  });

  let controller;
  let releaseLaunchCleanupPublication = () => null;
  try {
    await runGit(sourceRoot, ["init", "--initial-branch=main"]);
    await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({
      scripts: {
        develop: "node server.js"
      }
    }, null, 2));
    await initializeGenesisProject({
      projectRoot: sourceRoot
    });
    await addGenesisStack({
      pieces: ["jskit"],
      projectRoot: sourceRoot
    });
    const stackPath = path.join(sourceRoot, "genesis", "stack.md");
    const stack = await readFile(stackPath, "utf8");
    const outputsStart = stack.indexOf("## Outputs\n");
    const outputsEnd = stack.indexOf("\n## ", outputsStart + 1);
    assert.notEqual(outputsStart, -1);
    assert.notEqual(outputsEnd, -1);
    await writeFile(
      stackPath,
      `${stack.slice(0, outputsStart)}## Outputs\n\n### Target \`app\`: Run app\n\n- Default.\n- Mode: \`interactive\`\n- Runtimes: \`nodejs\`\n- Run \`Develop\`: \`npm\` \`run\` \`develop\`\n\n#### Presentation\n\n- Kind: \`web\`\n- Preferred port: \`3000\`\n- URL path: \`/\`\n- Ready when: \`GET\` \`/api/health\` returns \`200\`\n${stack.slice(outputsEnd)}`,
      "utf8"
    );
    const currentSetup = await inspectVibe64WorkspaceSetup({
      environment: {},
      projectRoot: sourceRoot
    });
    assert.equal(currentSetup.status, "ready");

    const session = {
      metadata: {
        source_kind: "session_clone",
        source_path: sourceRoot,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      sessionId,
      sessionRoot,
      sourceInspection: null,
      targetRoot: sourceRoot,
      workspaceSetup: {
        recipeHash: "sha256:retired-contract",
        status: "succeeded"
      }
    };
    const events = [];
    const workflowStarts = [];
    const workflowPhases = [];
    const workflowFinishes = [];
    let workflowRejection = null;
    let finishPreparation;
    let preparationStarted;
    const preparationStartedPromise = new Promise((resolve) => {
      preparationStarted = resolve;
    });
    const preparationCompletion = new Promise((resolve) => {
      finishPreparation = resolve;
    });
    let previewIdentityInput = null;
    let environmentPreparations = 0;
    let blockProjectEnvironment = false;
    let capturedLaunchExecution = null;
    let capturedLaunchProject = null;
    let capturedLaunchTerminal = null;
    let cleanupTerminalId = "terminal-workspace";
    let holdLaunchCleanupPublication = false;
    let projectEnvironmentStarted = null;
    let releaseProjectEnvironment = null;
    let changeStackDuringEnvironment = null;
    let changeStackDuringAdmission = null;
    const launchCleanupPublication = new Promise((resolve) => {
      releaseLaunchCleanupPublication = resolve;
    });
    const runtime = {
      async resolvePromptEnvironment() { return {}; },
      async getSession() {
        return session;
      },
      store: {
        async deleteMetadataValue() {},
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async readMetadataValue(_sessionId, name) {
          return name === "output_target_terminal_id" ? cleanupTerminalId : "";
        },
        async writeMetadataValue() {
          return null;
        }
      }
    };
    const projectService = {
      async createRuntime() {
        return runtime;
      },
      currentServiceDataRoot() {
        return path.join(root, "service");
      },
      currentTargetRoot() {
        return projectContextRoot;
      },
      async projectExecutionEnvironment() {
        environmentPreparations += 1;
        return {};
      },
      async projectInspectionEnvironment(input) {
        if (blockProjectEnvironment) {
          projectEnvironmentStarted?.();
          await new Promise((resolve) => {
            releaseProjectEnvironment = resolve;
          });
        }
        if (input.includeResourceConfiguration) await changeStackDuringEnvironment?.();
        return input.includeResourceConfiguration
          ? { environment: {}, resourceConfigurationFingerprint: "a".repeat(64) }
          : {};
      },
      async readPreviewApplicationIdentities(input) {
        previewIdentityInput = input;
        return {
          identities: [],
          ok: true
        };
      },
      selectedProject: {},
      targetRoot: projectContextRoot
    };
    controller = createOutputTargetTerminalController({
      async startWorkflow(input) {
        workflowStarts.push(input);
        await changeStackDuringAdmission?.();
        if (workflowRejection) return workflowRejection;
        return { ok: true, workflow: { id: `workflow-${workflowStarts.length}` } };
      },
      async setWorkflowPhase(id, phase) { workflowPhases.push({ id, phase }); },
      async finishWorkflow(id, options) { workflowFinishes.push({ id, ...options }); },
      env: {
        VIBE64_PREVIEW_PROXY_SOCKET_DIR: previewSocketDir,
        VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
        VIBE64_PUBLIC_PROTOCOL: "https",
        VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev",
        VIBE64_WORKSPACE: "merc"
      },
      async ensureWorkspacePrepared() {
        events.push("prepare-started");
        preparationStarted();
        return {
          completion: preparationCompletion.then(() => {
            session.workspaceSetup = {
              recipeHash: currentSetup.recipeHash,
              status: "succeeded"
            };
            events.push("prepare-completed");
            return session.workspaceSetup;
          })
        };
      },
      projectService,
      async publishSessionChanged(_sessionId, event = {}) {
        if (holdLaunchCleanupPublication && event.reason === "output-target-stale-cleared") {
          await launchCleanupPublication;
        }
      },
      async runCommand(input) {
        events.push("launch-started");
        assert.equal(session.workspaceSetup.recipeHash, currentSetup.recipeHash);
        capturedLaunchExecution = input.execution;
        capturedLaunchProject = input.project;
        capturedLaunchTerminal = input.terminal;
        return {
          id: "terminal-workspace",
          metadata: {
            ...input.terminal.metadata,
            launchReady: true
          },
          ok: true,
          running: true,
          status: "running"
        };
      }
    });

    const starting = runWithProjectRequestContext({
      slug: "launch-project",
      targetRoot: projectContextRoot
    }, () => controller.startTerminal(sessionId, {
      outputTargetId: "app"
    }));
    await preparationStartedPromise;
    let closeFinished = false;
    const closing = controller.closeAllForSession(sessionId).then((result) => {
      closeFinished = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeFinished, false);
    finishPreparation();

    const terminal = await starting;
    await closing;

    assert.equal(terminal.ok, true, JSON.stringify(terminal));
    assert.equal(capturedLaunchProject.slug, "launch-project");
    assert.deepEqual(capturedLaunchExecution, {
      kind: "preview",
      label: "Run app",
      workflowId: "workflow-1"
    });
    assert.deepEqual(workflowStarts[0].operation, { kind: "output", targetId: "app" });
    assert.equal(workflowStarts[0].sourceRoot, sourceRoot);
    assert.equal(workflowStarts[0].environment, "development");
    assert.equal(workflowStarts[0].configuration.environmentFingerprint, "a".repeat(64));
    assert.equal(workflowStarts[0].configuration.mode, "interactive");
    assert.deepEqual(workflowStarts[0].steps, [{ argv: ["npm", "run", "develop"], role: "run", workdir: "." }]);
    assert.deepEqual(workflowPhases, [{ id: "workflow-1", phase: "running" }]);
    assert.deepEqual(previewIdentityInput, {
      sessionId
    });
    assert.deepEqual(events, [
      "prepare-started",
      "prepare-completed",
      "launch-started"
    ]);
    const readyTerminal = await controller.startTerminal(sessionId, {
      outputTargetId: "app"
    });
    const previewPublicOrigin = readyTerminal.metadata.previewPublicOrigin;
    assert.match(previewPublicOrigin, /^https:\/\/v64preview-[a-z0-9]{12}--merc\.vibe64\.dev$/u);
    assert.equal(existsSync(previewPublicSocketPath(previewPublicOrigin, {
      VIBE64_PREVIEW_PROXY_SOCKET_DIR: previewSocketDir
    })), true);

    const environmentStarted = new Promise((resolve) => {
      projectEnvironmentStarted = resolve;
    });
    blockProjectEnvironment = true;
    const preparationsBeforeStatus = environmentPreparations;
    const status = controller.launchStatus(sessionId);
    await environmentStarted;
    const namespace = outputTargetTerminalNamespace(sessionId);
    const owner = "session-renewal:preview-status";
    assert.deepEqual(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen preview access.",
      owner
    }), {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    });
    blockProjectEnvironment = false;
    releaseProjectEnvironment();
    assert.equal((await status).ok, true);
    assert.equal(environmentPreparations, preparationsBeforeStatus);
    assert.equal(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen preview access.",
      owner
    }).ok, true);
    assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);

    assert.equal(typeof capturedLaunchTerminal?.onStop, "function");
    assert.equal(typeof capturedLaunchTerminal?.onClose, "function");
    holdLaunchCleanupPublication = true;
    const realLaunchTerminal = startTerminalSession({
      args: [
        "-lc",
        `"${process.execPath}" -e 'process.stdin.resume(); setInterval(() => {}, 1000);' & ` +
          "child=$!; printf 'SHELL:%s CHILD:%s\\n' \"$$\" \"$child\"; wait \"$child\""
      ],
      command: "bash",
      commandPreview: "bash launch cleanup deadline",
      metadata: readyTerminal.metadata,
      namespace,
      onClose: capturedLaunchTerminal.onClose,
      onStop: capturedLaunchTerminal.onStop
    });
    cleanupTerminalId = realLaunchTerminal.id;
    await waitForLaunchTest(() => /SHELL:\d+ CHILD:\d+/u.test(
      readTerminalSession(realLaunchTerminal.id, { namespace }).output
    ));
    const launchProcessIds = /SHELL:(\d+) CHILD:(\d+)/u.exec(
      readTerminalSession(realLaunchTerminal.id, { namespace }).output
    ).slice(1).map(Number);

    const startsBeforeReuse = workflowStarts.length;
    const reused = await controller.startTerminal(sessionId, { outputTargetId: "app", ensurePreview: true });
    assert.equal(reused.id, realLaunchTerminal.id, JSON.stringify(reused));
    assert.equal(workflowStarts.length, startsBeforeReuse, "reusing the ready preview does not create another accounting group");

    await assert.rejects(
      closeTerminalSession(realLaunchTerminal.id, {
        namespace,
        timeoutMs: 400
      }),
      (error) => {
        assert.equal(error.code, "terminal_cleanup_failed");
        assert.equal(error.errors.some((failure) => (
          failure.code === "terminal_stop_hook_timeout" ||
          failure.code === "terminal_close_hook_timeout"
        )), true);
        return true;
      }
    );
    await waitForLaunchTest(() => launchProcessIds.every((pid) => !processIsAlive(pid)));

    releaseLaunchCleanupPublication();
    assert.equal((await closeTerminalSession(realLaunchTerminal.id, {
      namespace,
      timeoutMs: 400
    })).closed, true);
    assert.equal(workflowFinishes.some((item) => item.id === "workflow-2" && item.outcome === "stopped" && item.defer), true);

    const declaredStack = await readFile(stackPath, "utf8");
    const stackChanges = [
      ["command", declaredStack.replace("`npm` `run` `develop`", "`npm` `run` `serve`")],
      ["target identity with the same label", declaredStack.replace("Target `app`", "Target `other`")],
      ["workspace setup", declaredStack.replace(/## Workspace setup\n[\s\S]*?(?=\n## |$)/u, "## Workspace setup\n\n- Nothing.\n")],
      ["resource estimates", `${declaredStack.replace(/## Resource estimates\n[\s\S]*?(?=\n## |$)/u, "")}\n## Resource estimates\n\n### Output \`app\`\n- Startup typical MiB: \`128\`\n- Startup high MiB: \`256\`\n- Running typical MiB: \`64\`\n- Running high MiB: \`128\`\n`]
    ];
    for (const [phase, name, changedStack] of ["environment preparation", "admission"].flatMap((phase) =>
      stackChanges.map(([name, changedStack]) => [phase, name, changedStack]))) {
      await t.test(`launch rejects stale ${name} after ${phase}`, async () => {
        assert.notEqual(changedStack, declaredStack);
        const startsBeforeChange = workflowStarts.length;
        const finishesBeforeChange = workflowFinishes.length;
        const commandsBeforeChange = events.filter((event) => event === "launch-started").length;
        if (phase === "environment preparation") changeStackDuringEnvironment = () => writeFile(stackPath, changedStack);
        else changeStackDuringAdmission = () => writeFile(stackPath, changedStack);
        try {
          const stale = await controller.startTerminal(sessionId, { outputTargetId: "app", forceRestart: true });
          assert.equal(stale.ok, false);
          assert.equal(stale.code, "VIBE64_STACK_CHANGED");
          assert.match(stale.error, /Stack changed.*Retry/u);
          assert.equal(workflowStarts.length, startsBeforeChange + (phase === "admission" ? 1 : 0));
          if (phase === "admission") assert.deepEqual(workflowFinishes.slice(finishesBeforeChange), [{
            id: `workflow-${workflowStarts.length}`, outcome: "failed", defer: true
          }]);
          assert.equal(events.filter((event) => event === "launch-started").length, commandsBeforeChange);
          const diagnostic = JSON.parse(await readFile(path.join(sessionRoot, "preview-last.json"), "utf8"));
          assert.equal(diagnostic.error.code, "VIBE64_STACK_CHANGED");
          assert.equal(diagnostic.reason, "terminal_start_failed");
        } finally {
          changeStackDuringEnvironment = null;
          changeStackDuringAdmission = null;
          await writeFile(stackPath, declaredStack);
        }
      });
    }

    workflowRejection = {
      ok: false, code: "vibe64_capacity_rejected", error: "The preview fits only with reduced peak headroom.",
      admission: { id: crypto.randomUUID(), outcome: "tight", availableBytes: 1600 * 1024 ** 2, actions: ["start-anyway"] }
    };
    const commandsBeforeRefusal = events.filter((event) => event === "launch-started").length;
    const refusal = await controller.startTerminal(sessionId, { outputTargetId: "app", forceRestart: true });
    assert.equal(refusal.ok, false);
    assert.equal(refusal.code, "vibe64_capacity_rejected");
    assert.deepEqual(refusal.details.admission, workflowRejection.admission);
    assert.equal(events.filter((event) => event === "launch-started").length, commandsBeforeRefusal);
    const diagnostic = JSON.parse(await readFile(path.join(sessionRoot, "preview-last.json"), "utf8"));
    assert.equal(diagnostic.error.resourceAdmissionId, workflowRejection.admission.id);
    assert.equal(diagnostic.reason, "terminal_start_failed");
    const refusedStatus = await controller.launchStatus(sessionId);
    assert.equal(refusedStatus.resourceAdmissionId, workflowRejection.admission.id);
    assert.equal(refusedStatus.preview.state, "failed");
    assert.equal(refusedStatus.preview.message, workflowRejection.error);
    for (const stale of [
      { ...diagnostic, sessionId: "another-session" },
      { ...diagnostic, outputTargetId: "removed-target" },
      { ...diagnostic, status: "ready" },
      { ...diagnostic, error: { ...diagnostic.error, resourceAdmissionId: "invalid" } }
    ]) {
      await writeFile(path.join(sessionRoot, "preview-last.json"), JSON.stringify(stale));
      assert.equal((await controller.launchStatus(sessionId)).resourceAdmissionId, undefined);
    }
    await writeFile(path.join(sessionRoot, "preview-last.json"), "{broken");
    assert.equal((await controller.launchStatus(sessionId)).resourceAdmissionId, undefined);
  } finally {
    releaseLaunchCleanupPublication?.();
    await controller?.close();
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

async function waitForLaunchTest(predicate, {
  intervalMs = 25,
  timeoutMs = 2000
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.fail("Timed out waiting for launch terminal state.");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function createLaunchSpecFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-spec-"));
  const sessionId = `session-${crypto.randomUUID()}`;
  const sessionRoot = path.join(root, "state", "sessions", "active", sessionId);
  const worktree = path.join(root, "managed-source", "sessions", "active", sessionId, "source");
  await mkdir(worktree, {
    recursive: true
  });
  return {
    cleanup: () => rm(root, {
      force: true,
      recursive: true
    }),
    session: {
      completedSteps: ["source_created"],
      metadata: {
        source_kind: "session_clone",
        source_path: worktree,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      sessionId,
      sessionRoot,
      targetRoot: worktree
    },
    targetRoot: worktree
  };
}

function previewIdentityCapability() {
  return {
    command: ["tools/preview-identity"],
    environment: {
      enabled: "APP_PREVIEW_IDENTITY_ENABLED",
      secret: "APP_PREVIEW_IDENTITY_SECRET"
    },
    identityTypes: ["email", "user-id"],
    protocol: "vibe64.preview-identity.command.v1",
    runtimes: ["node26"]
  };
}

async function installPreviewIdentityExecutable(targetRoot, {
  includeExecutable = true
} = {}) {
  if (!includeExecutable) {
    return;
  }
  const executablePath = path.join(targetRoot, "tools", "preview-identity");
  await mkdir(path.dirname(executablePath), {
    recursive: true
  });
  await writeFile(executablePath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(executablePath, 0o755);
}

test("serialized launch restart rules use the canonical matcher", () => {
  const generatedMatcherFactory = Function(
    `"use strict";\n${launchRestartRulesMatcherSource()}\nreturn vibe64LaunchRestartRulesMatcher;`
  )();
  const rules = {
    exclude: ["node_modules/**", ".git/**"],
    include: ["src/**/*.server.js", "server/**", ".env.*"]
  };
  const canonicalMatcher = launchRestartRulesMatcher(rules);
  const generatedMatcher = generatedMatcherFactory(rules);
  const paths = [
    "src/direct.server.js",
    "src/nested/direct.server.js",
    "src/page.js",
    "server/routes/index.js",
    ".env.local",
    "node_modules/server/index.js",
    ".git/server/index.js"
  ];

  assert.deepEqual(paths.map(generatedMatcher), paths.map(canonicalMatcher));
});

function createSpec({
  launch = {},
  preferredPort,
  session,
  targetRoot
}) {
  return createVibe64WebLaunchTargetTerminalSpec({
    launchTarget: {
      id: "dev",
      label: "Run app"
    },
    preferredPort,
    resolveLaunch: async () => ({
      command: "node -e \"setInterval(() => {}, 1000)\"",
      env: {
        APP_PUBLIC_URL: "http://localhost:4100",
        AUTH_SUPABASE_PUBLISHABLE_KEY: "pk_test_value",
        DB_PASSWORD: "database-password",
        VISIBLE_VALUE: "visible"
      },
      ...launch,
      waitForReadiness: false
    }),
    session,
    targetRoot
  });
}

test("web launch resolves preview identity from the explicit launch declaration", async () => {
  const fixture = await createLaunchSpecFixture();
  let spec;
  try {
    await installPreviewIdentityExecutable(fixture.targetRoot);
    spec = await createSpec({
      launch: {
        previewIdentity: previewIdentityCapability()
      },
      preferredPort: 47000 + crypto.randomInt(500),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.previewAuth, "application-command");
    assert.deepEqual(spec.metadata.previewIdentity.command, ["tools/preview-identity"]);
    assert.deepEqual(spec.metadata.previewIdentity.identityTypes, ["email", "user-id"]);
    assert.equal(spec.metadata.previewIdentity.sourceRoot, fixture.targetRoot);
    const env = spec.env({ id: "terminal-preview-identity" });
    assert.equal(env.APP_PREVIEW_IDENTITY_ENABLED, "true");
    assert.match(env.APP_PREVIEW_IDENTITY_SECRET, /^[a-f0-9]{64}$/u);
    assert.equal(env.VIBE64_PREVIEW_IDENTITY_ENABLED, undefined);
    assert.equal(env.VIBE64_PREVIEW_IDENTITY_SECRET, undefined);
  } finally {
    spec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

test("preview identity exchange does not reload or provision the project environment", async () => {
  const fixture = await createLaunchSpecFixture();
  let spec;
  try {
    await installPreviewIdentityExecutable(fixture.targetRoot);
    spec = await createSpec({
      launch: {
        previewIdentity: previewIdentityCapability()
      },
      preferredPort: 47000 + crypto.randomInt(500),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });
    const terminalId = "terminal-preview-identity";
    spec.env({ id: terminalId });
    let invocation;
    const runner = previewIdentityCommandRunnerForLaunchTerminal({
      context: {
        projectContextRoot: fixture.targetRoot,
        session: fixture.session,
        targetRoot: fixture.targetRoot
      },
      runCommand: async (input) => {
        invocation = input;
        const request = JSON.parse(input.input);
        return {
          ok: true,
          stdout: JSON.stringify({
            identity: {
              email: "ada@example.com",
              userId: "42"
            },
            ok: true,
            protocol: request.protocol,
            requestId: request.requestId,
            setCookie: ["app_session=native-session; Path=/; HttpOnly; SameSite=Lax"],
            signedOut: false
          })
        };
      },
      targetHref: "http://127.0.0.1:4100/home",
      terminal: {
        id: terminalId,
        metadata: spec.metadata
      }
    });

    assert.equal(typeof runner, "function");
    const result = await runner({
      operation: "login-as",
      selector: {
        type: "email",
        value: "ada@example.com"
      }
    });
    assert.deepEqual(Object.keys(invocation.env).sort(), [
      "APP_PREVIEW_IDENTITY_ENABLED",
      "APP_PREVIEW_IDENTITY_SECRET"
    ]);
    assert.deepEqual(invocation.project.runtimeConfigEnv, {});
    assert.equal(result.identity.email, "ada@example.com");
  } finally {
    spec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

test("web launch rejects a declared preview identity without its executable", async () => {
  const fixture = await createLaunchSpecFixture();
  try {
    await installPreviewIdentityExecutable(fixture.targetRoot, {
      includeExecutable: false
    });
    const spec = await createSpec({
      launch: {
        previewIdentity: previewIdentityCapability()
      },
      preferredPort: 47500 + crypto.randomInt(500),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(spec.ok, false);
    assert.match(spec.message, /missing or is not executable/u);
  } finally {
    await fixture.cleanup();
  }
});

test("web launch rejects preview identity executable symlinks", async () => {
  const fixture = await createLaunchSpecFixture();
  try {
    await installPreviewIdentityExecutable(fixture.targetRoot, {
      includeExecutable: false
    });
    const executablePath = path.join(fixture.targetRoot, ".vibe64", "bin", "preview-identity");
    const externalExecutable = path.join(path.dirname(fixture.targetRoot), "external-preview-identity");
    await mkdir(path.dirname(executablePath), {
      recursive: true
    });
    await writeFile(externalExecutable, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(externalExecutable, 0o755);
    await symlink(externalExecutable, executablePath);

    const spec = await createSpec({
      launch: {
        previewIdentity: previewIdentityCapability()
      },
      preferredPort: 47500 + crypto.randomInt(500),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(spec.ok, false);
    assert.match(spec.message, /missing or is not executable/u);
  } finally {
    await fixture.cleanup();
  }
});

test("web launch rejects conflicting preview identity and preview authentication declarations", async () => {
  const fixture = await createLaunchSpecFixture();
  try {
    const spec = await createSpec({
      launch: {
        previewAuth: "cookie-profile",
        previewIdentity: previewIdentityCapability()
      },
      preferredPort: 46500 + crypto.randomInt(500),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(spec.ok, false);
    assert.match(spec.message, /cannot combine/u);
  } finally {
    await fixture.cleanup();
  }
});

test("preview public origin maps user Studio hosts to the app preview domain", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {},
    publicHost: "massimo.users.vibe64.dev",
    sessionId: "2026-06-19_14-44-21",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^https:\/\/v64preview-[a-z0-9]{12}--massimo\.vibe64\.dev$/u);
  assert.equal(publicOrigin.includes(".users.vibe64.dev"), false);
});

test("preview public origin follows the Studio HTTPS protocol by default", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
      VIBE64_PUBLIC_PROTOCOL: "https",
      VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev"
    },
    publicHost: "pass.users.vibe64.dev",
    publicProtocol: "https",
    sessionId: "2026-07-10_05-25-34",
    targetHref: "http://127.0.0.1:4102/",
    terminalSessionId: "preview-terminal"
  });

  assert.match(publicOrigin, /^https:\/\/v64preview-[a-z0-9]{12}--pass\.vibe64\.dev$/u);
});

test("preview public origin uses hosted workspace configuration without a request host", () => {
  const env = {
    VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
    VIBE64_PUBLIC_PROTOCOL: "https",
    VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev",
    VIBE64_WORKSPACE: "pass"
  };
  const sessionId = "2026-07-10_05-25-34";

  assert.equal(
    previewPublicOriginForLaunch({ env, sessionId }),
    previewPublicOriginForLaunch({
      env,
      publicHost: "pass.users.vibe64.dev",
      sessionId
    })
  );
});

test("preview public origin rejects invalid hosted workspace configuration", () => {
  assert.equal(previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
      VIBE64_PUBLIC_PROTOCOL: "https",
      VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev",
      VIBE64_WORKSPACE: "invalid.workspace"
    },
    sessionId: "2026-07-10_05-25-34"
  }), "");
});

test("preview public origin follows the configured public protocol", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
      VIBE64_PREVIEW_PUBLIC_PROTOCOL: "http",
      VIBE64_PUBLIC_PROTOCOL: "https",
      VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev"
    },
    publicHost: "massimo.users.vibe64.dev",
    sessionId: "2026-06-19_14-44-21",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^https:\/\/v64preview-[a-z0-9]{12}--massimo\.vibe64\.dev$/u);
});

test("preview public origin stays stable across terminal restarts", () => {
  const input = {
    env: {},
    publicHost: "massimo.users.vibe64.dev",
    sessionId: "2026-06-19_14-44-21"
  };

  assert.equal(
    previewPublicOriginForLaunch({
      ...input,
      targetHref: "http://127.0.0.1:4100/home",
      terminalSessionId: "terminal-one"
    }),
    previewPublicOriginForLaunch({
      ...input,
      targetHref: "http://127.0.0.1:4999/home",
      terminalSessionId: "terminal-two"
    })
  );
});

test("preview public origin supports explicit localhost hosted routing config", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {},
    previewPublicDomain: "localhost:3000",
    publicHost: "merc.users.localhost:3000",
    publicProtocol: "http",
    publicUserDomain: "users.localhost:3000",
    sessionId: "2026-07-07_12-20-30",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^http:\/\/v64preview-[a-z0-9]{12}--merc\.localhost:3000$/u);
  assert.equal(publicOrigin.includes(".users.localhost"), false);
});

test("preview public origin supports env-driven localhost hosted routing config", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "localhost:3000",
      VIBE64_PUBLIC_PROTOCOL: "http",
      VIBE64_PUBLIC_USER_DOMAIN: "users.localhost:3000"
    },
    publicHost: "merc.users.localhost:3000",
    sessionId: "2026-07-07_12-21-30",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^http:\/\/v64preview-[a-z0-9]{12}--merc\.localhost:3000$/u);
});

test("preview public origin isolates localhost instances by public port", () => {
  const input = {
    env: {
      VIBE64_PUBLIC_PROTOCOL: "http"
    },
    publicProtocol: "http",
    sessionId: "2026-07-07_12-21-30"
  };
  const port3000Origin = previewPublicOriginForLaunch({
    ...input,
    publicHost: "merc.users.localhost:3000"
  });
  const port3001Origin = previewPublicOriginForLaunch({
    ...input,
    publicHost: "merc.users.localhost:3001"
  });

  assert.notEqual(new URL(port3000Origin).hostname, new URL(port3001Origin).hostname);
  assert.match(port3000Origin, /^http:\/\/v64preview-[a-z0-9]{12}--merc\.localhost:3000$/u);
  assert.match(port3001Origin, /^http:\/\/v64preview-[a-z0-9]{12}--merc\.localhost:3001$/u);
});

test("web launch target port allocation reserves ports during concurrent spec creation", async () => {
  const fixture = await createLaunchSpecFixture();
  const preferredPort = 48000 + crypto.randomInt(1000);
  let firstSpec;
  let secondSpec;
  let releasedSpec;

  try {
    [firstSpec, secondSpec] = await Promise.all([
      createSpec({
        preferredPort,
        session: fixture.session,
        targetRoot: fixture.targetRoot
      }),
      createSpec({
        preferredPort,
        session: fixture.session,
        targetRoot: fixture.targetRoot
      })
    ]);

    assert.equal(firstSpec.ok, true);
    assert.equal(secondSpec.ok, true);
    assert.notEqual(firstSpec.metadata.port, secondSpec.metadata.port);

    const firstPort = firstSpec.metadata.port;
    firstSpec.releasePortReservation();
    secondSpec.releasePortReservation();

    releasedSpec = await createSpec({
      preferredPort: firstPort,
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(releasedSpec.ok, true);
    assert.equal(releasedSpec.metadata.port, firstPort);
  } finally {
    firstSpec?.releasePortReservation?.();
    secondSpec?.releasePortReservation?.();
    releasedSpec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

test("web launch target passes resolved env to the host launch command and redacts command preview", async () => {
  const fixture = await createLaunchSpecFixture();
  let spec;

  try {
    spec = await createSpec({
      preferredPort: 49000 + crypto.randomInt(1000),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(spec.ok, true);
    const agentTarget = new URL(spec.metadata.agentTargetHref);
    assert.equal(agentTarget.hostname, "127.0.0.1");
    assert.equal(agentTarget.port, String(spec.metadata.port));
    assert.equal(agentTarget.pathname, "/");
    assert.equal(spec.command, "bash");
    assert.equal(spec.metadata.terminalOwner.ownerScope, "app");
    assert.equal(spec.metadata.terminalOwner.ownerUserKey, "launch-target");
    assert.equal(spec.metadata.terminalGithubActor.scope, "none");
    assert.equal(spec.metadata.terminalGithubActor.reason, "launch-target");
    const env = spec.env({
      id: "terminal-1"
    });
    assert.equal(env.VIBE64_LAUNCH_AGENT_HOST, "127.0.0.1");
    assert.equal(env.VIBE64_LAUNCH_AGENT_HREF, spec.metadata.agentTargetHref);
    assert.equal(env.APP_PUBLIC_URL, "http://localhost:4100");
    assert.equal(env.AUTH_SUPABASE_PUBLISHABLE_KEY, "pk_test_value");
    assert.equal(env.DB_PASSWORD, "database-password");
    assert.equal(env.VISIBLE_VALUE, "visible");
    const args = spec.args({
      id: "terminal-1"
    });

    assert.ok(args.join("\n").includes("HOST=127.0.0.1"));
    assert.ok(args.join("\n").includes(`PORT=${spec.metadata.port}`));
    assert.equal(args.includes("APP_PUBLIC_URL=http://localhost:4100"), false);
    assert.equal(args.includes("AUTH_SUPABASE_PUBLISHABLE_KEY=pk_test_value"), false);
    assert.equal(args.includes("DB_PASSWORD=database-password"), false);
    assert.equal(args.includes(`VIBE64_LAUNCH_AGENT_HREF=${spec.metadata.agentTargetHref}`), false);
    assert.equal(args.includes("VISIBLE_VALUE=visible"), false);

    const commandPreview = spec.commandPreview;
    assert.match(commandPreview, /node -e/u);
    assert.doesNotMatch(commandPreview, /database-password/u);
    assert.doesNotMatch(commandPreview, /pk_test_value/u);
  } finally {
    spec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

test("launch restart state marks relevant server file changes stale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-restart-"));
  try {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["config", "user.email", "vibe64@example.test"]);
    await runGit(root, ["config", "user.name", "Vibe64 Test"]);
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await mkdir(path.join(root, "src"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");
    await writeFile(path.join(root, "src", "page.vue"), "<template>One</template>\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Initial app"]);

    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**", "src/**/*.server.js"],
        label: "server files"
      },
      worktreePath: root
    });

    await writeFile(path.join(root, "src", "page.vue"), "<template>Two</template>\n");
    assert.equal((await launchRestartState({
      baseline,
      worktreePath: root
    })).stale, false);

    await writeFile(path.join(root, "src", "direct.server.js"), "export const server = true;\n");
    const directServerState = await launchRestartState({
      baseline,
      worktreePath: root
    });
    assert.equal(directServerState.stale, true);
    assert.deepEqual(directServerState.changedFiles, ["src/direct.server.js"]);

    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Add direct server file"]);
    const committedDirectServerBaseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**", "src/**/*.server.js"],
        label: "server files"
      },
      worktreePath: root
    });

    await writeFile(path.join(root, "server", "app.js"), "export const value = 2;\n");
    const staleState = await launchRestartState({
      baseline: committedDirectServerBaseline,
      worktreePath: root
    });
    assert.equal(staleState.stale, true);
    assert.deepEqual(staleState.changedFiles, ["server/app.js"]);
    assert.equal(staleState.reason, "server_source_changed");
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("launch restart state ignores commits of launch-time dirty server content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-restart-dirty-"));
  try {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["config", "user.email", "vibe64@example.test"]);
    await runGit(root, ["config", "user.name", "Vibe64 Test"]);
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Initial app"]);

    await writeFile(path.join(root, "server", "app.js"), "export const value = 2;\n");
    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"],
        label: "server files"
      },
      worktreePath: root
    });

    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Commit launch-time content"]);
    assert.equal((await launchRestartState({
      baseline,
      worktreePath: root
    })).stale, false);

    await writeFile(path.join(root, "server", "app.js"), "export const value = 3;\n");
    const staleState = await launchRestartState({
      baseline,
      worktreePath: root
    });
    assert.equal(staleState.stale, true);
    assert.deepEqual(staleState.changedFiles, ["server/app.js"]);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("launch restart state detects first commits that change launch-time server content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-restart-unborn-"));
  try {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["config", "user.email", "vibe64@example.test"]);
    await runGit(root, ["config", "user.name", "Vibe64 Test"]);
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");
    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"],
        label: "server files"
      },
      worktreePath: root
    });

    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Commit launch-time content"]);
    assert.equal((await launchRestartState({
      baseline,
      worktreePath: root
    })).stale, false);

    await writeFile(path.join(root, "server", "app.js"), "export const value = 2;\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Change server content"]);
    const staleState = await launchRestartState({
      baseline,
      worktreePath: root
    });
    assert.equal(staleState.stale, true);
    assert.deepEqual(staleState.changedFiles, ["server/app.js"]);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("launch restart baseline is unavailable outside git worktrees", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-no-git-"));
  try {
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");

    assert.equal(await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"]
      },
      worktreePath: root
    }), null);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
