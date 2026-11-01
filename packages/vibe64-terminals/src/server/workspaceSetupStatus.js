import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { workspaceSetupState } from "@local/vibe64-runtime/server/workspaceSetupState";

import { persist } from "./workspaceSetupRecords.js";
import {
  appendWorkspaceSetupTranscript,
  resourceIdentityMatches,
  workspaceSetupRunKey
} from "./workspaceSetupRules.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunnerState} WorkspaceSetupRunnerState */
/** @typedef {import("./types.js").WorkspaceSetupExecution} WorkspaceSetupExecution */

/**
 * A session's workspace setup status: marking it required again, whether it
 * is prepared for the current recipe and resources, and its run in progress.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {WorkspaceSetupRunnerState} dependencies.runnerState
 * @param {WorkspaceSetupExecution} dependencies.setupExecution
 */
function createWorkspaceSetupStatus({
  project,
  runnerState,
  setupExecution
}) {
  async function invalidate({ runtime, session, diagnostic } = {}) {
    const previous = workspaceSetupState(session.workspaceSetup);
    return persist(runtime, session.sessionId, {
      currentLabel: "",
      diagnostic,
      finishedAt: "",
      recipeHash: "",
      startedAt: "",
      status: "required",
      transcript: appendWorkspaceSetupTranscript(previous.transcript, diagnostic)
    });
  }

  async function isPrepared({ runtime, session } = {}) {
    if (runnerState.activeRuns.has(workspaceSetupRunKey(session?.sessionId))) {
      return false;
    }
    const previous = workspaceSetupState(session?.workspaceSetup);
    if (!["succeeded", "unconfigured"].includes(previous.status)) {
      return false;
    }
    const sourcePath = sessionSourcePath(session);
    if (!sourcePath) {
      return false;
    }
    let setup;
    try {
      setup = await runnerState.inspect({
        session,
        environment: await runtime.resolvePromptEnvironment(),
        projectRoot: sourcePath
      });
    } catch (error) {
      // Anything else still goes through start(), which owns diagnostics.
      return error?.code === "STACK_REQUIRED" && previous.status === "unconfigured";
    }
    if (setup.status === "unconfigured") {
      return previous.status === "unconfigured";
    }
    try {
      await setupExecution.connectedSourceRoots(setup, runtime, session);
    } catch {
      return false;
    }
    const environmentStatus = await project.projectEnvironmentStatus({ sessionId: session.sessionId, session });
    return setup.status === "ready" &&
      previous.status === "succeeded" &&
      Boolean(setup.recipeHash) &&
      previous.recipeHash === setup.recipeHash &&
      environmentStatus.status === "ready" &&
      resourceIdentityMatches(previous, environmentStatus);
  }

  function isRunning(sessionId = "") {
    return runnerState.activeRuns.has(workspaceSetupRunKey(toText(sessionId)));
  }

  function wait(sessionId = "") {
    return runnerState.activeRuns.get(workspaceSetupRunKey(toText(sessionId))) || null;
  }

  return Object.freeze({
    invalidate,
    isPrepared,
    isRunning,
    wait
  });
}

export {
  createWorkspaceSetupStatus
};
