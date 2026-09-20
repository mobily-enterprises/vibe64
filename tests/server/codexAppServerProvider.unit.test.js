import { CodexAppServerJsonRpcClient } from "@jskit-ai/assistant-core/server/codex-client";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_TRANSPORT,
  CodexAppServerAgentProvider,
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerEconomyHomeDir,
  codexAppServerEconomyWorkspaceDir,
  codexAppServerRequestIsInvalid,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexCliResumeCommand,
  codexTurnInput,
  currentCodexAccountIdentitySignature,
  ensureCodexAppServerRuntime,
  readCodexSelectedAccountAccess,
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
import {
  genesisCommandShimDirectory
} from "@local/vibe64-genesis/server";

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

async function waitForCondition(condition, message = "Timed out waiting for condition.", timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
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

async function writeChatgptAuth(toolHomeSource, {
  accessToken = "access-token-one",
  accountId = "account-one",
  refreshToken = "refresh-token-must-never-be-used"
} = {}) {
  const codexHome = path.join(toolHomeSource, ".codex");
  await mkdir(codexHome, { mode: 0o700, recursive: true });
  await writeFile(path.join(codexHome, "auth.json"), `${JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    tokens: {
      access_token: accessToken,
      account_id: accountId,
      refresh_token: refreshToken
    }
  }, null, 2)}\n`, { mode: 0o600 });
}

async function writeApiKeyAuth(toolHomeSource, apiKey = "sk-test-economy-key") {
  const codexHome = path.join(toolHomeSource, ".codex");
  await mkdir(codexHome, { mode: 0o700, recursive: true });
  await writeFile(path.join(codexHome, "auth.json"), `${JSON.stringify({
    OPENAI_API_KEY: apiKey,
    auth_mode: "apikey",
    tokens: null
  }, null, 2)}\n`, { mode: 0o600 });
}

function socketPathForRuntime(runtimeDir) {
  return path.join(runtimeDir, "app-server.sock");
}

function unixEndpointForRuntime(runtimeDir) {
  return `unix://${socketPathForRuntime(runtimeDir)}`;
}

function terminalEnvHash(terminalEnv = {}) {
  const excludedNames = new Set([
    "DBUS_SESSION_BUS_ADDRESS",
    "DBUS_STARTER_ADDRESS",
    "DBUS_STARTER_BUS_TYPE"
  ]);
  return stableHash(JSON.stringify(Object.entries(terminalEnv)
    .map(([name, value]) => [
      String(name || "").trim(),
      String(value ?? "")
    ])
    .filter(([name, value]) => (
      name &&
      String(value || "") &&
      !excludedNames.has(name)
    ))
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
  processIdentity = null,
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
    executionId: "11111111-1111-4111-8111-111111111112",
    executionContextHash: executionContextHash({
      project,
      session,
      userKey
    }),
    healthz: "",
    logPath: path.join(runtimeDir, "app-server.log"),
    pid,
    processCwd: runtimeDir,
    processIdentity: processIdentity || {
      commandHash: "0123456789ab",
      platform: "linux-proc",
      runtimeToken: "11111111-1111-4111-8111-111111111111",
      startTimeTicks: "1",
      version: 1
    },
    processState: "running",
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

async function processIdentityForFixture(pid, runtimeToken, commandHash) {
  const statText = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = statText.slice(statText.lastIndexOf(")") + 1).trim().split(/\s+/u);
  return {
    commandHash,
    platform: "linux-proc",
    runtimeToken,
    startTimeTicks: fields[19],
    version: 1
  };
}

function codexAppServerCommandRunner(runtimeDir, commandCalls = []) {
  return async (request) => {
    if (request.args.includes("app-server")) {
      writeFileSync(socketPathForRuntime(runtimeDir), "");
    }
    commandCalls.push(request);
    return {
      execution: {
        ...request.execution,
        id: randomUUID()
      },
      exitCode: 0,
      ok: true,
      output: "",
      pid: 12345,
      processIdentity: {
        commandHash: request.baseEnv.VIBE64_CODEX_APP_SERVER_COMMAND_HASH,
        platform: "linux-proc",
        runtimeToken: request.baseEnv.VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN,
        startTimeTicks: "12345",
        version: 1
      },
      signal: "",
      stderr: "",
      stdout: "",
      timedOut: false
    };
  };
}

function managedCodexAppServerArgs(call = {}) {
  assert.equal(call.command, "/bin/sh");
  assert.deepEqual(call.args?.slice(0, 4), [
    "-c",
    [
      "umask 0007",
      "unset DBUS_SESSION_BUS_ADDRESS DBUS_STARTER_ADDRESS DBUS_STARTER_BUS_TYPE",
      'exec "$@"'
    ].join("\n"),
    "vibe64-codex-app-server",
    STUDIO_MANAGED_CODEX_COMMAND
  ]);
  return call.args.slice(4);
}

function assertInteractiveCodexAppServerArgs(args = [], tail = []) {
  assert.deepEqual(args.slice(0, 5), [
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "-c",
    "features.hooks=true",
    "-c"
  ]);
  assert.match(
    args[5],
    /^hooks\.PreToolUse=\[\{matcher="\^Bash\$",hooks=\[\{type="command",command=.*agentSessionCommandHook\.js.*timeout=30\}\]\}\]$/u
  );
  assert.deepEqual(args.slice(6), [
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    ...tail
  ]);
}

async function startOrphanedDetachedProcessGroup(directory) {
  const childPidPath = path.join(directory, "child.pid");
  const script = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });",
    "writeFileSync(process.argv[1], String(child.pid));",
    "child.unref();",
    "setTimeout(() => {}, 100);"
  ].join("\n");
  const runtimeToken = randomUUID();
  const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
  const leader = spawn(process.execPath, ["-e", script, childPidPath], {
    detached: true,
    env: {
      ...process.env,
      VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
      VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
    },
    stdio: "ignore"
  });
  const processGroupId = leader.pid;
  const processIdentity = await processIdentityForFixture(
    processGroupId,
    runtimeToken,
    commandHash
  );
  await new Promise((resolve, reject) => {
    leader.once("error", reject);
    leader.once("exit", resolve);
  });
  return {
    childPid: Number(await readFile(childPidPath, "utf8")),
    processGroupId,
    processIdentity
  };
}

async function startDetachedProcessGroupWithTransientUnmarkedMember(directory) {
  const readyPath = path.join(directory, "transient-member.ready");
  const script = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const exact = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });",
    "const unmarkedEnv = { ...process.env };",
    "delete unmarkedEnv.VIBE64_CODEX_APP_SERVER_COMMAND_HASH;",
    "delete unmarkedEnv.VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN;",
    "const transient = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400);'], { env: unmarkedEnv, stdio: 'ignore' });",
    "writeFileSync(process.argv[1], JSON.stringify({ exactPid: exact.pid, transientPid: transient.pid }));",
    "setInterval(() => {}, 1000);"
  ].join("\n");
  const runtimeToken = randomUUID();
  const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
  const leader = spawn(process.execPath, ["-e", script, readyPath], {
    detached: true,
    env: {
      ...process.env,
      VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
      VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
    },
    stdio: "ignore"
  });
  leader.unref();
  let members = null;
  const readyDeadline = Date.now() + 1000;
  while (!members && Date.now() < readyDeadline) {
    try {
      members = JSON.parse(await readFile(readyPath, "utf8"));
    } catch {
      await delay(5);
    }
  }
  if (!Number.isSafeInteger(Number(members?.transientPid))) {
    throw new Error("Timed out waiting for transient process-group member.");
  }
  return {
    ...members,
    processGroupId: leader.pid,
    processIdentity: await processIdentityForFixture(
      leader.pid,
      runtimeToken,
      commandHash
    )
  };
}

async function startDetachedProcessWithDetachedCommand(directory) {
  const commandPidPath = path.join(directory, "command.pid");
  const script = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const command = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { detached: true, stdio: 'ignore' });",
    "writeFileSync(process.argv[1], String(command.pid));",
    "command.unref();",
    "setInterval(() => {}, 1000);"
  ].join("\n");
  const runtimeToken = randomUUID();
  const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
  const leader = spawn(process.execPath, ["-e", script, commandPidPath], {
    detached: true,
    env: {
      ...process.env,
      VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
      VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
    },
    stdio: "ignore"
  });
  const processIdentity = await processIdentityForFixture(
    leader.pid,
    runtimeToken,
    commandHash
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const commandPid = Number(await readFile(commandPidPath, "utf8"));
      if (commandPid > 0) {
        return {
          commandPid,
          processGroupId: leader.pid,
          processIdentity
        };
      }
    } catch {
      // The child writes its PID immediately after spawning the command.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Detached command fixture did not start.");
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
            platformOs: "linux",
            userAgent: "  vibe64/0.149.0 (unit test)  "
          }
        })
      }));
    }
  }
}

test("codex provider preserves observers across connection replacement and rejects old socket output", async () => {
  const provider = new CodexAppServerAgentProvider({ WebSocketImpl: ResponsiveFakeWebSocket });
  const runtime = { endpoint: "ws://localhost:9999" };
  provider.ensureRuntime = async () => {
    provider.runtime = runtime;
    return runtime;
  };
  const received = [];
  try {
    await provider.connect();
    const firstSocket = FakeWebSocket.instances.at(-1);
    const unsubscribe = provider.subscribe((event) => received.push(event.params.text));
    const emit = (socket, text) => socket.emit("message", {
      data: JSON.stringify({ method: "item/completed", params: { text } })
    });
    emit(firstSocket, "before reconnect");
    // Deliberate replacement follows the owner's stop policy; it is not a
    // license to reconnect automatically after an unexpected observation loss.
    provider.client.close();
    await provider.connect();
    const replacementSocket = FakeWebSocket.instances.at(-1);
    assert.notEqual(firstSocket, replacementSocket);
    emit(replacementSocket, "after reconnect");
    emit(firstSocket, "obsolete socket");
    unsubscribe();
    emit(replacementSocket, "after unsubscribe");
    assert.deepEqual(received, ["before reconnect", "after reconnect"]);
  } finally {
    provider.close();
  }
});

class EconomyResponsiveFakeWebSocket extends ResponsiveFakeWebSocket {
  send(payload) {
    super.send(payload);
    const message = this.sent.at(-1);
    if (message?.id && message.method === "account/login/start") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          id: message.id,
          result: {
            type: message.params?.type
          }
        })
      }));
    }
    if (message?.id && message.method === "account/read") {
      const login = this.sent.find((entry) => entry.method === "account/login/start");
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          id: message.id,
          result: {
            account: {
              type: login?.params?.type === "apiKey" ? "apiKey" : "chatgpt"
            },
            requiresOpenaiAuth: true
          }
        })
      }));
    }
  }
}

class OversizedServerInfoFakeWebSocket extends FakeWebSocket {
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
            userAgent: `vibe64/0.149.0 ${"x".repeat(1024)}`
          }
        })
      }));
    }
  }
}

class UnresponsiveFakeWebSocket extends FakeWebSocket {
  constructor(...args) {
    super(...args);
    queueMicrotask(() => this.emit("error", new Error("unresponsive")));
  }
}

class EconomyLoginErrorFakeWebSocket extends ResponsiveFakeWebSocket {
  send(payload) {
    super.send(payload);
    const message = this.sent.at(-1);
    if (message?.id && message.method === "account/login/start") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          error: {
            code: -32000,
            message: "login rejected with secret-token"
          },
          id: message.id
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

class InitializeErrorFakeWebSocket extends FakeWebSocket {
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
          error: {
            code: -32000,
            message: "initialize failed"
          },
          id: message.id
        })
      }));
    }
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
  await withTemporaryDirectory(async (root) => {
    await assert.rejects(
      () => startCodexAppServerProcess({
        authStateSignature: "test-auth-state-signature",
        readyTimeoutMs: 10,
        runtimeDir: path.join(
          root,
          "socket-path-that-is-far-too-long-for-a-unix-domain-socket",
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
});

test("codex provider reuses a live app-server runtime from Vibe64 metadata", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const metadata = metadataForRuntime(runtimeDir);
    await writeFile(metadata.socketPath, "");
    await writeMetadata(runtimeDir, metadata);
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      processGroupIsAlive: () => true,
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
        session_git_command_actor_user_key: "old-user"
      },
      sessionId: "old-session"
    };
    const newProject = {
      tenant: "sas",
      workspace: "sas"
    };
    const newSession = {
      metadata: {
        session_git_command_actor_user_key: "merc"
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
      processGroupIsAlive: () => true,
      readyTimeoutMs: 2000,
      runtimeDir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls),
      WebSocketImpl: FirstErrorThenResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, false);
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].command, "/bin/sh");
    assert.equal(commandCalls[0].execution.label, "Codex assistant");
    assertInteractiveCodexAppServerArgs(
      managedCodexAppServerArgs(commandCalls[0]),
      ["app-server", "--listen", unixEndpointForRuntime(runtimeDir)]
    );
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
      processGroupIsAlive: () => true,
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

test("codex provider reuses an owned runtime while its process identity is still settling", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const metadata = metadataForRuntime(runtimeDir);
    await writeMetadata(runtimeDir, metadata);

    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: metadata.authStateSignature,
      processIdentityInspector: async () => ({
        processGroupIds: [metadata.pid],
        status: "ambiguous"
      }),
      runtimeDir,
      commandRunner() {
        throw new Error("command runner must not replace an owned app-server whose identity is settling");
      },
      WebSocketImpl: ResponsiveFakeWebSocket
    });

    assert.equal(runtime.reused, true);
    assert.equal(runtime.runtimeStatus, "suspect");
    assert.equal(runtime.executionId, metadata.executionId);
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
        session_git_command_actor_user_key: "merc"
      },
      sessionId: "session-1",
      targetRoot
    };
    const terminalEnv = {
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/bus",
      DBUS_STARTER_BUS_TYPE: "session",
      VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR: gitCommandWrapperHostDir,
      DB_CLIENT: "mysql2",
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
      env: {
        ...process.env,
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/inherited-bus",
        DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/inherited-bus",
        DBUS_STARTER_BUS_TYPE: "session"
      },
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
    assert.equal(runCall.command, "/bin/sh");
    assertInteractiveCodexAppServerArgs(
      managedCodexAppServerArgs(runCall),
      [
        "-c",
        `projects={${JSON.stringify(workdir)}={trust_level="trusted"}}`,
        "app-server",
        "--listen",
        unixEndpointForRuntime(runtimeDir)
      ]
    );
    assert.equal(runCall.cwd, workdir);
    assert.equal(runCall.logPath, path.join(runtimeDir, "app-server.log"));
    assert.equal(runCall.inheritProcessEnv, false);
    assert.equal(runCall.credentialHome.home, toolHomeSource);
    assert.equal(Object.hasOwn(runCall.env || {}, "NPM_CONFIG_PREFIX"), false);
    assert.equal(runCall.baseEnv.DB_HOST, "127.0.0.1");
    assert.equal(runCall.baseEnv.DB_NAME, "codex_app_server_db");
    assert.equal(runCall.baseEnv.DB_PASSWORD, "test-root-password");
    assert.equal(runCall.baseEnv.VIBE64_WORKSPACE, "sas");
    assert.equal(Object.hasOwn(runCall.baseEnv, "DBUS_SESSION_BUS_ADDRESS"), false);
    assert.equal(Object.hasOwn(runCall.baseEnv, "DBUS_STARTER_ADDRESS"), false);
    assert.equal(Object.hasOwn(runCall.baseEnv, "DBUS_STARTER_BUS_TYPE"), false);
    assert.deepEqual(runCall.project, project);
    assert.deepEqual(runCall.session, session);
    assert.equal(runCall.userKey, "merc");
    assert.ok(runCall.runtimes.includes("mariadb"));
    assert.ok(runCall.runtimes.includes("playwright"));
    assert.deepEqual(runCall.shimDirs, [
      gitCommandWrapperHostDir,
      genesisCommandShimDirectory()
    ]);
    const startupEnvProbe = await runVibe64Command({
      ...runCall,
      args: [
        "-c",
        runCall.args[1],
        "vibe64-codex-app-server-env-probe",
        process.execPath,
        "-e",
        [
          "console.log(JSON.stringify({",
          "dbHost: process.env.DB_HOST,",
          "sessionBus: process.env.DBUS_SESSION_BUS_ADDRESS,",
          "starterAddress: process.env.DBUS_STARTER_ADDRESS,",
          "starterType: process.env.DBUS_STARTER_BUS_TYPE",
          "}));"
        ].join("")
      ],
      baseEnv: {
        ...runCall.baseEnv,
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/reintroduced-bus",
        DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/reintroduced-bus",
        DBUS_STARTER_BUS_TYPE: "session"
      },
      command: "/bin/sh",
      execution: undefined,
      logPath: "",
      mode: "capture"
    });
    assert.equal(startupEnvProbe.ok, true, startupEnvProbe.output);
    assert.deepEqual(JSON.parse(startupEnvProbe.stdout), {
      dbHost: "127.0.0.1"
    });
    const envProbe = await runVibe64Command({
      ...runCall,
      execution: undefined,
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
      browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
      dbHost: "127.0.0.1",
      dbName: "codex_app_server_db"
    });
    const initProbe = await runVibe64Command({
      ...runCall,
      execution: undefined,
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
      execution: undefined,
      args: ["add", "README.md"],
      command: "git",
      logPath: "",
      mode: "capture",
      runtimes: ["git"]
    });
    assert.equal(addProbe.ok, true, addProbe.output);
    const commitProbe = await runVibe64Command({
      ...runCall,
      execution: undefined,
      args: ["commit", "-m", "Codex app-server identity probe"],
      command: "git",
      logPath: "",
      mode: "capture",
      runtimes: ["git"]
    });
    assert.equal(commitProbe.ok, true, commitProbe.output);
    const lsRemoteProbe = await runVibe64Command({
      ...runCall,
      execution: undefined,
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

test("codex app-server process and every descendant start with the managed workspace umask", async () => {
  let temporaryRoot = "";
  await withTemporaryDirectory(async (root) => {
    temporaryRoot = root;
    const runtimeDir = path.join(root, "codex-app-server-umask-test");
    const workdir = path.join(root, "source");
    const probePath = path.join(root, "umask.txt");
    const fakeCodexPath = path.join(root, "fake-codex.cjs");
    await mkdir(workdir, {
      recursive: true
    });
    await writeFile(fakeCodexPath, [
      "#!/usr/bin/env node",
      'const { writeFileSync } = require("node:fs");',
      'const endpoint = process.argv[process.argv.indexOf("--listen") + 1] || "";',
      'if (endpoint.startsWith("unix://")) writeFileSync(endpoint.slice("unix://".length), "");',
      'writeFileSync(process.env.VIBE64_TEST_UMASK_PATH, process.umask().toString(8));',
      "setInterval(() => {}, 1000);"
    ].join("\n") + "\n", "utf8");
    await chmod(fakeCodexPath, 0o755);

    let runtime = null;
    try {
      runtime = await startCodexAppServerProcess({
        authStateSignature: "test-auth-state-signature",
        codexCommand: fakeCodexPath,
        env: {
          ...process.env,
          VIBE64_TEST_UMASK_PATH: probePath
        },
        runtimeDir,
        WebSocketImpl: ResponsiveFakeWebSocket,
        workdir
      });
      await writeMetadata(runtimeDir, runtime);
      let observed = "";
      for (let attempt = 0; attempt < 100 && !observed; attempt += 1) {
        observed = await readFile(probePath, "utf8").catch(() => "");
        if (!observed) {
          await delay(10);
        }
      }
      assert.equal(observed, "7");
    } finally {
      const stopped = await stopCodexAppServerRuntime({
        runtimeDir
      });
      if (runtime?.pid) {
        assert.equal(stopped.stopped, true);
        assert.equal(stopped.runtimeDirRemoved, true);
        assert.throws(() => process.kill(-runtime.pid, 0), {
          code: "ESRCH"
        });
      }
    }
  });
  await assert.rejects(() => access(temporaryRoot), {
    code: "ENOENT"
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
    managedCodexAppServerArgs(commandCalls[0]);
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
    managedCodexAppServerArgs(commandCalls[0]);

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
    await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
      pid: 99999999
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

test("codex provider releases verified stopped runtime without stopping expired execution ownership", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-stopped");
    await mkdir(runtimeDir, { recursive: true });
    await writeMetadata(runtimeDir, {
      ...metadataForRuntime(runtimeDir),
      processExitVerifiedAt: "2026-08-27T00:00:00.000Z",
      processState: "stopped"
    });
    let stopCalls = 0;

    const result = await stopCodexAppServerRuntime({
      runtimeDir,
      async stopExecution() {
        stopCalls += 1;
        throw new Error("A verified stopped runtime must not stop expired execution ownership.");
      }
    });

    assert.equal(stopCalls, 0);
    assert.equal(result.alreadyStopped, true);
    assert.equal(result.processExitVerified, true);
    assert.equal(result.runtimeDirRemoved, true);
    await assert.rejects(access(runtimeDir), { code: "ENOENT" });
  });
});

test("codex provider recovers its exact managed scope after resource history expires", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-expired-record");
    await mkdir(runtimeDir, { recursive: true });
    const metadata = metadataForRuntime(runtimeDir, { pid: 99999999 });
    await writeMetadata(runtimeDir, metadata);
    const stops = [];

    const result = await stopCodexAppServerRuntime({
      runtimeDir,
      async stopExecution(executionId, options) {
        stops.push({ executionId, options });
        return {
          executionId,
          ok: true,
          scopeEmpty: true,
          stopped: false
        };
      }
    });

    assert.equal(result.processExitVerified, true);
    assert.equal(result.runtimeDirRemoved, true);
    assert.deepEqual(stops, [{
      executionId: metadata.executionId,
      options: {
        allowMissingRecordScopeRecovery: true,
        killTimeoutMs: undefined,
        reason: "codex-app-server-stop",
        termTimeoutMs: undefined
      }
    }]);
  });
});

test("codex provider does not invent exit proof for malformed runtime metadata", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-malformed");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path.join(runtimeDir, "runtime.json"), JSON.stringify({
      pid: 99999999,
      runtimeDir
    }));

    const result = await stopCodexAppServerRuntime({ runtimeDir });

    assert.equal(result.processExitVerified, false);
    assert.equal(result.runtimeDirRemoved, false);
    assert.equal(await access(runtimeDir).then(() => true), true);
  });
});

test("codex provider never signals a reused process group and preserves exact exit proof", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-reused-pgid");
    await mkdir(runtimeDir, { recursive: true });
    await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
      pid: 45123
    }));
    const signals = [];

    const result = await stopCodexAppServerRuntime({
      preserveProcessExitProof: true,
      processIdentityInspector: async () => ({
        processGroupIds: [],
        status: "mismatch"
      }),
      runtimeDir,
      signalProcessGroup(processGroupId, signal) {
        signals.push([processGroupId, signal]);
      }
    });

    assert.equal(result.processExitVerified, true);
    assert.equal(result.runtimeDirPreserved, true);
    assert.deepEqual(signals, []);
    const proof = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
    assert.equal(proof.processState, "stopped");
    assert.match(proof.processExitVerifiedAt, /^\d{4}-\d{2}-\d{2}T/u);
  });
});

test("codex provider fails closed without signaling an ambiguous process group", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-ambiguous-pgid");
    await mkdir(runtimeDir, { recursive: true });
    await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
      pid: 45124
    }));
    const signals = [];

    const result = await stopCodexAppServerRuntime({
      preserveProcessExitProof: true,
      processIdentitySettleTimeoutMs: 1,
      processIdentityInspector: async () => ({
        processGroupIds: [45124],
        status: "ambiguous"
      }),
      runtimeDir,
      signalProcessGroup(processGroupId, signal) {
        signals.push([processGroupId, signal]);
      }
    });

    assert.equal(result.processExitVerified, false);
    assert.equal(result.runtimeDirPreserved, false);
    assert.deepEqual(signals, []);
    assert.equal(
      JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8")).processState,
      "running"
    );
  });
});

test("codex provider waits for transient identity ambiguity before signaling an exact process group", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-transient-ambiguous-pgid");
    await mkdir(runtimeDir, { recursive: true });
    await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
      pid: 45126
    }));
    let inspections = 0;
    const signals = [];

    const result = await stopCodexAppServerRuntime({
      preserveProcessExitProof: true,
      processIdentityInspector: async () => {
        inspections += 1;
        if (inspections === 1) {
          return {
            processGroupIds: [],
            status: "ambiguous"
          };
        }
        return signals.length > 0
          ? { processGroupIds: [], status: "absent" }
          : { processGroupIds: [45126], status: "exact" };
      },
      processIdentitySettlePollMs: 1,
      processIdentitySettleTimeoutMs: 50,
      runtimeDir,
      signalProcessGroup(processGroupId, signal) {
        signals.push([processGroupId, signal]);
      }
    });

    assert.equal(result.processExitVerified, true);
    assert.equal(result.runtimeDirPreserved, true);
    assert.deepEqual(signals, [[45126, "SIGTERM"]]);
    assert.ok(inspections >= 5);
    assert.equal(
      JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8")).processState,
      "stopped"
    );
  });
});

test("renewal shutdown waits for a transient unmarked process-group member without weakening identity proof", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux /proc process-group identity inspection is required.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-transient-member");
    await mkdir(runtimeDir, { recursive: true });
    const fixture = await startDetachedProcessGroupWithTransientUnmarkedMember(runtimeDir);
    try {
      await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
        pid: fixture.processGroupId,
        processIdentity: fixture.processIdentity
      }));
      const startedAt = Date.now();

      const result = await stopCodexAppServerRuntime({
        preserveProcessExitProof: true,
        processIdentitySettleTimeoutMs: 2500,
        runtimeDir
      });

      assert.equal(result.stopped, true, JSON.stringify(result));
      assert.equal(result.processExitVerified, true);
      assert.equal(result.runtimeDirPreserved, true);
      assert.ok(Date.now() - startedAt >= 100);
      assert.throws(() => process.kill(-fixture.processGroupId, 0), {
        code: "ESRCH"
      });
    } finally {
      try {
        process.kill(-fixture.processGroupId, "SIGKILL");
      } catch {
        // The verified shutdown path normally stops the complete fixture group.
      }
    }
  });
});

test("codex provider rechecks exact identity before escalation", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-escalation-race");
    await mkdir(runtimeDir, { recursive: true });
    await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
      pid: 45125
    }));
    let status = "exact";
    const signals = [];

    const result = await stopCodexAppServerRuntime({
      processIdentityInspector: async () => ({
        processGroupIds: status === "exact" ? [45125] : [],
        status
      }),
      runtimeDir,
      signalProcessGroup(processGroupId, signal) {
        signals.push([processGroupId, signal]);
        status = "ambiguous";
      },
      termTimeoutMs: 1
    });

    assert.equal(result.processExitVerified, false);
    assert.deepEqual(signals, [[45125, "SIGTERM"]]);
  });
});

test("renewal shutdown preserves exact process-exit proof across restart until final release", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process groups are not available on Windows.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-renewal-proof");
    await mkdir(runtimeDir, { recursive: true });
    const fixture = await startOrphanedDetachedProcessGroup(runtimeDir);
    try {
      await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
        pid: fixture.processGroupId,
        processIdentity: fixture.processIdentity
      }));

      const stopped = await stopCodexAppServerRuntime({
        preserveProcessExitProof: true,
        runtimeDir
      });
      assert.equal(stopped.stopped, true);
      assert.equal(stopped.processExitVerified, true);
      assert.equal(stopped.runtimeDirPreserved, true);
      assert.equal(stopped.runtimeDirRemoved, false);
      assert.throws(() => process.kill(-fixture.processGroupId, 0), {
        code: "ESRCH"
      });
      assert.equal(
        JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8")).pid,
        fixture.processGroupId
      );

      const restartedCleanup = await stopCodexAppServerRuntime({
        preserveProcessExitProof: true,
        runtimeDir
      });
      assert.equal(restartedCleanup.stopped, false);
      assert.equal(restartedCleanup.processExitVerified, true);
      assert.equal(restartedCleanup.runtimeDirPreserved, true);
      assert.equal(restartedCleanup.runtimeDirRemoved, false);

      const released = await stopCodexAppServerRuntime({ runtimeDir });
      assert.equal(released.processExitVerified, true);
      assert.equal(released.runtimeDirRemoved, true);
      await assert.rejects(access(runtimeDir), { code: "ENOENT" });

      const missing = await stopCodexAppServerRuntime({
        preserveProcessExitProof: true,
        runtimeDir
      });
      assert.equal(missing.processExitVerified, false);
      assert.equal(missing.runtimeDirPreserved, false);
      assert.equal(missing.runtimeDirRemoved, false);
    } finally {
      try {
        process.kill(-fixture.processGroupId, "SIGKILL");
      } catch {
        // The verified shutdown path normally stops the complete fixture group.
      }
    }
  });
});

test("codex provider reuses and stops the detached process group after its leader exits", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process groups are not available on Windows.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-orphaned-leader");
    await mkdir(runtimeDir, {
      recursive: true
    });
    const fixture = await startOrphanedDetachedProcessGroup(runtimeDir);
    try {
      const metadata = metadataForRuntime(runtimeDir, {
        pid: fixture.processGroupId,
        processIdentity: fixture.processIdentity
      });
      await writeFile(metadata.socketPath, "");
      await writeMetadata(runtimeDir, metadata);

      const runtime = await ensureCodexAppServerRuntime({
        authStateSignature: metadata.authStateSignature,
        runtimeDir,
        commandRunner() {
          throw new Error("command runner must not replace a responsive surviving process group");
        },
        WebSocketImpl: ResponsiveFakeWebSocket
      });

      assert.equal(runtime.reused, true);
      assert.equal(runtime.pid, fixture.processGroupId);

      const result = await stopCodexAppServerRuntime({
        runtimeDir
      });

      assert.equal(result.pid, fixture.processGroupId);
      assert.equal(result.stopped, true);
      assert.equal(result.runtimeDirRemoved, true);
      assert.throws(
        () => process.kill(-fixture.processGroupId, 0),
        {
          code: "ESRCH"
        }
      );
    } finally {
      try {
        process.kill(-fixture.processGroupId, "SIGKILL");
      } catch {
        // The assertion path normally stops the complete fixture group first.
      }
    }
  });
});

test("codex provider stops detached command groups below its session runtime", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux /proc process-tree inspection is required.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-command-tree");
    await mkdir(runtimeDir, {
      recursive: true
    });
    const fixture = await startDetachedProcessWithDetachedCommand(runtimeDir);
    try {
      await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
        pid: fixture.processGroupId,
        processIdentity: fixture.processIdentity
      }));

      const result = await stopCodexAppServerRuntime({
        runtimeDir
      });

      assert.equal(result.stopped, true);
      assert.equal(result.descendantProcessGroups.includes(fixture.commandPid), true);
      assert.throws(
        () => process.kill(-fixture.commandPid, 0),
        {
          code: "ESRCH"
        }
      );
    } finally {
      for (const processGroupId of [fixture.commandPid, fixture.processGroupId]) {
        try {
          process.kill(-processGroupId, "SIGKILL");
        } catch {
          // The assertion path normally stops both groups first.
        }
      }
    }
  });
});

test("codex provider does not signal a live group when its persisted start time is wrong", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux /proc process identity is required.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-starttime-mismatch");
    await mkdir(runtimeDir, { recursive: true });
    const fixture = await startDetachedProcessWithDetachedCommand(runtimeDir);
    try {
      await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
        pid: fixture.processGroupId,
        processIdentity: {
          ...fixture.processIdentity,
          startTimeTicks: String(Number(fixture.processIdentity.startTimeTicks) + 1)
        }
      }));

      const result = await stopCodexAppServerRuntime({ runtimeDir });

      assert.equal(result.identityStatus, "ambiguous");
      assert.equal(result.processExitVerified, false);
      assert.doesNotThrow(() => process.kill(-fixture.processGroupId, 0));
      assert.doesNotThrow(() => process.kill(-fixture.commandPid, 0));
    } finally {
      for (const processGroupId of [fixture.commandPid, fixture.processGroupId]) {
        try {
          process.kill(-processGroupId, "SIGKILL");
        } catch {
          // This test deliberately leaves both exact fixture groups alive.
        }
      }
    }
  });
});

test("codex provider refuses to replace live legacy metadata without an exact identity", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux process groups are required.");
    return;
  }
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server-live-legacy");
    await mkdir(runtimeDir, { recursive: true });
    const fixture = await startDetachedProcessWithDetachedCommand(runtimeDir);
    try {
      await writeMetadata(runtimeDir, {
        ...metadataForRuntime(runtimeDir, {
          pid: fixture.processGroupId,
          processIdentity: fixture.processIdentity
        }),
        processIdentity: undefined,
        processState: undefined,
        schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION - 1
      });

      await assert.rejects(
        () => ensureCodexAppServerRuntime({
          authStateSignature: "test-auth-state-signature",
          commandRunner() {
            throw new Error("unidentifiable live legacy runtime must not be replaced");
          },
          runtimeDir,
          WebSocketImpl: ResponsiveFakeWebSocket
        }),
        (error) => {
          assert.equal(error.code, "vibe64_codex_app_server_process_identity_unverified");
          assert.equal(error.cleanupRequired, true);
          assert.equal(error.retryable, false);
          assert.match(error.message, /refused to start a replacement/iu);
          return true;
        }
      );
      assert.doesNotThrow(() => process.kill(-fixture.processGroupId, 0));
      assert.doesNotThrow(() => process.kill(-fixture.commandPid, 0));
    } finally {
      for (const processGroupId of [fixture.commandPid, fixture.processGroupId]) {
        try {
          process.kill(-processGroupId, "SIGKILL");
        } catch {
          // The exact safety behavior leaves this unidentifiable runtime alone.
        }
      }
    }
  });
});

test("codex provider keeps the session runtime after interrupting a turn", async () => {
  const requests = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      requests.push({ method, params });
      return {
        ok: true
      };
    }
  });
  let runtimeStops = 0;
  provider.stopRuntime = async () => {
    runtimeStops += 1;
    return {
      stopped: true
    };
  };

  const result = await provider.interruptTurn("thread-1", "turn-1");

  assert.equal(result.ok, true);
  assert.equal(runtimeStops, 0);
  assert.deepEqual(requests, [{
    method: "turn/interrupt",
    params: {
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }]);
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
    await writeMetadata(runtimeDir, metadataForRuntime(runtimeDir, {
      pid: 99999999
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
      managedCodexAppServerArgs(commandCalls[0]);
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
    commandCalls.forEach(managedCodexAppServerArgs);
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
    managedCodexAppServerArgs(commandCalls[0]);

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
    managedCodexAppServerArgs(commandCalls[0]);

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
    const workdir = path.join(runtimeDir, "source");
    await mkdir(toolHomeSource, {
      recursive: true
    });
    await mkdir(workdir, {
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
      toolHomeSource,
      workdir
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
    assert.equal(commandCalls[0].cwd, workdir);
    assert.deepEqual(commandCalls[0].allowedRoots, [workdir]);
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
    assertInteractiveCodexAppServerArgs(
      managedCodexAppServerArgs(commandCalls[0]),
      ["app-server", "--listen", unixEndpointForRuntime(runtimeDir)]
    );
  });
});

test("codex economy provider starts from a private empty home and strips project execution inputs", async () => {
  await withTemporaryDirectory(async (runtimeDir) => {
    const toolHomeSource = path.join(runtimeDir, "canonical-account-home");
    const projectWorkdir = path.join(runtimeDir, "project", "source");
    await Promise.all([
      mkdir(projectWorkdir, { recursive: true }),
      writeChatgptAuth(toolHomeSource)
    ]);
    const commandCalls = [];
    const runtime = await ensureCodexAppServerRuntime({
      authStateSignature: "economy-auth-state",
      env: {
        DB_PASSWORD: "host-db-secret",
        LANG: "en_AU.UTF-8",
        OPENAI_API_KEY: "host-api-secret",
        PATH: process.env.PATH,
        PROJECT_HOST_SECRET: "host-project-secret"
      },
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      executionRoot: projectWorkdir,
      project: {
        runtimeConfigEnv: {
          PROJECT_CONFIG_SECRET: "project-config-secret"
        },
        workspace: "secret-project"
      },
      readyTimeoutMs: 2000,
      runtimeDir,
      runtimeInstanceId: "session-1:economy",
      runtimes: ["project-secret-runtime"],
      session: {
        databaseEnv: {
          SESSION_DB_SECRET: "session-db-secret"
        },
        sessionId: "secret-session"
      },
      terminalEnv: {
        DB_PASSWORD: "project-db-secret",
        VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR: "/project/secret/shims",
        VIBE64_PROJECT_SECRET: "project-secret"
      },
      toolHomeSource,
      userKey: "secret-user-key",
      WebSocketImpl: ResponsiveFakeWebSocket,
      workdir: projectWorkdir,
      commandRunner: codexAppServerCommandRunner(runtimeDir, commandCalls)
    });

    const economyHome = codexAppServerEconomyHomeDir(runtimeDir);
    const economyWorkspace = codexAppServerEconomyWorkspaceDir(runtimeDir);
    const runCall = commandCalls[0];
    const serializedCall = JSON.stringify(runCall);
    assert.equal(runtime.executionMode, CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY);
    assert.equal(runtime.processCwd, economyWorkspace);
    assert.equal(runtime.toolHomeSource, "");
    assert.equal(runtime.accountIdentitySignature, await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource
    }));
    assert.equal(runCall.cwd, economyWorkspace);
    assert.deepEqual(runCall.allowedRoots, [economyWorkspace]);
    assert.equal(runCall.credentialHome.home, economyHome);
    assert.deepEqual(runCall.project, {});
    assert.deepEqual(runCall.session, {});
    assert.equal(runCall.userKey, "");
    assert.deepEqual(runCall.shimDirs, []);
    assert.equal(runCall.execution.label, "Codex assistant");
    assert.equal(runCall.baseEnv.CODEX_HOME, economyHome);
    assert.equal(runCall.baseEnv.DB_PASSWORD, "");
    assert.equal(runCall.baseEnv.OPENAI_API_KEY, "");
    assert.equal(runCall.baseEnv.PROJECT_HOST_SECRET, "");
    assert.doesNotMatch(serializedCall, /project-secret|session-db-secret|project-db-secret/u);
    assert.doesNotMatch(serializedCall, /canonical-account-home|access-token-one|refresh-token/u);
    assert.doesNotMatch(runCall.args.join("\n"), /dangerously-bypass|trust_level/u);
    assert.match(runCall.args[1], /exec \/usr\/bin\/env -i/u);
    assert.deepEqual(runCall.runtimes, VIBE64_INTERACTIVE_RUNTIME_PACKS);

    const envProbe = await runVibe64Command({
      ...runCall,
      execution: undefined,
      args: [
        "-c",
        runCall.args[1],
        "vibe64-economy-env-probe",
        process.execPath,
        "-e",
        "console.log(JSON.stringify(process.env));"
      ],
      command: "/bin/sh",
      logPath: "",
      mode: "capture"
    });
    assert.equal(envProbe.ok, true, envProbe.output);
    const childEnv = JSON.parse(envProbe.stdout);
    assert.equal(childEnv.CODEX_HOME, economyHome);
    assert.equal(childEnv.HOME, economyHome);
    for (const secretName of [
      "DB_PASSWORD",
      "OPENAI_API_KEY",
      "PROJECT_CONFIG_SECRET",
      "PROJECT_HOST_SECRET",
      "SESSION_DB_SECRET",
      "VIBE64_PROJECT_SECRET"
    ]) {
      assert.equal(Object.hasOwn(childEnv, secretName), false, secretName);
    }
    assert.deepEqual(Object.keys(childEnv).sort(), [
      "CODEX_HOME",
      "HOME",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "LOGNAME",
      "PATH",
      "SSL_CERT_DIR",
      "SSL_CERT_FILE",
      "TERM",
      "TMPDIR",
      "TZ",
      "USER",
      "VIBE64_CODEX_APP_SERVER_COMMAND_HASH",
      "VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN"
    ]);

    const stored = await readFile(path.join(runtimeDir, "runtime.json"), "utf8");
    assert.doesNotMatch(stored, /canonical-account-home|access-token|refresh-token|api-key/u);
  });
});

test("codex economy provider retires a detached child when startup never becomes ready", async () => {
  await withTemporaryDirectory(async (root) => {
    const runtimeDir = path.join(root, "codex-app-server-economy-unready");
    let child = null;
    try {
      await assert.rejects(startCodexAppServerProcess({
        accountIdentitySignature: `sha256:${"e".repeat(64)}`,
        authStateSignature: "test-auth-state",
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        readyTimeoutMs: 50,
        runtimeDir,
        WebSocketImpl: UnresponsiveFakeWebSocket,
        async commandRunner(request) {
          await writeFile(socketPathForRuntime(runtimeDir), "");
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
            detached: true,
            env: {
              ...process.env,
              ...request.baseEnv
            },
            stdio: "ignore"
          });
          child.unref();
          return {
            exitCode: 0,
            ok: true,
            output: "",
            pid: child.pid,
            signal: "",
            stderr: "",
            stdout: "",
            timedOut: false
          };
        }
      }), (error) => {
        assert.equal(error.code, "vibe64_codex_economy_runtime_start_failed");
        assert.equal(error.cleanupRequired, false);
        return true;
      });
      assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
      for (const artifact of [
        codexAppServerEconomyHomeDir(runtimeDir),
        codexAppServerEconomyWorkspaceDir(runtimeDir),
        socketPathForRuntime(runtimeDir),
        path.join(runtimeDir, "app-server.log")
      ]) {
        await assert.rejects(access(artifact), { code: "ENOENT" });
      }
      assert.deepEqual(await readdir(runtimeDir), []);
    } finally {
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The assertion path retires the complete process group first.
        }
      }
    }
  });
});

test("codex economy provider retires a started child when metadata persistence fails", async () => {
  await withTemporaryDirectory(async (root) => {
    const runtimeDir = path.join(root, "codex-app-server-economy-metadata");
    let child = null;
    try {
      await assert.rejects(ensureCodexAppServerRuntime({
        accountIdentitySignature: `sha256:${"f".repeat(64)}`,
        authStateSignature: "test-auth-state",
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        readyTimeoutMs: 1000,
        runtimeDir,
        WebSocketImpl: ResponsiveFakeWebSocket,
        async commandRunner(request) {
          await writeFile(socketPathForRuntime(runtimeDir), "");
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
            detached: true,
            env: {
              ...process.env,
              ...request.baseEnv
            },
            stdio: "ignore"
          });
          child.unref();
          return {
            exitCode: 0,
            ok: true,
            output: "",
            pid: child.pid,
            signal: "",
            stderr: "",
            stdout: "",
            timedOut: false
          };
        },
        async runtimeMetadataWriter() {
          throw new Error("metadata-secret-must-not-escape");
        }
      }), (error) => {
        assert.equal(error.code, "vibe64_codex_economy_runtime_metadata_failed");
        assert.equal(error.cleanupRequired, false);
        assert.doesNotMatch(error.message, /metadata-secret/u);
        return true;
      });
      assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
      for (const artifact of [
        codexAppServerEconomyHomeDir(runtimeDir),
        codexAppServerEconomyWorkspaceDir(runtimeDir),
        socketPathForRuntime(runtimeDir),
        path.join(runtimeDir, "app-server.log"),
        path.join(runtimeDir, "runtime.json")
      ]) {
        await assert.rejects(access(artifact), { code: "ENOENT" });
      }
      assert.deepEqual(await readdir(runtimeDir), []);

      const retry = await ensureCodexAppServerRuntime({
        accountIdentitySignature: `sha256:${"f".repeat(64)}`,
        authStateSignature: "test-auth-state",
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        readyTimeoutMs: 1000,
        runtimeDir,
        WebSocketImpl: ResponsiveFakeWebSocket,
        commandRunner: codexAppServerCommandRunner(runtimeDir)
      });
      assert.equal(retry.reused, false);
      assert.equal(retry.executionMode, CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY);
      assert.equal((await readdir(runtimeDir)).includes("runtime.json"), true);
      const stoppedRetry = await stopCodexAppServerRuntime({ runtimeDir });
      assert.equal(stoppedRetry.runtimeDirRemoved, true);
    } finally {
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The assertion path retires the complete process group first.
        }
      }
    }
  });
});

test("shared Codex account identity signatures survive token refresh and change on account selection", async () => {
  await withTemporaryDirectory(async (root) => {
    const chatgptHome = path.join(root, "chatgpt-home");
    await writeChatgptAuth(chatgptHome, {
      accessToken: "first-access-token",
      accountId: "account-one"
    });
    const first = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource: chatgptHome
    });
    const provider = new CodexAppServerAgentProvider({
      authStateSignature: "test-auth-state",
      toolHomeSource: chatgptHome
    });
    assert.equal((await provider.currentRuntimeInfo()).accountIdentitySignature, first);
    provider.ensureRuntime = async () => ({
      runtimeDir: path.join(root, "shared-runtime")
    });
    const economyContext = await provider.currentEconomyExecutionContext();
    assert.equal(economyContext.accountIdentitySignature, first);
    assert.equal(economyContext.executionMode, CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY);
    await writeChatgptAuth(chatgptHome, {
      accessToken: "second-access-token",
      accountId: "account-one"
    });
    const refreshed = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource: chatgptHome
    });
    assert.equal(refreshed, first);
    assert.equal((await provider.currentRuntimeInfo()).accountIdentitySignature, first);
    assert.match(first, /^sha256:[a-f0-9]{64}$/u);

    await writeChatgptAuth(chatgptHome, {
      accessToken: "third-access-token",
      accountId: "account-two"
    });
    const switched = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource: chatgptHome
    });
    assert.notEqual(switched, first);
    assert.equal((await provider.currentRuntimeInfo()).accountIdentitySignature, switched);

    const apiKeyHome = path.join(root, "api-key-home");
    await writeApiKeyAuth(apiKeyHome, "sk-first-selected-key");
    const firstApiKey = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource: apiKeyHome
    });
    await writeApiKeyAuth(apiKeyHome, "sk-second-selected-key");
    const secondApiKey = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource: apiKeyHome
    });
    assert.notEqual(secondApiKey, firstApiKey);
  });
});

test("Codex access distinguishes account authentication from API keys without exposing secrets", async () => {
  await withTemporaryDirectory(async (root) => {
    const chatgptHome = path.join(root, "chatgpt-home");
    await writeChatgptAuth(chatgptHome, {
      accessToken: "first-private-access-token",
      accountId: "account-one"
    });
    const account = await readCodexSelectedAccountAccess({ toolHomeSource: chatgptHome });
    assert.equal(account.ownerOnly, true);
    assert.equal(account.endpointCode, "codex_subscription");
    assert.doesNotMatch(JSON.stringify(account), /first-private-access-token/u);

    await writeChatgptAuth(chatgptHome, {
      accessToken: "refreshed-private-access-token",
      accountId: "account-one"
    });
    assert.deepEqual(
      await readCodexSelectedAccountAccess({ toolHomeSource: chatgptHome }),
      account
    );

    const apiKeyHome = path.join(root, "api-key-home");
    await writeApiKeyAuth(apiKeyHome, "sk-private-selected-key");
    const apiKey = await readCodexSelectedAccountAccess({ toolHomeSource: apiKeyHome });
    assert.equal(apiKey.ownerOnly, false);
    assert.equal(apiKey.endpointCode, "openai_api");
    assert.doesNotMatch(JSON.stringify(apiKey), /sk-private-selected-key/u);

    const factsOnlyHome = path.join(root, "facts-only-home");
    await writeChatgptAuth(factsOnlyHome, {
      accessToken: "token-that-facts-must-not-resolve",
      accountId: "facts-only-account"
    });
    const factsOnlyAuthPath = path.join(factsOnlyHome, ".codex", "auth.json");
    const factsOnlyAuth = JSON.parse(await readFile(factsOnlyAuthPath, "utf8"));
    delete factsOnlyAuth.tokens.access_token;
    await writeFile(factsOnlyAuthPath, `${JSON.stringify(factsOnlyAuth)}\n`);
    const factsOnly = await readCodexSelectedAccountAccess({ toolHomeSource: factsOnlyHome });
    assert.equal(factsOnly.ownerOnly, true);
    assert.equal(factsOnly.endpointCode, "codex_subscription");
    await assert.rejects(
      currentCodexAccountIdentitySignature({
        executionMode: "economy",
        toolHomeSource: factsOnlyHome
      }),
      (error) => error.code === "vibe64_codex_economy_auth_invalid"
    );
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
    commandCalls.forEach(managedCodexAppServerArgs);
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

test("codex provider classifies invalid requests by JSON-RPC code and method", () => {
  assert.equal(codexAppServerRequestIsInvalid({
    code: -32600,
    method: "turn/steer"
  }, "turn/steer"), true);
  assert.equal(codexAppServerRequestIsInvalid({
    code: -32600,
    message: "localized provider message",
    method: "turn/interrupt"
  }, "turn/steer"), false);
  assert.equal(codexAppServerRequestIsInvalid({
    code: -32603,
    method: "turn/steer"
  }, "turn/steer"), false);
});

test("codex provider persists an empty paginated thread before publishing it", async () => {
  const requests = [];
  const provider = new CodexAppServerAgentProvider({});
  let releaseHistory;
  const historyReady = new Promise((resolve) => { releaseHistory = resolve; });
  let historyRequested;
  const historyStarted = new Promise((resolve) => { historyRequested = resolve; });
  provider.activeClient = async () => ({
    async request(method, params) {
      requests.push({ method, params });
      if (method === "thread/read") {
        historyRequested();
        await historyReady;
      }
      return { thread: { id: "thread-new", historyMode: "paginated", turns: [] } };
    }
  });

  let published = false;
  const starting = provider.startThread({ cwd: "/repo/worktree" }).then((thread) => {
    published = true;
    return thread;
  });
  await historyStarted;
  assert.equal(published, false);
  assert.deepEqual(requests.map(({ method }) => method), [
    "thread/start", "thread/name/set", "thread/read"
  ]);
  assert.deepEqual(requests[1].params, { threadId: "thread-new", name: "thread-new" });
  assert.deepEqual(requests[2].params, { threadId: "thread-new", includeTurns: true });
  releaseHistory();
  const thread = await starting;
  assert.equal(thread.id, "thread-new");
  assert.equal(thread.raw.historyMode, "paginated");

  requests.length = 0;
  await provider.resumeThread("thread-new");
  assert.deepEqual(requests.map(({ method }) => method), ["thread/resume"]);
  assert.equal(requests[0].params.excludeTurns, true);
});

for (const failedMethod of ["thread/name/set", "thread/read"]) {
  test(`codex provider propagates paginated initialization failure at ${failedMethod}`, async () => {
    const requests = [];
    const failure = Object.assign(new Error("history initialization failed"), { code: -32603 });
    const provider = new CodexAppServerAgentProvider({});
    provider.activeClient = async () => ({
      async request(method) {
        requests.push(method);
        if (method === failedMethod) throw failure;
        return { thread: { id: "thread-new", historyMode: "paginated" } };
      }
    });
    await assert.rejects(provider.startThread(), (error) => error === failure);
    assert.equal(requests.at(-1), failedMethod);
    assert.equal(requests.filter((method) => method === "thread/start").length, 1);
  });
}

test("codex provider does not persist ephemeral or legacy thread history at startup", async () => {
  for (const thread of [
    { id: "thread-ephemeral", ephemeral: true, historyMode: "paginated" },
    { id: "thread-legacy", historyMode: "legacy" }
  ]) {
    const requests = [];
    const provider = new CodexAppServerAgentProvider({});
    provider.activeClient = async () => ({
      async request(method) {
        requests.push(method);
        return { thread };
      }
    });
    assert.equal((await provider.startThread()).id, thread.id);
    assert.deepEqual(requests, ["thread/start"]);
  }
});

test("codex provider reads full thread turns for response recovery", async () => {
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
          turns: []
        }
      };
    }
  });

  const result = await provider.readThread("thread-1");

  assert.equal(result.id, "thread-1");
  assert.deepEqual(result.raw.turns, []);
  assert.deepEqual(requests, [
    {
      method: "thread/read",
      params: {
        includeTurns: true,
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

test("codex provider resumes threads without returning their history", async () => {
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
          turns: []
        }
      };
    }
  });

  const result = await provider.resumeThread("thread-1", {
    cwd: "/repo/worktree"
  });

  assert.equal(result.id, "thread-1");
  assert.deepEqual(requests, [
    {
      method: "thread/resume",
      params: {
        config: {
          shell_environment_policy: {
            inherit: "none",
            set: {}
          }
        },
        cwd: "/repo/worktree",
        excludeTurns: true,
        threadId: "thread-1"
      }
    }
  ]);
});

test("codex provider scopes each thread to its session environment", async () => {
  const requests = [];
  const provider = new CodexAppServerAgentProvider({
    threadEnv: {
      DATABASE_URL: "mysql://session-database.test/app",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/bus",
      DBUS_STARTER_BUS_TYPE: "session",
      SESSION_MARKER: "session-two"
    }
  });
  provider.activeClient = async () => ({
    async request(method, params) {
      requests.push({ method, params });
      return {
        thread: {
          id: "thread-1",
          turns: []
        }
      };
    }
  });

  await provider.startThread({ cwd: "/repo/session-two" });
  await provider.resumeThread("thread-1", { cwd: "/repo/session-two" });
  await provider.startThread({
    config: {
      shell_environment_policy: {
        inherit: "none",
        set: {}
      }
    },
    cwd: "/tmp/isolated-helper"
  });

  const sessionPolicy = {
    inherit: "none",
    set: {
      DATABASE_URL: "mysql://session-database.test/app",
      SESSION_MARKER: "session-two"
    }
  };
  assert.deepEqual(requests, [{
    method: "thread/start",
    params: {
      config: {
        shell_environment_policy: sessionPolicy
      },
      cwd: "/repo/session-two"
    }
  }, {
    method: "thread/resume",
    params: {
      config: {
        shell_environment_policy: sessionPolicy
      },
      cwd: "/repo/session-two",
      excludeTurns: true,
      threadId: "thread-1"
    }
  }, {
    method: "thread/start",
    params: {
      config: {
        shell_environment_policy: {
          inherit: "none",
          set: {}
        }
      },
      cwd: "/tmp/isolated-helper"
    }
  }]);
});

test("codex provider lists a bounded page of thread turns", async () => {
  const requests = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      requests.push({
        method,
        params
      });
      return {
        data: [{
          id: "turn-1",
          items: [],
          status: "inProgress"
        }]
      };
    }
  });

  const result = await provider.listThreadTurns("thread-1", {
    itemsView: "full",
    limit: 1,
    sortDirection: "desc"
  });

  assert.equal(result.data[0].id, "turn-1");
  assert.deepEqual(requests, [
    {
      method: "thread/turns/list",
      params: {
        itemsView: "full",
        limit: 1,
        sortDirection: "desc",
        threadId: "thread-1"
      }
    }
  ]);
});

test("codex provider coalesces concurrent availability checks", async () => {
  const provider = new CodexAppServerAgentProvider({});
  let activeClientCalls = 0;
  let preflightCalls = 0;
  let releasePreflight = null;
  const preflight = new Promise((resolve) => {
    releasePreflight = resolve;
  });
  const client = {
    isOpen: () => true
  };
  provider.preflightAuth = async () => {
    preflightCalls += 1;
    await preflight;
  };
  provider.activeClient = async () => {
    activeClientCalls += 1;
    return client;
  };

  const first = provider.ensureAvailable();
  const second = provider.ensureAvailable();
  await Promise.resolve();

  assert.equal(preflightCalls, 1);
  releasePreflight();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(activeClientCalls, 1);
  assert.equal(firstResult.client, client);
  assert.equal(secondResult.client, client);
});

test("codex provider reuses an available connection without another auth preflight", async () => {
  const provider = new CodexAppServerAgentProvider({});
  let preflightCalls = 0;
  const client = {
    isOpen: () => true
  };
  provider.client = client;
  provider.runtime = {
    endpoint: "unix:///tmp/vibe64/codex-app-server/app-server.sock"
  };
  provider.preflightAuth = async () => {
    preflightCalls += 1;
  };

  const result = await provider.ensureAvailable();

  assert.equal(result.client, client);
  assert.equal(result.reusedClient, true);
  assert.equal(preflightCalls, 0);
});

test("codex auth preflight uses the shared runtime directory when no session path is owned", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const runtimeDir = path.join(baseDir, "codex-app-server");
    const requests = [];
    await assert.rejects(() => access(runtimeDir), { code: "ENOENT" });

    await assertCodexAuthPreflightReady({
      commandRunner: async (request) => {
        requests.push(request);
        return {
          exitCode: 0,
          ok: true,
          output: ""
        };
      },
      runtimeDir
    });

    await access(runtimeDir);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].cwd, runtimeDir);
    assert.deepEqual(requests[0].allowedRoots, [runtimeDir]);
    assert.equal(requests[0].envPolicy, "auth");
    assert.equal(requests[0].inheritProcessEnv, false);
    assert.equal(requests[0].mode, "capture");
    assert.equal(requests[0].purpose, "codex");
  });
});

test("codex provider reads every model catalog page with native pagination fields", async () => {
  const calls = [];
  const responses = [{
    data: [{ model: "gpt-5.6-luna" }],
    nextCursor: "page-2"
  }, {
    data: [{ model: "gpt-5.6-sol" }],
    nextCursor: null
  }];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      calls.push({ method, params });
      return responses.shift();
    }
  });

  const result = await provider.listModels({
    includeHidden: true,
    limit: 25
  });

  assert.deepEqual(result, {
    data: [
      { model: "gpt-5.6-luna" },
      { model: "gpt-5.6-sol" }
    ],
    nextCursor: null
  });
  assert.deepEqual(calls, [{
    method: "model/list",
    params: {
      includeHidden: true,
      limit: 25
    }
  }, {
    method: "model/list",
    params: {
      cursor: "page-2",
      includeHidden: true,
      limit: 25
    }
  }]);
});

test("codex provider fails closed when model catalog pagination repeats a cursor", async () => {
  const calls = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      calls.push({ method, params });
      return {
        data: [],
        nextCursor: "repeated-page"
      };
    }
  });

  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.code, CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE);
    assert.match(error.message, /repeated a pagination cursor/u);
    assert.doesNotMatch(error.message, /repeated-page/u);
    return true;
  });
  assert.equal(calls.length, 2);
});

test("codex provider fails closed when model catalog data is malformed", async () => {
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request() {
      return {
        models: [{ model: "gpt-5.6-luna" }]
      };
    }
  });

  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.code, CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE);
    assert.match(error.message, /did not contain a data array/u);
    return true;
  });
});

test("codex provider clamps model pages and rejects oversized entries and cursors", async () => {
  const calls = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      calls.push({ method, params });
      return {
        data: [{
          description: "x".repeat(40 * 1024),
          model: "oversized-model"
        }],
        nextCursor: null
      };
    }
  });

  await assert.rejects(provider.listModels({ limit: 10_000 }), (error) => {
    assert.equal(error.code, CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE);
    assert.match(error.message, /response limit/u);
    return true;
  });
  assert.equal(calls[0].params.limit, 100);

  provider.activeClient = async () => ({
    async request() {
      return {
        data: [],
        nextCursor: "x".repeat(513)
      };
    }
  });
  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.code, CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE);
    assert.match(error.message, /cursor is invalid/u);
    assert.doesNotMatch(error.message, /x{20}/u);
    return true;
  });
});

test("codex provider forwards cancellation through every model catalog page", async () => {
  const abortController = new AbortController();
  const provider = new CodexAppServerAgentProvider({});
  let capturedSignal = null;
  provider.activeClient = async () => ({
    async request(_method, _params, options = {}) {
      capturedSignal = options.signal;
      return new Promise((resolve, reject) => {
        void resolve;
        const abort = () => {
          const error = new Error("catalog request aborted");
          error.code = "ABORT_ERR";
          error.name = "AbortError";
          reject(error);
        };
        if (options.signal?.aborted) {
          abort();
          return;
        }
        options.signal?.addEventListener?.("abort", abort, { once: true });
      });
    }
  });

  const pending = provider.listModels({}, {
    signal: abortController.signal
  });
  await delay(0);
  abortController.abort();

  await assert.rejects(pending, (error) => error.code === "ABORT_ERR");
  assert.equal(capturedSignal, abortController.signal);
  assert.equal(capturedSignal.aborted, true);
});

test("codex economy provider authoritatively inventories active and archived threads with bounded pagination", async () => {
  const calls = [];
  const runtimeDir = "/tmp/vibe64-economy-thread-inventory";
  const accountIdentitySignature = `sha256:${"b".repeat(64)}`;
  const responses = [{
    data: [{ id: "thread-two" }],
    nextCursor: "next-active"
  }, {
    data: [{ id: "thread-one" }],
    nextCursor: null
  }, {
    data: [{ id: "thread-archived" }],
    nextCursor: null
  }];
  const provider = new CodexAppServerAgentProvider({
    accountIdentitySignature,
    executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
    runtimeDir
  });
  provider.ensureRuntime = async () => {
    provider.runtime = {
      accountIdentitySignature,
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      processCwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
      runtimeDir
    };
    return provider.runtime;
  };
  provider.activeClient = async () => ({
    async request(method, params, options) {
      calls.push({ method, options, params });
      return responses.shift();
    }
  });

  const result = await provider.listEconomyThreads();

  assert.deepEqual(result.threadIds, [
    "thread-archived",
    "thread-one",
    "thread-two"
  ]);
  assert.equal(Object.isFrozen(result.threadIds), true);
  assert.deepEqual(calls.map(({ method, params }) => ({ method, params })), [{
    method: "thread/list",
    params: {
      archived: false,
      cwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
      limit: 100,
      sourceKinds: ["appServer"],
      useStateDbOnly: false
    }
  }, {
    method: "thread/list",
    params: {
      archived: false,
      cursor: "next-active",
      cwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
      limit: 100,
      sourceKinds: ["appServer"],
      useStateDbOnly: false
    }
  }, {
    method: "thread/list",
    params: {
      archived: true,
      cwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
      limit: 100,
      sourceKinds: ["appServer"],
      useStateDbOnly: false
    }
  }]);
});

test("codex provider inventories only active app-server threads for one exact session cwd", async () => {
  const calls = [];
  const provider = new CodexAppServerAgentProvider({});
  const responses = [{
    data: [{ cwd: "/repo/session-source", id: "thread-two" }],
    nextCursor: "next-page"
  }, {
    data: [{ cwd: "/repo/session-source", id: "thread-one" }],
    nextCursor: null
  }];
  provider.activeClient = async () => ({
    async request(method, params, options) {
      calls.push({ method, options, params });
      return responses.shift();
    }
  });

  const result = await provider.listAppServerThreadsForCwd({
    cwd: "/repo/session-source"
  });

  assert.deepEqual(result, {
    cwd: "/repo/session-source",
    threadIds: ["thread-one", "thread-two"]
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.threadIds), true);
  assert.deepEqual(calls.map(({ method, params }) => ({ method, params })), [{
    method: "thread/list",
    params: {
      archived: false,
      cwd: "/repo/session-source",
      limit: 100,
      sourceKinds: ["appServer"],
      useStateDbOnly: false
    }
  }, {
    method: "thread/list",
    params: {
      archived: false,
      cursor: "next-page",
      cwd: "/repo/session-source",
      limit: 100,
      sourceKinds: ["appServer"],
      useStateDbOnly: false
    }
  }]);
});

test("codex session thread inventory fails closed for another cwd or repeated pagination", async () => {
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request() {
      return {
        data: [{ cwd: "/repo/another-source", id: "wrong-thread" }],
        nextCursor: null
      };
    }
  });

  await assert.rejects(
    provider.listAppServerThreadsForCwd({ cwd: "/repo/session-source" }),
    (error) => error?.code === "vibe64_codex_session_thread_inventory_invalid"
  );

  provider.activeClient = async () => ({
    async request() {
      return {
        data: [],
        nextCursor: "same-cursor"
      };
    }
  });
  await assert.rejects(
    provider.listAppServerThreadsForCwd({ cwd: "/repo/session-source" }),
    (error) => (
      error?.code === "vibe64_codex_session_thread_inventory_invalid" &&
      !error.message.includes("same-cursor")
    )
  );
});

test("codex economy thread inventory fails closed on repeated or oversized provider data", async () => {
  const runtimeDir = "/tmp/vibe64-economy-thread-inventory-invalid";
  const accountIdentitySignature = `sha256:${"c".repeat(64)}`;
  const provider = new CodexAppServerAgentProvider({
    accountIdentitySignature,
    executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
    runtimeDir
  });
  provider.ensureRuntime = async () => {
    provider.runtime = {
      accountIdentitySignature,
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      processCwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
      runtimeDir
    };
    return provider.runtime;
  };
  provider.activeClient = async () => ({
    async request() {
      return {
        data: [{ id: "thread-one" }],
        nextCursor: "same-cursor"
      };
    }
  });
  await assert.rejects(provider.listEconomyThreads(), (error) => {
    assert.equal(error.code, "vibe64_codex_economy_thread_inventory_invalid");
    assert.doesNotMatch(error.message, /same-cursor/u);
    return true;
  });

  provider.activeClient = async () => ({
    async request() {
      return {
        data: [{
          id: "oversized-thread",
          title: "x".repeat(70 * 1024)
        }],
        nextCursor: null
      };
    }
  });
  await assert.rejects(provider.listEconomyThreads(), (error) => {
    assert.equal(error.code, "vibe64_codex_economy_thread_inventory_invalid");
    return true;
  });
});

test("codex provider reads effective config for one project cwd", async () => {
  const calls = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      calls.push({ method, params });
      return {
        config: {
          mcp_servers: {
            filesystem: {
              command: "unsafe-fixture"
            }
          }
        }
      };
    }
  });

  const result = await provider.readConfig({
    cwd: "/runtime/project/session/source"
  });

  assert.deepEqual(result.config.mcp_servers, {
    filesystem: {
      command: "unsafe-fixture"
    }
  });
  assert.deepEqual(calls, [{
    method: "config/read",
    params: {
      cwd: "/runtime/project/session/source",
      includeLayers: false
    }
  }]);
});

test("codex provider persists hook trust through the app-server config API", async () => {
  const calls = [];
  const provider = new CodexAppServerAgentProvider({});
  provider.activeClient = async () => ({
    async request(method, params) {
      calls.push({ method, params });
      return { status: "ok" };
    }
  });
  const state = {
    "/repo/.codex/hooks.json:session_start:0:0": {
      trusted_hash: "sha256:session-start"
    }
  };

  const result = await provider.writeHookTrustState(state);

  assert.deepEqual(result, { status: "ok" });
  assert.deepEqual(calls, [{
    method: "config/batchWrite",
    params: {
      edits: [{
        keyPath: "hooks.state",
        mergeStrategy: "upsert",
        value: state
      }],
      expectedVersion: null,
      filePath: null,
      reloadUserConfig: true
    }
  }]);
  assert.equal(await provider.writeHookTrustState({}), null);
  assert.equal(calls.length, 1);
});

test("codex provider discards a client that fails initialization", async () => {
  FakeWebSocket.instances = [];
  const provider = new CodexAppServerAgentProvider({
    requestTimeoutMs: 1000,
    WebSocketImpl: InitializeErrorFakeWebSocket
  });
  provider.ensureRuntime = async () => {
    provider.runtime = {
      endpoint: "ws://127.0.0.1:48123"
    };
    return provider.runtime;
  };

  await assert.rejects(provider.connect(), /initialize failed/u);

  assert.equal(provider.client, null);
  assert.equal(FakeWebSocket.instances.at(-1)?.closed, true);
});

test("codex provider exposes only the normalized connected app-server identity", async () => {
  FakeWebSocket.instances = [];
  const provider = new CodexAppServerAgentProvider({
    requestTimeoutMs: 1000,
    WebSocketImpl: ResponsiveFakeWebSocket
  });
  provider.ensureRuntime = async () => {
    provider.runtime = {
      endpoint: "ws://127.0.0.1:48123"
    };
    return provider.runtime;
  };

  await provider.connect();
  assert.deepEqual(provider.currentServerInfo(), {
    userAgent: "vibe64/0.149.0 (unit test)"
  });
  assert.equal(Object.isFrozen(provider.currentServerInfo()), true);

  provider.close();
  assert.equal(provider.currentServerInfo(), null);
});

test("codex provider drops oversized app-server identity fields", async () => {
  FakeWebSocket.instances = [];
  const provider = new CodexAppServerAgentProvider({
    requestTimeoutMs: 1000,
    WebSocketImpl: OversizedServerInfoFakeWebSocket
  });
  provider.ensureRuntime = async () => {
    provider.runtime = {
      endpoint: "ws://127.0.0.1:48123"
    };
    return provider.runtime;
  };

  await provider.connect();
  assert.deepEqual(provider.currentServerInfo(), {
    userAgent: ""
  });
  provider.close();
});

test("codex economy provider redacts app-server request failures and refuses external server requests", async () => {
  const provider = new CodexAppServerAgentProvider({
    accountIdentitySignature: `sha256:${"d".repeat(64)}`,
    authStateSignature: "test-auth-state",
    executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
  });
  let externalHandlerCalls = 0;
  provider.setServerRequestHandler(async () => {
    externalHandlerCalls += 1;
    return { secret: "must-not-run" };
  });
  provider.activeClient = async () => ({
    async request() {
      const error = new Error("provider leaked selected-api-key and project-secret");
      error.code = -32600;
      error.data = {
        token: "selected-api-key"
      };
      throw error;
    }
  });

  await assert.rejects(provider.startThread({}), (error) => {
    assert.equal(error.code, "vibe64_codex_economy_provider_request_failed");
    assert.equal(error.providerCode, -32600);
    assert.equal(error.operation, "codex-app-server-thread-start");
    assert.doesNotMatch(JSON.stringify(error), /selected-api-key|project-secret/u);
    assert.doesNotMatch(error.message, /selected-api-key|project-secret/u);
    return true;
  });
  await assert.rejects(provider.handleServerRequest({
    method: "mcp/call",
    params: {
      secret: "project-secret"
    }
  }), (error) => {
    assert.equal(error.code, -32601);
    assert.doesNotMatch(error.message, /project-secret/u);
    return true;
  });
  assert.equal(externalHandlerCalls, 0);
});

test("codex economy provider retires its runtime when in-memory account activation fails", async () => {
  await withTemporaryDirectory(async (root) => {
    FakeWebSocket.instances = [];
    const runtimeDir = path.join(root, "codex-app-server-economy-login");
    const toolHomeSource = path.join(root, "selected-home");
    await writeChatgptAuth(toolHomeSource);
    await Promise.all([
      mkdir(codexAppServerEconomyHomeDir(runtimeDir), { recursive: true }),
      mkdir(codexAppServerEconomyWorkspaceDir(runtimeDir), { recursive: true })
    ]);
    const runtimeToken = randomUUID();
    const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      detached: true,
      env: {
        ...process.env,
        VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
        VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
      },
      stdio: "ignore"
    });
    child.unref();
    try {
      const processIdentity = await processIdentityForFixture(
        child.pid,
        runtimeToken,
        commandHash
      );
      const accountIdentitySignature = await currentCodexAccountIdentitySignature({
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        toolHomeSource
      });
      const provider = new CodexAppServerAgentProvider({
        authStateSignature: "test-auth-state",
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        requestTimeoutMs: 1000,
        runtimeDir,
        toolHomeSource,
        WebSocketImpl: EconomyLoginErrorFakeWebSocket
      });
      provider.ensureRuntime = async () => {
        provider.runtime = {
          accountIdentitySignature,
          endpoint: "ws://127.0.0.1:48123",
          executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
          pid: child.pid,
          processCwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
          processIdentity,
          runtimeDir
        };
        return provider.runtime;
      };

      await assert.rejects(provider.connect(), (error) => {
        assert.equal(error.code, "vibe64_codex_economy_auth_unavailable");
        assert.doesNotMatch(error.message, /secret-token/u);
        return true;
      });
      assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
      assert.equal(provider.runtime, null);
      assert.equal(provider.client, null);
      await assert.rejects(access(codexAppServerEconomyHomeDir(runtimeDir)), { code: "ENOENT" });
      await assert.rejects(access(codexAppServerEconomyWorkspaceDir(runtimeDir)), { code: "ENOENT" });
    } finally {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The assertion path retires the complete process group first.
      }
    }
  });
});

test("codex economy provider injects only the selected ChatGPT account and refreshes from an advanced canonical token", async () => {
  await withTemporaryDirectory(async (root) => {
    FakeWebSocket.instances = [];
    const toolHomeSource = path.join(root, "selected-home");
    const runtimeDir = path.join(root, "runtime");
    await writeChatgptAuth(toolHomeSource, {
      accessToken: "first-access-token",
      accountId: "account-one",
      refreshToken: "refresh-token-never-forward"
    });
    const accountIdentitySignature = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource
    });
    const provider = new CodexAppServerAgentProvider({
      authStateSignature: "test-auth-state",
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      project: {
        secretProjectIdentity: "project-identity-must-be-stripped"
      },
      requestTimeoutMs: 1000,
      runtimes: ["project-runtime-must-be-stripped"],
      runtimeDir,
      session: {
        secretSessionIdentity: "session-identity-must-be-stripped"
      },
      terminalEnv: {
        PROJECT_ENV_SECRET: "terminal-env-must-be-stripped"
      },
      toolHomeSource,
      userKey: "user-key-must-be-stripped",
      WebSocketImpl: EconomyResponsiveFakeWebSocket
    });
    provider.ensureRuntime = async () => {
      provider.runtime = {
        accountIdentitySignature,
        endpoint: "ws://127.0.0.1:48123",
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        processCwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
        runtimeDir,
        transport: "unix"
      };
      return provider.runtime;
    };

    await provider.connect();
    const socket = FakeWebSocket.instances.at(-1);
    const login = socket.sent.find((entry) => entry.method === "account/login/start");
    assert.deepEqual(login.params, {
      accessToken: "first-access-token",
      chatgptAccountId: "account-one",
      chatgptPlanType: null,
      type: "chatgptAuthTokens"
    });
    assert.doesNotMatch(JSON.stringify(socket.sent), /refresh-token-never-forward/u);
    assert.deepEqual(socket.sent.find((entry) => entry.method === "account/read")?.params, {
      refreshToken: false
    });
    const runtimeInfo = await provider.currentRuntimeInfo();
    assert.equal(runtimeInfo.accountIdentitySignature, accountIdentitySignature);
    assert.equal(runtimeInfo.executionMode, CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY);
    assert.equal(runtimeInfo.executionContextHash, executionContextHash({
      project: {},
      session: {},
      userKey: ""
    }));
    assert.equal(runtimeInfo.runtimesHash, runtimesHash([]));
    assert.equal(runtimeInfo.terminalEnvHash, terminalEnvHash({}));
    assert.equal(runtimeInfo.toolHomeSource, "");
    assert.doesNotMatch(
      JSON.stringify(runtimeInfo),
      /project-identity|project-runtime|session-identity|terminal-env|user-key/u
    );

    await writeChatgptAuth(toolHomeSource, {
      accessToken: "second-access-token",
      accountId: "account-one",
      refreshToken: "second-refresh-token-never-forward"
    });
    assert.deepEqual(await provider.handleServerRequest({
      method: "account/chatgptAuthTokens/refresh",
      params: {
        previousAccountId: "account-one",
        reason: "unauthorized"
      }
    }), {
      accessToken: "second-access-token",
      chatgptAccountId: "account-one",
      chatgptPlanType: null
    });
    await assert.rejects(provider.handleServerRequest({
      method: "account/chatgptAuthTokens/refresh",
      params: {
        previousAccountId: "account-one",
        reason: "unauthorized"
      }
    }), (error) => error.code === "vibe64_codex_economy_auth_refresh_pending");
    provider.close();
  });
});

test("codex economy provider injects API-key auth without persisting or exposing the key", async () => {
  await withTemporaryDirectory(async (root) => {
    FakeWebSocket.instances = [];
    const toolHomeSource = path.join(root, "selected-api-home");
    const runtimeDir = path.join(root, "runtime");
    await writeApiKeyAuth(toolHomeSource, "sk-selected-economy-key");
    const accountIdentitySignature = await currentCodexAccountIdentitySignature({
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      toolHomeSource
    });
    const provider = new CodexAppServerAgentProvider({
      authStateSignature: "test-auth-state",
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      requestTimeoutMs: 1000,
      runtimeDir,
      toolHomeSource,
      WebSocketImpl: EconomyResponsiveFakeWebSocket
    });
    provider.ensureRuntime = async () => {
      provider.runtime = {
        accountIdentitySignature,
        endpoint: "ws://127.0.0.1:48123",
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
        processCwd: codexAppServerEconomyWorkspaceDir(runtimeDir),
        runtimeDir
      };
      return provider.runtime;
    };

    await provider.connect();
    const login = FakeWebSocket.instances.at(-1).sent
      .find((entry) => entry.method === "account/login/start");
    assert.deepEqual(login.params, {
      apiKey: "sk-selected-economy-key",
      type: "apiKey"
    });
    const runtimeInfo = await provider.currentRuntimeInfo();
    assert.equal(runtimeInfo.accountIdentitySignature, accountIdentitySignature);
    assert.equal(runtimeInfo.executionContextHash, executionContextHash({
      project: {},
      session: {},
      userKey: ""
    }));
    assert.equal(runtimeInfo.runtimesHash, runtimesHash([]));
    assert.equal(runtimeInfo.terminalEnvHash, terminalEnvHash({}));
    assert.doesNotMatch(JSON.stringify(runtimeInfo), /sk-selected-economy-key|selected-api-home/u);
    provider.close();
  });
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
  client.setRequestHandler(async (request) => {
    assert.equal(request.method, "item/tool/call");
    assert.equal(request.params.callId, "colliding-call");
    return {
      contentItems: [{
        text: "accepted",
        type: "inputText"
      }],
      success: true
    };
  });
  socket.emit("message", {
    data: JSON.stringify({
      id: 2,
      method: "item/tool/call",
      params: {
        arguments: {},
        callId: "colliding-call"
      }
    })
  });
  await delay(0);
  assert.deepEqual(socket.sent.at(-1), {
    id: 2,
    result: {
      contentItems: [{
        text: "accepted",
        type: "inputText"
      }],
      success: true
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

  const failedSteer = client.request("turn/steer", {
    expectedTurnId: "turn-1",
    input: codexTurnInput("One more thing"),
    threadId: "thread-1"
  });
  socket.emit("message", {
    data: JSON.stringify({
      error: {
        code: -32602,
        data: {
          reason: "NoActiveTurn"
        },
        message: "No active turn to steer"
      },
      id: 3
    })
  });
  await assert.rejects(failedSteer, (error) => {
    assert.equal(error.code, -32602);
    assert.deepEqual(error.data, {
      reason: "NoActiveTurn"
    });
    assert.equal(error.method, "turn/steer");
    return true;
  });

  client.setRequestHandler(async (request) => {
    assert.equal(request.method, "item/tool/call");
    assert.deepEqual(request.params, {
      arguments: {
        kind: "waiting_for_input"
      },
      callId: "call-1"
    });
    return {
      contentItems: [{
        text: "accepted",
        type: "inputText"
      }],
      success: true
    };
  });
  socket.emit("message", {
    data: JSON.stringify({
      id: "server-request-1",
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "waiting_for_input"
        },
        callId: "call-1"
      }
    })
  });
  await delay(0);
  assert.deepEqual(socket.sent.at(-1), {
    id: "server-request-1",
    result: {
      contentItems: [{
        text: "accepted",
        type: "inputText"
      }],
      success: true
    }
  });

  client.close();
});

test("codex JSON-RPC client cancels and removes an in-flight request", async () => {
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

  const abortController = new AbortController();
  const pending = client.request("model/list", {
    includeHidden: false,
    limit: 100
  }, {
    signal: abortController.signal
  });
  assert.equal(client.pendingRequests.size, 1);
  abortController.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "ABORT_ERR");
    assert.equal(error.method, "model/list");
    return true;
  });
  assert.equal(client.pendingRequests.size, 0);

  socket.emit("message", {
    data: JSON.stringify({
      id: 1,
      result: {
        data: [],
        nextCursor: null
      }
    })
  });
  assert.equal(client.pendingRequests.size, 0);
  client.close();
});

test("codex JSON-RPC client enforces its transport payload limit", async () => {
  FakeWebSocket.instances = [];
  const client = new CodexAppServerJsonRpcClient({
    endpoint: "ws://127.0.0.1:48123",
    maxMessageBytes: 256,
    requestTimeoutMs: 1000,
    WebSocketImpl: FakeWebSocket
  });
  const connection = client.connect();
  const socket = FakeWebSocket.instances.at(-1);
  socket.emit("open");
  await connection;
  assert.equal(socket.options.maxPayload, 256);

  const pending = client.request("model/list", {});
  const request = socket.sent.at(-1);
  socket.emit("message", {
    data: JSON.stringify({
      id: request.id,
      result: {
        data: "x".repeat(1024)
      }
    })
  });

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "assistant_codex_app_server_message_too_large");
    return true;
  });
  assert.equal(socket.closed, true);
  assert.equal(client.isOpen(), false);
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

test("Codex plan allowance reads once, accepts live updates and clears on auth changes", async () => {
  const provider = new CodexAppServerAgentProvider({ WebSocketImpl: ResponsiveFakeWebSocket });
  provider.ensureRuntime = async () => ({ endpoint: "ws://127.0.0.1:12345" });
  await provider.openConnection();
  try {
    const socket = FakeWebSocket.instances.at(-1);
    const calls = [];
    provider.client.request = async (method) => {
      calls.push(method);
      if (method === "account/read") return { account: { type: "chatgpt" } };
      return { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: { usedPercent: 80, windowDurationMins: 10080 } } };
    };
    const results = await Promise.all([provider.readPlanUsage(), provider.readPlanUsage()]);
    assert.equal(results[0].status, "available");
    assert.deepEqual(results[0].windows.map((window) => window.remainingPercent), [75, 20]);
    assert.deepEqual(calls, ["account/read", "account/rateLimits/read"]);
    const notify = (method, params) => socket.emit("message", { data: JSON.stringify({ method, params }) });
    notify("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: 100, windowDurationMins: 300 } } });
    assert.equal((await provider.readPlanUsage()).windows[0].remainingPercent, 0);
    notify("account/rateLimits/updated", { rateLimits: { limitId: "other", primary: { usedPercent: 5 } } });
    assert.equal((await provider.readPlanUsage()).windows[0].remainingPercent, 0);
    notify("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: null } } });
    assert.equal((await provider.readPlanUsage()).status, "unavailable");
    notify("account/updated", { authMode: "apikey" });
    provider.client.request = async (method) => {
      assert.equal(method, "account/read");
      return { account: { type: "apiKey" } };
    };
    assert.equal((await provider.readPlanUsage()).status, "unsupported");
    notify("account/updated", { authMode: "chatgpt" });
    provider.client.request = async () => { throw new Error("private upstream detail"); };
    assert.deepEqual(await provider.readPlanUsage(), { status: "unavailable", windows: [] });
  } finally { provider.close(); }
  assert.deepEqual(await provider.readPlanUsage(), { status: "unavailable", windows: [] });
});

test("Codex plan allowance ignores a read completed after an account switch", async () => {
  const provider = new CodexAppServerAgentProvider({ WebSocketImpl: ResponsiveFakeWebSocket });
  provider.ensureRuntime = async () => ({ endpoint: "ws://127.0.0.1:12345" });
  await provider.openConnection();
  try {
    let finish;
    provider.client.request = async (method) => method === "account/read"
      ? { account: { type: "chatgpt" } }
      : new Promise((resolve) => { finish = resolve; });
    const read = provider.readPlanUsage();
    await Promise.resolve();
    FakeWebSocket.instances.at(-1).emit("message", { data: JSON.stringify({ method: "account/updated", params: { authMode: "chatgpt" } }) });
    finish({ rateLimits: { secondary: { usedPercent: 90, windowDurationMins: 10080 } } });
    assert.deepEqual(await read, { status: "unavailable", windows: [] });
    assert.equal(provider.planUsage, null);
  } finally { provider.close(); }
});

test("stale-account runtime cleanup preserves a verified replacement without signaling it", async () => {
  await withTemporaryDirectory(async (root) => {
    const runtimeDir = path.join(root, "codex-app-server");
    await mkdir(runtimeDir);
    const metadata = {
      ...metadataForRuntime(runtimeDir),
      accountIdentitySignature: `sha256:${"b".repeat(64)}`
    };
    await writeMetadata(runtimeDir, metadata);
    const before = await readFile(path.join(runtimeDir, "runtime.json"), "utf8");
    let stops = 0;
    const result = await stopCodexAppServerRuntime({
      runtimeDir,
      expectedAccountIdentitySignature: `sha256:${"a".repeat(64)}`,
      async stopExecution() { stops += 1; throw new Error("Must not stop the replacement"); }
    });
    assert.equal(result.ownershipSuperseded, true);
    assert.equal(stops, 0);
    assert.equal(result.runtimeDirRemoved, false);
    assert.equal(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"), before);
  });
});

for (const [state, signature, expectedRemoval] of [
  ["owned stopped runtime", `sha256:${"a".repeat(64)}`, true],
  ["unverified runtime account", "", false]
]) {
  test(`stale-account runtime cleanup handles ${state}`, async () => {
    await withTemporaryDirectory(async (root) => {
      const runtimeDir = path.join(root, "codex-app-server");
      await mkdir(runtimeDir);
      await writeMetadata(runtimeDir, {
        ...metadataForRuntime(runtimeDir),
        accountIdentitySignature: signature,
        processState: "stopped",
        processExitVerifiedAt: "2026-09-13T00:00:00.000Z"
      });
      const result = await stopCodexAppServerRuntime({
        runtimeDir,
        expectedAccountIdentitySignature: `sha256:${"a".repeat(64)}`,
        async stopExecution() { assert.fail("Stopped runtime needs no signal"); }
      });
      assert.equal(result.runtimeDirRemoved, expectedRemoval);
      assert.equal(result.processExitVerified, expectedRemoval);
      if (!expectedRemoval) {
        assert.ok(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"));
      }
    });
  });
}

test("Codex goal controls preserve objective and budget while changing status", async () => {
  const provider = new CodexAppServerAgentProvider({ WebSocketImpl: ResponsiveFakeWebSocket });
  provider.ensureRuntime = async () => ({ endpoint: "ws://127.0.0.1:12345" });
  await provider.openConnection();
  try {
    const calls = [];
    provider.client.request = async (method, params) => { calls.push({ method, params }); return { goal: { status: params.status || "active" } }; };
    await provider.setGoal("thread-one", { objective: " Finish the report ", tokenBudget: 1000 });
    await assert.rejects(provider.setGoal("thread-one", { objective: " " }), /requires an objective/);
    await assert.rejects(provider.setGoal("thread-one", { objective: "Report", tokenBudget: -1 }), /positive token budget/);
    await provider.readGoal("thread-one");
    await provider.setGoalStatus("thread-one", "paused");
    await provider.setGoalStatus("thread-one", "active");
    await assert.rejects(provider.setGoalStatus("thread-one", "complete"), /Invalid Codex goal status/);
    await provider.clearGoal("thread-one");
    assert.deepEqual(calls, [
      { method: "thread/goal/set", params: { threadId: "thread-one", objective: "Finish the report", status: "active", tokenBudget: 1000 } },
      { method: "thread/goal/get", params: { threadId: "thread-one" } },
      { method: "thread/goal/set", params: { threadId: "thread-one", status: "paused" } },
      { method: "thread/goal/set", params: { threadId: "thread-one", status: "active" } },
      { method: "thread/goal/clear", params: { threadId: "thread-one" } }
    ]);
  } finally { await provider.close(); }
});

test("Codex observation stop pauses the same goal before interrupt and requires a fresh idle result", async () => {
  const provider = new CodexAppServerAgentProvider();
  const calls = [];
  let active = true;
  const goal = { status: "active", objective: "Finish", createdAt: 123 };
  provider.client = {
    isOpen: () => true,
    async request(method, params, { signal }) {
      calls.push(method);
      assert.equal(params.threadId, "thread-one");
      assert.ok(signal instanceof AbortSignal);
      if (method === "thread/goal/get") return { goal };
      if (method === "thread/goal/set") { goal.status = params.status; return { goal }; }
      if (method === "turn/interrupt") { assert.equal(params.turnId, "turn-one"); active = false; return {}; }
      return { thread: { status: { type: active ? "active" : "idle" } } };
    }
  };
  await provider.stopThreadForObservationLoss("thread-one", "turn-one");
  assert.deepEqual(calls, ["thread/goal/get", "thread/goal/set", "thread/read", "turn/interrupt", "thread/read"]);
  provider.client.request = async () => ({ goal: null, thread: { status: { type: "active" } } });
  await assert.rejects(provider.stopThreadForObservationLoss("thread-one", "turn-one"), /did not confirm/);
  provider.client.isOpen = () => false;
  await assert.rejects(provider.stopThreadForObservationLoss("thread-one", "turn-one"), /unavailable/);
});

test("unexpected Codex transport loss blocks reconnection and notifies its execution owner", async () => {
  const failures = [];
  const provider = new CodexAppServerAgentProvider({
    WebSocketImpl: ResponsiveFakeWebSocket,
    onObservationLost(error) { failures.push(error); }
  });
  provider.ensureRuntime = async () => ({ endpoint: "ws://localhost:9999" });
  try {
    await provider.connect();
    FakeWebSocket.instances.at(-1).close();
    assert.equal(failures.length, 1);
    await assert.rejects(provider.connect(), { code: "vibe64_codex_observation_lost" });
  } finally { provider.close(); }
});
