import {
  stableHash
} from "@local/studio-terminal-core/server/shellCommands";
import {
  RUNTIME_CONFIG_PHASES,
  normalizeRuntimeConfigPhases
} from "@local/vibe64-core/server/runtimeConfig";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  adapterRuntimeContainersTerminalEnv
} from "./terminalRuntimeContainers.js";

const SECRET_TERMINAL_ENV_PATTERN = /(PASSWORD|PASS|TOKEN|SECRET|KEY|CREDENTIAL|PWD)/iu;
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

function normalizeTerminalEnv(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    String(key || "").trim(),
    String(value ?? "")
  ]).filter(([key]) => Boolean(key)));
}

function terminalEnvironmentDockerArgs(env = {}) {
  return Object.entries(normalizeTerminalEnv(env)).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`
  ]);
}

function terminalEnvironmentFingerprint(env = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeTerminalEnv(env))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function shouldMaskTerminalEnvKey(key = "") {
  return SECRET_TERMINAL_ENV_PATTERN.test(String(key || ""));
}

function maskedTerminalEnvArg(value = "") {
  const text = String(value || "");
  const separatorIndex = text.indexOf("=");
  if (separatorIndex < 0) {
    return shouldMaskTerminalEnvKey(text) ? `${text}=*****` : text;
  }
  const key = text.slice(0, separatorIndex);
  return shouldMaskTerminalEnvKey(key) ? `${key}=*****` : text;
}

function maskedTerminalDockerArgs(args = []) {
  const dockerArgs = Array.isArray(args) ? args : [];
  return dockerArgs.map((arg, index) => {
    const previous = dockerArgs[index - 1];
    return previous === "-e" || previous === "--env"
      ? maskedTerminalEnvArg(arg)
      : arg;
  });
}

async function adapterRuntimeTerminalEnv({
  runtime = null,
  session = {},
  target = "",
  targetRoot = ""
} = {}) {
  return adapterRuntimeContainersTerminalEnv({
    runtime,
    session,
    target,
    targetRoot
  });
}

async function projectTerminalEnvironment({
  action = {},
  projectService = {},
  runtime = null,
  session = {},
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
  const [projectConfigEnv, runtimeConfigEnv, runtimeEnv] = await Promise.all([
    typeof projectService.projectConfigEnvironment === "function"
      ? projectService.projectConfigEnvironment()
      : {},
    typeof projectService.projectRuntimeConfigEnvironment === "function"
      ? projectService.projectRuntimeConfigEnvironment({
          phases: runtimeConfigPhases,
          target,
          targetRoot,
          sourcePath: String(worktreePath || sessionSourcePath(session) || "").trim()
        })
      : {},
    adapterRuntimeTerminalEnv({
      runtime,
      session,
      target,
      targetRoot
    })
  ]);

  return {
    ...normalizeTerminalEnv(projectConfigEnv),
    ...normalizeTerminalEnv(runtimeConfigEnv),
    ...runtimeEnv
  };
}

function runtimeConfigPhasesForTerminalContext({
  action = {},
  spec = {},
  target = ""
} = {}) {
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
  adapterRuntimeTerminalEnv,
  maskedTerminalDockerArgs,
  normalizeTerminalEnv,
  runtimeConfigPhasesForCommand,
  runtimeConfigPhasesForTerminalContext,
  runtimeConfigPhasesForTerminalTarget,
  terminalEnvironmentFingerprint,
  projectTerminalEnvironment,
  terminalEnvironmentDockerArgs
};
