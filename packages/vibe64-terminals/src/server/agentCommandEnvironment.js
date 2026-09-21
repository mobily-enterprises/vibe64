import process from "node:process";

import { genesisParserEnvironment, withGenesisCommandShim } from "@local/vibe64-genesis/server";
import { requestUnixJsonCommand } from "./unixJsonCommand.js";
import { codexTerminalNamespace } from "./terminalShared.js";
import { prepareAgentHelperCommand } from "./agentHelperCommand.js";
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

const preparations = new Map();
const closures = new Map();

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

async function agentSessionCommandEnvironmentIsHealthy(env = {}) {
  const names = Object.keys(env);
  const controls = [
    ["VIBE64_CODEX_GIT_COMMAND", "codex-git-command"],
    ["VIBE64_AGENT_SESSION_COMMAND", "agent-session-command"],
    ["VIBE64_AGENT_PREVIEW_COMMAND", "agent-preview-command"],
    ["VIBE64_AGENT_ENV_COMMAND", "agent-env-command"]
  ].filter(([prefix]) => names.some((key) => key.startsWith(`${prefix}_`)));
  const results = await Promise.all(controls.map(async ([prefix, route]) => {
    const socketPath = text(env[`${prefix}_SOCKET`]);
    const sessionId = text(env[`${prefix}_SESSION_ID`]);
    const generationId = text(env[`${prefix}_GENERATION`]);
    const token = text(env[`${prefix}_TOKEN`]);
    if (!socketPath || !sessionId || !generationId || !token) return false;
    try {
      const result = await requestUnixJsonCommand({
        socketPath,
        path: `/${route}/health`,
        body: { sessionId, generationId, token }
      });
      return result.statusCode === 200 && result.payload?.ok === true &&
        result.payload.sessionId === sessionId && result.payload.generationId === generationId;
    } catch {
      return false;
    }
  }));
  return results.every(Boolean);
}

async function prepareAgentSessionCommandEnvironment(options = {}) {
  const key = codexTerminalNamespace(text(options.sessionId));
  if (closures.has(key)) throw commandBoundaryError("closing session");
  const pending = (preparations.get(key) || Promise.resolve()).catch(() => null).then(() => {
    if (closures.has(key)) throw commandBoundaryError("closing session");
    return prepareAgentSessionCommandEnvironmentUnlocked(options);
  });
  preparations.set(key, pending);
  try {
    return await pending;
  } finally {
    if (preparations.get(key) === pending) preparations.delete(key);
  }
}

async function closeAgentSessionCommandEnvironment(sessionId, operation) {
  const key = codexTerminalNamespace(text(sessionId));
  if (closures.has(key)) return closures.get(key);
  const pending = Promise.resolve().then(async () => {
    await preparations.get(key)?.catch(() => null);
    return operation();
  });
  closures.set(key, pending);
  try {
    return await pending;
  } finally {
    if (closures.get(key) === pending) closures.delete(key);
  }
}

async function prepareAgentSessionCommandEnvironmentUnlocked({
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
  prepareHelperCommand = prepareAgentHelperCommand,
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
  const helper = await prepareHelperCommand({ wrapperHostDir: hostWrapperDir });
  if (helper?.ok !== true) {
    throw commandBoundaryError("helper");
  }
  const dropZoneRoot = text(runtime?.store?.paths?.(normalizedSessionId)?.dropZoneRoot);
  return {
    env: Object.assign({}, genesisParserEnvironment({ environment: env }), ...steps.map((step) => record(step.result?.env)), dropZoneRoot ? {
      VIBE64_DROP_ZONE: dropZoneRoot
    } : {}),
    hostWrapperDir,
    ok: true,
    shimDirs: withGenesisCommandShim([hostWrapperDir])
  };
}

export {
  agentSessionCommandEnvironmentIsHealthy,
  closeAgentSessionCommandEnvironment,
  prepareAgentSessionCommandEnvironment
};
