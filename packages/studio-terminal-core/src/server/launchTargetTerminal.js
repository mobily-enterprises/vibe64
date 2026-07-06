import { chmodSync, mkdirSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";

import {
  shellQuote,
  stableHash
} from "./shellCommands.js";
import {
  studioUserStartupScript
} from "./studioToolHome.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  normalizePreviewAuthKind,
  previewAuthEnvironment,
  previewAuthProfilePath
} from "@local/vibe64-core/server/previewAuth";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  terminalNoGithubActorMetadata
} from "./terminalOwnership.js";

const DEFAULT_WEB_LAUNCH_TARGET_PORT = 4100;
const LAUNCH_READY_MARKER_PREFIX = "VIBE64_LAUNCH_READY_V1";
const reservedWebLaunchTargetPorts = new Set();

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

async function launchTargetPortIsAvailable(port) {
  return canListenOnPort(port);
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
        commandPreview: normalizeText(entry?.commandPreview || normalizedCommand),
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
      ? `printf '\\n[studio] $ HOST=%s PORT=%s %s\\n\\n' "$HOST" "$PORT" ${shellQuote(entry.commandPreview || entry.command)}`
      : `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(entry.commandPreview || entry.command)}`,
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
    "export HOST=127.0.0.1",
    `export PORT=${shellQuote(String(port))}`,
    ...launchActionLines(launchActions),
    ...launchCommandLines(commands)
  ].join("\n");

  return studioUserStartupScript(["bash", "-lc", runCommand]);
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

function ensurePreviewAuthProfilePath(profilePath = "") {
  const normalizedPath = normalizeText(profilePath);
  if (!normalizedPath) {
    return "";
  }
  const profileDir = path.dirname(normalizedPath);
  mkdirSync(profileDir, {
    recursive: true
  });
  chmodSync(profileDir, 0o700);
  return normalizedPath;
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  if (!rootPath || !candidatePath) {
    return false;
  }
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function launchTargetTerminalArgs({
  port,
  startupCommands = [],
  launchActions = []
} = {}) {
  return [
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
  launchTarget = {},
  preferredPort = DEFAULT_WEB_LAUNCH_TARGET_PORT,
  resolveLaunch = async () => ({}),
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the session clone before running this launch target."
    };
  }

  const resolvedWorktreeRoot = path.resolve(worktreePath);
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
      worktreePath: resolvedWorktreeRoot
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

    const workdir = path.resolve(normalizeText(launch.workdir) || resolvedWorktreeRoot);
    if (!pathInsideOrEqual(resolvedWorktreeRoot, workdir)) {
      releasePortReservation();
      return {
        ok: false,
        message: "Launch command workdir is outside the session source."
      };
    }
    const previewAuthKind = normalizePreviewAuthKind(launch.previewAuth);
    const agentTargetHref = targetUrl;
    const launchAgentEnv = {
      VIBE64_LAUNCH_AGENT_HOST: "127.0.0.1",
      VIBE64_LAUNCH_AGENT_HREF: agentTargetHref
    };
    const metadata = {
      adapterId,
      defaultDisplay: normalizeText(launch.defaultDisplay || launchTarget.defaultDisplay),
      launchTargetId: normalizeText(launchTarget.id),
      launchTargetLabel: normalizeText(launchTarget.label),
      agentTargetHref,
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
      ...(launch.metadata || {}),
      ...terminalNoGithubActorMetadata({
        ownerUserKey: "launch-target",
        reason: "launch-target"
      })
    };

    return {
      args: () => {
        return launchTargetTerminalArgs({
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
          startupCommands
        });
      },
      command: "bash",
      commandPreview: startupCommands.map((entry) => entry.commandPreview || entry.command).join("\n"),
      cwd: workdir,
      env: ({ id } = {}) => {
        const profilePath = ensurePreviewAuthProfilePath(previewAuthProfilePath({
          sessionRoot: session.sessionRoot || "",
          targetRoot: resolvedTargetRoot,
          sessionId: session.sessionId || "",
          terminalSessionId: id || ""
        }));
        return normalizeLaunchEnv({
          ...launchAgentEnv,
          ...previewAuthEnvironment({
            kind: previewAuthKind,
            projectScope: launch.projectScope,
            sessionId: session.sessionId || "",
            targetHref: targetUrl,
            targetRoot: resolvedTargetRoot,
            terminalSessionId: id || ""
          }),
          ...(profilePath ? { VIBE64_PREVIEW_AUTH_PROFILE_FILE: profilePath } : {}),
          ...(launch.env || {})
        });
      },
      metadata,
      ok: true,
      onClose: () => {
        releasePortReservation();
      },
      onStop: () => {
        releasePortReservation();
      },
      readinessMarker: readiness.readinessMarker,
      releasePortReservation,
      restartOnChange: launch.restartOnChange || null,
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
  reserveAvailableWebLaunchTargetPort,
  commandWithHttpReadiness,
  httpReadinessProbeCommand,
  launchReadinessMarker,
  tcpReadinessProbeCommand,
  webLaunchTargetStartupScript
};
