import process from "node:process";

import {
  gitToolchainMountArgs
} from "./gitToolchainMounts.js";
import {
  targetRuntimeNetworkDockerArgs
} from "./aiStudio/runtimeContainers.js";
import {
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  studioDockerLabel
} from "./studioRuntimeIdentity.js";
import {
  studioPlaywrightBrowsersDockerArgs,
  studioToolHomeDockerArgs,
  studioUserCommand,
  studioUserStartupScript
} from "./studioToolHome.js";
import {
  hostUserIdentityEnvArgs,
  shellQuote
} from "./shellCommands.js";

const STUDIO_TOOLCHAIN_CONTAINER_LABEL = studioDockerLabel("kind", "toolchain");
const HOST_USER_TOOLCHAIN_HOME = "/tmp/studio-home";

function normalizeToolchainOptions(options = {}) {
  return Array.isArray(options)
    ? {
        extraArgs: options
      }
    : options;
}

function dockerUserSpecified(args = []) {
  return args.some((arg) => {
    const value = String(arg || "");
    return value === "-u" ||
      value === "--user" ||
      value.startsWith("-u=") ||
      value.startsWith("--user=");
  });
}

function dockerEnvValue(args = [], envName = "") {
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || "");
    const previous = String(args[index - 1] || "");
    const envAssignment = value.startsWith("--env=") ? value.slice("--env=".length) : value;
    const isEnvValue = previous === "-e" || previous === "--env" || value.startsWith("--env=");
    if (isEnvValue && envAssignment.startsWith(`${envName}=`)) {
      return envAssignment.slice(envName.length + 1);
    }
  }
  return "";
}

function hostUserToolchainStartupScript(commandArgs, {
  home = HOST_USER_TOOLCHAIN_HOME
} = {}) {
  return [
    "set -e",
    `export HOME=${shellQuote(home || HOST_USER_TOOLCHAIN_HOME)}`,
    "mkdir -p \"$HOME\"",
    `exec ${studioUserCommand(commandArgs)}`
  ].join("\n");
}

function toolchainHomeDockerArgs(extraArgs = []) {
  if (!dockerUserSpecified(extraArgs)) {
    return [
      ...studioToolHomeDockerArgs(),
      ...hostUserIdentityEnvArgs()
    ];
  }
  return dockerEnvValue(extraArgs, "HOME")
    ? []
    : [
        "-e",
        `HOME=${HOST_USER_TOOLCHAIN_HOME}`
      ];
}

function toolchainStartupScript(commandArgs, extraArgs = []) {
  if (!dockerUserSpecified(extraArgs)) {
    return studioUserStartupScript(commandArgs);
  }
  return hostUserToolchainStartupScript(commandArgs, {
    home: dockerEnvValue(extraArgs, "HOME") || HOST_USER_TOOLCHAIN_HOME
  });
}

function buildDoctorToolchainArgs(commandArgs, options = {}) {
  const {
    extraArgs = [],
    image = STUDIO_BASE_TOOLCHAIN_IMAGE,
    targetRoot = ""
  } = normalizeToolchainOptions(options);
  const workspaceMountArgs = targetRoot
    ? [
        "-v",
        `${targetRoot}:/workspace`,
        ...gitToolchainMountArgs(targetRoot)
      ]
    : [];
  return [
    "run",
    "--rm",
    ...toolchainHomeDockerArgs(extraArgs),
    "--label",
    STUDIO_TOOLCHAIN_CONTAINER_LABEL,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    ...workspaceMountArgs,
    ...(targetRoot ? targetRuntimeNetworkDockerArgs(targetRoot) : []),
    "-w",
    "/workspace",
    ...extraArgs,
    ...studioPlaywrightBrowsersDockerArgs(),
    image,
    "bash",
    "-lc",
    toolchainStartupScript(commandArgs, extraArgs)
  ];
}

function buildDoctorTerminalArgs(commandArgs, options = {}) {
  const normalizedOptions = normalizeToolchainOptions(options);
  return buildDoctorToolchainArgs(commandArgs, {
    ...normalizedOptions,
    extraArgs: ["-it", ...(normalizedOptions.extraArgs || [])]
  });
}

export {
  buildDoctorTerminalArgs,
  buildDoctorToolchainArgs,
  STUDIO_TOOLCHAIN_CONTAINER_LABEL
};
