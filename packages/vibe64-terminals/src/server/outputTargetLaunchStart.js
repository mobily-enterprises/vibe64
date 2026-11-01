import { updateTerminalSessionMetadata } from "@local/vibe64-execution/server/terminalSessions";
import { terminalNoGithubActorMetadata } from "@local/studio-terminal-core/server/terminalOwnership";
import {
  captureProjectRequestContext,
  runWithProjectRequestContext,
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";
import { activeUsageRecording } from "@local/vibe64-usage-recording/server/activeRecordings";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import {
  commandInvocation,
  ensureTerminalSessionSourceGitSelfContained,
  vibe64Result,
  outputTargetTerminalNamespace
} from "./terminalShared.js";
import {
  projectExecutionEnvFromRecords,
  loadProjectExecutionEnvRecords,
  executionEnvFingerprint
} from "./projectExecutionEnv.js";
import {
  createVibe64OutputTargetTerminalSpec,
  inspectVibe64OutputsForContext,
  normalizedRuntimeRequirements,
  outputResultsMarkerLineSeen
} from "./vibe64OutputTargets.js";
import { trimmedText } from "./trimmedText.js";
import { createLaunchRestartBaseline } from "./launchRestart.js";
import { previewPublicOriginForLaunch } from "./previewPublicOrigin.js";
import { launchExecutionProject } from "./launchPreviewAuth.js";
import {
  clearLaunchMetadataForTerminal,
  outputTargetFromMetadata,
  previewStopState,
  writeLaunchMetadata,
  writePreviewStopState
} from "./outputTargetMetadata.js";
import {
  launchReadinessMarkerLineSeen,
  launchTerminalIsRunning,
  readinessMarkerFromSpec
} from "./launchPreviewReadiness.js";
import { latestLaunchTerminal } from "./launchPreviewStatus.js";
import { writePreviewDiagnostic } from "./launchPreviewDiagnostics.js";
import {
  readPreparedLaunchContext,
  findOutputTarget,
  listOutputTargets,
  managedPreviewLaunchPlan
} from "./outputTargetLaunchContext.js";
import {
  cleanupSupersededLaunchTerminals,
  closeStoppedLaunchTerminals,
  composeLaunchTerminalEnvironment,
  launchActionsChanged,
  launchActionsFromOutput,
  launchSpecAllowedRoots,
  launchSpecEnvironment,
  launchTerminalIsReady,
  outputTargetExecutionDescriptor,
  previewRuntimesForSpec,
  releaseLaunchSpecReservation,
  reusableLaunchTerminal
} from "./outputTargetLaunchTerminals.js";

/** @typedef {import("./types.js").OutputTargetTerminalState} OutputTargetTerminalState */
/** @typedef {import("./types.js").OutputTargetLaunchCoordination} OutputTargetLaunchCoordination */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").ProjectServicesEnsure} ProjectServicesEnsure */

function previewStoppedRefusal() {
  return { ok: false, code: "vibe64_preview_stopped", error: "Preview was stopped explicitly. Use Start preview to run it again." };
}

/**
 * Starts an output target's terminal, or reuses the running one, and the
 * managed Preview's ensure and restart requests built on it.
 * @param {object} dependencies
 * @param {OutputTargetTerminalState} dependencies.state
 * @param {OutputTargetLaunchCoordination} dependencies.launchCoordination
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.ensureWorkspacePrepared
 * @param {ProjectServicesEnsure} dependencies.ensureProjectServices
 * @param {RuntimeEnv} dependencies.env
 * @param {ProjectService} dependencies.projectService
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof import("@local/vibe64-execution/server").runVibe64Command} dependencies.runCommand
 * @param {typeof import("./resourceWorkflow.js").startResourceWorkflow} dependencies.startWorkflow
 * @param {typeof import("@local/vibe64-execution/server").finishVibe64Workflow} dependencies.finishWorkflow
 * @param {typeof import("@local/vibe64-execution/server").setVibe64WorkflowPhase} dependencies.setWorkflowPhase
 */
function createOutputTargetLaunchStart({
  state,
  launchCoordination,
  ensureWorkspacePrepared,
  ensureProjectServices,
  env,
  projectService,
  publishSessionChanged,
  runCommand,
  startWorkflow,
  finishWorkflow,
  setWorkflowPhase
}) {
  // An ended launch terminal gives up its Preview proxy and the session's
  // launch record; a cleared record is announced.
  async function releaseEndedLaunchTerminal(context, sessionId, terminalSessionId) {
    await state.launchPreviewProxies.close({
      sessionId,
      terminalSessionId
    });
    const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, terminalSessionId);
    if (metadataCleared) {
      launchCoordination.publishLaunchCleanup(sessionId, context.projectSlug);
    }
  }

  function ensurePreview(sessionId, input = {}) {
    return startTerminal(sessionId, {
      outputTargetId: input.outputTargetId,
      ensurePreview: true
    });
  }

  function restartPreview(sessionId) {
    return startTerminal(sessionId, {
      restartPreview: true
    });
  }

  async function startTerminal(sessionId, input = {}) {
    return vibe64Result(async () => launchCoordination.withLaunchStartLock(sessionId, async () => {
      const testRun = state.previewTestRuns.get(sessionId);
      if (testRun && input.previewTestRun !== testRun) {
        if (input.ensurePreview !== true || (input.outputTargetId && input.outputTargetId !== testRun.targetId)) {
          return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Wait for them to finish before changing or restarting its target." };
        }
        input = { ...input, outputTargetId: testRun.targetId };
      }
      return launchCoordination.withLaunchAdmission(sessionId, async () => {
        if (input.automatic === true && !(testRun && input.previewTestRun === testRun)) {
          const runtime = await projectService.createRuntime();
          const session = await runtime.getSession(sessionId);
          if (previewStopState(session.metadata).stopped) {
            return previewStoppedRefusal();
          }
        }
        const context = await readPreparedLaunchContext(projectService, sessionId, {
          ensureWorkspacePrepared,
          // An explicit start runs a failed setup again; an automatic one
          // reports the stored failure instead of rerunning it unasked.
          rerunFailedSetup: input.automatic !== true
        });
        const unavailable = launchCoordination.launchAdmissionFailure(sessionId, context.session);
        if (unavailable) {
          return unavailable;
        }
        const stopState = previewStopState(context.session.metadata);
        if (stopState.stopped && !(testRun && input.previewTestRun === testRun)) {
          if (input.automatic === true) {
            return previewStoppedRefusal();
          }
          if (stopState.error || launchTerminalIsRunning(latestLaunchTerminal(sessionId) || {})) {
            return { ok: false, code: "vibe64_preview_stop_incomplete", error: stopState.error || "Preview cleanup is still running. Retry Stop before starting it." };
          }
        }
        const cwd = context.sessionSourceRoot;
        let forceRestart = input.forceRestart === true;
        let outputTargetId = trimmedText(input.outputTargetId);
        let outputTargets = null;
        const managedPreviewOperation = input.ensurePreview === true || input.restartPreview === true;
        if (managedPreviewOperation) {
          const restartRequested = input.restartPreview === true;
          const savedOutputTarget = outputTargetFromMetadata(context.session?.metadata || {});
          outputTargets = await listOutputTargets(context);
          const previewStatus = await launchCoordination.resolvePreviewStatus(sessionId, context, outputTargets);
          const launchPlan = managedPreviewLaunchPlan({
            outputTargets,
            outputTargetId,
            previewStatus,
            outputParameters: input.outputParameters,
            restart: restartRequested,
            savedOutputTarget
          });
          if (launchPlan.ready) {
            return launchPlan.terminal;
          }
          if (testRun && input.previewTestRun !== testRun) {
            return { ok: false, code: "vibe64_preview_test_not_ready", error: "The browser-test Preview stopped. Tests cannot restart it while using its fixtures." };
          }
          if (launchPlan.error) {
            return {
              ...(launchPlan.code ? { code: launchPlan.code } : {}),
              error: launchPlan.error,
              ok: false
            };
          }
          forceRestart = launchPlan.forceRestart;
          outputTargetId = launchPlan.outputTargetId;
        }
        const diagnosticBase = {
          cwd,
          outputTargetId,
          sessionId
        };
        // A start refused before its terminal runs records why, then says so.
        const refuseStart = async (reason, message, record = {}) => {
          await writePreviewDiagnostic(context.session, { ...diagnosticBase, ...record, message, reason, status: "failed" });
          return { ok: false, error: message };
        };
        const closingReason = sessionClosingReason(context.session);
        if (closingReason) {
          return refuseStart(
            "session_closing",
            `Session is ${closingReason}. Preview cannot start while the worktree is being archived.`
          );
        }
        if (!cwd) {
          return refuseStart("missing_target_root", "Vibe64 output target root is not available.");
        }
        await ensureTerminalSessionSourceGitSelfContained({
          runExclusive: async (operation) => {
            const result = await runVibe64AgentWriteExclusive(context.runtime, sessionId, operation, {
              operation: "prepare-preview-source"
            });
            if (!result.acquired) {
              throw Object.assign(new Error(result.value.error), result.value);
            }
            return result.value;
          },
          session: context.session,
          workdir: cwd
        });

        outputTargets ||= await listOutputTargets(context);
        const outputTarget = findOutputTarget(outputTargets, outputTargetId);
        if (!outputTarget) {
          return refuseStart("output_target_missing", "Output target is not available.", {
            details: {
              availableOutputTargetIds: outputTargets.map((target) => String(target?.id || "")).filter(Boolean)
            }
          });
        }
        if (outputTarget.available === false) {
          return refuseStart("output_target_disabled", outputTarget.disabledReason || "Output target is disabled.", {
            outputTargetId: outputTarget.id
          });
        }

        const savedTarget = outputTargetFromMetadata(context.session.metadata);
        let outputParameters = input.outputParameters;
        if (outputParameters === undefined && savedTarget?.id === outputTarget.id) {
          outputParameters = savedTarget.outputParameters;
        }
        const spec = await createVibe64OutputTargetTerminalSpec({
          context: {
            ...context,
            outputTarget,
            vibe64User: input.vibe64User || null
          },
          outputTargetId: outputTarget.id,
          outputParameters
        });
        if (spec?.ok === false) {
          return refuseStart("output_target_spec_failed", spec.message || "Output target terminal cannot start.", {
            outputTargetId: outputTarget.id
          });
        }
        await ensureProjectServices(context);
        const commandPreview = commandInvocation(spec);

        const namespace = outputTargetTerminalNamespace(sessionId);
        let terminalSession;
        let resourceWorkflow = null;
        let outputResultsMarker = "";
        let readinessMarker = "";
        try {
          const terminalEnvRecords = await loadProjectExecutionEnvRecords({
            includeResourceConfiguration: true,
            projectService,
            runCommand,
            runtime: context.runtime,
            session: context.session,
            target: "output-target"
          });
          const terminalEnv = projectExecutionEnvFromRecords(terminalEnvRecords);
          const webOutput = String(spec.metadata?.outputPresentationKind || "").trim() === "web";
          // While the session records this target, every launch of it
          // carries the recorder; the recorder's variables also change the
          // fingerprint, so an unrecorded process is never reused.
          const usageLaunch = activeUsageRecording(currentProjectScopeKey(), sessionId)?.launch({
            environment: composeLaunchTerminalEnvironment({ envBase: {}, hashBase: terminalEnv, specEnv: spec.env, terminalEnv }).hashEnv,
            outputTargetId: outputTarget.id,
            web: webOutput
          }) || null;
          const launchEnvironment = composeLaunchTerminalEnvironment({
            envBase: {},
            hashBase: terminalEnv,
            specEnv: usageLaunch
              ? (envInput) => ({ ...launchSpecEnvironment(spec.env, envInput), ...usageLaunch.environment })
              : spec.env,
            terminalEnv
          });
          const commandAllowedRoots = [
            context.sessionSourceRoot,
            spec.cwd,
            cwd,
            ...launchSpecAllowedRoots(spec)
          ].filter(Boolean);
          const commandProject = launchExecutionProject(context, terminalEnvRecords);
          const launchEnvHash = executionEnvFingerprint(launchEnvironment.hashEnv);
          const launchRestartBaseline = await createLaunchRestartBaseline({
            restartOnChange: spec.restartOnChange || spec.metadata?.restartOnChange,
            worktreePath: spec.metadata?.runRoot || spec.cwd || cwd
          });
          readinessMarker = readinessMarkerFromSpec(spec);
          outputResultsMarker = String(spec.metadata?.outputResultsMarker || "").trim();
          const previewPublicOrigin = webOutput
            ? previewPublicOriginForLaunch({
                env,
                publicHost: input.publicHost,
                publicProtocol: input.publicProtocol,
                sessionId
              })
            : "";
          let launchReadyConfirmed = false;
          await closeStoppedLaunchTerminals(sessionId);
          const existingReusableTerminal = forceRestart
            ? null
            : reusableLaunchTerminal(sessionId, {
                launchEnvHash,
                outputTargetId: outputTarget.id,
                namespace,
                spec
              });
          await cleanupSupersededLaunchTerminals({
            launchPreviewProxies: state.launchPreviewProxies,
            namespace,
            reusableTerminal: existingReusableTerminal,
            sessionId
          });
          if (existingReusableTerminal) {
            terminalSession = existingReusableTerminal;
          } else {
            const currentOutputs = await inspectVibe64OutputsForContext(context);
            if (currentOutputs.stackHash !== spec.stackHash) {
              throw Object.assign(new Error("The Stack changed while preparing this output. Retry to run the current target."), {
                code: "VIBE64_STACK_CHANGED"
              });
            }
            const execution = outputTargetExecutionDescriptor(outputTarget, spec);
            resourceWorkflow = await startWorkflow({
              ...spec.resourceWorkflow,
              configuration: {
                ...spec.resourceWorkflow?.configuration,
                environmentFingerprint: terminalEnvRecords.resourceConfigurationFingerprint
              },
              session: context.session, sourceRoot: context.sessionSourceRoot,
              environment: testRun && !testRun.restoring && outputTarget.id === testRun.targetId ? "test" : "development",
              kind: execution.kind, label: execution.label, env
            });
            if (resourceWorkflow?.ok === false) {
              throw Object.assign(new Error(resourceWorkflow.error || "This output could not be admitted."), {
                code: resourceWorkflow.code, details: { admission: resourceWorkflow.admission }
              });
            }
            const admittedOutputs = await inspectVibe64OutputsForContext(context);
            if (admittedOutputs.stackHash !== spec.stackHash) {
              throw Object.assign(new Error("The Stack changed while waiting for resources. Retry to run the current target."), {
                code: "VIBE64_STACK_CHANGED"
              });
            }
            // The running process outlives this admitted request. Its callbacks
            // observe and control that accepted work through the captured
            // control projection, as practice lessons expire the request grant.
            const callbackContext = captureProjectRequestContext();
            const inCallbackContext = handler => (...args) =>
              runWithProjectRequestContext(callbackContext || {}, () => handler(...args));
            terminalSession = await runCommand({
              actor: "daemon",
              allowedRoots: commandAllowedRoots,
              args: spec.args || [],
              command: spec.command,
              cwd: spec.cwd || cwd,
              env: launchEnvironment.env,
              envPolicy: webOutput ? "preview" : "project",
              execution: { ...execution, ...(resourceWorkflow?.workflow?.id ? { workflowId: resourceWorkflow.workflow.id } : {}) },
              mode: "pty",
              project: commandProject,
              purpose: webOutput ? "preview" : "output",
              runtimes: webOutput ? previewRuntimesForSpec(spec) : normalizedRuntimeRequirements(spec.runtimes),
              ...(usageLaunch?.usageRecordingPreload ? { usageRecordingPreload: usageLaunch.usageRecordingPreload } : {}),
              session: context.session || {},
              terminal: {
                commandPreview: spec.commandPreview,
                maxRunning: 1,
                metadata: {
                  ...(spec.metadata || {}),
                  attemptedCommand: commandPreview,
                  envHash: launchEnvHash,
                  ...(launchRestartBaseline ? { launchRestartBaseline } : {}),
                  outputTargetId: outputTarget.id,
                  outputTargetLabel: outputTarget.label,
                  ...(resourceWorkflow?.workflow?.id ? { resourceWorkflowId: resourceWorkflow.workflow.id } : {}),
                  ...(previewPublicOrigin ? { previewPublicOrigin } : {}),
                  sessionId,
                  ...terminalNoGithubActorMetadata({
                    ownerUserKey: "output-target",
                    reason: "output-target"
                  })
                },
                namespace,
                namespaceLimitPrefix: namespace,
                onClose: inCallbackContext(async (event) => {
                  usageLaunch?.exited();
                  try {
                    if (event.reason === "exit" && event.exitCode === 0) {
                      await launchCoordination.captureOutputResults({
                        context,
                        outputTarget,
                        spec,
                        terminalSessionId: event.id,
                        updateMetadata: (metadata) => updateTerminalSessionMetadata(event.id, metadata, {
                          namespace
                        })
                      });
                    }
                    if (event.reason === "exit") {
                      await writePreviewDiagnostic(context.session, {
                        ...diagnosticBase,
                        commandPreview,
                        exitCode: event.exitCode ?? null,
                        outputTargetId: outputTarget.id,
                        outputTail: event.output,
                        reason: event.exitCode === 0 ? "process_exited" : "process_exited_nonzero",
                        status: event.exitCode === 0 ? "exited" : "failed",
                        terminalSessionId: event.id
                      });
                    }
                    await releaseEndedLaunchTerminal(context, sessionId, event.id);
                    // readable-check: allow method-probe - data: a terminal spec may carry a close callback
                    if (typeof spec.onClose === "function") {
                      await spec.onClose(event);
                    }
                  } finally {
                    await finishWorkflow(resourceWorkflow?.workflow?.id, {
                      outcome: event.reason !== "exit" ? "stopped" : event.exitCode === 0 ? "succeeded" : "failed",
                      defer: true
                    });
                  }
                }),
                onStop: inCallbackContext(async (event) => {
                  usageLaunch?.exited();
                  await writePreviewDiagnostic(context.session, {
                    ...diagnosticBase,
                    commandPreview,
                    exitCode: event.exitCode ?? null,
                    outputTargetId: outputTarget.id,
                    outputTail: event.output,
                    reason: "process_stopped",
                    status: "stopped",
                    terminalSessionId: event.id
                  });
                  await releaseEndedLaunchTerminal(context, sessionId, event.id);
                  // readable-check: allow method-probe - data: a terminal spec may carry a stop callback
                  if (typeof spec.onStop === "function") {
                    await spec.onStop(event);
                  }
                }),
                onOutput: (event) => void inCallbackContext(({ output, session: runningTerminalSession, updateMetadata }) => {
                  const actions = launchActionsFromOutput(output);
                  if (actions.length > 0 && launchActionsChanged(runningTerminalSession.metadata?.actions, actions)) {
                    updateMetadata({
                      actions
                    });
                  }
                  void writePreviewDiagnostic(context.session, {
                    ...diagnosticBase,
                    commandPreview,
                    outputTargetId: outputTarget.id,
                    outputTail: output,
                    reason: "process_output",
                    status: "running",
                    terminalSessionId: runningTerminalSession.id
                  }, {
                    append: false
                  });
                  if (outputResultsMarkerLineSeen(output, outputResultsMarker)) {
                    void launchCoordination.captureOutputResults({
                      context,
                      outputTarget,
                      spec,
                      terminalSessionId: runningTerminalSession.id,
                      updateMetadata
                    });
                  }
                  if (!readinessMarker || launchReadyConfirmed || !launchReadinessMarkerLineSeen(output, readinessMarker)) {
                    return;
                  }
                  void launchCoordination.markLaunchReady({
                    namespace,
                    projectSlug: context.projectSlug,
                    publishSessionChanged,
                    source: "marker",
                    store: context.store,
                    sessionId,
                    terminalSession: runningTerminalSession,
                    updateMetadata
                  }).then(async (result) => {
                    launchReadyConfirmed = result?.ready === true;
                    if (launchReadyConfirmed) {
                      await launchCoordination.ensureReadyLaunchPreviewProxy(
                        context,
                        result.terminal || runningTerminalSession,
                        { source: "marker" }
                      );
                    }
                  }).catch((error) => {
                    vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.error", {
                      error: vibe64SessionDebugError(error),
                      sessionId,
                      terminalSessionId: runningTerminalSession.id
                    }, {
                      level: "warn"
                    });
                  });
                })(event).catch((error) => {
                  // The PTY hook only reports synchronous failures.
                  vibe64SessionDebugLog("server.outputTargetTerminal.output.error", {
                    error: vibe64SessionDebugError(error),
                    sessionId
                  }, {
                    level: "warn"
                  });
                }),
                reuseRunning: false
              }
            });
          }
        } catch (error) {
          await finishWorkflow(resourceWorkflow?.workflow?.id, { outcome: "failed", defer: true });
          releaseLaunchSpecReservation(spec);
          await writePreviewDiagnostic(context.session, {
            ...diagnosticBase,
            commandPreview,
            error,
            outputTargetId: outputTarget.id,
            reason: "terminal_start_failed",
            status: "failed"
          });
          throw error;
        }
        if (
          terminalSession?.ok === false ||
          (spec.metadata?.port && String(terminalSession?.metadata?.port || "") !== String(spec.metadata.port))
        ) {
          releaseLaunchSpecReservation(spec);
        }
        if (terminalSession?.ok === false) {
          await finishWorkflow(resourceWorkflow?.workflow?.id, { outcome: "failed", defer: true });
          await writePreviewDiagnostic(context.session, {
            ...diagnosticBase,
            commandPreview,
            error: terminalSession.error || "Output target terminal could not start.",
            outputTargetId: outputTarget.id,
            reason: "terminal_start_rejected",
            status: "failed"
          });
        } else {
          await writePreviewDiagnostic(context.session, {
            ...diagnosticBase,
            commandPreview,
            outputTargetId: outputTarget.id,
            reason: "terminal_started",
            status: "running",
            terminalSessionId: terminalSession.id
          });
        }
        if (terminalSession?.ok !== false && launchTerminalIsReady(terminalSession, readinessMarker)) {
          if (terminalSession.metadata?.outputMode === "interactive") {
            await setWorkflowPhase(terminalSession.metadata.resourceWorkflowId, "running");
          }
          await writeLaunchMetadata(context.store, sessionId, terminalSession);
          await writePreviewDiagnostic(context.session, {
            ...diagnosticBase,
            commandPreview,
            outputTargetId: outputTarget.id,
            reason: "launch_ready",
            status: "ready",
            terminalSessionId: terminalSession.id
          });
          await launchCoordination.ensureReadyLaunchPreviewProxy(context, terminalSession, {
            source: "start"
          });
        }
        if (terminalSession?.ok !== false && stopState.stopped && !(testRun && input.previewTestRun === testRun)) {
          await writePreviewStopState(context.store, sessionId, { stopped: false });
        }
        return terminalSession;
      });
    }));
  }

  return Object.freeze({
    ensurePreview,
    restartPreview,
    startTerminal
  });
}

export {
  createOutputTargetLaunchStart
};
