import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { normalizeText } from "@local/vibe64-core/server/core";
import { workspaceSetupState } from "@local/vibe64-runtime/server/workspaceSetupState";

import { persist } from "./workspaceSetupRecords.js";
import {
  appendWorkspaceSetupTranscript,
  resourceIdentityMatches,
  workspaceSetupRunKey
} from "./workspaceSetupRules.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {ReturnType<typeof import("./workspaceSetupRunnerState.js").createWorkspaceSetupRunnerState>} WorkspaceSetupRunnerState */
/** @typedef {ReturnType<typeof import("./workspaceSetupExecution.js").createWorkspaceSetupExecution>} WorkspaceSetupExecution */

/**
 * A session's workspace setup status: marking it required again, whether it
 * is prepared for the current recipe and resources, and its run in progress.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.projectService
 * @param {WorkspaceSetupRunnerState} dependencies.runnerState
 * @param {WorkspaceSetupExecution} dependencies.setupExecution
 */
function createWorkspaceSetupStatus({ projectService, runnerState, setupExecution }) {
  return Object.freeze({
    async invalidate({ runtime, session, diagnostic } = {}) {
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
    },
    async isPrepared({ runtime, session } = {}) {
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
      // readable-check: allow method-probe - optional operation: a project service without environment status reports its resources ready
      const environmentStatus = typeof projectService.projectEnvironmentStatus === "function"
        ? await projectService.projectEnvironmentStatus({ sessionId: session.sessionId, session }) : { status: "ready" };
      return setup.status === "ready" &&
        previous.status === "succeeded" &&
        Boolean(setup.recipeHash) &&
        previous.recipeHash === setup.recipeHash &&
        environmentStatus.status === "ready" &&
        resourceIdentityMatches(previous, environmentStatus);
    },
    isRunning(sessionId = "") {
      return runnerState.activeRuns.has(workspaceSetupRunKey(normalizeText(sessionId)));
    },
    wait(sessionId = "") {
      return runnerState.activeRuns.get(workspaceSetupRunKey(normalizeText(sessionId))) || null;
    }
  });
}

export {
  createWorkspaceSetupStatus
};
