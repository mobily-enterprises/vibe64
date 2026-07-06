import {
  gitSafeDirectoryArgs
} from "@local/studio-terminal-core/server/gitHostCommandPaths";
import {
  buildDoctorHostCommandArgs
} from "./doctorHostCommand.js";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";

const DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS = 20_000;

function doctorGitCommandArgs(targetRoot, args = []) {
  return ["git", ...gitSafeDirectoryArgs(targetRoot), ...args];
}

async function runDoctorHostCommand(commandArgs = [], {
  githubToolHomeSource = "",
  targetRoot,
  toolHomeSource = "",
  timeout = DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS
} = {}) {
  const argv = buildDoctorHostCommandArgs(commandArgs);
  const [command, ...args] = argv;
  if (!command) {
    return {
      error: "Doctor command is empty.",
      exitCode: 1,
      ok: false,
      output: "Doctor command is empty.",
      stderr: "Doctor command is empty.",
      stdout: ""
    };
  }
  const home = String(toolHomeSource || githubToolHomeSource || "").trim();
  return runHostCommand(command, args, {
    cwd: targetRoot || undefined,
    env: home ? {
      HOME: home
    } : undefined,
    timeout
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
