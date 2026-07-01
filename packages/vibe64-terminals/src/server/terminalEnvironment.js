import {
  stableHash
} from "@local/studio-terminal-core/server/shellCommands";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_TARGETS,
  normalizeRuntimeConfigPhases
} from "@local/vibe64-core/server/runtimeConfig";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  adapterRuntimeContainersTerminalEnv
} from "./terminalRuntimeContainers.js";

const TERMINAL_ENV_TRACE_OPTIONS = Object.freeze({
  env: {
    VIBE64_SESSION_DEBUG: "1"
  }
});
const SECRET_TERMINAL_ENV_PATTERN = /(PASSWORD|PASS|TOKEN|SECRET|KEY|CREDENTIAL|PWD)/iu;
const SERVER_LIKE_TERMINAL_TARGETS = new Set([
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

function terminalEnvironmentTraceLog(event = "", details = {}) {
  return vibe64SessionDebugLog(event, details, TERMINAL_ENV_TRACE_OPTIONS);
}

function sortedTerminalEnvKeys(env = {}) {
  return Object.keys(normalizeTerminalEnv(env)).sort((left, right) => left.localeCompare(right));
}

function terminalEnvironmentTraceStack(label = "terminal-environment-trace") {
  return String(new Error(label).stack || "")
    .split("\n")
    .slice(1, 8)
    .map((line) => line.trim())
    .join("\n");
}

function terminalEnvironmentTraceInput({
  action = {},
  projectConfigInput = {},
  runtimeConfigInput = {},
  runtimeConfigPhases = [],
  session = {},
  sourcePath = "",
  spec = {},
  target = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  return {
    ...vibe64SessionDebugSummary(session || {}),
    actionId: String(action?.id || ""),
    actionLabel: String(action?.label || ""),
    advanceOnSuccess: action?.advanceOnSuccess === true,
    projectConfigInput,
    runtimeConfigInput,
    runtimeConfigPhases,
    sourcePath: String(sourcePath || ""),
    specCommandPreview: String(spec?.commandPreview || spec?.command || "").slice(0, 160),
    specInputKeys: Object.keys(spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {})
      .sort((left, right) => left.localeCompare(right)),
    target: String(target || ""),
    targetRoot: String(targetRoot || ""),
    worktreePath: String(worktreePath || "")
  };
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

async function projectTerminalEnvironment({
  action = {},
  projectService = {},
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
  const runtimeConfigInput = projectRuntimeConfigEnvironmentInput({
    phases: runtimeConfigPhases,
    session,
    sourcePath: String(sourcePath || worktreePath || sessionSourcePath(session) || "").trim(),
    target,
    targetRoot
  });
  const traceInput = terminalEnvironmentTraceInput({
    action,
    projectConfigInput,
    runtimeConfigInput,
    runtimeConfigPhases,
    session,
    sourcePath,
    spec,
    target,
    targetRoot,
    worktreePath
  });
  terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.start", {
    ...traceInput,
    stack: terminalEnvironmentTraceStack("terminalEnvironment caller")
  });

  async function loadProjectConfigEnv() {
    terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.projectConfigEnv.start", traceInput);
    if (typeof projectService.projectConfigEnvironment !== "function") {
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.projectConfigEnv.skipped", traceInput);
      return {};
    }
    try {
      const env = await projectService.projectConfigEnvironment(projectConfigInput);
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.projectConfigEnv.done", {
        ...traceInput,
        envKeyCount: sortedTerminalEnvKeys(env).length,
        envKeys: sortedTerminalEnvKeys(env)
      });
      return env;
    } catch (error) {
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.projectConfigEnv.error", {
        ...traceInput,
        error: vibe64SessionDebugError(error),
        stack: terminalEnvironmentTraceStack("terminal projectConfigEnv error")
      });
      throw error;
    }
  }

  async function loadRuntimeConfigEnv() {
    terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.runtimeConfigEnv.start", traceInput);
    if (typeof projectService.projectRuntimeConfigEnvironment !== "function") {
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.runtimeConfigEnv.skipped", traceInput);
      return {};
    }
    try {
      const env = await projectService.projectRuntimeConfigEnvironment(runtimeConfigInput);
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.runtimeConfigEnv.done", {
        ...traceInput,
        envKeyCount: sortedTerminalEnvKeys(env).length,
        envKeys: sortedTerminalEnvKeys(env)
      });
      return env;
    } catch (error) {
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.runtimeConfigEnv.error", {
        ...traceInput,
        error: vibe64SessionDebugError(error),
        stack: terminalEnvironmentTraceStack("terminal runtimeConfigEnv error")
      });
      throw error;
    }
  }

  async function loadAdapterRuntimeEnv() {
    terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.adapterRuntimeEnv.start", traceInput);
    try {
      const env = await adapterRuntimeTerminalEnv({
        runtime,
        session,
        target,
        targetRoot
      });
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.adapterRuntimeEnv.done", {
        ...traceInput,
        envKeyCount: sortedTerminalEnvKeys(env).length,
        envKeys: sortedTerminalEnvKeys(env)
      });
      return env;
    } catch (error) {
      terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.adapterRuntimeEnv.error", {
        ...traceInput,
        error: vibe64SessionDebugError(error),
        stack: terminalEnvironmentTraceStack("terminal adapterRuntimeEnv error")
      });
      throw error;
    }
  }

  const [projectConfigEnv, runtimeConfigEnv, runtimeEnv] = await Promise.all([
    loadProjectConfigEnv(),
    loadRuntimeConfigEnv(),
    loadAdapterRuntimeEnv()
  ]);

  const mergedEnv = {
    ...normalizeTerminalEnv(projectConfigEnv),
    ...normalizeTerminalEnv(runtimeConfigEnv),
    ...runtimeEnv
  };
  terminalEnvironmentTraceLog("server.projectConfigTrace.terminalEnvironment.done", {
    ...traceInput,
    envKeyCount: sortedTerminalEnvKeys(mergedEnv).length,
    envKeys: sortedTerminalEnvKeys(mergedEnv)
  });
  return mergedEnv;
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
  runtimeConfigTargetForTerminalTarget,
  terminalEnvironmentFingerprint,
  projectTerminalEnvironment,
  terminalEnvironmentDockerArgs
};
