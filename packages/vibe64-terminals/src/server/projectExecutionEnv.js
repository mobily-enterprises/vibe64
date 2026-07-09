import {
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
  const [projectConfigEnv, runtimeConfigEnv] = await Promise.all([
    typeof projectService.projectConfigEnvironment === "function"
      ? projectService.projectConfigEnvironment(projectConfigInput)
      : {},
    shouldRequestRuntimeConfig
      ? projectService.projectRuntimeConfigEnvironment(projectRuntimeConfigEnvironmentInput({
          phases: runtimeConfigPhases,
          session,
          sourcePath: String(sourcePath || worktreePath || sessionSourcePath(session) || "").trim(),
          target,
          targetRoot
        }))
      : {}
  ]);
  return {
    projectConfigEnv: normalizeExecutionEnvRecord(projectConfigEnv),
    runtimeConfigEnv: normalizeExecutionEnvRecord(runtimeConfigEnv)
  };
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
