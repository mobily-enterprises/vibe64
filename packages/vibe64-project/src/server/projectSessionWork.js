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
  async function runSessionSourceWorkExclusive(input, operation, operationName = "project-source-write", options = {}) {
    const {
      waitMs = 0
    } = options;
    if (typeof operation !== "function") {
      throw new TypeError("Session source work requires an operation.");
    }
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      return operation();
    }
    const runtime = await createRuntimeWithoutSource();
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      operation,
      { operation: operationName, waitMs }
    );
    if (!exclusive.acquired) throw agentWriteBusyError(exclusive.value || undefined);
    return exclusive.value;
  }

  function sessionRuntimeOptions(options) {
    const requestContext = captureProjectRequestContext() || {};
    const target = selection.requireSelectedTargetRoot();
    return {
      createSessionSource: options.createSessionSource,
      projectContextRoot: target,
      projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selection.selectedSessionSourceRoot(),
      promptEnvironment: () => runWithProjectRequestContext(requestContext, environment.promptEnvironment),
      store: selection.sessionStore()
    };
  }

  /** A session runtime of the selected project; its session reads inspect the source checkout. */
  async function createRuntime(options = {}) {
    return new Vibe64SessionRuntime(sessionRuntimeOptions(options));
  }

  /** A session runtime of the selected project whose session reads never inspect the source checkout. */
  async function createRuntimeWithoutSource(options = {}) {
    return new Vibe64SessionRuntime({
      ...sessionRuntimeOptions(options),
      inspectSourceByDefault: false
    });
  }

  return Object.freeze({
    runSessionSourceWorkExclusive,
    createRuntime,
    createRuntimeWithoutSource
  });
}

export {
  createProjectSessionWork
};
