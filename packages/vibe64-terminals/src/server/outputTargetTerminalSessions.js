import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  resizeTerminalSession,
  stopTerminalSessionAndWait,
  subscribeTerminalSession,
  writeTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { stopActiveUsageRecording } from "@local/vibe64-usage-recording/server/activeRecordings";
import { currentProjectSlug, vibe64Result, outputTargetTerminalNamespace } from "./terminalShared.js";
import { readOutputResult, removeOutputResults } from "./outputResults.js";
import { writePreviewStopState } from "./outputTargetMetadata.js";
import { launchTerminalIsRunning } from "./launchPreviewReadiness.js";
import { latestLaunchTerminal } from "./launchPreviewStatus.js";
import { readLaunchContext } from "./outputTargetLaunchContext.js";

/** @typedef {import("./types.js").OutputTargetTerminalState} OutputTargetTerminalState */
/** @typedef {import("./types.js").OutputTargetLaunchCoordination} OutputTargetLaunchCoordination */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * The output target terminals of a session: reading, writing, resizing,
 * subscribing, stopping and closing them, their results, and the controller's
 * shutdown.
 * @param {object} dependencies
 * @param {OutputTargetTerminalState} dependencies.state
 * @param {OutputTargetLaunchCoordination} dependencies.launchCoordination
 * @param {ProjectService} dependencies.projectService
 * @param {(sessionId: string) => Promise<object>} dependencies.stopPreviewBrowsers
 */
function createOutputTargetTerminalSessions({
  state,
  launchCoordination,
  projectService,
  stopPreviewBrowsers
}) {
  async function close() {
    for (const testRun of state.previewTestRuns.values()) testRun.closing = true;
    await Promise.allSettled([
      ...state.launchReadyWrites.pending(),
      ...state.outputResultWrites.pending()
    ]);
    await state.launchPreviewProxies.closeAll();
  }

  async function closeAllForSession(sessionId) {
    const testRun = state.previewTestRuns.get(sessionId);
    if (testRun) testRun.closing = true;
    await stopActiveUsageRecording(currentProjectScopeKey(), sessionId, "session-ended");
    return launchCoordination.withLaunchStartLock(sessionId, async () => {
      await state.launchPreviewProxies.close({
        sessionId
      });
      return closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
    });
  }

  async function removeResultsForSession(sessionId) {
    const context = await readLaunchContext(projectService, sessionId);
    await removeOutputResults(context.session);
    return {
      ok: true,
      removed: true,
      sessionId: String(sessionId || "")
    };
  }

  async function closeTerminal(sessionId, terminalSessionId) {
    if (state.previewTestRuns.has(sessionId)) {
      return {
        ok: false,
        code: "vibe64_preview_test_busy",
        error: "Browser tests own this Preview. Stop the test command before closing Preview."
      };
    }
    await state.launchPreviewProxies.close({
      sessionId,
      terminalSessionId
    });
    return closeTerminalSession(terminalSessionId, {
      namespace: outputTargetTerminalNamespace(sessionId)
    });
  }

  async function readResult(sessionId, resultId) {
    const context = await readLaunchContext(projectService, sessionId);
    return readOutputResult(context.session, resultId);
  }

  function readTerminal(sessionId, terminalSessionId) {
    return readTerminalSession(terminalSessionId, {
      namespace: outputTargetTerminalNamespace(sessionId)
    });
  }

  async function stopTerminal(sessionId, terminalSessionId) {
    return vibe64Result(async () => launchCoordination.withLaunchStartLock(sessionId, async () => {
      if (state.previewTestRuns.has(sessionId)) {
        return {
          ok: false,
          code: "vibe64_preview_test_busy",
          error: "Browser tests own this Preview. Stop the test command before stopping Preview."
        };
      }
      const active = latestLaunchTerminal(sessionId);
      const requestedId = String(terminalSessionId || "").trim();
      if (requestedId && active?.id && active.id !== requestedId && launchTerminalIsRunning(active)) {
        return {
          ok: false,
          code: "vibe64_preview_run_changed",
          error: "A newer Preview run is active. Refresh its status before stopping it."
        };
      }
      const runtime = await projectService.createRuntime();
      const projectSlug = currentProjectSlug(projectService);
      await writePreviewStopState(runtime.store, sessionId, { stopped: true });
      const activeId = active?.id && (!requestedId || active.id === requestedId) ? active.id : "";
      let result = { ok: true, id: requestedId, running: false, status: "exited" };
      try {
        if (activeId && launchTerminalIsRunning(active)) {
          result = await stopTerminalSessionAndWait(activeId, {
            namespace: outputTargetTerminalNamespace(sessionId)
          });
          if (result?.ok === false) throw new Error(result.error || "Preview process did not stop.");
        }
        await state.launchPreviewProxies.close({ sessionId });
        const browserCleanup = await stopPreviewBrowsers(sessionId);
        if (browserCleanup?.ok === false) throw new Error(browserCleanup.error || "Managed Preview browser did not stop.");
        await writePreviewStopState(runtime.store, sessionId, { stopped: true });
        launchCoordination.publishLaunchCleanup(sessionId, projectSlug, "preview-stopped");
        return result;
      } catch (error) {
        const message = String(error?.message || error || "Preview cleanup failed.");
        await writePreviewStopState(runtime.store, sessionId, { stopped: true, error: message });
        launchCoordination.publishLaunchCleanup(sessionId, projectSlug, "preview-stop-failed");
        return { ok: false, code: "vibe64_preview_stop_incomplete", error: message };
      }
    }));
  }

  function subscribeTerminal(sessionId, terminalSessionId, subscriber) {
    return subscribeTerminalSession(terminalSessionId, subscriber, {
      namespace: outputTargetTerminalNamespace(sessionId)
    });
  }

  function writeTerminal(sessionId, terminalSessionId, data) {
    return writeTerminalSession(terminalSessionId, data, {
      namespace: outputTargetTerminalNamespace(sessionId)
    });
  }

  function resizeTerminal(sessionId, terminalSessionId, size) {
    return resizeTerminalSession(terminalSessionId, size, {
      namespace: outputTargetTerminalNamespace(sessionId)
    });
  }

  return Object.freeze({
    close,
    closeAllForSession,
    removeResultsForSession,
    closeTerminal,
    readResult,
    readTerminal,
    stopTerminal,
    subscribeTerminal,
    writeTerminal,
    resizeTerminal
  });
}

export {
  createOutputTargetTerminalSessions
};
