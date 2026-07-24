import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  chmod,
  mkdir,
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
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  codexAuthOutputRequiresReconnect,
  codexAuthStateSignature,
  markCodexReconnectRequired
} from "@local/vibe64-core/server/codexAuthState";
import {
  runVibe64Command as defaultCommandRunner,
  stableHash,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  AGENT_PROVIDER_IDS,
  normalizeAgentText,
  normalizeAgentThread,
  normalizeAgentTurn
} from "./agentProviders.js";
import {
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "./codexAttachmentPaths.js";

const CODEX_APP_SERVER_METADATA_SCHEMA_VERSION = 13;
const CODEX_APP_SERVER_PROVIDER_ID = AGENT_PROVIDER_IDS.CODEX_APP_SERVER;
const CODEX_APP_SERVER_TRANSPORT = Object.freeze({
  UNIX: "unix"
});
const CODEX_APP_SERVER_RUNTIME_DIR_NAME = "codex-app-server";
const CODEX_APP_SERVER_METADATA_FILE = "runtime.json";
const CODEX_APP_SERVER_LOG_FILE = "app-server.log";
const CODEX_APP_SERVER_SOCKET_FILE = "app-server.sock";
const CODEX_APP_SERVER_LOCK_DIR = "runtime.lock";
const CODEX_APP_SERVER_READY_TIMEOUT_MS = 15000;
const CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS = 2000;
const CODEX_APP_SERVER_LOCK_TIMEOUT_MS = 10000;
const CODEX_APP_SERVER_LOCK_STALE_MS = 120000;
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 60000;
const CODEX_APP_SERVER_INVALID_REQUEST_CODE = -32600;
const CODEX_AUTH_PREFLIGHT_TIMEOUT_MS = 15000;
const CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES = 4096;
const CODEX_APP_SERVER_CLIENT_VERSION = "0.1.0";
const CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES = process.platform === "linux" ? 107 : 103;
const VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV = "VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR";
const CODEX_APP_SERVER_ENDPOINT_STATUS = Object.freeze({
  MISSING: "missing",
  RESPONSIVE: "responsive",
  TIMEOUT: "timeout",
  UNREACHABLE: "unreachable"
});
const CODEX_APP_SERVER_RUNTIME_STATUS = Object.freeze({
  EXITED: "exited",
  INCOMPATIBLE: "incompatible",
  LIVE: "live",
  MISSING: "missing",
  SUSPECT: "suspect"
});

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

function hasOwn(object = {}, property = "") {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function codexAppServerRequestIsInvalid(error = null, method = "") {
  const expectedMethod = normalizeAgentText(method);
  const actualMethod = normalizeAgentText(error?.method);
  return Number(error?.code) === CODEX_APP_SERVER_INVALID_REQUEST_CODE &&
    (!expectedMethod || !actualMethod || actualMethod === expectedMethod);
}

function runtimeEnvValue(env = {}, hostEnv = process.env, name = "") {
  const primaryEnv = isPlainObject(env) ? env : {};
  const fallbackEnv = isPlainObject(hostEnv) ? hostEnv : {};
  return normalizeAgentText(hasOwn(primaryEnv, name) ? primaryEnv[name] : fallbackEnv[name]);
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

function processGroupIsAlive(processGroupId) {
  const normalizedProcessGroupId = Number(processGroupId);
  if (!Number.isSafeInteger(normalizedProcessGroupId) || normalizedProcessGroupId <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    return processIsAlive(normalizedProcessGroupId);
  }
  try {
    process.kill(-normalizedProcessGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessGroup(processGroupId, signal) {
  const normalizedProcessGroupId = Number(processGroupId);
  const target = process.platform === "win32"
    ? normalizedProcessGroupId
    : -normalizedProcessGroupId;
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (!["ESRCH", "EPERM"].includes(String(error?.code || ""))) {
      throw error;
    }
    return false;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && processGroupIsAlive(processGroupId)) {
    await delay(100);
  }
  return !processGroupIsAlive(processGroupId);
}

async function ensurePrivateDirectory(dirPath = "") {
  await mkdir(dirPath, {
    mode: 0o700,
    recursive: true
  });
  await chmod(dirPath, 0o700).catch(() => null);
}

async function ensureWritablePrivateDirectory(dirPath = "") {
  await ensurePrivateDirectory(dirPath);
  const probePath = path.join(dirPath, `.vibe64-write-check-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(probePath, "", {
      mode: 0o600
    });
  } catch (error) {
    throw new Error(
      `Codex app-server runtime directory is not writable: ${dirPath}. ${String(error?.message || error)}`
    );
  } finally {
    await rm(probePath, {
      force: true
    }).catch(() => null);
  }
}

async function assertExistingDirectory(dirPath = "", label = "directory") {
  const normalizedPath = normalizeAgentText(dirPath);
  if (!normalizedPath) {
    return;
  }
  const stats = await stat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${normalizedPath}`);
  }
}

function codexAppServerRuntimeBaseDir({
  env = process.env,
  hostEnv = process.env
} = {}) {
  const explicitDir = runtimeEnvValue(env, hostEnv, "VIBE64_AGENT_RUNTIME_DIR");
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const xdgRuntimeDir = runtimeEnvValue(env, hostEnv, "XDG_RUNTIME_DIR");
  if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
    return path.join(xdgRuntimeDir, "vibe64", "agent-providers");
  }
  const homeDir = normalizeAgentText(os.homedir());
  if (homeDir && path.isAbsolute(homeDir)) {
    return path.join(homeDir, ".cache", "vibe64", "agent-providers");
  }
  return path.join(os.tmpdir(), `vibe64-${processUid()}`, "agent-providers");
}

function codexAppServerRuntimeScope({
  targetRoot = "",
  workdir = ""
} = {}) {
  const normalizedTargetRoot = normalizeAgentText(targetRoot);
  if (normalizedTargetRoot) {
    return path.resolve(normalizedTargetRoot);
  }
  const normalizedWorkdir = normalizeAgentText(workdir);
  return normalizedWorkdir ? path.resolve(normalizedWorkdir) : "";
}

function codexAppServerRuntimeIdentityScope(options = {}) {
  const scope = codexAppServerRuntimeScope(options);
  if (!scope) {
    return "";
  }
  const namespace = runtimeNamespace();
  const runtimeInstanceId = normalizeAgentText(options.runtimeInstanceId);
  return [
    namespace ? `namespace:${namespace}` : "",
    `scope:${scope}`,
    runtimeInstanceId ? `instance:${runtimeInstanceId}` : ""
  ].filter(Boolean).join("\n");
}

function codexAppServerRuntimeDir(options = {}) {
  const scope = codexAppServerRuntimeIdentityScope(options);
  const dirName = scope
    ? `${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-${stableHash(scope)}`
    : CODEX_APP_SERVER_RUNTIME_DIR_NAME;
  return path.join(codexAppServerRuntimeBaseDir(options), dirName);
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

function codexAppServerSocketPathBytes(socketPath = "") {
  return Buffer.byteLength(String(socketPath || ""), "utf8");
}

function codexAppServerSocketPathTooLong(socketPath = "") {
  return codexAppServerSocketPathBytes(socketPath) > CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES;
}

function assertCodexAppServerSocketPathSupported(socketPath = "") {
  if (!codexAppServerSocketPathTooLong(socketPath)) {
    return;
  }
  throw new Error(
    `Codex app-server Unix socket path is too long for this OS: ${socketPath} ` +
    `(${codexAppServerSocketPathBytes(socketPath)} bytes, max ${CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES}). ` +
    "Configure VIBE64_AGENT_RUNTIME_DIR or XDG_RUNTIME_DIR to a shorter host runtime directory."
  );
}

function codexAppServerLockDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOCK_DIR);
}

function codexAppServerUnixEndpoint(socketPath = "") {
  return `unix://${socketPath}`;
}

async function currentCodexAuthStateSignature(options = {}) {
  const signature = normalizeAgentText(options.authStateSignature);
  if (signature) {
    return signature;
  }
  return codexAuthStateSignature({
    systemRoot: options.systemRoot
  });
}

function codexReconnectRequiredError({
  cause = null,
  observed = ""
} = {}) {
  const error = new Error(CODEX_RECONNECT_REQUIRED_MESSAGE);
  error.code = CODEX_RECONNECT_REQUIRED_CODE;
  error.errors = [
    {
      code: CODEX_RECONNECT_REQUIRED_CODE,
      message: CODEX_RECONNECT_REQUIRED_MESSAGE
    }
  ];
  error.observed = normalizeAgentText(observed);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function tailAppend(text = "", chunk = "", maxBytes = CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES) {
  const next = `${String(text || "")}${String(chunk || "")}`;
  return next.length > maxBytes ? next.slice(-maxBytes) : next;
}

function codexAuthPreflightArgs() {
  return [
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    "debug",
    "models"
  ];
}

async function runCodexAuthPreflight({
  codexCommand = STUDIO_MANAGED_CODEX_COMMAND,
  commandRunner = defaultCommandRunner,
  env = process.env,
  runtimes = [],
  terminalEnv = {},
  timeoutMs = CODEX_AUTH_PREFLIGHT_TIMEOUT_MS,
  toolHomeSource = ""
} = {}) {
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
  }
  const baseEnv = codexAppServerCommandBaseEnv({
    env,
    terminalEnv
  });
  try {
    const result = await commandRunner({
      actor: "app",
      args: codexAuthPreflightArgs(),
      baseEnv,
      command: codexCommand,
      credentialHome: codexAppServerCredentialHome(normalizedToolHomeSource, baseEnv),
      envPolicy: "auth",
      mode: "capture",
      purpose: "codex",
      runtimes: codexAppServerRuntimes(runtimes),
      shimDirs: codexAppServerShimDirs(terminalEnv),
      timeout: normalizePositiveInteger(timeoutMs, CODEX_AUTH_PREFLIGHT_TIMEOUT_MS)
    });
    return {
      code: result.exitCode,
      ok: result.ok === true,
      output: tailAppend("", result.output || [
        result.stderr,
        result.stdout
      ].filter(Boolean).join("\n")),
      signal: result.signal,
      timedOut: result.timedOut === true
    };
  } catch (error) {
    return {
      error,
      ok: false,
      output: normalizeAgentText(error?.message || error)
    };
  }
}

async function markCodexAppServerReconnectRequired(options = {}, {
  reason = "codex-app-server",
  observed = ""
} = {}) {
  await markCodexReconnectRequired(options.systemRoot, {
    reason
  });
  throw codexReconnectRequiredError({
    observed
  });
}

async function assertCodexAuthPreflightReady(options = {}, {
  reason = "codex-auth-preflight"
} = {}) {
  const result = await runCodexAuthPreflight(options);
  if (result.ok && !codexAuthOutputRequiresReconnect(result.output)) {
    return result;
  }
  const observed = normalizeAgentText(result.output || result.error?.message || "Codex auth preflight failed.");
  if (codexAuthOutputRequiresReconnect(observed)) {
    await markCodexReconnectRequired(options.systemRoot, {
      reason
    });
    throw codexReconnectRequiredError({
      observed
    });
  }
  throw new Error(observed || "Codex auth preflight failed.");
}

function codexAppServerProcessCwd({
  targetRoot = "",
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir) ? path.resolve(workdir) : "";
  if (normalizedWorkdir) {
    return normalizedWorkdir;
  }
  const normalizedTargetRoot = normalizeAgentText(targetRoot) ? path.resolve(targetRoot) : "";
  return normalizedTargetRoot;
}

function codexAppServerRuntimeDirIsManaged(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (!normalizedRuntimeDir) {
    return false;
  }
  const basename = path.basename(path.resolve(normalizedRuntimeDir));
  return basename === CODEX_APP_SERVER_RUNTIME_DIR_NAME ||
    basename.startsWith(`${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-`);
}

async function codexAppServerRuntimeProcessState(runtimeDir = "") {
  const metadata = await readCodexAppServerMetadata(runtimeDir);
  if (!metadata?.pid) {
    return {
      hasMetadata: Boolean(metadata),
      alive: false
    };
  }
  return {
    hasMetadata: true,
    alive: processGroupIsAlive(metadata.pid)
  };
}

async function removeCodexAppServerRuntimeDir(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (!codexAppServerRuntimeDirIsManaged(normalizedRuntimeDir)) {
    return false;
  }
  await rm(normalizedRuntimeDir, {
    force: true,
    recursive: true
  });
  return true;
}

async function stopCodexAppServerProcess(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (!codexAppServerRuntimeDirIsManaged(normalizedRuntimeDir)) {
    return {
      stopped: false
    };
  }
  const metadata = await readCodexAppServerMetadata(normalizedRuntimeDir);
  const pid = Number(metadata?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !processGroupIsAlive(pid)) {
    return {
      stopped: false
    };
  }
  signalProcessGroup(pid, "SIGTERM");
  let stopped = await waitForProcessGroupExit(pid, 3000);
  if (!stopped) {
    signalProcessGroup(pid, "SIGKILL");
    stopped = await waitForProcessGroupExit(pid, 1000);
  }
  return {
    pid,
    stopped
  };
}

function codexAppServerRuntimeCleanupCanSkip(error) {
  return ["EACCES", "EPERM", "ENOENT"].includes(String(error?.code || ""));
}

async function stopCodexAppServerRuntime(options = {}) {
  const runtimeDir = normalizeAgentText(options.runtimeDir);
  const processStop = runtimeDir
    ? await stopCodexAppServerProcess(runtimeDir)
    : {
        stopped: false
      };
  const runtimeProcessState = runtimeDir
    ? await codexAppServerRuntimeProcessState(runtimeDir)
    : {
        alive: false,
        hasMetadata: false
      };
  let runtimeDirRemoved = false;
  let runtimeDirCleanupSkipped = false;
  let runtimeDirCleanupError = "";
  if (
    runtimeDir &&
    (
      processStop.stopped === true ||
      (runtimeProcessState.hasMetadata && !runtimeProcessState.alive)
    )
  ) {
    try {
      runtimeDirRemoved = await removeCodexAppServerRuntimeDir(runtimeDir);
    } catch (error) {
      if (!codexAppServerRuntimeCleanupCanSkip(error)) {
        throw error;
      }
      runtimeDirCleanupSkipped = true;
      runtimeDirCleanupError = String(error?.message || error || "");
    }
  }
  return {
    ...processStop,
    runtimeDirCleanupError,
    runtimeDirCleanupSkipped,
    runtimeDirRemoved
  };
}

function socketPathFromCodexAppServerEndpoint(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint.startsWith("unix://")) {
    return "";
  }
  return normalizedEndpoint.slice("unix://".length);
}

function codexAppServerEndpointForTarget(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint) {
    return "";
  }
  return normalizedEndpoint;
}

function codexAppServerRuntimeIdentity(runtime = {}) {
  return [
    normalizeAgentText(runtime.authStateSignature),
    normalizeAgentText(runtime.endpoint),
    normalizeAgentText(runtime.runtimesHash),
    normalizeAgentText(runtime.terminalEnvHash),
    normalizeAgentText(runtime.socketPath),
    normalizeAgentText(runtime.startedAt),
    normalizeAgentText(runtime.pid)
  ].join("\0");
}

function normalizeCodexAppServerTerminalEnv(terminalEnv = {}) {
  if (!isPlainObject(terminalEnv)) {
    return {};
  }
  return Object.fromEntries(Object.entries(terminalEnv)
    .map(([name, value]) => [
      normalizeAgentText(name),
      String(value ?? "")
    ])
    .filter(([name, value]) => name && String(value || "")));
}

function codexAppServerCommandBaseEnv({
  env = process.env,
  terminalEnv = {}
} = {}) {
  return {
    ...env,
    ...normalizeCodexAppServerTerminalEnv(terminalEnv)
  };
}

function codexAppServerCredentialHome(toolHomeSource = "", baseEnv = {}) {
  const home = normalizeAgentText(toolHomeSource);
  if (!home) {
    return {};
  }
  return {
    home,
    username: normalizeAgentText(baseEnv.USER || baseEnv.LOGNAME)
  };
}

function codexAppServerShimDirs(terminalEnv = {}) {
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  return [
    normalizedTerminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]
  ].map(normalizeAgentText).filter(Boolean);
}

function codexAppServerRuntimes(runtimes = []) {
  const requested = Array.isArray(runtimes) ? runtimes : [];
  const values = [
    ...VIBE64_INTERACTIVE_RUNTIME_PACKS,
    ...requested
  ];
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeAgentText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function codexAppServerRuntimesHash(runtimes = []) {
  return stableHash(JSON.stringify(codexAppServerRuntimes(runtimes)));
}

function codexAppServerTerminalEnvHash(terminalEnv = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeCodexAppServerTerminalEnv(terminalEnv))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function normalizeCodexAppServerContextRecord(value = {}) {
  return isPlainObject(value) ? value : {};
}

function codexAppServerExecutionContextHash({
  project = {},
  session = {},
  userKey = ""
} = {}) {
  return stableHash(JSON.stringify({
    project: normalizeCodexAppServerContextRecord(project),
    session: normalizeCodexAppServerContextRecord(session),
    userKey: normalizeAgentText(userKey)
  }));
}

function normalizeCodexAppServerMetadata(metadata = {}) {
  const normalized = isPlainObject(metadata) ? metadata : {};
  const endpoint = normalizeAgentText(normalized.endpoint);
  return {
    attachmentHostRoot: normalizeAgentText(normalized.attachmentHostRoot),
    authStateSignature: normalizeAgentText(normalized.authStateSignature),
    endpoint,
    executionContextHash: normalizeAgentText(normalized.executionContextHash),
    healthz: normalizeAgentText(normalized.healthz),
    logPath: normalizeAgentText(normalized.logPath),
    pid: Number.isSafeInteger(Number(normalized.pid)) ? Number(normalized.pid) : null,
    processCwd: normalizeAgentText(normalized.processCwd),
    provider: normalizeAgentText(normalized.provider),
    readyz: normalizeAgentText(normalized.readyz),
    runtimeDir: normalizeAgentText(normalized.runtimeDir),
    runtimesHash: normalizeAgentText(normalized.runtimesHash),
    schemaVersion: Number(normalized.schemaVersion || 0),
    socketPath: normalizeAgentText(normalized.socketPath),
    startedAt: normalizeAgentText(normalized.startedAt),
    terminalEnvHash: normalizeAgentText(normalized.terminalEnvHash),
    toolHomeSource: normalizeAgentText(normalized.toolHomeSource),
    transport: normalizeAgentText(normalized.transport)
  };
}

function codexAppServerMetadataIsWellFormed(metadata = {}, options = {}) {
  const expectedAttachmentHostRoot = codexAttachmentHostRoot({
    env: options.env
  });
  const expectedToolHomeSource = normalizeAgentText(options.toolHomeSource);
  const expectedTerminalEnvHash = codexAppServerTerminalEnvHash(options.terminalEnv);
  const expectedRuntimesHash = codexAppServerRuntimesHash(options.runtimes);
  const expectedExecutionContextHash = codexAppServerExecutionContextHash(options);
  return Boolean(
    metadata.schemaVersion === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
    metadata.attachmentHostRoot === expectedAttachmentHostRoot &&
    metadata.authStateSignature &&
    metadata.executionContextHash === expectedExecutionContextHash &&
    metadata.processCwd &&
    metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
    metadata.runtimesHash === expectedRuntimesHash &&
    metadata.terminalEnvHash === expectedTerminalEnvHash &&
    metadata.toolHomeSource === expectedToolHomeSource &&
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
  await ensureWritablePrivateDirectory(runtimeDir);
  const metadataPath = codexAppServerMetadataPath(runtimeDir);
  const tempPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600).catch(() => null);
  await rename(tempPath, metadataPath);
  await chmod(metadataPath, 0o600).catch(() => null);
}

async function codexAppServerEndpointIsResponsive(endpoint = "", {
  timeoutMs = CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
  WebSocketImpl = WebSocket
} = {}) {
  return (await codexAppServerEndpointStatus(endpoint, {
    timeoutMs,
    WebSocketImpl
  })).status === CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE;
}

async function codexAppServerEndpointStatus(endpoint = "", {
  timeoutMs = CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
  WebSocketImpl = WebSocket
} = {}) {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  const socketPath = socketPathFromCodexAppServerEndpoint(normalizedEndpoint);
  if (!socketPath || !await fileExists(socketPath)) {
    return {
      status: CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING
    };
  }
  const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS);
  const client = new CodexAppServerJsonRpcClient({
    endpoint: normalizedEndpoint,
    requestTimeoutMs: normalizedTimeoutMs,
    WebSocketImpl
  });
  let timeout = null;
  const probe = (async () => {
    await client.connect();
    await client.initialize();
    return CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE;
  })();
  probe.catch(() => null);
  try {
    const status = await Promise.race([
      probe,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT), normalizedTimeoutMs);
        timeout.unref?.();
      })
    ]);
    return {
      status
    };
  } catch {
    return {
      status: CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE
    };
  } finally {
    clearTimeout(timeout);
    client.close();
  }
}

async function codexAppServerMetadataIsLive(metadata = {}, options = {}) {
  return (await codexAppServerRuntimeStatus(metadata, options)).status === CODEX_APP_SERVER_RUNTIME_STATUS.LIVE;
}

function codexAppServerLivenessTimeoutMs(options = {}) {
  return normalizePositiveInteger(
    options.livenessTimeoutMs,
    normalizePositiveInteger(options.timeoutMs, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS)
  );
}

async function codexAppServerRuntimeStatus(metadata = {}, options = {}) {
  const normalized = normalizeCodexAppServerMetadata(metadata);
  if (!codexAppServerMetadataIsWellFormed(normalized, options)) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.INCOMPATIBLE
    };
  }
  const authStateSignature = await currentCodexAuthStateSignature(options);
  if (normalized.authStateSignature !== authStateSignature) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.INCOMPATIBLE
    };
  }
  const runtimeProcessGroupIsAlive = typeof options.processGroupIsAlive === "function"
    ? options.processGroupIsAlive(normalized.pid)
    : processGroupIsAlive(normalized.pid);
  if (!runtimeProcessGroupIsAlive) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.EXITED
    };
  }
  const endpoint = await codexAppServerEndpointStatus(normalized.endpoint, {
    timeoutMs: codexAppServerLivenessTimeoutMs(options),
    WebSocketImpl: options.WebSocketImpl
  });
  if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE) {
    return {
      metadata: normalized,
      replace: false,
      reusable: true,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.LIVE
    };
  }
  if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.MISSING
    };
  }
  if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT) {
    return {
      metadata: normalized,
      replace: false,
      reusable: true,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.SUSPECT
    };
  }
  return {
    metadata: normalized,
    replace: true,
    reusable: false,
    status: CODEX_APP_SERVER_RUNTIME_STATUS.MISSING
  };
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
  env = process.env,
  timeoutMs = CODEX_APP_SERVER_LOCK_TIMEOUT_MS
} = {}) {
  await prepareCodexAttachmentRoot({
    env
  });
  await ensureWritablePrivateDirectory(runtimeDir);
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
  timeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
  WebSocketImpl = WebSocket
} = {}) {
  const socketPath = socketPathFromCodexAppServerEndpoint(endpoint);
  if (!socketPath) {
    return false;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    if (await codexAppServerEndpointIsResponsive(endpoint, {
      timeoutMs: Math.min(CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS, remainingMs),
      WebSocketImpl
    })) {
      return true;
    }
    await delay(100);
  }
  return false;
}

async function startCodexAppServerProcess({
  authStateSignature = "",
  codexCommand = STUDIO_MANAGED_CODEX_COMMAND,
  commandRunner = defaultCommandRunner,
  env = process.env,
  readyTimeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
  systemRoot = "",
  project = {},
  session = {},
  targetRoot = "",
  terminalEnv = {},
  toolHomeSource = "",
  userKey = "",
  WebSocketImpl = WebSocket,
  workdir = "",
  runtimeInstanceId = "",
  runtimes = [],
  runtimeDir = codexAppServerRuntimeDir({
    env,
    runtimeInstanceId,
    targetRoot,
    workdir
  })
} = {}) {
  await ensureWritablePrivateDirectory(runtimeDir);
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
  }
  const resolvedAuthStateSignature = await currentCodexAuthStateSignature({
    authStateSignature,
    env,
    systemRoot
  });
  const socketPath = codexAppServerSocketPath(runtimeDir);
  assertCodexAppServerSocketPathSupported(socketPath);
  const endpoint = codexAppServerUnixEndpoint(socketPath);
  const logPath = codexAppServerLogPath(runtimeDir);
  const processCwd = codexAppServerProcessCwd({
    targetRoot,
    workdir
  });
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  const normalizedRuntimes = codexAppServerRuntimes(runtimes);
  const baseEnv = codexAppServerCommandBaseEnv({
    env,
    terminalEnv: normalizedTerminalEnv
  });
  await rm(socketPath, {
    force: true
  });
  const startResult = await commandRunner({
    actor: "app",
    allowedRoots: processCwd ? [processCwd] : [],
    args: [
      "-c",
      STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
      "app-server",
      "--listen",
      endpoint
    ],
    baseEnv,
    command: codexCommand,
    credentialHome: codexAppServerCredentialHome(normalizedToolHomeSource, baseEnv),
    cwd: processCwd || process.cwd(),
    envPolicy: "auth",
    logPath,
    mode: "detached",
    project,
    purpose: "codex",
    runtimes: normalizedRuntimes,
    session,
    shimDirs: codexAppServerShimDirs(normalizedTerminalEnv),
    timeout: readyTimeoutMs,
    userKey: normalizeAgentText(userKey)
  });
  if (!startResult.ok) {
    throw new Error(startResult.output || startResult.error || "Codex app-server failed to start.");
  }

  const ready = await waitForCodexAppServer(endpoint, {
    timeoutMs: readyTimeoutMs,
    WebSocketImpl
  });
  if (!ready) {
    const logTail = await tailTextFile(logPath);
    if (codexAuthOutputRequiresReconnect(logTail)) {
      await markCodexAppServerReconnectRequired({
        env,
        systemRoot,
        toolHomeSource: normalizedToolHomeSource
      }, {
        observed: logTail,
        reason: "codex-app-server-start"
      });
    }
    throw new Error([
      `Codex app-server did not become ready at ${endpoint}.`,
      logTail ? `Recent log output:\n${logTail}` : ""
    ].filter(Boolean).join("\n"));
  }

  return {
    attachmentHostRoot: codexAttachmentHostRoot({
      env
    }),
    authStateSignature: resolvedAuthStateSignature,
    endpoint,
    executionContextHash: codexAppServerExecutionContextHash({
      project,
      session,
      userKey
    }),
    healthz: "",
    logPath,
    pid: Number.isSafeInteger(Number(startResult.pid)) ? Number(startResult.pid) : null,
    processCwd,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
    runtimesHash: codexAppServerRuntimesHash(normalizedRuntimes),
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    startedAt: new Date().toISOString(),
    terminalEnvHash: codexAppServerTerminalEnvHash(normalizedTerminalEnv),
    toolHomeSource: normalizedToolHomeSource,
    transport: CODEX_APP_SERVER_TRANSPORT.UNIX
  };
}

async function ensureCodexAppServerRuntime(options = {}) {
  const runtimeDir = options.runtimeDir || codexAppServerRuntimeDir(options);
  const authStateSignature = await currentCodexAuthStateSignature(options);
  const runtimeOptions = {
    ...options,
    authStateSignature
  };
  await ensureWritablePrivateDirectory(runtimeDir);

  const existing = await readCodexAppServerMetadata(runtimeDir);
  const existingStatus = existing ? await codexAppServerRuntimeStatus(existing, runtimeOptions) : null;
  if (existingStatus?.reusable) {
    return {
      ...existingStatus.metadata,
      reused: true,
      runtimeStatus: existingStatus.status
    };
  }

  const releaseLock = await acquireRuntimeLock(runtimeDir, runtimeOptions);
  try {
    const afterLock = await readCodexAppServerMetadata(runtimeDir);
    const afterLockStatus = afterLock ? await codexAppServerRuntimeStatus(afterLock, runtimeOptions) : null;
    if (afterLockStatus?.reusable) {
      return {
        ...afterLockStatus.metadata,
        reused: true,
        runtimeStatus: afterLockStatus.status
      };
    }

    if (!afterLockStatus || afterLockStatus.replace !== false) {
      await stopCodexAppServerProcess(runtimeDir);
    }

    const started = await startCodexAppServerProcess({
      ...runtimeOptions,
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
    this.requestHandler = null;
    this.connected = false;
    this.socket = null;
  }

  isOpen() {
    return Boolean(this.socket && (this.connected || this.socket.readyState === 1));
  }

  async connect() {
    if (!this.endpoint) {
      throw new Error("Codex app-server endpoint is required.");
    }
    if (typeof this.WebSocketImpl !== "function") {
      throw new Error("A WebSocket implementation is required for Codex app-server.");
    }
    if (this.isOpen()) {
      return this;
    }
    this.close();
    const unixSocketPath = socketPathFromCodexAppServerEndpoint(this.endpoint);
    const socketOptions = unixSocketPath
      ? {
          createConnection: () => createConnection(unixSocketPath),
          perMessageDeflate: false
        }
      : {
          perMessageDeflate: false
        };
    const socket = new this.WebSocketImpl(unixSocketPath ? "ws://localhost/" : this.endpoint, socketOptions);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const cleanup = [];
      const settle = (callback, value) => {
        for (const dispose of cleanup) {
          dispose?.();
        }
        callback(value);
      };
      cleanup.push(addSocketListener(socket, "open", () => {
        if (this.socket === socket) {
          this.connected = true;
        }
        settle(resolve);
      }));
      cleanup.push(addSocketListener(socket, "error", (error) => {
        if (this.socket === socket) {
          this.connected = false;
          this.socket = null;
        }
        settle(reject, error?.error || error);
      }));
    });
    addSocketListener(socket, "message", (event) => this.handleMessage(event));
    addSocketListener(socket, "close", () => {
      if (this.socket === socket) {
        this.connected = false;
        this.socket = null;
      }
      this.rejectPendingRequests(new Error("Codex app-server connection closed."));
    });
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

  setRequestHandler(callback) {
    this.requestHandler = typeof callback === "function" ? callback : null;
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
    if (!this.isOpen() || typeof this.socket.send !== "function") {
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
    if (Object.hasOwn(message, "id") && message.method) {
      void this.handleServerRequest(message);
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
        const error = new Error(message.error.message || `Codex app-server request failed: ${pending.method}`);
        error.code = message.error.code;
        error.data = message.error.data;
        error.method = pending.method;
        pending.reject(error);
        return;
      }
      pending.resolve(message.result);
      return;
    }
    for (const subscriber of this.notificationSubscribers) {
      subscriber(message);
    }
  }

  async handleServerRequest(message = {}) {
    try {
      if (!this.requestHandler) {
        const error = new Error(`Codex app-server client does not handle server request: ${message.method || "(missing method)"}`);
        error.code = -32601;
        throw error;
      }
      const result = await this.requestHandler({
        id: message.id,
        method: message.method,
        params: message.params
      });
      this.send({
        id: message.id,
        result
      });
    } catch (error) {
      try {
        this.send({
          error: {
            code: Number.isSafeInteger(error?.code) ? error.code : -32000,
            message: normalizeAgentText(error?.message) || "Codex app-server client request failed."
          },
          id: message.id
        });
      } catch {
        // The app-server connection closed before the response could be delivered.
      }
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
    const socket = this.socket;
    this.connected = false;
    this.socket = null;
    socket?.close?.();
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
  codexCommand = "",
  endpoint = "",
  threadId = ""
} = {}) {
  const normalizedEndpoint = codexAppServerEndpointForTarget(endpoint);
  const resolvedCodexCommand = normalizeAgentText(codexCommand) || STUDIO_MANAGED_CODEX_COMMAND;
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedEndpoint) {
    throw new Error("Codex app-server endpoint is required for the native CLI command.");
  }
  if (!normalizedThreadId) {
    throw new Error("Codex thread id is required for the native CLI command.");
  }
  const argv = [
    resolvedCodexCommand,
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    "--remote",
    normalizedEndpoint,
    "resume",
    normalizedThreadId
  ];
  return {
    argv,
    command: argv.map(shellQuote).join(" ")
  };
}

class CodexAppServerAgentProvider {
  constructor(options = {}) {
    this.availabilityPromise = null;
    this.options = options;
    this.client = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.runtime = null;
    this.runtimePromise = null;
    this.serverRequestHandler = null;
  }

  async ensureRuntime() {
    if (this.runtimePromise) {
      return this.runtimePromise;
    }
    const operation = this.prepareRuntime();
    this.runtimePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.runtimePromise === operation) {
        this.runtimePromise = null;
      }
    }
  }

  async prepareRuntime() {
    const previousRuntime = this.runtime;
    const nextRuntime = await ensureCodexAppServerRuntime(this.options);
    if (
      this.client &&
      previousRuntime &&
      codexAppServerRuntimeIdentity(previousRuntime) !== codexAppServerRuntimeIdentity(nextRuntime)
    ) {
      this.client.close();
      this.client = null;
    }
    this.runtime = nextRuntime;
    await this.assertRuntimeAuthReady("codex-app-server-runtime");
    return this.runtime;
  }

  async preflightAuth(reason = "codex-auth-preflight") {
    await this.assertRuntimeAuthReady(reason);
    try {
      return await assertCodexAuthPreflightReady(this.options, {
        reason
      });
    } catch (error) {
      if (error?.code === CODEX_RECONNECT_REQUIRED_CODE) {
        await this.stopRuntime().catch(() => null);
      }
      throw error;
    }
  }

  async assertRuntimeAuthReady(reason = "codex-app-server") {
    const runtime = this.runtime || {};
    const logTail = await tailTextFile(runtime.logPath || "");
    if (!codexAuthOutputRequiresReconnect(logTail)) {
      return;
    }
    await this.stopRuntime().catch(() => null);
    await markCodexAppServerReconnectRequired({
      ...this.options,
      toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource
    }, {
      observed: logTail,
      reason
    });
  }

  async runRequest(operation, reason = "codex-app-server-request") {
    try {
      const result = await operation();
      await this.assertRuntimeAuthReady(reason);
      return result;
    } catch (error) {
      const observed = [
        error?.message || "",
        error?.observed || "",
        await tailTextFile(this.runtime?.logPath || "")
      ].filter(Boolean).join("\n");
      if (codexAuthOutputRequiresReconnect(observed)) {
        const runtime = this.runtime || {};
        await this.stopRuntime().catch(() => null);
        await markCodexAppServerReconnectRequired({
          ...this.options,
          toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource
        }, {
          observed,
          reason
        });
      }
      throw error;
    }
  }

  async connect() {
    if (this.client?.isOpen?.() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const operation = this.openConnection();
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) {
        this.connectPromise = null;
      }
    }
  }

  async openConnection() {
    if (this.client?.isOpen?.() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    const runtime = await this.ensureRuntime();
    if (this.client?.isOpen?.()) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime
      };
    }
    this.client?.close?.();
    this.client = null;
    const client = new CodexAppServerJsonRpcClient({
      endpoint: runtime.endpoint,
      requestTimeoutMs: this.options.requestTimeoutMs,
      WebSocketImpl: this.options.WebSocketImpl
    });
    client.setRequestHandler(this.serverRequestHandler);
    let initializeResult = null;
    try {
      await client.connect();
      initializeResult = await this.runRequest(
        () => client.initialize(this.options.initialize),
        "codex-app-server-initialize"
      );
    } catch (error) {
      client.close();
      throw error;
    }
    this.client = client;
    this.connectionGeneration += 1;
    return {
      initializeResult,
      runtime
    };
  }

  currentConnectionGeneration() {
    return this.connectionGeneration;
  }

  isAvailable() {
    return Boolean(this.client?.isOpen?.() && this.runtime);
  }

  async activeClient() {
    if (this.client?.isOpen?.()) {
      return this.client;
    }
    await this.connect();
    return this.client;
  }

  async ensureAvailable() {
    if (this.isAvailable()) {
      return {
        client: this.client,
        ok: true,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.availabilityPromise) {
      return this.availabilityPromise;
    }
    const operation = (async () => {
      await this.preflightAuth("codex-app-server-ensure-available");
      const client = await this.activeClient();
      return {
        client,
        ok: true,
        runtime: this.runtime
      };
    })();
    this.availabilityPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.availabilityPromise === operation) {
        this.availabilityPromise = null;
      }
    }
  }

  subscribe(callback) {
    if (!this.client) {
      throw new Error("Codex app-server provider is not connected.");
    }
    return this.client.subscribe(callback);
  }

  setServerRequestHandler(callback) {
    const handler = typeof callback === "function" ? callback : null;
    this.serverRequestHandler = handler;
    this.client?.setRequestHandler?.(handler);
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
        this.client?.setRequestHandler?.(null);
      }
    };
  }

  async startThread(params = {}) {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("thread/start", params),
      "codex-app-server-thread-start"
    );
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
    const response = await this.runRequest(
      () => client.request("thread/resume", {
        excludeTurns: true,
        ...params,
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-thread-resume"
    );
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread
      }),
      response
    };
  }

  async readThread(threadId = "") {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("thread/read", {
        includeTurns: true,
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-read"
    );
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id || threadId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread || response
      }),
      response
    };
  }

  async readThreadStatus(threadId = "") {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("thread/read", {
        includeTurns: false,
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-status"
    );
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id || threadId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread || response
      }),
      response
    };
  }

  async listThreadTurns(threadId = "", params = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/turns/list", {
        ...params,
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-thread-turns-list"
    );
  }

  async listLoadedThreads(params = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/loaded/list", params),
      "codex-app-server-thread-loaded-list"
    );
  }

  async unsubscribeThread(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/unsubscribe", {
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-unsubscribe"
    );
  }

  async deleteThread(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/delete", {
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-delete"
    );
  }

  async sendTurn(threadId = "", input = [], params = {}) {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("turn/start", {
        ...params,
        input: codexTurnInput(input),
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-turn-start"
    );
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  async steerTurn(threadId = "", turnId = "", input = [], params = {}) {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("turn/steer", {
        ...params,
        expectedTurnId: normalizeAgentText(turnId || params.expectedTurnId),
        input: codexTurnInput(input),
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-turn-steer"
    );
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId || turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  async interruptTurn(threadId = "", turnId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("turn/interrupt", {
        threadId: normalizeAgentText(threadId),
        turnId: normalizeAgentText(turnId)
      }),
      "codex-app-server-turn-interrupt"
    );
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

  async stopRuntime() {
    this.close();
    const runtime = this.runtime || {};
    const result = await stopCodexAppServerRuntime({
      ...this.options,
      runtimeDir: runtime.runtimeDir || this.options.runtimeDir
    });
    this.runtime = null;
    return result;
  }
}

function createCodexAppServerAgentProvider(options = {}) {
  return new CodexAppServerAgentProvider(options);
}

export {
  CODEX_APP_SERVER_INVALID_REQUEST_CODE,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_TRANSPORT,
  CodexAppServerAgentProvider,
  CodexAppServerJsonRpcClient,
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerMetadataIsLive,
  codexAppServerRequestIsInvalid,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexCliResumeCommand,
  codexTextInput,
  codexTurnInput,
  createCodexAppServerAgentProvider,
  ensureCodexAppServerRuntime,
  startCodexAppServerProcess,
  stopCodexAppServerRuntime
};
