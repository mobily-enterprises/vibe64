import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CODEX_RECONNECT_REQUIRED_CODE,
  codexAuthMarkerPath,
  codexAuthStateSignature,
  markCodexReconnectRequired,
  readCodexAuthStatus
} from "@local/vibe64-core/server/codexAuthState";
import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_TRANSPORT,
  CodexAppServerAgentProvider,
  CodexAppServerJsonRpcClient,
  codexAppServerEndpointForTarget,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexCliResumeCommand,
  codexTurnInput,
  ensureCodexAppServerRuntime,
  startCodexAppServerProcess,
  stopCodexAppServerRuntime
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import {
  CODEX_ATTACHMENT_HOST_ROOT,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  runVibe64Command,
  stableHash,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";

async function withTemporaryDirectory(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibe64-codex-provider-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, {
      force: true,
      recursive: true
    });
  }
}

async function withRuntimeNamespace(namespace, callback) {
  const previous = process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  if (namespace) {
    process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = namespace;
  } else {
    delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  }
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
    } else {
      process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = previous;
    }
  }
}

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-daemon";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(condition, message = "Timed out waiting for condition.") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (condition()) {
      return;
    }
    await delay(5);
  }
  throw new Error(message);
}

async function writeMetadata(runtimeDir, metadata) {
  await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600
  });
}

async function writeCodexAuthMarker(systemRoot, {
  connected = true,
  updatedAt = "2026-06-04T00:00:00.000Z"
} = {}) {
  const markerPath = codexAuthMarkerPath(systemRoot);
  await mkdir(path.dirname(markerPath), {
    recursive: true
  });
  await writeFile(markerPath, `${JSON.stringify({
    connected,
    updatedAt,
    version: 1
  }, null, 2)}\n`, {
    mode: 0o600
  });
}

function socketPathForRuntime(runtimeDir) {
  return path.join(runtimeDir, "app-server.sock");
}

function unixEndpointForRuntime(runtimeDir) {
  return `unix://${socketPathForRuntime(runtimeDir)}`;
}

function terminalEnvHash(terminalEnv = {}) {
  return stableHash(JSON.stringify(Object.entries(terminalEnv)
    .map(([name, value]) => [
      String(name || "").trim(),
      String(value ?? "")
    ])
    .filter(([name, value]) => name && String(value || ""))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function runtimesHash(runtimes = VIBE64_INTERACTIVE_RUNTIME_PACKS) {
  return stableHash(JSON.stringify(runtimes));
}

function executionContextHash({
  project = {},
  session = {},
  userKey = ""
} = {}) {
  return stableHash(JSON.stringify({
    project,
    session,
    userKey: String(userKey || "").trim()
  }));
}

function metadataForRuntime(runtimeDir, {
  authStateSignature = "test-auth-state-signature",
  pid = process.pid,
  project = {},
  session = {},
  terminalEnv = {},
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const socketPath = socketPathForRuntime(runtimeDir);
  return {
    attachmentHostRoot: CODEX_ATTACHMENT_HOST_ROOT,
    authStateSignature,
    endpoint: `unix://${socketPath}`,
    executionContextHash: executionContextHash({
      project,
      session,
      userKey
    }),
    healthz: "",
    logPath: path.join(runtimeDir, "app-server.log"),
    pid,
    processCwd: runtimeDir,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
    runtimesHash: runtimesHash(),
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    startedAt: "2026-06-04T00:00:00.000Z",
    terminalEnvHash: terminalEnvHash(terminalEnv),
    toolHomeSource,
    transport: CODEX_APP_SERVER_TRANSPORT.UNIX
  };
}

function codexAppServerCommandRunner(runtimeDir, commandCalls = []) {
  return async (request) => {
    if (request.args.includes("app-server")) {
      writeFileSync(socketPathForRuntime(runtimeDir), "");
    }
    commandCalls.push(request);
    return {
      exitCode: 0,
      ok: true,
      output: "",
      pid: 12345,
      signal: "",
      stderr: "",
      stdout: "",
      timedOut: false
    };
  };
}

class FakeWebSocket {
  static instances = [];

  constructor(url, options = {}) {
    this.closed = false;
    this.listeners = new Map();
    this.options = options;
    this.sent = [];
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(eventName, listener) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  removeEventListener(eventName, listener) {
    const listeners = this.listeners.get(eventName) || [];
    this.listeners.set(eventName, listeners.filter((entry) => entry !== listener));
  }

  emit(eventName, event = {}) {
    for (const listener of this.listeners.get(eventName) || []) {
      listener(event);
    }
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
    this.emit("close");
  }
}

class ResponsiveFakeWebSocket extends FakeWebSocket {
  constructor(...args) {
    super(...args);
    queueMicrotask(() => this.emit("open"));
  }

  send(payload) {
    super.send(payload);
    const message = this.sent.at(-1);
    if (message?.id && message.method === "initialize") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          id: message.id,
          result: {
            platformOs: "linux"
          }
        })
      }));
    }
  }
}

class FirstErrorThenResponsiveFakeWebSocket extends FakeWebSocket {
  static constructorCount = 0;

  constructor(...args) {
    super(...args);
    this.shouldFail = FirstErrorThenResponsiveFakeWebSocket.constructorCount < 2;
    FirstErrorThenResponsiveFakeWebSocket.constructorCount += 1;
    queueMicrotask(() => {
      if (this.shouldFail) {
        this.emit("error", new Error("unresponsive"));
        return;
      }
      this.emit("open");
    });
  }

  send(payload) {
    super.send(payload);
    const message = this.sent.at(-1);
    if (!this.shouldFail && message?.id && message.method === "initialize") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          id: message.id,
          result: {
            platformOs: "linux"
          }
        })
      }));
    }
  }
}

class SlowInitializeFakeWebSocket extends FakeWebSocket {
  constructor(...args) {
    super(...args);
    queueMicrotask(() => this.emit("open"));
  }
}

async function completeInitialize(socket) {
  socket.emit("open");
  await waitForCondition(() => socket.sent.length >= 1, "Codex app-server initialize was not sent.");
  const initializeRequest = socket.sent.find((entry) => entry.method === "initialize" && entry.id);
  assert.ok(initializeRequest);
  socket.emit("message", {
    data: JSON.stringify({
      id: initializeRequest.id,
      result: {
        platformOs: "linux"
      }
    })
  });
}

test("codex provider runtime base uses explicit Vibe64 runtime directory", () => {
  assert.equal(
    codexAppServerRuntimeBaseDir({
      env: {
        VIBE64_AGENT_RUNTIME_DIR: "/tmp/vibe64-agent-runtime"
      }
    }),
    "/tmp/vibe64-agent-runtime"
  );
});

test("codex provider runtime base uses host XDG runtime when provider env is curated", () => {
  assert.equal(
    codexAppServerRuntimeBaseDir({
      env: {},
      hostEnv: {
        XDG_RUNTIME_DIR: "/run/user/1000"
      },
      targetRoot: "/var/lib/vibe64/merc/projects/ddd"
    }),
    "/run/user/1000/vibe64/agent-providers"
  );
});

test("codex provider scopes default runtime directory by target root", () => {
  const env = {
    VIBE64_AGENT_RUNTIME_DIR: "/tmp/vibe64-agent-runtime"
  };
  const first = codexAppServerRuntimeDir({
    env,
    targetRoot: "/home/workspace/vibe64/beepollen",
    workdir: "/home/workspace/.local/share/vibe64-local-editor/state/projects/beepollen-test/sessions/active/one/source"
  });
  const second = codexAppServerRuntimeDir({
    env,
    targetRoot: "/home/workspace/vibe64/dogandgroom",
    workdir: "/home/workspace/.local/share/vibe64-local-editor/state/projects/dogandgroom-test/sessions/active/one/source"
  });

  assert.match(first, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.match(second, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.notEqual(first, second);
});

test("codex provider scopes app-server runtime directories by runtime instance", () => {
  const env = {
    VIBE64_AGENT_RUNTIME_DIR: "/tmp/vibe64-agent-runtime"
  };
  const targetRoot = "/home/workspace/vibe64/beepollen";
  const workdir = "/home/workspace/.local/share/vibe64-local-editor/state/projects/beepollen-test/sessions/active/one/source";
  const first = codexAppServerRuntimeDir({
    env,
    runtimeInstanceId: "session-one",
    targetRoot,
    workdir
  });
  const firstAgain = codexAppServerRuntimeDir({
    env,
    runtimeInstanceId: "session-one",
    targetRoot,
    workdir
  });
  const second = codexAppServerRuntimeDir({
    env,
    runtimeInstanceId: "session-two",
    targetRoot,
    workdir
  });

  assert.match(first, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.equal(firstAgain, first);
  assert.notEqual(second, first);
});

test("codex provider scopes runtime directories by explicit runtime namespace", async () => {
  const env = {
    VIBE64_AGENT_RUNTIME_DIR: "/tmp/vibe64-agent-runtime"
  };
  const targetRoot = "/home/workspace/vibe64/beepollen";
  const workdir = "/home/workspace/.local/share/vibe64-local-editor/state/projects/beepollen-test/sessions/active/one/source";
  await assert.rejects(
    () => withRuntimeNamespace("", () => codexAppServerRuntimeDir({
      env,
      targetRoot,
      workdir
    })),
    /VIBE64_RUNTIME_NAMESPACE is required/u
  );
  const namespaceADir = await withRuntimeNamespace("namespace-a", () => codexAppServerRuntimeDir({
    env,
    targetRoot,
    workdir
  }));
  const namespaceBDir = await withRuntimeNamespace("namespace-b", () => codexAppServerRuntimeDir({
    env,
    targetRoot,
    workdir
  }));

  assert.match(namespaceADir, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.match(namespaceBDir, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.notEqual(namespaceBDir, namespaceADir);
});

test("codex provider fallback runtime base stays outside the target root when XDG runtime is unavailable", () => {
  assert.equal(
    codexAppServerRuntimeBaseDir({
      env: {
        XDG_RUNTIME_DIR: ""
      },
      hostEnv: {
        XDG_RUNTIME_DIR: "/run/user/1000"
      },
      targetRoot: "/home/workspace/vibe64/beepollen"
    }),
    path.join(os.homedir(), ".cache", "vibe64", "agent-providers")
  );
});

test("codex provider reports Unix socket paths that are too long for the OS", async () => {
  await assert.rejects(
    () => startCodexAppServerProcess({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 10,
      runtimeDir: path.join(
        os.tmpdir(),
        "vibe64-codex-provider-socket-path-that-is-far-too-long-for-a-unix-domain-socket",
        "nested-runtime-dir-that-keeps-going",
        "codex-app-server-123456789abc"
      ),
      commandRunner() {
        throw new Error("command runner must not be called for an unsupported socket path");
      },
      WebSocketImpl: ResponsiveFakeWebSocket
    }),
    /Unix socket path is too long/u
  );
});

test("codex provider reuses a live app-server runtime from Vibe64 metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const metadata = metadataForRuntime(runtimeDir);
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      runtimeDir,
      commandRunner() {
        throw new Error("command runner must not be called when metadata is live");
      },
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, true);
    assert.equal(runtime.endpoint, metadata.endpoint);
    assert.equal(runtime.provider, CODEX_APP_SERVER_PROVIDER_ID);
    assert.equal(runtime.transport, CODEX_APP_SERVER_TRANSPORT.UNIX);
  });
});

test("codex provider replaces a live runtime when the Codex tool home changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const oldToolHomeSource = path.join(runtimeDir, "homes", "old-owner");
    const newToolHomeSource = path.join(runtimeDir, "homes", "owner");
    await mkdir(oldToolHomeSource, {
      recursive: true
    });
    await mkdir(newToolHomeSource, {
      recursive: true
    });
    const metadata = metadataForRuntime(runtimeDir, {
      pid: 99999999,
      toolHomeSource: oldToolHomeSource
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const commandCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      toolHomeSource: newToolHomeSource,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.toolHomeSource, newToolHomeSource);
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].credentialHome.home, newToolHomeSource);
    assert.equal(Object.hasOwn(commandCalls[0].env || {}, "NPM_CONFIG_PREFIX"), false);
  });
});

test("codex provider replaces a live runtime when the terminal environment changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const oldTerminalEnv = {
      DB_HOST: "old-mariadb",
      DB_PASSWORD: "old-password"
    };
    const newTerminalEnv = {
      DB_HOST: "new-mariadb",
      DB_PASSWORD: "new-password"
    };
    const metadata = metadataForRuntime(runtimeDir, {
      pid: 99999999,
      terminalEnv: oldTerminalEnv
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const commandCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      terminalEnv: newTerminalEnv,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.terminalEnvHash, terminalEnvHash(newTerminalEnv));
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].baseEnv.DB_HOST, "new-mariadb");
    assert.equal(commandCalls[0].baseEnv.DB_PASSWORD, "new-password");
  });
});

test("codex provider replaces a live runtime when the execution context changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const oldProject = {
      tenant: "old-tenant",
      workspace: "old-tenant"
    };
    const oldSession = {
      metadata: {
        workflow_driver_username: "old-user"
      },
      sessionId: "old-session"
    };
    const newProject = {
      tenant: "sas",
      workspace: "sas"
    };
    const newSession = {
      metadata: {
        workflow_driver_username: "merc"
      },
      sessionId: "session-1"
    };
    const metadata = metadataForRuntime(runtimeDir, {
      pid: 99999999,
      project: oldProject,
      session: oldSession,
      userKey: "old-user"
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const commandCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      project: newProject,
      readyTimeoutMs: 2000,
      runtimeDir,
      session: newSession,
      userKey: "merc",
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.executionContextHash, executionContextHash({
      project: newProject,
      session: newSession,
      userKey: "merc"
    }));
    assert.equal(commandCalls.length, 1);
    assert.deepEqual(commandCalls[0].project, newProject);
    assert.deepEqual(commandCalls[0].session, newSession);
    assert.equal(commandCalls[0].userKey, "merc");
  });
});

test("codex provider replaces a runtime whose socket exists but does not answer", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    FirstErrorThenResponsiveFakeWebSocket.constructorCount = 0;
    const metadata = metadataForRuntime(runtimeDir);
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const commandCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      WebSocketImpl: FirstErrorThenResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);
    assert.deepEqual(commandCalls[0].args.slice(0, 3), [
      "-c",
      STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
      "app-server"
    ]);
    assert.equal(FirstErrorThenResponsiveFakeWebSocket.constructorCount, 3);
  });
});

test("codex provider preserves a live-looking runtime when liveness probe times out", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const metadata = metadataForRuntime(runtimeDir);
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      livenessTimeoutMs: 10,
      runtimeDir,
      commandRunner() {
        throw new Error("command runner must not be called for a suspect app-server runtime");
      },
      WebSocketImpl: SlowInitializeFakeWebSocket
    });

    assert.equal(runtime.reused, true);
    assert.equal(runtime.runtimeStatus, "suspect");
    assert.equal(runtime.endpoint, metadata.endpoint);
  });
});

test("codex provider starts one app-server and stores reusable runtime metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const targetRoot = path.join(runtimeDir, "target");
    const toolHomeSource = path.join(runtimeDir, "homes", "owner");
    const workdir = path.join(targetRoot, ".vibe64", "sessions", "active", "session-1", "source");
    const gitCommandWrapperHostDir = path.join(CODEX_ATTACHMENT_HOST_ROOT, "codex-git-command", "test-runtime");
    const project = {
      tenant: "sas",
      workspace: "sas"
    };
    const session = {
      metadata: {
        workflow_driver_username: "merc"
      },
      sessionId: "session-1",
      targetRoot
    };
    const terminalEnv = {
      VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR: gitCommandWrapperHostDir,
      DB_HOST: "127.0.0.1",
      DB_NAME: "codex_app_server_db",
      DB_PASSWORD: "test-root-password",
      DB_PORT: "24712",
      DB_USER: "vibe64_dev_app",
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/wrong-codex-app-server-playwright",
      VIBE64_WORKSPACE: "sas"
    };
    await mkdir(workdir, {
      recursive: true
    });
    await mkdir(toolHomeSource, {
      recursive: true
    });
    const commandCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      project,
      session,
      targetRoot,
      terminalEnv,
      toolHomeSource,
      userKey: "merc",
      WebSocketImpl: ResponsiveFakeWebSocket,
      workdir
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(commandCalls.length, 1);
    const runCall = commandCalls[0];
    assert.equal(runCall.mode, "detached");
    assert.equal(runCall.purpose, "codex");
    assert.equal(runCall.command, STUDIO_MANAGED_CODEX_COMMAND);
    assert.deepEqual(runCall.args, [
      "-c",
      STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
      "app-server",
      "--listen",
      unixEndpointForRuntime(runtimeDir)
    ]);
    assert.equal(runCall.cwd, workdir);
    assert.equal(runCall.logPath, path.join(runtimeDir, "app-server.log"));
    assert.equal(runCall.credentialHome.home, toolHomeSource);
    assert.equal(Object.hasOwn(runCall.env || {}, "NPM_CONFIG_PREFIX"), false);
    assert.equal(runCall.baseEnv.DB_HOST, "127.0.0.1");
    assert.equal(runCall.baseEnv.DB_NAME, "codex_app_server_db");
    assert.equal(runCall.baseEnv.DB_PASSWORD, "test-root-password");
    assert.equal(runCall.baseEnv.VIBE64_WORKSPACE, "sas");
    assert.deepEqual(runCall.project, project);
    assert.deepEqual(runCall.session, session);
    assert.equal(runCall.userKey, "merc");
    assert.ok(runCall.runtimes.includes("mariadb"));
    assert.ok(runCall.runtimes.includes("playwright"));
    assert.equal(runCall.shimDirs[0], gitCommandWrapperHostDir);
    const envProbe = await runVibe64Command({
      ...runCall,
      args: [
        "-e",
        [
          "console.log(JSON.stringify({",
          "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH,",
          "dbHost: process.env.DB_HOST,",
          "dbName: process.env.DB_NAME,",
          "mysqlDatabase: process.env.MYSQL_DATABASE,",
          "mysqlHost: process.env.MYSQL_HOST,",
          "mysqlPassword: process.env.MYSQL_PWD,",
          "mysqlTcpPort: process.env.MYSQL_TCP_PORT,",
          "mysqlUser: process.env.VIBE64_MYSQL_USER",
          "}));"
        ].join("")
      ],
      command: process.execPath,
      logPath: "",
      mode: "capture"
    });
    assert.equal(envProbe.ok, true, envProbe.output);
    assert.deepEqual(JSON.parse(envProbe.stdout), {
      browsers: "/var/cache/vibe64/playwright",
      dbHost: "127.0.0.1",
      dbName: "codex_app_server_db",
      mysqlDatabase: "codex_app_server_db",
      mysqlHost: "127.0.0.1",
      mysqlPassword: "test-root-password",
      mysqlTcpPort: "24712",
      mysqlUser: "vibe64_dev_app"
    });
    const initProbe = await runVibe64Command({
      ...runCall,
      args: ["init", "-b", "main"],
      command: "git",
      logPath: "",
      mode: "capture",
      runtimes: ["git"]
    });
    assert.equal(initProbe.ok, true, initProbe.output);
    await writeFile(path.join(workdir, "README.md"), "codex app-server identity probe\n", "utf8");
    const addProbe = await runVibe64Command({
      ...runCall,
      args: ["add", "README.md"],
      command: "git",
      logPath: "",
      mode: "capture",
      runtimes: ["git"]
    });
    assert.equal(addProbe.ok, true, addProbe.output);
    const commitProbe = await runVibe64Command({
      ...runCall,
      args: ["commit", "-m", "Codex app-server identity probe"],
      command: "git",
      logPath: "",
      mode: "capture",
      runtimes: ["git"]
    });
    assert.equal(commitProbe.ok, true, commitProbe.output);
    const lsRemoteProbe = await runVibe64Command({
      ...runCall,
      args: ["ls-remote", ".", "refs/heads/main"],
      command: "git",
      logPath: "",
      mode: "capture",
      runtimes: ["git"]
    });
    assert.equal(lsRemoteProbe.ok, true, lsRemoteProbe.output);
    assert.match(lsRemoteProbe.stdout, /refs\/heads\/main/u);

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.attachmentHostRoot, CODEX_ATTACHMENT_HOST_ROOT);
    assert.equal(stored.authStateSignature, "test-auth-state-signature");
    assert.equal(stored.executionContextHash, executionContextHash({
      project,
      session,
      userKey: "merc"
    }));
    assert.equal(stored.processCwd, workdir);
    assert.equal(stored.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(stored.provider, CODEX_APP_SERVER_PROVIDER_ID);
    assert.equal(stored.runtimesHash, runtimesHash(runCall.runtimes));
    assert.equal(stored.terminalEnvHash, terminalEnvHash(terminalEnv));
    assert.equal(stored.DB_PASSWORD, undefined);
    assert.equal(stored.toolHomeSource, toolHomeSource);
    assert.equal(stored.transport, CODEX_APP_SERVER_TRANSPORT.UNIX);
  });
});

test("codex provider uses external session source as the host process cwd", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const targetRoot = path.join(runtimeDir, "project-home");
    const workdir = path.join(runtimeDir, "state", "projects", "demo", "local", "sessions", "active", "session-1", "source");
    await mkdir(workdir, {
      recursive: true
    });
    const commandCalls = [];

    await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      targetRoot,
      WebSocketImpl: ResponsiveFakeWebSocket,
      workdir
    });

    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);
    assert.equal(commandCalls[0].cwd, workdir);
  });
});

test("codex provider stores configured attachment root in metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const attachmentRoot = path.join(runtimeDir, "online-state", "attachments");
    const targetRoot = path.join(runtimeDir, "target");
    await mkdir(targetRoot, {
      recursive: true
    });
    const commandCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      env: {
        [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot
      },
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      targetRoot,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.attachmentHostRoot, attachmentRoot);
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.attachmentHostRoot, attachmentRoot);
  });
});

test("codex provider removes a dead managed app-server runtime directory", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-dead");
    await mkdir(runtimeDir, {
      recursive: true
    });
    await writeFile(path.join(runtimeDir, "runtime.json"), JSON.stringify({
      pid: 99999999,
      runtimeDir,
      transport: "unix"
    }));

    const result = await stopCodexAppServerRuntime({
      runtimeDir
    });

    assert.equal(result.runtimeDirRemoved, true);
    await assert.rejects(
      () => readFile(path.join(runtimeDir, "runtime.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
  });
});

test("codex provider treats inaccessible stale app-server runtime directories as cleanup skips", async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("Root can traverse the permission-denied fixture.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const inaccessibleParent = path.join(baseDir, "private-runtime-parent");
    const runtimeDir = path.join(inaccessibleParent, "codex-app-server-stale");
    await mkdir(runtimeDir, {
      recursive: true
    });
    await writeFile(path.join(runtimeDir, "runtime.json"), JSON.stringify({
      pid: 99999999,
      runtimeDir,
      transport: "unix"
    }));
    await chmod(inaccessibleParent, 0o500);
    try {
      const result = await stopCodexAppServerRuntime({
        runtimeDir
      });

      assert.equal(result.runtimeDirRemoved, false);
      assert.equal(result.runtimeDirCleanupSkipped, true);
      assert.match(result.runtimeDirCleanupError, /permission denied|EACCES/iu);
    } finally {
      await chmod(inaccessibleParent, 0o700).catch(() => null);
    }
  });
});

test("codex provider includes namespace and runtime identity in the runtime directory", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    await withRuntimeNamespace("namespace-a", async () => {
      const targetRoot = path.join(runtimeDir, "target");
      const workdir = path.join(targetRoot, ".vibe64", "sessions", "active", "session-1", "source");
      await mkdir(workdir, {
        recursive: true
      });
      const commandCalls = [];
      await ensureCodexAppServerRuntime({
        authStateSignature: "test-auth-state-signature",
        readyTimeoutMs: 2000,
        runtimeDir,
        commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
        targetRoot,
        WebSocketImpl: ResponsiveFakeWebSocket,
        workdir
      });

      assert.equal(commandCalls.length, 1);
      assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);
      assert.equal(commandCalls[0].cwd, workdir);
    });
  });
});

test("codex provider starts distinct app-server processes for distinct runtime instances", async () => {
  await withTemporaryDirectory(async (runtimeRoot) => {
    const env = {
      VIBE64_AGENT_RUNTIME_DIR: runtimeRoot
    };
    const targetRoot = path.join(runtimeRoot, "target");
    const workdir = path.join(targetRoot, ".vibe64", "sessions", "active", "session-1", "source");
    await mkdir(workdir, {
      recursive: true
    });
    const runtimeDirFor = (runtimeInstanceId) => codexAppServerRuntimeDir({
      env,
      runtimeInstanceId,
      targetRoot,
      workdir
    });
    const firstRuntimeDir = runtimeDirFor("session-one");
    const secondRuntimeDir = runtimeDirFor("session-two");
    const commandCalls = [];
    for (const runtimeInstanceId of ["session-one", "session-two"]) {
      const runtimeDir = runtimeDirFor(runtimeInstanceId);
      await ensureCodexAppServerRuntime({
        authStateSignature: "test-auth-state-signature",
        env,
        readyTimeoutMs: 2000,
        runtimeInstanceId,
        commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
        targetRoot,
        WebSocketImpl: ResponsiveFakeWebSocket,
        workdir
      });
    }

    assert.notEqual(firstRuntimeDir, secondRuntimeDir);
    assert.equal(commandCalls.length, 2);
    assert.deepEqual(commandCalls.map((entry) => entry.command), [
      STUDIO_MANAGED_CODEX_COMMAND,
      STUDIO_MANAGED_CODEX_COMMAND
    ]);
    assert.deepEqual(commandCalls.map((entry) => entry.args.at(-1)), [
      unixEndpointForRuntime(firstRuntimeDir),
      unixEndpointForRuntime(secondRuntimeDir)
    ]);
  });
});

test("codex provider replaces old runtime metadata with host app-server metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const staleMetadata = {
      ...metadataForRuntime(runtimeDir),
      attachmentHostRoot: "",
      pid: 99999999,
      schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION - 1
    };
    await writeMetadata(runtimeDir, staleMetadata);
    const commandCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.schemaVersion, CODEX_APP_SERVER_METADATA_SCHEMA_VERSION);
    assert.equal(stored.attachmentHostRoot, CODEX_ATTACHMENT_HOST_ROOT);
    assert.equal(stored.authStateSignature, "test-auth-state-signature");
  });
});

test("codex provider replaces a live app-server when Codex auth state changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const systemRoot = path.join(runtimeDir, "system");
    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:00:00.000Z"
    });
    const oldAuthStateSignature = await codexAuthStateSignature({
      systemRoot
    });
    const metadata = metadataForRuntime(runtimeDir, {
      authStateSignature: oldAuthStateSignature,
      pid: 99999999
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);

    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });
    const newAuthStateSignature = await codexAuthStateSignature({
      systemRoot
    });
    const commandCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      readyTimeoutMs: 2000,
      runtimeDir,
      systemRoot,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.notEqual(oldAuthStateSignature, newAuthStateSignature);
    assert.equal(runtime.reused, false);
    assert.equal(runtime.authStateSignature, newAuthStateSignature);
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.authStateSignature, newAuthStateSignature);
  });
});

test("codex auth state signature uses the daemon system auth root", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const systemRoot = path.join(runtimeDir, "system");
    const missingSignature = await codexAuthStateSignature({
      systemRoot
    });

    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });

    const presentSignature = await codexAuthStateSignature({
      systemRoot
    });

    assert.notEqual(presentSignature, missingSignature);

    await markCodexReconnectRequired(systemRoot, {
      reason: "unit-test"
    });
    const reconnectSignature = await codexAuthStateSignature({
      systemRoot
    });

    assert.notEqual(reconnectSignature, presentSignature);
  });
});

test("codex provider preflight records reconnect-required when Codex rejects auth", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const systemRoot = path.join(runtimeDir, "system");
    const toolHomeSource = path.join(runtimeDir, "homes", "owner");
    await mkdir(toolHomeSource, {
      recursive: true
    });
    const commandCalls = [];
    const provider = new CodexAppServerAgentProvider({
      runtimeDir,
      commandRunner(request) {
        commandCalls.push(request);
        return {
          exitCode: 1,
          ok: false,
          output: "HTTP error: 401 Unauthorized\nrefresh_token_invalidated\n",
          pid: null,
          signal: "",
          stderr: "HTTP error: 401 Unauthorized\nrefresh_token_invalidated\n",
          stdout: "",
          timedOut: false
        };
      },
      systemRoot,
      toolHomeSource
    });

    await assert.rejects(
      () => provider.preflightAuth("unit-preflight"),
      (error) => {
        assert.equal(error.code, CODEX_RECONNECT_REQUIRED_CODE);
        return true;
      }
    );

    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);
    assert.deepEqual(commandCalls[0].args, [
      "-c",
      STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
      "debug",
      "models"
    ]);
    assert.equal(commandCalls[0].credentialHome.home, toolHomeSource);
    assert.equal(Object.hasOwn(commandCalls[0].env || {}, "NPM_CONFIG_PREFIX"), false);

    const authStatus = await readCodexAuthStatus(systemRoot);
    assert.equal(authStatus.status, "reconnect_required");
    assert.equal(authStatus.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(authStatus.reason, "unit-preflight");
  });
});

test("codex provider starts a host-native app-server", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const commandCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, STUDIO_MANAGED_CODEX_COMMAND);
    assert.deepEqual(commandCalls[0].args, [
      "-c",
      STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
      "app-server",
      "--listen",
      unixEndpointForRuntime(runtimeDir)
    ]);
  });
});

test("codex provider closes a connected client when Codex auth state changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    FakeWebSocket.instances = [];
    const systemRoot = path.join(runtimeDir, "system");
    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:00:00.000Z"
    });
    const commandCalls = [];
    const provider = new CodexAppServerAgentProvider({
      readyTimeoutMs: 2000,
      requestTimeoutMs: 1000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      systemRoot,
      WebSocketImpl: FakeWebSocket
    });

    const connect = provider.connect();
    await waitForCondition(() => FakeWebSocket.instances.length === 1, "Codex app-server liveness client was not opened.");
    await completeInitialize(FakeWebSocket.instances[0]);
    await waitForCondition(() => FakeWebSocket.instances.length === 2, "Codex app-server client was not opened.");
    const socket = FakeWebSocket.instances[1];
    await completeInitialize(socket);
    await connect;

    assert.ok(provider.client);
    assert.equal(socket.closed, false);
    assert.equal(commandCalls.length, 1);

    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });
    const ensure = provider.ensureRuntime();
    await waitForCondition(() => FakeWebSocket.instances.length === 3, "Replacement Codex app-server liveness client was not opened.");
    await completeInitialize(FakeWebSocket.instances[2]);
    const runtime = await ensure;

    assert.equal(runtime.reused, false);
    assert.equal(provider.client, null);
    assert.equal(socket.closed, true);
    assert.equal(commandCalls.length, 2);
    assert.deepEqual(commandCalls.map((call) => call.command), [
      STUDIO_MANAGED_CODEX_COMMAND,
      STUDIO_MANAGED_CODEX_COMMAND
    ]);
  });
});

test("codex provider builds the native Codex CLI resume command for the same thread", () => {
  assert.deepEqual(
    codexCliResumeCommand({
      endpoint: "unix:///tmp/vibe64/codex-app-server/app-server.sock",
      threadId: "019e865d-8108-7740-912b-42ece83a5c73"
    }),
    {
      argv: [
        STUDIO_MANAGED_CODEX_COMMAND,
        "-c",
        STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
        "--remote",
        "unix:///tmp/vibe64/codex-app-server/app-server.sock",
        "resume",
        "019e865d-8108-7740-912b-42ece83a5c73"
      ],
      command: `${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:///tmp/vibe64/codex-app-server/app-server.sock resume 019e865d-8108-7740-912b-42ece83a5c73`
    }
  );
});

test("codex provider keeps Unix endpoints unchanged for terminal clients", () => {
  assert.equal(
    codexAppServerEndpointForTarget("unix:///tmp/vibe64/codex-app-server/app-server.sock"),
    "unix:///tmp/vibe64/codex-app-server/app-server.sock"
  );
});

test("codex turn input uses the app-server text input shape", () => {
  assert.deepEqual(codexTurnInput("Refactor auth.py"), [
    {
      text: "Refactor auth.py",
      text_elements: [],
      type: "text"
    }
  ]);
});

test("codex provider steers the active app-server turn with the expected turn id", async () => {
  const requests = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      requests.push({
        method,
        params
      });
      return {
        turnId: "turn-1"
      };
    }
  });

  const result = await provider.steerTurn("thread-1", "turn-1", "Tighten the tests.");

  assert.equal(result.id, "turn-1");
  assert.deepEqual(requests, [
    {
      method: "turn/steer",
      params: {
        expectedTurnId: "turn-1",
        input: [
          {
            text: "Tighten the tests.",
            text_elements: [],
            type: "text"
          }
        ],
        threadId: "thread-1"
      }
    }
  ]);
});

test("codex provider reads thread status without requesting turns", async () => {
  const requests = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      requests.push({
        method,
        params
      });
      return {
        thread: {
          id: "thread-1",
          status: {
            type: "active"
          }
        }
      };
    }
  });

  const result = await provider.readThreadStatus("thread-1");

  assert.equal(result.id, "thread-1");
  assert.deepEqual(result.raw.status, {
    type: "active"
  });
  assert.deepEqual(requests, [
    {
      method: "thread/read",
      params: {
        includeTurns: false,
        threadId: "thread-1"
      }
    }
  ]);
});

test("codex JSON-RPC client sends initialize and turn/start over WebSocket", async () => {
  FakeWebSocket.instances = [];
  const client = new CodexAppServerJsonRpcClient({
    endpoint: "ws://127.0.0.1:48123",
    requestTimeoutMs: 1000,
    WebSocketImpl: FakeWebSocket
  });

  const connect = client.connect();
  const socket = FakeWebSocket.instances[0];
  socket.emit("open");
  await connect;

  const initialize = client.initialize();
  assert.equal(socket.sent[0].method, "initialize");
  socket.emit("message", {
    data: JSON.stringify({
      id: 1,
      result: {
        codexHome: "/home/test/.codex",
        platformFamily: "unix",
        platformOs: "linux",
        userAgent: "vibe64/0.1.0"
      }
    })
  });
  assert.equal((await initialize).platformOs, "linux");
  assert.equal(socket.sent[1].method, "initialized");

  const turn = client.request("turn/start", {
    input: codexTurnInput("Do the thing"),
    threadId: "thread-1"
  });
  assert.deepEqual(socket.sent[2], {
    id: 2,
    method: "turn/start",
    params: {
      input: [
        {
          text: "Do the thing",
          text_elements: [],
          type: "text"
        }
      ],
      threadId: "thread-1"
    }
  });
  socket.emit("message", {
    data: JSON.stringify({
      id: 2,
      result: {
        turnId: "turn-1"
      }
    })
  });
  assert.deepEqual(await turn, {
    turnId: "turn-1"
  });

  client.close();
});

test("codex JSON-RPC client connects to Unix socket endpoints without WebSocket compression", async () => {
  FakeWebSocket.instances = [];
  const client = new CodexAppServerJsonRpcClient({
    endpoint: "unix:///tmp/vibe64/codex-app-server/app-server.sock",
    requestTimeoutMs: 1000,
    WebSocketImpl: FakeWebSocket
  });

  const connect = client.connect();
  const socket = FakeWebSocket.instances[0];
  socket.emit("open");
  await connect;

  assert.equal(socket.url, "ws://localhost/");
  assert.equal(socket.options.perMessageDeflate, false);
  assert.equal(typeof socket.options.createConnection, "function");

  client.close();
});
