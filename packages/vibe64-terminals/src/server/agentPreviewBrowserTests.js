import crypto from "node:crypto";
import {
  browserTestNeedsCleanup,
  drainBrowserTestExecutions
} from "./browserTestCleanup.js";
import { trimmedText } from "./trimmedText.js";
import {
  responseError,
  runRegisteredPlaywrightCommand
} from "./agentPreviewBrowserWorker.js";
import { waitForPreviewReady } from "./agentPreviewStatusText.js";
import { doNothing } from "./doNothing.js";

/** @typedef {import("./types.js").AgentPreviewCommandState} AgentPreviewCommandState */
/** @typedef {import("./types.js").AgentPreviewWorkerRegistry} AgentPreviewWorkerRegistry */
/** @typedef {import("./types.js").OutputTargetTerminalController} OutputTargetTerminalController */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {typeof import("@local/vibe64-execution/server").vibe64ManagedExecutionProvider} Vibe64ManagedExecutionProvider */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64Execution} StopVibe64Execution */

/**
 * A session's browser tests: the one run a session may have at a time, its
 * status and cancellation, and the wait for resources a test asks the person
 * to approve before it runs.
 * @param {object} dependencies
 * @param {AgentPreviewCommandState} dependencies.state
 * @param {AgentPreviewWorkerRegistry} dependencies.workerRegistry
 * @param {OutputTargetTerminalController} dependencies.launchTarget
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {Vibe64ManagedExecutionProvider} dependencies.resourceProvider
 * @param {StopVibe64Execution} dependencies.stopManagedExecution
 */
function createAgentPreviewBrowserTests({
  state,
  workerRegistry,
  launchTarget,
  publishSessionChanged,
  resourceProvider,
  stopManagedExecution
}) {
  function testApprovalStatus(sessionId) {
    const pending = state.browserTestRuns.get(sessionId);
    return pending?.admissionId ? { admissionId: pending.admissionId, state: pending.state, expiresAt: pending.expiresAt } : null;
  }

  function playwrightStatus(sessionId) {
    const pending = state.browserTestRuns.get(sessionId);
    return {
      ok: true,
      run: pending ? {
        id: pending.id,
        targetId: pending.targetId,
        state: pending.state,
        startedAt: pending.startedAt,
        elapsedMs: Date.now() - Date.parse(pending.startedAt)
      } : null
    };
  }

  async function cancelPlaywrightRun(sessionId, runId) {
    const pending = state.browserTestRuns.get(sessionId);
    if (!pending || pending.id !== runId) return responseError(
      "That browser test is no longer active. Check playwright status before cancelling another run.", "vibe64_test_run_unavailable"
    );
    pending.cancelling ||= finishCancellation(sessionId, pending).finally(() => { pending.cancelling = null; });
    return pending.cancelling;
  }

  async function finishCancellation(sessionId, pending) {
    pending.interrupt();
    let result = await pending.completion;
    if (result?.previewRecoveryRequired) {
      if (pending.targetId) {
        result = await launchTarget.retryPreviewTestCleanup(sessionId);
      } else {
        pending.cleanupExecutionIds ||= new Set(result.cleanupExecutionIds || [result.execution?.id]);
        await drainBrowserTestExecutions(pending.cleanupExecutionIds, stopManagedExecution);
        result = { ...result, previewRecoveryRequired: pending.cleanupExecutionIds.size > 0 };
      }
      if (!result.previewRecoveryRequired && state.browserTestRuns.get(sessionId) === pending) {
        state.browserTestRuns.delete(sessionId);
        await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      }
    }
    if (result?.previewRecoveryRequired) return result;
    return { ok: true, cancelled: true, runId: pending.id, message: "Browser test finished and Preview cleanup completed." };
  }

  function cancelTestApproval({ projectSlug, sessionId, admissionId }, reason = "cancelled") {
    const pending = state.browserTestRuns.get(sessionId);
    if (!pending || pending.projectSlug !== projectSlug || pending.admissionId !== admissionId || pending.state !== "waiting") {
      return responseError("This test request is no longer waiting for approval.", "vibe64_test_approval_unavailable");
    }
    pending.cancel(reason);
    return { ok: true, cancelled: true, sessionId };
  }

  /**
   * Hands a waiting browser test the start its retry authorizes.
   * @param {{ projectSlug: string, sessionId: string, admissionId: string }} identity
   * @param {(start: object) => Promise<object>} authorizeStart
   */
  async function resumeTestApproval({ projectSlug, sessionId, admissionId }, authorizeStart) {
    const pending = state.browserTestRuns.get(sessionId);
    if (!pending || pending.projectSlug !== projectSlug || pending.admissionId !== admissionId) {
      return responseError("The original test request has ended. Run the test command again.", "vibe64_test_approval_unavailable");
    }
    if (["resuming", "running"].includes(pending.state)) return { ok: true, accepted: true, replayed: true, sessionId };
    if (pending.state !== "waiting" || Date.now() >= Date.parse(pending.expiresAt)) {
      return responseError("This test approval has expired or is no longer available.", "vibe64_test_approval_unavailable");
    }
    // The command's promise remains its result owner. HTTP only acknowledges
    // the handoff; a lost dashboard response never launches a second test.
    pending.resume(authorizeStart);
    await publishSessionChanged(sessionId, { projectSlug });
    return { ok: true, accepted: true, sessionId };
  }

  async function withTestApproval(sessionId, input, options, targetId, operation, validate) {
    // A browser test's progress text has nowhere to go when its caller streams none.
    const { onOutput = doNothing } = options;
    const run = (startTarget) => launchTarget.withPreviewTarget(sessionId, targetId, async (token) => {
      const pending = state.browserTestRuns.get(sessionId);
      if (pending?.admissionId) {
        pending.state = "running";
        await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      }
      options.signal.throwIfAborted();
      return operation(token);
    }, {
      startTarget: startTarget ? (start) => startTarget(async () => {
        options.signal.throwIfAborted();
        await validate();
        options.signal.throwIfAborted();
        return start();
      }) : undefined,
      signal: options.signal,
      onState: (targetState) => {
        const pending = state.browserTestRuns.get(sessionId);
        if (pending) pending.state = targetState;
      },
      waitUntilReady: async (terminal, { restoring = false } = {}) => {
        const waited = await waitForPreviewReady(launchTarget, sessionId, {
          terminalSessionId: terminal.id,
          signal: restoring ? null : options.signal
        });
        if (!waited.ok) throw new Error(waited.status?.error || (waited.timeout
          ? "Timed out waiting for Preview readiness." : "Preview failed to become ready."));
      }
    });
    const result = await run();
    const admission = result?.details?.admission;
    if (result?.code !== "vibe64_capacity_rejected" || admission?.outcome !== "unavailable" ||
        !admission.actions?.includes("recheck")) return result;
    options.signal.throwIfAborted();
    const { descriptor } = await validate();
    const provider = resourceProvider();
    const identity = { projectSlug: descriptor.project.slug, sessionId, admissionId: admission.id };
    const wait = await provider.beginWorkflowApprovalWait({
      ...identity,
      parentExecutionId: input.parentExecutionId,
      controlGenerationId: descriptor.controlGenerationId
    });
    let outcome = "interrupted";
    let timer;
    const pending = state.browserTestRuns.get(sessionId);
    Object.assign(pending, identity, { state: "waiting", expiresAt: wait.expiresAt });
    const decision = new Promise((resolve) => {
      pending.cancel = (reason) => {
        if (pending.state !== "waiting") return;
        pending.state = reason;
        outcome = reason;
        resolve(null);
      };
      pending.resume = (authorize) => {
        if (pending.state !== "waiting") return;
        pending.state = "resuming";
        clearTimeout(timer);
        resolve(authorize);
      };
    });
    const abort = () => pending.cancel("interrupted");
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    timer = setTimeout(() => pending.cancel("expired"), Math.max(0, Date.parse(wait.expiresAt) - Date.now()));
    try {
      onOutput(
        "Waiting for resources. Normal Preview has been restored. Retry or Cancel in Vibe64 within five minutes; tests have not run.\n"
      );
      await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      const authorizeStart = await decision;
      if (!authorizeStart) return responseError(
        outcome === "expired" ? "The resource wait expired. Tests were not run."
          : outcome === "cancelled" ? "The resource wait was cancelled. Tests were not run."
            : "The original test command ended. Tests were not run.",
        `vibe64_test_approval_${outcome}`, { details: result.details }
      );
      options.signal.throwIfAborted();
      await validate();
      outcome = "resumed";
      return await run(authorizeStart);
    } catch (error) {
      if (options.signal.aborted) outcome = "interrupted";
      error.details = { ...error.details, admission };
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      await provider.endWorkflowApprovalWait({ ...identity, outcome });
    }
  }

  async function playwrightRun(sessionId, input, options = {}) {
    input = structuredClone(input);
    if (state.browserTestRuns.has(sessionId) && !input.testRunToken) return responseError(
      "A browser test still owns this session. Use vibe64-helper playwright status, then cancel its run ID or wait for completion.",
      "vibe64_test_approval_busy"
    );
    const admission = launchTarget.previewTestRunAdmission(sessionId, trimmedText(input.testRunToken));
    if (admission) return admission;
    const parent = input.testRunToken ? state.browserTestRuns.get(sessionId) : null;
    const cancellation = new AbortController();
    const completion = Promise.withResolvers();
    const pending = !input.testRunToken ? {
      id: crypto.randomUUID(),
      projectSlug: workerRegistry.sessionProjectSlug(sessionId),
      targetId: input.targetId || "",
      state: "starting",
      startedAt: new Date().toISOString(),
      completion: completion.promise,
      children: [],
      interrupt: () => cancellation.abort()
    } : null;
    if (pending) {
      state.browserTestRuns.set(sessionId, pending);
    }
    options = {
      ...options,
      signal: AbortSignal.any([options.signal, cancellation.signal, parent?.signal].filter(Boolean))
    };
    if (pending) pending.signal = options.signal;
    if (parent) parent.children.push(completion.promise);
    const stopping = () => {
      if (pending && ["starting", "running"].includes(pending.state)) pending.state = "stopping";
    };
    options.signal.addEventListener("abort", stopping, { once: true });
    let result;
    try {
      result = await runRegisteredPlaywrightCommand(sessionId, input, {
        browserWorkers: state.browserWorkers,
        onOutput: options.onOutput,
        signal: options.signal,
        runCommand: async (request) => {
          if (pending && !input.targetId) pending.state = "running";
          const commandResult = await workerRegistry.runBrowserCommand(request);
          // The scoped wrapper may exit before its independently managed child.
          // Restoration must wait for every registered child to finish draining.
          const children = pending ? await Promise.all(pending.children) : [];
          const incomplete = [...children, commandResult].filter(browserTestNeedsCleanup);
          return incomplete.length ? {
            ...incomplete[0],
            cleanupExecutionIds: [...new Set(incomplete.flatMap(entry => entry.cleanupExecutionIds || [entry.execution?.id]))]
          } : commandResult;
        },
        withTarget: (targetId, operation, validate) => withTestApproval(sessionId, input, options, targetId, operation, validate)
      });
      if (browserTestNeedsCleanup(result)) {
        result = { ...result, previewRecoveryRequired: true };
        if (pending) pending.state = "cleanup_required";
      }
      return result;
    } catch (error) {
      result = responseError(error.message, error.code || "vibe64_managed_playwright_run_failed");
      return result;
    } finally {
      options.signal.removeEventListener("abort", stopping);
      completion.resolve(result);
      if (pending && !result?.previewRecoveryRequired && state.browserTestRuns.get(sessionId) === pending) {
        state.browserTestRuns.delete(sessionId);
        await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      }
    }
  }

  return Object.freeze({
    cancelPlaywrightRun,
    cancelTestApproval,
    playwrightRun,
    playwrightStatus,
    resumeTestApproval,
    testApprovalStatus
  });
}

export {
  createAgentPreviewBrowserTests
};
