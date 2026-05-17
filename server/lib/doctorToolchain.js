import {
  gitToolchainMountArgs
} from "./gitToolchainMounts.js";
import {
  STUDIO_TOOLCHAIN_IMAGE,
  STUDIO_TOOL_HOME_VOLUME
} from "./studioRuntimeIdentity.js";

function normalizeToolchainOptions(options = {}) {
  return Array.isArray(options)
    ? {
        extraArgs: options
      }
    : options;
}

function buildDoctorToolchainArgs(commandArgs, options = {}) {
  const {
    extraArgs = [],
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
    "-v",
    `${STUDIO_TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    ...workspaceMountArgs,
    "-w",
    "/workspace",
    ...extraArgs,
    STUDIO_TOOLCHAIN_IMAGE,
    ...commandArgs
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
  buildDoctorToolchainArgs
};
