import { normalizeText } from "@local/vibe64-core/server/core";
import { sanitizeOperationText } from "@local/vibe64-core/server/logging";
import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import {
  workspaceSetupState,
  workspaceSetupTranscript
} from "@local/vibe64-runtime/server/workspaceSetupState";

import { vibe64RuntimePacks } from "./vibe64OutputTargets.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { failed, persist } from "./workspaceSetupRecords.js";
import {
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
  appendWorkspaceSetupTranscript,
  capturedCommandOutput,
  commandDiagnostic,
  operationRedactionSecrets,
  stepStatus
} from "./workspaceSetupRules.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunnerState} WorkspaceSetupRunnerState */

/**
 * The Genesis migration a retried outdated project runs before its setup is
 * inspected again.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.projectService
 * @param {typeof import("@local/vibe64-execution/server").runVibe64Command} dependencies.runCommand
 * @param {WorkspaceSetupRunnerState} dependencies.runnerState
 */
function createWorkspaceSetupMigration({ projectService, runCommand, runnerState }) {
  // Runs `genesis migrate` for a retried outdated project, then reinspects it.
  // Returns { state } when the migration or reinspection failed.
  async function runGenesisMigration({ runtime, session, sessionId, sourcePath, previous, renewal }) {
    const currentLabel = "Migrate Genesis project";
    const migrationStartedAt = new Date().toISOString();
    let migrationTranscript = appendWorkspaceSetupTranscript(
      previous.transcript,
      "Workspace preparation retry started.",
      stepStatus(currentLabel, "Running")
    );
    await persist(runtime, sessionId, {
      currentLabel,
      diagnostic: "",
      finishedAt: "",
      recipeHash: "",
      startedAt: migrationStartedAt,
      status: "running",
      transcript: migrationTranscript
    }, renewal);

    let projectEnv = {};
    let redactionSecrets = [];
    try {
      projectEnv = await loadProjectExecutionEnv({
        prepare: true,
        projectService,
        session,
        target: "workspace-setup"
      });
      redactionSecrets = operationRedactionSecrets(projectEnv);
      migrationTranscript = workspaceSetupTranscript(sanitizeOperationText(
        migrationTranscript,
        redactionSecrets
      ));
      const migrationRuntime = vibe64RuntimePacks(["nodejs", "git"]);
      if (!migrationRuntime.available) {
        throw new Error(migrationRuntime.disabledReason);
      }
      const result = await runCommand({
        actor: "app",
        allowedRoots: [sourcePath],
        args: ["migrate"],
        baseEnv: await runtime.resolvePromptEnvironment(),
        command: "genesis",
        cwd: sourcePath,
        envPolicy: "project",
        gitSafeDirectories: [sourcePath],
        mode: "capture",
        project: {
          runtimeConfigEnv: projectEnv
        },
        purpose: "source",
        runtimes: migrationRuntime.runtimes,
        shimDirs: withGenesisCommandShim(),
        timeout: WORKSPACE_SETUP_COMMAND_TIMEOUT_MS
      });
      migrationTranscript = appendWorkspaceSetupTranscript(
        migrationTranscript,
        capturedCommandOutput(result, redactionSecrets)
      );
      if (result?.ok !== true) {
        const state = await failed(runtime, sessionId, {
          currentLabel,
          diagnostic: commandDiagnostic(result, currentLabel, redactionSecrets),
          redactionSecrets,
          renewal,
          startedAt: migrationStartedAt,
          transcript: migrationTranscript
        });
        return { state };
      }
      migrationTranscript = appendWorkspaceSetupTranscript(
        migrationTranscript,
        stepStatus(currentLabel, "Succeeded", redactionSecrets)
      );
    } catch (migrationError) {
      const state = await failed(runtime, sessionId, {
        currentLabel,
        diagnostic: normalizeText(migrationError?.message) || "Genesis project migration failed.",
        redactionSecrets,
        renewal,
        startedAt: migrationStartedAt,
        transcript: migrationTranscript
      });
      return { state };
    }

    let setup;
    try {
      setup = await runnerState.inspect({
        session,
        environment: await runtime.resolvePromptEnvironment(),
        projectRoot: sourcePath
      });
    } catch (inspectionError) {
      const state = await persist(runtime, sessionId, {
        currentLabel: "",
        diagnostic: sanitizeOperationText(
          normalizeText(inspectionError?.message) || "Vibe64 could not inspect the migrated workspace preparation.",
          redactionSecrets
        ),
        finishedAt: new Date().toISOString(),
        recipeHash: "",
        startedAt: migrationStartedAt,
        status: "failed",
        transcript: migrationTranscript
      }, renewal);
      return { state };
    }
    return {
      migrationStartedAt,
      migrationTranscript,
      setup,
      stateBase: workspaceSetupState({
        ...previous,
        currentLabel: "",
        diagnostic: "",
        finishedAt: "",
        startedAt: migrationStartedAt,
        status: "running",
        transcript: migrationTranscript
      })
    };
  }

  return Object.freeze({
    runGenesisMigration
  });
}

export {
  createWorkspaceSetupMigration
};
