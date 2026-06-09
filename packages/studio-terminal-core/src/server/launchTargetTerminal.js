import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  gitToolchainMountArgs
} from "./gitToolchainMounts.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  shellQuote,
  stableHash
} from "./shellCommands.js";
import {
  VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS
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
  runtimeNetworkTargetHash,
  targetRuntimeNetworkDockerArgs
} from "./runtimeContainers.js";

const execFileAsync = promisify(execFile);
const DEFAULT_WEB_LAUNCH_TARGET_PORT = 4100;
const LAUNCH_READY_MARKER_PREFIX = "VIBE64_LAUNCH_READY_V1";

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
    if (await launchTargetPortIsAvailable(port)) {
      return port;
    }
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

function commandWithTcpReadiness({
  command = "",
  host = "127.0.0.1",
  marker = "",
  port,
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
    `  ${tcpReadinessProbeCommand({
      host,
      marker,
      port,
      timeoutSeconds
    })}`,
    "  wait \"$vibe64_launch_pid\"",
    "}"
  ].join("\n");
}

function addReadinessMarkerToLaunchCommands(commands = [], {
  marker = "",
  port,
  waitForReadiness = true
} = {}) {
  if (!waitForReadiness || !marker) {
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
          command: commandWithTcpReadiness({
            command: entry.command,
            marker,
            port
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
  launchActions = [],
  port
} = {}) {
  const runCommand = [
    "set -e",
    "export HOST=0.0.0.0",
    `export PORT=${shellQuote(String(port))}`,
    ...launchActionLines(launchActions),
    ...launchCommandLines(commands)
  ].join("\n");

  return [
    "set -e",
    "mkdir -p /tmp/studio-home",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${VIBE64_HOST_UID:-}\" ] && [ -n \"${VIBE64_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$VIBE64_HOST_UID:$VIBE64_HOST_GID\" /tmp/studio-home",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$VIBE64_HOST_UID" --regid "$VIBE64_HOST_GID" $docker_group_args env HOME=/tmp/studio-home bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home bash -lc ${shellQuote(runCommand)}`
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
  if (entries.length > 0 && profilePath) {
    entries.push(["VIBE64_PREVIEW_AUTH_PROFILE_FILE", profilePath]);
  }
  return entries.flatMap(([name, value]) => [
    "-e",
    `${name}=${value}`
  ]);
}

function redactLaunchTargetTerminalArgs(args = []) {
  return (Array.isArray(args) ? args : []).map((arg) => {
    const text = String(arg || "");
    if (text.startsWith("AUTH_DEV_BYPASS_SECRET=")) {
      return "AUTH_DEV_BYPASS_SECRET=(redacted)";
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

function launchContainerName({
  adapterId = "generic",
  sessionId = "",
  terminalId = ""
} = {}) {
  return `vibe64-${adapterId}-launch-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function launchTargetTerminalArgs({
  adapterId = "generic",
  containerName = "",
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  port,
  sessionId = "",
  startupCommands = [],
  launchActions = [],
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
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
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `vibe64.session=${sessionId}`,
    "--label",
    `vibe64.terminal=${terminalId}`,
    "--label",
    `vibe64.target=${runtimeNetworkTargetHash(targetRoot)}`,
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
    ...targetRuntimeNetworkDockerArgs(targetRoot),
    ...extraDockerArgs,
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    image,
    "bash",
    "-lc",
    webLaunchTargetStartupScript({
      commands: startupCommands,
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
  const port = await findAvailableWebLaunchTargetPort(preferredPort);
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
  const readiness = addReadinessMarkerToLaunchCommands(normalizeLaunchCommands(launch), {
    marker: generatedReadinessMarker,
    port,
    waitForReadiness: launch.waitForReadiness !== false
  });
  const startupCommands = readiness.commands;
  if (startupCommands.length === 0) {
    return {
      ok: false,
      message: "Launch command is not configured."
    };
  }

  const urlPath = normalizeUrlPath(launch.urlPath || "/");
  const targetUrl = `http://127.0.0.1:${port}${urlPath}`;
  const openTarget = normalizeOpenTarget({
    href: launch.openTarget?.href || targetUrl,
    kind: launch.openTarget?.kind || "url",
    label: launch.openTarget?.label || launch.openLabel || "Open browser"
  });
  const workdir = normalizeText(launch.workdir) || worktreePath;
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
    args: ({ id }) => launchTargetTerminalArgs({
      adapterId,
      containerName: launchContainerName({
        adapterId,
        sessionId: session.sessionId,
        terminalId: id
      }),
      extraDockerArgs: [
        ...extraDockerArgs,
        ...previewAuthDockerArgs({
          kind: previewAuthKind,
          profilePath: previewAuthProfilePath({
            sessionRoot: session.sessionRoot || "",
            targetRoot: resolvedTargetRoot,
            sessionId: session.sessionId || "",
            terminalSessionId: id
          }),
          projectScope: launch.projectScope,
          sessionId: session.sessionId || "",
          targetHref: targetUrl,
          targetRoot: resolvedTargetRoot,
          terminalSessionId: id
        })
      ],
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
      port,
      sessionId: session.sessionId,
      startupCommands,
      targetRoot: resolvedTargetRoot,
      terminalId: id,
      workdir
    }),
    command: "docker",
    commandPreview: ({ args }) => dockerCommand(redactLaunchTargetTerminalArgs(args)),
    cwd: resolvedTargetRoot,
    metadata,
    ok: true,
    readinessMarker: readiness.readinessMarker,
    reuseRunning: true
  };
}

export {
  DEFAULT_WEB_LAUNCH_TARGET_PORT,
  createVibe64WebLaunchTargetTerminalSpec,
  findAvailableWebLaunchTargetPort,
  commandWithTcpReadiness,
  launchReadinessMarker,
  tcpReadinessProbeCommand,
  webLaunchTargetStartupScript
};
