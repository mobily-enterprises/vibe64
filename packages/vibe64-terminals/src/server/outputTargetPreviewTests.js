import crypto from "node:crypto";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { closeTerminalSessionsForNamespace } from "@local/vibe64-execution/server/terminalSessions";
import { browserTestNeedsCleanup, drainBrowserTestExecutions } from "./browserTestCleanup.js";
import { outputTargetTerminalNamespace } from "./terminalShared.js";
import { clearLaunchMetadata, OUTPUT_METADATA, outputTargetFromMetadata, writePreviewStopState } from "./outputTargetMetadata.js";
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
 * A finished run whose restore of the person's Preview waits for the agent's
 * turn to end, or whose later restore failed: the next test run, or a request
 * that starts or stops Preview, takes it over.
 */
const restoreWaits = (testRun) => Boolean(testRun?.restorePending ||
  (testRun?.restoreLater && testRun.state === "restore_failed" && !testRun.restoreRun));

/**
 * Puts the target the session had saved before a test run back as its saved target.
 * @param {{ store: object, savedTarget: { id: string, label: string, outputParameters: object } }} previous
 * @param {string} sessionId
 */
async function writeSavedTarget({ store, savedTarget }, sessionId) {
  await store.mutateSession(sessionId, async () => {
    await store.writeMetadataValue(sessionId, OUTPUT_METADATA.id, savedTarget.id);
    await store.writeMetadataValue(sessionId, OUTPUT_METADATA.label, savedTarget.label);
    await store.writeMetadataValue(sessionId, OUTPUT_METADATA.parameters, JSON.stringify(savedTarget.outputParameters));
  });
}

/**
 * Browser test runs that own a session's Preview: the run's target, its
 * admission, and restoring or cleaning up the Preview afterwards. A run that
 * replaced the person's running Preview with another target restores it when
 * the agent's turn ends or someone asks for Preview, not when its command
 * ends: an agent repeating a test would otherwise pay the person's app's whole
 * start after every run, only for its next run to stop it again.
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
    // A restore the agent's turn end started finishes before this run reads the Preview.
    await state.previewTestRuns.get(sessionId)?.restoreRun;
    function changeState(nextState) {
      testRun.state = nextState;
      onState(nextState);
      launchCoordination.publishLaunchCleanup(sessionId, testRun.projectSlug, "preview-test-state-changed");
    }
    // A run waiting to restore the person's Preview hands that restore to this one, whose target starts afresh.
    let replaced = null;
    const previous = await launchCoordination.withLaunchStartLock(sessionId, async () => {
      signal?.throwIfAborted();
      const current = state.previewTestRuns.get(sessionId);
      if (current && !restoreWaits(current)) {
        throw vibe64Error("Browser tests already own this session's Preview. Wait for them to finish.", "vibe64_preview_test_busy");
      }
      const context = await readLaunchContext(project, sessionId);
      testRun.projectSlug = context.projectSlug;
      const unavailable = launchCoordination.launchAdmissionFailure(sessionId, context.session);
      if (unavailable) throw Object.assign(new Error(unavailable.error), unavailable);
      const targets = await listOutputTargets(context);
      // Without a target, a run tests the person's Preview, which a waiting run's test target stands in for.
      if (!outputTargetId && current) {
        outputTargetId = current.previous.targetId;
        testRun.targetId = outputTargetId;
      }
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
      if (current) {
        current.restorePending = false;
        replaced = current;
        return current.previous;
      }
      return {
        running: launchTerminalIsRunning(status.activeTerminal || {}),
        targetId: status.activeTerminal?.metadata?.outputTargetId || "",
        outputParameters: status.activeTerminal?.metadata?.outputParameters || {},
        savedTarget: outputTargetFromMetadata(context.session.metadata),
        store: context.runtime.store
      };
    });
    testRun.previous = previous;
    async function ensureTargetReady(targetId, options) {
      testRun.restoring = options?.restoring === true;
      const start = () => launchStart.startTerminal(sessionId, {
        // The waiting run's test target still runs, with that run's data: this run's starts afresh.
        ...(replaced && !testRun.restoring ? { restartPreview: true } : { ensurePreview: true }),
        outputTargetId: targetId,
        requestedBy: "preview-test",
        ...(options?.restoring ? { outputParameters: testRun.previous.outputParameters } : {}),
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
        throw vibe64Error("The session closed before browser tests could start.", "vibe64_preview_test_session_closed");
      }
      changeState("running");
      testRun.tested = true;
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
      const previous = testRun.previous;
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
            await state.launchPreviewProxies.stop({ sessionId });
            const closed = await closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
            if (closed?.ok === false) throw new Error(closed.error);
            await clearLaunchMetadata(previous.store, sessionId);
            if (previous.savedTarget) {
              await writeSavedTarget(previous, sessionId);
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
    // Restoring would start the person's app again: a run that tested hands its result back now and restores later. A
    // run refused or cancelled restores at once, as its caller expects Preview back.
    if (testRun.tested && !signal?.aborted && !cleanupRequired && !testRun.closing && !testRun.restoreWhenFinished &&
        previous.running && previous.targetId && previous.targetId !== testRun.targetId) {
      testRun.restorePending = true;
      testRun.restoreLater = true;
      changeState("restore_pending");
      return { ...result, previewRestorePending: true };
    }
    return testRun.finish();
  }

  /**
   * The agent's turn ended: the person's running target starts again over the test target a finished run left
   * waiting, with its parameters. A run still testing restores as it finishes. Answers the restore, if one runs.
   * @param {string} sessionId
   */
  function restorePendingPreview(sessionId) {
    const testRun = state.previewTestRuns.get(sessionId);
    if (!testRun) return null;
    if (testRun.restorePending) {
      testRun.restorePending = false;
      testRun.restoreRun = testRun.finish().finally(() => {
        testRun.restoreRun = null;
      });
    } else if (!testRun.finish) {
      testRun.restoreWhenFinished = true;
    }
    return testRun.restoreRun || null;
  }

  /**
   * Before a request that starts, restarts, stops or closes Preview: a running restore finishes first, and a waiting
   * restore, or a later one that failed, hands the Preview back to that request with the person's saved target put
   * back. A start's test target keeps running for the start to replace, as it replaces any Preview: a record with no
   * process and no Stop reads as stale and is cleared (launchPreviewStatus.js), parameters and all. For a Stop
   * (`stop`) the Preview is marked stopped first and the test target closes, so no stopped test target is left for
   * the next Start to start again. Answers the person's target, for a request that names none.
   * @param {string} sessionId
   * @param {{ stop?: boolean }} [options]
   * @returns {Promise<{ targetId: string } | null>}
   */
  async function handPreviewBack(sessionId, { stop = false } = {}) {
    const current = state.previewTestRuns.get(sessionId);
    if (!current || (!restoreWaits(current) && !current.restoreRun)) return null;
    await current.restoreRun;
    return launchCoordination.withLaunchStartLock(sessionId, async () => {
      const testRun = state.previewTestRuns.get(sessionId);
      if (!restoreWaits(testRun)) return null;
      const { previous } = testRun;
      if (stop) {
        // A Stop the test target's close does not finish is finished by the Stop itself, which stops what still runs.
        await writePreviewStopState(previous.store, sessionId, { stopped: true });
        await state.launchPreviewProxies.stop({ sessionId });
        await closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
        await clearLaunchMetadata(previous.store, sessionId);
      }
      if (previous.savedTarget) await writeSavedTarget(previous, sessionId);
      state.previewTestRuns.delete(sessionId);
      launchCoordination.publishLaunchCleanup(sessionId, testRun.projectSlug, "preview-test-state-changed");
      return { targetId: previous.targetId };
    });
  }

  async function retryPreviewTestCleanup(sessionId) {
    const testRun = state.previewTestRuns.get(sessionId);
    if (!testRun?.finish) return { ok: false, error: "The browser test has not finished.", previewRecoveryRequired: true };
    testRun.finishing ||= testRun.finish(true).finally(() => {
      testRun.finishing = null;
    });
    return testRun.finishing;
  }

  function previewTestRunAdmission(sessionId, token = "") {
    const testRun = state.previewTestRuns.get(sessionId);
    // A new run takes over a run waiting to restore (withPreviewTarget).
    if (restoreWaits(testRun) && !token) return null;
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
    restorePendingPreview,
    handPreviewBack,
    retryPreviewTestCleanup,
    previewTestRunAdmission
  });
}

export {
  createOutputTargetPreviewTests
};
