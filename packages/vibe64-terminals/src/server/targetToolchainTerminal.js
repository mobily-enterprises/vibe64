import path from "node:path";
import process from "node:process";

import {
  runtimeNetworkTargetHash,
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
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioPlaywrightBrowsersDockerArgs,
  studioToolHomeDockerArgs
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  terminalEnvironmentDockerArgs
} from "./terminalEnvironment.js";

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
  return dockerMountArgs({
    source: path.resolve(normalizedWorkdir),
    target: path.resolve(normalizedWorkdir)
  });
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
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    "-it",
    "--name",
    containerName,
    ...dockerRunArgs,
    ...dockerLabelArgs([
      kind ? studioDockerLabel("kind", kind) : "",
      `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
      sessionId ? studioDockerLabel("session", sessionId) : "",
      studioDockerLabel("terminal", terminalId),
      studioDockerLabel("target", runtimeNetworkTargetHash(targetRoot)),
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
    ...workdirMountArgs({
      targetRoot,
      workdir
    }),
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
