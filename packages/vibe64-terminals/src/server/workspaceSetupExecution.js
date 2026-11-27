import path from "node:path";

import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { connectedSyncRunning, stopConnectedSync } from "@local/vibe64-project/server/connectedSync";
import { executionCleanupRequired } from "@local/vibe64-execution/server";
import { logOperationalEvent, sanitizeOperationText } from "@local/vibe64-core/server/logging";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
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
  setupStep,
  stepRecordValue,
  stepStatus
} from "./workspaceSetupRules.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunnerState} WorkspaceSetupRunnerState */

const WORKSPACE_SETUP_CANCELLED = "Workspace preparation was cancelled. Prepare workspace runs every step again.";
const STEP_SKIPPED = "Skipped: what it reads and runs is unchanged since it last succeeded";

/** The transcript without its last line when that line is `line`. */
function withoutLastLine(transcript, line) {
  if (transcript === line) return "";
  return transcript.endsWith(`\n${line}`) ? transcript.slice(0, -line.length - 1) : transcript;
}

/**
 * Runs a prepared recipe's steps in an admitted resource workflow, inside the
 * session source and its connected sources, and observes each run until it
 * settles, recording a failure it did not record itself. A step that names its
 * inputs is skipped while its command and what those inputs hold are unchanged
 * since it last succeeded on the same resources, and recorded each time it
 * succeeds. A run's `signal` (an AI task's Cancel) stops the step that is
 * running and every later one; the run is recorded as failed and cancelled,
 * and, as after a failed step, that step and every later one keep no record,
 * so the next preparation runs them again.
 * @param {object} dependencies
 * @param {(request: object) => Promise<object>} dependencies.connectedPreparation
 * @param {typeof import("@local/vibe64-execution/server").finishVibe64Workflow} dependencies.finishWorkflow
 * @param {ProjectService} dependencies.project
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger] hears each run's and step's
 *   start and finish, at warn so the default level keeps them
 * @param {typeof import("./workspaceSetupTree.js").readStepInputs} dependencies.readInputs
 * @param {typeof import("./workspaceSetupTree.js").readPreparedTree} dependencies.readTree
 * @param {typeof import("@local/vibe64-execution/server").runVibe64Command} dependencies.runCommand
 * @param {WorkspaceSetupRunnerState} dependencies.runnerState
 * @param {(request: object) => Promise<object>} dependencies.startWorkflow
 */
function createWorkspaceSetupExecution({
  connectedPreparation,
  finishWorkflow,
  logger = silentLogger,
  project,
  readInputs,
  readTree,
  runCommand,
  runnerState,
  startWorkflow
}) {
  /**
   * One line of a preparation's progress in the server's log. A preparation can run for minutes after a restart
   * while a message or a Preview waits for it, so each run and step says when it started and how long it took.
   */
  function logPreparation(event, sessionId, fields) {
    try {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.workspace_setup",
        event,
        sessionId,
        ...fields
      }, event === "vibe64.workspace_setup.run" ? "Workspace preparation run." : "Workspace preparation step.");
    } catch {
      // The log is diagnostic only; a failing sink must not fail the preparation.
    }
  }

  /** The session's prepared connections, checked against the recipe's selection. */
  async function connectedInputs(setup, runtime, session) {
    if (!setup.connectedDevelopment) return { repositories: [], sourceRoots: [] };
    const inputs = await connectedPreparation({ mode: "inspect", runtime, session });
    if (inputs?.ok === false) throw Object.assign(new Error(inputs.error), { code: inputs.code });
    if (inputs?.inputsHash !== setup.connectedDevelopment.inputsHash || !Array.isArray(inputs.sourceRoots)) {
      throw new Error("Connected source selection changed. Prepare the workspace again before running commands.");
    }
    return inputs;
  }

  async function connectedSourceRoots(setup, runtime, session) {
    return (await connectedInputs(setup, runtime, session)).sourceRoots;
  }

  /**
   * Keeps the session's swapped connected packages in step with its connected copies while it runs
   * (once per session; a later call while it runs does nothing). What a sync needs to run (npm
   * listing a package's files, or installing a new dependency) runs with the recipe's runtimes.
   */
  /**
   * A managed command in the session's source and connected copies with the recipe's runtimes, as
   * Vibe64's own connected work outside a preparation runs it (a sync, a Save's bumps and steps).
   */
  async function connectedCommand({ runtime, session, setup, runtimes, sourcePath, label }) {
    const { sourceRoots } = await connectedInputs(setup, runtime, session);
    const baseEnv = await runtime.resolvePromptEnvironment();
    const projectSlug = currentProjectRequestContext()?.slug;
    return ({ command, args, cwd, timeout, env }) => runCommand({
      actor: "app",
      allowedRoots: [sourcePath, ...sourceRoots],
      args,
      baseEnv: { ...baseEnv, ...env },
      command,
      cwd,
      envPolicy: "project",
      execution: { kind: "job", label, ownerId: session.sessionId, sessionId: session.sessionId, projectSlug },
      mode: "capture",
      purpose: "source",
      runtimes,
      timeout: timeout || WORKSPACE_SETUP_COMMAND_TIMEOUT_MS
    });
  }

  async function ensureConnectedSync({ runtime, session, setup, runtimes, sourcePath, restart = false }) {
    // With no typed dependency left, the sync a removed one started has nothing to keep in step.
    if (!setup?.connectedDevelopment?.adapters) return stopConnectedSync(session.sessionId);
    if (!restart && connectedSyncRunning(session.sessionId)) return;
    await project.syncConnectedRepositories({
      session,
      runCommand: await connectedCommand({ runtime, session, setup, runtimes, sourcePath, label: "Syncing connected packages" })
    });
  }

  /**
   * What Save runs for the session's connections, between saving its connected copies and its own
   * commit: whether it has typed dependencies (whose published versions Save adopts), the Stack's
   * Save entries, and the managed command both run with.
   */
  async function connectedSaveCommand({ runtime, session, setup, runtimes, sourcePath }) {
    return {
      dependencies: Boolean(setup.connectedDevelopment.adapters),
      saveSteps: setup.connectedDevelopment.saveSteps.map((step, index) => setupStep(step, index, sourcePath)),
      runCommand: await connectedCommand({ runtime, session, setup, runtimes, sourcePath, label: "Saving connected repositories" })
    };
  }

  /**
   * Whether every typed connected dependency of a ready recipe is in effect in the session's trees
   * now; the first that is not, with why. One nothing in the session installs needs no preparation.
   */
  async function connectedInEffect(setup, session) {
    if (!setup?.connectedDevelopment?.adapters) return { inEffect: true, reason: "" };
    try {
      const proofs = await project.inspectConnectedAdapters({ session });
      const missing = proofs.find(proof => !proof.inEffect && !proof.unused);
      return missing
        ? { inEffect: false, reason: `Connected ${missing.name} is not in effect: ${missing.reason}` }
        : { inEffect: true, reason: "" };
    } catch (error) {
      return { inEffect: false, reason: toText(error?.message) || "Vibe64 could not check the connected repositories." };
    }
  }

  /**
   * The tree a preparation of this setup's recipe finds now, in the session source and its
   * connected repositories; null when it cannot be read.
   */
  async function currentTree({ runtime, session, setup, sourcePath }) {
    try {
      const connectedRoots = await connectedSourceRoots(setup, runtime, session);
      return await readTree({ connectedRoots, recipeHash: setup.recipeHash, sourcePath });
    } catch {
      return null;
    }
  }

  /**
   * Runs the recipe's steps, logging the run's start and its finish with its outcome and duration.
   * `preparedSteps` are the step records this run may skip by: none for an explicit retry.
   * @param {Parameters<typeof executeSteps>[0]} request
   */
  async function execute(request) {
    const sessionId = request.session.sessionId;
    const startedAt = Date.now();
    let outcome = "failed";
    logPreparation("vibe64.workspace_setup.run", sessionId, { phase: "started", steps: request.recipe.steps.length });
    try {
      const state = await executeSteps(request);
      outcome = toText(state?.status) || "failed";
      return state;
    } finally {
      logPreparation("vibe64.workspace_setup.run", sessionId, { phase: "finished", outcome, durationMs: Date.now() - startedAt });
    }
  }

  async function executeSteps({
    context,
    preparedSteps = [],
    recipe,
    runtime,
    session,
    signal = null,
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
    // Resources created just now (a new database) run every step.
    const resourcePreparation = environmentRecords.resourcePreparation;
    const resources = resourcePreparation?.identity || "";
    const records = new Map(!resourcePreparation || resourcePreparation.preserved === true
      ? preparedSteps.map(({ step, inputs }) => [step, inputs])
      : []);
    // The records of the steps before the one at `until`: a step that did not finish may have changed
    // what any later step relies on, so neither it nor they keep one.
    const recorded = (until = recipe.steps.length) => [...new Set(recipe.steps.slice(0, until).map(({ recordKey }) => recordKey))]
      .filter(step => records.has(step))
      .map(step => ({ inputs: records.get(step), step }));
    const cancelled = (currentLabel, index = 0) => failed(runtime, session.sessionId, {
      currentLabel,
      diagnostic: WORKSPACE_SETUP_CANCELLED,
      preparedSteps: recorded(index),
      recipeHash: recipe.recipeHash,
      redactionSecrets,
      renewal: context.renewal,
      runtimes: recipe.runtimes,
      startedAt,
      stepOutcome: "Cancelled",
      transcript: context.transcript
    });
    if (signal?.aborted) return cancelled(context.currentLabel);
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
    if (resource?.ok === false) {
      throw Object.assign(new Error(resource.error || "Workspace preparation could not be admitted."), {
        code: resource.code,
        details: { admission: resource.admission }
      });
    }
    let outcome = "failed";
    try {
      const admittedSetup = await runnerState.inspect({ environment, projectRoot: sourcePath, session });
      if (admittedSetup?.status !== "ready" || admittedSetup.recipeHash !== recipe.recipeHash ||
          admittedSetup.stackHash !== currentSetup.stackHash) {
        throw new Error("Workspace setup changed while waiting for resources. Retry preparation to run the current steps.");
      }
      for (const [index, step] of recipe.steps.entries()) {
        const connected = await connectedInputs(admittedSetup, runtime, session);
        const connectedRoots = connected.sourceRoots;
        const currentLabel = safeSetupLabel(step.label, redactionSecrets);
        context.currentLabel = currentLabel;
        if (signal?.aborted) {
          outcome = "stopped";
          return await cancelled(currentLabel, index);
        }
        const inputs = step.recordKey ? await readInputs({ inputs: step.inputs, sourcePath }) : null;
        const record = inputs ? stepRecordValue(inputs, resources) : "";
        if (record && records.get(step.recordKey) === record) {
          logPreparation("vibe64.workspace_setup.step", session.sessionId, { phase: "skipped", index, label: currentLabel });
          // The first step was announced as running before this run knew it would skip it.
          context.transcript = appendWorkspaceSetupTranscript(
            index === 0 ? withoutLastLine(context.transcript, stepStatus(currentLabel, "Running", redactionSecrets)) : context.transcript,
            stepStatus(currentLabel, STEP_SKIPPED, redactionSecrets)
          );
          continue;
        }
        records.delete(step.recordKey);
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
          preparedSteps: recorded(index),
          recipeHash: recipe.recipeHash,
          startedAt,
          status: "running",
          transcript: context.transcript
        }, context.renewal);
        const stepStartedAt = Date.now();
        logPreparation("vibe64.workspace_setup.step", session.sessionId, { phase: "started", index, label: currentLabel });
        const baseEnv = await runtime.resolvePromptEnvironment();
        const command = (request) => runCommand({
          actor: "app",
          allowedRoots: [sourcePath, ...connectedRoots],
          baseEnv,
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
          ...(signal ? { signal } : {}),
          timeout: WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
          ...request
        });
        // A typed connected dependency's step is Vibe64's own: its adapter runs the commands it needs.
        const result = step.connectedAdapter
          ? await project.runConnectedAdapterStep({
            action: step.connectedAdapter.action,
            repository: step.connectedAdapter.repository,
            repositories: connected.repositories,
            sessionSourceRoot: sourcePath,
            // An adapter's command may add environment of its own (COMPOSER, BUNDLE_GEMFILE).
            runCommand: ({ command: executable, args, cwd, timeout, env }) => command({
              command: executable,
              args,
              cwd,
              ...(timeout ? { timeout } : {}),
              ...(env ? { baseEnv: { ...baseEnv, ...env } } : {})
            })
          })
          : await command({ args: step.argv.slice(1), command: step.argv[0], cwd: step.cwd });
        logPreparation("vibe64.workspace_setup.step", session.sessionId, {
          phase: "finished",
          index,
          label: currentLabel,
          outcome: result?.ok === true ? "succeeded" : signal?.aborted ? "stopped" : "failed",
          durationMs: Date.now() - stepStartedAt,
          ...(Number.isInteger(result?.exitCode) ? { exitCode: result.exitCode } : {}),
          ...(result?.timedOut ? { timedOut: true } : {})
        });
        context.transcript = appendWorkspaceSetupTranscript(
          context.transcript,
          capturedCommandOutput(result, redactionSecrets)
        );
        // A step whose processes could not be stopped keeps that failure: it names what is still running.
        if (result?.ok !== true && signal?.aborted && !executionCleanupRequired(result)) {
          outcome = "stopped";
          return await cancelled(currentLabel, index);
        }
        if (result?.ok !== true) {
          return failed(runtime, session.sessionId, {
            currentLabel,
            diagnostic: commandDiagnostic(result, currentLabel, redactionSecrets),
            preparedSteps: recorded(index),
            recipeHash: recipe.recipeHash,
            redactionSecrets,
            renewal: context.renewal,
            runtimes: recipe.runtimes,
            startedAt,
            transcript: context.transcript
          });
        }
        // What its inputs held when it started: a file changed while it ran is not one it prepared.
        if (record) records.set(step.recordKey, record);
        context.transcript = appendWorkspaceSetupTranscript(
          context.transcript,
          stepStatus(currentLabel, "Succeeded", redactionSecrets)
        );
      }
      outcome = "succeeded";
      // What this run prepared, as it leaves it: what its own steps changed (a rewritten lockfile) is prepared too.
      const preparedTree = await currentTree({ runtime, session, setup: admittedSetup, sourcePath });
      // The swaps this run made stay in step with the connected copies from now on.
      await ensureConnectedSync({ runtime, session, setup: admittedSetup, runtimes: recipe.runtimes, sourcePath, restart: true })
        .catch((error) => {
          context.transcript = appendWorkspaceSetupTranscript(
            context.transcript,
            `[Connected] Saved changes will reach the swapped packages at the next preparation, not at once: ${toText(error?.message)}`
          );
        });
      return await persist(runtime, session.sessionId, {
        currentLabel: context.currentLabel,
        diagnostic: "",
        finishedAt: new Date().toISOString(),
        preparedSteps: recorded(),
        preparedTree,
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
    connectedInEffect,
    connectedSaveCommand,
    connectedSourceRoots,
    ensureConnectedSync,
    currentTree,
    execute,
    logPreparation,
    observe
  });
}

export {
  createWorkspaceSetupExecution
};
