import process from "node:process";

import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import {
  prepareAgentDatabaseCommand
} from "./agentDatabaseCommand.js";
import {
  prepareAgentEnvCommand
} from "./agentEnvCommand.js";
import {
  prepareAgentPreviewCommand
} from "./agentPreviewCommand.js";
import {
  prepareAgentSessionCommand
} from "./agentSessionCommand.js";
import {
  prepareCodexGitCommand
} from "./codexGitCommand.js";

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value = "") {
  return String(value ?? "").trim();
}

function commandBoundaryError(name = "") {
  const error = new Error(`Vibe64 could not prepare the session-scoped ${text(name) || "command"} boundary.`);
  error.code = "vibe64_agent_command_boundary_unavailable";
  error.boundary = text(name);
  return error;
}

async function prepareAgentSessionCommandEnvironment({
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  agentSessionCommand = null,
  env = process.env,
  gitCommand = null,
  gitEnvironment = env,
  prepareDatabaseCommand = prepareAgentDatabaseCommand,
  prepareEnvironmentCommand = prepareAgentEnvCommand,
  prepareGitCommand = prepareCodexGitCommand,
  preparePreviewCommand = prepareAgentPreviewCommand,
  prepareSessionCommand = prepareAgentSessionCommand,
  project = {},
  runtime = null,
  sessionId = "",
  worktreePath = ""
} = {}) {
  const normalizedSessionId = text(sessionId);
  if (!gitCommand || !normalizedSessionId) {
    return {
      env: {},
      hostWrapperDir: "",
      ok: false,
      shimDirs: []
    };
  }
  const git = await prepareGitCommand({
    commandService: gitCommand,
    env: gitEnvironment,
    sessionId: normalizedSessionId,
    stateRoot: text(runtime?.stateRoot)
  });
  if (git?.ok !== true || !text(git.hostWrapperDir)) {
    throw commandBoundaryError("Git");
  }
  const steps = [{ name: "Git", result: git }];
  const optionalSteps = await Promise.all([
    agentSessionCommand ? prepareSessionCommand({
      commandService: agentSessionCommand,
      sessionId: normalizedSessionId,
      wrapperHostDir: git.hostWrapperDir
    }).then((result) => ({
      name: "shell execution",
      result
    })) : null,
    agentPreviewCommand ? preparePreviewCommand({
      commandService: agentPreviewCommand,
      env,
      project: record(project),
      sessionId: normalizedSessionId,
      worktreePath,
      wrapperHostDir: git.hostWrapperDir
    }).then((result) => ({
      name: "preview",
      result
    })) : null,
    agentEnvCommand ? prepareEnvironmentCommand({
      commandService: agentEnvCommand,
      sessionId: normalizedSessionId,
      wrapperHostDir: git.hostWrapperDir
    }).then((result) => ({
      name: "environment",
      result
    })) : null,
    agentDatabaseCommand ? prepareDatabaseCommand({
      commandService: agentDatabaseCommand,
      sessionId: normalizedSessionId,
      wrapperHostDir: git.hostWrapperDir
    }).then((result) => ({
      name: "database",
      result
    })) : null
  ].filter(Boolean));
  steps.push(...optionalSteps);
  const unavailable = steps.find((step) => step.result?.ok !== true);
  if (unavailable) {
    throw commandBoundaryError(unavailable.name);
  }
  const hostWrapperDir = text(git.hostWrapperDir);
  const dropZoneRoot = text(runtime?.store?.paths?.(normalizedSessionId)?.dropZoneRoot);
  return {
    env: Object.assign({}, ...steps.map((step) => record(step.result?.env)), dropZoneRoot ? {
      VIBE64_DROP_ZONE: dropZoneRoot
    } : {}),
    hostWrapperDir,
    ok: true,
    shimDirs: withGenesisCommandShim([hostWrapperDir])
  };
}

export {
  prepareAgentSessionCommandEnvironment
};
