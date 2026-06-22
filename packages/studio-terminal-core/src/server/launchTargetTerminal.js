import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  gitToolchainMountArgs
} from "./gitToolchainMounts.js";
import {
  dockerEnvNameArgs,
  writeDockerEnvFileSync
} from "./dockerRuntime.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  shellQuote,
  stableHash
} from "./shellCommands.js";
import {
  STUDIO_DAEMON_ID_LABEL,
  VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  studioDaemonDockerLabels,
  studioDaemonId,
  studioDockerLabel
} from "./studioRuntimeIdentity.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  normalizePreviewAuthKind,
  previewAuthEnvironment,
  previewAuthProfilePath
} from "@local/vibe64-core/server/previewAuth";
import {
  sessionWorktreePath
} from "@local/vibe64-core/server/sessionWorktreePath";
import {
  currentProcessIsDockerContainer,
  runtimeDockerNamePrefix,
  runtimeTargetName,
  targetRuntimeNetworkDockerArgs
} from "./runtimeContainers.js";

const execFileAsync = promisify(execFile);
const DEFAULT_WEB_LAUNCH_TARGET_PORT = 4100;
const LAUNCH_READY_MARKER_PREFIX = "VIBE64_LAUNCH_READY_V1";
const reservedWebLaunchTargetPorts = new Set();
const LAUNCH_TARGET_CONTAINER_KIND_LABEL = studioDockerLabel("kind", "launch-target-terminal");
const LAUNCH_TARGET_SESSION_LABEL = studioDockerLabel("session");
const LAUNCH_TARGET_TERMINAL_LABEL = studioDockerLabel("terminal");
const LAUNCH_TARGET_TARGET_LABEL = studioDockerLabel("target");
const SECRET_LAUNCH_ENV_PATTERN = /(PASSWORD|PASS|TOKEN|SECRET|KEY|CREDENTIAL|PWD)/iu;

function normalizePort(value, fallback = DEFAULT_WEB_LAUNCH_TARGET_PORT) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : fallback;
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function dockerHasPublishedPort(port) {
  try {
    const result = await execFileAsync("docker", [
      "ps",
      "--filter",
      `publish=${port}`,
      "--format",
      "{{.ID}}"
    ], {
      maxBuffer: 1024 * 1024,
      timeout: 3000
    });
    return Boolean(String(result.stdout || "").trim());
  } catch {
    return false;
  }
}

function parseLaunchTargetContainerRows(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => {
      const [id = "", terminalId = ""] = line.split("\t");
      const normalizedId = normalizeText(id);
      if (!normalizedId) {
        return null;
      }
      return {
        id: normalizedId,
        terminalId: normalizeText(terminalId)
      };
    })
    .filter(Boolean);
}

function dockerLabelFilter(label = "") {
  const normalized = normalizeText(label);
  return normalized ? ["--filter", `label=${normalized}`] : [];
}

function dockerContainerRemovalAlreadySettled(error = {}) {
  return /No such container|removal of container .* is already in progress/iu.test(String(error?.stderr || error?.message || error || ""));
}

async function listLaunchTargetContainers({
  daemonId = studioDaemonId(),
  execFileImpl = execFileAsync,
  sessionId = "",
  targetRoot = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const targetName = runtimeTargetName(targetRoot);
  if (!normalizedSessionId || !targetName) {
    return [];
  }
  const result = await execFileImpl("docker", [
    "ps",
    "-a",
    ...dockerLabelFilter(LAUNCH_TARGET_CONTAINER_KIND_LABEL),
    ...dockerLabelFilter(`${LAUNCH_TARGET_SESSION_LABEL}=${normalizedSessionId}`),
    ...dockerLabelFilter(`${LAUNCH_TARGET_TARGET_LABEL}=${targetName}`),
    ...dockerLabelFilter(daemonId ? `${STUDIO_DAEMON_ID_LABEL}=${daemonId}` : ""),
    "--format",
    `{{.ID}}\t{{.Label "${LAUNCH_TARGET_TERMINAL_LABEL}"}}`
  ], {
    maxBuffer: 1024 * 1024,
    timeout: 10000
  });
  return parseLaunchTargetContainerRows(result.stdout);
}

async function removeLaunchTargetContainers({
  daemonId = studioDaemonId(),
  exceptTerminalIds = [],
  execFileImpl = execFileAsync,
  sessionId = "",
  targetRoot = ""
} = {}) {
  const preservedTerminalIds = new Set((Array.isArray(exceptTerminalIds) ? exceptTerminalIds : [])
    .map(normalizeText)
    .filter(Boolean));
  const containerIds = (await listLaunchTargetContainers({
    daemonId,
    execFileImpl,
    sessionId,
    targetRoot
  }))
    .filter((container) => !preservedTerminalIds.has(container.terminalId))
    .map((container) => container.id);
  if (!containerIds.length) {
    return [];
  }

  try {
    await execFileImpl("docker", ["rm", "-f", ...containerIds], {
      maxBuffer: 1024 * 1024,
      timeout: 30000
    });
    return containerIds;
  } catch (error) {
    if (containerIds.length === 1 && dockerContainerRemovalAlreadySettled(error)) {
      return containerIds;
    }
  }

  const removedContainerIds = [];
  for (const containerId of containerIds) {
    try {
      await execFileImpl("docker", ["rm", "-f", containerId], {
        maxBuffer: 1024 * 1024,
        timeout: 30000
      });
      removedContainerIds.push(containerId);
    } catch (error) {
      if (!dockerContainerRemovalAlreadySettled(error)) {
        throw error;
      }
      removedContainerIds.push(containerId);
    }
  }
  return removedContainerIds;
}

async function launchTargetPortIsAvailable(port) {
  const [localAvailable, dockerPublished] = await Promise.all([
    canListenOnPort(port),
    dockerHasPublishedPort(port)
  ]);
  return localAvailable && !dockerPublished;
}

async function findAvailableWebLaunchTargetPort(preferredPort = DEFAULT_WEB_LAUNCH_TARGET_PORT) {
  const startPort = normalizePort(preferredPort);
  for (let port = startPort; port <= 65535; port += 1) {
    if (reservedWebLaunchTargetPorts.has(port)) {
      continue;
    }
    if (await launchTargetPortIsAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No localhost port is available at or after ${startPort}.`);
}

async function reserveAvailableWebLaunchTargetPort(preferredPort = DEFAULT_WEB_LAUNCH_TARGET_PORT) {
  const startPort = normalizePort(preferredPort);
  for (let port = startPort; port <= 65535; port += 1) {
    if (reservedWebLaunchTargetPorts.has(port)) {
      continue;
    }
    if (!await launchTargetPortIsAvailable(port)) {
      continue;
    }
    if (reservedWebLaunchTargetPorts.has(port)) {
      continue;
    }
    let released = false;
    reservedWebLaunchTargetPorts.add(port);
    return {
      port,
      release() {
        if (released) {
          return;
        }
        released = true;
        reservedWebLaunchTargetPorts.delete(port);
      }
    };
  }
  throw new Error(`No localhost port is available at or after ${startPort}.`);
}

function normalizeUrlPath(value = "/") {
  const normalized = normalizeText(value) || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeLaunchCommands({
  command = "",
  commands = []
} = {}) {
  const entries = Array.isArray(commands) && commands.length > 0
    ? commands
    : [
        {
          command,
          networkEnv: true
        }
      ];

  return entries
    .map((entry) => {
      const normalizedCommand = normalizeText(typeof entry === "string" ? entry : entry?.command);
      if (!normalizedCommand) {
        return null;
      }
      return {
        command: normalizedCommand,
        label: normalizeText(entry?.label),
        networkEnv: entry?.networkEnv !== false
      };
    })
    .filter(Boolean);
}

function launchReadinessMarker({
  adapterId = "generic",
  launchTargetId = "",
  port = "",
  sessionId = ""
} = {}) {
  const markerId = stableHash([
    adapterId,
    launchTargetId,
    port,
    sessionId
  ].join(":"));
  return `[[${LAUNCH_READY_MARKER_PREFIX}:${markerId}]]`;
}

function tcpReadinessProbeCommand({
  host = "127.0.0.1",
  marker = "",
  port,
  timeoutSeconds = 90
} = {}) {
  const script = [
    "const net = require('node:net');",
    "const host = process.argv[1];",
    "const port = Number(process.argv[2]);",
    "const marker = process.argv[3];",
    "const timeoutMs = Number(process.argv[4]) * 1000;",
    "const deadline = Date.now() + timeoutMs;",
    "function retry() {",
    "  if (Date.now() >= deadline) {",
    "    console.error(`[studio] Launch target did not become ready on ${host}:${port}.`);",
    "    process.exit(1);",
    "  }",
    "  setTimeout(probe, 250);",
    "}",
    "function probe() {",
    "  const socket = net.connect({ host, port });",
    "  socket.setTimeout(1000);",
    "  socket.once('connect', () => { socket.end(); console.log(marker); });",
    "  socket.once('error', retry);",
    "  socket.once('timeout', () => { socket.destroy(); retry(); });",
    "}",
    "probe();"
  ].join("\n");
  return [
    "node",
    "-e",
    shellQuote(script),
    shellQuote(host),
    shellQuote(String(port)),
    shellQuote(marker),
    shellQuote(String(timeoutSeconds))
  ].join(" ");
}

function httpReadinessProbeCommand({
  href = "",
  marker = "",
  timeoutSeconds = 90
} = {}) {
  const script = [
    "const href = process.argv[1];",
    "const marker = process.argv[2];",
    "const timeoutMs = Number(process.argv[3]) * 1000;",
    "const deadline = Date.now() + timeoutMs;",
    "async function retry() {",
    "  if (Date.now() >= deadline) {",
    "    console.error(`[studio] Launch target did not become ready at ${href}.`);",
    "    process.exit(1);",
    "  }",
    "  await new Promise((resolve) => setTimeout(resolve, 250));",
    "  await probe();",
    "}",
    "async function probe() {",
    "  const controller = new AbortController();",
    "  const timeout = setTimeout(() => controller.abort(), 1000);",
    "  try {",
    "    const response = await fetch(href, {",
    "      redirect: 'manual',",
    "      signal: controller.signal",
    "    });",
    "    clearTimeout(timeout);",
    "    if (response.status < 500) {",
    "      console.log(marker);",
    "      return;",
    "    }",
    "  } catch {",
    "    clearTimeout(timeout);",
    "  }",
    "  await retry();",
    "}",
    "probe();"
  ].join("\n");
  return [
    "node",
    "-e",
    shellQuote(script),
    shellQuote(href),
    shellQuote(marker),
    shellQuote(String(timeoutSeconds))
  ].join(" ");
}

function commandWithHttpReadiness({
  command = "",
  href = "",
  marker = "",
  timeoutSeconds = 90
} = {}) {
  return [
    "{",
    "  set -e",
    `  (${command}) &`,
    "  vibe64_launch_pid=$!",
    "  cleanup_vibe64_launch() {",
    "    kill \"$vibe64_launch_pid\" 2>/dev/null || true",
    "  }",
    "  trap cleanup_vibe64_launch EXIT INT TERM",
    `  ${httpReadinessProbeCommand({
      href,
      marker,
      timeoutSeconds
    })}`,
    "  wait \"$vibe64_launch_pid\"",
    "}"
  ].join("\n");
}

function addReadinessMarkerToLaunchCommands(commands = [], {
  href = "",
  marker = "",
  waitForReadiness = true
} = {}) {
  if (!waitForReadiness || !marker || !href) {
    return {
      commands,
      readinessMarker: ""
    };
  }
  const serverCommandIndex = commands.findLastIndex((entry) => entry.networkEnv);
  if (serverCommandIndex < 0) {
    return {
      commands,
      readinessMarker: ""
    };
  }
  return {
    commands: commands.map((entry, index) => index === serverCommandIndex
      ? {
          ...entry,
          command: commandWithHttpReadiness({
            command: entry.command,
            href,
            marker
          })
        }
      : entry),
    readinessMarker: marker
  };
}

function launchCommandLines(commands = []) {
  return commands.flatMap((entry) => [
    entry.label ? `printf '\\n[studio] %s\\n' ${shellQuote(entry.label)}` : "",
    entry.networkEnv
      ? `printf '\\n[studio] $ HOST=%s PORT=%s %s\\n\\n' "$HOST" "$PORT" ${shellQuote(entry.command)}`
      : `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(entry.command)}`,
    entry.command
  ].filter(Boolean));
}

function launchActionLines(actions = []) {
  return actions.map((action) => {
    if (action?.kind !== "url" || !normalizeText(action.href)) {
      return "";
    }
    return `printf '\\n[studio] action:%s\\n' ${shellQuote(action.href)}`;
  }).filter(Boolean);
}

function webLaunchTargetStartupScript({
  commands = [],
  home = "/tmp/studio-home",
  launchActions = [],
  port
} = {}) {
  const homePath = normalizeText(home) || "/tmp/studio-home";
  const runCommand = [
    "set -e",
    "export HOST=0.0.0.0",
    `export PORT=${shellQuote(String(port))}`,
    ...launchActionLines(launchActions),
    ...launchCommandLines(commands)
  ].join("\n");

  return [
    "set -e",
    `mkdir -p ${shellQuote(homePath)}`,
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${VIBE64_HOST_UID:-}\" ] && [ -n \"${VIBE64_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    `  chown -R "$VIBE64_HOST_UID:$VIBE64_HOST_GID" ${shellQuote(homePath)}`,
    "  if [ -n \"${CODEX_HOME:-}\" ]; then",
    "    mkdir -p \"$CODEX_HOME\"",
    "    chown -R \"$VIBE64_HOST_UID:$VIBE64_HOST_GID\" \"$CODEX_HOME\"",
    "  fi",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$VIBE64_HOST_UID" --regid "$VIBE64_HOST_GID" $docker_group_args env HOME=${shellQuote(homePath)} bash -lc ${shellQuote(runCommand)}`,
    "fi",
    "if [ -n \"${CODEX_HOME:-}\" ]; then",
    "  mkdir -p \"$CODEX_HOME\"",
    "fi",
    `exec env HOME=${shellQuote(homePath)} bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function hostDockerArgs(enabled = false) {
  if (!enabled) {
    return [];
  }
  const args = [
    "-e",
    "DOCKER_HOST=unix:///var/run/docker.sock",
    "-e",
    `${VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV}=1`,
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock"
  ];
  const userArgs = hostUserDockerArgs();
  if (userArgs.length === 2) {
    args.push("--user", userArgs[1]);
  }
  try {
    const socketStats = statSync("/var/run/docker.sock");
    args.push("--group-add", String(socketStats.gid));
  } catch {
    // Docker readiness is reported by the terminal command itself.
  }
  return args;
}

function previewAuthDockerArgs({
  envFilePath = "",
  kind = "",
  profilePath = "",
  projectScope = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  const env = previewAuthEnvironment({
    kind,
    projectScope,
    sessionId,
    targetHref,
    targetRoot,
    terminalSessionId
  });
  const entries = Object.entries(env);
  const args = [];
  if (normalizePreviewAuthKind(kind) && profilePath) {
    const profileDir = path.dirname(path.resolve(profilePath));
    args.push("-v", `${profileDir}:${profileDir}`);
    entries.push(["VIBE64_PREVIEW_AUTH_PROFILE_FILE", profilePath]);
  }
  if (entries.length > 0 && !normalizeText(envFilePath)) {
    throw new Error("Preview auth Docker environment requires a terminal-scoped env-file path.");
  }
  args.push(...writeDockerEnvFileSync(envFilePath, Object.fromEntries(entries)));
  return args;
}

function normalizeLaunchEnv(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    String(key || "").trim(),
    String(value ?? "")
  ]).filter(([key]) => Boolean(key)));
}

function launchEnvDockerArgs(env = {}) {
  return dockerEnvNameArgs(normalizeLaunchEnv(env));
}

function ensurePreviewAuthProfilePath(profilePath = "") {
  const normalizedPath = normalizeText(profilePath);
  if (!normalizedPath) {
    return "";
  }
  const profileDir = path.dirname(normalizedPath);
  mkdirSync(profileDir, {
    recursive: true
  });
  // Launch containers can run with a remapped user. Keep only the terminal-scoped
  // runtime directory writable; runtime-private parent directories still gate access.
  chmodSync(profileDir, 0o777);
  return normalizedPath;
}

function redactLaunchTargetTerminalArgs(args = []) {
  return (Array.isArray(args) ? args : []).map((arg) => {
    const text = String(arg || "");
    const separatorIndex = text.indexOf("=");
    if (separatorIndex > 0 && SECRET_LAUNCH_ENV_PATTERN.test(text.slice(0, separatorIndex))) {
      return `${text.slice(0, separatorIndex)}=(redacted)`;
    }
    return arg;
  });
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
  const normalizedWorkdir = String(workdir || "").trim();
  if (!normalizedWorkdir || pathInsideOrEqual(targetRoot, normalizedWorkdir)) {
    return [];
  }
  return [
    "-v",
    `${path.resolve(normalizedWorkdir)}:${path.resolve(normalizedWorkdir)}`
  ];
}

function launchHomePath({
  sessionRoot = "",
  terminalId = "",
  worktreePath = ""
} = {}) {
  const resolvedSessionRoot = normalizeText(sessionRoot)
    ? path.resolve(sessionRoot)
    : "";
  const resolvedWorktreePath = normalizeText(worktreePath)
    ? path.resolve(worktreePath)
    : "";
  const derivedSessionRoot = !resolvedSessionRoot && path.basename(resolvedWorktreePath) === "worktree"
    ? path.dirname(resolvedWorktreePath)
    : "";
  const root = resolvedSessionRoot || derivedSessionRoot;
  if (!root) {
    return "";
  }
  const safeTerminalId = normalizeText(terminalId)
    .replace(/[^a-z0-9_.-]+/giu, "-")
    .replace(/^-+|-+$/gu, "") || stableHash(terminalId || "launch");
  return path.join(root, "runtime", "launch-home", safeTerminalId);
}

function ensureLaunchHomePath(home = "") {
  const resolvedHome = normalizeText(home) ? path.resolve(home) : "";
  if (!resolvedHome) {
    return "";
  }
  mkdirSync(resolvedHome, {
    recursive: true
  });
  return resolvedHome;
}

function launchHomeDockerArgs(home = "") {
  const resolvedHome = normalizeText(home) ? path.resolve(home) : "";
  return resolvedHome
    ? [
        "-v",
        `${resolvedHome}:${resolvedHome}`
      ]
    : [];
}

function launchPreviewAuthEnvFilePath(launchHome = "") {
  const resolvedHome = normalizeText(launchHome) ? path.resolve(launchHome) : "";
  return resolvedHome ? path.join(resolvedHome, "preview-auth.env") : "";
}

function removeLaunchPreviewAuthEnvFile({
  session = {},
  terminalId = "",
  worktreePath = ""
} = {}) {
  const envFilePath = launchPreviewAuthEnvFilePath(launchHomePath({
    sessionRoot: session.sessionRoot || "",
    terminalId,
    worktreePath
  }));
  if (!envFilePath) {
    return;
  }
  rmSync(envFilePath, {
    force: true
  });
}

function launchContainerName({
  adapterId = "generic",
  sessionId = "",
  targetRoot = "",
  terminalId = ""
} = {}) {
  return [
    runtimeDockerNamePrefix(targetRoot),
    adapterId,
    "launch",
    sessionId,
    terminalId
  ].filter(Boolean).join("-");
}

function launchContainerNetworkAlias({
  adapterId = "generic",
  launchTargetId = "",
  sessionId = ""
} = {}) {
  return `vibe64-launch-${stableHash([
    adapterId,
    launchTargetId,
    sessionId
  ].join(":"))}`;
}

function networkAliasDockerArgs(aliases = []) {
  return [...new Set((Array.isArray(aliases) ? aliases : [])
    .map(normalizeText)
    .filter((alias) => /^vibe64-launch-[a-f0-9]{12}$/u.test(alias)))]
    .flatMap((alias) => ["--network-alias", alias]);
}

function launchTargetTerminalArgs({
  adapterId = "generic",
  containerName = "",
  env = {},
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  port,
  sessionId = "",
  startupCommands = [],
  launchActions = [],
  launchHome = "",
  networkAliases = [],
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  const resolvedLaunchHome = ensureLaunchHomePath(launchHome);
  const home = resolvedLaunchHome || "/tmp/studio-home";
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "vibe64.kind=launch-target-terminal",
    "--label",
    `vibe64.adapter=${adapterId}`,
    ...studioDaemonDockerLabels().flatMap((label) => ["--label", label]),
    "--label",
    `vibe64.session=${sessionId}`,
    "--label",
    `vibe64.terminal=${terminalId}`,
    "--label",
    `vibe64.target=${runtimeTargetName(targetRoot)}`,
    "-p",
    `127.0.0.1:${port}:${port}`,
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...workdirMountArgs({
      targetRoot,
      workdir
    }),
    ...launchHomeDockerArgs(resolvedLaunchHome),
    ...targetRuntimeNetworkDockerArgs(targetRoot),
    ...networkAliasDockerArgs(networkAliases),
    ...launchEnvDockerArgs(env),
    ...extraDockerArgs,
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    image,
    "bash",
    "-lc",
    webLaunchTargetStartupScript({
      commands: startupCommands,
      home,
      launchActions,
      port
    })
  ];
}

function normalizeOpenTarget({
  href = "",
  kind = "url",
  label = "Open browser"
} = {}) {
  return {
    href: normalizeText(href),
    kind: normalizeText(kind || "url"),
    label: normalizeText(label || "Open")
  };
}

async function createVibe64WebLaunchTargetTerminalSpec({
  adapterId = "generic",
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  launchTarget = {},
  preferredPort = DEFAULT_WEB_LAUNCH_TARGET_PORT,
  resolveLaunch = async () => ({}),
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = sessionWorktreePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running this launch target."
    };
  }

  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const portReservation = await reserveAvailableWebLaunchTargetPort(preferredPort);
  const releasePortReservation = portReservation.release;
  try {
    const port = portReservation.port;
    const generatedReadinessMarker = launchReadinessMarker({
      adapterId,
      launchTargetId: launchTarget.id,
      port,
      sessionId: session.sessionId || ""
    });
    const launch = await resolveLaunch({
      launchTarget,
      port,
      readinessMarker: generatedReadinessMarker,
      session,
      targetRoot: resolvedTargetRoot,
      worktreePath
    });
    const urlPath = normalizeUrlPath(launch.urlPath || "/");
    const targetUrl = `http://127.0.0.1:${port}${urlPath}`;
    const openTarget = normalizeOpenTarget({
      href: launch.openTarget?.href || targetUrl,
      kind: launch.openTarget?.kind || "url",
      label: launch.openTarget?.label || launch.openLabel || "Open browser"
    });
    const readiness = addReadinessMarkerToLaunchCommands(normalizeLaunchCommands(launch), {
      href: openTarget.href || targetUrl,
      marker: generatedReadinessMarker,
      waitForReadiness: launch.waitForReadiness !== false
    });
    const startupCommands = readiness.commands;
    if (startupCommands.length === 0) {
      releasePortReservation();
      return {
        ok: false,
        message: "Launch command is not configured."
      };
    }

    const workdir = normalizeText(launch.workdir) || worktreePath;
    const previewProxyAlias = launchContainerNetworkAlias({
      adapterId,
      launchTargetId: launchTarget.id,
      sessionId: session.sessionId || ""
    });
    const containerizedStudio = await currentProcessIsDockerContainer();
    const extraDockerArgs = [
      ...(Array.isArray(launch.extraDockerArgs) ? launch.extraDockerArgs : []),
      ...hostDockerArgs(launch.hostDocker === true)
    ];
    const previewAuthKind = normalizePreviewAuthKind(launch.previewAuth);
    const metadata = {
      adapterId,
      defaultDisplay: normalizeText(launch.defaultDisplay || launchTarget.defaultDisplay),
      launchTargetId: normalizeText(launchTarget.id),
      launchTargetLabel: normalizeText(launchTarget.label),
      openTarget,
      port,
      previewAuth: previewAuthKind,
      readinessMarker: readiness.readinessMarker,
      launchReady: !readiness.readinessMarker,
      ...(containerizedStudio ? { previewProxyTargetHref: `http://${previewProxyAlias}:${port}${urlPath}` } : {}),
      runRoot: workdir,
      scope: "session",
      sessionId: session.sessionId || "",
      sessionRoot: String(session.sessionRoot || ""),
      targetRoot: resolvedTargetRoot,
      targetUrl,
      urlPath,
      ...(launch.metadata || {})
    };

    return {
      args: ({ env, id }) => {
        const terminalLaunchHome = launchHomePath({
          sessionRoot: session.sessionRoot || "",
          terminalId: id,
          worktreePath
        });
        return launchTargetTerminalArgs({
          adapterId,
          containerName: launchContainerName({
            adapterId,
            sessionId: session.sessionId,
            targetRoot: resolvedTargetRoot,
            terminalId: id
          }),
          extraDockerArgs: [
            ...extraDockerArgs,
            ...previewAuthDockerArgs({
              envFilePath: launchPreviewAuthEnvFilePath(terminalLaunchHome),
              kind: previewAuthKind,
              profilePath: ensurePreviewAuthProfilePath(previewAuthProfilePath({
                sessionRoot: session.sessionRoot || "",
                targetRoot: resolvedTargetRoot,
                sessionId: session.sessionId || "",
                terminalSessionId: id
              })),
              projectScope: launch.projectScope,
              sessionId: session.sessionId || "",
              targetHref: targetUrl,
              targetRoot: resolvedTargetRoot,
              terminalSessionId: id
            })
          ],
          env,
          image,
          launchActions: openTarget.href
            ? [
                {
                  href: openTarget.href,
                  kind: "url",
                  label: openTarget.label
                }
              ]
            : [],
          launchHome: terminalLaunchHome,
          networkAliases: [previewProxyAlias],
          port,
          sessionId: session.sessionId,
          startupCommands,
          targetRoot: resolvedTargetRoot,
          terminalId: id,
          workdir
        });
      },
      command: "docker",
      commandPreview: ({ args }) => dockerCommand(redactLaunchTargetTerminalArgs(args)),
      cwd: resolvedTargetRoot,
      metadata,
      ok: true,
      onClose: (event = {}) => {
        removeLaunchPreviewAuthEnvFile({
          session,
          terminalId: event.id,
          worktreePath
        });
        releasePortReservation();
      },
      onStop: (event = {}) => {
        removeLaunchPreviewAuthEnvFile({
          session,
          terminalId: event.id,
          worktreePath
        });
        releasePortReservation();
      },
      readinessMarker: readiness.readinessMarker,
      releasePortReservation,
      reuseRunning: true
    };
  } catch (error) {
    releasePortReservation();
    throw error;
  }
}

export {
  DEFAULT_WEB_LAUNCH_TARGET_PORT,
  createVibe64WebLaunchTargetTerminalSpec,
  findAvailableWebLaunchTargetPort,
  listLaunchTargetContainers,
  removeLaunchTargetContainers,
  reserveAvailableWebLaunchTargetPort,
  commandWithHttpReadiness,
  httpReadinessProbeCommand,
  launchReadinessMarker,
  tcpReadinessProbeCommand,
  webLaunchTargetStartupScript
};
