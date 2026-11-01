import process from "node:process";

import { genesisParserEnvironment, withGenesisCommandShim } from "@local/vibe64-genesis/server";
import { requestUnixJsonCommand } from "./unixJsonCommand.js";
import { codexTerminalNamespace, openCodeError } from "./terminalShared.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { prepareAgentHelperCommand } from "./agentHelperCommand.js";
import { learningSessionExecutionRoot } from "./mainConversationContext.js";
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
import { createKeyedQueue, createSharedOperations } from "./keyedOperations.js";
import { toText } from "@local/vibe64-core/shared/toText";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

const preparations = createKeyedQueue();
const closures = createSharedOperations();

function commandBoundaryError(name = "") {
  const error = new Error(`Vibe64 could not prepare the session-scoped ${toText(name) || "command"} boundary.`);
  error.code = "vibe64_agent_command_boundary_unavailable";
  error.boundary = toText(name);
  return error;
}

async function agentSessionCommandEnvironmentIsHealthy(env = {}) {
  const names = Object.keys(env);
  const controls = [
    ["VIBE64_CODEX_GIT_COMMAND", "codex-git-command"],
    ["VIBE64_AGENT_SESSION_COMMAND", "agent-session-command"],
    ["VIBE64_AGENT_PREVIEW_COMMAND", "agent-preview-command"],
    ["VIBE64_AGENT_ENV_COMMAND", "agent-env-command"],
    ["VIBE64_AGENT_DATABASE_COMMAND", "agent-database-command"]
  ].filter(([prefix]) => names.some((key) => key.startsWith(`${prefix}_`)));
  const results = await Promise.all(controls.map(async ([prefix, route]) => {
    const socketPath = toText(env[`${prefix}_SOCKET`]);
    const sessionId = toText(env[`${prefix}_SESSION_ID`]);
    const generationId = toText(env[`${prefix}_GENERATION`]);
    const token = toText(env[`${prefix}_TOKEN`]);
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

async function prepareOpenCodeSessionCommandEnvironment(context, {
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codexGitCommand,
  env,
  prepareCommandEnvironment,
  project
}) {
  if (context.assistantScope) {
    return {
      env: context.assistantScope.environment || {},
      shimDirs: []
    };
  }
  if (await learningSessionExecutionRoot(context.runtime, context.sessionId)) {
    return { env: {}, shimDirs: [] };
  }
  if (!codexGitCommand) {
    return { env: {}, shimDirs: [] };
  }
  const projectRecord = await project.readCurrentProject();
  const prepared = await prepareCommandEnvironment({
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    env,
    gitCommand: codexGitCommand,
    project: projectRecord,
    runtime: context.runtime,
    sessionId: context.sessionId,
    worktreePath: context.workdir
  });
  if (prepared?.ok !== true) {
    throw openCodeError(
      "vibe64_opencode_command_boundary_unavailable",
      "Vibe64 could not prepare session-scoped Git commands for OpenCode.",
      {},
      503
    );
  }
  return {
    env: {
      ...await loadProjectExecutionEnv({ project, session: context.session, target: "opencode" }),
      ...normalizeObject(prepared.env)
    },
    shimDirs: prepared.shimDirs
  };
}

async function prepareAgentSessionCommandEnvironment(options = {}) {
  const key = codexTerminalNamespace(toText(options.sessionId));
  if (closures.has(key)) throw commandBoundaryError("closing session");
  return preparations.run(key, () => {
    if (closures.has(key)) throw commandBoundaryError("closing session");
    return prepareAgentSessionCommandEnvironmentUnlocked(options);
  });
}

async function closeAgentSessionCommandEnvironment(sessionId, operation) {
  const key = codexTerminalNamespace(toText(sessionId));
  return closures.run(key, async () => {
    await preparations.settled(key);
    return operation();
  });
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
  const normalizedSessionId = toText(sessionId);
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
    stateRoot: toText(runtime?.stateRoot)
  });
  if (git?.ok !== true || !toText(git.hostWrapperDir)) {
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
      project: normalizeObject(project),
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
  const hostWrapperDir = toText(git.hostWrapperDir);
  const helper = await prepareHelperCommand({ wrapperHostDir: hostWrapperDir, env });
  if (helper?.ok !== true) {
    throw commandBoundaryError("helper");
  }
  const filePaths = runtime ? runtime.store.paths(normalizedSessionId) : null;
  const dropZoneRoot = toText(filePaths?.dropZoneRoot);
  const projectBackupsRoot = toText(filePaths?.projectBackupsRoot);
  const projectDropZoneRoot = toText(filePaths?.projectDropZoneRoot);
  if (projectBackupsRoot || projectDropZoneRoot) await runtime.store.prepareProjectFileAreas();
  return {
    env: Object.assign({},
      genesisParserEnvironment({ environment: env }),
      ...steps.map((step) => normalizeObject(step.result?.env)),
      dropZoneRoot ? {
      VIBE64_DROP_ZONE: dropZoneRoot
    } : {}, projectDropZoneRoot ? { VIBE64_PROJECT_DROP_ZONE: projectDropZoneRoot } : {},
    projectBackupsRoot ? { VIBE64_PROJECT_BACKUPS: projectBackupsRoot } : {}),
    hostWrapperDir,
    ok: true,
    shimDirs: withGenesisCommandShim([hostWrapperDir])
  };
}

export {
  agentSessionCommandEnvironmentIsHealthy,
  closeAgentSessionCommandEnvironment,
  prepareAgentSessionCommandEnvironment,
  prepareOpenCodeSessionCommandEnvironment
};
