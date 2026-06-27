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
  gitToolchainMountArgs
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  dockerEnvArgs
} from "@local/studio-terminal-core/server/dockerRuntime";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  codexAuthOutputRequiresReconnect,
  codexAuthStateSignature,
  markCodexReconnectRequired
} from "@local/vibe64-core/server/codexAuthState";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  resolveVibe64ProviderHomesRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  runtimeTargetName,
  targetRuntimeNetworkDockerArgs
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  hostUserIdentityEnvArgs,
  stableHash
} from "@local/studio-terminal-core/server/shellCommands";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  runtimeNamespace,
  studioDaemonDockerLabels,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioToolHomeDockerArgs,
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  AGENT_PROVIDER_IDS,
  normalizeAgentText,
  normalizeAgentThread,
  normalizeAgentTurn
} from "./agentProviders.js";
import {
  codexAttachmentMount,
  prepareCodexAttachmentRoot
} from "./codexAttachmentPaths.js";

const CODEX_APP_SERVER_METADATA_SCHEMA_VERSION = 9;
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
const CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS = 2000;
const CODEX_APP_SERVER_LOCK_TIMEOUT_MS = 10000;
const CODEX_APP_SERVER_LOCK_STALE_MS = 120000;
const CODEX_APP_SERVER_CONTAINER_REMOVE_TIMEOUT_MS = 5000;
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 60000;
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

function codexGitCommandWrapperSetupLines() {
  return [
    `if [ -n "\${${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}:-}" ]; then`,
    `  export PATH="$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}:$PATH"`,
    "  if [ \"$(id -u)\" = \"0\" ]; then",
    "    for VIBE64_CODEX_GIT_COMMAND_NAME in git gh; do",
    `      if [ -x "$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}/$VIBE64_CODEX_GIT_COMMAND_NAME" ]; then`,
    `        ln -sfn "$${VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV}/$VIBE64_CODEX_GIT_COMMAND_NAME" "/usr/local/bin/$VIBE64_CODEX_GIT_COMMAND_NAME"`,
    "      fi",
    "    done",
    "    unset VIBE64_CODEX_GIT_COMMAND_NAME",
    "  fi",
    "fi"
  ];
}

function hasOwn(object = {}, property = "") {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function runtimeEnvValue(env = {}, hostEnv = process.env, name = "") {
  const primaryEnv = isPlainObject(env) ? env : {};
  const fallbackEnv = isPlainObject(hostEnv) ? hostEnv : {};
  return normalizeAgentText(hasOwn(primaryEnv, name) ? primaryEnv[name] : fallbackEnv[name]);
}

function prependPathEntry(entry = "", currentPath = "") {
  const normalizedEntry = normalizeAgentText(entry);
  const normalizedPath = String(currentPath || "");
  if (!normalizedEntry) {
    return normalizedPath;
  }
  return normalizedPath ? `${normalizedEntry}:${normalizedPath}` : normalizedEntry;
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

function codexAppServerRuntimeBaseDir({
  targetRoot = "",
  workdir = "",
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
  const scope = codexAppServerRuntimeScope({
    targetRoot,
    workdir
  });
  if (scope) {
    return path.join(scope, ".vibe64", "runtime", "agent-providers");
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

function codexAppServerContainerSocketPath() {
  return path.posix.join(CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR, CODEX_APP_SERVER_SOCKET_FILE);
}

function codexAppServerContainerEndpoint() {
  return codexAppServerUnixEndpoint(codexAppServerContainerSocketPath());
}

async function currentCodexAuthStateSignature(options = {}) {
  const signature = normalizeAgentText(options.authStateSignature);
  if (signature) {
    return signature;
  }
  return codexAuthStateSignature({
    env: options.env,
    providerHomesRoot: codexProviderHomesRootForOptions(options),
    systemRoot: options.systemRoot
  });
}

function codexProviderHomesRootForOptions({
  env = process.env,
  systemRoot = "",
  toolHomeSource = ""
} = {}) {
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV]) {
    return resolveVibe64ProviderHomesRoot({
      env,
      systemRoot
    });
  }
  if (normalizedToolHomeSource && path.basename(path.resolve(normalizedToolHomeSource)) === "codex") {
    return path.dirname(path.resolve(normalizedToolHomeSource));
  }
  return resolveVibe64ProviderHomesRoot({
    env,
    systemRoot
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

function observeChildOutput(stream, onChunk) {
  if (!stream || typeof stream.on !== "function") {
    return;
  }
  stream.on("data", (chunk) => onChunk(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "")));
}

function codexAuthPreflightDockerArgs({
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  terminalEnv = {},
  toolHomeSource = ""
} = {}) {
  const command = [
    STUDIO_MANAGED_CODEX_COMMAND,
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    "debug",
    "models"
  ];
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    ...studioToolHomeDockerArgs({
      source: normalizeAgentText(toolHomeSource) || undefined
    }),
    ...hostUserIdentityEnvArgs(),
    ...dockerEnvArgs(normalizeCodexAppServerTerminalEnv(terminalEnv)),
    image,
    "bash",
    "-lc",
    studioUserStartupScript(command)
  ];
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
  codexCommand = "codex",
  env = process.env,
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  spawn = defaultSpawn,
  terminalEnv = {},
  timeoutMs = CODEX_AUTH_PREFLIGHT_TIMEOUT_MS,
  toolHomeSource = "",
  useDocker = true
} = {}) {
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await ensurePrivateDirectory(normalizedToolHomeSource);
  }
  const command = useDocker ? "docker" : codexCommand;
  const args = useDocker
    ? codexAuthPreflightDockerArgs({
        image,
        terminalEnv,
        toolHomeSource: normalizedToolHomeSource
      })
    : codexAuthPreflightArgs();
  const child = spawn(command, args, {
    env: useDocker
      ? env
      : {
          ...env,
          ...(normalizedToolHomeSource
            ? {
                HOME: normalizedToolHomeSource,
                NPM_CONFIG_PREFIX: path.join(normalizedToolHomeSource, ".local")
              }
            : {})
        },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderrTail = "";
  let stdoutTail = "";
  observeChildOutput(child.stdout, (chunk) => {
    stdoutTail = tailAppend(stdoutTail, chunk);
  });
  observeChildOutput(child.stderr, (chunk) => {
    stderrTail = tailAppend(stderrTail, chunk);
  });
  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        output: [
          stderrTail,
          stdoutTail
        ].filter(Boolean).join("\n"),
        ...result
      });
    };
    timeout = setTimeout(() => {
      child.kill?.("SIGTERM");
      settle({
        code: null,
        ok: false,
        timedOut: true
      });
    }, normalizePositiveInteger(timeoutMs, CODEX_AUTH_PREFLIGHT_TIMEOUT_MS));
    timeout.unref?.();
    child.once?.("error", (error) => settle({
      error,
      ok: false
    }));
    child.once?.("close", (code, signal) => settle({
      code,
      ok: code === 0,
      signal
    }));
    child.once?.("exit", (code, signal) => settle({
      code,
      ok: code === 0,
      signal
    }));
  });
}

async function markCodexAppServerReconnectRequired(options = {}, {
  reason = "codex-app-server",
  observed = ""
} = {}) {
  await markCodexReconnectRequired(options.systemRoot, {
    providerHomesRoot: codexProviderHomesRootForOptions(options),
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
      providerHomesRoot: codexProviderHomesRootForOptions(options),
      reason
    });
    throw codexReconnectRequiredError({
      observed
    });
  }
  throw new Error(observed || "Codex auth preflight failed.");
}

function dockerMountArgs({
  readOnly = false,
  source = "",
  target = ""
} = {}) {
  const normalizedSource = normalizeAgentText(source);
  const normalizedTarget = normalizeAgentText(target);
  if (!normalizedSource || !normalizedTarget) {
    return [];
  }
  return [
    "-v",
    `${normalizedSource}:${normalizedTarget}${readOnly ? ":ro" : ""}`
  ];
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  if (!rootPath || !candidatePath) {
    return false;
  }
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function workdirMountArgs({
  targetRoot = "",
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir);
  if (!normalizedWorkdir || pathInsideOrEqual(targetRoot, normalizedWorkdir)) {
    return [];
  }
  return dockerMountArgs({
    source: path.resolve(normalizedWorkdir),
    target: path.resolve(normalizedWorkdir)
  });
}

function codexAppServerProcessCwd({
  targetRoot = "",
  workdir = ""
} = {}) {
  const normalizedTargetRoot = normalizeAgentText(targetRoot) ? path.resolve(targetRoot) : "";
  if (normalizedTargetRoot) {
    // Session-scoped app-servers still use the project root for shared mounts; thread requests carry the session workdir.
    return normalizedTargetRoot;
  }
  const normalizedWorkdir = normalizeAgentText(workdir) ? path.resolve(workdir) : "";
  return normalizedWorkdir;
}

function dockerNamePart(value = "", fallback = "runtime") {
  const normalized = normalizeAgentText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || fallback;
}

function codexAppServerRuntimeNamespacePart() {
  const namespace = runtimeNamespace();
  return namespace ? dockerNamePart(namespace, "") : "";
}

function codexAppServerContainerNameForTarget({
  runtimeDir = "",
  targetRoot = ""
} = {}) {
  const project = normalizeAgentText(targetRoot) ? runtimeTargetName(targetRoot) : "";
  const runtimeName = dockerNamePart(
    path.basename(path.resolve(runtimeDir || CODEX_APP_SERVER_RUNTIME_DIR_NAME)),
    CODEX_APP_SERVER_RUNTIME_DIR_NAME
  );
  return [
    "vibe64",
    codexAppServerRuntimeNamespacePart(),
    project,
    runtimeName
  ].filter(Boolean).join("-");
}

function waitForSpawnedProcessClose(child, {
  timeoutMs = CODEX_APP_SERVER_CONTAINER_REMOVE_TIMEOUT_MS
} = {}) {
  if (!child || typeof child.once !== "function") {
    return Promise.resolve({
      ok: true
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    timeout = setTimeout(() => {
      settle({
        ok: false,
        timedOut: true
      });
      child.kill?.("SIGTERM");
    }, timeoutMs);
    timeout.unref?.();
    child.once("error", (error) => settle({
      error,
      ok: false
    }));
    child.once("close", (code, signal) => settle({
      code,
      ok: code === 0,
      signal
    }));
    child.once("exit", (code, signal) => settle({
      code,
      ok: code === 0,
      signal
    }));
  });
}

async function removeCodexAppServerContainer({
  runtimeDir = "",
  spawn = defaultSpawn,
  targetRoot = "",
  timeoutMs = CODEX_APP_SERVER_CONTAINER_REMOVE_TIMEOUT_MS,
  useDocker = true
} = {}) {
  if (!useDocker) {
    return {
      removed: false
    };
  }
  const containerName = codexAppServerContainerNameForTarget({
    runtimeDir,
    targetRoot
  });
  try {
    const child = spawn("docker", ["rm", "-f", containerName], {
      stdio: "ignore"
    });
    const result = await waitForSpawnedProcessClose(child, {
      timeoutMs
    });
    return {
      ...result,
      containerName,
      removed: result.ok === true
    };
  } catch (error) {
    return {
      containerName,
      error,
      removed: false
    };
  }
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
    alive: processIsAlive(metadata.pid)
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

async function stopCodexAppServerRuntime(options = {}) {
  const result = await removeCodexAppServerContainer(options);
  const runtimeDir = normalizeAgentText(options.runtimeDir);
  const runtimeProcessState = runtimeDir
    ? await codexAppServerRuntimeProcessState(runtimeDir)
    : {
        alive: false,
        hasMetadata: false
      };
  let runtimeDirRemoved = false;
  if (
    runtimeDir &&
    (
      result.removed === true ||
      (runtimeProcessState.hasMetadata && !runtimeProcessState.alive)
    )
  ) {
    runtimeDirRemoved = await removeCodexAppServerRuntimeDir(runtimeDir);
  }
  return {
    ...result,
    runtimeDirRemoved
  };
}

function codexAppServerDockerArgs({
  containerEndpoint = codexAppServerContainerEndpoint(),
  env = process.env,
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  runtimeDir = "",
  targetRoot = "",
  terminalEnv = {},
  toolHomeSource = "",
  workdir = ""
} = {}) {
  const normalizedRuntimeDir = path.resolve(runtimeDir);
  const normalizedTargetRoot = normalizeAgentText(targetRoot) ? path.resolve(targetRoot) : "";
  const normalizedWorkdir = normalizeAgentText(workdir) ? path.resolve(workdir) : "";
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  const processCwd = codexAppServerProcessCwd({
    targetRoot: normalizedTargetRoot,
    workdir: normalizedWorkdir
  });
  const command = [
    STUDIO_MANAGED_CODEX_COMMAND,
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    "app-server",
    "--listen",
    containerEndpoint
  ];
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    "--name",
    codexAppServerContainerNameForTarget({
      runtimeDir: normalizedRuntimeDir,
      targetRoot: normalizedTargetRoot
    }),
    "--label",
    studioDockerLabel("kind", "codex-app-server"),
    ...studioDaemonDockerLabels().flatMap((label) => ["--label", label]),
    "--label",
    studioDockerLabel("target", normalizedTargetRoot ? runtimeTargetName(normalizedTargetRoot) : dockerNamePart(path.basename(normalizedRuntimeDir))),
    ...studioToolHomeDockerArgs({
      source: normalizeAgentText(toolHomeSource) || undefined
    }),
    ...hostUserIdentityEnvArgs(),
    ...dockerEnvArgs(normalizedTerminalEnv),
    ...gitToolchainMountArgs(normalizedTargetRoot),
    ...dockerMountArgs({
      source: normalizedRuntimeDir,
      target: CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR
    }),
    ...dockerMountArgs(codexAttachmentMount({
      env
    })),
    ...(normalizedTargetRoot
      ? [
          "-v",
          `${normalizedTargetRoot}:/workspace`,
          "-v",
          `${normalizedTargetRoot}:${normalizedTargetRoot}`,
          ...targetRuntimeNetworkDockerArgs(normalizedTargetRoot)
        ]
      : []),
    ...(normalizedTargetRoot
      ? []
      : workdirMountArgs({
          targetRoot: normalizedTargetRoot,
          workdir: normalizedWorkdir
        })),
    ...(processCwd ? ["-w", processCwd] : []),
    image,
    "bash",
    "-lc",
    studioUserStartupScript(command, {
      setupLines: [
        ...codexGitCommandWrapperSetupLines(),
        `mkdir -p ${shellQuote(CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR)}`
      ]
    })
  ];
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

function codexAppServerRuntimeIdentity(runtime = {}) {
  return [
    normalizeAgentText(runtime.authStateSignature),
    normalizeAgentText(runtime.endpoint),
    normalizeAgentText(runtime.image),
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

function codexAppServerTerminalEnvHash(terminalEnv = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeCodexAppServerTerminalEnv(terminalEnv))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function normalizeCodexAppServerMetadata(metadata = {}) {
  const normalized = isPlainObject(metadata) ? metadata : {};
  const endpoint = normalizeAgentText(normalized.endpoint);
  return {
    attachmentContainerRoot: normalizeAgentText(normalized.attachmentContainerRoot),
    attachmentHostRoot: normalizeAgentText(normalized.attachmentHostRoot),
    authStateSignature: normalizeAgentText(normalized.authStateSignature),
    containerEndpoint: normalizeAgentText(normalized.containerEndpoint),
    containerRuntimeDir: normalizeAgentText(normalized.containerRuntimeDir),
    containerSocketPath: normalizeAgentText(normalized.containerSocketPath),
    endpoint,
    healthz: normalizeAgentText(normalized.healthz),
    image: normalizeAgentText(normalized.image),
    logPath: normalizeAgentText(normalized.logPath),
    pid: Number.isSafeInteger(Number(normalized.pid)) ? Number(normalized.pid) : null,
    processCwd: normalizeAgentText(normalized.processCwd),
    provider: normalizeAgentText(normalized.provider),
    readyz: normalizeAgentText(normalized.readyz),
    runtimeDir: normalizeAgentText(normalized.runtimeDir),
    schemaVersion: Number(normalized.schemaVersion || 0),
    socketPath: normalizeAgentText(normalized.socketPath),
    startedAt: normalizeAgentText(normalized.startedAt),
    terminalEnvHash: normalizeAgentText(normalized.terminalEnvHash),
    toolHomeSource: normalizeAgentText(normalized.toolHomeSource),
    transport: normalizeAgentText(normalized.transport)
  };
}

function codexAppServerMetadataIsWellFormed(metadata = {}, options = {}) {
  const attachmentMount = codexAttachmentMount({
    env: options.env
  });
  const expectedImage = normalizeAgentText(options.image || STUDIO_BASE_TOOLCHAIN_IMAGE);
  const expectedToolHomeSource = normalizeAgentText(options.toolHomeSource);
  const expectedTerminalEnvHash = codexAppServerTerminalEnvHash(options.terminalEnv);
  return Boolean(
    metadata.schemaVersion === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
    metadata.attachmentContainerRoot === attachmentMount.target &&
    metadata.attachmentHostRoot === attachmentMount.source &&
    metadata.authStateSignature &&
    metadata.image === expectedImage &&
    metadata.processCwd &&
    metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
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
  if (!processIsAlive(normalized.pid)) {
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
  codexCommand = "codex",
  env = process.env,
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  readyTimeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
  spawn = defaultSpawn,
  systemRoot = "",
  targetRoot = "",
  terminalEnv = {},
  toolHomeSource = "",
  WebSocketImpl = WebSocket,
  workdir = "",
  runtimeInstanceId = "",
  runtimeDir = codexAppServerRuntimeDir({
    env,
    runtimeInstanceId,
    targetRoot,
    workdir
  }),
  useDocker = true
} = {}) {
  await ensureWritablePrivateDirectory(runtimeDir);
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  const normalizedImage = normalizeAgentText(image || STUDIO_BASE_TOOLCHAIN_IMAGE);
  if (normalizedToolHomeSource) {
    await ensurePrivateDirectory(normalizedToolHomeSource);
  }
  const resolvedAuthStateSignature = await currentCodexAuthStateSignature({
    authStateSignature,
    env,
    systemRoot
  });
  const socketPath = codexAppServerSocketPath(runtimeDir);
  assertCodexAppServerSocketPathSupported(socketPath);
  const endpoint = codexAppServerUnixEndpoint(socketPath);
  const containerEndpoint = codexAppServerContainerEndpoint();
  const logPath = codexAppServerLogPath(runtimeDir);
  const processCwd = codexAppServerProcessCwd({
    targetRoot,
    workdir
  });
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  const spawnEnv = useDocker
    ? env
    : {
        ...env,
        ...normalizedTerminalEnv,
        PATH: prependPathEntry(
          normalizedTerminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV],
          normalizedTerminalEnv.PATH || env.PATH || process.env.PATH
        ),
        ...(normalizedToolHomeSource
          ? {
              HOME: normalizedToolHomeSource,
              NPM_CONFIG_PREFIX: path.join(normalizedToolHomeSource, ".local")
            }
          : {})
      };
  await rm(socketPath, {
    force: true
  });
  const logHandle = await open(logPath, "w", 0o600);
  let child = null;
  try {
    const spawnCommand = useDocker ? "docker" : codexCommand;
    const spawnArgs = useDocker
      ? codexAppServerDockerArgs({
          containerEndpoint,
          env,
          image: normalizedImage,
          runtimeDir,
          targetRoot,
          terminalEnv: normalizedTerminalEnv,
          toolHomeSource: normalizedToolHomeSource,
          workdir
        })
      : [
          "app-server",
          "--listen",
          endpoint
        ];
    child = spawn(spawnCommand, spawnArgs, {
      detached: true,
      env: spawnEnv,
      stdio: ["ignore", logHandle.fd, logHandle.fd]
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };
      child.once?.("spawn", () => settle(resolve));
      child.once?.("error", (error) => settle(reject, error));
      setImmediate(() => settle(resolve));
    });
    child.unref?.();
  } finally {
    await logHandle.close().catch(() => null);
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

  const attachmentMount = codexAttachmentMount({
    env
  });
  return {
    attachmentContainerRoot: attachmentMount.target,
    attachmentHostRoot: attachmentMount.source,
    authStateSignature: resolvedAuthStateSignature,
    containerEndpoint,
    containerRuntimeDir: CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR,
    containerSocketPath: codexAppServerContainerSocketPath(),
    endpoint,
    healthz: "",
    image: normalizedImage,
    logPath,
    pid: Number.isSafeInteger(child?.pid) ? child.pid : null,
    processCwd,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
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
      await removeCodexAppServerContainer({
        ...runtimeOptions,
        runtimeDir
      });
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
  target = "host",
  threadId = ""
} = {}) {
  const normalizedEndpoint = codexAppServerEndpointForTarget(endpoint, {
    target
  });
  const resolvedCodexCommand = normalizeAgentText(codexCommand) ||
    (target === "container" ? STUDIO_MANAGED_CODEX_COMMAND : "codex");
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedEndpoint) {
    throw new Error("Codex app-server endpoint is required for the native CLI command.");
  }
  if (!normalizedThreadId) {
    throw new Error("Codex thread id is required for the native CLI command.");
  }
  const argv = [
    resolvedCodexCommand,
    ...(target === "container" ? ["-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG] : []),
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
    this.options = options;
    this.client = null;
    this.connectionGeneration = 0;
    this.runtime = null;
  }

  async ensureRuntime() {
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
    this.client = new CodexAppServerJsonRpcClient({
      endpoint: runtime.endpoint,
      requestTimeoutMs: this.options.requestTimeoutMs,
      WebSocketImpl: this.options.WebSocketImpl
    });
    await this.client.connect();
    const initializeResult = await this.runRequest(
      () => this.client.initialize(this.options.initialize),
      "codex-app-server-initialize"
    );
    this.connectionGeneration += 1;
    return {
      initializeResult,
      runtime
    };
  }

  currentConnectionGeneration() {
    return this.connectionGeneration;
  }

  async activeClient() {
    if (this.client?.isOpen?.()) {
      return this.client;
    }
    await this.connect();
    return this.client;
  }

  async ensureAvailable() {
    await this.preflightAuth("codex-app-server-ensure-available");
    const client = await this.activeClient();
    return {
      client,
      ok: true,
      runtime: this.runtime
    };
  }

  subscribe(callback) {
    if (!this.client) {
      throw new Error("Codex app-server provider is not connected.");
    }
    return this.client.subscribe(callback);
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
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_TRANSPORT,
  CODEX_APP_SERVER_CONTAINER_RUNTIME_DIR,
  CodexAppServerAgentProvider,
  CodexAppServerJsonRpcClient,
  assertCodexAuthPreflightReady,
  codexAppServerContainerEndpoint,
  codexAppServerContainerSocketPath,
  codexAppServerEndpointForTarget,
  codexAppServerMetadataIsLive,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexCliResumeCommand,
  codexProviderHomesRootForOptions,
  codexTextInput,
  codexTurnInput,
  createCodexAppServerAgentProvider,
  ensureCodexAppServerRuntime,
  startCodexAppServerProcess,
  stopCodexAppServerRuntime
};
