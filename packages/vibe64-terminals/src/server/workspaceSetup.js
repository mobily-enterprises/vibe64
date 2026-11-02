import { finishVibe64Workflow, runVibe64Command } from "@local/vibe64-execution/server";
import { inspectGenesisProjectFormat } from "@local/vibe64-genesis/server";

import { startResourceWorkflow } from "./resourceWorkflow.js";
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
 * @param {typeof inspectGenesisProjectFormat} [dependencies.inspectProjectFormat]
 * @param {(request: object) => Promise<object>} dependencies.connectedPreparation
 * @param {ProjectService} dependencies.project inspects each session's workspace setup
 * @param {(request: object) => Promise<object>} [dependencies.startWorkflow]
 * @param {typeof finishVibe64Workflow} [dependencies.finishWorkflow]
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 */
function createWorkspaceSetupRunner({
  inspectProjectFormat = inspectGenesisProjectFormat,
  connectedPreparation,
  project,
  startWorkflow = startResourceWorkflow,
  finishWorkflow = finishVibe64Workflow,
  runCommand = runVibe64Command
}) {
  const runnerState = createWorkspaceSetupRunnerState({ inspect: project.inspectWorkspaceSetup });
  const setupExecution = createWorkspaceSetupExecution({
    connectedPreparation,
    finishWorkflow,
    project,
    runCommand,
    runnerState,
    startWorkflow
  });
  const setupMigration = createWorkspaceSetupMigration({
    project,
    runCommand,
    runnerState
  });
  const setupStart = createWorkspaceSetupStart({
    connectedPreparation,
    inspectProjectFormat,
    project,
    runnerState,
    setupExecution,
    setupMigration
  });
  const setupStatus = createWorkspaceSetupStatus({
    project,
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
  createWorkspaceSetupRunner
};
