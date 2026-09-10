import path from "node:path";

import {
  pathInsideOrEqual,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
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
} from "@local/vibe64-terminals/server/vibe64OutputTargets";
import {
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  projectExecutionEnvFromRecords
} from "@local/vibe64-terminals/server/projectExecutionEnv";
import {
  terminalNamespace
} from "./terminalShared.js";
import { startResourceWorkflow } from "./resourceWorkflow.js";

const WORKSPACE_SETUP_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const WORKSPACE_SETUP_RUN_NAMESPACE = "vibe64-workspace-setup";

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

function stepStatus(label = "", status = "", secrets = []) {
  return `[${safeSetupLabel(label, secrets) || "Workspace preparation"}] ${status}.`;
}

function commandDiagnostic(result = {}, label = "", secrets = []) {
  const output = normalizeText(sanitizeOperationText(
    result.stderr || result.error || result.output,
    secrets
  ));
  if (output) {
    return output.slice(-1600);
  }
  const safeLabel = safeSetupLabel(label, secrets) || "Workspace preparation";
  if (result.timedOut === true) {
    return `${safeLabel} timed out after 15 minutes.`;
  }
  return `${safeLabel} exited with code ${Number(result.exitCode) || 1}.`;
}

function workspaceSetupRunKey(sessionId = "") {
  return terminalNamespace(WORKSPACE_SETUP_RUN_NAMESPACE, sessionId);
}

function createWorkspaceSetupRunner({
  clock = () => new Date(),
  inspect = inspectVibe64WorkspaceSetup,
  inspectProjectFormat = inspectGenesisProjectFormat,
  projectService,
  startWorkflow = startResourceWorkflow,
  finishWorkflow = finishVibe64Workflow,
  runCommand = runVibe64Command
} = {}) {
  if (!projectService) {
    throw new TypeError("createWorkspaceSetupRunner requires the Vibe64 project service.");
  }
  const activeRuns = new Map();

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
    startedAt
  }) {
    const environmentRecords = await loadProjectExecutionEnvRecords({
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
    const currentSetup = await inspect({ environment, projectRoot: sourcePath });
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
      const admittedSetup = await inspect({ environment, projectRoot: sourcePath });
      if (admittedSetup?.status !== "ready" || admittedSetup.recipeHash !== recipe.recipeHash ||
          admittedSetup.stackHash !== currentSetup.stackHash) {
        throw new Error("Workspace setup changed while waiting for resources. Retry preparation to run the current steps.");
      }
      for (const [index, step] of recipe.steps.entries()) {
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
          allowedRoots: [sourcePath],
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
    const inProjectContext = (callback) => context.projectContext
      ? runWithProjectRequestContext(context.projectContext, callback)
      : callback();
    const completion = operation
      .catch((error) => inProjectContext(async () => failed(context.runtime, sessionId, {
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
      .finally(() => inProjectContext(() => {
        if (activeRuns.get(context.runKey) === completion) {
          activeRuns.delete(context.runKey);
        }
      }));
    activeRuns.set(context.runKey, completion);
    return completion;
  }

  async function start({ renewal = false, retry = false, runtime, session } = {}) {
    const sessionId = normalizeText(session?.sessionId || session?.id);
    if (!sessionId || !runtime?.store) {
      throw new TypeError("Workspace preparation requires a stored Vibe64 session.");
    }
    const projectContext = currentProjectRequestContext();
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
          status: "failed"
        }, renewal);
        return { completion: null, state };
      }

      const currentLabel = "Migrate Genesis project";
      migrationStartedAt = stateTimestamp(clock);
      migrationTranscript = appendWorkspaceSetupTranscript(
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
          return { completion: null, state };
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
        return { completion: null, state };
      }

      try {
        setup = await inspect({
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
        return { completion: null, state };
      }
      stateBase = workspaceSetupState({
        ...previous,
        currentLabel: "",
        diagnostic: "",
        finishedAt: "",
        startedAt: migrationStartedAt,
        status: "running",
        transcript: migrationTranscript
      });
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
        "STACK_SECTION_AMBIGUOUS"
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
    if (
      !migrationTranscript &&
      retry !== true &&
      stateBase.recipeHash === recipe.recipeHash &&
      ["succeeded", "failed"].includes(stateBase.status)
    ) {
      return {
        completion: null,
        state: stateBase
      };
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
      projectContext
        ? runWithProjectRequestContext(projectContext, () => execute({
            context,
            recipe,
            runtime,
            session,
            sourcePath,
            startedAt
          }))
        : execute({
            context,
            recipe,
            runtime,
            session,
            sourcePath,
            startedAt
          }),
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
      return setup.status === "ready" &&
        previous.status === "succeeded" &&
        Boolean(setup.recipeHash) &&
        previous.recipeHash === setup.recipeHash;
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
