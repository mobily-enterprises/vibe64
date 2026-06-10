import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  codexAuthStateSignature
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
  ensureCodexAppServerRuntime
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  CODEX_ATTACHMENT_HOST_ROOT
} from "@local/vibe64-runtime/server/codexAttachmentPaths";

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

async function writeCodexAuthMarker(dataRoot, {
  connected = true,
  updatedAt = "2026-06-04T00:00:00.000Z"
} = {}) {
  const markerPath = path.join(dataRoot, "provider-homes", "codex", "status.json");
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

function metadataForRuntime(runtimeDir, {
  authStateSignature = "test-auth-state-signature"
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
    logPath: path.join(runtimeDir, "app-server.log"),
    pid: process.pid,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    startedAt: "2026-06-04T00:00:00.000Z",
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

test("codex provider scopes default runtime directory by target root", () => {
  const env = {
    VIBE64_AGENT_RUNTIME_DIR: "/tmp/vibe64-agent-runtime"
  };
  const first = codexAppServerRuntimeDir({
    env,
    targetRoot: "/home/tenant/vibe64/beepollen",
    workdir: "/home/tenant/vibe64/beepollen/.vibe64/sessions/active/one/worktree"
  });
  const second = codexAppServerRuntimeDir({
    env,
    targetRoot: "/home/tenant/vibe64/dogandgroom",
    workdir: "/home/tenant/vibe64/dogandgroom/.vibe64/sessions/active/one/worktree"
  });

  assert.match(first, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.match(second, /^\/tmp\/vibe64-agent-runtime\/codex-app-server-[a-f0-9]{12}$/u);
  assert.notEqual(first, second);
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
      }
    });

    assert.equal(runtime.reused, true);
    assert.equal(runtime.endpoint, metadata.endpoint);
    assert.equal(runtime.provider, CODEX_APP_SERVER_PROVIDER_ID);
    assert.equal(runtime.transport, CODEX_APP_SERVER_TRANSPORT.UNIX);
  });
});

test("codex provider starts one app-server and stores reusable runtime metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const targetRoot = path.join(runtimeDir, "target");
    const workdir = path.join(targetRoot, ".vibe64", "sessions", "active", "session-1", "worktree");
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
      workdir
    });

    assert.equal(runtime.reused, false);
    assert.equal(runtime.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(runtime.containerEndpoint, codexAppServerContainerEndpoint());
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0].command, "docker");
    assert.deepEqual(spawnCalls[0].args.slice(0, 2), ["rm", "-f"]);

    const runCall = spawnCalls[1];
    assert.equal(runCall.command, "docker");
    assert.equal(runCall.args[0], "run");
    assert.equal(spawnCalls[0].args[2], runCall.args[runCall.args.indexOf("--name") + 1]);
    assert.equal(runCall.args[runCall.args.indexOf("--name") + 1], "vibe64-target-codex-app-server");
    assert.ok(runCall.args.includes("--pull"));
    assert.ok(runCall.args.includes("never"));
    assert.ok(runCall.args.includes("--rm"));
    assert.ok(runCall.args.includes(`${runtimeDir}:/vibe64-codex-app-server`));
    assert.ok(runCall.args.includes(`${CODEX_ATTACHMENT_HOST_ROOT}:${CODEX_ATTACHMENT_CONTAINER_ROOT}:ro`));
    assert.ok(runCall.args.includes(`${targetRoot}:/workspace`));
    assert.ok(runCall.args.includes(`${targetRoot}:${targetRoot}`));
    assert.ok(runCall.args.includes(workdir));
    assert.ok(runCall.args.includes("test-codex-toolchain:latest"));
    assert.equal(runCall.args.at(-3), "bash");
    assert.equal(runCall.args.at(-2), "-lc");
    assert.match(runCall.args.at(-1), /codex app-server --listen unix:\/\/\/vibe64-codex-app-server\/app-server\.sock/u);

    const stored = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(stored.attachmentContainerRoot, CODEX_ATTACHMENT_CONTAINER_ROOT);
    assert.equal(stored.attachmentHostRoot, CODEX_ATTACHMENT_HOST_ROOT);
    assert.equal(stored.authStateSignature, "test-auth-state-signature");
    assert.equal(stored.endpoint, unixEndpointForRuntime(runtimeDir));
    assert.equal(stored.containerEndpoint, codexAppServerContainerEndpoint());
    assert.equal(stored.provider, CODEX_APP_SERVER_PROVIDER_ID);
    assert.equal(stored.transport, CODEX_APP_SERVER_TRANSPORT.UNIX);
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
      }
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
    const dataRoot = path.join(runtimeDir, "data");
    await writeCodexAuthMarker(dataRoot, {
      updatedAt: "2026-06-04T00:00:00.000Z"
    });
    const oldAuthStateSignature = await codexAuthStateSignature({
      dataRoot
    });
    const metadata = metadataForRuntime(runtimeDir, {
      authStateSignature: oldAuthStateSignature
    });
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);

    await writeCodexAuthMarker(dataRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });
    const newAuthStateSignature = await codexAuthStateSignature({
      dataRoot
    });
    const spawnCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      dataRoot,
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
      }
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
      useDocker: false
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
    const dataRoot = path.join(runtimeDir, "data");
    await writeCodexAuthMarker(dataRoot, {
      updatedAt: "2026-06-04T00:00:00.000Z"
    });
    const spawnCalls = [];
    const provider = new CodexAppServerAgentProvider({
      dataRoot,
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
      WebSocketImpl: FakeWebSocket
    });

    const connect = provider.connect();
    await waitForCondition(() => FakeWebSocket.instances.length === 1, "Codex app-server client was not opened.");
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    await waitForCondition(() => socket.sent.length === 1, "Codex app-server initialize was not sent.");
    socket.emit("message", {
      data: JSON.stringify({
        id: socket.sent[0].id,
        result: {
          platformOs: "linux"
        }
      })
    });
    await connect;

    assert.ok(provider.client);
    assert.equal(socket.closed, false);
    assert.equal(spawnCalls.length, 2);

    await writeCodexAuthMarker(dataRoot, {
      updatedAt: "2026-06-04T00:01:00.000Z"
    });
    const runtime = await provider.ensureRuntime();

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
      threadId: "019e865d-8108-7740-912b-42ece83a5c73"
    }),
    {
      argv: [
        "codex",
        "--remote",
        codexAppServerContainerEndpoint(),
        "resume",
        "019e865d-8108-7740-912b-42ece83a5c73"
      ],
      command: `codex --remote ${codexAppServerContainerEndpoint()} resume 019e865d-8108-7740-912b-42ece83a5c73`
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
