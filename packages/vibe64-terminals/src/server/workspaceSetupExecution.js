import path from "node:path";

import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sanitizeOperationText } from "@local/vibe64-core/server/logging";
import {
  workspaceSetupState,
  workspaceSetupTranscript
} from "@local/vibe64-runtime/server/workspaceSetupState";

import { loadProjectExecutionEnvRecords, projectExecutionEnvFromRecords } from "./projectExecutionEnv.js";
import { failed, persist } from "./workspaceSetupRecords.js";
import {
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
  appendWorkspaceSetupTranscript,
  capturedCommandOutput,
  commandDiagnostic,
  inProjectContext,
  operationRedactionSecrets,
  safeSetupLabel,
  stepStatus
} from "./workspaceSetupRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunnerState} WorkspaceSetupRunnerState */

/**
 * Runs a prepared recipe's steps in an admitted resource workflow, inside the
 * session source and its connected sources, and observes each run until it
 * settles, recording a failure it did not record itself.
 * @param {object} dependencies
 * @param {(request: object) => Promise<object>} dependencies.connectedPreparation
 * @param {typeof import("@local/vibe64-execution/server").finishVibe64Workflow} dependencies.finishWorkflow
 * @param {ProjectService} dependencies.project
 * @param {typeof import("@local/vibe64-execution/server").runVibe64Command} dependencies.runCommand
 * @param {WorkspaceSetupRunnerState} dependencies.runnerState
 * @param {(request: object) => Promise<object>} dependencies.startWorkflow
 */
function createWorkspaceSetupExecution({
  connectedPreparation,
  finishWorkflow,
  project,
  runCommand,
  runnerState,
  startWorkflow
}) {
  async function connectedSourceRoots(setup, runtime, session) {
    if (!setup.connectedDevelopment) return [];
    const inputs = await connectedPreparation({ mode: "inspect", runtime, session });
    if (inputs?.ok === false) throw Object.assign(new Error(inputs.error), { code: inputs.code });
    if (inputs?.inputsHash !== setup.connectedDevelopment.inputsHash || !Array.isArray(inputs.sourceRoots)) {
      throw new Error("Connected source selection changed. Prepare the workspace again before running commands.");
    }
    return inputs.sourceRoots;
  }

  async function execute({
    context,
    recipe,
    runtime,
    session,
    sourcePath,
    startedAt,
    preparedEnvironment
  }) {
    const environmentRecords = preparedEnvironment || await loadProjectExecutionEnvRecords({
      prepare: true,
      includeResourceConfiguration: true,
      project,
      session,
      target: "workspace-setup"
    });
    const projectEnv = projectExecutionEnvFromRecords(environmentRecords);
    const redactionSecrets = operationRedactionSecrets(projectEnv);
    context.redactionSecrets = redactionSecrets;
    context.transcript = workspaceSetupTranscript(sanitizeOperationText(
      context.transcript,
      redactionSecrets
    ));
    const environment = await runtime.resolvePromptEnvironment();
    const currentSetup = await runnerState.inspect({ environment, projectRoot: sourcePath, session });
    if (currentSetup?.status !== "ready" || currentSetup.recipeHash !== recipe.recipeHash) {
      throw new Error("Workspace setup changed while preparing its environment. Retry preparation to run the current steps.");
    }
    const resource = await startWorkflow({
      session,
      sourceRoot: sourcePath,
      operation: { kind: "workspace-setup" },
      runtimes: recipe.runtimes,
      steps: recipe.steps.map((step) => ({ argv: step.argv, workdir: path.relative(sourcePath, step.cwd) || "." })),
      estimates: currentSetup.resourceEstimates,
      configuration: { environmentFingerprint: environmentRecords.resourceConfigurationFingerprint },
      kind: "job",
      label: "Preparing workspace",
      env: environment
    });
    if (resource?.ok === false) throw Object.assign(new Error(resource.error || "Workspace preparation could not be admitted."), {
      code: resource.code,
      details: { admission: resource.admission }
    });
    let outcome = "failed";
    try {
      const admittedSetup = await runnerState.inspect({ environment, projectRoot: sourcePath, session });
      if (admittedSetup?.status !== "ready" || admittedSetup.recipeHash !== recipe.recipeHash ||
          admittedSetup.stackHash !== currentSetup.stackHash) {
        throw new Error("Workspace setup changed while waiting for resources. Retry preparation to run the current steps.");
      }
      for (const [index, step] of recipe.steps.entries()) {
        const connectedRoots = await connectedSourceRoots(admittedSetup, runtime, session);
        const currentLabel = safeSetupLabel(step.label, redactionSecrets);
        context.currentLabel = currentLabel;
        if (index > 0) {
          context.transcript = appendWorkspaceSetupTranscript(
            context.transcript,
            stepStatus(currentLabel, "Running", redactionSecrets)
          );
        }
        await persist(runtime, session.sessionId, {
          currentLabel,
          diagnostic: "",
          finishedAt: "",
          recipeHash: recipe.recipeHash,
          startedAt,
          status: "running",
          transcript: context.transcript
        }, context.renewal);
        const result = await runCommand({
          actor: "app",
          allowedRoots: [sourcePath, ...connectedRoots],
          args: step.argv.slice(1),
          baseEnv: await runtime.resolvePromptEnvironment(),
          command: step.argv[0],
          cwd: step.cwd,
          envPolicy: "project",
          execution: {
            kind: "job",
            label: currentLabel,
            workflowId: resource?.workflow?.id,
            ownerId: session.sessionId,
            sessionId: session.sessionId,
            projectSlug: currentProjectRequestContext()?.slug
          },
          mode: "capture",
          project: {
            runtimeConfigEnv: projectEnv
          },
          purpose: "source",
          runtimes: recipe.runtimes,
          timeout: WORKSPACE_SETUP_COMMAND_TIMEOUT_MS
        });
        context.transcript = appendWorkspaceSetupTranscript(
          context.transcript,
          capturedCommandOutput(result, redactionSecrets)
        );
        if (result?.ok !== true) {
          return failed(runtime, session.sessionId, {
            currentLabel,
            diagnostic: commandDiagnostic(result, currentLabel, redactionSecrets),
            recipeHash: recipe.recipeHash,
            redactionSecrets,
            renewal: context.renewal,
            runtimes: recipe.runtimes,
            startedAt,
            transcript: context.transcript
          });
        }
        context.transcript = appendWorkspaceSetupTranscript(
          context.transcript,
          stepStatus(currentLabel, "Succeeded", redactionSecrets)
        );
      }
      outcome = "succeeded";
      return await persist(runtime, session.sessionId, {
        currentLabel: context.currentLabel,
        diagnostic: "",
        finishedAt: new Date().toISOString(),
        recipeHash: recipe.recipeHash,
        resourceIdentity: environmentRecords.resourcePreparation?.identity,
        startedAt,
        status: "succeeded",
        transcript: appendWorkspaceSetupTranscript(
          context.transcript,
          "Workspace preparation succeeded."
        )
      }, context.renewal);
    } catch (error) {
      outcome = "failed";
      throw error;
    } finally {
      await finishWorkflow(resource?.workflow?.id, { outcome, defer: true });
    }
  }

  function observe(sessionId, operation, context) {
    const completion = operation
      .catch((error) => inProjectContext(context.projectContext, async () => failed(context.runtime, sessionId, {
        currentLabel: context.currentLabel,
        diagnostic: toText(error?.message) || "Workspace preparation failed.",
        recipeHash: context.recipeHash,
        redactionSecrets: context.redactionSecrets,
        resourceAdmissionId: error?.details?.admission?.id,
        renewal: context.renewal,
        startedAt: context.startedAt,
        transcript: context.transcript
      }).catch(() => workspaceSetupState({
        currentLabel: safeSetupLabel(context.currentLabel, context.redactionSecrets),
        diagnostic: sanitizeOperationText(
          toText(error?.message) || "Workspace preparation failed.",
          context.redactionSecrets
        ),
        finishedAt: new Date().toISOString(),
        recipeHash: context.recipeHash,
        resourceAdmissionId: error?.details?.admission?.id,
        startedAt: context.startedAt,
        status: "failed",
        transcript: appendWorkspaceSetupTranscript(
          sanitizeOperationText(context.transcript, context.redactionSecrets),
          stepStatus(context.currentLabel, "Failed", context.redactionSecrets)
        ),
        updatedAt: new Date().toISOString()
      }))))
      .finally(() => inProjectContext(context.projectContext, () => {
        if (runnerState.activeRuns.get(context.runKey) === completion) {
          runnerState.activeRuns.delete(context.runKey);
        }
      }));
    runnerState.activeRuns.set(context.runKey, completion);
    return completion;
  }

  return Object.freeze({
    connectedSourceRoots,
    execute,
    observe
  });
}

export {
  createWorkspaceSetupExecution
};
