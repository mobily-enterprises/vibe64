import { spawn as defaultSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";

import {
  AGENT_PROVIDER_IDS,
  normalizeAgentText,
  normalizeAgentThread,
  normalizeAgentTurn
} from "./agentProviders.js";

const CODEX_APP_SERVER_METADATA_SCHEMA_VERSION = 3;
const CODEX_APP_SERVER_PROVIDER_ID = AGENT_PROVIDER_IDS.CODEX_APP_SERVER;
const CODEX_APP_SERVER_TRANSPORT = Object.freeze({
  UNIX: "unix"
});
const CODEX_APP_SERVER_RUNTIME_DIR_NAME = "codex-app-server";
const CODEX_APP_SERVER_METADATA_FILE = "runtime.json";
const CODEX_APP_SERVER_LOG_FILE = "app-server.log";
const CODEX_APP_SERVER_SOCKET_FILE = "app-server.sock";
const CODEX_APP_SERVER_LOCK_DIR = "runtime.lock";
const CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR = "/vibe64-codex-app-server";
const CODEX_APP_SERVER_READY_TIMEOUT_MS = 15000;
const CODEX_APP_SERVER_LOCK_TIMEOUT_MS = 10000;
const CODEX_APP_SERVER_LOCK_STALE_MS = 120000;
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 60000;
const CODEX_APP_SERVER_CLIENT_VERSION = "0.1.0";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function processUid() {
  return typeof process.getuid === "function" ? process.getuid() : "user";
}

function processIsAlive(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensurePrivateDirectory(dirPath = "") {
  await mkdir(dirPath, {
    mode: 0o700,
    recursive: true
  });
  await chmod(dirPath, 0o700).catch(() => null);
}

function codexAppServerRuntimeBaseDir({
  env = process.env
} = {}) {
  const explicitDir = normalizeAgentText(env.VIBE64_AGENT_RUNTIME_DIR);
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const xdgRuntimeDir = normalizeAgentText(env.XDG_RUNTIME_DIR);
  if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
    return path.join(xdgRuntimeDir, "vibe64", "agent-providers");
  }
  return path.join(os.tmpdir(), `vibe64-${processUid()}`, "agent-providers");
}

function codexAppServerRuntimeDir(options = {}) {
  return path.join(codexAppServerRuntimeBaseDir(options), CODEX_APP_SERVER_RUNTIME_DIR_NAME);
}

function codexAppServerMetadataPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_METADATA_FILE);
}

function codexAppServerLogPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOG_FILE);
}

function codexAppServerSocketPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_SOCKET_FILE);
}

function codexAppServerLockDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOCK_DIR);
}

function codexAppServerUnixEndpoint(socketPath = "") {
  return `unix://${socketPath}`;
}

function codexAppServerContainerSocketPath() {
  return path.posix.join(CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR, CODEX_APP_SERVER_SOCKET_FILE);
}

function codexAppServerContainerEndpoint() {
  return codexAppServerUnixEndpoint(codexAppServerContainerSocketPath());
}

function socketPathFromCodexAppServerEndpoint(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint.startsWith("unix://")) {
    return "";
  }
  return normalizedEndpoint.slice("unix://".length);
}

function codexAppServerEndpointForTarget(endpoint = "", {
  target = "host"
} = {}) {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint) {
    return "";
  }
  if (target !== "container") {
    return normalizedEndpoint;
  }
  if (normalizedEndpoint.startsWith("unix://")) {
    return normalizedEndpoint;
  }
  return normalizedEndpoint;
}

function normalizeCodexAppServerMetadata(metadata = {}) {
  const normalized = isPlainObject(metadata) ? metadata : {};
  const endpoint = normalizeAgentText(normalized.endpoint);
  return {
    containerEndpoint: normalizeAgentText(normalized.containerEndpoint),
    containerRuntimeDir: normalizeAgentText(normalized.containerRuntimeDir),
    containerSocketPath: normalizeAgentText(normalized.containerSocketPath),
    endpoint,
    healthz: normalizeAgentText(normalized.healthz),
    logPath: normalizeAgentText(normalized.logPath),
    pid: Number.isSafeInteger(Number(normalized.pid)) ? Number(normalized.pid) : null,
    provider: normalizeAgentText(normalized.provider),
    readyz: normalizeAgentText(normalized.readyz),
    runtimeDir: normalizeAgentText(normalized.runtimeDir),
    schemaVersion: Number(normalized.schemaVersion || 0),
    socketPath: normalizeAgentText(normalized.socketPath),
    startedAt: normalizeAgentText(normalized.startedAt),
    transport: normalizeAgentText(normalized.transport)
  };
}

function codexAppServerMetadataIsWellFormed(metadata = {}) {
  return Boolean(
    metadata.schemaVersion === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
    metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
    metadata.transport === CODEX_APP_SERVER_TRANSPORT.UNIX &&
    metadata.endpoint &&
    metadata.socketPath
  );
}

async function readCodexAppServerMetadata(runtimeDir = "") {
  try {
    const metadata = JSON.parse(await readFile(codexAppServerMetadataPath(runtimeDir), "utf8"));
    return normalizeCodexAppServerMetadata(metadata);
  } catch {
    return null;
  }
}

async function writeCodexAppServerMetadata(runtimeDir = "", metadata = {}) {
  await ensurePrivateDirectory(runtimeDir);
  const metadataPath = codexAppServerMetadataPath(runtimeDir);
  const tempPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600).catch(() => null);
  await rename(tempPath, metadataPath);
  await chmod(metadataPath, 0o600).catch(() => null);
}

async function codexAppServerMetadataIsLive(metadata = {}, options = {}) {
  const normalized = normalizeCodexAppServerMetadata(metadata);
  if (!codexAppServerMetadataIsWellFormed(normalized)) {
    return false;
  }
  return processIsAlive(normalized.pid) && await fileExists(normalized.socketPath);
}

async function fileExists(filePath = "") {
  try {
    const entry = await stat(filePath);
    return entry.isSocket() || entry.isFile();
  } catch {
    return false;
  }
}

async function tailTextFile(filePath = "", maxBytes = 4096) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.slice(-maxBytes);
  } catch {
    return "";
  }
}

async function readLockOwner(lockDir = "") {
  try {
    return JSON.parse(await readFile(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    return {};
  }
}

async function lockIsStale(lockDir = "") {
  const owner = await readLockOwner(lockDir);
  if (owner.pid && processIsAlive(owner.pid)) {
    const createdAtMs = Date.parse(owner.createdAt || "");
    return Number.isFinite(createdAtMs) && Date.now() - createdAtMs > CODEX_APP_SERVER_LOCK_STALE_MS;
  }
  return true;
}

async function acquireRuntimeLock(runtimeDir = "", {
  timeoutMs = CODEX_APP_SERVER_LOCK_TIMEOUT_MS
} = {}) {
  await ensurePrivateDirectory(runtimeDir);
  const lockDir = codexAppServerLockDir(runtimeDir);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await mkdir(lockDir, {
        mode: 0o700
      });
      await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid
      })}\n`, {
        mode: 0o600
      });
      return async () => {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await lockIsStale(lockDir)) {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
        continue;
      }
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for the Codex app-server runtime lock.");
}

async function waitForCodexAppServer(endpoint = "", {
  timeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS
} = {}) {
  const socketPath = socketPathFromCodexAppServerEndpoint(endpoint);
  if (!socketPath) {
    return false;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await fileExists(socketPath)) {
      return true;
    }
    await delay(100);
  }
  return false;
}

async function startCodexAppServerProcess({
  codexCommand = "codex",
  env = process.env,
  readyTimeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
  runtimeDir = codexAppServerRuntimeDir({ env }),
  spawn = defaultSpawn
} = {}) {
  await ensurePrivateDirectory(runtimeDir);
  const socketPath = codexAppServerSocketPath(runtimeDir);
  const endpoint = codexAppServerUnixEndpoint(socketPath);
  const containerEndpoint = codexAppServerContainerEndpoint();
  const logPath = codexAppServerLogPath(runtimeDir);
  await rm(socketPath, {
    force: true
  });
  const logHandle = await open(logPath, "a", 0o600);
  let child = null;
  try {
    child = spawn(codexCommand, [
      "app-server",
      "--listen",
      endpoint
    ], {
      detached: true,
      env,
      stdio: ["ignore", logHandle.fd, logHandle.fd]
    });
    child.unref?.();
  } finally {
    await logHandle.close().catch(() => null);
  }

  const ready = await waitForCodexAppServer(endpoint, {
    timeoutMs: readyTimeoutMs
  });
  if (!ready) {
    const logTail = await tailTextFile(logPath);
    throw new Error([
      `Codex app-server did not become ready at ${endpoint}.`,
      logTail ? `Recent log output:\n${logTail}` : ""
    ].filter(Boolean).join("\n"));
  }

  return {
    containerEndpoint,
    containerRuntimeDir: CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR,
    containerSocketPath: codexAppServerContainerSocketPath(),
    endpoint,
    healthz: "",
    logPath,
    pid: Number.isSafeInteger(child?.pid) ? child.pid : null,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    startedAt: new Date().toISOString(),
    transport: CODEX_APP_SERVER_TRANSPORT.UNIX
  };
}

async function ensureCodexAppServerRuntime(options = {}) {
  const runtimeDir = options.runtimeDir || codexAppServerRuntimeDir(options);
  await ensurePrivateDirectory(runtimeDir);

  const existing = await readCodexAppServerMetadata(runtimeDir);
  if (existing && await codexAppServerMetadataIsLive(existing, options)) {
    return {
      ...existing,
      reused: true
    };
  }

  const releaseLock = await acquireRuntimeLock(runtimeDir, options);
  try {
    const afterLock = await readCodexAppServerMetadata(runtimeDir);
    if (afterLock && await codexAppServerMetadataIsLive(afterLock, options)) {
      return {
        ...afterLock,
        reused: true
      };
    }

    const started = await startCodexAppServerProcess({
      ...options,
      runtimeDir
    });
    await writeCodexAppServerMetadata(runtimeDir, started);
    return {
      ...started,
      reused: false
    };
  } finally {
    await releaseLock();
  }
}

function addSocketListener(socket, eventName, handler) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(eventName, handler);
    return () => socket.removeEventListener?.(eventName, handler);
  }
  if (typeof socket.on === "function") {
    socket.on(eventName, handler);
    return () => socket.off?.(eventName, handler) || socket.removeListener?.(eventName, handler);
  }
  throw new Error("Unsupported WebSocket implementation.");
}

function socketMessageText(event) {
  const data = event?.data ?? event;
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Buffer) {
    return data.toString("utf8");
  }
  return String(data || "");
}

class CodexAppServerJsonRpcClient {
  constructor({
    endpoint = "",
    requestTimeoutMs = CODEX_APP_SERVER_REQUEST_TIMEOUT_MS,
    WebSocketImpl = WebSocket
  } = {}) {
    this.endpoint = normalizeAgentText(endpoint);
    this.requestTimeoutMs = normalizePositiveInteger(requestTimeoutMs, CODEX_APP_SERVER_REQUEST_TIMEOUT_MS);
    this.WebSocketImpl = WebSocketImpl;
    this.nextRequestId = 1;
    this.notificationSubscribers = new Set();
    this.pendingRequests = new Map();
    this.socket = null;
  }

  async connect() {
    if (!this.endpoint) {
      throw new Error("Codex app-server endpoint is required.");
    }
    if (typeof this.WebSocketImpl !== "function") {
      throw new Error("A WebSocket implementation is required for Codex app-server.");
    }
    if (this.socket) {
      return this;
    }
    const unixSocketPath = socketPathFromCodexAppServerEndpoint(this.endpoint);
    const socketOptions = unixSocketPath
      ? {
          createConnection: () => createConnection(unixSocketPath),
          perMessageDeflate: false
        }
      : {
          perMessageDeflate: false
        };
    this.socket = new this.WebSocketImpl(unixSocketPath ? "ws://localhost/" : this.endpoint, socketOptions);
    await new Promise((resolve, reject) => {
      const cleanup = [];
      const settle = (callback, value) => {
        for (const dispose of cleanup) {
          dispose?.();
        }
        callback(value);
      };
      cleanup.push(addSocketListener(this.socket, "open", () => settle(resolve)));
      cleanup.push(addSocketListener(this.socket, "error", (error) => settle(reject, error?.error || error)));
    });
    addSocketListener(this.socket, "message", (event) => this.handleMessage(event));
    addSocketListener(this.socket, "close", () => this.rejectPendingRequests(new Error("Codex app-server connection closed.")));
    return this;
  }

  async initialize({
    capabilities = {
      experimentalApi: true,
      requestAttestation: false
    },
    clientInfo = {
      name: "vibe64",
      title: "Vibe64",
      version: CODEX_APP_SERVER_CLIENT_VERSION
    }
  } = {}) {
    const result = await this.request("initialize", {
      capabilities,
      clientInfo
    });
    this.notify("initialized");
    return result;
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      return () => null;
    }
    this.notificationSubscribers.add(callback);
    return () => {
      this.notificationSubscribers.delete(callback);
    };
  }

  notify(method, params) {
    this.send({
      method,
      ...(params === undefined ? {} : { params })
    });
  }

  request(method, params = {}) {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    this.send({
      id,
      method,
      params
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, {
        method,
        reject,
        resolve,
        timeout
      });
    });
  }

  send(payload) {
    if (!this.socket || typeof this.socket.send !== "function") {
      throw new Error("Codex app-server connection is not open.");
    }
    this.socket.send(JSON.stringify(payload));
  }

  handleMessage(event) {
    let message = null;
    try {
      message = JSON.parse(socketMessageText(event));
    } catch {
      return;
    }
    if (Object.hasOwn(message, "id")) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex app-server request failed: ${pending.method}`));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    for (const subscriber of this.notificationSubscribers) {
      subscriber(message);
    }
  }

  rejectPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  close() {
    this.rejectPendingRequests(new Error("Codex app-server connection closed."));
    this.socket?.close?.();
    this.socket = null;
  }
}

function codexTextInput(text = "") {
  return {
    text: String(text ?? ""),
    text_elements: [],
    type: "text"
  };
}

function codexTurnInput(input = []) {
  const values = Array.isArray(input) ? input : [input];
  return values.map((item) => {
    if (isPlainObject(item) && item.type === "text") {
      return codexTextInput(item.text);
    }
    return codexTextInput(item);
  });
}

function shellQuote(value = "") {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function codexCliResumeCommand({
  codexCommand = "codex",
  endpoint = "",
  target = "host",
  threadId = ""
} = {}) {
  const normalizedEndpoint = codexAppServerEndpointForTarget(endpoint, {
    target
  });
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedEndpoint) {
    throw new Error("Codex app-server endpoint is required for the native CLI command.");
  }
  if (!normalizedThreadId) {
    throw new Error("Codex thread id is required for the native CLI command.");
  }
  const argv = [codexCommand, "--remote", normalizedEndpoint, "resume", normalizedThreadId];
  return {
    argv,
    command: argv.map(shellQuote).join(" ")
  };
}

class CodexAppServerAgentProvider {
  constructor(options = {}) {
    this.options = options;
    this.client = null;
    this.runtime = null;
  }

  async ensureRuntime() {
    this.runtime = await ensureCodexAppServerRuntime(this.options);
    return this.runtime;
  }

  async connect() {
    const runtime = this.runtime || await this.ensureRuntime();
    this.client = new CodexAppServerJsonRpcClient({
      endpoint: runtime.endpoint,
      requestTimeoutMs: this.options.requestTimeoutMs,
      WebSocketImpl: this.options.WebSocketImpl
    });
    await this.client.connect();
    const initializeResult = await this.client.initialize(this.options.initialize);
    return {
      initializeResult,
      runtime
    };
  }

  async activeClient() {
    if (!this.client) {
      await this.connect();
    }
    return this.client;
  }

  subscribe(callback) {
    if (!this.client) {
      throw new Error("Codex app-server provider is not connected.");
    }
    return this.client.subscribe(callback);
  }

  async startThread(params = {}) {
    const client = await this.activeClient();
    const response = await client.request("thread/start", params);
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread
      }),
      response
    };
  }

  async resumeThread(threadId = "", params = {}) {
    const client = await this.activeClient();
    const response = await client.request("thread/resume", {
      ...params,
      threadId: normalizeAgentText(threadId || params.threadId)
    });
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread
      }),
      response
    };
  }

  async sendTurn(threadId = "", input = [], params = {}) {
    const client = await this.activeClient();
    const response = await client.request("turn/start", {
      ...params,
      input: codexTurnInput(input),
      threadId: normalizeAgentText(threadId || params.threadId)
    });
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  async interruptTurn(threadId = "", turnId = "") {
    const client = await this.activeClient();
    return client.request("turn/interrupt", {
      threadId: normalizeAgentText(threadId),
      turnId: normalizeAgentText(turnId)
    });
  }

  nativeCliResumeCommand(threadId = "") {
    const runtime = this.runtime || {};
    return codexCliResumeCommand({
      codexCommand: this.options.codexCommand || "codex",
      endpoint: runtime.endpoint,
      threadId
    });
  }

  close() {
    this.client?.close();
    this.client = null;
  }
}

function createCodexAppServerAgentProvider(options = {}) {
  return new CodexAppServerAgentProvider(options);
}

export {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_TRANSPORT,
  CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR,
  CodexAppServerAgentProvider,
  CodexAppServerJsonRpcClient,
  codexAppServerContainerEndpoint,
  codexAppServerContainerSocketPath,
  codexAppServerEndpointForTarget,
  codexAppServerMetadataIsLive,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexCliResumeCommand,
  codexTextInput,
  codexTurnInput,
  createCodexAppServerAgentProvider,
  ensureCodexAppServerRuntime,
  startCodexAppServerProcess
};
