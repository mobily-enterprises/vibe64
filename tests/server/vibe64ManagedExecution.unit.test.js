import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  installVibe64ManagedExecutionProvider,
  stopVibe64Execution,
  stopVibe64OwnedExecutions
} from "../../packages/vibe64-execution/src/server/managedExecution.js";
import {
  normalizeExecutionDescriptor,
  normalizeVibe64CommandRequest
} from "../../packages/vibe64-execution/src/server/request.js";
import {
  runVibe64Command
} from "../../packages/vibe64-execution/src/server/runVibe64Command.js";

const execFileAsync = promisify(execFile);
const EXEC_HELPER = path.resolve("packages/vibe64-execution/src/host/execHelper.js");

test("release commands reject caller Env and non-application execution", () => {
  const request = {
    command: process.execPath,
    actor: "app",
    envPolicy: "deployment",
    releaseEnvironmentFile: "/release/artifact/service/environment",
    runtimes: []
  };
  for (const change of [
    { actor: "daemon" },
    { mode: "detached" },
    { envPolicy: "session" },
    { env: { API_KEY: "session-value" } },
    { baseEnv: { API_KEY: "host-value" } },
    { releaseEnvironmentFile: "relative/environment" },
    { releaseEnvironmentFile: 123 }
  ]) {
    assert.throws(() => normalizeVibe64CommandRequest({ ...request, ...change }),
      { code: "vibe64_command_release_environment_invalid" });
  }
  assert.equal(normalizeVibe64CommandRequest(request).inheritProcessEnv, false);
});

test("release commands exclude editable Env and cannot fall back to local execution", async (t) => {
  const request = {
    command: process.execPath,
    args: ["-e", "throw new Error('must not execute locally')"],
    actor: "app",
    envPolicy: "deployment",
    releaseEnvironmentFile: "/release/artifact/service/environment",
    runtimes: [],
    project: { deploymentEnv: { RELEASE_TEST_KEY: "edited-value" } },
    session: { databaseEnv: { RELEASE_TEST_KEY: "session-value" } }
  };
  const previous = process.env.RELEASE_TEST_KEY;
  process.env.RELEASE_TEST_KEY = "editor-process-value";
  t.after(() => {
    if (previous === undefined) delete process.env.RELEASE_TEST_KEY;
    else process.env.RELEASE_TEST_KEY = previous;
  });
  const unavailable = await runVibe64Command(request);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "vibe64_release_environment_unavailable");
  let called = false;
  const release = installVibe64ManagedExecutionProvider({
    async stopExecution() { throw new Error("Unexpected stop"); },
    async runCommand(normalized, context) {
      called = true;
      assert.equal(normalized.releaseEnvironmentFile, request.releaseEnvironmentFile);
      assert.equal(context.env.RELEASE_TEST_KEY, undefined);
      assert.ok(context.env.HOME);
      assert.ok(context.env.PATH);
      return context.runLocal();
    }
  });
  t.after(release);
  const fallback = await runVibe64Command(request);
  assert.equal(called, true);
  assert.equal(fallback.ok, false);
  assert.equal(fallback.code, "vibe64_release_environment_unavailable");
});

test("managed release runner supplies inherited release values with host-owned identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-release-env-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const payloadPath = path.join(root, "command.json");
  await writeFile(payloadPath, JSON.stringify({
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({key:process.env.RELEASE_TEST_KEY,home:process.env.HOME,user:process.env.USER,path:process.env.PATH}))"],
    cwd: root,
    env: { HOME: root, USER: "fixture", PATH: "/host/runtime/bin" },
    releaseEnvironment: true,
    executionId: randomUUID(),
    schema: "vibe64.managed-execution.command",
    schemaVersion: 1
  }));
  const result = await execFileAsync(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
    cwd: root,
    env: { RELEASE_TEST_KEY: "release-fixture", HOME: "/wrong", USER: "wrong", PATH: "/wrong" },
    timeout: 5000
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    key: "release-fixture", home: root, user: "fixture", path: "/host/runtime/bin"
  });
  await assert.rejects(readFile(payloadPath), { code: "ENOENT" });
});

test("managed release runner consumes input and records child failure without persisting Env", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-release-failure-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const payloadPath = path.join(root, "command.json");
  const executionId = randomUUID();
  const input = JSON.stringify({ operation: "status", integrationId: "mailbox" });
  await writeFile(payloadPath, JSON.stringify({
    command: process.execPath,
    args: ["--input-type=module", "-e", `
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      if (JSON.parse(input).integrationId !== "mailbox") process.exit(19);
      if (process.env.RELEASE_TEST_KEY !== "private-fixture-value") process.exit(20);
      process.stdout.write("controlled failure");
      process.exitCode = 7;
    `],
    cwd: root,
    env: { HOME: root, USER: "fixture", PATH: "/host/runtime/bin" },
    releaseEnvironment: true,
    inputPresent: true,
    inputBase64: Buffer.from(input).toString("base64"),
    executionId,
    schema: "vibe64.managed-execution.command",
    schemaVersion: 1
  }));
  await assert.rejects(execFileAsync(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
    cwd: root, env: { RELEASE_TEST_KEY: "private-fixture-value" }, timeout: 5000
  }), (error) => {
    assert.equal(error.code, 7);
    assert.equal(error.stdout, "controlled failure");
    assert.equal(error.stderr, "");
    return true;
  });
  await assert.rejects(readFile(payloadPath), { code: "ENOENT" });
  const resultText = await readFile(path.join(root, "result.json"), "utf8");
  const result = JSON.parse(resultText);
  assert.equal(result.executionId, executionId);
  assert.equal(result.result, "exit-code");
  assert.equal(result.execMainStatus, "7");
  assert.equal(resultText.includes("private-fixture-value"), false);
  assert.equal(resultText.includes("RELEASE_TEST_KEY"), false);
});

test("execution descriptors carry intent without accepting controller policy", () => {
  const descriptor = normalizeExecutionDescriptor({
    id: "caller-owned-id",
    kind: "assistant",
    label: "Session assistant",
    lifecycle: "service",
    memoryMaxBytes: 1,
    operationId: "turn-1",
    ownerId: "session-1",
    systemdUnit: "caller.service"
  }, {
    mode: "detached",
    project: {
      slug: "dogandgroom"
    },
    session: {
      id: "2026-08-17_13-05-55"
    }
  });

  assert.match(descriptor.id, /^[0-9a-f-]{36}$/u);
  assert.notEqual(descriptor.id, "caller-owned-id");
  assert.deepEqual(descriptor, {
    controlGenerationId: "",
    id: descriptor.id,
    kind: "assistant",
    label: "Session assistant",
    lifecycle: "service",
    operationId: "turn-1",
    ownerId: "session-1",
    parentExecutionId: "",
    projectSlug: "dogandgroom",
    sessionId: "2026-08-17_13-05-55"
  });
  assert.equal(Object.isFrozen(descriptor), true);
});

test("the installed provider owns run and stop by the same execution id", async (t) => {
  const calls = [];
  const provider = {
    async runCommand(request, context) {
      calls.push({
        envExecutionId: context.env.VIBE64_EXECUTION_ID,
        executionId: request.execution.id,
        operation: "run"
      });
      return {
        execution: request.execution,
        exitCode: 0,
        ok: true,
        output: "managed"
      };
    },
    async stopExecution(executionId) {
      calls.push({
        executionId,
        operation: "stop"
      });
      return {
        executionId,
        ok: true,
        stopped: true
      };
    }
  };
  const release = installVibe64ManagedExecutionProvider(provider);
  t.after(release);

  const result = await runVibe64Command({
    command: process.execPath,
    execution: {
      kind: "assistant",
      lifecycle: "service",
      ownerId: "session-1"
    },
    mode: "detached",
    runtimes: []
  });
  const stopped = await stopVibe64Execution(result.execution.id);

  assert.equal(result.ok, true);
  assert.equal(result.output, "managed");
  assert.equal(stopped.ok, true);
  assert.deepEqual(calls, [
    {
      envExecutionId: result.execution.id,
      executionId: result.execution.id,
      operation: "run"
    },
    {
      executionId: result.execution.id,
      operation: "stop"
    }
  ]);
});

test("the installed provider can drain durable services by their exact owner", async (t) => {
  const calls = [];
  const release = installVibe64ManagedExecutionProvider({
    async runCommand() {
      return { ok: true };
    },
    async stopExecution() {
      return { ok: true, scopeEmpty: true };
    },
    async stopOwnedExecutions(selector, options) {
      calls.push({ options, selector });
      return {
        closed: 2,
        ok: true,
        processExitProofs: [{ scopeEmpty: true, stopped: true }],
        scopeEmpty: true,
        supported: true
      };
    }
  });
  t.after(release);
  const selector = {
    kind: "assistant",
    operationId: "opencode-server",
    ownerId: "session-1",
    sessionId: "session-1"
  };

  const result = await stopVibe64OwnedExecutions(selector, {
    reason: "session-close"
  });

  assert.equal(result.closed, 2);
  assert.equal(result.scopeEmpty, true);
  assert.deepEqual(calls, [{
    options: { reason: "session-close" },
    selector
  }]);
  release();
  assert.deepEqual(await stopVibe64OwnedExecutions(selector), {
    closed: 0,
    ok: true,
    processExitProofs: [],
    scopeEmpty: true,
    supported: false
  });
});

test("a managed host fails closed when its execution provider is unavailable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-managed-required-"));
  const markerPath = path.join(root, "started.txt");
  const previous = process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
  process.env.VIBE64_MANAGED_EXECUTION_REQUIRED = "1";
  t.after(async () => {
    if (previous === undefined) {
      delete process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
    } else {
      process.env.VIBE64_MANAGED_EXECUTION_REQUIRED = previous;
    }
    await rm(root, { force: true, recursive: true });
  });

  const result = await runVibe64Command({
    args: [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "started");`
    ],
    command: process.execPath,
    cwd: root,
    execution: {
      kind: "job",
      lifecycle: "finite",
      ownerId: "managed-host-test"
    },
    runtimes: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_managed_execution_provider_unavailable");
  assert.equal(result.retryable, false);
  assert.match(result.error, /did not start this work/iu);
  await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
});

test("isolated managed commands exclude the daemon environment and own their XDG roots", async (t) => {
  const previousSecret = process.env.VIBE64_TEST_DAEMON_SECRET;
  process.env.VIBE64_TEST_DAEMON_SECRET = "must-not-leak";
  let observed = null;
  const release = installVibe64ManagedExecutionProvider({
    async runCommand(request, context) {
      observed = { request, env: context.env };
      return { execution: request.execution, ok: true };
    },
    async stopExecution() {
      return { ok: true, scopeEmpty: true };
    }
  });
  t.after(() => {
    release();
    if (previousSecret === undefined) {
      delete process.env.VIBE64_TEST_DAEMON_SECRET;
    } else {
      process.env.VIBE64_TEST_DAEMON_SECRET = previousSecret;
    }
  });

  const result = await runVibe64Command({
    baseEnv: { LANG: "en_AU.UTF-8", SAFE_VALUE: "kept" },
    command: process.execPath,
    credentialHome: {
      cacheRoot: "/tmp/v64-isolated/cache",
      configRoot: "/tmp/v64-isolated/config",
      dataRoot: "/tmp/v64-isolated/data",
      home: "/tmp/v64-isolated/home",
      stateRoot: "/tmp/v64-isolated/state"
    },
    execution: {
      kind: "assistant",
      lifecycle: "service",
      ownerId: "isolated-assistant"
    },
    inheritProcessEnv: false,
    mode: "detached",
    purpose: "assistant",
    runtimes: []
  });

  assert.equal(result.ok, true);
  assert.equal(observed.request.inheritProcessEnv, false);
  assert.equal(observed.env.VIBE64_TEST_DAEMON_SECRET, undefined);
  assert.equal(observed.env.SAFE_VALUE, "kept");
  assert.equal(observed.env.HOME, "/tmp/v64-isolated/home");
  assert.equal(observed.env.XDG_CACHE_HOME, "/tmp/v64-isolated/cache");
  assert.equal(observed.env.XDG_CONFIG_HOME, "/tmp/v64-isolated/config");
  assert.equal(observed.env.XDG_DATA_HOME, "/tmp/v64-isolated/data");
  assert.equal(observed.env.XDG_STATE_HOME, "/tmp/v64-isolated/state");
});

test("standalone detached execution stops and drains its exact process group", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-owned-detached-"));
  const markerPath = path.join(root, "started.txt");
  const result = await runVibe64Command({
    args: [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "started"); setInterval(() => {}, 1000);`
    ],
    command: process.execPath,
    cwd: root,
    execution: {
      kind: "assistant",
      lifecycle: "service",
      ownerId: "session-standalone"
    },
    mode: "detached",
    runtimes: []
  });

  assert.equal(result.ok, true, result.output);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (await readFile(markerPath, "utf8") === "started") {
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.equal(await readFile(markerPath, "utf8"), "started");

  const stopped = await stopVibe64Execution(result.execution.id);
  assert.deepEqual(stopped, {
    executionId: result.execution.id,
    ok: true,
    scopeEmpty: true,
    stopped: true
  });
  assert.throws(
    () => process.kill(result.pid, 0),
    (error) => error?.code === "ESRCH"
  );
});

test("standalone finite execution drains descendants before reporting completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-owned-capture-"));
  const childPidPath = path.join(root, "child.pid");
  const result = await runVibe64Command({
    args: [
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        `writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));`,
        "child.unref();"
      ].join("\n")
    ],
    command: process.execPath,
    cwd: root,
    execution: {
      kind: "job",
      lifecycle: "finite",
      ownerId: "setup-1"
    },
    runtimes: []
  });

  assert.equal(result.ok, true, result.output);
  const childPid = Number(await readFile(childPidPath, "utf8"));
  assert.throws(
    () => process.kill(childPid, 0),
    (error) => error?.code === "ESRCH"
  );
});

test("standalone PTY execution closes and drains by execution id", async () => {
  const namespace = `v64-owned-pty-${Date.now()}`;
  const result = await runVibe64Command({
    args: [
      "-e",
      "setInterval(() => {}, 1000)"
    ],
    command: process.execPath,
    execution: {
      kind: "terminal",
      lifecycle: "interactive",
      ownerId: "terminal-1"
    },
    mode: "pty",
    runtimes: [],
    terminal: {
      namespace
    }
  });

  assert.equal(result.ok, true, result.error);
  const stopped = await stopVibe64Execution(result.execution.id);
  assert.deepEqual(stopped, {
    executionId: result.execution.id,
    ok: true,
    scopeEmpty: true,
    stopped: true
  });
});

test("managed runner preserves final counters after a successful transient unit can unload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-managed-result-"));
  try {
    const executionId = randomUUID();
    const payloadPath = path.join(root, "command.json");
    await writeFile(payloadPath, `${JSON.stringify({
      args: ["-e", "Buffer.alloc(8 * 1024 * 1024);"],
      command: process.execPath,
      cwd: root,
      env: {
        PATH: process.env.PATH
      },
      executionId,
      inputBase64: "",
      inputPresent: false,
      schema: "vibe64.managed-execution.command",
      schemaVersion: 1
    })}\n`, "utf8");

    await execFileAsync(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
      cwd: root
    });
    const result = JSON.parse(await readFile(path.join(root, "result.json"), "utf8"));

    assert.equal(result.schema, "vibe64.managed-execution.result");
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.executionId, executionId);
    assert.equal(result.execMainStatus, "0");
    assert.equal(result.result, "success");
    assert.ok(Number(result.memoryPeak) > 0);
    assert.ok(Number(result.tasksPeak) > 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed service runner stops its process tree when the owning controller disappears", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-managed-controller-lease-"));
  const leaseName = `\0vibe64-resource-controller-runner-${process.pid}`;
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const pidPath = path.join(root, "pids.txt");
  let managedPids = [];
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ path: leaseName }, resolve);
    });
    const executionId = randomUUID();
    const payloadPath = path.join(root, "command.json");
    await writeFile(payloadPath, `${JSON.stringify({
      args: ["-e", [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        `writeFileSync(${JSON.stringify(pidPath)}, process.pid + ' ' + grandchild.pid);`,
        "setInterval(() => {}, 1000);"
      ].join("\n")],
      command: process.execPath,
      controllerLeaseName: leaseName,
      cwd: root,
      env: { PATH: process.env.PATH },
      executionId,
      inputBase64: "",
      inputPresent: false,
      schema: "vibe64.managed-execution.command",
      schemaVersion: 1
    })}\n`, "utf8");
    const runner = spawn(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    runner.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        managedPids = String(await readFile(pidPath, "utf8"))
          .trim()
          .split(/\s+/u)
          .map(Number);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.equal(managedPids.length, 2, stderr);
    for (const socket of sockets) {
      socket.destroy();
    }

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Managed runner did not stop after lease loss.")), 8000);
      runner.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.equal(exitCode, 1, stderr);
    for (const pid of managedPids) {
      assert.throws(
        () => process.kill(pid, 0),
        (error) => error?.code === "ESRCH"
      );
    }
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(() => resolve()));
    for (const pid of managedPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        assert.equal(error?.code, "ESRCH");
      }
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("repeatable activity descriptors carry only an explicit opaque history identity", () => {
  const resourceProfile = { key: "codex-app-server", compatibilityKey: "a".repeat(64), environment: "development" };
  const descriptor = normalizeExecutionDescriptor({ resourceProfile });
  assert.deepEqual(descriptor.resourceProfile, resourceProfile);
  assert.notEqual(descriptor.resourceProfile, resourceProfile);
  assert.equal(Object.isFrozen(descriptor.resourceProfile), true);
  for (const invalid of [{}, { ...resourceProfile, compatibilityKey: "short" }, { ...resourceProfile, key: "../foreign" },
    { ...resourceProfile, environment: "unknown" }, { ...resourceProfile, memoryMaxBytes: 1 },
    { ...resourceProfile, command: "private command" }]) {
    assert.throws(() => normalizeExecutionDescriptor({ resourceProfile: invalid }), /profile identity/u);
  }
  assert.equal(normalizeExecutionDescriptor({ operationId: "random-operation" }).resourceProfile, undefined);
});
