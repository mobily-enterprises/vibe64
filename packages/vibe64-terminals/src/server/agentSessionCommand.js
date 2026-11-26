import {
  captureProjectRequestContext,
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { manageWorkPlan } from "./assistantWorkPlan.js";
import { planPassItemsCheck, planPassListing, withAfterPlanPasses } from "./planPasses.js";
import { listGenesisPasses } from "@local/vibe64-genesis/server";
import { planCommandSource } from "./agentPlanCommand.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { readAgentSessionStatus } from "./agentSessionStatus.js";
import { runAgentSessionSave } from "./agentSessionSave.js";
import { agentSessionUpdateAnswer } from "./agentSessionUpdate.js";
import {
  WORKSPACE_SETUP_METADATA_NAME,
  workspaceSetupState,
  workspaceSetupStateFromMetadata
} from "@local/vibe64-runtime/server/workspaceSetupState";
import { assertSessionTempRootFits } from "@local/vibe64-runtime/server/sessionTempFolder";

import { refuseUnreadFields } from "@local/vibe64-core/server/commandInput";
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
  agentControlFilePath,
  runVibe64Command,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  writeAgentControlFile
} from "@local/vibe64-execution/server";
import {
  genesisParserEnvironment,
  withGenesisCommandShim
} from "@local/vibe64-genesis/server";
import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import { createSessionCommandRuns } from "./sessionCommandRuns.js";
import {
  HELPER_GROUP_ROUTE,
  NO_HELPER_COMMAND_GROUPS,
  createHelperGroupRunner,
  streamHelperGroup,
  writeHelperGroupClient
} from "./helperCommandGroups.js";
import {
  createSessionCommandServers,
  shortCommandHash
} from "./unixJsonCommand.js";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  AGENT_SESSION_COMMAND_CONTRACT_VERSION,
  AGENT_SESSION_COMMAND_TIMEOUT_MS,
  commandRunnerSource,
  commandRunsHostPath,
  commandSocketHostPath,
  commandWrapperSource,
  decodedCommand,
  readBoundedFile,
  runnerHostPath,
  sanitizedCommandEnvironment,
  SESSION_RENAME_CONTROL_ENV,
  sessionCommandCwd,
  sessionRenameCommandSource,
  VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV,
  VIBE64_AGENT_SESSION_RUN_COMMAND_ENV,
  VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV,
  VIBE64_AGENT_SESSION_RUN_RESULT_ENV,
  VIBE64_WRAPPER_ENV,
  SESSION_COMMAND_FIELDS,
  waitForSessionCommand,
  wrapperHostPath
} from "./agentSessionCommandRun.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { assistantPlanRole } from "./assistantRoutingRequests.js";
import { sessionSourceState } from "./planSourceChanges.js";
import { handPlanOver, refusedPlanChange } from "./assistantPlanHandoff.js";
import { commandLineFailure } from "./commandFailure.js";
import { rememberAfterPlanBase } from "./afterPlanBase.js";
import { createAgentCommandRepeats, createTurnCommandRepeats } from "./agentCommandRepeats.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */

const AGENT_SESSION_COMMAND_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
// What plan outcome reads: the workflow identity a plan read returns, under the same names, and the outcome itself.
const OUTCOME_FIELDS = Object.freeze({
  operation: "plan outcome",
  fields: ["messageId", "turnId", "stage", "status", "decision", "explanation", "progress", "expectedRevision", "expectedProgressRevision"],
  required: ["messageId", "turnId", "stage", "decision", "explanation", "progress"]
});

// Every route but run is authorized by the control token rather than the
// shell-execution token, and hands its command the agent's own fields.
const controlRoute = (name) => ({
  handle: ({ commandService, fields, sessionId }) => commandService[name](sessionId, fields),
  status: vibe64StatusCode,
  token: "controlToken"
});
const commandServers = createSessionCommandServers({
  routePrefix: "/agent-session-command",
  routes: {
    "/agent-session-command/list-project": controlRoute("listProject"),
    "/agent-session-command/message-project": controlRoute("messageProject"),
    "/agent-session-command/project-preview": controlRoute("projectPreview"),
    "/agent-session-command/rename": controlRoute("renameSession"),
    "/agent-session-command/setup-retry": controlRoute("retrySetup"),
    "/agent-session-command/status": controlRoute("sessionStatus"),
    "/agent-session-command/update": controlRoute("updateSession"),
    "/agent-session-command/save": controlRoute("saveSession"),
    "/agent-session-command/plan": controlRoute("managePlan"),
    [HELPER_GROUP_ROUTE]: { handle: streamHelperGroup, token: "controlToken" },
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
 * @param {(sessionId: string, input: object, options: object) => Promise<object>} dependencies.handPlanToSenior Records,
 *   for Auto's running turn, a plan change only Senior may make, which routing hands to Senior once the turn ends
 * @param {(sessionId: string) => Promise<object>} dependencies.retryWorkspaceSetup
 * @param {(sessionId: string, input: object) => Promise<object>} dependencies.updateSessionWork the session's own Update
 * @param {(sessionId: string, input: object) => Promise<object>} dependencies.saveSessionWork the session's own Save, to
 * the destination it has now
 * @param {(sessionId: string, time: string) => boolean} dependencies.previewStartedBefore whether the session's
 * Preview runs in a process started before `time`
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {typeof stopVibe64Execution} [dependencies.stopExecution]
 * @param {typeof stopVibe64OwnedExecutions} [dependencies.stopOwnedExecutions]
 * @param {import("./types.js").HelperCommandGroup[]} [dependencies.helperCommandGroups] a host's own vibe64-helper groups
 * @param {import("./agentCommandRepeats.js").NoteAgent} dependencies.noteAgent Vibe64's note to the running Main turn
 * @param {ReturnType<typeof createAgentCommandRepeats>} [dependencies.commandRepeats] each Main turn's repeated commands
 * @param {() => number} [dependencies.now] the clock a command's duration for its repeats is read from
 */
function createAgentSessionCommandService({
  listProjectSessions,
  sendProjectMessage,
  readProjectPreview,
  reportWorkflowOutcome,
  handPlanToSenior,
  retryWorkspaceSetup,
  updateSessionWork,
  saveSessionWork,
  previewStartedBefore,
  logger,
  project,
  publishSessionChanged,
  listPasses = listGenesisPasses,
  runCommand = runVibe64Command,
  stopExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions,
  helperCommandGroups = NO_HELPER_COMMAND_GROUPS,
  noteAgent,
  commandRepeats = createAgentCommandRepeats(),
  now = Date.now
}) {
  const projectBinding = createAgentCommandProjectBinding(project, {
    sessionRequired: ["Vibe64 session command binding is incomplete.", "vibe64_agent_session_command_binding_required"],
    projectRequired: ["Vibe64 session commands require a project.", "vibe64_agent_session_command_project_required"],
    unbound: ["This shell command is not bound to an active Vibe64 session.", "vibe64_agent_session_command_session_unbound"],
    changed: ["The shell command session no longer matches its bound project.", "vibe64_agent_session_command_project_binding_changed"]
  });
  const sessionExecutions = new Map();
  const sessionRuns = createSessionCommandRuns();

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
   * Runs a session command in its bound project: once the binding is checked, a field the command does not read, or
   * a missing one it needs, is refused before it acts (SESSION_COMMAND_FIELDS).
   */
  function runSessionCommand(sessionId, name, input, operation) {
    return runInSessionProject(sessionId, (bound) => {
      refuseUnreadFields(input, SESSION_COMMAND_FIELDS[name]);
      return operation(bound);
    });
  }

  /**
   * Cross-project commands act for the person who submitted the current request; its turn, while it works.
   * @param {Vibe64SessionStore} store
   * @param {string} sessionId
   * @param {object} binding
   */
  async function requestTurn(store, sessionId, binding) {
    const routing = JSON.parse(await store.readMetadataValue(sessionId, "assistant_routing_request") || "null");
    return {
      actor: routing?.submittedBy || binding.actor,
      turnId: routing?.status === "working" ? toText(routing.turnId) : ""
    };
  }
  const requestActor = async (store, sessionId, binding) => (await requestTurn(store, sessionId, binding)).actor;
  const helperGroups = createHelperGroupRunner({ groups: helperCommandGroups, runInSessionProject, requestTurn, sessionRuns });

  async function listProject(sessionId, input) {
    return runSessionCommand(sessionId, "listProject", input, async ({ binding, store }) => {
      return listProjectSessions({
        projectSlug: toText(input.projectSlug),
        sourceProject: binding.projectSlug,
        sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function messageProject(sessionId, input) {
    return runSessionCommand(sessionId, "messageProject", input, async ({ binding, store }) => {
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
    return runSessionCommand(sessionId, "projectPreview", input, async ({ binding, store }) => {
      return readProjectPreview({
        projectSlug: toText(input.projectSlug),
        ...(input.destinationSessionId !== undefined ? { destinationSessionId: toText(input.destinationSessionId) } : {}),
        sourceProject: binding.projectSlug,
        sourceSession: sessionId,
        actor: await requestActor(store, sessionId, binding)
      });
    });
  }

  async function renameSession(sessionId, input) {
    return runSessionCommand(sessionId, "renameSession", input, async ({ store }) => {
      const sessionName = await store.writeSessionLabel(sessionId, input.name);
      await publishSessionChanged(sessionId, { reason: "session-renamed", payload: { clientRefresh: { includeList: true } } });
      return { ok: true, sessionId, sessionName };
    });
  }

  async function sessionStatus(sessionId, input = {}) {
    return runSessionCommand(sessionId, "sessionStatus", input, ({ descriptor, project: projectRecord, sourceRoot, store }) => readAgentSessionStatus({
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
  async function retrySetup(sessionId, input = {}) {
    return runSessionCommand(sessionId, "retrySetup", input, async () => {
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

  /**
   * Runs the session's own Update, the one its Update button runs, for the person whose request the AI is working
   * on, and answers with what moved and what to do next. The AI runs it from inside its own turn: Update holds the
   * session only while it changes files, keeps the AI's unsaved work, and steers no turn, since this answer already
   * says which files changed. `reviewedConflictId` applies a repaired conflict, as Review resolved conflicts does.
   * @param {string} sessionId
   * @param {{ reviewedConflictId?: string }} input
   */
  async function updateSession(sessionId, input = {}) {
    return runSessionCommand(sessionId, "updateSession", input, async ({ binding, store }) => {
      const startedAt = new Date().toISOString();
      const reviewedConflictId = toText(input.reviewedConflictId);
      const result = await updateSessionWork(sessionId, {
        ...(reviewedConflictId ? { reviewedConflictId } : {}),
        requestedByAgent: true,
        vibe64User: await requestActor(store, sessionId, binding)
      });
      const setup = workspaceSetupStateFromMetadata({
        [WORKSPACE_SETUP_METADATA_NAME]: await store.readMetadataValue(sessionId, WORKSPACE_SETUP_METADATA_NAME)
      });
      return {
        sessionId,
        ...agentSessionUpdateAnswer(result, {
          previewStartedBefore: previewStartedBefore(sessionId, startedAt),
          setupRunning: setup.status === "running"
        })
      };
    });
  }

  /**
   * `vibe64-helper session save`: the session's own Save, for the main chat's AI while its Automatically save
   * changes is on (`runAgentSessionSave` decides whose command it is).
   * @param {string} sessionId
   */
  function saveSession(sessionId, input = {}) {
    return runSessionCommand(sessionId, "saveSession", input, async ({ binding, store }) => ({
      sessionId,
      ...await runAgentSessionSave({ actor: () => requestActor(store, sessionId, binding), saveSessionWork, sessionId, store })
    }));
  }

  async function managePlan(sessionId, input) {
    return runInSessionProject(sessionId, async ({ store, descriptor }) => {
      const request = JSON.parse(await store.readMetadataValue(sessionId, "assistant_routing_request") || "null");
      const { operation, ...fields } = input;
      if (operation === "outcome") {
        refuseUnreadFields(fields, OUTCOME_FIELDS);
        return reportWorkflowOutcome(sessionId, input, { vibe64User: request?.submittedBy || null });
      }
      if (operation === "handoff") {
        refuseUnreadFields(fields, { operation: "plan handoff", fields: [] });
        return { ok: true, ...await handPlanOver({ sessionId, request, handPlanToSenior }) };
      }
      // A plan's pass ticks only its own Passes item, and a new plan in a chat whose plans run passes gets them.
      const role = assistantPlanRole(request);
      const readListing = planPassListing(listPasses, { store, sessionId, descriptor });
      const planInput = input.operation === "new" && request?.afterPlan && ["senior", "review"].includes(role)
        ? { ...input, text: await withAfterPlanPasses(input.text, store, sessionId, readListing) } : input;
      let result;
      try {
        // The AI's change records the session's source as it is now: the plan view counts the files changed since.
        result = await manageWorkPlan({ runtime: { store }, session: { sessionId } }, planInput, role, {
          ...(role === "pass" ? { passItem: request.pass.item } : {}),
          sourceState: () => sessionSourceState(store, sessionId, descriptor),
          agent: true,
          checkPassItems: planPassItemsCheck(readListing)
        });
      } catch (error) {
        throw await refusedPlanChange({ sessionId, request, input, error, handPlanToSenior, logger });
      }
      // A plan becoming current marks where its changes start, unless a base is recorded.
      if (["new", "reopen"].includes(input.operation)) await rememberAfterPlanBase(store, { ...descriptor, sessionId }, { onlyWhenUnset: true });
      if (!["read", "history"].includes(input.operation)) await publishSessionChanged(sessionId, { reason: "work-plan-changed", payload: { planNotice: result.notice || "" } });
      return {
        ok: true,
        ...result,
        ...(input.operation === "read" ? {
          workflow: request?.workflow || request?.mode === "auto" && request.stage === "planning" ? {
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
    const cwd = await sessionCommandCwd(input.cwd, context.sourceRoot);
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
    await mkdir(runRoot, { mode: 0o700, recursive: true });
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
      allowedRoots: cwd.allowedRoots,
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
      tempDirectory: cwd.tempDirectory,
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
      const exitCodeText = await waitForSessionCommand(resultPath, { ...input, command });
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

  const repeats = createTurnCommandRepeats({
    commandRepeats, logger, noteAgent, now, publishSessionChanged, requestTurn, runInSessionProject
  });

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const sessionId = toText(input.sessionId);
    const counted = repeats.begin(sessionId, input.commandBase64);
    const tracked = sessionRuns.track(sessionId, input.signal);
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
        (context) => execute({ ...input, signal: tracked.signal }, context)
      );
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_agent_session_command_failed",
        fallbackMessage: "Vibe64 session command failed."
      });
      result = commandLineFailure(payload.error, payload.code);
    } finally {
      tracked.end();
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
    // A command that ran counts toward its turn's repeats, once it has answered; one refused before it started does not.
    if (result?.execution?.id) counted();
    return result;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = toText(sessionId);
    const binding = projectBinding.forget(normalizedSessionId);
    sessionRuns.cancelSession(normalizedSessionId);
    repeats.forget(normalizedSessionId);
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
    updateSession,
    saveSession,
    managePlan,
    run,
    summarizeTurnCommands: repeats.summarize,
    helperGroups: helperGroups.listing,
    runHelperGroup: helperGroups.run
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
    return { env: {}, ok: false };
  }
  assertSessionTempRootFits(); // a TMPDIR too long for its sessions' sockets stops the AI here, naming the fix
  await commandService.bindSession(normalizedSessionId, {
    wrapperHostDir: normalizedWrapperHostDir
  });
  // The session control's file holds its control token, never the shell-execution token managed child commands lack.
  const controlFilePath = agentControlFilePath(normalizedWrapperHostDir, "session");
  await Promise.all([
    writeExecutableFileIfChanged(path.join(normalizedWrapperHostDir, "vibe64-plan"), planCommandSource(SESSION_RENAME_CONTROL_ENV, controlFilePath)),
    writeExecutableFileIfChanged(path.join(normalizedWrapperHostDir, "vibe64-session"), sessionRenameCommandSource(controlFilePath)),
    writeExecutableFileIfChanged(wrapperHostPath(normalizedWrapperHostDir), commandWrapperSource()),
    writeExecutableFileIfChanged(runnerHostPath(normalizedWrapperHostDir), commandRunnerSource()),
    writeHelperGroupClient(normalizedWrapperHostDir, controlFilePath, commandService.helperGroups)
  ]);
  const socketPath = commandSocketHostPath(normalizedWrapperHostDir);
  const server = await commandServers.ensure({ commandService, sessionId: normalizedSessionId, socketPath });
  const control = {
    socketPath: server.socketPath,
    sessionId: normalizedSessionId,
    generationId: server.generationId,
    token: server.controlToken
  };
  await writeAgentControlFile(controlFilePath, control);
  return {
    controlGenerationId: server.generationId,
    env: {
      [SESSION_RENAME_CONTROL_ENV]: JSON.stringify(control),
      [VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV]: AGENT_SESSION_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV]: socketPath,
      [VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV]: server.token,
      [VIBE64_WRAPPER_ENV]: wrapperHostPath(normalizedWrapperHostDir)
    },
    hostSocketPath: socketPath,
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  createAgentSessionCommandService,
  prepareAgentSessionCommand
};
