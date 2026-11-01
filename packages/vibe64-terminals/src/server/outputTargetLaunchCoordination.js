import { beginTerminalNamespaceOperation } from "@local/vibe64-execution/server/terminalSessions";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";
import { snapshotDeclaredOutputResults } from "./outputResults.js";
import { normalizeOpenTarget } from "./outputTargetMetadata.js";
import { outputTargetTerminalNamespace } from "./terminalShared.js";
import { ensureLaunchPreviewProxy, markLaunchTerminalReady } from "./launchPreviewReadiness.js";
import { resolveLaunchPreviewStatus } from "./launchPreviewStatus.js";

/** @typedef {import("./types.js").OutputTargetTerminalState} OutputTargetTerminalState */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */

// One write per key at a time: a second request for the key shares the write
// in flight, and the key is free again once that write settles.
function sharedWrite(writes, key, startWrite) {
  const existing = writes.get(key);
  if (existing) {
    return existing;
  }
  const tracked = startWrite().finally(() => {
    if (writes.get(key) === tracked) {
      writes.delete(key);
    }
  });
  writes.set(key, tracked);
  return tracked;
}

/**
 * The coordination every launch shares: one start at a time per session,
 * the session's admission, the Preview status read, the readiness and result
 * writes a running launch makes, the eager Preview proxy and the cleanup
 * announcements.
 * @param {object} dependencies
 * @param {OutputTargetTerminalState} dependencies.state
 * @param {RuntimeEnv} dependencies.env
 * @param {ProjectService} dependencies.projectService
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof import("@local/vibe64-execution/server").runVibe64Command} dependencies.runCommand
 * @param {typeof import("@local/vibe64-execution/server").setVibe64WorkflowPhase} dependencies.setWorkflowPhase
 * @param {(sessionId: string) => object | null} dependencies.sessionAdmissionFailure
 */
function createOutputTargetLaunchCoordination({
  state,
  env,
  projectService,
  publishSessionChanged,
  runCommand,
  setWorkflowPhase,
  sessionAdmissionFailure
}) {
  const launchStartLocks = new Map();

  // The environment, project and command runner a Preview status read or
  // proxy start runs with, after the caller's own options.
  function launchCommandOptions(options = {}) {
    return {
      ...options,
      env,
      projectService,
      runCommand
    };
  }

  function publishLaunchCleanup(sessionId, projectSlug, reason = "output-target-stale-cleared") {
    // Process cleanup must not wait for realtime delivery or its access checks.
    void Promise.resolve().then(() => publishSessionChanged(sessionId, {
      projectSlug,
      reason
    })).catch((error) => {
      vibe64SessionDebugLog("server.outputTargetTerminal.cleanupPublication.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      }, { level: "warn" });
    });
  }

  async function ensureReadyLaunchPreviewProxy(context = {}, terminal = {}, {
    source = "ready"
  } = {}) {
    const metadata = terminal.metadata || {};
    const targetHref = String(
      normalizeOpenTarget(metadata.openTarget || {}).href || metadata.targetUrl || ""
    ).trim();
    const previewPublicOrigin = String(metadata.previewPublicOrigin || "").trim();
    if (
      metadata.outputPresentationKind !== "web" ||
      !targetHref ||
      !previewPublicOrigin
    ) {
      return false;
    }
    try {
      await ensureLaunchPreviewProxy({
        context,
        launchPreviewProxies: state.launchPreviewProxies,
        options: launchCommandOptions(),
        previewPublicOrigin,
        sessionId: context.session?.sessionId || metadata.sessionId || "",
        targetHref,
        terminal
      });
      return true;
    } catch (error) {
      vibe64SessionDebugLog("server.outputTargetTerminal.previewProxy.eagerEnsureError", {
        error: vibe64SessionDebugError(error),
        sessionId: String(context.session?.sessionId || metadata.sessionId || ""),
        source,
        terminalSessionId: String(terminal.id || "")
      }, {
        level: "warn"
      });
      return false;
    }
  }

  function captureOutputResults({
    context = {},
    outputTarget = {},
    spec = {},
    terminalSessionId = "",
    updateMetadata = () => null
  } = {}) {
    const downloads = Array.isArray(spec.metadata?.outputDownloads)
      ? spec.metadata.outputDownloads
      : [];
    if (downloads.length === 0 || !terminalSessionId) {
      return Promise.resolve({
        captured: false,
        ok: true,
        results: []
      });
    }
    const key = `${String(context.session?.sessionRoot || "")}:${terminalSessionId}`;
    return sharedWrite(state.outputResultWrites, key, () => snapshotDeclaredOutputResults({
      downloads,
      outputTargetId: outputTarget.id,
      session: context.session,
      terminalSessionId
    }).then(async (snapshot) => {
      updateMetadata({
        outputResultError: null,
        outputResults: snapshot.results,
        outputResultsReady: true,
        outputRun: snapshot.run
      });
      await publishSessionChanged(context.session?.sessionId || "", {
        projectSlug: context.projectSlug,
        reason: "output-results-ready"
      });
      return {
        ...snapshot,
        ok: true
      };
    }).catch(async (error) => {
      const outputResultFailure = {
        code: String(error?.code || "vibe64_output_result_snapshot_failed"),
        message: String(error?.message || error || "Declared downloads could not be snapshotted.")
      };
      updateMetadata({
        outputResultError: outputResultFailure,
        outputResultsReady: false
      });
      await publishSessionChanged(context.session?.sessionId || "", {
        projectSlug: context.projectSlug,
        reason: "output-results-failed"
      }).catch(() => null);
      vibe64SessionDebugLog("server.outputTargetTerminal.results.error", {
        error: vibe64SessionDebugError(error),
        outputTargetId: outputTarget.id,
        sessionId: context.session?.sessionId || "",
        terminalSessionId
      }, {
        level: "warn"
      });
      return {
        error: outputResultFailure,
        ok: false,
        results: []
      };
    }));
  }

  function markLaunchReady(input = {}) {
    const terminalSessionId = String(input.terminalSession?.id || "").trim();
    const key = `${String(input.namespace || "")}:${terminalSessionId}`;
    return sharedWrite(state.launchReadyWrites, key, () => Promise.resolve().then(async () => {
      const result = await markLaunchTerminalReady(input);
      const metadata = input.terminalSession?.metadata;
      if (result?.ready && metadata?.outputMode === "interactive") {
        await setWorkflowPhase(metadata.resourceWorkflowId, "running");
      }
      return result;
    }));
  }

  async function withLaunchStartLock(sessionId = "", operation) {
    const key = String(sessionId || "global");
    const previous = launchStartLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => null).then(operation);
    const tracked = run.catch(() => null).finally(() => {
      if (launchStartLocks.get(key) === tracked) {
        launchStartLocks.delete(key);
      }
    });
    launchStartLocks.set(key, tracked);
    return run;
  }

  function launchAdmissionFailure(sessionId = "", session = null) {
    const frozen = sessionAdmissionFailure(sessionId);
    if (frozen?.ok === false) {
      return frozen;
    }
    const closingReason = sessionClosingReason(session || {});
    if (!closingReason) {
      return null;
    }
    const renewing = String(session?.status || "").trim() === "renewal_quiesced";
    return {
      code: renewing ? "vibe64_session_renewal_quiesced" : "vibe64_session_closing",
      error: renewing
        ? "Session renewal has frozen preview access."
        : `Session is ${closingReason} and preview access is unavailable.`,
      ok: false
    };
  }

  // Runs one launch operation inside the session's output terminal admission,
  // refusing it while the session is frozen for renewal or closing.
  async function withLaunchAdmission(sessionId, operation) {
    const admission = beginTerminalNamespaceOperation(outputTargetTerminalNamespace(sessionId));
    if (admission.ok === false) {
      return launchAdmissionFailure(sessionId) || admission;
    }
    try {
      const frozen = launchAdmissionFailure(sessionId);
      if (frozen) {
        return frozen;
      }
      return await operation();
    } finally {
      admission.release();
    }
  }

  function resolvePreviewStatus(sessionId, context, outputTargets, options = {}) {
    return resolveLaunchPreviewStatus({
      context,
      launchPreviewProxies: state.launchPreviewProxies,
      outputTargets,
      markReady: markLaunchReady,
      options: launchCommandOptions(options),
      publishSessionChanged,
      sessionId
    });
  }

  return Object.freeze({
    publishLaunchCleanup,
    ensureReadyLaunchPreviewProxy,
    captureOutputResults,
    markLaunchReady,
    withLaunchStartLock,
    launchAdmissionFailure,
    withLaunchAdmission,
    resolvePreviewStatus
  });
}

export {
  createOutputTargetLaunchCoordination
};
