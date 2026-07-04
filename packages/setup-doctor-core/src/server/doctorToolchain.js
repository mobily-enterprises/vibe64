import path from "node:path";

import {
  gitToolchainMountArgs
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  githubSshToHttpsGitDockerEnvArgs
} from "@local/studio-terminal-core/server/gitGithubTransport";
import {
  targetRuntimeNetworkDockerArgs
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  studioDaemonDockerLabels,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioPlaywrightBrowsersDockerArgs,
  studioToolHomeDockerArgs,
  studioUserCommand,
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  dockerUserArgs,
  hostUserIdentityEnvArgs,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";

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

function toolchainHomeDockerArgs(extraArgs = [], {
  githubToolHomeSource = "",
  toolHomeSource = ""
} = {}) {
  const credentialHomeSource = String(toolHomeSource || githubToolHomeSource || "").trim();
  if (!dockerUserSpecified(extraArgs)) {
    return [
      ...studioToolHomeDockerArgs({
        githubToolHomeSource,
        source: toolHomeSource
      }),
      ...hostUserIdentityEnvArgs()
    ];
  }
  if (credentialHomeSource) {
    return studioToolHomeDockerArgs({
      githubToolHomeSource,
      source: credentialHomeSource
    });
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
    githubToolHomeSource = "",
    hostGid = "",
    hostUid = "",
    image = STUDIO_BASE_TOOLCHAIN_IMAGE,
    targetRoot = "",
    toolHomeSource = ""
  } = normalizeToolchainOptions(options);
  const normalizedTargetRoot = targetRoot ? path.resolve(String(targetRoot)) : "";
  const resolvedExtraArgs = [
    ...(dockerUserSpecified(extraArgs)
      ? []
      : dockerUserArgs({
          gid: hostGid,
          uid: hostUid
        })),
    ...extraArgs
  ];
  const toolHomeArgs = toolchainHomeDockerArgs(resolvedExtraArgs, {
    githubToolHomeSource,
    toolHomeSource
  });
  const workspaceMountArgs = normalizedTargetRoot
    ? [
        "-v",
        `${normalizedTargetRoot}:${normalizedTargetRoot}`,
        ...gitToolchainMountArgs(normalizedTargetRoot)
      ]
    : [];
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    ...toolHomeArgs,
    ...githubSshToHttpsGitDockerEnvArgs(),
    "--label",
    STUDIO_TOOLCHAIN_CONTAINER_LABEL,
    ...studioDaemonDockerLabels().flatMap((label) => ["--label", label]),
    ...workspaceMountArgs,
    ...(normalizedTargetRoot ? targetRuntimeNetworkDockerArgs(normalizedTargetRoot) : []),
    ...(normalizedTargetRoot ? ["-w", normalizedTargetRoot] : []),
    ...resolvedExtraArgs,
    ...studioPlaywrightBrowsersDockerArgs(),
    image,
    "bash",
    "-lc",
    toolchainStartupScript(commandArgs, [
      ...toolHomeArgs,
      ...resolvedExtraArgs
    ])
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
