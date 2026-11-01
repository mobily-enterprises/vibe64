import { Vibe64SessionRuntime } from "@local/vibe64-runtime/server/runtime";
import { agentWriteBusyError, runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import {
  captureProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";

/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectEnvironment} ProjectEnvironment */

/**
 * The selected project's session runtime, and source work that holds a session's
 * agent write lock while it runs.
 * @param {object} dependencies
 * @param {ProjectEnvironment} dependencies.environment
 * @param {ProjectSelection} dependencies.selection
 */
function createProjectSessionWork({ environment, selection }) {
  async function runSessionSourceWorkExclusive(input = {}, operation, operationName = "project-source-write", {
    waitMs = 0
  } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Session source work requires an operation.");
    }
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      return operation();
    }
    const runtime = await createRuntime({
      inspectSource: false
    });
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      operation,
      { operation: operationName, waitMs }
    );
    if (!exclusive.acquired) throw agentWriteBusyError(exclusive.value || undefined);
    return exclusive.value;
  }

  async function createRuntime(options = {}) {
    const requestContext = captureProjectRequestContext() || {};
    const target = selection.requireSelectedTargetRoot();
    return new Vibe64SessionRuntime({
      createSessionSource: options.createSessionSource,
      inspectSourceByDefault: options.inspectSource !== false,
      projectContextRoot: target,
      projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selection.selectedSessionSourceRoot(),
      promptEnvironment: () => runWithProjectRequestContext(requestContext, environment.promptEnvironment),
      store: selection.sessionStore()
    });
  }

  return Object.freeze({
    runSessionSourceWorkExclusive,
    createRuntime
  });
}

export {
  createProjectSessionWork
};
