import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  githubSshToHttpsGitEnv
} from "@local/studio-terminal-core/server/gitGithubTransport";
import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  terminalFailureOutputTail
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  studioUserStartupScript
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  vibe64Result,
  commandInvocation,
  commandTerminalNamespace,
  normalizePlainObject,
  pathInsideOrEqual,
  stableHash,
  terminalTargetRoot,
  terminalWorktreePath,
  toolTerminalNamespace
} from "./terminalShared.js";
import {
  COMMAND_RESULT_ENV,
  createCommandResultFileSync,
  readCommandResultFile,
  removeCommandResultFile
} from "./commandTerminalResults.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  resolveTerminalToolchainImage
} from "./terminalToolchainImage.js";
import {
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";
import {
  VIBE64_ACTION_DISPATCH_ROUTES as ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function actionRunsInCommandTerminal(action = {}) {
  return action.dispatchRoute === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL || action.type === "command";
}

async function recordCommandSystemMessage(runtime, sessionId = "", message = "") {
  const text = normalizeText(message);
  if (!text || typeof runtime?.store?.writeConversationSystemMessage !== "function") {
    return null;
  }
  return runtime.store.writeConversationSystemMessage(sessionId, {
    text
  });
}

function commandTerminalContainerName({
  sessionId = "",
  terminalId = ""
} = {}) {
  return `vibe64-command-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function toolTerminalContainerName({
  terminalId = "",
  toolId = ""
} = {}) {
  return `vibe64-tool-${stableHash(toolId)}-${stableHash(terminalId)}`;
}

function sessionRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function sessionStepRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

function commandLifecycleIdForSession(session = {}, action = {}) {
  const stepRevision = sessionStepRevision(session.stepRevision) || 1;
  return `${stepRevision}-${String(action.id || "command").trim() || "command"}`;
}

function inputKeys(input = {}) {
  return Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort();
}

async function writeCommandLifecycleEvent({
  event = {},
  lifecycleId = "",
  patch = {},
  runtime,
  sessionId = ""
} = {}) {
  if (!lifecycleId || typeof runtime?.store?.writeCommandLifecycleEvent !== "function") {
    return null;
  }
  return runtime.store.writeCommandLifecycleEvent(sessionId, lifecycleId, {
    event,
    patch
  });
}

function staleCompletionReason(startedSession = {}, currentSession = {}) {
  if (currentSession.currentStep !== startedSession.currentStep) {
    return "step_changed";
  }
  const startedRevision = sessionStepRevision(startedSession.stepRevision);
  const currentRevision = sessionStepRevision(currentSession.stepRevision);
  if (
    startedRevision !== null &&
    currentRevision !== null &&
    currentRevision !== startedRevision
  ) {
    return "step_revision_changed";
  }
  return "";
}

function refreshRecommendedCommandError(error, session = {}, operationOutcome = "state_rejected") {
  error.operationOutcome = operationOutcome;
  error.refreshRecommended = true;
  error.sessionId = session.sessionId || "";
  error.revision = sessionRevision(session.revision);
  error.currentStep = session.currentStep || "";
  error.stepRevision = sessionStepRevision(session.stepRevision);
  error.stepStatus = session.stepMachine?.status || "";
  return error;
}

function resolveCommandWorkdir(targetRoot = "", cwd = "") {
  const normalizedCwd = String(cwd || "").trim();
  if (!normalizedCwd) {
    return targetRoot;
  }
  return path.isAbsolute(normalizedCwd)
    ? path.resolve(normalizedCwd)
    : path.resolve(targetRoot, normalizedCwd);
}

function commandTerminalArgs({
  args = [],
  command = "",
  containerName = "",
  env = {},
  image,
  mounts = [],
  resultFile = {},
  session = {},
  sessionId = "",
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      studioUserStartupScript([command, ...args])
    ],
    containerName,
    env: {
      ...env,
      ...githubSshToHttpsGitEnv()
    },
    image,
    kind: "command-terminal",
    mounts: [
      {
        source: resultFile.directory,
        target: resultFile.directory
      },
      ...sessionExchangeMounts(session),
      ...mounts
    ],
    sessionId,
    targetRoot,
    terminalId,
    workdir
  });
}

function sessionExchangeMounts(session = {}) {
  return [
    session.artifactsRoot,
    session.metadataRoot
  ]
    .map((source) => String(source || "").trim())
    .filter(Boolean)
    .map((source) => ({
      source,
      target: source
    }));
}

function commandWorkdirAllowed({
  session = {},
  targetRoot = "",
  workdir = ""
} = {}) {
  if (pathInsideOrEqual(targetRoot, workdir)) {
    return true;
  }
  const worktreePath = terminalWorktreePath(session);
  if (!worktreePath || path.resolve(worktreePath) !== path.resolve(workdir)) {
    return false;
  }
  const sessionRoot = String(session.sessionRoot || "").trim();
  return Boolean(sessionRoot) && pathInsideOrEqual(sessionRoot, workdir);
}

async function writeActionTerminalResult({
  advanceOnSuccess = false,
  action = {},
  commandLifecycleId = "",
  exitCode,
  input = {},
  output = "",
  resultFile = {},
  runtime,
  session = {},
  spec = {},
  terminalSessionId = ""
} = {}) {
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.commandTerminal.writeResult.start", {
    actionId: String(action.id || ""),
    advanceOnSuccess,
    exitCode,
    sessionId: String(session.sessionId || ""),
    stepId: String(session.currentStep || "")
  });
  const completed = exitCode === 0;
  await writeCommandLifecycleEvent({
    lifecycleId: commandLifecycleId,
    runtime,
    sessionId: session.sessionId,
    patch: {
      exitCode,
      phase: "result_writing",
      terminalSessionId
    },
    event: {
      kind: "result_writing",
      message: "Command terminal exited; applying command result."
    }
  });
  const currentSessionBeforeWrite = await runtime.getSession(session.sessionId);
  const staleReason = staleCompletionReason(session, currentSessionBeforeWrite);
  if (staleReason) {
    vibe64SessionDebugLog("server.commandTerminal.writeResult.stale", {
      actionId: String(action.id || ""),
      currentStep: String(currentSessionBeforeWrite.currentStep || ""),
      currentRevision: sessionRevision(currentSessionBeforeWrite.revision),
      currentStepRevision: sessionStepRevision(currentSessionBeforeWrite.stepRevision),
      exitCode,
      reason: staleReason,
      sessionId: String(session.sessionId || ""),
      startedRevision: sessionRevision(session.revision),
      startedStepRevision: sessionStepRevision(session.stepRevision),
      startedStep: String(session.currentStep || "")
    });
    await writeCommandLifecycleEvent({
      lifecycleId: commandLifecycleId,
      runtime,
      sessionId: session.sessionId,
      patch: {
        currentStep: String(currentSessionBeforeWrite.currentStep || ""),
        currentStepRevision: sessionStepRevision(currentSessionBeforeWrite.stepRevision),
        exitCode,
        outcome: "stale",
        phase: "done",
        startedStep: String(session.currentStep || ""),
        startedStepRevision: sessionStepRevision(session.stepRevision),
        staleReason,
        terminalSessionId
      },
      event: {
        kind: "stale_completion",
        message: `Ignored stale command completion: ${staleReason}.`,
        outcome: "stale"
      }
    });
    return {
      action,
      actionResult: null,
      commandLifecycleId,
      completed,
      input,
      metadata: {},
      outcome: "stale",
      runtime,
      session: currentSessionBeforeWrite,
      spec,
      stale: true,
      terminalSessionId
    };
  }
  const sessionForWrite = currentSessionBeforeWrite;
  const commandResult = completed ? await readCommandResultFile(resultFile.path) : {
    facts: {}
  };
  const resultApplication = completed ? await applySuccessFacts({
    action,
    facts: commandResult.facts || {},
    input,
    runtime,
    session: sessionForWrite,
    spec
  }) : {
    deleteMetadata: [],
    metadata: {}
  };
  const metadata = completed ? resultApplication.metadata : {};
  const message = completed
    ? spec.successMessage || `${action.label || action.id} completed.`
    : spec.failureMessage || `${action.label || action.id} failed with exit code ${exitCode}.`;
  const failureContext = completed ? {} : {
    attemptedCommand: commandInvocation(spec),
    commandPreview: String(spec.commandPreview || ""),
    exitCode,
    output: terminalFailureOutputTail(output),
    terminalSessionId
  };
  const actionResult = await runtime.store.writeActionResult(
    session.sessionId,
    action.id,
    {
      actionLabel: action.label,
      actionType: "command",
      artifacts: {},
      ...failureContext,
      input,
      message,
      metadata,
      status: completed ? "completed" : "blocked",
      stepId: sessionForWrite.currentStep
    }
  );
  if (completed) {
    await Promise.all(resultApplication.deleteMetadata.map((name) => {
      return runtime.store.deleteMetadataValue(session.sessionId, name);
    }));
    await Promise.all(Object.entries(metadata).map(([name, value]) => {
      return runtime.store.writeMetadataValue(session.sessionId, name, value);
    }));
  }
  await runtime.store.appendCommandLogEntry(session.sessionId, {
    actionId: action.id,
    actionLabel: action.label,
    actionType: "command",
    kind: "terminal-action",
    status: actionResult.status,
    stepId: sessionForWrite.currentStep
  });
  if (typeof runtime.recordCommandActionFinished === "function") {
    await runtime.recordCommandActionFinished(sessionForWrite, action.id, actionResult);
  }
  await recordCommandSystemMessage(
    runtime,
    session.sessionId,
    completed ? action.auditMessage || message : message
  );
  const advancedSession = await advanceSessionAfterSuccessfulCommand({
    advanceOnSuccess,
    completed,
    runtime,
    session: sessionForWrite
  });
  const currentSession = advancedSession || await runtime.getSession(session.sessionId);
  const advanced = completed && currentSession.currentStep !== sessionForWrite.currentStep;
  await writeCommandLifecycleEvent({
    lifecycleId: commandLifecycleId,
    runtime,
    sessionId: session.sessionId,
    patch: {
      actionResultStatus: String(actionResult.status || ""),
      currentStep: String(currentSession.currentStep || ""),
      currentStepRevision: sessionStepRevision(currentSession.stepRevision),
      exitCode,
      metadataKeys: Object.keys(metadata).sort(),
      outcome: completed ? "completed" : "blocked",
      phase: advanced ? "advanced" : "result_written",
      sessionRevisionAfter: sessionRevision(currentSession.revision),
      terminalSessionId
    },
    event: {
      kind: advanced ? "workflow_advanced" : "result_written",
      message: advanced
        ? "Command result was written and the workflow advanced."
        : "Command result was written.",
      outcome: completed ? "completed" : "blocked"
    }
  });
  vibe64SessionDebugLog("server.commandTerminal.writeResult.done", {
    ...vibe64SessionDebugSummary(currentSession),
    actionId: String(action.id || ""),
    actionResultStatus: String(actionResult.status || ""),
    completed,
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    exitCode,
    metadataKeys: Object.keys(metadata).sort()
  });
  return {
    action,
    actionResult,
    commandLifecycleId,
    completed,
    input,
    metadata,
    outcome: completed ? "completed" : "blocked",
    runtime,
    session: currentSession,
    spec,
    terminalSessionId
  };
}

function scheduleCommandTerminalPostCommitTask(label, task, details = {}) {
  const startedAtMs = Date.now();
  vibe64SessionDebugLog(`server.commandTerminal.postCommit.${label}.scheduled`, details);
  void (async () => {
    try {
      await task();
      vibe64SessionDebugLog(`server.commandTerminal.postCommit.${label}.done`, {
        ...details,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs)
      });
    } catch (error) {
      vibe64SessionDebugLog(`server.commandTerminal.postCommit.${label}.error`, {
        ...details,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error)
      });
    }
  })();
}

function scheduleCommandTerminalPostCommitEffects({
  afterSuccessfulCommand = async () => null,
  completion = {},
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const shouldRunAfterSuccessfulCommand = completion?.completed === true &&
    completion?.stale !== true &&
    Boolean(completion?.actionResult);
  scheduleCommandTerminalPostCommitTask("effects", async () => {
    await writeCommandLifecycleEvent({
      lifecycleId: completion.commandLifecycleId,
      runtime: completion.runtime,
      sessionId: completion.session?.sessionId || sessionId,
      patch: {
        phase: "post_commit_running",
        postCommit: {
          afterSuccessfulCommand: shouldRunAfterSuccessfulCommand ? "running" : "skipped",
          publishSessionChanged: "running"
        }
      },
      event: {
        kind: "post_commit_running",
        message: "Command result is committed; running post-commit effects."
      }
    });
    const publishResult = await Promise.allSettled([
      publishSessionChanged(sessionId, {
        reason: "command-terminal-closed",
        session: completion.session
      }),
      shouldRunAfterSuccessfulCommand
        ? afterSuccessfulCommand({
            action: completion.action,
            actionResult: completion.actionResult,
            input: completion.input,
            metadata: completion.metadata,
            runtime: completion.runtime,
            session: completion.session,
            spec: completion.spec
          })
        : Promise.resolve(null)
    ]);
    const [publishOutcome, afterSuccessfulCommandOutcome] = publishResult;
    const postCommitFailed = publishOutcome.status === "rejected" ||
      afterSuccessfulCommandOutcome.status === "rejected";
    const afterSuccessfulCommandStatus = shouldRunAfterSuccessfulCommand
      ? afterSuccessfulCommandOutcome.status === "fulfilled" ? "done" : "failed"
      : "skipped";
    await writeCommandLifecycleEvent({
      lifecycleId: completion.commandLifecycleId,
      runtime: completion.runtime,
      sessionId: completion.session?.sessionId || sessionId,
      patch: {
        outcome: postCommitFailed ? "post_commit_failed" : completion.outcome || "",
        phase: postCommitFailed ? "failed" : "done",
        postCommit: {
          afterSuccessfulCommand: afterSuccessfulCommandStatus,
          afterSuccessfulCommandError: afterSuccessfulCommandOutcome.status === "rejected"
            ? vibe64SessionDebugError(afterSuccessfulCommandOutcome.reason)
            : "",
          publishSessionChanged: publishOutcome.status === "fulfilled" ? "done" : "failed",
          publishSessionChangedError: publishOutcome.status === "rejected"
            ? vibe64SessionDebugError(publishOutcome.reason)
            : ""
        }
      },
      event: {
        kind: postCommitFailed ? "post_commit_failed" : "done",
        message: postCommitFailed
          ? "Command post-commit effects failed."
          : "Command lifecycle completed.",
        outcome: postCommitFailed ? "post_commit_failed" : completion.outcome || ""
      }
    });
  }, {
    actionId: String(completion.action?.id || ""),
    reason: "command-terminal-closed",
    sessionId: String(completion.session?.sessionId || sessionId || "")
  });
}

async function advanceSessionAfterSuccessfulCommand({
  advanceOnSuccess = false,
  completed = false,
  runtime,
  session = {}
} = {}) {
  if (!advanceOnSuccess || !completed) {
    vibe64SessionDebugLog("server.commandTerminal.advanceAfterSuccess.skipped", {
      advanceOnSuccess,
      completed,
      hasAdvance: typeof runtime?.advance === "function",
      sessionId: String(session.sessionId || "")
    });
    return null;
  }
  if (typeof runtime?.advance !== "function") {
    throw vibe64Error(
      "Vibe64 runtime advance is not available for command completion.",
      "vibe64_runtime_advance_not_available"
    );
  }

  const refreshedSession = await runtime.getSession(session.sessionId);
  if (
    refreshedSession?.next?.visible === true &&
    refreshedSession.next.enabled === true &&
    refreshedSession.next.stepId
  ) {
    vibe64SessionDebugLog("server.commandTerminal.advanceAfterSuccess.start", {
      ...vibe64SessionDebugSummary(refreshedSession)
    });
    return runtime.advance(session.sessionId);
  }
  vibe64SessionDebugLog("server.commandTerminal.advanceAfterSuccess.notReady", {
    ...vibe64SessionDebugSummary(refreshedSession),
    nextDisabledReason: String(refreshedSession?.next?.disabledReason || ""),
    nextVisible: refreshedSession?.next?.visible === true
  });
  return refreshedSession;
}

function normalizeMetadataMap(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata || {}).map(([name, value]) => [
    String(name || "").trim(),
    String(value || "").trim()
  ]).filter(([name]) => Boolean(name)));
}

function normalizeDeleteMetadata(names = []) {
  return Array.from(new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)));
}

async function applySuccessFacts({
  action = {},
  facts = {},
  input = {},
  runtime,
  session = {},
  spec = {}
} = {}) {
  const factApplication = typeof spec.applySuccessFacts === "function"
    ? await spec.applySuccessFacts({
        action,
        facts,
        input,
        runtime,
        session
      })
    : {};
  return {
    deleteMetadata: normalizeDeleteMetadata(factApplication.deleteMetadata),
    metadata: {
      ...normalizeMetadataMap(spec.successMetadata),
      ...normalizeMetadataMap(factApplication.metadata)
    }
  };
}

async function startCommandTerminalProcess({
  containerName,
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  maxRunning = 1,
  metadata = {},
  namespace = "",
  namespaceLimitPrefix = "",
  onClose = async () => null,
  projectService,
  resolveToolchainImage = resolveTerminalToolchainImage,
  reuseRunning = true,
  runtime,
  session = {},
  spec = {},
  startTerminal = startTerminalSession,
  target = "command",
  targetRoot = ""
} = {}) {
  const workdir = resolveCommandWorkdir(targetRoot, spec.cwd);
  if (!commandWorkdirAllowed({
    session,
    targetRoot,
    workdir
  })) {
    return {
      ok: false,
      error: "Vibe64 command workdir is outside the target root."
    };
  }

  const imageResult = await resolveToolchainImage({
    runtime,
    session,
    target,
    targetRoot
  });
  if (imageResult.ok === false) {
    return imageResult;
  }

  await ensureRuntimeNetwork(targetRoot);
  await ensureAdapterRuntimeContainers({
    runtime,
    session,
    target,
    targetRoot
  });
  const terminalEnv = await projectTerminalEnvironment({
    projectService,
    runtime,
    session,
    target,
    targetRoot
  });
  const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
  let resultFile = null;
  const commandResultFile = () => {
    if (!resultFile) {
      resultFile = createCommandResultFileSync();
    }
    return resultFile;
  };

  return startTerminal({
    args: (terminalContext) => {
      const activeResultFile = commandResultFile();
      const specEnv = typeof spec.env === "function" ? spec.env(terminalContext) : spec.env || {};
      return commandTerminalArgs({
        args: spec.args || [],
        command: spec.command,
        containerName: containerName(terminalContext),
        env: {
          ...terminalEnv,
          ...specEnv,
          [COMMAND_RESULT_ENV]: activeResultFile.path
        },
        image: imageResult.image,
        mounts: Array.isArray(spec.mounts) ? spec.mounts : [],
        resultFile: activeResultFile,
        session,
        sessionId: session.sessionId || "",
        targetRoot,
        terminalId: terminalContext.id,
        workdir
      });
    },
    command: "docker",
    commandPreview: spec.commandPreview,
    cwd: workdir,
    maxRunning,
    metadata: {
      attemptedCommand: commandInvocation(spec),
      cwd: workdir,
      envHash: terminalEnvHash,
      image: imageResult.image,
      imageLabel: imageResult.label,
      targetRoot,
      ...metadata
    },
    namespace,
    namespaceLimitPrefix: namespaceLimitPrefix || namespace,
    onClose: async ({ exitCode, id }) => {
      const activeResultFile = resultFile || {};
      try {
        await onClose({
          exitCode,
          id,
          resultFile: activeResultFile
        });
      } finally {
        await removeCommandResultFile(activeResultFile);
      }
    },
    reuseRunning
  });
}

function createCommandTerminalController({
  afterSuccessfulCommand = async () => null,
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  projectService,
  publishSessionChanged = async () => null,
  resolveToolchainImage = resolveTerminalToolchainImage,
  startTerminal = startTerminalSession
} = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(commandTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      const startedAtMs = Date.now();
      const requestedActionId = String(input?.actionId || "").trim();
      vibe64SessionDebugLog("server.commandTerminal.start.start", {
        actionId: requestedActionId,
        advanceOnSuccess: input?.advanceOnSuccess === true,
        inputKeys: Object.keys(normalizePlainObject(input?.input)).sort(),
        sessionId
      });
      return vibe64Result(async () => {
        try {
          const actionId = requestedActionId;
          const runtime = await projectService.createRuntime();
          const session = await runtime.getSession(sessionId);
          vibe64SessionDebugLog("server.commandTerminal.start.sessionLoaded", {
            ...vibe64SessionDebugSummary(session),
            actionId
          });
          const action = actionById(session, actionId);
          if (!action) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "action_not_available"
            });
            throw refreshRecommendedCommandError(vibe64Error(
              `Action ${actionId || "(empty)"} is not available on this Vibe64 step.`,
              "vibe64_action_not_available"
            ), session, "stale_operation");
          }
          if (!actionRunsInCommandTerminal(action)) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "command_requires_terminal"
            });
            throw vibe64Error(
              `Action ${action.label || action.id} does not run in the command terminal.`,
              "vibe64_command_requires_terminal"
            );
          }
          if (action.enabled !== true) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "action_disabled"
            });
            throw refreshRecommendedCommandError(vibe64Error(
              action.disabledReason || `Action ${action.label || action.id} is disabled.`,
              "vibe64_action_disabled"
            ), session, "state_rejected");
          }
          const targetRoot = terminalTargetRoot(session, projectService);
          if (!targetRoot) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "missing_target_root"
            });
            return {
              ok: false,
              error: "Vibe64 command target root is not available."
            };
          }

          const advanceOnSuccess = input?.advanceOnSuccess === true;
          const commandInput = normalizePlainObject(input?.input);
          const spec = await runtime.adapter.createCommandTerminalSpec(action.id, {
            action,
            config: runtime.projectConfig,
            input: commandInput,
            runtime,
            session,
            store: runtime.store
          });
          if (spec?.ok === false) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "spec_not_ready"
            });
            return {
              ok: false,
              error: spec.message || `Command ${action.label || action.id} cannot start.`
            };
          }

          const workdir = resolveCommandWorkdir(targetRoot, spec.cwd);
          if (!commandWorkdirAllowed({
            session,
            targetRoot,
            workdir
          })) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "workdir_outside_target"
            });
            return {
              ok: false,
              error: "Vibe64 command workdir is outside the target root."
            };
          }

          const imageResult = await resolveToolchainImage({
            runtime,
            session,
            target: "command",
            targetRoot
          });
          if (imageResult.ok === false) {
            vibe64SessionDebugLog("server.commandTerminal.start.blocked", {
              ...vibe64SessionDebugSummary(session),
              actionId,
              reason: "toolchain_image",
              toolchainError: String(imageResult.error || "")
            });
            return imageResult;
          }

          await ensureRuntimeNetwork(targetRoot);
          await ensureAdapterRuntimeContainers({
            runtime,
            session,
            target: "command",
            targetRoot
          });
          const terminalEnv = await projectTerminalEnvironment({
            projectService,
            runtime,
            session,
            target: "command",
            targetRoot
          });
          const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
          const namespace = commandTerminalNamespace(sessionId);
          let resultFile = null;
          const commandResultFile = () => {
            if (!resultFile) {
              resultFile = createCommandResultFileSync();
            }
            return resultFile;
          };
          const commandLifecycleId = commandLifecycleIdForSession(session, action);
          await writeCommandLifecycleEvent({
            lifecycleId: commandLifecycleId,
            runtime,
            sessionId,
            patch: {
              actionId: action.id,
              actionLabel: action.label,
              advanceOnSuccess,
              currentStep: String(session.currentStep || ""),
              inputKeys: inputKeys(commandInput),
              phase: "starting",
              sessionRevisionBefore: sessionRevision(session.revision),
              stepId: String(session.currentStep || ""),
              stepRevision: sessionStepRevision(session.stepRevision)
            },
            event: {
              kind: "starting",
              message: "Command terminal start accepted."
            }
          });
          let startedSession = session;
          if (typeof runtime.recordCommandActionStarted === "function") {
            await runtime.recordCommandActionStarted(sessionId, action.id);
            startedSession = await runtime.getSession(sessionId);
          }
          try {
            const terminal = await startTerminal({
              args: (terminalContext) => {
                const activeResultFile = commandResultFile();
                const specEnv = typeof spec.env === "function" ? spec.env(terminalContext) : spec.env || {};
                return commandTerminalArgs({
                  args: spec.args || [],
                  command: spec.command,
                  containerName: commandTerminalContainerName({
                    sessionId,
                    terminalId: terminalContext.id
                  }),
                  env: {
                    ...terminalEnv,
                    ...specEnv,
                    [COMMAND_RESULT_ENV]: activeResultFile.path
                  },
                  image: imageResult.image,
                  mounts: Array.isArray(spec.mounts) ? spec.mounts : [],
                  resultFile: activeResultFile,
                  session,
                  sessionId,
                  targetRoot,
                  terminalId: terminalContext.id,
                  workdir
                });
              },
              command: "docker",
              commandPreview: spec.commandPreview,
              cwd: workdir,
              maxRunning: 1,
              metadata: {
                actionId: action.id,
                actionLabel: action.label,
                attemptedCommand: commandInvocation(spec),
                cwd: workdir,
                envHash: terminalEnvHash,
                image: imageResult.image,
                imageLabel: imageResult.label,
                sessionId
              },
              namespace,
              namespaceLimitPrefix: namespace,
              onClose: async ({ exitCode, id, output }) => {
                const onCloseStartedAtMs = Date.now();
                const activeResultFile = resultFile || {};
                vibe64SessionDebugLog("server.commandTerminal.onClose.start", {
                  actionId: action.id,
                  exitCode,
                  sessionId,
                  terminalSessionId: id
                });
                try {
                  await writeCommandLifecycleEvent({
                    lifecycleId: commandLifecycleId,
                    runtime,
                    sessionId,
                    patch: {
                      exitCode,
                      phase: "terminal_exited",
                      terminalSessionId: id
                    },
                    event: {
                      kind: "terminal_exited",
                      message: "Command terminal process exited."
                    }
                  });
                  const completion = await runtime.store.mutateSession(session.sessionId, async () => {
                    return writeActionTerminalResult({
                      advanceOnSuccess,
                      action,
                      commandLifecycleId,
                      exitCode,
                      input: commandInput,
                      output,
                      resultFile: activeResultFile,
                      runtime,
                      session: startedSession,
                      spec,
                      terminalSessionId: id
                    });
                  });
                  scheduleCommandTerminalPostCommitEffects({
                    afterSuccessfulCommand,
                    completion,
                    publishSessionChanged,
                    sessionId
                  });
                  vibe64SessionDebugLog("server.commandTerminal.onClose.done", {
                    actionId: action.id,
                    durationMs: vibe64SessionDebugDurationMs(onCloseStartedAtMs),
                    exitCode,
                    sessionId,
                    terminalSessionId: id
                  });
                } catch (error) {
                  await writeCommandLifecycleEvent({
                    lifecycleId: commandLifecycleId,
                    runtime,
                    sessionId,
                    patch: {
                      error: vibe64SessionDebugError(error),
                      exitCode,
                      outcome: "failed",
                      phase: "failed",
                      terminalSessionId: id
                    },
                    event: {
                      kind: "failed",
                      message: "Command terminal finalization failed.",
                      outcome: "failed"
                    }
                  });
                  vibe64SessionDebugLog("server.commandTerminal.onClose.error", {
                    actionId: action.id,
                    durationMs: vibe64SessionDebugDurationMs(onCloseStartedAtMs),
                    error: vibe64SessionDebugError(error),
                    exitCode,
                    sessionId,
                    terminalSessionId: id
                  });
                  throw error;
                } finally {
                  await removeCommandResultFile(activeResultFile);
                }
              },
              reuseRunning: false
            });
            await writeCommandLifecycleEvent({
              lifecycleId: commandLifecycleId,
              runtime,
              sessionId,
              patch: {
                commandPreview: String(terminal?.commandPreview || spec.commandPreview || ""),
                phase: terminal?.ok === false ? "failed" : "started",
                terminalSessionId: String(terminal?.id || ""),
                terminalStatus: String(terminal?.status || "")
              },
              event: {
                kind: terminal?.ok === false ? "failed" : "started",
                message: terminal?.ok === false
                  ? "Command terminal could not start."
                  : "Command terminal process started.",
                outcome: terminal?.ok === false ? "failed" : ""
              }
            });
            if (terminal?.ok === false && typeof runtime.recordCommandActionFinished === "function") {
              await runtime.recordCommandActionFinished(startedSession, action.id, {
                message: String(terminal.error || "Command terminal could not start."),
                status: "blocked"
              });
            }
            vibe64SessionDebugLog("server.commandTerminal.start.done", {
              actionId: action.id,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              sessionId,
              terminalSessionId: String(terminal?.id || ""),
              terminalStatus: String(terminal?.status || "")
            });
            return terminal;
          } catch (error) {
            await writeCommandLifecycleEvent({
              lifecycleId: commandLifecycleId,
              runtime,
              sessionId,
              patch: {
                error: vibe64SessionDebugError(error),
                outcome: "failed",
                phase: "failed"
              },
              event: {
                kind: "failed",
                message: "Command terminal start failed.",
                outcome: "failed"
              }
            });
            if (typeof runtime.recordCommandActionFinished === "function") {
              await runtime.recordCommandActionFinished(startedSession, action.id, {
                message: String(error?.message || error || "Command terminal could not start."),
                status: "blocked"
              });
            }
            throw error;
          }
        } catch (error) {
          vibe64SessionDebugLog("server.commandTerminal.start.error", {
            actionId: requestedActionId,
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: commandTerminalNamespace(sessionId)
      });
    }
  });
}

function createProjectToolTerminalController({
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  projectService,
  resolveToolchainImage = resolveTerminalToolchainImage,
  startTerminal = startTerminalSession
} = {}) {
  async function startPreparedRun(toolId, run = {}) {
    if (run?.ok === false) {
      return run;
    }
    if (run.type !== "command") {
      return {
        ok: false,
        error: `${run.tool?.label || toolId} is not a command tool.`
      };
    }
    const runtime = await projectService.createRuntime();
    const targetRoot = terminalTargetRoot({
      targetRoot: run.targetRoot
    }, projectService);
    if (!targetRoot) {
      return {
        ok: false,
        error: "Vibe64 tool target root is not available."
      };
    }
    const tool = run.tool || {
      id: toolId,
      label: toolId
    };
    const session = {
      targetRoot
    };
    return startCommandTerminalProcess({
      containerName: ({ id }) => toolTerminalContainerName({
        terminalId: id,
        toolId: tool.id
      }),
      ensureRuntimeNetwork,
      metadata: {
        inputKeys: Object.keys(normalizePlainObject(run.input)).sort(),
        toolId: tool.id,
        toolLabel: tool.label
      },
      namespace: toolTerminalNamespace(tool.id),
      onClose: async () => null,
      projectService,
      resolveToolchainImage,
      runtime,
      session,
      spec: run.spec,
      startTerminal,
      target: "tool",
      targetRoot
    });
  }

  return Object.freeze({
    closeTerminal(toolId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: toolTerminalNamespace(toolId)
      });
    },

    readTerminal(toolId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: toolTerminalNamespace(toolId)
      });
    },

    async startTerminal(toolId, input = {}) {
      return vibe64Result(async () => {
        const run = await projectService.prepareProjectToolRun(toolId, input);
        return startPreparedRun(toolId, run);
      });
    },

    async startPreparedRun(toolId, run = {}) {
      return vibe64Result(async () => {
        return startPreparedRun(toolId, run);
      });
    },

    subscribeTerminal(toolId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: toolTerminalNamespace(toolId)
      });
    },

    writeTerminal(toolId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: toolTerminalNamespace(toolId)
      });
    },

    resizeTerminal(toolId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: toolTerminalNamespace(toolId)
      });
    }
  });
}

export {
  commandTerminalArgs,
  commandTerminalContainerName,
  createCommandTerminalController,
  createProjectToolTerminalController,
  startCommandTerminalProcess,
  toolTerminalContainerName
};
