import {
  runVibe64Command,
  stableHash
} from "@local/vibe64-execution/server";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_TARGETS,
  normalizeRuntimeConfigPhases
} from "@local/vibe64-core/server/runtimeConfig";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
const SERVER_LIKE_TERMINAL_TARGETS = new Set([
  "codex",
  "fix-codex",
  "main",
  "shell",
  "worktree"
]);
const COMMAND_RUNTIME_PHASE_HINTS = Object.freeze([
  {
    pattern: /\binstall(?:ing|ed)?\b|dependencies|node_modules/iu,
    phase: RUNTIME_CONFIG_PHASES.INSTALL
  },
  {
    pattern: /\bmigrat(?:e|ion|ions|ing)\b|db:migrate/iu,
    phase: RUNTIME_CONFIG_PHASES.MIGRATE
  },
  {
    pattern: /\bseed(?:ing|ed)?\b|seed_/iu,
    phase: RUNTIME_CONFIG_PHASES.SEED
  },
  {
    pattern: /\bgenerat(?:e|ion|ed|ing)\b|code_index|scaffold|create_source/iu,
    phase: RUNTIME_CONFIG_PHASES.GENERATE
  },
  {
    pattern: /\bbuild\b|client-build/iu,
    phase: RUNTIME_CONFIG_PHASES.CLIENT_BUILD
  }
]);
const executionEnvironmentPreparationRuns = new Map();

function normalizeExecutionEnvRecord(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    String(key || "").trim(),
    String(value ?? "")
  ]).filter(([key]) => Boolean(key)));
}

function executionEnvFingerprint(env = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeExecutionEnvRecord(env))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function projectConfigEnvironmentInput(session = {}) {
  const sessionId = String(session?.sessionId || session?.id || "").trim();
  return sessionId ? { sessionId } : {};
}

function projectRuntimeConfigEnvironmentInput({
  phases = [],
  session = {},
  sourcePath = "",
  target = "",
  targetRoot = ""
} = {}) {
  const sessionId = String(session?.sessionId || session?.id || "").trim();
  const resolvedSourcePath = String(sourcePath || "").trim();
  return {
    phases,
    target: runtimeConfigTargetForTerminalTarget(target),
    targetRoot,
    ...(sessionId ? { sessionId } : {}),
    ...(resolvedSourcePath ? { sourcePath: resolvedSourcePath } : {})
  };
}

function runtimeConfigTargetForTerminalTarget(target = "") {
  const terminalTarget = String(target || "").trim();
  if (terminalTarget === "launch-target") {
    return RUNTIME_CONFIG_TARGETS.LAUNCH_TARGET;
  }
  if (terminalTarget === "command" || terminalTarget === "tool") {
    return RUNTIME_CONFIG_TARGETS.COMMAND;
  }
  if (SERVER_LIKE_TERMINAL_TARGETS.has(terminalTarget)) {
    return RUNTIME_CONFIG_TARGETS.SERVER;
  }
  return "";
}

async function loadProjectExecutionEnv(input = {}) {
  return projectExecutionEnvFromRecords(await loadProjectExecutionEnvRecords(input));
}

async function loadProjectExecutionEnvRecords({
  action = {},
  projectService = {},
  runCommand = runVibe64Command,
  runtime = null,
  session = {},
  sourcePath = "",
  spec = {},
  target = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const runtimeConfigPhases = runtimeConfigPhasesForTerminalContext({
    action,
    spec,
    target
  });
  const projectConfigInput = projectConfigEnvironmentInput(session);
  const shouldRequestRuntimeConfig = runtimeConfigPhases.length > 0 &&
    typeof projectService.projectRuntimeConfigEnvironment === "function";
  const resolvedSourcePath = String(sourcePath || worktreePath || sessionSourcePath(session) || "").trim();
  const [projectConfigEnv, runtimeConfigEnv] = await Promise.all([
    typeof projectService.projectConfigEnvironment === "function"
      ? projectService.projectConfigEnvironment(projectConfigInput)
      : {},
    shouldRequestRuntimeConfig
      ? projectService.projectRuntimeConfigEnvironment(projectRuntimeConfigEnvironmentInput({
          phases: runtimeConfigPhases,
          session,
          sourcePath: resolvedSourcePath,
          target,
          targetRoot
        }))
      : {}
  ]);
  const records = {
    projectConfigEnv: normalizeExecutionEnvRecord(projectConfigEnv),
    runtimeConfigEnv: normalizeExecutionEnvRecord(runtimeConfigEnv)
  };
  if (shouldRequestRuntimeConfig) {
    await prepareProjectExecutionEnvironment({
      projectService,
      records,
      runCommand,
      runtime,
      runtimeConfigPhases,
      session,
      sourcePath: resolvedSourcePath,
      target,
      targetRoot
    });
  }
  return records;
}

function projectExecutionEnvironmentTargetRoot({
  projectService = {},
  runtime = null,
  targetRoot = ""
} = {}) {
  return String(
    (typeof projectService.currentTargetRoot === "function"
      ? projectService.currentTargetRoot()
      : "") ||
    runtime?.targetRoot ||
    targetRoot ||
    ""
  ).trim();
}

function projectExecutionEnvironmentServiceDataRoot(projectService = {}) {
  return String(typeof projectService.currentServiceDataRoot === "function"
    ? projectService.currentServiceDataRoot()
    : "").trim();
}

function normalizedExecutionEnvironmentPreparation(preparation = {}, index = 0) {
  const id = String(preparation?.id || "").trim();
  const command = String(preparation?.command || "").trim();
  const coalesceKey = String(preparation?.coalesceKey || "").trim();
  if (!id || !command || !coalesceKey) {
    const error = new Error(`Execution-environment preparation ${index + 1} must declare an id, command, and coalesceKey.`);
    error.code = "vibe64_execution_environment_preparation_invalid";
    throw error;
  }
  const timeout = Number(preparation.timeout);
  return {
    allowedRoots: (Array.isArray(preparation.allowedRoots) ? preparation.allowedRoots : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
    args: (Array.isArray(preparation.args) ? preparation.args : [])
      .map((value) => String(value ?? "")),
    command,
    coalesceKey,
    cwd: String(preparation.cwd || "").trim(),
    id,
    label: String(preparation.label || id).trim(),
    runtimes: (Array.isArray(preparation.runtimes) ? preparation.runtimes : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
    timeout: Number.isSafeInteger(timeout) && timeout > 0 ? timeout : 60_000
  };
}

function executionEnvironmentPreparationFailure(preparation = {}, result = {}) {
  const detail = String(result?.stderr || result?.error || result?.output || "").trim().slice(0, 4000);
  const error = new Error([
    `Vibe64 could not ${preparation.label}. Your work is safe.`,
    detail
  ].filter(Boolean).join(" "));
  error.code = "vibe64_execution_environment_preparation_failed";
  error.preparationId = preparation.id;
  error.resultCode = String(result?.code || "").trim();
  error.retryable = true;
  return error;
}

async function runExecutionEnvironmentPreparation(preparation = {}, {
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  let result;
  try {
    result = await runCommand({
      actor: "app",
      allowedRoots: preparation.allowedRoots,
      args: preparation.args,
      command: preparation.command,
      cwd: preparation.cwd,
      envPolicy: "project",
      mode: "capture",
      project,
      purpose: "setup",
      runtimes: preparation.runtimes,
      session,
      timeout: preparation.timeout
    });
  } catch (error) {
    result = {
      code: error?.code,
      error: error?.message,
      ok: false
    };
  }
  if (result?.ok !== true) {
    throw executionEnvironmentPreparationFailure(preparation, result);
  }
  return result;
}

function coalescedExecutionEnvironmentPreparation(preparation = {}, context = {}) {
  const key = stableHash(JSON.stringify({
    coalesceKey: preparation.coalesceKey,
    id: preparation.id
  }));
  const existing = executionEnvironmentPreparationRuns.get(key);
  if (existing) {
    return existing;
  }
  const run = runExecutionEnvironmentPreparation(preparation, context);
  const tracked = run.finally(() => {
    if (executionEnvironmentPreparationRuns.get(key) === tracked) {
      executionEnvironmentPreparationRuns.delete(key);
    }
  });
  executionEnvironmentPreparationRuns.set(key, tracked);
  return tracked;
}

async function prepareProjectExecutionEnvironment({
  projectService = {},
  records = {},
  runCommand = runVibe64Command,
  runtime = null,
  runtimeConfigPhases = [],
  session = {},
  sourcePath = "",
  target = "",
  targetRoot = ""
} = {}) {
  const adapter = runtime?.adapter;
  if (typeof adapter?.listExecutionEnvironmentPreparations !== "function") {
    return [];
  }
  const executionTargetRoot = projectExecutionEnvironmentTargetRoot({
    projectService,
    runtime,
    targetRoot
  });
  const serviceDataRoot = projectExecutionEnvironmentServiceDataRoot(projectService);
  const preparations = await adapter.listExecutionEnvironmentPreparations({
    config: runtime?.projectConfig || {},
    projectConfigEnv: records.projectConfigEnv || {},
    runtimeConfigPhases,
    runtimeConfigEnv: records.runtimeConfigEnv || {},
    serviceDataRoot,
    session,
    sourcePath,
    target,
    targetRoot: executionTargetRoot
  });
  const normalized = (Array.isArray(preparations) ? preparations : [])
    .filter(Boolean)
    .map(normalizedExecutionEnvironmentPreparation);
  const project = {
    config: runtime?.projectConfig || {},
    serviceDataRoot,
    sourcePath,
    targetRoot: executionTargetRoot
  };
  for (const preparation of normalized) {
    await coalescedExecutionEnvironmentPreparation(preparation, {
      project,
      runCommand,
      session
    });
  }
  return normalized;
}

function projectExecutionEnvFromRecords({
  projectConfigEnv = {},
  runtimeConfigEnv = {}
} = {}) {
  return {
    ...normalizeExecutionEnvRecord(projectConfigEnv),
    ...normalizeExecutionEnvRecord(runtimeConfigEnv)
  };
}

function runtimeConfigPhasesForTerminalContext({
  action = {},
  spec = {},
  target = ""
} = {}) {
  if (spec.runtimeConfigPhases === false) {
    return [];
  }
  const explicitPhases = runtimeConfigPhasesFromValue(spec.runtimeConfigPhases)
    .concat(runtimeConfigPhasesFromValue(action.runtimeConfigPhases));
  if (explicitPhases.length) {
    return normalizeRuntimeConfigPhases(explicitPhases);
  }
  if (target === "command" || target === "tool") {
    return runtimeConfigPhasesForCommand({
      action,
      spec
    });
  }
  return runtimeConfigPhasesForTerminalTarget(target);
}

function runtimeConfigPhasesFromValue(value = []) {
  return Array.isArray(value) ? normalizeRuntimeConfigPhases(value) : [];
}

function runtimeConfigPhasesForCommand({
  action = {},
  spec = {}
} = {}) {
  const phaseHintText = [
    action.id,
    action.label,
    action.commandPreview,
    spec.command,
    Array.isArray(spec.args) ? spec.args.join(" ") : "",
    spec.commandPreview,
    spec.cwd
  ].filter(Boolean).join(" ");
  return normalizeRuntimeConfigPhases(COMMAND_RUNTIME_PHASE_HINTS
    .filter(({ pattern }) => pattern.test(phaseHintText))
    .map(({ phase }) => phase));
}

function runtimeConfigPhasesForTerminalTarget(target = "") {
  if (target === "launch-target") {
    return [
      RUNTIME_CONFIG_PHASES.PREVIEW,
      RUNTIME_CONFIG_PHASES.SERVER
    ];
  }
  if (SERVER_LIKE_TERMINAL_TARGETS.has(String(target || "").trim())) {
    return [
      RUNTIME_CONFIG_PHASES.SERVER
    ];
  }
  return [];
}

export {
  normalizeExecutionEnvRecord,
  runtimeConfigPhasesForCommand,
  runtimeConfigPhasesForTerminalContext,
  runtimeConfigPhasesForTerminalTarget,
  runtimeConfigTargetForTerminalTarget,
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  projectExecutionEnvFromRecords
};
