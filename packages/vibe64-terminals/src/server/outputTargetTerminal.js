import {
  finishVibe64Workflow,
  setVibe64WorkflowPhase,
  stopVibe64Execution,
  runVibe64Command
} from "@local/vibe64-execution/server";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
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
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger] where each replaced Preview run
 *   is logged
 * @param {number} [dependencies.previewPrepareWaitMs] how long a restart waits at most for its run's Prepare steps
 * @param {() => Promise<number | null>} [dependencies.availableMemory] the memory free for a browser-test run's app
 *   servers (browserTestWorkers.js)
 * @param {() => number} [dependencies.testBudget] the machine's test budget
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
  sessionAdmissionFailure,
  logger = silentLogger,
  previewPrepareWaitMs,
  availableMemory,
  testBudget
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
    setWorkflowPhase,
    logger,
    prepareWaitMs: previewPrepareWaitMs
  });
  const previewTests = createOutputTargetPreviewTests({
    state,
    launchCoordination,
    launchStart,
    project,
    stopExecution,
    availableMemory,
    testBudget
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
    const startNow = (stage) => previewTests.startOverTestTarget(sessionId, (back) => (
      launchStart.startTerminal(sessionId, back ? asRestore(back, start) : start, { stage })
    ));
    if (!startId) return startNow();
    const key = startKey(sessionId, startId);
    const ended = heldStarts.inspect(key);
    if (ended?.settled) return ended.result;
    const projectSlug = currentProjectSlug(project);
    sessionStarts.set(sessionId, [...(sessionStarts.get(sessionId) || []).filter(id => id !== startId), startId]
      .slice(-REPORTED_STARTS));
    const answer = await heldStarts.run(key, async ({ stage }) => {
      const result = await startNow(stage);
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

  // A request that stops or closes Preview first takes back the Preview a finished browser test left waiting
  // (outputTargetPreviewTests.js). One that starts or restarts it starts the person's own target, unless it names one,
  // as that test run's restore (`asRestore`), so a refused start leaves the restore waiting. The person's target gets
  // its parameters from the run, not from the record, which the replaced test target's end clears.
  const afterTestRestore = (operation, options) => async (sessionId, ...input) => {
    await previewTests.handPreviewBack(sessionId, options);
    return operation(sessionId, ...input);
  };
  const asRestore = (back, input) => {
    const outputTargetId = input.outputTargetId || back.targetId;
    return {
      ...input,
      outputTargetId,
      ...(outputTargetId === back.targetId && input.outputParameters === undefined
        ? { outputParameters: back.outputParameters }
        : {}),
      previewTestRun: back.previewTestRun
    };
  };

  /**
   * @param {string} sessionId
   * @param {{ outputTargetId?: string, requestedBy?: string }} [input]
   */
  function ensurePreview(sessionId, input = {}) {
    return previewTests.startOverTestTarget(sessionId, (back) => back
      ? launchStart.startTerminal(sessionId, asRestore(back, {
        outputTargetId: input.outputTargetId,
        ensurePreview: true,
        requestedBy: input.requestedBy
      }))
      : launchStart.ensurePreview(sessionId, input));
  }

  /**
   * @param {string} sessionId
   * @param {{ requestedBy?: string }} [input]
   */
  function restartPreview(sessionId, input = {}) {
    // The person's own target starting over the test target is that restart.
    return previewTests.startOverTestTarget(sessionId, (back) => back
      ? launchStart.startTerminal(sessionId, asRestore(back, { ensurePreview: true, requestedBy: input.requestedBy }))
      : launchStart.restartPreview(sessionId, input));
  }

  /**
   * The agent's turn ended: the Preview a finished browser test left waiting is restored now.
   * @param {string} sessionId
   */
  function restorePreviewAfterTurn(sessionId) {
    return previewTests.restorePendingPreview(sessionId);
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
    closeTerminal: afterTestRestore(terminalSessions.closeTerminal),
    launchStarts,
    launchStatus,
    selectPreviewIdentity: outputStatus.selectPreviewIdentity,
    verifyPreviewIdentity: outputStatus.verifyPreviewIdentity,
    ensurePreview,
    withPreviewTarget: previewTests.withPreviewTarget,
    restorePreviewAfterTurn,
    retryPreviewTestCleanup: previewTests.retryPreviewTestCleanup,
    previewTestRunAdmission: previewTests.previewTestRunAdmission,
    restartPreview,
    restartPreviewAfterWorkspaceSetup: launchStart.restartPreviewAfterWorkspaceSetup,
    usageRecordingTargets: outputStatus.usageRecordingTargets,
    openOutputTarget: outputStatus.openOutputTarget,
    readResult: terminalSessions.readResult,
    readTerminal: terminalSessions.readTerminal,
    startTerminal,
    stopTerminal: afterTestRestore(terminalSessions.stopTerminal, { stop: true }),
    subscribeTerminal: terminalSessions.subscribeTerminal,
    writeTerminal: terminalSessions.writeTerminal,
    resizeTerminal: terminalSessions.resizeTerminal
  });
}

export {
  createOutputTargetTerminalController
};
