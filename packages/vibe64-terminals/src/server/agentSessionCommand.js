import {
  captureProjectRequestContext,
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { manageWorkPlan } from "./assistantWorkPlan.js";
import { planCommandSource } from "./agentPlanCommand.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { readAgentSessionStatus } from "./agentSessionStatus.js";
import { workspaceSetupState } from "@local/vibe64-runtime/server/workspaceSetupState";

import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  runVibe64Command,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";
import {
  genesisParserEnvironment,
  withGenesisCommandShim
} from "@local/vibe64-genesis/server";
import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import {
  createSessionCommandServers,
  shortCommandHash,
  unixCommandSocketPath
} from "./unixJsonCommand.js";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  AGENT_SESSION_COMMAND_CONTRACT_VERSION,
  AGENT_SESSION_COMMAND_NAME,
  AGENT_SESSION_COMMAND_TIMEOUT_MS,
  commandRunnerSource,
  commandWrapperSource,
  decodedCommand,
  readBoundedFile,
  sanitizedCommandEnvironment,
  SESSION_RENAME_CONTROL_ENV,
  sessionRenameCommandSource,
  validateCommandCwd,
  VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV,
  VIBE64_AGENT_SESSION_RUN_COMMAND_ENV,
  VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV,
  VIBE64_AGENT_SESSION_RUN_RESULT_ENV,
  VIBE64_WRAPPER_ENV,
  waitForCommandResult
} from "./agentSessionCommandRun.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { commandLineFailure } from "./commandFailure.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */

const AGENT_SESSION_COMMAND_RUNNER_NAME = "vibe64-session-command-runner";
const AGENT_SESSION_COMMAND_SOCKET_NAME = "session-command.sock";
const AGENT_SESSION_COMMAND_RUNS_DIR_NAME = "session-command-runs";
const AGENT_SESSION_COMMAND_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_NAME);
}

function runnerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_RUNNER_NAME);
}

/** The command's socket, under this server process's temporary directory. */
function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_SESSION_COMMAND_SOCKET_NAME), { env: process.env });
}

function commandRunsHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_SESSION_COMMAND_RUNS_DIR_NAME);
}

// Every route but run is authorized by the control token rather than the
// shell-execution token.
const commandServers = createSessionCommandServers({
  routePrefix: "/agent-session-command",
  routes: {
    "/agent-session-command/list-project": {
      handle: ({ commandService, input, sessionId }) => commandService.listProject(sessionId, input),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/message-project": {
      handle: ({ commandService, input, sessionId }) => commandService.messageProject(sessionId, input),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/project-preview": {
      handle: ({ commandService, input, sessionId }) => commandService.projectPreview(sessionId, input),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/rename": {
      handle: ({ commandService, input, sessionId }) => commandService.renameSession(sessionId, input.name),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/setup-retry": {
      handle: ({ commandService, sessionId }) => commandService.retrySetup(sessionId),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/status": {
      handle: ({ commandService, sessionId }) => commandService.sessionStatus(sessionId),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/plan": {
      handle: ({ commandService, input, sessionId }) => commandService.managePlan(sessionId, input),
      status: vibe64StatusCode,
      token: "controlToken"
    },
    "/agent-session-command/run": {
      handle({ commandService, input, request, response }) {
        const abortController = new AbortController();
        request.once("aborted", () => abortController.abort());
        response.once("close", () => {
          if (!response.writableEnded) abortController.abort();
        });
        return commandService.run({ ...input, signal: abortController.signal });
      },
      status: vibe64StatusCode
    }
  },
  extraTokens: ["controlToken"],
  label: "session",
  maxBytes: AGENT_SESSION_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_session_command_invalid_json", message: "Vibe64 session command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_session_command_input_too_large", message: "Vibe64 session command input is too large." },
  notFound: commandLineFailure("Unknown Vibe64 session command route.", "vibe64_agent_session_command_route_not_found"),
  rejection: {
    statusCode: 403,
    payload: commandLineFailure(
      "Vibe64 session command identity is invalid. Reconnect the affected assistant before retrying. If only a child agent is affected, ask its parent to replace that child and preserve its work.",
      "vibe64_agent_session_command_identity_invalid"
    )
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_session_command_request_failed",
    fallbackMessage: "Vibe64 session command request failed."
  },
  errorBody: (payload) => commandLineFailure(payload.error, payload.code),
  directoryMode: 0o700
});

/**
 * @param {object} dependencies
 * @param {(request: object) => Promise<object>} dependencies.listProjectSessions
 * @param {(request: object) => Promise<object>} dependencies.sendProjectMessage
 * @param {(request: object) => Promise<object>} dependencies.readProjectPreview
 * @param {(sessionId: string, input: object, options: object) => Promise<object>} dependencies.reportWorkflowOutcome
 * @param {(sessionId: string) => Promise<object>} dependencies.retryWorkspaceSetup
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {typeof stopVibe64Execution} [dependencies.stopExecution]
 * @param {typeof stopVibe64OwnedExecutions} [dependencies.stopOwnedExecutions]
 */
function createAgentSessionCommandService({
  listProjectSessions,
  sendProjectMessage,
  readProjectPreview,
  reportWorkflowOutcome,
  retryWorkspaceSetup,
  logger,
  project,
  publishSessionChanged,
  runCommand = runVibe64Command,
  stopExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions
}) {
  const projectBinding = createAgentCommandProjectBinding(project, {
    sessionRequired: ["Vibe64 session command binding is incomplete.", "vibe64_agent_session_command_binding_required"],
    projectRequired: ["Vibe64 session commands require a project.", "vibe64_agent_session_command_project_required"],
    unbound: ["This shell command is not bound to an active Vibe64 session.", "vibe64_agent_session_command_session_unbound"],
    changed: ["The shell command session no longer matches its bound project.", "vibe64_agent_session_command_project_binding_changed"]
  });
  const sessionExecutions = new Map();
  const sessionRuns = new Map();

  async function bindSession(sessionId = "", options = {}) {
    const { wrapperHostDir = "" } = options;
    const normalizedSessionId = toText(sessionId);
    const normalizedWrapperHostDir = toText(wrapperHostDir);
    if (!normalizedSessionId || !normalizedWrapperHostDir) {
      throw vibe64Error(
        "Vibe64 session command binding is incomplete.",
        "vibe64_agent_session_command_binding_required"
      );
    }
    const requestContext = currentProjectRequestContext();
    // Practice sessions are ordinary project sessions; no host binds a
    // learning-scoped session command any more, so one is refused.
    if (requestContext?.learningScope) {
      throw vibe64Error(
        "Session commands are unavailable in a Learning-scoped context.",
        "vibe64_agent_session_command_learning_unavailable"
      );
    }
    const binding = await projectBinding.bind(normalizedSessionId);
    Object.assign(binding, {
      actor: requestContext?.vibe64User || null,
      projectContext: captureProjectRequestContext(),
      wrapperHostDir: path.resolve(normalizedWrapperHostDir)
    });
    return {
      ...binding,
      ok: true,
      sessionId: normalizedSessionId
    };
  }

  async function runInSessionProject(sessionId, operation) {
    const normalizedSessionId = toText(sessionId);
    const runBound = () => projectBinding.run(normalizedSessionId, async (binding, projectRecord) => {
      const store = await project.createSessionStore({
        sessionId: normalizedSessionId
      });
      const descriptor = await store.readSessionSourceDescriptor(normalizedSessionId);
      const sourceRoot = sessionSourcePath({
        ...descriptor,
        id: normalizedSessionId,
        sessionId: normalizedSessionId
      });
      if (!sourceRoot) {
        throw vibe64Error(
          "The active Vibe64 session source is unavailable.",
          "vibe64_agent_session_command_source_unavailable"
        );
      }
      return operation({
        binding,
        store,
        descriptor,
        project: projectRecord,
        sourceRoot: path.resolve(sourceRoot)
      });
    });
    return runWithProjectRequestContext(projectBinding.get(normalizedSessionId)?.projectContext || {}, runBound);
  }

  /**
   * Cross-project commands act for the person who submitted the current request.
   * @param {Vibe64SessionStore} store
   * @param {string} sessionId
   * @param {object} binding
   */
  async function requestActor(store, sessionId, binding) {
    const routing = JSON.parse(await store.readMetadataValue(sessionId, "assistant_routing_request") || "null");
    return routing?.submittedBy || binding.actor;
  }

  async function listProject(sessionId, input) {
    return runInSessionProject(sessionId, async ({ binding, store }) => {
      return listProjectSessions({
        projectSlug: toText(input.projectSlug),
        sourceProject: binding.projectSlug,
        sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function messageProject(sessionId, input) {
    return runInSessionProject(sessionId, async ({ binding, store }) => {
      return sendProjectMessage({
        projectSlug: toText(input.projectSlug),
        message: toText(input.message),
        ...(input.destinationSessionId !== undefined ? { destinationSessionId: toText(input.destinationSessionId) } : {}),
        messageId: toText(input.messageId) || randomUUID(),
        sourceProject: binding.projectSlug,
        sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function projectPreview(sessionId, input) {
    return runInSessionProject(sessionId, async ({ binding, store }) => {
      return readProjectPreview({
        projectSlug: toText(input.projectSlug),
        ...(input.destinationSessionId !== undefined ? { destinationSessionId: toText(input.destinationSessionId) } : {}),
        sourceProject: binding.projectSlug,
        sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function renameSession(sessionId, name) {
    return runInSessionProject(sessionId, async ({ store }) => {
      const sessionName = await store.writeSessionLabel(sessionId, name);
      await publishSessionChanged(sessionId, { reason: "session-renamed", payload: { clientRefresh: { includeList: true } } });
      return { ok: true, sessionId, sessionName };
    });
  }

  async function sessionStatus(sessionId) {
    return runInSessionProject(sessionId, ({ descriptor, project: projectRecord, sourceRoot, store }) => readAgentSessionStatus({
      descriptor,
      project,
      projectRecord,
      sessionId,
      sourceRoot,
      store
    }));
  }

  /**
   * Runs the session's complete declared setup again, like Retry on its card.
   * It returns once preparation starts; session status reports the result.
   */
  async function retrySetup(sessionId) {
    return runInSessionProject(sessionId, async () => {
      const setup = await retryWorkspaceSetup(sessionId);
      if (setup?.ok === false) return setup;
      const state = workspaceSetupState(setup?.state);
      return {
        ok: true,
        sessionId,
        workspaceSetup: { status: state.status, currentLabel: state.currentLabel, diagnostic: state.diagnostic },
        next: state.status === "running"
          ? "Workspace setup is running. Read vibe64-helper session status --json until workspaceSetup.status is no longer running."
          : ""
      };
    });
  }

  async function managePlan(sessionId, input) {
    return runInSessionProject(sessionId, async ({ store }) => {
      const request = JSON.parse(await store.readMetadataValue(sessionId, "assistant_routing_request") || "null");
      if (input.operation === "outcome") {
        return reportWorkflowOutcome(sessionId, input, { vibe64User: request?.submittedBy || null });
      }
      let role = "";
      if (request?.reason !== "conversation" &&
          request?.task !== "deslop" &&
          request?.status === "working" &&
          request.delivery === "accepted") {
        role = request.stage === "review" && request.followup ? "review" : request.resolvedMode;
      }
      const result = await manageWorkPlan({ runtime: { store }, session: { sessionId } }, input, role);
      if (!["read", "history"].includes(input.operation)) {
        await publishSessionChanged(sessionId, { reason: "work-plan-changed", payload: { planNotice: result.notice || "" } });
      }
      return {
        ok: true,
        ...result,
        ...(input.operation === "read" ? {
          workflow: request?.mode === "auto" && (request.workflow || request.stage === "planning") ? {
            messageId: request.messageId,
            turnId: request.turnId || "",
            stage: request.stage,
            status: request.status
          } : null
        } : {})
      };
    });
  }

  async function execute(input = {}, context = {}) {
    input.signal?.throwIfAborted();
    const command = decodedCommand(input.commandBase64);
    if (!command) {
      return commandLineFailure(
        "Vibe64 session command input is invalid.",
        "vibe64_agent_session_command_invalid",
        { exitCode: 2 }
      );
    }
    const cwd = validateCommandCwd(input.cwd, context.sourceRoot);
    if (cwd.ok === false) {
      return cwd;
    }
    const runtimeConfigEnv = await loadProjectExecutionEnv({
      project,
      session: { ...context.descriptor, sessionId: toText(input.sessionId) }
    });
    const commandId = randomUUID();
    const runRoot = path.join(
      commandRunsHostPath(context.binding.wrapperHostDir),
      commandId
    );
    const outputPath = path.join(runRoot, "output.log");
    const resultPath = path.join(runRoot, "result.txt");
    await mkdir(runRoot, {
      mode: 0o700,
      recursive: true
    });
    const childEnv = {
      ...sanitizedCommandEnvironment(input.env),
      ...genesisParserEnvironment(),
      [VIBE64_AGENT_SESSION_RUN_COMMAND_ENV]: Buffer.from(command, "utf8").toString("base64"),
      [VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV]: outputPath,
      [VIBE64_AGENT_SESSION_RUN_RESULT_ENV]: resultPath
    };
    const projectSlug = context.binding.projectSlug;
    input.signal?.throwIfAborted();
    const started = await runCommand({
      actor: "app",
      allowedRoots: [context.sourceRoot],
      args: [],
      baseEnv: childEnv,
      command: runnerHostPath(context.binding.wrapperHostDir),
      cwd: cwd.cwd,
      envPolicy: "session",
      execution: {
        kind: "job",
        label: "Agent command",
        lifecycle: "service",
        operationId: `agent-command-${shortCommandHash(commandId)}`,
        ownerId: toText(input.sessionId),
        projectSlug,
        sessionId: toText(input.sessionId)
      },
      inheritProcessEnv: false,
      mode: "detached",
      project: {
        ...context.project,
        runtimeConfigEnv,
        slug: projectSlug
      },
      purpose: "terminal",
      runtimes: VIBE64_INTERACTIVE_RUNTIME_PACKS,
      session: {
        ...context.descriptor,
        sessionId: toText(input.sessionId),
        sourcePath: context.sourceRoot
      },
      shimDirs: withGenesisCommandShim([context.binding.wrapperHostDir]),
      timeout: AGENT_SESSION_COMMAND_TIMEOUT_MS
    });
    const executionId = toText(started?.execution?.id);
    if (started?.ok !== true || !executionId) {
      await rm(runRoot, { force: true, recursive: true }).catch(() => null);
      return commandLineFailure(
        toText(started?.error || started?.stderr || started?.output) || "Vibe64 could not start this session command.",
        toText(started?.code) || "vibe64_agent_session_command_start_failed"
      );
    }
    const executions = sessionExecutions.get(toText(input.sessionId)) || new Set();
    executions.add(executionId);
    sessionExecutions.set(toText(input.sessionId), executions);
    try {
      const exitCodeText = await waitForCommandResult(resultPath, {
        signal: input.signal,
        timeoutMs: AGENT_SESSION_COMMAND_TIMEOUT_MS
      });
      const exitCode = Number.parseInt(exitCodeText, 10);
      const output = await readBoundedFile(outputPath).catch((error) => (
        error?.code === "ENOENT" ? "" : Promise.reject(error)
      ));
      const normalizedExitCode = Number.isInteger(exitCode) ? exitCode : 1;
      return {
        execution: started.execution,
        exitCode: normalizedExitCode,
        ok: normalizedExitCode === 0,
        output,
        stderr: normalizedExitCode === 0 ? "" : output,
        stdout: normalizedExitCode === 0 ? output : ""
      };
    } catch (error) {
      await stopExecution(executionId, {
        reason: error?.code || "agent-session-command-failed"
      }).catch(() => null);
      throw error;
    }
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const sessionId = toText(input.sessionId);
    const abortController = new AbortController();
    const runs = sessionRuns.get(sessionId) || new Set();
    runs.add(abortController);
    sessionRuns.set(sessionId, runs);
    const abort = () => abortController.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    let result;
    try {
      if (!sessionId) {
        throw vibe64Error(
          "Vibe64 session command session id is required.",
          "vibe64_agent_session_command_session_required"
        );
      }
      result = await runInSessionProject(
        sessionId,
        (context) => execute({ ...input, signal: abortController.signal }, context)
      );
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_agent_session_command_failed",
        fallbackMessage: "Vibe64 session command failed."
      });
      result = commandLineFailure(payload.error, payload.code);
    } finally {
      input.signal?.removeEventListener("abort", abort);
      runs.delete(abortController);
      if (sessionRuns.get(sessionId) === runs && runs.size === 0) {
        sessionRuns.delete(sessionId);
      }
    }
    logOperationalEvent(logger, result?.ok === false ? "warn" : "info", {
      code: toText(result?.code),
      component: "vibe64.agent_session_command",
      durationMs: Date.now() - startedAtMs,
      event: "vibe64.agent_session_command.finished",
      executionId: toText(result?.execution?.id),
      exitCode: Number(result?.exitCode ?? (result?.ok === false ? 1 : 0)),
      ok: result?.ok !== false,
      sessionId
    }, "Vibe64 agent session command finished.");
    return result;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = toText(sessionId);
    const binding = projectBinding.forget(normalizedSessionId);
    for (const abortController of sessionRuns.get(normalizedSessionId) || []) {
      abortController.abort();
    }
    sessionRuns.delete(normalizedSessionId);
    const executions = [...(sessionExecutions.get(normalizedSessionId) || [])];
    sessionExecutions.delete(normalizedSessionId);
    const owned = await stopOwnedExecutions({
      ownerId: normalizedSessionId,
      sessionId: normalizedSessionId
    }, {
      reason: "session-close"
    }).catch(() => ({ supported: false }));
    const proofs = owned?.supported === true
      ? (Array.isArray(owned.processExitProofs) ? owned.processExitProofs : [owned])
      : await Promise.all(executions.map((executionId) => (
        stopExecution(executionId, {
          reason: "session-close"
        }).catch((error) => ({
          error: error?.message || String(error),
          executionId,
          ok: false
        }))
      )));
    const closed = await commandServers.closeForSession(normalizedSessionId);
    const stoppedExecutionCount = owned?.supported === true
      ? Number(owned.closed || 0)
      : proofs.filter((proof) => proof?.stopped === true).length;
    if (binding?.wrapperHostDir) {
      await rm(commandRunsHostPath(binding.wrapperHostDir), {
        force: true,
        recursive: true
      }).catch(() => null);
    }
    return {
      closed: closed + stoppedExecutionCount,
      ok: proofs.every((proof) => proof?.ok !== false || proof?.code === "vibe64_execution_not_found"),
      processExitProofs: proofs
    };
  }

  return Object.freeze({
    logger,
    bindSession,
    closeAllForSession,
    renameSession,
    listProject,
    messageProject,
    projectPreview,
    sessionStatus,
    retrySetup,
    managePlan,
    run
  });
}

/**
 * @param {object} options
 * @param {AgentSessionCommandService} options.commandService
 * @param {string} [options.sessionId]
 * @param {string} [options.wrapperHostDir]
 */
async function prepareAgentSessionCommand({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
}) {
  const normalizedSessionId = toText(sessionId);
  const normalizedWrapperHostDir = toText(wrapperHostDir);
  if (!normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  await commandService.bindSession(normalizedSessionId, {
    wrapperHostDir: normalizedWrapperHostDir
  });
  await Promise.all([
    writeExecutableFileIfChanged(path.join(normalizedWrapperHostDir, "vibe64-plan"), planCommandSource(SESSION_RENAME_CONTROL_ENV)),
    writeExecutableFileIfChanged(path.join(normalizedWrapperHostDir, "vibe64-session"), sessionRenameCommandSource()),
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      commandWrapperSource()
    ),
    writeExecutableFileIfChanged(
      runnerHostPath(normalizedWrapperHostDir),
      commandRunnerSource()
    )
  ]);
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: commandSocketHostPath(normalizedWrapperHostDir)
  });
  return {
    controlGenerationId: server.generationId,
    env: {
      [SESSION_RENAME_CONTROL_ENV]: JSON.stringify({
        socketPath: server.socketPath,
        sessionId: normalizedSessionId,
        generationId: server.generationId,
        token: server.controlToken
      }),
      [VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV]: AGENT_SESSION_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV]: server.token,
      [VIBE64_WRAPPER_ENV]: wrapperHostPath(normalizedWrapperHostDir)
    },
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  createAgentSessionCommandService,
  prepareAgentSessionCommand
};
