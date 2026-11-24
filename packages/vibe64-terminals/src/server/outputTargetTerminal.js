import {
  finishVibe64Workflow,
  setVibe64WorkflowPhase,
  stopVibe64Execution,
  runVibe64Command
} from "@local/vibe64-execution/server";
import { createHeldWork } from "@local/vibe64-core/server/heldWork";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { startResourceWorkflow } from "./resourceWorkflow.js";
import { createOutputTargetTerminalState } from "./outputTargetTerminalState.js";
import { createOutputTargetLaunchCoordination } from "./outputTargetLaunchCoordination.js";
import { createOutputTargetLaunchStart } from "./outputTargetLaunchStart.js";
import { createOutputTargetPreviewTests } from "./outputTargetPreviewTests.js";
import { createOutputTargetLaunchStatus } from "./outputTargetLaunchStatus.js";
import { createOutputTargetTerminalSessions } from "./outputTargetTerminalSessions.js";
import { currentProjectSlug } from "./terminalShared.js";

// The starts of a session the outputs read reports: its latest few, each for as long as held work keeps its outcome.
const REPORTED_STARTS = 5;

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
 * @param {RuntimeEnv} dependencies.env
 * @param {ProjectService} dependencies.project
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
  env,
  project,
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
    project,
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
    project,
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
    project,
    stopExecution
  });
  const outputStatus = createOutputTargetLaunchStatus({
    state,
    launchCoordination,
    project,
    runCommand
  });
  const terminalSessions = createOutputTargetTerminalSessions({
    state,
    launchCoordination,
    project,
    stopPreviewBrowsers
  });

  // A start the page names (`startId`) answers within two seconds, as starting, while it waits (for the workspace
  // preparation, after a restart for minutes) and goes on: the hosted edge ends a request after about a minute. Its
  // repeat after a lost answer joins it, or reads its outcome once it ended; the outputs read reports it
  // (`launchStarts`), and its end is announced so the page reads it at once.
  const heldStarts = createHeldWork({ component: "vibe64.preview_start" });
  const sessionStarts = new Map();
  const startKey = (sessionId, startId) => `${sessionId}\0${startId}`;

  async function startTerminal(sessionId, input = {}) {
    const { startId: requestedStartId, ...start } = input;
    const startId = normalizeText(requestedStartId);
    if (!startId) return launchStart.startTerminal(sessionId, start);
    const key = startKey(sessionId, startId);
    const ended = heldStarts.inspect(key);
    if (ended?.settled) return ended.result;
    const projectSlug = currentProjectSlug(project);
    sessionStarts.set(sessionId, [...(sessionStarts.get(sessionId) || []).filter(id => id !== startId), startId]
      .slice(-REPORTED_STARTS));
    const answer = await heldStarts.run(key, async ({ stage }) => {
      const result = await launchStart.startTerminal(sessionId, start, { stage });
      launchCoordination.publishLaunchCleanup(sessionId, projectSlug, "output-target-start-settled");
      return result;
    });
    if (answer.settled) return answer.result;
    return { ok: true, starting: true, startId, waitingFor: answer.waitingFor };
  }

  /**
   * The session's latest starts the page named, newest last: starting (with what it waits for), started (its
   * terminal) or failed (its refusal in words, with its code and the admission it was refused by).
   * @param {string} sessionId
   */
  function launchStarts(sessionId) {
    return (sessionStarts.get(sessionId) || []).flatMap((startId) => {
      const operation = heldStarts.inspect(startKey(sessionId, startId));
      if (!operation) return [];
      if (!operation.settled) return [{ startId, status: "starting", waitingFor: operation.waitingFor }];
      const result = operation.result || {};
      if (operation.error || result.ok === false) {
        const admissionId = normalizeText(result.details?.admission?.id);
        return [{
          startId,
          status: "failed",
          ...(result.code ? { code: String(result.code) } : {}),
          error: String(result.error || operation.error?.message || "Preview could not start."),
          ...(admissionId ? { admissionId } : {})
        }];
      }
      return [{ startId, status: "started", terminalSessionId: String(result.id || "") }];
    });
  }

  async function launchStatus(sessionId, options = {}) {
    const status = await outputStatus.launchStatus(sessionId, options);
    const starts = launchStarts(sessionId);
    return status?.ok === true && starts.length > 0 ? { ...status, launchStarts: starts } : status;
  }

  return Object.freeze({
    close: terminalSessions.close,
    closeAllForSession: terminalSessions.closeAllForSession,
    removeResultsForSession: terminalSessions.removeResultsForSession,
    closeTerminal: terminalSessions.closeTerminal,
    launchStarts,
    launchStatus,
    selectPreviewIdentity: outputStatus.selectPreviewIdentity,
    verifyPreviewIdentity: outputStatus.verifyPreviewIdentity,
    ensurePreview: launchStart.ensurePreview,
    withPreviewTarget: previewTests.withPreviewTarget,
    retryPreviewTestCleanup: previewTests.retryPreviewTestCleanup,
    previewTestRunAdmission: previewTests.previewTestRunAdmission,
    restartPreview: launchStart.restartPreview,
    restartPreviewAfterWorkspaceSetup: launchStart.restartPreviewAfterWorkspaceSetup,
    usageRecordingTargets: outputStatus.usageRecordingTargets,
    openOutputTarget: outputStatus.openOutputTarget,
    readResult: terminalSessions.readResult,
    readTerminal: terminalSessions.readTerminal,
    startTerminal,
    stopTerminal: terminalSessions.stopTerminal,
    subscribeTerminal: terminalSessions.subscribeTerminal,
    writeTerminal: terminalSessions.writeTerminal,
    resizeTerminal: terminalSessions.resizeTerminal
  });
}

export {
  createOutputTargetTerminalController
};
