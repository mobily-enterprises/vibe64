import {
  runtimeContainersTerminalEnv
} from "../../../../server/lib/aiStudio/runtimeContainers.js";
import {
  stableHash
} from "../../../../server/lib/shellCommands.js";

const SECRET_TERMINAL_ENV_PATTERN = /(PASSWORD|PASS|TOKEN|SECRET|KEY|CREDENTIAL|PWD)/iu;

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
  if (typeof runtime?.adapter?.listRuntimeContainers !== "function") {
    return {};
  }
  const context = {
    config: runtime.projectConfig || {},
    runtime,
    session,
    target,
    targetRoot
  };
  const descriptors = await runtime.adapter.listRuntimeContainers(context);
  return runtimeContainersTerminalEnv(descriptors, {
    adapterId: runtime.adapter.id,
    context,
    targetRoot
  });
}

async function projectTerminalEnvironment({
  projectService = {},
  runtime = null,
  session = {},
  target = "",
  targetRoot = ""
} = {}) {
  const [projectConfigEnv, runtimeEnv] = await Promise.all([
    typeof projectService.projectConfigEnvironment === "function"
      ? projectService.projectConfigEnvironment()
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
    ...runtimeEnv
  };
}

export {
  adapterRuntimeTerminalEnv,
  maskedTerminalDockerArgs,
  normalizeTerminalEnv,
  terminalEnvironmentFingerprint,
  projectTerminalEnvironment,
  terminalEnvironmentDockerArgs
};
