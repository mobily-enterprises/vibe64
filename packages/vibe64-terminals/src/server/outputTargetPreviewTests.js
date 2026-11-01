import crypto from "node:crypto";
import { closeTerminalSessionsForNamespace } from "@local/vibe64-execution/server/terminalSessions";
import { browserTestNeedsCleanup, drainBrowserTestExecutions } from "./browserTestCleanup.js";
import { outputTargetTerminalNamespace } from "./terminalShared.js";
import { clearLaunchMetadata, OUTPUT_METADATA, outputTargetFromMetadata } from "./outputTargetMetadata.js";
import { launchTerminalIsRunning } from "./launchPreviewReadiness.js";
import {
  readLaunchContext,
  findOutputTarget,
  listOutputTargets,
  managedPreviewLaunchPlan,
  previewTargetError
} from "./outputTargetLaunchContext.js";

/** @typedef {import("./types.js").OutputTargetTerminalState} OutputTargetTerminalState */
/** @typedef {import("./types.js").OutputTargetLaunchCoordination} OutputTargetLaunchCoordination */
/** @typedef {ReturnType<typeof import("./outputTargetLaunchStart.js").createOutputTargetLaunchStart>} OutputTargetLaunchStart */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * A test run's own start of its target, and its state observer, when the
 * caller passes none.
 */
const startTargetNow = (start) => start();
const ignoreTestRunState = () => {};

/**
 * Browser test runs that own a session's Preview: the run's target, its
 * admission, and restoring or cleaning up the Preview afterwards.
 * @param {object} dependencies
 * @param {OutputTargetTerminalState} dependencies.state
 * @param {OutputTargetLaunchCoordination} dependencies.launchCoordination
 * @param {OutputTargetLaunchStart} dependencies.launchStart
 * @param {ProjectService} dependencies.project
 * @param {typeof import("@local/vibe64-execution/server").stopVibe64Execution} dependencies.stopExecution
 */
function createOutputTargetPreviewTests({
  state,
  launchCoordination,
  launchStart,
  project,
  stopExecution
}) {
  async function withPreviewTarget(sessionId, outputTargetId, operation, {
    waitUntilReady,
    startTarget = startTargetNow,
    signal,
    onState = ignoreTestRunState
  }) {
    const testRun = { targetId: outputTargetId, token: crypto.randomUUID(), closing: false };
    function changeState(nextState) {
      testRun.state = nextState;
      onState(nextState);
      launchCoordination.publishLaunchCleanup(sessionId, testRun.projectSlug, "preview-test-state-changed");
    }
    const previous = await launchCoordination.withLaunchStartLock(sessionId, async () => {
      signal?.throwIfAborted();
      if (state.previewTestRuns.has(sessionId)) {
        throw Object.assign(new Error("Browser tests already own this session's Preview. Wait for them to finish."), {
          code: "vibe64_preview_test_busy"
        });
      }
      const context = await readLaunchContext(project, sessionId);
      testRun.projectSlug = context.projectSlug;
      const unavailable = launchCoordination.launchAdmissionFailure(sessionId, context.session);
      if (unavailable) throw Object.assign(new Error(unavailable.error), unavailable);
      const targets = await listOutputTargets(context);
      const status = await launchCoordination.resolvePreviewStatus(sessionId, context, targets);
      if (!outputTargetId) {
        const plan = managedPreviewLaunchPlan({
          outputTargets: targets,
          previewStatus: status,
          savedOutputTarget: outputTargetFromMetadata(context.session.metadata)
        });
        if (plan.error) throw Object.assign(new Error(plan.error), { code: plan.code });
        outputTargetId = plan.outputTargetId || plan.terminal?.metadata?.outputTargetId;
        testRun.targetId = outputTargetId;
      }
      const targetError = previewTargetError(findOutputTarget(targets, outputTargetId), outputTargetId);
      if (targetError) throw targetError;
      state.previewTestRuns.set(sessionId, testRun);
      return {
        running: launchTerminalIsRunning(status.activeTerminal || {}),
        targetId: status.activeTerminal?.metadata?.outputTargetId || "",
        outputParameters: status.activeTerminal?.metadata?.outputParameters || {},
        savedTarget: outputTargetFromMetadata(context.session.metadata),
        store: context.runtime.store
      };
    });
    async function ensureTargetReady(targetId, options) {
      testRun.restoring = options?.restoring === true;
      const start = () => launchStart.startTerminal(sessionId, {
        ensurePreview: true,
        outputTargetId: targetId,
        ...(options?.restoring ? { outputParameters: previous.outputParameters } : {}),
        previewTestRun: testRun
      });
      if (!testRun.restoring) signal?.throwIfAborted();
      const started = await (testRun.restoring ? start() : startTarget(start));
      if (started?.ok === false) {
        throw Object.assign(new Error(started.error), started);
      }
      await waitUntilReady(started, options);
    }

    let result;
    try {
      changeState("starting");
      await ensureTargetReady(outputTargetId);
      signal?.throwIfAborted();
      if (testRun.closing) {
        throw new Error("The session closed before browser tests could start.");
      }
      changeState("running");
      result = await operation(testRun.token);
    } catch (error) {
      result = {
        ok: false,
        exitCode: 1,
        error: error.message,
        code: error.code,
        ...(error.execution ? { execution: error.execution } : {}),
        ...(error.details ? { details: error.details } : {})
      };
    }
    let cleanupRequired = browserTestNeedsCleanup(result);
    const cleanupExecutionIds = new Set(cleanupRequired ? result.cleanupExecutionIds || [result.execution?.id] : []);
    testRun.finish = async (retry = false) => {
      if (cleanupRequired) {
        changeState("cleanup_required");
        if (retry) {
          await drainBrowserTestExecutions(cleanupExecutionIds, stopExecution);
          cleanupRequired = cleanupExecutionIds.size > 0;
        }
        if (cleanupRequired) return { ...result, previewRecoveryRequired: true };
      }
      try {
        if (testRun.closing) {
          state.previewTestRuns.delete(sessionId);
          return result;
        }
        changeState("restoring");
        if (previous.running && previous.targetId) {
          await ensureTargetReady(previous.targetId, { restoring: true });
        } else {
          await launchCoordination.withLaunchStartLock(sessionId, async () => {
            await state.launchPreviewProxies.close({ sessionId });
            const closed = await closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
            if (closed?.ok === false) throw new Error(closed.error);
            await clearLaunchMetadata(previous.store, sessionId);
            if (previous.savedTarget) {
              await previous.store.mutateSession(sessionId, async () => {
                await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.id, previous.savedTarget.id);
                await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.label, previous.savedTarget.label);
                await previous.store.writeMetadataValue(
                  sessionId,
                  OUTPUT_METADATA.parameters,
                  JSON.stringify(previous.savedTarget.outputParameters)
                );
              });
            }
          });
        }
        state.previewTestRuns.delete(sessionId);
        launchCoordination.publishLaunchCleanup(sessionId, testRun.projectSlug, "preview-test-state-changed");
      } catch (error) {
        changeState("restore_failed");
        return {
          ...result,
          ok: false,
          exitCode: result?.exitCode || 1,
          code: "vibe64_preview_restore_failed",
          error: [result?.error, `Could not restore Preview: ${error.message}`].filter(Boolean).join("\n"),
          previewRecoveryRequired: true
        };
      }
      return result;
    };
    return testRun.finish();
  }

  async function retryPreviewTestCleanup(sessionId) {
    const testRun = state.previewTestRuns.get(sessionId);
    if (!testRun?.finish) return { ok: false, error: "The browser test has not finished.", previewRecoveryRequired: true };
    testRun.finishing ||= testRun.finish(true).finally(() => { testRun.finishing = null; });
    return testRun.finishing;
  }

  function previewTestRunAdmission(sessionId, token = "") {
    const testRun = state.previewTestRuns.get(sessionId);
    if ((!testRun && token) || (testRun && (testRun.closing || testRun.token !== token))) {
      return {
        ok: false,
        code: "vibe64_preview_test_busy",
        error: "Another browser test owns this Preview, or this test run has ended. Wait for it to finish, then retry."
      };
    }
    return null;
  }

  return Object.freeze({
    withPreviewTarget,
    retryPreviewTestCleanup,
    previewTestRunAdmission
  });
}

export {
  createOutputTargetPreviewTests
};
