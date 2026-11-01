import { finishVibe64Workflow, runVibe64Command } from "@local/vibe64-execution/server";
import { inspectGenesisProjectFormat, inspectVibe64WorkspaceSetup } from "@local/vibe64-genesis/server";

import { startResourceWorkflow } from "./resourceWorkflow.js";
import { WORKSPACE_SETUP_COMMAND_TIMEOUT_MS } from "./workspaceSetupRules.js";
import { createWorkspaceSetupRunnerState } from "./workspaceSetupRunnerState.js";
import { createWorkspaceSetupExecution } from "./workspaceSetupExecution.js";
import { createWorkspaceSetupMigration } from "./workspaceSetupMigration.js";
import { createWorkspaceSetupStart } from "./workspaceSetupStart.js";
import { createWorkspaceSetupStatus } from "./workspaceSetupStatus.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * A project's workspace setup runner. Each concern is built once, in
 * dependency order, and the runner offers its functions by name.
 * @param {object} dependencies
 * @param {(request: object) => Promise<object>} [dependencies.inspect]
 * @param {typeof inspectGenesisProjectFormat} [dependencies.inspectProjectFormat]
 * @param {(request: object) => Promise<object>} dependencies.connectedPreparation
 * @param {ProjectService} dependencies.projectService
 * @param {(request: object) => Promise<object>} [dependencies.startWorkflow]
 * @param {typeof finishVibe64Workflow} [dependencies.finishWorkflow]
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 */
function createWorkspaceSetupRunner({
  inspect: suppliedInspect = null,
  inspectProjectFormat = inspectGenesisProjectFormat,
  connectedPreparation,
  projectService,
  startWorkflow = startResourceWorkflow,
  finishWorkflow = finishVibe64Workflow,
  runCommand = runVibe64Command
}) {
  const inspect = suppliedInspect || projectService.inspectWorkspaceSetup?.bind(projectService) || inspectVibe64WorkspaceSetup;
  const runnerState = createWorkspaceSetupRunnerState({ inspect });
  const setupExecution = createWorkspaceSetupExecution({
    connectedPreparation,
    finishWorkflow,
    projectService,
    runCommand,
    runnerState,
    startWorkflow
  });
  const setupMigration = createWorkspaceSetupMigration({
    projectService,
    runCommand,
    runnerState
  });
  const setupStart = createWorkspaceSetupStart({
    connectedPreparation,
    inspectProjectFormat,
    projectService,
    runnerState,
    setupExecution,
    setupMigration
  });
  const setupStatus = createWorkspaceSetupStatus({
    projectService,
    runnerState,
    setupExecution
  });

  return Object.freeze({
    invalidate: setupStatus.invalidate,
    isPrepared: setupStatus.isPrepared,
    isRunning: setupStatus.isRunning,
    start: setupStart.start,
    wait: setupStatus.wait
  });
}

export {
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
  createWorkspaceSetupRunner
};
