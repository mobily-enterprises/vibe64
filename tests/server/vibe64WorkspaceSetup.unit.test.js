import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH,
  WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER,
  workspaceSetupState,
  workspaceSetupStateFromMetadata
} from "@local/vibe64-runtime/server/workspaceSetupState";
import {
  createWorkspaceSetupRunner,
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS
} from "../../packages/vibe64-terminals/src/server/workspaceSetup.js";
import {
  initializeGenesisProject,
  inspectVibe64WorkspaceSetup
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function workspaceSession(targetRoot, sessionId = "workspace-session") {
  const sourceRoot = sourcePath(targetRoot, sessionId);
  await mkdir(path.join(sourceRoot, "web"), {
    recursive: true
  });
  const runtime = new Vibe64SessionRuntime({
    promptEnvironment: {
      VIBE64_RUNTIME_PACK_ROOT: "/managed/runtime-packs"
    },
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot)
  });
  await runtime.store.createSession({
    metadata: sourceMetadata(targetRoot, sessionId),
    runtimeKind: "genesis",
    sessionId
  });
  return {
    runtime,
    session: await runtime.store.readSession(sessionId),
    sourceRoot
  };
}

function readySetup(overrides = {}) {
  return {
    components: ["jskit"],
    diagnostics: [],
    recipeHash: "sha256:recipe",
    runtimeRequirements: ["nodejs"],
    source: "project",
    stackHash: "sha256:stack",
    status: "ready",
    steps: [{
      argv: ["npm", "install"],
      label: "Install JavaScript dependencies",
      runtimeRequirements: ["nodejs"],
      workdir: "."
    }],
    ...overrides
  };
}

test("workspace preparation executes declared argv in order through the managed gateway", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session, sourceRoot } = await workspaceSession(targetRoot);
    const calls = [];
    const workflowCalls = [];
    const workflowId = "7abcf25f-8c93-4965-91ac-7f6c866ad39b";
    const runner = createWorkspaceSetupRunner({
      async startWorkflow(input) {
        workflowCalls.push(input);
        assert.equal(calls.length, 0);
        return { ok: true, workflow: { id: workflowId } };
      },
      async finishWorkflow(id, options) {
        workflowCalls.push({ id, ...options });
        assert.equal(calls.length, 2);
      },
      inspect: () => readySetup({
        steps: [{
          argv: ["composer", "install", "--no-interaction"],
          label: "Install PHP dependencies",
          runtimeRequirements: ["composer", "php"],
          workdir: "."
        }, {
          argv: ["npm", "install"],
          label: "Install JavaScript dependencies",
          runtimeRequirements: ["nodejs"],
          workdir: "web"
        }]
      }),
      projectService: {
        async projectExecutionEnvironment(input) {
          assert.equal(input.includeResourceConfiguration, true);
          return {
            environment: { PROJECT_SETTING: "configured-secret-value" },
            resourceConfigurationFingerprint: "b".repeat(64)
          };
        }
      },
      async runCommand(request) {
        calls.push(request);
        return {
          exitCode: 0,
          ok: true,
          output: request.command === "composer"
            ? "Downloading PHP packages\nconfigured-secret-value\n"
            : "Installing JavaScript packages\nAPI_TOKEN=raw-token\n"
        };
      }
    });

    const started = await runner.start({ runtime, session });
    assert.equal(started.state.status, "running");
    assert.match(started.state.transcript, /\[Install PHP dependencies\] Running\./u);
    assert.equal(runner.isRunning(session.sessionId), true);
    assert.equal(await runner.wait(session.sessionId), await started.completion);
    assert.equal(runner.isRunning(session.sessionId), false);

    assert.equal(workflowCalls.length, 2);
    assert.deepEqual(workflowCalls[0].operation, { kind: "workspace-setup" });
    assert.equal(workflowCalls[0].sourceRoot, sourceRoot);
    assert.deepEqual(workflowCalls[0].configuration, { environmentFingerprint: "b".repeat(64) });
    assert.equal(JSON.stringify(workflowCalls).includes("configured-secret-value"), false);
    assert.deepEqual(workflowCalls[0].steps, [
      { argv: ["composer", "install", "--no-interaction"], workdir: "." },
      { argv: ["npm", "install"], workdir: "web" }
    ]);
    assert.deepEqual(workflowCalls[0].runtimes, ["node26", "composer", "php"]);
    assert.equal(workflowCalls[0].env.VIBE64_RUNTIME_PACK_ROOT, "/managed/runtime-packs");
    assert.deepEqual(workflowCalls[1], { id: workflowId, outcome: "succeeded", defer: true });

    assert.deepEqual(calls.map(({ command, args, cwd }) => ({ args, command, cwd })), [{
      args: ["install", "--no-interaction"],
      command: "composer",
      cwd: sourceRoot
    }, {
      args: ["install"],
      command: "npm",
      cwd: path.join(sourceRoot, "web")
    }]);
    for (const call of calls) {
      assert.equal(call.execution.workflowId, workflowId);
      assert.equal(call.execution.sessionId, session.sessionId);
      assert.equal(call.actor, "app");
      assert.equal(call.envPolicy, "project");
      assert.deepEqual(call.allowedRoots, [sourceRoot]);
      assert.deepEqual(call.project.runtimeConfigEnv, {
        PROJECT_SETTING: "configured-secret-value"
      });
      assert.equal(Object.hasOwn(call.project, "databaseEnv"), false);
      assert.deepEqual(call.runtimes, ["node26", "composer", "php"]);
      assert.equal(call.timeout, WORKSPACE_SETUP_COMMAND_TIMEOUT_MS);
    }

    const stored = workspaceSetupStateFromMetadata(
      (await runtime.store.readSession(session.sessionId)).metadata
    );
    assert.equal(stored.status, "succeeded");
    assert.equal(stored.currentLabel, "Install JavaScript dependencies");
    assert.equal(stored.recipeHash, "sha256:recipe");
    assert.equal(stored.diagnostic, "");
    assert.match(stored.transcript, /\[Install PHP dependencies\] Running\./u);
    assert.match(stored.transcript, /Downloading PHP packages/u);
    assert.match(stored.transcript, /\[Install JavaScript dependencies\] Succeeded\./u);
    assert.match(stored.transcript, /Workspace preparation succeeded\./u);
    assert.doesNotMatch(stored.transcript, /configured-secret-value|raw-token|--no-interaction/u);
    assert.match(stored.transcript, /\[redacted\]/u);
  });
});

for (const [phase, change] of ["environment preparation", "admission"].flatMap((phase) =>
  ["command", "removed setup", "estimates", "removed estimates", "invalid estimates"].map((change) => [phase, change]))) {
  test(`workspace preparation rechecks ${change} after ${phase} before execution`, async () => {
    await withTemporaryRoot(async (targetRoot) => {
      const { runtime, session, sourceRoot } = await workspaceSession(targetRoot);
      await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: sourceRoot });
      await initializeGenesisProject({ projectRoot: sourceRoot });
      const stackPath = path.join(sourceRoot, "genesis/stack.md");
      const setup = "- Prepare `Prepare app` with `nodejs`: `node` `before.js`";
      const estimates = "## Resource estimates\n\n### Workspace setup\n- Typical MiB: `128`\n- High MiB: `256`\n";
      const original = `# Stack\n\n## Components\n\n## Workspace setup\n\n${setup}\n\n${estimates}`;
      const updated = change === "command" ? original.replace("`before.js`", "`after.js`")
        : change === "removed setup" ? original.replace(setup, "- Nothing.")
        : change === "estimates" ? original.replace("`256`", "`512`")
        : change === "removed estimates" ? original.replace(estimates, "")
        : original.replace("`256`", "`invalid`");
      await writeFile(stackPath, original);
      const initial = await inspectVibe64WorkspaceSetup({ projectRoot: sourceRoot });
      assert.equal(initial.status, "ready");
      assert.equal(initial.resourceEstimates.status, "ready");
      let environmentCalls = 0;
      const admissions = [];
      const commands = [];
      const finishes = [];
      const workflowId = "4c6a4b6c-1fde-4364-9f48-5b1cafb2535c";
      const runner = createWorkspaceSetupRunner({
        projectService: {
          async projectExecutionEnvironment() {
            environmentCalls += 1;
            if (phase === "environment preparation") await writeFile(stackPath, updated);
            return { environment: {}, resourceConfigurationFingerprint: "a".repeat(64) };
          }
        },
        async startWorkflow(input) {
          admissions.push(input);
          if (phase === "admission") await writeFile(stackPath, updated);
          return { ok: true, workflow: { id: workflowId } };
        },
        async finishWorkflow(id, options) { finishes.push({ id, ...options }); },
        async runCommand(input) {
          commands.push(input);
          return { ok: true, exitCode: 0 };
        }
      });
      const result = await (await runner.start({ runtime, session })).completion;
      assert.equal(environmentCalls, 1, "Reinspection must not repeat environment provisioning.");
      assert.equal(await readFile(stackPath, "utf8"), updated);
      if (phase === "admission" || change === "command" || change === "removed setup") {
        assert.equal(result.status, "failed");
        assert.match(result.diagnostic, /Workspace setup changed.*Retry/iu);
        assert.equal(result.recipeHash, initial.recipeHash);
        assert.equal(admissions.length, phase === "admission" ? 1 : 0);
        assert.deepEqual(finishes, phase === "admission" ? [{ id: workflowId, outcome: "failed", defer: true }] : [],
          "A source change during admission releases the unused workflow.");
        assert.equal(commands.length, 0);
        assert.equal(runner.isRunning(session.sessionId), false);
        if (change === "command") {
          const retried = await runner.start({
            runtime,
            session: await runtime.getSession(session.sessionId, { inspectSource: false }),
            retry: true
          });
          assert.equal((await retried.completion).status, "succeeded");
          assert.equal(commands.length, 1);
          assert.deepEqual(commands[0].args, ["after.js"]);
          assert.deepEqual(admissions.at(-1).steps, [{ argv: ["node", "after.js"], workdir: "." }]);
        }
      } else {
        assert.equal(result.status, "succeeded", result.diagnostic);
        assert.equal(result.recipeHash, initial.recipeHash, "Optional estimates do not change the setup recipe.");
        assert.equal(admissions.length, 1);
        assert.equal(commands.length, 1);
        const current = await inspectVibe64WorkspaceSetup({ projectRoot: sourceRoot });
        assert.deepEqual(admissions[0].estimates, current.resourceEstimates);
        assert.notDeepEqual(admissions[0].estimates, initial.resourceEstimates);
        assert.deepEqual(admissions[0].steps, [{ argv: ["node", "before.js"], workdir: "." }]);
        assert.deepEqual(commands[0].args, ["before.js"]);
      }
    });
  });
}

test("source invalidation survives restart and reruns an unchanged preparation recipe", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let installs = 0;
    const options = {
      inspect: () => readySetup(),
      projectService: {},
      async runCommand() { installs += 1; return { ok: true }; }
    };
    const runner = createWorkspaceSetupRunner(options);
    await (await runner.start({ runtime, session })).completion;
    const prepared = await runtime.getSession(session.sessionId, { inspectSource: false });
    assert.equal(await runner.isPrepared({ runtime, session: prepared }), true);
    assert.equal((await runner.start({ runtime, session: prepared })).completion, null);

    await runner.invalidate({ runtime, session: prepared, diagnostic: "Source updated; preparation is required." });
    const restored = await runtime.getSession(session.sessionId, { inspectSource: false });
    const restartedRunner = createWorkspaceSetupRunner(options);
    assert.equal(restored.workspaceSetup.status, "required");
    assert.equal(await restartedRunner.isPrepared({ runtime, session: restored }), false);
    assert.equal((await (await restartedRunner.start({ runtime, session: restored })).completion).status, "succeeded");
    assert.equal(installs, 2);

    const current = await runtime.getSession(session.sessionId, { inspectSource: false });
    await (await restartedRunner.start({ runtime, session: current, retry: true })).completion;
    assert.equal(installs, 3, "Explicit preparation retries must also repair a previously successful installation.");
  });
});

test("workspace preparation state bounds and normalizes durable transcripts", () => {
  const oldState = workspaceSetupStateFromMetadata({
    workspace_setup: JSON.stringify({
      currentLabel: "Install dependencies",
      recipeHash: "sha256:old-shape",
      status: "succeeded"
    })
  });
  assert.equal(oldState.transcript, "");

  const bounded = workspaceSetupState({
    status: "running",
    transcript: `\u001b[31m${"x".repeat(WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH * 2)}tail\u001b[0m`
  });
  assert.equal(bounded.transcript.length, WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH);
  assert.equal(bounded.transcript.startsWith(WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER), true);
  assert.equal(bounded.transcript.endsWith("tail"), true);
  assert.equal(bounded.transcript.includes("\u001b"), false);
});

test("resource refusal preserves its decision identity across reload and clears it after successful preparation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    const id = "cc295f04-3870-4020-9352-900f872848eb";
    let rejected = true;
    let commands = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(), projectService: {},
      async startWorkflow() {
        return rejected ? { ok: false, code: "vibe64_capacity_rejected", error: "Insufficient peak headroom.", admission: { id } }
          : { ok: true, workflow: null };
      },
      async runCommand() { commands += 1; return { ok: true, exitCode: 0, output: "Prepared." }; }
    });
    const state = await (await runner.start({ runtime, session })).completion;
    assert.equal(state.status, "failed");
    assert.equal(state.resourceAdmissionId, id);
    assert.equal(commands, 0);
    const stored = await runtime.store.readSession(session.sessionId);
    assert.equal(workspaceSetupStateFromMetadata(stored.metadata).resourceAdmissionId, id);
    const current = await runtime.getSession(session.sessionId, { inspectSource: false });
    assert.equal(current.workspaceSetup.resourceAdmissionId, id);
    rejected = false;
    const prepared = await (await runner.start({ runtime, session: current, retry: true })).completion;
    assert.equal(prepared.status, "succeeded");
    assert.equal(prepared.resourceAdmissionId, undefined);
    assert.equal(commands, 1);
    assert.equal((await runtime.getSession(session.sessionId, { inspectSource: false })).workspaceSetup.resourceAdmissionId, undefined);
    assert.equal(workspaceSetupState({ status: "failed", resourceAdmissionId: "../forged" }).resourceAdmissionId, undefined);
    assert.equal(workspaceSetupState({ status: "running", resourceAdmissionId: id }).resourceAdmissionId, undefined);
  });
});

test("workspace preparation transcript remains visible after a runtime restart", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot, "restart-session");
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(),
      projectService: {},
      async runCommand() {
        return {
          exitCode: 0,
          ok: true,
          output: `${"x".repeat(WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH * 2)}Restorable workspace output.`
        };
      }
    });

    const started = await runner.start({ runtime, session });
    await started.completion;
    const restartedRuntime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const restored = await restartedRuntime.getSession(session.sessionId, {
      inspectSource: false
    });
    assert.equal(restored.workspaceSetup.status, "succeeded");
    assert.equal(
      restored.workspaceSetup.transcript.length <= WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH,
      true
    );
    assert.equal(
      restored.workspaceSetup.transcript.startsWith(WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER),
      true
    );
    assert.match(restored.workspaceSetup.transcript, /Restorable workspace output\./u);
    assert.match(restored.workspaceSetup.transcript, /Workspace preparation succeeded\./u);
  });
});

test("workspace preparation configuration never infers a package manager", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => ({
        components: [],
        diagnostics: [],
        runtimeRequirements: [],
        source: null,
        stackHash: "sha256:empty",
        status: "unconfigured",
        steps: []
      }),
      projectService: {},
      async runCommand() {
        commandCount += 1;
      }
    });

    const result = await runner.start({ runtime, session });
    assert.equal(result.completion, null);
    assert.equal(result.state.status, "unconfigured");
    assert.equal(commandCount, 0);

    const repeated = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.deepEqual(repeated.state, result.state);
    assert.equal(
      (await runtime.store.readSession(session.sessionId)).metadata.workspace_setup,
      undefined
    );
  });
});

test("workspace preparation starts when a later Stack declaration supplies a recipe", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let configured = false;
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => configured
        ? readySetup()
        : {
            components: [],
            diagnostics: [],
            runtimeRequirements: [],
            source: null,
            stackHash: "sha256:empty",
            status: "unconfigured",
            steps: []
          },
      projectService: {},
      async runCommand() {
        commandCount += 1;
        return {
          exitCode: 0,
          ok: true
        };
      }
    });

    const unconfigured = await runner.start({ runtime, session });
    assert.equal(unconfigured.state.status, "unconfigured");
    configured = true;

    const started = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.equal(started.state.status, "running");
    assert.equal((await started.completion).status, "succeeded");
    assert.equal(commandCount, 1);
  });
});

test("workspace preparation reruns a successful recipe after its identity changes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let recipeHash = "sha256:retired-contract";
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup({ recipeHash }),
      projectService: {},
      async runCommand() {
        commandCount += 1;
        return {
          exitCode: 0,
          ok: true
        };
      }
    });

    const initial = await runner.start({ runtime, session });
    assert.equal((await initial.completion).recipeHash, "sha256:retired-contract");

    recipeHash = "sha256:current-contract";
    const migrated = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.equal(migrated.state.status, "running");
    assert.equal((await migrated.completion).recipeHash, "sha256:current-contract");
    assert.equal(commandCount, 2);
  });
});

test("workspace preparation treats a missing Genesis Stack as unconfigured", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    const runner = createWorkspaceSetupRunner({
      inspect: async () => {
        const error = new Error("Run genesis init first.");
        error.code = "STACK_REQUIRED";
        throw error;
      },
      projectService: {}
    });

    const result = await runner.start({ runtime, session });
    assert.equal(result.completion, null);
    assert.equal(result.state.status, "unconfigured");
    assert.equal(result.state.diagnostic, "");
  });
});

test("workspace preparation retry migrates a recognized legacy Genesis project before setup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session, sourceRoot } = await workspaceSession(targetRoot);
    const calls = [];
    let inspectionCount = 0;
    let formatInspectionCount = 0;
    const legacyError = () => {
      const error = new Error("Genesis project files are unversioned. Run genesis migrate.");
      error.code = "PROJECT_FORMAT_UNVERSIONED";
      return error;
    };
    const runner = createWorkspaceSetupRunner({
      inspect() {
        inspectionCount += 1;
        if (inspectionCount < 3) {
          throw legacyError();
        }
        return readySetup();
      },
      inspectProjectFormat() {
        formatInspectionCount += 1;
        return {
          action: "migrate",
          projectVersion: null,
          status: "unversioned",
          supportedVersion: 2
        };
      },
      projectService: {},
      async runCommand(request) {
        calls.push(request);
        return {
          exitCode: 0,
          ok: true,
          output: request.command === "genesis"
            ? "Migrated Genesis project format to 2."
            : "Dependencies are current."
        };
      }
    });

    const failed = await runner.start({ runtime, session });
    assert.equal(failed.completion, null);
    assert.equal(failed.state.status, "failed");
    assert.equal(formatInspectionCount, 0);
    assert.equal(calls.length, 0);

    const retried = await runner.start({
      retry: true,
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.equal(retried.state.status, "running");
    const succeeded = await retried.completion;
    assert.equal(succeeded.status, "succeeded");
    assert.equal(formatInspectionCount, 1);
    assert.equal(inspectionCount, 5, "The migrated recipe is rechecked after environment preparation and admission.");
    assert.deepEqual(calls.map(({ args, command, cwd }) => ({ args, command, cwd })), [{
      args: ["migrate"],
      command: "genesis",
      cwd: sourceRoot
    }, {
      args: ["install"],
      command: "npm",
      cwd: sourceRoot
    }]);
    assert.equal(calls[0].actor, "app");
    assert.deepEqual(calls[0].allowedRoots, [sourceRoot]);
    assert.equal(calls[0].envPolicy, "project");
    assert.deepEqual(calls[0].gitSafeDirectories, [sourceRoot]);
    assert.equal(calls[0].purpose, "source");
    assert.deepEqual(calls[0].runtimes, ["node26", "git"]);
    assert.equal(calls[0].shimDirs.some((directory) => (
      directory.endsWith(path.join("packages", "vibe64-genesis", "bin"))
    )), true);
    assert.equal(calls[0].timeout, WORKSPACE_SETUP_COMMAND_TIMEOUT_MS);
    assert.match(succeeded.transcript, /Workspace preparation retry started\./u);
    assert.match(succeeded.transcript, /\[Migrate Genesis project\] Running\./u);
    assert.match(succeeded.transcript, /Migrated Genesis project format to 2\./u);
    assert.match(succeeded.transcript, /\[Migrate Genesis project\] Succeeded\./u);
    assert.match(succeeded.transcript, /\[Install JavaScript dependencies\] Succeeded\./u);
  });
});

test("workspace preparation never migrates a current project after an inspection failure", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect() {
        throw new Error("The current Stack contract is incomplete.");
      },
      inspectProjectFormat() {
        return {
          action: null,
          projectVersion: 2,
          status: "current",
          supportedVersion: 2
        };
      },
      projectService: {},
      async runCommand() {
        commandCount += 1;
        return { exitCode: 0, ok: true };
      }
    });

    const result = await runner.start({ retry: true, runtime, session });
    assert.equal(result.completion, null);
    assert.equal(result.state.status, "failed");
    assert.match(result.state.diagnostic, /current Stack contract is incomplete/u);
    assert.equal(commandCount, 0);
  });
});

test("workspace preparation keeps a failed Genesis migration recoverable", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let inspectionCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect() {
        inspectionCount += 1;
        throw new Error("Run genesis migrate.");
      },
      inspectProjectFormat() {
        return {
          action: "migrate",
          status: "outdated"
        };
      },
      projectService: {},
      async runCommand() {
        return {
          exitCode: 1,
          ok: false,
          stderr: "The legacy Stack cannot be migrated automatically."
        };
      }
    });

    const result = await runner.start({ retry: true, runtime, session });

    assert.equal(result.completion, null);
    assert.equal(result.state.status, "failed");
    assert.equal(inspectionCount, 1);
    assert.match(result.state.diagnostic, /cannot be migrated automatically/u);
    assert.match(result.state.transcript, /\[Migrate Genesis project\] Running\./u);
    assert.match(result.state.transcript, /\[Migrate Genesis project\] Failed\./u);
  });
});

test("ambiguous setup remains an actionable session state without executing either recipe", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => ({
        diagnostics: [{
          code: "STACK_SECTION_AMBIGUOUS",
          message: "JSKIT and Laravel both declare workspace setup. Add one project override."
        }],
        status: "blocked",
        steps: []
      }),
      projectService: {},
      async runCommand() {
        commandCount += 1;
      }
    });

    const result = await runner.start({ runtime, session });
    assert.equal(result.state.status, "ambiguous");
    assert.match(result.state.diagnostic, /both declare workspace setup/u);
    assert.equal(commandCount, 0);
    assert.equal((await runtime.store.readSession(session.sessionId)).status, "active");

    const repeated = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.deepEqual(repeated.state, result.state);
  });
});

test("command failure records a short diagnostic and leaves the session active", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let shouldFail = true;
    const workflowOutcomes = [];
    const runner = createWorkspaceSetupRunner({
      async startWorkflow() { return { ok: true, workflow: { id: "setup-workflow" } }; },
      async finishWorkflow(id, options) { workflowOutcomes.push({ id, ...options }); },
      inspect: () => readySetup(),
      projectService: {
        async projectExecutionEnvironment(input) {
          assert.equal(input.includeResourceConfiguration, true);
          return {
            environment: { REGISTRY_TOKEN: "retry-secret" },
            resourceConfigurationFingerprint: "c".repeat(64)
          };
        }
      },
      async runCommand() {
        return shouldFail
          ? {
              exitCode: 1,
              ok: false,
              stderr: "npm could not reach the registry using retry-secret"
            }
          : {
              exitCode: 0,
              ok: true,
              output: "Dependencies are current."
            };
      }
    });

    const started = await runner.start({ runtime, session });
    const finished = await started.completion;
    assert.equal(finished.status, "failed");
    assert.equal(finished.currentLabel, "Install JavaScript dependencies");
    assert.equal(finished.diagnostic, "npm could not reach the registry using [redacted]");
    assert.match(finished.transcript, /npm could not reach the registry using \[redacted\]/u);
    assert.doesNotMatch(finished.transcript, /retry-secret/u);
    assert.match(finished.transcript, /\[Install JavaScript dependencies\] Failed\./u);
    assert.equal((await runtime.store.readSession(session.sessionId)).status, "active");
    assert.deepEqual(workflowOutcomes, [{ id: "setup-workflow", outcome: "failed", defer: true }]);

    shouldFail = false;
    const retried = await runner.start({
      retry: true,
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    const succeeded = await retried.completion;
    assert.equal(succeeded.status, "succeeded");
    assert.deepEqual(workflowOutcomes[1], { id: "setup-workflow", outcome: "succeeded", defer: true });
    assert.match(succeeded.transcript, /Workspace preparation retry started\./u);
    assert.match(succeeded.transcript, /Dependencies are current\./u);
    assert.equal(
      succeeded.transcript.match(/\[Install JavaScript dependencies\] Failed\./gu)?.length,
      1
    );
    assert.equal(
      succeeded.transcript.match(/\[Install JavaScript dependencies\] Succeeded\./gu)?.length,
      1
    );
  });
});

test("an active preparation is shared instead of starting another run", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let finishCommand;
    const commandFinished = new Promise((resolve) => {
      finishCommand = resolve;
    });
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(),
      projectService: {},
      runCommand: () => commandFinished
    });

    const started = await runner.start({ runtime, session });
    const joined = await runner.start({ runtime, session });
    assert.equal(joined.completion, started.completion);
    finishCommand({ exitCode: 0, ok: true });
    await started.completion;
  });
});

test("same raw session workspace preparations remain isolated across project contexts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "shared-workspace-session";
    const alpha = await workspaceSession(path.join(targetRoot, "alpha"), sessionId);
    const beta = await workspaceSession(path.join(targetRoot, "beta"), sessionId);
    const contexts = {
      alpha: {
        projectRuntimeRoot: alpha.runtime.stateRoot,
        slug: "alpha",
        targetRoot: alpha.runtime.projectContextRoot
      },
      beta: {
        projectRuntimeRoot: beta.runtime.stateRoot,
        slug: "beta",
        targetRoot: beta.runtime.projectContextRoot
      }
    };
    const gates = Object.fromEntries(["alpha", "beta"].map((slug) => {
      let enter;
      let release;
      return [slug, {
        entered: new Promise((resolve) => {
          enter = resolve;
        }),
        enter,
        release: () => release(),
        wait: new Promise((resolve) => {
          release = resolve;
        })
      }];
    }));
    const resumedContexts = [];
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(),
      projectService: {},
      async runCommand() {
        const slug = currentProjectRequestContext()?.slug;
        gates[slug].enter();
        await gates[slug].wait;
        resumedContexts.push(currentProjectRequestContext()?.slug);
        return { exitCode: 0, ok: true };
      }
    });

    const alphaStarted = await runWithProjectRequestContext(
      contexts.alpha,
      () => runner.start({ runtime: alpha.runtime, session: alpha.session })
    );
    const betaStarted = await runWithProjectRequestContext(
      contexts.beta,
      () => runner.start({ runtime: beta.runtime, session: beta.session })
    );
    await Promise.all([gates.alpha.entered, gates.beta.entered]);

    assert.notEqual(alphaStarted.completion, betaStarted.completion);
    assert.equal(
      await runWithProjectRequestContext(contexts.alpha, () => runner.isRunning(sessionId)),
      true
    );
    assert.equal(
      await runWithProjectRequestContext(contexts.beta, () => runner.isRunning(sessionId)),
      true
    );

    gates.alpha.release();
    assert.equal((await alphaStarted.completion).status, "succeeded");
    assert.equal(
      await runWithProjectRequestContext(contexts.alpha, () => runner.isRunning(sessionId)),
      false
    );
    assert.equal(
      await runWithProjectRequestContext(contexts.beta, () => runner.isRunning(sessionId)),
      true
    );
    const betaWait = await runWithProjectRequestContext(contexts.beta, () => ({
      completion: runner.wait(sessionId)
    }));
    assert.equal(betaWait.completion, betaStarted.completion);

    gates.beta.release();
    assert.equal((await betaStarted.completion).status, "succeeded");
    assert.deepEqual(resumedContexts.sort(), ["alpha", "beta"]);
    assert.equal(
      await runWithProjectRequestContext(contexts.beta, () => runner.isRunning(sessionId)),
      false
    );
  });
});
