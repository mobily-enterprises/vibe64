import { trimmedText } from "./trimmedText.js";
import {
  startRegisteredBrowserWorker,
  stopRegisteredBrowserWorker,
  stopRegisteredBrowserWorkerForInput
} from "./agentPreviewBrowserWorker.js";

/** @typedef {import("./types.js").AgentPreviewCommandState} AgentPreviewCommandState */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {typeof import("@local/vibe64-execution/server").runVibe64Command} RunVibe64Command */
/** @typedef {ReturnType<typeof import("./unixJsonCommand.js").createSessionCommandServers>} SessionCommandServers */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64Execution} StopVibe64Execution */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64OwnedExecutions} StopVibe64OwnedExecutions */

/**
 * Each session's registered Preview browser workers: registering a worker's
 * generation, running the browser's managed commands in the session's
 * project, starting and stopping workers, and tearing a session's workers and
 * command servers down.
 * @param {object} dependencies
 * @param {AgentPreviewCommandState} dependencies.state
 * @param {SessionCommandServers} dependencies.commandServers
 * @param {ProjectService} dependencies.projectService
 * @param {RunVibe64Command} dependencies.runManagedCommand
 * @param {StopVibe64Execution} dependencies.stopManagedExecution
 * @param {StopVibe64OwnedExecutions} dependencies.stopOwnedExecutions
 */
function createAgentPreviewWorkerRegistry({
  state,
  commandServers,
  projectService,
  runManagedCommand,
  stopManagedExecution,
  stopOwnedExecutions
}) {
  /**
   * The project that prepared the session's assistant commands. A browser
   * test's changes name it, because its command can arrive outside any
   * request, as after a restart.
   */
  function sessionProjectSlug(sessionId) {
    const project = [...(state.browserWorkers.get(sessionId)?.values() || [])][0]?.project;
    return trimmedText(project?.slug || project?.name);
  }

  async function runBrowserCommand(request) {
    const runtimeConfigEnv = await projectService.runInProjectContext(request.project.slug, () => (
      projectService.projectInspectionEnvironment({
        sessionId: request.session.sessionId,
        target: "preview"
      })
    ));
    return runManagedCommand({
      ...request,
      project: { ...request.project, runtimeConfigEnv }
    });
  }

  function registerBrowserWorker(sessionId = "", descriptor = {}) {
    const normalizedSessionId = trimmedText(sessionId);
    const socketPath = trimmedText(descriptor.socketPath);
    if (!normalizedSessionId || !socketPath) {
      return false;
    }
    const sessionWorkers = state.browserWorkers.get(normalizedSessionId) || new Map();
    const existing = sessionWorkers.get(socketPath);
    const sameGeneration = trimmedText(existing?.token) === trimmedText(descriptor.token);
    if (existing && !sameGeneration) state.browserTestRuns.get(normalizedSessionId)?.interrupt();
    sessionWorkers.set(socketPath, {
      ...descriptor,
      executionId: sameGeneration ? trimmedText(existing?.executionId) : "",
      retiredDescriptors: sameGeneration
        ? (existing?.retiredDescriptors || [])
        : [
            ...(existing?.retiredDescriptors || []),
            ...(existing ? [existing] : [])
          ],
      sessionId: normalizedSessionId,
      socketPath
    });
    state.browserWorkers.set(normalizedSessionId, sessionWorkers);
    return true;
  }

  /**
   * Interrupts a pending browser test, stops every registered worker and
   * closes the session's command servers; returns the worker count.
   */
  async function teardownSession(sessionId = "", options = {}) {
    const { forget = false, reason = "" } = options;
    const normalizedSessionId = trimmedText(sessionId);
    const pending = state.browserTestRuns.get(normalizedSessionId);
    pending?.interrupt();
    await pending?.completion;
    const sessionWorkers = state.browserWorkers.get(normalizedSessionId) || new Map();
    if (forget) {
      state.browserWorkers.delete(normalizedSessionId);
    }
    let closed = 0;
    for (const descriptor of sessionWorkers.values()) {
      await stopRegisteredBrowserWorker(descriptor, {
        reason,
        stopExecution: stopManagedExecution,
        stopOwnedExecutions
      });
      closed += 1;
    }
    await commandServers.closeForSession(normalizedSessionId);
    return closed;
  }

  async function closeAllForSession(sessionId = "") {
    const closed = await teardownSession(sessionId, { forget: true, reason: "session-close" });
    return {
      closed,
      ok: true
    };
  }

  async function stopBrowsersForSession(sessionId = "") {
    const sessionWorkers = state.browserWorkers.get(trimmedText(sessionId));
    if (!sessionWorkers) return { ok: true, closed: 0 };
    let closed = 0;
    for (const descriptor of sessionWorkers.values()) {
      const result = await stopRegisteredBrowserWorker(descriptor, {
        reason: "preview-stop",
        stopExecution: stopManagedExecution,
        stopOwnedExecutions
      });
      if (result?.ok === false) return result;
      closed += 1;
    }
    // Preview owns browser processes, not the assistant's command registration.
    // Keep it usable for the next launch; session closure retires it separately.
    return { ok: true, closed };
  }

  async function releaseControlForSession(sessionId = "") {
    await teardownSession(sessionId, { reason: "control-release" });
    return {
      ok: true
    };
  }

  function browserStart(sessionId, input) {
    return startRegisteredBrowserWorker(sessionId, input, {
      browserWorkers: state.browserWorkers,
      runCommand: runBrowserCommand,
      stopExecution: stopManagedExecution,
      stopOwnedExecutions
    });
  }

  function browserStop(sessionId, input) {
    return stopRegisteredBrowserWorkerForInput(sessionId, input, {
      browserWorkers: state.browserWorkers,
      stopExecution: stopManagedExecution,
      stopOwnedExecutions
    });
  }

  return Object.freeze({
    browserStart,
    browserStop,
    closeAllForSession,
    registerBrowserWorker,
    releaseControlForSession,
    runBrowserCommand,
    sessionProjectSlug,
    stopBrowsersForSession
  });
}

export {
  createAgentPreviewWorkerRegistry
};
