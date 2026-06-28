import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CODEX_RECONNECT_REQUIRED_CODE,
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
  codexAppServerContainerEndpoint,
  codexAppServerContainerSocketPath,
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
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  CODEX_ATTACHMENT_HOST_ROOT,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  STUDIO_TOOL_HOME_PATH,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  stableHash
} from "@local/studio-terminal-core/server/shellCommands";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";

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

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";

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
  const markerPath = path.join(systemRoot, "provider-homes", "codex", "status.json");
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

async function writeProviderCodexAuthMarker(providerHomesRoot, {
  connected = true,
  updatedAt = "2026-06-04T00:00:00.000Z"
} = {}) {
  const markerPath = path.join(providerHomesRoot, "codex", "status.json");
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

function dockerSafeTestName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "runtime";
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

function metadataForRuntime(runtimeDir, {
  authStateSignature = "test-auth-state-signature",
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  terminalEnv = {},
  toolHomeSource = ""
} = {}) {
  const socketPath = socketPathForRuntime(runtimeDir);
  return {
    attachmentContainerRoot: CODEX_ATTACHMENT_CONTAINER_ROOT,
    attachmentHostRoot: CODEX_ATTACHMENT_HOST_ROOT,
    authStateSignature,
    containerEndpoint: codexAppServerContainerEndpoint(),
    containerRuntimeDir: "/vibe64-codex-app-server",
    containerSocketPath: codexAppServerContainerSocketPath(),
    endpoint: `unix://${socketPath}`,
    healthz: "",
    image,
    logPath: path.join(runtimeDir, "app-server.log"),
    pid: process.pid,
    processCwd: runtimeDir,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    startedAt: "2026-06-04T00:00:00.000Z",
    terminalEnvHash: terminalEnvHash(terminalEnv),
    toolHomeSource,
    transport: CODEX_APP_SERVER_TRANSPORT.UNIX
  };
}

function fakeChild({
  closeCode = 0,
  emitClose = true,
  pid = 12345
} = {}) {
  const listeners = new Map();
  const child = {
    kill() {},
    once(eventName, listener) {
      listeners.set(eventName, listener);
      return child;
    },
    pid,
    unref() {}
  };
  queueMicrotask(() => {
    listeners.get("spawn")?.();
    if (emitClose) {
      listeners.get("close")?.(closeCode, null);
    }
  });
  return child;
}

function fakeOutputChild({
  closeCode = 0,
  stderr = "",
  stdout = ""
} = {}) {
  const child = new EventEmitter();
  child.kill = () => {};
  child.pid = 12345;
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.unref = () => {};
  queueMicrotask(() => {
    if (stdout) {
      child.stdout.emit("data", stdout);
    }
    if (stderr) {
      child.stderr.emit("data", stderr);
    }
    child.emit("close", closeCode, null);
  });
  return child;
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
      targetRoot: "/srv/vibe64/tenants/merc/projects/ddd"
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
    workdir: "/home/workspace/vibe64/beepollen/.vibe64-local/sessions/active/one/source"
  });
  const second = codexAppServerRuntimeDir({
    env,
    targetRoot: "/home/workspace/vibe64/dogandgroom",
    workdir: "/home/workspace/vibe64/dogandgroom/.vibe64-local/sessions/active/one/source"
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
  const workdir = "/home/workspace/vibe64/beepollen/.vibe64-local/sessions/active/one/source";
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
  const workdir = "/home/workspace/vibe64/beepollen/.vibe64-local/sessions/active/one/source";
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

test("codex provider fallback runtime base stays under the target root when XDG runtime is unavailable", () => {
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
    "/home/workspace/vibe64/beepollen/.vibe64/runtime/agent-providers"
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
      spawn() {
        throw new Error("spawn must not be called for an unsupported socket path");
      },
      useDocker: false,
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
      spawn() {
        throw new Error("spawn must not be called when metadata is live");
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
    const oldToolHomeSource = path.join(runtimeDir, "provider-homes", "old-codex");
    const newToolHomeSource = path.join(runtimeDir, "provider-homes", "codex");
    const metadata = metadataForRuntime(runtimeDir, {
      toolHomeSource: oldToolHomeSource
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const spawnCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      toolHomeSource: newToolHomeSource,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.toolHomeSource, newToolHomeSource);
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[1].args.includes(`${newToolHomeSource}:${STUDIO_TOOL_HOME_PATH}`), true);
  });
});

test("codex provider replaces a live runtime when the terminal environment changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const oldTerminalEnv = {
      MYSQL_HOST: "old-mysql",
      MYSQL_PWD: "old-password"
    };
    const newTerminalEnv = {
      MYSQL_HOST: "new-mysql",
      MYSQL_PWD: "new-password"
    };
    const metadata = metadataForRuntime(runtimeDir, {
      terminalEnv: oldTerminalEnv
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const spawnCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      terminalEnv: newTerminalEnv,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.terminalEnvHash, terminalEnvHash(newTerminalEnv));
    assert.equal(spawnCalls.length, 2);
    const runArgs = spawnCalls[1].args;
    assert.equal(runArgs.includes("MYSQL_HOST=new-mysql"), true);
    assert.equal(runArgs.includes("MYSQL_PWD=new-password"), true);
    assert.equal(runArgs.includes("MYSQL_HOST=old-mysql"), false);
    assert.equal(runArgs.includes("MYSQL_PWD=old-password"), false);
  });
});

test("codex provider replaces a live runtime when the toolchain image changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const oldImage = "old-codex-toolchain:latest";
    const newImage = "new-codex-toolchain:latest";
    const metadata = metadataForRuntime(runtimeDir, {
      image: oldImage
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const spawnCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      image: newImage,
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.image, newImage);
    assert.equal(spawnCalls.length, 2);
    const runArgs = spawnCalls[1].args;
    assert.equal(runArgs.includes(newImage), true);
    assert.equal(runArgs.includes(oldImage), false);
  });
});

test("codex provider replaces a runtime whose socket exists but does not answer", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    FirstErrorThenResponsiveFakeWebSocket.constructorCount = 0;
    const metadata = metadataForRuntime(runtimeDir);
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const spawnCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      WebSocketImpl: FirstErrorThenResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0].command, "docker");
    assert.deepEqual(spawnCalls[0].args.slice(0, 2), ["rm", "-f"]);
    assert.equal(spawnCalls[1].command, "docker");
    assert.equal(spawnCalls[1].args[0], "run");
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
      spawn() {
        throw new Error("spawn must not be called for a suspect app-server runtime");
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
    const toolHomeSource = path.join(runtimeDir, "provider-homes", "codex");
    const workdir = path.join(targetRoot, ".vibe64", "sessions", "active", "session-1", "source");
    const terminalEnv = {
      MYSQL_HOST: "vibe64-mariadb",
      MYSQL_PWD: "test-root-password"
    };
    await mkdir(workdir, {
      recursive: true
    });
    const spawnCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      image: "test-codex-toolchain:latest",
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      targetRoot,
      terminalEnv,
      toolHomeSource,
      WebSocketImpl: ResponsiveFakeWebSocket,
      workdir
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(runtime.containerEndpoint, codexAppServerContainerEndpoint());
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0].command, "docker");
    assert.deepEqual(spawnCalls[0].args.slice(0, 2), ["rm", "-f"]);

    const runCall = spawnCalls[1];
    const expectedContainerName = `vibe64-unit-tenant-target-${dockerSafeTestName(path.basename(runtimeDir))}`;
    assert.equal(runCall.command, "docker");
    assert.equal(runCall.args[0], "run");
    assert.equal(spawnCalls[0].args[2], runCall.args[runCall.args.indexOf("--name") + 1]);
    assert.equal(runCall.args[runCall.args.indexOf("--name") + 1], expectedContainerName);
    assert.ok(runCall.args.includes("--pull"));
    assert.ok(runCall.args.includes("never"));
    assert.ok(runCall.args.includes("--rm"));
    assert.ok(runCall.args.includes(`${runtimeDir}:/vibe64-codex-app-server`));
    assert.ok(runCall.args.includes(`${toolHomeSource}:${STUDIO_TOOL_HOME_PATH}`));
    assert.ok(runCall.args.includes("MYSQL_HOST=vibe64-mariadb"));
    assert.ok(runCall.args.includes("MYSQL_PWD=test-root-password"));
    assert.ok(runCall.args.includes(`${CODEX_ATTACHMENT_HOST_ROOT}:${CODEX_ATTACHMENT_CONTAINER_ROOT}:ro`));
    assert.ok(runCall.args.includes(`${targetRoot}:/workspace`));
    assert.ok(runCall.args.includes(`${targetRoot}:${targetRoot}`));
    assert.equal(runCall.args.includes(workdir), false);
    assert.equal(runCall.args[runCall.args.indexOf("-w") + 1], targetRoot);
    assert.ok(runCall.args.includes("test-codex-toolchain:latest"));
    assert.equal(runCall.args.at(-3), "bash");
    assert.equal(runCall.args.at(-2), "-lc");
    assert.match(
      runCall.args.at(-1),
      new RegExp(`${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} app-server --listen unix:\\/\\/\\/vibe64-codex-app-server\\/app-server\\.sock`, "u")
    );
    assert.match(
      runCall.args.at(-1),
      /ln -sfn "\$VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR\/\$VIBE64_CODEX_GIT_COMMAND_NAME" "\/usr\/local\/bin\/\$VIBE64_CODEX_GIT_COMMAND_NAME"/u
    );

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.attachmentContainerRoot, CODEX_ATTACHMENT_CONTAINER_ROOT);
    assert.equal(stored.attachmentHostRoot, CODEX_ATTACHMENT_HOST_ROOT);
    assert.equal(stored.authStateSignature, "test-auth-state-signature");
    assert.equal(stored.processCwd, targetRoot);
    assert.equal(stored.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(stored.image, "test-codex-toolchain:latest");
    assert.equal(stored.containerEndpoint, codexAppServerContainerEndpoint());
    assert.equal(stored.provider, CODEX_APP_SERVER_PROVIDER_ID);
    assert.equal(stored.terminalEnvHash, terminalEnvHash(terminalEnv));
    assert.equal(stored.MYSQL_PWD, undefined);
    assert.equal(stored.toolHomeSource, toolHomeSource);
    assert.equal(stored.transport, CODEX_APP_SERVER_TRANSPORT.UNIX);
  });
});

test("codex provider uses configured attachment root for Docker mount and metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const attachmentRoot = path.join(runtimeDir, "online-state", "attachments");
    const targetRoot = path.join(runtimeDir, "target");
    await mkdir(targetRoot, {
      recursive: true
    });
    const spawnCalls = [];

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      env: {
        [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot
      },
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      targetRoot,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.attachmentHostRoot, attachmentRoot);
    const runCall = spawnCalls.find((call) => call.command === "docker" && call.args[0] === "run");
    assert.ok(runCall);
    assert.ok(runCall.args.includes(`${attachmentRoot}:${CODEX_ATTACHMENT_CONTAINER_ROOT}:ro`));

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.attachmentContainerRoot, CODEX_ATTACHMENT_CONTAINER_ROOT);
    assert.equal(stored.attachmentHostRoot, attachmentRoot);
  });
});

test("codex provider explicitly stops a session app-server runtime", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const targetRoot = path.join(runtimeDir, "target");
    const spawnCalls = [];

    const result = await stopCodexAppServerRuntime({
      runtimeDir,
      spawn(command, args, options) {
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild();
      },
      targetRoot
    });

    const expectedContainerName = `vibe64-unit-tenant-target-${dockerSafeTestName(path.basename(runtimeDir))}`;
    assert.equal(result.removed, true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, "docker");
    assert.deepEqual(spawnCalls[0].args, ["rm", "-f", expectedContainerName]);
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
      runtimeDir,
      useDocker: false
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

test("codex provider includes namespace and runtime identity in app-server Docker container", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    await withRuntimeNamespace("namespace-a", async () => {
      const targetRoot = path.join(runtimeDir, "target");
      const workdir = path.join(targetRoot, ".vibe64", "sessions", "active", "session-1", "source");
      await mkdir(workdir, {
        recursive: true
      });
      const spawnCalls = [];
      await ensureCodexAppServerRuntime({
        authStateSignature: "test-auth-state-signature",
        readyTimeoutMs: 2000,
        runtimeDir,
        spawn(command, args, options) {
          if (command === "docker" && args[0] === "run") {
            writeFileSync(socketPathForRuntime(runtimeDir), "");
          }
          spawnCalls.push({
            args,
            command,
            options
          });
          return fakeChild({
            emitClose: command !== "docker" || args[0] !== "run"
          });
        },
        targetRoot,
        WebSocketImpl: ResponsiveFakeWebSocket,
        workdir
      });

      const removeCall = spawnCalls[0];
      const runCall = spawnCalls[1];
      const expectedContainerName = `vibe64-namespace-a-target-${dockerSafeTestName(path.basename(runtimeDir))}`;
      assert.equal(removeCall.args[2], expectedContainerName);
      assert.equal(runCall.args[runCall.args.indexOf("--name") + 1], expectedContainerName);
    });
  });
});

test("codex provider starts distinct app-server containers for distinct runtime instances", async () => {
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
    const spawnCalls = [];
    for (const runtimeInstanceId of ["session-one", "session-two"]) {
      const runtimeDir = runtimeDirFor(runtimeInstanceId);
      await ensureCodexAppServerRuntime({
        authStateSignature: "test-auth-state-signature",
        env,
        readyTimeoutMs: 2000,
        runtimeInstanceId,
        spawn(command, args, options) {
          if (command === "docker" && args[0] === "run") {
            writeFileSync(socketPathForRuntime(runtimeDir), "");
          }
          spawnCalls.push({
            args,
            command,
            options
          });
          return fakeChild({
            emitClose: command !== "docker" || args[0] !== "run"
          });
        },
        targetRoot,
        WebSocketImpl: ResponsiveFakeWebSocket,
        workdir
      });
    }

    assert.notEqual(firstRuntimeDir, secondRuntimeDir);
    const runCalls = spawnCalls.filter((entry) => entry.command === "docker" && entry.args[0] === "run");
    assert.equal(runCalls.length, 2);
    const containerNames = runCalls.map((entry) => entry.args[entry.args.indexOf("--name") + 1]);
    assert.equal(new Set(containerNames).size, 2);
    assert.equal(containerNames[0], `vibe64-unit-tenant-target-${dockerSafeTestName(path.basename(firstRuntimeDir))}`);
    assert.equal(containerNames[1], `vibe64-unit-tenant-target-${dockerSafeTestName(path.basename(secondRuntimeDir))}`);
  });
});

test("codex provider removes stale app-server container before replacing old runtime metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const staleMetadata = {
      ...metadataForRuntime(runtimeDir),
      attachmentContainerRoot: "",
      attachmentHostRoot: "",
      schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION - 1
    };
    await writeMetadata(runtimeDir, staleMetadata);
    const spawnCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0].command, "docker");
    assert.deepEqual(spawnCalls[0].args.slice(0, 2), ["rm", "-f"]);
    assert.equal(spawnCalls[1].command, "docker");
    assert.equal(spawnCalls[1].args[0], "run");
    assert.equal(spawnCalls[0].args[2], spawnCalls[1].args[spawnCalls[1].args.indexOf("--name") + 1]);

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.schemaVersion, CODEX_APP_SERVER_METADATA_SCHEMA_VERSION);
    assert.equal(stored.attachmentContainerRoot, CODEX_ATTACHMENT_CONTAINER_ROOT);
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
      authStateSignature: oldAuthStateSignature
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);

    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });
    const newAuthStateSignature = await codexAuthStateSignature({
      systemRoot
    });
    const spawnCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      readyTimeoutMs: 2000,
      runtimeDir,
      systemRoot,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.notEqual(oldAuthStateSignature, newAuthStateSignature);
    assert.equal(runtime.reused, false);
    assert.equal(runtime.authStateSignature, newAuthStateSignature);
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0].command, "docker");
    assert.deepEqual(spawnCalls[0].args.slice(0, 2), ["rm", "-f"]);
    assert.equal(spawnCalls[1].command, "docker");
    assert.equal(spawnCalls[1].args[0], "run");

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.authStateSignature, newAuthStateSignature);
  });
});

test("codex auth state signature can use explicit provider homes root", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const providerHomesRoot = path.join(runtimeDir, "provider-homes");
    const systemRoot = path.join(runtimeDir, "system");
    const env = {
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    };
    const missingSignature = await codexAuthStateSignature({
      env,
      systemRoot
    });

    await writeProviderCodexAuthMarker(providerHomesRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });

    const presentSignature = await codexAuthStateSignature({
      env,
      systemRoot
    });

    assert.notEqual(presentSignature, missingSignature);

    await markCodexReconnectRequired(systemRoot, {
      providerHomesRoot,
      reason: "unit-test"
    });
    const reconnectSignature = await codexAuthStateSignature({
      env,
      systemRoot
    });

    assert.notEqual(reconnectSignature, presentSignature);
  });
});

test("codex provider preflight records reconnect-required when Codex rejects auth", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const providerHomesRoot = path.join(runtimeDir, "provider-homes");
    const systemRoot = path.join(runtimeDir, "system");
    const toolHomeSource = path.join(providerHomesRoot, "codex");
    const spawnCalls = [];
    const provider = new CodexAppServerAgentProvider({
      runtimeDir,
      spawn(command, args, options) {
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeOutputChild({
          closeCode: 1,
          stderr: "HTTP error: 401 Unauthorized\nrefresh_token_invalidated\n"
        });
      },
      systemRoot,
      toolHomeSource,
      useDocker: false
    });

    await assert.rejects(
      () => provider.preflightAuth("unit-preflight"),
      (error) => {
        assert.equal(error.code, CODEX_RECONNECT_REQUIRED_CODE);
        return true;
      }
    );

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, "codex");
    assert.deepEqual(spawnCalls[0].args, [
      "-c",
      STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
      "debug",
      "models"
    ]);
    assert.equal(spawnCalls[0].options.env.HOME, toolHomeSource);

    const authStatus = await readCodexAuthStatus(systemRoot, {
      providerHomesRoot
    });
    assert.equal(authStatus.status, "reconnect_required");
    assert.equal(authStatus.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(authStatus.reason, "unit-preflight");
  });
});

test("codex provider can still start a native app-server when explicitly requested", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const spawnCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "test-auth-state-signature",
      readyTimeoutMs: 2000,
      runtimeDir,
      spawn(command, args, options) {
        writeFileSync(socketPathForRuntime(runtimeDir), "");
        spawnCalls.push({
          args,
          command,
          options
        });
        return {
          pid: 12345,
          unref() {}
        };
      },
      useDocker: false,
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, "codex");
    assert.deepEqual(spawnCalls[0].args, ["app-server", "--listen", unixEndpointForRuntime(runtimeDir)]);
  });
});

test("codex provider closes a connected client when Codex auth state changes", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    FakeWebSocket.instances = [];
    const systemRoot = path.join(runtimeDir, "system");
    await writeCodexAuthMarker(systemRoot, {
      updatedAt: "2026-06-04T00:00:00.000Z"
    });
    const spawnCalls = [];
    const provider = new CodexAppServerAgentProvider({
      readyTimeoutMs: 2000,
      requestTimeoutMs: 1000,
      runtimeDir,
      spawn(command, args, options) {
        if (command === "docker" && args[0] === "run") {
          writeFileSync(socketPathForRuntime(runtimeDir), "");
        }
        spawnCalls.push({
          args,
          command,
          options
        });
        return fakeChild({
          emitClose: command !== "docker" || args[0] !== "run"
        });
      },
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
    assert.equal(spawnCalls.length, 2);

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
    assert.equal(spawnCalls.length, 4);
    assert.equal(spawnCalls[2].command, "docker");
    assert.deepEqual(spawnCalls[2].args.slice(0, 2), ["rm", "-f"]);
    assert.equal(spawnCalls[3].command, "docker");
    assert.equal(spawnCalls[3].args[0], "run");
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
        "codex",
        "--remote",
        "unix:///tmp/vibe64/codex-app-server/app-server.sock",
        "resume",
        "019e865d-8108-7740-912b-42ece83a5c73"
      ],
      command: "codex --remote unix:///tmp/vibe64/codex-app-server/app-server.sock resume 019e865d-8108-7740-912b-42ece83a5c73"
    }
  );
  assert.deepEqual(
    codexCliResumeCommand({
      endpoint: codexAppServerContainerEndpoint(),
      target: "container",
      threadId: "019e865d-8108-7740-912b-42ece83a5c73"
    }),
    {
      argv: [
        STUDIO_MANAGED_CODEX_COMMAND,
        "-c",
        STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
        "--remote",
        codexAppServerContainerEndpoint(),
        "resume",
        "019e865d-8108-7740-912b-42ece83a5c73"
      ],
      command: `${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote ${codexAppServerContainerEndpoint()} resume 019e865d-8108-7740-912b-42ece83a5c73`
    }
  );
});

test("codex provider keeps Unix endpoints unchanged for Docker terminal clients", () => {
  assert.equal(
    codexAppServerEndpointForTarget(codexAppServerContainerEndpoint(), {
      target: "container"
    }),
    codexAppServerContainerEndpoint()
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
