import path from "node:path";

import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  normalizeText,
  pathInsideOrEqual
} from "@local/vibe64-core/server/core";
import {
  captureProjectRequestContext,
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  createStreamingLogSanitizer,
  sanitizeOperationText
} from "@local/vibe64-core/server/logging";
import {
  finishVibe64Workflow,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  GENESIS_STACK_SECTION_AMBIGUOUS,
  inspectGenesisProjectFormat,
  inspectVibe64WorkspaceSetup,
  withGenesisCommandShim
} from "@local/vibe64-genesis/server";
import {
  workspaceSetupState,
  workspaceSetupTranscript,
  writeWorkspaceSetupState
} from "@local/vibe64-runtime/server/workspaceSetupState";
import {
  vibe64RuntimePacks
} from "./vibe64OutputTargets.js";
import {
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  projectExecutionEnvFromRecords
} from "./projectExecutionEnv.js";
import {
  terminalNamespace
} from "./terminalShared.js";
import { startResourceWorkflow } from "./resourceWorkflow.js";

const WORKSPACE_SETUP_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const WORKSPACE_SETUP_RUN_NAMESPACE = "vibe64-workspace-setup";
const CONNECTED_PREPARATION_LABEL = "Preparing connected projects";

function diagnosticText(diagnostics = []) {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .map((diagnostic) => normalizeText(
      typeof diagnostic === "string"
        ? diagnostic
        : diagnostic?.message || diagnostic?.code
    ))
    .find(Boolean) || "";
}

function diagnosticsInclude(diagnostics = [], code = "") {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .some((diagnostic) => normalizeText(diagnostic?.code) === code);
}

function stateTimestamp(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function setupStep(step = {}, index = 0, sourcePath = "") {
  const argv = Array.isArray(step.argv) ? step.argv.map((value) => String(value)) : [];
  if (!normalizeText(argv[0])) {
    throw new Error(`Workspace preparation step ${index + 1} has no command.`);
  }
  const cwd = path.resolve(sourcePath, normalizeText(step.workdir) || ".");
  if (!pathInsideOrEqual(sourcePath, cwd)) {
    throw new Error(`Workspace preparation step ${index + 1} has a work directory outside the session source.`);
  }
  return {
    argv,
    cwd,
    label: normalizeText(step.label) || `Workspace preparation step ${index + 1}`,
    runtimeRequirements: Array.isArray(step.runtimeRequirements)
      ? step.runtimeRequirements
      : []
  };
}

function preparedRecipe(setup = {}, sourcePath = "") {
  const recipeHash = normalizeText(setup.recipeHash);
  if (!recipeHash) {
    throw new Error("Vibe64 produced a ready workspace preparation recipe without an identity.");
  }
  const steps = (Array.isArray(setup.steps) ? setup.steps : [])
    .map((step, index) => setupStep(step, index, sourcePath));
  if (steps.length < 1) {
    throw new Error("Vibe64 produced a ready workspace preparation recipe without any steps.");
  }
  const runtime = vibe64RuntimePacks([
    ...(Array.isArray(setup.runtimeRequirements) ? setup.runtimeRequirements : []),
    ...steps.flatMap((step) => step.runtimeRequirements)
  ]);
  if (!runtime.available) {
    throw new Error(runtime.disabledReason);
  }
  return {
    recipeHash,
    runtimes: runtime.runtimes,
    steps
  };
}

function operationRedactionSecrets(env = {}) {
  return [...new Set(Object.values(
    env && typeof env === "object" && !Array.isArray(env) ? env : {}
  ).map((value) => String(value ?? "")).filter((value) => value.length >= 4))];
}

function safeSetupLabel(value = "", secrets = []) {
  return sanitizeOperationText(normalizeText(value), secrets)
    .replace(/\s+/gu, " ")
    .slice(0, 160);
}

function capturedCommandOutput(result = {}, secrets = []) {
  const combined = String(result.output ?? "");
  const raw = combined || [result.stdout, result.stderr, result.error]
    .map((value) => String(value ?? ""))
    .filter(Boolean)
    .join("\n");
  if (!raw) {
    return "";
  }
  const sanitizer = createStreamingLogSanitizer({ secrets });
  return workspaceSetupTranscript(`${sanitizer.push(raw)}${sanitizer.flush()}`);
}

function appendWorkspaceSetupTranscript(transcript = "", ...entries) {
  return workspaceSetupTranscript([
    transcript,
    ...entries
  ].map((entry) => String(entry ?? "").trim()).filter(Boolean).join("\n"));
}

// One transcript line per connected checkout: updated, current or why not.
function connectedUpdateLine({ repository = "", update = null } = {}) {
  const name = `[Connected] ${normalizeText(repository).split("/").pop()}`;
  if (update?.status === "updated") return `${name} updated to ${normalizeText(update.commit).slice(0, 7)}.`;
  if (update?.status === "current") return `${name} is up to date.`;
  if (update?.status === "skipped") return `${name} was not updated: ${normalizeText(update.reason)}`;
  return "";
}

function stepStatus(label = "", status = "", secrets = []) {
  return `[${safeSetupLabel(label, secrets) || "Workspace preparation"}] ${status}.`;
}

function commandDiagnostic(result = {}, label = "", secrets = []) {
  const output = normalizeText(sanitizeOperationText(
    result.stderr || result.error || result.output,
    secrets
  ));
  // A program that isn't installed fails before it runs: say that, not "spawn x ENOENT".
  const absent = /\bspawn (\S+) ENOENT\b/u.exec(output)?.[1];
  if (absent) {
    return `Vibe64 couldn't find ${absent.split("/").pop()} on this computer, so this step couldn't run.`;
  }
  if (output) {
    return output.slice(-1600);
  }
  const safeLabel = safeSetupLabel(label, secrets) || "Workspace preparation";
  if (result.timedOut === true) {
    return `${safeLabel} timed out after 15 minutes.`;
  }
  return `${safeLabel} exited with code ${Number(result.exitCode) || 1}.`;
}

// The cached run still matches the host resources only when both name the same
// resource preparation, or neither has one.
function resourceIdentityMatches(state = {}, environmentStatus = {}) {
  return Object.hasOwn(environmentStatus, "resourcePreparation")
    ? Boolean(state.resourceIdentity && state.resourceIdentity === environmentStatus.resourcePreparation?.identity)
    : !state.resourceIdentity;
}

function inProjectContext(projectContext, callback) {
  return projectContext ? runWithProjectRequestContext(projectContext, callback) : callback();
}

function workspaceSetupRunKey(sessionId = "") {
  return terminalNamespace(WORKSPACE_SETUP_RUN_NAMESPACE, sessionId);
}

function createWorkspaceSetupRunner({
  clock = () => new Date(),
  inspect: suppliedInspect = null,
  inspectProjectFormat = inspectGenesisProjectFormat,
  connectedPreparation = null,
  projectService,
  startWorkflow = startResourceWorkflow,
  finishWorkflow = finishVibe64Workflow,
  runCommand = runVibe64Command
} = {}) {
  if (!projectService) {
    throw new TypeError("createWorkspaceSetupRunner requires the Vibe64 project service.");
  }
  const inspect = suppliedInspect || projectService.inspectWorkspaceSetup?.bind(projectService) || inspectVibe64WorkspaceSetup;
  const activeRuns = new Map();

  async function connectedSourceRoots(setup, runtime, session) {
    if (!setup.connectedDevelopment) return [];
    if (typeof connectedPreparation !== "function") throw new Error("Connected workspace preparation is unavailable.");
    const inputs = await connectedPreparation({ mode: "inspect", runtime, session });
    if (inputs?.ok === false) throw Object.assign(new Error(inputs.error), { code: inputs.code });
    if (inputs?.inputsHash !== setup.connectedDevelopment.inputsHash || !Array.isArray(inputs.sourceRoots)) {
      throw new Error("Connected source selection changed. Prepare the workspace again before running commands.");
    }
    return inputs.sourceRoots;
  }

  async function persist(runtime, sessionId, value, renewal = false) {
    return writeWorkspaceSetupState(runtime.store, sessionId, {
      ...value,
      updatedAt: stateTimestamp(clock)
    }, {
      renewal
    });
  }

  async function persistInspectedState(runtime, sessionId, previous, value, renewal = false) {
    const next = workspaceSetupState({
      transcript: previous.transcript,
      ...value
    });
    const unchanged = [
      "currentLabel",
      "diagnostic",
      "recipeHash",
      "status",
      "transcript"
    ].every((name) => previous[name] === next[name]);
    return unchanged && previous.status !== "running"
      ? previous
      : persist(runtime, sessionId, next, renewal);
  }

  async function failed(runtime, sessionId, {
    currentLabel = "",
    diagnostic = "Workspace preparation failed.",
    recipeHash = "",
    redactionSecrets = [],
    resourceAdmissionId = "",
    renewal = false,
    runtimes = [],
    startedAt = "",
    transcript = ""
  } = {}) {
    const safeLabel = safeSetupLabel(currentLabel, redactionSecrets);
    const safeDiagnostic = sanitizeOperationText(diagnostic, redactionSecrets);
    return persist(runtime, sessionId, {
      currentLabel: safeLabel,
      diagnostic: safeDiagnostic,
      finishedAt: stateTimestamp(clock),
      recipeHash,
      resourceAdmissionId,
      runtimes,
      startedAt,
      status: "failed",
      transcript: appendWorkspaceSetupTranscript(
        sanitizeOperationText(transcript, redactionSecrets),
        stepStatus(safeLabel, "Failed", redactionSecrets)
      )
    }, renewal);
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
      projectService,
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
    const currentSetup = await inspect({ environment, projectRoot: sourcePath, session });
    if (currentSetup?.status !== "ready" || currentSetup.recipeHash !== recipe.recipeHash) {
      throw new Error("Workspace setup changed while preparing its environment. Retry preparation to run the current steps.");
    }
    const resource = await startWorkflow({
      session, sourceRoot: sourcePath, operation: { kind: "workspace-setup" },
      runtimes: recipe.runtimes,
      steps: recipe.steps.map((step) => ({ argv: step.argv, workdir: path.relative(sourcePath, step.cwd) || "." })),
      estimates: currentSetup.resourceEstimates,
      configuration: { environmentFingerprint: environmentRecords.resourceConfigurationFingerprint },
      kind: "job", label: "Preparing workspace", env: environment
    });
    if (resource?.ok === false) throw Object.assign(new Error(resource.error || "Workspace preparation could not be admitted."), {
      code: resource.code, details: { admission: resource.admission }
    });
    let outcome = "failed";
    try {
      const admittedSetup = await inspect({ environment, projectRoot: sourcePath, session });
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
            kind: "job", label: currentLabel, workflowId: resource?.workflow?.id,
            ownerId: session.sessionId, sessionId: session.sessionId,
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
        finishedAt: stateTimestamp(clock),
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
        diagnostic: normalizeText(error?.message) || "Workspace preparation failed.",
        recipeHash: context.recipeHash,
        redactionSecrets: context.redactionSecrets,
        resourceAdmissionId: error?.details?.admission?.id,
        renewal: context.renewal,
        startedAt: context.startedAt,
        transcript: context.transcript
      }).catch(() => workspaceSetupState({
        currentLabel: safeSetupLabel(context.currentLabel, context.redactionSecrets),
        diagnostic: sanitizeOperationText(
          normalizeText(error?.message) || "Workspace preparation failed.",
          context.redactionSecrets
        ),
        finishedAt: stateTimestamp(clock),
        recipeHash: context.recipeHash,
        resourceAdmissionId: error?.details?.admission?.id,
        startedAt: context.startedAt,
        status: "failed",
        transcript: appendWorkspaceSetupTranscript(
          sanitizeOperationText(context.transcript, context.redactionSecrets),
          stepStatus(context.currentLabel, "Failed", context.redactionSecrets)
        ),
        updatedAt: stateTimestamp(clock)
      }))))
      .finally(() => inProjectContext(context.projectContext, () => {
        if (activeRuns.get(context.runKey) === completion) {
          activeRuns.delete(context.runKey);
        }
      }));
    activeRuns.set(context.runKey, completion);
    return completion;
  }

  // Runs `genesis migrate` for a retried outdated project, then reinspects it.
  // Returns { state } when the migration or reinspection failed.
  async function runGenesisMigration({ runtime, session, sessionId, sourcePath, previous, renewal }) {
    const currentLabel = "Migrate Genesis project";
    const migrationStartedAt = stateTimestamp(clock);
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
      setup = await inspect({
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
        finishedAt: stateTimestamp(clock),
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

  async function start({ renewal = false, retry = false, runtime, session } = {}) {
    const sessionId = normalizeText(session?.sessionId || session?.id);
    if (!sessionId || !runtime?.store) {
      throw new TypeError("Workspace preparation requires a stored Vibe64 session.");
    }
    const projectContext = captureProjectRequestContext();
    const runKey = workspaceSetupRunKey(sessionId);
    if (activeRuns.has(runKey)) {
      return {
        completion: activeRuns.get(runKey),
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
      setup = await inspect({
        session,
        environment: await runtime.resolvePromptEnvironment(),
        projectRoot: sourcePath
      });
    } catch (error) {
      if (normalizeText(error?.code) === "STACK_REQUIRED") {
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
        normalizeText(projectFormat?.action) !== "migrate" ||
        !["outdated", "unversioned"].includes(normalizeText(projectFormat?.status))
      ) {
        const state = await persistInspectedState(runtime, sessionId, previous, {
          currentLabel: "",
          diagnostic: normalizeText(error?.message) || "Vibe64 could not inspect workspace preparation.",
          finishedAt: stateTimestamp(clock),
          recipeHash: "",
          startedAt: "",
          // Genesis now rejects reads until the project authors one competing
          // section; keep the same "needs a choice" state its diagnostic used.
          status: normalizeText(error?.code) === GENESIS_STACK_SECTION_AMBIGUOUS ? "ambiguous" : "failed"
        }, renewal);
        return { completion: null, state };
      }

      const migration = await runGenesisMigration({ runtime, session, sessionId, sourcePath, previous, renewal });
      if (Object.hasOwn(migration, "state")) return { completion: null, state: migration.state };
      ({ migrationStartedAt, migrationTranscript, setup, stateBase } = migration);
    }

    const run = {
      migrationStartedAt, migrationTranscript, projectContext, renewal, retry,
      runKey, runtime, session, sessionId, setup, sourcePath, stateBase
    };
    if (runtime.learningScope || !setup?.connectedDevelopment || retry !== true) return startRecipe(run);
    // A requested run prepares connected projects in the background: they
    // can take minutes, and the session shows each step while it runs.
    const startedAt = migrationStartedAt || stateTimestamp(clock);
    const currentLabel = CONNECTED_PREPARATION_LABEL;
    const state = await persist(runtime, sessionId, {
      ...stateBase, currentLabel, diagnostic: "", finishedAt: "", startedAt, status: "running"
    }, renewal);
    const begin = () => startRecipe({
      ...run,
      onProgress: label => persist(runtime, sessionId, {
        ...stateBase, currentLabel: safeSetupLabel(label), diagnostic: "", finishedAt: "", startedAt, status: "running"
      }, renewal)
    }).then(next => next.completion || next.state);
    const completion = observe(sessionId, inProjectContext(projectContext, begin), {
      currentLabel, recipeHash: "", redactionSecrets: [], renewal, projectContext,
      runtime, runKey, startedAt, transcript: stateBase.transcript
    });
    return { completion, state };
  }

  async function startRecipe({
    migrationStartedAt, migrationTranscript, onProgress = null, projectContext, renewal, retry,
    runKey, runtime, session, sessionId, setup, sourcePath, stateBase
  }) {
    let connectedUpdates = [];
    if (!runtime.learningScope && setup?.connectedDevelopment) {
      try {
        if (typeof connectedPreparation !== "function") throw new Error("Connected workspace preparation is unavailable.");
        const prepared = await connectedPreparation({ mode: "prepare", runtime, session, onProgress });
        if (prepared?.ok === false) throw Object.assign(new Error(prepared.error), { code: prepared.code });
        connectedUpdates = (prepared?.prepared || []).map(connectedUpdateLine).filter(Boolean);
        await onProgress?.("Checking connected sources");
        session = await runtime.getSession(sessionId, { inspectSource: false });
        setup = await inspect({ session, projectRoot: sourcePath, environment: await runtime.resolvePromptEnvironment() });
        await connectedSourceRoots(setup, runtime, session);
      } catch (error) {
        const state = await failed(runtime, sessionId, {
          currentLabel: "Prepare connected sources", diagnostic: normalizeText(error?.message), renewal
        });
        return { completion: null, state };
      }
    }

    if (normalizeText(setup?.status) === "unconfigured") {
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
    if (normalizeText(setup?.status) !== "ready") {
      const ambiguous = diagnosticsInclude(
        setup?.diagnostics,
        GENESIS_STACK_SECTION_AMBIGUOUS
      );
      const state = await persistInspectedState(runtime, sessionId, stateBase, {
        currentLabel: "",
        diagnostic: diagnosticText(setup?.diagnostics) || "Vibe64 could not select one workspace preparation recipe.",
        finishedAt: stateTimestamp(clock),
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
        diagnostic: normalizeText(error?.message),
        finishedAt: stateTimestamp(clock),
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
      ["succeeded", "failed"].includes(stateBase.status)
    ) {
      if (stateBase.status === "failed" || typeof projectService.projectEnvironmentStatus !== "function") {
        return { completion: null, state: stateBase };
      }
      const environmentStatus = await projectService.projectEnvironmentStatus({ sessionId, session });
      const sameResources = resourceIdentityMatches(stateBase, environmentStatus);
      if (environmentStatus.status === "ready" && sameResources) return { completion: null, state: stateBase };
      if (sameResources && stateBase.resourceIdentity) {
        // Restore host resource readiness separately. Cached application setup
        // is reusable only when its exact resources existed before provisioning.
        try {
          preparedEnvironment = await loadProjectExecutionEnvRecords({
            prepare: true, reusePrepared: true, includeResourceConfiguration: true,
            projectService, session, target: "workspace-setup"
          });
          const restoredSetup = await inspect({
            session, projectRoot: sourcePath, environment: await runtime.resolvePromptEnvironment()
          });
          if (restoredSetup?.status !== "ready" || restoredSetup.recipeHash !== recipe.recipeHash) {
            throw new Error("Workspace setup changed while preparing its environment. Retry preparation to run the current steps.");
          }
          const restored = await projectService.projectEnvironmentStatus({ sessionId, session });
          if (restored.status !== "ready") throw new Error("Project environment is not ready. Correct its configuration and retry preparation.");
          if (preparedEnvironment.resourcePreparation?.preserved === true &&
              preparedEnvironment.resourcePreparation.identity === stateBase.resourceIdentity &&
              restored.resourcePreparation?.identity === stateBase.resourceIdentity) {
            return { completion: null, state: stateBase };
          }
        } catch (error) {
          return { completion: null, state: await failed(runtime, sessionId, {
            currentLabel: "Prepare project environment", diagnostic: normalizeText(error?.message),
            recipeHash: recipe.recipeHash, renewal, transcript: stateBase.transcript,
            redactionSecrets: operationRedactionSecrets(projectExecutionEnvFromRecords(preparedEnvironment || {})),
            resourceAdmissionId: error?.details?.admission?.id
          }) };
        }
      }
    }
    const startedAt = migrationStartedAt || stateTimestamp(clock);
    const currentLabel = safeSetupLabel(recipe.steps[0].label);
    const attemptLabel = migrationTranscript
      ? ""
      : stateBase.transcript
      ? (retry === true
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
    const completion = observe(
      sessionId,
      inProjectContext(projectContext, () => execute({
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
      if (activeRuns.has(workspaceSetupRunKey(session?.sessionId))) {
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
        setup = await inspect({
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
        await connectedSourceRoots(setup, runtime, session);
      } catch {
        return false;
      }
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
      return activeRuns.has(workspaceSetupRunKey(normalizeText(sessionId)));
    },
    start,
    wait(sessionId = "") {
      return activeRuns.get(workspaceSetupRunKey(normalizeText(sessionId))) || null;
    }
  });
}

export {
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
  createWorkspaceSetupRunner
};
