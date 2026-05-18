import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

import {
  AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  STUDIO_DAEMON_PID_LABEL
} from "../../../studioRuntimeIdentity.js";
import { containerWorkspacePath, removeDockerContainer } from "../../../containerRuntime.js";
import { gitToolchainMountArgs } from "../../../gitToolchainMounts.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  shellQuote,
  stableHash
} from "../../../shellCommands.js";
import { JSKIT_TOOLCHAIN_IMAGE } from "./toolchainIdentity.js";
import {
  jskitDatabaseDockerArgs,
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";

const execFileAsync = promisify(execFile);
const DEFAULT_REVIEW_BUILD_COMMAND = "npm run build";
const DEFAULT_REVIEW_SERVER_COMMAND = "npm run server";
const DEFAULT_REVIEW_PORT = 4100;
const REVIEW_COMMAND_CONFIG = ".jskit/config/testrun_command";
const REVIEW_PORT_CONFIG = ".jskit/config/server_port_for_user_review";
const REVIEW_HOST_DOCKER_CONFIG = ".jskit/config/devel_app_test_host_docker";

function enabledConfigValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

async function readOptionalConfigFile(root, relativePath, fallback = "") {
  try {
    const value = String(await readFile(path.join(root, relativePath), "utf8")).trim();
    return value || fallback;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw new Error(`Cannot read ${relativePath}: ${String(error?.message || error)}`);
  }
}

function normalizePort(value) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : DEFAULT_REVIEW_PORT;
}

async function resolveReviewConfig(worktreePath) {
  const [reviewCommand, hostDockerValue, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, REVIEW_COMMAND_CONFIG, ""),
    readOptionalConfigFile(worktreePath, REVIEW_HOST_DOCKER_CONFIG, ""),
    readOptionalConfigFile(worktreePath, REVIEW_PORT_CONFIG, String(DEFAULT_REVIEW_PORT))
  ]);
  const hostDocker = enabledConfigValue(hostDockerValue);
  if (reviewCommand) {
    return {
      buildCommand: "",
      commandSource: REVIEW_COMMAND_CONFIG,
      hostDocker,
      hostDockerSource: hostDocker ? REVIEW_HOST_DOCKER_CONFIG : "",
      preferredPort: normalizePort(portValue),
      serverCommand: "",
      testrunCommand: reviewCommand
    };
  }

  const [buildCommand, serverCommand] = await Promise.all([
    readOptionalConfigFile(worktreePath, "config/build_command", DEFAULT_REVIEW_BUILD_COMMAND),
    readOptionalConfigFile(worktreePath, "config/server_command", DEFAULT_REVIEW_SERVER_COMMAND)
  ]);
  return {
    buildCommand,
    commandSource: "fallback_split_commands",
    hostDocker,
    hostDockerSource: hostDocker ? REVIEW_HOST_DOCKER_CONFIG : "",
    preferredPort: normalizePort(portValue),
    serverCommand,
    testrunCommand: `${buildCommand};${serverCommand}`
  };
}

function targetDockerArgs(enabled = false) {
  if (!enabled) {
    return [];
  }
  const args = [
    "-e",
    "DOCKER_HOST=unix:///var/run/docker.sock",
    "-e",
    `${AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP_ENV}=1`,
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

async function reviewPortIsAvailable(port) {
  const [localAvailable, dockerPublished] = await Promise.all([
    canListenOnPort(port),
    dockerHasPublishedPort(port)
  ]);
  return localAvailable && !dockerPublished;
}

async function findAvailableReviewPort(preferredPort) {
  const startPort = normalizePort(preferredPort);
  for (let port = startPort; port <= 65535; port += 1) {
    if (await reviewPortIsAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No localhost port is available at or after ${startPort}.`);
}

async function defaultAppPath(worktreePath) {
  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot: worktreePath
    });
    const surfaceDefaultId = String(appConfig?.surfaceDefaultId || "").trim().replace(/^\/+/u, "");
    return surfaceDefaultId ? `/${surfaceDefaultId}` : "/";
  } catch {
    return "/";
  }
}

function reviewStartupScript({
  port,
  testrunCommand
}) {
  const runCommand = [
    "set -e",
    "export HOST=0.0.0.0",
    `export PORT=${shellQuote(String(port))}`,
    `printf '\\n[studio] $ HOST=%s PORT=%s %s\\n\\n' "$HOST" "$PORT" ${shellQuote(testrunCommand)}`,
    testrunCommand
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home /tmp/npm-cache",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${AI_STUDIO_HOST_UID:-}\" ] && [ -n \"${AI_STUDIO_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$AI_STUDIO_HOST_UID:$AI_STUDIO_HOST_GID\" /tmp/studio-home /tmp/npm-cache",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$AI_STUDIO_HOST_UID" --regid "$AI_STUDIO_HOST_GID" $docker_group_args env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function reviewContainerName({
  sessionId = "",
  terminalId = ""
} = {}) {
  return `ai-studio-app-review-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function reviewTerminalArgs({
  containerName = "",
  hostDocker = false,
  port,
  sessionId = "",
  targetRoot = "",
  terminalId = "",
  testrunCommand = "",
  workdir = "",
  databaseHost = ""
} = {}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "ai-studio.kind=app-review-terminal",
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `ai-studio.session=${sessionId}`,
    "--label",
    `ai-studio.terminal=${terminalId}`,
    "--label",
    `ai-studio.target=${stableHash(targetRoot)}`,
    "-p",
    `127.0.0.1:${port}:${port}`,
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...jskitDatabaseDockerArgs(databaseHost),
    ...targetDockerArgs(hostDocker),
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    JSKIT_TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    reviewStartupScript({
      port,
      testrunCommand
    })
  ];
}

async function createJskitAppReviewTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running the app."
    };
  }
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  if (!containerWorkspacePath(resolvedTargetRoot, worktreePath)) {
    return {
      ok: false,
      message: "The session worktree is outside the target root."
    };
  }

  const config = await resolveReviewConfig(worktreePath);
  const port = await findAvailableReviewPort(config.preferredPort);
  const [urlPath, databaseHost] = await Promise.all([
    defaultAppPath(worktreePath),
    readDatabaseHostFromDotEnv(worktreePath)
  ]);
  const appUrl = `http://127.0.0.1:${port}${urlPath}`;
  const metadata = {
    appUrl,
    buildCommand: config.buildCommand,
    commandSource: config.commandSource,
    databaseHost,
    hostDocker: config.hostDocker,
    hostDockerSource: config.hostDockerSource,
    port,
    runRoot: worktreePath,
    scope: "session",
    serverCommand: config.serverCommand,
    sessionId: session.sessionId || "",
    testrunCommand: config.testrunCommand,
    urlPath
  };

  return {
    args: ({ id }) => reviewTerminalArgs({
      containerName: reviewContainerName({
        sessionId: session.sessionId,
        terminalId: id
      }),
      hostDocker: config.hostDocker,
      port,
      sessionId: session.sessionId,
      targetRoot: resolvedTargetRoot,
      terminalId: id,
      testrunCommand: config.testrunCommand,
      workdir: worktreePath,
      databaseHost
    }),
    command: "docker",
    commandPreview: ({ args }) => dockerCommand(args),
    cwd: resolvedTargetRoot,
    metadata,
    ok: true,
    onClose: async ({ id }) => {
      await removeDockerContainer(reviewContainerName({
        sessionId: session.sessionId,
        terminalId: id
      }));
    },
    reuseRunning: true
  };
}

export {
  createJskitAppReviewTerminalSpec,
  REVIEW_COMMAND_CONFIG,
  REVIEW_HOST_DOCKER_CONFIG,
  REVIEW_PORT_CONFIG
};
