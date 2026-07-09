import {
  gitSafeDirectoryArgs
} from "@local/studio-terminal-core/server/gitHostCommandPaths";
import {
  buildDoctorHostCommandArgs
} from "./doctorHostCommand.js";
import {
  DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS,
  emptyDoctorCommandResult,
  runDoctorGatewayCommand
} from "./doctorCommandRunner.js";

function doctorGitCommandArgs(targetRoot, args = []) {
  return ["git", ...gitSafeDirectoryArgs(targetRoot), ...args];
}

async function runDoctorHostCommand(commandArgs = [], {
  actor = "",
  env = {},
  githubToolHomeSource = "",
  input,
  runtimes = [],
  targetRoot,
  toolHomeSource = "",
  timeout = DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS,
  userKey = ""
} = {}) {
  const argv = buildDoctorHostCommandArgs(commandArgs);
  const [command, ...args] = argv;
  if (!command) {
    return emptyDoctorCommandResult();
  }
  return runDoctorGatewayCommand(command, args, {
    actor,
    cwd: targetRoot || undefined,
    env,
    githubToolHomeSource,
    input,
    runtimes,
    targetRoot,
    timeout,
    toolHomeSource,
    userKey
  });
}

async function runDoctorGit(targetRoot, args = [], options = {}) {
  return runDoctorHostCommand(doctorGitCommandArgs(targetRoot, args), {
    targetRoot,
    ...options
  });
}

async function runDoctorGh(targetRoot, args = [], options = {}) {
  return runDoctorHostCommand(["gh", ...args], {
    targetRoot,
    ...options
  });
}

export {
  doctorGitCommandArgs,
  runDoctorGh,
  runDoctorGit,
  runDoctorHostCommand
};
