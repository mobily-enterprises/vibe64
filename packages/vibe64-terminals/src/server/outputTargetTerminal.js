import {
  finishVibe64Workflow,
  setVibe64WorkflowPhase,
  stopVibe64Execution,
  runVibe64Command
} from "@local/vibe64-execution/server";
import { startResourceWorkflow } from "./resourceWorkflow.js";
import { createLaunchRestartBaseline, launchRestartState } from "./launchRestart.js";
import { previewEditorOrigin, previewPublicOriginForLaunch } from "./previewPublicOrigin.js";
import { previewIdentityCommandRunnerForLaunchTerminal } from "./launchPreviewAuth.js";
import { OUTPUT_METADATA } from "./outputTargetMetadata.js";
import { launchReadinessMarkerLineSeen } from "./launchPreviewReadiness.js";
import { listOutputTargets, workspaceSetupLaunchDisabledReason } from "./outputTargetLaunchContext.js";
import {
  cleanupSupersededLaunchTerminals,
  launchActionsFromOutput,
  outputTargetExecutionDescriptor
} from "./outputTargetLaunchTerminals.js";
import { createOutputTargetTerminalState } from "./outputTargetTerminalState.js";
import { createOutputTargetLaunchCoordination } from "./outputTargetLaunchCoordination.js";
import { createOutputTargetLaunchStart } from "./outputTargetLaunchStart.js";
import { createOutputTargetPreviewTests } from "./outputTargetPreviewTests.js";
import { createOutputTargetLaunchStatus } from "./outputTargetLaunchStatus.js";
import { createOutputTargetTerminalSessions } from "./outputTargetTerminalSessions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").ProjectServicesEnsure} ProjectServicesEnsure */

/**
 * A session's output target terminals and managed Preview. Each concern is
 * built once, in dependency order, and the controller offers its functions
 * by name.
 * @param {object} dependencies
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.ensureWorkspacePrepared
 * @param {ProjectServicesEnsure} dependencies.ensureProjectServices
 * @param {RuntimeEnv} [dependencies.env]
 * @param {ProjectService} dependencies.projectService
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {typeof startResourceWorkflow} [dependencies.startWorkflow]
 * @param {typeof stopVibe64Execution} [dependencies.stopExecution]
 * @param {(sessionId: string) => Promise<object>} dependencies.stopPreviewBrowsers
 * @param {typeof finishVibe64Workflow} [dependencies.finishWorkflow]
 * @param {typeof setVibe64WorkflowPhase} [dependencies.setWorkflowPhase]
 * @param {(sessionId: string) => object | null} dependencies.sessionAdmissionFailure
 */
function createOutputTargetTerminalController({
  ensureWorkspacePrepared,
  ensureProjectServices,
  env = process.env,
  projectService,
  publishSessionChanged,
  runCommand = runVibe64Command,
  startWorkflow = startResourceWorkflow,
  stopExecution = stopVibe64Execution,
  stopPreviewBrowsers,
  finishWorkflow = finishVibe64Workflow,
  setWorkflowPhase = setVibe64WorkflowPhase,
  sessionAdmissionFailure
}) {
  const state = createOutputTargetTerminalState({ env });
  const launchCoordination = createOutputTargetLaunchCoordination({
    state,
    env,
    projectService,
    publishSessionChanged,
    runCommand,
    setWorkflowPhase,
    sessionAdmissionFailure
  });
  const launchStart = createOutputTargetLaunchStart({
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
  });
  const previewTests = createOutputTargetPreviewTests({
    state,
    launchCoordination,
    launchStart,
    projectService,
    stopExecution
  });
  const outputStatus = createOutputTargetLaunchStatus({
    state,
    launchCoordination,
    projectService
  });
  const terminalSessions = createOutputTargetTerminalSessions({
    state,
    launchCoordination,
    projectService,
    stopPreviewBrowsers
  });

  return Object.freeze({
    close: terminalSessions.close,
    closeAllForSession: terminalSessions.closeAllForSession,
    removeResultsForSession: terminalSessions.removeResultsForSession,
    closeTerminal: terminalSessions.closeTerminal,
    launchStatus: outputStatus.launchStatus,
    selectPreviewIdentity: outputStatus.selectPreviewIdentity,
    ensurePreview: launchStart.ensurePreview,
    withPreviewTarget: previewTests.withPreviewTarget,
    retryPreviewTestCleanup: previewTests.retryPreviewTestCleanup,
    previewTestRunAdmission: previewTests.previewTestRunAdmission,
    restartPreview: launchStart.restartPreview,
    usageRecordingTargets: outputStatus.usageRecordingTargets,
    openOutputTarget: outputStatus.openOutputTarget,
    readResult: terminalSessions.readResult,
    readTerminal: terminalSessions.readTerminal,
    startTerminal: launchStart.startTerminal,
    stopTerminal: terminalSessions.stopTerminal,
    subscribeTerminal: terminalSessions.subscribeTerminal,
    writeTerminal: terminalSessions.writeTerminal,
    resizeTerminal: terminalSessions.resizeTerminal
  });
}

export {
  OUTPUT_METADATA,
  cleanupSupersededLaunchTerminals,
  createLaunchRestartBaseline,
  launchActionsFromOutput,
  launchReadinessMarkerLineSeen,
  launchRestartState,
  listOutputTargets,
  outputTargetExecutionDescriptor,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewEditorOrigin,
  previewPublicOriginForLaunch,
  workspaceSetupLaunchDisabledReason,
  createOutputTargetTerminalController
};
