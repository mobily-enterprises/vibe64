import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentSessionCommandService,
  prepareAgentSessionCommand
} from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import {
  genesisCommandShimDirectory,
  initializeGenesisProject
} from "../../packages/vibe64-genesis/src/server/index.js";
import { resolveCommandEnv } from "../../packages/vibe64-execution/src/server/env/resolveCommandEnv.js";

test("agent shell commands run as session-owned managed executions and drain on session close", async (t) => {
  for (const [name, value] of Object.entries({ GENESIS_PARSER_ROOT: "/release/genesis-parsers", GENESIS_PARSER_AUTO_INSTALL: "0" })) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-session-command-"));
  const sessionId = "session-1";
  const projectSlug = "project-1";
  const projectRoot = path.join(temporaryRoot, "project");
  const sourceRoot = path.join(temporaryRoot, "sessions", "active", sessionId, "source");
  const wrapperHostDir = path.join(temporaryRoot, "wrappers");
  const runCalls = [];
  let projectEnv = { DB_NAME: "new_database", DB_USER: "managed_writer", SERVICE_URL: "https://current.example.test" };
  let environmentFailure = null;
  let environmentStatus = "not-prepared";
  let commandExitCode = 0;
  const stopOwnedCalls = [];
  const descriptor = {
    metadata: {
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: "managed_session_source"
    },
    sessionId,
    sessionRoot: path.join(temporaryRoot, "state", sessionId)
  };
  const project = {
    projectRoot,
    slug: projectSlug
  };
  await writeFile(path.join(temporaryRoot, ".keep"), "");
  const service = createAgentSessionCommandService({
    projectService: {
      async createSessionStore() {
        return {
          async readSessionSourceDescriptor() {
            return descriptor;
          },
          async readMetadataValue() {
            return JSON.stringify({ status: "succeeded" });
          }
        };
      },
      async readCurrentProject() {
        return project;
      },
      async projectInspectionEnvironment(input) {
        assert.equal(input.sessionId, sessionId);
        assert.equal(input.session.metadata.source_path, sourceRoot);
        if (environmentFailure) throw environmentFailure;
        return projectEnv;
      },
      async projectEnvironmentStatus() {
        return { status: environmentStatus, keys: Object.keys(projectEnv), resources: [] };
      },
      async projectExecutionEnvironment() {
        assert.fail("Shell environment reads must not provision resources or acquire the active agent's source lock.");
      },
      async runInProjectContext(slug, operation) {
        assert.equal(slug, projectSlug);
        return operation();
      }
    },
    async runCommand(request) {
      runCalls.push(request);
      await writeFile(request.baseEnv.VIBE64_AGENT_SESSION_RUN_OUTPUT_PATH, "started chrome\n");
      await writeFile(request.baseEnv.VIBE64_AGENT_SESSION_RUN_RESULT_PATH, `${commandExitCode}\n`);
      return {
        execution: { id: "execution-1" },
        ok: true
      };
    },
    async stopOwnedExecutions(selector, options) {
      stopOwnedCalls.push([selector, options]);
      return {
        closed: 1,
        processExitProofs: [{ executionId: "execution-1", ok: true, stopped: true }],
        supported: true
      };
    }
  });

  try {
    await mkdir(sourceRoot, { recursive: true });
    await promisify(execFile)("git", ["init", "--quiet", sourceRoot]);
    await initializeGenesisProject({ projectRoot: sourceRoot });
    await service.bindSession(sessionId, { wrapperHostDir });
    const command = "/usr/bin/google-chrome --headless https://example.test &";
    const result = await service.run({
      commandBase64: Buffer.from(command, "utf8").toString("base64url"),
      cwd: sourceRoot,
      env: {
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
        DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/bus",
        DBUS_STARTER_BUS_TYPE: "session",
        SAFE_ENV: "kept",
        DB_NAME: "stale_database",
        VIBE64_SESSION_RENAME_CONTROL: "rename-only-capability",
        GENESIS_PARSER_ROOT: "/untrusted/parser-cache",
        GENESIS_PARSER_AUTO_INSTALL: "1",
        VIBE64_AGENT_SESSION_COMMAND_TOKEN: "must-not-leak"
      },
      sessionId
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "started chrome\n");
    assert.equal(runCalls.length, 1);
    const request = runCalls[0];
    assert.equal(request.mode, "detached");
    assert.equal(request.execution.kind, "job");
    assert.equal(request.execution.lifecycle, "service");
    assert.equal(request.execution.ownerId, sessionId);
    assert.equal(request.execution.projectSlug, projectSlug);
    assert.equal(request.execution.sessionId, sessionId);
    assert.equal(request.cwd, sourceRoot);
    assert.deepEqual(request.allowedRoots, [sourceRoot]);
    assert.deepEqual(request.shimDirs, [
      wrapperHostDir,
      genesisCommandShimDirectory()
    ]);
    assert.equal(request.baseEnv.SAFE_ENV, "kept");
    assert.deepEqual(request.project.runtimeConfigEnv, projectEnv);
    assert.equal(resolveCommandEnv({ baseEnv: request.baseEnv, request }).DB_NAME, "new_database");
    assert.equal(resolveCommandEnv({ baseEnv: request.baseEnv, request }).SERVICE_URL, "https://current.example.test");
    assert.equal(request.baseEnv.VIBE64_SESSION_RENAME_CONTROL, "rename-only-capability");
    assert.equal(request.baseEnv.GENESIS_PARSER_ROOT, "/release/genesis-parsers");
    assert.equal(request.baseEnv.GENESIS_PARSER_AUTO_INSTALL, "0");
    assert.equal(Object.hasOwn(request.baseEnv, "DBUS_SESSION_BUS_ADDRESS"), false);
    assert.equal(Object.hasOwn(request.baseEnv, "DBUS_STARTER_ADDRESS"), false);
    assert.equal(Object.hasOwn(request.baseEnv, "DBUS_STARTER_BUS_TYPE"), false);
    assert.equal(Object.hasOwn(request.baseEnv, "VIBE64_AGENT_SESSION_COMMAND_TOKEN"), false);
    assert.equal(
      Buffer.from(request.baseEnv.VIBE64_AGENT_SESSION_RUN_COMMAND_BASE64, "base64").toString("utf8"),
      command
    );

    await mkdir(sourceRoot, { recursive: true });
    const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId, wrapperHostDir });
    const hookPath = new URL("../../packages/vibe64-runtime/src/server/agentSessionCommandHook.js", import.meta.url);
    for (const original of [
      command,
      "  printf '%s\\n' \"$HOME\" '`id`' '$(id)' | cat; # café\n\n",
      "cat <<'EOF'\nquotes: ' \" $ ` \\\nEOF\n",
      "printf '%s' \"a'b\" && false || true > result.txt 2>&1 &"
    ]) {
      const hook = spawnSync(process.execPath, [hookPath.pathname], {
        encoding: "utf8",
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: original } })
      });
      assert.equal(hook.status, 0, hook.stderr);
      const rewritten = JSON.parse(hook.stdout).hookSpecificOutput.updatedInput.command;
      const output = await promisify(execFile)("bash", ["-c", rewritten], {
        cwd: sourceRoot,
        env: { ...process.env, ...prepared.env }
      });
      assert.equal(output.stdout, "started chrome\n");
      assert.equal(output.stderr, "");
      assert.equal(Buffer.from(runCalls.at(-1).baseEnv.VIBE64_AGENT_SESSION_RUN_COMMAND_BASE64, "base64").toString("utf8"), original);
    }
    commandExitCode = 7;
    await assert.rejects(promisify(execFile)(prepared.hostWrapperPath, ["exit 7"], {
      cwd: sourceRoot,
      env: { ...process.env, ...prepared.env }
    }), (error) => error.code === 7 && error.stderr === "started chrome\n" && error.stdout === "");
    const callCount = runCalls.length;
    await assert.rejects(promisify(execFile)(prepared.hostWrapperPath, ["printf denied"], {
      env: { ...process.env, ...prepared.env, VIBE64_AGENT_SESSION_COMMAND_TOKEN: "" }
    }), (error) => error.code === 1 && /Reconnect the assistant/.test(error.stderr));
    await assert.rejects(promisify(execFile)(prepared.hostWrapperPath, ["printf denied"], {
      env: { ...process.env, ...prepared.env, VIBE64_AGENT_SESSION_COMMAND_TOKEN: "invalid" }
    }), (error) => error.code === 1 && /identity is invalid/.test(error.stderr));
    assert.equal(runCalls.length, callCount);

    const readStatus = () => promisify(execFile)(path.join(wrapperHostDir, "vibe64-session"), ["status", "--json"], {
      cwd: sourceRoot, env: { ...process.env, ...prepared.env }
    });
    let summary = JSON.parse((await readStatus()).stdout);
    assert.equal(summary.project, projectSlug);
    assert.equal(summary.environment.status, "not-prepared");
    assert.match(summary.recovery, /Prepare workspace/);
    assert.equal(summary.workspaceSetup.status, "succeeded");
    assert.equal(summary.tools.browserTests, "vibe64-helper playwright status");
    assert.equal(summary.tools.browserTestReadiness, "vibe64-helper playwright readiness");
    assert.equal(JSON.stringify(summary).includes("managed_writer"), false);
    environmentStatus = "ready";
    summary = JSON.parse((await readStatus()).stdout);
    assert.equal(summary.environment.status, "ready", "The helper reads current state without restarting the conversation.");

    projectEnv = { DB_NAME: "changed_database", DB_USER: "managed_writer", SERVICE_URL: "https://changed.example.test" };
    commandExitCode = 0;
    await promisify(execFile)(prepared.hostWrapperPath, ["printf updated"], {
      cwd: sourceRoot,
      env: { ...process.env, ...prepared.env, DB_NAME: "stale_database" }
    });
    const currentRequest = runCalls.at(-1);
    const resolvedEnv = resolveCommandEnv({ baseEnv: currentRequest.baseEnv, request: currentRequest });
    assert.equal(resolvedEnv.DB_NAME, "changed_database");
    assert.equal(resolvedEnv.SERVICE_URL, "https://changed.example.test");

    environmentFailure = Object.assign(new Error("Current project environment could not be read."), { code: "environment_unavailable" });
    const beforeFailure = runCalls.length;
    const blocked = await service.run({ commandBase64: Buffer.from("printf blocked").toString("base64url"), cwd: sourceRoot, sessionId });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "environment_unavailable");
    assert.equal(runCalls.length, beforeFailure, "Environment failure must block execution rather than reuse stale values.");

    const closed = await service.closeAllForSession(sessionId);
    assert.equal(closed.ok, true);
    assert.deepEqual(stopOwnedCalls, [[
      { ownerId: sessionId, sessionId },
      { reason: "session-close" }
    ]]);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
