import process from "node:process";

import {
  targetRuntimeNetworkDockerArgs
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  gitToolchainMountArgs
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  hostUserIdentityEnvArgs
} from "@local/studio-terminal-core/server/shellCommands";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_DAEMON_PID_LABEL,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioPlaywrightBrowsersDockerArgs,
  studioToolHomeDockerArgs
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  terminalEnvironmentDockerArgs
} from "./terminalEnvironment.js";
import {
  stableHash
} from "./terminalShared.js";

function dockerMountArgs({
  readOnly = false,
  source = "",
  target = ""
} = {}) {
  if (!source || !target) {
    return [];
  }
  return [
    "-v",
    `${source}:${target}${readOnly ? ":ro" : ""}`
  ];
}

function dockerLabelArgs(labels = []) {
  return labels
    .filter(Boolean)
    .flatMap((label) => ["--label", label]);
}

function targetToolchainTerminalArgs({
  commandArgs = [],
  containerName = "",
  dockerRunArgs = [],
  env = {},
  extraLabels = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  kind = "",
  mounts = [],
  sessionId = "",
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    ...dockerRunArgs,
    ...dockerLabelArgs([
      kind ? studioDockerLabel("kind", kind) : "",
      `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
      studioDockerLabel("session", sessionId),
      studioDockerLabel("terminal", terminalId),
      studioDockerLabel("target", stableHash(targetRoot)),
      ...extraLabels
    ]),
    ...studioToolHomeDockerArgs(),
    ...terminalEnvironmentDockerArgs(env),
    ...studioPlaywrightBrowsersDockerArgs(),
    ...hostUserIdentityEnvArgs(),
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...mounts.flatMap(dockerMountArgs),
    ...targetRuntimeNetworkDockerArgs(targetRoot),
    "-w",
    workdir,
    image,
    ...commandArgs
  ];
}

export {
  targetToolchainTerminalArgs
};
