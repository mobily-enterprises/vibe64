import process from "node:process";

import {
  targetRuntimeNetworkDockerArgs
} from "../../../../server/lib/aiStudio/runtimeContainers.js";
import {
  gitToolchainMountArgs
} from "../../../../server/lib/gitToolchainMounts.js";
import {
  hostUserIdentityEnvArgs
} from "../../../../server/lib/shellCommands.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_DAEMON_PID_LABEL,
  studioDockerLabel
} from "../../../../server/lib/studioRuntimeIdentity.js";
import {
  studioPlaywrightBrowsersDockerArgs,
  studioToolHomeDockerArgs
} from "../../../../server/lib/studioToolHome.js";
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
