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
  genesisCommandShimDirectory
} from "../../packages/vibe64-genesis/src/server/index.js";

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
          }
        };
      },
      async readCurrentProject() {
        return project;
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
