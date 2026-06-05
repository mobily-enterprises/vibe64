import {
  gitSafeDirectoryArgs
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  buildDoctorToolchainArgs
} from "./doctorToolchain.js";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";

const DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS = 20_000;

function doctorGitCommandArgs(targetRoot, args = []) {
  return ["git", ...gitSafeDirectoryArgs(targetRoot), ...args];
}

async function runDoctorToolchain(commandArgs = [], {
  extraArgs = [],
  targetRoot,
  toolHomeSource = "",
  timeout = DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS
} = {}) {
  if (targetRoot) {
    await ensureTargetRuntimeNetwork(targetRoot);
  }
  return runHostCommand("docker", buildDoctorToolchainArgs(commandArgs, {
    extraArgs,
    targetRoot,
    toolHomeSource
  }), {
    timeout
  });
}

async function runDoctorGit(targetRoot, args = [], options = {}) {
  return runDoctorToolchain(doctorGitCommandArgs(targetRoot, args), {
    targetRoot,
    ...options
  });
}

async function runDoctorGh(targetRoot, args = [], options = {}) {
  return runDoctorToolchain(["gh", ...args], {
    targetRoot,
    ...options
  });
}

export {
  doctorGitCommandArgs,
  runDoctorGh,
  runDoctorGit,
  runDoctorToolchain
};
