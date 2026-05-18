import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

import {
  createAiStudioAppReviewTerminalSpec
} from "../../appReviewTerminal.js";
import {
  createAiStudioLaunchTargetTerminalSpec
} from "../../launchTargetTerminal.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";
import {
  jskitDatabaseDockerArgsForTarget,
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";

const DEFAULT_REVIEW_BUILD_COMMAND = "npm run build";
const DEFAULT_REVIEW_SERVER_COMMAND = "npm run server";
const DEFAULT_DEV_SERVER_COMMAND = "npm run dev -- --host 0.0.0.0 --port \"$PORT\"";
const DEFAULT_REVIEW_PORT = 4100;
const DEV_SERVER_COMMAND_CONFIG = "config/dev_server_command";
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

async function readPackageJsonScripts(root) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return packageJson?.scripts && typeof packageJson.scripts === "object"
      ? packageJson.scripts
      : {};
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw new Error(`Cannot read package.json scripts: ${String(error?.message || error)}`);
  }
}

async function configFileHasValue(root, relativePath) {
  return Boolean(await readOptionalConfigFile(root, relativePath, ""));
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

async function resolveDevReviewConfig(worktreePath) {
  const [devCommand, hostDockerValue, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, DEV_SERVER_COMMAND_CONFIG, ""),
    readOptionalConfigFile(worktreePath, REVIEW_HOST_DOCKER_CONFIG, ""),
    readOptionalConfigFile(worktreePath, REVIEW_PORT_CONFIG, String(DEFAULT_REVIEW_PORT))
  ]);
  return {
    commandSource: devCommand ? DEV_SERVER_COMMAND_CONFIG : "package_json_dev_script",
    devCommand: devCommand || DEFAULT_DEV_SERVER_COMMAND,
    hostDocker: enabledConfigValue(hostDockerValue),
    hostDockerSource: enabledConfigValue(hostDockerValue) ? REVIEW_HOST_DOCKER_CONFIG : "",
    preferredPort: normalizePort(portValue)
  };
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

function jskitLaunchTarget(id, label) {
  return {
    id,
    label
  };
}

async function listJskitLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath) {
    return [];
  }

  const [
    scripts,
    hasTestrunCommand,
    hasBuildCommandConfig,
    hasServerCommandConfig,
    hasDevCommandConfig
  ] = await Promise.all([
    readPackageJsonScripts(worktreePath),
    configFileHasValue(worktreePath, REVIEW_COMMAND_CONFIG),
    configFileHasValue(worktreePath, "config/build_command"),
    configFileHasValue(worktreePath, "config/server_command"),
    configFileHasValue(worktreePath, DEV_SERVER_COMMAND_CONFIG)
  ]);

  const launchTargets = [];
  if (hasTestrunCommand || (hasBuildCommandConfig && hasServerCommandConfig) || (scripts.build && scripts.server)) {
    launchTargets.push(jskitLaunchTarget("built", "Build and run built version"));
  }
  if (hasDevCommandConfig || scripts.dev) {
    launchTargets.push(jskitLaunchTarget("dev", "Run dev version"));
  }
  return launchTargets;
}

async function createJskitReviewDescriptor({
  config,
  databaseHost = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  return {
    command: config.testrunCommand,
    extraDockerArgs: jskitDatabaseDockerArgsForTarget(databaseHost, targetRoot),
    hostDocker: config.hostDocker,
    metadata: {
      buildCommand: config.buildCommand,
      commandSource: config.commandSource,
      databaseHost,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      serverCommand: config.serverCommand,
      testrunCommand: config.testrunCommand
    },
    urlPath: await defaultAppPath(worktreePath)
  };
}

async function createJskitDevReviewDescriptor({
  config,
  databaseHost = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  return {
    command: config.devCommand,
    extraDockerArgs: jskitDatabaseDockerArgsForTarget(databaseHost, targetRoot),
    hostDocker: config.hostDocker,
    metadata: {
      commandSource: config.commandSource,
      databaseHost,
      devCommand: config.devCommand,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      mode: "dev"
    },
    urlPath: await defaultAppPath(worktreePath)
  };
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
  const [config, databaseHost] = await Promise.all([
    resolveReviewConfig(worktreePath),
    readDatabaseHostFromDotEnv(worktreePath)
  ]);
  const reviewTargetRoot = targetRoot || session.targetRoot || "";
  return createAiStudioAppReviewTerminalSpec({
    adapterId: "jskit",
    image: JSKIT_TOOLCHAIN_IMAGE,
    preferredPort: config.preferredPort,
    resolveReview: ({ worktreePath: reviewWorktreePath }) => createJskitReviewDescriptor({
      config,
      databaseHost,
      targetRoot: reviewTargetRoot,
      worktreePath: reviewWorktreePath
    }),
    session,
    targetRoot: reviewTargetRoot
  });
}

async function createJskitLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown JSKIT launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const launchTarget = context.launchTarget || jskitLaunchTarget(launchTargetId, launchTargetId);
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running the app."
    };
  }
  const availableLaunchTargets = await listJskitLaunchTargets({
    session
  });
  if (!availableLaunchTargets.some((availableTarget) => availableTarget.id === launchTargetId)) {
    return {
      ok: false,
      message: `JSKIT launch target ${launchTargetId} is not configured.`
    };
  }

  const reviewTargetRoot = targetRoot || session.targetRoot || "";
  const [databaseHost, config] = await Promise.all([
    readDatabaseHostFromDotEnv(worktreePath),
    launchTargetId === "dev"
      ? resolveDevReviewConfig(worktreePath)
      : resolveReviewConfig(worktreePath)
  ]);
  const descriptorFactory = launchTargetId === "dev"
    ? createJskitDevReviewDescriptor
    : createJskitReviewDescriptor;

  return createAiStudioLaunchTargetTerminalSpec({
    adapterId: "jskit",
    image: JSKIT_TOOLCHAIN_IMAGE,
    launchTarget,
    preferredPort: config.preferredPort,
    resolveLaunch: ({ worktreePath: reviewWorktreePath }) => descriptorFactory({
      config,
      databaseHost,
      targetRoot: reviewTargetRoot,
      worktreePath: reviewWorktreePath
    }),
    session,
    targetRoot: reviewTargetRoot
  });
}

export {
  createJskitLaunchTargetTerminalSpec,
  createJskitAppReviewTerminalSpec,
  createJskitReviewDescriptor,
  listJskitLaunchTargets,
  DEV_SERVER_COMMAND_CONFIG,
  REVIEW_COMMAND_CONFIG,
  REVIEW_HOST_DOCKER_CONFIG,
  REVIEW_PORT_CONFIG
};
