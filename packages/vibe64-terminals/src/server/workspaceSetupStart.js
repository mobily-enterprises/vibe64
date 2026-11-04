import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { CONNECTED_LINK_REQUIRED } from "@local/vibe64-core/server/projectRepository";
import { captureProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { GENESIS_STACK_SECTION_AMBIGUOUS } from "@local/vibe64-genesis/server";
import { workspaceSetupState } from "@local/vibe64-runtime/server/workspaceSetupState";

import { loadProjectExecutionEnvRecords, projectExecutionEnvFromRecords } from "./projectExecutionEnv.js";
import { connectedChoiceRequired, failed, persist, persistInspectedState } from "./workspaceSetupRecords.js";
import {
  CONNECTED_PREPARATION_LABEL,
  appendWorkspaceSetupTranscript,
  connectedLinkLine,
  connectedUpdateLine,
  diagnosticText,
  diagnosticsInclude,
  inProjectContext,
  operationRedactionSecrets,
  preparedRecipe,
  resourceIdentityMatches,
  safeSetupLabel,
  stepStatus,
  workspaceSetupRunKey
} from "./workspaceSetupRules.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunnerState} WorkspaceSetupRunnerState */
/** @typedef {import("./types.js").WorkspaceSetupExecution} WorkspaceSetupExecution */
/** @typedef {ReturnType<typeof import("./workspaceSetupMigration.js").createWorkspaceSetupMigration>} WorkspaceSetupMigration */

/**
 * Starts a session's workspace setup: inspects its recipe, migrates a retried
 * outdated project, prepares connected sources, reuses a run that still
 * matches, and otherwise records the new run and starts it.
 * @param {object} dependencies
 * @param {(request: object) => Promise<object>} dependencies.connectedPreparation
 * @param {typeof import("@local/vibe64-genesis/server").inspectGenesisProjectFormat} dependencies.inspectProjectFormat
 * @param {ProjectService} dependencies.project
 * @param {WorkspaceSetupRunnerState} dependencies.runnerState
 * @param {WorkspaceSetupExecution} dependencies.setupExecution
 * @param {WorkspaceSetupMigration} dependencies.setupMigration
 */
function createWorkspaceSetupStart({
  connectedPreparation,
  inspectProjectFormat,
  project,
  runnerState,
  setupExecution,
  setupMigration
}) {
  /**
   * `rerunFailed` is an explicit start (Preview Start, ensure or restart): it
   * runs a failed recipe again instead of reporting the stored failure.
   * `agentRequested` marks a start an AI asked for: linking a connected session
   * cannot be undone, so that one stops for a person instead.
   */
  async function start({ agentRequested = false, renewal = false, rerunFailed = false, retry = false, runtime, session } = {}) {
    const sessionId = toText(session?.sessionId);
    if (!sessionId || !runtime?.store) {
      throw new TypeError("Workspace preparation requires a stored Vibe64 session.");
    }
    const projectContext = captureProjectRequestContext();
    const runKey = workspaceSetupRunKey(sessionId);
    if (runnerState.activeRuns.has(runKey)) {
      return {
        completion: runnerState.activeRuns.get(runKey),
        state: workspaceSetupState(session.workspaceSetup)
      };
    }
    const sourcePath = sessionSourcePath(session);
    if (!sourcePath) {
      const state = await failed(runtime, sessionId, {
        diagnostic: "Workspace preparation requires an attached session source.",
        renewal
      });
      return { completion: null, state };
    }
    const previous = workspaceSetupState(session.workspaceSetup);
    let stateBase = previous;
    let migrationStartedAt = "";
    let migrationTranscript = "";

    let setup;
    try {
      setup = await runnerState.inspect({
        session,
        environment: await runtime.resolvePromptEnvironment(),
        projectRoot: sourcePath
      });
    } catch (error) {
      if (toText(error?.code) === "STACK_REQUIRED") {
        const state = await persistInspectedState(runtime, sessionId, previous, {
          currentLabel: "",
          diagnostic: "",
          finishedAt: "",
          recipeHash: "",
          startedAt: "",
          status: "unconfigured"
        }, renewal);
        return { completion: null, state };
      }
      let projectFormat = null;
      if (retry === true) {
        try {
          projectFormat = await inspectProjectFormat({
            environment: await runtime.resolvePromptEnvironment(),
            projectRoot: sourcePath
          });
        } catch {
          projectFormat = null;
        }
      }
      if (
        retry !== true ||
        toText(projectFormat?.action) !== "migrate" ||
        !["outdated", "unversioned"].includes(toText(projectFormat?.status))
      ) {
        const state = await persistInspectedState(runtime, sessionId, previous, {
          currentLabel: "",
          diagnostic: toText(error?.message) || "Vibe64 could not inspect workspace preparation.",
          finishedAt: new Date().toISOString(),
          recipeHash: "",
          startedAt: "",
          // Genesis now rejects reads until the project authors one competing
          // section; keep the same "needs a choice" state its diagnostic used.
          status: toText(error?.code) === GENESIS_STACK_SECTION_AMBIGUOUS ? "ambiguous" : "failed"
        }, renewal);
        return { completion: null, state };
      }

      const migration = await setupMigration.runGenesisMigration({ runtime, session, sessionId, sourcePath, previous, renewal });
      if (Object.hasOwn(migration, "state")) return { completion: null, state: migration.state };
      ({ migrationStartedAt, migrationTranscript, setup, stateBase } = migration);
    }

    const run = {
      agentRequested,
      migrationStartedAt,
      migrationTranscript,
      projectContext,
      renewal,
      rerunFailed,
      retry,
      runKey,
      runtime,
      session,
      sessionId,
      setup,
      sourcePath,
      stateBase
    };
    if (runtime.learningScope || !setup?.connectedDevelopment || retry !== true) return startRecipe(run);
    // A requested run prepares connected projects in the background: they
    // can take minutes, and the session shows each step while it runs.
    const startedAt = migrationStartedAt || new Date().toISOString();
    const currentLabel = CONNECTED_PREPARATION_LABEL;
    // The output starts this attempt at once, so an earlier attempt's last
    // line is never shown as this one's progress.
    const attemptBase = {
      ...stateBase,
      transcript: appendWorkspaceSetupTranscript(
        stateBase.transcript,
        migrationTranscript ? "" : stateBase.transcript ? "Workspace preparation retry started." : "Workspace preparation started.",
        stepStatus(currentLabel, "Running")
      )
    };
    const state = await persist(runtime, sessionId, {
      ...attemptBase,
      currentLabel,
      diagnostic: "",
      finishedAt: "",
      startedAt,
      status: "running"
    }, renewal);
    const begin = () => startRecipe({
      ...run,
      attemptStarted: true,
      stateBase: attemptBase,
      onProgress: label => persist(runtime, sessionId, {
        ...attemptBase,
        currentLabel: safeSetupLabel(label),
        diagnostic: "",
        finishedAt: "",
        startedAt,
        status: "running"
      }, renewal)
    }).then(next => next.completion || next.state);
    const completion = setupExecution.observe(sessionId, inProjectContext(projectContext, begin), {
      currentLabel,
      recipeHash: "",
      redactionSecrets: [],
      renewal,
      projectContext,
      runtime,
      runKey,
      startedAt,
      transcript: attemptBase.transcript
    });
    return { completion, state };
  }

  async function startRecipe({
    agentRequested,
    attemptStarted = false,
    migrationStartedAt,
    migrationTranscript,
    onProgress = doNothing,
    projectContext,
    renewal,
    rerunFailed = false,
    retry,
    runKey,
    runtime,
    session,
    sessionId,
    setup,
    sourcePath,
    stateBase
  }) {
    let connectedLinks = [];
    let connectedUpdates = [];
    if (!runtime.learningScope && setup?.connectedDevelopment) {
      try {
        const prepared = await connectedPreparation({
          automaticLink: !renewal && !agentRequested,
          mode: "prepare",
          onProgress,
          renewal,
          runtime,
          session
        });
        connectedLinks = (prepared?.linked || []).map(connectedLinkLine);
        if (prepared?.ok === false) {
          // Name the connected project that failed: its own message often cannot.
          const failedProject = toText(prepared.failedRepository).split("/").pop();
          throw Object.assign(
            new Error(failedProject ? `Connected project ${failedProject}: ${toText(prepared.error)}` : prepared.error),
            { code: prepared.code }
          );
        }
        connectedUpdates = [...connectedLinks, ...(prepared?.prepared || []).map(connectedUpdateLine).filter(Boolean)];
        await onProgress("Checking connected sources");
        session = await runtime.getSessionWithoutSource(sessionId);
        setup = await runnerState.inspect({ session, projectRoot: sourcePath, environment: await runtime.resolvePromptEnvironment() });
        await setupExecution.connectedSourceRoots(setup, runtime, session);
      } catch (error) {
        const stopped = {
          currentLabel: "Prepare connected sources",
          diagnostic: toText(error?.message),
          renewal,
          // The output keeps the reason, so Expand and the next attempt's
          // history show why, not only that this step stopped.
          transcript: appendWorkspaceSetupTranscript(attemptStarted ? stateBase.transcript : "", ...connectedLinks, toText(error?.message))
        };
        const state = error?.code === CONNECTED_LINK_REQUIRED
          ? await connectedChoiceRequired(runtime, sessionId, stopped)
          : await failed(runtime, sessionId, stopped);
        return { completion: null, state };
      }
    }

    if (toText(setup?.status) === "unconfigured") {
      const state = await persistInspectedState(runtime, sessionId, stateBase, {
        currentLabel: "",
        diagnostic: "",
        finishedAt: "",
        recipeHash: "",
        startedAt: "",
        status: "unconfigured"
      }, renewal);
      return { completion: null, state };
    }
    if (toText(setup?.status) !== "ready") {
      const ambiguous = diagnosticsInclude(
        setup?.diagnostics,
        GENESIS_STACK_SECTION_AMBIGUOUS
      );
      const state = await persistInspectedState(runtime, sessionId, stateBase, {
        currentLabel: "",
        diagnostic: diagnosticText(setup?.diagnostics) || "Vibe64 could not select one workspace preparation recipe.",
        finishedAt: new Date().toISOString(),
        recipeHash: "",
        startedAt: "",
        status: ambiguous ? "ambiguous" : "failed"
      }, renewal);
      return { completion: null, state };
    }

    let recipe;
    try {
      recipe = preparedRecipe(setup, sourcePath);
    } catch (error) {
      const state = await persistInspectedState(runtime, sessionId, stateBase, {
        currentLabel: "",
        diagnostic: toText(error?.message),
        finishedAt: new Date().toISOString(),
        recipeHash: "",
        startedAt: "",
        status: "failed"
      }, renewal);
      return { completion: null, state };
    }
    let preparedEnvironment;
    if (
      !migrationTranscript &&
      retry !== true &&
      stateBase.recipeHash === recipe.recipeHash &&
      (stateBase.status === "succeeded" || (stateBase.status === "failed" && rerunFailed !== true))
    ) {
      if (stateBase.status === "failed") {
        return { completion: null, state: stateBase };
      }
      const environmentStatus = await project.projectEnvironmentStatus({ sessionId, session });
      const sameResources = resourceIdentityMatches(stateBase, environmentStatus);
      if (environmentStatus.status === "ready" && sameResources) return { completion: null, state: stateBase };
      if (sameResources && stateBase.resourceIdentity) {
        // Restore host resource readiness separately. Cached application setup
        // is reusable only when its exact resources existed before provisioning.
        try {
          preparedEnvironment = await loadProjectExecutionEnvRecords({
            prepare: true,
            reusePrepared: true,
            includeResourceConfiguration: true,
            project,
            session,
            target: "workspace-setup"
          });
          const restoredSetup = await runnerState.inspect({
            session,
            projectRoot: sourcePath,
            environment: await runtime.resolvePromptEnvironment()
          });
          if (restoredSetup?.status !== "ready" || restoredSetup.recipeHash !== recipe.recipeHash) {
            throw new Error("Workspace setup changed while preparing its environment. Retry preparation to run the current steps.");
          }
          const restored = await project.projectEnvironmentStatus({ sessionId, session });
          if (restored.status !== "ready") {
            throw new Error("Project environment is not ready. Correct its configuration and retry preparation.");
          }
          if (preparedEnvironment.resourcePreparation?.preserved === true &&
              preparedEnvironment.resourcePreparation.identity === stateBase.resourceIdentity &&
              restored.resourcePreparation?.identity === stateBase.resourceIdentity) {
            return { completion: null, state: stateBase };
          }
        } catch (error) {
          return {
            completion: null,
            state: await failed(runtime, sessionId, {
              currentLabel: "Prepare project environment",
              diagnostic: toText(error?.message),
              recipeHash: recipe.recipeHash,
              renewal,
              transcript: stateBase.transcript,
              redactionSecrets: operationRedactionSecrets(projectExecutionEnvFromRecords(preparedEnvironment || {})),
              resourceAdmissionId: error?.details?.admission?.id
            })
          };
        }
      }
    }
    const startedAt = migrationStartedAt || new Date().toISOString();
    const currentLabel = safeSetupLabel(recipe.steps[0].label);
    const attemptLabel = migrationTranscript || attemptStarted
      ? ""
      : stateBase.transcript
        ? (retry === true || (rerunFailed === true && stateBase.status === "failed")
            ? "Workspace preparation retry started."
            : "Workspace preparation started for updated configuration.")
        : "Workspace preparation started.";
    const transcript = appendWorkspaceSetupTranscript(
      stateBase.transcript,
      attemptLabel,
      ...connectedUpdates,
      stepStatus(currentLabel, "Running")
    );
    const state = await persist(runtime, sessionId, {
      currentLabel,
      diagnostic: "",
      finishedAt: "",
      recipeHash: recipe.recipeHash,
      startedAt,
      status: "running",
      transcript
    }, renewal);
    const context = {
      currentLabel,
      recipeHash: recipe.recipeHash,
      redactionSecrets: [],
      renewal,
      projectContext,
      runtime,
      runKey,
      startedAt,
      transcript
    };
    const completion = setupExecution.observe(
      sessionId,
      inProjectContext(projectContext, () => setupExecution.execute({
        context,
        recipe,
        runtime,
        session,
        sourcePath,
        startedAt,
        preparedEnvironment
      })),
      context
    );
    return { completion, state };
  }

  return Object.freeze({
    start
  });
}

export {
  createWorkspaceSetupStart
};
