import path from "node:path";

import {
  runVibe64Command
} from "@local/vibe64-execution/server";

const DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS = 20_000;

function emptyDoctorCommandResult(message = "Doctor command is empty.") {
  return {
    error: message,
    exitCode: 1,
    ok: false,
    output: message,
    stderr: message,
    stdout: ""
  };
}

function credentialHomeFromOptions({
  credentialHome = {},
  githubToolHomeSource = "",
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const home = String(credentialHome.home || credentialHome.toolHomeSource || toolHomeSource || githubToolHomeSource || "").trim();
  return home
    ? {
        ...credentialHome,
        home,
        username: credentialHome.username || credentialHome.userKey || userKey || ""
      }
    : {};
}

function homeRequiresRealUser(home = "") {
  const normalizedHome = String(home || "").trim();
  return normalizedHome === "/home" || normalizedHome.startsWith("/home/");
}

function actorForDoctorCommand({
  actor = "",
  credentialHome = {},
  userKey = ""
} = {}) {
  if (actor) {
    return actor;
  }
  if (homeRequiresRealUser(credentialHome.home) && userKey) {
    return "owner-user";
  }
  return "app";
}

async function runDoctorGatewayCommand(command = "", args = [], {
  actor = "",
  allowedRoots = [],
  cwd = "",
  env = {},
  gitTransport = "none",
  githubToolHomeSource = "",
  input,
  project = {},
  runtimes = [],
  targetRoot = "",
  timeout = DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS,
  toolHomeSource = "",
  userKey = ""
} = {}) {
  const resolvedCommand = String(command || "").trim();
  if (!resolvedCommand) {
    return emptyDoctorCommandResult();
  }
  const credentialHome = credentialHomeFromOptions({
    githubToolHomeSource,
    toolHomeSource,
    userKey
  });
  const commandRoot = String(cwd || targetRoot || process.cwd()).trim();
  const roots = [
    commandRoot,
    targetRoot,
    ...allowedRoots
  ].filter(Boolean).map((root) => path.resolve(root));

  return runVibe64Command({
    actor: actorForDoctorCommand({
      actor,
      credentialHome,
      userKey
    }),
    allowedRoots: roots,
    args,
    command: resolvedCommand,
    credentialHome,
    cwd: commandRoot,
    env,
    envPolicy: "project",
    gitTransport,
    input,
    mode: "capture",
    project,
    purpose: "setup",
    runtimes,
    timeout,
    userKey
  });
}

export {
  DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS,
  emptyDoctorCommandResult,
  runDoctorGatewayCommand
};
