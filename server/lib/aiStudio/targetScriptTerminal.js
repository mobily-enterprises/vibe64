import path from "node:path";
import process from "node:process";

import {
  containerWorkspacePath,
  removeDockerContainer
} from "../containerRuntime.js";
import {
  gitToolchainMountArgs
} from "../gitToolchainMounts.js";
import {
  hostUserIdentityEnvArgs,
  shellQuote,
  stableHash
} from "../shellCommands.js";
import {
  studioPlaywrightBrowsersDockerArgs
} from "../studioToolHome.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_DAEMON_PID_LABEL
} from "../studioRuntimeIdentity.js";
import {
  normalizeText
} from "./core.js";
import {
  targetRuntimeNetworkDockerArgs
} from "./runtimeContainers.js";

function targetScriptError(code, message, extra = {}) {
  return {
    ...extra,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function adapterScriptNameFromInput(input = {}) {
  const scriptId = normalizeText(input?.scriptId);
  return scriptId.startsWith("adapter:") ? scriptId.slice("adapter:".length).trim() : "";
}

function targetScriptStartupScript(command = "", {
  exitLabel = "command"
} = {}) {
  const normalizedCommand = normalizeText(command);
  const runCommand = [
    "set +e",
    `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(normalizedCommand)}`,
    normalizedCommand,
    "status=$?",
    `printf '\\n[studio] ${exitLabel} exited with code %s\\n' "$status"`,
    "exit \"$status\""
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${AI_STUDIO_HOST_UID:-}\" ] && [ -n \"${AI_STUDIO_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$AI_STUDIO_HOST_UID:$AI_STUDIO_HOST_GID\" /tmp/studio-home",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$AI_STUDIO_HOST_UID" --regid "$AI_STUDIO_HOST_GID" $docker_group_args env HOME=/tmp/studio-home bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function targetScriptContainerName({
  adapterId = "generic",
  terminalId = ""
} = {}) {
  return `ai-studio-${adapterId}-target-script-${stableHash(terminalId)}`;
}

function targetScriptTerminalArgs({
  adapterId = "generic",
  command = "",
  containerName = "",
  exitLabel = "command",
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  targetRoot = "",
  terminalId = "",
  workdir = "/workspace"
} = {}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "ai-studio.kind=target-script-terminal",
    "--label",
    `ai-studio.adapter=${adapterId}`,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    "ai-studio.session=target",
    "--label",
    `ai-studio.terminal=${terminalId}`,
    "--label",
    `ai-studio.target=${stableHash(targetRoot)}`,
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...targetRuntimeNetworkDockerArgs(targetRoot),
    ...extraDockerArgs,
    ...studioPlaywrightBrowsersDockerArgs(),
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    image,
    "bash",
    "-lc",
    targetScriptStartupScript(command, {
      exitLabel
    })
  ];
}

function scriptByName(scripts = [], scriptName = "") {
  return scripts.find((candidate) => candidate.name === scriptName) || null;
}

function commandPreviewForScript(script = {}) {
  return normalizeText(script.commandPreview || script.command);
}

function targetScriptCommandPreview(command = "") {
  return normalizeText(command);
}

async function createAiStudioTargetScriptTerminalSpec({
  adapterId = "generic",
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  input = {},
  metadata = {},
  packageManager = "",
  scripts = [],
  targetRoot = "",
  workdir = "/workspace"
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptName = adapterScriptNameFromInput(input);
  if (!scriptName) {
    return targetScriptError("missing_target_script", "scriptId must identify an adapter target script.");
  }
  const script = scriptByName(scripts, scriptName);
  if (!script) {
    return targetScriptError("invalid_target_script", `Unknown target script: ${scriptName}.`);
  }
  const command = normalizeText(script.command);
  if (!command) {
    return targetScriptError("invalid_target_script", `Target script has no command: ${scriptName}.`);
  }
  if (!containerWorkspacePath(normalizedTargetRoot, normalizedTargetRoot)) {
    return targetScriptError("invalid_target_root", "The target script directory is outside the target root.");
  }
  const commandPreview = commandPreviewForScript(script);
  return {
    args: ({ id }) => targetScriptTerminalArgs({
      adapterId,
      command,
      containerName: targetScriptContainerName({
        adapterId,
        terminalId: id
      }),
      extraDockerArgs,
      image,
      targetRoot: normalizedTargetRoot,
      terminalId: id,
      workdir
    }),
    closeExisting: true,
    command: "docker",
    commandPreview,
    cwd: normalizedTargetRoot,
    maxRunning: 1,
    metadata: {
      command,
      commandPreview,
      packageManager,
      runRoot: normalizedTargetRoot,
      scope: "target",
      scriptName,
      ...(metadata || {})
    },
    ok: true,
    onClose: async ({ id }) => {
      await removeDockerContainer(targetScriptContainerName({
        adapterId,
        terminalId: id
      }));
    },
    prepareTargetRuntimeNetwork: true,
    reuseRunning: false,
    targetRoot: normalizedTargetRoot
  };
}

export {
  adapterScriptNameFromInput,
  createAiStudioTargetScriptTerminalSpec,
  targetScriptCommandPreview,
  targetScriptError,
  targetScriptStartupScript,
  targetScriptTerminalArgs
};
