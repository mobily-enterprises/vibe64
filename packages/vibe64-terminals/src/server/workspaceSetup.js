import { finishVibe64Workflow, runVibe64Command } from "@local/vibe64-execution/server";
import { inspectGenesisProjectFormat } from "@local/vibe64-genesis/server";

import { startResourceWorkflow } from "./resourceWorkflow.js";
import { createWorkspaceSetupRunnerState } from "./workspaceSetupRunnerState.js";
import { createWorkspaceSetupExecution } from "./workspaceSetupExecution.js";
import { createWorkspaceSetupMigration } from "./workspaceSetupMigration.js";
import { createWorkspaceSetupStart } from "./workspaceSetupStart.js";
import { createWorkspaceSetupStatus } from "./workspaceSetupStatus.js";
import { readPreparedTree, readStepInputs } from "./workspaceSetupTree.js";
import { preparedRecipe } from "./workspaceSetupRules.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * A project's workspace setup runner. Each concern is built once, in
 * dependency order, and the runner offers its functions by name.
 * @param {object} dependencies
 * @param {typeof inspectGenesisProjectFormat} [dependencies.inspectProjectFormat]
 * @param {(request: object) => Promise<object>} dependencies.connectedPreparation
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger] hears each run's and step's start and finish
 * @param {ProjectService} dependencies.project inspects each session's workspace setup
 * @param {(request: object) => Promise<object>} [dependencies.startWorkflow]
 * @param {typeof finishVibe64Workflow} [dependencies.finishWorkflow]
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {typeof readStepInputs} [dependencies.readInputs] reads what the inputs a step names hold
 * @param {typeof readPreparedTree} [dependencies.readTree] reads the tree a preparation prepares
 */
function createWorkspaceSetupRunner({
  inspectProjectFormat = inspectGenesisProjectFormat,
  connectedPreparation,
  logger,
  project,
  startWorkflow = startResourceWorkflow,
  finishWorkflow = finishVibe64Workflow,
  readInputs = readStepInputs,
  readTree = readPreparedTree,
  runCommand = runVibe64Command
}) {
  const runnerState = createWorkspaceSetupRunnerState({ inspect: project.inspectWorkspaceSetup });
  const setupExecution = createWorkspaceSetupExecution({
    connectedPreparation,
    finishWorkflow,
    logger,
    project,
    readInputs,
    readTree,
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

  /**
   * Keeps a prepared session's swapped connected packages in step with its connected copies, when
   * nothing does yet (after a restart). Preparation starts it itself.
   */
  async function keepConnectedInSync({ runtime, session }) {
    const sourcePath = sessionSourcePath(session);
    const setup = await runnerState.inspect({ session, environment: await runtime.resolvePromptEnvironment(), projectRoot: sourcePath });
    if (setup?.status !== "ready" || !setup.connectedDevelopment?.adapters) return;
    await setupExecution.ensureConnectedSync({ runtime, session, setup, runtimes: preparedRecipe(setup, sourcePath).runtimes, sourcePath });
  }

  /**
   * What Save runs for a session whose ready recipe has connected development (its typed
   * dependencies' published versions and the Stack's Save entries); null when it has none.
   */
  async function connectedSaveRunner({ runtime, session }) {
    const sourcePath = sessionSourcePath(session);
    const setup = await runnerState.inspect({ session, environment: await runtime.resolvePromptEnvironment(), projectRoot: sourcePath });
    if (setup?.status !== "ready" || !setup.connectedDevelopment) return null;
    const { runtimes } = preparedRecipe(setup, sourcePath);
    return setupExecution.connectedSaveCommand({ runtime, session, setup, runtimes, sourcePath });
  }

  return Object.freeze({
    connectedSaveRunner,
    invalidate: setupStatus.invalidate,
    keepConnectedInSync,
    isPrepared: setupStatus.isPrepared,
    isRunning: setupStatus.isRunning,
    start: setupStart.start,
    wait: setupStatus.wait
  });
}

export {
  createWorkspaceSetupRunner
};
