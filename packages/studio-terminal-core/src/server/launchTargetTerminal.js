import { chmodSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";

import {
  shellQuote,
  stableHash
} from "@local/vibe64-execution/server";
import {
  studioUserStartupScript
} from "./studioToolHome.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import {
  APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
  createPreviewAuthSecret,
  normalizePreviewIdentityCommandCapability,
  normalizePreviewAuthKind,
  previewAuthEnvironment,
  previewAuthRequiresIdentitySecret,
  previewAuthProfilePath,
  previewAuthSecretPath,
  previewAuthUsesProfile
} from "@local/vibe64-core/server/previewAuth";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  terminalNoGithubActorMetadata
} from "./terminalOwnership.js";

const DEFAULT_WEB_LAUNCH_TARGET_PORT = 4100;
const WEB_LAUNCH_READINESS_TIMEOUT_SECONDS = 300;
const LAUNCH_READY_MARKER_PREFIX = "VIBE64_LAUNCH_READY_V1";
const PREVIEW_AUTH_SECRET_HASH_PLACEHOLDER = "0".repeat(64);
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

function normalizeLaunchRuntimes(values = []) {
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    const runtime = normalizeText(value);
    if (runtime && !normalized.includes(runtime)) {
      normalized.push(runtime);
    }
  }
  return normalized;
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
  launchTargetId = "",
  port = "",
  sessionId = ""
} = {}) {
  const markerId = stableHash([
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
  timeoutSeconds = WEB_LAUNCH_READINESS_TIMEOUT_SECONDS
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
  expectedStatus = 200,
  href = "",
  marker = "",
  method = "GET",
  timeoutSeconds = WEB_LAUNCH_READINESS_TIMEOUT_SECONDS
} = {}) {
  const script = [
    "const href = process.argv[1];",
    "const marker = process.argv[2];",
    "const timeoutMs = Number(process.argv[3]) * 1000;",
    "const method = process.argv[4];",
    "const expectedStatus = Number(process.argv[5]);",
    "const deadline = Date.now() + timeoutMs;",
    "const statusFile = process.env.VIBE64_READINESS_STATUS_FILE || '';",
    "const launchPid = Number(process.env.VIBE64_READINESS_LAUNCH_PID || 0);",
    "function finish(status) {",
    "  if (statusFile) {",
    "    require('node:fs').writeFileSync(statusFile, `${status}\\n`, { encoding: 'utf8' });",
    "  }",
    "  if (status !== 0 && Number.isInteger(launchPid) && launchPid > 1) {",
    "    try { process.kill(launchPid, 'SIGTERM'); } catch {}",
    "  }",
    "  process.exit(status);",
    "}",
    "async function retry() {",
    "  if (Date.now() >= deadline) {",
    "    console.error(`[studio] Launch target did not become ready: ${method} ${href} did not return ${expectedStatus}.`);",
    "    finish(1);",
    "  }",
    "  await new Promise((resolve) => setTimeout(resolve, 250));",
    "  await probe();",
    "}",
    "async function probe() {",
    "  const controller = new AbortController();",
    "  const timeout = setTimeout(() => controller.abort(), 1000);",
    "  try {",
    "    const response = await fetch(href, {",
    "      method,",
    "      redirect: 'manual',",
    "      signal: controller.signal",
    "    });",
    "    clearTimeout(timeout);",
    "    if (response.status === expectedStatus) {",
    "      console.log(marker);",
    "      finish(0);",
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
    shellQuote(String(timeoutSeconds)),
    shellQuote(String(method)),
    shellQuote(String(expectedStatus))
  ].join(" ");
}

function commandWithHttpReadiness({
  command = "",
  expectedStatus = 200,
  href = "",
  marker = "",
  method = "GET",
  timeoutSeconds = WEB_LAUNCH_READINESS_TIMEOUT_SECONDS
} = {}) {
  return [
    "{",
    "  set -e",
    `  (${command}) &`,
    "  vibe64_launch_pid=$!",
    "  vibe64_readiness_pid=",
    "  vibe64_readiness_status_file=\"$(mktemp \"${TMPDIR:-/tmp}/vibe64-readiness.XXXXXX\")\"",
    "  cleanup_vibe64_launch() {",
    "    kill \"$vibe64_launch_pid\" 2>/dev/null || true",
    "    if [ -n \"$vibe64_readiness_pid\" ]; then",
    "      kill \"$vibe64_readiness_pid\" 2>/dev/null || true",
    "    fi",
    "    rm -f \"$vibe64_readiness_status_file\"",
    "  }",
    "  trap cleanup_vibe64_launch EXIT INT TERM",
    `  ( exec env VIBE64_READINESS_STATUS_FILE="$vibe64_readiness_status_file" VIBE64_READINESS_LAUNCH_PID="$vibe64_launch_pid" ${httpReadinessProbeCommand({
      expectedStatus,
      href,
      marker,
      method,
      timeoutSeconds
    })} ) &`,
    "  vibe64_readiness_pid=$!",
    "  set +e",
    "  wait \"$vibe64_launch_pid\"",
    "  vibe64_launch_status=$?",
    "  set -e",
    "  if [ ! -s \"$vibe64_readiness_status_file\" ]; then",
    "    kill \"$vibe64_readiness_pid\" 2>/dev/null || true",
    "    wait \"$vibe64_readiness_pid\" 2>/dev/null || true",
    "    vibe64_readiness_pid=",
    "    if [ \"$vibe64_launch_status\" -eq 0 ]; then",
    "      echo '[studio] Launch target exited before it became ready.' >&2",
    "      exit 1",
    "    fi",
    "    exit \"$vibe64_launch_status\"",
    "  fi",
    "  vibe64_readiness_status=",
    "  read -r vibe64_readiness_status <\"$vibe64_readiness_status_file\"",
    "  set +e",
    "  wait \"$vibe64_readiness_pid\"",
    "  set -e",
    "  vibe64_readiness_pid=",
    "  if [ \"$vibe64_readiness_status\" -ne 0 ]; then",
    "    exit \"$vibe64_readiness_status\"",
    "  fi",
    "  exit \"$vibe64_launch_status\"",
    "}"
  ].join("\n");
}

function addReadinessMarkerToLaunchCommands(commands = [], {
  expectedStatus = 200,
  href = "",
  marker = "",
  method = "GET",
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
            expectedStatus,
            href,
            marker,
            method
          })
        }
      : entry),
    readinessMarker: marker
  };
}

function normalizeHttpLaunchReadiness(readiness = null) {
  if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) {
    return null;
  }
  const kind = normalizeText(readiness.kind);
  const method = normalizeText(readiness.method).toUpperCase();
  const readinessPath = normalizeText(readiness.path);
  const status = Number(readiness.status);
  if (
    kind !== "http" ||
    method !== "GET" ||
    !readinessPath.startsWith("/") ||
    readinessPath.startsWith("//") ||
    /[\\?#]/u.test(readinessPath) ||
    !Number.isInteger(status) ||
    status < 200 ||
    status > 399
  ) {
    return null;
  }
  return {
    kind,
    method,
    path: readinessPath,
    status
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

function ensurePreviewAuthRuntimeFilePath(filePath = "") {
  const normalizedPath = normalizeText(filePath);
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

function writePreviewAuthSecret(secretPath = "", secret = "") {
  const normalizedPath = ensurePreviewAuthRuntimeFilePath(secretPath);
  if (!normalizedPath) {
    return "";
  }
  writeFileSync(normalizedPath, String(secret || ""), {
    flag: "wx",
    mode: 0o600
  });
  chmodSync(normalizedPath, 0o600);
  return normalizedPath;
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  if (!rootPath || !candidatePath) {
    return false;
  }
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
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
  launchTarget = {},
  preferredPort = DEFAULT_WEB_LAUNCH_TARGET_PORT,
  resolveLaunch = async () => ({}),
  session = {}
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the session clone before running this launch target."
    };
  }

  const resolvedWorktreeRoot = path.resolve(worktreePath);
  const portReservation = await reserveAvailableWebLaunchTargetPort(preferredPort);
  const releasePortReservation = portReservation.release;
  try {
    const port = portReservation.port;
    const generatedReadinessMarker = launchReadinessMarker({
      launchTargetId: launchTarget.id,
      port,
      sessionId: session.sessionId || ""
    });
    const launch = await resolveLaunch({
      launchTarget,
      port,
      readinessMarker: generatedReadinessMarker,
      session,
      sessionSourceRoot: resolvedWorktreeRoot,
      worktreePath: resolvedWorktreeRoot
    });
    const urlPath = normalizeUrlPath(launch.urlPath || "/");
    const targetUrl = `http://127.0.0.1:${port}${urlPath}`;
    const openTarget = normalizeOpenTarget({
      href: launch.openTarget?.href || targetUrl,
      kind: launch.openTarget?.kind || "url",
      label: launch.openTarget?.label || launch.openLabel || "Open browser"
    });
    const declaredReadiness = normalizeHttpLaunchReadiness(launch.readiness);
    if (launch.waitForReadiness !== false && !declaredReadiness) {
      releasePortReservation();
      return {
        ok: false,
        message: "Launch target must declare one valid HTTP readiness predicate."
      };
    }
    const readinessHref = declaredReadiness
      ? new URL(declaredReadiness.path, `http://127.0.0.1:${port}/`).href
      : "";
    const readiness = addReadinessMarkerToLaunchCommands(normalizeLaunchCommands(launch), {
      expectedStatus: declaredReadiness?.status,
      href: readinessHref,
      marker: generatedReadinessMarker,
      method: declaredReadiness?.method,
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
    const previewIdentity = normalizePreviewIdentityCommandCapability(launch.previewIdentity);
    if (previewIdentity && normalizePreviewAuthKind(launch.previewAuth)) {
      releasePortReservation();
      return {
        ok: false,
        message: "A launch target cannot combine a preview identity command with another preview authentication mode."
      };
    }
    if (previewIdentity) {
      const executablePath = path.resolve(resolvedWorktreeRoot, previewIdentity.command[0]);
      const executable = (() => {
        try {
          return lstatSync(executablePath);
        } catch {
          return null;
        }
      })();
      if (!executable?.isFile() || (executable.mode & 0o111) === 0) {
        releasePortReservation();
        return {
          ok: false,
          message: `Preview identity executable is missing or is not executable: ${previewIdentity.command[0]}.`
        };
      }
    }
    const previewAuthKind = previewIdentity
      ? APPLICATION_COMMAND_PREVIEW_AUTH_KIND
      : normalizePreviewAuthKind(launch.previewAuth);
    const previewAuthSecretValue = previewAuthRequiresIdentitySecret({ kind: previewAuthKind })
      ? createPreviewAuthSecret()
      : "";
    const projectScope = normalizeText(launch.projectScope) || currentProjectScopeKey();
    const agentTargetHref = targetUrl;
    const launchAgentEnv = {
      VIBE64_LAUNCH_AGENT_HOST: "127.0.0.1",
      VIBE64_LAUNCH_AGENT_HREF: agentTargetHref
    };
    const metadata = {
      ...(launch.metadata || {}),
      defaultDisplay: normalizeText(launch.defaultDisplay || launchTarget.defaultDisplay),
      launchTargetId: normalizeText(launchTarget.id),
      launchTargetLabel: normalizeText(launchTarget.label),
      agentTargetHref,
      openTarget,
      port,
      previewAuth: previewAuthKind,
      ...(previewIdentity ? {
        previewIdentity: {
          ...previewIdentity,
          sourceRoot: resolvedWorktreeRoot
        }
      } : {}),
      projectScope,
      ...(declaredReadiness ? { readiness: declaredReadiness } : {}),
      readinessMarker: readiness.readinessMarker,
      launchReady: !readiness.readinessMarker,
      runRoot: workdir,
      scope: "session",
      sessionId: session.sessionId || "",
      sessionRoot: String(session.sessionRoot || ""),
      sessionSourceRoot: resolvedWorktreeRoot,
      targetUrl,
      urlPath,
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
        const previewAuthSecret = previewAuthSecretValue && !id
          ? PREVIEW_AUTH_SECRET_HASH_PLACEHOLDER
          : previewAuthSecretValue;
        if (previewAuthSecretValue && id) {
          writePreviewAuthSecret(previewAuthSecretPath({
            sessionRoot: session.sessionRoot || "",
            terminalSessionId: id || ""
          }), previewAuthSecretValue);
        }
        const profilePath = previewAuthUsesProfile({ kind: previewAuthKind })
          ? ensurePreviewAuthRuntimeFilePath(previewAuthProfilePath({
              sessionRoot: session.sessionRoot || "",
              terminalSessionId: id || ""
            }))
          : "";
        return normalizeLaunchEnv({
          ...(launch.env || {}),
          ...launchAgentEnv,
          ...previewAuthEnvironment({
            kind: previewAuthKind,
            previewIdentity,
            projectScope,
            secret: previewAuthSecret,
            sessionSourceRoot: resolvedWorktreeRoot,
            sessionId: session.sessionId || "",
            targetHref: targetUrl,
            terminalSessionId: id || ""
          }),
          ...(profilePath ? { VIBE64_PREVIEW_AUTH_PROFILE_FILE: profilePath } : {})
        });
      },
      metadata,
      ok: true,
      allowedRoots: Array.isArray(launch.allowedRoots)
        ? launch.allowedRoots.map((root) => normalizeText(root)).filter(Boolean)
        : [],
      onClose: () => {
        releasePortReservation();
      },
      onStop: () => {
        releasePortReservation();
      },
      readinessMarker: readiness.readinessMarker,
      releasePortReservation,
      restartOnChange: launch.restartOnChange || null,
      runtimes: normalizeLaunchRuntimes(launch.runtimes),
      reuseRunning: true
    };
  } catch (error) {
    releasePortReservation();
    throw error;
  }
}

export {
  DEFAULT_WEB_LAUNCH_TARGET_PORT,
  WEB_LAUNCH_READINESS_TIMEOUT_SECONDS,
  createVibe64WebLaunchTargetTerminalSpec,
  findAvailableWebLaunchTargetPort,
  reserveAvailableWebLaunchTargetPort,
  commandWithHttpReadiness,
  httpReadinessProbeCommand,
  normalizeHttpLaunchReadiness,
  launchReadinessMarker,
  tcpReadinessProbeCommand,
  webLaunchTargetStartupScript
};
